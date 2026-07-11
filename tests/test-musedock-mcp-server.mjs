import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMuseDockMcpServer, createOperationStore } from '../server/integrations/mcp/musedockMcpServer.mjs';

const calls = [];
const projectResponse = {
  success: true,
  workflow_id: 'wf_1',
  edit_state: {
    active_draft_count: 0,
    has_pending_html_draft: false,
    stale_narration_count: 0,
    has_narration_text_outdated_audio: false,
    narration_tail_risk_count: 0,
    has_narration_tail_risk: false,
    layout_issue_count: 0,
    has_layout_issues: false,
    export_outdated: false,
    preview_outdated: false,
    latest_revision: { id: 'rev_1', created_at: '2026-07-11T00:00:00.000Z', summary: '初始版本' },
  },
  html_video_project: {
    project_id: 'project_1',
    workflow_id: 'wf_1',
    status: 'ready',
    template_id: 'news_signal_vertical',
    output: { resolution: { width: 1080, height: 1920 }, fps: 30, duration: 30, default_playback_speed: 1.5 },
    revisions: [{ id: 'rev_1', snapshot: { should_not_leak: true } }],
    edit_sessions: [{
      id: 'edit_plan_0001',
      kind: 'edit_plan',
      status: 'drafts_ready',
      scope: 'frame',
      mode: 'frame_layout_fix',
      instruction: '减少第二段文字密度',
      affected_frames: ['scene_01'],
      selected_frames: ['scene_01'],
      generated_drafts: [{ frame_id: 'scene_01', draft_id: 'draft_1', html_path: 'hidden.html', status: 'ready' }],
      layout_qa_reports: [{ frame_id: 'scene_01', draft_id: 'draft_1', report: { success: true, issues: [] } }],
    }],
    frames: [{
      id: 'scene_01',
      scene_id: 'scene_01',
      order: 1,
      template_id: 'news_signal_vertical',
      duration_sec: 5,
      narration_text: '第一段旁白。',
      captions: [{ id: 'cap_1', start: 0, end: 5, text: '第一段旁白。' }],
      inputs: { title: '第一段' },
      metadata: { visual_text: { headline: '第一段', keywords: ['测试'] }, secret_snapshot: 'hidden' },
      drafts: [],
    }],
  },
};

const api = {
  baseUrl: 'http://127.0.0.1:3000',
  exportFileUrl: (workflowId, exportId) => `http://127.0.0.1:3000/file/${workflowId}/${exportId}`,
  checkSystem: async () => ({
    success: true,
    data: {
      environment: { ok: true, message: '就绪', diagnostics: [{ ok: true, code: 'ffmpeg_available', message: 'ffmpeg 可用' }] },
      models: {
        analysis: { configured: true, provider: 'test', modelId: 'text-model', supportsMultimodal: true },
        tts: { configured: true, provider: 'test', modelId: 'tts-model' },
      },
      templates: { defaults: { aspectRatio: '9:16', fps: 30 } },
    },
  }),
  createVideo: async payload => {
    calls.push({ name: 'createVideo', payload });
    return { success: true, workflow_id: 'wf_1', task_id: 'task_1', status: 'queued' };
  },
  listVideos: async () => ({ success: true, workflows: [] }),
  getVideo: async () => ({ success: true, workflow_id: 'wf_1', status: 'done', result: { render: {} }, workflow: {} }),
  listExports: async () => ({
    success: true,
    exports: [{
      id: 'export_1',
      kind: 'export',
      created_at: '2026-07-11T00:00:01.000Z',
      absolute_path: '/tmp/output.mp4',
      quality_report: { pass: true, publish_ready: true, message: '通过', metrics: { fps: 30 }, issues: [] },
    }],
  }),
  getProject: async () => structuredClone(projectResponse),
  updateScene: async (workflowId, frameId, payload) => {
    calls.push({ name: 'updateScene', workflowId, frameId, payload });
    return { success: true, workflow_id: workflowId, revision: { id: 'rev_2', summary: '场景已修改' }, requires_tts: true, requires_render: true };
  },
  generateEditDrafts: async (workflowId, planId) => ({
    success: true,
    workflow_id: workflowId,
    plan_id: planId,
    message: '草稿已生成',
    plan: {
      id: planId,
      kind: 'edit_plan',
      status: 'drafts_ready',
      affected_frames: ['scene_01'],
      selected_frames: ['scene_01'],
      generated_drafts: [{ frame_id: 'scene_01', draft_id: 'draft_1', html_path: 'hidden.html', status: 'ready' }],
      layout_qa_reports: [{ frame_id: 'scene_01', draft_id: 'draft_1', report: { success: true, issues: [] } }],
    },
    html_video_project: { revisions: [{ id: 'rev_2', created_at: '2026-07-11T00:00:01.000Z', summary: '草稿已保存' }] },
  }),
  createFramePreview: async (workflowId, payload) => {
    calls.push({ name: 'createFramePreview', workflowId, payload });
    return {
      success: true,
      workflow_id: workflowId,
      preview_frame_id: payload.frame_id,
      preview_draft_id: payload.draft_id,
      preview_path: '/tmp/scene-01-draft-1.mp4',
      layout_qa: { success: true, checked_count: 5, issues: [] },
      message: '单帧预览已更新。',
    };
  },
  createPreview: async (workflowId, payload) => {
    calls.push({ name: 'createPreview', workflowId, payload });
    return { success: true, workflow_id: workflowId, message: '预览完成' };
  },
  exportVideo: async (workflowId, payload) => {
    calls.push({ name: 'exportVideo', workflowId, payload });
    return { success: true, workflow_id: workflowId, message: '导出完成' };
  },
};

const server = createMuseDockMcpServer({ api, operationStore: createOperationStore() });
const client = new Client({ name: 'musedock-test-client', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

/**
 * 等待测试后台操作进入终态。
 * @param {string} operationId 操作 ID。
 * @returns {Promise<object>} MCP 工具响应。
 */
async function waitForOperation(operationId) {
  for (let index = 0; index < 20; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const operation = await client.callTool({ name: 'get_operation', arguments: { operation_id: operationId } });
    if (['done', 'failed'].includes(operation.structuredContent.status)) return operation;
  }
  throw new Error(`operation ${operationId} did not finish`);
}

try {
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  const expectedTools = [
    'check_system', 'analyze_video_idea', 'compose_video_prompt', 'create_video',
    'list_videos', 'get_video', 'get_retry_plan', 'retry_video', 'inspect_video',
    'update_scene', 'propose_video_edit', 'generate_edit_drafts', 'create_scene_preview',
    'accept_video_edit', 'discard_video_edit', 'regenerate_narration',
    'inspect_video_layout', 'create_video_preview', 'export_video',
    'list_video_revisions', 'restore_video_revision', 'get_operation',
  ];
  assert.deepEqual(names.slice().sort(), expectedTools.slice().sort());
  assert.equal(names.some(name => name.includes('html_source')), false);

  const health = await client.callTool({ name: 'check_system', arguments: {} });
  assert.equal(health.structuredContent.ready, true);
  assert.equal(health.structuredContent.models.analysis.model_id, 'text-model');

  const created = await client.callTool({
    name: 'create_video',
    arguments: {
      prompt: '完整创作提示词',
      aspect_ratio: '9:16',
      duration_sec: 30,
      fps: 60,
      playback_speed: 1.2,
      template_id: 'news_signal_vertical',
      tts_voice: '白桦',
    },
  });
  assert.equal(created.structuredContent.workflow_id, 'wf_1');
  assert.deepEqual(calls[0].payload.creativeDefaultsOverride.templateByAspectRatio, { '9:16': 'news_signal_vertical' });
  assert.equal(calls[0].payload.creativeDefaultsOverride.fps, 60);
  assert.equal(calls[0].payload.creativeDefaultsOverride.playbackSpeed, 1.2);

  const inspected = await client.callTool({ name: 'inspect_video', arguments: { workflow_id: 'wf_1' } });
  assert.equal(inspected.structuredContent.scenes[0].frame_id, 'scene_01');
  assert.equal(inspected.structuredContent.edit_state.latest_revision.id, 'rev_1');
  assert.equal(inspected.structuredContent.edit_plans[0].generated_drafts[0].draft_id, 'draft_1');
  assert.equal(inspected.structuredContent.edit_plans[0].layout_qa_reports[0].report.success, true);
  assert.equal(JSON.stringify(inspected.structuredContent).includes('should_not_leak'), false);
  assert.equal(JSON.stringify(inspected.structuredContent).includes('secret_snapshot'), false);
  assert.equal(JSON.stringify(inspected.structuredContent).includes('hidden.html'), false);

  const updated = await client.callTool({
    name: 'update_scene',
    arguments: {
      workflow_id: 'wf_1',
      frame_id: 'scene_01',
      expected_revision_id: 'rev_1',
      narration_text: '修改后的第一段旁白。',
    },
  });
  assert.equal(updated.structuredContent.revision.id, 'rev_2');
  assert.equal(calls.find(call => call.name === 'updateScene').payload.narration_text, '修改后的第一段旁白。');

  const conflict = await client.callTool({
    name: 'update_scene',
    arguments: {
      workflow_id: 'wf_1',
      frame_id: 'scene_01',
      expected_revision_id: 'rev_old',
      duration_sec: 6,
    },
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.code, 'REVISION_CONFLICT');

  const draftsStarted = await client.callTool({
    name: 'generate_edit_drafts',
    arguments: {
      workflow_id: 'wf_1',
      plan_id: 'edit_plan_0001',
      selected_frame_ids: ['scene_01'],
      expected_revision_id: 'rev_1',
    },
  });
  const draftsOperation = await waitForOperation(draftsStarted.structuredContent.operation_id);
  assert.equal(draftsOperation.structuredContent.status, 'done');
  assert.equal(draftsOperation.structuredContent.result.plan.generated_drafts[0].draft_id, 'draft_1');
  assert.equal(draftsOperation.structuredContent.result.revision.id, 'rev_2');
  assert.equal(JSON.stringify(draftsOperation.structuredContent.result).includes('hidden.html'), false);

  const scenePreviewStarted = await client.callTool({
    name: 'create_scene_preview',
    arguments: { workflow_id: 'wf_1', frame_id: 'scene_01', draft_id: 'draft_1' },
  });
  const scenePreviewOperation = await waitForOperation(scenePreviewStarted.structuredContent.operation_id);
  assert.equal(scenePreviewOperation.structuredContent.result.preview_path, '/tmp/scene-01-draft-1.mp4');
  assert.equal(scenePreviewOperation.structuredContent.result.layout_qa.checked_count, 5);
  assert.equal(calls.find(call => call.name === 'createFramePreview').payload.run_layout_qa, true);

  const videoPreviewStarted = await client.callTool({
    name: 'create_video_preview',
    arguments: { workflow_id: 'wf_1' },
  });
  const videoPreviewOperation = await waitForOperation(videoPreviewStarted.structuredContent.operation_id);
  assert.equal(videoPreviewOperation.structuredContent.status, 'done');
  assert.equal(calls.find(call => call.name === 'createPreview').payload.export_options.playback_speed, 1.5);

  const exportStarted = await client.callTool({
    name: 'export_video',
    arguments: { workflow_id: 'wf_1', expected_revision_id: 'rev_1', export_options: { fps: 30 } },
  });
  assert.match(exportStarted.structuredContent.operation_id, /^operation_/);

  const operation = await waitForOperation(exportStarted.structuredContent.operation_id);
  assert.equal(operation.structuredContent.status, 'done');
  assert.equal(operation.structuredContent.result.latest_export.local_path, '/tmp/output.mp4');
  assert.equal(operation.structuredContent.result.latest_export.quality_report.publish_ready, true);
  assert.equal(calls.find(call => call.name === 'exportVideo').payload.export_options.playback_speed, 1.5);

  const explicitExportStarted = await client.callTool({
    name: 'export_video',
    arguments: { workflow_id: 'wf_1', expected_revision_id: 'rev_1', export_options: { playback_speed: 1.2 } },
  });
  await waitForOperation(explicitExportStarted.structuredContent.operation_id);
  assert.equal(calls.filter(call => call.name === 'exportVideo').at(-1).payload.export_options.playback_speed, 1.2);
} finally {
  await client.close();
  await server.close();
}

console.log('musedock mcp server protocol tests passed');
