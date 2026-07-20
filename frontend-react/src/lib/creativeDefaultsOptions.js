export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];

export const CREATIVE_FPS_OPTIONS = [30, 60];

export const CONTENT_MODE_OPTIONS = [
  { value: 'news', label: '资讯' },
  { value: 'analysis', label: '解读' },
  { value: 'discussion', label: '讨论' },
];

export const DEFAULT_TTS_VOICE = 'mimo_default';

export const FALLBACK_TTS_VOICES = [
  { id: DEFAULT_TTS_VOICE, label: '默认音色' },
  { id: '冰糖', label: '冰糖' },
  { id: '茉莉', label: '茉莉' },
  { id: '苏打', label: '苏打' },
  { id: '白桃', label: '白桃' },
  { id: '白桦', label: '白桦' },
  { id: 'Mia', label: 'Mia' },
  { id: 'Chloe', label: 'Chloe' },
  { id: 'Milo', label: 'Milo' },
  { id: 'Dean', label: 'Dean' },
];

export const DEFAULT_CREATIVE_DEFAULTS = {
  aspectRatio: '9:16',
  targetDurationSec: 60,
  fps: 30,
  playbackSpeed: 1.1,
  templateByAspectRatio: {
    '9:16': '',
    '16:9': '',
    '1:1': '',
    '4:5': '',
  },
  lockTemplate: false,
  contentMode: 'analysis',
  useResearch: true,
  generateAudio: true,
  autoSfxEnabled: true,
  generateCaptions: true,
  emotionalVoice: false,
  ttsVoice: DEFAULT_TTS_VOICE,
  sourceImageAnalysisEnabled: false,
  extractDouyinFrames: false,
  frameHtmlConcurrency: 1,
};

export const TEMPLATE_NAME_ZH = {
  bold_poster: '醒目宣言海报',
  bold_signal: '信号卡片',
  creative_voltage: '创意电压',
  data_chart: '编辑部趋势图',
  glitch_title: '故障风格标题',
  light_leak: '漏光电影',
  liquid_hero: '流体极光主视觉',
  news_signal_vertical: '竖屏财经信号',
  pentagram_stat: '瑞士网格统计',
  portrait_cinematic_story: '竖版电影故事',
  portrait_data_story: '竖版数据故事',
  portrait_editorial_explainer: '竖版杂志解释',
  portrait_product_steps: '竖版产品路径',
  portrait_source_brief: '竖版信源简报',
  square_compare_grid: '方形双栏对比',
  square_data_evidence: '方形数据证据',
  square_editorial_cards: '方形模块简报',
  square_product_spotlight: '方形产品聚焦',
  square_quote_signal: '方形霓虹观点',
  vertical_editorial_digest: '竖屏编辑部解读',
  vertical_compare_decision: '竖屏对比决策',
  vertical_data_chart: '竖屏数据图解',
  vertical_documentary_story: '竖屏纪实故事',
  vertical_process_steps: '竖屏蓝图步骤',
  vertical_product_demo: '竖屏产品演示',
  vertical_source_context: '竖屏信源解读',
  vertical_story_quote: '竖屏人物观点',
  wide_editorial_explainer: '横屏深度解释',
  wide_process_blueprint: '横屏流程蓝图',
  'frame-bold-poster': '醒目海报',
  'frame-bold-signal': '强信号卡片',
  'frame-build-minimal': '极简构建',
  'frame-creative-voltage': '创意电压',
  'frame-data-chart-nyt': '数据图表',
  'frame-data-rollup': '数据汇总',
  'frame-decision-tree': '决策树',
  'frame-electric-studio': '电光工作室',
  'frame-glitch-title': '故障标题',
  'frame-kinetic-type': '动态文字',
  'frame-light-leak-cinema': '漏光电影',
  'frame-liquid-bg-hero': '液态背景主视觉',
  'frame-logo-outro': 'Logo 片尾',
  'frame-nyt-graph': '新闻图表',
  'frame-pentagram-stat': '醒目数据',
  'frame-play-mode': '播放模式',
  'frame-product-promo': '产品推广',
  'frame-product-promo-30s': '产品推广 30 秒',
  'frame-swiss-grid': '瑞士网格',
  'frame-takram-organic': '有机视觉',
  'frame-vignelli': '维涅利版式',
  'frame-warm-grain': '暖色颗粒',
  'vfx-text-cursor': '文字光标特效',
};

const TEMPLATE_CATEGORY_ZH = {
  heroes: '品牌产品',
  hero: '品牌产品',
  titles: '标题开场',
  title: '标题开场',
  news: '资讯解读',
  data: '数据图表',
  cinematic: '故事叙事',
  promo: '品牌产品',
};

/**
 * 补齐创作默认值，保留表单输入中的空值以支持用户继续编辑。
 * @param {object} defaults 后端保存值或页面草稿。
 * @returns {object} 字段完整的创作默认值。
 */
export function normalizeCreativeDefaults(defaults = {}) {
  const source = defaults && typeof defaults === 'object' ? defaults : {};
  const fps = Number(source.fps);
  const playbackSpeed = source.playbackSpeed === ''
    ? ''
    : (Number.isFinite(Number(source.playbackSpeed))
      ? Number(source.playbackSpeed)
      : DEFAULT_CREATIVE_DEFAULTS.playbackSpeed);
  return {
    ...DEFAULT_CREATIVE_DEFAULTS,
    ...source,
    templateByAspectRatio: {
      ...DEFAULT_CREATIVE_DEFAULTS.templateByAspectRatio,
      ...(source.templateByAspectRatio || {}),
    },
    fps: CREATIVE_FPS_OPTIONS.includes(fps) ? fps : DEFAULT_CREATIVE_DEFAULTS.fps,
    contentMode: CONTENT_MODE_OPTIONS.some(option => option.value === source.contentMode)
      ? source.contentMode
      : DEFAULT_CREATIVE_DEFAULTS.contentMode,
    playbackSpeed,
    ttsVoice: String(source.ttsVoice || DEFAULT_TTS_VOICE).trim() || DEFAULT_TTS_VOICE,
  };
}

/**
 * 从应用设置对象中读取创作默认值。
 * @param {object} appSettings 应用设置。
 * @returns {object} 字段完整的创作默认值。
 */
export function getCreativeDefaults(appSettings) {
  return normalizeCreativeDefaults(appSettings?.creativeDefaults);
}

/**
 * 读取模板声明里的主画幅。
 * @param {object} template 模板声明。
 * @returns {string} 画幅值。
 */
export function getTemplateAspect(template) {
  return template?.aspect_ratio || template?.aspectRatio || template?.aspect || '';
}

/**
 * 读取模板声明支持的全部画幅。
 * @param {object} template 模板声明。
 * @returns {string[]} 支持的画幅列表。
 */
export function getTemplateAspects(template) {
  const aspects = template?.supported_aspects || template?.supportedAspects;
  if (Array.isArray(aspects)) return aspects.map(item => String(item || '').trim()).filter(Boolean);
  const aspect = getTemplateAspect(template);
  return aspect ? [aspect] : [];
}

/**
 * 读取模板 ID。
 * @param {object} template 模板声明。
 * @returns {string} 模板 ID。
 */
export function getTemplateId(template) {
  return typeof template?.id === 'string' ? template.id : '';
}

/**
 * 判断模板是否应出现在指定画幅下。
 * @param {object} template 模板声明。
 * @param {string} aspectRatio 目标画幅。
 * @returns {boolean} 是否展示。
 */
export function isTemplateShownForAspect(template, aspectRatio) {
  const aspects = getTemplateAspects(template);
  return !aspects.length || aspects.includes(aspectRatio);
}

/**
 * 判断模板是否存在非画幅类阻断原因。
 * @param {object} template 模板声明。
 * @returns {boolean} 是否存在阻断原因。
 */
export function hasBlockingCompatibilityReason(template) {
  const reasons = Array.isArray(template?.compatibility_reasons) ? template.compatibility_reasons : [];
  return reasons.some(reason => reason?.code && reason.code !== 'unsupported-aspect');
}

/**
 * 返回模板中文展示名。
 * @param {object} template 模板声明。
 * @returns {string} 展示名。
 */
export function getTemplateDisplayName(template) {
  const id = getTemplateId(template);
  return TEMPLATE_NAME_ZH[id] || template?.name || id;
}

/**
 * 返回适合在模板选项中展示的中文分类，未知英文分类不直接暴露给用户。
 * @param {object} template 模板声明。
 * @returns {string} 中文分类或空字符串。
 */
export function getTemplateCategoryLabel(template) {
  const category = String(template?.category || '').trim();
  if (!category) return '';
  if (TEMPLATE_CATEGORY_ZH[category]) return TEMPLATE_CATEGORY_ZH[category];
  return /[\u3400-\u9fff]/.test(category) ? category : '';
}

/**
 * 返回模板下拉选项文案。
 * @param {object} template 模板声明。
 * @param {string} aspectRatio 当前画幅。
 * @returns {string} 选项文案。
 */
export function optionLabel(template, aspectRatio) {
  const compatible = isTemplateShownForAspect(template, aspectRatio) && !hasBlockingCompatibilityReason(template);
  const category = getTemplateCategoryLabel(template);
  return `${getTemplateDisplayName(template)}${category ? ` · ${category}` : ''}${compatible ? '' : '（不兼容）'}`;
}

/**
 * 归一化后端返回的音色选项，接口失败时使用内置 MiMo 音色兜底。
 * @param {Array<{id?: string, label?: string}>} voices 后端音色列表。
 * @returns {{id: string, label: string}[]} 可渲染音色列表。
 */
export function normalizeTtsVoiceOptions(voices) {
  const items = Array.isArray(voices) ? voices : [];
  const normalized = items
    .map(voice => ({
      id: String(voice?.id || '').trim(),
      label: String(voice?.label || voice?.id || '').trim(),
    }))
    .filter(voice => voice.id);
  return normalized.length ? normalized : FALLBACK_TTS_VOICES;
}
