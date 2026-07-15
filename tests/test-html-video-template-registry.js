const assert = require('assert');
const fs = require('fs');
const path = require('path');

const registry = require('../server/services/creative-video/html-video/templateRegistry');

const fixturesDir = path.resolve(__dirname, 'fixtures/html-video-templates');
const productionTemplatesDir = path.resolve(__dirname, '../server/templates');

const manifests = registry.scanTemplateManifests(fixturesDir);
assert.ok(manifests.some(item => item.id === 'commercial_hyperframes'));
assert.ok(manifests.some(item => item.id === 'noncommercial_hyperframes'));
assert.ok(manifests.some(item => item.id === 'remotion_template'));
assert.ok(manifests.some(item => item.id === 'script_source'));

const compactDefault = registry.buildCompactIndex(fixturesDir);
assert.deepEqual(compactDefault.map(item => item.id), ['commercial_hyperframes']);
assert.deepEqual(Object.keys(compactDefault[0]).sort(), [
  'aspect_ratio',
  'assets_attribution',
  'attribution_required',
  'best_for',
  'category',
  'description',
  'duration_sec',
  'engine',
  'evidence_policy',
  'id',
  'inputs',
  'license',
  'mapped_engine',
  'name',
  'not_for',
  'output',
  'scene_roles',
  'source_entry',
  'supported_aspects',
  'tags',
  'visual_family',
].sort());
assert.equal(compactDefault[0].mapped_engine, 'hyperframes-playwright');
assert.equal(compactDefault[0].aspect_ratio, '16:9');
assert.equal(compactDefault[0].duration_sec, 8);
assert.equal(compactDefault[0].attribution_required, true);
assert.equal(compactDefault[0].source_entry, 'index.html');
assert.equal(compactDefault[0].license.commercial_use, true);
assert.equal(compactDefault[0].license.attribution_required, true);
assert.equal(compactDefault[0].sourceHtml, undefined);

const statefulRegistry = registry.createTemplateRegistry({ rootDir: fixturesDir });
assert.deepEqual(statefulRegistry.scanTemplates().map(item => item.id).sort(), manifests.map(item => item.id).sort());
assert.deepEqual(statefulRegistry.listTemplates().map(item => item.id), ['commercial_hyperframes']);
assert.equal(statefulRegistry.hasTemplate('commercial_hyperframes'), true);
assert.equal(statefulRegistry.hasTemplate('noncommercial_hyperframes'), false);
assert.equal(statefulRegistry.getTemplate('commercial_hyperframes').id, 'commercial_hyperframes');

assert.deepEqual(
  statefulRegistry.buildCompactIndex({ aspectRatio: '16:9', durationSec: 8 }).map(item => item.id),
  ['commercial_hyperframes']
);

assert.deepEqual(
  statefulRegistry.buildCompactIndex({ aspect_ratio: '9:16', duration: 8 }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { commercialOnly: false }).map(item => item.id).sort(),
  ['commercial_hyperframes', 'noncommercial_hyperframes'].sort()
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { engines: ['remotion'], commercialOnly: false }).map(item => item.id),
  ['remotion_template']
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { aspects: ['9:16'] }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { durationSec: 3 }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { duration: 3 }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { licenseAllow: ['Apache-2.0'] }).map(item => item.id),
  ['commercial_hyperframes']
);

const failures = [
  {
    manifest: manifests.find(item => item.id === 'remotion_template'),
    field: 'engine',
    text: '当前不支持该模板引擎',
  },
  {
    manifest: manifests.find(item => item.id === 'script_source'),
    field: 'source_entry',
    text: 'source_entry 必须指向 HTML 文件',
  },
  {
    manifest: manifests.find(item => item.id === 'noncommercial_hyperframes'),
    field: 'license',
    text: '模板授权不允许商业使用',
  },
  {
    manifest: manifests.find(item => item.id === 'commercial_hyperframes'),
    options: { aspects: ['1:1'] },
    field: 'aspect',
    text: '模板不支持目标画幅',
  },
  {
    manifest: manifests.find(item => item.id === 'commercial_hyperframes'),
    options: { durationSec: 30 },
    field: 'duration',
    text: '模板不支持目标时长',
  },
  {
    manifest: manifests.find(item => item.id === 'missing_source_entry'),
    field: 'source_entry',
    text: 'source_entry 指向的文件不存在',
  },
];

failures.forEach(({ manifest, options, field, text }) => {
  const result = registry.validateTemplateCompatibility(manifest, options);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some(item => item.field === field && item.message.includes(text)), field);
});

const productionIndex = registry.buildCompactIndex(productionTemplatesDir);
const productionManifests = registry.scanTemplateManifests(productionTemplatesDir);
const productionIds = productionIndex.map(item => item.id).sort();
const expectedProductionIds = [
  'bold_poster',
  'bold_signal',
  'creative_voltage',
  'data_chart',
  'glitch_title',
  'light_leak',
  'liquid_hero',
  'news_signal_vertical',
  'pentagram_stat',
  'portrait_cinematic_story',
  'portrait_data_story',
  'portrait_editorial_explainer',
  'portrait_product_steps',
  'square_compare_grid',
  'square_editorial_cards',
  'square_product_spotlight',
  'square_quote_signal',
  'vertical_editorial_digest',
  'vertical_process_steps',
  'vertical_product_demo',
  'vertical_story_quote',
];
assert.deepEqual(productionIds, expectedProductionIds.sort());
const defaultIndex = registry.buildCompactIndex();
for (const id of expectedProductionIds) {
  assert.ok(defaultIndex.some(item => item.id === id), `default index should include ${id}`);
}
if (require('fs').existsSync(registry.DEFAULT_EXTERNAL_ROOT_DIR)) {
  assert.ok(defaultIndex.some(item => item.id === 'frame-bold-signal'), 'default index should include adjacent html-video templates');
}
const defaultRegistry = registry.createTemplateRegistry();
for (const template of productionIndex) {
  assert.ok(template.best_for.length > 0, `${template.id} should describe best_for`);
  assert.ok(template.not_for.length > 0, `${template.id} should describe not_for`);
  assert.ok(template.scene_roles.length > 0, `${template.id} should describe scene_roles`);
  assert.ok(template.visual_family, `${template.id} should describe visual_family`);
  assert.deepEqual(template.output.duration_range_sec, [2, 90]);
  const manifest = productionManifests.find(item => item.id === template.id);
  assert.equal(manifest.preview.poster, 'preview/poster.jpg', `${template.id} should declare preview poster`);
  assert.ok(fs.existsSync(path.join(productionTemplatesDir, template.id, manifest.preview.poster)), `${template.id} preview poster should exist`);
}

const expectedAspectCoverage = {
  '9:16': 5,
  '16:9': 8,
  '1:1': 4,
  '4:5': 4,
};
for (const [aspectRatio, minimumCount] of Object.entries(expectedAspectCoverage)) {
  const aspectTemplates = defaultRegistry.buildCompactIndex({ aspect_ratio: aspectRatio });
  assert.ok(aspectTemplates.length >= minimumCount, `${aspectRatio} should include at least ${minimumCount} templates`);
  assert.ok(new Set(aspectTemplates.map(item => item.category)).size >= 3, `${aspectRatio} should cover at least 3 categories`);
  assert.equal(new Set(aspectTemplates.map(item => item.visual_family)).size, aspectTemplates.length, `${aspectRatio} should not duplicate visual families`);
}

const generatedTemplateIds = expectedProductionIds.filter(id => (
  id.startsWith('vertical_') || id.startsWith('square_') || id.startsWith('portrait_')
));
for (const id of generatedTemplateIds) {
  const template = productionIndex.find(item => item.id === id);
  const sourcePath = path.join(productionTemplatesDir, id, template.source_entry);
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /data-hv-canvas/);
  assert.match(source, new RegExp(`data-width="${template.output.resolution.width}"`));
  assert.match(source, new RegExp(`data-height="${template.output.resolution.height}"`));
  assert.match(source, /data-hv-bind="headline"/);
  assert.match(source, /@keyframes\s+reveal/);
  if (id.startsWith('square_')) assert.match(source, /footer\{[^}]*bottom:290px/);
  if (id.startsWith('portrait_')) assert.match(source, /footer\{[^}]*bottom:330px/);
  if (id.startsWith('vertical_')) assert.match(source, /footer\{[^}]*bottom:365px/);
}

for (const id of ['bold_poster', 'creative_voltage', 'data_chart', 'light_leak', 'liquid_hero', 'pentagram_stat']) {
  const template = productionIndex.find(item => item.id === id);
  const sourcePath = path.join(productionTemplatesDir, id, template.source_entry);
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /data-hv-canvas/);
  assert.match(source, /const bindings=/);
  assert.doesNotMatch(source, /gsap\.min\.js/);
}

for (const id of ['bold_signal', 'glitch_title']) {
  const template = productionIndex.find(item => item.id === id);
  assert.equal(template.engine, 'hyperframes');
  assert.equal(template.source_entry, 'source/index.html');
  assert.equal(template.output.resolution.width, 1920);
  assert.equal(template.output.resolution.height, 1080);
  assert.equal(Number(template.output.fps), 30);
  assert.ok(Number(template.duration_sec) > 0);
  assert.ok(template.inputs.schema && Object.keys(template.inputs.schema).length > 0);
  assert.equal(template.license.commercial_use, true);
  assert.ok(Array.isArray(template.assets_attribution));
}

console.log('html-video template registry tests passed');
