import assert from 'node:assert/strict';

import { createMuseDockApiClient, MuseDockApiError, normalizeBaseUrl } from '../server/integrations/mcp/musedockApiClient.mjs';

const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  if (String(url).endsWith('/failed')) {
    return new Response(JSON.stringify({ success: false, code: 'BAD_REQUEST', message: '请求内容错误。' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ success: true, workflow_id: 'wf_1' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

assert.equal(normalizeBaseUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
assert.throws(() => normalizeBaseUrl('file:///tmp/musedock'), /http 或 https/);

const api = createMuseDockApiClient({ baseUrl: 'http://127.0.0.1:3999/', fetchImpl, timeoutMs: 5000 });
await api.createVideo({ input: '测试视频' });
assert.equal(calls[0].url, 'http://127.0.0.1:3999/api/creative-workflows');
assert.equal(calls[0].options.method, 'POST');
assert.deepEqual(JSON.parse(calls[0].options.body), { input: '测试视频' });

await api.updateScene('wf 1', 'scene/1', { type: 'frame_patch' });
assert.equal(calls[1].url, 'http://127.0.0.1:3999/api/creative-workflows/wf%201/html-video-project/frames/scene%2F1');
assert.equal(calls[1].options.method, 'PATCH');

await api.createFramePreview('wf 1', { frame_id: 'scene/1', draft_id: 'draft_1', run_layout_qa: true });
assert.equal(calls[2].url, 'http://127.0.0.1:3999/api/creative-workflows/wf%201/html-video-project/render');
assert.deepEqual(JSON.parse(calls[2].options.body), {
  mode: 'frame',
  frame_id: 'scene/1',
  draft_id: 'draft_1',
  run_layout_qa: true,
});

assert.equal(
  api.exportFileUrl('wf 1', 'export/1'),
  'http://127.0.0.1:3999/api/creative-workflows/wf%201/html-video-project/exports/export%2F1/file',
);

await assert.rejects(
  () => api.request('/failed'),
  error => error instanceof MuseDockApiError
    && error.status === 400
    && error.code === 'BAD_REQUEST'
    && /请求内容错误/.test(error.message),
);

console.log('musedock mcp api client tests passed');
