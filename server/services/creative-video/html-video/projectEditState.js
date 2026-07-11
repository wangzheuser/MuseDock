const crypto = require('crypto');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  return String(value ?? '').trim();
}

function timestampMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 计算稳定文本 hash，用于判断旁白文本和已生成音频是否一致。
 * @param {string} value 原始文本。
 * @returns {string} sha256 hash。
 */
function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * 收集仍需重新生成 TTS 的帧。
 * @param {object} project html-video 工程。
 * @returns {Array<object>} 待重新生成旁白的帧摘要。
 */
function collectStaleNarrationFrames(project = {}) {
  return arrayOrEmpty(project.frames)
    .filter(frame => {
      const text = String(frame?.narration_text ?? '');
      if (!text.trim()) return false;
      if (frame?.narration_audio_stale === true) return true;
      const audioHash = safeString(frame?.narration_audio_text_hash || frame?.audio_text_hash);
      return Boolean(audioHash) && audioHash !== hashText(text);
    })
    .map((frame, index) => ({
      frame_id: safeString(frame?.id || frame?.scene_id),
      scene_id: safeString(frame?.scene_id || frame?.id),
      order: Number.isFinite(Number(frame?.order)) ? Number(frame.order) : index + 1,
      title: safeString(frame?.title || frame?.metadata?.visual_text?.headline || frame?.inputs?.headline),
      reason: frame?.narration_audio_stale === true ? 'narration_audio_stale' : 'narration_text_hash_mismatch',
    }))
    .filter(item => item.frame_id || item.scene_id);
}

function activeDrafts(project = {}) {
  return arrayOrEmpty(project.frames).flatMap((frame, index) => {
    const drafts = arrayOrEmpty(frame?.drafts);
    const activeDraftId = safeString(frame?.active_draft_id || frame?.activeDraftId);
    return drafts
      .filter(draft => draft?.status !== 'discarded' && draft?.status !== 'accepted' && (activeDraftId ? draft?.id === activeDraftId : true))
      .map(draft => ({
        frame_id: safeString(frame?.id || frame?.scene_id),
        scene_id: safeString(frame?.scene_id || frame?.id),
        order: Number.isFinite(Number(frame?.order)) ? Number(frame.order) : index + 1,
        draft_id: safeString(draft?.id),
        summary: safeString(draft?.summary || draft?.instruction),
      }));
  });
}

function latestLayoutQa(project = {}) {
  const reports = arrayOrEmpty(project.layout_qa_reports || project.layoutQaReports)
    .slice()
    .sort((a, b) => timestampMs(b?.created_at || b?.createdAt) - timestampMs(a?.created_at || a?.createdAt));
  return reports[0] || null;
}

function blockingLayoutIssues(layoutQa = null) {
  const issues = arrayOrEmpty(layoutQa?.issues);
  return issues.filter(issue => !['warning', 'info'].includes(safeString(issue?.severity).toLowerCase()));
}

function latestItem(items = []) {
  return arrayOrEmpty(items)
    .slice()
    .sort((a, b) => timestampMs(b?.created_at || b?.createdAt) - timestampMs(a?.created_at || a?.createdAt))[0] || null;
}

const NON_CONTENT_REVISION_TYPES = new Set([
  'render',
  'delete_export',
  'frame_html_draft',
  'frame_html_draft_discard',
]);

/**
 * 获取最近一次会改变正式成片内容的版本。
 * @param {Array<object>} revisions 工程版本列表。
 * @returns {object|null} 最近的内容版本。
 */
function latestContentRevision(revisions = []) {
  return latestItem(arrayOrEmpty(revisions).filter(revision => {
    const changeType = safeString(revision?.change?.type);
    return !NON_CONTENT_REVISION_TYPES.has(changeType);
  }));
}

function collectNarrationTailRiskFrames(project = {}) {
  return arrayOrEmpty(project.frames)
    .map((frame, index) => {
      const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration ?? 0);
      const audioDuration = Number(frame?.narration_audio_duration_sec ?? frame?.narrationAudioDurationSec ?? 0);
      const overflow = audioDuration - duration;
      return {
        frame_id: safeString(frame?.id || frame?.scene_id),
        scene_id: safeString(frame?.scene_id || frame?.id),
        order: Number.isFinite(Number(frame?.order)) ? Number(frame.order) : index + 1,
        title: safeString(frame?.title || frame?.metadata?.visual_text?.headline || frame?.inputs?.headline),
        overflow_sec: Math.round(overflow * 1000) / 1000,
      };
    })
    .filter(item => item.overflow_sec > 0.05 && (item.frame_id || item.scene_id));
}

/**
 * 从项目数据派生编辑状态，避免为了 UI 状态污染持久模型。
 * @param {object} project html-video 工程。
 * @param {object} options 派生选项。
 * @returns {object} 编辑状态摘要。
 */
function buildProjectEditState(project = {}, options = {}) {
  const drafts = activeDrafts(project);
  const staleNarrationFrames = collectStaleNarrationFrames(project);
  const tailRiskFrames = collectNarrationTailRiskFrames(project);
  const layoutQa = options.layoutQa || latestLayoutQa(project);
  const layoutIssues = blockingLayoutIssues(layoutQa);
  const revisions = arrayOrEmpty(project.revisions);
  const exportsList = arrayOrEmpty(options.exportsList || project.exports);
  const latestRevision = latestItem(revisions);
  const latestRenderedContentRevision = latestContentRevision(revisions);
  const latestExport = latestItem(exportsList.filter(item => item?.kind !== 'preview')) || latestItem(exportsList);
  const latestPreview = latestItem(exportsList.filter(item => item?.kind === 'preview'));
  const latestContentRevisionMs = timestampMs(latestRenderedContentRevision?.created_at || latestRenderedContentRevision?.createdAt);
  const latestExportMs = timestampMs(latestExport?.created_at || latestExport?.createdAt);
  const latestPreviewMs = timestampMs(latestPreview?.created_at || latestPreview?.createdAt);

  return {
    active_drafts: drafts,
    active_draft_count: drafts.length,
    has_pending_html_draft: drafts.length > 0,
    stale_narration_frames: staleNarrationFrames,
    stale_narration_count: staleNarrationFrames.length,
    has_narration_text_outdated_audio: staleNarrationFrames.length > 0,
    narration_tail_risk_frames: tailRiskFrames,
    narration_tail_risk_count: tailRiskFrames.length,
    has_narration_tail_risk: tailRiskFrames.length > 0,
    narration_tail_risk_max_overflow_sec: Math.max(0, ...tailRiskFrames.map(item => item.overflow_sec || 0)),
    layout_issue_count: layoutIssues.length,
    has_layout_issues: layoutIssues.length > 0,
    latest_revision: latestRevision || null,
    latest_export: latestExport || null,
    latest_preview: latestPreview || null,
    export_outdated: latestContentRevisionMs > 0 && (!latestExportMs || latestContentRevisionMs > latestExportMs),
    preview_outdated: latestContentRevisionMs > 0 && (!latestPreviewMs || latestContentRevisionMs > latestPreviewMs),
  };
}

module.exports = {
  hashText,
  collectStaleNarrationFrames,
  collectNarrationTailRiskFrames,
  buildProjectEditState,
};
