const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * MuseDock REST 请求错误。
 */
export class MuseDockApiError extends Error {
  /**
   * @param {string} message 中文错误信息。
   * @param {{status?:number,code?:string,data?:object}} details 错误详情。
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'MuseDockApiError';
    this.status = Number(details.status || 0);
    this.code = String(details.code || '');
    this.data = details.data || null;
  }
}

/**
 * 校验并标准化 MuseDock 服务地址。
 * @param {string} value 服务地址。
 * @returns {string} 无尾斜杠地址。
 */
export function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('MUSEDOCK_BASE_URL 只支持 http 或 https。');
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * 创建调用现有 MuseDock REST 服务的客户端。
 * @param {{baseUrl?:string,fetchImpl?:Function,timeoutMs?:number}} options 客户端选项。
 * @returns {object} MuseDock API 客户端。
 */
export function createMuseDockApiClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.MUSEDOCK_BASE_URL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || process.env.MUSEDOCK_MCP_HTTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境不支持 fetch。');

  /**
   * 请求 JSON 接口并保留后端中文错误。
   * @param {string} pathname API 路径。
   * @param {{method?:string,body?:object}} requestOptions 请求选项。
   * @returns {Promise<object>} JSON 响应。
   */
  async function request(pathname, requestOptions = {}) {
    const method = requestOptions.method || (requestOptions.body === undefined ? 'GET' : 'POST');
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers: requestOptions.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new MuseDockApiError(
        timedOut ? 'MuseDock 请求超时，请查询任务状态后再决定是否重试。' : `无法连接 MuseDock 服务：${error.message || '网络错误'}`,
        { code: timedOut ? 'MUSEDOCK_TIMEOUT' : 'MUSEDOCK_UNREACHABLE' },
      );
    }

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new MuseDockApiError(`MuseDock 返回了无法解析的响应（HTTP ${response.status}）。`, {
          status: response.status,
          code: 'INVALID_JSON_RESPONSE',
        });
      }
    }
    if (!response.ok || data?.success === false) {
      throw new MuseDockApiError(data?.message || `MuseDock 请求失败（HTTP ${response.status}）。`, {
        status: response.status,
        code: data?.code,
        data,
      });
    }
    return data;
  }

  const id = value => encodeURIComponent(String(value || '').trim());
  const workflowPath = workflowId => `/api/creative-workflows/${id(workflowId)}`;
  const projectPath = workflowId => `${workflowPath(workflowId)}/html-video-project`;

  return {
    baseUrl,
    request,
    checkSystem: refresh => request(`/api/config/system-health${refresh ? '?refresh=1' : ''}`),
    analyzeVideoIdea: payload => request('/api/creative-workflows/guidance/analyze', { method: 'POST', body: payload }),
    composeVideoPrompt: payload => request('/api/creative-workflows/guidance/compose', { method: 'POST', body: payload }),
    createVideo: payload => request('/api/creative-workflows', { method: 'POST', body: payload }),
    listVideos: () => request('/api/creative-workflows'),
    getVideo: workflowId => request(workflowPath(workflowId)),
    getRetryPlan: workflowId => request(`${workflowPath(workflowId)}/retry-plan`),
    retryVideo: (workflowId, payload) => request(`${workflowPath(workflowId)}/retry`, { method: 'POST', body: payload || {} }),
    getProject: workflowId => request(projectPath(workflowId)),
    updateScene: (workflowId, frameId, payload) => request(`${projectPath(workflowId)}/frames/${id(frameId)}`, {
      method: 'PATCH',
      body: payload,
    }),
    proposeEdit: (workflowId, payload) => request(`${projectPath(workflowId)}/edit-plan`, { method: 'POST', body: payload }),
    generateEditDrafts: (workflowId, planId, payload) => request(`${projectPath(workflowId)}/edit-plan/${id(planId)}/run`, {
      method: 'POST',
      body: payload,
    }),
    acceptEdit: (workflowId, planId) => request(`${projectPath(workflowId)}/edit-plan/${id(planId)}/accept`, {
      method: 'POST',
      body: {},
    }),
    discardEdit: (workflowId, planId) => request(`${projectPath(workflowId)}/edit-plan/${id(planId)}/discard`, {
      method: 'POST',
      body: {},
    }),
    regenerateNarration: (workflowId, payload) => request(`${projectPath(workflowId)}/edit`, {
      method: 'POST',
      body: { type: 'tts', ...payload },
    }),
    inspectLayout: (workflowId, payload) => request(`${projectPath(workflowId)}/layout-qa`, {
      method: 'POST',
      body: payload || {},
    }),
    createFramePreview: (workflowId, payload) => request(`${projectPath(workflowId)}/render`, {
      method: 'POST',
      body: { mode: 'frame', ...(payload || {}) },
    }),
    createPreview: (workflowId, payload) => request(`${projectPath(workflowId)}/preview`, {
      method: 'POST',
      body: payload || {},
    }),
    exportVideo: (workflowId, payload) => request(`${projectPath(workflowId)}/export`, {
      method: 'POST',
      body: payload || {},
    }),
    listExports: workflowId => request(`${projectPath(workflowId)}/exports`),
    listRevisions: workflowId => request(`${projectPath(workflowId)}/revisions`),
    restoreRevision: (workflowId, revisionId) => request(`${projectPath(workflowId)}/revisions/${id(revisionId)}/restore`, {
      method: 'POST',
      body: {},
    }),
    exportFileUrl: (workflowId, exportId) => `${baseUrl}${projectPath(workflowId)}/exports/${id(exportId)}/file`,
  };
}
