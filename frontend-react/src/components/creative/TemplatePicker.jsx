import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clapperboard,
  ImageOff,
  Loader2,
  Maximize2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import {
  getTemplateCategoryLabel,
  getTemplateDisplayName,
  getTemplateId,
  hasBlockingCompatibilityReason,
  isTemplateShownForAspect,
} from '@/lib/creativeDefaultsOptions.js';
import { cn } from '@/lib/utils.js';

/**
 * 把 9:16 等画幅转换成 CSS aspect-ratio 可用值。
 * @param {string} aspectRatio 模板画幅。
 * @returns {string} CSS 比例。
 */
function toCssAspectRatio(aspectRatio) {
  const [width, height] = String(aspectRatio || '16:9').split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '16 / 9';
  return `${width} / ${height}`;
}

/**
 * 模板静态封面，加载失败时显示明确占位内容。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 封面节点。
 */
function TemplatePoster({ template, aspectRatio, className }) {
  const [failed, setFailed] = useState(false);
  const posterUrl = String(template?.preview?.poster_url || '');

  useEffect(() => setFailed(false), [posterUrl]);

  return (
    <div
      className={cn('relative grid place-items-center overflow-hidden bg-[#11141b]', className)}
      style={{ aspectRatio: toCssAspectRatio(aspectRatio) }}
    >
      {posterUrl && !failed ? (
        <img
          src={posterUrl}
          alt={`${getTemplateDisplayName(template)}模板封面`}
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="grid justify-items-center gap-1.5 px-3 text-center text-[#8f99aa]">
          <ImageOff size={20} aria-hidden="true" />
          <span className="text-[10px] font-semibold">暂无静态封面</span>
        </div>
      )}
      <span className="absolute bottom-1.5 right-1.5 rounded-md border border-white/15 bg-black/65 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white/85 backdrop-blur">
        {aspectRatio}
      </span>
    </div>
  );
}

/**
 * 模板卡片，用于浏览、聚焦和选择模板。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 模板卡片。
 */
function TemplateCard({ template, aspectRatio, active, selected, onActivate, onSelect }) {
  const category = getTemplateCategoryLabel(template);
  return (
    <button
      type="button"
      className={cn(
        'group grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-2xl border p-2 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/45',
        active
          ? 'border-[#2563eb] bg-[#eef4ff] shadow-[0_12px_28px_rgba(37,99,235,.14)]'
          : 'border-[#e4e8ef] bg-white hover:-translate-y-0.5 hover:border-[#b9c7dc] hover:shadow-[0_10px_24px_rgba(15,23,42,.08)]',
      )}
      aria-pressed={selected}
      onFocus={onActivate}
      onMouseEnter={onActivate}
      onClick={onSelect}
    >
      <TemplatePoster
        template={template}
        aspectRatio={aspectRatio}
        className="h-[86px] w-[76px] rounded-xl"
      />
      <span className="flex min-w-0 flex-col py-1">
        <span className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[13px] font-black leading-[1.3] text-[#172033]">
            {getTemplateDisplayName(template)}
          </span>
          {selected ? (
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#2563eb] text-white">
              <Check size={12} strokeWidth={3} aria-hidden="true" />
            </span>
          ) : null}
        </span>
        <span className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[.14em] text-[#6c7890]">
          {category || '视觉模板'}
        </span>
        <span className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-[#6c7482]">
          {template.description || '查看动态排版和视觉节奏。'}
        </span>
      </span>
    </button>
  );
}

/**
 * 当前模板的动态 iframe 预览舞台。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 动态预览区域。
 */
function TemplateLivePreview({ template, aspectRatio }) {
  const [replayKey, setReplayKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const liveUrl = String(template?.preview?.live_url || '');

  useEffect(() => {
    setReplayKey(0);
    setLoading(true);
  }, [template?.id]);

  /** 重新加载 iframe，让模板动画从头播放。 */
  function replayPreview() {
    setLoading(true);
    setReplayKey(value => value + 1);
  }

  /** 打开模板大图预览，并显示独立加载状态。 */
  function openExpandedPreview() {
    if (!liveUrl) return;
    setExpandedLoading(true);
    setExpanded(true);
  }

  /** 同步大图预览弹窗状态。 */
  function handleExpandedChange(nextOpen) {
    setExpanded(nextOpen);
    if (nextOpen) setExpandedLoading(true);
  }

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[22px] border border-white/10 bg-[#090b10] text-white shadow-[0_28px_70px_rgba(0,0,0,.3)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[9px] font-bold uppercase tracking-[.22em] text-[#7e8ba3]">Live motion preview</p>
          <h3 className="mt-1 truncate font-serif text-lg font-bold text-white">{getTemplateDisplayName(template)}</h3>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            aria-label="放大模板动态预览"
            disabled={!liveUrl}
            onClick={openExpandedPreview}
          >
            <Maximize2 size={14} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            aria-label="重新播放模板动画"
            onClick={replayPreview}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-[300px] place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#252a36_0%,#0a0c11_58%,#050609_100%)] p-5 max-[760px]:min-h-[360px]">
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-[0_18px_50px_rgba(0,0,0,.55)] ring-1 ring-white/10"
          style={{
            aspectRatio: toCssAspectRatio(aspectRatio),
            height: ['9:16', '4:5'].includes(aspectRatio) ? '100%' : 'auto',
            width: ['9:16', '4:5'].includes(aspectRatio) ? 'auto' : '100%',
          }}
        >
          {liveUrl ? (
            <iframe
              key={`${template.id}-${replayKey}`}
              src={`${liveUrl}?replay=${replayKey}`}
              title={`${getTemplateDisplayName(template)}动态效果预览`}
              sandbox="allow-scripts"
              className="h-full w-full border-0 bg-black"
              onLoad={() => setLoading(false)}
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-[#9da7b7]">当前模板没有动态预览。</div>
          )}
          {loading && liveUrl ? (
            <div className="absolute inset-0 z-20 grid place-items-center bg-[#090b10] text-[#c7d0df]" role="status">
              <span className="grid justify-items-center gap-2 text-xs font-semibold">
                <Loader2 className="animate-spin" size={22} aria-hidden="true" />
                正在加载动态效果...
              </span>
            </div>
          ) : null}
          {liveUrl && !loading ? (
            <button
              type="button"
              className="group absolute inset-0 z-10 cursor-zoom-in bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7da8ff]"
              aria-label="点击放大模板动态预览"
              onClick={openExpandedPreview}
            >
              <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-2.5 py-1.5 text-[10px] font-bold text-white/90 opacity-0 shadow-lg backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 size={12} aria-hidden="true" />
                点击放大
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="m-0 text-xs leading-relaxed text-[#aab4c4]">
          {template.description || '动态预览使用模板示例内容，不会创建任务或导出视频。'}
        </p>
        {Array.isArray(template.best_for) && template.best_for.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {template.best_for.slice(0, 3).map(item => (
              <span key={item} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-[#d6deea]">
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={expanded} onOpenChange={handleExpandedChange}>
        <DialogContent className="grid h-[min(92vh,900px)] w-[min(96vw,1400px)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[24px] border-white/10 bg-[#07090d] p-0 text-white shadow-[0_36px_120px_rgba(0,0,0,.65)] sm:max-w-none">
          <DialogHeader className="border-b border-white/10 bg-[#0c0f15] px-5 py-4 pr-14 text-left">
            <DialogTitle className="font-serif text-xl font-bold text-white">{getTemplateDisplayName(template)} · 放大预览</DialogTitle>
            <DialogDescription className="text-xs text-[#9da8b9]">动态预览使用模板示例内容，不会创建任务或导出视频。</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#252a36_0%,#0a0c11_58%,#050609_100%)] p-5">
            <div
              className="relative max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-[0_22px_70px_rgba(0,0,0,.65)] ring-1 ring-white/10"
              style={{
                aspectRatio: toCssAspectRatio(aspectRatio),
                height: ['9:16', '4:5'].includes(aspectRatio) ? '100%' : 'auto',
                width: ['9:16', '4:5'].includes(aspectRatio) ? 'auto' : '100%',
              }}
            >
              <iframe
                key={`${template.id}-${replayKey}-expanded`}
                src={`${liveUrl}?replay=${replayKey}`}
                title={`${getTemplateDisplayName(template)}放大动态效果预览`}
                sandbox="allow-scripts"
                className="h-full w-full border-0 bg-black"
                onLoad={() => setExpandedLoading(false)}
              />
              {expandedLoading ? (
                <div className="absolute inset-0 grid place-items-center bg-[#090b10] text-[#c7d0df]" role="status">
                  <span className="grid justify-items-center gap-2 text-xs font-semibold">
                    <Loader2 className="animate-spin" size={24} aria-hidden="true" />
                    正在打开大图预览...
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 卡片式模板选择器，同时支持静态封面和单模板动态预览。
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 模板选择器。
 */
export function TemplatePicker({
  templates,
  aspectRatio,
  value,
  disabled = false,
  compact = false,
  onChange,
}) {
  const availableTemplates = useMemo(() => (
    (Array.isArray(templates) ? templates : []).filter(template => (
      getTemplateId(template)
      && isTemplateShownForAspect(template, aspectRatio)
      && !hasBlockingCompatibilityReason(template)
    ))
  ), [templates, aspectRatio]);
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(String(value || ''));
  const [activeId, setActiveId] = useState(String(value || ''));
  const [category, setCategory] = useState('全部');
  const selectedTemplate = availableTemplates.find(template => getTemplateId(template) === value) || null;
  const activeTemplate = availableTemplates.find(template => getTemplateId(template) === activeId) || null;
  const categories = useMemo(() => (
    [...new Set(availableTemplates.map(getTemplateCategoryLabel).filter(Boolean))]
  ), [availableTemplates]);
  const visibleTemplates = category === '全部'
    ? availableTemplates
    : availableTemplates.filter(template => getTemplateCategoryLabel(template) === category);

  /** 打开时恢复当前值，关闭时丢弃尚未确认的草稿。 */
  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (nextOpen) {
      const requestedId = String(value || '');
      const currentId = availableTemplates.some(template => getTemplateId(template) === requestedId)
        ? requestedId
        : '';
      setDraftValue(currentId);
      setActiveId(currentId || getTemplateId(availableTemplates[0]));
      setCategory('全部');
    }
  }

  /** 确认模板选择并关闭弹窗。 */
  function confirmSelection() {
    onChange?.(draftValue);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          'group flex w-full items-center justify-between gap-2 rounded-xl border border-[#d9dde5] bg-white text-left text-[#30343b] outline-none transition hover:border-[#9db0ca] focus-visible:border-[#2563eb] focus-visible:ring-2 focus-visible:ring-[#2563eb]/15 disabled:cursor-not-allowed disabled:opacity-60',
          compact ? 'h-[38px] px-2.5 text-[13px]' : 'min-h-[42px] px-2.5 py-1.5 text-[13px]',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => handleOpenChange(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedTemplate ? (
            <TemplatePoster template={selectedTemplate} aspectRatio={aspectRatio} className="h-7 w-7 shrink-0 rounded-md" />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#eff4fb] text-[#315a91]">
              <Sparkles size={14} aria-hidden="true" />
            </span>
          )}
          <span className="truncate font-semibold">
            {selectedTemplate ? getTemplateDisplayName(selectedTemplate) : '不指定模板（自动选择）'}
          </span>
        </span>
        <ChevronDown size={15} className="shrink-0 text-[#7d8795] transition group-hover:translate-y-0.5" aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="grid max-h-[calc(100vh-2rem)] w-[min(1120px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[26px] border-[#dfe4ec] bg-[#f5f7fa] p-0 shadow-[0_32px_100px_rgba(15,23,42,.28)] sm:max-w-[1120px]">
          <DialogHeader className="border-b border-[#dde3ec] bg-white px-6 py-5 pr-14 text-left">
            <p className="m-0 font-mono text-[10px] font-bold uppercase tracking-[.24em] text-[#2563eb]">Template contact sheet · {aspectRatio}</p>
            <DialogTitle className="mt-1 font-serif text-2xl font-black tracking-tight text-[#111827]">选择画面语言，而不只是模板名称</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-relaxed text-[#687386]">
              先浏览封面，再在右侧查看真实动态效果。预览不会创建任务，也不会导出视频。
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)] gap-4 overflow-hidden p-4 max-[900px]:grid-cols-1 max-[900px]:overflow-auto">
            <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-[#dfe4ec] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8ecf2] px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {['全部', ...categories].map(item => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[10px] font-bold transition',
                        category === item ? 'bg-[#172033] text-white' : 'bg-[#f0f3f7] text-[#667085] hover:bg-[#e4e9f0]',
                      )}
                      onClick={() => setCategory(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-[10px] font-bold text-[#7c8798]">{visibleTemplates.length} 个适配模板</span>
              </div>

              <div className="min-h-0 overflow-y-auto p-3">
                <button
                  type="button"
                  className={cn(
                    'mb-3 flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition',
                    draftValue === '' ? 'border-[#2563eb] bg-[#eef4ff]' : 'border-dashed border-[#cbd3df] bg-[#f8fafc] hover:border-[#9eacc0]',
                  )}
                  aria-pressed={draftValue === ''}
                  onClick={() => { setDraftValue(''); setActiveId(''); }}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#2563eb] shadow-sm">
                    <Sparkles size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-black text-[#172033]">不指定模板，由系统自动匹配</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-[#6b7687]">根据内容结构、场景角色和当前画幅自动选择。</span>
                  </span>
                  {draftValue === '' ? <Check size={16} className="shrink-0 text-[#2563eb]" aria-hidden="true" /> : null}
                </button>

                {visibleTemplates.length ? (
                  <div className="grid grid-cols-2 gap-3 max-[620px]:grid-cols-1">
                    {visibleTemplates.map(template => {
                      const id = getTemplateId(template);
                      return (
                        <TemplateCard
                          key={id}
                          template={template}
                          aspectRatio={aspectRatio}
                          active={activeId === id}
                          selected={draftValue === id}
                          onActivate={() => setActiveId(id)}
                          onSelect={() => { setDraftValue(id); setActiveId(id); }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-[#768195]" role="status">
                    当前画幅暂时没有可用模板。
                  </div>
                )}
              </div>
            </section>

            {activeTemplate ? (
              <TemplateLivePreview template={activeTemplate} aspectRatio={aspectRatio} />
            ) : (
              <div className="grid min-h-[360px] place-items-center rounded-[22px] border border-[#dfe4ec] bg-[#11141b] px-8 text-center text-white">
                <div className="grid max-w-xs justify-items-center gap-3">
                  <span className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-[#8bb2ff]">
                    <Clapperboard size={25} aria-hidden="true" />
                  </span>
                  <h3 className="m-0 font-serif text-xl font-bold">系统将自动选择视觉模板</h3>
                  <p className="m-0 text-xs leading-relaxed text-[#aab4c4]">如果内容结构还没有确定，保留自动选择通常比提前锁定模板更合适。</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between border-t border-[#dde3ec] bg-white px-6 py-4">
            <span className="min-w-0 truncate text-xs font-semibold text-[#687386]">
              {draftValue
                ? `待使用：${getTemplateDisplayName(availableTemplates.find(template => getTemplateId(template) === draftValue))}`
                : '待使用：系统自动匹配'}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button type="button" className="bg-[#172033] text-white hover:bg-[#090d16]" onClick={confirmSelection}>
                使用此模板
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const templatePickerTestUtils = {
  toCssAspectRatio,
};
