const assert = require('assert/strict');
const express = require('express');
const http = require('http');

const creativeWorkflowsRouter = require('../server/routes/creativeWorkflows');

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function requestJson(server, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: text ? JSON.parse(text) : {},
      }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

async function run() {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.locals.creativeGuidance = {
    analyzeCreativeGuidance: async payload => {
      calls.push({ name: 'analyze', payload });
      if (!payload.input) return { success: false, code: 'INVALID_INPUT', message: '请先输入视频主题。' };
      return {
        success: true,
        analysis: {
          scenario: 'news',
          questions: [{ id: 'angle', options: [] }],
        },
      };
    },
    composeCreativeGuidance: async payload => {
      calls.push({ name: 'compose', payload });
      if (payload.failModel) return { success: false, code: 'TEXT_MODEL_UNAVAILABLE', message: '分析模型未配置。' };
      return { success: true, final_prompt: '完整创作提示词。', recommended_overrides: {} };
    },
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const analyzed = await requestJson(server, '/api/creative-workflows/guidance/analyze', { input: '今天发布新模型' });
    assert.equal(analyzed.statusCode, 200);
    assert.equal(analyzed.body.analysis.scenario, 'news');
    assert.equal(calls[0].payload.input, '今天发布新模型');

    const invalid = await requestJson(server, '/api/creative-workflows/guidance/analyze', {});
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.message, /请先输入/);

    const composed = await requestJson(server, '/api/creative-workflows/guidance/compose', {
      input: '今天发布新模型',
      answers: { angle: { selected: ['general_impact'] } },
    });
    assert.equal(composed.statusCode, 200);
    assert.equal(composed.body.final_prompt, '完整创作提示词。');

    const unavailable = await requestJson(server, '/api/creative-workflows/guidance/compose', { failModel: true });
    assert.equal(unavailable.statusCode, 503);
    assert.match(unavailable.body.message, /模型未配置/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('creative guidance route tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
