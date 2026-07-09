import { useEffect, useMemo, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

export function NarrationPanel({ narration, audioUrl = '', stale, tailRisk = null, disabled, onSave, onRegenerate, onRegenerateAll }) {
  const [draft, setDraft] = useState(narration?.text || narration || '');
  const changed = useMemo(() => draft !== (narration?.text || narration || ''), [draft, narration]);

  useEffect(() => {
    setDraft(narration?.text || narration || '');
  }, [narration]);

  return (
    <EditorPanel className="[&_textarea]:resize-y">
      <EditorPanelHeader>
        <h3>旁白</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled || !draft.trim()} onClick={() => onRegenerate({ text: draft })}>重新生成当前帧</button>
          <button type="button" disabled={disabled} onClick={() => onRegenerateAll?.()}>重新生成全片</button>
          <button type="button" disabled={disabled || !changed} onClick={() => onSave({ text: draft })}>保存旁白</button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <p className="m-0 text-xs leading-relaxed text-[#6b7280]">
        重新生成旁白会使用设置中心已保存的最新 TTS 音色和情绪化配音配置。
      </p>
      {stale ? <p className="m-0 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">旁白文本已修改，音频需要重新生成后才会进入最新导出。</p> : null}
      {tailRisk ? <p className="m-0 rounded-md bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">当前旁白音频比画面长约 {Number(tailRisk.overflow_sec || 0).toFixed(1)} 秒，导出时会自动保留尾音。</p> : null}
      {audioUrl ? (
        <audio className="w-full" src={audioUrl} controls preload="none">
          <track kind="captions" />
        </audio>
      ) : <p className="m-0 text-xs text-[#6b7280]">当前帧暂无可试听旁白音频。</p>}
      <textarea value={draft} disabled={disabled} rows={5} onChange={event => setDraft(event.target.value)} />
    </EditorPanel>
  );
}
