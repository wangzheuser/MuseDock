const crypto = require('crypto');
const {
  DEFAULT_ROOT, getWorkflowPath, readWorkflow, persistWorkflowUnlocked,
  withWorkflowFileQueue, createStages, makeId, getNow, workflowFileExists,
} = require('../workflowStore');
const { WHITEBOARD_MODE, createModeSnapshot } = require('../creationModes');
const {
  CONTRACT_VERSION, SKILL_SOURCE_REVISION, CANDIDATE_SKELETON, CANDIDATE_SCHEMA, WhiteboardError,
  normalizeInput, normalizeProductionPlan, canonicalJson, sha256, materializeCandidate,
} = require('./contracts');
const artifactStore = require('./artifactStore');
const { generateDraft } = require('./structuredDraft');

function assertContract(record) {
  if (record.creationModeId !== WHITEBOARD_MODE) throw new WhiteboardError('MODE_ACTION_UNSUPPORTED', '该操作仅适用于线稿白板动画。', 409);
  if (record.creationModeContractVersion !== 1 || record.skillContractVersion !== CONTRACT_VERSION
    || record.skillSourceRevision !== SKILL_SOURCE_REVISION
    || canonicalJson(record.stageSchemaSnapshot) !== canonicalJson(createModeSnapshot(WHITEBOARD_MODE).stageSchemaSnapshot)) {
    throw new WhiteboardError('CONTRACT_UNSUPPORTED', '此任务使用的白板合同版本暂不兼容，请保留原任务并创建新任务。', 409);
  }
}

function addMessage(record, role, text, now, attemptId = '') {
  record.whiteboard.messages.push({ id: crypto.randomUUID(), role, text, createdAt: now, attemptId });
}

function setStage(record, id, status, message, now) {
  record.stages = record.stages.map(stage => stage.id === id
    ? { ...stage, status, message, updated_at: now, ...(status === 'done' ? { completed_at: now } : {}) }
    : stage);
}

function prepareAttempt(record, { input, productionPlan, revisionMessage = '', kind = 'model' }, now) {
  const attempt = {
    id: crypto.randomUUID(), number: record.whiteboard.attempts.length + 1,
    role: input.inputMode === 'srt' ? 'storyboardPlanning' : 'contentDrafting',
    kind, status: 'prepared', createdAt: now, input, productionPlan, revisionMessage,
    parentIdentity: record.whiteboard.current?.identity || '',
    inputIdentity: sha256({ contractVersion: CONTRACT_VERSION, input, productionPlan, narrationService: record.whiteboard.narrationService }),
  };
  record.whiteboard.attempts.push(attempt);
  record.whiteboard.activeAttemptId = attempt.id;
  record.whiteboard.pendingInitialApproval = true;
  if (record.whiteboard.current) record.whiteboard.current.stale = true;
  record.whiteboard.approvals.forEach(approval => { approval.stale = true; });
  record.whiteboard.initialApproval = null;
  record.success = true;
  record.status = 'queued';
  record.current_stage = 'content_plan';
  record.current_progress = 10;
  record.message = kind === 'settings' ? '正在更新制作方案...' : '正在准备白板内容与制作方案...';
  record.current_stage_message = record.message;
  record.last_event_seq = 0;
  record.error = null;
  record.updated_at = now;
  setStage(record, 'content_plan', 'queued', record.message, now);
  setStage(record, 'initial_approval', 'pending', '等待当前内容与制作方案生成。', now);
  return attempt;
}

async function mutate(workflowId, options, handler) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  return withWorkflowFileQueue(getWorkflowPath(workflowId, rootDir), async () => {
    const record = await readWorkflow(workflowId, rootDir);
    assertContract(record);
    const result = await handler(record, getNow(options.services));
    await persistWorkflowUnlocked(record, rootDir);
    return { record, result };
  });
}

function actionsFor(record, artifactValid = true) {
  if (!artifactValid || ['queued', 'running'].includes(record.status)) return [];
  if (record.status === 'unknown_external_outcome') return [{ id: 'authorize_new_attempt', label: '确认后重新请求', requiresConfirmation: true }];
  if (record.status === 'failed') return [{ id: 'retry', label: '重新生成方案' }];
  const actions = [{ id: 'revise', label: '生成修改版' }, { id: 'update_plan', label: '调整制作设置' }];
  if (record.status === 'waiting_approval' && record.whiteboard.current && !record.whiteboard.current.stale) {
    actions.unshift({ id: 'approve_initial', label: '确认内容与制作方案', requiresConfirmation: true });
  }
  return ['waiting_approval', 'phase0_complete'].includes(record.status) ? actions : [];
}

async function getView(record, options = {}) {
  const view = structuredClone(record);
  let valid = true;
  try {
    assertContract(record);
    if (record.whiteboard.current) view.whiteboard.current.artifact = await artifactStore.readArtifact(record, record.whiteboard.current, options.rootDir);
  } catch (error) {
    valid = false;
    view.whiteboard.artifactError = error instanceof WhiteboardError ? error.message : '读取白板方案失败，请检查本地文件。';
  }
  view.whiteboard.allowedActions = actionsFor(record, valid);
  // 候选执行输入保存在磁盘审计中；页面历史只需要版本、状态和绑定，不回灌全部正文。
  view.whiteboard.attempts = record.whiteboard.attempts.map(({ input, productionPlan, revisionMessage, ...attempt }) => attempt);
  return view;
}

async function createWhiteboardWorkflow(payload, options = {}) {
  const input = normalizeInput(payload.input);
  const productionPlan = normalizeProductionPlan(payload.productionPlan || {});
  if ((payload.assetIds?.length || payload.asset_ids?.length) || payload.skipValidation === true) throw new WhiteboardError('INVALID_INPUT', '白板阶段 0 不接受上传素材或跳过校验，请使用白板输入表单。');
  const now = getNow(options.services);
  const workflowId = String(options.services?.idFactory?.() || makeId(now));
  const snapshot = createModeSnapshot(WHITEBOARD_MODE);
  const ttsConfig = await options.services?.aiModelConfig?.getRuntimeConfig?.('tts');
  const voiceConfigured = Boolean(ttsConfig?.enabled && ttsConfig.apiKey && ttsConfig.baseUrl && ttsConfig.modelId);
  const narrationService = {
    configured: voiceConfigured,
    displayName: voiceConfigured ? String(ttsConfig.providerName || '创建时启用的旁白服务').slice(0, 80) : '未配置',
    // 仅冻结非敏感调用合同的指纹，凭据和服务地址不进入任务或产物。
    contractHash: voiceConfigured ? sha256({ provider: ttsConfig.provider || '', protocol: ttsConfig.protocol || '', modelId: ttsConfig.modelId, voiceId: ttsConfig.voiceId || '' }) : '',
  };
  const record = {
    ...snapshot, skillContractVersion: CONTRACT_VERSION, skillSourceRevision: SKILL_SOURCE_REVISION,
    workflow_id: workflowId, aweme_id: '', title: input.inputMode === 'topic' ? input.content.slice(0, 80) : '白板创作',
    input, stages: createStages(snapshot.stageSchemaSnapshot), created_at: now, updated_at: now,
    active_task_id: '', active_operation_id: '', task_status: '', result: null,
    whiteboard: { schemaVersion: 1, narrationService, current: null, activeAttemptId: '', pendingInitialApproval: true, initialApproval: null, attempts: [], approvals: [], messages: [] },
  };
  setStage(record, 'intake', 'done', '创作输入已校验，模式与合同已冻结。', now);
  const attempt = prepareAttempt(record, { input, productionPlan }, now);
  addMessage(record, 'user', input.content, now, attempt.id);
  const rootDir = options.rootDir || DEFAULT_ROOT;
  await withWorkflowFileQueue(getWorkflowPath(workflowId, rootDir), async () => {
    if (await workflowFileExists(workflowId, rootDir)) throw new WhiteboardError('WORKFLOW_EXISTS', '任务标识重复，请重新创建。', 409);
    await persistWorkflowUnlocked(record, rootDir);
  });
  return { success: true, ...await getView(record, options) };
}

function assertExpectedVersion(record, payload) {
  const latest = record.whiteboard.attempts.at(-1);
  if (payload.expectedAttemptId !== latest?.id || payload.expectedIdentity !== (record.whiteboard.current?.identity || '')) {
    throw new WhiteboardError('STALE_IDENTITY', '方案版本已变化，请刷新并检查当前版本后再操作。', 409);
  }
}

function assertActiveAttempt(record, attempt) {
  const active = record.whiteboard.attempts.find(item => item.id === attempt.id);
  if (record.whiteboard.activeAttemptId !== attempt.id || record.status !== 'running'
    || (record.whiteboard.current?.identity || '') !== attempt.parentIdentity
    || active?.inputIdentity !== attempt.inputIdentity) {
    throw new WhiteboardError('STALE_IDENTITY', '当前方案或输入已变化，不能发布旧候选。', 409);
  }
  return active;
}

async function actOnWhiteboardWorkflow(workflowId, payload = {}, options = {}) {
  if (payload.action === 'ask_status') {
    const record = await readWorkflow(workflowId, options.rootDir);
    assertContract(record);
    return { success: true, workflow_id: workflowId, workflow: await getView(record, options), startTask: false };
  }
  const { record, result } = await mutate(workflowId, options, async (record, now) => {
    assertExpectedVersion(record, payload);
    if (!actionsFor(record).some(action => action.id === payload.action)) throw new WhiteboardError('ACTION_NOT_ALLOWED', '当前阶段不允许此操作，请等待执行结束或刷新任务。', 409);
    const current = record.whiteboard.current;
    if (payload.action === 'approve_initial') {
      if (payload.confirmed !== true || current?.stale) throw new WhiteboardError('APPROVAL_REQUIRED', '请检查当前内容与制作方案，并明确确认。', 409);
      const artifact = await artifactStore.readArtifact(record, current, options.rootDir);
      const approval = {
        gate: 'initial_content_plan_approval', identity: current.identity, attemptId: current.attemptId,
        artifactSha256: current.artifactSha256, productionPlanSha256: sha256(artifact.productionPlan),
        actor: 'user', approvedAt: now, stale: false,
      };
      record.whiteboard.initialApproval = approval;
      record.whiteboard.approvals.push(approval);
      record.whiteboard.pendingInitialApproval = false;
      record.status = 'phase0_complete';
      record.success = true;
      record.current_progress = 100;
      record.message = '内容与制作方案已确认，阶段 0 已完成。后续媒体制作尚未接入。';
      record.current_stage_message = record.message;
      record.updated_at = now;
      setStage(record, 'initial_approval', 'done', record.message, now);
      addMessage(record, 'user', '确认当前内容、分镜与制作方案。', now, current.attemptId);
      addMessage(record, 'assistant', record.message, now, current.attemptId);
      return false;
    }
    if (payload.action === 'authorize_new_attempt' && payload.confirmed !== true) throw new WhiteboardError('EXTERNAL_AUTH_REQUIRED', '需要明确同意新的外部请求及可能的重复费用。', 409);
    const latest = record.whiteboard.attempts.at(-1);
    const revisionMessage = payload.action === 'revise' ? String(payload.message || '').trim() : latest.revisionMessage;
    if (payload.action === 'revise' && (!revisionMessage || revisionMessage.length > 6000)) throw new WhiteboardError('INVALID_INPUT', '请输入修改意见，长度不能超过 6000 个字符。');
    const input = payload.input ? normalizeInput({ ...latest.input, ...payload.input }) : latest.input;
    const productionPlan = payload.action === 'update_plan'
      ? normalizeProductionPlan({ ...latest.productionPlan, ...(payload.productionPlan || {}) }) : latest.productionPlan;
    if (payload.action === 'update_plan') await artifactStore.readArtifact(record, current, options.rootDir);
    const kind = payload.action === 'update_plan' ? 'settings' : (payload.action === 'retry' || payload.action === 'authorize_new_attempt' ? latest.kind : 'model');
    const attempt = prepareAttempt(record, { input, productionPlan, revisionMessage, kind }, now);
    addMessage(record, 'user', payload.action === 'revise' ? revisionMessage : ({
      update_plan: '调整制作设置，并生成新的待确认版本。', retry: '重新生成内容与制作方案。',
      authorize_new_attempt: '我已确认可能产生重复费用，同意发起一次新的模型请求。',
    })[payload.action], now, attempt.id);
    return true;
  });
  return { success: true, workflow_id: workflowId, workflow: await getView(record, options), startTask: result };
}

async function runWhiteboardWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  let attempt;
  let claimed = false;
  try {
    const started = await mutate(workflowId, options, (record, now) => {
      attempt = record.whiteboard.attempts.find(item => item.id === record.whiteboard.activeAttemptId);
      if (!attempt || record.status !== 'queued' || attempt.status !== 'prepared') throw new WhiteboardError('ACTION_NOT_ALLOWED', '当前任务没有等待执行的白板版本。', 409);
      record.status = 'running';
      attempt.status = 'preparing';
      record.updated_at = now;
      setStage(record, 'content_plan', 'running', record.message, now);
    });
    claimed = true;
    const frozen = started.record;
    const task = {
      schemaVersion: 1, role: attempt.role, contractVersion: CONTRACT_VERSION,
      inputIdentity: attempt.inputIdentity, input: attempt.input, productionPlan: attempt.productionPlan,
      revisionMessage: attempt.revisionMessage, parentIdentity: attempt.parentIdentity,
      narrationService: frozen.whiteboard.narrationService,
      formalWritesAllowed: false, approvalWritesAllowed: false, allowedTools: [],
      allowedOutputs: ['candidate.json'], candidateSkeleton: CANDIDATE_SKELETON, candidateSchema: CANDIDATE_SCHEMA,
    };
    const { result: taskSha256 } = await mutate(workflowId, options, async record => {
      const active = assertActiveAttempt(record, attempt);
      const hash = await artifactStore.writeImmutable(workflowId, attempt.id, 'task.json', task, rootDir);
      active.taskSha256 = hash;
      return hash;
    });
    const previousArtifact = frozen.whiteboard.current ? await artifactStore.readArtifact(frozen, frozen.whiteboard.current, rootDir) : null;
    await options.taskContext?.emit?.({ type: 'stage_started', stage: 'content_plan', progress: 20, message: '正在整理白板内容、分镜和制作方案...' });
    const candidate = attempt.kind === 'settings' ? {
      schemaVersion: 1, title: previousArtifact.title, summary: previousArtifact.summary,
      cues: previousArtifact.cues.map(({ id, text }) => ({ id, text })),
      scenes: previousArtifact.scenes.map(({ id, title, cueIds, imagePrompt }) => ({ id, title, cueIds, imagePrompt })),
    } : await generateDraft(task, {
      services: options.services, previousArtifact,
      onRequest: async repair => {
        await mutate(workflowId, options, (record, now) => {
          const active = assertActiveAttempt(record, attempt);
          active.status = 'requesting';
          active.repairCount = repair;
          active.taskSha256 = taskSha256;
          record.updated_at = now;
        });
        await options.taskContext?.emit?.({ type: 'stage_progress', stage: 'content_plan', progress: repair ? 55 : 30, message: repair ? '正在补正候选方案的结构...' : '正在请求分析模型整理内容与分镜...' });
      },
      onCandidate: ({ repair, candidate, errors }) => mutate(workflowId, options, record => {
        assertActiveAttempt(record, attempt);
        return artifactStore.writeImmutable(workflowId, attempt.id, `candidate-response-${repair}.json`, { candidate, validationErrors: errors }, rootDir);
      }),
    });
    const artifact = materializeCandidate(candidate, attempt.input, attempt.productionPlan, frozen.whiteboard.narrationService);
    const published = await mutate(workflowId, options, async (record, now) => {
      const active = assertActiveAttempt(record, attempt);
      // 与删除共用文件队列；先核验当前版本，再落盘及发布，防止任务删除后重新创建产物。
      const binding = await artifactStore.publishArtifact({ record, attempt, candidate, artifact, taskSha256, rootDir });
      active.status = 'validated';
      active.binding = binding;
      active.completedAt = now;
      record.whiteboard.attempts.filter(item => item.id !== attempt.id && item.binding).forEach(item => { item.stale = true; });
      record.whiteboard.current = binding;
      record.whiteboard.activeAttemptId = '';
      record.status = 'waiting_approval';
      record.success = true;
      record.title = artifact.title;
      record.current_stage = 'initial_approval';
      record.current_progress = 75;
      record.message = '内容、分镜和制作方案已准备好，请检查当前版本后确认。';
      record.current_stage_message = record.message;
      record.updated_at = now;
      setStage(record, 'content_plan', 'done', '当前方案已通过结构与输入校验。', now);
      setStage(record, 'initial_approval', 'waiting_approval', '等待你确认当前内容与制作方案。', now);
      addMessage(record, 'assistant', `第 ${active.number} 版内容与制作方案已整理完成。${artifact.summary}\n请检查方案中的旁白、分镜与制作设置；你可以提出修改意见，或确认当前方案。`, now, attempt.id);
    });
    return { success: true, ...await getView(published.record, options) };
  } catch (error) {
    if (error?.code === 'ENOENT' || (claimed && !await workflowFileExists(workflowId, rootDir))) return { success: false, workflow_id: workflowId, status: 'deleted', message: '创作任务已停止并删除。' };
    const code = error instanceof WhiteboardError ? error.code : 'WHITEBOARD_FAILED';
    const message = error instanceof WhiteboardError ? error.message : '白板方案处理失败，请检查本地存储空间和文件权限后重试。';
    if (attempt && claimed) {
      try {
        await mutate(workflowId, options, (record, now) => {
          if (record.whiteboard.activeAttemptId !== attempt.id) return;
          failAttempt(record, code, message, now);
        });
      } catch { /* 删除或合同不兼容时，不能重新创建或覆盖任务。 */ }
    }
    return { success: false, workflow_id: workflowId, status: code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed', code, message };
  }
}

function failAttempt(record, code, message, now) {
  const attempt = record.whiteboard.attempts.find(item => item.id === record.whiteboard.activeAttemptId);
  const status = code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed';
  if (attempt) Object.assign(attempt, { status, errorCode: code, message, completedAt: now });
  record.whiteboard.activeAttemptId = '';
  record.status = status;
  record.success = false;
  record.message = message;
  record.current_stage_message = message;
  record.error = { code, message };
  record.updated_at = now;
  setStage(record, 'content_plan', 'failed', message, now);
  addMessage(record, 'assistant', message, now, attempt?.id);
}

function recoverInterruptedRecord(record, now) {
  if (!['queued', 'running'].includes(record.status)) return record;
  const attempt = record.whiteboard.attempts.find(item => item.id === record.whiteboard.activeAttemptId);
  const unknown = attempt?.status === 'requesting';
  failAttempt(record, unknown ? 'UNKNOWN_EXTERNAL_OUTCOME' : 'INTERRUPTED', unknown
    ? '服务已重启，上次分析模型请求的结果无法确认。普通重试已暂停，请核实后明确同意新的请求。'
    : '服务已重启，方案任务被中断。可以手动重新生成方案。', now);
  record.active_task_id = '';
  record.active_operation_id = '';
  record.task_status = 'failed';
  return record;
}

module.exports = { assertContract, getView, createWhiteboardWorkflow, actOnWhiteboardWorkflow, runWhiteboardWorkflow, recoverInterruptedRecord };
