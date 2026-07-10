import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const guidance = read('frontend-react/src/components/creative/CreativeGuidanceDialog.jsx');
const composer = read('frontend-react/src/components/creative/CreativeComposer.jsx');
const page = read('frontend-react/src/pages/OneClickCreativePage.jsx');
const detail = read('frontend-react/src/components/creative/CreativeTaskDetail.jsx');
const client = read('frontend-react/src/api/client.js');

assert.match(client, /analyzeCreativeGuidance\s*\(/);
assert.match(client, /\/api\/creative-workflows\/guidance\/analyze/);
assert.match(client, /composeCreativeGuidance\s*\(/);
assert.match(client, /\/api\/creative-workflows\/guidance\/compose/);

assert.match(guidance, /musedock\.creative\.guidanceDraft\.v1/);
assert.match(guidance, /交给 AI 决定/);
assert.match(guidance, /自定义要求/);
assert.match(guidance, /查看更多选项/);
assert.match(guidance, /跳过/);
assert.match(guidance, /生成最终提示词/);
assert.match(guidance, /应用到输入框/);
assert.match(guidance, /maxLength=\{1000\}/);
assert.match(guidance, /api\.analyzeCreativeGuidance/);
assert.match(guidance, /api\.composeCreativeGuidance/);
assert.match(guidance, /saveGuidanceDraft\(null\)/);
assert.match(guidance, /researchQuery:\s*result\.research_query/);
assert.match(guidance, /建议检索/);

assert.match(composer, /生成创作方案/);
assert.match(composer, /重新优化创作方案/);
assert.match(composer, /<CreativeGuidanceDialog/);
assert.match(composer, /onApply=\{applyGuidedPrompt\}/);
assert.match(composer, /aria-label="一键生成视频"/);
assert.match(composer, /title="直接使用当前输入框内容一键生成视频"/);
assert.match(composer, /max-h-\[45vh\]/);
assert.match(composer, /完整创作提示词已回填/);

assert.match(page, /const \[guidedPromptMeta, setGuidedPromptMeta\] = useState\(null\)/);
assert.match(page, /input:\s*submittedPrompt,[\s\S]*submittedPrompt,/);
assert.match(page, /promptOrigin:\s*guidedPromptMeta\?\.generatedPrompt/);
assert.match(page, /researchQuery:\s*guidedPromptMeta\?\.researchQuery/);
assert.match(page, /'guided_edited'/);
assert.match(page, /onApplyGuidedPrompt=\{applyGuidedPrompt\}/);
assert.match(page, /setGuidedPromptMeta\(null\)/);

assert.match(detail, /workflow\?\.prompt_snapshot/);
assert.match(detail, /typeof promptSnapshot\.submitted_prompt === 'string'/);
assert.match(detail, /本次实际提交提示词/);
assert.match(detail, /由创作方案生成后手动修改/);
assert.match(detail, /点击“一键生成视频”时输入框中的完整文本/);

console.log('creative guidance UI tests passed');
