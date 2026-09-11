// Real React/HTTP/media player verification against isolated local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const config = require('../../server/services/ai/aiModelConfig');
const router = require('../../server/routes/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');

async function main() {
  const root = path.resolve('.codex-runtime');
  const candidates = [];
  for (const name of (await fs.readdir(root)).filter(name => name.startsWith('whiteboard-media-test-'))) {
    const file = path.join(root, name, 'result.json');
    try { candidates.push({ file, mtime: (await fs.stat(file)).mtimeMs }); } catch {}
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  assert.ok(candidates.length, '请先运行 node tests/test-whiteboard-media.js');
  const fixture = JSON.parse(await fs.readFile(candidates[0].file, 'utf8'));
  const screenshots = path.join(root, 'whiteboard-media-ui-qa');
  await fs.mkdir(screenshots, { recursive: true });
  const configPath = path.join(screenshots, 'fixture-models.json');
  await config.saveConfig({ providers: { doubao: { name: '豆包语音测试', baseUrl: 'https://openspeech.bytedance.com', apiKey: 'fixture-key-only',
    models: { tts: { enabled: true, modelId: 'seed-audio-1.0' } } } }, active: { tts: 'doubao/tts' } }, { configPath });
  const options = { rootDir: fixture.rootDir };
  const app = express(); app.use(express.json());
  app.locals.creativeTaskRegistry = createCreativeTaskRegistry();
  app.locals.creativeWorkflows = {
    listCreationModes: workflows.listCreationModes,
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(options),
    getCreativeWorkflow: id => workflows.getCreativeWorkflow(id, options),
    getWhiteboardArtifact: (id, attempt) => workflows.getWhiteboardArtifact(id, attempt, options),
    getWhiteboardMediaFile: (id, file) => workflows.getWhiteboardMediaFile(id, file, options),
  };
  app.get('/api/config/ai-models', async (_req, res) => res.json(await config.getPublicConfig({ configPath })));
  app.post('/api/config/ai-models', async (req, res) => { await new Promise(resolve => setTimeout(resolve, 200)); res.json(await config.saveConfig(req.body, { configPath })); });
  app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: { creativeDefaults: {} } }));
  app.get('/api/system/health', (_req, res) => res.json({ success: true, data: { status: 'ok', diagnostics: [] } }));
  app.use('/api/creative-workflows', router);
  app.use(express.static(path.resolve('frontend-dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('frontend-dist/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    let executablePath = process.env.MUSEDOCK_QA_BROWSER;
    if (!executablePath) for (const file of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
      if (await fs.access(file).then(() => true, () => false)) { executablePath = file; break; }
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/creative/${fixture.workflowId}`);
    await page.getByRole('link', { name: '下载最终视频', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const video = await page.locator('video').evaluate(async element => {
      await element.play(); element.pause();
      await new Promise(resolve => { element.addEventListener('seeked', resolve, { once: true }); element.currentTime = 3; });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d'); context.drawImage(element, 0, 0, 32, 32);
      const pixel = [...context.getImageData(0, 0, 1, 1).data];
      return { width: element.videoWidth, height: element.videoHeight, duration: element.duration, pixel };
    });
    assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.ok(Math.abs(video.duration - 6) < 0.1);
    assert.ok(video.pixel[0] > 180 && video.pixel[1] > 170 && video.pixel[2] > 150, '浏览器必须实际解码出暖纸画面，不能仅加载黑色播放器元数据');
    const downloadWait = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载最终视频', exact: true }).click();
    const download = await downloadWait;
    assert.equal(download.suggestedFilename(), 'final.mp4');
    assert.ok((await fs.stat(await download.path())).size > 1000);
    await page.screenshot({ path: path.join(screenshots, 'final-desktop.png'), fullPage: true });
    await page.getByRole('tab', { name: '旁白', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 1);
    assert.ok(Math.abs(await page.locator('audio').evaluate(element => element.duration) - 6) < 0.1);
    await page.getByRole('tab', { name: '落墨', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="白板媒体产物"] img')].every(image => image.complete && image.naturalWidth));
    await page.screenshot({ path: path.join(screenshots, 'annotation-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: '成片', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(screenshots, 'final-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/settings?section=models`);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('豆包音色与整体表演描述').fill('成年女声，清晰自然，像在向朋友讲故事。');
    await page.getByLabel('豆包语速', { exact: true }).fill('12');
    await page.getByLabel('豆包音量', { exact: true }).fill('-5');
    await page.getByLabel('豆包音高', { exact: true }).fill('2');
    await page.screenshot({ path: path.join(screenshots, 'doubao-settings.png'), fullPage: true });
    await page.getByRole('button', { name: '应用到列表', exact: true }).click();
    const save = page.getByRole('button', { name: '保存模型配置', exact: true });
    await save.click(); assert.equal(await save.isDisabled(), true);
    await page.getByText('配置已保存', { exact: true }).waitFor();
    const stored = await config.getRuntimeConfig('tts', { configPath });
    assert.deepEqual(stored.doubao, { voiceDirection: '成年女声，清晰自然，像在向朋友讲故事。', speechRate: 12, loudnessRate: -5, pitchRate: 2 });
    assert.equal(stored.apiKey, 'fixture-key-only');
    await page.reload();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByLabel('豆包语速', { exact: true }).inputValue(), '12');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, providerCalls: 0, checks: ['最终视频播放及下载', '完整旁白播放', '标注图加载', '390px布局', '豆包参数保存及刷新', '无运行时异常'], screenshots }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
