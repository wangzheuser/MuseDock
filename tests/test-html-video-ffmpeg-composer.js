const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const composer = require('../server/services/creative-video/html-video/ffmpegComposer');

function assertIncludesPair(args, key, value) {
  const index = args.indexOf(key);
  assert.notEqual(index, -1, `缺少 ${key}`);
  assert.equal(args[index + 1], value, `${key} 参数不正确`);
}

(async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-ffmpeg-'));
  const commands = [];
  const runCommand = async (command, args) => {
    if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
      return { ok: false, code: 1, stdout: '', stderr: '' };
    }
    commands.push({ command, args });
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const demuxerOutput = path.join(workDir, 'exports/output.mp4');
  const demuxer = await composer.concatFramesWithFfmpeg([
    { path: path.join(workDir, 'frames/01.mp4'), engine: 'hyperframes-playwright', encoding: composer.H264_PUBLISH_ENCODING },
    { path: path.join(workDir, 'frames/02.mp4'), engine: 'hyperframes-playwright', encoding: composer.H264_PUBLISH_ENCODING },
  ], demuxerOutput, workDir, { runCommand });

  assert.equal(demuxer.success, true);
  assert.equal(demuxer.strategy, 'concat-demuxer');
  assert.deepEqual(commands[0].args, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.join(workDir, 'frames/concat.txt'),
    '-map', '0:v:0',
    '-c:v', 'copy',
    '-an',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-sn', '-dn',
    '-movflags', '+faststart',
    demuxerOutput,
  ]);
  const concatList = await fs.readFile(path.join(workDir, 'frames/concat.txt'), 'utf8');
  assert.ok(concatList.includes("file '"));
  assert.ok(concatList.includes('/frames/01.mp4') || concatList.includes('frames/01.mp4'));

  const filterOutput = path.join(workDir, 'exports/filter-output.mp4');
  const filter = await composer.concatFramesWithFfmpeg([
    { path: path.join(workDir, 'frames/01.mp4'), engine: 'hyperframes-playwright', encoding: 'h264-yuv420p-crf20' },
    { path: path.join(workDir, 'frames/02.mp4'), engine: 'other-engine', encoding: 'vp9' },
  ], filterOutput, workDir, { runCommand, fps: 30, width: 1920, height: 1080 });

  assert.equal(filter.success, true);
  assert.equal(filter.strategy, 'concat-filter');
  const filterArgs = commands[1].args;
  assert.ok(filterArgs.includes('[0:v][1:v]concat=n=2:v=1:a=0[concat];[concat]scale=iw:ih:flags=lanczos:out_color_matrix=bt709:out_range=tv[v]'));
  assertIncludesPair(filterArgs, '-c:v', 'libx264');
  assertIncludesPair(filterArgs, '-crf', '17');
  assertIncludesPair(filterArgs, '-profile:v', 'high');
  assertIncludesPair(filterArgs, '-pix_fmt', 'yuv420p');
  assertIncludesPair(filterArgs, '-g', '60');
  assertIncludesPair(filterArgs, '-colorspace', 'bt709');
  assertIncludesPair(filterArgs, '-color_primaries', 'bt709');
  assertIncludesPair(filterArgs, '-color_trc', 'bt709');
  assertIncludesPair(filterArgs, '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off');
  assertIncludesPair(filterArgs, '-movflags', '+faststart');

  const muxOutput = path.join(workDir, 'exports/muxed.mp4');
  const mux = await composer.muxAudioWithFfmpeg({
    videoPath: filterOutput,
    outputPath: muxOutput,
    musicPath: path.join(workDir, 'music.mp3'),
    narrationPath: path.join(workDir, 'narration.wav'),
    musicVolumeDb: -18,
    narrationVolumeDb: 0,
    fadeInSec: 0.2,
    fadeOutSec: 1.5,
    videoDurationSec: 6,
    runCommand,
  });

  assert.equal(mux.success, true);
  assert.deepEqual(commands[2].args.slice(0, 7), [
    '-y',
    '-i', filterOutput,
    '-i', path.join(workDir, 'narration.wav'),
    '-i', path.join(workDir, 'music.mp3'),
  ]);
  assert.ok(commands[2].args.includes('-filter_complex'));
  const filterComplex = commands[2].args[commands[2].args.indexOf('-filter_complex') + 1];
  assert.ok(filterComplex.includes('volume=0dB'));
  assert.ok(filterComplex.includes('volume=-18dB'));
  assert.ok(filterComplex.includes('afade=t=in:st=0:d=0.2'));
  assert.ok(filterComplex.includes('afade=t=out:st=4.5:d=1.5'));
  assert.doesNotMatch(filterComplex, /\[1:a\][^;]*afade=t=out/, '旁白轨不应淡出，避免尾字变小');
  assert.ok(filterComplex.includes('amix=inputs=2:duration=longest:dropout_transition=0[mixed]'));
  assert.ok(filterComplex.includes('[mixed]apad,atrim=0:6,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:LRA=7:TP=-1.5[aout]'));
  assertIncludesPair(commands[2].args, '-map', '0:v:0');
  assertIncludesPair(commands[2].args, '-c:a', 'aac');
  assertIncludesPair(commands[2].args, '-b:a', '192k');
  assertIncludesPair(commands[2].args, '-ar', '48000');
  assertIncludesPair(commands[2].args, '-ac', '2');
  assertIncludesPair(commands[2].args, '-movflags', '+faststart');
  assert.ok(commands[2].args.includes('-shortest'));

  const muxWithSfxOutput = path.join(workDir, 'exports/muxed-sfx.mp4');
  const muxWithSfx = await composer.muxAudioWithFfmpeg({
    videoPath: filterOutput,
    outputPath: muxWithSfxOutput,
    musicPath: path.join(workDir, 'music.mp3'),
    narrationPath: path.join(workDir, 'narration.wav'),
    sfxEvents: [
      { path: path.join(workDir, 'sfx1.wav'), global_time_sec: 0.18, volume_db: -16 },
      { path: path.join(workDir, 'sfx2.wav'), global_time_sec: 1.2, volume_db: -18 },
    ],
    videoDurationSec: 6,
    runCommand,
  });
  assert.equal(muxWithSfx.success, true);
  const sfxArgs = commands.at(-1).args;
  const expectedSfxInputs = [
    '-y',
    '-i', filterOutput,
    '-i', path.join(workDir, 'narration.wav'),
    '-i', path.join(workDir, 'music.mp3'),
    '-i', path.join(workDir, 'sfx1.wav'),
    '-i', path.join(workDir, 'sfx2.wav'),
  ];
  assert.deepEqual(sfxArgs.slice(0, expectedSfxInputs.length), expectedSfxInputs);
  const sfxFilter = sfxArgs[sfxArgs.indexOf('-filter_complex') + 1];
  assert.ok(sfxFilter.includes('[3:a]volume=-16dB,adelay=180|180[sfx2]'));
  assert.ok(sfxFilter.includes('[4:a]volume=-18dB,adelay=1200|1200'));
  // 两级混音：旁白+音乐先按原响度 amix，音效用旧版 ffmpeg 兼容的预增益叠加
  assert.ok(sfxFilter.includes('[narration0][music1]amix=inputs=2:duration=longest:dropout_transition=0[base]'));
  assert.ok(sfxFilter.includes('[base]volume=3,apad[mix0]'));
  assert.ok(sfxFilter.includes('[sfx2]volume=3,apad[mix1]'));
  assert.ok(sfxFilter.includes('[sfx3]volume=3,apad[mix2]'));
  assert.ok(sfxFilter.includes('[mix0][mix1][mix2]amix=inputs=3:duration=longest:dropout_transition=0[mixed]'));
  assert.doesNotMatch(sfxFilter, /normalize=0|whole_dur/);

  const noAudio = await composer.muxAudioWithFfmpeg({
    videoPath: filterOutput,
    outputPath: path.join(workDir, 'exports/no-audio.mp4'),
    runCommand,
  });
  assert.equal(noAudio.success, true);
  assert.equal(noAudio.skipped, true);

  const retimedOutput = path.join(workDir, 'exports/retimed.mp4');
  const retimed = await composer.retimeVideoWithFfmpeg({
    inputPath: muxOutput,
    outputPath: retimedOutput,
    playbackSpeed: 1.25,
    includeAudio: true,
    fps: 30,
    runCommand,
  });
  assert.equal(retimed.success, true);
  const retimedArgs = commands.at(-1).args;
  assert.ok(retimedArgs.includes('[0:v]setpts=PTS/1.25,fps=30[v];[0:a]atempo=1.25,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a]'));
  assertIncludesPair(retimedArgs, '-crf', '17');
  assertIncludesPair(retimedArgs, '-g', '60');
  assertIncludesPair(retimedArgs, '-ar', '48000');
  assertIncludesPair(retimedArgs, '-ac', '2');

  const slowRetimedOutput = path.join(workDir, 'exports/retimed-slow.mp4');
  const slowRetimed = await composer.retimeVideoWithFfmpeg({
    inputPath: muxOutput,
    outputPath: slowRetimedOutput,
    playbackSpeed: 0.1,
    includeAudio: true,
    fps: 30,
    runCommand,
  });
  assert.equal(slowRetimed.success, true);
  assert.ok(commands.at(-1).args.includes('[0:v]setpts=PTS/0.1,fps=30[v];[0:a]atempo=0.5,atempo=0.5,atempo=0.5,atempo=0.8,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a]'));

  const quality = await composer.probeMediaQualityWithFfprobe({
    videoPath: muxOutput,
    expectedWidth: 1080,
    expectedHeight: 1920,
    expectedFps: 30,
    requireAudio: true,
    ffprobePath: 'ffprobe-test',
    runCommand: async () => ({
      ok: true,
      stdout: JSON.stringify({
        streams: [
          {
            codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1080, height: 1920,
            pix_fmt: 'yuv420p', avg_frame_rate: '30/1', bit_rate: '8000000', color_range: 'tv',
            color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709',
          },
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, bit_rate: '192000' },
        ],
        format: { duration: '6', size: '6200000', bit_rate: '8192000' },
      }),
      stderr: '',
    }),
  });
  assert.equal(quality.success, true);
  assert.equal(quality.pass, true);
  assert.equal(quality.metrics.video_bitrate, 8000000);

  const contentAdaptiveQuality = await composer.probeMediaQualityWithFfprobe({
    videoPath: muxOutput,
    expectedWidth: 1080,
    expectedHeight: 1920,
    expectedFps: 30,
    encodingMode: composer.H264_PUBLISH_ENCODING,
    ffprobePath: 'ffprobe-test',
    runCommand: async () => ({
      ok: true,
      stdout: JSON.stringify({
        streams: [{
          codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1080, height: 1920,
          pix_fmt: 'yuv420p', avg_frame_rate: '30/1', bit_rate: '2000000', color_range: 'tv',
          color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709',
        }],
        format: { duration: '6', size: '1500000', bit_rate: '2000000' },
      }),
      stderr: '',
    }),
  });
  assert.equal(contentAdaptiveQuality.pass, true);
  assert.equal(contentAdaptiveQuality.metrics.encoding_mode, composer.H264_PUBLISH_ENCODING);
  assert.equal(contentAdaptiveQuality.issues.some(item => item.code === 'video_bitrate_low'), false);

  const qualityWarning = await composer.probeMediaQualityWithFfprobe({
    videoPath: muxOutput,
    expectedWidth: 1080,
    expectedHeight: 1920,
    expectedFps: 60,
    requireAudio: true,
    ffprobePath: 'ffprobe-test',
    ffmpegPath: 'ffmpeg-test',
    runCommand: async command => command === 'ffmpeg-test'
      ? { ok: true, stdout: '', stderr: 'frame= 144 fps=0.0 time=00:00:06.00' }
      : {
        ok: true,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1080, height: 1920,
              pix_fmt: 'yuv420p', avg_frame_rate: '60/1', bit_rate: '2000000', nb_frames: '360', color_range: 'unknown',
            },
            { codec_type: 'audio', codec_name: 'aac', sample_rate: '24000', channels: 1, bit_rate: '96000' },
            { codec_type: 'data', codec_name: 'bin_data' },
          ],
          format: { duration: '6', size: '2000000', bit_rate: '2200000' },
        }),
        stderr: '',
      },
  });
  assert.equal(qualityWarning.success, true);
  assert.equal(qualityWarning.pass, false);
  assert.equal(qualityWarning.issues.some(item => item.code === 'high_fps_static_content' && item.severity === 'info'), true);
  assert.equal(qualityWarning.metrics.unique_frames_estimate, 144);
  assert.equal(qualityWarning.metrics.motion_effective_fps_estimate, 24);
  assert.equal(qualityWarning.issues.some(item => item.code === 'audio_sample_rate_unexpected'), true);
  assert.equal(qualityWarning.issues.some(item => item.code === 'extra_streams_present'), true);

  const highFpsStaticInfo = await composer.probeMediaQualityWithFfprobe({
    videoPath: muxOutput,
    expectedWidth: 1080,
    expectedHeight: 1920,
    expectedFps: 60,
    requireAudio: true,
    encodingMode: composer.H264_PUBLISH_ENCODING,
    ffprobePath: 'ffprobe-test',
    ffmpegPath: 'ffmpeg-test',
    runCommand: async command => command === 'ffmpeg-test'
      ? { ok: true, stdout: '', stderr: 'frame= 300 fps=0.0 time=00:00:06.00' }
      : {
        ok: true,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1080, height: 1920,
              pix_fmt: 'yuv420p', avg_frame_rate: '60/1', bit_rate: '4000000', nb_frames: '360', color_range: 'tv',
              color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709',
            },
            { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, bit_rate: '192000' },
          ],
          format: { duration: '6', size: '3200000', bit_rate: '4192000' },
        }),
        stderr: '',
      },
  });
  assert.equal(highFpsStaticInfo.success, true);
  assert.equal(highFpsStaticInfo.pass, true);
  assert.equal(highFpsStaticInfo.publish_ready, true);
  assert.equal(highFpsStaticInfo.issues[0].code, 'high_fps_static_content');
  assert.match(highFpsStaticInfo.issues[0].message, /已按 60 FPS 逐帧生成/);

  const qualityFailure = await composer.probeMediaQualityWithFfprobe({
    videoPath: muxOutput,
    expectedWidth: 1080,
    expectedHeight: 1920,
    expectedFps: 30,
    ffprobePath: 'ffprobe-test',
    runCommand: async () => ({
      ok: true,
      stdout: JSON.stringify({
        streams: [{ codec_type: 'video', codec_name: 'vp9', profile: '0', width: 720, height: 1280, pix_fmt: 'yuv444p', avg_frame_rate: '25/1' }],
        format: {},
      }),
      stderr: '',
    }),
  });
  assert.equal(qualityFailure.success, false);
  assert.equal(qualityFailure.issues.some(item => item.code === 'resolution_mismatch' && item.severity === 'error'), true);

  const probe = await composer.verifyDurationWithFfprobe({
    videoPath: filterOutput,
    expectedDurationSec: 6,
    toleranceSec: 0.5,
    ffprobePath: 'ffprobe-test',
    runCommand: async (command, args) => {
      assert.equal(command, 'ffprobe-test');
      assert.deepEqual(args, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filterOutput,
      ]);
      return { ok: true, stdout: '6.2\n', stderr: '' };
    },
  });
  assert.equal(probe.success, true);
  assert.equal(probe.duration_sec, 6.2);

  const durationMismatch = await composer.verifyDurationWithFfprobe({
    videoPath: filterOutput,
    expectedDurationSec: 6,
    toleranceSec: 0.25,
    ffprobePath: 'ffprobe-test',
    runCommand: async () => ({ ok: true, stdout: '7.1\n', stderr: '' }),
  });
  assert.equal(durationMismatch.success, false);
  assert.equal(durationMismatch.code, 'duration_mismatch');
  assert.match(durationMismatch.message, /时长偏差/);

  const ffmpegDir = path.join(workDir, 'bin');
  const foundFfmpeg = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const expectedFfprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  await fs.mkdir(ffmpegDir, { recursive: true });
  await fs.writeFile(expectedFfprobe, 'ffprobe');
  const resolvedProbe = await composer.verifyDurationWithFfprobe({
    videoPath: filterOutput,
    expectedDurationSec: 6,
    toleranceSec: 0.5,
    runCommand: async (command, args) => {
      if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
        assert.deepEqual(args, ['ffmpeg']);
        return { ok: true, stdout: `${foundFfmpeg}\n`, stderr: '' };
      }
      assert.equal(command, expectedFfprobe);
      return { ok: true, stdout: '6.0\n', stderr: '' };
    },
  });
  assert.equal(resolvedProbe.success, true);
  assert.equal(resolvedProbe.duration_sec, 6);

  const timedOut = await composer.runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 30 });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.timed_out, true);
  assert.match(timedOut.error, /超时/);

  const narrationTrack = await composer.concatAudioWithFfmpeg([
    { path: path.join(workDir, 'tts/scene_01.mp3') },
    { path: path.join(workDir, 'tts/scene_02.mp3') },
  ], path.join(workDir, 'exports/narration.mp3'), workDir, { runCommand });
  assert.equal(narrationTrack.success, true);
  assert.deepEqual(commands.at(-1).args, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.join(workDir, 'audio/concat.txt'),
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    path.join(workDir, 'exports/narration.mp3'),
  ]);

  console.log('html-video ffmpeg composer tests passed');
})();
