import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createMuseDockApiClient, MuseDockApiError } from './musedockApiClient.mjs';

const SERVER_NAME = 'musedock';
const SERVER_VERSION = '1.0.0';
const IDENTIFIER = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_.-]+$/, '标识符格式无效');
const WORKFLOW_ID = IDENTIFIER.describe('MuseDock 创作任务 ID');
const FRAME_ID = IDENTIFIER.describe('工程中的 frame_id 或 scene_id');
const PLAN_ID = IDENTIFIER.describe('AI 编辑计划 ID');
const DRAFT_ID = IDENTIFIER.describe('场景 HTML 草稿 ID');
const REVISION_ID = IDENTIFIER.describe('工程 revision ID');

/**
 * 判断值是否为普通对象。
 * @param {unknown} value 待判断值。
 * @returns {boolean} 是否为普通对象。
 */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 取后端响应中的工程对象。
 * @param {object} response 后端响应。
 * @returns {object} html-video 工程。
 */
function getProject(response = {}) {
  return isObject(response.html_video_project) ? response.html_video_project : {};
}

/**
 * 生成 MCP 成功结果，同时兼容不读取 structuredContent 的客户端。
 * @param {object} data 结构化结果。
 * @param {string} message 简短结果说明。
 * @returns {object} MCP 工具结果。
 */
function successResult(data, message = '') {
  const value = isObject(data) ? data : { value: data };
  const text = [message || value.message || '操作完成。', JSON.stringify(value)].filter(Boolean).join('\n');
  return {
    content: [{ type: 'text', text }],
    structuredContent: value,
  };
}

/**
 * 将异常转换为 Agent 可理解的 MCP 工具错误。
 * @param {unknown} error 异常。
 * @returns {object} MCP 工具错误结果。
 */
function errorResult(error) {
  const apiError = error instanceof MuseDockApiError;
  const data = {
    success: false,
    code: apiError ? (error.code || 'MUSEDOCK_API_ERROR') : 'MCP_TOOL_ERROR',
    message: error?.message || 'MuseDock MCP 工具执行失败。',
    ...(apiError && error.status ? { http_status: error.status } : {}),
  };
  return {
    content: [{ type: 'text', text: `${data.message}\n${JSON.stringify(data)}` }],
    structuredContent: data,
    isError: true,
  };
}

/**
 * 精简 revision，避免把完整工程快照写入模型上下文。
 * @param {object} revision revision 记录。
 * @returns {object|null} revision 摘要。
 */
function summarizeRevision(revision) {
  if (!isObject(revision)) return null;
  return {
    id: String(revision.id || ''),
    created_at: String(revision.created_at || ''),
    summary: String(revision.summary || ''),
    requires_tts: revision.requires_tts === true,
    requires_render: revision.requires_render === true,
  };
}

/**
 * 精简导出记录和技术质量报告。
 * @param {object} item 导出记录。
 * @param {object} api MuseDock API 客户端。
 * @param {string} workflowId 工作流 ID。
 * @returns {object|null} 导出摘要。
 */
function summarizeExport(item, api, workflowId) {
  if (!isObject(item)) return null;
  const report = isObject(item.quality_report) ? item.quality_report : null;
  return {
    id: String(item.id || ''),
    kind: String(item.kind || 'export'),
    created_at: String(item.created_at || ''),
    format: String(item.format || ''),
    platform: item.platform || null,
    playback_speed: Number(item.playback_speed || 1),
    tail_protection: String(item.tail_protection || ''),
    local_path: String(item.absolute_path || item.path || ''),
    download_url: item.id ? api.exportFileUrl(workflowId, item.id) : '',
    quality_report: report ? {
      pass: report.pass === true,
      publish_ready: report.publish_ready === true,
      message: String(report.message || ''),
      metrics: isObject(report.metrics) ? report.metrics : {},
      issues: Array.isArray(report.issues) ? report.issues : [],
    } : null,
  };
}

/**
 * 按创建时间取得最新记录。
 * @param {Array<object>} items 记录列表。
 * @returns {object|null} 最新记录。
 */
function latestItem(items = []) {
  return [...items].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))[0] || null;
}

/**
 * 未显式设置导出倍速时继承当前任务默认值。
 * @param {object} exportOptions 本次导出配置。
 * @param {object} projectOutput 工程输出配置。
 * @returns {object} 补全后的导出配置。
 */
function withProjectPlaybackSpeed(exportOptions = {}, projectOutput = {}) {
  const next = { ...(isObject(exportOptions) ? exportOptions : {}) };
  if (next.playback_speed !== undefined) return next;
  const speed = Number(projectOutput?.default_playback_speed);
  if (
    Number.isFinite(speed)
    && speed >= 0.1
    && speed <= 2
    && Math.abs(speed * 10 - Math.round(speed * 10)) < 0.000001
  ) next.playback_speed = speed;
  return next;
}

/**
 * 精简场景信息，保留 Agent 进行局部编辑所需字段。
 * @param {object} frame 工程帧。
 * @returns {object} 场景摘要。
 */
function summarizeFrame(frame = {}) {
  return {
    frame_id: String(frame.id || ''),
    scene_id: String(frame.scene_id || frame.id || ''),
    order: Number(frame.order || 0),
    template_id: String(frame.template_id || ''),
    duration_sec: Number(frame.duration_sec || 0),
    narration_text: String(frame.narration_text || ''),
    narration_audio_stale: frame.narration_audio_stale === true,
    narration_audio_duration_sec: Number(frame.narration_audio_duration_sec || 0) || null,
    inputs: isObject(frame.inputs) ? frame.inputs : {},
    visual_text: isObject(frame.metadata?.visual_text) ? frame.metadata.visual_text : {},
    captions: (Array.isArray(frame.captions) ? frame.captions : []).map(caption => ({
      id: String(caption?.id || ''),
      start: Number(caption?.start || 0),
      end: Number(caption?.end || 0),
      text: String(caption?.text || ''),
    })),
    active_draft_id: String(frame.active_draft_id || ''),
    drafts: (Array.isArray(frame.drafts) ? frame.drafts : []).map(draft => ({
      id: String(draft?.id || ''),
      status: String(draft?.status || ''),
      summary: String(draft?.summary || ''),
      preview_path: String(draft?.preview_path || draft?.preview_image_path || ''),
    })),
  };
}

/**
 * 精简布局质检结果，避免把完整浏览器诊断写入模型上下文。
 * @param {object} value 布局质检结果。
 * @returns {object|null} 布局质检摘要。
 */
function summarizeLayoutQa(value) {
  if (!isObject(value)) return null;
  return {
    success: value.success !== false,
    checked_count: Number(value.checked_count ?? (value.metrics ? 1 : 0)),
    skipped_count: Number(value.skipped_count || 0),
    environment_skipped: value.environment_skipped === true,
    issues: (Array.isArray(value.issues) ? value.issues : []).slice(0, 50).map(issue => ({
      code: String(issue?.code || ''),
      severity: String(issue?.severity || ''),
      frame_id: String(issue?.frame_id || ''),
      sample_time_sec: Number(issue?.sample_time_sec || 0),
      message: String(issue?.message || ''),
      details: isObject(issue?.details) ? issue.details : {},
    })),
  };
}

/**
 * 精简 AI 编辑计划及其草稿和质检状态。
 * @param {object} plan 编辑计划。
 * @returns {object|null} 编辑计划摘要。
 */
function summarizeEditPlan(plan) {
  if (!isObject(plan)) return null;
  return {
    id: String(plan.id || plan.plan_id || ''),
    status: String(plan.status || ''),
    scope: String(plan.scope || ''),
    mode: String(plan.mode || ''),
    instruction: String(plan.instruction || ''),
    ambiguous: plan.ambiguous === true,
    affected_frame_ids: Array.isArray(plan.affected_frames) ? plan.affected_frames : [],
    selected_frame_ids: Array.isArray(plan.selected_frames) ? plan.selected_frames : [],
    generated_drafts: (Array.isArray(plan.generated_drafts) ? plan.generated_drafts : []).map(draft => ({
      frame_id: String(draft?.frame_id || ''),
      draft_id: String(draft?.draft_id || ''),
      status: String(draft?.status || ''),
    })),
    layout_qa_reports: (Array.isArray(plan.layout_qa_reports) ? plan.layout_qa_reports : []).map(item => ({
      frame_id: String(item?.frame_id || ''),
      draft_id: String(item?.draft_id || ''),
      report: summarizeLayoutQa(item?.report),
    })),
    execution_errors: (Array.isArray(plan.execution_errors) ? plan.execution_errors : []).map(item => ({
      frame_id: String(item?.frame_id || ''),
      draft_id: String(item?.draft_id || ''),
      code: String(item?.code || ''),
      message: String(item?.message || ''),
    })),
  };
}

/**
 * 精简工程和编辑状态。
 * @param {object} response 工程接口响应。
 * @param {{frameId?:string}} options 筛选项。
 * @returns {object} 工程摘要。
 */
function summarizeProject(response = {}, options = {}) {
  const project = getProject(response);
  const allFrames = Array.isArray(project.frames) ? project.frames : [];
  const frames = options.frameId
    ? allFrames.filter(frame => frame.id === options.frameId || frame.scene_id === options.frameId)
    : allFrames;
  if (options.frameId && !frames.length) {
    throw new MuseDockApiError(`未找到场景 ${options.frameId}。`, { code: 'FRAME_NOT_FOUND' });
  }
  const editState = isObject(response.edit_state) ? response.edit_state : (isObject(project.edit_state) ? project.edit_state : {});
  return {
    success: true,
    workflow_id: String(response.workflow_id || project.workflow_id || ''),
    project_id: String(project.project_id || ''),
    status: String(project.status || ''),
    template_id: String(project.template_id || ''),
    output: isObject(project.output) ? project.output : {},
    scene_count: allFrames.length,
    scenes: frames.map(summarizeFrame),
    edit_state: {
      active_draft_count: Number(editState.active_draft_count || 0),
      has_pending_html_draft: editState.has_pending_html_draft === true,
      stale_narration_count: Number(editState.stale_narration_count || 0),
      has_narration_text_outdated_audio: editState.has_narration_text_outdated_audio === true,
      narration_tail_risk_count: Number(editState.narration_tail_risk_count || 0),
      has_narration_tail_risk: editState.has_narration_tail_risk === true,
      layout_issue_count: Number(editState.layout_issue_count || 0),
      has_layout_issues: editState.has_layout_issues === true,
      export_outdated: editState.export_outdated === true,
      preview_outdated: editState.preview_outdated === true,
      latest_revision: summarizeRevision(editState.latest_revision),
      latest_export: editState.latest_export ? {
        id: String(editState.latest_export.id || ''),
        created_at: String(editState.latest_export.created_at || ''),
      } : null,
    },
    edit_plans: (Array.isArray(project.edit_sessions) ? project.edit_sessions : [])
      .filter(plan => plan?.kind === 'edit_plan')
      .slice(-20)
      .map(summarizeEditPlan),
  };
}

/**
 * 精简通用编辑响应。
 * @param {object} response 后端响应。
 * @returns {object} 编辑结果摘要。
 */
function summarizeMutation(response = {}) {
  const plan = response.plan || response.edit_plan || null;
  const project = getProject(response);
  const latestRevision = latestItem(Array.isArray(project.revisions) ? project.revisions : []);
  return {
    success: response.success !== false,
    workflow_id: String(response.workflow_id || ''),
    plan_id: String(response.plan_id || plan?.id || plan?.plan_id || ''),
    message: String(response.message || ''),
    revision: summarizeRevision(response.revision || latestRevision),
    requires_tts: response.requires_tts === true,
    requires_render: response.requires_render === true,
    plan: summarizeEditPlan(plan),
    choices: (Array.isArray(response.choices) ? response.choices : []).map(choice => ({
      mode: String(choice?.mode || ''),
      label: String(choice?.label || ''),
      description: String(choice?.description || ''),
    })),
  };
}

/**
 * 创建轻量内存操作表，让耗时编辑和导出立即返回 operation_id。
 * @param {number} maxRecords 最大保留记录数。
 * @returns {object} 操作表。
 */
export function createOperationStore(maxRecords = 100) {
  const records = new Map();

  /**
   * 清理最旧的已完成操作。
   */
  function trim() {
    if (records.size <= maxRecords) return;
    const removable = [...records.values()]
      .filter(record => ['done', 'failed'].includes(record.status))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    while (records.size > maxRecords && removable.length) records.delete(removable.shift().operation_id);
  }

  return {
    /**
     * 启动后台操作。
     * @param {string} type 操作类型。
     * @param {object} metadata 操作元数据。
     * @param {Function} action 异步动作。
     * @returns {object} 初始操作状态。
     */
    start(type, metadata, action) {
      const now = new Date().toISOString();
      const record = {
        operation_id: `operation_${Date.now()}_${randomUUID().slice(0, 8)}`,
        type,
        status: 'queued',
        created_at: now,
        updated_at: now,
        ...metadata,
        result: null,
        error: null,
      };
      records.set(record.operation_id, record);
      trim();
      Promise.resolve().then(async () => {
        record.status = 'running';
        record.updated_at = new Date().toISOString();
        try {
          record.result = await action();
          record.status = 'done';
        } catch (error) {
          record.status = 'failed';
          record.error = {
            code: error instanceof MuseDockApiError ? error.code : 'MCP_OPERATION_FAILED',
            message: error?.message || '后台操作失败。',
            ...(error instanceof MuseDockApiError && error.status ? { http_status: error.status } : {}),
          };
        }
        record.updated_at = new Date().toISOString();
      });
      return { ...record };
    },
    /**
     * 读取后台操作。
     * @param {string} operationId 操作 ID。
     * @returns {object|null} 操作状态。
     */
    get(operationId) {
      const record = records.get(operationId);
      return record ? { ...record } : null;
    },
  };
}

/**
 * 检查调用方读取的 revision 是否仍为最新版本。
 * @param {object} api MuseDock API 客户端。
 * @param {string} workflowId 工作流 ID。
 * @param {string|undefined} expectedRevisionId 预期 revision。
 */
async function assertExpectedRevision(api, workflowId, expectedRevisionId) {
  if (!expectedRevisionId) return;
  const response = await api.getProject(workflowId);
  const summary = summarizeProject(response);
  const actual = summary.edit_state.latest_revision?.id || '';
  if (actual !== expectedRevisionId) {
    throw new MuseDockApiError(`工程已更新，当前最新版本为 ${actual || '未知'}，请重新调用 inspect_video。`, {
      code: 'REVISION_CONFLICT',
      data: { expected_revision_id: expectedRevisionId, actual_revision_id: actual },
    });
  }
}

/**
 * 构建只包含显式字段的创作覆盖项。
 * @param {object} args MCP 工具参数。
 * @returns {object} creativeDefaultsOverride。
 */
function buildCreativeOverride(args) {
  const override = {};
  const map = [
    ['aspect_ratio', 'aspectRatio'],
    ['duration_sec', 'targetDurationSec'],
    ['content_mode', 'contentMode'],
    ['fps', 'fps'],
    ['playback_speed', 'playbackSpeed'],
    ['use_research', 'useResearch'],
    ['generate_audio', 'generateAudio'],
    ['generate_captions', 'generateCaptions'],
    ['auto_sfx', 'autoSfxEnabled'],
    ['emotional_voice', 'emotionalVoice'],
    ['tts_voice', 'ttsVoice'],
    ['source_image_analysis', 'sourceImageAnalysisEnabled'],
    ['frame_html_concurrency', 'frameHtmlConcurrency'],
  ];
  map.forEach(([source, target]) => {
    if (args[source] !== undefined) override[target] = args[source];
  });
  if (args.template_id) {
    if (!args.aspect_ratio) throw new MuseDockApiError('指定 template_id 时必须同时指定 aspect_ratio。', { code: 'ASPECT_RATIO_REQUIRED' });
    override.templateByAspectRatio = { [args.aspect_ratio]: args.template_id };
    override.lockTemplate = true;
  }
  return override;
}

/**
 * 注册带统一错误处理的 MCP 工具。
 * @param {McpServer} server MCP Server。
 * @param {string} name 工具名。
 * @param {object} config 工具配置。
 * @param {Function} handler 工具处理器。
 */
function registerTool(server, name, config, handler) {
  server.registerTool(name, config, async args => {
    try {
      return await handler(args || {});
    } catch (error) {
      return errorResult(error);
    }
  });
}

/**
 * 创建 MuseDock MCP Server。
 * @param {{api?:object,operationStore?:object}} options 注入项。
 * @returns {McpServer} 已注册工具的 MCP Server。
 */
export function createMuseDockMcpServer(options = {}) {
  const api = options.api || createMuseDockApiClient();
  const operations = options.operationStore || createOperationStore();
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: 'MuseDock 用于创建和二次编辑高质量视频。新视频先检查系统；短想法优先分析并生成完整提示词。编辑前必须 inspect_video，并尽量携带 expected_revision_id。视觉修改先提案、生成草稿和预览，再接受；修改旁白后重生成 TTS；正式导出前检查草稿、旁白和布局状态。耗时工具返回 operation_id，使用 get_operation 每 15～30 秒查询，禁止高频轮询。',
    },
  );

  const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  registerTool(server, 'check_system', {
    title: '检查 MuseDock 系统状态',
    description: '在创建或编辑视频前检查 MuseDock 服务、分析模型、TTS 和渲染环境。不会返回密钥。',
    inputSchema: z.object({ refresh: z.boolean().optional().describe('是否强制刷新环境检测') }).strict(),
    annotations: readAnnotations,
  }, async ({ refresh }) => {
    const response = await api.checkSystem(refresh === true);
    const data = isObject(response.data) ? response.data : response;
    const environment = isObject(data.environment) ? data.environment : {};
    const models = isObject(data.models) ? data.models : {};
    const result = {
      success: true,
      ready: environment.ok === true && models.analysis?.configured === true && models.tts?.configured === true,
      base_url: api.baseUrl,
      environment: {
        ok: environment.ok === true,
        message: String(environment.message || ''),
        diagnostics: Array.isArray(environment.diagnostics) ? environment.diagnostics.map(item => ({
          ok: item?.ok === true,
          code: String(item?.code || ''),
          message: String(item?.message || ''),
        })) : [],
      },
      models: {
        analysis: models.analysis ? {
          configured: models.analysis.configured === true,
          provider: String(models.analysis.provider || ''),
          model_id: String(models.analysis.modelId || ''),
          supports_multimodal: models.analysis.supportsMultimodal === true,
        } : null,
        tts: models.tts ? {
          configured: models.tts.configured === true,
          provider: String(models.tts.provider || ''),
          model_id: String(models.tts.modelId || ''),
        } : null,
      },
      creative_defaults: data.templates?.defaults || null,
    };
    return successResult(result, result.ready ? 'MuseDock 已具备视频生成条件。' : 'MuseDock 尚未完全就绪。');
  });

  const creativeSettingsSchema = z.object({
    aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']).optional(),
    targetDurationSec: z.number().min(15).max(180).optional(),
    contentMode: z.enum(['news', 'analysis', 'discussion']).optional(),
    fps: z.union([z.literal(30), z.literal(60)]).optional(),
    playbackSpeed: z.number().min(0.1).max(2).multipleOf(0.1).optional(),
    useResearch: z.boolean().optional(),
    generateAudio: z.boolean().optional(),
    generateCaptions: z.boolean().optional(),
    autoSfxEnabled: z.boolean().optional(),
    emotionalVoice: z.boolean().optional(),
    ttsVoice: z.string().trim().max(80).optional(),
  }).passthrough();

  registerTool(server, 'analyze_video_idea', {
    title: '分析视频创作想法',
    description: '把简短想法分析为场景、风险和少量高价值问题。时效资讯和信息不足时应先调用本工具。会消耗分析模型。',
    inputSchema: z.object({
      input: z.string().trim().min(2).max(20000),
      creative_settings: creativeSettingsSchema.optional(),
    }).strict(),
    annotations: { ...readAnnotations, idempotentHint: false },
  }, async args => successResult(await api.analyzeVideoIdea({
    input: args.input,
    creativeSettings: args.creative_settings || {},
  }), '创作想法分析完成。'));

  registerTool(server, 'compose_video_prompt', {
    title: '生成完整视频提示词',
    description: '根据 analyze_video_idea 的 analysis 和用户回答生成可二次修改的完整创作提示词。会消耗分析模型。',
    inputSchema: z.object({
      input: z.string().trim().min(2).max(20000),
      analysis: z.record(z.string(), z.unknown()),
      answers: z.record(z.string(), z.object({
        selected: z.array(z.string()).optional(),
        custom: z.string().max(1000).optional(),
      }).passthrough()).optional(),
      creative_settings: creativeSettingsSchema.optional(),
    }).strict(),
    annotations: { ...readAnnotations, idempotentHint: false },
  }, async args => successResult(await api.composeVideoPrompt({
    input: args.input,
    analysis: args.analysis,
    answers: args.answers || {},
    creativeSettings: args.creative_settings || {},
  }), '完整创作提示词已生成，请在创建视频前向用户展示。'));

  registerTool(server, 'create_video', {
    title: '创建视频',
    description: '使用最终提示词创建后台视频任务并立即返回 workflow_id。短想法应先经过创作引导。未传设置继续使用 MuseDock 设置中心默认值。',
    inputSchema: z.object({
      prompt: z.string().trim().min(2).max(30000),
      research_query: z.string().trim().max(240).optional(),
      prompt_origin: z.enum(['manual', 'guided', 'guided_edited']).optional(),
      aspect_ratio: z.enum(['9:16', '16:9', '1:1', '4:5']).optional(),
      duration_sec: z.number().min(15).max(180).optional(),
      content_mode: z.enum(['news', 'analysis', 'discussion']).optional(),
      fps: z.union([z.literal(30), z.literal(60)]).optional(),
      playback_speed: z.number().min(0.1).max(2).multipleOf(0.1).optional(),
      template_id: z.string().trim().max(100).optional(),
      use_research: z.boolean().optional(),
      generate_audio: z.boolean().optional(),
      generate_captions: z.boolean().optional(),
      auto_sfx: z.boolean().optional(),
      emotional_voice: z.boolean().optional(),
      tts_voice: z.string().trim().max(80).optional(),
      source_image_analysis: z.boolean().optional(),
      frame_html_concurrency: z.number().int().min(1).max(5).optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    const response = await api.createVideo({
      input: args.prompt,
      submittedPrompt: args.prompt,
      researchQuery: args.research_query || '',
      promptOrigin: args.prompt_origin || 'manual',
      assetIds: [],
      renderOptions: {},
      workflowOptions: {},
      creativeDefaultsOverride: buildCreativeOverride(args),
    });
    return successResult({
      success: true,
      workflow_id: String(response.workflow_id || ''),
      task_id: String(response.task_id || response.active_task?.task_id || ''),
      status: String(response.status || response.workflow?.status || 'queued'),
      message: String(response.message || '创作任务已创建。'),
    }, '创作任务已创建。请每 15～30 秒调用 get_video 查询，禁止立即重复创建。');
  });

  registerTool(server, 'list_videos', {
    title: '列出视频任务',
    description: '列出最近的 MuseDock 创作任务，用于定位“刚才的视频”或失败任务。',
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    annotations: readAnnotations,
  }, async ({ limit }) => {
    const response = await api.listVideos();
    const workflows = (Array.isArray(response.workflows) ? response.workflows : []).slice(0, limit || 20).map(item => ({
      workflow_id: String(item.workflow_id || ''),
      title: String(item.title || ''),
      input: String(item.input || '').slice(0, 500),
      status: String(item.status || ''),
      message: String(item.message || ''),
      output_url: item.output_url ? new URL(item.output_url, api.baseUrl).toString() : '',
      created_at: String(item.created_at || ''),
      updated_at: String(item.updated_at || ''),
    }));
    return successResult({ success: true, count: workflows.length, workflows }, `已读取 ${workflows.length} 个视频任务。`);
  });

  registerTool(server, 'get_video', {
    title: '查询视频任务',
    description: '查询视频任务进度；完成时返回最新成片本地路径、下载地址和质量报告。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID }).strict(),
    annotations: readAnnotations,
  }, async ({ workflow_id }) => {
    const response = await api.getVideo(workflow_id);
    let exportsResponse = null;
    try {
      exportsResponse = await api.listExports(workflow_id);
    } catch (error) {
      if (error?.status !== 404 && !['HTML_VIDEO_PROJECT_NOT_FOUND', 'PROJECT_NOT_FOUND'].includes(error?.code)) throw error;
    }
    const exportsList = Array.isArray(exportsResponse?.exports) ? exportsResponse.exports : [];
    const latestExport = latestItem(exportsList.filter(item => item?.kind !== 'preview'));
    const workflow = response.workflow || {};
    const render = response.result?.render || {};
    const result = {
      success: true,
      workflow_id,
      status: String(response.status || workflow.status || ''),
      stage: String(workflow.current_stage || ''),
      progress: Number(workflow.current_progress || 0),
      message: String(response.message || workflow.current_stage_message || ''),
      task_id: String(response.active_task?.task_id || workflow.active_task_id || ''),
      can_retry: String(response.status || workflow.status || '') === 'failed',
      output_path: String(render.output_path || workflow.render_output_path || ''),
      output_url: render.output_url ? new URL(render.output_url, api.baseUrl).toString() : '',
      latest_export: summarizeExport(latestExport, api, workflow_id),
      error: String(response.status || workflow.status || '') === 'failed'
        ? (workflow.error || workflow.last_failure || null)
        : null,
    };
    const draftReady = result.status === 'done' && !latestExport;
    if (draftReady) result.message = '可编辑工程已生成，等待二次编辑后导出。';
    return successResult(
      result,
      draftReady ? result.message : (result.status === 'done' ? '视频生成完成。' : `视频任务状态：${result.status || '未知'}。`),
    );
  });

  registerTool(server, 'get_retry_plan', {
    title: '读取视频恢复计划',
    description: '失败任务重试前读取最新恢复计划和 plan_code，避免从错误阶段重复生成。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID }).strict(),
    annotations: readAnnotations,
  }, async ({ workflow_id }) => successResult(await api.getRetryPlan(workflow_id), '已读取最新恢复计划。'));

  registerTool(server, 'retry_video', {
    title: '恢复失败视频任务',
    description: '按 get_retry_plan 返回的最新 plan_code 恢复失败任务，不新建 workflow。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      expected_plan_code: z.string().trim().min(1).max(120),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => successResult(await api.retryVideo(args.workflow_id, {
    mode: 'repair_and_resume',
    confirm_plan_code: args.expected_plan_code,
  }), '恢复重试任务已启动。'));

  registerTool(server, 'inspect_video', {
    title: '读取视频工程',
    description: '二次编辑前读取精简工程、稳定场景 ID、旁白、字幕、草稿、revision 和过期状态；不会返回 HTML 源码。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID, frame_id: FRAME_ID.optional() }).strict(),
    annotations: readAnnotations,
  }, async args => successResult(
    summarizeProject(await api.getProject(args.workflow_id), { frameId: args.frame_id }),
    args.frame_id ? `已读取场景 ${args.frame_id}。` : '已读取视频工程摘要。',
  ));

  const captionSchema = z.object({
    id: z.string().trim().max(160).optional(),
    start: z.number().min(0).max(3600),
    end: z.number().min(0).max(3600),
    text: z.string().max(4000),
  }).strict().refine(value => value.end >= value.start, '字幕结束时间不能早于开始时间');

  registerTool(server, 'update_scene', {
    title: '精确修改视频场景',
    description: '精确修改一个场景的旁白、时长、模板输入、字幕或模板。修改旁白后必须再调用 regenerate_narration。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      frame_id: FRAME_ID,
      expected_revision_id: REVISION_ID.optional(),
      narration_text: z.string().max(8000).optional(),
      duration_sec: z.number().min(0.1).max(600).optional(),
      template_id: z.string().trim().min(1).max(100).optional(),
      inputs: z.record(z.string(), z.unknown()).optional(),
      captions: z.array(captionSchema).max(200).optional(),
      regenerate_captions: z.boolean().optional(),
      summary: z.string().trim().max(300).optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    const payload = {
      type: 'frame_patch',
      summary: args.summary || 'MCP 已修改场景，需要重新渲染。',
    };
    ['narration_text', 'duration_sec', 'template_id', 'inputs', 'captions', 'regenerate_captions'].forEach(key => {
      if (args[key] !== undefined) payload[key] = args[key];
    });
    if (Object.keys(payload).length === 2) throw new MuseDockApiError('至少提供一个要修改的场景字段。', { code: 'EMPTY_SCENE_PATCH' });
    return successResult(summarizeMutation(await api.updateScene(args.workflow_id, args.frame_id, payload)), '场景修改已保存。');
  });

  registerTool(server, 'propose_video_edit', {
    title: '生成视频 AI 编辑计划',
    description: '针对自然语言视觉修改生成影响范围和编辑计划，不直接接受正式修改。布局、动效、视觉结构调整应先调用本工具。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      instruction: z.string().trim().min(2).max(4000),
      selected_frame_id: FRAME_ID.optional(),
      expected_revision_id: REVISION_ID.optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    const response = await api.proposeEdit(args.workflow_id, {
      instruction: args.instruction,
      selected_frame_id: args.selected_frame_id,
    });
    return successResult(summarizeMutation(response), 'AI 编辑计划已生成，请检查影响范围后再生成草稿。');
  });

  registerTool(server, 'generate_edit_drafts', {
    title: '执行编辑计划并生成草稿',
    description: '后台执行编辑计划，为选定场景生成草稿并默认运行布局 QA；立即返回 operation_id。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      plan_id: PLAN_ID,
      selected_frame_ids: z.array(FRAME_ID).max(100).optional(),
      run_layout_qa: z.boolean().optional(),
      expected_revision_id: REVISION_ID.optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    const operation = operations.start('generate_edit_drafts', {
      workflow_id: args.workflow_id,
      plan_id: args.plan_id,
    }, async () => summarizeMutation(await api.generateEditDrafts(args.workflow_id, args.plan_id, {
      confirm: true,
      selected_frame_ids: args.selected_frame_ids || [],
      run_layout_qa: args.run_layout_qa !== false,
    })));
    return successResult(operation, '编辑草稿正在生成，请调用 get_operation 查询。');
  });

  registerTool(server, 'create_scene_preview', {
    title: '生成场景或草稿预览',
    description: '后台渲染指定正式场景或 HTML 草稿，并运行布局 QA；接受视觉草稿前应调用。立即返回 operation_id。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      frame_id: FRAME_ID,
      draft_id: DRAFT_ID.optional(),
      run_layout_qa: z.boolean().optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    const operation = operations.start('create_scene_preview', {
      workflow_id: args.workflow_id,
      frame_id: args.frame_id,
      draft_id: args.draft_id || null,
    }, async () => {
      const response = await api.createFramePreview(args.workflow_id, {
        frame_id: args.frame_id,
        ...(args.draft_id ? { draft_id: args.draft_id } : {}),
        run_layout_qa: args.run_layout_qa !== false,
      });
      return {
        success: response.success !== false,
        workflow_id: args.workflow_id,
        frame_id: String(response.preview_frame_id || args.frame_id),
        draft_id: String(response.preview_draft_id || args.draft_id || ''),
        preview_path: String(response.preview_path || ''),
        layout_qa: summarizeLayoutQa(response.layout_qa),
        message: String(response.message || ''),
      };
    });
    return successResult(operation, '场景预览正在生成，请调用 get_operation 查询。');
  });

  registerTool(server, 'accept_video_edit', {
    title: '接受视频编辑草稿',
    description: '接受指定 AI 编辑计划生成的草稿。应先检查草稿预览和布局 QA。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID, plan_id: PLAN_ID, expected_revision_id: REVISION_ID.optional() }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    return successResult(summarizeMutation(await api.acceptEdit(args.workflow_id, args.plan_id)), '编辑草稿已接受，需要重新预览和导出。');
  });

  registerTool(server, 'discard_video_edit', {
    title: '放弃视频编辑草稿',
    description: '放弃指定 AI 编辑计划生成的草稿，不修改正式视频帧。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID, plan_id: PLAN_ID }).strict(),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, async args => successResult(summarizeMutation(await api.discardEdit(args.workflow_id, args.plan_id)), '编辑草稿已放弃。'));

  registerTool(server, 'regenerate_narration', {
    title: '重新生成视频旁白',
    description: '使用设置中心最新 TTS 音色和情绪配置重新生成一个场景或全片旁白；立即返回 operation_id。单场景必须提供 narration_text。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      frame_id: FRAME_ID.optional(),
      narration_text: z.string().max(8000).optional(),
      expected_revision_id: REVISION_ID.optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    if (args.frame_id && !String(args.narration_text || '').trim()) {
      throw new MuseDockApiError('重新生成单场景旁白时必须提供 narration_text。', { code: 'NARRATION_EMPTY' });
    }
    const operation = operations.start('regenerate_narration', {
      workflow_id: args.workflow_id,
      frame_id: args.frame_id || null,
    }, async () => summarizeMutation(await api.regenerateNarration(args.workflow_id, {
      ...(args.frame_id ? { frame_id: args.frame_id, text: args.narration_text } : {}),
    })));
    return successResult(operation, '旁白正在重新生成，请调用 get_operation 查询。');
  });

  registerTool(server, 'inspect_video_layout', {
    title: '检查视频布局',
    description: '后台检查全片或单场景布局，发现文本重叠、溢出和低信息画面；立即返回 operation_id。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID, frame_id: FRAME_ID.optional() }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    const operation = operations.start('inspect_video_layout', {
      workflow_id: args.workflow_id,
      frame_id: args.frame_id || null,
    }, async () => {
      const response = await api.inspectLayout(args.workflow_id, args.frame_id ? { frame_id: args.frame_id } : {});
      const qa = response.layout_qa || {};
      return {
        success: response.success !== false,
        workflow_id: args.workflow_id,
        message: String(response.message || ''),
        layout_qa: {
          success: qa.success !== false,
          checked_count: Number(qa.checked_count || 0),
          skipped_count: Number(qa.skipped_count || 0),
          environment_skipped: qa.environment_skipped === true,
          issues: Array.isArray(qa.issues) ? qa.issues : [],
        },
      };
    });
    return successResult(operation, '布局检查已启动，请调用 get_operation 查询。');
  });

  const exportOptionsSchema = z.object({
    platform: z.string().trim().max(80).optional(),
    file_name: z.string().trim().max(180).optional(),
    width: z.number().int().min(240).max(7680).optional(),
    height: z.number().int().min(240).max(7680).optional(),
    fps: z.union([z.literal(30), z.literal(60)]).optional(),
    playback_speed: z.number().min(0.1).max(2).multipleOf(0.1).optional(),
    tail_protection: z.enum(['pad_end', 'none']).optional(),
  }).strict();

  registerTool(server, 'create_video_preview', {
    title: '生成视频预览',
    description: '后台生成全片预览；修改完成后、正式导出前调用。立即返回 operation_id。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID, export_options: exportOptionsSchema.optional() }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    const operation = operations.start('create_video_preview', { workflow_id: args.workflow_id }, async () => {
      const project = getProject(await api.getProject(args.workflow_id));
      const exportOptions = withProjectPlaybackSpeed(args.export_options, project.output);
      const response = await api.createPreview(args.workflow_id, { export_options: exportOptions });
      const exportsResponse = await api.listExports(args.workflow_id);
      const previews = (Array.isArray(exportsResponse.exports) ? exportsResponse.exports : []).filter(item => item?.kind === 'preview');
      return {
        ...summarizeMutation(response),
        latest_preview: summarizeExport(latestItem(previews), api, args.workflow_id),
      };
    });
    return successResult(operation, '视频预览正在生成，请调用 get_operation 查询。');
  });

  registerTool(server, 'export_video', {
    title: '正式导出视频',
    description: '后台重新渲染并正式导出视频，返回发布质量报告。导出前必须确认没有待接受草稿、过期旁白或阻断布局问题。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      expected_revision_id: REVISION_ID.optional(),
      export_options: exportOptionsSchema.optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    const projectSummary = summarizeProject(await api.getProject(args.workflow_id));
    const state = projectSummary.edit_state;
    const blockers = [];
    if (state.has_pending_html_draft) blockers.push('存在待接受或放弃的 HTML 草稿');
    if (state.has_narration_text_outdated_audio) blockers.push('存在旁白文本与音频不一致的场景');
    if (state.has_narration_tail_risk) blockers.push('存在旁白尾音截断风险');
    if (state.has_layout_issues) blockers.push('存在阻断级布局问题');
    if (blockers.length) {
      throw new MuseDockApiError(`工程尚不适合正式导出：${blockers.join('；')}。`, {
        code: 'PROJECT_NOT_READY',
        data: { blockers },
      });
    }
    const exportOptions = withProjectPlaybackSpeed(args.export_options, projectSummary.output);
    const operation = operations.start('export_video', { workflow_id: args.workflow_id }, async () => {
      const response = await api.exportVideo(args.workflow_id, { export_options: exportOptions });
      const exportsResponse = await api.listExports(args.workflow_id);
      const exportsList = (Array.isArray(exportsResponse.exports) ? exportsResponse.exports : []).filter(item => item?.kind !== 'preview');
      return {
        ...summarizeMutation(response),
        latest_export: summarizeExport(latestItem(exportsList), api, args.workflow_id),
      };
    });
    return successResult(operation, '正式视频正在导出，请调用 get_operation 查询。');
  });

  registerTool(server, 'list_video_revisions', {
    title: '列出视频版本',
    description: '列出工程 revision 摘要，不返回完整快照。',
    inputSchema: z.object({ workflow_id: WORKFLOW_ID, limit: z.number().int().min(1).max(100).optional() }).strict(),
    annotations: readAnnotations,
  }, async args => {
    const response = await api.listRevisions(args.workflow_id);
    const revisions = (Array.isArray(response.revisions) ? response.revisions : []).slice(-(args.limit || 30)).map(summarizeRevision);
    return successResult({ success: true, workflow_id: args.workflow_id, count: revisions.length, revisions }, '已读取工程版本。');
  });

  registerTool(server, 'restore_video_revision', {
    title: '恢复视频版本',
    description: '基于历史 revision 创建新的恢复版本，不删除后续历史。',
    inputSchema: z.object({
      workflow_id: WORKFLOW_ID,
      revision_id: REVISION_ID,
      expected_revision_id: REVISION_ID.optional(),
    }).strict(),
    annotations: writeAnnotations,
  }, async args => {
    await assertExpectedRevision(api, args.workflow_id, args.expected_revision_id);
    return successResult(summarizeMutation(await api.restoreRevision(args.workflow_id, args.revision_id)), '历史版本已恢复为新的 revision。');
  });

  registerTool(server, 'get_operation', {
    title: '查询 MuseDock 后台操作',
    description: '查询编辑草稿、TTS、布局检查、预览或导出操作。建议每 15～30 秒调用一次。',
    inputSchema: z.object({ operation_id: IDENTIFIER }).strict(),
    annotations: readAnnotations,
  }, async ({ operation_id }) => {
    const operation = operations.get(operation_id);
    if (!operation) throw new MuseDockApiError('未找到该 MCP 后台操作；MCP 进程重启后请重新 inspect_video 或 get_video。', { code: 'OPERATION_NOT_FOUND' });
    return successResult(operation, `后台操作状态：${operation.status}。`);
  });

  return server;
}

/**
 * 通过 STDIO 启动 MuseDock MCP Server。
 * @param {{api?:object,operationStore?:object}} options 注入项。
 */
export async function startMuseDockMcpStdio(options = {}) {
  const server = createMuseDockMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
