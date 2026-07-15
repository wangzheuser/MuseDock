const assert = require('assert');
const phraseTimeline = require('../server/services/tts/phraseTimeline');

function run() {
  const phrases = phraseTimeline.splitChineseCaptionIntoPhrases(
    '输入是什么，输出是什么，规则是什么，哪里需要确认。'
  );

  assert.deepStrictEqual(phrases, [
    '输入是什么',
    '输出是什么',
    '规则是什么',
    '哪里需要确认',
  ]);

  const listPhrases = phraseTimeline.splitChineseCaptionIntoPhrases(
    '处理固定模板、批量命名、拆分文件、汇总数据，本质上都是重复动作。'
  );

  assert.deepStrictEqual(listPhrases, [
    '处理固定模板',
    '批量命名',
    '拆分文件',
    '汇总数据',
    '本质上都是重复动作',
  ]);

  const halfWidthCommaPhrases = phraseTimeline.splitChineseCaptionIntoPhrases(
    '输入是什么, 输出是什么, 规则是什么。'
  );

  assert.deepStrictEqual(halfWidthCommaPhrases, [
    '输入是什么',
    '输出是什么',
    '规则是什么',
  ]);

  const productNamePhrases = phraseTimeline.splitChineseCaptionIntoPhrases(
    '热点检索改写用Luna或Terra，Codex或能在ChatGPT操作无接口软件。'
  );
  assert.equal(productNamePhrases.join(''), '热点检索改写用Luna或TerraCodex或能在ChatGPT操作无接口软件');
  assert.equal(productNamePhrases.some(text => /^(?:rra|T操作)/.test(text)), false);
  assert.ok(productNamePhrases.some(text => text.includes('Terra')));
  assert.ok(productNamePhrases.some(text => text.includes('ChatGPT')));

  const noOrphanPhrases = phraseTimeline.splitChineseCaptionIntoPhrases(
    'Luna定位和价格仅为媒体说法',
  );
  assert.equal(noOrphanPhrases.at(-1), '说法');
  assert.equal(noOrphanPhrases.some(text => [...text].length === 1), false);

  const blocks = phraseTimeline.buildPhraseBlocksFromCaptions([
    {
      index: 3,
      start: 10,
      end: 14,
      duration: 4,
      text: '输入是什么，输出是什么，规则是什么，哪里需要确认。',
    },
  ]);

  assert.deepStrictEqual(blocks.map(block => ({
    id: block.id,
    caption_index: block.caption_index,
    text: block.text,
    start: Number(block.start.toFixed(2)),
    end: Number(block.end.toFixed(2)),
  })), [
    { id: 'cap-3-p1', caption_index: 3, text: '输入是什么', start: 10, end: 11 },
    { id: 'cap-3-p2', caption_index: 3, text: '输出是什么', start: 11, end: 12 },
    { id: 'cap-3-p3', caption_index: 3, text: '规则是什么', start: 12, end: 13 },
    { id: 'cap-3-p4', caption_index: 3, text: '哪里需要确认', start: 13, end: 14 },
  ]);
}

try {
  run();
  console.log('phrase timeline tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
