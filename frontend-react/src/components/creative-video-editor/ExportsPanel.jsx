import { useState } from 'react';
import { Clipboard, Download, Play } from 'lucide-react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

const PLATFORM_PRESETS = {
  custom: { label: '自定义', width: '', height: '', fps: 30 },
  douyin: { label: '抖音 / 小红书 竖屏', width: 1080, height: 1920, fps: 30 },
  bilibili: { label: 'B站横屏', width: 1920, height: 1080, fps: 30 },
  wechat: { label: '视频号竖屏', width: 1080, height: 1920, fps: 30 },
};

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function getExportLabel(item, index) {
  return item?.file_name || item?.path || item?.url || item?.file || `导出 ${index + 1}`;
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

function copyText(value) {
  if (!value || typeof navigator === 'undefined') return;
  navigator.clipboard?.writeText(value).catch(() => {});
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

function createInitialDraft() {
  return {
    platform: 'custom',
    fileName: 'output',
    width: '',
    height: '',
    fps: 30,
    playbackSpeed: 1,
    tailProtection: 'pad_end',
  };
}

export function ExportsPanel({
  exportsList = [],
  disabled,
  exporting,
  onExport,
  onRefresh,
  getExportPlaybackUrl: resolveExportPlaybackUrl,
  onPatchExport,
  onDeleteExport,
  onPlay = openPlaybackUrl,
}) {
  const [draft, setDraft] = useState(createInitialDraft);
  const [notes, setNotes] = useState({});

  function applyPlatform(platform) {
    const preset = PLATFORM_PRESETS[platform] || PLATFORM_PRESETS.custom;
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
    onExport?.({
      export_options: {
        platform: draft.platform,
        file_name: draft.fileName,
        width: Number.isFinite(width) && width > 0 ? width : undefined,
        height: Number.isFinite(height) && height > 0 ? height : undefined,
        fps: Number(draft.fps) || undefined,
        playback_speed: Number(draft.playbackSpeed) || 1,
        tail_protection: draft.tailProtection,
      },
    });
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
        <div className="grid grid-cols-3 gap-2">
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
            <input type="number" min="1" value={draft.fps} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, fps: event.target.value }))} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span>导出倍速</span>
            <select value={draft.playbackSpeed} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, playbackSpeed: Number(event.target.value) }))}>
              {SPEED_OPTIONS.map(speed => <option value={speed} key={speed}>{speed}x</option>)}
            </select>
          </label>
          <label>
            <span>尾音保护</span>
            <select value={draft.tailProtection} disabled={disabled} onChange={event => setDraft(prev => ({ ...prev, tailProtection: event.target.value }))}>
              <option value="pad_end">自动保护尾音</option>
              <option value="none">保持原时长</option>
            </select>
          </label>
        </div>
      </div>
      {exportsList.length ? exportsList.map((item, index) => {
        const playbackUrl = getExportPlaybackUrl(item, resolveExportPlaybackUrl);
        return (
          <div className="flex items-center justify-between gap-2 border-t border-[#e5e7eb] pt-2 text-xs text-[#4b5563] [&_strong]:break-all [&_strong]:text-[#111827]" key={item.id || item.path || index}>
            <div className="grid min-w-0 gap-[3px]">
              <strong>{getExportLabel(item, index)}</strong>
              <span>{formatExportTime(item.created_at) || item.status || '已生成'}{item.kind === 'preview' ? ' · 预览' : ''}{item.playback_speed && Number(item.playback_speed) !== 1 ? ` · ${item.playback_speed}x` : ''}{item.tail_padding_sec ? ` · 已保护尾音 +${Number(item.tail_padding_sec).toFixed(1)}s` : ''}</span>
              {item.note ? <span>备注：{item.note}</span> : null}
            </div>
            <EditorInlineActions>
              <button type="button" className="inline-flex flex-none items-center gap-1" disabled={disabled || !playbackUrl} title={playbackUrl ? '播放导出成片' : '暂无可播放文件'} aria-label={`播放导出成片：${getExportLabel(item, index)}`} onClick={() => onPlay(playbackUrl, item)}>
                <Play size={14} aria-hidden="true" />播放
              </button>
              <button type="button" className="inline-flex flex-none items-center gap-1" disabled={disabled || !playbackUrl} onClick={() => downloadUrl(playbackUrl)}>
                <Download size={14} aria-hidden="true" />下载
              </button>
              <button type="button" className="inline-flex flex-none items-center gap-1" disabled={disabled || !playbackUrl} onClick={() => copyText(playbackUrl)}>
                <Clipboard size={14} aria-hidden="true" />复制路径
              </button>
              <button type="button" disabled={disabled || !item.id} onClick={() => {
                if (typeof window !== 'undefined' && !window.confirm('确定删除这条导出记录和本地文件吗？')) return;
                onDeleteExport?.(item.id);
              }}>删除</button>
            </EditorInlineActions>
            <div className="col-span-full mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input value={notes[item.id] ?? item.note ?? ''} disabled={disabled || !item.id} placeholder="添加备注" onChange={event => setNotes(prev => ({ ...prev, [item.id]: event.target.value }))} />
              <button type="button" disabled={disabled || !item.id} onClick={() => onPatchExport?.(item.id, { note: notes[item.id] ?? item.note ?? '' })}>保存备注</button>
            </div>
          </div>
        );
      }) : <p>暂无导出记录</p>}
    </EditorPanel>
  );
}
