const fsp = require('fs/promises');
const path = require('path');

const projectStore = require('./projectStore');
const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { ensureCaptionLayer } = require('./captionLayer');
const { markCheckpointStage, markCheckpointFrame } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { normalizeCaptions, trustedSceneDuration } = require('./rawHtmlFrameBuilder');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const { AGENTS, STAGES } = require('../agentStages');

const FRAME_HTML_MODEL_OPTIONS = { requestTimeoutMs: 180000, maxRetries: 1 };
const FRAME_HTML_CONCURRENCY = 1;

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const max = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: max }, async () => {
    while (next < list.length) {
      const current = next;
      next += 1;
      results[current] = await mapper(list[current], current);
    }
  }));
  return results;
}

function isProviderMissingText(message) {
  return /返回结果缺少文本内容|流式返回结果缺少文本内容/.test(String(message || ''));
}

function firstExplicitDiagnosticCode(diagnostics) {
  if (!Array.isArray(diagnostics)) return '';
  for (const item of diagnostics) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const code = String(item.code || '').trim().replace(/-/g, '_');
    if (code) return code;
  }
  return '';
}

async function writeFailedFrameHtml(projectDir, sceneId, html) {
  const text = String(html || '');
  if (!text.trim()) return '';
  const safeSceneId = String(sceneId || 'frame').replace(/[^A-Za-z0-9_.-]+/g, '_') || 'frame';
  const relativePath = `frames/.failed/${safeSceneId}.html`;
  const absolutePath = projectStore.resolveProjectPath(projectDir, relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, text, 'utf8');
  return relativePath;
}

function isFrameProviderMissingText(result = {}) {
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  if (diagnostics.some(item => item?.details?.retry_provider_missing_text === true)) return true;
  const diagnosticCode = firstExplicitDiagnosticCode(diagnostics);
  if (diagnosticCode) return diagnosticCode === 'provider_missing_text';
  return isProviderMissingText(result.message);
}

/**
 * 判断失败是否适合用精简提示词重试并在连续失败后启用基础帧兜底。
 */
function shouldRetryInvalidFrameOutput(result = {}) {
  if (isFrameProviderMissingText(result)) return true;
  return ['html_document_extract_failed', 'html_validation_failed']
    .includes(firstExplicitDiagnosticCode(result.diagnostics));
}

/**
 * 判断帧模型调用是否为可恢复的网关/网络故障。
 * 这类故障不应阻断整条可编辑工程，重试一次后使用基础帧继续生成。
 */
function isTransientFrameProviderFailure(result = {}) {
  const text = [
    result?.message,
    result?.error,
    ...(Array.isArray(result?.diagnostics)
      ? result.diagnostics.map(item => item?.message || item?.user_message || item?.code)
      : []),
  ].filter(Boolean).join(' ');
  return /HTTP\s*5(?:02|03|04|24)|(?:gateway|upstream|network|socket|connect|timed?\s*out|timeout|连接|网关|上游|超时)/i.test(text);
}

function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 为资讯场景补齐可见来源和日期，避免事实只存在于旁白或 scene-spec 元数据中。
 */
function ensureUpdateSourceAttributionHtml(html, scene = {}, target = {}) {
  const source = String(scene.source_attribution || scene.sourceAttribution || '').trim();
  const date = String(scene.update_time || scene.updateTime || '').trim();
  const original = String(html || '');
  if (scene.content_role !== 'update' || (!source && !date) || !original.trim()) return original;
  const visibleText = original
    .replace(/<!--[^>]*-->/g, ' ')
    .replace(/<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, '');
  const normalized = visibleText;
  const sourceLabel = source.split(/[《(（\[]/, 1)[0].replace(/(?:官方)?(?:产品更新页面|产品页面|产品页|更新页面)/g, '官方页面').trim() || source;
  const hasSource = !source || normalized.includes(sourceLabel.replace(/\s+/g, ''));
  const hasDate = !date || normalized.includes(date.replace(/\s+/g, ''));
  if (hasSource && hasDate) return original;
  const resolution = frameHtmlAgent.resolveResolution(target);
  const dateParts = date.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const dateLabel = dateParts
    ? `${dateParts[1]}-${String(dateParts[2]).padStart(2, '0')}-${String(dateParts[3]).padStart(2, '0')}`
    : date;
  const label = [sourceLabel ? `来源：${sourceLabel}` : '', dateLabel ? `日期：${dateLabel}` : ''].filter(Boolean).join('｜');
  const overlay = `<div data-role="source-attribution" data-text-key="source" style="position:absolute;left:72px;right:72px;top:${resolution.height >= 1500 ? 500 : 180}px;z-index:30;color:rgba(226,232,240,.86);font:600 16px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;letter-spacing:.02em;text-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlAttribute(label)}</div>`;
  return /<\/body>/i.test(original)
    ? original.replace(/<\/body>/i, `${overlay}</body>`)
    : `${original}${overlay}`;
}

/**
 * 清理分析场景中未被证据支持的装饰性指标，防止观众误读为实测数据。
 */
function sanitizeAnalysisMetricVisuals(html, scene = {}) {
  const original = String(html || '');
  const role = String(scene.content_role || '').trim();
  if (!['analysis', 'action'].includes(role) || !original.trim()) return original;
  const protectedBlocks = [];
  const protectedHtml = original.replace(/<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, block => {
    const token = `___MUSEDOCK_PROTECTED_${protectedBlocks.length}___`;
    const normalizedBlock = /<style\b/i.test(block)
      ? block.replace(/((?:\.bar|\.progress)[^{}]*\{[^}]*?width:)\s*\d+(?:\.\d+)?%/gi, '$1 100%')
      : block;
    protectedBlocks.push(normalizedBlock);
    return token;
  });
  const cleaned = protectedHtml.replace(/>([^<]+)</g, (match, text) => {
    const nextText = String(text)
      .replace(/\+?\d+(?:\.\d+)?\s*(?:×|x|%|倍)/g, '示意')
      .replace(/\bTOP\s*\d+\b/g, '示意')
      .replace(/\bMAX\b/g, '示意');
    return `>${nextText}<`;
  });
  const equalized = cleaned.replace(/((?:\.bar|\.progress)[^{}]*\{[^}]*?width:)\s*\d+(?:\.\d+)?%/gi, '$1 100%');
  const restored = equalized.replace(/___MUSEDOCK_PROTECTED_(\d+)___/g, (_, index) => protectedBlocks[Number(index)] || '');
  return restored;
}

function normalizeGeneratedFrameHtml(html, scene, target) {
  const positioned = String(html || '').replace(/(<[^>]*data-role=["']source-attribution["'][^>]*style=")([^"]*)("[^>]*>)/gi, (_, prefix, style, suffix) => {
    const nextStyle = style
      .replace(/bottom\s*:\s*[-\d.]+px\s*;?/gi, '')
      .replace(/top\s*:\s*[-\d.]+px\s*;?/gi, '')
      .replace(/font:\s*600\s*22px/gi, 'font:600 16px')
      .concat('top:500px;');
    return `${prefix}${nextStyle}${suffix}`;
  }).replace(/(<[^>]*data-role=["']measurement-disclaimer["'][^>]*style=")([^"]*)("[^>]*>)/gi, (_, prefix, style, suffix) => {
    const nextStyle = style
      .replace(/bottom\s*:\s*[-\d.]+px\s*;?/gi, '')
      .replace(/top\s*:\s*[-\d.]+px\s*;?/gi, '')
      .replace(/font:\s*600\s*22px/gi, 'font:600 18px')
      .concat('top:1800px;');
    return `${prefix}${nextStyle}${suffix}`;
  });
  const sanitized = sanitizeAnalysisMetricVisuals(positioned, scene);
  return ensureUpdateSourceAttributionHtml(sanitized, scene, target);
}

function frameFallbackDiagnostic(frameId, details = {}) {
  return createDiagnostic({
    code: 'fallback_frame_html_used',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: frameId,
    severity: 'warning',
    fallback_allowed: true,
    retryable: false,
    user_message: '当前帧 AI 生成连续失败，已使用基础 HTML 兜底。',
    details,
  });
}

function clipText(value, max = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function blockingLayoutIssues(report = {}) {
  return (Array.isArray(report.issues) ? report.issues : [])
    .filter(issue => issue && issue.severity !== 'warning' && issue.severity !== 'info');
}

function summarizeLayoutIssues(issues = []) {
  return issues.slice(0, 3).map((issue) => {
    const details = issue.details || {};
    const pair = details.first?.text && details.second?.text
      ? `「${clipText(details.first.text)}」与「${clipText(details.second.text)}」互相遮挡`
      : (details.text ? `「${clipText(details.text)}」` : '');
    return [issue.message || issue.code, pair].filter(Boolean).join('：');
  }).join('；');
}

async function inspectGeneratedFrameLayout({
  layoutQaService,
  projectDir,
  sceneId,
  node,
  scene,
  html,
  target,
  generateCaptions = true,
}) {
  const safeSceneId = String(sceneId || node.id || 'frame').replace(/[^A-Za-z0-9_.-]+/g, '_') || 'frame';
  // QA 文件与正式 frame 保持同层，确保 ../assets 等相对素材路径仍然有效。
  const relativePath = `frames/.qa-${safeSceneId}.html`;
  const absolutePath = projectStore.resolveProjectPath(projectDir, relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  const durationSec = trustedSceneDuration(scene || {}, node);
  // 使用最终渲染一致的字幕层做 QA，避免字幕注入后才发现遮挡。
  const qaHtml = generateCaptions
    ? ensureCaptionLayer(String(html || ''), normalizeCaptions(scene || {}, durationSec))
    : String(html || '');
  await fsp.writeFile(absolutePath, qaHtml, 'utf8');
  try {
    return await layoutQaService.inspectFrameHtmlLayout({
      htmlPath: absolutePath,
      frame: { id: node.id || sceneId },
      resolution: frameHtmlAgent.resolveResolution(target),
      durationSec,
    });
  } catch (error) {
    // ponytail: QA 基建失败不拦帧，渲染前的 layout gate 仍是最终兜底
    return { success: true, issues: [], metrics: { skipped: true, error: error.message || String(error) } };
  } finally {
    await fsp.rm(absolutePath, { force: true }).catch(() => {});
  }
}

/**
 * 生成（或复用）每一帧的 HTML，并写盘 + 打 checkpoint。
 * 行为与原 generateHtmlVideo 内联实现 1:1 一致。
 * @returns {Promise<{ok:true, project:object, contentGraph:object}|{ok:false, failure:object}>}
 */
async function runFrameHtmlPhase(ctx) {
  const {
    model,
    projectDir,
    sceneSpec,
    creativeContext,
    templateRenderTarget,
    template,
    mediaOptions,
    frameHtmlConcurrency,
    resumeAllowed,
    regenerateFrameHtmlRequested,
    runLayoutQa,
    layoutQaService,
    onProgress,
    diagnostics,
    // workflow-local 共享助手
    report,
    objectOrEmpty,
    sha256,
    failure,
    shouldReuseFrameHtml,
    invalidateFrameHtmlDependents,
  } = ctx;
  let { project, contentGraph } = ctx;

  const nodes = contentGraph.nodes || [];
  const scenes = new Map((Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : []).map(scene => [scene.id, scene]));
  let visualStyleReferenceHtml = '';
  const frameResults = [];
  const frameJobs = [];
  const unresolvedLayoutIssues = [];
  let completedFrameHtmlCount = 0;
  const concurrency = Math.min(5, Math.max(1, Math.round(Number(frameHtmlConcurrency) || FRAME_HTML_CONCURRENCY)));
  const frameHtmlRunsInParallel = concurrency > 1;
  const generateFrameJob = async job => {
    const { index, node, sceneId, scene, styleReferenceHtml } = job;
    await report(onProgress, {
      type: 'html_video_frame_html_started',
      stage: 'project',
      sub_stage: 'frame_html',
      message: frameHtmlRunsInParallel
        ? `正在并发生成第 ${index + 1}/${nodes.length} 帧 HTML...`
        : `正在逐帧生成第 ${index + 1}/${nodes.length} 帧 HTML...`,
      frame_id: node.id,
      data: {
        frame_id: node.id,
        index,
        total: nodes.length,
        completed: completedFrameHtmlCount,
        parallel: frameHtmlRunsInParallel,
        concurrency,
      },
    });
    let htmlResult = await frameHtmlAgent.generateFrameHtml({
      model,
      frameId: node.id || sceneId,
      attempt: 1,
      modelOptions: {
        ...FRAME_HTML_MODEL_OPTIONS,
        audit: {
          agent: AGENTS.frameHtml,
          stage: STAGES.frameHtml,
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          node_id: node.id || '',
          attempt: 1,
        },
      },
      graph: contentGraph,
      node,
      index,
      total: nodes.length,
      sceneSpec,
      creativeContext,
      target: templateRenderTarget,
      template,
      visualStyleReferenceHtml: styleReferenceHtml,
      previousFrameHtml: '',
    });
    if (!htmlResult.success && (shouldRetryInvalidFrameOutput(htmlResult) || isTransientFrameProviderFailure(htmlResult))) {
      const previousFailedHtml = htmlResult.failed_html;
      const previousDiagnostics = Array.isArray(htmlResult.diagnostics) ? htmlResult.diagnostics : [];
      htmlResult = await frameHtmlAgent.generateFrameHtml({
        model,
        frameId: node.id || sceneId,
        attempt: 2,
        modelOptions: {
          ...FRAME_HTML_MODEL_OPTIONS,
          stream: false,
          audit: {
            agent: AGENTS.frameHtml,
            stage: STAGES.frameHtml,
            sub_stage: 'frame_html',
            frame_id: node.id || sceneId,
            node_id: node.id || '',
            attempt: 2,
          },
        },
        shortPrompt: true,
        graph: contentGraph,
        node,
        index,
        total: nodes.length,
        sceneSpec,
        creativeContext,
        target: templateRenderTarget,
        template,
        visualStyleReferenceHtml: styleReferenceHtml,
        previousFrameHtml: '',
      });
      if (!htmlResult.success) {
        const failedHtmlPath = await writeFailedFrameHtml(projectDir, sceneId, htmlResult.failed_html || previousFailedHtml);
        const warning = frameFallbackDiagnostic(node.id || sceneId, {
          ...(failedHtmlPath ? { failed_html_path: failedHtmlPath } : {}),
          diagnostics: [
            ...previousDiagnostics.map(item => item?.user_message || item?.message || item?.code).filter(Boolean),
            ...(Array.isArray(htmlResult.diagnostics) ? htmlResult.diagnostics : []).map(item => item?.user_message || item?.message || item?.code).filter(Boolean),
          ].slice(0, 6),
        });
        diagnostics.push(warning);
        htmlResult = {
          success: true,
          html: frameFallbackBuilder.buildFallbackFrameHtml({
            scene,
            node,
            target: templateRenderTarget,
            template,
          }),
          fallbackDiagnostic: warning,
        };
      }
    }
    // 先规范来源和指标，再做布局 QA，避免后置注入绕过遮挡检查。
    if (htmlResult.success && htmlResult.html) {
      htmlResult.html = normalizeGeneratedFrameHtml(htmlResult.html, scene, templateRenderTarget);
    }
    if (
      htmlResult.success
      && !htmlResult.fallbackDiagnostic
      && runLayoutQa === true
      && layoutQaService
      && typeof layoutQaService.inspectFrameHtmlLayout === 'function'
    ) {
      const layoutQaArgs = {
        layoutQaService,
        projectDir,
        sceneId,
        node,
        scene,
        target: templateRenderTarget,
        generateCaptions: mediaOptions.generateCaptions !== false,
      };
      const firstQa = await inspectGeneratedFrameLayout({ ...layoutQaArgs, html: htmlResult.html });
      const firstBlocking = blockingLayoutIssues(firstQa);
      if (firstBlocking.length) {
        await report(onProgress, {
          type: 'html_video_frame_layout_repair_started',
          stage: 'project',
          sub_stage: 'frame_html',
          message: `第 ${index + 1}/${nodes.length} 帧检测到布局或开场画面问题，正在自动修复...`,
          frame_id: node.id,
          data: { frame_id: node.id, issues: firstBlocking.slice(0, 3) },
        });
        const repaired = await frameHtmlAgent.generateFrameHtml({
          model,
          frameId: node.id || sceneId,
          attempt: 2,
          modelOptions: {
            ...FRAME_HTML_MODEL_OPTIONS,
            stream: false,
            audit: {
              agent: AGENTS.frameHtml,
              stage: STAGES.frameHtml,
              sub_stage: 'frame_html',
              frame_id: node.id || sceneId,
              node_id: node.id || '',
              attempt: 2,
              repair_attempt: 'layout_qa',
            },
          },
          graph: contentGraph,
          node,
          index,
          total: nodes.length,
          sceneSpec,
          creativeContext,
          target: templateRenderTarget,
          template,
          visualStyleReferenceHtml: styleReferenceHtml,
          previousFrameHtml: '',
          layoutFeedback: summarizeLayoutIssues(firstBlocking),
        });
        let unresolved = firstBlocking;
        if (repaired.success) {
          const secondQa = await inspectGeneratedFrameLayout({ ...layoutQaArgs, html: repaired.html });
          const secondBlocking = blockingLayoutIssues(secondQa);
          if (secondBlocking.length < firstBlocking.length) {
            htmlResult = { success: true, html: repaired.html, diagnostics: repaired.diagnostics || [] };
            unresolved = secondBlocking;
          }
        }
        if (unresolved.length) {
          unresolvedLayoutIssues.push(...unresolved.map(issue => ({
            ...issue,
            frame_id: node.id || sceneId,
          })));
          diagnostics.push(createDiagnostic({
            code: 'frame_layout_qa_unresolved',
            stage: 'ai-frame-html',
            sub_stage: 'frame_html',
            frame_id: node.id || sceneId,
            severity: 'warning',
            retryable: true,
            repair_action: 'retry_frame_html',
            fallback_allowed: true,
            user_message: `第 ${index + 1} 帧自动修复后仍可能存在布局遮挡：${summarizeLayoutIssues(unresolved)}`,
            details: { frame_id: node.id || sceneId, issues: unresolved.slice(0, 5) },
          }));
        }
        await report(onProgress, {
          type: 'html_video_frame_layout_repair_done',
          stage: 'project',
          sub_stage: 'frame_html',
          message: unresolved.length
            ? `第 ${index + 1}/${nodes.length} 帧自动修复后仍有布局或开场画面问题，已记录警告。`
            : `第 ${index + 1}/${nodes.length} 帧布局和开场画面问题已自动修复。`,
          frame_id: node.id,
          data: { frame_id: node.id, resolved: unresolved.length === 0, remaining_issues: unresolved.slice(0, 3) },
        });
      }
    }
    if (htmlResult.success && htmlResult.html) {
      htmlResult.html = normalizeGeneratedFrameHtml(htmlResult.html, scene, templateRenderTarget);
    }
    return { ...job, htmlResult };
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const sceneId = resolveNodeSceneId(node) || node.id;
    const scene = scenes.get(sceneId);
    const checkpointFrame = objectOrEmpty(project.generation_checkpoint?.stages?.frame_html?.frames?.[sceneId]);
    const reuse = shouldReuseFrameHtml({
      projectDir,
      checkpointFrame,
      scene,
      node,
      target: templateRenderTarget,
      resumeAllowed: resumeAllowed && !regenerateFrameHtmlRequested,
    });
    if (reuse.reuse) {
      const durationSec = trustedSceneDuration(scene || {}, node);
      const normalizedReuseHtml = normalizeGeneratedFrameHtml(reuse.html, scene, templateRenderTarget);
      let htmlPath = reuse.html_path;
      if (normalizedReuseHtml !== reuse.html) {
        const captions = mediaOptions.generateCaptions !== false && scene
          ? normalizeCaptions(scene, durationSec)
          : [];
        const rewritten = await projectStore.writeRawFrameHtml({
          projectDir,
          sceneId,
          order: index + 1,
          html: normalizedReuseHtml,
          captions,
          durationSec,
        });
        htmlPath = rewritten.html_path;
      }
      nodes[index] = {
        ...node,
        durationSec,
        html_path: htmlPath,
      };
      contentGraph = {
        ...contentGraph,
        nodes,
      };
      project = await projectStore.writeProjectJson(projectDir, current => {
        current.content_graph = contentGraph;
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        return current;
      });
      if (!visualStyleReferenceHtml) visualStyleReferenceHtml = normalizedReuseHtml;
      completedFrameHtmlCount += 1;
      await report(onProgress, {
        type: 'html_video_frame_html_done',
        stage: 'project',
        sub_stage: 'frame_html',
        message: `第 ${index + 1}/${nodes.length} 帧 HTML 已复用。`,
        frame_id: node.id,
        data: {
          frame_id: node.id,
          index,
          total: nodes.length,
          reused: true,
          completed: completedFrameHtmlCount,
        },
      });
      continue;
    }
    frameJobs.push({ index, node, sceneId, scene });
  }

  if (frameJobs.length > 1) {
    await report(onProgress, {
      type: 'html_video_frame_html_parallel_started',
      stage: 'project',
      sub_stage: 'frame_html',
      message: frameHtmlRunsInParallel
        ? `正在并发生成 ${frameJobs.length} 帧 HTML，最多同时生成 ${concurrency} 帧。`
        : `正在逐帧生成 ${frameJobs.length} 帧 HTML。`,
      data: {
        total: nodes.length,
        completed: completedFrameHtmlCount,
        pending: frameJobs.length,
        concurrency,
      },
    });
  }

  if (frameJobs.length) {
    let remainingJobs = frameJobs;
    if (!visualStyleReferenceHtml) {
      const firstResult = await generateFrameJob({
        ...frameJobs[0],
        styleReferenceHtml: '',
      });
      frameResults.push(firstResult);
      if (firstResult.htmlResult.success) visualStyleReferenceHtml = firstResult.htmlResult.html;
      remainingJobs = frameJobs.slice(1);
    }
    frameResults.push(...await mapLimit(
      remainingJobs.map(job => ({ ...job, styleReferenceHtml: visualStyleReferenceHtml })),
      concurrency,
      generateFrameJob,
    ));
  }

  for (const frameResult of frameResults.sort((a, b) => a.index - b.index)) {
    const { index, node, sceneId, scene, htmlResult } = frameResult;
    if (!htmlResult.success) {
      const failedHtmlPath = await writeFailedFrameHtml(projectDir, sceneId, htmlResult.failed_html);
      const explicitDiagnosticCode = firstExplicitDiagnosticCode(htmlResult.diagnostics);
      const diagnosticCode = explicitDiagnosticCode || (isProviderMissingText(htmlResult.message) ? 'provider_missing_text' : 'frame_html_invalid');
      let rawDiagnostics = diagnosticCode === 'provider_missing_text' && !explicitDiagnosticCode
        ? (Array.isArray(htmlResult.diagnostics) ? htmlResult.diagnostics : []).map(item => ({
          ...objectOrEmpty(item),
          code: 'provider_missing_text',
        }))
        : htmlResult.diagnostics;
      if (failedHtmlPath && Array.isArray(rawDiagnostics)) {
        rawDiagnostics = rawDiagnostics.map(item => ({
          ...objectOrEmpty(item),
          details: (() => {
            const { failed_html: _failedHtml, ...details } = objectOrEmpty(item?.details);
            return { ...details, failed_html_path: failedHtmlPath };
          })(),
        }));
      }
      const normalizedFrameDiagnostics = normalizeDiagnostics(rawDiagnostics, {
        code: diagnosticCode,
        stage: 'ai-frame-html',
        sub_stage: 'frame_html',
        frame_id: node.id || sceneId,
        user_message: htmlResult.message || '单帧 HTML 生成失败。',
        retryable: true,
        repair_action: 'retry_frame_html',
        details: failedHtmlPath ? { failed_html_path: failedHtmlPath } : {},
      });
      const checkpointDiagnosticCode = normalizedFrameDiagnostics[0]?.code || diagnosticCode;
      project = await projectStore.writeProjectJson(projectDir, current => {
        invalidateFrameHtmlDependents(current, sceneId);
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', sceneId, {
          status: 'failed',
          diagnostic_code: checkpointDiagnosticCode,
        });
        return current;
      });
      return { ok: false, failure: failure(htmlResult.message || '单帧 HTML 生成失败。', normalizedFrameDiagnostics.length ? normalizedFrameDiagnostics : [
        createDiagnostic({
          code: diagnosticCode,
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          user_message: htmlResult.message || '单帧 HTML 生成失败。',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: { frame_id: node.id },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      }) };
    }
    if (Array.isArray(htmlResult.diagnostics) && htmlResult.diagnostics.length) {
      diagnostics.push(...normalizeDiagnostics(htmlResult.diagnostics));
    }
    const durationSec = trustedSceneDuration(scene || {}, node);
    const captions = mediaOptions.generateCaptions !== false && scene
      ? normalizeCaptions(scene, durationSec)
      : [];
    let written;
    try {
      written = await projectStore.writeRawFrameHtml({
        projectDir,
        sceneId,
        order: index + 1,
        html: htmlResult.html,
        captions,
        durationSec,
      });
    } catch (error) {
      project = await projectStore.writeProjectJson(projectDir, current => {
        invalidateFrameHtmlDependents(current, sceneId);
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', sceneId, {
          status: 'failed',
          diagnostic_code: 'frame_html_write_failed',
        });
        return current;
      });
      return { ok: false, failure: failure(error.message || '单帧 HTML 写入失败。', [
        createDiagnostic({
          code: 'frame_html_write_failed',
          stage: 'frame-html',
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          user_message: '单帧 HTML 写入失败。',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: { frame_id: node.id },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      }) };
    }
    nodes[index] = {
      ...node,
      durationSec,
      html_path: written.html_path,
    };
    contentGraph = {
      ...contentGraph,
      nodes,
    };
    project = await projectStore.writeProjectJson(projectDir, current => {
      invalidateFrameHtmlDependents(current, sceneId);
      current.content_graph = contentGraph;
      markCheckpointStage(current, 'frame_html', { status: 'partial' });
      markCheckpointFrame(current, 'frame_html', sceneId, {
        status: 'done',
        html_path: written.html_path,
        input_hash: sha256(htmlResult.html),
        output_hash: written.output_hash,
        diagnostic_code: htmlResult.fallbackDiagnostic?.code || '',
      });
      return current;
    });
    completedFrameHtmlCount += 1;
    await report(onProgress, {
      type: 'html_video_frame_html_done',
      stage: 'project',
      sub_stage: 'frame_html',
      message: `第 ${index + 1}/${nodes.length} 帧 HTML 已生成。`,
      frame_id: node.id,
      data: {
        frame_id: node.id,
        index,
        total: nodes.length,
        completed: completedFrameHtmlCount,
        parallel: frameJobs.length > 1 && frameHtmlRunsInParallel,
        concurrency: frameJobs.length > 1 ? concurrency : 1,
      },
    });
  }
  project = await projectStore.writeProjectJson(projectDir, current => {
    current.content_graph = contentGraph;
    if (unresolvedLayoutIssues.length) {
      current.layout_qa_reports = Array.isArray(current.layout_qa_reports) ? current.layout_qa_reports : [];
      current.layout_qa_reports.push({
        id: `layout_qa_${String(current.layout_qa_reports.length + 1).padStart(4, '0')}`,
        created_at: new Date().toISOString(),
        frame_id: null,
        success: false,
        issues: unresolvedLayoutIssues,
        checked_count: nodes.length,
        skipped_count: 0,
      });
    }
    markCheckpointStage(current, 'frame_html', { status: 'done' });
    return current;
  });

  return { ok: true, project, contentGraph };
}

module.exports = {
  runFrameHtmlPhase,
  isTransientFrameProviderFailure,
  isProviderMissingText,
  ensureUpdateSourceAttributionHtml,
  sanitizeAnalysisMetricVisuals,
  normalizeGeneratedFrameHtml,
  FRAME_HTML_CONCURRENCY,
  FRAME_HTML_MODEL_OPTIONS,
};
