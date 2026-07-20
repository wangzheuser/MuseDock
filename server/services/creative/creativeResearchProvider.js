const aiModelConfig = require('../ai/aiModelConfig');
const aiTextModel = require('../ai/aiTextModel');
const { AGENTS, STAGES } = require('../creative-video/agentStages');
const { buildRequirementSearchQueries } = require('./pipeline/evidencePack');

const RESEARCH_SEARCH_TIMEOUT_MS = 25_000;
const RESEARCH_SUMMARY_TIMEOUT_MS = 60_000;

/**
 * 限制单次研究子请求的最长等待时间，避免联网资讯任务无限停在 research 阶段。
 */
function withTimeout(promise, timeoutMs, message) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return promise;
  let timer;
  const timed = Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]);
  return timed.finally(() => clearTimeout(timer));
}

// ponytail: 3 行纯函数，与 creativeWorkflows 各持一份，避免为它把 166 处调用迁去共享 util
function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

async function defaultResearchProvider({
  query,
  now,
  creativeContract,
  fetchImpl,
  aiModelConfig: injectedAiModelConfig,
  aiTextModel: injectedAiTextModel,
  webSearchProvider,
} = {}) {
  return runResearchProvider({
    query,
    now,
    creativeContract,
    fetchImpl: fetchImpl || globalThis.fetch,
    fetchEvidencePages: true,
    aiModelConfig: injectedAiModelConfig || aiModelConfig,
    aiTextModel: injectedAiTextModel || aiTextModel,
    webSearchProvider: webSearchProvider || defaultWebSearchProvider,
  });
}

function extractUrlsFromText(text) {
  const urlRegex = /https?:\/\/[^\s)）\]}>"'，。；;]+/g;
  return String(text || '').match(urlRegex) || [];
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 RSS 资讯条目，保留第一方标题、摘要和发布时间。
 */
function parseRssResults(xml, limit = 20) {
  const results = [];
  const items = String(xml || '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const readTag = (item, tag) => {
    const match = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return stripHtml(String(match?.[1] || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
  };
  for (const item of items) {
    if (results.length >= limit) break;
    const url = readTag(item, 'link') || readTag(item, 'guid');
    if (!url) continue;
    const publishedAt = readTag(item, 'pubDate');
    const timestamp = Date.parse(publishedAt);
    results.push({
      title: readTag(item, 'title'),
      url,
      summary: readTag(item, 'description'),
      ...(Number.isFinite(timestamp) ? { published_at: new Date(timestamp).toISOString() } : {}),
      evidence: 'official_feed',
    });
  }
  return results;
}

/**
 * 从可直接访问的官方页面中提取正文摘要。
 */
function extractOfficialPageSummary(html, maxChars = 6000) {
  const source = String(html || '')
    .replace(/<(?:script|style|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|svg)>/gi, ' ');
  const main = source.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1]
    || source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || source;
  return stripHtml(main).slice(0, maxChars);
}

/**
 * 从网页元数据中提取可验证的发布时间。
 * @param {string} html 网页源码。
 * @returns {string} ISO 时间或原始日期字符串。
 */
function extractHtmlPublishedAt(html) {
  const source = String(html || '');
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|publishdate|date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|datePublished|publishdate|date)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ];
  const value = patterns.map(pattern => source.match(pattern)?.[1]).find(Boolean) || '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : safeString(value);
}

/**
 * Twitter/X Snowflake ID 自带发布时间，可用于补全原帖的权威时间锚点。
 * @param {string} url X/Twitter 状态链接。
 * @returns {string} ISO 时间。
 */
function inferXStatusPublishedAt(url) {
  const id = safeString(url).match(/\/(?:status|statuses)\/(\d+)/i)?.[1];
  if (!id) return '';
  try {
    const milliseconds = (BigInt(id) >> 22n) + 1288834974657n;
    const value = Number(milliseconds);
    return Number.isFinite(value) ? new Date(value).toISOString() : '';
  } catch {
    return '';
  }
}

/**
 * 抓取候选来源正文；X 状态链接优先使用官方 oEmbed 读取原帖文本。
 * @param {object} source 搜索候选。
 * @param {Function} fetchImpl fetch 实现。
 * @returns {Promise<object>} 带正文证据的来源。
 */
async function fetchEvidenceSource(source = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function' || !safeString(source.url)) return source;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    Accept: 'text/html,application/json',
  };
  try {
    if (/(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(source.url)) {
      const response = await fetchImpl(`https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(source.url)}`, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
      });
      if (response?.ok) {
        const payload = await response.json();
        const summary = stripHtml(payload?.html || '');
        if (summary) {
          return {
            ...source,
            title: safeString(payload?.author_name) || source.title,
            summary,
            published_at: safeString(source.published_at) || inferXStatusPublishedAt(source.url),
            evidence: 'original_post',
          };
        }
      }
      return source;
    }
    const response = await fetchImpl(source.url, {
      headers,
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
    });
    if (!response?.ok) return source;
    const contentType = safeString(response.headers?.get?.('content-type'));
    if (!/html|text\//i.test(contentType)) return source;
    const html = await response.text();
    const summary = extractOfficialPageSummary(html);
    if (!summary) return source;
    return {
      ...source,
      title: stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || source.title,
      summary,
      published_at: safeString(source.published_at) || extractHtmlPublishedAt(html),
      evidence: source.evidence === 'official_feed' ? source.evidence : 'page_body',
    };
  } catch {
    return source;
  }
}

/**
 * 限量抓取合并后的候选正文，搜索摘要本身不升级为证据。
 * @param {Array<object>} sources 搜索候选。
 * @param {Function} fetchImpl fetch 实现。
 * @returns {Promise<Array<object>>} 来源列表。
 */
async function enrichResearchSources(sources = [], fetchImpl = globalThis.fetch) {
  const enriched = await Promise.all(sources.slice(0, 16).map(source => fetchEvidenceSource(source, fetchImpl)));
  return [...enriched, ...sources.slice(16)];
}

function decodeDuckDuckGoRedirect(url) {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return safeString(url);
  }
}

function parseDuckDuckGoLiteResults(html, limit) {
  const results = [];
  const pattern = /<a([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>[\s\S]*?<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    const hrefMatch = match[1].match(/\shref=['"]([^'"]+)['"]/i);
    if (!hrefMatch) continue;
    results.push({
      title: stripHtml(match[2]),
      url: decodeDuckDuckGoRedirect(hrefMatch[1]),
      summary: stripHtml(match[3]),
    });
  }
  return results;
}

function parseDuckDuckGoHtmlResults(html, limit) {
  const results = [];
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    results.push({
      title: stripHtml(match[2]),
      url: decodeDuckDuckGoRedirect(match[1]),
      summary: stripHtml(match[3]),
    });
  }
  return results;
}

function parseBingResults(html, limit) {
  const results = [];
  const pattern = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    results.push({
      title: stripHtml(match[2]),
      url: safeString(match[1]),
      summary: stripHtml(match[3]),
    });
  }
  return results;
}

/**
 * 解析搜狗网页搜索中的普通结果卡片。
 */
function parseSogouResults(html, limit) {
  const results = [];
  const blocks = String(html || '').match(/<div class="vrwrap"[^>]*>[\s\S]*?<!--STATUS VR OK-->/gi) || [];
  for (const block of blocks) {
    if (results.length >= limit) break;
    const title = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const summary = block.match(/<div[^>]+class="[^"]*(?:space-txt|base-ellipsis)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    const url = block.match(/\sdata-url="(https?:\/\/[^"\s]+)"/i)?.[1];
    const date = block.match(/class="citeLinkClass"[\s\S]*?<span>[^<]*<\/span>[\s\S]*?<span>[^<]*<\/span>\s*<span>([^<]+)<\/span>/i)?.[1];
    if (!title || !url) continue;
    results.push({
      title: stripHtml(title),
      url: stripHtml(url),
      summary: stripHtml(summary),
      published_at: stripHtml(date),
    });
  }
  return results;
}

const GENERIC_QUERY_TERMS = new Set([
  '今天', '最新', '消息', '新闻', '相关', '内容', '官方', '发布', '情况', '目前', '现在', '战争', '冲突', '进展',
  'latest', 'news', 'official', 'release', 'update', 'updates',
]);

const FIRST_PARTY_DOMAIN_RULES = [
  { pattern: /^(?:openai|chatgpt|codex|gpt(?:-?\d[\w.-]*)?)$/i, domain: 'openai.com' },
  { pattern: /^(?:anthropic|claude(?:-?\d[\w.-]*)?)$/i, domain: 'anthropic.com' },
  { pattern: /^(?:google|gemini(?:-?\d[\w.-]*)?|deepmind)$/i, domain: 'google.com' },
  { pattern: /^(?:meta|llama(?:-?\d[\w.-]*)?)$/i, domain: 'meta.com' },
  { pattern: /^(?:xai|grok(?:-?\d[\w.-]*)?)$/i, domain: 'x.ai' },
  { pattern: /^(?:microsoft|copilot)$/i, domain: 'microsoft.com' },
  { pattern: /^(?:kimi|moonshot)$/i, domain: 'kimi.com' },
];

/**
 * 仅从明确品牌词推断第一方域名，禁止把 launched、model 等普通词拼成虚假域名。
 */
function resolveFirstPartyDomain(value = '') {
  const tokens = safeString(value).match(/[a-z][a-z0-9.-]{1,}/gi) || [];
  for (const token of tokens) {
    const rule = FIRST_PARTY_DOMAIN_RULES.find(item => item.pattern.test(token));
    if (rule) return rule.domain;
  }
  return '';
}

/**
 * 提取用于过滤无关搜索结果的主题关键词。
 */
function extractQueryKeywords(query) {
  const text = safeString(query).replace(/site:\S+/gi, ' ');
  const latin = text.match(/[a-z][a-z0-9._-]{1,}/gi) || [];
  const chinese = (text.match(/[\u3400-\u9fff]{2,}/g) || []).flatMap(chunk => {
    const subject = chunk
      .replace(/今天|最新|消息|新闻|相关|内容|官方|发布|情况|目前|现在|战争|冲突|进展/g, '')
      .replace(/[和与及的]/g, '');
    if (subject.length <= 2) return subject ? [subject] : [];
    return Array.from({ length: subject.length - 1 }, (_, index) => subject.slice(index, index + 2));
  });
  return [...new Set([...latin, ...chinese].map(item => item.toLowerCase()))]
    .filter(item => ![...GENERIC_QUERY_TERMS].some(generic => item.includes(generic)));
}

/**
 * 提取 site: 过滤域名，防止搜索引擎忽略限定后返回无关站点。
 */
function extractSiteFilters(query = '') {
  return [...new Set((safeString(query).match(/site:([a-z0-9.-]+)/gi) || [])
    .map(value => value.slice(5).toLowerCase().replace(/^www\./, ''))
    .filter(Boolean))];
}

/**
 * 判断搜索结果是否至少命中一个有效主题词。
 */
function isRelevantSearchResult(result, query) {
  const siteFilters = extractSiteFilters(query);
  if (siteFilters.length) {
    try {
      const hostname = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '');
      if (!siteFilters.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) return false;
    } catch {
      return false;
    }
  }
  const keywords = extractQueryKeywords(query);
  if (!keywords.length) return true;
  const haystack = `${result.title} ${result.url} ${result.summary}`.toLowerCase();
  const compactLatin = haystack.replace(/[^a-z0-9]/g, '');
  const matches = keywords.filter(keyword => (
    /^[a-z0-9._-]+$/.test(keyword)
      ? compactLatin.includes(keyword.replace(/[^a-z0-9]/g, ''))
      : haystack.includes(keyword)
  )).length;
  return matches >= Math.min(siteFilters.length ? 1 : 2, keywords.length);
}

/**
 * 从搜索摘要中提取绝对或相对发布时间。
 */
function inferPublishedAt(value, now = '') {
  const text = safeString(value);
  const dateMatch = text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
  }
  const relativeMatch = text.match(/(\d+)\s*(小时|天)(?:前|之前)/);
  const base = Date.parse(now);
  if (!Number.isFinite(base)) return '';
  if (/^今天$/.test(text)) return new Date(base).toISOString().slice(0, 10);
  if (/^昨天$/.test(text)) return new Date(base - 86400000).toISOString().slice(0, 10);
  if (!relativeMatch) return '';
  const amount = Number(relativeMatch[1]);
  const milliseconds = amount * (relativeMatch[2] === '天' ? 86400000 : 3600000);
  return new Date(base - milliseconds).toISOString();
}

/**
 * 规范化、去重并过滤搜索结果。
 */
function normalizeSearchResults(value, query = '', now = '') {
  const rawResults = Array.isArray(value)
    ? value
    : (Array.isArray(value?.results) ? value.results : []);
  const seen = new Set();
  return rawResults.map(item => {
    const summary = safeString(item?.summary || item?.snippet || item?.description);
    const rawPublishedAt = safeString(item?.published_at || item?.publishedAt);
    const publishedAt = inferPublishedAt(rawPublishedAt, now) || rawPublishedAt || inferPublishedAt(summary, now);
    return {
      title: safeString(item?.title),
      url: safeString(item?.url || item?.link).replace(/&amp;/g, '&'),
      summary,
      ...(publishedAt ? { published_at: publishedAt } : {}),
      ...(safeString(item?.evidence) ? { evidence: safeString(item.evidence) } : {}),
    };
  }).filter(item => {
    if (!item.url || seen.has(item.url) || !isRelevantSearchResult(item, query)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 5);
}

function buildSearchQuery(value) {
  const text = safeString(value);
  const firstLine = text.split(/\r?\n/).map(safeString).find(Boolean) || text;
  return firstLine.length > 120 ? firstLine.slice(0, 120) : firstLine;
}

/**
 * 为时效查询追加检索当天日期，减少历史结果占位。
 */
function buildTimeGroundedSearchQuery(value, now = '') {
  const query = buildSearchQuery(value);
  if (!query || !/(今天|最新|刚刚|近期|目前|战争|冲突|发布|上线|更新|latest|today|war|conflict|release|update)/i.test(query)) return query;
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) return query;
  const date = new Date(timestamp).toISOString().slice(0, 10);
  return query.includes(date) ? query : `${query} ${date}`;
}

/**
 * 生成通用、第一方和社区三个检索方向，避免单一搜索结果决定全部叙事。
 */
function buildResearchSearchQueries(value, now = '') {
  const base = buildTimeGroundedSearchQuery(value, now);
  if (!base) return [];
  const latinTerms = [...new Set((base.match(/[a-z][a-z0-9.-]{2,}/gi) || [])
    .filter(term => !/^(reddit|twitter|latest|official|release)$/i.test(term)))]
    .slice(0, 8);
  const isBroadAiTopic = /(?:\bAI\b|人工智能|大模型)/i.test(base);
  const dateToken = base.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || '';
  const focusedTopic = latinTerms.length
    ? latinTerms.join(' ')
    : (isBroadAiTopic ? `AI OpenAI Anthropic Google Gemini Meta xAI ${dateToken}`.trim() : base);
  const productTerms = latinTerms.filter(term => !/^(sol|terra|luna)$/i.test(term)).slice(0, 4);
  // 中文泛主题没有拉丁实体时也必须保留原查询，避免退化成只有 site: 的全站搜索。
  const communityTopic = productTerms.length ? productTerms.join(' ') : focusedTopic;
  const firstPartyDomain = resolveFirstPartyDomain(base);
  const primaryQuery = firstPartyDomain
    ? `${productTerms.join(' ')} site:${firstPartyDomain}`
    : `${focusedTopic} official documentation release`;
  return [
    { channel: 'general', query: base },
    { channel: 'primary', query: primaryQuery },
    { channel: 'community', query: `${communityTopic} site:reddit.com` },
    { channel: 'social', query: `${communityTopic} site:x.com` },
  ];
}

/**
 * 用 URL 判断明显的第一方和社区来源；无法确认时按媒体来源处理。
 */
function classifyResearchSource(source = {}, query = '') {
  const url = safeString(source.url).toLowerCase();
  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  if (/(^|\.)(reddit\.com|x\.com|twitter\.com|news\.ycombinator\.com|zhihu\.com|weibo\.com)$/.test(hostname)) {
    return 'community';
  }
  const firstPartyDomain = resolveFirstPartyDomain(query);
  if ((firstPartyDomain && (hostname === firstPartyDomain || hostname.endsWith(`.${firstPartyDomain}`)))
    || /\.(gov|edu)(\.|$)/.test(hostname)) {
    return 'first_party';
  }
  return 'media';
}

/**
 * 按检索方向轮询合并来源，保证不同视角不会被同类结果挤掉。
 */
function mergeResearchSources(groups = [], limit = 8, query = '') {
  const seen = new Set();
  const merged = [];
  const maxGroupSize = Math.max(0, ...groups.map(group => group.sources.length));
  for (let index = 0; index < maxGroupSize && merged.length < limit; index += 1) {
    for (const group of groups) {
      const source = group.sources[index];
      if (!source?.url || seen.has(source.url)) continue;
      seen.add(source.url);
      merged.push({
        ...source,
        discovery_channel: group.channel,
        ...(group.requirement_id ? { requirement_ids: [group.requirement_id] } : {}),
        source_type: classifyResearchSource(source, query),
      });
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

/**
 * 汇总检索覆盖情况，供后续导演判断材料是否足以支撑具体结论。
 */
function buildResearchCoverage(groups = [], sources = []) {
  const domains = new Set(sources.map(source => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }).filter(Boolean));
  const channels = Object.fromEntries(groups.map(group => [group.channel, group.sources.length]));
  const sourceTypes = sources.reduce((counts, source) => {
    const type = source.source_type || 'media';
    counts[type] = Number(counts[type] || 0) + 1;
    return counts;
  }, {});
  const fetchedContentCount = sources.filter(source => (
    source.source_type === 'first_party'
      && ['official_feed', 'official_page'].includes(source.evidence)
  )).length;
  return {
    status: domains.size >= 2 && Number(sourceTypes.first_party || 0) > 0 && Number(sourceTypes.community || 0) > 0
      ? 'ready'
      : 'weak',
    queries: groups.map(group => ({ channel: group.channel, query: group.query })),
    channels,
    source_types: sourceTypes,
    fetched_content_count: fetchedContentCount,
    domain_count: domains.size,
  };
}

function summarizeSearchSources(sources) {
  return sources
    .map((source, index) => {
      const title = source.title || `来源 ${index + 1}`;
      return `${index + 1}. ${title}\n${source.summary || ''}\n${source.url}`;
    })
    .join('\n\n');
}

/**
 * 从站点地图中补回搜索引擎漏掉的第一方页面。
 */
async function searchOfficialSitemap({ query, limit = 5, fetchImpl = global.fetch, headers = {} } = {}) {
  const domain = extractSiteFilters(query)[0];
  if (!domain || typeof fetchImpl !== 'function') return [];
  const normalizedKeywords = extractQueryKeywords(query)
    .map(keyword => keyword.replace(/[^a-z0-9\u3400-\u9fff]/gi, '').toLowerCase())
    .filter(keyword => keyword.length >= 3 && !domain.replace(/[^a-z0-9]/gi, '').includes(keyword));
  if (!normalizedKeywords.length) return [];

  /** 对官方结果按主题词命中和主产品页精确度评分。 */
  const scoreOfficialResult = value => {
    const text = typeof value === 'string' ? value : `${value?.title || ''} ${value?.url || ''} ${value?.summary || ''}`;
    const comparable = text.replace(/[^a-z0-9\u3400-\u9fff]/gi, '').toLowerCase();
    const baseScore = normalizedKeywords.reduce((total, keyword, index) => (
      total + (comparable.includes(keyword) ? (index === 0 ? 5 : 1) : 0)
    ), 0);
    const urlComparable = String(typeof value === 'string' ? value : value?.url || '')
      .replace(/[^a-z0-9\u3400-\u9fff]/gi, '')
      .toLowerCase();
    return baseScore + (urlComparable.endsWith(normalizedKeywords[0]) ? 10 : 0);
  };

  /** 读取一个官方公开文本端点。 */
  const fetchText = async (url, timeoutMs = 30000) => {
    const response = await fetchImpl(url, {
      headers,
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined,
    });
    return response?.ok ? String(await response.text()) : '';
  };

  /** 读取单个站点地图中的链接。 */
  const fetchLocations = async url => {
    const xml = await fetchText(url);
    return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
      .map(match => match[1].replace(/&amp;/g, '&').trim())
      .filter(Boolean);
  };

  try {
    const rootLocations = await fetchLocations(`https://${domain}/sitemap.xml`);
    const childMaps = rootLocations
      .filter(url => /sitemap/i.test(url))
      .sort((a, b) => Number(/\/(?:release|product|api|page|publication)\//i.test(b))
        - Number(/\/(?:release|product|api|page|publication)\//i.test(a)))
      .slice(0, 6);
    const nestedLocations = childMaps.length
      ? (await Promise.all(childMaps.map(fetchLocations))).flat()
      : [];
    const pageUrls = [...new Set([...rootLocations, ...nestedLocations].filter(url => !/sitemap/i.test(url)))];
    const rankedPages = pageUrls
      .map(url => {
        const score = scoreOfficialResult(url);
        return { url, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
      .slice(0, limit);

    let rssResults = [];
    for (const rssPath of ['/news/rss.xml', '/rss.xml']) {
      const rssXml = await fetchText(`https://${domain}${rssPath}`, 20000).catch(() => '');
      rssResults = parseRssResults(rssXml, 50).map(item => {
        const score = scoreOfficialResult(item);
        return { ...item, score };
      }).filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.url.length - b.url.length);
      if (rssResults.length) break;
    }

    const fetchedPages = await Promise.all(rankedPages.slice(0, 2).map(async item => {
      const html = await fetchText(item.url, 15000).catch(() => '');
      const summary = extractOfficialPageSummary(html);
      if (!summary) return null;
      const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
      return {
        title: title || `${normalizedKeywords[0]} · ${domain}`,
        url: item.url,
        summary,
        evidence: 'official_page',
        score: item.score,
      };
    }));

    const candidates = [
      ...rssResults,
      ...fetchedPages.filter(Boolean),
      ...rankedPages.map(item => ({
        title: `${normalizedKeywords[0]} · ${domain}`,
        url: item.url,
        summary: `${domain} 官方站点地图中的相关页面。`,
        evidence: 'official_url',
        score: item.score,
      })),
    ];
    const seen = new Set();
    return candidates.filter(item => {
      const key = item.url.replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => b.score - a.score || Number(b.evidence !== 'official_url') - Number(a.evidence !== 'official_url'))
      .slice(0, limit)
      .map(({ score, ...item }) => item);
  } catch {
    return [];
  }
}

async function defaultWebSearchProvider({ query, limit = 5, fetchImpl = global.fetch } = {}) {
  const normalizedQuery = safeString(query);
  if (!normalizedQuery) return { results: [] };
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境缺少 fetch 实现，无法执行联网搜索。');
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  };
  const endpoints = [
    {
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseDuckDuckGoLiteResults,
    },
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseDuckDuckGoHtmlResults,
    },
    ...(/[\u3400-\u9fff]/.test(normalizedQuery) ? [{
      url: `https://www.sogou.com/web?query=${encodeURIComponent(normalizedQuery)}`,
      parse: parseSogouResults,
    }] : []),
    {
      url: `https://www.bing.com/search?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseBingResults,
    },
  ];
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetchImpl(endpoint.url, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(20000)
          : undefined,
      });
      if (!response || !response.ok) {
        errors.push(`HTTP ${response?.status || 'unknown'}: ${endpoint.url}`);
        continue;
      }
      const html = await response.text();
      const results = normalizeSearchResults(endpoint.parse(html, limit), normalizedQuery);
      if (results.length > 0) return { results };
      errors.push(`搜索结果为空: ${endpoint.url}`);
    } catch (error) {
      errors.push(`${endpoint.url}: ${error.message || '请求失败'}`);
    }
  }
  const sitemapResults = await searchOfficialSitemap({
    query: normalizedQuery,
    limit,
    fetchImpl,
    headers,
  });
  if (sitemapResults.length) return { results: sitemapResults, diagnostics: errors };
  return { results: [], diagnostics: errors };
}

function getFirstAssistantMessage(rawResponse = {}) {
  return rawResponse?.choices?.[0]?.message || null;
}

function getWebSearchToolCalls(rawResponse = {}) {
  const message = getFirstAssistantMessage(rawResponse);
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return toolCalls.filter(toolCall => toolCall?.function?.name === 'web_search');
}

function parseToolCallArguments(toolCall) {
  try {
    return JSON.parse(toolCall?.function?.arguments || '{}');
  } catch {
    return {};
  }
}

async function runResearchProvider({
  query,
  now,
  creativeContract,
  aiTextModel: textModelService,
  webSearchProvider,
  fetchImpl,
  fetchEvidencePages = false,
} = {}) {
  const normalizedQuery = safeString(query);
  const researchTopic = buildSearchQuery(normalizedQuery);
  const contractQueries = buildRequirementSearchQueries(creativeContract, normalizedQuery);
  const searchQueries = creativeContract?.version === 2 && contractQueries.some(item => item.requirement_id)
    ? contractQueries
    : buildResearchSearchQueries(normalizedQuery, now);
  const asOf = safeString(now) || new Date().toISOString();
  const messages = [
    {
      role: 'system',
      content: `你是自媒体创作的联网素材研究助手。资料检索截止时间为 ${asOf}（UTC）。请收集最新且直接相关的信号、背景、观点和开放问题，不需要替创作者裁决整个话题真假。`,
    },
    {
      role: 'user',
      content: `请搜索并研究以下主题：${researchTopic}`,
    },
  ];

  try {
    if (typeof webSearchProvider === 'function') {
      const summarize = (sources, coverage, attempt) => textModelService.callTextModel({
        messages: [
          messages[0],
          {
            role: 'user',
            content: [
              `请基于以下联网搜索结果，围绕主题“${researchTopic}”整理中文创作素材。`,
              '先做“前提校验”，核对用户输入中的发布时间、是否已经发生、范围和因果关系；发现冲突时直接指出，不要照抄错误前提。',
              '再按“现有信号、背景信息、不同观点、开放问题、观众价值”组织；没有内容的栏目可以省略，不要给整个事件下真假结论。',
              '只使用搜索结果中的信息；对负责人发言、媒体报道、用户观察准确归因；区分原始来源和二手转述；保留关键来源 URL。',
              '优先提取日期、数字、名称、价格、适用范围、实际案例和观点冲突。观众价值必须给出可执行的判断方法或选择建议，不能只列“后续观察”。',
              '如果材料覆盖不足，明确缺少哪个检索方向，但仍应充分使用已经找到的具体信息。',
              JSON.stringify({ query: researchTopic, coverage, results: sources }),
            ].join('\n'),
          },
        ],
        temperature: 0.3,
        stream: false,
        audit: {
          agent: AGENTS.research,
          stage: STAGES.research,
          sub_stage: 'web_search_summary',
          attempt,
        },
      });

      const groups = await Promise.all(searchQueries.map(async search => {
        const searchResult = await withTimeout(
          webSearchProvider({ query: search.query, limit: 5 }),
          RESEARCH_SEARCH_TIMEOUT_MS,
          `联网搜索超时：${search.query}`,
        ).catch(() => ({ results: [], diagnostics: ['search_timeout'] }));
        return {
          ...search,
          // 各检索方向按自己的实体和 site: 约束过滤，不能再拿中文总主题误杀英文一手来源。
          sources: normalizeSearchResults(searchResult, search.query, asOf),
        };
      }));
      const prioritizedGroups = [
        ...groups.filter(group => group.channel === 'requirement'),
        ...groups.filter(group => group.channel === 'primary'),
        ...groups.filter(group => group.channel === 'community'),
        ...groups.filter(group => group.channel === 'social'),
        ...groups.filter(group => group.channel === 'general'),
      ];
      // 每个关键要求至少保留一个候选来源，不能让固定 8 条上限截断后半段核验项。
      const sourceLimit = Math.min(24, Math.max(8, searchQueries.length * 2));
      const directSources = (Array.isArray(creativeContract?.reference_urls) ? creativeContract.reference_urls : [])
        .map(url => ({
          title: '',
          url,
          summary: '',
          discovery_channel: 'direct',
          source_type: classifyResearchSource({ url }, researchTopic),
        }));
      const mergedSearchSources = mergeResearchSources(prioritizedGroups, sourceLimit, researchTopic);
      const seenSourceUrls = new Set();
      const discoveredSources = [...directSources, ...mergedSearchSources].filter(source => {
        if (!source.url || seenSourceUrls.has(source.url)) return false;
        seenSourceUrls.add(source.url);
        return true;
      }).slice(0, Math.min(24, sourceLimit + directSources.length));
      const sources = fetchEvidencePages
        ? await enrichResearchSources(discoveredSources, fetchImpl)
        : discoveredSources;
      const coverage = buildResearchCoverage(groups, sources);
      if (sources.length > 0) {
        const finalResult = await withTimeout(
          summarize(sources, coverage, 1),
          RESEARCH_SUMMARY_TIMEOUT_MS,
          '联网研究摘要请求超时',
        ).catch(() => ({ success: false, text: '' }));
        if (finalResult.success) {
          return {
            summary: finalResult.text || '',
            sources,
            coverage,
          };
        }
      }
      if (sources.length === 0) {
        return { summary: '', sources: [], coverage };
      }
      return {
        summary: summarizeSearchSources(sources),
        sources,
        coverage,
      };
    }

    const result = await textModelService.callTextModel({
      messages,
      temperature: 0.3,
      stream: false,
      audit: {
        agent: AGENTS.research,
        stage: STAGES.research,
        sub_stage: 'web_search_request',
        attempt: 1,
      },
    });

    if (!result.success) {
      throw new Error(result.message || '分析模型调用失败');
    }

    // 从响应中提取搜索结果
    const text = result.text || '';
    const rawResponse = result.raw_response || {};
    const webSearchToolCalls = getWebSearchToolCalls(rawResponse);

    if (webSearchToolCalls.length > 0 && typeof webSearchProvider === 'function') {
      const assistantMessage = getFirstAssistantMessage(rawResponse);
      const toolMessages = [];
      let searchSources = [];
      for (const toolCall of webSearchToolCalls) {
        const args = parseToolCallArguments(toolCall);
        const searchQuery = safeString(args.query) || safeString(query);
        const searchResult = await webSearchProvider({ query: searchQuery, limit: 5 });
        const normalizedResults = normalizeSearchResults(searchResult, searchQuery, asOf);
        searchSources = searchSources.concat(normalizedResults);
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query: searchQuery, results: normalizedResults }),
        });
      }

      const finalResult = await textModelService.callTextModel({
        messages: [
          ...messages,
          {
            role: 'assistant',
            content: assistantMessage?.content || '',
            tool_calls: assistantMessage?.tool_calls || webSearchToolCalls,
          },
          ...toolMessages,
          {
            role: 'user',
            content: '请基于搜索结果输出中文研究摘要，并在正文中保留关键来源 URL。不要编造搜索结果之外的信息。',
          },
        ],
        temperature: 0.3,
        stream: false,
        audit: {
          agent: AGENTS.research,
          stage: STAGES.research,
          sub_stage: 'web_search_summary',
          attempt: 1,
        },
      });
      if (!finalResult.success) {
        throw new Error(finalResult.message || '分析模型整理搜索结果失败');
      }
      return {
        summary: finalResult.text || '',
        sources: normalizeSearchResults(searchSources, normalizedQuery, asOf),
      };
    }

    // 尝试从raw_response中提取搜索结果
    let sources = [];
    if (rawResponse.choices && rawResponse.choices[0] && rawResponse.choices[0].message) {
      const message = rawResponse.choices[0].message;
      // mimo的搜索结果可能在message的某个字段中
      if (message.tool_calls) {
        // 解析tool_calls中的搜索结果
        for (const toolCall of message.tool_calls) {
          if (toolCall.function && toolCall.function.name === 'web_search') {
            try {
              const searchResult = JSON.parse(toolCall.function.arguments);
              if (searchResult.results) {
                sources = searchResult.results.map(item => ({
                  title: item.title || '',
                  url: item.url || item.link || '',
                  summary: item.snippet || item.description || '',
                }));
              }
            } catch {
              // 解析失败，继续
            }
          }
        }
      }
    }

    // 如果没有从tool_calls中提取到，尝试从文本中提取
    if (sources.length === 0) {
      // 尝试从文本中提取URL和标题
      const urls = extractUrlsFromText(text);
      sources = urls.slice(0, 5).map(url => ({
        title: '',
        url: url,
        summary: '',
      }));
    }

    return {
      summary: text,
      sources: sources,
    };
  } catch (error) {
    throw new Error(`联网研究失败：${error.message}`);
  }
}

module.exports = {
  defaultResearchProvider,
  defaultWebSearchProvider,
  runResearchProvider,
  extractUrlsFromText,
  stripHtml,
  decodeDuckDuckGoRedirect,
  parseDuckDuckGoLiteResults,
  parseDuckDuckGoHtmlResults,
  parseBingResults,
  parseSogouResults,
  parseRssResults,
  extractOfficialPageSummary,
  extractHtmlPublishedAt,
  inferXStatusPublishedAt,
  fetchEvidenceSource,
  enrichResearchSources,
  normalizeSearchResults,
  extractSiteFilters,
  buildTimeGroundedSearchQuery,
  buildResearchSearchQueries,
  resolveFirstPartyDomain,
  classifyResearchSource,
  mergeResearchSources,
  buildResearchCoverage,
  searchOfficialSitemap,
  getFirstAssistantMessage,
  getWebSearchToolCalls,
  parseToolCallArguments,
};
