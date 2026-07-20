const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCreativeContract } = require('../server/services/creative/pipeline/creativeContract');
const { buildEvidencePack } = require('../server/services/creative/pipeline/evidencePack');
const { buildEditorialPlan, validateEditorialPlan } = require('../server/services/creative/pipeline/editorialPlan');
const { buildProductionSpec } = require('../server/services/creative/pipeline/productionSpec');
const { buildQualityReport } = require('../server/services/creative/pipeline/qualityGate');
const { runResearchProvider } = require('../server/services/creative/creativeResearchProvider');
const {
  createCreativeWorkflow,
  invalidateWorkflowDownstream,
  resolveWorkflowResumeStage,
  runCreativeWorkflow,
} = require('../server/services/creative/creativeWorkflows');

const NOW = '2026-07-17T08:00:00.000Z';

async function testRegressionFixture() {
  const fixture = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '../data/creative-workflows/20260715091147355976.json',
  ), 'utf8'));
  const contract = buildCreativeContract(fixture.input, fixture.target, NOW);
  const evidencePack = buildEvidencePack(contract, fixture.research_context, NOW);
  const missingTexts = evidencePack.coverage.missing_critical_requirement_ids
    .map(id => contract.must_cover.find(item => item.id === id)?.text)
    .join('\n');

  assert.equal(contract.version, 2);
  assert.match(contract.must_cover.map(item => item.text).join('\n'), /原帖链接/);
  assert.match(missingTexts, /原帖链接|统计口径/);
  assert.equal(evidencePack.coverage.ready, false);
  assert.equal(evidencePack.claims.some(claim => /Nextdoor|Ona/i.test(claim.text) && claim.requirement_ids.some(id => (
    /800万|900万|额度重置/.test(contract.must_cover.find(item => item.id === id)?.text || '')
  ))), false);
}

async function testEvidenceEditorialAndQualityPass() {
  const input = {
    raw_text: [
      '创作一条30秒的核验短视频，主题是Tibo发布的Codex用户规模消息。',
      '制作前必须联网查证：确认Tibo的具体账号身份、原帖链接、发布时间及完整上下文；明确原帖中的Codex具体指哪一项产品或服务；分别核验用户达到800万、额度重置、用户接近900万三项说法；特别核实用户是活跃用户还是注册用户；核实额度重置的具体机制。',
    ].join('\n'),
  };
  const target = { duration_sec: 30, aspect_ratio: '9:16', fps: 30, content_mode: 'analysis' };
  const contract = buildCreativeContract(input, target, NOW);
  const evidencePack = buildEvidencePack(contract, {
    status: 'ready',
    updated_at: NOW,
    sources: [
      {
        title: 'Tibo Sottiaux · Head of Codex',
        url: 'https://x.com/thsottiaux/status/2077114635308986427',
        published_at: '2025-12-30T10:00:00.000Z',
        source_type: 'community',
        evidence: 'original_post',
        summary: 'Tibo表示，Codex与ChatGPT Work合计达到800万活跃用户；额度完成一次重置，随后活跃用户接近900万。这是负责人原帖口径，不代表Codex单一产品注册用户。',
      },
      {
        title: 'Tibo Sottiaux profile',
        url: 'https://example.com/tibo-profile',
        source_type: 'media',
        evidence: 'page_body',
        summary: 'Tibo Sottiaux is Head of Codex at OpenAI，负责Codex产品团队和相关发布。',
      },
      {
        title: 'Codex quota reset explanation',
        url: 'https://example.com/codex-quota-reset',
        source_type: 'media',
        evidence: 'page_body',
        summary: '报道将reset解释为一次额度调整和限额恢复安排，而不是用户增长原因；具体周期仍需以OpenAI账户页面为准。',
      },
    ],
  }, NOW);
  assert.equal(evidencePack.coverage.ready, true);

  const factRequirementIds = contract.must_cover.filter(item => item.evidence_required).map(item => item.id);
  const claimIds = evidencePack.claims.map(item => item.id);
  const sourceIds = [...new Set(evidencePack.claims.flatMap(item => item.source_ids))];
  const brief = {
    title: '800万到底是什么口径',
    summary: '核验原帖和数字口径。',
    storyboard: {
      scenes: [
        {
          id: 'scene_01',
          narration_text: 'Tibo原帖说的是Codex与ChatGPT Work合计800万活跃用户，随后接近900万。',
          requirement_ids: factRequirementIds,
          claim_ids: claimIds,
          source_ids: sourceIds,
          visual_text: { keywords: ['活跃用户'], cards: ['800万', '接近900万'] },
        },
        {
          id: 'scene_02',
          narration_text: '额度重置是限额调整，不足以证明它造成用户增长。',
          requirement_ids: factRequirementIds,
          claim_ids: claimIds,
          source_ids: sourceIds,
          visual_text: { keywords: ['额度机制'], cards: ['相关不等于因果'] },
        },
      ],
    },
  };
  const editorialPlan = buildEditorialPlan(brief, contract, evidencePack);
  assert.equal(validateEditorialPlan(editorialPlan, contract, evidencePack).success, true);

  const audio = {
    status: 'ready',
    duration: 30,
    scenes: editorialPlan.scenes.map((scene, index) => ({
      ...scene,
      index: index + 1,
      speech_duration_sec: 15,
      captions: [{ start: 0, end: 15, text: scene.narration_text }],
    })),
  };
  const productionSpec = buildProductionSpec(editorialPlan, audio, target);
  const qualityReport = buildQualityReport({
    contract,
    evidencePack,
    editorialPlan,
    productionSpec,
    projectStageResult: {
      hyperframes_freeform: {
        project: { html_video_project_path: '/tmp/project', ready_for_edit: false },
        render: { status: 'exported' },
        visual_inspect: { status: 'passed', issues: [] },
      },
    },
  });
  assert.equal(productionSpec.timing_status, 'ready');
  assert.equal(qualityReport.publish_ready, true);

  const repairedLayoutReport = buildQualityReport({
    contract,
    evidencePack,
    editorialPlan,
    productionSpec,
    projectStageResult: {
      hyperframes_freeform: {
        project: {
          html_video_project_path: '/tmp/project',
          ready_for_edit: false,
          layout_qa_reports: [
            { created_at: '2026-07-17T10:00:00.000Z', issues: [{ code: 'text_overlap', severity: 'error' }] },
            { created_at: '2026-07-17T10:01:00.000Z', success: true, issues: [] },
          ],
        },
        render: { status: 'exported' },
        visual_inspect: { status: 'passed', issues: [] },
      },
    },
  });
  assert.equal(repairedLayoutReport.checks.layout.passed, true);
  assert.equal(repairedLayoutReport.publish_ready, true);

  const rootPathQualityReport = buildQualityReport({
    contract,
    evidencePack,
    editorialPlan,
    productionSpec,
    projectStageResult: {
      hyperframes_freeform: {
        html_video_project_path: '/tmp/project',
        project: { ready_for_edit: false },
        render: { status: 'exported' },
        visual_inspect: { status: 'passed', issues: [] },
      },
    },
  });
  assert.equal(rootPathQualityReport.checks.technical.passed, true);
  assert.equal(rootPathQualityReport.publish_ready, true);

  const resumableRecord = {
    pipeline_version: 2,
    run_id: 'run-1',
    creative_context: {
      creative_contract: contract,
      evidence_pack: evidencePack,
      editorial_plan: editorialPlan,
      production_spec: productionSpec,
    },
  };
  assert.equal(resolveWorkflowResumeStage(resumableRecord, 'brief'), 'brief');
  assert.equal(resolveWorkflowResumeStage(resumableRecord, 'audio'), 'audio');
  assert.equal(resolveWorkflowResumeStage(resumableRecord, 'project'), 'project');
  assert.equal(resolveWorkflowResumeStage({
    ...resumableRecord,
    creative_context: { ...resumableRecord.creative_context, evidence_pack: null },
  }, 'audio'), 'research');
  const retryRecord = JSON.parse(JSON.stringify({
    ...resumableRecord,
    result: { stale: true },
    quality_report: { passed: true },
    stages: ['research', 'brief', 'audio', 'project', 'check'].map(id => ({ id, status: 'done', result: { stale: true } })),
  }));
  invalidateWorkflowDownstream(retryRecord, 'audio', NOW);
  assert.equal(retryRecord.creative_context.editorial_plan.input_hash, editorialPlan.input_hash);
  assert.equal(retryRecord.creative_context.audio, undefined);
  assert.equal(retryRecord.creative_context.production_spec, undefined);
  assert.equal(retryRecord.result, null);
  assert.equal(retryRecord.stages.find(stage => stage.id === 'brief').status, 'done');
  assert.equal(retryRecord.stages.find(stage => stage.id === 'audio').status, 'pending');
  assert.equal(retryRecord.stages.find(stage => stage.id === 'check').status, 'pending');

  const mismatchedBrief = JSON.parse(JSON.stringify(brief));
  mismatchedBrief.storyboard.scenes[0].claim_ids = [claimIds.at(-1)];
  mismatchedBrief.storyboard.scenes[0].source_ids = evidencePack.claims.at(-1).source_ids;
  const mismatchedPlan = buildEditorialPlan(mismatchedBrief, contract, evidencePack);
  assert.equal(validateEditorialPlan(mismatchedPlan, contract, evidencePack).success, true);
  assert.deepEqual(mismatchedPlan.scenes[0].claim_ids.sort(), claimIds.sort());
}

async function testKimiContractAndEvidenceCompaction() {
  const contract = buildCreativeContract({
    raw_text: [
      '创作一条45秒的Kimi K3资讯视频。',
      '目标受众：关注AI模型和编程工具的中文用户。',
      '1. 确认Kimi K3已经在Kimi Work、Kimi Code和Kimi API上线。',
      '2. 核验KDA以及16/896专家激活机制。',
      '3. 明确区分产品已经上线和完整模型权重将在2026年7月27日发布。',
    ].join('\n'),
  }, { duration_sec: 45, aspect_ratio: '9:16', content_mode: 'news' }, NOW);
  assert.equal(contract.audience, '关注AI模型和编程工具的中文用户');
  assert.match(contract.must_cover.map(item => item.text).join('\n'), /完整模型权重将在2026年7月27日发布/);

  const evidencePack = buildEvidencePack(contract, {
    status: 'ready',
    updated_at: NOW,
    sources: [{
      title: 'Kimi K3 official release',
      url: 'https://www.kimi.com/blog/kimi-k3',
      source_type: 'first_party',
      evidence: 'page_body',
      summary: `Kimi K3已经上线。${'产品背景'.repeat(100)}Kimi K3 is available on Kimi Work, Kimi Code and Kimi API。${'架构背景'.repeat(100)}KDA会激活16/896个专家。完整模型权重将在2026年7月27日发布。${'无关正文'.repeat(2000)}`,
    }],
  }, NOW);
  assert.ok(evidencePack.claims.every(claim => claim.text.length <= 1600));
  assert.ok(evidencePack.sources.every(source => source.summary.length <= 1600));
  assert.match(evidencePack.claims.find(claim => claim.requirement_ids.includes('req_02')).text, /Kimi Code.*Kimi API/);
  assert.match(evidencePack.claims.find(claim => claim.requirement_ids.includes('req_03')).text, /16\/896/);
  assert.match(evidencePack.claims.find(claim => claim.requirement_ids.includes('req_04')).text, /2026年7月27日/);
}

async function testDirectEvidenceLinkIsFetched() {
  const statusUrl = 'https://x.com/thsottiaux/status/2077114635308986427';
  const contract = buildCreativeContract({
    raw_text: `制作核验视频。制作前必须联网查证：确认Tibo原帖链接和发布时间。来源：${statusUrl}`,
  }, { duration_sec: 30 }, NOW);
  const queries = [];
  const result = await runResearchProvider({
    query: contract.objective,
    now: NOW,
    creativeContract: contract,
    fetchEvidencePages: true,
    webSearchProvider: async ({ query }) => {
      queries.push(query);
      return { results: [] };
    },
    fetchImpl: async url => {
      assert.match(String(url), /publish\.twitter\.com\/oembed/);
      return {
        ok: true,
        json: async () => ({
          author_name: 'Tibo Sottiaux',
          html: '<blockquote>Tibo发布了Codex用户规模原帖，并说明统计口径。</blockquote>',
        }),
      };
    },
    aiTextModel: {
      callTextModel: async () => ({ success: true, text: '已读取用户提供的原帖。' }),
    },
  });
  assert.ok(queries.length >= 1);
  assert.equal(contract.reference_urls[0], statusUrl);
  assert.equal(result.sources[0].url, statusUrl);
  assert.equal(result.sources[0].evidence, 'original_post');
  assert.match(result.sources[0].published_at, /^20\d{2}-/);
}

async function testWorkflowWaitsForCriticalEvidence() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-pipeline-v2-'));
  const mediaRoot = path.join(rootDir, 'media');
  let agentCalled = false;
  const services = {
    now: () => NOW,
    idFactory: () => '202607170800000001',
    appSettings: {
      getCreativeDefaults: async () => ({
        aspectRatio: '9:16',
        targetDurationSec: 30,
        fps: 30,
        useResearch: true,
        generateAudio: true,
        generateCaptions: true,
        sourceImageAnalysisEnabled: false,
        templateByAspectRatio: { '9:16': 'news_signal_vertical' },
      }),
      getEffectiveSystemSettings: async () => ({ skipValidation: false }),
    },
    aiModelConfig: { getRuntimeConfig: async () => ({}) },
    researchService: {
      createResearchContext: async ({ query, now }) => ({
        status: 'ready',
        query,
        updated_at: now,
        summary: '只找到无关官方资料。',
        sources: [{
          title: 'Nextdoor case',
          url: 'https://openai.com/example',
          source_type: 'first_party',
          evidence: 'page_body',
          summary: 'OpenAI介绍Nextdoor案例，与Tibo原帖及用户口径无关。',
        }],
      }),
    },
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => {
        agentCalled = true;
        return { success: false };
      },
    },
  };
  const created = await createCreativeWorkflow({
    input: '创作30秒核验视频。制作前必须联网查证：确认Tibo原帖链接和发布时间；核实800万活跃用户的统计口径。',
    useResearch: true,
  }, { rootDir, mediaRoot, services });
  const result = await runCreativeWorkflow(created.workflow_id, { rootDir, mediaRoot, services });
  assert.equal(result.status, 'needs_input');
  assert.equal(result.execution_status, 'waiting_input');
  assert.equal(result.product_status, 'research_incomplete');
  assert.equal(agentCalled, false);
}

async function testChineseRequirementCanUseCombinedEvidence() {
  const contract = buildCreativeContract({
    raw_text: '制作资讯视频。逐项核验并准确区分：仅暂停C端新用户订阅，还是暂停所有用户购买新套餐。',
  }, { duration_sec: 30 }, NOW);
  const pack = buildEvidencePack(contract, {
    status: 'ready',
    updated_at: NOW,
    sources: [{
      title: 'Kimi暂停C端新用户订阅',
      url: 'https://example.com/news',
      source_type: 'media',
      evidence: 'page_body',
      summary: 'Kimi决定即日起暂停C端新用户订阅，现有订阅用户权益不受影响。',
    }, {
      title: '关于套餐调整的说明',
      url: 'https://www.kimi.com/help',
      source_type: 'first_party',
      evidence: 'page_body',
      summary: '受算力限制，新套餐目前暂未开放购买，具体开放时间待定。',
    }],
  }, NOW);
  assert.equal(pack.coverage.status, 'ready');
  assert.equal(pack.coverage.missing_critical_requirement_ids.length, 0);
  assert.ok(pack.claims.some(claim => claim.source_ids.length > 0));
}

(async () => {
  await testRegressionFixture();
  await testEvidenceEditorialAndQualityPass();
  await testKimiContractAndEvidenceCompaction();
  await testDirectEvidenceLinkIsFetched();
  await testWorkflowWaitsForCriticalEvidence();
  await testChineseRequirementCanUseCombinedEvidence();
  console.log('creative pipeline v2 tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
