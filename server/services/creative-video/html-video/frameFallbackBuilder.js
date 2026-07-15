/**
 * 将未知值收敛为普通对象。
 */
function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * 转义插入 HTML 的动态文本。
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 提取第一个可展示的文本值。
 */
function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text && text !== '[object Object]') return text;
  }
  return '';
}

/**
 * 从字符串或常见内容对象中读取可见文案。
 */
function textFromValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return firstText(value);
  const item = objectOrEmpty(value);
  return firstText(item.text, item.label, item.title, item.value, item.name);
}

/**
 * 规范化关键词或卡片列表，并去除重复内容。
 */
function normalizeTextList(value, limit = 4) {
  const source = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return [...new Set(source.map(textFromValue).filter(Boolean))].slice(0, limit);
}

/**
 * 限制兜底画面的单段文字长度，避免极端输入破坏布局。
 */
function clipText(value, maxLength) {
  const text = firstText(value);
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

/**
 * 解析场景序号，用于稳定切换构图和配色。
 */
function resolveSceneIndex(scene = {}, node = {}) {
  const metadata = objectOrEmpty(node.metadata);
  const explicit = Number(metadata.order || scene.order || node.order);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const id = firstText(scene.id, node.id);
  const matched = id.match(/(\d+)(?!.*\d)/);
  return matched ? Math.max(1, Number(matched[1])) : 1;
}

/**
 * 读取场景视觉文案，兼容 content graph 元数据中的镜像字段。
 */
function resolveVisualText(scene = {}, node = {}) {
  const sceneVisual = objectOrEmpty(scene.visual_text);
  const nodeVisual = objectOrEmpty(objectOrEmpty(node.metadata).visual_text);
  return {
    headline: firstText(sceneVisual.headline, nodeVisual.headline, node.label, node.title, scene.title),
    keywords: normalizeTextList(sceneVisual.keywords || nodeVisual.keywords, 5),
    cards: normalizeTextList(sceneVisual.cards || nodeVisual.cards, 4),
  };
}

/**
 * 解析渲染尺寸并提供安全默认值。
 */
function resolveResolution(target = {}, template = {}) {
  const output = objectOrEmpty(template.output);
  const resolution = objectOrEmpty(target.resolution || output.resolution);
  const width = Number(target.width || resolution.width || 1920);
  const height = Number(target.height || resolution.height || 1080);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

/**
 * 根据场景序号选择高对比度配色，减少连续镜头的视觉重复。
 */
function resolveTheme(sceneIndex) {
  const themes = [
    { accent: '#ffe36e', accent2: '#62e6ff', glow: 'rgba(98,230,255,.18)' },
    { accent: '#7cf7c4', accent2: '#83a7ff', glow: 'rgba(124,247,196,.17)' },
    { accent: '#ff9f7a', accent2: '#c58cff', glow: 'rgba(197,140,255,.18)' },
  ];
  return themes[(sceneIndex - 1) % themes.length];
}

/**
 * 生成信息卡片标记。
 */
function buildCardsHtml(cards = []) {
  return cards.map((card, index) => [
    `<article class="info-card" style="--i:${index + 1}">`,
    `<span class="card-no">0${index + 1}</span>`,
    `<strong>${escapeHtml(clipText(card, 24))}</strong>`,
    '<i aria-hidden="true"></i>',
    '</article>',
  ].join('')).join('');
}

/**
 * 生成关键词标签标记。
 */
function buildKeywordsHtml(keywords = []) {
  return keywords.map((keyword, index) => (
    `<span class="tag" style="--i:${index}">${escapeHtml(clipText(keyword, 12))}</span>`
  )).join('');
}

/**
 * 构建可发布质量的确定性兜底帧，模型连续失败时仍保留信息层级、构图差异和基础动效。
 */
function buildFallbackFrameHtml({ scene, node, target, template } = {}) {
  const safeScene = objectOrEmpty(scene);
  const safeNode = objectOrEmpty(node);
  const resolution = resolveResolution(target, template);
  const visualText = resolveVisualText(safeScene, safeNode);
  const sceneIndex = resolveSceneIndex(safeScene, safeNode);
  const theme = resolveTheme(sceneIndex);
  const orientation = resolution.height > resolution.width ? 'portrait' : 'landscape';
  const layout = `layout-${((sceneIndex - 1) % 3) + 1}`;
  const headline = clipText(firstText(visualText.headline, safeScene.id, safeNode.id, '重点速览'), 30);
  const keywords = visualText.keywords.length
    ? visualText.keywords
    : normalizeTextList([safeNode.kind, '关键结论', '行动建议'], 4);
  const defaultCards = ['核心结论', '判断依据', '验证路径', '下一步行动'];
  const cards = [...new Set([
    ...visualText.cards,
    ...keywords,
    clipText(safeNode.summary || safeNode.text, 24),
    ...defaultCards,
  ].filter(Boolean))].slice(0, 4);
  const subtitle = clipText(keywords.slice(0, 3).join(' · ') || '关键结论 · 判断依据 · 行动建议', 34);
  const focus = cards[0] || headline;
  const frameId = firstText(safeScene.id, safeNode.id, 'structured_frame');
  const sceneNo = String(sceneIndex).padStart(2, '0');

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta name="viewport" content="width=${resolution.width},height=${resolution.height},initial-scale=1.0">`,
    '<style>',
    `:root{--accent:${theme.accent};--accent2:${theme.accent2};--glow:${theme.glow};--w:${resolution.width}px;--h:${resolution.height}px}`,
    `html,body{margin:0;width:${resolution.width}px;height:${resolution.height}px;overflow:hidden;background:#090c13;color:#f7f9ff;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}`,
    '*{box-sizing:border-box}',
    '@keyframes stageIn{from{opacity:.82;transform:scale(.992)}to{opacity:1;transform:scale(1)}}',
    '@keyframes cardIn{from{opacity:.76;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes scan{0%{transform:translateX(-120%)}45%,100%{transform:translateX(140%)}}',
    '@keyframes pulse{0%,100%{transform:scale(.96);opacity:.32}50%{transform:scale(1.06);opacity:.68}}',
    '.stage{position:relative;width:100%;height:100%;isolation:isolate;background:radial-gradient(circle at 82% 12%,var(--glow),transparent 34%),linear-gradient(145deg,#090c13 0%,#111827 54%,#0a101b 100%);animation:stageIn .65s ease-out both}',
    '.stage:before{content:"";position:absolute;inset:0;z-index:-3;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,#000 0%,transparent 76%)}',
    '.orb{position:absolute;z-index:-2;width:420px;height:420px;border:1px solid color-mix(in srgb,var(--accent2) 35%,transparent);border-radius:50%;right:-120px;top:240px;box-shadow:0 0 110px var(--glow);animation:pulse 4.8s ease-in-out infinite}',
    '.orb:after{content:"";position:absolute;inset:74px;border:1px dashed color-mix(in srgb,var(--accent) 38%,transparent);border-radius:50%}',
    '.shell{height:100%;display:flex;flex-direction:column}',
    '.portrait .shell{padding:112px 86px 420px}',
    '.landscape .shell{padding:64px 96px 210px}',
    '.topbar{display:flex;align-items:center;justify-content:space-between;min-height:44px;color:#a9b4c8;font-size:20px;font-weight:700;letter-spacing:.12em}',
    '.topbar .brand{display:flex;align-items:center;gap:14px}',
    '.topbar .brand:before{content:"";width:34px;height:8px;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 22px var(--glow)}',
    '.scene-no{font-variant-numeric:tabular-nums;color:var(--accent)}',
    '.header{margin-top:66px;margin-bottom:48px;max-width:900px}',
    '.landscape .header{margin-top:32px;margin-bottom:26px;max-width:1320px}',
    '.eyebrow{margin:0 0 16px;color:var(--accent2);font-size:23px;font-weight:800;letter-spacing:.08em}',
    'h1{margin:0;font-size:76px;line-height:1.08;letter-spacing:-.045em;font-weight:900;text-wrap:balance}',
    '.landscape h1{font-size:64px;line-height:1.04}',
    '.subtitle{margin:22px 0 0;color:#b9c5d8;font-size:29px;line-height:1.35;font-weight:650}',
    '.landscape .subtitle{margin-top:14px;font-size:24px}',
    '.visual-grid{display:grid;min-height:0;flex:1;gap:20px}',
    '.layout-1 .visual-grid{grid-template-columns:1.2fr .8fr}',
    '.layout-2 .visual-grid{grid-template-columns:1fr}',
    '.layout-3 .visual-grid{grid-template-columns:.78fr 1.22fr}',
    '.focus-card,.info-card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.13);background:linear-gradient(145deg,rgba(25,34,50,.94),rgba(13,19,30,.92));box-shadow:0 24px 70px rgba(0,0,0,.26)}',
    '.focus-card{border-radius:30px;padding:38px;display:flex;flex-direction:column;justify-content:space-between;min-height:280px;animation:cardIn .72s .08s ease-out both}',
    '.focus-card:before{content:"";position:absolute;inset:0 auto 0 0;width:7px;background:linear-gradient(var(--accent),var(--accent2))}',
    '.focus-card:after{content:"";position:absolute;top:0;bottom:0;width:42%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.075),transparent);animation:scan 4.6s 1s ease-in-out infinite}',
    '.focus-label{color:#8f9db4;font-size:20px;font-weight:750;letter-spacing:.1em}',
    '.focus-card strong{position:relative;z-index:1;display:block;max-width:92%;font-size:42px;line-height:1.18;letter-spacing:-.025em}',
    '.focus-index{color:var(--accent);font-size:84px;line-height:1;font-weight:950;opacity:.92;font-variant-numeric:tabular-nums}',
    '.cards{display:grid;grid-template-columns:1fr;gap:16px;min-height:0}',
    '.layout-2 .cards{grid-template-columns:repeat(3,1fr)}',
    '.layout-2 .focus-card{min-height:210px;flex-direction:row;align-items:flex-end}',
    '.layout-2 .focus-card strong{font-size:40px;max-width:68%}',
    '.info-card{border-radius:22px;padding:24px 24px 22px;display:grid;grid-template-columns:48px 1fr;align-items:center;gap:16px;animation:cardIn .62s calc(.12s + var(--i)*.1s) ease-out both}',
    '.info-card strong{font-size:26px;line-height:1.24}',
    '.card-no{color:var(--accent2);font-size:18px;font-weight:850;font-variant-numeric:tabular-nums}',
    '.info-card i{position:absolute;left:24px;right:24px;bottom:0;height:3px;border-radius:9px;background:linear-gradient(90deg,var(--accent2),transparent);opacity:.68}',
    '.tags{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;min-height:48px}',
    '.landscape .tags{margin-top:16px}',
    '.tag{padding:11px 17px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:rgba(255,255,255,.055);color:#d2d9e7;font-size:19px;font-weight:700;animation:cardIn .55s calc(.26s + var(--i)*.08s) ease-out both}',
    '.landscape .focus-card{min-height:180px;padding:28px}',
    '.landscape .focus-card strong{font-size:34px}',
    '.landscape .focus-index{font-size:64px}',
    '.landscape .info-card{padding:18px 20px}',
    '.landscape .info-card strong{font-size:22px}',
    '</style>',
    '</head>',
    `<body class="${orientation}" data-hv-canvas data-width="${resolution.width}" data-height="${resolution.height}">`,
    `<main class="stage ${layout}" data-frame-id="${escapeHtml(frameId)}" data-render-mode="structured-fallback">`,
    '<div class="orb" aria-hidden="true"></div>',
    '<section class="shell">',
    '<div class="topbar"><span class="brand">重点速览</span>',
    `<span class="scene-no">SCENE / ${sceneNo}</span></div>`,
    '<header class="header">',
    `<p class="eyebrow">${escapeHtml(clipText(keywords[0] || '内容拆解', 12))}</p>`,
    `<h1 data-text-key="headline">${escapeHtml(headline)}</h1>`,
    `<p class="subtitle" data-text-key="subtitle">${escapeHtml(subtitle)}</p>`,
    '</header>',
    '<section class="visual-grid">',
    '<article class="focus-card">',
    '<span class="focus-label">核心判断</span>',
    `<strong>${escapeHtml(clipText(focus, 24))}</strong>`,
    `<span class="focus-index">${sceneNo}</span>`,
    '</article>',
    `<section class="cards" data-text-key="body">${buildCardsHtml(cards.slice(1))}</section>`,
    '</section>',
    `<div class="tags">${buildKeywordsHtml(keywords.slice(1))}</div>`,
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = {
  buildFallbackFrameHtml,
};
