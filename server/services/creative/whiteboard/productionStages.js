const fsp = require('fs/promises');
const path = require('path');
const { WhiteboardError, sha256 } = require('./contracts');
const store = require('./mediaStore');
const models = require('./mediaModels');
const { buildNarrationTiming, buildSilentTiming, srtText } = require('./narrationTiming');
const aiTtsModel = require('../../ai/aiTtsModel');

async function complete(ctx, item, stage, binding) {
  await ctx.change((record, now) => {
    record.whiteboard.media.current[stage] = binding;
    if (item) Object.assign(record.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
    record.whiteboard.media.activeAttemptId = '';
  });
}

async function reuseHistory(ctx, collection, key, inputIdentity) {
  const record = await ctx.read();
  const histories = [...(record.whiteboard.mediaHistory || [])].reverse();
  for (const history of histories) {
    if (history.contractVersion !== store.MEDIA_CONTRACT) continue;
    const binding = history[collection]?.[key];
    if (!binding || binding.inputIdentity !== inputIdentity) continue;
    try { await store.validateBinding(record, binding, ctx.rootDir); } catch { continue; }
    const ids = new Set(store.fileIds(binding));
    const sources = [history, ...histories].flatMap(media => media.artifacts).filter(file => ids.has(file.id));
    await ctx.change(current => {
      current.whiteboard.media[collection][key] = structuredClone(binding);
      const existing = new Set(current.whiteboard.media.artifacts.map(file => file.id));
      for (const file of sources) if (!existing.has(file.id)) { current.whiteboard.media.artifacts.push(structuredClone(file)); existing.add(file.id); }
      (current.whiteboard.media.reused ||= []).push({ collection, key, identity: binding.identity });
    });
    return true;
  }
  return false;
}

async function narrationStage(ctx, artifact) {
  let record = await ctx.read();
  const media = record.whiteboard.media;
  const silent = artifact.productionPlan.narrationMode === 'disabled';
  if (!silent && ctx.voice.service.contractHash !== media.voiceService.contractHash) throw new WhiteboardError('VOICE_CONFIG_CHANGED', '旁白服务或声音参数已变化，请重新确认制作设置后生成新版本。', 409);
  const inputIdentity = sha256({ text: artifact.narrationText, language: artifact.narrationLanguage, cues: artifact.cues,
    scenes: artifact.scenes.map(({ id, cueIds, startMs, endMs }) => ({ id, cueIds, startMs, endMs })),
    voice: media.voiceService.contractHash, silent, take: media.narrationTake || 0 });
  if (await reuseHistory(ctx, 'current', 'full_narration', inputIdentity)) return;
  const reusable = [...media.attempts].reverse().find(item => item.stage === 'full_narration' && item.inputIdentity === inputIdentity && item.received?.raw && item.received?.native);
  const item = await ctx.attempt('full_narration', '', !silent && !reusable, inputIdentity);
  const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
  let timing;
  let audio;
  let native;
  let audioInfo;
  if (silent) timing = buildSilentTiming(artifact);
  else {
    let received;
    if (reusable) received = reusable.received;
    else {
      await ctx.requesting(item.id);
      const cueMap = new Map(artifact.cues.map(cue => [cue.id, cue.text]));
      const result = await (ctx.services.aiTtsModel || aiTtsModel).callTtsModel({
        text: artifact.narrationText, language: artifact.narrationLanguage,
        durationSeconds: artifact.durationMs / 1000,
        scenes: artifact.scenes.map(scene => ({ ...scene, text: scene.cueIds.map(id => cueMap.get(id)).join('\n') })),
        ttsConfig: { ...ctx.voice.runtime, enabled: true }, env: {}, nativeWordSubtitles: true,
        maxRetries: 0, requestTimeoutMs: 180000, fetchImpl: ctx.services.fetchImpl, signal: ctx.processOptions.signal,
      });
      if (result.audioBuffer) {
        const raw = path.join(directory, 'provider-audio.bin');
        await fsp.writeFile(raw, result.audioBuffer, { flag: 'wx' });
        const files = { raw: { path: raw, kind: 'provider_audio', name: '同请求原始音频', mime: 'application/octet-stream' } };
        if (result.nativeSubtitles) files.native = { path: await ctx.jsonFile(item, 'provider-subtitles.json', result.nativeSubtitles),
          kind: 'provider_subtitles', name: '同请求原生字级字幕', mime: 'application/json' };
        received = (await ctx.publish(item, files)).result;
      }
      if (!result.success || !received?.raw || !received?.native) throw new WhiteboardError(result.code || 'UNKNOWN_EXTERNAL_OUTCOME', result.message || '语音没有返回完整的同请求音频与原生字幕证据。');
    }
    record = await ctx.read();
    const rawPath = await ctx.filePath(record, received.raw);
    const evidence = await store.readData(record, received.native, ctx.rootDir);
    const output = path.join(directory, 'narration.wav');
    audioInfo = await ctx.tools.normalizeAudio(rawPath, output, ctx.runtime, ctx.processOptions);
    if (evidence.durationMs && Math.abs(evidence.durationMs - audioInfo.durationMs) > 120) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '语音响应声明的时长与实际音频不一致。音频已保留，请核实。');
    timing = buildNarrationTiming(artifact, evidence, audioInfo.durationMs);
    timing.audioSha256 = await ctx.tools.hashFile(output);
    timing.nativeSubtitlesSha256 = received.native.sha256;
    native = received.native;
    audio = (await ctx.publish(item, { audio: { path: output, kind: 'narration', name: '完整旁白', mime: 'audio/wav' } })).result.audio;
  }
  const timelinePath = await ctx.jsonFile(item, 'timeline.json', timing);
  const srtPath = path.join(directory, 'narration.srt');
  await fsp.writeFile(srtPath, srtText(timing.captions), { flag: 'wx' });
  const files = (await ctx.publish(item, {
    timeline: { path: timelinePath, kind: 'timeline', name: '真实时间线', mime: 'application/json' },
    subtitles: { path: srtPath, kind: 'subtitles', name: '权威字幕', mime: 'application/x-subrip' },
  })).result;
  const binding = store.bind({ kind: 'full_narration', inputIdentity, ...files, audio: audio || null, native: native || null,
    durationMs: timing.durationMs, audioInfo: audioInfo || null, timingKind: timing.timingKind,
    sourceTextSha256: timing.sourceTextSha256, language: artifact.narrationLanguage });
  await complete(ctx, item, 'full_narration', binding);
}

async function lineartStage(ctx, artifact, timing) {
  for (const scene of artifact.scenes) {
    const record = await ctx.read();
    if (record.whiteboard.media.lineart[scene.id]) {
      await store.validateBinding(record, record.whiteboard.media.lineart[scene.id], ctx.rootDir); continue;
    }
    const revision = record.whiteboard.media.overrides[`lineart_generation:${scene.id}`] || '';
    const imageConfig = await ctx.services.aiModelConfig.getRuntimeConfig('image');
    const inputIdentity = sha256({ prompt: models.lineartPrompt(artifact, scene, revision), style: artifact.visualStyle, revision,
      model: imageConfig.modelId, provider: imageConfig.provider, endpoint: imageConfig.baseUrl });
    if (await reuseHistory(ctx, 'lineart', scene.id, inputIdentity)) continue;
    const reusable = [...record.whiteboard.media.attempts].reverse().find(attempt => attempt.stage === 'lineart_generation'
      && attempt.sceneId === scene.id && attempt.inputIdentity === inputIdentity && attempt.received?.rawImage);
    const item = await ctx.attempt('lineart_generation', scene.id, !reusable, inputIdentity);
    const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
    let raw;
    if (reusable) raw = await ctx.filePath(record, reusable.received.rawImage);
    else {
      const bytes = await models.generateLineart({ artifact, scene, revision, imageConfig, services: ctx.services, onRequest: () => ctx.requesting(item.id) });
      raw = path.join(directory, 'provider-image.bin');
      await fsp.writeFile(raw, bytes, { flag: 'wx' });
      await ctx.publish(item, { rawImage: { path: raw, kind: 'provider_image', name: `${scene.title}原始图`, sceneId: scene.id, mime: 'application/octet-stream' } });
    }
    const output = path.join(directory, 'lineart.png');
    await ctx.tools.python('normalize-image', { input: raw, output }, ctx.processOptions);
    await ctx.publish(item, { image: { path: output, kind: 'lineart', name: scene.title, sceneId: scene.id, mime: 'image/png' } }, (current, files, now) => {
      current.whiteboard.media.lineart[scene.id] = store.bind({ kind: 'lineart', sceneId: scene.id, inputIdentity, image: files.image });
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
    });
  }
  const record = await ctx.read();
  await complete(ctx, null, 'lineart_generation', store.bind({ kind: 'lineart_bundle',
    scenes: timing.scenes.map(scene => record.whiteboard.media.lineart[scene.id]) }));
}

async function annotationStage(ctx, artifact, timing) {
  for (const scene of timing.scenes) {
    const record = await ctx.read();
    if (record.whiteboard.media.annotations[scene.id]) {
      await store.validateBinding(record, record.whiteboard.media.annotations[scene.id], ctx.rootDir); continue;
    }
    const lineart = await store.validateBinding(record, record.whiteboard.media.lineart[scene.id], ctx.rootDir);
    const image = await ctx.filePath(record, lineart.image);
    const revision = record.whiteboard.media.overrides[`annotation_drafting:${scene.id}`] || '';
    const inputIdentity = sha256({ image: lineart.image.sha256, timing: record.whiteboard.media.current.full_narration.identity, scene, revision });
    if (await reuseHistory(ctx, 'annotations', scene.id, inputIdentity)) continue;
    const item = await ctx.attempt('annotation_drafting', scene.id, true, inputIdentity);
    const candidate = await models.structuredVision({ textConfig: ctx.config, images: [image], services: ctx.services,
      onRequest: () => ctx.requesting(item.id), validate: models.validateAnnotation,
      prompt: `实际查看这张 1920×1080 线稿，按旁白叙事顺序把可独立揭示的内容分成 1 至 3 个连续墨迹簇。连续不可分割的图形必须同组，矩形覆盖所有墨迹，可用整幅画布作一个区域。后面的区域会从前面扣除。protectedRegions 只保护确有必要的局部，不能用来掩盖错误分组，通常为空。不要切断人物、字、箭头。weight 决定本幕内分配的相对绘制时长，不输出时间或审批。\n旁白与真实时间：${JSON.stringify({ scene, cues: timing.cues.filter(cue => scene.cueIds.includes(cue.id)) })}\n修订：${revision}\n只返回 {"schemaVersion":1,"elements":[{"label":"主体","region":{"x":0,"y":0,"width":1920,"height":1080},"direction":"left-to-right","weight":1,"protectedRegions":[]}]}。`,
    });
    const annotation = models.materializeAnnotation(candidate, scene, lineart.image.sha256, record.whiteboard.media.current.full_narration.identity);
    const candidateFile = await ctx.jsonFile(item, 'candidate.json', candidate);
    const annotationFile = await ctx.jsonFile(item, 'annotation.json', annotation);
    await ctx.publish(item, { candidate: { path: candidateFile, kind: 'annotation_candidate', name: '区域候选', sceneId: scene.id, mime: 'application/json' } });
    const preview = path.join(store.workDirectory(ctx.workflowId, item.id, ctx.rootDir), 'annotation-preview.png');
    const coverage = await ctx.tools.python('annotation-preview', { image, annotation, font: ctx.runtime.font, output: preview }, ctx.processOptions);
    await ctx.publish(item, {
      annotation: { path: annotationFile, kind: 'annotation', name: `${scene.title}落墨编排`, sceneId: scene.id, mime: 'application/json' },
      preview: { path: preview, kind: 'annotation_preview', name: `${scene.title}区域预览`, sceneId: scene.id, mime: 'image/png' },
    }, (current, files, now) => {
      current.whiteboard.media.annotations[scene.id] = store.bind({ kind: 'annotation', sceneId: scene.id, inputIdentity, ...files, coverage });
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
    });
  }
  const record = await ctx.read();
  await complete(ctx, null, 'annotation_drafting', store.bind({ kind: 'annotation_bundle',
    scenes: timing.scenes.map(scene => record.whiteboard.media.annotations[scene.id]) }));
}

async function sceneStage(ctx, artifact, timing) {
  for (const scene of timing.scenes) {
    const record = await ctx.read();
    if (record.whiteboard.media.scenes[scene.id]) {
      await store.validateBinding(record, record.whiteboard.media.scenes[scene.id], ctx.rootDir); continue;
    }
    const lineart = await store.validateBinding(record, record.whiteboard.media.lineart[scene.id], ctx.rootDir);
    const annotationBinding = await store.validateBinding(record, record.whiteboard.media.annotations[scene.id], ctx.rootDir);
    const annotation = await store.readData(record, annotationBinding.annotation, ctx.rootDir);
    const image = await ctx.filePath(record, lineart.image);
    const inputIdentity = sha256({ lineart: lineart.identity, annotation: annotationBinding.identity, scene,
      showHand: artifact.productionPlan.handDisplayMode === 'show', recipe: record.whiteboard.media.recipe });
    if (await reuseHistory(ctx, 'scenes', scene.id, inputIdentity)) continue;
    const item = await ctx.attempt('scene_render', scene.id, false, inputIdentity);
    const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
    const output = path.join(directory, 'scene.mp4');
    const validation = await ctx.tools.renderScene({ image, annotation, output, scene, showHand: artifact.productionPlan.handDisplayMode === 'show' }, ctx.runtime, ctx.processOptions);
    const files = { video: { path: output, kind: 'scene_video', name: scene.title, sceneId: scene.id, mime: 'video/mp4' } };
    for (const [index, fraction] of [0.15, 0.55, 0.95].entries()) {
      const preview = path.join(directory, `frame-${index}.png`);
      await ctx.tools.extractFrame(output, preview, (scene.endMs - scene.startMs) * fraction, ctx.runtime, ctx.processOptions);
      files[`frame${index}`] = { path: preview, kind: 'scene_frame', name: `${scene.title}进度帧 ${index + 1}`, sceneId: scene.id, mime: 'image/png' };
    }
    await ctx.publish(item, files, (current, published, now) => {
      current.whiteboard.media.scenes[scene.id] = store.bind({ kind: 'scene_video', sceneId: scene.id, inputIdentity,
        video: published.video, frames: [published.frame0, published.frame1, published.frame2], validation });
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
    });
  }
  const record = await ctx.read();
  await complete(ctx, null, 'scene_render', store.bind({ kind: 'scene_bundle', scenes: timing.scenes.map(scene => record.whiteboard.media.scenes[scene.id]) }));
}

async function finalStage(ctx, artifact, timing) {
  const record = await ctx.read();
  const media = record.whiteboard.media;
  for (const stage of store.STAGES.slice(0, -1)) {
    await store.validateBinding(record, media.current[stage.id], ctx.rootDir);
    if (!media.approvals.some(approval => !approval.stale && approval.gate === store.GATES[stage.id]
      && approval.identity === media.current[stage.id].identity)) throw new WhiteboardError('APPROVAL_REQUIRED', '缺少当前上游产物的有效批准，不能合成最终视频。', 409);
  }
  const item = await ctx.attempt('final_delivery', '', false, sha256({ scenes: media.current.scene_render.identity,
    narration: media.current.full_narration.identity, recipe: media.recipe, burnSubtitles: artifact.productionPlan.burnSubtitles }));
  const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
  const sceneFiles = [];
  for (const scene of timing.scenes) sceneFiles.push(await ctx.filePath(record, media.scenes[scene.id].video));
  const audioFile = media.current.full_narration.audio ? await ctx.filePath(record, media.current.full_narration.audio) : null;
  const validation = await ctx.tools.finalVideo({ sceneFiles, audioFile, cues: timing.captions,
    durationMs: timing.durationMs, directory, burnSubtitles: artifact.productionPlan.burnSubtitles }, ctx.runtime, ctx.processOptions);
  const poster = path.join(directory, 'poster.png');
  await ctx.tools.extractFrame(path.join(directory, 'final.mp4'), poster, Math.min(timing.durationMs - 100, timing.captions[0].endMs - 50), ctx.runtime, ctx.processOptions);
  const receipt = await ctx.jsonFile(item, 'technical-validation.json', { ...validation, recipe: media.recipe,
    narrationIdentity: media.current.full_narration.identity, sceneBundleIdentity: media.current.scene_render.identity });
  await ctx.publish(item, {
    video: { path: path.join(directory, 'final.mp4'), kind: 'final_video', name: '最终白板视频', mime: 'video/mp4' },
    poster: { path: poster, kind: 'final_poster', name: '成片预览', mime: 'image/png' },
    receipt: { path: receipt, kind: 'technical_validation', name: '技术验证记录', mime: 'application/json' },
  }, (current, published) => {
    current.whiteboard.media.current.final_delivery = store.bind({ kind: 'final_video', inputIdentity: item.inputIdentity,
      ...published, validation, narrationIdentity: media.current.full_narration.identity, sceneBundleIdentity: media.current.scene_render.identity });
    current.result = { render: { output_url: `/api/creative-workflows/${ctx.workflowId}/whiteboard/media/${published.video.id}` } };
  });
  const updated = await ctx.read();
  await complete(ctx, item, 'final_delivery', updated.whiteboard.media.current.final_delivery);
}

async function reviewGate(ctx, artifact) {
  const record = await ctx.read();
  const media = record.whiteboard.media;
  if (['full_narration', 'final_delivery'].includes(media.stage)) return true;
  const binding = await store.validateBinding(record, media.current[media.stage], ctx.rootDir);
  const images = [];
  for (const scene of binding.scenes) {
    const files = media.stage === 'lineart_generation' ? [scene.image] : media.stage === 'annotation_drafting' ? [scene.preview] : scene.frames;
    for (const file of files) images.push(await ctx.filePath(record, file));
  }
  // Bound the image context per call while keeping every scene/frame in the review.
  for (let offset = 0; offset < images.length; offset += 6) {
    const subset = images.slice(offset, offset + 6);
    const item = await ctx.attempt(`review_${media.stage}`, '', true, binding.identity);
    const findings = await models.structuredVision({ textConfig: ctx.config, images: subset, services: ctx.services,
      onRequest: () => ctx.requesting(item.id),
      validate: candidate => typeof candidate?.passed === 'boolean' && typeof candidate.summary === 'string' && Array.isArray(candidate.issues)
        && candidate.issues.every(issue => typeof issue === 'string') && candidate.imageCount === subset.length ? [] : ['返回 passed 布尔值、中文 summary、issues 字符串数组、实际 imageCount。'],
      prompt: `检查全部 ${subset.length} 张当前白板图像。阶段 ${media.stage}。${media.stage === 'scene_render' ? '这里是各幕按早、中、晚顺序抽取的真实渲染帧，不是完整视频；结合逐帧解码已通过的事实检查可见遮挡、逐步揭示与结尾画面，不声称完整观看或试听。' : '检查内容是否符合方案、字形是否清晰、构图与区域边界是否合理。'}\n内容方案：${artifact.summary}\n返回 {"passed":true,"summary":"具体观察","issues":[],"imageCount":${subset.length}}。存在严重问题时 passed=false 并具体说明，不能给出批准或修改状态。`,
    });
    const resultFile = await ctx.jsonFile(item, 'findings.json', findings);
    await ctx.publish(item, { findings: { path: resultFile, kind: 'visual_findings', name: '视觉检查记录', mime: 'application/json' } }, (current, files, now) => {
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
      current.whiteboard.media.activeAttemptId = '';
      if (!findings.passed || findings.issues.length) {
        current.message = `视觉检查建议你确认或修改：${findings.issues.join('；') || findings.summary}`;
        current.current_stage_message = current.message;
        current.whiteboard.messages.push({ id: require('crypto').randomUUID(), role: 'assistant', text: current.message, createdAt: now });
      }
    });
    if (!findings.passed || findings.issues.length) return false;
  }
  return true;
}

module.exports = { narrationStage, lineartStage, annotationStage, sceneStage, finalStage, reviewGate };
