import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

export function HtmlVideoQualityPanel({ frame, layoutQa, disabled, inspecting = false, onInspectFrame, onFixFrame }) {
  const frameId = frame?.id || frame?.scene_id || '';
  const issues = Array.isArray(layoutQa?.issues) ? layoutQa.issues : [];
  const checkedCount = layoutQa?.checked_count ?? layoutQa?.checkedCount ?? layoutQa?.reports?.length ?? 0;
  const skippedCount = layoutQa?.skipped_count ?? layoutQa?.skippedCount ?? 0;
  const environmentSkipped = layoutQa?.environment_skipped === true || layoutQa?.environmentSkipped === true;

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>布局检查</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled || !frameId} onClick={() => onInspectFrame({ frame_id: frameId })}>{inspecting ? '正在检查布局...' : '运行布局检查'}</button>
          <button type="button" disabled={disabled || !frameId} onClick={() => onFixFrame?.(frameId)}>用 AI 修复当前帧</button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <div className="flex flex-wrap gap-2 text-xs text-[#6b7280]">
        <span>已检查：{checkedCount}</span>
        <span>已跳过：{skippedCount}</span>
        {environmentSkipped ? <span className="font-semibold text-amber-700">当前环境跳过检查</span> : null}
      </div>
      {inspecting ? (
        <p className="m-0 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800" role="status">正在使用真实浏览器检查当前帧的文字越界与字幕遮挡...</p>
      ) : issues.length ? (
        <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message || issue.user_message || issue.code}</li>)}</ul>
      ) : <p>暂无布局检查问题。</p>}
    </EditorPanel>
  );
}
