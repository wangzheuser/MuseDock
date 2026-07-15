const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeTemplateManifest } = require('../server/services/creative-video/html-video/templateManifestService');
const {
  buildTemplatePreviewDescriptor,
  buildTemplatePreviewHtml,
  getPreviewResolution,
  resolveTemplatePosterPath,
} = require('../server/services/creative-video/html-video/templatePreviewService');

/**
 * 验证模板预览元数据、物化内容和路径保护。
 * @returns {Promise<void>}
 */
async function runTests() {
  const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musedock-template-preview-'));
  try {
    fs.mkdirSync(path.join(templateDir, 'preview'), { recursive: true });
    fs.writeFileSync(
      path.join(templateDir, 'source.html'),
      '<html><head></head><body data-hv-canvas><h1>{{headline}}</h1></body></html>',
    );
    fs.writeFileSync(path.join(templateDir, 'preview/poster.jpg'), 'poster');

    const manifest = normalizeTemplateManifest({
      id: 'preview-fixture',
      name: '预览测试模板',
      engine: 'hyperframes',
      source_entry: 'source.html',
      output: {
        resolution: { width: 1080, height: 1920 },
        duration: 6,
      },
      inputs: { examples: [{ headline: '动态预览标题' }] },
      preview: {
        title: '预览测试',
        poster: 'preview/poster.jpg',
        sample_time_sec: 1.6,
      },
      license: { commercial_use: true },
    }, { templateDir });

    assert.deepStrictEqual(getPreviewResolution(manifest), {
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
    });
    assert.strictEqual(resolveTemplatePosterPath(manifest), path.join(templateDir, 'preview/poster.jpg'));
    assert.deepStrictEqual(buildTemplatePreviewDescriptor(manifest), {
      title: '预览测试',
      poster_url: '/api/config/templates/preview-fixture/poster',
      live_url: '/api/config/templates/preview-fixture/preview',
      sample_time_sec: 1.6,
    });

    const html = await buildTemplatePreviewHtml(manifest);
    assert.match(html, /动态预览标题/);
    assert.match(html, /window\.__HV_VARS__/);
    assert.match(html, /musedock-template-preview-style/);
    assert.match(html, /window\.innerWidth\/1080/);

    assert.throws(() => normalizeTemplateManifest({
      id: 'unsafe-preview',
      engine: 'hyperframes',
      source_entry: 'source.html',
      preview: { poster: '../outside.jpg' },
    }, { templateDir }), /preview\.poster 不合法/);
  } finally {
    fs.rmSync(templateDir, { recursive: true, force: true });
  }
}

runTests().then(() => {
  console.log('html-video template preview tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
