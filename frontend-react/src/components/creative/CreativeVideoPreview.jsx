export function CreativeVideoPreview({ videoUrl }) {
  return (
    <section className="flex justify-center overflow-hidden rounded-lg border border-[#e7e9ee] bg-[#05070a] p-3 shadow-[0_12px_32px_rgba(15,23,42,.08)]" aria-label="生成视频预览">
      <video className="block h-auto w-auto max-h-[calc(100vh-220px)] max-w-full rounded-md bg-[#05070a]" src={videoUrl} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
    </section>
  );
}
