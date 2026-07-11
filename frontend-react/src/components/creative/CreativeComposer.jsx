import { useMemo, useState } from 'react';
import { ArrowUp, ChevronDown, Globe2, Loader2, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import {
  ASPECT_RATIOS,
  CREATIVE_FPS_OPTIONS,
  DEFAULT_TTS_VOICE,
  getTemplateDisplayName,
  getTemplateId,
  hasBlockingCompatibilityReason,
  isTemplateShownForAspect,
  normalizeCreativeDefaults,
  normalizeTtsVoiceOptions,
  optionLabel,
} from '@/lib/creativeDefaultsOptions.js';
import { cn } from '@/lib/utils.js';
import { Switch } from '../settings/Switch.jsx';
import {
  CreativeGuidanceDialog,
  creativeGuidanceSettingsSignature,
} from './CreativeGuidanceDialog.jsx';

const FIELD_CLASS = 'h-[34px] w-full rounded-xl border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * 返回当前可用的文本模型是否支持多模态输入。
 * @param {object} activeModels 当前激活模型配置。
 * @returns {boolean} 是否可用。
 */
function canUseSourceImageAnalysis(activeModels = {}) {
  const textModel = activeModels?.text || null;
  return textModel?.enabled === true
    && Boolean(textModel?.modelId)
    && textModel?.supportsMultimodal === true;
}

/**
 * 生成指定画幅可选模板列表。
 * @param {Array<object>} templates 模板列表。
 * @param {string} aspectRatio 当前画幅。
 * @returns {Array<object>} 可展示模板。
 */
function getAspectTemplates(templates, aspectRatio) {
  const safeTemplates = Array.isArray(templates) ? templates : [];
  return safeTemplates.filter(template => (
    getTemplateId(template) && isTemplateShownForAspect(template, aspectRatio)
  ));
}

/**
 * 根据模板 ID 查找展示名。
 * @param {Array<object>} templates 模板列表。
 * @param {string} templateId 模板 ID。
 * @returns {string} 模板展示名。
 */
function getSelectedTemplateLabel(templates, templateId) {
  const id = String(templateId || '').trim();
  if (!id) return '不指定模板';
  const matched = (Array.isArray(templates) ? templates : [])
    .find(template => getTemplateId(template) === id);
  return matched ? getTemplateDisplayName(matched) : id;
}

/**
 * 根据音色 ID 查找展示名。
 * @param {Array<{id: string, label: string}>} voices 音色列表。
 * @param {string} voiceId 音色 ID。
 * @returns {string} 音色展示名。
 */
function getVoiceLabel(voices, voiceId) {
  const id = String(voiceId || DEFAULT_TTS_VOICE).trim() || DEFAULT_TTS_VOICE;
  return voices.find(voice => voice.id === id)?.label || id;
}

/**
 * 单个折叠面板开关项。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 开关行。
 */
function SettingSwitchRow({ label, description, checked, disabled, onChange, warning }) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      warning ? 'border-amber-200 bg-amber-50' : 'border-[#eef1f6] bg-white',
    )}
    >
      <label className="inline-flex min-h-6 cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-[#30343b]">
        <Switch
          small
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        <span className={cn('min-w-[42px]', checked ? 'text-[#111827]' : 'text-[#69717e]')}>{checked ? '已开启' : '已关闭'}</span>
        <span>{label}</span>
      </label>
      {description ? (
        <p className="mt-1.5 text-xs leading-relaxed text-[#69717e]">{description}</p>
      ) : null}
      {warning ? (
        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-[#b45309]" role="status">{warning}</p>
      ) : null}
    </div>
  );
}

/**
 * 本次创作设置折叠面板。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 折叠设置面板。
 */
function CreativeRunSettingsPanel({
  creativeDefaults,
  onChange,
  templates,
  ttsVoices,
  activeModels,
  isBusy,
}) {
  const [open, setOpen] = useState(false);
  const defaults = useMemo(() => normalizeCreativeDefaults(creativeDefaults), [creativeDefaults]);
  const voiceOptions = useMemo(() => normalizeTtsVoiceOptions(ttsVoices), [ttsVoices]);
  const sourceImageAnalysisReady = canUseSourceImageAnalysis(activeModels);
  const sourceImageAnalysisEnabled = defaults.sourceImageAnalysisEnabled === true;
  const currentAspectRatio = defaults.aspectRatio || '9:16';
  const playbackSpeedText = String(defaults.playbackSpeed ?? '').trim();
  const playbackSpeedInvalid = !/^\d+(\.\d)?$/.test(playbackSpeedText)
    || Number(playbackSpeedText) < 0.1
    || Number(playbackSpeedText) > 2;
  const templateId = defaults.templateByAspectRatio?.[currentAspectRatio] || '';
  const aspectTemplates = useMemo(
    () => getAspectTemplates(templates, currentAspectRatio),
    [templates, currentAspectRatio],
  );
  const summaryItems = [
    { label: '画幅', value: currentAspectRatio },
    { label: '时长', value: `${defaults.targetDurationSec || 60}s` },
    { label: '帧率', value: `${defaults.fps || 30} FPS` },
    { label: '导出', value: `${playbackSpeedInvalid ? '1.0' : Number(playbackSpeedText).toFixed(1)}x` },
    { label: '模板', value: getSelectedTemplateLabel(templates, templateId) },
    { label: '旁白音色', value: getVoiceLabel(voiceOptions, defaults.ttsVoice) },
    { label: '联网', value: defaults.useResearch !== false ? '开启' : '关闭' },
  ];

  /**
   * 合并本次创作设置草稿。
   * @param {object} patch 变更字段。
   */
  function updateDefaults(patch) {
    if (typeof onChange !== 'function') return;
    onChange(patch);
  }

  /**
   * 更新当前画幅对应模板。
   * @param {string} nextTemplateId 模板 ID。
   */
  function updateCurrentTemplate(nextTemplateId) {
    updateDefaults({
      templateByAspectRatio: {
        ...defaults.templateByAspectRatio,
        [currentAspectRatio]: typeof nextTemplateId === 'string' ? nextTemplateId : '',
      },
    });
  }

  return (
    <div className="rounded-[16px] border border-[#edf0f5] bg-[#f8fafc]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isBusy}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-bold text-[#111827]">
          <SlidersHorizontal size={15} />
          本次创作设置
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
          {summaryItems.map(item => (
            <span
              key={item.label}
              className="rounded-full border border-[#e2e8f0] bg-white px-2 py-1 text-[11px] font-semibold text-[#64748b]"
            >
              {item.label}：{item.value}
            </span>
          ))}
        </span>
        <ChevronDown
          size={16}
          className={cn('flex-none text-[#64748b] transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-[#edf0f5] px-3 py-3">
          <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">画幅</span>
              <select
                value={currentAspectRatio}
                disabled={isBusy}
                onChange={event => updateDefaults({ aspectRatio: event.target.value })}
                className={FIELD_CLASS}
              >
                {ASPECT_RATIOS.map(aspectRatio => (
                  <option key={aspectRatio} value={aspectRatio}>{aspectRatio}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">目标时长（秒）</span>
              <input
                type="number"
                min="15"
                max="180"
                step="1"
                value={defaults.targetDurationSec}
                disabled={isBusy}
                className={FIELD_CLASS}
                onChange={event => updateDefaults({
                  targetDurationSec: event.target.value === '' ? '' : Number(event.target.value),
                })}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">生成帧率</span>
              <select
                value={defaults.fps || 30}
                disabled={isBusy}
                onChange={event => updateDefaults({ fps: Number(event.target.value) })}
                className={FIELD_CLASS}
              >
                {CREATIVE_FPS_OPTIONS.map(fps => (
                  <option key={fps} value={fps}>{fps === 60 ? '60 FPS（高动态，渲染更慢）' : '30 FPS（通用）'}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">默认导出倍速</span>
              <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
                <input
                  type="number"
                  min="0.1"
                  max="2.0"
                  step="0.1"
                  required
                  value={defaults.playbackSpeed}
                  disabled={isBusy}
                  aria-invalid={playbackSpeedInvalid}
                  aria-describedby="creative-playback-speed-help"
                  className={FIELD_CLASS}
                  onChange={event => updateDefaults({
                    playbackSpeed: event.target.value === '' ? '' : Number(event.target.value),
                  })}
                />
                <span className="text-xs font-semibold text-[#5f6876]">x</span>
              </span>
              <span id="creative-playback-speed-help" className={cn('text-[11px] leading-relaxed', playbackSpeedInvalid ? 'font-semibold text-red-600' : 'text-[#7b8492]')}>
                {playbackSpeedInvalid ? '请输入 0.1 到 2.0 之间、最多一位小数的导出倍速。' : '1.0 为原速，仅影响最终导出。'}
              </span>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">当前画幅模板</span>
              <select
                value={templateId}
                disabled={isBusy}
                onChange={event => updateCurrentTemplate(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">不指定模板</option>
                {aspectTemplates.map(template => (
                  <option
                    key={`${currentAspectRatio}-${getTemplateId(template)}`}
                    value={getTemplateId(template)}
                    disabled={!isTemplateShownForAspect(template, currentAspectRatio) || hasBlockingCompatibilityReason(template)}
                  >
                    {optionLabel(template, currentAspectRatio)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">旁白音色</span>
              <select
                value={defaults.ttsVoice || DEFAULT_TTS_VOICE}
                disabled={isBusy || defaults.generateAudio === false}
                onChange={event => updateDefaults({ ttsVoice: event.target.value })}
                className={FIELD_CLASS}
              >
                {voiceOptions.map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">帧 HTML 并发</span>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={defaults.frameHtmlConcurrency}
                disabled={isBusy}
                className={FIELD_CLASS}
                onChange={event => updateDefaults({
                  frameHtmlConcurrency: event.target.value === '' ? '' : Number(event.target.value),
                })}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <SettingSwitchRow
              label="联网研究"
              checked={defaults.useResearch !== false}
              disabled={isBusy}
              onChange={checked => updateDefaults({ useResearch: checked })}
              description="开启后会结合最新资料生成脚本和画面方向。"
            />
            <SettingSwitchRow
              label="生成旁白"
              checked={defaults.generateAudio !== false}
              disabled={isBusy}
              onChange={checked => updateDefaults({ generateAudio: checked })}
              description="关闭后会跳过 TTS 配音，旁白音色和情绪化配音不会生效。"
            />
            <SettingSwitchRow
              label="锁定模板"
              checked={defaults.lockTemplate === true}
              disabled={isBusy}
              onChange={checked => updateDefaults({ lockTemplate: checked })}
              description="开启后优先使用当前画幅模板，不由工作流自动替换。"
            />
            <SettingSwitchRow
              label="情绪化配音"
              checked={defaults.emotionalVoice === true}
              disabled={isBusy || defaults.generateAudio === false}
              onChange={checked => updateDefaults({ emotionalVoice: checked })}
              description="开启后会向支持的 TTS 模型传入更明确的语气、停顿和情绪提示。"
            />
            <SettingSwitchRow
              label="自动音效"
              checked={defaults.autoSfxEnabled !== false}
              disabled={isBusy}
              onChange={checked => updateDefaults({ autoSfxEnabled: checked })}
              description={defaults.generateAudio === false
                ? '可保留本次选择，但关闭旁白音频后实际不会添加自动音效。'
                : '为文字入场、重点提示、转场和结论强调添加短音效。'}
            />
            <SettingSwitchRow
              label="生成字幕"
              checked={defaults.generateCaptions !== false}
              disabled={isBusy}
              onChange={checked => updateDefaults({ generateCaptions: checked })}
              description="开启后根据旁白和分镜生成字幕轨。"
            />
            <SettingSwitchRow
              label="来源图片多模态分析"
              checked={sourceImageAnalysisEnabled}
              disabled={isBusy || (!sourceImageAnalysisEnabled && !sourceImageAnalysisReady)}
              onChange={checked => updateDefaults({ sourceImageAnalysisEnabled: checked })}
              description="开启后会让支持图片输入的分析模型理解来源图片。"
              warning={!sourceImageAnalysisReady
                ? '当前分析模型未标记为支持多模态输入，无法开启来源图片多模态分析。'
                : ''}
            />
            <SettingSwitchRow
              label="抖音视频抽帧"
              checked={defaults.extractDouyinFrames === true}
              disabled={isBusy}
              onChange={checked => updateDefaults({ extractDouyinFrames: checked })}
              description="输入抖音链接时尝试抽取关键帧作为视觉参考。"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreativeHeroHeader() {
  return (
    <div className="grid w-full max-w-[776px] justify-items-center gap-3">
      <div className="inline-flex items-center gap-2.5 text-[#111827]">
        <h1 className="m-0 text-2xl font-bold leading-tight tracking-normal text-[#111827]">嘿，今天我们来做点什么？</h1>
      </div>
    </div>
  );
}

function CreativePromptComposer({
  input,
  setInput,
  setUseResearch,
  isBusy,
  submitDisabled,
  onSubmit,
  creativeDefaults,
  onCreativeDefaultsChange,
  templates,
  ttsVoices,
  activeModels,
  guidedPromptMeta,
  onApplyGuidedPrompt,
}) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const defaults = useMemo(() => normalizeCreativeDefaults(creativeDefaults), [creativeDefaults]);
  const researchEnabled = defaults.useResearch !== false;
  const currentGuidanceSettingsSignature = creativeGuidanceSettingsSignature(defaults);
  const guidedPromptEdited = Boolean(guidedPromptMeta?.generatedPrompt)
    && input !== guidedPromptMeta.generatedPrompt;
  const guidedPromptSettingsStale = Boolean(guidedPromptMeta?.settingsSignature)
    && guidedPromptMeta.settingsSignature !== currentGuidanceSettingsSignature;

  /**
   * 更新本次创作设置；旧调用方没有传入本次设置回调时回退到联网开关。
   * @param {object} patch 变更字段。
   */
  function updateDefaults(patch) {
    if (typeof onCreativeDefaultsChange === 'function') {
      onCreativeDefaultsChange(patch);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'useResearch') && typeof setUseResearch === 'function') {
      setUseResearch(patch.useResearch);
    }
  }

  /**
   * 将引导生成的完整提示词和推荐设置应用到当前创作。
   * @param {string} finalPrompt 完整提示词。
   * @param {object} recommendedOverrides 推荐设置。
   * @param {object} meta 引导元数据。
   */
  function applyGuidedPrompt(finalPrompt, recommendedOverrides, meta) {
    const nextDefaults = normalizeCreativeDefaults({
      ...defaults,
      ...(recommendedOverrides || {}),
    });
    if (typeof onApplyGuidedPrompt === 'function') {
      onApplyGuidedPrompt(finalPrompt, recommendedOverrides, {
        ...(meta || {}),
        settingsSignature: creativeGuidanceSettingsSignature(nextDefaults),
      });
      return;
    }
    setInput(finalPrompt);
    updateDefaults(recommendedOverrides || {});
  }

  return (
    <form
      className="grid min-h-0 w-[min(100%,776px)] gap-2.5 rounded-[20px] border border-[#dfe3ea] bg-white px-3 pb-2.5 pt-[17px] shadow-[0_16px_38px_rgba(15,23,42,.07)] max-[760px]:w-full"
      onSubmit={onSubmit}
    >
      <label className="sr-only" htmlFor="creative-input">
        输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
      </label>
      <Textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        className="min-h-[92px] max-h-[45vh] resize-y border-0 bg-transparent px-1 py-0 text-base leading-[1.6] text-[#111827] shadow-none placeholder:text-[#a4acb8] focus-visible:ring-0 disabled:text-[#8a93a2]"
        placeholder="粘贴文章/GitHub 链接，或输入你想生成的视频方向"
        rows={4}
      />

      {guidedPromptMeta?.generatedPrompt ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-xs leading-relaxed',
            guidedPromptSettingsStale
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-[#d5e4fb] bg-[#f4f8ff] text-[#345171]',
          )}
          role="status"
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={14} />
            {guidedPromptSettingsStale
              ? '本次创作设置已变化，当前提示词可能与最新时长或画幅不一致。'
              : `完整创作提示词已回填${guidedPromptEdited ? '并经过手动修改' : ''}，可继续编辑后直接生成。`}
          </span>
          {guidedPromptSettingsStale ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 px-2 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
              disabled={isBusy}
              onClick={() => setGuidanceOpen(true)}
            >
              根据最新设置重新优化
            </Button>
          ) : null}
        </div>
      ) : input.trim() && input.trim().length < 40 ? (
        <p className="m-0 px-1 text-xs leading-relaxed text-[#7b8492]">
          当前内容较少，可以先生成创作方案；也可以直接点击右侧按钮一键生成视频。
        </p>
      ) : null}

      <CreativeRunSettingsPanel
        creativeDefaults={defaults}
        onChange={updateDefaults}
        templates={templates}
        ttsVoices={ttsVoices}
        activeModels={activeModels}
        isBusy={isBusy}
      />

      <div className="flex items-center justify-between gap-3 max-[720px]:items-end">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border-[#bed0ea] bg-[#f7faff] px-3 text-[13px] font-bold text-[#24528b] shadow-sm transition hover:-translate-y-px hover:border-[#91aed4] hover:bg-[#edf4ff] hover:text-[#163f73] disabled:cursor-not-allowed disabled:opacity-[.62]"
            variant="outline"
            disabled={isBusy || !input.trim()}
            onClick={() => setGuidanceOpen(true)}
          >
            <WandSparkles size={15} />
            <span>{guidedPromptMeta?.generatedPrompt ? '重新优化创作方案' : '生成创作方案'}</span>
          </Button>
          <Button
            type="button"
            className={cn(
              'inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-[.62]',
              researchEnabled
                ? '-translate-y-px border-[#bcd0ff] bg-[#e6efff] text-[#2563eb] shadow-[inset_0_0_0_1px_#8fb0ff] hover:bg-[#e6efff] hover:text-[#2563eb]'
                : 'border-[#e5e7eb] bg-white text-[#667085] hover:bg-white hover:text-[#667085]',
            )}
            variant="outline"
            disabled={isBusy}
            onClick={() => updateDefaults({ useResearch: !researchEnabled })}
          >
            <Globe2 size={15} />
            <span>联网获取最新资料</span>
          </Button>
        </div>

        <Button
          className="flex-none rounded-full bg-[#2563eb] text-white hover:-translate-y-px hover:bg-[#1d4ed8] disabled:opacity-[.64]"
          size="icon"
          type="submit"
          disabled={submitDisabled}
          aria-label="一键生成视频"
          title="直接使用当前输入框内容一键生成视频"
        >
          {isBusy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} />}
        </Button>
      </div>

      <CreativeGuidanceDialog
        open={guidanceOpen}
        onOpenChange={setGuidanceOpen}
        input={input}
        creativeDefaults={defaults}
        onApply={applyGuidedPrompt}
      />
    </form>
  );
}

function CreativeInputForm(props) {
  return <CreativePromptComposer {...props} />;
}

export function CreativeComposer(props) {
  return (
    <div className="grid w-full justify-items-center gap-[22px]">
      <CreativeHeroHeader />
      <CreativeInputForm {...props} />
    </div>
  );
}
