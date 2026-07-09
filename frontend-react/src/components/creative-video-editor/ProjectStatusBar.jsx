import { formatExportTime } from './ExportsPanel.jsx';

const STATUS_CLASS = {
  error: 'border-red-500/30 bg-red-500/10 text-red-100',
  not_configured: 'border-red-500/30 bg-red-500/10 text-red-100',
  needs_validation: 'border-red-500/30 bg-red-500/10 text-red-100',
  loading: 'border-slate-600 bg-slate-800 text-slate-100',
  saving: 'border-slate-600 bg-slate-800 text-slate-100',
  editing: 'border-slate-600 bg-slate-800 text-slate-100',
  materializing: 'border-slate-600 bg-slate-800 text-slate-100',
  rendering: 'border-slate-600 bg-slate-800 text-slate-100',
  exporting: 'border-slate-600 bg-slate-800 text-slate-100',
  tts: 'border-slate-600 bg-slate-800 text-slate-100',
  tts_all: 'border-slate-600 bg-slate-800 text-slate-100',
  previewing: 'border-slate-600 bg-slate-800 text-slate-100',
  restoring_revision: 'border-slate-600 bg-slate-800 text-slate-100',
};

const PILL_CLASS = 'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold';

function statusPills(editState = {}, dirtyRequiresRender) {
  const pills = [];
  if (editState.has_pending_html_draft) {
    pills.push({ key: 'draft', text: `草稿待接受 ${editState.active_draft_count || ''}`.trim(), className: 'bg-sky-400/15 text-sky-100' });
  }
  if (editState.has_narration_text_outdated_audio) {
    pills.push({ key: 'tts', text: `旁白待重生成 ${editState.stale_narration_count || ''}`.trim(), className: 'bg-amber-400/15 text-amber-100' });
  }
  if (editState.has_narration_tail_risk) {
    const overflow = Number(editState.narration_tail_risk_max_overflow_sec || 0);
    pills.push({ key: 'tail-risk', text: `尾音风险${overflow > 0 ? ` ${overflow.toFixed(1)}s` : ''}`, className: 'bg-orange-400/15 text-orange-100' });
  }
  if (editState.has_layout_issues) {
    pills.push({ key: 'qa', text: `QA 问题 ${editState.layout_issue_count || ''}`.trim(), className: 'bg-red-400/15 text-red-100' });
  }
  if (dirtyRequiresRender || editState.export_outdated) {
    pills.push({ key: 'export', text: '需要重新导出', className: 'bg-amber-400/15 text-amber-100' });
  }
  if (editState.preview_outdated) {
    pills.push({ key: 'preview', text: '预览已过期', className: 'bg-fuchsia-400/15 text-fuchsia-100' });
  }
  if (editState.latest_export?.created_at && !editState.export_outdated) {
    pills.push({ key: 'latest-export', text: `已导出 ${formatExportTime(editState.latest_export.created_at)}`, className: 'bg-emerald-400/15 text-emerald-100' });
  }
  return pills;
}

export function ProjectStatusBar({ status, message, dirtyRequiresRender, editState }) {
  const pills = statusPills(editState, dirtyRequiresRender);
  return (
    <div className={`flex min-h-8 flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${STATUS_CLASS[status] || 'border-slate-600 bg-slate-800 text-slate-100'}`} aria-live="polite">
      <span>{message || '等待加载可编辑成片工程。'}</span>
      <div className="ml-auto flex flex-wrap justify-end gap-1.5">
        {pills.map(pill => <strong className={`${PILL_CLASS} ${pill.className}`} key={pill.key}>{pill.text}</strong>)}
      </div>
    </div>
  );
}
