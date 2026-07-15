import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const componentPath = path.join(root, 'frontend-react/src/components/settings/CreativeDefaultsSettings.jsx');
const settingsPagePath = path.join(root, 'frontend-react/src/pages/SettingsPage.jsx');
const creativeDefaultsOptionsPath = path.join(root, 'frontend-react/src/lib/creativeDefaultsOptions.js');
const composerPath = path.join(root, 'frontend-react/src/components/creative/CreativeComposer.jsx');

const [componentSource, settingsPageSource, creativeDefaultsOptionsSource, composerSource] = await Promise.all([
  readFile(componentPath, 'utf8'),
  readFile(settingsPagePath, 'utf8'),
  readFile(creativeDefaultsOptionsPath, 'utf8'),
  readFile(composerPath, 'utf8'),
]);
const combinedCreativeDefaultsSource = `${componentSource}\n${creativeDefaultsOptionsSource}\n${composerSource}`;

for (const text of [
  '默认画面比例',
  '默认目标时长',
  '默认生成帧率',
  '默认导出倍速',
  '内容类型',
  '60 FPS',
  '帧 HTML 并发上限',
  '按比例默认模板',
  '锁定模板',
  '联网研究默认开启',
  '抖音视频抽帧',
  '强信号卡片',
  '正在保存创作默认值',
  '保存创作默认值',
]) {
  assert.match(combinedCreativeDefaultsSource, new RegExp(text), `Creative defaults UI should include "${text}"`);
}

assert.doesNotMatch(componentSource, /captionMode|showCaptionBar|renderQuality/);
assert.match(componentSource, /frameHtmlConcurrency/);
assert.match(componentSource, /fps/);
assert.match(combinedCreativeDefaultsSource, /playbackSpeed/);
assert.match(composerSource, /min="0\.1"/);
assert.match(composerSource, /max="2\.0"/);
assert.match(composerSource, /step="0\.1"/);
assert.match(settingsPageSource, /CreativeDefaultsSettings/);

console.log('creative defaults ui tests passed');
