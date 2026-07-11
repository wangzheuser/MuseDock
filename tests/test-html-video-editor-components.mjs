import assert from 'node:assert/strict';
import fs from 'node:fs';

const { buildFrameSavePayload } = await import('../frontend-react/src/components/creative-video-editor/frameInputsPayload.mjs');

const hook = fs.readFileSync('frontend-react/src/hooks/useHtmlVideoProject.js', 'utf-8');
const shell = fs.readFileSync('frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx', 'utf-8');
const editor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx', 'utf-8');

const componentPaths = [
  'frontend-react/src/components/creative-video-editor/ProjectStatusBar.jsx',
  'frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/NarrationPanel.jsx',
  'frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/ExportsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/PreviewPanel.jsx',
  'frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx',
  'frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx',
  'frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx',
  'frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx',
  'frontend-react/src/components/creative-video-editor/HtmlVideoAiEditPanel.jsx',
];

for (const componentPath of componentPaths) {
  assert.ok(fs.existsSync(componentPath), `missing component ${componentPath}`);
}

for (const status of [
  'loading',
  'saving',
  'editing',
  'materializing',
  'rendering',
  'exporting',
  'tts',
  'error',
  'not_configured',
  'needs_validation',
  'ready',
]) {
  assert.ok(hook.includes(status), `hook should handle status ${status}`);
}

for (const message of [
  '正在加载可编辑成片工程',
  '可编辑成片工程已加载',
  '正在保存模板字段',
  '正在应用编辑',
  '正在重新生成 HTML',
  '正在渲染单帧预览',
  '正在导出成片',
  '正在重新生成旁白',
  '渲染环境未配置',
  '工程需要验证',
  '正在加载当前帧源码',
  '正在保存帧源码草稿',
  '正在接受草稿',
  '正在放弃草稿',
  '正在运行布局检查',
  '正在重写当前帧 HTML',
  '正在生成全片编辑计划',
  '正在执行全片编辑计划',
  '正在接受计划草稿',
  '正在放弃计划草稿',
]) {
  assert.ok(hook.includes(message), `hook should expose Chinese message: ${message}`);
}

for (const method of [
  'getHtmlVideoProject',
  'patchHtmlVideoProjectInputs',
  'patchHtmlVideoProjectFrame',
  'editHtmlVideoProject',
  'renderHtmlVideoProject',
  'exportHtmlVideoProject',
  'listHtmlVideoProjectExports',
  'getHtmlVideoProjectFrameHtml',
  'saveHtmlVideoProjectFrameHtml',
  'acceptHtmlVideoProjectFrameDraft',
  'discardHtmlVideoProjectFrameDraft',
  'inspectHtmlVideoProjectLayout',
  'iterateHtmlVideoProjectFrame',
  'createHtmlVideoProjectEditPlan',
  'runHtmlVideoProjectEditPlan',
  'acceptHtmlVideoProjectEditPlan',
  'discardHtmlVideoProjectEditPlan',
]) {
  assert.ok(hook.includes(method), `hook should call api.${method}`);
}

for (const hookSurface of [
  'frameHtml',
  'layoutQa',
  'editPlan',
  'loadFrameHtml',
  'saveFrameHtmlDraft',
  'acceptFrameDraft',
  'saveAndAcceptFrameEdit',
  'discardFrameDraft',
  'inspectLayout',
  'iterateFrame',
  'createEditPlan',
  'runEditPlan',
  'acceptEditPlan',
  'discardEditPlan',
]) {
  assert.ok(hook.includes(hookSurface), `hook should expose ${hookSurface}`);
}

assert.match(hook, /useRef\(/, 'hook should use refs for duplicate request protection');
assert.match(hook, /mutatingRef|actionRef|inFlightRef/, 'hook should keep a mutating ref');
assert.match(hook, /isMutating/, 'hook should expose mutating disabled state');
assert.match(hook, /html_video_project/, 'hook should parse API html_video_project payloads');
assert.match(hook, /data\?\.html_video_project/, 'hook should parse nested data.html_video_project payloads');

for (const componentName of [
  'ProjectStatusBar',
  'HtmlVideoCanvasEditor',
  'ExportsPanel',
  'NaturalLanguageEditBox',
]) {
  assert.ok(editor.includes(componentName), `HtmlVideoProjectEditor should compose ${componentName}`);
}

assert.doesNotMatch(editor, /ReservedCapabilitiesPanel/, 'advanced reserved panel should not be shown by default');
assert.doesNotMatch(editor, /role="tablist"/, 'editor should no longer use a tab bar');
assert.doesNotMatch(editor, /useState\(['"]canvas['"]\)/, 'editor should not track an active tab');
assert.ok(editor.includes('ui/dialog'), 'editor should use the shared dialog for secondary panels');
for (const toolbarEntry of ['字幕 / 旁白', 'AI 修改', '更多', '导出成片']) {
  assert.ok(editor.includes(toolbarEntry), `editor toolbar should expose ${toolbarEntry}`);
}
for (const menuPanel of ['源码', '布局检查', '导出记录', '重新生成 HTML', '重新加载']) {
  assert.ok(editor.includes(menuPanel), `更多 menu should expose ${menuPanel}`);
}
assert.ok(editor.includes('DropdownMenuPrimitive'), 'low-frequency panels should live in a dropdown menu');
assert.ok(editor.includes('HtmlVideoDraftPanel'), 'draft panel should be merged into the AI 修改 dialog');
assert.doesNotMatch(editor, /ProjectFramesList/, 'editor should drop the left frames list (bottom strip covers selection)');
assert.ok(editor.includes('buildExportIssues'), 'editor should collect export blockers before exporting');
assert.ok(editor.includes('画布有未保存修改'), 'editor should block export when canvas edits are unsaved');
assert.ok(editor.includes('画面草稿待接受或放弃'), 'editor should block export when frame drafts are pending');
assert.ok(editor.includes('继续导出'), 'editor should allow confirmed export for warning-only issues');
assert.ok(editor.includes('runExport(payload)'), 'regenerated narration export should bypass stale-state recheck');
assert.ok(editor.includes("setActivePanel('exports')"), 'top export button should open the export options panel');
assert.ok(editor.includes('onDirtyChange={setCanvasDirty}'), 'canvas dirty state should be reported to export checks');
assert.ok(hook.includes('frameIdOf'), 'hook should share frame id lookup for id and scene_id');
assert.ok(hook.includes('frame?.id || frame?.scene_id'), 'hook should select frames by id or scene_id');

const sourcePanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx', 'utf-8');
assert.ok(sourcePanel.includes('源码'), 'Source panel should show Chinese source title');
assert.ok(sourcePanel.includes('保存为草稿'), 'Source panel should save draft');
assert.ok(sourcePanel.includes('当前帧不是 raw_html'), 'Source panel should handle non raw_html frame');
assert.doesNotMatch(sourcePanel, /mode:\s*['"]replace['"]/, 'Source panel should not send replace mode');

const draftPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx', 'utf-8');
assert.ok(draftPanel.includes('接受草稿'), 'Draft panel should accept drafts');
assert.ok(draftPanel.includes('放弃草稿'), 'Draft panel should discard drafts');

const qualityPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx', 'utf-8');
assert.ok(qualityPanel.includes('布局检查'), 'Quality panel should show layout QA');
assert.ok(qualityPanel.includes('用 AI 修复当前帧'), 'Quality panel should expose frame fix action');

const aiEditPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoAiEditPanel.jsx', 'utf-8');
for (const message of [
  'AI 修改',
  '修复布局',
  '生成当前帧草稿',
  '生成全片编辑计划',
  '执行全片编辑计划',
  '接受计划草稿',
  '放弃计划草稿',
]) {
  assert.ok(aiEditPanel.includes(message), `AI edit panel should show Chinese message: ${message}`);
}
assert.ok(aiEditPanel.includes('visual_rewrite'), 'AI edit panel should expose visual rewrite mode value');
assert.ok(aiEditPanel.includes('style_match'), 'AI edit panel should expose style match mode value');
assert.ok(aiEditPanel.includes('confirm: true'), 'AI edit panel should confirm edit plan runs');
assert.ok(aiEditPanel.includes("editPlan.status !== 'drafts_ready'"), 'AI edit panel should only accept ready plan drafts');
assert.ok(aiEditPanel.includes('editPlan.generated_drafts?.length'), 'AI edit panel should only discard generated plan drafts');

assert.ok(editor.includes('HtmlVideoSourcePanel'), 'HtmlVideoProjectEditor should compose source panel');
assert.ok(editor.includes('HtmlVideoDraftPanel'), 'HtmlVideoProjectEditor should compose draft panel');
assert.ok(editor.includes('HtmlVideoQualityPanel'), 'HtmlVideoProjectEditor should compose quality panel');
assert.ok(editor.includes('projectResolution={editor.project?.output?.resolution}'), 'editor should pass the fixed project resolution to export settings');
assert.ok(editor.includes('HtmlVideoAiEditPanel'), 'HtmlVideoProjectEditor should compose AI edit panel');
assert.doesNotMatch(editor, /ReservedCapabilitiesPanel/, 'reserved panel should remain hidden');

const naturalEdit = fs.readFileSync('frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx', 'utf-8');
assert.ok(naturalEdit.includes('正在解析编辑意图'), 'natural language edit should show loading text');
assert.ok(naturalEdit.includes('编辑已应用，需要重新渲染'), 'natural language edit should show success text');

const exportsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/ExportsPanel.jsx', 'utf-8');
assert.ok(exportsPanel.includes('正在导出成片'), 'exports panel should show export loading text');
assert.ok(exportsPanel.includes('导出成片'), 'exports panel should provide export action');
assert.ok(exportsPanel.includes('播放'), 'exports panel should provide a playback action for each export record');
assert.ok(exportsPanel.includes('已复制'), 'exports panel should show copy success feedback');
assert.ok(exportsPanel.includes('复制失败'), 'exports panel should show copy failure feedback');
assert.ok(exportsPanel.includes('grid-cols-[minmax(0,1fr)_auto]'), 'exports panel records should keep actions and notes readable');
assert.ok(exportsPanel.includes('formatExportTime'), 'exports panel should format export timestamps before rendering');
assert.match(exportsPanel, /toLocaleString\('zh-CN'/, 'exports panel should render export timestamps in local Chinese format');
assert.ok(exportsPanel.includes('getExportPlaybackUrl'), 'exports panel should resolve a safe playback URL for exported videos');
assert.ok(exportsPanel.includes('导出倍速'), 'exports panel should expose export playback speed');
assert.ok(exportsPanel.includes('尾音保护'), 'exports panel should expose tail protection');
assert.ok(exportsPanel.includes('playback_speed'), 'exports panel should submit playback_speed');
assert.ok(exportsPanel.includes('tail_protection'), 'exports panel should submit tail_protection');
assert.ok(exportsPanel.includes('inputMode="decimal"'), 'exports panel should use manual decimal speed input');
assert.ok(exportsPanel.includes('1.0'), 'exports panel should default speed to 1.0');
assert.ok(exportsPanel.includes('0.1 到 2.0'), 'exports panel should describe the speed range');
assert.ok(exportsPanel.includes('最多 1 位小数'), 'exports panel should describe one decimal limit');
assert.doesNotMatch(exportsPanel, /SPEED_OPTIONS/, 'exports panel should not use fixed speed options');
assert.ok(exportsPanel.includes('localStorage'), 'exports panel should persist export draft in browser localStorage');
assert.ok(exportsPanel.includes('musedock.htmlVideo.exportDraft.v1'), 'exports panel should use a stable localStorage key');
assert.ok(exportsPanel.includes('抖音横屏'), 'exports panel should include Douyin landscape preset');
assert.ok(exportsPanel.includes('小红书横屏'), 'exports panel should include Xiaohongshu landscape preset');
assert.ok(exportsPanel.includes('不能直接导出为'), 'exports panel should block changing a fixed-canvas project resolution');
assert.match(exportsPanel, /douyin_landscape:[^}]*width:\s*1920[^}]*height:\s*1080/s, 'Douyin landscape should use 1920x1080');
assert.match(exportsPanel, /xiaohongshu_landscape:[^}]*width:\s*1920[^}]*height:\s*1080/s, 'Xiaohongshu landscape should use 1920x1080');
assert.ok(exportsPanel.includes('技术质检通过'), 'exports panel should show final media quality status');
assert.ok(exportsPanel.includes('技术质检未通过'), 'exports panel should show blocked media quality status');
assert.ok(exportsPanel.includes('video_bitrate'), 'exports panel should show actual video bitrate');
assert.ok(exportsPanel.includes('audio_sample_rate'), 'exports panel should show actual audio sample rate');
assert.ok(exportsPanel.includes('motion_effective_fps_estimate'), 'exports panel should show estimated effective motion FPS');
assert.ok(exportsPanel.includes('跟随工程'), 'exports panel should allow FPS to follow the project');
assert.ok(exportsPanel.includes('projectFps'), 'exports panel should receive the project FPS');
assert.ok(exportsPanel.includes('画面变化估算约'), 'exports panel should describe motion FPS as an estimate instead of a quality failure');
assert.ok(exportsPanel.includes('CRF17 质量模式'), 'exports panel should identify content-adaptive publish encoding');
assert.ok(exportsPanel.includes('存在发布质量建议'), 'exports panel should show concrete media quality suggestions');

const previewPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/PreviewPanel.jsx', 'utf-8');
assert.ok(previewPanel.includes('预览倍速'), 'preview panel should expose preview speed');
assert.ok(previewPanel.includes('playbackRate'), 'preview panel should update native video playbackRate');
assert.ok(previewPanel.includes('playback_speed'), 'preview panel should send playback speed when regenerating preview');
assert.ok(previewPanel.includes('inputMode="decimal"'), 'preview panel should use manual decimal speed input');

const frameInputsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx', 'utf-8');
const frameInputsPayload = fs.readFileSync('frontend-react/src/components/creative-video-editor/frameInputsPayload.mjs', 'utf-8');
assert.match(frameInputsPanel, /duration_sec/, 'FrameInputsPanel should edit html-video duration_sec values returned by the project schema');
assert.match(frameInputsPanel, /metadata\?\.visual_text\?\.headline/, 'FrameInputsPanel should project raw_html visual headline into the title field');
assert.match(frameInputsPanel, /buildFrameSavePayload/, 'FrameInputsPanel should use the tested frame payload helper');
assert.doesNotMatch(frameInputsPanel, /template_id:\s*draft\.template_id\s*\|\|\s*draft\.template\s*\|\|\s*''/, 'FrameInputsPanel should not send empty template_id values');
assert.match(frameInputsPayload, /type:\s*'frame_patch'/, 'Frame payload helper should send explicit frame_patch payloads');
assert.match(frameInputsPayload, /frame_id:\s*draft\.id\s*\|\|\s*draft\.scene_id/, 'Frame payload helper should include the edited frame id');
assert.match(frameInputsPayload, /if\s*\(templateId\)/, 'Frame payload helper should only include non-empty template_id values');
assert.doesNotMatch(frameInputsPanel, /duration_sec:\s*Number\(draft\.duration_sec\)/, 'FrameInputsPanel should not always send empty duration as 0');
assert.match(frameInputsPayload, /duration\s*>\s*0/, 'Frame payload helper should only include duration_sec when the draft duration is positive');
assert.match(frameInputsPayload, /metadata_patch:\s*\{[^]*visual_text:\s*\{[^]*headline/s, 'Frame payload helper should save headline through frame metadata_patch');

{
  const payload = buildFrameSavePayload({
    id: 'frame_01',
    duration_sec: '',
    title: '新标题',
    narration_text: '新旁白',
    inputs: { headline: '旧标题', body: '正文' },
  });
  assert.equal(payload.type, 'frame_patch');
  assert.equal(payload.frame_id, 'frame_01');
  assert.equal(payload.narration_text, '新旁白');
  assert.equal(payload.inputs.headline, '新标题');
  assert.equal(payload.inputs.body, '正文');
  assert.equal(payload.metadata_patch.visual_text.headline, '新标题');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'template_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'duration_sec'), false);
}

{
  const payload = buildFrameSavePayload({
    scene_id: 'scene_01',
    template_id: ' template_a ',
    duration_sec: 2.5,
    headline: '标题',
    inputs: {},
  });
  assert.equal(payload.frame_id, 'scene_01');
  assert.equal(payload.template_id, 'template_a');
  assert.equal(payload.duration_sec, 2.5);
  assert.equal(payload.metadata_patch.visual_text.headline, '标题');
}

for (const invalidDuration of [0, -1, '0', '-1', 'abc']) {
  const payload = buildFrameSavePayload({
    id: 'frame_invalid_duration',
    duration_sec: invalidDuration,
    title: '标题',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'duration_sec'), false, `invalid duration should be omitted: ${invalidDuration}`);
}

const captionsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx', 'utf-8');
const narrationPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/NarrationPanel.jsx', 'utf-8');
assert.match(captionsPanel, /selectedFrameId/, 'CaptionsPanel should require a selected frame before saving captions');
assert.match(captionsPanel, /type:\s*'frame_patch'/, 'CaptionsPanel should save captions through frame_patch');
assert.match(captionsPanel, /frame_id:\s*selectedFrameId/, 'CaptionsPanel should target the selected frame id');
assert.doesNotMatch(captionsPanel, /onSave\(\{\s*captions:\s*drafts\s*\}\)/, 'CaptionsPanel should not save project-level captions');
assert.ok(captionsPanel.includes('请选择一帧后编辑字幕。'), 'CaptionsPanel should show a Chinese empty selection state');
assert.ok(
  narrationPanel.includes('重新生成旁白会使用设置中心已保存的最新 TTS 音色和情绪化配音配置。'),
  'NarrationPanel should explain latest saved TTS config for regeneration',
);
assert.ok(narrationPanel.includes('导出时会自动保留尾音'), 'NarrationPanel should explain automatic tail protection');

assert.match(frameInputsPanel, /typeof onRenderPreview === 'function'/, 'FrameInputsPanel should hide preview action when no preview handler exists');
assert.match(editor, /frames\s*=\s*Array\.isArray\(editor\.frames\)\s*\?\s*editor\.frames\s*:\s*\[\]/, 'HtmlVideoProjectEditor should fallback to an empty frames array');
assert.match(editor, /selectedFrame\s*=\s*frames\.find/, 'HtmlVideoProjectEditor should resolve captions from the selected frame');

assert.ok(shell.includes('useHtmlVideoProject'), 'CreativeVideoEditor should try HtmlVideoProject first');
assert.ok(shell.includes('HtmlVideoProjectEditor'), 'CreativeVideoEditor should render HtmlVideoProjectEditor');
assert.match(shell, /no_html_video_project/, 'CreativeVideoEditor should handle missing HtmlVideoProject');

for (const componentPath of [
  'frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx',
  ...componentPaths,
]) {
  const source = fs.readFileSync(componentPath, 'utf-8');
  assert.doesNotMatch(source, /fetch\(|from ['"]\.\.\/\.\.\/api\/client|api\./, `${componentPath} should not call API directly`);
}

assert.ok(hook.includes('saveAndAcceptFrameEdit'), 'hook should expose saveAndAcceptFrameEdit');
assert.ok(hook.includes('resolveSavedDraftId'), 'hook should resolve the saved draft id before accepting');
assert.ok(hook.includes('保存修改失败'), 'hook should expose a combined save-and-accept failure message');

const canvasEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx', 'utf-8');
const inspector = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx', 'utf-8');
assert.ok(inspector.includes('保存修改'), 'inspector should expose 保存修改 for canvas edits');
assert.ok(canvasEditor.includes('saveAndAcceptFrameEdit'), 'canvas 保存修改 should call saveAndAcceptFrameEdit');
assert.doesNotMatch(canvasEditor, /保存为草稿/, 'canvas should no longer expose separate 保存为草稿');
assert.doesNotMatch(canvasEditor, /onRenderPreview=\{\(\) => \{\}\}/, 'canvas should not wire dead preview actions');
assert.ok(canvasEditor.includes('FrameInputsPanel'), 'canvas right rail should mount frame fields');
assert.ok(editor.includes('CaptionsPanel'), 'captions should be a top-level toolbar entry in the project editor');
assert.ok(editor.includes('NarrationPanel'), 'narration should live next to captions in the project editor');
assert.match(editor, /narration=\{selectedFrame\?\.narration_text \|\| ''\}/, '旁白面板应编辑当前帧旁白');
assert.match(editor, /editor\.saveFrame\(selectedFrameId,[^]*narration_text: payload\.text/s, '保存旁白应走当前帧 frame_patch');
assert.match(hook, /type:\s*'tts'[^]*frame_id:\s*frameId/s, '重新生成旁白应走后端 tts 编辑类型并带当前帧 ID');
assert.doesNotMatch(hook, /type:\s*'tts',\s*\.\.\.payload/, '重新生成旁白不应再发送无帧 ID 的 tts payload');

console.log('html video editor component tests passed');
