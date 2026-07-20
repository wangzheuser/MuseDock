const crypto = require('crypto');

const SPECIAL_ANCHORS = [
  ['identity', /账号身份|具体身份|是谁|人物身份/, /身份|负责人|创始人|founder|lead|head|profile|bio/i],
  ['original_post', /原帖链接|原始帖|原帖/, /(?:x\.com|twitter\.com)\/[^\s/]+\/status\/\d+|weibo\.com\/\d+\//i],
  ['published_at', /发布时间|发布时点|时间戳|日期/, null],
  ['full_context', /完整上下文|上下文|全文/, null],
  ['metric_scope', /统计口径|用户.*(?:指|究竟)|注册用户|活跃用户|付费用户|使用人数/, /注册|活跃|付费|使用人数|active|weekly|monthly|registered|paid|users?/i],
  ['reset_mechanism', /额度重置|限额调整|额度恢复|重置.*机制|限额.*机制/, /额度|限额|重置|恢复|\b(?:quota|limit|reset)\b/i],
];
const LATIN_STOP_WORDS = new Set(['http', 'https', 'www', 'com', 'official', 'site', 'and', 'the', 'with', 'from', 'latest']);
const CHINESE_META_PATTERN = /逐项|核验|核实|核查|查证|准确|明确|区分|以下|概念|第一|第二|第三|第四|分别|是否|还是/g;

/**
 * 把任意值归一化为字符串。
 * @param {unknown} value 原始值。
 * @returns {string} 归一化文本。
 */
function safeString(value) {
  return String(value ?? '').trim();
}

/**
 * 生成内容哈希。
 * @param {unknown} value 待计算内容。
 * @returns {string} SHA-256 哈希。
 */
function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/**
 * 从要求中提取不可忽略的数字。
 * @param {string} text 要求文本。
 * @returns {string[]} 数字锚点。
 */
function extractNumberAnchors(text) {
  return [...new Set((safeString(text).match(/\d+(?:\.\d+)?\s*(?:万|亿|%|million|billion|m|b)?/gi) || [])
    .map(value => value.replace(/\s+/g, '').toLowerCase()))];
}

/**
 * 从要求中提取品牌、产品和人名等拉丁字符锚点。
 * @param {string} text 要求文本。
 * @returns {string[]} 拉丁字符锚点。
 */
function extractLatinAnchors(text) {
  return [...new Set((safeString(text).match(/[a-z][a-z0-9._-]{1,}/gi) || [])
    .map(value => value.toLowerCase())
    .filter(value => !LATIN_STOP_WORDS.has(value)))];
}

/**
 * 提取中文事实条款中的短语锚点，补足纯中文要求无法参与词法匹配的问题。
 * @param {string} text 要求文本。
 * @returns {string[]} 中文短语锚点。
 */
function extractChineseAnchors(text) {
  const runs = safeString(text)
    .replace(CHINESE_META_PATTERN, '')
    .match(/[\u3400-\u9fff]{2,}/g) || [];
  const anchors = [];
  runs.forEach(run => {
    if (run.length <= 4) {
      anchors.push(run);
      return;
    }
    // 长句采用二元词组匹配，允许多来源共同覆盖同一项事实要求。
    for (let index = 0; index < run.length - 1; index += 1) {
      anchors.push(run.slice(index, index + 2));
    }
  });
  return [...new Set(anchors)];
}

/**
 * 计算纯中文条款达到可信相关性所需的最少锚点数。
 * @param {string[]} anchors 中文锚点。
 * @returns {number} 最少命中数。
 */
function requiredChineseAnchorCount(anchors = []) {
  return Math.min(4, Math.max(2, Math.ceil(anchors.length * 0.2)));
}

/**
 * 获取来源可用于匹配的全文。
 * @param {object} source 研究来源。
 * @returns {string} 归一化来源文本。
 */
function sourceText(source = {}) {
  return [source.title, source.summary, source.url, source.published_at]
    .map(safeString)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * 从来源正文中截取与单项要求最相关的短证据，避免把整页正文传入下游模型。
 * @param {object} requirement Creative Contract 要求。
 * @param {string} summary 来源正文。
 * @param {number} maxChars 最大字符数。
 * @returns {string} 相关证据摘录。
 */
function extractRelevantExcerpt(requirement = {}, summary = '', maxChars = 1200) {
  const text = safeString(summary).replace(/\s+/g, ' ');
  if (text.length <= maxChars) return text;
  const anchors = [...extractNumberAnchors(requirement.text), ...extractLatinAnchors(requirement.text)];
  const lower = text.toLowerCase();
  const positions = anchors
    .filter(anchor => anchor.length >= 2)
    .map(anchor => lower.indexOf(anchor))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)
    .filter((index, offset, values) => offset === 0 || index - values[offset - 1] > 180);
  const excerpts = positions.map(index => text.slice(Math.max(0, index - 90), index + 300).trim());
  return [...new Set(excerpts.length ? excerpts : [text.slice(0, maxChars)])].join(' … ').slice(0, maxChars).trim();
}

/**
 * 判断单个来源满足了哪些要求锚点。
 * @param {object} requirement Creative Contract 要求。
 * @param {object} source 研究来源。
 * @returns {object} 命中详情。
 */
function matchRequirementSource(requirement = {}, source = {}) {
  const requirementText = safeString(requirement.text);
  const haystack = sourceText(source);
  const compact = haystack.replace(/[\s,，]/g, '');
  const numberAnchors = extractNumberAnchors(requirementText);
  const latinAnchors = extractLatinAnchors(requirementText);
  const chineseAnchors = extractChineseAnchors(requirementText);
  const matchedNumbers = numberAnchors.filter(anchor => compact.includes(anchor));
  const matchedLatin = latinAnchors.filter(anchor => haystack.includes(anchor));
  const matchedChinese = chineseAnchors.filter(anchor => compact.includes(anchor));
  const special = {};

  SPECIAL_ANCHORS.forEach(([id, requirementPattern, sourcePattern]) => {
    if (!requirementPattern.test(requirementText)) return;
    if (id === 'published_at') special[id] = Boolean(safeString(source.published_at));
    else if (id === 'full_context') special[id] = safeString(source.summary).length >= 60;
    else special[id] = sourcePattern.test(haystack);
  });

  return {
    number_anchors: numberAnchors,
    latin_anchors: latinAnchors,
    chinese_anchors: chineseAnchors,
    matched_numbers: matchedNumbers,
    matched_latin: matchedLatin,
    matched_chinese: matchedChinese,
    special,
    score: matchedNumbers.length * 3
      + matchedLatin.length * 2
      + matchedChinese.length
      + Object.values(special).filter(Boolean).length * 2,
  };
}

/**
 * 汇总多个来源后判断一个要求是否真正获得覆盖。
 * @param {object} requirement Creative Contract 要求。
 * @param {Array<object>} matches 来源匹配结果。
 * @returns {object} 要求覆盖结果。
 */
function evaluateRequirementCoverage(requirement = {}, matches = []) {
  if (requirement.evidence_required !== true) {
    return { covered: true, reason: 'evidence_not_required', matched_source_ids: [] };
  }
  const numberAnchors = extractNumberAnchors(requirement.text);
  const latinAnchors = extractLatinAnchors(requirement.text);
  const chineseAnchors = extractChineseAnchors(requirement.text);
  const matchedNumbers = new Set(matches.flatMap(item => item.match.matched_numbers));
  const matchedLatin = new Set(matches.flatMap(item => item.match.matched_latin));
  const matchedChinese = new Set(matches.flatMap(item => item.match.matched_chinese));
  const requiredSpecial = SPECIAL_ANCHORS
    .filter(([, pattern]) => pattern.test(safeString(requirement.text)))
    .map(([id]) => id);
  const matchedSpecial = new Set(requiredSpecial.filter(id => matches.some(item => (
    item.match.special[id] === true
    && latinAnchors.every(anchor => item.match.matched_latin.includes(anchor))
  ))));
  const lexicalScore = matches.reduce((total, item) => total + item.match.score, 0);
  const numbersCovered = numberAnchors.every(anchor => matchedNumbers.has(anchor));
  const latinCovered = latinAnchors.every(anchor => matchedLatin.has(anchor));
  const specialCovered = requiredSpecial.every(anchor => matchedSpecial.has(anchor));
  const hasSpecificAnchor = numberAnchors.length + latinAnchors.length + requiredSpecial.length > 0;
  const chineseCovered = matchedChinese.size >= requiredChineseAnchorCount(chineseAnchors);
  const covered = hasSpecificAnchor
    ? numbersCovered && latinCovered && specialCovered && lexicalScore > 0
    : chineseCovered;
  return {
    covered,
    reason: covered ? 'matched' : 'missing_required_anchors',
    matched_source_ids: matches.filter(item => item.match.score > 0).map(item => item.source.id),
    anchors: {
      numbers: numberAnchors,
      latin: latinAnchors,
      chinese: chineseAnchors,
      special: requiredSpecial,
      matched_numbers: [...matchedNumbers],
      matched_latin: [...matchedLatin],
      matched_chinese: [...matchedChinese],
      matched_special: [...matchedSpecial],
    },
  };
}

/**
 * 为每个需要证据的要求生成独立查询，避免一个总查询承担全部核验任务。
 * @param {object} contract Creative Contract。
 * @param {string} fallbackQuery 兼容查询。
 * @returns {Array<object>} 研究查询列表。
 */
function buildRequirementSearchQueries(contract = {}, fallbackQuery = '') {
  const requirements = (Array.isArray(contract.must_cover) ? contract.must_cover : [])
    .filter(item => item.evidence_required === true);
  if (!requirements.length) {
    const query = safeString(fallbackQuery);
    return query ? [{ requirement_id: '', channel: 'general', query }] : [];
  }
  const subjectPrefix = extractLatinAnchors(contract.objective).slice(0, 4).join(' ');
  return requirements.slice(0, 10).map(item => {
    const requirementText = safeString(item.text);
    const query = extractLatinAnchors(requirementText).length || !subjectPrefix
      ? requirementText
      : `${subjectPrefix} ${requirementText}`;
    return {
      requirement_id: safeString(item.id),
      channel: 'requirement',
      query: query.slice(0, 180),
    };
  });
}

/**
 * 根据来源类型计算 Claim 可信状态。
 * @param {object} source 规范化来源。
 * @returns {string} Claim 状态。
 */
function claimStatusForSource(source = {}) {
  if (source.source_type === 'first_party' || ['official_page', 'official_feed', 'page_body'].includes(source.evidence)) return 'verified';
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(safeString(source.url))) return 'primary_attributed';
  return 'secondary_attributed';
}

/**
 * 选择能完整覆盖要求锚点的最小来源集合，避免把泛相关页面写入 Claim。
 * @param {object} requirement Creative Contract 要求。
 * @param {Array<object>} matches 来源匹配结果。
 * @returns {Array<object>} 最小来源集合。
 */
function selectCoverageMatches(requirement = {}, matches = []) {
  const latinAnchors = extractLatinAnchors(requirement.text);
  const chineseAnchors = extractChineseAnchors(requirement.text);
  const hasHardAnchors = extractNumberAnchors(requirement.text).length
    + latinAnchors.length
    + SPECIAL_ANCHORS.filter(([, pattern]) => pattern.test(safeString(requirement.text))).length > 0;
  if (!hasHardAnchors) {
    const requiredCount = requiredChineseAnchorCount(chineseAnchors);
    const selected = [];
    const covered = new Set();
    const candidates = matches
      .filter(item => item.match.matched_chinese.length > 0)
      .sort((left, right) => right.match.matched_chinese.length - left.match.matched_chinese.length);
    for (const candidate of candidates) {
      const gained = candidate.match.matched_chinese.filter(anchor => !covered.has(anchor));
      if (!gained.length) continue;
      selected.push(candidate);
      gained.forEach(anchor => covered.add(anchor));
      if (covered.size >= requiredCount) return selected;
    }
    return [];
  }
  const required = new Set([
    ...extractNumberAnchors(requirement.text).map(value => `number:${value}`),
    ...latinAnchors.map(value => `latin:${value}`),
    ...SPECIAL_ANCHORS
      .filter(([, pattern]) => pattern.test(safeString(requirement.text)))
      .map(([id]) => `special:${id}`),
  ]);
  const candidates = matches.map(item => {
    const keys = new Set([
      ...item.match.matched_numbers.map(value => `number:${value}`),
      ...item.match.matched_latin.map(value => `latin:${value}`),
      ...Object.entries(item.match.special)
        .filter(([, matched]) => matched && latinAnchors.every(anchor => item.match.matched_latin.includes(anchor)))
        .map(([id]) => `special:${id}`),
    ]);
    return { ...item, keys };
  }).filter(item => item.keys.size > 0);
  const selected = [];
  while (required.size && candidates.length) {
    candidates.sort((left, right) => {
      const leftGain = [...left.keys].filter(key => required.has(key)).length;
      const rightGain = [...right.keys].filter(key => required.has(key)).length;
      return rightGain - leftGain || right.match.score - left.match.score;
    });
    const next = candidates.shift();
    const gained = [...next.keys].filter(key => required.has(key));
    if (!gained.length) break;
    selected.push(next);
    gained.forEach(key => required.delete(key));
  }
  return required.size ? [] : selected;
}

/**
 * 把研究上下文转为按 Contract 要求映射的 Evidence Pack。
 * @param {object} contract Creative Contract。
 * @param {object} researchContext 研究上下文。
 * @param {string} now 生成时间。
 * @returns {object} Evidence Pack V2。
 */
function buildEvidencePack(contract = {}, researchContext = {}, now = '') {
  const rawSources = (Array.isArray(researchContext.sources) ? researchContext.sources : []).map((source, index) => ({
    id: `src_${String(index + 1).padStart(2, '0')}`,
    title: safeString(source.title),
    url: safeString(source.url),
    type: safeString(source.source_type || 'media'),
    source_type: safeString(source.source_type || 'media'),
    published_at: safeString(source.published_at),
    retrieved_at: safeString(source.retrieved_at || researchContext.updated_at || now),
    summary: safeString(source.summary),
    evidence: safeString(source.evidence || 'search_snippet'),
    discovery_channel: safeString(source.discovery_channel),
    content_hash: hashValue([source.title, source.url, source.summary, source.published_at]),
  }));
  const requirements = Array.isArray(contract.must_cover) ? contract.must_cover : [];
  const claims = [];
  const requirementCoverage = requirements.map(requirement => {
    const evidenceSources = rawSources.filter(source => !['search_snippet', 'official_url', ''].includes(source.evidence));
    const matches = evidenceSources.map(source => ({ source, match: matchRequirementSource(requirement, source) }));
    const coverage = evaluateRequirementCoverage(requirement, matches);
    const selectedMatches = coverage.covered && requirement.evidence_required === true
      ? selectCoverageMatches(requirement, matches)
      : [];
    if (selectedMatches.length) {
      const selectedSources = selectedMatches.map(item => item.source);
      claims.push({
        id: `claim_${String(claims.length + 1).padStart(2, '0')}`,
        requirement_ids: [requirement.id],
        text: selectedSources
          .map(source => extractRelevantExcerpt(requirement, source.summary || source.title))
          .filter(Boolean)
          .join('\n')
          .slice(0, 1600),
        status: selectedSources.some(source => claimStatusForSource(source) === 'verified')
          ? 'verified'
          : selectedSources.some(source => claimStatusForSource(source) === 'primary_attributed')
            ? 'primary_attributed'
            : 'secondary_attributed',
        source_ids: selectedSources.map(source => source.id),
      });
    }
    return { requirement_id: requirement.id, ...coverage };
  });
  const missingCritical = requirements
    .filter(item => item.critical !== false && item.evidence_required === true)
    .filter(item => !requirementCoverage.find(coverage => coverage.requirement_id === item.id)?.covered)
    .map(item => item.id);
  const covered = requirementCoverage.filter(item => item.covered).map(item => item.requirement_id);
  const sources = rawSources.map(source => {
    const excerpts = requirements
      .filter(requirement => matchRequirementSource(requirement, source).score > 0)
      .map(requirement => extractRelevantExcerpt(requirement, source.summary, 500));
    return {
      ...source,
      summary: [...new Set(excerpts.filter(Boolean))].join('\n').slice(0, 1600),
    };
  });
  const pack = {
    version: 2,
    sources,
    claims,
    coverage: {
      status: missingCritical.length ? 'incomplete' : 'ready',
      ready: missingCritical.length === 0,
      covered_requirement_ids: covered,
      missing_critical_requirement_ids: missingCritical,
      requirements: requirementCoverage,
    },
    created_at: safeString(now || researchContext.updated_at),
  };
  return { ...pack, input_hash: hashValue([contract.input_hash, researchContext]) };
}

module.exports = {
  buildEvidencePack,
  buildRequirementSearchQueries,
  evaluateRequirementCoverage,
  extractLatinAnchors,
  extractChineseAnchors,
  extractNumberAnchors,
  matchRequirementSource,
};
