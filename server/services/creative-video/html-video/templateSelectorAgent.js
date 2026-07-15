const { parseJsonOnlyResponse } = require('./templateInputAgent');

function stringify(value) {
  return JSON.stringify(value || {}, null, 2);
}

function fail(userMessage, diagnostics = []) {
  return {
    success: false,
    user_message: userMessage,
    message: userMessage,
    fallback_allowed: true,
    diagnostics: diagnostics.length ? diagnostics : [userMessage],
  };
}

function normalizeIndex(compactIndex = []) {
  return Array.isArray(compactIndex) ? compactIndex : [];
}

/**
 * 只保留模板选择所需字段，避免模板库扩充后把输入 schema 和授权明细重复送入模型。
 * @param {object} template 注册表中的紧凑模板。
 * @returns {object} 模板选择摘要。
 */
function compactTemplateForSelection(template = {}) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    best_for: template.best_for,
    not_for: template.not_for,
    scene_roles: template.scene_roles,
    visual_family: template.visual_family,
    evidence_policy: template.evidence_policy,
    supported_aspects: template.supported_aspects,
    duration_range_sec: template.output?.duration_range_sec,
  };
}

/**
 * 构建模板选择提示词，让模型依据内容任务而不是关键词表面相似度选型。
 * @param {object} options 选择上下文。
 * @returns {string} 仅允许返回 JSON 的选择提示词。
 */
function buildTemplateSelectionPrompt({ sceneSpec, compactIndex, target } = {}) {
  return [
    '你是 html-video 模板选择助手。',
    '只返回 JSON，不要输出 Markdown、解释、注释或代码块。',
    '不要输出 HTML、CSS、JavaScript、完整页面、index.html、hyperframes.json、package.json 或 files 数组。',
    '你只能从可用模板列表中选择一个 template_id。',
    '返回格式必须严格是：',
    '{ "template_id": "frame-glitch-title", "reason": "内容偏科技感和冲突感，适合故障风标题模板", "confidence": 0.86 }',
    'confidence 必须是 0 到 1 的数字。',
    '模板将作为整条视频的视觉系统，而不是只服务第一帧；优先选择能覆盖多数 scene_roles 的模板。',
    '选择时依次匹配内容任务、scene_roles、信息密度、情绪、宽高比和目标时长，不要只按“科技”“新闻”等表面关键词选择。',
    'best_for 是正向适配条件；命中 not_for 时原则上不要选择，除非列表中没有更合适的模板。',
    '带 evidence_policy 的数据模板只有在 scene_spec 明确提供对应数字或来源时才能选择，禁止为了视觉冲击选择并补造数字。',
    '解读或讨论内容不要求使用新闻模板；应根据观众最终获得的是解释框架、步骤、对比、观点还是故事来选择。',
    'scene_spec：',
    stringify(sceneSpec),
    'target：',
    stringify(target),
    '可用模板 compactIndex：',
    stringify(normalizeIndex(compactIndex).map(compactTemplateForSelection)),
  ].join('\n');
}

function parseTemplateSelectionResponse(responseText, { compactIndex = [], allowedTemplateIds } = {}) {
  const parsed = parseJsonOnlyResponse(responseText);
  if (!parsed.success) {
    return fail(parsed.user_message || '模板选择返回不是有效 JSON。', parsed.diagnostics || []);
  }

  const data = parsed.data;
  const templateId = typeof data.template_id === 'string' ? data.template_id.trim() : '';
  if (!templateId) {
    return fail('模板选择失败：AI 未返回 template_id。', ['missing_template_id']);
  }

  const availableIds = normalizeIndex(compactIndex).map(item => item && item.id).filter(Boolean);
  if (availableIds.length && !availableIds.includes(templateId)) {
    return fail(`模板选择失败：AI 返回了不存在的 template_id：${templateId}。`, [`unknown_template_id:${templateId}`]);
  }

  if (Array.isArray(allowedTemplateIds) && allowedTemplateIds.length && !allowedTemplateIds.includes(templateId)) {
    return fail(`模板选择失败：template_id ${templateId} 不在本次允许的模板范围内。`, [`filtered_template_id:${templateId}`]);
  }

  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return fail('模板选择失败：confidence 必须是 0 到 1 的数字。', ['invalid_confidence']);
  }

  return {
    success: true,
    template_id: templateId,
    reason: typeof data.reason === 'string' ? data.reason : '',
    confidence,
    raw: data,
  };
}

module.exports = {
  buildTemplateSelectionPrompt,
  parseTemplateSelectionResponse,
};
