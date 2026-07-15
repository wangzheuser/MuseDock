const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agent/agentRuns');
const { compressFreeformNarrationDeterministically } = require('../server/services/agent/agentRunsFreeformHelpers');
const narrationBudget = require('../server/services/storyboard/storyboardNarrationBudget');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-budget-'));
  const awemeId = '20260625112010037731';
  const runId = '20260625-freeform-budget';
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  fs.mkdirSync(runDir, { recursive: true });

  const scenes = Array.from({ length: 7 }, (_, index) => ({
    index: index + 1,
    headline: `第 ${index + 1} 幕`,
    narration_text: `第${index + 1}幕。${'这是一段明显超过六十秒总预算的口播内容'.repeat(12)}。`,
  }));
  const originalChars = scenes.reduce((sum, scene) => sum + narrationBudget.countNarrationChars(scene.narration_text), 0);

  fs.writeFileSync(path.join(runDir, `${runId}.json`), JSON.stringify({
    success: true,
    run_id: runId,
    template: 'hyperframes_freeform',
    aweme_id: awemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '预算测试',
          storyboard: { scenes },
        },
      },
    },
  }, null, 2));

  let capturedScenes = null;
  const result = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, runId, {
    rootDir,
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        capturedScenes = scenes;
        return {
          success: true,
          message: 'ok',
          scene_tts: {
            status: 'done',
            duration: scenes.length,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: 1,
              speech_duration_sec: 1,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: 1, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.ok(capturedScenes);
  const fittedChars = capturedScenes.reduce((sum, scene) => sum + narrationBudget.countNarrationChars(scene.narration_text), 0);
  assert.ok(fittedChars < originalChars);
  assert.ok(fittedChars <= 270);

  const persisted = JSON.parse(fs.readFileSync(path.join(runDir, `${runId}.json`), 'utf8'));
  const persistedScenes = persisted.hyperframes_freeform.brief.data.storyboard.scenes;
  assert.deepEqual(
    persistedScenes.map(scene => scene.narration_text),
    capturedScenes.map(scene => scene.narration_text),
  );
  assert.equal(persisted.hyperframes_freeform.brief.data.narration_budget.status, 'ok');

  const semanticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-semantic-budget-'));
  const semanticAwemeId = '20260626061707994796';
  const semanticRunId = 'semantic-budget';
  const semanticRunDir = path.join(semanticRoot, semanticAwemeId, 'agent_runs');
  fs.mkdirSync(semanticRunDir, { recursive: true });
  const semanticScenes = [
    { index: 1, headline: '开场', narration_text: 'npm、Yarn、pnpm都是Node.js的包管理器。' },
    {
      index: 2,
      headline: '结尾',
      target_duration_sec: 3,
      narration_text: '如果你正在启动新项目，pnpm 通常是目前最均衡的选择。',
    },
  ];
  fs.writeFileSync(path.join(semanticRunDir, `${semanticRunId}.json`), JSON.stringify({
    success: true,
    run_id: semanticRunId,
    template: 'hyperframes_freeform',
    aweme_id: semanticAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '语义预算测试',
          target_duration_sec: 60,
          storyboard: { scenes: semanticScenes },
        },
      },
    },
  }, null, 2));

  let semanticCaptured = null;
  const semanticResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(semanticAwemeId, semanticRunId, {
    rootDir: semanticRoot,
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        semanticCaptured = scenes;
        return {
          success: true,
          message: 'ok',
          scene_tts: {
            status: 'done',
            duration: 12,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: scene.index === 2 ? 6 : 4,
              speech_duration_sec: scene.index === 2 ? 6 : 4,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: scene.index === 2 ? 6 : 4, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(semanticResult.success, true);
  assert.equal(semanticCaptured[1].narration_text, '如果你正在启动新项目，pnpm 通常是目前最均衡的选择。');

  const repairRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-compression-repair-'));
  const repairAwemeId = '20260714085712983907';
  const repairRunId = 'compression-repair';
  const repairRunDir = path.join(repairRoot, repairAwemeId, 'agent_runs');
  fs.mkdirSync(repairRunDir, { recursive: true });
  fs.writeFileSync(path.join(repairRunDir, `${repairRunId}.json`), JSON.stringify({
    success: true,
    run_id: repairRunId,
    template: 'hyperframes_freeform',
    aweme_id: repairAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 10 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '压缩残句自动修复测试',
          target_duration_sec: 10,
          storyboard: {
            scenes: [
              { index: 1, narration_text: '这是第一段明显超出十秒预算的旁白，需要压缩后再进入配音流程。' },
              { index: 2, narration_text: '这是第二段同样过长的旁白，用于确保总字数必然触发模型压缩。' },
            ],
          },
        },
      },
    },
  }, null, 2));

  let repairModelCalls = 0;
  let repairedScenes = null;
  const repairResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(repairAwemeId, repairRunId, {
    rootDir: repairRoot,
    aiTextModel: {
      callTextModel: async () => {
        repairModelCalls += 1;
        if (repairModelCalls === 1) {
          return {
            success: true,
            text: JSON.stringify({
              scenes: [
                { index: 1, narration_text: '如果创作者要比较。' },
                { index: 2, narration_text: '统一记录成本。' },
              ],
            }),
          };
        }
        return {
          success: true,
          text: JSON.stringify({
            scenes: [{ index: 1, narration_text: '如果要比较，先统一提示词。' }],
          }),
        };
      },
    },
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        repairedScenes = scenes;
        return {
          success: true,
          message: 'ok',
          scene_tts: {
            status: 'done',
            duration: 4,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: 2,
              speech_duration_sec: 2,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: 2, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(repairResult.success, true);
  assert.equal(repairModelCalls, 2);
  assert.equal(repairedScenes[0].narration_text, '如果要比较，先统一提示词。');

  const fallback = compressFreeformNarrationDeterministically([
    { index: 1, narration_text: '7月9日，OpenAI 官方发布 GPT-5.6，强调性能和高难任务。' },
    { index: 2, narration_text: '同一选题，同一提示词，同一评分表，再比较返工次数。' },
  ], {
    scenes: [
      { index: 1, max_recommended_chars: 22 },
      { index: 2, max_recommended_chars: 18 },
    ],
  }, 12);
  assert.equal(fallback.success, true);
  assert.equal(fallback.fallback_used, true);
  assert.ok(fallback.scenes.every(scene => /[。！？!?]$/.test(scene.narration_text)));

  console.log('agent runs freeform audio budget tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
