const express = require('express');
const storedCookies = require('../state/cookies');
const aiModelConfig = require('../services/ai/aiModelConfig');
const aiTtsModel = require('../services/ai/aiTtsModel');
const appSettings = require('../services/appSettings');
const { cleanupTargets, getSystemHealth } = require('../services/systemMaintenance');
const {
  DEFAULT_TTS_VOICE,
  getTtsVoiceOptions,
  normalizeTtsVoice,
} = require('../services/tts/voiceOptions');
const { getVoiceStylePrompt } = require('../services/tts/stylePrompts');
const {
  DEFAULT_ROOT_DIR,
  DEFAULT_ROOT_DIRS,
  scanTemplateManifests,
  validateTemplateCompatibility,
  mappedEngine,
  getManifestAspect,
  getManifestAspects,
} = require('../services/creative-video/html-video/templateRegistry');
const {
  buildTemplatePreviewDescriptor,
  buildTemplatePreviewHtml,
  resolveTemplatePosterPath,
} = require('../services/creative-video/html-video/templatePreviewService');

const router = express.Router();
const SUPPORTED_CLEANUP_TARGETS = new Set(['creative-workflows', 'media-cache', 'render-outputs', 'browser-data', 'cookies']);
const TTS_PREVIEW_TEXT = '你好，这是一段 MuseDock 旁白音色试听。';

async function getAppSettingsRoute(req, res) {
  try {
    const config = await appSettings.getPublicConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: '读取应用设置失败。', error: error.message });
  }
}

async function saveAppSettingsRoute(req, res) {
  try {
    const config = await appSettings.saveConfig(req.body || {});
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: '保存应用设置失败。', error: error.message });
  }
}

async function getConfigTemplatesRoute(req, res) {
  try {
    const defaults = await appSettings.getCreativeDefaults();
    const aspectRatio = defaults && defaults.aspectRatio;
    const manifests = scanTemplateManifests(DEFAULT_ROOT_DIRS || DEFAULT_ROOT_DIR);
    const templates = manifests.map(manifest => {
      const output = manifest.output || {};
      const compatibility = validateTemplateCompatibility(manifest, { aspectRatio });

      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description || '',
        category: manifest.category || '',
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
        best_for: Array.isArray(manifest.best_for) ? manifest.best_for : [],
        not_for: Array.isArray(manifest.not_for) ? manifest.not_for : [],
        visual_family: manifest.visual_family || '',
        engine: manifest.engine,
        mapped_engine: mappedEngine(manifest.engine),
        aspect_ratio: getManifestAspect(manifest),
        supported_aspects: getManifestAspects(manifest),
        duration_sec: output.duration_sec ?? output.duration,
        source_entry: manifest.source_entry,
        license: manifest.license,
        preview: buildTemplatePreviewDescriptor(manifest),
        compatible: compatibility.ok,
        compatibility_reasons: compatibility.reasons,
      };
    });

    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: '读取视频模板失败。', error: error.message });
  }
}

/**
 * 在正式模板目录中查找指定模板。
 * @param {string} templateId 模板 ID。
 * @returns {object|null} 匹配的模板声明。
 */
function findTemplateManifest(templateId) {
  const id = String(templateId || '').trim();
  if (!id) return null;
  return scanTemplateManifests(DEFAULT_ROOT_DIRS || DEFAULT_ROOT_DIR)
    .find(manifest => manifest.id === id) || null;
}

/**
 * 返回用于模板选择器的动态 HTML 预览。
 * @param {import('express').Request} req Express 请求。
 * @param {import('express').Response} res Express 响应。
 */
async function getTemplatePreviewRoute(req, res) {
  const manifest = findTemplateManifest(req.params.templateId);
  if (!manifest) {
    return res.status(404).json({ success: false, message: '未找到指定视频模板。' });
  }
  try {
    const html = await buildTemplatePreviewHtml(manifest);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    return res.type('html').send(html);
  } catch (error) {
    const status = error.code === 'TEMPLATE_PREVIEW_SOURCE_NOT_FOUND' ? 404 : 500;
    return res.status(status).json({ success: false, message: `读取模板动态预览失败：${error.message}` });
  }
}

/**
 * 返回模板选择器使用的静态封面。
 * @param {import('express').Request} req Express 请求。
 * @param {import('express').Response} res Express 响应。
 */
function getTemplatePosterRoute(req, res) {
  const manifest = findTemplateManifest(req.params.templateId);
  if (!manifest) {
    return res.status(404).json({ success: false, message: '未找到指定视频模板。' });
  }
  const posterPath = resolveTemplatePosterPath(manifest);
  if (!posterPath) {
    return res.status(404).json({ success: false, message: '当前模板尚未生成预览封面。' });
  }
  res.set('Cache-Control', 'public, max-age=3600');
  return res.sendFile(posterPath);
}

async function getConfigSystemHealthRoute(req, res) {
  try {
    const health = await getSystemHealth({ refresh: req.query?.refresh === '1' });
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, message: '读取系统状态失败。', error: error.message });
  }
}

/**
 * 返回当前支持的 MiMo 旁白音色列表。
 * @param {import('express').Request} req Express 请求。
 * @param {import('express').Response} res Express 响应。
 */
async function getTtsVoicesRoute(req, res) {
  res.json({
    success: true,
    data: {
      defaultVoice: DEFAULT_TTS_VOICE,
      voices: getTtsVoiceOptions(),
    },
  });
}

/**
 * 判断运行时配置是否指向 MiMo TTS。
 * @param {object} runtime TTS 运行时配置。
 * @returns {boolean} 是否为 MiMo。
 */
function isMimoTtsRuntime(runtime = {}) {
  const provider = String(runtime.provider || '').trim().toLowerCase();
  const providerName = String(runtime.providerName || '').trim().toLowerCase();
  const modelId = String(runtime.modelId || '').trim().toLowerCase();
  return ['mimo', 'xiaomi', 'xiaomimimo'].includes(provider)
    || ['mimo', 'xiaomi', 'xiaomimimo', '小米 mimo'].includes(providerName)
    || modelId.startsWith('mimo');
}

/**
 * 根据音频格式返回浏览器可播放的 MIME。
 * @param {string} format TTS 返回的音频格式。
 * @returns {string} MIME 类型。
 */
function audioMimeFromFormat(format) {
  const value = String(format || '').trim().toLowerCase();
  if (value === 'mp3' || value === 'mpeg') return 'audio/mpeg';
  if (value === 'm4a' || value === 'mp4') return 'audio/mp4';
  return 'audio/wav';
}

/**
 * 使用当前 TTS 配置生成一段固定文案试听音频。
 * @param {import('express').Request} req Express 请求。
 * @param {import('express').Response} res Express 响应。
 */
async function previewTtsRoute(req, res) {
  try {
    const runtime = await aiModelConfig.getRuntimeConfig('tts');
    if (!runtime || runtime.enabled !== true || !runtime.apiKey || !runtime.baseUrl || !runtime.modelId) {
      return res.status(400).json({
        success: false,
        message: 'TTS 语音合成模型未配置。请先在设置页启用 TTS 模型，并填写 API Key、Base URL 和模型 ID。',
      });
    }
    if (!isMimoTtsRuntime(runtime)) {
      return res.status(400).json({
        success: false,
        message: '当前试听音色仅支持小米 MiMo TTS。请切换到 MiMo TTS 后再试听。',
      });
    }

    const voice = normalizeTtsVoice(req.body?.voice);
    const stylePrompt = getVoiceStylePrompt(req.body?.emotionalVoice === true);
    // 试听不落盘，仅把临时音频转成 base64 返回给浏览器播放。
    const result = await aiTtsModel.callTtsModel({
      text: TTS_PREVIEW_TEXT,
      voice,
      stylePrompt,
      ttsConfig: runtime,
    });
    if (!result?.success || !result.audioBuffer) {
      return res.status(400).json({
        success: false,
        message: result?.message || '试听音色失败，请检查 TTS 配置。',
      });
    }

    return res.json({
      success: true,
      voice: result.voice || voice,
      model: result.model || {},
      audio: {
        mime: audioMimeFromFormat(result.format),
        base64: result.audioBuffer.toString('base64'),
      },
      message: '试听音频已生成。',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: `试听音色失败：${error.message}` });
  }
}

async function cleanupConfigDataRoute(req, res) {
  const targets = Array.isArray(req.body?.targets)
    ? req.body.targets.map(target => String(target || '').trim()).filter(Boolean)
    : [];

  if (targets.length === 0) {
    return res.status(400).json({ success: false, message: '请选择要清理的类型。' });
  }
  if (targets.some(target => !SUPPORTED_CLEANUP_TARGETS.has(target))) {
    return res.status(400).json({ success: false, message: '不支持的清理类型。' });
  }

  try {
    const result = await cleanupTargets({
      targets,
      storedCookies,
    });
    return res.status(result.success ? 200 : 409).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: '清理维护数据失败。', error: error.message });
  }
}

router.get('/app-settings', getAppSettingsRoute);
router.post('/app-settings', saveAppSettingsRoute);
router.get('/templates', getConfigTemplatesRoute);
router.get('/templates/:templateId/preview', getTemplatePreviewRoute);
router.get('/templates/:templateId/poster', getTemplatePosterRoute);
router.get('/system-health', getConfigSystemHealthRoute);
router.get('/tts-voices', getTtsVoicesRoute);
router.post('/tts-preview', previewTtsRoute);
router.post('/maintenance/cleanup', cleanupConfigDataRoute);

router.get('/ai-models', async (req, res) => {
  try {
    const config = await aiModelConfig.getPublicConfig();
    res.json({ success: true, ...config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/ai-models', async (req, res) => {
  try {
    const config = await aiModelConfig.saveConfig(req.body || {});
    res.json({ success: true, ...config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.cleanupConfigDataRoute = cleanupConfigDataRoute;
module.exports.audioMimeFromFormat = audioMimeFromFormat;
module.exports.isMimoTtsRuntime = isMimoTtsRuntime;
