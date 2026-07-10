const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_COMMAND_TIMEOUT_MS = Number(process.env.MUSEDOCK_COMMAND_TIMEOUT_MS) || 10 * 60 * 1000;
const DEFAULT_COMMAND_OUTPUT_LIMIT = 1024 * 1024;
const OUTPUT_CLEAN_ARGS = ['-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn'];
const H264_PUBLISH_ENCODING = 'h264-yuv420p-crf17-bt709';

/**
 * 生成发布母版统一使用的 H.264 编码参数。
 * @param {object} options 编码参数。
 * @returns {Array<string>} ffmpeg 参数。
 */
function buildH264VideoEncodeArgs({ fps = 30, width = 1920, height = 1080 } = {}) {
  const outputFps = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : 30;
  const pixels = Math.max(1, Number(width) || 1920) * Math.max(1, Number(height) || 1080);
  const highResolution = pixels > 1920 * 1080;
  const highFrameRate = outputFps > 30;
  const maxRate = highResolution ? '35M' : highFrameRate ? '20M' : '12M';
  const bufferSize = highResolution ? '70M' : highFrameRate ? '40M' : '24M';
  const level = highResolution ? (highFrameRate ? '5.2' : '5.1') : highFrameRate ? '4.2' : '4.1';
  const gop = Math.max(1, Math.round(outputFps * 2));
  return [
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-tune', 'animation',
    '-crf', '17',
    '-maxrate', maxRate,
    '-bufsize', bufferSize,
    '-profile:v', 'high',
    '-level:v', level,
    '-pix_fmt', 'yuv420p',
    '-r', String(outputFps),
    '-vsync', 'cfr',
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off',
    ...OUTPUT_CLEAN_ARGS,
    '-movflags', '+faststart',
  ];
}

async function findFfmpegOnPath(runCommandImpl) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runCommandImpl(finder, ['ffmpeg']);
  if (!result.ok) return '';
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || '';
}

async function getFfmpegCommand(options = {}) {
  if (options.ffmpegPath) return options.ffmpegPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const runCommandImpl = options.runCommand || runCommand;
  const pathFfmpeg = await findFfmpegOnPath(runCommandImpl);
  if (pathFfmpeg) return pathFfmpeg;
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }
}

async function getFfprobeCommand(options = {}) {
  if (options.ffprobePath) return options.ffprobePath;
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpegPath = options.ffmpegPath || await getFfmpegCommand(options);
  if (ffmpegPath && (ffmpegPath.includes(path.sep) || path.isAbsolute(ffmpegPath))) {
    const adjacent = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fsSync.existsSync(adjacent)) return adjacent;
  }
  try {
    const installerPath = require('@ffmpeg-installer/ffmpeg').path;
    const adjacent = path.join(path.dirname(installerPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fsSync.existsSync(adjacent)) return adjacent;
  } catch {
    // Fall through to PATH lookup.
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function appendLimitedOutput(current, chunk, limit = DEFAULT_COMMAND_OUTPUT_LIMIT) {
  const next = current + chunk.toString('utf8');
  return next.length > limit ? next.slice(-limit) : next;
}

/**
 * 执行外部命令，避免 ffmpeg/ffprobe 卡死后拖住整条任务链路。
 * @param {string} command 命令路径。
 * @param {Array<string>} args 命令参数。
 * @param {object} options spawn 选项与超时配置。
 * @returns {Promise<object>} 执行结果。
 */
function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const {
      timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
      maxOutputBytes = DEFAULT_COMMAND_OUTPUT_LIMIT,
      ...spawnOptions
    } = options || {};
    let child;
    let settled = false;
    let timedOut = false;
    let timeoutTimer = null;
    let killTimer = null;
    let stdout = '';
    let stderr = '';

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    }

    try {
      child = spawn(command, args, { windowsHide: true, ...spawnOptions });
    } catch (error) {
      finish({ ok: false, code: null, error: error.message, stdout: '', stderr: '' });
      return;
    }

    if (Number(timeoutMs) > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      }, Number(timeoutMs));
    }

    child.stdout?.on('data', chunk => { stdout = appendLimitedOutput(stdout, chunk, maxOutputBytes); });
    child.stderr?.on('data', chunk => { stderr = appendLimitedOutput(stderr, chunk, maxOutputBytes); });
    child.on('error', error => finish({ ok: false, code: null, error: error.message, stdout, stderr }));
    child.on('close', code => finish({
      ok: !timedOut && code === 0,
      code,
      stdout,
      stderr,
      timed_out: timedOut,
      error: timedOut ? `命令执行超时：${command}` : undefined,
    }));
  });
}

async function verifyDurationWithFfprobe({
  videoPath,
  expectedDurationSec,
  toleranceSec = 1,
  runCommand: runCommandImpl = runCommand,
  ffprobePath,
} = {}) {
  const expected = Number(expectedDurationSec);
  if (!videoPath || !Number.isFinite(expected) || expected <= 0) {
    return { success: true, skipped: true, message: '未提供期望时长，跳过 ffprobe 时长校验。' };
  }

  const ffprobe = await getFfprobeCommand({ ffprobePath, runCommand: runCommandImpl });
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ];
  const result = await runCommandImpl(ffprobe, args);
  if (!result.ok) {
    return {
      success: true,
      skipped: true,
      code: 'ffprobe_unavailable',
      message: `ffprobe 不可用，已跳过导出时长校验：${result.stderr || result.error || `ffprobe exited ${result.code}`}`,
      args,
    };
  }

  const actual = Number.parseFloat(String(result.stdout || '').trim());
  if (!Number.isFinite(actual)) {
    return {
      success: false,
      code: 'duration_probe_invalid',
      message: 'ffprobe 未返回有效的视频时长。',
      args,
      stdout: result.stdout || '',
    };
  }

  const diff = Math.abs(actual - expected);
  if (diff > Number(toleranceSec || 1)) {
    return {
      success: false,
      code: 'duration_mismatch',
      message: `导出视频时长偏差过大：期望 ${expected.toFixed(2)} 秒，实际 ${actual.toFixed(2)} 秒。`,
      expected_duration_sec: expected,
      duration_sec: actual,
      diff_sec: diff,
      tolerance_sec: Number(toleranceSec || 1),
      args,
    };
  }

  return {
    success: true,
    duration_sec: actual,
    expected_duration_sec: expected,
    diff_sec: diff,
    tolerance_sec: Number(toleranceSec || 1),
    args,
  };
}

async function verifyAudioStreamWithFfprobe({
  videoPath,
  runCommand: runCommandImpl = runCommand,
  ffprobePath,
} = {}) {
  if (!videoPath) {
    return {
      success: false,
      code: 'audio_stream_missing',
      message: '未提供导出文件路径，无法校验音频轨。',
    };
  }

  const ffprobe = await getFfprobeCommand({ ffprobePath, runCommand: runCommandImpl });
  const args = [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    videoPath,
  ];
  const result = await runCommandImpl(ffprobe, args);
  if (!result.ok) {
    return {
      success: true,
      skipped: true,
      code: 'ffprobe_unavailable',
      message: `ffprobe 不可用，已跳过导出音频轨校验：${result.stderr || result.error || `ffprobe exited ${result.code}`}`,
      args,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    return {
      success: false,
      code: 'audio_probe_invalid',
      message: `ffprobe 未返回有效的音频轨信息：${error.message || 'JSON 解析失败'}`,
      args,
      stdout: result.stdout || '',
    };
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  if (!streams.some(stream => stream?.codec_type === 'audio')) {
    return {
      success: false,
      code: 'audio_stream_missing',
      message: '导出文件没有音频轨。',
      args,
      stdout: result.stdout || '',
    };
  }

  return {
    success: true,
    audio_stream_count: streams.length,
    args,
  };
}

/**
 * 解析 ffprobe 返回的分数帧率。
 * @param {string|number} value 帧率文本。
 * @returns {number} 每秒帧数。
 */
function parseFrameRate(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const [numerator, denominator = '1'] = text.split('/');
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/**
 * 返回用于发布质量提示的最低视频码率。
 * @param {number} width 视频宽度。
 * @param {number} height 视频高度。
 * @param {number} fps 视频帧率。
 * @returns {number} 建议最低码率，单位 bps。
 */
function recommendedMinVideoBitrate(width, height, fps) {
  const pixels = Math.max(1, Number(width) || 0) * Math.max(1, Number(height) || 0);
  if (pixels > 1920 * 1080) return Number(fps) > 30 ? 16000000 : 12000000;
  if (pixels >= 1080 * 1920) return Number(fps) > 30 ? 8000000 : 4000000;
  return Number(fps) > 30 ? 4000000 : 2500000;
}

/**
 * 从 ffmpeg 进度输出中读取最终处理帧数。
 * @param {string} output ffmpeg 标准错误输出。
 * @returns {number} 最终帧数。
 */
function parseFinalFrameCount(output) {
  const matches = Array.from(String(output || '').matchAll(/frame=\s*(\d+)/g));
  return Number(matches.at(-1)?.[1] || 0);
}

/**
 * 使用 mpdecimate 估算高帧率视频中的近似重复帧比例。
 * @param {object} options 检测参数。
 * @returns {Promise<object|null>} 重复帧指标，检测失败时返回 null。
 */
async function probeDuplicateFrameMetrics({
  videoPath,
  totalFrames,
  durationSec,
  fps,
  runCommand: runCommandImpl = runCommand,
  ffmpegPath,
} = {}) {
  const total = Number(totalFrames) > 0
    ? Number(totalFrames)
    : Math.round(Number(durationSec || 0) * Number(fps || 0));
  if (!videoPath || total <= 0 || Number(fps) <= 30) return null;
  const ffmpeg = await getFfmpegCommand({ ffmpegPath, runCommand: runCommandImpl });
  const args = [
    '-hide_banner',
    '-v', 'info',
    '-i', videoPath,
    '-map', '0:v:0',
    '-vf', 'mpdecimate',
    '-an',
    '-vsync', 'vfr',
    '-f', 'null',
    '-',
  ];
  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) return null;
  const retained = parseFinalFrameCount(result.stderr || result.stdout);
  if (retained <= 0) return null;
  const uniqueFrames = Math.min(total, retained);
  const duplicateRatio = Math.max(0, (total - uniqueFrames) / total);
  return {
    total_frames: total,
    unique_frames_estimate: uniqueFrames,
    duplicate_frame_ratio: Math.round(duplicateRatio * 10000) / 10000,
    motion_effective_fps_estimate: Math.round(Number(fps) * (uniqueFrames / total) * 100) / 100,
  };
}

/**
 * 读取最终 MP4 技术参数，阻止明显不符合发布规格的文件进入导出记录。
 * @param {object} options 质检参数。
 * @returns {Promise<object>} 技术质检报告。
 */
async function probeMediaQualityWithFfprobe({
  videoPath,
  expectedWidth,
  expectedHeight,
  expectedFps,
  requireAudio = false,
  encodingMode = '',
  runCommand: runCommandImpl = runCommand,
  ffprobePath,
  ffmpegPath,
} = {}) {
  if (!videoPath) return { success: false, code: 'quality_probe_missing_path', message: '缺少导出文件路径，无法执行技术质检。', issues: [] };
  const ffprobe = await getFfprobeCommand({ ffprobePath, ffmpegPath, runCommand: runCommandImpl });
  const args = [
    '-v', 'error',
    '-show_entries',
    'format=duration,size,bit_rate:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,bit_rate,nb_frames,color_range,color_space,color_transfer,color_primaries,sample_rate,channels',
    '-of', 'json',
    videoPath,
  ];
  const result = await runCommandImpl(ffprobe, args);
  if (!result.ok) {
    return {
      success: true,
      skipped: true,
      code: 'ffprobe_unavailable',
      message: `ffprobe 不可用，已跳过最终视频技术质检：${result.stderr || result.error || `ffprobe exited ${result.code}`}`,
      issues: [],
      args,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    return { success: false, code: 'quality_probe_invalid', message: `ffprobe 技术质检结果无效：${error.message}`, issues: [], args };
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find(stream => stream?.codec_type === 'video') || null;
  const audio = streams.find(stream => stream?.codec_type === 'audio') || null;
  const extraStreams = streams.filter(stream => !['video', 'audio'].includes(stream?.codec_type));
  const issues = [];
  const addIssue = (code, severity, message) => issues.push({ code, severity, message });
  if (!video) {
    addIssue('video_stream_missing', 'error', '导出文件没有有效视频轨。');
  }

  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  const fps = parseFrameRate(video?.avg_frame_rate) || parseFrameRate(video?.r_frame_rate);
  const formatBitrate = Number(parsed.format?.bit_rate || 0);
  const videoBitrate = Number(video?.bit_rate || 0) || Math.max(0, formatBitrate - Number(audio?.bit_rate || 0));
  const durationSec = Number(parsed.format?.duration || 0);
  const duplicateFrameMetrics = await probeDuplicateFrameMetrics({
    videoPath,
    totalFrames: Number(video?.nb_frames || 0),
    durationSec,
    fps,
    runCommand: runCommandImpl,
    ffmpegPath,
  });
  if (video && Number(expectedWidth) > 0 && Number(expectedHeight) > 0
    && (width !== Number(expectedWidth) || height !== Number(expectedHeight))) {
    addIssue('resolution_mismatch', 'error', `实际分辨率 ${width}×${height} 与请求的 ${expectedWidth}×${expectedHeight} 不一致。`);
  }
  if (video && Number(expectedFps) > 0 && Math.abs(fps - Number(expectedFps)) > 0.1) {
    addIssue('fps_mismatch', 'error', `实际帧率 ${fps.toFixed(2)}fps 与请求的 ${Number(expectedFps).toFixed(2)}fps 不一致。`);
  }
  if (video && video.codec_name !== 'h264') addIssue('video_codec_unexpected', 'error', `视频编码为 ${video.codec_name || '未知'}，发布母版要求 H.264。`);
  if (video && String(video.profile || '').toLowerCase() !== 'high') addIssue('video_profile_unexpected', 'error', `视频编码档次为 ${video.profile || '未知'}，发布母版要求 H.264 High。`);
  if (video && video.pix_fmt !== 'yuv420p') addIssue('pixel_format_unexpected', 'error', `像素格式为 ${video.pix_fmt || '未知'}，平台兼容格式应为 yuv420p。`);
  if (video && ['color_space', 'color_primaries', 'color_transfer'].some(key => video?.[key] !== 'bt709')) {
    addIssue('color_space_not_bt709', 'warning', 'HD 视频色彩元数据不是完整 BT.709，平台转码后可能出现色差。');
  }
  if (video && video.color_range !== 'tv') addIssue('color_range_unexpected', 'warning', '视频色彩范围不是 TV limited range，平台转码后可能出现明暗偏差。');
  const minVideoBitrate = recommendedMinVideoBitrate(width, height, fps);
  if (videoBitrate > 0 && videoBitrate < minVideoBitrate && encodingMode !== H264_PUBLISH_ENCODING) {
    addIssue('video_bitrate_low', 'warning', `视频码率约 ${(videoBitrate / 1000000).toFixed(2)} Mbps，低于当前规格建议的 ${(minVideoBitrate / 1000000).toFixed(0)} Mbps。`);
  }
  if (requireAudio && !audio) addIssue('audio_stream_missing', 'error', '当前任务需要旁白或音效，但导出文件没有音频轨。');
  if (audio && audio.codec_name !== 'aac') addIssue('audio_codec_unexpected', 'warning', `音频编码为 ${audio.codec_name || '未知'}，建议使用 AAC。`);
  if (audio && Number(audio.sample_rate || 0) !== 48000) addIssue('audio_sample_rate_unexpected', 'warning', `音频采样率为 ${audio.sample_rate || 0}Hz，发布母版建议使用 48kHz。`);
  if (audio && Number(audio.channels || 0) !== 2) addIssue('audio_channels_unexpected', 'warning', `音频声道数为 ${audio.channels || 0}，发布母版建议使用立体声。`);
  if (audio && Number(audio.bit_rate || 0) > 0 && Number(audio.bit_rate) < 160000) addIssue('audio_bitrate_low', 'warning', `音频码率约 ${Math.round(Number(audio.bit_rate) / 1000)} kbps，建议至少使用 160 kbps。`);
  if (extraStreams.length) addIssue('extra_streams_present', 'warning', `导出文件包含 ${extraStreams.length} 条额外数据流，建议发布前清除。`);
  if (fps > 30 && duplicateFrameMetrics?.duplicate_frame_ratio >= 0.15) {
    addIssue(
      'high_fps_capture_risk',
      'warning',
      `高帧率视频约 ${(duplicateFrameMetrics.duplicate_frame_ratio * 100).toFixed(0)}% 为近似重复或静止帧，有效动态帧率估算约 ${duplicateFrameMetrics.motion_effective_fps_estimate.toFixed(2)}fps。`,
    );
  } else if (fps > 30 && !duplicateFrameMetrics) {
    addIssue('high_fps_capture_risk', 'warning', '当前 Chromium 录制模式的高帧率视频未完成重复帧检测，应检查真实运动流畅度。');
  }

  const blockingIssues = issues.filter(issue => issue.severity === 'error');
  return {
    success: blockingIssues.length === 0,
    pass: issues.length === 0,
    publish_ready: blockingIssues.length === 0,
    code: blockingIssues[0]?.code || '',
    message: blockingIssues[0]?.message || (issues.length ? '技术质检通过，但存在发布质量建议。' : '最终视频技术质检通过。'),
    metrics: {
      width,
      height,
      fps: Math.round(fps * 100) / 100,
      video_codec: video?.codec_name || '',
      video_profile: video?.profile || '',
      pixel_format: video?.pix_fmt || '',
      video_bitrate: videoBitrate,
      encoding_mode: encodingMode,
      color_space: video?.color_space || '',
      color_primaries: video?.color_primaries || '',
      color_transfer: video?.color_transfer || '',
      audio_codec: audio?.codec_name || '',
      audio_sample_rate: Number(audio?.sample_rate || 0),
      audio_channels: Number(audio?.channels || 0),
      audio_bitrate: Number(audio?.bit_rate || 0),
      duration_sec: durationSec,
      size_bytes: Number(parsed.format?.size || 0),
      extra_stream_count: extraStreams.length,
      ...(duplicateFrameMetrics || {}),
    },
    issues,
    args,
  };
}

function sameEncoding(frameMp4s) {
  if (!frameMp4s.length) return true;
  const first = frameMp4s[0];
  return frameMp4s.every(item => (
    item.engine === first.engine
    && item.encoding === H264_PUBLISH_ENCODING
    && item.encoding === first.encoding
  ));
}

function escapeConcatPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/'/g, "'\\''");
}

async function writeConcatList(frameMp4s, workDir) {
  const framesDir = path.join(workDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });
  const listPath = path.join(framesDir, 'concat.txt');
  const content = frameMp4s
    .map(item => `file '${escapeConcatPath(item.path || item)}'`)
    .join('\n');
  await fs.writeFile(listPath, `${content}\n`, 'utf8');
  return listPath;
}

async function writeAudioConcatList(audioFiles, workDir) {
  const audioDir = path.join(workDir, 'audio');
  await fs.mkdir(audioDir, { recursive: true });
  const listPath = path.join(audioDir, 'concat.txt');
  const content = audioFiles
    .map(item => `file '${escapeConcatPath(item.path || item)}'`)
    .join('\n');
  await fs.writeFile(listPath, `${content}\n`, 'utf8');
  return listPath;
}

async function concatAudioWithFfmpeg(audioFiles, outputPath, workDir, opts = {}) {
  const files = Array.isArray(audioFiles) ? audioFiles : [];
  if (!files.length) {
    return { success: false, message: '没有可拼接的旁白音频。' };
  }
  if (files.length === 1) {
    return { success: true, skipped: true, output_path: files[0].path || files[0], message: '只有一段旁白音频，跳过拼接。' };
  }
  const runCommandImpl = opts.runCommand || runCommand;
  const ffmpeg = await getFfmpegCommand(opts);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const listPath = await writeAudioConcatList(files, workDir);
  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    outputPath,
  ];
  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      message: `旁白音频拼接失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
    };
  }
  return { success: true, output_path: outputPath, args };
}

async function concatFramesWithFfmpeg(frameMp4s, outputPath, workDir, opts = {}) {
  const frames = Array.isArray(frameMp4s) ? frameMp4s : [];
  if (!frames.length) {
    return { success: false, message: '没有可拼接的视频帧。' };
  }
  const runCommandImpl = opts.runCommand || runCommand;
  const ffmpeg = await getFfmpegCommand(opts);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let args;
  let strategy;
  if (sameEncoding(frames)) {
    strategy = 'concat-demuxer';
    const listPath = await writeConcatList(frames, workDir);
    args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-map', '0:v:0',
      '-c:v', 'copy',
      '-an',
      ...OUTPUT_CLEAN_ARGS,
      '-movflags', '+faststart',
      outputPath,
    ];
  } else {
    strategy = 'concat-filter';
    const fps = Number(opts.fps || 30);
    const inputArgs = frames.flatMap(item => ['-i', item.path || item]);
    const labels = frames.map((_, index) => `[${index}:v]`).join('');
    args = [
      '-y',
      ...inputArgs,
      '-filter_complex', `${labels}concat=n=${frames.length}:v=1:a=0[concat];[concat]scale=iw:ih:flags=lanczos:out_color_matrix=bt709:out_range=tv[v]`,
      '-map', '[v]',
      '-an',
      ...buildH264VideoEncodeArgs({ fps, width: opts.width, height: opts.height }),
      outputPath,
    ];
  }

  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      strategy,
      message: `视频拼接失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
    };
  }
  return { success: true, strategy, output_path: outputPath, args };
}

function audioInputs({ narrationPath, musicPath, sfxEvents = [] }) {
  const inputs = [];
  if (narrationPath) inputs.push({ role: 'narration', path: narrationPath });
  if (musicPath) inputs.push({ role: 'music', path: musicPath });
  for (const event of Array.isArray(sfxEvents) ? sfxEvents : []) {
    if (!event?.path) continue;
    inputs.push({
      role: 'sfx',
      path: event.path,
      global_time_sec: Number(event.global_time_sec || 0),
      volume_db: Number.isFinite(Number(event.volume_db)) ? Number(event.volume_db) : -18,
    });
  }
  return inputs;
}

function buildAudioFilter(inputs, options) {
  const chains = [];
  const duration = Number(options.videoDurationSec || 0);
  inputs.forEach((input, index) => {
    const streamIndex = index + 1;
    const label = input.role === 'music' ? 'music' : input.role === 'sfx' ? 'sfx' : 'narration';
    const volume = input.role === 'music'
      ? options.musicVolumeDb
      : input.role === 'sfx'
        ? input.volume_db
        : options.narrationVolumeDb;
    const fadeIn = input.role === 'sfx' ? 0 : Number(options.fadeInSec || 0);
    // 旁白不能淡出，否则结尾一两个字会像被截断；保留音乐淡出即可。
    const fadeOut = input.role === 'music' ? Number(options.fadeOutSec || 0) : 0;
    const outLabel = `${label}${index}`;
    const filters = [`volume=${Number(volume || 0)}dB`];
    if (input.role === 'sfx') {
      const delayMs = Math.max(0, Math.round(Number(input.global_time_sec || 0) * 1000));
      filters.push(`adelay=${delayMs}|${delayMs}`);
    }
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
    if (fadeOut > 0 && duration > fadeOut) filters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`);
    chains.push(`[${streamIndex}:a]${filters.join(',')}[${outLabel}]`);
  });
  const labelFor = (input, index) => {
    const label = input.role === 'music' ? 'music' : input.role === 'sfx' ? 'sfx' : 'narration';
    return `[${label}${index}]`;
  };
  const baseLabels = [];
  const sfxLabels = [];
  inputs.forEach((input, index) => {
    (input.role === 'sfx' ? sfxLabels : baseLabels).push(labelFor(input, index));
  });
  const compensateLegacyAmix = labels => labels.map((label, offset) => {
    const out = `mix${offset}`;
    // ponytail: bundled ffmpeg is old; pad + pre-gain keeps amix normalization from ducking SFX mixes.
    chains.push(`${label}volume=${labels.length},apad[${out}]`);
    return `[${out}]`;
  });

  // 两级混音：旁白/音乐先按原有 amix（响度与无音效版本一致），音效再叠加。
  // 旧版 bundled ffmpeg 没有 amix normalize 参数，用 apad 保持输入存活并用预增益抵消默认归一化。
  if (!sfxLabels.length) {
    chains.push(`${baseLabels.join('')}amix=inputs=${baseLabels.length}:duration=longest:dropout_transition=0[mixed]`);
  } else if (!baseLabels.length) {
    const finalLabels = compensateLegacyAmix(sfxLabels);
    chains.push(`${finalLabels.join('')}amix=inputs=${finalLabels.length}:duration=longest:dropout_transition=0[mixed]`);
  } else {
    chains.push(`${baseLabels.join('')}amix=inputs=${baseLabels.length}:duration=longest:dropout_transition=0[base]`);
    const finalLabels = compensateLegacyAmix(['[base]', ...sfxLabels]);
    chains.push(`${finalLabels.join('')}amix=inputs=${finalLabels.length}:duration=longest:dropout_transition=0[mixed]`);
  }
  const publishAudioFilters = [
    ...(duration > 0 ? ['apad', `atrim=0:${formatFilterNumber(duration)}`] : []),
    'aresample=48000',
    'aformat=sample_rates=48000:channel_layouts=stereo',
    'loudnorm=I=-16:LRA=7:TP=-1.5',
  ];
  chains.push(`[mixed]${publishAudioFilters.join(',')}[aout]`);
  return chains.join(';');
}

async function muxAudioWithFfmpeg({
  videoPath,
  outputPath,
  musicPath = null,
  narrationPath = null,
  musicVolumeDb = -18,
  narrationVolumeDb = 0,
  fadeInSec = 0,
  fadeOutSec = 1.5,
  sfxEvents = [],
  videoDurationSec = 0,
  runCommand: runCommandImpl = runCommand,
  ffmpegPath,
} = {}) {
  const inputs = audioInputs({ narrationPath, musicPath, sfxEvents });
  if (!inputs.length) {
    return { success: true, skipped: true, output_path: videoPath, message: '无音频文件，跳过混流。' };
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ffmpeg = await getFfmpegCommand({ ffmpegPath, runCommand: runCommandImpl });
  const args = [
    '-y',
    '-i', videoPath,
    ...inputs.flatMap(input => ['-i', input.path]),
    '-filter_complex', buildAudioFilter(inputs, {
      musicVolumeDb,
      narrationVolumeDb,
      fadeInSec,
      fadeOutSec,
      videoDurationSec,
    }),
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    ...OUTPUT_CLEAN_ARGS,
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ];

  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      message: `音频混流失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
    };
  }
  return { success: true, output_path: outputPath, args };
}

function formatFilterNumber(value) {
  return String(Number(Number(value).toFixed(3))).replace(/\.0$/, '');
}

function buildAtempoFilter(speed) {
  const factors = [];
  let remaining = Number(speed);
  if (!Number.isFinite(remaining) || remaining <= 0) return 'atempo=1';
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  factors.push(remaining);
  return factors.map(item => `atempo=${formatFilterNumber(item)}`).join(',');
}

/**
 * 按导出倍速重编码最终成片，并在有音频时保持音画同步。
 * @param {object} options 调速参数。
 * @returns {Promise<object>} ffmpeg 执行结果。
 */
async function retimeVideoWithFfmpeg({
  inputPath,
  outputPath,
  playbackSpeed = 1,
  includeAudio = false,
  fps = 30,
  width = 1920,
  height = 1080,
  runCommand: runCommandImpl = runCommand,
  ffmpegPath,
} = {}) {
  const speed = Number(playbackSpeed);
  if (!inputPath || !outputPath) {
    return { success: false, message: '视频调速失败：缺少输入或输出路径。' };
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    return { success: false, message: '视频调速失败：导出倍速无效。' };
  }
  if (Math.abs(speed - 1) < 0.001) {
    return { success: true, skipped: true, output_path: inputPath, message: '导出倍速为 1x，跳过调速。' };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ffmpeg = await getFfmpegCommand({ ffmpegPath, runCommand: runCommandImpl });
  const outputFps = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : 30;
  const videoFilter = `[0:v]setpts=PTS/${formatFilterNumber(speed)},fps=${formatFilterNumber(outputFps)}[v]`;
  const videoEncodeArgs = buildH264VideoEncodeArgs({ fps: outputFps, width, height });
  const args = includeAudio ? [
    '-y',
    '-i', inputPath,
    '-filter_complex', `${videoFilter};[0:a]${buildAtempoFilter(speed)},aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a]`,
    '-map', '[v]',
    '-map', '[a]',
    ...videoEncodeArgs,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    outputPath,
  ] : [
    '-y',
    '-i', inputPath,
    '-filter_complex', videoFilter,
    '-map', '[v]',
    '-an',
    ...videoEncodeArgs,
    outputPath,
  ];

  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      message: `视频调速失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
      args,
    };
  }
  return { success: true, output_path: outputPath, args };
}

module.exports = {
  H264_PUBLISH_ENCODING,
  buildH264VideoEncodeArgs,
  concatFramesWithFfmpeg,
  concatAudioWithFfmpeg,
  muxAudioWithFfmpeg,
  retimeVideoWithFfmpeg,
  verifyDurationWithFfprobe,
  verifyAudioStreamWithFfprobe,
  probeMediaQualityWithFfprobe,
  getFfmpegCommand,
  getFfprobeCommand,
  runCommand,
  escapeConcatPath,
};
