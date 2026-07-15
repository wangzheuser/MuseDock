import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils.js';
import {
  ASPECT_RATIOS,
  CREATIVE_FPS_OPTIONS,
  DEFAULT_TTS_VOICE,
  getCreativeDefaults,
  getTemplateId,
  isTemplateShownForAspect,
  normalizeTtsVoiceOptions,
} from '@/lib/creativeDefaultsOptions.js';
import { api } from '../../api/client.js';
import { TemplatePicker } from '../creative/TemplatePicker.jsx';
import { Switch } from './Switch.jsx';

/**
 * 判断当前激活的 TTS 模型是否为 MiMo，以决定是否允许试听 MiMo 音色。
 * @param {object} model 设置中心激活模型信息。
 * @returns {boolean} 是否为 MiMo TTS。
 */
function isMimoTtsModel(model) {
  const providerName = String(model?.providerName || '').trim().toLowerCase();
  const providerId = String(model?.providerId || '').trim().toLowerCase();
  const modelId = String(model?.modelId || '').trim().toLowerCase();
  return ['mimo', 'xiaomi', 'xiaomimimo'].includes(providerName)
    || ['mimo', 'xiaomi', 'xiaomimimo'].includes(providerId)
    || modelId.startsWith('mimo');
}

/**
 * 播放后端返回的 base64 试听音频。
 * @param {{mime?: string, base64?: string}} audio 试听音频数据。
 * @returns {Promise<void>} 播放完成的 Promise。
 */
async function playPreviewAudio(audio = {}) {
  if (!audio.base64) throw new Error('试听音频为空。');
  const player = new Audio(`data:${audio.mime || 'audio/wav'};base64,${audio.base64}`);
  await player.play();
}

export function CreativeDefaultsSettings({
  appSettings,
  activeModels,
  modelSettingsLoading = false,
  templates,
  ttsVoices,
  disabled,
  saving,
  dirty,
  onChange,
  onSave,
}) {
  const [sourceImageAnalysisMessage, setSourceImageAnalysisMessage] = useState('');
  const [previewStatus, setPreviewStatus] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const creativeDefaults = getCreativeDefaults(appSettings);
  const safeTemplates = Array.isArray(templates) ? templates : [];
  const voiceOptions = normalizeTtsVoiceOptions(ttsVoices);
  const activeTtsModel = activeModels?.tts || null;
  const mimoTtsActive = activeTtsModel?.enabled === true && isMimoTtsModel(activeTtsModel);
  const sourceImageAnalysisEnabled = creativeDefaults.sourceImageAnalysisEnabled === true;
  const canUseSourceImageAnalysis = activeModels?.text?.enabled === true
    && activeModels?.text?.modelId
    && activeModels?.text?.supportsMultimodal === true;
  const sourceImageAnalysisUnavailable = modelSettingsLoading !== true && !canUseSourceImageAnalysis;
  const sourceImageAnalysisUnsupported = sourceImageAnalysisEnabled && sourceImageAnalysisUnavailable;
  const playbackSpeedText = String(creativeDefaults.playbackSpeed ?? '').trim();
  const playbackSpeedInvalid = !/^\d+(\.\d)?$/.test(playbackSpeedText)
    || Number(playbackSpeedText) < 0.1
    || Number(playbackSpeedText) > 2;
  const sourceImageAnalysisWarning = sourceImageAnalysisUnsupported
    ? '来源图片多模态分析已开启，但当前分析模型不支持图片输入。请切换到支持多模态的分析模型，或先关闭该开关。'
    : sourceImageAnalysisUnavailable
      ? '当前分析模型未标记为支持多模态输入，无法开启来源图片多模态分析。'
      : sourceImageAnalysisMessage;

  useEffect(() => {
    if (modelSettingsLoading || canUseSourceImageAnalysis) {
      setSourceImageAnalysisMessage('');
    }
  }, [canUseSourceImageAnalysis, modelSettingsLoading]);

  function updateCreativeDefaults(nextCreativeDefaults) {
    onChange({
      ...(appSettings || {}),
      creativeDefaults: {
        ...creativeDefaults,
        ...nextCreativeDefaults,
      },
    });
  }

  function updateTemplate(aspectRatio, templateId) {
    updateCreativeDefaults({
      templateByAspectRatio: {
        ...creativeDefaults.templateByAspectRatio,
        [aspectRatio]: typeof templateId === 'string' ? templateId : '',
      },
    });
  }

  function handleSave() {
    onSave({
      ...(appSettings || {}),
      creativeDefaults,
    });
  }

  function handleSourceImageAnalysisChange(checked) {
    if (checked && sourceImageAnalysisUnavailable) {
      setSourceImageAnalysisMessage('当前分析模型未标记为支持多模态输入，无法开启来源图片多模态分析。');
      return;
    }
    setSourceImageAnalysisMessage('');
    updateCreativeDefaults({ sourceImageAnalysisEnabled: checked });
  }

  async function previewTtsVoice() {
    if (!mimoTtsActive) {
      setPreviewStatus({ type: 'error', message: '当前试听音色仅支持小米 MiMo TTS。请先在模型配置中启用 MiMo TTS。' });
      return;
    }
    setPreviewing(true);
    setPreviewStatus({ type: 'loading', message: '正在生成试听音频...' });
    try {
      const result = await api.previewTts({
        voice: creativeDefaults.ttsVoice || DEFAULT_TTS_VOICE,
        emotionalVoice: creativeDefaults.emotionalVoice === true,
      });
      await playPreviewAudio(result.audio);
      setPreviewStatus({ type: 'success', message: result.message || '试听音频已播放。' });
    } catch (error) {
      setPreviewStatus({ type: 'error', message: error.message || '试听音色失败，请检查 TTS 配置。' });
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section>
      <div className="sticky top-0 z-10 -mx-2 mb-4 flex items-start justify-between gap-3 border-b border-[#edf0f4] bg-white/95 px-2 pb-3 pt-1 backdrop-blur max-[520px]:flex-col">
        <div>
          <h3 className="m-0 text-lg font-bold">创作默认值</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">设置一键创作默认使用的画面比例、目标时长、生成帧率、模板策略和联网研究开关。</p>
        </div>
        <button
          type="button"
          className="min-h-9 rounded-lg bg-[#111827] px-4 text-sm font-bold text-white transition hover:bg-[#020617] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={disabled || saving || !appSettings || playbackSpeedInvalid}
          onClick={handleSave}
        >
          {saving ? '正在保存创作默认值...' : '保存创作默认值'}
        </button>
        {dirty ? <span className="absolute bottom-1 right-2 text-[11px] font-semibold text-amber-700">有尚未保存的修改</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">默认画面比例</span>
          <select
            value={creativeDefaults.aspectRatio}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ aspectRatio: event.target.value })}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ASPECT_RATIOS.map(aspectRatio => (
              <option key={aspectRatio} value={aspectRatio}>{aspectRatio}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">默认目标时长</span>
          <input
            type="number"
            min="15"
            max="180"
            step="1"
            value={creativeDefaults.targetDurationSec}
            disabled={disabled}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
            onChange={event => updateCreativeDefaults({
              targetDurationSec: event.target.value === '' ? '' : Number(event.target.value),
            })}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">默认生成帧率</span>
          <select
            value={creativeDefaults.fps || 30}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ fps: Number(event.target.value) })}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {CREATIVE_FPS_OPTIONS.map(fps => (
              <option key={fps} value={fps}>{fps === 60 ? '60 FPS（高动态，渲染约需双倍时间）' : '30 FPS（通用）'}</option>
            ))}
          </select>
          <span className="text-[11px] leading-relaxed text-[#7b8492]">60 FPS 会从源头逐帧渲染；静态资讯画面的清晰度主要由分辨率和编码质量决定。</span>
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">默认导出倍速</span>
          <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
            <input
              type="number"
              min="0.1"
              max="2.0"
              step="0.1"
              value={creativeDefaults.playbackSpeed}
              disabled={disabled}
              aria-invalid={playbackSpeedInvalid}
              aria-describedby="default-playback-speed-help"
              className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={event => updateCreativeDefaults({
                playbackSpeed: event.target.value === '' ? '' : Number(event.target.value),
              })}
            />
            <span className="text-xs font-semibold text-[#5f6876]">x</span>
          </span>
          <span id="default-playback-speed-help" className={cn('text-[11px] leading-relaxed', playbackSpeedInvalid ? 'font-semibold text-red-600' : 'text-[#7b8492]')}>
            {playbackSpeedInvalid
              ? '请输入 0.1 到 2.0 之间、最多一位小数的导出倍速。'
              : '影响首次自动成片和工程后续导出的初始倍速，1.0 为原速。'}
          </span>
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">帧 HTML 并发上限</span>
          <input
            type="number"
            min="1"
            max="5"
            step="1"
            value={creativeDefaults.frameHtmlConcurrency}
            disabled={disabled}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
            onChange={event => updateCreativeDefaults({
              frameHtmlConcurrency: event.target.value === '' ? '' : Number(event.target.value),
            })}
          />
        </label>

        <div className="grid gap-2.5 md:col-span-2">
          <span className="text-xs font-semibold text-[#5f6876]">按比例默认模板</span>
          {ASPECT_RATIOS.map(aspectRatio => {
            const value = typeof creativeDefaults.templateByAspectRatio?.[aspectRatio] === 'string'
              ? creativeDefaults.templateByAspectRatio[aspectRatio]
              : '';
            const aspectTemplates = safeTemplates.filter(template => (
              getTemplateId(template) && isTemplateShownForAspect(template, aspectRatio)
            ));

            return (
              <div
                key={aspectRatio}
                className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2.5"
              >
                <span className="text-xs font-semibold text-[#5f6876]">{aspectRatio}</span>
                <TemplatePicker
                  compact
                  templates={aspectTemplates}
                  aspectRatio={aspectRatio}
                  value={value}
                  disabled={disabled}
                  onChange={templateId => updateTemplate(aspectRatio, templateId)}
                />
              </div>
            );
          })}
        </div>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.lockTemplate === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ lockTemplate: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.lockTemplate ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.lockTemplate ? '已锁定' : '未锁定'}</span>
          <span>锁定模板</span>
        </label>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.useResearch === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ useResearch: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.useResearch ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.useResearch ? '已开启' : '已关闭'}</span>
          <span>联网研究默认开启</span>
        </label>

        <div className={`rounded-lg border p-3 ${sourceImageAnalysisUnsupported ? 'border-amber-200 bg-amber-50' : 'border-[#edf0f4] bg-[#fafbfc]'}`}>
          <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-[#30343b]">
            <Switch
              checked={sourceImageAnalysisEnabled}
              disabled={disabled || (!sourceImageAnalysisEnabled && sourceImageAnalysisUnavailable)}
              onChange={event => handleSourceImageAnalysisChange(event.target.checked)}
            />
            <span className={cn('min-w-[42px]', sourceImageAnalysisEnabled ? 'text-[#111827]' : 'text-[#69717e]')}>{sourceImageAnalysisEnabled ? '已开启' : '已关闭'}</span>
            <span>来源图片多模态分析</span>
          </label>
          <p className="mt-2 whitespace-normal text-xs font-normal leading-relaxed text-[#69717e]">
            关闭后仍会提取文章/GitHub 图片，但只基于图片说明、URL 和上下文进行轻量匹配。
          </p>
          {sourceImageAnalysisWarning ? (
            <p className="mt-2 whitespace-normal text-xs font-semibold leading-relaxed text-[#b45309]" role="status">{sourceImageAnalysisWarning}</p>
          ) : null}
        </div>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.extractDouyinFrames === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ extractDouyinFrames: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.extractDouyinFrames ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.extractDouyinFrames ? '已开启' : '已关闭'}</span>
          <span>抖音视频抽帧</span>
        </label>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.generateAudio !== false}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ generateAudio: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.generateAudio !== false ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.generateAudio !== false ? '已开启' : '已关闭'}</span>
          <span>生成旁白音频</span>
        </label>

        <div className="rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 md:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3 max-[720px]:flex-col max-[720px]:items-start">
            <div>
              <span className="text-[13px] font-semibold text-[#30343b]">默认旁白音色</span>
              <p className="mt-1 text-xs font-normal leading-relaxed text-[#69717e]">
                首版支持小米 MiMo 内置音色；重新生成旁白会使用最近保存的默认音色。
              </p>
            </div>
            <button
              type="button"
              className="min-h-8 rounded-lg border border-[#d9dde5] bg-white px-3 text-xs font-bold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
              disabled={disabled || previewing || creativeDefaults.generateAudio === false || !mimoTtsActive}
              onClick={previewTtsVoice}
            >
              {previewing ? '正在试听...' : '试听音色'}
            </button>
          </div>
          <select
            value={creativeDefaults.ttsVoice || DEFAULT_TTS_VOICE}
            disabled={disabled || creativeDefaults.generateAudio === false}
            onChange={event => updateCreativeDefaults({ ttsVoice: event.target.value })}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {voiceOptions.map(voice => (
              <option key={voice.id} value={voice.id}>{voice.label}</option>
            ))}
          </select>
          {!mimoTtsActive ? (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-[#b45309]">
              当前未启用 MiMo TTS，音色选择会保存，但试听和实际生效需要切换到 MiMo TTS。
            </p>
          ) : null}
          {previewStatus ? (
            <p
              className={cn(
                'mt-2 text-xs font-semibold leading-relaxed',
                previewStatus.type === 'error' ? 'text-red-600' : previewStatus.type === 'success' ? 'text-emerald-700' : 'text-[#69717e]',
              )}
              role="status"
            >
              {previewStatus.message}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
          <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-[#30343b]">
            <Switch
              checked={creativeDefaults.autoSfxEnabled !== false}
              disabled={disabled}
              onChange={event => updateCreativeDefaults({ autoSfxEnabled: event.target.checked })}
            />
            <span className={cn('min-w-[42px]', creativeDefaults.autoSfxEnabled !== false ? 'text-[#111827]' : 'text-[#69717e]')}>
              {creativeDefaults.autoSfxEnabled !== false ? '已开启' : '已关闭'}
            </span>
            <span>自动音效增强</span>
          </label>
          <p className="mt-2 whitespace-normal text-xs font-normal leading-relaxed text-[#69717e]">
            生成视频时自动为文字入场、重点提示、转场、打字效果和结论强调添加短音效。关闭旁白音频后不会添加自动音效，开启后可能会略微增加生成时间。
          </p>
        </div>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.emotionalVoice === true}
            disabled={disabled || creativeDefaults.generateAudio === false}
            onChange={event => updateCreativeDefaults({ emotionalVoice: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.emotionalVoice ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.emotionalVoice ? '已开启' : '已关闭'}</span>
          <span>情绪化配音</span>
        </label>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.generateCaptions !== false}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ generateCaptions: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.generateCaptions !== false ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.generateCaptions !== false ? '已开启' : '已关闭'}</span>
          <span>生成字幕</span>
        </label>
      </div>
    </section>
  );
}
