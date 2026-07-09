import { useEffect, useMemo, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

function getFrameId(frame) {
  return frame?.id || frame?.scene_id || '';
}

function getPlanId(editPlan) {
  return editPlan?.id || editPlan?.plan_id || editPlan?.session_id || '';
}

function summarizePlan(editPlan) {
  if (!editPlan) return '';
  if (editPlan.summary) return editPlan.summary;
  if (editPlan.instruction) return editPlan.instruction;
  if (Array.isArray(editPlan.steps)) {
    return editPlan.steps.map((step, index) => `${index + 1}. ${step.summary || step.instruction || step.action || '未命名步骤'}`).join('\n');
  }
  return JSON.stringify(editPlan, null, 2);
}

function affectedFrames(editPlan) {
  return Array.isArray(editPlan?.affected_frames) ? editPlan.affected_frames : [];
}

export function HtmlVideoAiEditPanel({
  frame,
  editPlan,
  disabled,
  onIterateFrame,
  onCreatePlan,
  onRunPlan,
  onAcceptPlan,
  onDiscardPlan,
}) {
  const [frameMode, setFrameMode] = useState('layout_fix');
  const [preserveText, setPreserveText] = useState(true);
  const [frameInstruction, setFrameInstruction] = useState('');
  const [planInstruction, setPlanInstruction] = useState('');
  const [selectedPlanFrames, setSelectedPlanFrames] = useState([]);

  const frameId = getFrameId(frame);
  const planId = getPlanId(editPlan);
  const planFrames = useMemo(() => affectedFrames(editPlan), [editPlan]);
  const trimmedFrameInstruction = frameInstruction.trim();
  const trimmedPlanInstruction = planInstruction.trim();
  const canIterateFrame = Boolean(frameId && trimmedFrameInstruction && !disabled);
  const canCreatePlan = Boolean(trimmedPlanInstruction && !disabled);
  const canUsePlan = Boolean(planId && !disabled);
  const canRunPlan = Boolean(canUsePlan && editPlan?.status === 'planned');

  useEffect(() => {
    setSelectedPlanFrames(planFrames);
  }, [planFrames]);

  async function submitFrameDraft(event) {
    event.preventDefault();
    if (!canIterateFrame) return;
    const result = await onIterateFrame?.(frameId, {
      mode: frameMode,
      preserve_text: preserveText,
      run_layout_qa: true,
      render_preview: true,
      instruction: trimmedFrameInstruction,
    });
    if (result) setFrameInstruction('');
  }

  async function submitEditPlan(event) {
    event.preventDefault();
    if (!canCreatePlan) return;
    const payload = { instruction: trimmedPlanInstruction };
    if (frameId) payload.selected_frame_id = frameId;
    const result = await onCreatePlan?.(payload);
    if (result) setPlanInstruction('');
  }

  function togglePlanFrame(frameIdValue) {
    setSelectedPlanFrames(prev => (
      prev.includes(frameIdValue) ? prev.filter(item => item !== frameIdValue) : [...prev, frameIdValue]
    ));
  }

  return (
    <EditorPanel aria-label="AI 修改">
      <form onSubmit={submitFrameDraft}>
        <EditorPanelHeader>
          <h4>当前帧</h4>
          <button type="submit" disabled={!canIterateFrame}>生成当前帧草稿</button>
        </EditorPanelHeader>
        <label>
          修改模式
          <select value={frameMode} disabled={disabled} onChange={event => setFrameMode(event.target.value)}>
            <option value="layout_fix">修复布局</option>
            <option value="visual_rewrite">重写视觉</option>
            <option value="content_rewrite">改写内容</option>
            <option value="style_match">匹配风格</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={preserveText} disabled={disabled} onChange={event => setPreserveText(event.target.checked)} />
          保留文案
        </label>
        <textarea value={frameInstruction} disabled={disabled} rows={3} placeholder="例如：修复布局错位，标题不要遮挡人物主体。" onChange={event => setFrameInstruction(event.target.value)} />
      </form>

      <form onSubmit={submitEditPlan}>
        <EditorPanelHeader>
          <h4>全片</h4>
          <button type="submit" disabled={!canCreatePlan}>生成全片编辑计划</button>
        </EditorPanelHeader>
        <textarea value={planInstruction} disabled={disabled} rows={3} placeholder="例如：全片统一改成更干净的科技资讯风格，并检查所有字幕遮挡。" onChange={event => setPlanInstruction(event.target.value)} />
      </form>

      {editPlan ? (
        <div className="grid gap-2 rounded-md border border-[#e5e7eb] bg-white p-2">
          <EditorPanelHeader>
            <h4>计划草稿</h4>
            <EditorInlineActions>
              <button type="button" disabled={!canRunPlan || selectedPlanFrames.length === 0} onClick={() => onRunPlan?.(planId, { confirm: true, selected_frame_ids: selectedPlanFrames })}>执行全片编辑计划</button>
              <button type="button" disabled={!canUsePlan || editPlan.status !== 'drafts_ready'} onClick={() => onAcceptPlan?.(planId)}>接受计划草稿</button>
              <button type="button" disabled={!canUsePlan || !editPlan.generated_drafts?.length} onClick={() => onDiscardPlan?.(planId)}>放弃计划草稿</button>
            </EditorInlineActions>
          </EditorPanelHeader>
          <div className="grid gap-1 text-xs text-[#4b5563]">
            <span>范围：{editPlan.scope === 'frame' ? '当前帧' : '全片'}</span>
            <span>模式：{editPlan.mode || '未指定'}</span>
            <span>状态：{editPlan.status || 'planned'}</span>
            <span>可能影响：画面 HTML 草稿；如改写内容，接受后需要检查旁白和字幕。</span>
          </div>
          {planFrames.length ? (
            <div className="grid gap-1 rounded-md bg-[#f8fafc] p-2 text-xs text-[#4b5563]">
              <strong className="text-[#111827]">影响帧，可选择执行范围</strong>
              {planFrames.map(item => (
                <label className="flex items-center gap-2" key={item}>
                  <input type="checkbox" checked={selectedPlanFrames.includes(item)} disabled={disabled || editPlan.status !== 'planned'} onChange={() => togglePlanFrame(item)} />
                  {item}
                </label>
              ))}
            </div>
          ) : null}
          {Array.isArray(editPlan.generated_drafts) && editPlan.generated_drafts.length ? (
            <ul className="m-0 pl-5 text-xs text-[#4b5563]">
              {editPlan.generated_drafts.map(draft => <li key={`${draft.frame_id}-${draft.draft_id}`}>已生成草稿：{draft.frame_id} / {draft.draft_id}</li>)}
            </ul>
          ) : null}
          <pre className="whitespace-pre-wrap break-words text-xs">{summarizePlan(editPlan)}</pre>
        </div>
      ) : null}
    </EditorPanel>
  );
}
