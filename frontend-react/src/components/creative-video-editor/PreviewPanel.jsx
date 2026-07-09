import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';
import { formatExportTime, getExportPlaybackUrl, parsePlaybackSpeedInput } from './ExportsPanel.jsx';

export function PreviewPanel({ previews = [], disabled, generating, previewOutdated, onCreatePreview, getExportPlaybackUrl: resolveExportPlaybackUrl }) {
  const [playbackSpeed, setPlaybackSpeed] = useState('1.0');
  const [speedError, setSpeedError] = useState('');
  const videoRef = useRef(null);
  const latestPreview = useMemo(() => (
    [...(Array.isArray(previews) ? previews : [])]
      .sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0))[0] || null
  ), [previews]);
  const playbackUrl = latestPreview ? getExportPlaybackUrl(latestPreview, resolveExportPlaybackUrl) : '';

  useEffect(() => {
    const parsed = parsePlaybackSpeedInput(playbackSpeed);
    if (videoRef.current && parsed.ok) videoRef.current.playbackRate = parsed.speed;
  }, [playbackSpeed, playbackUrl]);

  function createPreview() {
    const parsed = parsePlaybackSpeedInput(playbackSpeed);
    if (!parsed.ok) {
      setSpeedError(parsed.message);
      return;
    }
    setSpeedError('');
    setPlaybackSpeed(parsed.formatted);
    onCreatePreview?.({ preview: true, export_options: { playback_speed: parsed.speed } });
  }

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>全片预览</h3>
        <EditorInlineActions>
          <label className="inline-flex items-center gap-1 text-xs">
            预览倍速
            <input
              className="w-16"
              value={playbackSpeed}
              disabled={disabled}
              inputMode="decimal"
              placeholder="1.0"
              aria-describedby="preview-playback-speed-help"
              onBlur={() => {
                const parsed = parsePlaybackSpeedInput(playbackSpeed);
                if (parsed.ok) setPlaybackSpeed(parsed.formatted);
              }}
              onChange={event => setPlaybackSpeed(event.target.value)}
            />
            x
          </label>
          <button type="button" disabled={disabled} onClick={createPreview}>
            {generating ? '正在生成预览...' : '生成全片预览'}
          </button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <p className="m-0 text-xs leading-relaxed text-[#6b7280]">
        预览用于导出前确认整体节奏。这里调整预览播放速度；重新生成预览时会按当前倍速生成文件。
      </p>
      <p id="preview-playback-speed-help" className={`m-0 text-xs ${speedError ? 'font-semibold text-red-600' : 'text-[#6b7280]'}`}>
        {speedError || '0.1 到 2.0，最多 1 位小数。'}
      </p>
      {previewOutdated ? <p className="m-0 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">项目修改后尚未重新生成预览。</p> : null}
      {playbackUrl ? (
        <video ref={videoRef} className="w-full rounded-md border border-[#e5e7eb] bg-black" src={playbackUrl} controls />
      ) : <p>暂无可播放预览。</p>}
      {latestPreview ? <p className="m-0 text-xs text-[#6b7280]">最近预览：{formatExportTime(latestPreview.created_at) || latestPreview.id}</p> : null}
    </EditorPanel>
  );
}
