const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

const routePath = path.join(__dirname, '../server/routes/config.js');
const source = fs.readFileSync(routePath, 'utf-8');

assert.match(source, /require\(['"]\.\.\/services\/appSettings['"]\)/, 'config route should require appSettings');
assert.match(source, /require\(['"]\.\.\/services\/creative-video\/html-video\/templateRegistry['"]\)/, 'config route should require html-video template registry');
assert.match(source, /async function getAppSettingsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getAppSettingsRoute');
assert.match(source, /async function saveAppSettingsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define saveAppSettingsRoute');
assert.match(source, /async function getConfigTemplatesRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getConfigTemplatesRoute');
assert.match(source, /async function getTemplatePreviewRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getTemplatePreviewRoute');
assert.match(source, /function getTemplatePosterRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getTemplatePosterRoute');
assert.match(source, /async function getConfigSystemHealthRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getConfigSystemHealthRoute');
assert.match(source, /async function getTtsVoicesRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getTtsVoicesRoute');
assert.match(source, /async function previewTtsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define previewTtsRoute');
assert.match(source, /router\.get\(['"]\/app-settings['"]\s*,\s*getAppSettingsRoute\s*\)/, 'config route should mount GET /app-settings');
assert.match(source, /router\.post\(['"]\/app-settings['"]\s*,\s*saveAppSettingsRoute\s*\)/, 'config route should mount POST /app-settings');
assert.match(source, /router\.get\(['"]\/templates['"]\s*,\s*getConfigTemplatesRoute\s*\)/, 'config route should mount GET /templates');
assert.match(source, /router\.get\(['"]\/templates\/:templateId\/preview['"]\s*,\s*getTemplatePreviewRoute\s*\)/, 'config route should mount template live preview');
assert.match(source, /router\.get\(['"]\/templates\/:templateId\/poster['"]\s*,\s*getTemplatePosterRoute\s*\)/, 'config route should mount template poster');
assert.match(source, /router\.get\(['"]\/system-health['"]\s*,\s*getConfigSystemHealthRoute\s*\)/, 'config route should mount GET /system-health');
assert.match(source, /router\.get\(['"]\/tts-voices['"]\s*,\s*getTtsVoicesRoute\s*\)/, 'config route should mount GET /tts-voices');
assert.match(source, /router\.post\(['"]\/tts-preview['"]\s*,\s*previewTtsRoute\s*\)/, 'config route should mount POST /tts-preview');

async function listen(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function requestJson(server, method, pathname, body) {
  const address = server.address();
  const response = await fetch(`http://${address.address}:${address.port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * 请求文本或二进制接口，保留响应头用于接口断言。
 * @param {import('http').Server} server 测试服务器。
 * @param {string} pathname 请求路径。
 * @returns {Promise<{status: number, contentType: string, body: Buffer}>} 原始响应。
 */
async function requestRaw(server, pathname) {
  const address = server.address();
  const response = await fetch(`http://${address.address}:${address.port}${pathname}`);
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body: Buffer.from(await response.arrayBuffer()),
  };
}

async function runIntegrationTests() {
  const appSettings = require('../server/services/appSettings');
  const aiModelConfig = require('../server/services/ai/aiModelConfig');
  const aiTtsModel = require('../server/services/ai/aiTtsModel');
  const systemMaintenance = require('../server/services/systemMaintenance');
  const templateRegistry = require('../server/services/creative-video/html-video/templateRegistry');
  const originals = {
    getPublicConfig: appSettings.getPublicConfig,
    saveConfig: appSettings.saveConfig,
    getCreativeDefaults: appSettings.getCreativeDefaults,
    getRuntimeConfig: aiModelConfig.getRuntimeConfig,
    callTtsModel: aiTtsModel.callTtsModel,
    getSystemHealth: systemMaintenance.getSystemHealth,
    scanTemplateManifests: templateRegistry.scanTemplateManifests,
    validateTemplateCompatibility: templateRegistry.validateTemplateCompatibility,
  };
  const savedPayloads = [];
  const compatibilityCalls = [];
  const healthCalls = [];
  const ttsCalls = [];
  const templateFixtureRoot = fs.mkdtempSync(path.join(__dirname, '.tmp-config-template-'));
  const wideTemplateDir = path.join(templateFixtureRoot, 'wide-news');
  const verticalTemplateDir = path.join(templateFixtureRoot, 'vertical-news');
  fs.mkdirSync(path.join(wideTemplateDir, 'preview'), { recursive: true });
  fs.mkdirSync(verticalTemplateDir, { recursive: true });
  fs.writeFileSync(path.join(wideTemplateDir, 'index.html'), '<html><head></head><body data-hv-canvas><h1>{{headline}}</h1></body></html>');
  fs.writeFileSync(path.join(wideTemplateDir, 'preview/poster.jpg'), 'wide-poster');
  fs.writeFileSync(path.join(verticalTemplateDir, 'index.html'), '<html><head></head><body data-hv-canvas>vertical</body></html>');
  let scannedRootDir = '';
  let ttsRuntime = {
    enabled: true,
    provider: 'mimo',
    providerName: '小米 MiMo',
    apiKey: 'tts-key',
    baseUrl: 'https://mimo.example/v1',
    modelId: 'mimo-v2.5-tts',
  };

  appSettings.getPublicConfig = async () => ({
    version: 1,
    creativeDefaults: { aspectRatio: '16:9' },
    system: { skipValidation: false, pexelsApiKey: 'pexels-route-key' },
  });
  appSettings.saveConfig = async payload => {
    savedPayloads.push(payload);
    return {
      version: 1,
      creativeDefaults: { aspectRatio: payload.creativeDefaults.aspectRatio },
      system: { skipValidation: payload.system.skipValidation, pexelsApiKey: payload.system.pexelsApiKey || '' },
    };
  };
  appSettings.getCreativeDefaults = async () => ({ aspectRatio: '16:9' });
  aiModelConfig.getRuntimeConfig = async type => (type === 'tts' ? ttsRuntime : null);
  aiTtsModel.callTtsModel = async options => {
    ttsCalls.push(options);
    return {
      success: true,
      audioBuffer: Buffer.from(`preview:${options.voice}`),
      format: 'mp3',
      voice: options.voice,
      model: { provider: 'mimo', id: 'mimo-v2.5-tts' },
    };
  };
  systemMaintenance.getSystemHealth = async options => {
    healthCalls.push(options);
    return { environment: { ok: true }, templates: { items: [] }, models: {}, storage: {} };
  };
  templateRegistry.scanTemplateManifests = rootDir => {
    scannedRootDir = rootDir;
    return [
      {
        id: 'wide-news',
        name: '横版资讯',
        description: '横版视频模板',
        category: 'news',
        tags: ['news', 'wide'],
        best_for: ['资讯解读'],
        not_for: ['竖版内容'],
        visual_family: 'editorial-wide',
        engine: 'hyperframes',
        output: { aspect: '16:9', duration_sec: 30 },
        source_entry: 'index.html',
        inputs: { examples: [{ headline: '预览标题' }] },
        preview: { title: '横版资讯动态预览', poster: 'preview/poster.jpg', sample_time_sec: 1.5 },
        __dir: wideTemplateDir,
        license: { name: 'MIT', commercial_use: true },
      },
      {
        id: 'vertical-news',
        name: '竖版资讯',
        engine: 'hyperframes',
        output: { aspect: '9:16', duration_sec: 60 },
        source_entry: 'index.html',
        inputs: { examples: [] },
        preview: {},
        __dir: verticalTemplateDir,
        license: { name: 'MIT', commercial_use: true },
      },
    ];
  };
  templateRegistry.validateTemplateCompatibility = (manifest, options) => {
    compatibilityCalls.push({ id: manifest.id, options });
    if (manifest.id === 'wide-news') {
      return { ok: true, reasons: [] };
    }
    return {
      ok: false,
      reasons: [{ field: 'aspect', code: 'unsupported-aspect', message: '模板不支持目标画幅' }],
    };
  };

  delete require.cache[require.resolve('../server/routes/config')];
  const router = require('../server/routes/config');
  const app = express();
  app.use(express.json());
  app.use('/api/config', router);
  const server = await listen(app);

  try {
    const getSettings = await requestJson(server, 'GET', '/api/config/app-settings');
    assert.strictEqual(getSettings.status, 200);
    assert.deepStrictEqual(getSettings.body, {
      success: true,
      data: {
        version: 1,
        creativeDefaults: { aspectRatio: '16:9' },
        system: { skipValidation: false, pexelsApiKey: 'pexels-route-key' },
      },
    });

    const settingsPayload = {
      creativeDefaults: { aspectRatio: '1:1' },
      system: { skipValidation: true, pexelsApiKey: 'pexels-save-key' },
    };
    const saveSettings = await requestJson(server, 'POST', '/api/config/app-settings', settingsPayload);
    assert.strictEqual(saveSettings.status, 200);
    assert.deepStrictEqual(savedPayloads, [settingsPayload]);
    assert.deepStrictEqual(saveSettings.body, {
      success: true,
      data: {
        version: 1,
        creativeDefaults: { aspectRatio: '1:1' },
        system: { skipValidation: true, pexelsApiKey: 'pexels-save-key' },
      },
    });

    const templates = await requestJson(server, 'GET', '/api/config/templates');
    assert.strictEqual(templates.status, 200);
    assert.deepStrictEqual(scannedRootDir, templateRegistry.DEFAULT_ROOT_DIRS);
    assert.deepStrictEqual(compatibilityCalls, [
      { id: 'wide-news', options: { aspectRatio: '16:9' } },
      { id: 'vertical-news', options: { aspectRatio: '16:9' } },
    ]);
    assert.deepStrictEqual(templates.body, {
      success: true,
      data: [
        {
          id: 'wide-news',
          name: '横版资讯',
          description: '横版视频模板',
          category: 'news',
          tags: ['news', 'wide'],
          best_for: ['资讯解读'],
          not_for: ['竖版内容'],
          visual_family: 'editorial-wide',
          engine: 'hyperframes',
          mapped_engine: 'hyperframes-playwright',
          aspect_ratio: '16:9',
          supported_aspects: ['16:9'],
          duration_sec: 30,
          source_entry: 'index.html',
          license: { name: 'MIT', commercial_use: true },
          preview: {
            title: '横版资讯动态预览',
            poster_url: '/api/config/templates/wide-news/poster',
            live_url: '/api/config/templates/wide-news/preview',
            sample_time_sec: 1.5,
          },
          compatible: true,
          compatibility_reasons: [],
        },
        {
          id: 'vertical-news',
          name: '竖版资讯',
          description: '',
          category: '',
          tags: [],
          best_for: [],
          not_for: [],
          visual_family: '',
          engine: 'hyperframes',
          mapped_engine: 'hyperframes-playwright',
          aspect_ratio: '9:16',
          supported_aspects: ['9:16'],
          duration_sec: 60,
          source_entry: 'index.html',
          license: { name: 'MIT', commercial_use: true },
          preview: {
            title: '竖版资讯预览',
            poster_url: '',
            live_url: '/api/config/templates/vertical-news/preview',
            sample_time_sec: 1.2,
          },
          compatible: false,
          compatibility_reasons: [{ field: 'aspect', code: 'unsupported-aspect', message: '模板不支持目标画幅' }],
        },
      ],
    });

    const templatePreview = await requestRaw(server, '/api/config/templates/wide-news/preview');
    assert.strictEqual(templatePreview.status, 200);
    assert.match(templatePreview.contentType, /text\/html/);
    assert.match(templatePreview.body.toString('utf8'), /预览标题/);
    assert.match(templatePreview.body.toString('utf8'), /musedock-template-preview-style/);

    const templatePoster = await requestRaw(server, '/api/config/templates/wide-news/poster');
    assert.strictEqual(templatePoster.status, 200);
    assert.match(templatePoster.contentType, /image\/jpeg/);
    assert.strictEqual(templatePoster.body.toString('utf8'), 'wide-poster');

    const missingTemplatePreview = await requestJson(server, 'GET', '/api/config/templates/missing/preview');
    assert.strictEqual(missingTemplatePreview.status, 404);
    assert.match(missingTemplatePreview.body.message, /未找到指定视频模板/);

    const health = await requestJson(server, 'GET', '/api/config/system-health?refresh=1');
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(healthCalls, [{ refresh: true }]);
    assert.deepStrictEqual(health.body, {
      success: true,
      data: { environment: { ok: true }, templates: { items: [] }, models: {}, storage: {} },
    });

    const voices = await requestJson(server, 'GET', '/api/config/tts-voices');
    assert.strictEqual(voices.status, 200);
    assert.strictEqual(voices.body.success, true);
    assert.strictEqual(voices.body.data.defaultVoice, 'mimo_default');
    assert.ok(voices.body.data.voices.some(voice => voice.id === '茉莉'));

    const preview = await requestJson(server, 'POST', '/api/config/tts-preview', {
      voice: '茉莉',
      emotionalVoice: true,
    });
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(preview.body.success, true);
    assert.strictEqual(preview.body.audio.mime, 'audio/mpeg');
    assert.strictEqual(preview.body.audio.base64, Buffer.from('preview:茉莉').toString('base64'));
    assert.strictEqual(ttsCalls.length, 1);
    assert.strictEqual(ttsCalls[0].voice, '茉莉');
    assert.match(ttsCalls[0].stylePrompt, /情绪|停顿|语气/);

    ttsRuntime = { enabled: false };
    const previewWithoutTts = await requestJson(server, 'POST', '/api/config/tts-preview', {
      voice: '茉莉',
    });
    assert.strictEqual(previewWithoutTts.status, 400);
    assert.strictEqual(previewWithoutTts.body.success, false);
    assert.match(previewWithoutTts.body.message, /TTS 语音合成模型未配置/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    appSettings.getPublicConfig = originals.getPublicConfig;
    appSettings.saveConfig = originals.saveConfig;
    appSettings.getCreativeDefaults = originals.getCreativeDefaults;
    aiModelConfig.getRuntimeConfig = originals.getRuntimeConfig;
    aiTtsModel.callTtsModel = originals.callTtsModel;
    systemMaintenance.getSystemHealth = originals.getSystemHealth;
    templateRegistry.scanTemplateManifests = originals.scanTemplateManifests;
    templateRegistry.validateTemplateCompatibility = originals.validateTemplateCompatibility;
    fs.rmSync(templateFixtureRoot, { recursive: true, force: true });
    delete require.cache[require.resolve('../server/routes/config')];
  }
}

runIntegrationTests().then(() => {
  console.log('config settings route tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
