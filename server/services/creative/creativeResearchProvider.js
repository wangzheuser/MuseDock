const aiModelConfig = require('../ai/aiModelConfig');
const aiTextModel = require('../ai/aiTextModel');
const { AGENTS, STAGES } = require('../creative-video/agentStages');

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
  aiModelConfig: injectedAiModelConfig,
  aiTextModel: injectedAiTextModel,
  webSearchProvider,
} = {}) {
  return runResearchProvider({
    query,
    now,
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

/**
 * 提取用于过滤无关搜索结果的主题关键词。
 */
function extractQueryKeywords(query) {
  const text = safeString(query).replace(/site:\S+/gi, ' ');
  const latin = text.match(/[a-z][a-z0-9._-]{2,}/gi) || [];
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
 * 判断搜索结果是否至少命中一个有效主题词。
 */
function isRelevantSearchResult(result, query) {
  const keywords = extractQueryKeywords(query);
  if (!keywords.length) return true;
  const haystack = `${result.title} ${result.url} ${result.summary}`.toLowerCase();
  const latinWords = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
  const matches = keywords.filter(keyword => (
    /^[a-z0-9._-]+$/.test(keyword) ? latinWords.has(keyword) : haystack.includes(keyword)
  )).length;
  return matches >= Math.min(2, keywords.length);
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

function summarizeSearchSources(sources) {
  return sources
    .map((source, index) => {
      const title = source.title || `来源 ${index + 1}`;
      return `${index + 1}. ${title}\n${source.summary || ''}\n${source.url}`;
    })
    .join('\n\n');
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
    ...(/[\u3400-\u9fff]/.test(normalizedQuery) ? [{
      url: `https://www.sogou.com/web?query=${encodeURIComponent(normalizedQuery)}`,
      parse: parseSogouResults,
    }] : []),
    {
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseDuckDuckGoLiteResults,
    },
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`,
      parse: parseDuckDuckGoHtmlResults,
    },
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
  aiTextModel: textModelService,
  webSearchProvider,
} = {}) {
  const normalizedQuery = safeString(query);
  const webQuery = buildTimeGroundedSearchQuery(normalizedQuery, now);
  const asOf = safeString(now) || new Date().toISOString();
  const messages = [
    {
      role: 'system',
      content: `你是一个联网研究助手。资料核验截止时间为 ${asOf}（UTC）。请优先使用最新且直接相关的来源，为用户提供准确、有帮助的信息。`,
    },
    {
      role: 'user',
      content: `请搜索并研究以下主题：${normalizedQuery}`,
    },
  ];

  try {
    if (typeof webSearchProvider === 'function') {
      const summarize = (searchQuery, sources, attempt) => textModelService.callTextModel({
        messages: [
          messages[0],
          {
            role: 'user',
            content: [
              `请基于以下联网搜索结果，围绕主题“${searchQuery}”输出中文研究摘要。`,
              '要求：只使用搜索结果中的信息，在正文中保留关键来源 URL，不要编造搜索结果之外的信息。',
              JSON.stringify({ query: searchQuery, results: sources }),
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

      const searchResult = await webSearchProvider({ query: webQuery, limit: 5 });
      const sources = normalizeSearchResults(searchResult, normalizedQuery, asOf);
      if (sources.length > 0) {
        const finalResult = await summarize(webQuery, sources, 1);
        if (finalResult.success) {
          return {
            summary: finalResult.text || '',
            sources,
          };
        }
      }

      const searchQuery = buildSearchQuery(normalizedQuery);
      if (searchQuery && searchQuery !== webQuery) {
        const retrySearchResult = await webSearchProvider({ query: searchQuery, limit: 5 });
        const retrySources = normalizeSearchResults(retrySearchResult, normalizedQuery, asOf);
        if (retrySources.length === 0) {
          return sources.length > 0 ? { summary: summarizeSearchSources(sources), sources } : { summary: '', sources: [] };
        }
        const retryResult = await summarize(searchQuery, retrySources, 2);
        return {
          summary: retryResult.success ? (retryResult.text || '') : summarizeSearchSources(retrySources),
          sources: retrySources,
        };
      }

      if (sources.length === 0) {
        return { summary: '', sources: [] };
      }
      return {
        summary: summarizeSearchSources(sources),
        sources,
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
  normalizeSearchResults,
  buildTimeGroundedSearchQuery,
  getFirstAssistantMessage,
  getWebSearchToolCalls,
  parseToolCallArguments,
};
