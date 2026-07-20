const crypto = require('crypto');

const EVIDENCE_REQUIREMENT_PATTERN = /查证|核查|核验|核实|确认|证实|明确(?:区分|说明|标明)|区分|原帖|来源|发布时间|官方依据|统计口径|数据口径|额度|限额|机制|最新官方信息/;
const FORBIDDEN_PATTERN = /不得|不要|禁止|避免|不可|不能/;
const VISUAL_PATTERN = /视觉|画面|竖屏|横屏|字幕|卡片|截图|配色|动效/;

/**
 * 把任意值归一化为去除首尾空白的字符串。
 * @param {unknown} value 原始值。
 * @returns {string} 归一化文本。
 */
function safeString(value) {
  return String(value ?? '').trim();
}

/**
 * 生成稳定短哈希，便于判断契约是否变化。
 * @param {unknown} value 待计算内容。
 * @returns {string} SHA-256 哈希。
 */
function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/**
 * 按中文创作指令边界拆分条款。
 * @param {string} text 用户创作要求。
 * @returns {string[]} 去重后的条款列表。
 */
function splitClauses(text) {
  const normalized = safeString(text)
    .replace(/\r/g, '\n')
    .replace(/[。；;]+/g, '\n')
    .replace(/，(?=(?:还要|并且|同时|确认|明确|分别|特别|重点|核实|核验|查证|不得|不要|禁止))/g, '\n');
  const seen = new Set();
  return normalized.split(/\n+/)
    .map(item => item.replace(/^[\s\d一二三四五六七八九十、.．)）(（-]+/, '').trim())
    .filter(item => item.length >= 4)
    .filter(item => {
      const key = item.replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * 提取视频面向的受众描述。
 * @param {string} text 用户创作要求。
 * @returns {string} 受众描述。
 */
function extractAudience(text) {
  return safeString(text).match(/(?:目标受众|受众|适合人群|面向)\s*[：:]?\s*([^，。；;\n]{2,60})/)?.[1]?.trim() || '';
}

/**
 * 提取必须覆盖的业务要求。
 * @param {string} text 用户创作要求。
 * @returns {Array<object>} 要求列表。
 */
function extractMustCover(text) {
  const researchText = safeString(text).split(/内容结构建议|表达要清晰|视觉上/)[0];
  const clauses = splitClauses(researchText);
  const requirements = [];
  const objective = clauses[0] || safeString(text).slice(0, 240);
  if (objective) {
    requirements.push({
      text: objective.slice(0, 320),
      critical: true,
      evidence_required: false,
      kind: 'objective',
    });
  }

  clauses.forEach(clause => {
    if (!EVIDENCE_REQUIREMENT_PATTERN.test(clause) || FORBIDDEN_PATTERN.test(clause)) return;
    if (/^创作目标/.test(clause)) return;
    const cleaned = clause
      .replace(/^(?:制作前)?(?:必须|需要|请)?(?:联网)?(?:查证|核查|核验|核实)?[：:]?\s*/, '')
      .trim();
    if (!cleaned || cleaned === objective) return;
    const isConstraint = /优先引用|以.+为准|标明来源|若无法|应明确表述/.test(cleaned);
    requirements.push({
      text: cleaned.slice(0, 320),
      critical: true,
      evidence_required: !isConstraint,
      kind: isConstraint ? 'constraint' : 'fact',
    });
  });

  // 没有拆出独立事实条款时，事实核验型目标本身必须经过证据门禁。
  if (requirements.length === 1 && EVIDENCE_REQUIREMENT_PATTERN.test(objective)) {
    requirements[0].evidence_required = true;
    requirements[0].kind = 'fact';
  }

  return requirements.slice(0, 12).map((item, index) => ({
    id: `req_${String(index + 1).padStart(2, '0')}`,
    ...item,
  }));
}

/**
 * 提取明确禁止的表达或视觉行为。
 * @param {string} text 用户创作要求。
 * @returns {string[]} 禁止项。
 */
function extractForbidden(text) {
  return splitClauses(text)
    .filter(clause => FORBIDDEN_PATTERN.test(clause))
    .map(clause => clause.slice(0, 240))
    .slice(0, 12);
}

/**
 * 提取用户明确给出的视觉约束。
 * @param {string} text 用户创作要求。
 * @returns {string[]} 视觉约束。
 */
function extractVisualConstraints(text) {
  return splitClauses(text)
    .filter(clause => VISUAL_PATTERN.test(clause))
    .map(clause => clause.slice(0, 240))
    .slice(0, 8);
}

/**
 * 提取用户明确提供的证据链接，研究阶段应优先读取这些原始来源。
 * @param {string} text 用户创作要求。
 * @param {unknown} explicitUrls 结构化传入的来源链接。
 * @returns {string[]} 去重后的 HTTP(S) 链接。
 */
function extractReferenceUrls(text, explicitUrls) {
  const textUrls = safeString(text).match(/https?:\/\/[^\s)）\]}>,，。；;"']+/g) || [];
  const values = [
    ...textUrls,
    ...(Array.isArray(explicitUrls) ? explicitUrls : []),
  ];
  return [...new Set(values.map(safeString).filter(value => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }))].slice(0, 12);
}

/**
 * 从用户输入和目标参数生成 Creative Contract V2。
 * @param {object} input 已归一化创作输入。
 * @param {object} target 成片目标参数。
 * @param {string} now 创建时间。
 * @returns {object} 稳定创作契约。
 */
function buildCreativeContract(input = {}, target = {}, now = '') {
  const rawText = safeString(input.raw_text || input.text || input.title || input.source_url || input.aweme_id);
  const mustCover = extractMustCover(rawText);
  const contract = {
    version: 2,
    objective: mustCover[0]?.text || rawText.slice(0, 320),
    audience: extractAudience(rawText),
    target: {
      duration_sec: Number(target.duration_sec || target.durationSec || 0) || 0,
      aspect_ratio: safeString(target.aspect_ratio || target.aspectRatio),
      content_mode: safeString(target.content_mode || target.contentMode || 'analysis'),
    },
    must_cover: mustCover,
    forbidden: extractForbidden(rawText),
    visual_constraints: extractVisualConstraints(rawText),
    reference_urls: extractReferenceUrls(rawText, input.reference_urls || input.referenceUrls),
    research_required: mustCover.some(item => item.critical && item.evidence_required),
    created_at: safeString(now),
  };
  return { ...contract, input_hash: hashValue(contract) };
}

module.exports = {
  buildCreativeContract,
  extractMustCover,
  extractReferenceUrls,
  splitClauses,
};
