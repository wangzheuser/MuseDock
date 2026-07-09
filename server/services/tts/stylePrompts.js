const NEUTRAL_VOICE_STYLE_PROMPT = '请使用自然、清晰、语速稳定的短视频口播风格；避免夸张表演、过长间隔、深呼吸或拖慢语速。';
const EMOTIONAL_VOICE_STYLE_PROMPT = '请使用自然、有情绪起伏的短视频口播风格；关键句加强语气，适度停顿，保持清晰表达，不要过度拖慢语速。';

/**
 * 根据情绪化配音开关返回统一的 TTS 风格提示词。
 * @param {boolean} emotionalVoice 是否启用情绪化配音。
 * @returns {string} TTS 风格提示词。
 */
function getVoiceStylePrompt(emotionalVoice) {
  return emotionalVoice === true ? EMOTIONAL_VOICE_STYLE_PROMPT : NEUTRAL_VOICE_STYLE_PROMPT;
}

module.exports = {
  EMOTIONAL_VOICE_STYLE_PROMPT,
  NEUTRAL_VOICE_STYLE_PROMPT,
  getVoiceStylePrompt,
};
