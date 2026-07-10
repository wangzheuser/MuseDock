import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { api } from '@/api/client.js';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { normalizeCreativeDefaults } from '@/lib/creativeDefaultsOptions.js';
import { cn } from '@/lib/utils.js';

const GUIDANCE_DRAFT_STORAGE_KEY = 'musedock.creative.guidanceDraft.v1';
const AI_DECIDE_OPTION_ID = '__ai_decide__';

/**
 * 返回引导接口需要的创作设置，避免提交无关 UI 状态。
 * @param {object} creativeDefaults 本次创作设置。
 * @returns {object} 精简设置。
 */
function guidanceSettings(creativeDefaults = {}) {
  const defaults = normalizeCreativeDefaults(creativeDefaults);
  const aspectRatio = defaults.aspectRatio;
  return {
    aspectRatio,
    targetDurationSec: defaults.targetDurationSec,
    useResearch: defaults.useResearch !== false,
    templateId: defaults.templateByAspectRatio?.[aspectRatio] || '',
  };
}

/**
 * 生成影响创作内容的设置指纹。
 * @param {object} creativeDefaults 本次创作设置。
 * @returns {string} 稳定指纹。
 */
export function creativeGuidanceSettingsSignature(creativeDefaults = {}) {
  return JSON.stringify(guidanceSettings(creativeDefaults));
}

/**
 * 读取当前输入对应的浏览器引导草稿。
 * @param {string} input 当前输入。
 * @param {string} settingsSignature 设置指纹。
 * @returns {object|null} 可恢复草稿。
 */
function loadGuidanceDraft(input, settingsSignature) {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(GUIDANCE_DRAFT_STORAGE_KEY) || 'null');
    if (value?.baseInput !== input || value?.settingsSignature !== settingsSignature || !value?.analysis) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * 保存未完成的创作引导，避免关闭弹窗后丢失回答。
 * @param {object|null} draft 草稿；空值表示删除。
 */
function saveGuidanceDraft(draft) {
  if (typeof window === 'undefined') return;
  try {
    if (!draft) {
      window.localStorage.removeItem(GUIDANCE_DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(GUIDANCE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // 浏览器禁用本地存储时只放弃草稿恢复，不影响当前引导流程。
  }
}

/**
 * 从接口错误中提取可操作的中文信息。
 * @param {unknown} error 请求错误。
 * @param {string} fallback 默认信息。
 * @returns {string} 错误信息。
 */
function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

/**
 * 返回指定问题的回答对象。
 * @param {object} answers 全部回答。
 * @param {string} questionId 问题 ID。
 * @returns {{selected:Array<string>,custom:string}} 当前回答。
 */
function getAnswer(answers, questionId) {
  const value = answers?.[questionId];
  return value && typeof value === 'object'
    ? {
      selected: Array.isArray(value.selected) ? value.selected : [],
      custom: typeof value.custom === 'string' ? value.custom : '',
    }
    : { selected: [], custom: '' };
}

/**
 * 引导生成创作方案并把最终提示词交还给主输入框。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 创作引导弹窗。
 */
export function CreativeGuidanceDialog({
  open,
  onOpenChange,
  input,
  creativeDefaults,
  onApply,
}) {
  const requestSequenceRef = useRef(0);
  const openedKeyRef = useRef('');
  const [phase, setPhase] = useState('idle');
  const [analysis, setAnalysis] = useState(null);
  const [answers, setAnswers] = useState({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [failedAction, setFailedAction] = useState('');
  const [expandedQuestions, setExpandedQuestions] = useState({});
  const [customQuestions, setCustomQuestions] = useState({});
  const [selectionMessage, setSelectionMessage] = useState('');
  const settings = useMemo(() => guidanceSettings(creativeDefaults), [creativeDefaults]);
  const settingsSignature = useMemo(
    () => creativeGuidanceSettingsSignature(creativeDefaults),
    [creativeDefaults],
  );
  const questions = Array.isArray(analysis?.questions) ? analysis.questions : [];
  const currentQuestion = questions[questionIndex] || null;
  const currentAnswer = currentQuestion ? getAnswer(answers, currentQuestion.id) : { selected: [], custom: '' };

  useEffect(() => {
    if (!open) {
      requestSequenceRef.current += 1;
      openedKeyRef.current = '';
      return;
    }
    const openedKey = `${input}\n${settingsSignature}`;
    if (openedKeyRef.current === openedKey) return;
    openedKeyRef.current = openedKey;
    const restored = loadGuidanceDraft(input, settingsSignature);
    if (restored) {
      setAnalysis(restored.analysis);
      setAnswers(restored.answers || {});
      setQuestionIndex(Math.min(Number(restored.questionIndex) || 0, Math.max(0, restored.analysis.questions?.length - 1)));
      setResult(null);
      setErrorMessage('');
      setFailedAction('');
      setPhase('questions');
      return;
    }

    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setPhase('analyzing');
    setAnalysis(null);
    setAnswers({});
    setQuestionIndex(0);
    setResult(null);
    setErrorMessage('');
    setFailedAction('');
    api.analyzeCreativeGuidance({ input, creativeSettings: settings })
      .then(json => {
        if (requestSequenceRef.current !== sequence) return;
        const nextAnalysis = json?.analysis;
        if (!nextAnalysis || !Array.isArray(nextAnalysis.questions) || nextAnalysis.questions.length === 0) {
          throw new Error('没有生成可用的创作引导问题，请重试。');
        }
        setAnalysis(nextAnalysis);
        setPhase('questions');
      })
      .catch(error => {
        if (requestSequenceRef.current !== sequence) return;
        setErrorMessage(getErrorMessage(error, '分析创作方向失败，请稍后重试。'));
        setFailedAction('analyze');
        setPhase('error');
      });
  }, [open, input, settings, settingsSignature]);

  useEffect(() => {
    if (!open || phase !== 'questions' || !analysis) return;
    saveGuidanceDraft({
      baseInput: input,
      settingsSignature,
      analysis,
      answers,
      questionIndex,
      updatedAt: new Date().toISOString(),
    });
  }, [open, phase, input, settingsSignature, analysis, answers, questionIndex]);

  /**
   * 合并当前问题回答。
   * @param {string} questionId 问题 ID。
   * @param {object} nextAnswer 新回答。
   */
  function updateAnswer(questionId, nextAnswer) {
    setAnswers(previous => ({ ...previous, [questionId]: nextAnswer }));
    setSelectionMessage('');
  }

  /**
   * 选择或取消一个预设项。
   * @param {object} question 当前问题。
   * @param {string} optionId 选项 ID。
   */
  function selectOption(question, optionId) {
    const answer = getAnswer(answers, question.id);
    if (question.type !== 'multi') {
      updateAnswer(question.id, { selected: [optionId], custom: '' });
      setCustomQuestions(previous => ({ ...previous, [question.id]: false }));
      return;
    }
    const withoutAi = answer.selected.filter(id => id !== AI_DECIDE_OPTION_ID);
    const selected = withoutAi.includes(optionId)
      ? withoutAi.filter(id => id !== optionId)
      : [...withoutAi, optionId];
    if (selected.length > (Number(question.max_selections) || 3)) {
      setSelectionMessage(`最多选择 ${Number(question.max_selections) || 3} 个重点，也可以在自定义要求中补充。`);
      return;
    }
    updateAnswer(question.id, { selected, custom: answer.custom });
  }

  /**
   * 将当前问题交给 AI 决定。
   * @param {object} question 当前问题。
   */
  function selectAiDecision(question) {
    updateAnswer(question.id, { selected: [AI_DECIDE_OPTION_ID], custom: '' });
    setCustomQuestions(previous => ({ ...previous, [question.id]: false }));
  }

  /**
   * 展开当前问题的自定义输入。
   * @param {object} question 当前问题。
   */
  function openCustomAnswer(question) {
    const answer = getAnswer(answers, question.id);
    if (question.type !== 'multi') {
      updateAnswer(question.id, { selected: [], custom: answer.custom });
    }
    setCustomQuestions(previous => ({ ...previous, [question.id]: true }));
  }

  /**
   * 生成最终提示词。
   */
  async function composePrompt() {
    if (!analysis || phase === 'composing') return;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setPhase('composing');
    setErrorMessage('');
    setFailedAction('');
    try {
      const json = await api.composeCreativeGuidance({
        input,
        analysis,
        answers,
        creativeSettings: settings,
      });
      if (requestSequenceRef.current !== sequence) return;
      if (!json?.final_prompt) throw new Error('生成结果缺少完整提示词，请重试。');
      setResult(json);
      setPhase('preview');
    } catch (error) {
      if (requestSequenceRef.current !== sequence) return;
      setErrorMessage(getErrorMessage(error, '生成创作提示词失败，请稍后重试。'));
      setFailedAction('compose');
      setPhase('error');
    }
  }

  /**
   * 前进到下一题，最后一题直接生成提示词。
   */
  function continueGuidance() {
    if (questionIndex < questions.length - 1) {
      setQuestionIndex(index => index + 1);
      setSelectionMessage('');
      return;
    }
    composePrompt();
  }

  /**
   * 跳过当前问题并继续。
   */
  function skipQuestion() {
    if (!currentQuestion) return;
    updateAnswer(currentQuestion.id, { selected: [], custom: '' });
    continueGuidance();
  }

  /**
   * 把完整提示词和可见推荐设置交回创作输入框。
   */
  function applyPrompt() {
    if (!result?.final_prompt) return;
    onApply?.(result.final_prompt, result.recommended_overrides || {}, {
      generatedPrompt: result.final_prompt,
      researchQuery: result.research_query || '',
      analysis: result.analysis || analysis,
    });
    saveGuidanceDraft(null);
    onOpenChange?.(false);
  }

  /**
   * 重试最近失败的分析或提示词生成。
   */
  function retryFailedAction() {
    if (failedAction === 'compose') {
      composePrompt();
      return;
    }
    openedKeyRef.current = '';
    onOpenChange?.(false);
    window.setTimeout(() => onOpenChange?.(true), 0);
  }

  const visibleOptions = currentQuestion
    ? (expandedQuestions[currentQuestion.id]
      ? currentQuestion.options
      : currentQuestion.options.slice(0, 6))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid max-h-[min(90vh,820px)] w-[min(94vw,760px)] max-w-[760px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[20px] border border-[#dfe5ee] bg-[#fbfcfe] p-0 shadow-[0_30px_90px_rgba(15,23,42,.28)]"
        showCloseButton={false}
      >
        <DialogHeader className="border-b border-[#e8edf4] bg-white px-6 py-5 pr-16">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-[#111827]">
            <span className="grid size-8 place-items-center rounded-xl bg-[#e8f0ff] text-[#2563eb]">
              <WandSparkles size={17} />
            </span>
            生成创作方案
          </DialogTitle>
          <DialogDescription className="leading-relaxed text-[#667085]">
            回答少量问题，把当前想法整理成完整提示词；不会在此阶段创建视频。
          </DialogDescription>
        </DialogHeader>

        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="absolute right-5 top-5 rounded-full text-[#667085] hover:bg-[#f1f5f9]"
            aria-label="关闭创作引导"
          >
            <X size={16} />
          </Button>
        </DialogClose>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          {phase === 'analyzing' ? (
            <div className="grid min-h-[360px] place-items-center text-center" aria-live="polite">
              <div className="grid max-w-[420px] justify-items-center gap-4">
                <span className="grid size-14 place-items-center rounded-2xl bg-[#eaf1ff] text-[#2563eb]">
                  <Loader2 size={26} className="animate-spin" />
                </span>
                <div className="grid gap-1.5">
                  <strong className="text-base text-[#111827]">正在理解你的创作想法...</strong>
                  <span className="text-sm leading-relaxed text-[#667085]">正在判断内容场景、信息完整度和最值得补充的问题。</span>
                </div>
              </div>
            </div>
          ) : null}

          {phase === 'questions' && currentQuestion ? (
            <div className="grid gap-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded-full bg-[#eaf1ff] px-2.5 py-1 text-xs font-bold text-[#2563eb]">
                    {analysis.scenario_label || '创作引导'}
                  </span>
                  <span className="truncate text-xs text-[#7b8492]">{analysis.summary}</span>
                </div>
                <span className="shrink-0 text-xs font-semibold text-[#7b8492]">{questionIndex + 1} / {questions.length}</span>
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-[#e9edf3]" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-[#2563eb] transition-[width] duration-300"
                  style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }}
                />
              </div>

              <div className="grid gap-1.5">
                <h2 className="m-0 text-[21px] font-bold leading-tight text-[#111827]">{currentQuestion.title}</h2>
                <p className="m-0 text-sm leading-relaxed text-[#667085]">{currentQuestion.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 max-[640px]:grid-cols-1">
                {visibleOptions.map(item => {
                  const selected = currentAnswer.selected.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        'group relative grid min-h-[68px] content-center gap-1 rounded-[14px] border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40',
                        selected
                          ? 'border-[#2563eb] bg-[#edf4ff] shadow-[inset_0_0_0_1px_#2563eb]'
                          : 'border-[#dfe5ed] bg-white hover:border-[#b8c8df] hover:bg-[#f8fafc]',
                      )}
                      onClick={() => selectOption(currentQuestion, item.id)}
                    >
                      <span className="flex items-center gap-2 text-sm font-bold text-[#202632]">
                        {selected ? <Check size={14} className="text-[#2563eb]" /> : null}
                        {item.label}
                        {item.recommended ? (
                          <span className="rounded-full bg-[#dce9ff] px-1.5 py-0.5 text-[10px] font-bold text-[#1d4ed8]">推荐</span>
                        ) : null}
                      </span>
                      {item.description ? <span className="text-xs leading-relaxed text-[#747e8d]">{item.description}</span> : null}
                    </button>
                  );
                })}

                {currentQuestion.allow_ai_decide ? (
                  <button
                    type="button"
                    aria-pressed={currentAnswer.selected.includes(AI_DECIDE_OPTION_ID)}
                    className={cn(
                      'grid min-h-[68px] content-center gap-1 rounded-[14px] border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40',
                      currentAnswer.selected.includes(AI_DECIDE_OPTION_ID)
                        ? 'border-[#2563eb] bg-[#edf4ff] shadow-[inset_0_0_0_1px_#2563eb]'
                        : 'border-dashed border-[#b9c7da] bg-[#f8fafc] hover:border-[#7f9bc1]',
                    )}
                    onClick={() => selectAiDecision(currentQuestion)}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-[#30415a]"><Sparkles size={14} />交给 AI 决定</span>
                    <span className="text-xs leading-relaxed text-[#747e8d]">根据主题和平台自动选择最合适的答案。</span>
                  </button>
                ) : null}

                {currentQuestion.allow_custom ? (
                  <button
                    type="button"
                    aria-pressed={customQuestions[currentQuestion.id] === true}
                    className={cn(
                      'grid min-h-[68px] content-center gap-1 rounded-[14px] border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40',
                      customQuestions[currentQuestion.id]
                        ? 'border-[#2563eb] bg-[#edf4ff] shadow-[inset_0_0_0_1px_#2563eb]'
                        : 'border-dashed border-[#b9c7da] bg-white hover:border-[#7f9bc1]',
                    )}
                    onClick={() => openCustomAnswer(currentQuestion)}
                  >
                    <span className="text-sm font-bold text-[#30415a]">自定义要求</span>
                    <span className="text-xs leading-relaxed text-[#747e8d]">以上都不合适时，完整写出你自己的要求。</span>
                  </button>
                ) : null}
              </div>

              {currentQuestion.options.length > 6 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit gap-1.5 px-2 text-[#526174]"
                  onClick={() => setExpandedQuestions(previous => ({
                    ...previous,
                    [currentQuestion.id]: !previous[currentQuestion.id],
                  }))}
                >
                  <ChevronDown
                    size={14}
                    className={cn('transition-transform', expandedQuestions[currentQuestion.id] && 'rotate-180')}
                  />
                  {expandedQuestions[currentQuestion.id]
                    ? '收起更多选项'
                    : `查看更多选项（${currentQuestion.options.length - 6}）`}
                </Button>
              ) : null}

              {customQuestions[currentQuestion.id] ? (
                <label className="grid gap-1.5 rounded-[14px] border border-[#c7d6eb] bg-white p-3.5">
                  <span className="text-xs font-bold text-[#526174]">自定义内容</span>
                  <Textarea
                    value={currentAnswer.custom}
                    className="min-h-[92px] resize-y border-[#d8e0eb] text-sm leading-relaxed focus-visible:ring-[#2563eb]/20"
                    placeholder="例如：重点说明 API 价格变化，并比较上一版本的实际使用体验。"
                    maxLength={1000}
                    onChange={event => updateAnswer(currentQuestion.id, {
                      selected: currentQuestion.type === 'multi' ? currentAnswer.selected : [],
                      custom: event.target.value,
                    })}
                  />
                  <span className="text-right text-[11px] text-[#98a1ae]">{currentAnswer.custom.length} / 1000</span>
                </label>
              ) : null}

              {selectionMessage ? <p className="m-0 text-xs font-semibold text-[#b45309]" role="status">{selectionMessage}</p> : null}
              {analysis.warnings?.length ? (
                <div className="flex gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{analysis.warnings[0]}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === 'composing' ? (
            <div className="grid min-h-[360px] place-items-center text-center" aria-live="polite">
              <div className="grid max-w-[440px] justify-items-center gap-4">
                <span className="grid size-14 place-items-center rounded-2xl bg-[#eaf1ff] text-[#2563eb]">
                  <Loader2 size={26} className="animate-spin" />
                </span>
                <div className="grid gap-1.5">
                  <strong className="text-base text-[#111827]">正在整理完整创作提示词...</strong>
                  <span className="text-sm leading-relaxed text-[#667085]">正在合并原始想法、你的选择、事实要求和内容结构。</span>
                </div>
              </div>
            </div>
          ) : null}

          {phase === 'preview' && result ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#e7f7ee] px-2.5 py-1 text-xs font-bold text-[#16784b]">创作方案已准备好</span>
                <span className="rounded-full border border-[#dce4ef] bg-white px-2.5 py-1 text-xs font-semibold text-[#526174]">
                  {result.analysis?.scenario_label || analysis?.scenario_label || '创作方案'}
                </span>
                <span className="rounded-full border border-[#dce4ef] bg-white px-2.5 py-1 text-xs font-semibold text-[#526174]">
                  建议 {result.recommended_overrides?.targetDurationSec || analysis?.recommended_duration_sec || settings.targetDurationSec} 秒
                </span>
                <span className="rounded-full border border-[#dce4ef] bg-white px-2.5 py-1 text-xs font-semibold text-[#526174]">
                  联网研究：{result.recommended_overrides?.useResearch === false ? '关闭' : '开启'}
                </span>
              </div>

              {result.research_query ? (
                <div className="rounded-[12px] border border-[#dce5f2] bg-[#f5f8fc] px-3 py-2 text-xs leading-relaxed text-[#526174]">
                  <strong className="text-[#30415a]">建议检索：</strong>{result.research_query}
                </div>
              ) : null}

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="m-0 text-lg font-bold text-[#111827]">最终创作提示词</h2>
                  <span className="text-xs text-[#7b8492]">应用后可在主输入框继续修改</span>
                </div>
                <Textarea
                  readOnly
                  value={result.final_prompt}
                  className="min-h-[320px] resize-none border-[#d8e1ec] bg-white p-4 text-sm leading-[1.75] text-[#202632] shadow-inner focus-visible:ring-0"
                />
              </div>

              {result.assumptions?.length ? (
                <div className="rounded-[12px] border border-[#dce5f2] bg-[#f5f8fc] px-3.5 py-3 text-xs leading-relaxed text-[#526174]">
                  <strong className="mb-1 block text-[#30415a]">AI 采用的默认判断</strong>
                  {result.assumptions.join('；')}
                </div>
              ) : null}
              {result.warnings?.length ? (
                <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
                  <strong className="mb-1 block">生成前提醒</strong>
                  {result.warnings.join('；')}
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="grid min-h-[360px] place-items-center text-center" role="alert">
              <div className="grid max-w-[460px] justify-items-center gap-4">
                <span className="grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600">
                  <AlertTriangle size={25} />
                </span>
                <div className="grid gap-1.5">
                  <strong className="text-base text-[#111827]">创作引导暂时没有完成</strong>
                  <span className="text-sm leading-relaxed text-[#667085]">{errorMessage}</span>
                </div>
                <Button type="button" onClick={retryFailedAction}>重新尝试</Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-[#e8edf4] bg-white px-6 py-4 sm:justify-between">
          {phase === 'questions' ? (
            <>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={questionIndex === 0}
                  onClick={() => {
                    setQuestionIndex(index => Math.max(0, index - 1));
                    setSelectionMessage('');
                  }}
                >
                  <ArrowLeft size={15} />
                  上一步
                </Button>
                {currentQuestion?.allow_skip ? (
                  <Button type="button" variant="ghost" className="text-[#667085]" onClick={skipQuestion}>跳过</Button>
                ) : null}
              </div>
              <Button type="button" onClick={continueGuidance}>
                {questionIndex === questions.length - 1 ? <Sparkles size={15} /> : null}
                {questionIndex === questions.length - 1 ? '生成最终提示词' : '下一步'}
                {questionIndex < questions.length - 1 ? <ArrowRight size={15} /> : null}
              </Button>
            </>
          ) : null}

          {phase === 'preview' ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setPhase('questions')}>
                <ArrowLeft size={15} />
                修改回答
              </Button>
              <Button type="button" className="bg-[#2563eb] hover:bg-[#1d4ed8]" onClick={applyPrompt}>
                <Check size={15} />
                应用到输入框
              </Button>
            </>
          ) : null}

          {['analyzing', 'composing', 'error'].includes(phase) ? (
            <span className="text-xs text-[#7b8492]">关闭后仍可直接使用当前提示词一键生成视频。</span>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
