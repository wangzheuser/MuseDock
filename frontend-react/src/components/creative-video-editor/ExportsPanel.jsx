import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Clipboard, Download, Play, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

const PLATFORM_PRESETS = {
  custom: { label: '自定义', width: '', height: '', fps: 'project' },
  douyin: { label: '抖音 / 小红书 竖屏', width: 1080, height: 1920, fps: 30 },
  douyin_landscape: { label: '抖音横屏', width: 1920, height: 1080, fps: 30 },
  xiaohongshu_landscape: { label: '小红书横屏', width: 1920, height: 1080, fps: 30 },
  bilibili: { label: 'B站横屏', width: 1920, height: 1080, fps: 30 },
  wechat: { label: '视频号竖屏', width: 1080, height: 1920, fps: 30 },
};

const EXPORT_DRAFT_STORAGE_KEY = 'musedock.htmlVideo.exportDraft.v1';

export const PLAYBACK_SPEED_ERROR = '请输入 0.1 到 2.0 之间的导出倍速，最多 1 位小数。';

export function parsePlaybackSpeedInput(value) {
  const text = String(value ?? '').trim();
  const normalized = text || '1.1';
  if (!/^\d+(\.\d?)?$/.test(normalized)) {
    return { ok: false, message: PLAYBACK_SPEED_ERROR };
  }
  const speed = Number(normalized);
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 2) {
    return { ok: false, message: PLAYBACK_SPEED_ERROR };
  }
  return { ok: true, speed, formatted: speed.toFixed(1) };
}

function getExportLabel(item, index) {
  return item?.file_name || item?.path || item?.url || item?.file || `导出 ${index + 1}`;
}

/**
 * 格式化导出记录的实际倍速，缺失历史数据时不推测。
 * @param {unknown} value 导出记录中的倍速。
 * @returns {string} 用户可见倍速文案。
 */
export function formatExportPlaybackSpeed(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '导出倍速未知';
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 ? `导出倍速 ${speed.toFixed(1)}x` : '导出倍速未知';
}

export function formatExportTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function getExportPlaybackUrl(item, resolver) {
  if (typeof resolver === 'function') return resolver(item);
  return item?.url || item?.output_url || item?.playback_url || '';
}

function openPlaybackUrl(url) {
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyText(value) {
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function downloadUrl(url) {
  if (!url || typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * 格式化视频码率。
 * @param {number|string} value 码率，单位 bps。
 * @returns {string} Mbps 文本。
 */
function formatVideoBitrate(value) {
  const bitrate = Number(value);
  return Number.isFinite(bitrate) && bitrate > 0 ? `${(bitrate / 1000000).toFixed(2)} Mbps` : '码率未知';
}

/**
 * 返回技术质检的展示信息。
 * @param {object|null} report 质检报告。
 * @returns {object} 状态文案、样式和图标。
 */
function getQualityDisplay(report) {
  if (!report) return { label: '暂无技术质检数据', className: 'text-[#6b7280]', icon: CircleHelp };
  if (report.skipped) return { label: '技术质检已跳过', className: 'text-amber-700', icon: AlertTriangle };
  if (report.publish_ready === false || report.success === false) return { label: '技术质检未通过', className: 'text-red-700', icon: XCircle };
  const hasActionableIssue = (report.issues || []).some(issue => ['error', 'warning'].includes(issue?.severity));
  if (report.pass === false || hasActionableIssue) return { label: '技术质检通过，存在优化建议', className: 'text-amber-700', icon: AlertTriangle };
  return { label: '技术质检通过', className: 'text-emerald-700', icon: CheckCircle2 };
}

function defaultExportDraft() {
  return {
    platform: 'custom',
    fileName: 'output',
    width: '',
    height: '',
    fps: 'project',
    playbackSpeed: '1.1',
    tailProtection: 'pad_end',
  };
}

/**
 * 获取浏览器本地存储对象，兼容隐私模式或权限限制导致的访问异常。
 * @returns {Storage|null} 可用的 localStorage。
 */
function getExportDraftStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * 归一化浏览器保存的导出草稿，避免损坏数据污染导出参数。
 * @param {object} value localStorage 中解析出的草稿。
 * @returns {object} 可直接用于表单的草稿。
 */
function normalizeStoredDraft(value) {
  const defaults = defaultExportDraft();
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const speed = parsePlaybackSpeedInput(input.playbackSpeed);
  return {
    platform: PLATFORM_PRESETS[input.platform] ? input.platform : defaults.platform,
    fileName: String(input.fileName || defaults.fileName).slice(0, 80),
    width: input.width === '' ? '' : Number(input.width) || defaults.width,
    height: input.height === '' ? '' : Number(input.height) || defaults.height,
    fps: input.fps === 'project' || [30, 60].includes(Number(input.fps))
      ? input.fps
      : defaults.fps,
    playbackSpeed: speed.ok ? speed.formatted : defaults.playbackSpeed,
    tailProtection: input.tailProtection === 'none' ? 'none' : defaults.tailProtection,
  };
}

/**
 * 从浏览器恢复上次导出配置；无浏览器环境或数据损坏时回退默认值。
 * @param {unknown} defaultPlaybackSpeed 当前任务默认导出倍速。
 * @returns {object} 初始导出配置。
 */
function createInitialDraft(defaultPlaybackSpeed) {
  const storage = getExportDraftStorage();
  const configuredSpeed = parsePlaybackSpeedInput(defaultPlaybackSpeed);
  if (!storage) {
    return {
      ...defaultExportDraft(),
      ...(configuredSpeed.ok ? { playbackSpeed: configuredSpeed.formatted } : {}),
    };
  }
  try {
    const stored = normalizeStoredDraft(JSON.parse(storage.getItem(EXPORT_DRAFT_STORAGE_KEY) || '{}'));
    return configuredSpeed.ok ? { ...stored, playbackSpeed: configuredSpeed.formatted } : stored;
  } catch {
    return {
      ...defaultExportDraft(),
      ...(configuredSpeed.ok ? { playbackSpeed: configuredSpeed.formatted } : {}),
    };
  }
}

/**
 * 将导出配置保存到浏览器，只保存表单配置，不保存导出记录和备注。
 * @param {object} draft 当前导出配置。
 */
function saveExportDraft(draft) {
  const storage = getExportDraftStorage();
  if (!storage) return;
  try {
    const nextDraft = normalizeStoredDraft(draft);
    storage.setItem(EXPORT_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
  } catch {
    // localStorage 不可用时跳过，不影响导出。
  }
}

export function ExportsPanel({
  exportsList = [],
  projectResolution = {},
  projectFps = 30,
  defaultPlaybackSpeed,
  disabled,
  exporting,
  onExport,
  onRefresh,
  getExportPlaybackUrl: resolveExportPlaybackUrl,
  onPatchExport,
  onDeleteExport,
  onPlay = openPlaybackUrl,
}) {
  const [draft, setDraft] = useState(() => createInitialDraft(defaultPlaybackSpeed));
  const [notes, setNotes] = useState({});
  const [speedError, setSpeedError] = useState('');
  const [resolutionError, setResolutionError] = useState('');
  const [copyStatus, setCopyStatus] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    saveExportDraft(draft);
  }, [draft]);

  useEffect(() => {
    const parsed = parsePlaybackSpeedInput(defaultPlaybackSpeed);
    if (!parsed.ok) return;
    setDraft(previous => ({ ...previous, playbackSpeed: parsed.formatted }));
    setSpeedError('');
  }, [defaultPlaybackSpeed]);

  const indexedExports = exportsList.map((item, index) => ({ item, index }));
  const exportGroups = [
    { id: 'export', title: '正式成品', records: indexedExports.filter(({ item }) => item?.kind === 'export') },
    { id: 'preview', title: '预览文件', records: indexedExports.filter(({ item }) => item?.kind === 'preview') },
  ].filter(group => group.records.length > 0);

  function applyPlatform(platform) {
    const preset = PLATFORM_PRESETS[platform] || PLATFORM_PRESETS.custom;
    setResolutionError('');
    setDraft(prev => ({
      ...prev,
      platform,
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
    }));
  }

  function submitExport() {
    const width = Number(draft.width);
    const height = Number(draft.height);
    const projectWidth = Number(projectResolution.width);
    const projectHeight = Number(projectResolution.height);
    const resolvedFps = draft.fps === 'project'
      ? ([30, 60].includes(Number(projectFps)) ? Number(projectFps) : 30)
      : Number(draft.fps);
    const parsedSpeed = parsePlaybackSpeedInput(draft.playbackSpeed);
    if (!parsedSpeed.ok) {
      setSpeedError(parsedSpeed.message);
      return;
    }
    if (
      Number.isFinite(width) && width > 0
      && Number.isFinite(height) && height > 0
      && Number.isFinite(projectWidth) && projectWidth > 0
      && Number.isFinite(projectHeight) && projectHeight > 0
      && (width !== projectWidth || height !== projectHeight)
    ) {
      setResolutionError(`当前工程画布为 ${projectWidth}×${projectHeight}，不能直接导出为 ${width}×${height}。请使用目标画幅重新创建工程。`);
      return;
    }
    setSpeedError('');
    setResolutionError('');
    setDraft(prev => ({ ...prev, playbackSpeed: parsedSpeed.formatted }));
    onExport?.({
      export_options: {
        platform: draft.platform,
        file_name: draft.fileName,
        width: Number.isFinite(width) && width > 0 ? width : undefined,
        height: Number.isFinite(height) && height > 0 ? height : undefined,
        fps: resolvedFps,
        playback_speed: parsedSpeed.speed,
        tail_protection: draft.tailProtection,
      },
    });
  }

  /**
   * 复制导出文件地址并给出短反馈。
   * @param {string|number} key 导出记录键。
   * @param {string} url 播放地址。
   */
  async function copyPlaybackUrl(key, url) {
    const ok = await copyText(url);
    setCopyStatus(prev => ({ ...prev, [key]: ok ? '已复制' : '复制失败' }));
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      setCopyStatus(prev => ({ ...prev, [key]: '' }));
    }, 1800);
  }

  async function confirmDeleteExport() {
    if (!pendingDelete?.id || deleting) return;
    setDeleting(true);
    try {
      await onDeleteExport?.(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>导出记录</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled} onClick={onRefresh}>刷新</button>
          <button type="button" disabled={disabled} onClick={submitExport}>
            {exporting ? '正在导出成片...' : '按当前选项导出'}
          </button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <div className="grid gap-2 rounded-md border border-[#e5e7eb] bg-white p-2">
        <label>
          <span>平台预设</span>
          <select value={draft.platform} disabled={disabled} onChange={event => applyPlatform(event.target.value)}>
            {Object.entries(PLATFORM_PRESETS).map(([value, preset]) => <option value={value} key={value}>{preset.label}</option>)}
          </select>
        </label>
        <label>
          <span>文件名</span>
          <input value={draft.fileName} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, fileName: event.target.value }))} />
        </label>
        <div className="grid grid-cols-3 gap-2 max-[560px]:grid-cols-1">
          <label>
            <span>宽</span>
            <input type="number" min="1" value={draft.width} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, width: event.target.value }))} />
          </label>
          <label>
            <span>高</span>
            <input type="number" min="1" value={draft.height} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, height: event.target.value }))} />
          </label>
          <label>
            <span>FPS</span>
            <select value={draft.fps} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, fps: event.target.value }))}>
              <option value="project">跟随工程（{[30, 60].includes(Number(projectFps)) ? Number(projectFps) : 30} FPS）</option>
              <option value="30">30 FPS</option>
              <option value="60">60 FPS</option>
            </select>
          </label>
        </div>
        {resolutionError ? <p className="m-0 text-xs font-semibold text-red-600">{resolutionError}</p> : null}
        <div className="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
          <label>
            <span>导出倍速</span>
            <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
              <input
                value={draft.playbackSpeed}
                disabled={disabled}
                inputMode="decimal"
                placeholder="1.0"
                aria-describedby="export-playback-speed-help"
                onBlur={() => {
                  const parsed = parsePlaybackSpeedInput(draft.playbackSpeed);
                  if (parsed.ok) setDraft(prev => ({ ...prev, playbackSpeed: parsed.formatted }));
                }}
                onChange={event => setDraft(prev => ({ ...prev, playbackSpeed: event.target.value }))}
              />
              <span>x</span>
            </span>
          </label>
          <label>
            <span>尾音保护</span>
            <select value={draft.tailProtection} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, tailProtection: event.target.value }))}>
              <option value="pad_end">自动保护尾音</option>
              <option value="none">保持原时长</option>
            </select>
          </label>
        </div>
        <p id="export-playback-speed-help" className={`m-0 text-xs ${speedError ? 'font-semibold text-red-600' : 'text-[#6b7280]'}`}>
          {speedError || '0.1 到 2.0，最多 1 位小数。1.0 为原速。低于 0.5x 可能导出更慢、画面略卡顿。'}
        </p>
      </div>
      {exportGroups.length ? exportGroups.map(group => (
        <section className="grid gap-2" key={group.id} aria-labelledby={`export-group-${group.id}`}>
          <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-1">
            <h4 className="m-0 text-xs font-bold text-[#111827]" id={`export-group-${group.id}`}>{group.title}</h4>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{group.records.length} 个文件</span>
          </div>
          {group.records.map(({ item, index }) => {
        const playbackUrl = getExportPlaybackUrl(item, resolveExportPlaybackUrl);
        const itemKey = item.id || item.path || index;
        const qualityReport = item.quality_report || null;
        const qualityDisplay = getQualityDisplay(qualityReport);
        const QualityIcon = qualityDisplay.icon;
        const metrics = qualityReport?.metrics || {};
        const warningCount = (qualityReport?.issues || []).filter(issue => issue?.severity === 'warning').length;
        return (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[#e5e7eb] bg-white p-3 text-xs text-[#4b5563] max-[720px]:grid-cols-1 [&_strong]:break-all [&_strong]:text-[#111827]" key={itemKey}>
            <div className="grid min-w-0 gap-[3px]">
              <strong>{getExportLabel(item, index)}</strong>
              <span>{formatExportTime(item.created_at) || item.status || '已生成'} · {item.kind === 'preview' ? '预览文件' : '正式成品'} · {formatExportPlaybackSpeed(item.playback_speed)}{item.tail_padding_sec ? ` · 已保护尾音 +${Number(item.tail_padding_sec).toFixed(1)}s` : ''}</span>
              <span className={`inline-flex items-center gap-1 font-medium ${qualityDisplay.className}`} role="status" title={qualityReport?.message || qualityDisplay.label}>
                <QualityIcon size={14} aria-hidden="true" />{qualityDisplay.label}{warningCount ? `（${warningCount} 项）` : ''}
              </span>
              {qualityReport && !qualityReport.skipped ? (
                <span>
                  {metrics.width || 0}×{metrics.height || 0} · {Number(metrics.fps || 0).toFixed(2)} FPS · {formatVideoBitrate(metrics.video_bitrate)}
                  {metrics.audio_sample_rate ? ` · 音频 ${Math.round(Number(metrics.audio_sample_rate) / 1000)}kHz` : ''}
                  {metrics.encoding_mode?.includes('crf17') ? ' · CRF17 质量模式' : ''}
                  {metrics.motion_effective_fps_estimate ? ` · 画面变化估算约 ${Number(metrics.motion_effective_fps_estimate).toFixed(2)} FPS` : ''}
                </span>
              ) : null}
              {(qualityReport?.issues || []).map(issue => (
                <span className={issue?.severity === 'error' ? 'text-red-700' : issue?.severity === 'warning' ? 'text-amber-700' : 'text-[#64748b]'} key={issue?.code || issue?.message}>
                  {issue?.message || '存在发布质量建议。'}
                </span>
              ))}
              {item.note ? <span>备注：{item.note}</span> : null}
              {copyStatus[itemKey] ? <span className={copyStatus[itemKey] === '已复制' ? 'text-emerald-600' : 'text-red-600'}>{copyStatus[itemKey]}</span> : null}
            </div>
            <EditorInlineActions>
              <button type="button" className="inline-flex flex-none items-center gap-1" disabled={disabled || !playbackUrl} title={playbackUrl ? '播放导出成片' : '暂无可播放文件'} aria-label={`播放导出成片：${getExportLabel(item, index)}`} onClick={() => onPlay(playbackUrl, item)}>
                <Play size={14} aria-hidden="true" />播放
              </button>
              <button type="button" className="inline-flex flex-none items-center gap-1" disabled={disabled || !playbackUrl} onClick={() => downloadUrl(playbackUrl)}>
                <Download size={14} aria-hidden="true" />下载
              </button>
              <button type="button" className="inline-flex flex-none items-center gap-1" disabled={disabled || !playbackUrl} onClick={() => copyPlaybackUrl(itemKey, playbackUrl)}>
                <Clipboard size={14} aria-hidden="true" />复制路径
              </button>
              <button type="button" className="text-red-700 hover:text-red-800" disabled={disabled || !item.id} onClick={() => setPendingDelete(item)}>删除</button>
            </EditorInlineActions>
            <div className="col-span-2 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-[720px]:col-span-1">
              <input value={notes[item.id] ?? item.note ?? ''} disabled={disabled || !item.id} placeholder="添加备注" onChange={event => setNotes(prev => ({ ...prev, [item.id]: event.target.value }))} />
              <button type="button" disabled={disabled || !item.id} onClick={() => onPatchExport?.(item.id, { note: notes[item.id] ?? item.note ?? '' })}>保存备注</button>
            </div>
          </div>
        );
          })}
        </section>
      )) : <p>暂无导出记录</p>}
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <DialogContent className="bg-white text-[#111827]" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>删除导出记录</DialogTitle>
            <DialogDescription>将同时删除本地导出文件，此操作不可恢复。</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{pendingDelete ? getExportLabel(pendingDelete, 0) : ''}</div>
          <DialogFooter>
            <button type="button" className="min-h-9 rounded-lg border border-[#d9dde5] bg-white px-4 text-sm font-semibold" disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button>
            <button type="button" className="min-h-9 rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-55" disabled={deleting} onClick={confirmDeleteExport}>{deleting ? '正在删除...' : '确认删除'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EditorPanel>
  );
}
