import { useEffect, useState } from 'react';
import { buildFrameSavePayload, updateHeadline } from './frameInputsPayload.mjs';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getFrameDuration(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : '';
}

function getFrameTitle(frame) {
  return frame?.title
    || frame?.metadata?.visual_text?.headline
    || frame?.inputs?.headline
    || frame?.inputs?.title
    || '';
}

function getFrameInputs(frame) {
  const inputs = objectOrEmpty(frame?.inputs);
  if (Object.keys(inputs).length > 0) return inputs;
  return objectOrEmpty(frame?.metadata?.visual_text);
}

function createDraft(frame) {
  if (!frame) return null;
  const inputs = getFrameInputs(frame);
  return {
    ...frame,
    title: getFrameTitle(frame),
    headline: getFrameTitle(frame),
    duration_sec: getFrameDuration(frame),
    inputs,
    inputsText: JSON.stringify(inputs, null, 2),
    narration_text: frame.narration_text || '',
  };
}

export function FrameInputsPanel({ frame, disabled, onSave, onRenderPreview }) {
  const [draft, setDraft] = useState(() => createDraft(frame));
  const [inputsError, setInputsError] = useState('');
  const canRenderPreview = typeof onRenderPreview === 'function';

  useEffect(() => {
    setDraft(createDraft(frame));
    setInputsError('');
  }, [frame]);

  if (!draft) {
    return <EditorPanel><p>请选择要编辑的帧</p></EditorPanel>;
  }

  return (
    <EditorPanel className="[&_textarea]:resize-y">
      <EditorPanelHeader>
        <h3>帧字段</h3>
        <EditorInlineActions>
          {canRenderPreview ? (
            <button type="button" disabled={disabled} onClick={() => onRenderPreview(draft.id)}>渲染单帧预览</button>
          ) : null}
          <button type="button" disabled={disabled || Boolean(inputsError)} onClick={() => onSave(buildFrameSavePayload(draft))}>保存帧</button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <label>
        <span>模板</span>
        <input value={draft.template_id || draft.template || ''} readOnly aria-readonly="true" title="模板由工程创建时确定" />
      </label>
      <label>
        <span>时长（秒）</span>
        <input type="number" min="0" step="0.1" value={draft.duration_sec || ''} disabled={disabled} onChange={event => setDraft({ ...draft, duration_sec: event.target.value === '' ? '' : Number(event.target.value) })} />
      </label>
      <label>
        <span>标题</span>
        <input
          value={draft.title || ''}
          disabled={disabled}
          onChange={event => {
            const title = event.target.value;
            setDraft({
              ...draft,
              title,
              headline: title,
              inputs: updateHeadline(draft.inputs, title),
              inputsText: JSON.stringify(updateHeadline(draft.inputs, title), null, 2),
            });
          }}
        />
      </label>
      <details className="rounded-md border border-[#e5e7eb] bg-white p-2">
        <summary className="cursor-pointer text-sm font-semibold text-[#4b5563]">高级：帧输入 JSON</summary>
        <label className="mt-2">
          <span>帧输入 JSON</span>
          <textarea
            value={draft.inputsText}
            disabled={disabled}
            rows={6}
            onChange={event => {
              const inputsText = event.target.value;
              try {
                const inputs = JSON.parse(inputsText || '{}');
                setInputsError('');
                setDraft({ ...draft, inputs, inputsText });
              } catch (error) {
                setInputsError(`JSON 格式错误：${error.message}`);
                setDraft({ ...draft, inputsText });
              }
            }}
          />
        </label>
      </details>
      {inputsError ? <p className="m-0 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">{inputsError}</p> : null}
    </EditorPanel>
  );
}
