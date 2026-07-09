import { useEffect, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

export function NarrationPanel({ narration, disabled, onSave, onRegenerate }) {
  const [draft, setDraft] = useState(narration?.text || narration || '');

  useEffect(() => {
    setDraft(narration?.text || narration || '');
  }, [narration]);

  return (
    <EditorPanel className="[&_textarea]:resize-y">
      <EditorPanelHeader>
        <h3>旁白</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled} onClick={() => onRegenerate({ text: draft })}>重新生成旁白</button>
          <button type="button" disabled={disabled} onClick={() => onSave({ text: draft })}>保存旁白</button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <p className="m-0 text-xs leading-relaxed text-[#6b7280]">
        重新生成旁白会使用设置中心已保存的最新 TTS 音色和情绪化配音配置。
      </p>
      <textarea value={draft} disabled={disabled} rows={5} onChange={event => setDraft(event.target.value)} />
    </EditorPanel>
  );
}
