import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';
import { formatExportTime } from './ExportsPanel.jsx';

function revisionLabel(revision, index) {
  return revision?.summary || revision?.change?.type || `版本 ${index + 1}`;
}

export function RevisionsPanel({ revisions = [], disabled, onRestore }) {
  const items = [...(Array.isArray(revisions) ? revisions : [])].reverse().slice(0, 20);
  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>版本历史</h3>
        <span className="text-xs text-[#6b7280]">恢复会创建一个新版本，不会删除历史。</span>
      </EditorPanelHeader>
      {items.length ? items.map((revision, index) => {
        const restorable = revision?.restorable !== false && Boolean(revision?.snapshot || revision?.id);
        return (
          <div className="grid gap-1 border-t border-[#e5e7eb] pt-2 text-xs text-[#4b5563]" key={revision?.id || index}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block break-words text-[#111827]">{revisionLabel(revision, index)}</strong>
                <span>{revision?.id || `revision-${index + 1}`} · {formatExportTime(revision?.created_at) || '未知时间'}</span>
              </div>
              <EditorInlineActions>
                <button type="button" disabled={disabled || !restorable} onClick={() => onRestore?.(revision.id)}>恢复</button>
              </EditorInlineActions>
            </div>
          </div>
        );
      }) : <p>暂无版本历史。</p>}
    </EditorPanel>
  );
}
