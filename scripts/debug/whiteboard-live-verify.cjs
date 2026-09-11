// Explicitly opt-in, billable acceptance. Never included in npm test.
// Credentials can be supplied through the process environment; no credential
// or provider response is printed or written to the verification report.
const fs = require('fs/promises');
const path = require('path');
const config = require('../../server/services/ai/aiModelConfig');
const workflows = require('../../server/services/creative/creativeWorkflows');
const store = require('../../server/services/creative/workflowStore');
const mediaStore = require('../../server/services/creative/whiteboard/mediaStore');

async function main() {
  if (!process.argv.includes('--live')) throw new Error('真实验收需要显式传入 --live。');
  const injected = process.env.MUSEDOCK_ACCEPTANCE_TTS_CONFIG ? JSON.parse(process.env.MUSEDOCK_ACCEPTANCE_TTS_CONFIG) : null;
  delete process.env.MUSEDOCK_ACCEPTANCE_TTS_CONFIG;
  const root = path.resolve('.codex-runtime/whiteboard-live-verification');
  await fs.mkdir(root, { recursive: true });
  const rootDir = path.join(root, 'workflows');
  const counters = { tts: 0, image: 0, text: 0, downloads: 0 };
  const baseFetch = global.fetch;
  const modelIndex = process.argv.indexOf('--text-model');
  const textModelOverride = modelIndex >= 0 ? process.argv[modelIndex + 1] : '';
  const services = {
    aiModelConfig: { getRuntimeConfig: async type => {
      if (type === 'tts' && injected) return injected;
      const current = await config.getRuntimeConfig(type);
      return type === 'text' && textModelOverride ? { ...current, modelId: textModelOverride } : current;
    } },
    fetchImpl: async (url, init) => {
      let kind = 'download';
      if (init?.method === 'POST') {
        if (String(url).includes('/tts/') || String(url).endsWith('/t2a_v2')) { counters.tts += 1; kind = 'tts'; }
        else if (String(url).endsWith('/images/generations')) { counters.image += 1; kind = 'image'; }
        else { counters.text += 1; kind = 'text'; }
      } else counters.downloads += 1;
      const result = await baseFetch(url, init);
      const diagnostic = { kind, httpStatus: result.status };
      if (!result.ok) {
        const body = await result.clone().json().catch(() => null);
        const reason = String(body?.error?.message || body?.message || '');
        diagnostic.parameter = /^[a-z_]{1,60}$/.test(body?.error?.param || '') ? body.error.param : '';
        diagnostic.hints = ['temperature', 'json_object', 'json_schema', 'stream', 'model', 'instructions', 'max_output_tokens', 'input', 'store'].filter(value => reason.toLowerCase().includes(value));
        const credentials = Object.values(init?.headers || {}).filter(value => typeof value === 'string' && value.length > 10);
        let safeReason = reason;
        for (const credential of credentials) safeReason = safeReason.split(credential.replace(/^Bearer /, '')).join('<redacted>');
        diagnostic.reason = safeReason.replace(/https?:\/\/[^\s"']+/g, '<url>').replace(/[a-zA-Z0-9_-]{32,}/g, '<id>').slice(0, 500);
      }
      await fs.appendFile(path.join(root, 'request-events.jsonl'), `${JSON.stringify(diagnostic)}\n`);
      console.log(JSON.stringify(diagnostic));
      return result;
    },
  };
  const options = { rootDir, services, taskContext: { emit: async event => console.log(JSON.stringify({ stage: event.stage, message: event.message })) } };
  if (injected && process.argv.includes('--register-doubao')) {
    const current = await config.getPublicConfig();
    if (!Object.values(current.providers).some(provider => provider.models?.tts?.modelId === 'seed-audio-1.0')) {
      const providerId = 'doubao_seed_audio';
      if (current.providers[providerId]) throw new Error('豆包供应商标识已被占用，未覆盖已有设置。');
      current.providers[providerId] = { name: '豆包 Seed Audio', protocol: 'openai-responses', baseUrl: injected.baseUrl,
        apiKey: injected.apiKey, models: { tts: { enabled: true, modelId: injected.modelId,
          doubao: injected.doubao, ttsQueueIntervalMs: injected.ttsQueueIntervalMs || 1800, ttsConcurrency: 1 } } };
      await config.saveConfig(current);
      console.log(JSON.stringify({ configuration: '已将豆包 Seed Audio 作为可选供应商加入设置', activeSelectionChanged: false }));
    }
  }
  const resumeIndex = process.argv.indexOf('--resume');
  let id = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : '';
  if (!id) {
    const created = await workflows.createCreativeWorkflow({ creationModeId: 'whiteboard-stream-v1',
      input: { inputMode: 'text', rewritePolicy: 'preserve', narrationLanguage: 'zh-CN', targetDurationSeconds: 20,
        visualStylePreset: 'warm-paper-minimal-v1',
        content: '当一件事看起来很难，先把它拆成一个小动作。写下第一步，马上开始。看得见的小进展，会带着你走向下一步。' },
      productionPlan: { bgmMode: 'disabled', handDisplayMode: 'show', burnSubtitles: true, agentApprovalEnabled: true, narrationMode: 'enabled' },
    }, options);
    if (!created.success) throw new Error(created.message);
    id = created.workflow_id;
    await fs.writeFile(path.join(root, 'current.json'), JSON.stringify({ workflowId: id, rootDir, purpose: 'explicit_live_acceptance', counters }, null, 2));
    const drafted = await workflows.runCreativeWorkflow(id, options);
    if (!drafted.success) throw new Error(drafted.message);
    const approved = await action('approve_initial', { confirmed: true });
    if (!approved.success) throw new Error(approved.message);
  }
  async function action(name, extra = {}) {
    const record = await store.readWorkflow(id, rootDir);
    return workflows.actOnWhiteboardWorkflow(id, { action: name,
      expectedAttemptId: record.whiteboard.attempts.at(-1).id, expectedIdentity: record.whiteboard.current?.identity || '',
      expectedMediaIdentity: record.whiteboard.media ? mediaStore.mediaIdentity(record.whiteboard.media) : undefined,
      interactionId: record.whiteboard.interactions?.findLast(item => item.status === 'pending')?.id, ...extra }, options);
  }
  let record = await store.readWorkflow(id, rootDir);
  if (!record.whiteboard.media && record.status === 'failed') {
    const retried = await action('retry'); if (!retried.success) throw new Error(retried.message);
    const drafted = await workflows.runCreativeWorkflow(id, options); if (!drafted.success) throw new Error(drafted.message);
    const approved = await action('approve_initial', { confirmed: true }); if (!approved.success) throw new Error(approved.message);
    record = await store.readWorkflow(id, rootDir);
  }
  if (record.status === 'phase0_complete') {
    const result = await action('start_production'); if (!result.success) throw new Error(result.message);
  } else if (record.status === 'failed') {
    const result = await action('retry_media'); if (!result.success) throw new Error(result.message);
  } else if (record.status === 'unknown_external_outcome' && process.argv.includes('--authorize-review-retry')) {
    const last = record.whiteboard.media?.attempts.at(-1);
    if (!last?.stage.startsWith('review_') && last?.stage !== 'annotation_drafting') throw new Error('本次授权参数只适用于视觉审阅或标注请求。');
    const result = await action('authorize_media_retry', { confirmed: true }); if (!result.success) throw new Error(result.message);
  }
  record = await store.readWorkflow(id, rootDir);
  if (record.status === 'queued') await workflows.runCreativeWorkflow(id, options);
  record = await store.readWorkflow(id, rootDir);
  const final = record.whiteboard.media?.current?.final_delivery;
  const report = { workflowId: id, rootDir, status: record.status, stage: record.whiteboard.media?.stage,
    message: record.message, counters, finalIdentity: final?.identity,
    finalFile: final ? (await workflows.getWhiteboardMediaFile(id, final.video.id, options)).file_path : null,
    finalValidation: final?.validation, approvalBasis: 'development_acceptance_with_explicit_goal_authorization' };
  await fs.writeFile(path.join(root, 'current.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!final) process.exitCode = 2;
}
main().catch(() => { console.error('真实白板验收未完成，请读取隔离任务中的去敏状态与已保存产物；未自动重试外部请求。'); process.exitCode = 1; });
