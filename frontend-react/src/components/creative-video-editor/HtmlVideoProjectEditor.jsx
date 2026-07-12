import { useState } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CaptionsPanel } from './CaptionsPanel.jsx';
import { ExportsPanel } from './ExportsPanel.jsx';
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoCanvasEditor } from './HtmlVideoCanvasEditor.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { NarrationPanel } from './NarrationPanel.jsx';
import { NaturalLanguageEditBox } from './NaturalLanguageEditBox.jsx';
import { PreviewPanel } from './PreviewPanel.jsx';
import { ProjectStatusBar } from './ProjectStatusBar.jsx';
import { RevisionsPanel } from './RevisionsPanel.jsx';
import { SfxPanel } from './SfxPanel.jsx';

const TOOL_BUTTON_CLASS = 'min-h-8 rounded-md border border-slate-700 bg-slate-800 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55';
const PRIMARY_TOOL_BUTTON_CLASS = 'min-h-8 rounded-md border border-slate-100 bg-slate-100 px-2.5 text-xs font-bold text-slate-950 transition hover:border-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-55';
const MENU_ITEM_CLASS = 'cursor-pointer rounded px-2.5 py-2 text-xs font-bold text-slate-100 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 data-[highlighted]:bg-slate-700';
const LIGHT_SCROLLBAR_CLASS = '[scrollbar-width:thin] [scrollbar-color:#cbd5e1_#f8fafc] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#f8fafc] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400';

function PanelDialog({ label, title, contentClassName = '', children }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={TOOL_BUTTON_CLASS} type="button">{label}</button>
      </DialogTrigger>
      <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS} ${contentClassName}`}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 汇总导出前需要用户处理或确认的问题。
 * @param {object} editState 编辑器派生状态。
 * @param {boolean} canvasDirty 画布是否存在未保存修改。
 * @param {object} payload 本次导出参数。
 * @returns {Array<object>} 导出问题列表。
 */
function buildExportIssues(editState = {}, canvasDirty = false, payload = {}) {
  const issues = [];
  if (canvasDirty) {
    issues.push({ key: 'canvas', level: 'blocking', text: '画布有未保存修改，请先保存修改或切换镜头放弃修改。' });
  }
  if (editState.has_pending_html_draft) {
    issues.push({ key: 'draft', level: 'blocking', text: `还有 ${editState.active_draft_count || 1} 个画面草稿待接受或放弃。` });
  }
  if (editState.has_layout_issues) {
    issues.push({ key: 'qa', level: 'warning', text: `布局检查还有 ${editState.layout_issue_count || 1} 个问题，建议修复后导出。` });
  }
  if (editState.has_narration_text_outdated_audio && payload.force_use_stale_tts !== true) {
    issues.push({ key: 'tts', level: 'warning', text: `还有 ${editState.stale_narration_count || 1} 个镜头旁白音频待重生成。` });
  }
  return issues;
}

/**
 * 判断是否存在必须先处理的导出阻断项。
 * @param {Array<object>} issues 导出问题列表。
 * @returns {boolean} 是否阻断导出。
 */
function hasBlockingExportIssues(issues = []) {
  return issues.some(issue => issue.level === 'blocking');
}

export function HtmlVideoProjectEditor({ editor, onExported }) {
  const disabled = editor.disabled;
  const frames = Array.isArray(editor.frames) ? editor.frames : [];
  const selectedFrame = frames.find(frame => (
    frame.id === editor.selectedFrameId || frame.scene_id === editor.selectedFrameId
  )) || editor.selectedFrame || null;
  const selectedFrameId = selectedFrame?.id || selectedFrame?.scene_id || '';
  const selectedTailRisk = (editor.editState?.narration_tail_risk_frames || []).find(item => (
    item.frame_id === selectedFrame?.id || item.frame_id === selectedFrame?.scene_id || item.scene_id === selectedFrame?.scene_id
  )) || null;

  // 低频面板收进“更多”菜单，菜单关闭并归还焦点后再打开受控 Dialog。
  const [activePanel, setActivePanel] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [captionTab, setCaptionTab] = useState('captions');
  const [aiTab, setAiTab] = useState('quick');
  const [pendingExportPayload, setPendingExportPayload] = useState(null);
  const [pendingExportIssues, setPendingExportIssues] = useState([]);
  const [canvasDirty, setCanvasDirty] = useState(false);

  function openPanel(panel) {
    setMoreOpen(false);
    // 等菜单完成焦点归还后再打开弹窗，避免菜单残留在遮罩后方。
    queueMicrotask(() => setActivePanel(panel));
    // 源码面板依赖手动加载的 frameHtml，打开时自动加载当前帧，避免展示上一帧的旧源码
    if (panel === 'source' && selectedFrameId) editor.loadFrameHtml(selectedFrameId);
  }

  async function runExport(payload = {}) {
    const result = await editor.exportProject(payload);
    if (result) onExported?.(result);
    return result;
  }

  async function handleExport(payload = {}) {
    const issues = buildExportIssues(editor.editState, canvasDirty, payload);
    if (issues.length) {
      setActivePanel(null);
      setPendingExportPayload(payload);
      setPendingExportIssues(issues);
      return null;
    }
    return runExport(payload);
  }

  async function continueExportWithWarnings() {
    const payload = pendingExportPayload || {};
    if (hasBlockingExportIssues(pendingExportIssues)) return;
    setPendingExportPayload(null);
    setPendingExportIssues([]);
    await runExport({ ...payload, force_use_stale_tts: true });
  }

  async function regenerateNarrationAndExport() {
    const payload = pendingExportPayload || {};
    if (hasBlockingExportIssues(pendingExportIssues)) return;
    const regenerated = await editor.regenerateAllNarration?.();
    if (!regenerated || regenerated.requires_tts === true) return;
    setPendingExportPayload(null);
    setPendingExportIssues([]);
    await runExport(payload);
  }

  function patchFrame(payload) {
    if (payload?.type === 'frame_patch') return editor.saveFrame(payload.frame_id, payload);
    return editor.saveTemplateInputs(payload);
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-100 shadow-[0_18px_48px_rgba(15,23,42,.18)]">
      <ProjectStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} editState={editor.editState} />
      <div className="flex flex-wrap items-center gap-2">
        <PanelDialog label="字幕 / 旁白" title="字幕 / 旁白">
          <div className="grid content-start gap-3">
            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1" aria-label="字幕与旁白">
              <button className={`rounded-md px-3 py-2 text-sm font-bold ${captionTab === 'captions' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`} type="button" aria-pressed={captionTab === 'captions'} onClick={() => setCaptionTab('captions')}>字幕</button>
              <button className={`rounded-md px-3 py-2 text-sm font-bold ${captionTab === 'narration' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`} type="button" aria-pressed={captionTab === 'narration'} onClick={() => setCaptionTab('narration')}>旁白</button>
            </div>
            {captionTab === 'captions' ? (
              <CaptionsPanel captions={selectedFrame?.captions || []} selectedFrameId={selectedFrameId} disabled={disabled} onSave={patchFrame} />
            ) : (
              <NarrationPanel
                narration={selectedFrame?.narration_text || ''}
                audioUrl={selectedFrameId ? editor.getNarrationPlaybackUrl?.(selectedFrameId) : ''}
                stale={selectedFrame?.narration_audio_stale === true}
                tailRisk={selectedTailRisk}
                disabled={disabled || !selectedFrameId}
                onSave={(payload) => editor.saveFrame(selectedFrameId, {
                  type: 'frame_patch',
                  narration_text: payload.text || '',
                })}
                onRegenerate={(payload) => editor.regenerateNarration(selectedFrameId, payload)}
                onRegenerateAll={editor.regenerateAllNarration}
              />
            )}
          </div>
        </PanelDialog>
        <PanelDialog label="AI 修改" title="AI 修改" contentClassName="w-[min(720px,calc(100vw-32px))] max-w-[720px] bg-[#f8fafc] text-[#111827] sm:max-w-[720px]">
          <div className="grid content-start gap-3">
            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1" aria-label="AI 修改方式">
              <button className={`rounded-md px-3 py-2 text-sm font-bold ${aiTab === 'quick' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`} type="button" aria-pressed={aiTab === 'quick'} onClick={() => setAiTab('quick')}>快速修改</button>
              <button className={`rounded-md px-3 py-2 text-sm font-bold ${aiTab === 'advanced' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`} type="button" aria-pressed={aiTab === 'advanced'} onClick={() => setAiTab('advanced')}>草稿与计划</button>
            </div>
            {aiTab === 'quick' ? (
              <NaturalLanguageEditBox tone="light" disabled={disabled} editing={editor.status === 'editing'} onSubmit={editor.applyNaturalLanguageEdit} />
            ) : (
              <>
                <HtmlVideoDraftPanel
                  frame={selectedFrame}
                  disabled={disabled}
                  onRender={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
                  onAccept={editor.acceptFrameDraft}
                  onDiscard={editor.discardFrameDraft}
                />
                <HtmlVideoAiEditPanel
                  frame={selectedFrame}
                  editPlan={editor.editPlan}
                  disabled={disabled}
                  onIterateFrame={editor.iterateFrame}
                  onCreatePlan={editor.createEditPlan}
                  onRunPlan={editor.runEditPlan}
                  onAcceptPlan={editor.acceptEditPlan}
                  onDiscardPlan={editor.discardEditPlan}
                />
              </>
            )}
          </div>
        </PanelDialog>
        <DropdownMenuPrimitive.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuPrimitive.Trigger asChild>
            <button className={TOOL_BUTTON_CLASS} type="button" disabled={disabled}>更多 ▾</button>
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content align="start" sideOffset={6} className="z-50 min-w-[168px] rounded-md border border-slate-700 bg-slate-800 p-1 shadow-[0_16px_40px_rgba(2,6,23,.5)]">
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => openPanel('preview')}>全片预览</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => openPanel('revisions')}>版本历史</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => openPanel('layout-qa')}>布局检查</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => openPanel('source')}>源码</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => openPanel('exports')}>导出记录</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => openPanel('sfx')}>音效</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Separator className="my-1 h-px bg-slate-700" />
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => editor.materializeProject({})}>
                {editor.status === 'materializing' ? '正在重新生成 HTML...' : '重新生成 HTML'}
              </DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={editor.load}>重新加载</DropdownMenuPrimitive.Item>
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
        <button className={`${PRIMARY_TOOL_BUTTON_CLASS} ml-auto`} type="button" disabled={disabled} onClick={() => setActivePanel('exports')}>
          {editor.status === 'exporting' ? '正在导出成片...' : '导出成片'}
        </button>
      </div>
      <Dialog open={Boolean(pendingExportPayload)} onOpenChange={(open) => {
        if (!open) {
          setPendingExportPayload(null);
          setPendingExportIssues([]);
        }
      }}>
        <DialogContent className="bg-[#f8fafc] text-[#111827]">
          <DialogHeader>
            <DialogTitle>导出前请确认</DialogTitle>
            <DialogDescription>
              {hasBlockingExportIssues(pendingExportIssues) ? '当前还有必须处理的问题，处理后再导出。' : '发现可能影响成片的问题，请确认后继续。'}
            </DialogDescription>
          </DialogHeader>
          <ul className="m-0 grid gap-2 pl-5 text-sm">
            {pendingExportIssues.map(issue => (
              <li key={issue.key} className={issue.level === 'blocking' ? 'font-semibold text-red-700' : 'text-amber-700'}>
                {issue.text}
              </li>
            ))}
          </ul>
          <DialogFooter className="flex flex-wrap justify-end gap-2">
            <button className={TOOL_BUTTON_CLASS} type="button" disabled={disabled} onClick={() => {
              setPendingExportPayload(null);
              setPendingExportIssues([]);
            }}>取消</button>
            <button className={TOOL_BUTTON_CLASS} type="button" disabled={disabled || hasBlockingExportIssues(pendingExportIssues)} onClick={continueExportWithWarnings}>继续导出</button>
            {pendingExportIssues.some(issue => issue.key === 'tts') ? (
              <button className={PRIMARY_TOOL_BUTTON_CLASS} type="button" disabled={disabled || hasBlockingExportIssues(pendingExportIssues)} onClick={regenerateNarrationAndExport}>重新生成旁白并导出</button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'preview'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader className="sr-only"><DialogTitle>全片预览</DialogTitle></DialogHeader>
          <PreviewPanel
            previews={editor.previewsList}
            disabled={disabled}
            generating={editor.status === 'previewing'}
            previewOutdated={editor.editState?.preview_outdated}
            onCreatePreview={editor.createPreview}
            getExportPlaybackUrl={editor.getExportPlaybackUrl}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'revisions'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader className="sr-only"><DialogTitle>版本历史</DialogTitle></DialogHeader>
          <RevisionsPanel revisions={editor.revisionsList} disabled={disabled} onRestore={editor.restoreRevision} />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'layout-qa'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader className="sr-only"><DialogTitle>布局检查</DialogTitle></DialogHeader>
          <HtmlVideoQualityPanel
            frame={selectedFrame}
            layoutQa={editor.layoutQa}
            disabled={disabled}
            inspecting={editor.status === 'layout_qa'}
            onInspectFrame={editor.inspectLayout}
            onFixFrame={(frameId) => editor.iterateFrame(frameId, {
              mode: 'layout_fix', preserve_text: true, run_layout_qa: true, render_preview: true,
              instruction: '修复当前帧文字错位、越界或遮挡问题，保留现有文案和整体风格。',
            })}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'source'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] w-[min(900px,calc(100vw-32px))] max-w-[900px] overflow-y-auto overflow-x-hidden sm:max-w-[900px] ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader className="sr-only"><DialogTitle>帧源码</DialogTitle></DialogHeader>
          <HtmlVideoSourcePanel
            frame={selectedFrame}
            html={editor.frameHtml}
            disabled={disabled}
            onLoad={editor.loadFrameHtml}
            onSaveDraft={editor.saveFrameHtmlDraft}
            onRenderDraft={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'exports'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[88vh] w-[min(960px,calc(100vw-32px))] max-w-[960px] overflow-y-auto overflow-x-hidden bg-[#f8fafc] text-[#111827] sm:max-w-[960px] ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader className="sr-only"><DialogTitle>导出记录</DialogTitle></DialogHeader>
          <ExportsPanel
            exportsList={editor.exportsList}
            projectResolution={editor.project?.output?.resolution}
            projectFps={editor.project?.output?.fps}
            defaultPlaybackSpeed={editor.project?.output?.default_playback_speed}
            disabled={disabled}
            exporting={editor.status === 'exporting'}
            onExport={handleExport}
            onRefresh={editor.refreshExports}
            getExportPlaybackUrl={editor.getExportPlaybackUrl}
            onPatchExport={editor.patchExportRecord}
            onDeleteExport={editor.deleteExportRecord}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'sfx'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] w-[min(560px,calc(100vw-32px))] max-w-[560px] overflow-y-auto overflow-x-hidden bg-[#f8fafc] text-[#111827] sm:max-w-[560px] ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader className="sr-only"><DialogTitle>自动音效</DialogTitle></DialogHeader>
          <SfxPanel
            project={editor.project}
            frames={frames}
            disabled={disabled}
            deletingSfxEventId={editor.deletingSfxEventId}
            onDisableEvent={editor.disableSfxEvent}
            onUpdateEvent={editor.updateSfxEvent}
            getSfxEventPlaybackUrl={editor.getSfxEventPlaybackUrl}
          />
        </DialogContent>
      </Dialog>
      <div className="grid min-h-0 min-w-0 grid-cols-1">
        <HtmlVideoCanvasEditor editor={editor} onDirtyChange={setCanvasDirty} />
      </div>
    </section>
  );
}
