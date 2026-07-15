const fs = require('fs');
const fsPromises = require('fs/promises');

const { materializeTemplate } = require('./materializer');
const {
  getManifestAspect,
  resolveSourceEntryPath,
  resolveTemplateFilePath,
} = require('./templateRegistry');

/**
 * 读取模板预览使用的示例输入。
 * @param {object} manifest 模板声明。
 * @returns {object} 第一组示例输入。
 */
function getPreviewVariables(manifest) {
  const examples = Array.isArray(manifest?.inputs?.examples) ? manifest.inputs.examples : [];
  const variables = examples[0];
  return variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {};
}

/**
 * 读取模板的默认时长。
 * @param {object} manifest 模板声明。
 * @returns {number} 预览时长，单位秒。
 */
function getPreviewDurationSec(manifest) {
  const output = manifest?.output || {};
  const value = Number(output.duration_sec ?? output.duration ?? 6);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

/**
 * 返回模板预览画布尺寸。
 * @param {object} manifest 模板声明。
 * @returns {{width: number, height: number, aspectRatio: string}} 画布尺寸。
 */
function getPreviewResolution(manifest) {
  const resolution = manifest?.output?.resolution || {};
  const defaultResolution = resolution.default || {};
  const width = Number(resolution.width || defaultResolution.width) || 1920;
  const height = Number(resolution.height || defaultResolution.height) || 1080;
  return {
    width,
    height,
    aspectRatio: getManifestAspect(manifest) || `${width}:${height}`,
  };
}

/**
 * 把原始模板画布缩放到预览 iframe 的可视区域。
 * @param {string} html 已物化的模板 HTML。
 * @param {{width: number, height: number}} resolution 模板画布尺寸。
 * @returns {string} 带预览缩放逻辑的 HTML。
 */
function injectPreviewViewport(html, resolution) {
  const style = `<style id="musedock-template-preview-style">
html{width:100vw!important;height:100vh!important;overflow:hidden!important;background:#090b10!important}
body{position:absolute!important;left:50%!important;top:50%!important;width:${resolution.width}px!important;height:${resolution.height}px!important;min-width:${resolution.width}px!important;min-height:${resolution.height}px!important;margin:0!important;transform:translate(-50%,-50%) scale(var(--musedock-preview-scale,1))!important;transform-origin:center center!important}
</style>`;
  const script = `<script id="musedock-template-preview-script">
(()=>{const fit=()=>{const scale=Math.min(window.innerWidth/${resolution.width},window.innerHeight/${resolution.height});document.documentElement.style.setProperty('--musedock-preview-scale',String(scale));};fit();window.addEventListener('resize',fit,{passive:true});})();
</script>`;
  const withStyle = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}\n</head>`) : `${style}\n${html}`;
  return /<\/body>/i.test(withStyle) ? withStyle.replace(/<\/body>/i, `${script}\n</body>`) : `${withStyle}\n${script}`;
}

/**
 * 生成前端模板选择器使用的预览元数据。
 * @param {object} manifest 模板声明。
 * @returns {object} 不暴露本地路径的预览信息。
 */
function buildTemplatePreviewDescriptor(manifest) {
  const templateId = encodeURIComponent(String(manifest?.id || ''));
  const posterPath = resolveTemplateFilePath(manifest, manifest?.preview?.poster);
  const hasPoster = Boolean(posterPath && fs.existsSync(posterPath) && fs.statSync(posterPath).isFile());
  return {
    title: String(manifest?.preview?.title || `${manifest?.name || manifest?.id || '模板'}预览`),
    poster_url: hasPoster ? `/api/config/templates/${templateId}/poster` : '',
    live_url: `/api/config/templates/${templateId}/preview`,
    sample_time_sec: Number(manifest?.preview?.sample_time_sec) || 1.2,
  };
}

/**
 * 生成模板选择器中的动态 HTML 预览。
 * @param {object} manifest 模板声明。
 * @returns {Promise<string>} 可直接返回给 iframe 的 HTML。
 */
async function buildTemplatePreviewHtml(manifest) {
  const sourcePath = resolveSourceEntryPath(manifest);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const error = new Error('模板预览源文件不存在。');
    error.code = 'TEMPLATE_PREVIEW_SOURCE_NOT_FOUND';
    throw error;
  }
  const sourceHtml = await fsPromises.readFile(sourcePath, 'utf8');
  const html = materializeTemplate(
    sourceHtml,
    getPreviewVariables(manifest),
    getPreviewDurationSec(manifest),
    { preview: true },
  );
  return injectPreviewViewport(html, getPreviewResolution(manifest));
}

/**
 * 解析已声明且真实存在的模板封面。
 * @param {object} manifest 模板声明。
 * @returns {string} 封面绝对路径，不存在时返回空字符串。
 */
function resolveTemplatePosterPath(manifest) {
  const posterPath = resolveTemplateFilePath(manifest, manifest?.preview?.poster);
  if (!posterPath || !fs.existsSync(posterPath) || !fs.statSync(posterPath).isFile()) return '';
  return posterPath;
}

module.exports = {
  buildTemplatePreviewDescriptor,
  buildTemplatePreviewHtml,
  getPreviewDurationSec,
  getPreviewResolution,
  getPreviewVariables,
  injectPreviewViewport,
  resolveTemplatePosterPath,
};
