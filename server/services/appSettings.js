const fsp = require('fs/promises');
const path = require('path');

const aiModelConfig = require('./ai/aiModelConfig');
const { DEFAULT_TTS_VOICE, normalizeTtsVoice } = require('./tts/voiceOptions');

const DEFAULT_CONFIG_PATH = path.join(require('../dataRoot'), 'data/config/app-settings.json');
const DEFAULT_AI_CONFIG_PATH = aiModelConfig.DEFAULT_CONFIG_PATH
  || path.join(require('../dataRoot'), 'data/config/ai-models.json');

const ALLOWED_ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];
const ALLOWED_CREATIVE_FPS = [30, 60];
const ALLOWED_CONTENT_MODES = ['news', 'analysis', 'discussion'];

const DEFAULT_CONFIG = {
  version: 1,
  creativeDefaults: {
    aspectRatio: '9:16',
    targetDurationSec: 60,
    fps: 30,
    playbackSpeed: 1,
    templateByAspectRatio: {
      '9:16': 'news_signal_vertical',
      '16:9': 'bold_signal',
      '1:1': '',
      '4:5': '',
    },
    lockTemplate: false,
    contentMode: 'analysis',
    useResearch: true,
    generateAudio: true,
    autoSfxEnabled: true,
    generateCaptions: true,
    emotionalVoice: false,
    ttsVoice: DEFAULT_TTS_VOICE,
    sourceImageAnalysisEnabled: false,
    extractDouyinFrames: false,
    frameHtmlConcurrency: 1,
  },
  system: {
    skipValidation: false,
    pexelsApiKey: '',
  },
};

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function normalizeDurationSec(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_CONFIG.creativeDefaults.targetDurationSec;
  return Math.min(180, Math.max(15, Math.round(number)));
}

function normalizeSmallInteger(value, defaultValue, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return defaultValue;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * 归一化默认导出倍速。
 * @param {unknown} value 倍速值。
 * @returns {number} 0.1 到 2.0 之间且最多一位小数的倍速。
 */
function normalizePlaybackSpeed(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d)?$/.test(text)) return DEFAULT_CONFIG.creativeDefaults.playbackSpeed;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0.1 && number <= 2
    ? number
    : DEFAULT_CONFIG.creativeDefaults.playbackSpeed;
}

function normalizeCreativeDefaults(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const templateSource = source.templateByAspectRatio && typeof source.templateByAspectRatio === 'object'
    ? source.templateByAspectRatio
    : {};
  const templateByAspectRatio = {};

  for (const ratio of ALLOWED_ASPECT_RATIOS) {
    if (Object.prototype.hasOwnProperty.call(templateSource, ratio)) {
      const value = templateSource[ratio];
      templateByAspectRatio[ratio] = typeof value === 'string' ? value.trim() : '';
    } else {
      templateByAspectRatio[ratio] = DEFAULT_CONFIG.creativeDefaults.templateByAspectRatio[ratio];
    }
  }

  return {
    aspectRatio: ALLOWED_ASPECT_RATIOS.includes(source.aspectRatio)
      ? source.aspectRatio
      : DEFAULT_CONFIG.creativeDefaults.aspectRatio,
    targetDurationSec: normalizeDurationSec(source.targetDurationSec),
    fps: ALLOWED_CREATIVE_FPS.includes(Number(source.fps))
      ? Number(source.fps)
      : DEFAULT_CONFIG.creativeDefaults.fps,
    playbackSpeed: normalizePlaybackSpeed(source.playbackSpeed),
    templateByAspectRatio,
    lockTemplate: source.lockTemplate === true,
    contentMode: ALLOWED_CONTENT_MODES.includes(source.contentMode)
      ? source.contentMode
      : DEFAULT_CONFIG.creativeDefaults.contentMode,
    useResearch: typeof source.useResearch === 'boolean'
      ? source.useResearch
      : DEFAULT_CONFIG.creativeDefaults.useResearch,
    generateAudio: typeof source.generateAudio === 'boolean'
      ? source.generateAudio
      : DEFAULT_CONFIG.creativeDefaults.generateAudio,
    autoSfxEnabled: typeof source.autoSfxEnabled === 'boolean'
      ? source.autoSfxEnabled
      : DEFAULT_CONFIG.creativeDefaults.autoSfxEnabled,
    generateCaptions: typeof source.generateCaptions === 'boolean'
      ? source.generateCaptions
      : DEFAULT_CONFIG.creativeDefaults.generateCaptions,
    emotionalVoice: source.emotionalVoice === true,
    // 旁白音色进入所有创作入口前先归一化，避免无效 voice 透传给 TTS 供应商。
    ttsVoice: normalizeTtsVoice(source.ttsVoice),
    sourceImageAnalysisEnabled: source.sourceImageAnalysisEnabled === true,
    extractDouyinFrames: source.extractDouyinFrames === true,
    frameHtmlConcurrency: normalizeSmallInteger(
      source.frameHtmlConcurrency,
      DEFAULT_CONFIG.creativeDefaults.frameHtmlConcurrency,
      1,
      5,
    ),
  };
}

function normalizeSystemSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    skipValidation: source.skipValidation === true,
    pexelsApiKey: typeof source.pexelsApiKey === 'string' ? source.pexelsApiKey.trim() : '',
  };
}

function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: 1,
    creativeDefaults: normalizeCreativeDefaults(source.creativeDefaults),
    system: normalizeSystemSettings(source.system),
  };
}

function resolveConfigPath(options = {}) {
  return options.configPath || DEFAULT_CONFIG_PATH;
}

function resolveAiConfigPath(options = {}) {
  return options.aiConfigPath || DEFAULT_AI_CONFIG_PATH;
}

async function hasConfig(options = {}) {
  try {
    await fsp.access(resolveConfigPath(options));
    return true;
  } catch {
    return false;
  }
}

async function readConfig(options = {}) {
  const configPath = resolveConfigPath(options);
  try {
    const raw = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
    return normalizeConfig(raw);
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

async function getPublicConfig(options = {}) {
  return readConfig(options);
}

async function getCreativeDefaults(options = {}) {
  const config = await readConfig(options);
  return config.creativeDefaults;
}

async function getSystemSettings(options = {}) {
  const config = await readConfig(options);
  return config.system;
}

async function getPexelsApiKey(options = {}) {
  const system = await getSystemSettings(options);
  return system.pexelsApiKey || '';
}

async function getEffectiveSystemSettings(options = {}) {
  if (await hasConfig(options)) {
    const system = await getSystemSettings(options);
    return { ...system, source: 'app-settings' };
  }

  try {
    const raw = JSON.parse(await fsp.readFile(resolveAiConfigPath(options), 'utf-8'));
    return {
      skipValidation: raw && raw.skipValidation === true,
      source: 'legacy-ai-models',
    };
  } catch {
    return {
      ...DEFAULT_CONFIG.system,
      source: 'default',
    };
  }
}

async function saveConfig(input = {}, options = {}) {
  const configPath = resolveConfigPath(options);
  const exists = await hasConfig(options);
  const effectiveSystem = exists ? null : await getEffectiveSystemSettings(options);
  const source = input && typeof input === 'object' ? input : {};
  const inputSystem = source.system && typeof source.system === 'object' ? source.system : {};
  const system = effectiveSystem && typeof inputSystem.skipValidation !== 'boolean'
    ? { ...inputSystem, skipValidation: effectiveSystem.skipValidation }
    : inputSystem;
  const config = normalizeConfig({ ...source, system });

  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG,
  ALLOWED_ASPECT_RATIOS,
  normalizeConfig,
  normalizeCreativeDefaults,
  normalizeSystemSettings,
  hasConfig,
  getPublicConfig,
  saveConfig,
  getCreativeDefaults,
  getSystemSettings,
  getPexelsApiKey,
  getEffectiveSystemSettings,
};
