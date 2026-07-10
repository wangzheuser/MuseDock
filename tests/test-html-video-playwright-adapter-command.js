const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  buildFrameEncoderArgs,
  render,
} = require('../server/services/creative-video/html-video/hyperframesPlaywrightAdapter');
const { diagnoseEnvironment } = require('../server/services/creative-video/html-video/environmentDoctor');

(async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-adapter-'));
  try {
    const sourcePath = path.join(workDir, 'frame.html');
    const outputPath = path.join(workDir, 'frame.mp4');
    await fsp.writeFile(sourcePath, '<html><body><h1>帧</h1></body></html>', 'utf8');

    const encoderArgs = buildFrameEncoderArgs({
      outputPath,
      fps: 24,
      width: 640,
      height: 360,
    });
    assertIncludesPair(encoderArgs, '-f', 'image2pipe');
    assertIncludesPair(encoderArgs, '-framerate', '24');
    assertIncludesPair(encoderArgs, '-vcodec', 'png');
    assertIncludesPair(encoderArgs, '-i', 'pipe:0');

    const calls = {
      launches: [],
      contexts: [],
      gotos: [],
      initScripts: 0,
      progress: [],
      ffmpeg: [],
      screenshots: [],
      seeks: [],
    };

    const mockPlaywright = {
      chromium: {
        launch: async options => {
          calls.launches.push(options);
          return {
            newContext: async options => {
              calls.contexts.push(options);
              return {
                newPage: async () => ({
                  addInitScript: async () => { calls.initScripts += 1; },
                  goto: async (url, options) => { calls.gotos.push({ url, options }); },
                  evaluate: async (fn, value) => {
                    const source = String(fn);
                    if (source.includes('getComputedStyle')) return 1800;
                    if (source.includes('__hvPlayAll')) return true;
                    if (source.includes('targetTimeSec')) calls.seeks.push(value);
                    return undefined;
                  },
                  waitForTimeout: async () => {},
                  screenshot: async options => {
                    calls.screenshots.push(options);
                    return Buffer.from('png-frame');
                  },
                }),
                close: async () => {},
              };
            },
            close: async () => {},
          };
        },
      },
    };

    const renderResult = await render(
      {
        template: { sourcePath },
        config: {
          outputPath,
          resolution: { width: 640, height: 360 },
          fps: 24,
          duration: 4,
          durationMode: 'explicit',
        },
      },
      {
        onProgress: (percent, message) => calls.progress.push({ percent, message }),
      },
      {
        importPlaywright: async () => mockPlaywright,
        runFrameEncoder: async (command, args, encoder) => {
          calls.ffmpeg.push({ command, args });
          calls.frameCount = encoder.frameCount;
          await encoder.captureFrame(0);
          await encoder.captureFrame(encoder.frameCount - 1);
          encoder.onFrame?.(1);
          encoder.onFrame?.(encoder.frameCount);
          await fsp.writeFile(outputPath, Buffer.alloc(4096, 1));
          return { ok: true, stdout: '', stderr: '' };
        },
        probeVideoStreams: async () => [{ codec_type: 'video' }],
        ffmpegPath: 'ffmpeg-mock',
      },
    );
    assert.equal(renderResult.diagnostics[0].code, 'frame_rendered');
    assert.match(renderResult.diagnostics[0].message, /Playwright\/Chromium/);

    assert.equal(calls.launches.length, 1);
    assert.equal(calls.launches[0].headless, true);
    assert.deepEqual(calls.contexts[0].viewport, { width: 640, height: 360 });
    assert.equal(calls.contexts[0].recordVideo, undefined);
    assert.equal(calls.initScripts, 1);
    assert.equal(calls.gotos[0].options.waitUntil, 'domcontentloaded');
    assert.equal(calls.frameCount, 96);
    assert.deepEqual(calls.seeks, [0, 95 / 24]);
    assert.equal(calls.screenshots.length, 2);
    assert.deepEqual(calls.screenshots[0].clip, { x: 0, y: 0, width: 640, height: 360 });

    assert.equal(calls.ffmpeg.length, 1);
    assert.equal(calls.ffmpeg[0].command, 'ffmpeg-mock');
    const args = calls.ffmpeg[0].args;
    assertIncludesPair(args, '-c:v', 'libx264');
    assertIncludesPair(args, '-pix_fmt', 'yuv420p');
    assertIncludesPair(args, '-preset', 'medium');
    assertIncludesPair(args, '-crf', '17');
    assertIncludesPair(args, '-profile:v', 'high');
    assertIncludesPair(args, '-g', '48');
    assertIncludesPair(args, '-colorspace', 'bt709');
    assertIncludesPair(args, '-color_primaries', 'bt709');
    assertIncludesPair(args, '-color_trc', 'bt709');
    assertIncludesPair(args, '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off');
    assertIncludesPair(args, '-movflags', '+faststart');
    assertIncludesPair(args, '-f', 'image2pipe');
    assertIncludesPair(args, '-framerate', '24');
    assertIncludesPair(args, '-vcodec', 'png');
    assertIncludesPair(args, '-i', 'pipe:0');
    assert.ok(args.includes('-an'), '帧视频不应包含音轨');
    assert.equal(args.includes('-ss'), false, '确定性逐帧渲染不应依赖录屏裁剪');
    assert.equal(args.includes('-vf'), false, 'PNG 帧已按目标尺寸和时间采样，不需要补帧滤镜');
    assert.equal(renderResult.meta.encoding, 'h264-yuv420p-crf17-bt709');
    assert.equal(renderResult.meta.captureMode, 'deterministic-frames');
    assert.equal(renderResult.meta.renderedFrames, 96);

    const badOutputPath = path.join(workDir, 'bad-frame.mp4');
    await assert.rejects(
      () => render(
        {
          template: { sourcePath },
          config: {
            outputPath: badOutputPath,
            resolution: { width: 640, height: 360 },
            fps: 24,
            duration: 2,
            durationMode: 'explicit',
          },
        },
        {},
        {
          importPlaywright: async () => mockPlaywright,
          runFrameEncoder: async () => {
            await fsp.writeFile(badOutputPath, Buffer.alloc(4096, 1));
            return { ok: true, stdout: '', stderr: '' };
          },
          probeVideoStreams: async () => [],
          ffmpegPath: 'ffmpeg-mock',
        },
      ),
      error => error.code === 'render-failed'
        && error.message.includes('html-video 编码完成但输出视频无有效画面流。'),
    );

    const ffmpegDir = path.join(workDir, 'bin');
    const ffmpegExecutable = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const expectedFfprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    await fsp.mkdir(ffmpegDir, { recursive: true });
    await fsp.writeFile(expectedFfprobe, 'ffprobe');
    const ffprobeCalls = [];
    const absoluteFfprobeOutput = path.join(workDir, 'absolute-ffprobe.mp4');
    await render(
      {
        template: { sourcePath },
        config: {
          outputPath: absoluteFfprobeOutput,
          resolution: { width: 640, height: 360 },
          fps: 24,
          duration: 2,
          durationMode: 'explicit',
        },
      },
      {},
      {
        importPlaywright: async () => mockPlaywright,
        runCommand: async (command, args) => {
          if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
            return { ok: true, stdout: `${ffmpegExecutable}\n`, stderr: '' };
          }
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        },
        runFrameEncoder: async (command) => {
          assert.equal(command, ffmpegExecutable);
          await fsp.writeFile(absoluteFfprobeOutput, Buffer.alloc(4096, 1));
          return { ok: true, stdout: '', stderr: '' };
        },
        runFfprobe: async (command, args) => {
          ffprobeCalls.push({ command, args });
          return { ok: true, stdout: JSON.stringify({ streams: [{ codec_type: 'video' }] }), stderr: '' };
        },
      },
    );
    assert.ok(ffprobeCalls.length >= 1);
    assert.equal(ffprobeCalls[0].command, expectedFfprobe);

    const originalFfmpegPath = process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_PATH;
    const commandCalls = [];
    try {
      const foundFfmpeg = process.platform === 'win32'
        ? path.join(workDir, 'doctor-bin', 'ffmpeg.exe')
        : path.join(workDir, 'doctor-bin', 'ffmpeg');
      const foundFfprobe = path.join(path.dirname(foundFfmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      await fsp.mkdir(path.dirname(foundFfmpeg), { recursive: true });
      await fsp.writeFile(foundFfprobe, 'ffprobe');
      const doctor = await diagnoseEnvironment({
        importPlaywright: async () => ({
          chromium: {
            launch: async () => ({ close: async () => {} }),
          },
        }),
        runCommand: async (command, args) => {
          commandCalls.push({ command, args });
          if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
            return { ok: true, stdout: `${foundFfmpeg}\n`, stderr: '' };
          }
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        },
      });

      assert.equal(doctor.ok, true);
      assert.equal(commandCalls[0].command, process.platform === 'win32' ? 'where.exe' : 'which');
      assert.deepEqual(commandCalls[0].args, ['ffmpeg']);
      assert.equal(doctor.diagnostics.find(item => item.code === 'ffmpeg_available').path, foundFfmpeg);
      assert.equal(doctor.diagnostics.find(item => item.code === 'ffprobe_available').path, foundFfprobe);
    } finally {
      if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = originalFfmpegPath;
    }

    const missingFfprobe = await diagnoseEnvironment({
      importPlaywright: async () => ({
        chromium: {
          launch: async () => ({ close: async () => {} }),
        },
      }),
      runCommand: async (command, args) => {
        const basename = path.basename(command).toLowerCase();
        if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
          return { ok: false, stdout: '', stderr: 'not found' };
        }
        if (basename.startsWith('ffmpeg')) {
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        }
        if (basename.startsWith('ffprobe')) {
          return { ok: false, stdout: '', stderr: 'ffprobe missing' };
        }
        return { ok: false, stdout: '', stderr: 'unexpected command' };
      },
    });
    assert.equal(missingFfprobe.ok, false);
    assert.equal(missingFfprobe.diagnostics.some(item => item.code === 'ffmpeg_available'), true);
    const ffprobeMissing = missingFfprobe.diagnostics.find(item => item.code === 'ffprobe_missing');
    assert.ok(ffprobeMissing);
    assert.equal(path.basename(ffprobeMissing.path).toLowerCase(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    assert.equal(ffprobeMissing.path.includes('@ffmpeg-installer'), false);

    console.log('html-video playwright adapter command tests passed');
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
})();

function assertIncludesPair(args, key, value) {
  const index = args.indexOf(key);
  assert.notEqual(index, -1, `缺少 ${key}`);
  assert.equal(args[index + 1], value, `${key} 参数不正确`);
}
