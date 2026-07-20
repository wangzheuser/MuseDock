const editableParts = [
  '[data-text-key]',
  '[data-role]',
  '.headline',
  '.subtitle',
  '.body-text',
  '.body-copy',
  '.card-title',
  '.complaint',
  '.badge',
  '.chip',
  '.output',
  '.card',
  '.panel',
  '.visual',
  '.media',
  '.asset',
  '.shape',
  '.background',
  '[data-asset-id]',
  '[data-hv-editable]',
  'img',
  'video',
  'svg',
  'canvas',
  'figure',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
];

const excludedParts = [
  'html',
  'body',
  'head',
  'style',
  'script',
  'link',
  'meta',
  '.hv-caption-layer',
  '.hv-caption-item',
  '[data-hv-canvas]',
  '[data-hv-editor-overlay]',
  '[data-hv-editor-handle]',
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
];

export const editableSelector = editableParts.join(',');
export const excludedSelector = excludedParts.join(',');

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function parsePx(value) {
  const number = Number(String(value || '').replace(/px$/i, ''));
  return Number.isFinite(number) ? number : 0;
}

export function formatElementLabel(info = {}) {
  if (info.textKey) return String(info.textKey);
  if (info.role) return String(info.role);
  if (info.assetId) return String(info.assetId);
  if (info.editId) return String(info.editId);
  const firstClass = String(info.className || '').trim().split(/\s+/).filter(Boolean)[0];
  if (firstClass) return `.${firstClass}`;
  return String(info.tagName || 'element').toLowerCase();
}

export function nextEditId(existingIds = new Set()) {
  let index = 1;
  while (existingIds.has(`hv_edit_${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `hv_edit_${String(index).padStart(3, '0')}`;
}

export function createDraftSummary(label = '') {
  const safe = String(label || '').trim();
  return `画布调整：${safe || '元素位置'}`;
}

const textlessTags = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'AUDIO', 'IFRAME', 'HR', 'BR', 'INPUT']);

// 文案编辑把整段文本写进第一个文本节点：若后代元素自带文本（如选中 section），
// 会造成内容整份复制。只有全部可见文本都在自身文本节点里的元素才允许改文案。
export function canEditText(element) {
  if (!element || textlessTags.has(String(element.tagName || '').toUpperCase())) return false;
  // 文本节点必须有非空白内容：否则 pretty-print 的缩进节点会把纯布局包装误判成可编辑
  if (!Array.from(element.childNodes || []).some(node => node.nodeType === 3 && String(node.textContent || '').trim())) return false;
  return !Array.from(element.children || []).some(child => (child.textContent || '').trim());
}

export function isCanvasEditableElement(element) {
  if (!element || element.nodeType !== 1 || typeof element.matches !== 'function') return false;
  if (element.matches(excludedSelector)) return false;
  return element.matches(editableSelector) || canEditText(element);
}

export function previewAspectRatio(project = {}) {
  const resolution = project?.output?.resolution || project?.resolution || {};
  const width = Number(resolution.width ?? project?.width);
  const height = Number(resolution.height ?? project?.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width / height
    : 16 / 9;
}

export function fitPreviewBox(size = {}, aspectRatio = 16 / 9) {
  const width = Math.max(0, Number(size.width) || 0);
  const height = Math.max(0, Number(size.height) || 0);
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
  if (!width || !height) return { width: 0, height: 0 };
  const byWidth = { width, height: width / ratio };
  const fitted = byWidth.height <= height
    ? byWidth
    : { width: height * ratio, height };
  return {
    width: Math.floor(fitted.width),
    height: Math.floor(fitted.height),
  };
}

/** 把工程中的 dB 音量换算成浏览器 audio 使用的 0-1 音量。 */
export function decibelsToVolume(value, fallbackDb = 0) {
  const db = Number.isFinite(Number(value)) ? Number(value) : fallbackDb;
  return clamp(10 ** (db / 20), 0, 1);
}

/**
 * 根据工程主时间线生成当前镜头的声音播放计划。
 * @param {object} project html-video 工程。
 * @param {object} frame 当前镜头。
 * @returns {object} 镜头时间窗、主音轨偏移和音效计划。
 */
export function buildFrameAudioPlan(project = {}, frame = {}) {
  project = project || {};
  frame = frame || {};
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const frameIds = new Set([frame?.id, frame?.scene_id].filter(Boolean).map(String));
  const mainTrack = (Array.isArray(project?.timeline?.tracks) ? project.timeline.tracks : [])
    .find(track => track?.id === 'main' || track?.type === 'video');
  const item = (Array.isArray(mainTrack?.items) ? mainTrack.items : [])
    .find(entry => frameIds.has(String(entry?.frame_id || entry?.scene_id || '')));
  const frameIndex = frames.findIndex(entry => frameIds.has(String(entry?.id || entry?.scene_id || '')));
  const fallbackStartSec = frames.slice(0, Math.max(0, frameIndex)).reduce((sum, entry) => {
    const duration = Number(entry?.duration_sec ?? entry?.durationSec ?? entry?.duration);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  const itemStartSec = Number(item?.start_sec ?? item?.startSec);
  const itemDurationSec = Number(item?.duration_sec ?? item?.durationSec);
  const frameDurationSec = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration);
  const startSec = Number.isFinite(itemStartSec) && itemStartSec >= 0 ? itemStartSec : fallbackStartSec;
  const durationSec = Number.isFinite(itemDurationSec) && itemDurationSec > 0
    ? itemDurationSec
    : (Number.isFinite(frameDurationSec) && frameDurationSec > 0 ? frameDurationSec : 3);
  const audio = project.audio || {};
  const events = Array.isArray(audio?.sfx?.events) ? audio.sfx.events : [];
  const sfx = events.flatMap(event => {
    if (event?.enabled === false) return [];
    const eventFrameId = String(event?.frame_id || event?.scene_id || '');
    if (eventFrameId && !frameIds.has(eventFrameId)) return [];
    const sceneTime = Number(event?.time_sec);
    const globalTime = Number(event?.global_time_sec);
    const localTimeSec = eventFrameId && Number.isFinite(sceneTime)
      ? sceneTime
      : (Number.isFinite(globalTime) ? globalTime - startSec : NaN);
    if (!Number.isFinite(localTimeSec) || localTimeSec < 0 || localTimeSec >= durationSec) return [];
    return [{ ...event, local_time_sec: localTimeSec, volume: decibelsToVolume(event?.volume_db, -18) }];
  });

  return {
    start_sec: startSec,
    duration_sec: durationSec,
    narration_mode: audio.narration_path ? 'combined' : (audio.tts_manifest_path ? 'frame' : 'none'),
    narration_offset_sec: audio.narration_path ? startSec : 0,
    narration_volume: decibelsToVolume(audio?.mix?.narration_volume_db, 0),
    music_offset_sec: startSec,
    music_volume: decibelsToVolume(audio?.mix?.music_volume_db, -18),
    has_music: Boolean(audio.music_path),
    sfx,
  };
}
