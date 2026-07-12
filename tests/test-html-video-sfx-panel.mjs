import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const editorPath = path.join(root, 'frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx');
const panelPath = path.join(root, 'frontend-react/src/components/creative-video-editor/SfxPanel.jsx');
const hookPath = path.join(root, 'frontend-react/src/hooks/useHtmlVideoProject.js');
const apiPath = path.join(root, 'frontend-react/src/api/client.js');

const [editor, panel, hook, api] = await Promise.all([
  readFile(editorPath, 'utf8'),
  readFile(panelPath, 'utf8'),
  readFile(hookPath, 'utf8'),
  readFile(apiPath, 'utf8'),
]);

assert.match(editor, /SfxPanel/);
assert.match(editor, />音效</);
assert.match(editor, /activePanel === 'sfx'/);
assert.match(panel, /当前工程还没有自动音效。/);
assert.match(panel, /停用中\.\.\./);
assert.match(panel, /停用/);
// 面板复用 editorUi 共享原语，不再自造卡片样式
assert.match(panel, /EditorSection/);
assert.doesNotMatch(panel, /data-success-message/);
assert.match(panel, /time_sec/);
assert.match(panel, /global_time_sec/);
assert.match(panel, /Math\.round\(Number\(value\) \* 100\) \/ 100/, '音效时间输入应限制为两位小数');
assert.match(panel, /保存音效设置/);
assert.match(panel, /显示已停用音效/);
assert.doesNotMatch(panel, /start_seconds/);
assert.match(hook, /disableSfxEvent/);
assert.match(hook, /deletingSfxEventId/);
// 停用成功文案属于 hook（真正展示它的地方），不在面板里造死属性
assert.match(hook, /音效已停用|音效设置已更新/);
assert.match(api, /patchHtmlVideoProjectSfxEvent/);

console.log('html-video sfx panel tests passed');
