import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { installSkill, resolveClients } from '../scripts/install-musedock-skill.mjs';

const skillPath = path.resolve('integrations/skills/musedock-video/SKILL.md');
const skill = await readFile(skillPath, 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]+?)\n---\n/);

assert.ok(frontmatter, 'skill should contain YAML frontmatter');
const metadata = YAML.parse(frontmatter[1]);
assert.equal(metadata.name, 'musedock-video');
assert.match(metadata.description, /Generate.*high-quality videos.*MuseDock MCP server/i);
assert.match(metadata.compatibility, /MCP server named musedock/);
assert.ok(skill.split('\n').length < 500, 'SKILL.md should remain concise');
assert.match(skill, /MuseDock MCP server/);
for (const tool of [
  'check_system', 'analyze_video_idea', 'compose_video_prompt', 'create_video',
  'inspect_video', 'update_scene', 'propose_video_edit', 'generate_edit_drafts',
  'create_scene_preview', 'regenerate_narration', 'create_video_preview', 'export_video', 'get_operation',
]) assert.match(skill, new RegExp(`\\b${tool}\\b`), `skill should reference ${tool}`);
assert.match(skill, /15–30 seconds/);
assert.match(skill, /REVISION_CONFLICT/);
assert.match(skill, /Never bypass MuseDock QA/);
assert.doesNotMatch(skill, /curl\s+http/i);
for (const reference of ['options.md', 'editing.md']) {
  assert.match(skill, new RegExp(`references/${reference.replace('.', '\\.')}`));
  await readFile(path.resolve('integrations/skills/musedock-video/references', reference), 'utf8');
}

assert.deepEqual(resolveClients('all'), ['codex', 'claude', 'cursor']);
assert.deepEqual(resolveClients('codex'), ['codex']);
assert.throws(() => resolveClients('unknown'), /用法/);

const homeDir = await mkdtemp(path.join(tmpdir(), 'musedock-skill-test-'));
try {
  const installed = await installSkill('codex', { homeDir });
  const installedSkill = await readFile(path.join(installed, 'SKILL.md'), 'utf8');
  assert.match(installedSkill, /musedock-video-skill/);

  await installSkill('codex', { homeDir });

  const unmanaged = path.join(homeDir, '.claude', 'skills', 'musedock-video');
  await mkdir(unmanaged, { recursive: true });
  await writeFile(path.join(unmanaged, 'SKILL.md'), 'user owned skill', 'utf8');
  await assert.rejects(() => installSkill('claude', { homeDir }), /停止覆盖/);
} finally {
  await rm(homeDir, { recursive: true, force: true });
}

console.log('musedock video skill tests passed');
