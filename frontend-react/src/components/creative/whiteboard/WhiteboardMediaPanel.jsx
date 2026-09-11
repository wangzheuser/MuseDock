import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { CreativeVideoPreview } from '../CreativeVideoPreview.jsx';

const PANELS = [ ['full_narration', '旁白'], ['lineart_generation', '线稿'], ['annotation_drafting', '落墨'], ['scene_render', '单幕'], ['final_delivery', '成片'] ];
function PreviewImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <p role="alert" className="text-xs text-danger">图片读取失败，请刷新任务并检查本地文件。</p>
    : <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="aspect-video w-full rounded-md border border-line-1 object-contain" />;
}

export function WhiteboardMediaPanel({ media }) {
  const [tab, setTab] = useState(media.stage);
  useEffect(() => setTab(media.stage), [media.stage]);
  const files = new Map(media.artifacts.map(file => [file.id, file]));
  const url = file => files.get(file?.id)?.url || '';
  const current = media.current;
  const narration = current.full_narration;
  const final = current.final_delivery;
  const download = (file, label) => file && <Button asChild variant="outline" size="sm" className="max-[760px]:min-h-11"><a href={`${url(file)}?download=1`} download><Download size={14} />{label}</a></Button>;
  const empty = <p className="py-6 text-center text-sm text-fg-3">完成前面的步骤后，此处会显示当前产物。</p>;
  return (
    <div className="grid min-w-0 gap-4" aria-label="白板媒体产物">
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
        <TabsList className="grid h-auto w-full grid-cols-5" aria-label="媒体阶段">{PANELS.map(([id, label]) => <TabsTrigger key={id} value={id} className="min-h-10 px-1 text-xs">{label}</TabsTrigger>)}</TabsList>
        <TabsContent value="full_narration" className="min-w-0">
          {narration ? <div className="grid gap-4">
            <p className="m-0 text-sm">真实时长 <strong>{(narration.durationMs / 1000).toFixed(2)} 秒</strong>{narration.audio ? ' · 24 kHz 单声道' : ' · 静音 SRT'}</p>
            {narration.audio ? <audio controls preload="metadata" src={url(narration.audio)} className="w-full" aria-label="完整白板旁白" /> : null}
            <div className="flex flex-wrap gap-2">{download(narration.audio, '下载完整旁白')}{download(narration.subtitles, '下载字幕 SRT')}</div>
            <p className="m-0 text-xs leading-6 text-fg-3">{narration.audio ? '字幕文字来自已确认正文，时间来自同一次语音响应的原生字级证据。' : '使用输入 SRT 的真实时钟。'}</p>
          </div> : empty}
        </TabsContent>
        <TabsContent value="lineart_generation" className="min-w-0"><div className="grid gap-5">
          {current.lineart_generation?.scenes.map((scene, index) => <article key={scene.sceneId} className="grid gap-2"><strong className="text-sm">{index + 1}. {scene.image.name}</strong><PreviewImage src={url(scene.image)} alt={`${scene.image.name}线稿`} />{download(scene.image, '下载线稿')}</article>) || empty}
        </div></TabsContent>
        <TabsContent value="annotation_drafting" className="min-w-0"><div className="grid gap-5">
          {current.annotation_drafting?.scenes.map((scene, index) => <article key={scene.sceneId} className="grid gap-2"><strong className="text-sm">{index + 1}. {scene.preview.name}</strong><PreviewImage src={url(scene.preview)} alt={scene.preview.name} /><p className="m-0 text-xs text-fg-3">区域按编号串行落墨，末尾保留至少半秒。墨迹覆盖率 {(scene.coverage.coverageRatio * 100).toFixed(1)}%。</p>{download(scene.annotation, '下载区域编排')}</article>) || empty}
        </div></TabsContent>
        <TabsContent value="scene_render" className="min-w-0"><div className="grid gap-5">
          {current.scene_render?.scenes.map((scene, index) => <article key={scene.sceneId} className="grid gap-2"><strong className="text-sm">{index + 1}. {scene.video.name}</strong><CreativeVideoPreview videoUrl={url(scene.video)} />{download(scene.video, '下载单幕视频')}</article>) || empty}
        </div></TabsContent>
        <TabsContent value="final_delivery" className="min-w-0">
          {final ? <div className="grid gap-4"><CreativeVideoPreview videoUrl={url(final.video)} posterUrl={url(final.poster)} /><div className="flex flex-wrap gap-2">{download(final.video, '下载最终视频')}{download(narration?.subtitles, '下载字幕')}</div>
            <p className="m-0 text-xs leading-6 text-fg-3">1920 × 1080 · 60 fps · H.264{final.validation.audio ? ' / AAC' : ' · 静音'} · {(final.validation.durationMs / 1000).toFixed(2)} 秒</p>
            <details className="rounded-md border border-line-1 p-3 text-xs"><summary className="cursor-pointer text-fg-2">技术验证与版本身份</summary><p className="break-all font-mono leading-6 text-fg-3">{final.identity}</p><p className="text-fg-3">已检查编码、帧数、时长、音轨并完整解码。</p><a href={url(final.receipt)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline"><FileText size={13} />查看验证记录</a></details>
          </div> : empty}
        </TabsContent>
      </Tabs>
    </div>
  );
}
