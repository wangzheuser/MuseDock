const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { once } = require('events');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const { prepareSourceHtml } = require('./prepareSourceHtml');
const { resolveFfmpegPath } = require('./environmentDoctor');
const { H264_PUBLISH_ENCODING, buildH264VideoEncodeArgs } = require('./ffmpegComposer');

const ADAPTER_VERSION = '0.2.0-deterministic';
const DEFAULT_RENDER_RESOLUTION = { width: 1920, height: 1080 };

async function render(input = {}, ctx = {}, deps = {}) {
  const startedAt = Date.now();
  const config = normalizeConfig(input.config || input);
  const sourcePath = input.template?.sourcePath || input.sourcePath || input.htmlPath || input.html_path;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw createRenderError('template-invalid', '未找到 html-video 模板入口 HTML。');
  }

  await fsp.mkdir(path.dirname(config.outputPath), { recursive: true });
  let browser;
  let context;
  let cleanupPrepared;
  let totalDuration = config.duration;

  try {
    report(ctx, 5, '正在准备 html-video 渲染...');

    // 对应 html-video 源码段：launch chromium headless。
    report(ctx, 15, '正在启动 Playwright Chromium...');
    const playwright = await loadPlaywright(deps.importPlaywright);
    browser = await playwright.chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    context = await browser.newContext({
      viewport: { width: config.width, height: config.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // 渲染与布局 QA 共用同一套动画暂停逻辑，保证采样时间一致。
    await installPausedAnimationStyle(page);

    report(ctx, 30, '正在加载 html-video 模板...');
    const prepared = await prepareSourceHtml(sourcePath);
    cleanupPrepared = prepared.cleanup;

    // 对应 html-video 源码段：page.goto(file://..., domcontentloaded)。
    // 显式 45s 超时，避免模板异常时卡在默认导航等待里拖垮整条渲染任务。
    try {
      await page.goto(pathToFileURL(prepared.loadPath).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      throw createRenderError('render-goto-timeout', `加载 html-video 模板超时或失败：${error.message}`);
    }

    // 对应 html-video 源码段：等待 stylesheet、逐个 fonts.load、fonts.ready。
    report(ctx, 32, '正在加载字体和样式...');
    await waitForStylesAndFonts(page);

    await page.waitForTimeout(100);

    // 对应 html-video 源码段：探测 CSS animation 与 GSAP finite timeline。
    if (config.durationMode !== 'explicit') {
      const animationMs = await probeAnimationDurationMs(page);
      const needed = Math.min(30, (animationMs + 400) / 1000);
      if (needed > totalDuration) totalDuration = needed;
    } else {
      await probeAnimationDurationMs(page).catch(() => 0);
    }

    // 对应 html-video 源码段：调用 window.__hvPlayAll()。
    await page.evaluate(() => {
      if (typeof window.__hvPlayAll === 'function') {
        window.__hvPlayed = true;
        window.__hvPlayAll();
        return true;
      }
      return false;
    }).catch(() => false);

    // 让模板完成一次初始化后冻结运行时，由后续逐帧寻址统一驱动动画。
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })).catch(() => {});
    await freezeRuntimeClock(page);

    const ffmpegPath = deps.ffmpegPath || await resolveFfmpegPath(deps);
    const probeDeps = { ...deps, ffmpegPath };
    const frameCount = Math.max(1, Math.round(totalDuration * config.fps));
    const ffmpegArgs = buildFrameEncoderArgs({
      outputPath: config.outputPath,
      fps: config.fps,
      width: config.width,
      height: config.height,
    });
    report(ctx, 40, `正在逐帧渲染 ${frameCount} 帧...`);
    let lastReportedPercent = 40;
    const ffmpegResult = await runFrameEncoderCommand(ffmpegPath, ffmpegArgs, {
      frameCount,
      captureFrame: async frameIndex => {
        await seekPageToTime(page, frameIndex / config.fps);
        return page.screenshot({
          type: 'png',
          animations: 'allow',
          caret: 'hide',
          clip: { x: 0, y: 0, width: config.width, height: config.height },
        });
      },
      onFrame: completed => {
        const percent = 40 + Math.floor((completed / frameCount) * 50);
        if (percent <= lastReportedPercent && completed < frameCount) return;
        lastReportedPercent = percent;
        report(ctx, percent, `正在逐帧渲染 ${completed}/${frameCount}...`);
      },
    }, deps.runFrameEncoder);
    if (!ffmpegResult.ok) {
      throw createRenderError(
        'render-failed',
        `ffmpeg 编码 html-video 失败：${ffmpegResult.stderr || ffmpegResult.error || `exit ${ffmpegResult.code}`}`,
      );
    }

    const stat = await fsp.stat(config.outputPath).catch(() => ({ size: 0 }));
    const hasValidVideoStream = stat.size > 2048
      && await outputHasVideoStream(config.outputPath, probeDeps);
    if (!hasValidVideoStream) {
      throw createRenderError('render-failed', 'html-video 编码完成但输出视频无有效画面流。');
    }
    report(ctx, 100, 'html-video 帧渲染完成。');
    return {
      outputPath: config.outputPath,
      output_path: config.outputPath,
      meta: {
        durationSec: totalDuration,
        fileSizeBytes: stat.size,
        actualResolution: { width: config.width, height: config.height },
        fps: config.fps,
        renderedFrames: frameCount,
        renderWallClockSec: (Date.now() - startedAt) / 1000,
        engineVersion: `hyperframes-playwright@${ADAPTER_VERSION}`,
        encoding: H264_PUBLISH_ENCODING,
        captureMode: 'deterministic-frames',
      },
      diagnostics: [{
        code: 'frame_rendered',
        stage: 'render',
        message: '已通过 Playwright/Chromium 确定性逐帧渲染并使用发布级 H.264 参数编码。',
        fallback_allowed: false,
      }],
    };
  } catch (error) {
    if (error && error.code === 'environment_not_configured') throw error;
    if (/playwright/i.test(error && error.message ? error.message : '')) {
      throw createRenderError('environment_not_configured', 'Playwright Chromium 未配置，无法渲染 html-video 模板。', error);
    }
    throw error;
  } finally {
    if (context) await closeWithTimeout(() => context.close());
    if (browser) await closeWithTimeout(() => browser.close());
    if (cleanupPrepared) await cleanupPrepared().catch(() => {});
  }
}

/**
 * 限制浏览器资源关闭时间，避免 Chromium 已产出文件后清理阶段无限悬挂。
 * @param {Function} close 资源关闭函数。
 * @param {number} timeoutMs 最长等待时间。
 * @returns {Promise<void>}
 */
async function closeWithTimeout(close, timeoutMs = 3000) {
  let timeout;
  await Promise.race([
    Promise.resolve().then(close).catch(() => {}),
    new Promise(resolve => { timeout = setTimeout(resolve, timeoutMs); }),
  ]);
  clearTimeout(timeout);
}

function normalizeConfig(config) {
  const resolution = config.resolution || {};
  const width = Number(resolution.width || config.width || DEFAULT_RENDER_RESOLUTION.width);
  const height = Number(resolution.height || config.height || DEFAULT_RENDER_RESOLUTION.height);
  const duration = config.duration === 'auto'
    ? 5
    : Math.max(0.5, Number(config.duration || config.duration_sec || 5));
  return {
    outputPath: config.outputPath || config.output_path || path.resolve('output.mp4'),
    width,
    height,
    fps: Number(config.fps || 30),
    duration,
    durationMode: config.durationMode || config.duration_mode || (config.duration === 'auto' ? 'auto' : 'explicit'),
  };
}

async function loadPlaywright(importPlaywright) {
  try {
    return importPlaywright ? await importPlaywright() : await import('playwright-core');
  } catch (error) {
    throw createRenderError(
      'environment_not_configured',
      'Playwright Chromium 未配置，无法渲染 html-video 模板。',
      error,
    );
  }
}

async function waitForStylesAndFonts(page) {
  return page.evaluate(() => new Promise(resolve => {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.ready?.then !== 'function') {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    };
    const cap = setTimeout(finish, 8000);
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const linkDone = links.map(link => {
      try {
        if (link.sheet && link.sheet.cssRules) return Promise.resolve();
      } catch (_) {}
      return new Promise(done => {
        const finishLink = () => done();
        link.addEventListener('load', finishLink, { once: true });
        link.addEventListener('error', finishLink, { once: true });
        setTimeout(finishLink, 6000);
      });
    });
    Promise.all(linkDone)
      .then(() => {
        const loads = [];
        fonts.forEach(face => {
          try {
            loads.push(face.load().catch(() => undefined));
          } catch (_) {}
        });
        return Promise.all(loads);
      })
      .then(() => fonts.ready)
      .then(() => {
        clearTimeout(cap);
        finish();
      })
      .catch(() => {
        clearTimeout(cap);
        finish();
      });
  })).catch(() => {});
}

/**
 * 在页面脚本执行前暂停 CSS 与 SMIL 动画，后续由时间寻址统一推进。
 * @param {import('playwright-core').Page} page Playwright 页面。
 * @returns {Promise<void>}
 */
async function installPausedAnimationStyle(page) {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.id = '__hv_freeze';
    style.textContent = [
      '*, *::before, *::after {',
      'animation-play-state: paused !important;',
      '-webkit-animation-play-state: paused !important;',
      '}',
      'svg * {',
      'animation-play-state: paused !important;',
      '}',
    ].join('');
    const pauseSmil = () => {
      document.querySelectorAll('svg').forEach(svg => {
        if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations();
      });
    };
    const attach = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById(style.id)) root.appendChild(style);
      pauseSmil();
    };
    const observer = new MutationObserver(() => attach());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.head || document.documentElement) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
  });
}

async function probeAnimationDurationMs(page) {
  return page.evaluate(() => {
    let cssMaxMs = 0;
    Array.from(document.querySelectorAll('*')).forEach(el => {
      const style = getComputedStyle(el);
      const durations = (style.animationDuration || '').split(',');
      const delays = (style.animationDelay || '').split(',');
      const iterations = (style.animationIterationCount || '').split(',');
      durations.forEach((durationText, index) => {
        if ((iterations[index] || '').trim() === 'infinite') return;
        const durationMs = cssTimeToMs(durationText);
        const delayMs = cssTimeToMs(delays[index] || '0s');
        cssMaxMs = Math.max(cssMaxMs, durationMs + delayMs);
      });
    });

    const gsap = window.gsap;
    let gsapMaxMs = 0;
    const children = gsap?.globalTimeline?.getChildren?.(true, true, true) || [];
    children.forEach(child => {
      const repeat = typeof child.repeat === 'function' ? child.repeat() : (child.vars?.repeat || 0);
      if (repeat === -1) return;
      const totalDuration = typeof child.totalDuration === 'function' ? child.totalDuration() : 0;
      if (Number.isFinite(totalDuration)) gsapMaxMs = Math.max(gsapMaxMs, totalDuration * 1000);
    });
    return Math.max(cssMaxMs, gsapMaxMs);

    function cssTimeToMs(value) {
      const text = String(value || '').trim();
      if (!text) return 0;
      if (text.endsWith('ms')) return Number.parseFloat(text) || 0;
      if (text.endsWith('s')) return (Number.parseFloat(text) || 0) * 1000;
      return (Number.parseFloat(text) || 0) * 1000;
    }
  }).catch(() => 0);
}

/**
 * 冻结模板内依赖真实时间的 RAF 循环，避免逐帧截图期间状态自行推进。
 * @param {import('playwright-core').Page} page Playwright 页面。
 * @returns {Promise<void>}
 */
async function freezeRuntimeClock(page) {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    document.getAnimations({ subtree: true }).forEach(animation => {
      try {
        animation.pause();
      } catch (_) {}
    });
  }).catch(() => {});
  await page.waitForTimeout(25).catch(() => {});
}

/**
 * 将页面推进到指定时间，并同步 CSS、GSAP、SMIL、媒体和字幕状态。
 * @param {import('playwright-core').Page} page Playwright 页面。
 * @param {number} timeSec 目标时间，单位秒。
 * @returns {Promise<void>}
 */
async function seekPageToTime(page, timeSec) {
  await page.evaluate(async targetTimeSec => {
    const timeMs = Math.max(0, Number(targetTimeSec) || 0) * 1000;
    const seconds = timeMs / 1000;

    document.getAnimations({ subtree: true }).forEach(animation => {
      try {
        animation.pause();
        animation.currentTime = timeMs;
      } catch (_) {}
    });

    Object.values(window.__timelines || {}).forEach(timeline => {
      try {
        if (typeof timeline.pause === 'function') timeline.pause();
        if (typeof timeline.totalTime === 'function') timeline.totalTime(seconds, false);
        else if (typeof timeline.seek === 'function') timeline.seek(seconds, false);
        else if (typeof timeline.time === 'function') timeline.time(seconds, false);
      } catch (_) {}
    });

    const globalTimeline = window.gsap?.globalTimeline;
    if (globalTimeline) {
      try {
        if (typeof globalTimeline.pause === 'function') globalTimeline.pause();
        if (typeof globalTimeline.totalTime === 'function') globalTimeline.totalTime(seconds, false);
        else if (typeof globalTimeline.seek === 'function') globalTimeline.seek(seconds, false);
        else if (typeof globalTimeline.time === 'function') globalTimeline.time(seconds, false);
      } catch (_) {}
    }

    document.querySelectorAll('svg').forEach(svg => {
      try {
        if (typeof svg.setCurrentTime === 'function') svg.setCurrentTime(seconds);
      } catch (_) {}
    });

    window.dispatchEvent(new CustomEvent('hf-seek', {
      detail: { time: seconds, timeSec: seconds, seconds },
    }));

    const mediaSeeks = Array.from(document.querySelectorAll('video,audio')).map(media => new Promise(resolve => {
      try {
        media.pause();
        const duration = Number(media.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          resolve();
          return;
        }
        const start = Number(media.dataset.start || 0) || 0;
        const localTime = Math.max(0, seconds - start);
        const target = media.loop ? localTime % duration : Math.min(localTime, Math.max(0, duration - 0.001));
        if (Math.abs(Number(media.currentTime || 0) - target) < 0.002) {
          resolve();
          return;
        }
        const finish = () => {
          clearTimeout(timeout);
          media.removeEventListener('seeked', finish);
          resolve();
        };
        const timeout = setTimeout(finish, 1000);
        media.addEventListener('seeked', finish, { once: true });
        media.currentTime = target;
      } catch (_) {
        resolve();
      }
    }));
    await Promise.all(mediaSeeks);

    document.querySelectorAll('.hv-caption-item').forEach(item => {
      const start = Number(item.dataset.start || 0);
      const end = Number(item.dataset.end || 0);
      if (Number.isFinite(start) && Number.isFinite(end) && seconds >= start && seconds < end) {
        item.dataset.hvActive = 'true';
      } else {
        delete item.dataset.hvActive;
      }
    });
  }, timeSec);
}

/**
 * 生成 PNG 图像流转发布级 MP4 的 ffmpeg 参数。
 * @param {object} options 编码参数。
 * @returns {Array<string>} ffmpeg 参数。
 */
function buildFrameEncoderArgs({ outputPath, fps, width, height }) {
  return [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-vcodec', 'png',
    '-i', 'pipe:0',
    '-an',
    ...buildH264VideoEncodeArgs({ fps, width, height }),
    outputPath,
  ];
}

async function outputHasVideoStream(videoPath, deps = {}) {
  if (typeof deps.probeVideoStreams === 'function') {
    const streams = await deps.probeVideoStreams(videoPath);
    return hasVideoStream(streams);
  }
  const ffprobe = getFfprobeCommand(deps);
  const args = [
    '-v', 'error',
    '-select_streams', 'v',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    videoPath,
  ];
  const result = await runFfprobeCommand(ffprobe, args, deps.runFfprobe);
  if (!result.ok) return false;
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return hasVideoStream(parsed.streams);
  } catch (_) {
    return false;
  }
}

function hasVideoStream(streams) {
  return Array.isArray(streams) && streams.some(stream => stream && stream.codec_type === 'video');
}

function getFfprobeCommand(deps = {}) {
  if (deps.ffprobePath) return deps.ffprobePath;
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpegPath = deps.ffmpegPath || '';
  if (ffmpegPath && ffmpegPath.includes(path.sep)) {
    const adjacent = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(adjacent)) return adjacent;
  }
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path) {
      const adjacent = path.join(path.dirname(installer.path), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      if (fs.existsSync(adjacent)) return adjacent;
    }
  } catch (_) {}
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function runFfprobeCommand(command, args, injectedRunner) {
  if (injectedRunner) return injectedRunner(command, args);
  return runFfmpegCommand(command, args);
}

function runFfmpegCommand(command, args, injectedRunner) {
  if (injectedRunner) return injectedRunner(command, args);
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, code: null, error: error.message, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      resolve({ ok: false, code: null, error: error.message, stdout, stderr });
    });
    child.on('close', code => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

/**
 * 逐帧抓取 PNG 并写入 ffmpeg stdin。
 * @param {string} command ffmpeg 命令。
 * @param {Array<string>} args ffmpeg 参数。
 * @param {object} options 抓帧选项。
 * @param {Function} injectedRunner 测试注入编码器。
 * @returns {Promise<object>} 编码结果。
 */
function runFrameEncoderCommand(command, args, options = {}, injectedRunner) {
  if (injectedRunner) return injectedRunner(command, args, options);
  return new Promise(resolve => {
    let child;
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, ...result });
    };
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      finish({ ok: false, code: null, error: error.message });
      return;
    }
    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => finish({ ok: false, code: null, error: error.message }));
    child.on('close', code => finish({ ok: code === 0, code }));

    (async () => {
      const frameCount = Math.max(1, Number(options.frameCount) || 1);
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        if (settled) return;
        const frame = await options.captureFrame(frameIndex);
        const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
        if (!child.stdin.write(buffer)) await once(child.stdin, 'drain');
        options.onFrame?.(frameIndex + 1);
      }
      child.stdin.end();
    })().catch(error => {
      child.stdin?.destroy();
      child.kill();
      finish({ ok: false, code: null, error: error.message });
    });
  });
}

function createRenderError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function report(ctx, percent, message) {
  if (typeof ctx.onProgress === 'function') ctx.onProgress(percent, message);
}

module.exports = {
  render,
  buildFrameEncoderArgs,
  installPausedAnimationStyle,
  seekPageToTime,
};
