const MAX_JSON_CHARS = 12000;
const {
  buildEditorialPlan,
  validateEditorialPlan,
} = require('../creative/pipeline/editorialPlan');

function stripCodeFence(text = '') {
  let value = String(text || '').trim();
  value = value.replace(/^```\s*(?:json)?\s*/i, '');
  value = value.replace(/\s*```$/i, '');
  return value.trim();
}

function safeJson(value, maxChars = MAX_JSON_CHARS) {
  const json = JSON.stringify(value || {}, null, 2);
  if (json.length <= maxChars) return json;

  const previewLimit = Math.max(200, maxChars - 2000);
  return JSON.stringify({
    truncated: true,
    original_length: json.length,
    preview: json.slice(0, previewLimit),
  }, null, 2);
}

function getOptionSummary(options = {}) {
  return {
    target_duration_sec: Number(options.targetDurationSec || options.target_duration_sec || 0) || '',
    aspect_ratio: options.aspectRatio || options.aspect_ratio || '',
    style_prompt: options.stylePrompt || options.style_prompt || '',
    content_mode: options.contentMode || options.content_mode || 'analysis',
  };
}

/**
 * 提取导演简报需要的联网研究资料。
 */
function getResearchSummary(options = {}) {
  const research = options?.creative_context?.research_context;
  if (!research || typeof research !== 'object' || Array.isArray(research)) return null;
  const hasEvidencePack = Number(options?.creative_context?.evidence_pack?.version) === 2;
  return {
    status: research.status || '',
    query: research.query || '',
    updated_at: research.updated_at || '',
    summary: String(research.summary || '').slice(0, 1000),
    coverage: research.coverage || {},
    sources: (Array.isArray(research.sources) ? research.sources : []).slice(0, 5).map(source => ({
      title: source?.title || '',
      url: source?.url || '',
      published_at: source?.published_at || '',
      summary: hasEvidencePack ? '' : String(source?.summary || '').slice(0, 600),
      evidence: source?.evidence || '',
      discovery_channel: source?.discovery_channel || '',
      source_type: source?.source_type || '',
    })),
  };
}

/**
 * 精简 Evidence Pack，只把导演决策需要的 Claim 和来源索引传给模型。
 * @param {object} options 创作选项。
 * @returns {object|null} 精简证据包。
 */
function getEvidenceSummary(options = {}) {
  const pack = options?.creative_context?.evidence_pack;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return null;
  return {
    version: pack.version,
    sources: (Array.isArray(pack.sources) ? pack.sources : []).map(source => ({
      id: source?.id || '',
      title: source?.title || '',
      url: source?.url || '',
      source_type: source?.source_type || source?.type || '',
      published_at: source?.published_at || '',
    })),
    claims: (Array.isArray(pack.claims) ? pack.claims : []).map(claim => ({
      id: claim?.id || '',
      requirement_ids: claim?.requirement_ids || [],
      text: String(claim?.text || '').slice(0, 1200),
      status: claim?.status || '',
      source_ids: claim?.source_ids || [],
    })),
    coverage: {
      status: pack.coverage?.status || '',
      ready: pack.coverage?.ready === true,
      missing_critical_requirement_ids: pack.coverage?.missing_critical_requirement_ids || [],
    },
  };
}

/**
 * 精简运行记录，避免把生成状态和空产物重复发给导演模型。
 */
function getRunSummary(run = {}) {
  const result = run?.result || {};
  return {
    input_summary: run?.input_summary || {},
    result: {
      summary: result.summary || '',
      rewrite_script: result.rewrite_script || '',
      video_brief: result.video_brief || {},
    },
  };
}

/**
 * 按 4~8 秒一个有效场景给出节奏范围，不强制模型凑固定场景数。
 */
function getRecommendedSceneRange(targetDurationSec) {
  const duration = Number(targetDurationSec) || 60;
  return {
    min: Math.max(3, Math.min(8, Math.ceil(duration / 8))),
    max: Math.max(3, Math.min(12, Math.ceil(duration / 4))),
  };
}

function buildFreeformBriefMessages({ run = {}, skillContext = '', options = {} } = {}) {
  const optionSummary = getOptionSummary(options);
  const researchSummary = getResearchSummary(options);
  const creativeContract = options?.creative_context?.creative_contract || null;
  const evidencePack = getEvidenceSummary(options);
  const narrationCharBudget = Math.floor(Number(optionSummary.target_duration_sec || 60) * 5);
  const recommendedSceneRange = getRecommendedSceneRange(optionSummary.target_duration_sec);
  return [
    {
      role: 'system',
      content: [
        '你是 HyperFrames 导演简报 Agent。',
        '你的任务是把已有口播、分镜和用户风格要求整理成可执行的视频工程创作简报。',
        '只能返回 JSON 对象，不要返回 Markdown、代码块或解释文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请根据以下资料生成 HyperFrames 导演简报。',
        '',
        '目标参数：',
        safeJson(optionSummary),
        '',
        '风格要求：',
        optionSummary.style_prompt || '未指定',
        '',
        '联网研究素材：',
        researchSummary ? safeJson(researchSummary, 5000) : '未提供',
        '',
        'Creative Contract（必须逐项覆盖）：',
        creativeContract ? safeJson(creativeContract, 9000) : '未提供',
        '',
        'Evidence Pack（事实唯一来源）：',
        evidencePack ? safeJson(evidencePack, 8000) : '未提供',
        '',
        '技能上下文：',
        String(skillContext || '未提供').slice(0, 6000),
        '',
        '运行摘要：',
        safeJson(getRunSummary(run), 6000),
        '',
        '输出要求：',
        '1. 只返回 JSON 对象。',
        '2. title 用中文概括短片主题。',
        '3. summary 说明成片表达目标。',
        '4. narration 不要输出完整口播，只写 120 字以内的口播结构摘要。',
        '5. storyboard 给出关键场景规划；storyboard.scenes[].narration_text 承载实际配音文本。',
        '6. storyboard.scenes[].visual_text 承载画面文字素材：keywords 是 3~5 个画面关键词；cards 是 2~4 条提炼后的要点短语或数据点，每条 4~16 个汉字。keywords/cards 禁止照抄 narration_text 原句，也不要写成完整长句；旁白全文会由系统作为底部字幕注入，画面文字只放提炼后的短文案。',
        '7. audio_direction 给出高级成片音频导演建议，必须包含 voice 和 style_prompt；style_prompt 可描述情绪、口吻、语速、停顿、吸气、笑声或哭腔，例如紧张、深呼吸、语速加快、沉默片刻、长叹一口气。',
        '8. storyboard.scenes[].narration_text 和 captions.text 只能包含观众可见、可朗读的正文；吸气、停顿、语速等表演指令只能写入 audio_direction.style_prompt，不要写进旁白或字幕。',
        '9. design_md 使用 Markdown 文本描述视觉方向、版式、动效和检查要点，不超过 400 字。',
        '10. content_mode=news 时侧重发生了什么和实际影响；analysis 时侧重信号、背景、可能意义和观众价值；discussion 时侧重争议、不同观点和观察方向。默认按 analysis 创作，不强制裁决话题真假。',
        '11. 当提供 Evidence Pack 时，事实只能来自其中的 claims；搜索列表、用户目标和编辑推断不能冒充证据。',
        '12. 不确定信息优先准确归因，例如“负责人表示”“部分用户发现”“社区正在讨论”；观察、转述和编辑推断必须区分，不能把局部现象扩大成全面结论。',
        '13. 除非未知信息直接影响核心表达，否则不要反复使用“尚未确认”“未知”“有待证实”“暂不明确”；60 秒内最多 2 个场景出现此类兜底措辞，专门解释证据边界的场景最多 1 个。',
        '14. 每个场景都要推进叙事，至少提供现象、背景、影响、观点或后续观察中的一种新信息，禁止把搜索摘要逐条改写成免责声明。',
        '15. analysis 模式必须输出 premise_check、thesis 和 audience_takeaways。先校验用户前提，再给出一个明确中心判断和 2~4 条观众可带走的信息。',
        '16. analysis 模式的每个场景都输出 viewer_gain；把已核验的日期、数字、名称、适用范围和案例保留到 narration_text，禁止抽象成泛化营销词。',
        '17. analysis 模式至少给出一个 viewer_action，告诉目标观众如何选择、判断或下一步怎么做；结尾不能只说“继续观察”“等待官方说明”。',
        '18. 提问式开场最多占一个场景，后续必须直接回答标题；不要连续提出问题而不给答案。',
        '19. 当 coverage.status=weak 且 source_types.first_party=0 时，禁止把检索失败写成“官方未确认”“官方未发布”或“并非官方”；只能说明“本次检索未获得第一方页面”，且不得把检索数量当作视频核心内容。',
        '20. 用户输入中明确给出的日期、范围、产品定位和来源要求，如果搜索材料没有出现直接反证，不得仅因页面正文抓取失败而降级成“官方仅确认部分内容”“其余只是第三方说法”或改写成事件未发生；可以标为用户提供的创作前提或待核验项，但不要反复展示内部检索状态。',
        '21. 当模型定位、价格或真实效果尚缺一手资料或独立样本时，只能给“先测谁、怎么对比”的测试顺序，不能把编辑推断压缩成“复杂用A、脚本用B”这类确定选型。',
        '22. 有效任务成本统一表达为“全部调用总成本÷成功交付数量”或“单次平均成本÷成功率”；禁止再把调用次数乘一次后又除以成功率。',
        '23. evidence_points 只能写来源材料支持的事实；用户的创作目标、受众任务和编辑建议应分别写成 viewer_action 或明确标为编辑假设，不能冒充研究证据。',
        '24. 旁白和画面文案不得出现 Creative Contract、Evidence Pack、Claim 等内部实现名称。',
        '24. 当提供 Creative Contract 时，每个场景必须填写 requirement_ids；事实场景还必须填写 claim_ids、source_ids，且 ID 必须存在于 Creative Contract 和 Evidence Pack。',
        '25. 不得为凑结构加入合同外的第二个主体、产品动态或行业新闻；场景只服务用户目标和 must_cover。',
        '26. 根据叙事需要选择 source_quote、metric_correction、evidence_matrix、timeline、comparison、verdict 或 explain 作为 layout_archetype；模板只控制视觉主题，不控制所有场景使用同一种卡片布局。',
        `27. 全部 storyboard.scenes[].narration_text 合计不超过 ${narrationCharBudget} 个非空白字符；这是 ${optionSummary.target_duration_sec || 60} 秒成片的配音硬预算。先删重复解释和套话，不要依赖后续自动截断。`,
        `28. 建议输出 ${recommendedSceneRange.min}~${recommendedSceneRange.max} 个有效场景，每个场景约 4~8 秒；不要为了命中固定数量拆分或填充无关内容。`,
        '',
        '输出示例：',
        safeJson({
          title: '短片标题',
          summary: '成片目标说明',
          premise_check: '核对输入前提后的结论。',
          thesis: '全片要证明的中心判断。',
          audience_takeaways: ['观众能复述的信息一', '观众能执行的信息二'],
          narration: '口播结构摘要，不粘贴完整长稿。',
          audio_direction: {
            voice: 'mimo_default',
            style_prompt: '自然清晰，带一点紧张感；开头深呼吸，关键句语速加快，结尾留出短暂停顿。',
          },
          storyboard: {
            scenes: [
              {
                headline: '开场',
                narration_text: '第一段旁白。',
                requirement_ids: ['req_01'],
                claim_ids: ['claim_01'],
                source_ids: ['src_01'],
                layout_archetype: 'source_quote',
                viewer_gain: '观众看完本段新增的认知。',
                evidence_points: ['具体日期、数字、名称或案例'],
                viewer_action: '观众可以采取的判断或行动。',
                content_role: 'update',
                update_subject: '具名模型、产品、平台或机构',
                update_detail: '这次具体发生的变化',
                update_time: '来源显示的日期时间或当前线索未给出精确时间',
                timeliness_status: 'within_window',
                source_attribution: '官方页面、负责人发文、媒体称或社区观察',
                workflow_impact: '影响选题、资料、脚本、画面或成本中的哪一环',
                test_action: '观众今天可以执行的一个测试动作',
                visual_text: {
                  keywords: ['关键词一', '关键词二', '关键词三'],
                  cards: ['提炼要点短语', '数据点：30%'],
                },
                visual_direction: '画面设计说明',
              },
            ],
          },
          design_md: '# Design\n视觉方向与制作要求',
        }),
      ].join('\n'),
    },
  ];
}

/**
 * 判断用户是否明确要求时效资讯或产品动态。
 */
function requestsUpdateCoverage(userInputText = '') {
  return /资讯|动态|更新|发布|上线|过去\s*24\s*小时|近\s*24\s*小时|最新消息/.test(String(userInputText || ''));
}

/**
 * 判断资讯场景是否同时交付主体、变化、归因、影响和测试动作。
 */
function isCompleteUpdateScene(scene = {}) {
  const placeholderPattern = /待补|待核|二次编辑时补|当前线索未给出|联网研究已禁用|用户提供的创作前提|官方页面、负责人发文、媒体称或社区观察|影响选题、资料、脚本、画面或成本中的哪一环|观众今天可以执行的一个测试动作/;
  return ['update_subject', 'update_detail', 'update_time', 'timeliness_status', 'source_attribution', 'workflow_impact', 'test_action']
    .every(key => {
      const value = String(scene?.[key] || '').trim();
      return value && !placeholderPattern.test(value);
    });
}

/**
 * 判断用户是否要求严格的当前时间窗口。
 */
function requestsCurrentWindow(userInputText = '') {
  return /过去\s*24\s*小时|近\s*24\s*小时|今天|今日|最新消息|时效/.test(String(userInputText || ''));
}

/**
 * 校验 analysis 导演简报是否明确交付观点、证据和行动价值。
 */
function validateFreeformBrief(brief = {}, options = {}) {
  // Analysis is the product default.  Do not silently skip the value checks
  // when an older caller omits contentMode.
  // Direct unit callers may intentionally omit creative context; production
  // calls always carry it, so default the real workflow to analysis without
  // breaking the small parser-only fallback.
  const mode = options.contentMode || options.content_mode
    || (options.creative_context ? 'analysis' : '');
  if (!mode) return { success: true, issues: [] };
  const issues = [];
  const scenes = Array.isArray(brief?.storyboard?.scenes) ? brief.storyboard.scenes : [];
  const takeaways = Array.isArray(brief.audience_takeaways) ? brief.audience_takeaways.filter(Boolean) : [];
  const gains = scenes.filter(scene => String(scene?.viewer_gain || '').trim()).length;
  const actions = scenes.filter(scene => String(scene?.viewer_action || '').trim()).length;
  const evidencePoints = scenes.flatMap(scene => (
    Array.isArray(scene?.evidence_points) ? scene.evidence_points : []
  )).filter(Boolean);
  const researchContext = options?.creative_context?.research_context || {};
  const creativeContract = options?.creative_context?.creative_contract || {};
  const evidencePack = options?.creative_context?.evidence_pack || {};
  const isPipelineV2 = Number(creativeContract.version) === 2;
  const researchSources = researchContext.sources;
  const coverage = researchContext.coverage || {};
  const creativeInput = options?.creative_context?.input || {};
  const userInputText = [
    creativeInput.raw_text,
    creativeInput.text,
    creativeInput.title,
    creativeInput.description,
  ].filter(Boolean).join('\n');
  const researchText = [
    researchContext.summary,
    ...(Array.isArray(researchSources) ? researchSources.flatMap(source => [source?.title, source?.summary]) : []),
  ].filter(Boolean).join('\n');
  const narrationText = scenes.map(scene => String(scene?.narration_text || '')).join('\n');
  const targetDurationSec = Number(options.targetDurationSec || options.target_duration_sec || brief.target_duration_sec || 60) || 60;
  const narrationCharCount = narrationText.replace(/\s+/g, '').length;
  // ponytail: 给模型输出留 5% 标点浮动，真实时长仍由后续 TTS 校验。
  const narrationCharBudget = Math.ceil(targetDurationSec * 5.25);
  const uncertaintyPattern = /尚未|未全|未完整|没有取得|未取得|未获得|缺少|待(?:实测|核实|验证|确认)|仍需(?:核验|确认|实测)|或能|无法|未知|有待|暂不明确/;
  const uncertaintySceneCount = scenes.filter(scene => uncertaintyPattern.test(String(scene?.narration_text || ''))).length;
  const briefText = JSON.stringify(brief);
  const admitsOfficialBodyMissing = /(?:没有|未)(?:取得|获得|拿到).{0,10}(?:公告|发布页|官方)?正文/.test(briefText);
  const directChoiceScenes = scenes.filter(scene => {
    const text = String(scene?.narration_text || '');
    return /(?:用|选|上)\s*[A-Za-z][A-Za-z0-9._+#/\-]*/.test(text)
      && !/(?:先测|测试|对比|比较|试用|假设)/.test(text);
  });
  const requestsOfficialPremiseCheck = /(?:先使用|使用|根据|请用|通过).{0,20}(?:官方|第一方).{0,40}(?:确认|核对|说明|发布|定位)/.test(userInputText);
  const downgradesUserPremiseForSearchGap = /官方(?:仅|只)(?:明确)?确认|当前一手材料.{0,20}(?:仅|只)(?:明确)?(?:出现|支持|确认)|(?:定位|说法).{0,20}(?:来自|仅为|只是)第三方|第三方(?:转述|说法).{0,30}(?:缺|未有|没有).{0,16}(?:官方|一手)/.test(briefText);
  const hasDirectPremiseContradiction = /(?:官方|第一方).{0,30}(?:明确否认|明确不包含|证实为错误|证实不实)|与用户前提.{0,12}(?:冲突|不符)/.test(researchText);
  const updateCoverageRequested = requestsUpdateCoverage(userInputText);
  const researchDisabled = researchContext.status === 'disabled'
    || researchContext.status === 'failed'
    || researchContext.status === 'empty'
    || (researchContext.status === 'ready'
      && (!Array.isArray(researchSources) || researchSources.length === 0))
    || (options?.creative_context?.input?.use_research === false);
  const completeUpdateScenes = scenes.filter(isCompleteUpdateScene);
  const currentWindowRequested = requestsCurrentWindow(userInputText);
  const currentUpdateScenes = completeUpdateScenes.filter(scene => ['within_window', 'current_unverified']
    .includes(String(scene.timeliness_status || '').trim()));
  const researchYear = String(researchContext.updated_at || '').match(/20\d{2}/)?.[0] || '';
  const staleCurrentScenes = currentUpdateScenes.filter(scene => {
    const updateYear = String(scene.update_time || '').match(/20\d{2}/)?.[0] || '';
    return researchYear && updateYear && updateYear !== researchYear;
  });
  const evidenceBoundaryPattern = /时间窗|时间戳|UTC|日期冲突|检索(?:失败|未命中)|抓取(?:失败|不到)|无发布时间|没有发布时间|帮助页.{0,12}(?:不代表|不是).{0,8}更新|证据边界/;
  const evidenceBoundarySceneCount = scenes.filter(scene => evidenceBoundaryPattern.test([
    scene?.headline,
    scene?.narration_text,
    scene?.update_detail,
  ].filter(Boolean).join(' '))).length;

  if (isPipelineV2) {
    const editorialValidation = validateEditorialPlan(
      buildEditorialPlan(brief, creativeContract, evidencePack),
      creativeContract,
      evidencePack,
    );
    issues.push(...editorialValidation.issues.map(issue => issue.message));
  }

  if (mode === 'analysis') {
    if (!String(brief.premise_check || '').trim()) issues.push('缺少 premise_check，尚未校验用户前提');
    if (!String(brief.thesis || '').trim()) issues.push('缺少 thesis，标题问题没有明确答案');
    if (takeaways.length < 2) issues.push('audience_takeaways 至少需要 2 条');
  }
  if (!scenes.length) issues.push('storyboard.scenes 不能为空');
  if (scenes.length && gains < Math.max(2, scenes.length - 1)) issues.push('多数场景缺少 viewer_gain');
  if (narrationCharCount > narrationCharBudget) {
    issues.push(`旁白共 ${narrationCharCount} 字，超过 ${targetDurationSec} 秒成片的 ${narrationCharBudget} 字硬预算`);
  }
  if (actions < 1) issues.push('至少一个场景需要 viewer_action');
  if (uncertaintySceneCount > 2) issues.push('不确定性兜底占用了超过 2 个场景，叙事没有持续提供新信息');
  if (admitsOfficialBodyMissing && directChoiceScenes.length > 0) {
    issues.push('一手定位尚未取得时只能给测试顺序，不能输出确定选型');
  }
  if (requestsOfficialPremiseCheck && downgradesUserPremiseForSearchGap && !hasDirectPremiseContradiction) {
    issues.push('没有直接反证时，不得把用户明确要求核对的官方前提降级成第三方说法');
  }
  if (/(?:调用价|单次成本).{0,12}(?:×|乘).{0,10}(?:次数|尝试).{0,12}(?:÷|除以?).{0,8}成功率/.test(narrationText)) {
    issues.push('有效成本公式重复计算了尝试次数，应使用总成本除以成功交付数量');
  }
  if (!isPipelineV2 &&
    coverage.status === 'weak'
    && Number(coverage?.source_types?.first_party || 0) === 0
    && /官方(?:未确认|未发布|没有|不存在)|未发现官方|并非官方|只能按传闻|官方原始来源(?:为|：)?0/.test(JSON.stringify(brief))
  ) {
    issues.push('弱覆盖不能推出官方未确认或未发布，只能说明本次检索未获得第一方页面');
  }
  if (!isPipelineV2 && Array.isArray(researchSources) && researchSources.length > 0 && evidencePoints.length < 2) {
    issues.push('已有联网材料时至少需要 2 个 evidence_points');
  }
  if (!isPipelineV2 && updateCoverageRequested && completeUpdateScenes.length < 2) {
    issues.push('资讯主题至少需要 2 个具体动态，并逐条提供来源归因、工作流影响和测试动作');
  }
  if (!isPipelineV2 && updateCoverageRequested && researchDisabled) {
    issues.push('资讯主题缺少联网素材，不能用占位字段生成具名动态；请开启联网研究或改为方法型解读');
  }
  if (!isPipelineV2 && currentWindowRequested && (currentUpdateScenes.length < 2 || staleCurrentScenes.length > 0)) {
    issues.push('当前时效主题至少需要 2 个落在目标窗口或明确标为当前待核验的具体动态，历史资料不能冒充当前更新');
  }
  if (!isPipelineV2 && updateCoverageRequested && evidenceBoundarySceneCount > Math.max(1, Math.floor(scenes.length * 0.2))) {
    issues.push('时间核验和证据边界最多占 1 个场景且不得超过全片 20%，不能把资讯改成核验教程');
  }
  return {
    success: issues.length === 0,
    issues,
    message: issues.length ? `导演策划缺少观众价值：${issues.join('；')}。` : '',
  };
}

function parseJsonObject(text = '') {
  const cleaned = stripCodeFence(text);
  // AI 模型有时会用中文引号 「」""'' 代替标准双引号，统一清洗
  const sanitized = cleaned
    .replace(/[「『"']/g, '"')  // 「『"' → "
    .replace(/[」』"']/g, '"');   // 」』"' → "

  const candidates = [cleaned];
  if (sanitized !== cleaned) candidates.push(sanitized);

  for (const candidate of candidates) {
    // 1. 直接解析
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (_) {}
    // 2. 正则提取第一个完整的 JSON 对象（非贪婪，容错 AI 输出的额外文字）
    const jsonMatch = candidate.match(/\{[\s\S]*?\}/);
    if (jsonMatch && jsonMatch[0] !== candidate) {
      try {
        const value = JSON.parse(jsonMatch[0]);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch (_) {}
    }
    // 3. 贪婪匹配兜底（处理嵌套大括号的情况）
    const greedyMatch = candidate.match(/\{[\s\S]*\}/);
    if (greedyMatch && greedyMatch[0] !== jsonMatch?.[0]) {
      try {
        const value = JSON.parse(greedyMatch[0]);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch (_) {}
    }
  }
  // 记录原始内容以便诊断（截取前 500 字符）
  const preview = String(text || '').slice(0, 500);
  throw new Error(`响应不是 JSON 对象。原始内容预览：${preview}`);
}

/**
 * 在不删除场景的前提下按比例压缩旁白，真实时长仍由后续 TTS 结果校验。
 * @param {object} brief 导演简报。
 * @param {object} options 创作参数。
 * @returns {object} 时长预算内的导演简报。
 */
function fitNarrationBudget(brief = {}, options = {}) {
  const scenes = Array.isArray(brief?.storyboard?.scenes) ? brief.storyboard.scenes : [];
  if (!scenes.length) return brief;
  const targetDurationSec = Number(options.targetDurationSec || options.target_duration_sec || brief.target_duration_sec || 60) || 60;
  const budget = Math.floor(targetDurationSec * 5);
  const lengths = scenes.map(scene => String(scene?.narration_text || '').replace(/\s+/g, '').length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= budget) return brief;
  const minimum = Math.min(12, Math.floor(budget / scenes.length / 2));
  let remaining = Math.max(0, budget - minimum * scenes.length);
  const limits = lengths.map(length => minimum + Math.floor(remaining * length / total));
  remaining = budget - limits.reduce((sum, limit) => sum + limit, 0);
  for (let index = 0; remaining > 0; index = (index + 1) % limits.length, remaining -= 1) limits[index] += 1;

  return {
    ...brief,
    storyboard: {
      ...brief.storyboard,
      scenes: scenes.map((scene, index) => {
        const narration = String(scene?.narration_text || '').trim();
        const limit = limits[index];
        if (narration.replace(/\s+/g, '').length <= limit) return scene;
        const preview = narration.slice(0, Math.max(1, limit));
        const punctuation = Math.max(...['。', '！', '？', '；', '!', '?', ';'].map(mark => preview.lastIndexOf(mark)));
        const shortened = punctuation >= Math.floor(limit * 0.55)
          ? preview.slice(0, punctuation + 1)
          : `${preview.slice(0, Math.max(1, limit - 1)).trim()}。`;
        return { ...scene, narration_text: shortened };
      }),
    },
  };
}

function parseFreeformBriefResponse(text = '', options = {}) {
  try {
    const brief = fitNarrationBudget(parseJsonObject(text), options);
    const validation = validateFreeformBrief(brief, options);
    if (!validation.success) return validation;
    return {
      success: true,
      brief,
    };
  } catch (error) {
    return {
      success: false,
      message: `解析 HyperFrames 导演简报失败：${error.message}`,
    };
  }
}

module.exports = {
  buildFreeformBriefMessages,
  fitNarrationBudget,
  parseFreeformBriefResponse,
  validateFreeformBrief,
};
