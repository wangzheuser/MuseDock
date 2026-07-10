import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf8');
const composerSource = readFileSync('frontend-react/src/components/creative/CreativeComposer.jsx', 'utf8');
const startNewTaskMatch = source.match(/function startNewTask\(\) \{[\s\S]*?\n  \}/);

assert.match(source, /useResearchTouched/, 'missing useResearchTouched touched state');
assert.match(source, /api\.getAppSettings\(\)/, 'missing app settings load for creative defaults');
assert.match(source, /api\.getConfigTemplates\(\)/, 'missing template load for run settings');
assert.match(source, /api\.getTtsVoices\(\)/, 'missing TTS voice load for run settings');
assert.match(source, /api\.getAiModels\(\)/, 'missing active model load for run settings');
assert.match(source, /buildCreativeDefaultsOverride/, 'missing creative defaults override builder');
assert.match(source, /hasWorkflowDetail/, 'done task selection should verify workflow detail before stopping polling');
assert.match(source, /task\.status === 'done' && hasWorkflowDetail\(task\.workflow\) \? 'done' : 'polling'/, 'done task without detail should still poll detail');
assert.match(source, /numberInRangeOrFallback/, 'creative overrides should clamp numeric UI values');
assert.match(source, /targetDurationSec,[\s\S]*15,[\s\S]*180/, 'target duration override should be clamped to UI range');
assert.match(source, /frameHtmlConcurrency,[\s\S]*1,[\s\S]*5/, 'frame HTML concurrency override should be clamped to UI range');
assert.match(source, /creativeDefaultsOverride/, 'missing creativeDefaultsOverride request payload');
assert.match(source, /useResearchTouchedRef/, 'missing useResearchTouchedRef guard');
assert.match(source, /savedCreativeDefaultsRef/, 'missing saved defaults ref');
assert.match(source, /setUseResearchTouched\(true\)/, 'missing touched setter in user toggle handler');
assert.ok(startNewTaskMatch, 'missing startNewTask function');
assert.match(
  startNewTaskMatch[0],
  /setCreativeDefaults\(savedCreativeDefaultsRef\.current\)/,
  'startNewTask should reset creative defaults to saved defaults',
);
assert.match(
  startNewTaskMatch[0],
  /setUseResearch\(savedCreativeDefaultsRef\.current\.useResearch !== false\)/,
  'startNewTask should reset useResearch from saved defaults',
);
assert.match(
  startNewTaskMatch[0],
  /useResearchTouchedRef\.current\s*=\s*false/,
  'startNewTask should reset useResearchTouchedRef',
);
assert.match(
  startNewTaskMatch[0],
  /setUseResearchTouched\(false\)/,
  'startNewTask should reset useResearchTouched state',
);
assert.doesNotMatch(
  source,
  /useResearch:\s*useResearch,\s*assetIds/s,
  'request payload should not unconditionally send useResearch before assetIds',
);
assert.match(composerSource, /本次创作设置/, 'composer should expose per-run settings panel');
assert.match(composerSource, /旁白音色/, 'composer should expose TTS voice override');
assert.match(composerSource, /来源图片多模态分析/, 'composer should expose source image analysis override');
assert.match(composerSource, /frameHtmlConcurrency/, 'composer should expose frame HTML concurrency override');

console.log('one click research defaults tests passed');
