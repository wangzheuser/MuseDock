const DEFAULT_TTS_VOICE = 'mimo_default';

const MIMO_TTS_VOICES = [
  { id: DEFAULT_TTS_VOICE, label: '默认音色' },
  { id: '冰糖', label: '冰糖' },
  { id: '茉莉', label: '茉莉' },
  { id: '苏打', label: '苏打' },
  { id: '白桃', label: '白桃' },
  { id: '白桦', label: '白桦' },
  { id: 'Mia', label: 'Mia' },
  { id: 'Chloe', label: 'Chloe' },
  { id: 'Milo', label: 'Milo' },
  { id: 'Dean', label: 'Dean' },
];

const MIMO_TTS_VOICE_IDS = new Set(MIMO_TTS_VOICES.map(voice => voice.id));

/**
 * 将外部传入的旁白音色归一到当前支持的 MiMo 音色。
 * @param {unknown} value 用户选择或配置里的音色 ID。
 * @returns {string} 可安全传入 TTS 的音色 ID。
 */
function normalizeTtsVoice(value) {
  const voice = String(value || '').trim();
  return MIMO_TTS_VOICE_IDS.has(voice) ? voice : DEFAULT_TTS_VOICE;
}

/**
 * 返回前端可展示的 MiMo 音色列表副本，避免调用方改写模块常量。
 * @returns {{id: string, label: string}[]} 音色选项列表。
 */
function getTtsVoiceOptions() {
  return MIMO_TTS_VOICES.map(voice => ({ ...voice }));
}

/**
 * 判断指定音色是否属于当前支持的 MiMo 音色集合。
 * @param {unknown} value 待检查的音色 ID。
 * @returns {boolean} 是否支持。
 */
function isSupportedTtsVoice(value) {
  return MIMO_TTS_VOICE_IDS.has(String(value || '').trim());
}

module.exports = {
  DEFAULT_TTS_VOICE,
  MIMO_TTS_VOICES,
  getTtsVoiceOptions,
  isSupportedTtsVoice,
  normalizeTtsVoice,
};
