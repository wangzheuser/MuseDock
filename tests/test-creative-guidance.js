const assert = require('assert/strict');

const {
  analyzeCreativeGuidance,
  composeCreativeGuidance,
  detectScenario,
  detectTemporalRisk,
  normalizeAnalysis,
} = require('../server/services/creative/creativeGuidance');

const ORIGINAL_INPUT = '今天 gpt-5.6 正式发布了';

function createModel() {
  const requests = [];
  return {
    requests,
    callTextModel: async request => {
      requests.push(request);
      const systemText = request.messages?.[0]?.content || '';
      if (systemText.includes('需求分析编辑')) {
        return {
          success: true,
          text: JSON.stringify({
            scenario: 'news',
            summary: '高时效科技资讯，当前信息较少。',
            information_level: 'sparse',
            temporal_risk: true,
            recommended_duration_sec: 60,
            question_ids: ['angle', 'audience', 'tone', 'source_strategy'],
            recommended_answers: {
              angle: ['general_impact'],
              audience: 'tool_users',
              tone: 'objective_news',
              source_strategy: 'official_first',
            },
            contextual_options: {
              angle: [
                { label: 'API 可用范围', description: '说明 API 是否同步开放。', recommended: true },
                { label: '一分钟看懂更新', description: '按 60 秒快速说明变化。', recommended: true },
              ],
            },
            warnings: ['应先核验官方发布信息。'],
          }),
          model: { provider: 'mock', model_id: 'guidance-test' },
          usage: { total_tokens: 100 },
        };
      }
      if (systemText.includes('资深短视频总编')) {
        return {
          success: true,
          text: JSON.stringify({
            final_prompt: [
              '请创作一条面向普通 AI 工具用户的科技资讯短视频，主题围绕 GPT-5.6 的发布消息以及它对普通用户的实际影响。',
              '创作目标：让没有专业技术背景的观众快速理解这次变化是否值得关注，并知道自己接下来应该查看哪些官方信息。',
              '内容结构：前三秒提出核心问题，随后说明事件背景，再提炼三个最重要的变化，补充普通用户和 API 用户可能受到的影响，最后给出简洁结论。',
              '表达方式：使用客观、通俗、自然的中文口语，每一段提供新的信息，不重复同一个观点，不堆砌术语。',
              '视觉方向：优先使用官方页面、功能对比、时间线和关键词动画，避免只使用通用电脑与办公素材。',
            ].join('\n\n'),
            research_query: 'GPT-5.6 OpenAI 官方发布 site:openai.com',
            summary: { title: 'GPT-5.6 发布消息解读' },
            recommended_overrides: { targetDurationSec: 60, useResearch: true },
            assumptions: ['默认面向普通 AI 工具用户。', '根据当前设置按 60 秒规划内容，而不是 30 秒。'],
            warnings: [],
          }),
          model: { provider: 'mock', model_id: 'guidance-test' },
          usage: { total_tokens: 200 },
        };
      }
      return { success: false, message: '未知测试请求。' };
    },
  };
}

async function testAnalyzeReturnsRichStableQuestions() {
  const model = createModel();
  const result = await analyzeCreativeGuidance({
    input: ORIGINAL_INPUT,
    creativeSettings: { aspectRatio: '9:16', targetDurationSec: 60, useResearch: true },
  }, { aiTextModel: model });

  assert.equal(result.success, true);
  assert.equal(result.analysis.scenario, 'news');
  assert.equal(result.analysis.temporal_risk, true);
  assert.equal(result.analysis.recommended_duration_sec, 30);
  assert.equal(result.analysis.questions.length, 4);
  const angle = result.analysis.questions.find(question => question.id === 'angle');
  assert.ok(angle.options.length >= 10);
  assert.equal(angle.options[0].label, 'API 可用范围');
  assert.equal(angle.options.some(item => item.label === '一分钟看懂更新'), false);
  assert.equal(angle.allow_custom, true);
  assert.equal(angle.allow_ai_decide, true);
  assert.equal(angle.allow_skip, true);
  assert.equal(angle.max_selections, 3);
  assert.equal(angle.options.find(item => item.id === 'general_impact').recommended, true);
}

async function testComposeCreatesEditablePromptAndFactGuard() {
  const model = createModel();
  const analyzed = await analyzeCreativeGuidance({
    input: ORIGINAL_INPUT,
    creativeSettings: { aspectRatio: '9:16', targetDurationSec: 60, useResearch: true },
  }, { aiTextModel: model });
  const angleQuestion = analyzed.analysis.questions.find(question => question.id === 'angle');
  const contextualId = angleQuestion.options.find(item => item.label === 'API 可用范围').id;
  const result = await composeCreativeGuidance({
    input: ORIGINAL_INPUT,
    analysis: analyzed.analysis,
    answers: {
      angle: { selected: [contextualId, 'general_impact'], custom: '同时说明免费用户能否使用。' },
      audience: { selected: ['tool_users'], custom: '' },
      tone: { selected: ['objective_news'], custom: '' },
      source_strategy: { selected: ['official_first'], custom: '' },
    },
    creativeSettings: { aspectRatio: '9:16', targetDurationSec: 60, useResearch: true },
  }, { aiTextModel: model });

  assert.equal(result.success, true);
  assert.ok(result.final_prompt.length >= 180);
  assert.match(result.final_prompt, /事实核验要求/);
  assert.match(result.final_prompt, /30\s*秒/);
  assert.match(result.final_prompt, /官方公告|官方文档/);
  assert.match(result.final_prompt, /不得把未经确认的信息写成确定事实/);
  assert.equal(result.research_query, 'GPT-5.6 OpenAI 官方发布 site:openai.com');
  assert.deepEqual(result.recommended_overrides, { targetDurationSec: 30, useResearch: true });
  assert.deepEqual(result.assumptions, ['默认面向普通 AI 工具用户。']);
  const composeRequest = model.requests.find(request => request.messages?.[0]?.content?.includes('资深短视频总编'));
  assert.match(composeRequest.messages[1].content, /API 可用范围/);
  assert.match(composeRequest.messages[1].content, /同时说明免费用户能否使用/);
}

async function testValidationAndFallbackDetection() {
  assert.equal(detectScenario('如何使用剪辑软件制作字幕教程'), 'tutorial');
  assert.equal(detectScenario('A 和 B 到底哪个好，对比评测'), 'comparison');
  assert.equal(detectTemporalRisk('今天正式发布新版本'), true);

  const singleQuestion = normalizeAnalysis({
    scenario: 'news',
    question_ids: ['angle'],
  }, ORIGINAL_INPUT, { targetDurationSec: 60 });
  assert.equal(singleQuestion.questions.length, 2);
  assert.equal(singleQuestion.questions[0].id, 'angle');

  const empty = await analyzeCreativeGuidance({ input: '   ' }, { aiTextModel: createModel() });
  assert.equal(empty.success, false);
  assert.match(empty.message, /请先输入/);

  const unavailable = await analyzeCreativeGuidance({ input: '一个创作主题' }, {
    aiTextModel: { callTextModel: async () => ({ success: false, message: '分析模型未配置。' }) },
  });
  assert.equal(unavailable.success, false);
  assert.equal(unavailable.code, 'TEXT_MODEL_UNAVAILABLE');
  assert.match(unavailable.message, /模型未配置/);
}

async function run() {
  await testAnalyzeReturnsRichStableQuestions();
  await testComposeCreatesEditablePromptAndFactGuard();
  await testValidationAndFallbackDetection();
  console.log('creative guidance tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
