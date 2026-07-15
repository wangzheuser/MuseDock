const assert = require('assert/strict');

const {
  defaultResearchProvider,
  defaultWebSearchProvider,
} = require('../server/services/creative/creativeWorkflows');
const {
  buildTimeGroundedSearchQuery,
  buildResearchSearchQueries,
  classifyResearchSource,
  extractSiteFilters,
  normalizeSearchResults,
  parseRssResults,
  parseSogouResults,
  resolveFirstPartyDomain,
  searchOfficialSitemap,
} = require('../server/services/creative/creativeResearchProvider');

async function run() {
  assert.equal(
    buildTimeGroundedSearchQuery('美国 伊朗 冲突 最新消息', '2026-07-13T08:00:00.000Z'),
    '美国 伊朗 冲突 最新消息 2026-07-13',
  );
  assert.deepEqual(
    buildResearchSearchQueries('GPT-5.6 最新发布', '2026-07-13T08:00:00.000Z').map(item => item.channel),
    ['general', 'primary', 'community', 'social'],
  );
  const chineseAiQueries = buildResearchSearchQueries(
    '过去24小时 AI 模型 产品 平台 更新 负责人 社交媒体 创作者工作流',
    '2026-07-14T08:00:00.000Z',
  );
  assert.match(chineseAiQueries.find(item => item.channel === 'community').query, /OpenAI.*Anthropic/);
  assert.match(chineseAiQueries.find(item => item.channel === 'social').query, /OpenAI.*Anthropic/);
  assert.doesNotMatch(chineseAiQueries.find(item => item.channel === 'social').query, /^\s*site:/);
  const gptModelQueries = buildResearchSearchQueries(
    'GPT-5.6 Sol Terra Luna launched official model comparison creator workflow July 2026',
    '2026-07-14T08:00:00.000Z',
  );
  assert.match(gptModelQueries.find(item => item.channel === 'primary').query, /site:openai\.com/);
  assert.doesNotMatch(gptModelQueries.find(item => item.channel === 'primary').query, /site:launched\.com/);
  assert.equal(resolveFirstPartyDomain('Claude 5 latest release'), 'anthropic.com');
  assert.equal(resolveFirstPartyDomain('launched official model comparison'), '');
  assert.equal(classifyResearchSource({ url: 'https://openai.com/index/gpt-5-6/' }, 'OpenAI GPT-5.6'), 'first_party');
  assert.equal(classifyResearchSource({ url: 'https://launched.com/post' }, 'GPT-5.6 launched official model'), 'media');
  assert.equal(classifyResearchSource({ url: 'https://www.reddit.com/r/codex/' }, 'OpenAI GPT-5.6'), 'community');
  assert.deepEqual(extractSiteFilters('GPT-5.6 site:openai.com'), ['openai.com']);
  assert.deepEqual(normalizeSearchResults({ results: [
    { title: '错误站点', url: 'https://example.com/openai', summary: 'GPT-5.6 OpenAI' },
    { title: '官方站点', url: 'https://openai.com/index/gpt-5-6/', summary: 'GPT-5.6 OpenAI' },
  ] }, 'GPT-5.6 OpenAI site:openai.com'), [{
    title: '官方站点',
    url: 'https://openai.com/index/gpt-5-6/',
    summary: 'GPT-5.6 OpenAI',
  }]);
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

  assert.deepEqual(parseRssResults(`
    <rss><channel><item>
      <title><![CDATA[GPT-5.6 正式发布]]></title>
      <description><![CDATA[三档模型面向不同任务。]]></description>
      <link>https://openai.com/index/gpt-5-6</link>
      <pubDate>Thu, 09 Jul 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>
  `), [{
    title: 'GPT-5.6 正式发布',
    url: 'https://openai.com/index/gpt-5-6',
    summary: '三档模型面向不同任务。',
    published_at: '2026-07-09T10:00:00.000Z',
    evidence: 'official_feed',
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

  const sitemap = await searchOfficialSitemap({
    query: 'GPT-5.6 OpenAI site:openai.com',
    fetchImpl: async url => ({
      ok: !url.endsWith('/rss.xml'),
      text: async () => {
        if (url === 'https://openai.com/sitemap.xml') {
          return '<sitemapindex><loc>https://openai.com/sitemap.xml/release/</loc></sitemapindex>';
        }
        if (url.includes('/sitemap.xml/')) {
          return '<urlset><loc>https://openai.com/index/gpt-5-6/</loc></urlset>';
        }
        return '<html><head><title>GPT-5.6 发布</title></head><body><main>官方页面正文：7 月 9 日发布 GPT-5.6。</main></body></html>';
      },
    }),
  });
  assert.equal(sitemap[0].url, 'https://openai.com/index/gpt-5-6/');
  assert.equal(sitemap[0].evidence, 'official_page');
  assert.match(sitemap[0].summary, /7 月 9 日发布/);

  const calls = [];
  const searchQueries = [];
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
      searchQueries.push(query);
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
    discovery_channel: 'primary',
    source_type: 'first_party',
  }]);
  assert.equal(searchQueries.length, 4);
  assert.ok(searchQueries.some(query => query.includes('site:openai.com')));
  assert.ok(searchQueries.some(query => query.includes('site:reddit.com')));
  assert.ok(searchQueries.some(query => query.includes('site:x.com')));
  assert.equal(result.coverage.status, 'weak');
  assert.equal(calls.length, 1);

  const channelFiltering = await defaultResearchProvider({
    query: '过去24小时 AI 产品更新',
    now: '2026-07-14T08:00:00.000Z',
    aiTextModel: {
      callTextModel: async () => ({ success: true, text: '已整理两条动态。' }),
    },
    webSearchProvider: async ({ query }) => {
      if (query.includes('site:x.com')) {
        return { results: [{
          title: 'OpenAI product update',
          url: 'https://x.com/openai/status/123',
          summary: 'OpenAI shared a product update today.',
        }] };
      }
      if (/official documentation release/.test(query)) {
        return { results: [{
          title: 'OpenAI product release',
          url: 'https://openai.com/index/product-update/',
          summary: 'OpenAI released a product update today.',
        }] };
      }
      return { results: [] };
    },
  });
  assert.ok(channelFiltering.sources.some(source => source.url.includes('openai.com/index/product-update')));
  assert.ok(channelFiltering.sources.some(source => source.url.includes('x.com/openai/status')));

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
  assert.equal(fallbackSearchQueries.length, 4);
  assert.equal(fallbackSearchQueries[0], '疑似触发供应商风控的话题');
  assert.equal(fallbackCalls.length, 1);
  assert.doesNotMatch(fallbackCalls[0].messages[1].content, /这里是很长的正文/);
  assert.match(fallback.summary, /短主题搜索结果/);
  assert.deepEqual(fallback.sources, [{
    title: '短主题搜索结果',
    url: 'https://example.com/short',
    summary: '供应商拒绝总结时仍应保留搜索来源。',
    discovery_channel: 'primary',
    source_type: 'media',
  }]);

  console.log('creative research provider tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
