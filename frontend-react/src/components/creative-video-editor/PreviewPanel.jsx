import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';
import { formatExportTime, getExportPlaybackUrl } from './ExportsPanel.jsx';

export function PreviewPanel({ previews = [], disabled, generating, previewOutdated, onCreatePreview, getExportPlaybackUrl: resolveExportPlaybackUrl }) {
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const videoRef = useRef(null);
  const latestPreview = useMemo(() => (
    [...(Array.isArray(previews) ? previews : [])]
      .sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0))[0] || null
  ), [previews]);
  const playbackUrl = latestPreview ? getExportPlaybackUrl(latestPreview, resolveExportPlaybackUrl) : '';

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = Number(playbackSpeed) || 1;
  }, [playbackSpeed, playbackUrl]);

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>全片预览</h3>
        <EditorInlineActions>
          <label className="inline-flex items-center gap-1 text-xs">
            预览倍速
            <select value={playbackSpeed} disabled={disabled} onChange={event => setPlaybackSpeed(Number(event.target.value))}>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => <option value={speed} key={speed}>{speed}x</option>)}
            </select>
          </label>
          <button type="button" disabled={disabled} onClick={() => onCreatePreview?.({ preview: true, export_options: { playback_speed: playbackSpeed } })}>
            {generating ? '正在生成预览...' : '生成全片预览'}
          </button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <p className="m-0 text-xs leading-relaxed text-[#6b7280]">
        预览用于导出前确认整体节奏。这里调整预览播放速度；重新生成预览时会按当前倍速生成文件。
      </p>
      {previewOutdated ? <p className="m-0 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">项目修改后尚未重新生成预览。</p> : null}
      {playbackUrl ? (
        <video ref={videoRef} className="w-full rounded-md border border-[#e5e7eb] bg-black" src={playbackUrl} controls />
      ) : <p>暂无可播放预览。</p>}
      {latestPreview ? <p className="m-0 text-xs text-[#6b7280]">最近预览：{formatExportTime(latestPreview.created_at) || latestPreview.id}</p> : null}
    </EditorPanel>
  );
}
