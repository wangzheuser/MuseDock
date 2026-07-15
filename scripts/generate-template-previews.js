#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const {
  DEFAULT_ROOT_DIR,
  scanTemplateManifests,
} = require('../server/services/creative-video/html-video/templateRegistry');
const {
  buildTemplatePreviewHtml,
  getPreviewResolution,
} = require('../server/services/creative-video/html-video/templatePreviewService');

const MAX_LANDSCAPE_WIDTH = 720;
const MAX_PORTRAIT_HEIGHT = 720;
const MAX_SQUARE_SIZE = 640;

/**
 * 根据原始画布计算轻量封面尺寸，保留模板真实画幅。
 * @param {{width: number, height: number}} resolution 模板画布尺寸。
 * @returns {{width: number, height: number}} 截图视口尺寸。
 */
function getPosterViewport(resolution) {
  if (resolution.width === resolution.height) {
    return { width: MAX_SQUARE_SIZE, height: MAX_SQUARE_SIZE };
  }
  const scale = resolution.width > resolution.height
    ? MAX_LANDSCAPE_WIDTH / resolution.width
    : MAX_PORTRAIT_HEIGHT / resolution.height;
  return {
    width: Math.max(1, Math.round(resolution.width * scale)),
    height: Math.max(1, Math.round(resolution.height * scale)),
  };
}

/**
 * 生成单个模板的 JPEG 预览封面。
 * @param {import('playwright-core').Browser} browser Playwright 浏览器。
 * @param {object} manifest 模板声明。
 * @returns {Promise<string>} 已写入的封面路径。
 */
async function generatePoster(browser, manifest) {
  const posterEntry = String(manifest?.preview?.poster || '').trim();
  if (!posterEntry) throw new Error(`${manifest.id} 未声明 preview.poster`);

  const resolution = getPreviewResolution(manifest);
  const viewport = getPosterViewport(resolution);
  const page = await browser.newPage({ viewport });
  try {
    const html = await buildTemplatePreviewHtml(manifest);
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts?.ready || Promise.resolve());
    const sampleTimeSec = Math.max(0, Number(manifest.preview.sample_time_sec) || 1.2);
    await page.waitForTimeout(Math.round(sampleTimeSec * 1000));

    const posterPath = path.resolve(manifest.__dir, posterEntry);
    await fs.mkdir(path.dirname(posterPath), { recursive: true });
    await page.screenshot({ path: posterPath, type: 'jpeg', quality: 88 });
    return posterPath;
  } finally {
    await page.close();
  }
}

/**
 * 批量生成正式模板预览封面。
 * @returns {Promise<void>}
 */
async function main() {
  const requestedIds = new Set(process.argv.slice(2).map(value => String(value || '').trim()).filter(Boolean));
  const manifests = scanTemplateManifests(DEFAULT_ROOT_DIR)
    .filter(manifest => requestedIds.size === 0 || requestedIds.has(manifest.id));
  if (!manifests.length) throw new Error('没有找到需要生成封面的模板。');

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const failures = [];
  try {
    for (const manifest of manifests) {
      try {
        const posterPath = await generatePoster(browser, manifest);
        process.stdout.write(`✓ ${manifest.id} -> ${path.relative(process.cwd(), posterPath)}\n`);
      } catch (error) {
        failures.push({ id: manifest.id, message: error.message });
        process.stderr.write(`✗ ${manifest.id}: ${error.message}\n`);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    throw new Error(`${failures.length} 个模板封面生成失败。`);
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`生成模板封面失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  generatePoster,
  getPosterViewport,
};
