const crypto = require('crypto');

/**
 * 返回第一个合法正数。
 * @param {...unknown} values 候选值。
 * @returns {number} 合法正数或 0。
 */
function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

/**
 * 将数值保留三位小数。
 * @param {unknown} value 原始值。
 * @returns {number} 时长值。
 */
function roundDuration(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

/**
 * 生成内容哈希。
 * @param {unknown} value 待计算内容。
 * @returns {string} SHA-256 哈希。
 */
function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/**
 * 按场景 ID 或顺序读取实际音频段。
 * @param {object} audio 音频结果。
 * @returns {object} 音频查找表。
 */
function buildAudioLookup(audio = {}) {
  const segments = Array.isArray(audio.scenes)
    ? audio.scenes
    : (Array.isArray(audio.segments) ? audio.segments : []);
  const byId = new Map();
  const byIndex = new Map();
  segments.forEach((segment, index) => {
    const id = String(segment.id || segment.scene_id || segment.sceneId || '').trim();
    const order = Number(segment.index || segment.order || index + 1);
    if (id) byId.set(id, segment);
    if (Number.isFinite(order) && order > 0) byIndex.set(order, segment);
  });
  return { byId, byIndex };
}

/**
 * 根据 Editorial Plan 和真实 TTS 时长生成 Production Spec。
 * @param {object} editorialPlan Editorial Plan。
 * @param {object} audio 音频结果。
 * @param {object} target 成片目标。
 * @returns {object} Production Spec V2。
 */
function buildProductionSpec(editorialPlan = {}, audio = {}, target = {}) {
  const lookup = buildAudioLookup(audio);
  let cursor = 0;
  let missingActualTimingCount = 0;
  const scenes = (Array.isArray(editorialPlan.scenes) ? editorialPlan.scenes : []).map((scene, index) => {
    const segment = lookup.byId.get(scene.id) || lookup.byIndex.get(Number(scene.order || index + 1)) || {};
    const actualDuration = firstPositiveNumber(
      segment.speech_duration_sec,
      segment.actual_duration_sec,
      segment.duration,
    );
    const duration = firstPositiveNumber(
      actualDuration,
      scene.actual_duration_sec,
      scene.duration,
      scene.duration_sec,
    );
    if (audio.status === 'ready' && !actualDuration) missingActualTimingCount += 1;
    const start = roundDuration(cursor);
    cursor = roundDuration(cursor + duration);
    return {
      id: scene.id,
      order: Number(scene.order || index + 1),
      start_sec: start,
      duration_sec: roundDuration(duration),
      end_sec: cursor,
      duration_source: actualDuration ? 'tts' : 'planned',
      narration_text: scene.narration_text || '',
      captions: Array.isArray(segment.captions) ? segment.captions : [],
      requirement_ids: Array.isArray(scene.requirement_ids) ? scene.requirement_ids : [],
      claim_ids: Array.isArray(scene.claim_ids) ? scene.claim_ids : [],
      source_ids: Array.isArray(scene.source_ids) ? scene.source_ids : [],
      layout_archetype: scene.layout_archetype || scene.content_role || scene.kind || 'explain',
      visual_text: scene.visual_text || {},
      visual_direction: scene.visual_direction || '',
    };
  });
  const targetDuration = firstPositiveNumber(target.duration_sec, target.durationSec, editorialPlan.target_duration_sec);
  const actualDuration = roundDuration(firstPositiveNumber(audio.duration, cursor));
  const deviation = targetDuration ? Math.abs(actualDuration - targetDuration) / targetDuration : 0;
  const spec = {
    version: 2,
    title: editorialPlan.title || '',
    target: {
      duration_sec: targetDuration,
      aspect_ratio: target.aspect_ratio || target.aspectRatio || '',
      fps: Number(target.fps) || 30,
    },
    actual_duration_sec: actualDuration,
    duration_deviation_ratio: Math.round(deviation * 10000) / 10000,
    missing_actual_timing_count: missingActualTimingCount,
    timing_status: !targetDuration || audio.status === 'skipped'
      ? 'not_applicable'
      : (missingActualTimingCount > 0 ? 'missing_audio_timing' : (deviation <= 0.05 ? 'ready' : 'mismatch')),
    scenes,
    editorial_plan_hash: editorialPlan.input_hash || '',
  };
  return { ...spec, input_hash: hashValue(spec) };
}

module.exports = {
  buildProductionSpec,
};
