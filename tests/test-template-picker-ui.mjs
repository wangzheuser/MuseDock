import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 读取前端源码供轻量结构测试使用。
 * @param {string} filePath 仓库相对路径。
 * @returns {string} 文件内容。
 */
function read(filePath) {
  return readFileSync(filePath, 'utf8');
}

const picker = read('frontend-react/src/components/creative/TemplatePicker.jsx');
const composer = read('frontend-react/src/components/creative/CreativeComposer.jsx');
const defaults = read('frontend-react/src/components/settings/CreativeDefaultsSettings.jsx');

for (const text of [
  '选择画面语言，而不只是模板名称',
  '正在加载动态效果...',
  '不指定模板，由系统自动匹配',
  '预览不会创建任务，也不会导出视频',
  '点击放大模板动态预览',
  '正在打开大图预览...',
  '使用此模板',
]) {
  assert.ok(picker.includes(text), `TemplatePicker should include ${text}`);
}

assert.match(picker, /sandbox="allow-scripts"/, 'live preview iframe should be sandboxed without same-origin permission');
assert.match(picker, /poster_url/, 'template picker should render static poster metadata');
assert.match(picker, /live_url/, 'template picker should render live preview metadata');
assert.match(picker, /onLoad=\{\(\) => setLoading\(false\)\}/, 'live preview should expose a clear loading state');
assert.match(picker, /w-\[min\(96vw,1400px\)\]/, 'template preview should provide a large responsive dialog');
assert.match(composer, /<TemplatePicker[\s\S]*aspectRatio=\{currentAspectRatio\}/, 'composer should use the reusable template picker');
assert.match(composer, /<TemplatePicker[\s\S]*compact[\s\S]*onChange=\{updateCurrentTemplate\}/, 'composer template picker should align with compact settings fields');
assert.match(composer, /h-\[38px\].*rounded-lg/, 'composer settings controls should share one height and radius');
assert.match(defaults, /<TemplatePicker[\s\S]*aspectRatio=\{aspectRatio\}/, 'settings should use the reusable template picker');

console.log('template picker ui tests passed');
