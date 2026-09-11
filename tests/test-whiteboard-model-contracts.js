const assert = require('node:assert/strict');
const { callTextModel } = require('../server/services/ai/aiTextModel');
const { generateLineart, lineartPrompt } = require('../server/services/creative/whiteboard/mediaModels');

(async () => {
  let body;
  const text = await callTextModel({ textConfig: { enabled: true, apiKey: 'fixture-key', baseUrl: 'https://example.invalid/v1', modelId: 'gpt-6-astra' },
    messages: [{ role: 'user', content: '返回 JSON' }], reasoningEffort: 'low', maxOutputTokens: 10000, maxRetries: 0,
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 }); } });
  assert.equal(text.success, true);
  assert.deepEqual(body.reasoning, { effort: 'low' }); assert.equal(body.max_output_tokens, 10000);
  assert.equal(body.temperature, undefined);
  assert.equal(body.text, undefined);
  const imageConfig = { enabled: true, apiKey: 'fixture-key', baseUrl: 'https://example.invalid/v1', modelId: 'seedream-test' };
  const input = { artifact: { visualStyle: { displayName: '测试', description: '测试线稿' } }, scene: { imagePrompt: '两个独立图形' }, imageConfig };
  const prompt = lineartPrompt(input.artifact, input.scene);
  assert.ok(prompt.includes('低饱和橙色与钴蓝色'));
  assert.ok(!prompt.includes('#F5EBD7'));
  assert.ok(prompt.includes('色号、尺寸、制作术语和提示词都是创作说明，不能写在图里'));
  await assert.rejects(generateLineart({ ...input, services: { fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body); return new Response(JSON.stringify({ error: { message: 'unsupported parameter' } }), { status: 400 });
  } } }), error => error.code === 'IMAGE_REQUEST_REJECTED');
  assert.equal(body.output_format, undefined); assert.equal(body.size, '2560x1440');
  await assert.rejects(generateLineart({ ...input, services: { fetchImpl: async () => { throw new Error('fixture timeout'); } } }), error => error.code === 'UNKNOWN_EXTERNAL_OUTCOME');
  console.log('白板模型合同：Responses 推理预算、Seedream 参数与明确拒绝/未知结果区分通过。');
})().catch(error => { console.error(error); process.exitCode = 1; });
