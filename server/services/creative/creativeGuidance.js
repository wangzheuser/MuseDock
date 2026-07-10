const defaultAiTextModel = require('../ai/aiTextModel');

const MAX_INPUT_LENGTH = 30000;
const MAX_CUSTOM_ANSWER_LENGTH = 1000;
const MIN_FINAL_PROMPT_LENGTH = 180;
const ALLOWED_SCENARIOS = new Set([
  'news',
  'explainer',
  'tutorial',
  'opinion',
  'product',
  'comparison',
  'story',
  'generic',
]);

const SCENARIO_LABELS = {
  news: '时效资讯',
  explainer: '知识科普',
  tutorial: '教程演示',
  opinion: '观点评论',
  product: '产品推广',
  comparison: '对比评测',
  story: '故事表达',
  generic: '通用创作',
};

const SCENARIO_QUESTIONS = {
  news: ['angle', 'audience', 'tone', 'source_strategy'],
  explainer: ['audience', 'objective', 'angle', 'structure'],
  tutorial: ['audience', 'objective', 'structure', 'tone'],
  opinion: ['audience', 'angle', 'tone', 'structure'],
  product: ['audience', 'objective', 'angle', 'call_to_action'],
  comparison: ['audience', 'angle', 'structure', 'tone'],
  story: ['audience', 'objective', 'tone', 'structure'],
  generic: ['content_type', 'audience', 'objective', 'tone'],
};

/**
 * 创建稳定的引导选项。
 * @param {string} id 选项 ID。
 * @param {string} label 展示文案。
 * @param {string} description 补充说明。
 * @returns {{id:string,label:string,description:string}} 引导选项。
 */
function option(id, label, description = '') {
  return { id, label, description };
}

const QUESTION_CATALOG = {
  content_type: {
    title: '你希望做成哪一类视频？',
    description: '选择最接近的内容形态，后续结构会随之调整。',
    type: 'single',
    options: [
      option('news_flash', '新闻快讯', '快速说明发生了什么和主要影响。'),
      option('deep_analysis', '深度解读', '补充背景、原因和趋势判断。'),
      option('plain_explainer', '科普解释', '用通俗语言讲清一个概念。'),
      option('step_tutorial', '教程演示', '按步骤帮助观众完成具体任务。'),
      option('opinion_commentary', '观点评论', '围绕事实给出明确观点。'),
      option('comparison_review', '对比评测', '比较多个方案、版本或产品。'),
      option('product_intro', '产品介绍', '突出产品价值与使用场景。'),
      option('case_review', '案例复盘', '讲清背景、过程、结果和经验。'),
      option('listicle', '榜单盘点', '以清单形式高密度输出信息。'),
      option('storytelling', '故事化表达', '通过人物、冲突和转折传递信息。'),
    ],
  },
  audience: {
    title: '这条视频主要给谁看？',
    description: '受众会影响术语难度、信息密度和举例方式。',
    type: 'single',
    options: [
      option('general_public', '普通大众', '不假设观众具备专业知识。'),
      option('beginners', '入门新手', '重点解释基础概念和使用门槛。'),
      option('tool_users', '工具使用者', '关注能否使用、怎么使用和实际收益。'),
      option('developers', '开发者', '关注 API、技术能力和集成方式。'),
      option('product_ops', '产品与运营人员', '关注场景、效率和业务价值。'),
      option('content_creators', '内容创作者', '关注选题、生产效率和传播效果。'),
      option('managers', '管理者与决策者', '关注成本、风险和组织影响。'),
      option('students', '学生群体', '表达更轻松，补足必要背景。'),
      option('industry_professionals', '行业从业者', '允许更高的信息密度和专业度。'),
      option('potential_buyers', '潜在购买者', '突出决策依据、收益和限制。'),
      option('existing_users', '现有用户', '重点说明变化和迁移影响。'),
    ],
  },
  objective: {
    title: '你希望观众看完获得什么？',
    description: '选择最重要的结果，避免视频同时追求太多目标。',
    type: 'single',
    options: [
      option('know_event', '快速了解事件', '知道发生了什么以及为什么重要。'),
      option('understand_concept', '真正理解概念', '能用自己的话复述核心原理。'),
      option('complete_action', '完成具体操作', '跟随视频即可完成一项任务。'),
      option('make_decision', '帮助做出选择', '获得清晰的比较和决策依据。'),
      option('gain_methods', '得到实用方法', '带走可以立即执行的建议。'),
      option('change_opinion', '建立新的认知', '理解一个容易忽略的观点。'),
      option('join_discussion', '参与讨论', '愿意表达自己的看法。'),
      option('remember_brand', '记住产品或品牌', '形成明确、可信的价值印象。'),
      option('try_product', '尝试产品', '了解使用收益并产生体验意愿。'),
      option('follow_updates', '关注后续进展', '知道接下来应关注哪些变化。'),
    ],
  },
  angle: {
    title: '你希望重点讲哪些角度？',
    description: '可以选择多个，建议最多选择 3 个重点。',
    type: 'multi',
    maxSelections: 3,
    options: [
      option('what_happened', '发生了什么', '先讲清事件或变化本身。'),
      option('core_highlights', '核心亮点', '提炼最值得关注的变化。'),
      option('general_impact', '对普通人的影响', '说明日常使用会发生什么变化。'),
      option('professional_impact', '对专业用户的影响', '关注工作流、能力和效率。'),
      option('availability', '使用门槛与开放范围', '说明谁能用、何时能用。'),
      option('version_comparison', '与此前版本对比', '突出升级、退步和差异。'),
      option('pricing', '价格与成本', '解释付费方式和投入产出。'),
      option('use_cases', '典型应用场景', '用具体例子说明价值。'),
      option('pros_cons', '优点与不足', '保持客观，不只讲优势。'),
      option('risks', '风险与争议', '说明限制、不确定性和注意事项。'),
      option('industry_impact', '行业影响', '解释对市场和从业者的意义。'),
      option('actionable_advice', '实际使用建议', '给观众明确的下一步。'),
    ],
  },
  tone: {
    title: '你希望视频呈现什么语气？',
    description: '语气会同时影响旁白措辞、节奏和视觉表现。',
    type: 'single',
    options: [
      option('objective_news', '客观新闻', '克制、准确，不使用夸张判断。'),
      option('professional_concise', '专业简洁', '高信息密度，直接进入重点。'),
      option('plain_language', '通俗易懂', '少用术语，多用生活化解释。'),
      option('conversational', '轻松口语', '像朋友交流一样自然。'),
      option('energetic', '强节奏冲击', '短句、快速切换、强调重点。'),
      option('rational', '理性克制', '清晰区分事实、推测和观点。'),
      option('story_driven', '故事感', '通过铺垫、冲突和转折推进。'),
      option('humorous', '幽默有梗', '在不损害准确性的前提下增加趣味。'),
      option('emotional', '情绪共鸣', '强调人物感受和真实体验。'),
      option('sharp_commentary', '犀利评论', '观点鲜明，但要有事实支持。'),
    ],
  },
  structure: {
    title: '你更喜欢哪种内容结构？',
    description: '结构决定观众如何接收和记住信息。',
    type: 'single',
    options: [
      option('conclusion_first', '结论先行', '先给答案，再解释原因。'),
      option('question_answer', '问题—答案', '围绕观众最关心的问题推进。'),
      option('event_change_impact', '事件—变化—影响', '适合新闻和产品更新。'),
      option('problem_solution_result', '痛点—方案—结果', '适合产品和方法介绍。'),
      option('comparison', '对比式', '通过前后或多方案差异强化认知。'),
      option('list', '清单式', '按 3～5 个要点快速展开。'),
      option('timeline', '时间线', '按时间顺序说明过程和变化。'),
      option('story', '故事式', '通过人物和事件推动内容。'),
      option('step_by_step', '步骤式', '一步一步完成目标。'),
      option('myth_fact', '误区—事实', '先指出常见误解，再给出证据。'),
    ],
  },
  source_strategy: {
    title: '资料和事实应该如何处理？',
    description: '时效内容建议优先核验官方来源。',
    type: 'single',
    options: [
      option('official_first', '官方来源优先', '优先公告、文档和产品页面。'),
      option('multiple_sources', '多来源交叉核验', '官方资料与可靠媒体相互印证。'),
      option('provided_only', '只使用我提供的资料', '不扩展用户未提供的信息。'),
      option('latest_web', '优先最新公开资料', '关注新近变化和发布时间。'),
      option('balanced', '兼顾官方与行业观点', '事实与实际反馈分开呈现。'),
      option('data_first', '数据和原始证据优先', '优先报告、数据集和原始记录。'),
      option('clearly_uncertain', '明确标注不确定信息', '无法确认时不写成确定事实。'),
      option('no_research', '不联网补充', '只围绕当前输入进行创作。'),
    ],
  },
  call_to_action: {
    title: '视频结尾希望观众做什么？',
    description: '不需要行动引导时可以直接选择“自然收束”。',
    type: 'single',
    options: [
      option('none', '自然收束', '只总结结论，不做营销引导。'),
      option('follow', '引导关注', '提醒观众关注后续内容。'),
      option('comment', '引导评论', '提出一个具体、容易回答的问题。'),
      option('save', '引导收藏', '强调内容后续可复查的价值。'),
      option('share', '引导转发', '说明哪些人可能需要这条内容。'),
      option('view_source', '查看完整资料', '引导观众阅读来源或长文。'),
      option('try_product', '体验产品', '给出清晰但不过度推销的行动。'),
      option('visit_link', '访问链接', '引导进入指定页面了解详情。'),
      option('download', '下载或安装', '明确下一步操作和适用对象。'),
      option('join_discussion', '参与讨论', '邀请观众补充案例和观点。'),
    ],
  },
};

/**
 * 将任意值转成去首尾空白的字符串。
 * @param {unknown} value 输入值。
 * @returns {string} 安全文本。
 */
function safeString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * 把时长限制在创作入口允许的范围内。
 * @param {unknown} value 时长值。
 * @param {number} fallback 回退值。
 * @returns {number} 15～180 秒整数。
 */
function normalizeDuration(value, fallback = 45) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(180, Math.max(15, Math.round(number)))
    : fallback;
}

/**
 * 判断输入是否具有明显时效性。
 * @param {string} input 用户输入。
 * @returns {boolean} 是否需要优先核验最新事实。
 */
function detectTemporalRisk(input) {
  return /今天|今日|刚刚|最新|正式发布|宣布|上线|突发|本周|昨日|目前|现已|release|launch|breaking/i.test(input);
}

/**
 * 在模型不可用或结果异常时提供稳定场景判断。
 * @param {string} input 用户输入。
 * @returns {string} 场景 ID。
 */
function detectScenario(input) {
  if (detectTemporalRisk(input) || /新闻|消息|发布会|更新了|官宣/i.test(input)) return 'news';
  if (/教程|步骤|怎么做|如何|实操|演示/i.test(input)) return 'tutorial';
  if (/对比|评测|区别|哪个好|\bvs\b/i.test(input)) return 'comparison';
  if (/产品|商品|品牌|推广|营销|卖点|转化/i.test(input)) return 'product';
  if (/观点|评论|怎么看|争议|反驳|为什么说/i.test(input)) return 'opinion';
  if (/科普|解释|是什么|原理|讲清楚|知识/i.test(input)) return 'explainer';
  if (/故事|经历|人物|成长|复盘/i.test(input)) return 'story';
  return 'generic';
}

/**
 * 解析模型返回的 JSON，兼容 Markdown 代码块。
 * @param {string} text 模型文本。
 * @returns {object|null} JSON 对象。
 */
function parseModelJson(text) {
  const source = safeString(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(source.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 调用文本模型并要求返回 JSON；首次格式异常时只修复一次。
 * @param {object} model 文本模型服务。
 * @param {Array<object>} messages 消息列表。
 * @returns {Promise<object>} 结构化调用结果。
 */
async function callStructuredModel(model, messages) {
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, message: '分析模型服务不可用，请先检查模型配置。' };
  }
  const first = await model.callTextModel({
    messages,
    temperature: 0.25,
    maxRetries: 1,
    response_format: { type: 'json_object' },
  });
  if (!first || first.success === false) {
    return { success: false, message: first?.message || '分析模型调用失败。' };
  }
  const parsed = parseModelJson(first.text || first.content || '');
  if (parsed) return { success: true, value: parsed, model: first.model || {}, usage: first.usage || {} };

  const repair = await model.callTextModel({
    messages: [
      { role: 'system', content: '你只负责把已有内容修复成严格 JSON，不增加新事实。只返回 JSON 对象。' },
      { role: 'user', content: safeString(first.text || first.content) },
    ],
    temperature: 0,
    maxRetries: 1,
    response_format: { type: 'json_object' },
  });
  if (!repair || repair.success === false) {
    return { success: false, message: repair?.message || '模型结果格式修复失败。' };
  }
  const repaired = parseModelJson(repair.text || repair.content || '');
  return repaired
    ? { success: true, value: repaired, model: repair.model || first.model || {}, usage: repair.usage || {} }
    : { success: false, message: '分析模型未返回有效的 JSON 结果。' };
}

/**
 * 规范化模型提供的主题专属选项。
 * @param {unknown} value 原始选项。
 * @param {Array<object>} catalogOptions 固定选项。
 * @returns {Array<object>} 最多三个专属选项。
 */
function normalizeContextualOptions(value, catalogOptions) {
  const existingLabels = new Set(catalogOptions.map(item => item.label));
  return (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      id: `context_${index + 1}`,
      label: safeString(item?.label).slice(0, 30),
      description: safeString(item?.description).slice(0, 100),
      recommended: item?.recommended === true,
    }))
    .filter(item => item.label && !existingLabels.has(item.label))
    .slice(0, 3);
}

/**
 * 提取选项或说明中明确表达的整体视频时长。
 * @param {string} value 文本。
 * @returns {number} 秒数；未表达时返回 0。
 */
function extractOverallDuration(value) {
  const text = safeString(value);
  const seconds = text.match(/(?:约|按|时长(?:为|：|:)?)[^\d]{0,4}(\d{1,3})\s*秒/);
  if (seconds) return Number(seconds[1]);
  const minutes = text.match(/(\d{1,2})\s*分钟/);
  if (minutes) return Number(minutes[1]) * 60;
  if (/一\s*分钟/.test(text)) return 60;
  return 0;
}

/**
 * 删除与最终推荐时长冲突的模型专属选项，并保证仍有推荐项。
 * @param {object} question 引导问题。
 * @param {number} durationSec 推荐时长。
 * @returns {object} 时长一致的问题。
 */
function alignQuestionOptionsWithDuration(question, durationSec) {
  const options = (Array.isArray(question?.options) ? question.options : []).filter(item => {
    if (!safeString(item?.id).startsWith('context_')) return true;
    const optionDuration = extractOverallDuration(`${item.label} ${item.description}`);
    return !optionDuration || optionDuration === durationSec;
  });
  if (options.length > 0 && !options.some(item => item.recommended === true)) {
    options[0] = { ...options[0], recommended: true };
  }
  return { ...question, options };
}

/**
 * 修正摘要中由旧默认设置带入的整体时长。
 * @param {string} value 摘要文本。
 * @param {number} durationSec 推荐时长。
 * @returns {string} 时长一致的摘要。
 */
function alignSummaryDuration(value, durationSec) {
  return safeString(value)
    .replace(/约\s*\d{1,3}\s*秒/g, `约 ${durationSec} 秒`)
    .replace(/时长(?:为|：|:)?\s*\d{1,3}\s*秒/g, `时长 ${durationSec} 秒`);
}

/**
 * 创建前端可直接渲染的稳定问题。
 * @param {string} questionId 问题 ID。
 * @param {object} modelAnalysis 模型分析结果。
 * @returns {object|null} 问题对象。
 */
function buildQuestion(questionId, modelAnalysis) {
  const catalog = QUESTION_CATALOG[questionId];
  if (!catalog) return null;
  const recommendedValue = modelAnalysis?.recommended_answers?.[questionId];
  const recommendedIds = new Set(
    (Array.isArray(recommendedValue) ? recommendedValue : [recommendedValue]).map(safeString).filter(Boolean),
  );
  const contextual = normalizeContextualOptions(
    modelAnalysis?.contextual_options?.[questionId],
    catalog.options,
  );
  const options = [...contextual, ...catalog.options].map((item, index) => ({
    ...item,
    recommended: item.recommended === true
      || recommendedIds.has(item.id)
      || (recommendedIds.size === 0 && index === 0),
  }));
  return {
    id: questionId,
    title: catalog.title,
    description: catalog.description,
    type: catalog.type,
    required: false,
    max_selections: catalog.type === 'multi' ? Number(catalog.maxSelections) || 3 : 1,
    allow_custom: true,
    allow_ai_decide: true,
    allow_skip: true,
    options,
  };
}

/**
 * 规范化分析结果并合并固定选项库。
 * @param {object} modelAnalysis 模型结果。
 * @param {string} input 用户输入。
 * @param {object} creativeSettings 当前创作设置。
 * @returns {object} 稳定分析结果。
 */
function normalizeAnalysis(modelAnalysis, input, creativeSettings = {}) {
  const detectedScenario = detectScenario(input);
  const scenario = ALLOWED_SCENARIOS.has(safeString(modelAnalysis?.scenario))
    ? safeString(modelAnalysis.scenario)
    : detectedScenario;
  const questionIds = (Array.isArray(modelAnalysis?.question_ids) ? modelAnalysis.question_ids : [])
    .map(safeString)
    .filter(id => QUESTION_CATALOG[id]);
  const selectedQuestionIds = [...new Set(questionIds.length ? questionIds : SCENARIO_QUESTIONS[scenario])];
  // 模型只返回一个问题时补足一个场景问题，维持低门槛同时避免方案信息不足。
  if (selectedQuestionIds.length < 2) {
    for (const questionId of SCENARIO_QUESTIONS[scenario]) {
      if (!selectedQuestionIds.includes(questionId)) selectedQuestionIds.push(questionId);
      if (selectedQuestionIds.length >= 2) break;
    }
  }
  const temporalRisk = modelAnalysis?.temporal_risk === true || detectTemporalRisk(input);
  const modelInformationLevel = safeString(modelAnalysis?.information_level);
  const informationLevel = input.length < 40
    ? 'sparse'
    : (['sparse', 'adequate', 'complete'].includes(modelInformationLevel)
      ? modelInformationLevel
      : (input.length < 80 ? 'sparse' : input.length < 500 ? 'adequate' : 'complete'));
  const fallbackDuration = input.length < 80 ? (scenario === 'news' ? 30 : 45) : 60;
  const settingsDuration = normalizeDuration(creativeSettings.targetDurationSec, fallbackDuration);
  const modelDuration = normalizeDuration(modelAnalysis?.recommended_duration_sec, Math.min(settingsDuration, fallbackDuration));
  // 信息稀疏时先缩短视频，避免模型为了满足旧默认时长重复表达或填充空话。
  const recommendedDuration = informationLevel === 'sparse'
    ? Math.min(modelDuration, scenario === 'news' ? 30 : 45)
    : modelDuration;
  const warnings = (Array.isArray(modelAnalysis?.warnings) ? modelAnalysis.warnings : [])
    .map(safeString)
    .filter(Boolean)
    .slice(0, 4);
  if (temporalRisk && !warnings.some(item => /核验|时效|来源/.test(item))) {
    warnings.unshift('内容具有较强时效性，正式生成时应优先核验官方来源。');
  }
  const rawSummary = safeString(modelAnalysis?.summary)
    || `${SCENARIO_LABELS[scenario]}，${input.length < 80 ? '当前信息较少，建议通过引导补充创作意图。' : '当前内容可进一步明确受众和表达重点。'}`;
  return {
    scenario,
    scenario_label: SCENARIO_LABELS[scenario],
    summary: alignSummaryDuration(rawSummary, recommendedDuration),
    information_level: informationLevel,
    temporal_risk: temporalRisk,
    recommended_duration_sec: recommendedDuration,
    warnings,
    questions: selectedQuestionIds.slice(0, 4)
      .map(id => buildQuestion(id, modelAnalysis))
      .filter(Boolean)
      .map(question => alignQuestionOptionsWithDuration(question, recommendedDuration)),
  };
}

/**
 * 校验创作引导输入。
 * @param {unknown} value 输入值。
 * @returns {{success:boolean,input?:string,message?:string}} 校验结果。
 */
function validateGuidanceInput(value) {
  const input = safeString(value);
  if (!input) return { success: false, message: '请先输入视频主题、文章、脚本或链接。' };
  if (input.length > MAX_INPUT_LENGTH) {
    return { success: false, message: `创作引导内容过长，请控制在 ${MAX_INPUT_LENGTH} 个字符以内。` };
  }
  return { success: true, input };
}

/**
 * 分析原始创作想法并返回少量高价值问题。
 * @param {object} payload 请求数据。
 * @param {object} options 依赖覆盖项。
 * @returns {Promise<object>} 引导分析结果。
 */
async function analyzeCreativeGuidance(payload = {}, options = {}) {
  const validation = validateGuidanceInput(payload.input);
  if (!validation.success) return { success: false, code: 'INVALID_INPUT', message: validation.message };
  const input = validation.input;
  const creativeSettings = payload.creativeSettings && typeof payload.creativeSettings === 'object'
    ? payload.creativeSettings
    : {};
  const model = options.aiTextModel || defaultAiTextModel;
  const result = await callStructuredModel(model, [
    {
      role: 'system',
      content: [
        '你是短视频创作入口的需求分析编辑。',
        '你的任务不是写脚本，而是识别内容场景并挑选最多 4 个最值得询问的问题。',
        '不要把用户尚未证实的说法当成事实。',
        '只返回 JSON，字段：scenario、summary、information_level、temporal_risk、recommended_duration_sec、question_ids、recommended_answers、contextual_options、warnings。',
        'scenario 只能是 news、explainer、tutorial、opinion、product、comparison、story、generic。',
        `question_ids 只能从 ${Object.keys(QUESTION_CATALOG).join('、')} 中选择。`,
        'contextual_options 只为确实有主题价值的问题补充 1～3 个中文选项，每项含 label、description、recommended，不要重复通用选项。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({ input, creative_settings: creativeSettings }),
    },
  ]);
  if (!result.success) {
    return { success: false, code: 'TEXT_MODEL_UNAVAILABLE', message: result.message || '创作方案分析失败。' };
  }
  return {
    success: true,
    analysis: normalizeAnalysis(result.value, input, creativeSettings),
    model: result.model || {},
    usage: result.usage || {},
  };
}

/**
 * 将回答中的选项 ID 转成模型可读文本。
 * @param {object} analysis 已规范化分析结果。
 * @param {object} answers 用户回答。
 * @returns {Array<object>} 回答摘要。
 */
function normalizeAnswers(analysis, answers = {}) {
  const answerSource = answers && typeof answers === 'object' ? answers : {};
  return (Array.isArray(analysis?.questions) ? analysis.questions : []).map(question => {
    const rawAnswer = answerSource[question.id] && typeof answerSource[question.id] === 'object'
      ? answerSource[question.id]
      : {};
    const selected = (Array.isArray(rawAnswer.selected) ? rawAnswer.selected : [])
      .map(safeString)
      .filter(Boolean)
      .slice(0, question.max_selections || 1);
    const labels = selected.map(id => {
      if (id === '__ai_decide__') return '交给 AI 决定';
      return question.options?.find(item => item.id === id)?.label || '';
    }).filter(Boolean);
    const custom = safeString(rawAnswer.custom).slice(0, MAX_CUSTOM_ANSWER_LENGTH);
    return {
      id: question.id,
      question: question.title,
      selected: labels,
      custom,
      skipped: labels.length === 0 && !custom,
    };
  });
}

/**
 * 规范化前端传回的分析对象，避免把任意结构直接放入模型消息。
 * @param {object} value 分析对象。
 * @param {string} input 原始输入。
 * @param {object} settings 创作设置。
 * @returns {object} 规范化分析。
 */
function normalizeIncomingAnalysis(value, input, settings) {
  const source = value && typeof value === 'object' ? value : {};
  const scenario = ALLOWED_SCENARIOS.has(safeString(source.scenario)) ? safeString(source.scenario) : detectScenario(input);
  const sourceQuestions = Array.isArray(source.questions) ? source.questions : [];
  const questionIds = sourceQuestions
    .map(item => safeString(item?.id))
    .filter(id => QUESTION_CATALOG[id]);
  const normalized = normalizeAnalysis({
    scenario,
    summary: safeString(source.summary),
    information_level: safeString(source.information_level),
    temporal_risk: source.temporal_risk === true,
    recommended_duration_sec: source.recommended_duration_sec,
    question_ids: questionIds,
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
  }, input, settings);
  normalized.questions = normalized.questions.map(question => {
    const incoming = sourceQuestions.find(item => safeString(item?.id) === question.id);
    const contextualOptions = (Array.isArray(incoming?.options) ? incoming.options : [])
      .filter(item => /^context_\d+$/.test(safeString(item?.id)))
      .map(item => ({
        id: safeString(item.id),
        label: safeString(item.label).slice(0, 30),
        description: safeString(item.description).slice(0, 100),
        recommended: item?.recommended === true,
      }))
      .filter(item => item.label)
      .slice(0, 3);
    const contextualLabels = new Set(contextualOptions.map(item => item.label));
    return {
      ...question,
      options: [
        ...contextualOptions,
        ...question.options.filter(item => !contextualLabels.has(item.label)),
      ],
    };
  });
  return normalized;
}

/**
 * 确保高时效主题始终带有明确的事实核验约束。
 * @param {string} prompt 模型生成的提示词。
 * @param {boolean} temporalRisk 是否为高时效主题。
 * @returns {string} 补齐约束后的提示词。
 */
function ensureFactCheckingGuard(prompt, temporalRisk) {
  const text = safeString(prompt);
  if (!temporalRisk || (/核验/.test(text) && /官方|来源/.test(text) && /不得|未确认|无法确认/.test(text))) {
    return text;
  }
  return `${text}\n\n事实核验要求：\n- 正式创作前先联网核验相关说法，优先使用官方公告、官方文档和原始资料。\n- 如果无法找到可靠依据，不得把未经确认的信息写成确定事实，应明确说明尚未确认。`;
}

/**
 * 让最终提示词中的时长与引导推荐保持一致。
 * @param {string} prompt 模型生成提示词。
 * @param {number} durationSec 推荐时长。
 * @returns {string} 带明确时长约束的提示词。
 */
function ensureDurationInstruction(prompt, durationSec) {
  const duration = normalizeDuration(durationSec, 45);
  const durationPattern = new RegExp(`${duration}\\s*秒`);
  let text = safeString(prompt)
    .replace(/约\s*\d{1,3}\s*秒/g, `约 ${duration} 秒`)
    .replace(/目标(?:成片)?时长(?:为|：|:)?\s*\d{1,3}\s*秒/g, `目标成片时长：${duration} 秒`);
  if (!durationPattern.test(text)) {
    text = `${text}\n\n成片节奏与时长：\n- 目标成片约 ${duration} 秒，按有效信息量规划旁白和场景；资料不足时优先减少内容，不得使用重复表达或空话填充时长。`;
  }
  return text;
}

/**
 * 判断说明文本是否仍引用了与推荐值冲突的整体时长。
 * @param {string} value 说明文本。
 * @param {number} durationSec 推荐时长。
 * @returns {boolean} 是否冲突。
 */
function hasConflictingOverallDuration(value, durationSec) {
  const extracted = extractOverallDuration(value);
  return extracted > 0 && extracted !== durationSec;
}

/**
 * 生成供联网研究使用的短查询，避免把整篇创作提示词直接交给搜索引擎。
 * @param {unknown} value 模型建议查询。
 * @param {string} originalInput 初始输入。
 * @returns {string} 单行短查询。
 */
function normalizeResearchQuery(value, originalInput) {
  const modelQuery = safeString(value).replace(/\s+/g, ' ');
  if (modelQuery) return modelQuery.slice(0, 240);
  return safeString(originalInput).replace(/\s+/g, ' ').slice(0, 240);
}

/**
 * 清洗模型返回的创作方案字段。
 * @param {object} value 模型 JSON。
 * @param {object} analysis 引导分析。
 * @returns {object} 可返回前端的创作方案。
 */
function normalizeComposition(value, analysis, creativeSettings = {}, originalInput = '') {
  const modelOverrides = value?.recommended_overrides && typeof value.recommended_overrides === 'object'
    ? value.recommended_overrides
    : {};
  const modelDuration = normalizeDuration(
    modelOverrides.targetDurationSec ?? modelOverrides.target_duration_sec,
    analysis.recommended_duration_sec,
  );
  const recommendedOverrides = {
    targetDurationSec: analysis.information_level === 'sparse'
      ? Math.min(modelDuration, analysis.recommended_duration_sec)
      : modelDuration,
    useResearch: analysis.temporal_risk === true
      ? true
      : (typeof modelOverrides.useResearch === 'boolean'
        ? modelOverrides.useResearch
        : creativeSettings.useResearch !== false),
  };
  const finalPrompt = ensureDurationInstruction(ensureFactCheckingGuard(
    safeString(value?.final_prompt || value?.finalPrompt).replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, ''),
    analysis.temporal_risk === true,
  ), recommendedOverrides.targetDurationSec);
  return {
    final_prompt: finalPrompt,
    research_query: normalizeResearchQuery(value?.research_query || value?.researchQuery, originalInput),
    summary: value?.summary && typeof value.summary === 'object' ? value.summary : {},
    recommended_overrides: recommendedOverrides,
    assumptions: (Array.isArray(value?.assumptions) ? value.assumptions : [])
      .map(safeString)
      .filter(item => item && !hasConflictingOverallDuration(item, recommendedOverrides.targetDurationSec))
      .slice(0, 6),
    warnings: (Array.isArray(value?.warnings) ? value.warnings : [])
      .map(safeString)
      .filter(item => item && !hasConflictingOverallDuration(item, recommendedOverrides.targetDurationSec))
      .slice(0, 6),
  };
}

/**
 * 根据原始输入和引导回答生成可回填、可编辑的完整提示词。
 * @param {object} payload 请求数据。
 * @param {object} options 依赖覆盖项。
 * @returns {Promise<object>} 完整创作提示词。
 */
async function composeCreativeGuidance(payload = {}, options = {}) {
  const validation = validateGuidanceInput(payload.input || payload.originalInput);
  if (!validation.success) return { success: false, code: 'INVALID_INPUT', message: validation.message };
  const input = validation.input;
  const creativeSettings = payload.creativeSettings && typeof payload.creativeSettings === 'object'
    ? payload.creativeSettings
    : {};
  const analysis = normalizeIncomingAnalysis(payload.analysis, input, creativeSettings);
  const answers = normalizeAnswers(analysis, payload.answers);
  const model = options.aiTextModel || defaultAiTextModel;
  const result = await callStructuredModel(model, [
    {
      role: 'system',
      content: [
        '你是资深短视频总编，负责把用户的初始想法和引导回答整理成最终创作提示词。',
        '最终提示词会完整展示给用户并允许编辑，因此必须使用清晰、自然、可读的简体中文。',
        '不要直接生成成片脚本，不要输出 JSON 以外的内容，不要使用 Markdown 代码围栏。',
        '只返回 JSON：final_prompt、research_query、summary、recommended_overrides、assumptions、warnings。',
        'final_prompt 必须自包含，建议包含主题、目标受众、创作目标、资料与事实要求、内容结构、表达方式、视觉方向和结尾要求。',
        '保留用户提供的 URL、专有名词和关键约束；不要发明精确事实、参数、价格、日期或官方结论。',
        '遇到今天、最新、发布等时效表述，必须要求联网核验官方来源；找不到依据时不得写成确定事实。',
        '时长和画幅用于规划节奏，但不要把音色、并发数等纯技术配置混入内容提示词。',
        '模板 ID 只用于理解视觉风格，不要把内部模板 ID 原样写进 final_prompt。',
        'research_query 必须是一条不超过 120 个字符的单行检索词，只保留主题、主体和官方来源限定，不要包含视频制作要求。',
        'recommended_overrides 只允许 targetDurationSec 和 useResearch。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        original_input: input,
        analysis: {
          scenario: analysis.scenario,
          scenario_label: analysis.scenario_label,
          summary: analysis.summary,
          temporal_risk: analysis.temporal_risk,
          recommended_duration_sec: analysis.recommended_duration_sec,
          warnings: analysis.warnings,
        },
        answers,
        creative_settings: {
          aspect_ratio: safeString(creativeSettings.aspectRatio),
          target_duration_sec: analysis.recommended_duration_sec,
          current_target_duration_sec: normalizeDuration(creativeSettings.targetDurationSec, analysis.recommended_duration_sec),
          use_research: creativeSettings.useResearch !== false,
          template_id: safeString(creativeSettings.templateId),
        },
      }),
    },
  ]);
  if (!result.success) {
    return { success: false, code: 'TEXT_MODEL_UNAVAILABLE', message: result.message || '生成创作提示词失败。' };
  }
  const composition = normalizeComposition(result.value, analysis, creativeSettings, input);
  if (composition.final_prompt.length < MIN_FINAL_PROMPT_LENGTH) {
    return {
      success: false,
      code: 'GUIDANCE_PROMPT_TOO_SHORT',
      message: '模型生成的创作提示词过短，请重新生成或补充更多创作要求。',
    };
  }
  return {
    success: true,
    ...composition,
    analysis: {
      scenario: analysis.scenario,
      scenario_label: analysis.scenario_label,
      temporal_risk: analysis.temporal_risk,
      recommended_duration_sec: analysis.recommended_duration_sec,
    },
    model: result.model || {},
    usage: result.usage || {},
  };
}

module.exports = {
  QUESTION_CATALOG,
  analyzeCreativeGuidance,
  composeCreativeGuidance,
  detectScenario,
  detectTemporalRisk,
  normalizeAnalysis,
  normalizeAnswers,
  parseModelJson,
};
