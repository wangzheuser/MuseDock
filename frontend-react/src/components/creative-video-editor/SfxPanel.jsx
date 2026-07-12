import { useEffect, useState } from 'react';
import { EditorInlineActions, EditorSection } from './editorUi.jsx';

function getEvents(project) {
  return Array.isArray(project?.audio?.sfx?.events) ? project.audio.sfx.events : [];
}

function getEventId(event) {
  return event?.id || event?.event_id || event?.sfx_id || '';
}

function getSceneLabel(event, frames, fallbackIndex) {
  const frameId = event?.frame_id || event?.scene_id || event?.frameId || event?.sceneId;
  const frameIndex = frames.findIndex(item => (
    String(item?.id) === String(frameId) || String(item?.scene_id) === String(frameId)
  ));
  const frame = frameIndex >= 0 ? frames[frameIndex] : null;
  const order = Number(frame?.order);
  return `场景 ${Number.isFinite(order) ? order : (frameIndex >= 0 ? frameIndex + 1 : fallbackIndex + 1)}`;
}

function getSortTime(event) {
  const value = event?.global_time_sec ?? event?.time_sec;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

function formatTime(event) {
  const timeSec = Number(event?.time_sec);
  if (Number.isFinite(timeSec)) return `${timeSec.toFixed(2)}s`;
  const globalTimeSec = Number(event?.global_time_sec);
  if (Number.isFinite(globalTimeSec)) return `全片 ${globalTimeSec.toFixed(2)}s`;
  return '未指定时间';
}

function editableDraft(event) {
  const roundTime = value => Math.round(Number(value) * 100) / 100;
  return {
    volume_db: Number.isFinite(Number(event?.volume_db)) ? Number(event.volume_db) : -18,
    time_sec: Number.isFinite(Number(event?.time_sec)) ? roundTime(event.time_sec) : 0,
    global_time_sec: Number.isFinite(Number(event?.global_time_sec)) ? roundTime(event.global_time_sec) : 0,
  };
}

export function SfxPanel({
  project,
  frames = [],
  disabled,
  deletingSfxEventId = '',
  onDisableEvent,
  onUpdateEvent,
  getSfxEventPlaybackUrl,
}) {
  const events = getEvents(project);
  const [showDisabled, setShowDisabled] = useState(false);
  const [drafts, setDrafts] = useState({});
  const visibleEvents = events
    .filter(event => showDisabled || event?.enabled !== false)
    .map((event, index) => ({ event, index }))
    .sort((a, b) => getSortTime(a.event) - getSortTime(b.event) || a.index - b.index);
  const disabledCount = events.filter(event => event?.enabled === false).length;

  useEffect(() => {
    setDrafts(Object.fromEntries(events.map(event => [getEventId(event), editableDraft(event)])));
  }, [project]);

  function patchDraft(eventId, patch) {
    setDrafts(prev => ({ ...prev, [eventId]: { ...(prev[eventId] || {}), ...patch } }));
  }

  return (
    <div className="grid min-w-0 gap-2 text-sm text-[#4b5563]">
      <p className="m-0 text-xs leading-5 text-[#4b5563]">
        这些音效会在重新导出时混入成片。停用是非破坏式操作，可随时恢复。
      </p>
      <label className="flex items-center gap-2 text-xs font-semibold text-[#4b5563]">
        <input type="checkbox" checked={showDisabled} disabled={disabled} onChange={event => setShowDisabled(event.target.checked)} />
        显示已停用音效
      </label>

      {visibleEvents.length ? (
        <EditorSection className="overflow-hidden p-0">
          {visibleEvents.map(({ event, index }, rowIndex) => {
            const eventId = getEventId(event);
            const mutating = String(deletingSfxEventId) === String(eventId);
            const draft = drafts[eventId] || editableDraft(event);
            const audioUrl = getSfxEventPlaybackUrl?.(eventId) || '';
            return (
              <div className={`grid gap-2 px-3 py-3 ${rowIndex < visibleEvents.length - 1 ? 'border-b border-[#e5e7eb]' : ''}`} key={eventId || `sfx-${index}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#111827]">
                      {event?.label_zh || event?.label || '未命名音效'}{event?.enabled === false ? '（已停用）' : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#6b7280]">
                      <span>{getSceneLabel(event, frames, index)}</span>
                      <span>时间：{formatTime(event)}</span>
                      <span>音量：{event?.volume_db ?? -18}dB</span>
                    </div>
                  </div>
                  <EditorInlineActions>
                    {event?.enabled === false ? (
                      <button type="button" disabled={disabled || mutating || !eventId} onClick={() => onUpdateEvent?.(eventId, { enabled: true })}>恢复</button>
                    ) : (
                      <button type="button" disabled={disabled || mutating || !eventId} onClick={() => onDisableEvent?.(eventId)}>{mutating ? '停用中...' : '停用'}</button>
                    )}
                  </EditorInlineActions>
                </div>
                {audioUrl ? <audio className="w-full" src={audioUrl} controls preload="none"><track kind="captions" /></audio> : null}
                <div className="grid grid-cols-3 gap-2">
                  <label>
                    <span>场景时间（秒）</span>
                    <input type="number" min="0" step="0.01" value={draft.time_sec} disabled={disabled || mutating} onChange={event => patchDraft(eventId, { time_sec: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>全片时间（秒）</span>
                    <input type="number" min="0" step="0.01" value={draft.global_time_sec} disabled={disabled || mutating} onChange={event => patchDraft(eventId, { global_time_sec: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>音量 dB</span>
                    <input type="number" min="-28" max="-10" step="1" value={draft.volume_db} disabled={disabled || mutating} onChange={event => patchDraft(eventId, { volume_db: Number(event.target.value) })} />
                  </label>
                </div>
                <EditorInlineActions>
                  <button type="button" disabled={disabled || mutating || !eventId} onClick={() => onUpdateEvent?.(eventId, draft)}>保存音效设置</button>
                </EditorInlineActions>
                {event?.reason ? <p className="m-0 text-xs leading-5 text-[#4b5563]">来源：{event.reason}</p> : null}
              </div>
            );
          })}
        </EditorSection>
      ) : (
        <EditorSection>
          <p className="m-0 text-sm font-semibold text-[#111827]">当前工程还没有自动音效。</p>
          <p className="m-0 mt-1 text-xs text-[#6b7280]">开启“自动音效增强”后，新生成的视频会在这里显示可停用的音效。</p>
        </EditorSection>
      )}

      <div className="text-right text-xs text-[#6b7280]">
        共 {events.length} 条，已停用 {disabledCount} 条
      </div>
    </div>
  );
}
