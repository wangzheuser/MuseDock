const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const defaultTtsModel = require('../ai/aiTtsModel');
const ttsTimeline = require('../tts/ttsTimeline');
const {
  computeSceneSpecSpeechHash,
  getSceneSpecSpeechSignature,
} = require('./sceneSpecHash');
const { normalizeTtsVoice } = require('../tts/voiceOptions');

function safeSceneId(sceneId) {
  return String(sceneId || 'scene')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'scene';
}

function uniqueBaseName(sceneId, usedNames) {
  const base = safeSceneId(sceneId);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  let suffix = 2;
  while (usedNames.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const next = `${base}_${suffix}`;
  usedNames.add(next);
  return next;
}

function normalizeFormat(format) {
  const raw = String(format || 'mp3').trim().toLowerCase();
  const mapped = {
    mp3: 'mp3',
    mpeg: 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    wav: 'wav',
    wave: 'wav',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    m4a: 'm4a',
    'audio/mp4': 'm4a',
    mp4: 'm4a',
  }[raw];
  return mapped || 'mp3';
}

function relativeAudioPath(fileName) {
  return `tts/${fileName}`.replace(/\\/g, '/');
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getScenes(sceneSpec, sceneId) {
  const scenes = Array.isArray(sceneSpec && sceneSpec.scenes) ? sceneSpec.scenes : [];
  if (!sceneId) {
    return scenes;
  }
  return scenes.filter(scene => scene.id === sceneId);
}

function sceneIds(sceneSpec = {}) {
  const signature = getSceneSpecSpeechSignature(sceneSpec);
  return signature.scenes.map(scene => scene.id);
}

function createSceneSpecManifestBase(projectDir, sceneSpec, { status = 'ready' } = {}) {
  const ids = sceneIds(sceneSpec);
  return {
    version: 1,
    source: 'scene_spec',
    scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec || {}),
    scene_count: ids.length,
    scene_ids: ids,
    status,
    project_dir: projectDir,
    scenes: [],
  };
}

/**
 * 读取新生成 TTS 文件的真实时长，失败时返回 0 让调用方保持兼容。
 * @param {string} filePath 音频文件路径。
 * @param {object} options ffprobe 选项。
 * @returns {Promise<number>} 音频时长秒数。
 */
async function defaultReadAudioDuration(filePath, options = {}) {
  const result = await ttsTimeline.readAudioDuration(filePath, options);
  if (Number.isFinite(Number(result))) return Number(result);
  return result?.success ? Number(result.duration || 0) : 0;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function hasManifestSceneAudio(audioManifest = {}) {
  return (Array.isArray(audioManifest.scenes) ? audioManifest.scenes : [])
    .some(scene => firstNonEmptyString(scene?.path, scene?.relative_path, scene?.relativePath));
}

// TTS manifest -> project.audio 的唯一映射实现，htmlVideoWorkflow / resumeExecutor /
// creativeWorkflows 三条链路共用，避免各自手抄后漂移。
function applyManifestToProjectAudio(project, sceneSpec, audioManifest = {}) {
  const manifest = audioManifest && typeof audioManifest === 'object' ? audioManifest : {};
  const scenes = Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : [];
  const narrationPath = firstNonEmptyString(
    manifest.combined_path,
    manifest.narration_path,
    manifest.narrationPath,
  );
  const manifestPath = firstNonEmptyString(
    manifest.tts_manifest_path,
    manifest.ttsManifestPath,
    manifest.manifest_path,
    manifest.manifestPath,
  );
  project.audio = project.audio && typeof project.audio === 'object' ? project.audio : {};
  project.audio.source = 'scene_spec';
  project.audio.scene_spec_hash = manifest.scene_spec_hash || computeSceneSpecSpeechHash(sceneSpec || {});
  project.audio.scene_count = manifest.scene_count || scenes.length;
  project.audio.scene_ids = Array.isArray(manifest.scene_ids) && manifest.scene_ids.length
    ? manifest.scene_ids
    : scenes.map(scene => scene.id);
  project.audio.status = manifest.status || 'ready';
  project.audio.tts_manifest_path = manifestPath || (narrationPath || hasManifestSceneAudio(manifest) ? 'tts/audio_manifest.json' : null);
  project.audio.narration_path = narrationPath || null;

  // 将 manifest 的文本 hash 回写到帧，导出前可精确判断旁白音频是否过期。
  const manifestByScene = new Map((Array.isArray(manifest.scenes) ? manifest.scenes : [])
    .map(scene => [String(scene?.scene_id || scene?.id || '').trim(), scene])
    .filter(([id]) => id));
  for (const frame of Array.isArray(project.frames) ? project.frames : []) {
    const sceneId = String(frame?.scene_id || frame?.id || '').trim();
    const manifestScene = manifestByScene.get(sceneId);
    if (!manifestScene) continue;
    const scene = scenes.find(item => String(item?.id || '').trim() === sceneId) || {};
    const expectedHash = hashText(scene.narration_text || frame.narration_text || '');
    const audioHash = firstNonEmptyString(manifestScene.narration_text_hash, manifestScene.text_hash);
    if (audioHash && audioHash === expectedHash) {
      frame.narration_audio_text_hash = audioHash;
      frame.narration_audio_stale = false;
      frame.narration_audio_updated_at = new Date().toISOString();
    }
    const duration = Number(manifestScene.duration ?? manifestScene.duration_sec ?? manifestScene.durationSec);
    if (Number.isFinite(duration) && duration > 0) {
      frame.narration_audio_duration_sec = Math.round(duration * 1000) / 1000;
    }
  }
  return project.audio;
}

async function readExistingManifestScenes(ttsDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(ttsDir, 'audio_manifest.json'), 'utf8'));
    return Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  } catch {
    return [];
  }
}

/**
 * 根据 scene_spec 生成或增量重生成旁白音频。
 * @param {object} options 合成参数。
 * @returns {Promise<{success: boolean, message?: string, audio_manifest: object}>} TTS 合成结果。
 */
async function synthesizeSceneNarration({
  projectDir,
  sceneSpec,
  sceneId,
  voice,
  stylePrompt,
  services = {},
} = {}) {
  if (!projectDir) {
    return { success: false, message: 'TTS 失败：缺少工程目录。', audio_manifest: { scenes: [] } };
  }
  const selectedScenes = getScenes(sceneSpec, sceneId);
  if (sceneId && selectedScenes.length === 0) {
    return { success: false, message: `TTS 失败：未找到场景 ${sceneId}。`, audio_manifest: createSceneSpecManifestBase(projectDir, sceneSpec, { status: 'failed' }) };
  }
  const scenes = selectedScenes.filter(scene => String(scene.narration_text || '').trim());
  if (scenes.length === 0) {
    return { success: true, message: '没有可生成的旁白音频。', audio_manifest: createSceneSpecManifestBase(projectDir, sceneSpec) };
  }

  const ttsModel = services.ttsModel || defaultTtsModel;
  const callTtsModel = ttsModel && ttsModel.callTtsModel;
  if (typeof callTtsModel !== 'function') {
    return { success: false, message: 'TTS 失败：未配置语音合成服务。', audio_manifest: createSceneSpecManifestBase(projectDir, sceneSpec, { status: 'failed' }) };
  }

  const readAudioDuration = services.readAudioDuration || defaultReadAudioDuration;
  const ttsDir = path.join(projectDir, 'tts');
  await fs.mkdir(ttsDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(ttsDir, '.tmp-'));
  const manifest = createSceneSpecManifestBase(projectDir, sceneSpec);
  const pendingFiles = [];
  const usedNames = new Set();
  // 统一在服务边界归一化音色，保证外部调用传入旧值或空值时仍可生成。
  const normalizedVoice = normalizeTtsVoice(voice);
  const normalizedStylePrompt = firstNonEmptyString(stylePrompt);

  try {
    for (const scene of scenes) {
      const text = String(scene.narration_text || '').trim();
      const response = await callTtsModel({
        text,
        scene_id: scene.id,
        voice: normalizedVoice,
        stylePrompt: normalizedStylePrompt,
      });
      if (!response || response.success === false || !response.audioBuffer) {
        manifest.status = 'failed';
        return {
          success: false,
          message: `TTS 失败：场景 ${scene.id} 旁白生成失败。`,
          audio_manifest: manifest,
          error: response && (response.message || response.error),
        };
      }

      const format = normalizeFormat(response.format);
      const fileName = `${uniqueBaseName(scene.id, usedNames)}.${format}`;
      const finalPath = path.join(ttsDir, fileName);
      const tempPath = path.join(tempDir, fileName);
      await fs.writeFile(tempPath, response.audioBuffer);
      const duration = await readAudioDuration(tempPath, { scene, format });
      pendingFiles.push({ tempPath, finalPath });
      manifest.scenes.push({
        scene_id: scene.id,
        path: finalPath,
        relative_path: relativeAudioPath(fileName),
        duration: Number.isFinite(Number(duration)) ? Number(duration) : 0,
        format,
        voice: response.voice || '',
        model: response.model || {},
        narration_text_hash: hashText(text),
        text_hash: hashText(text),
      });
    }

    for (const file of pendingFiles) {
      await fs.rm(file.finalPath, { force: true });
      await fs.rename(file.tempPath, file.finalPath);
    }
    if (sceneId) {
      // 单场景重生成：把磁盘上已有 manifest 里其他场景的条目并回来，避免整份覆盖丢音频
      const specIdOrder = new Map(getScenes(sceneSpec).map((scene, index) => [scene.id, index]));
      const regenerated = new Set(manifest.scenes.map(scene => scene.scene_id));
      const kept = (await readExistingManifestScenes(ttsDir))
        .filter(scene => !regenerated.has(scene.scene_id) && specIdOrder.has(scene.scene_id));
      manifest.scenes = [...kept, ...manifest.scenes]
        .sort((a, b) => (specIdOrder.get(a.scene_id) ?? 0) - (specIdOrder.get(b.scene_id) ?? 0));
    }
    await fs.writeFile(path.join(ttsDir, 'audio_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  return {
    success: true,
    audio_manifest: manifest,
    message: sceneId ? '场景旁白音频已生成。' : '全部场景旁白音频已生成。',
  };
}

module.exports = {
  synthesizeSceneNarration,
  applyManifestToProjectAudio,
};
