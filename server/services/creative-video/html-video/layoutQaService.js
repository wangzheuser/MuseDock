const { pathToFileURL } = require('url');
const {
  installPausedAnimationStyle,
  seekPageToTime,
} = require('./hyperframesPlaywrightAdapter');

const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
const CANDIDATE_SELECTOR = [
  '[data-text-key]',
  '.headline',
  '.body-copy',
  '.card-title',
  '.big-number',
  '.valuation',
  '[data-role]',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
  'span',
  'div',
].join(',');

function defaultSampleTimes(durationSec) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  if (duration < 1.2) {
    return normalizeSampleTimes([
      0,
      Math.min(0.35, duration * 0.5),
      Math.max(0, duration - 0.1),
    ], duration);
  }
  return normalizeSampleTimes([
    0,
    0.35,
    duration < 2 ? 0.8 : 1.2,
    duration * 0.65,
    Math.max(0, duration - 0.3),
  ], duration).slice(0, 5);
}

function normalizeSampleTimes(sampleTimesSec, durationSec) {
  const duration = Number(durationSec);
  const hasDuration = Number.isFinite(duration) && duration >= 0;
  const sorted = (Array.isArray(sampleTimesSec) ? sampleTimesSec : [])
    .map(time => Number(time))
    .filter(time => Number.isFinite(time) && time >= 0)
    .filter(time => !hasDuration || time <= duration)
    .sort((a, b) => a - b);

  const normalized = [];
  for (const time of sorted) {
    if (normalized.some(existing => Math.abs(existing - time) <= 0.05)) continue;
    normalized.push(Number(time.toFixed(3)));
    if (normalized.length >= 5) break;
  }
  return normalized;
}

async function loadPlaywright(options = {}) {
  if (options.playwright) return options.playwright;
  try {
    if (typeof options.importPlaywright === 'function') {
      return await options.importPlaywright();
    }
    return await import('playwright-core');
  } catch (error) {
    return { error };
  }
}

function makeIssue({
  code,
  severity = 'error',
  frameId,
  sampleTimeSec,
  message,
  details = {},
}) {
  return {
    code,
    severity,
    frame_id: frameId || null,
    sample_time_sec: sampleTimeSec,
    message,
    details,
  };
}

function isBlockingIssue(issue) {
  return issue.severity !== 'warning' && issue.severity !== 'info';
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const details = issue.details || {};
    const key = [
      issue.code,
      issue.code === 'scene_opening_low_information' ? issue.sample_time_sec : '',
      details.selector, details.text,
      details.first?.selector, details.first?.text,
      details.second?.selector, details.second?.text,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function intersects(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { width, height, area: width * height };
}

function isPrimaryText(candidate) {
  const name = `${candidate.key || ''} ${candidate.selector || ''}`.toLowerCase();
  return name.includes('headline')
    || name.includes('body')
    || name.includes('subtitle');
}

function isDecorativeText(candidate) {
  const name = [
    candidate.key,
    candidate.role,
    candidate.selector,
    candidate.container?.role,
    candidate.container?.selector,
  ].filter(Boolean).join(' ').toLowerCase();
  return /counter|number|decorative|ornament|background|watermark|brand|footer|kicker|eyebrow|label|badge|chip|meta|signal|engine|date|time|stamp|dim|tick/.test(name);
}

/**
 * 判断文本候选是否属于系统注入的字幕层。
 * @param {object} candidate 文本候选。
 * @returns {boolean}
 */
function isSystemCaption(candidate) {
  const name = [candidate.key, candidate.role, candidate.selector, candidate.container?.selector]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /hv-caption|subtitle-caption/.test(name);
}

/**
 * 判断文本是否可作为场景开头的主体信息，显式文本锚点优先于父容器命名。
 * @param {object} candidate 文本候选。
 * @returns {boolean}
 */
function isOpeningPrimaryText(candidate) {
  if (isSystemCaption(candidate)) return false;
  if (/^\d{1,3}\s*[/|·-]\s*\d{1,3}$/.test(String(candidate.text || '').replace(/\s+/g, ' ').trim())) {
    return false;
  }
  const structuralName = [candidate.role, candidate.selector]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/section(?:-|_)?(?:no|number)|counter|decorative|ornament|watermark|footer|kicker|eyebrow|badge|chip|meta|date|time|stamp|tick/.test(structuralName)) {
    return false;
  }
  const ownName = [candidate.key, candidate.role, candidate.selector]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/headline|body|subtitle|title|copy|summary|description/.test(ownName)) return true;
  if (/^h[1-3]$/.test(candidate.tag || '')) return true;
  return (candidate.tag === 'p' || candidate.tag === 'li')
    && String(candidate.text || '').trim().length >= 4
    && !isDecorativeText(candidate);
}

/**
 * 计算元素矩形与画布相交区域。
 * @param {object} box 元素矩形。
 * @param {object} resolution 画布尺寸。
 * @returns {number}
 */
function visibleArea(box, resolution) {
  if (!box) return 0;
  const width = Math.max(0, Math.min(box.right, resolution.width) - Math.max(box.left, 0));
  const height = Math.max(0, Math.min(box.bottom, resolution.height) - Math.max(box.top, 0));
  return width * height;
}

/**
 * 判断候选元素是否有足够比例处于画布内，过滤仅露出少量边缘的入场元素。
 * @param {object} candidate 文本候选。
 * @param {object} resolution 画布尺寸。
 * @returns {boolean}
 */
function isSubstantiallyVisible(candidate, resolution) {
  const boxArea = Number(candidate?.box?.width || 0) * Number(candidate?.box?.height || 0);
  if (boxArea <= 0) return false;
  return visibleArea(candidate.box, resolution) / boxArea >= 0.25;
}

/**
 * 收集当前时间点可见的主视觉容器，避免仅凭字幕或角落编号判定画面有效。
 * @param {import('playwright-core').Page} page Playwright 页面。
 * @param {object} resolution 画布尺寸。
 * @returns {Promise<object>}
 */
async function collectVisualAnchors(page, resolution) {
  return page.evaluate(({ width, height }) => {
    const selector = [
      'img',
      'video',
      'canvas',
      'svg',
      '[data-role="visual-card"]',
      '[data-role="media"]',
      '[data-role="chart"]',
      '.card',
      '.panel',
      '.tile',
      '.module',
      '.visual',
      '.media',
    ].join(',');
    const viewportArea = width * height;

    function alpha(color) {
      const match = String(color || '').match(/rgba?\([^)]*?(?:,|\s\/\s)([\d.]+)\s*\)$/i);
      return match ? Number(match[1]) : (String(color || '') === 'transparent' ? 0 : 1);
    }

    function intersectionArea(rect) {
      const visibleWidth = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
      return visibleWidth * visibleHeight;
    }

    function hasVisibleAppearance(element, style) {
      const tag = element.tagName.toLowerCase();
      if (tag === 'img') return element.complete && element.naturalWidth > 0;
      if (tag === 'video') return element.readyState >= 1;
      if (tag === 'canvas' || tag === 'svg') return true;
      return style.backgroundImage !== 'none'
        || alpha(style.backgroundColor) >= 0.08
        || Number.parseFloat(style.borderTopWidth || '0') > 0
        || style.boxShadow !== 'none';
    }

    function effectiveOpacity(element) {
      let current = element;
      let opacity = 1;
      while (current) {
        const style = getComputedStyle(current);
        if (!style || style.display === 'none' || style.visibility === 'hidden') return 0;
        opacity *= Number(style.opacity || 1);
        if (opacity < 0.15) return opacity;
        current = current.parentElement;
      }
      return opacity;
    }

    const anchors = Array.from(document.querySelectorAll(selector))
      .filter(element => !element.closest('[data-hv-layer="captions"], .hv-caption-layer, [data-layout-ignore], [aria-hidden="true"]'))
      .map(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const area = intersectionArea(rect);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || effectiveOpacity(element) < 0.15
          || area <= 0
          || !hasVisibleAppearance(element, style)
        ) return null;
        return {
          selector: element.id
            ? `#${element.id}`
            : `${element.tagName.toLowerCase()}${element.classList.length ? `.${Array.from(element.classList).join('.')}` : ''}`,
          visible_area_ratio: viewportArea > 0 ? area / viewportArea : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.visible_area_ratio - a.visible_area_ratio);

    return {
      count: anchors.length,
      max_visible_area_ratio: anchors[0]?.visible_area_ratio || 0,
      anchors: anchors.slice(0, 5),
    };
  }, {
    width: resolution.width,
    height: resolution.height,
  });
}

/**
 * 检查场景开头是否已有足够明确的主体内容。
 * @param {object} options 检查参数。
 * @returns {Array<object>}
 */
function inspectOpeningContent({ candidates, visualAnchors, resolution, frameId, sampleTimeSec }) {
  if (sampleTimeSec > 0.4) return [];
  const primaryCandidates = candidates.filter(candidate => (
    isOpeningPrimaryText(candidate)
    && isSubstantiallyVisible(candidate, resolution)
  ));
  const maxVisualAreaRatio = Number(visualAnchors.max_visible_area_ratio || 0);
  if (primaryCandidates.length > 0 || maxVisualAreaRatio >= 0.04) return [];
  return [makeIssue({
    code: 'scene_opening_low_information',
    severity: 'error',
    frameId,
    sampleTimeSec,
    message: '场景开头缺少可辨识的主标题、主卡片、图片或核心视觉，容易出现只有背景或字幕的空档。',
    details: {
      primary_candidate_count: primaryCandidates.length,
      primary_candidates: primaryCandidates.slice(0, 5).map(candidate => ({
        selector: candidate.selector,
        text: String(candidate.text || '').slice(0, 80),
      })),
      visible_visual_anchor_count: visualAnchors.count || 0,
      max_visible_visual_area_ratio: maxVisualAreaRatio,
    },
  })];
}

function inspectCandidates({ candidates, resolution, frameId, sampleTimeSec }) {
  const issues = [];
  const viewportTolerance = 12;

  for (const candidate of candidates) {
    const box = candidate.box;
    const decorative = isDecorativeText(candidate);
    if (!candidate.allowOverflow && (
      box.left < -viewportTolerance
      || box.top < -viewportTolerance
      || box.right > resolution.width + viewportTolerance
      || box.bottom > resolution.height + viewportTolerance
    )) {
      issues.push(makeIssue({
        code: 'text_out_of_viewport',
        severity: decorative ? 'warning' : 'error',
        frameId,
        sampleTimeSec,
        message: '文本超出画面边界。',
        details: {
          text: candidate.text,
          selector: candidate.selector,
          box,
          viewport: resolution,
        },
      }));
    }

    const container = candidate.container;
    if (!candidate.allowOverflow && container && container.box) {
      const cbox = container.box;
      // overflow: visible 的容器允许入场位移和字体行盒产生少量外扩；裁切容器仍保持严格。
      const horizontalTolerance = container.overflow_x === 'visible' ? 24 : 12;
      const verticalTolerance = container.overflow_y === 'visible' ? 24 : 12;
      if (
        box.left < cbox.left - horizontalTolerance
        || box.top < cbox.top - verticalTolerance
        || box.right > cbox.right + horizontalTolerance
        || box.bottom > cbox.bottom + verticalTolerance
      ) {
        issues.push(makeIssue({
          code: 'text_out_of_container',
          severity: decorative ? 'warning' : 'error',
          frameId,
          sampleTimeSec,
          message: '文本超出语义容器边界。',
          details: {
            text: candidate.text,
            selector: candidate.selector,
            container: container.selector,
            box,
            container_box: cbox,
          },
        }));
      }
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.text === b.text) continue;
      if (
        (Array.isArray(a.ancestorIndexes) && a.ancestorIndexes.includes(b.index))
        || (Array.isArray(b.ancestorIndexes) && b.ancestorIndexes.includes(a.index))
      ) {
        continue;
      }

      const intersection = intersects(a.box, b.box);
      if (intersection.area <= 0) continue;

      const smallerArea = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      if (smallerArea <= 0 || intersection.area / smallerArea <= 0.25) continue;

      const code = isPrimaryText(a) || isPrimaryText(b)
        ? 'decorative_overlay_text'
        : 'text_overlap';
      issues.push(makeIssue({
        code,
        severity: isDecorativeText(a) || isDecorativeText(b) ? 'warning' : 'error',
        frameId,
        sampleTimeSec,
        message: '检测到文本元素互相重叠。',
        details: {
          first: { text: a.text, selector: a.selector, box: a.box },
          second: { text: b.text, selector: b.selector, box: b.box },
          intersection_area: Math.round(intersection.area),
          smaller_area: Math.round(smallerArea),
        },
      }));
    }
  }

  return issues;
}

async function collectCandidates(page) {
  return page.evaluate((selector) => {
    const semanticSelector = '[data-role]:not(section), .card, .panel, .tile, .module, article, main, section[data-role], section';
    const explicitTextSelector = [
      '[data-text-key]',
      '.headline',
      '.body-copy',
      '.card-title',
      '.big-number',
      '.valuation',
      'h1',
      'h2',
      'h3',
      'p',
      'li',
      'span',
    ].join(',');

    function directText(element) {
      return Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isVisible(element, box) {
      let current = element;
      let effectiveOpacity = 1;
      while (current) {
        const style = window.getComputedStyle(current);
        if (!style || style.visibility === 'hidden' || style.display === 'none') return false;
        effectiveOpacity *= Number(style.opacity || 1);
        if (effectiveOpacity < 0.15) return false;
        current = current.parentElement;
      }
      return box.width >= 8 && box.height >= 8;
    }

    function serializeBox(rect) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    function selectorFor(element) {
      if (element.dataset && element.dataset.textKey) return `[data-text-key="${element.dataset.textKey}"]`;
      if (element.classList && element.classList.length) {
        return `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')}`;
      }
      if (element.dataset && element.dataset.role) return `[data-role="${element.dataset.role}"]`;
      return element.tagName.toLowerCase();
    }

    function containerFor(element) {
      const container = element.parentElement ? element.parentElement.closest(semanticSelector) : null;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      return {
        selector: selectorFor(container),
        role: container.getAttribute('data-role') || null,
        box: serializeBox(rect),
        overflow_x: style.overflowX,
        overflow_y: style.overflowY,
      };
    }

    function hasLayoutFlag(element, selector) {
      return Boolean(element.closest(selector));
    }

    const records = Array.from(document.querySelectorAll(selector))
      .map((element) => {
        if (hasLayoutFlag(element, '[data-layout-ignore], [aria-hidden="true"]')) return null;
        const rect = element.getBoundingClientRect();
        const direct = directText(element);
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        const isExplicitText = element.matches(explicitTextSelector);
        if (!text || (!direct && !isExplicitText)) return null;
        if (!isVisible(element, rect)) return null;
        if (!direct) {
          const hasVisibleTextDescendant = Array.from(element.querySelectorAll('*')).some((descendant) => {
            if (!directText(descendant)) return false;
            return isVisible(descendant, descendant.getBoundingClientRect());
          });
          if (!hasVisibleTextDescendant) return null;
        }
        return {
          element,
          candidate: {
            key: element.getAttribute('data-text-key') || null,
            role: element.getAttribute('data-role') || null,
            tag: element.tagName.toLowerCase(),
            selector: selectorFor(element),
            text,
            box: serializeBox(rect),
            container: containerFor(element),
            allowOverflow: hasLayoutFlag(element, '[data-layout-allow-overflow]'),
          },
        };
      })
      .filter(Boolean);

    return records.map((record, index) => ({
      ...record.candidate,
      index,
      ancestorIndexes: records
        .map((other, otherIndex) => (
          otherIndex !== index && other.element.contains(record.element) ? otherIndex : null
        ))
        .filter(otherIndex => otherIndex !== null),
    }));
  }, CANDIDATE_SELECTOR);
}

async function waitForLayout(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function inspectFrameHtmlLayout(options = {}) {
  const {
    frame = {},
    htmlPath,
    resolution = DEFAULT_RESOLUTION,
    sampleTimesSec,
  } = options;
  const frameId = options.frameId
    || frame.id
    || frame.scene_id
    || frame.graph_node_id
    || frame.graphNodeId
    || '';
  const durationSec = options.durationSec ?? frame.duration_sec ?? frame.durationSec;

  const issues = [];
  const metrics = {
    skipped: false,
    samples: [],
    candidate_count: 0,
  };

  const playwright = await loadPlaywright(options);
  if (playwright.error || !playwright.chromium) {
    issues.push(makeIssue({
      code: 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED',
      severity: 'warning',
      frameId,
      sampleTimeSec: null,
      message: '布局 QA 环境未配置，已跳过 html-video 布局检查。',
      details: { error: playwright.error ? playwright.error.message : 'Playwright Chromium unavailable' },
    }));
    metrics.skipped = true;
    return { success: true, issues, metrics };
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    issues.push(makeIssue({
      code: 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED',
      severity: 'warning',
      frameId,
      sampleTimeSec: null,
      message: '布局 QA 浏览器无法启动，已跳过 html-video 布局检查。',
      details: { error: error.message },
    }));
    metrics.skipped = true;
    return { success: true, issues, metrics };
  }

  try {
    const page = await browser.newPage({
      viewport: {
        width: resolution.width || DEFAULT_RESOLUTION.width,
        height: resolution.height || DEFAULT_RESOLUTION.height,
      },
      deviceScaleFactor: 1,
    });

    await installPausedAnimationStyle(page);
    await page.addInitScript(() => {
      window.__layoutQaVisibilityState = {
        initial: document.visibilityState,
        changes: [],
      };
      document.addEventListener('visibilitychange', () => {
        window.__layoutQaVisibilityState.changes.push({
          state: document.visibilityState,
          at: Date.now(),
        });
      });
    });

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await waitForLayout(page);
    await page.evaluate(() => {
      if (typeof window.__hvPlayAll === 'function') {
        window.__hvPlayed = true;
        window.__hvPlayAll();
        return true;
      }
      return false;
    }).catch(() => false);

    const samples = normalizeSampleTimes(
      Array.isArray(sampleTimesSec) && sampleTimesSec.length
        ? sampleTimesSec
        : defaultSampleTimes(durationSec),
      durationSec,
    );

    for (const sampleTimeSec of samples) {
      await seekPageToTime(page, sampleTimeSec);
      const candidates = await collectCandidates(page);
      const normalizedResolution = {
        width: resolution.width || DEFAULT_RESOLUTION.width,
        height: resolution.height || DEFAULT_RESOLUTION.height,
      };
      const visualAnchors = await collectVisualAnchors(page, normalizedResolution);
      const primaryCandidates = candidates.filter(candidate => (
        isOpeningPrimaryText(candidate)
        && isSubstantiallyVisible(candidate, normalizedResolution)
      ));
      metrics.samples.push({
        sample_time_sec: sampleTimeSec,
        candidate_count: candidates.length,
        primary_candidate_count: primaryCandidates.length,
        primary_candidates: primaryCandidates.slice(0, 5).map(candidate => ({
          selector: candidate.selector,
          text: String(candidate.text || '').slice(0, 80),
        })),
        visible_visual_anchor_count: visualAnchors.count,
        max_visible_visual_area_ratio: visualAnchors.max_visible_area_ratio,
      });
      metrics.candidate_count += candidates.length;
      issues.push(...inspectCandidates({
        candidates,
        resolution: normalizedResolution,
        frameId,
        sampleTimeSec,
      }));
      issues.push(...inspectOpeningContent({
        candidates,
        visualAnchors,
        resolution: normalizedResolution,
        frameId,
        sampleTimeSec,
      }));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const dedupedIssues = dedupeIssues(issues);
  return {
    success: !dedupedIssues.some(isBlockingIssue),
    issues: dedupedIssues,
    metrics,
  };
}

module.exports = {
  defaultSampleTimes,
  inspectFrameHtmlLayout,
};
