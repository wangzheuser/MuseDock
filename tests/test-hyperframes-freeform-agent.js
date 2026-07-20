const assert = require('assert');

const agent = require('../server/services/hyperframes/hyperframesFreeformAgent');

async function run() {
  const briefMessages = agent.buildFreeformBriefMessages({
    run: { result: { rewrite_script: '测试口播' } },
    skillContext: 'Use HyperFrames.',
    options: {
      contentMode: 'analysis',
      creative_context: {
        research_context: {
          status: 'ready',
          query: 'OpenAI 最新发布',
          updated_at: '2026-07-13T08:00:00.000Z',
          summary: '官方发布页确认了最新信息。',
          sources: [{ title: 'OpenAI News', url: 'https://openai.com/news/', published_at: '2026-07-13' }],
        },
      },
    },
  });
  assert.match(briefMessages[1].content, /audio_direction/);
  assert.match(briefMessages[1].content, /voice/);
  assert.match(briefMessages[1].content, /style_prompt/);
  assert.match(briefMessages[1].content, /narration 不要输出完整口播/);
  assert.match(briefMessages[1].content, /storyboard\.scenes\[\]\.narration_text 承载实际配音文本/);
  assert.match(briefMessages[1].content, /紧张|深呼吸|语速|停顿|长叹/);
  assert.doesNotMatch(briefMessages[1].content, /narration_text 可以.*括号标签/);
  assert.match(briefMessages[1].content, /narration_text 和 captions\.text 只能包含观众可见、可朗读的正文/);
  assert.match(briefMessages[1].content, /visual_text 承载画面文字素材/);
  assert.match(briefMessages[1].content, /keywords\/cards 禁止照抄 narration_text 原句/);
  assert.match(briefMessages[1].content, /"keywords"/);
  assert.match(briefMessages[1].content, /"cards"/);
  assert.match(briefMessages[1].content, /官方发布页确认了最新信息/);
  assert.match(briefMessages[1].content, /https:\/\/openai\.com\/news\//);
  assert.match(briefMessages[1].content, /默认按 analysis 创作，不强制裁决话题真假/);
  assert.match(briefMessages[1].content, /事实只能来自其中的 claims/);
  assert.match(briefMessages[1].content, /不得仅因页面正文抓取失败而降级/);
  assert.match(briefMessages[1].content, /最多 2 个场景/);
  assert.match(briefMessages[1].content, /全部调用总成本÷成功交付数量/);
  assert.match(briefMessages[1].content, /只能给“先测谁、怎么对比”的测试顺序/);
  assert.match(briefMessages[1].content, /premise_check/);
  assert.match(briefMessages[1].content, /audience_takeaways/);
  assert.match(briefMessages[1].content, /viewer_gain/);
  assert.match(briefMessages[1].content, /viewer_action/);
  assert.match(briefMessages[1].content, /禁止抽象成泛化营销词/);
  assert.match(briefMessages[1].content, /每个场景必须填写 requirement_ids/);
  assert.match(briefMessages[1].content, /不得为凑结构加入合同外的第二个主体/);
  assert.match(briefMessages[1].content, /layout_archetype/);
  assert.match(briefMessages[1].content, /负责人表示/);
  assert.match(briefMessages[1].content, /配音硬预算/);

  const emptyAnalysis = agent.parseFreeformBriefResponse(JSON.stringify({ title: '空洞解读' }), {
    contentMode: 'analysis',
  });
  assert.equal(emptyAnalysis.success, false);
  assert.match(emptyAnalysis.message, /观众价值/);

  const valuableAnalysis = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '具体解读',
    premise_check: '发布时间已经核对。',
    thesis: '讨论来自选择成本，而非单纯性能。',
    audience_takeaways: ['知道三档定位', '知道如何选择'],
    storyboard: {
      scenes: [
        { narration_text: '第一段。', viewer_gain: '知道发布时间。', evidence_points: ['7月9日发布'] },
        { narration_text: '第二段。', viewer_gain: '知道价格差异。', evidence_points: ['价格相差五倍'], viewer_action: '按任务成本选择。' },
        { narration_text: '第三段。', viewer_gain: '知道产品范围。' },
      ],
    },
  }), {
    contentMode: 'analysis',
    creative_context: { research_context: { sources: [{ url: 'https://example.com' }] } },
  });
  assert.equal(valuableAnalysis.success, true);

  const overlongNarration = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '超长旁白',
    storyboard: {
      scenes: [
        { narration_text: '这是一段重复旁白。'.repeat(30), viewer_gain: '知道问题。' },
        { narration_text: '这是结尾。', viewer_gain: '知道结论。', viewer_action: '立即测试。' },
      ],
    },
  }), { contentMode: 'news', targetDurationSec: 10 });
  assert.equal(overlongNarration.success, true);
  assert.ok(overlongNarration.brief.storyboard.scenes
    .map(scene => scene.narration_text)
    .join('')
    .replace(/\s+/g, '').length <= 50);

  const weakCoverageDenial = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '错误否定',
    storyboard: {
      scenes: [
        { narration_text: '官方未确认该产品发布。', viewer_gain: '知道检索结论。' },
        { narration_text: '继续等待。', viewer_gain: '知道下一步。', viewer_action: '稍后再看。' },
      ],
    },
  }), {
    contentMode: 'news',
    creative_context: { research_context: { coverage: { status: 'weak', source_types: {} } } },
  });
  assert.equal(weakCoverageDenial.success, false);
  assert.match(weakCoverageDenial.message, /弱覆盖不能推出/);

  const uncertaintyDominated = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '仍然空泛',
    storyboard: {
      scenes: [
        { narration_text: '三档边界待实测。', viewer_gain: '知道边界。' },
        { narration_text: '其他价格未全。', viewer_gain: '知道价格。' },
        { narration_text: '跨应用或能减少切换。', viewer_gain: '知道影响。', viewer_action: '做一次测试。' },
      ],
    },
  }), { contentMode: 'news' });
  assert.equal(uncertaintyDominated.success, false);
  assert.match(uncertaintyDominated.message, /超过 2 个场景/);

  const invalidCostFormula = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '成本怎么算',
    storyboard: {
      scenes: [
        { narration_text: '成本看调用价×次数÷成功率。', viewer_gain: '知道成本。' },
        { narration_text: '记录总支出。', viewer_gain: '知道记录方法。', viewer_action: '开始记录。' },
      ],
    },
  }), { contentMode: 'news' });
  assert.equal(invalidCostFormula.success, false);
  assert.match(invalidCostFormula.message, /重复计算/);

  const unsupportedDirectChoice = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '先怎么选',
    premise_check: '没有取得官方发布页正文。',
    storyboard: {
      scenes: [
        { narration_text: '复杂用Sol，脚本用Terra。', viewer_gain: '知道选型。' },
        { narration_text: '记录结果。', viewer_gain: '知道方法。', viewer_action: '开始测试。' },
      ],
    },
  }), { contentMode: 'news' });
  assert.equal(unsupportedDirectChoice.success, false);
  assert.match(unsupportedDirectChoice.message, /只能给测试顺序/);

  const premiseDowngradedBySearchGap = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '三档定位',
    storyboard: {
      scenes: [
        { narration_text: '官方仅确认 GPT-5.6 与 Sol，Terra、Luna 定位只是第三方说法。', viewer_gain: '知道定位。' },
        { narration_text: '同题测试三次。', viewer_gain: '知道测试方法。', viewer_action: '开始测试。' },
      ],
    },
  }), {
    contentMode: 'news',
    creative_context: {
      input: { raw_text: '先使用 OpenAI 官方发布信息确认发布时间和官方三档定位。' },
      research_context: {
        summary: '本次已找到 OpenAI 官方发布条目，但正文抓取受限。',
        sources: [{ title: 'GPT-5.6 官方发布', evidence: 'official_feed' }],
      },
    },
  });
  assert.equal(premiseDowngradedBySearchGap.success, false);
  assert.match(premiseDowngradedBySearchGap.message, /不得把用户明确要求核对的官方前提降级/);

  const updateCoverageOptions = {
    contentMode: 'analysis',
    creative_context: { input: { raw_text: '制作 AI 时效资讯动态，告诉创作者怎么测试。' } },
  };
  const updateCoverageDrift = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '24小时信号核验法',
    premise_check: '时间窗需要核验。',
    thesis: '先核验来源再行动。',
    audience_takeaways: ['知道时间窗', '知道核验方法'],
    storyboard: {
      scenes: [
        { headline: 'UTC时间窗', narration_text: '先看UTC时间窗。', viewer_gain: '知道时间窗。' },
        { headline: '日期冲突', narration_text: '日报标题日期冲突。', viewer_gain: '知道冲突。' },
        { headline: '帮助页', narration_text: '帮助页不代表更新。', viewer_gain: '知道页面区别。', viewer_action: '检查时间。' },
      ],
    },
  }), updateCoverageOptions);
  assert.equal(updateCoverageDrift.success, false);
  assert.match(updateCoverageDrift.message, /2 个具体动态/);
  assert.match(updateCoverageDrift.message, /不能把资讯改成核验教程/);

  const validUpdateCoverage = agent.parseFreeformBriefResponse(JSON.stringify({
    title: '两条AI动态怎么测',
    premise_check: '两条线索均保留来源归因。',
    thesis: '创作者应按真实工作流验证新能力。',
    audience_takeaways: ['知道两条变化', '知道如何测试'],
    storyboard: {
      scenes: [
        {
          headline: '产品A更新', narration_text: '负责人发文称产品A新增长文转脚本。', viewer_gain: '知道脚本变化。',
          evidence_points: ['负责人7月14日发文'], content_role: 'update', update_subject: '产品A', update_detail: '新增长文转脚本',
          update_time: '2026年7月14日', timeliness_status: 'within_window',
          source_attribution: '负责人发文称', workflow_impact: '脚本生成', test_action: '用同一长文测试一稿可用率',
        },
        {
          headline: '产品A额度变化', narration_text: '媒体称产品A同时调整了生成额度。', viewer_gain: '知道额度变化。',
          evidence_points: ['媒体7月14日报道'], content_role: 'update', update_subject: '产品A', update_detail: '调整生成额度',
          update_time: '2026年7月14日', timeliness_status: 'current_unverified',
          source_attribution: '媒体称', workflow_impact: '画面制作', test_action: '对同一分镜记录返工时间', viewer_action: '完成一次对照测试。',
        },
      ],
    },
  }), updateCoverageOptions);
  assert.equal(validUpdateCoverage.success, true);

  const staleUpdateCoverage = JSON.parse(JSON.stringify(validUpdateCoverage.brief));
  staleUpdateCoverage.storyboard.scenes[0].update_time = '2024年12月12日';
  staleUpdateCoverage.storyboard.scenes[0].timeliness_status = 'within_window';
  const staleUpdateResult = agent.parseFreeformBriefResponse(JSON.stringify(staleUpdateCoverage), {
    ...updateCoverageOptions,
    creative_context: {
      ...updateCoverageOptions.creative_context,
      research_context: { updated_at: '2026-07-14T08:00:00.000Z' },
    },
  });
  assert.equal(staleUpdateResult.success, false);
  assert.match(staleUpdateResult.message, /历史资料不能冒充当前更新/);

  const parsed = agent.parseFreeformBriefResponse(JSON.stringify({ title: '测试短片' }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.brief.title, '测试短片');

  const failed = agent.parseFreeformBriefResponse('not json');
  assert.equal(failed.success, false);
  assert.match(failed.message, /解析/);

  const longMessages = agent.buildFreeformBriefMessages({
    run: { result: { rewrite_script: 'a'.repeat(30000) } },
  });
  const truncatedBlocks = longMessages[1].content.match(/\{\n  "truncated": true,[\s\S]*?\n\}/g) || [];
  assert.ok(truncatedBlocks.length >= 1);
  const value = JSON.parse(truncatedBlocks[0]);
  assert.equal(value.truncated, true);
  assert.equal(typeof value.preview, 'string');
  assert.ok(value.preview.length < 6000);
}

run().then(() => {
  console.log('hyperframes freeform agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
