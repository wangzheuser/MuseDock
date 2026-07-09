import { useEffect, useMemo, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

function numberOrEmpty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function normalizeDraft(caption, index) {
  return {
    ...caption,
    id: caption?.id || `caption_${index + 1}`,
    start: numberOrEmpty(caption?.start ?? caption?.start_sec),
    end: numberOrEmpty(caption?.end ?? caption?.end_sec),
    text: caption?.text || '',
  };
}

function validateCaptions(captions) {
  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    const start = Number(caption.start ?? caption.start_sec);
    const end = Number(caption.end ?? caption.end_sec);
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
      return `字幕 ${index + 1} 的结束时间必须大于开始时间。`;
    }
  }
  return '';
}

export function CaptionsPanel({ captions = [], selectedFrameId, disabled, onSave }) {
  const [drafts, setDrafts] = useState(() => captions.map(normalizeDraft));
  const error = useMemo(() => validateCaptions(drafts), [drafts]);
  const canSave = Boolean(selectedFrameId) && !disabled && !error;

  useEffect(() => {
    setDrafts(captions.map(normalizeDraft));
  }, [captions]);

  function updateCaption(index, patch) {
    setDrafts(prev => prev.map((caption, currentIndex) => (
      currentIndex === index ? { ...caption, ...patch } : caption
    )));
  }

  function splitCaption(index) {
    setDrafts(prev => {
      const current = prev[index];
      if (!current) return prev;
      const start = Number(current.start);
      const end = Number(current.end);
      const middle = Number.isFinite(start) && Number.isFinite(end) && end > start ? Number(((start + end) / 2).toFixed(2)) : '';
      const first = { ...current, id: `${current.id || `caption_${index + 1}`}_a`, end: middle || current.end };
      const second = { ...current, id: `${current.id || `caption_${index + 1}`}_b`, start: middle || current.start, text: '' };
      return [...prev.slice(0, index), first, second, ...prev.slice(index + 1)];
    });
  }

  function mergeWithPrevious(index) {
    if (index <= 0) return;
    setDrafts(prev => {
      const previous = prev[index - 1];
      const current = prev[index];
      if (!previous || !current) return prev;
      const merged = {
        ...previous,
        id: previous.id || current.id,
        end: current.end || previous.end,
        text: [previous.text, current.text].filter(Boolean).join(''),
      };
      return [...prev.slice(0, index - 1), merged, ...prev.slice(index + 1)];
    });
  }

  function save() {
    if (!canSave) return;
    onSave({
      type: 'frame_patch',
      frame_id: selectedFrameId,
      captions: drafts.map(caption => ({
        ...caption,
        start: caption.start === '' ? undefined : Number(caption.start),
        end: caption.end === '' ? undefined : Number(caption.end),
        start_sec: caption.start === '' ? undefined : Number(caption.start),
        end_sec: caption.end === '' ? undefined : Number(caption.end),
      })),
    });
  }

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>字幕</h3>
        <button type="button" disabled={!canSave} onClick={save}>保存字幕</button>
      </EditorPanelHeader>
      {!selectedFrameId ? <p className="muted">请选择一帧后编辑字幕。</p> : null}
      {error ? <p className="m-0 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">{error}</p> : null}
      {drafts.length ? drafts.map((caption, index) => (
        <div className="grid gap-2 rounded-md border border-[#e5e7eb] bg-white p-2" key={caption.id || index}>
          <label>
            <span>{caption.id || `字幕 ${index + 1}`}</span>
            <input value={caption.text || ''} disabled={disabled} onChange={event => updateCaption(index, { text: event.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span>开始时间（秒）</span>
              <input type="number" min="0" step="0.01" value={caption.start} disabled={disabled} onChange={event => updateCaption(index, { start: event.target.value === '' ? '' : Number(event.target.value) })} />
            </label>
            <label>
              <span>结束时间（秒）</span>
              <input type="number" min="0" step="0.01" value={caption.end} disabled={disabled} onChange={event => updateCaption(index, { end: event.target.value === '' ? '' : Number(event.target.value) })} />
            </label>
          </div>
          <EditorInlineActions>
            <button type="button" disabled={disabled} onClick={() => splitCaption(index)}>拆分</button>
            <button type="button" disabled={disabled || index === 0} onClick={() => mergeWithPrevious(index)}>合并到上一条</button>
          </EditorInlineActions>
        </div>
      )) : <p>暂无字幕</p>}
    </EditorPanel>
  );
}
