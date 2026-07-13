const assert = require('assert/strict');

const {
  defaultResearchProvider,
  defaultWebSearchProvider,
} = require('../server/services/creative/creativeWorkflows');
const {
  buildTimeGroundedSearchQuery,
  normalizeSearchResults,
  parseSogouResults,
} = require('../server/services/creative/creativeResearchProvider');

async function run() {
  assert.equal(
    buildTimeGroundedSearchQuery('美国 伊朗 冲突 最新消息', '2026-07-13T08:00:00.000Z'),
    '美国 伊朗 冲突 最新消息 2026-07-13',
  );
  assert.deepEqual(normalizeSearchResults({ results: [
    { title: '无关制作教程', url: 'https://example.com/video', summary: '如何制作短视频' },
    { title: '美国与伊朗局势更新', url: 'https://example.com/iran', summary: '2 小时之前发布的局势更新' },
    { title: '重复结果', url: 'https://example.com/iran', summary: '重复' },
  ] }, '美国 伊朗 冲突 最新消息', '2026-07-13T08:00:00.000Z'), [{
    title: '美国与伊朗局势更新',
    url: 'https://example.com/iran',
    summary: '2 小时之前发布的局势更新',
    published_at: '2026-07-13T06:00:00.000Z',
  }]);
  assert.deepEqual(parseSogouResults(`
    <div class="vrwrap"><h3 class="vr-title"><a href="/link">美军称对<em>伊朗</em>发起新一轮打击</a></h3>
    <div class="fz-mid space-txt base-ellipsis">美国东部时间12日开始对伊朗发动打击。</div>
    <a class="citeLinkClass"><span>中国网</span><span>news.china.com.cn</span><span>今天</span></a>
    <div data-url="https://news.china.com.cn/2026-07/13/example.shtml"></div></div><!--STATUS VR OK-->
  `, 5), [{
    title: '美军称对 伊朗 发起新一轮打击',
    url: 'https://news.china.com.cn/2026-07/13/example.shtml',
    summary: '美国东部时间12日开始对伊朗发动打击。',
    published_at: '今天',
  }]);

  const search = await defaultWebSearchProvider({
    query: 'OpenAI 新闻',
    limit: 2,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => `
        <html><body>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fnews%2F" class='result-link'>OpenAI News</a>
          <td class='result-snippet'>Official OpenAI news.</td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fnews%2Fproduct%2Dreleases%2F" class='result-link'>OpenAI Product Releases</a>
          <td class='result-snippet'>Product updates from OpenAI.</td>
        </body></html>
      `,
    }),
  });
  assert.deepEqual(search.results, [
    {
      title: 'OpenAI News',
      url: 'https://openai.com/news/',
      summary: 'Official OpenAI news.',
    },
    {
      title: 'OpenAI Product Releases',
      url: 'https://openai.com/news/product-releases/',
      summary: 'Product updates from OpenAI.',
    },
  ]);

  const calls = [];
  let searchCalls = 0;
  const result = await defaultResearchProvider({
    query: 'OpenAI 最新产品新闻',
    aiModelConfig: {
      getRuntimeConfig: async () => ({ modelId: 'gpt-5.5' }),
    },
    aiTextModel: {
      callTextModel: async request => {
        calls.push(request);
        assert.equal(request.tools, undefined);
        assert.equal(request.tool_choice, undefined);
        assert.ok(request.messages.some(message => message.content.includes('https://openai.com/news/')));
        return {
          success: true,
          text: 'OpenAI 发布了最新产品动态，详见官方来源。',
          raw_response: { choices: [{ message: { content: 'OpenAI 发布了最新产品动态，详见官方来源。' } }] },
        };
      },
    },
    webSearchProvider: async ({ query, limit }) => {
      searchCalls += 1;
      assert.equal(query, 'OpenAI 最新产品新闻');
      assert.equal(limit, 5);
      return {
        results: [{
          title: 'OpenAI News',
          url: 'https://openai.com/news/',
          summary: 'OpenAI 官方产品新闻页面。',
        }],
      };
    },
  });

  assert.equal(result.summary, 'OpenAI 发布了最新产品动态，详见官方来源。');
  assert.deepEqual(result.sources, [{
    title: 'OpenAI News',
    url: 'https://openai.com/news/',
    summary: 'OpenAI 官方产品新闻页面。',
  }]);
  assert.equal(searchCalls, 1);
  assert.equal(calls.length, 1);

  const longResearchQuery = '疑似触发供应商风控的话题\n这里是很长的正文，不应该整段拿去搜索。';
  const fallbackCalls = [];
  const fallbackSearchQueries = [];
  const fallback = await defaultResearchProvider({
    query: longResearchQuery,
    aiTextModel: {
      callTextModel: async request => {
        fallbackCalls.push(request);
        assert.equal(request.tools, undefined);
        assert.equal(request.tool_choice, undefined);
        return { success: false, message: 'provider 调用失败：HTTP 400' };
      },
    },
    webSearchProvider: async ({ query }) => {
      fallbackSearchQueries.push(query);
      return {
        results: [{
          title: query === longResearchQuery ? '全文搜索结果' : '短主题搜索结果',
          url: query === longResearchQuery ? 'https://example.com/full' : 'https://example.com/short',
          summary: '供应商拒绝总结时仍应保留搜索来源。',
        }],
      };
    },
  });
  assert.deepEqual(fallbackSearchQueries, ['疑似触发供应商风控的话题']);
  assert.equal(fallbackCalls.length, 1);
  assert.doesNotMatch(fallbackCalls[0].messages[1].content, /这里是很长的正文/);
  assert.match(fallback.summary, /短主题搜索结果/);
  assert.deepEqual(fallback.sources, [{
    title: '短主题搜索结果',
    url: 'https://example.com/short',
    summary: '供应商拒绝总结时仍应保留搜索来源。',
  }]);

  console.log('creative research provider tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
