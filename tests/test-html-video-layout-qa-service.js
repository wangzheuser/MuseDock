const assert = require('assert');
const path = require('path');
const {
  defaultSampleTimes,
  inspectFrameHtmlLayout,
} = require('../server/services/creative-video/html-video/layoutQaService');

const fixtureDir = path.join(__dirname, 'fixtures', 'html-video-layout-qa');
const resolution = { width: 1920, height: 1080 };
const sampleTimesSec = [0.1];

async function inspectFixture(fileName, frame, extraOptions = {}) {
  return inspectFrameHtmlLayout({
    htmlPath: path.join(fixtureDir, fileName),
    frame,
    resolution,
    sampleTimesSec,
    ...extraOptions,
  });
}

(async () => {
  assert.deepEqual(defaultSampleTimes(), [0]);
  assert.deepEqual(defaultSampleTimes(0), [0]);
  assert.deepEqual(defaultSampleTimes(1), [0, 0.35, 0.9]);
  assert.deepEqual(defaultSampleTimes(1.2), [0, 0.35, 0.78, 0.9]);
  assert.deepEqual(defaultSampleTimes(10), [0, 0.35, 1.2, 6.5, 9.7]);
  assert.deepEqual(defaultSampleTimes(1.25), [0, 0.35, 0.8, 0.95]);

  const delayedOpening = await inspectFixture(
    'opening-delayed.html',
    { id: 'scene_opening_delayed', duration_sec: 2 },
    { sampleTimesSec: [0, 0.35, 1.2] },
  );
  assert.equal(delayedOpening.success, false);
  assert.ok(
    delayedOpening.issues.some(issue => issue.code === 'scene_opening_low_information'),
    '主视觉整体延迟入场时应报告 scene_opening_low_information',
  );
  assert.deepEqual(
    delayedOpening.issues
      .filter(issue => issue.code === 'scene_opening_low_information')
      .map(issue => issue.sample_time_sec),
    [0, 0.35],
  );
  assert.equal(delayedOpening.metrics.samples[0].primary_candidate_count, 0);
  assert.ok(delayedOpening.metrics.samples[0].max_visible_visual_area_ratio < 0.04);

  const visibleOpening = await inspectFixture(
    'opening-visible.html',
    { id: 'scene_opening_visible', duration_sec: 2 },
    { sampleTimesSec: [0, 0.35, 1.2] },
  );
  assert.equal(visibleOpening.success, true);
  assert.ok(visibleOpening.metrics.samples[0].primary_candidate_count > 0);

  const overlay = await inspectFixture('overlay-valuation.html', { id: 'scene_06', duration_sec: 1 });
  assert.equal(overlay.metrics.skipped, false);
  assert.equal(overlay.success, false);
  assert.ok(overlay.issues.every(issue => issue.frame_id === 'scene_06'));
  assert.ok(
    overlay.issues.some(issue => issue.code === 'decorative_overlay_text' || issue.code === 'text_overlap'),
    'overlay-valuation.html 应报告 decorative_overlay_text 或 text_overlap',
  );

  const overlayFixed = await inspectFixture('overlay-valuation-fixed.html', { id: 'scene_06', duration_sec: 1 });
  assert.equal(overlayFixed.success, true);

  const overlayTwoSamples = await inspectFixture(
    'overlay-valuation.html',
    { id: 'scene_06', duration_sec: 1 },
    { sampleTimesSec: [0.1, 0.4] },
  );
  assert.equal(overlayTwoSamples.metrics.samples.length, 2);
  assert.equal(
    overlayTwoSamples.issues.length,
    overlay.issues.length,
    '同一问题在多个采样点应只报告一次',
  );

  const decorativeOverlap = await inspectFixture('decorative-overlap.html', { id: 'scene_11', duration_sec: 1 });
  assert.equal(decorativeOverlap.success, true, '装饰大数字垫底标题不应触发阻断式修复');
  assert.ok(
    decorativeOverlap.issues.some(issue => issue.code === 'decorative_overlay_text' && issue.severity === 'warning'),
    'decorative-overlap.html 应报告 warning 级 decorative_overlay_text',
  );

  const overlayFixedDefaultSamples = await inspectFixture(
    'overlay-valuation-fixed.html',
    { scene_id: 'scene_06', duration_sec: 1 },
    { sampleTimesSec: undefined },
  );
  assert.equal(overlayFixedDefaultSamples.success, true);
  assert.deepEqual(
    overlayFixedDefaultSamples.metrics.samples.map(sample => sample.sample_time_sec),
    [0, 0.35, 0.9],
  );

  const overflow = await inspectFixture('overflow-card-title.html', { id: 'scene_04', duration_sec: 1 });
  assert.equal(overflow.success, false);
  assert.ok(
    overflow.issues.some(issue => issue.code === 'text_out_of_container'),
    'overflow-card-title.html 应报告 text_out_of_container',
  );

  const overflowFixed = await inspectFixture('overflow-card-title-fixed.html', { id: 'scene_04', duration_sec: 1 });
  assert.equal(overflowFixed.success, true);

  const playAllOverlap = await inspectFixture('playall-overlap.html', { id: 'scene_07', duration_sec: 1 });
  assert.equal(playAllOverlap.success, false);
  assert.ok(
    playAllOverlap.issues.some(issue => issue.code === 'decorative_overlay_text' || issue.code === 'text_overlap'),
    'playall-overlap.html 应在 __hvPlayAll() 后报告文本重叠',
  );

  const richTextNested = await inspectFixture('rich-text-nested.html', { id: 'scene_08', duration_sec: 1 });
  assert.equal(richTextNested.success, true);

  const divRoleOverflow = await inspectFixture('div-role-overflow.html', { id: 'scene_09', duration_sec: 1 });
  assert.equal(divRoleOverflow.success, false);
  assert.ok(
    divRoleOverflow.issues.some(issue => issue.code === 'text_out_of_container'),
    'div-role-overflow.html 应报告 text_out_of_container',
  );

  const decorativeOverflow = await inspectFixture('decorative-overflow.html', { id: 'scene_10', duration_sec: 1 });
  assert.equal(decorativeOverflow.success, true);
  assert.ok(
    decorativeOverflow.issues.every(issue => issue.severity === 'warning'),
    '装饰编号或允许溢出的品牌字不应触发阻断式修复',
  );
  assert.equal(
    decorativeOverflow.issues.some(issue => issue.details?.text === '忽略的背景字'),
    false,
    'data-layout-ignore 元素应跳过布局检查',
  );

  const sectionContentOverflow = await inspectFixture('section-content-overflow.html', { id: 'scene_12', duration_sec: 1 });
  assert.equal(sectionContentOverflow.success, false, 'section 内的正式结论被裁切时必须阻断');
  assert.ok(sectionContentOverflow.issues.some(issue => (
    issue.code === 'text_out_of_container' && issue.details?.text === '可感知收益成立，再调整'
  )));

  const importFailure = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixtureDir, 'overlay-valuation-fixed.html'),
    frame: { id: 'scene_import_failure', duration_sec: 1 },
    resolution,
    sampleTimesSec,
    importPlaywright: async () => {
      throw new Error('模拟 Playwright import 失败');
    },
  });
  assert.equal(importFailure.success, true);
  assert.equal(importFailure.metrics.skipped, true);
  assert.ok(importFailure.issues.some(issue => issue.code === 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED'));

  const launchFailure = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixtureDir, 'overlay-valuation-fixed.html'),
    frame: { id: 'scene_launch_failure', duration_sec: 1 },
    resolution,
    sampleTimesSec,
    playwright: {
      chromium: {
        launch: async () => {
          throw new Error('模拟 Chromium 启动失败');
        },
      },
    },
  });
  assert.equal(launchFailure.success, true);
  assert.equal(launchFailure.metrics.skipped, true);
  assert.ok(launchFailure.issues.some(issue => issue.code === 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED'));

  console.log('html-video layout QA service tests passed');
})();
