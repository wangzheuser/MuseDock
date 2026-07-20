function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeSource(source = {}, now = '') {
  const discoveryChannel = safeString(source.discovery_channel);
  const sourceType = safeString(source.source_type);
  const requirementIds = Array.isArray(source.requirement_ids)
    ? source.requirement_ids.map(safeString).filter(Boolean)
    : [];
  return {
    title: safeString(source.title),
    url: safeString(source.url),
    published_at: safeString(source.published_at),
    retrieved_at: safeString(source.retrieved_at) || safeString(now),
    summary: safeString(source.summary),
    evidence: safeString(source.evidence),
    ...(discoveryChannel ? { discovery_channel: discoveryChannel } : {}),
    ...(sourceType ? { source_type: sourceType } : {}),
    ...(requirementIds.length ? { requirement_ids: requirementIds } : {}),
  };
}

async function createResearchContext({
  enabled,
  query,
  now,
  provider,
  creativeContract,
} = {}) {
  const updatedAt = safeString(now);

  if (enabled !== true) {
    return {
      status: 'disabled',
      query: '',
      sources: [],
      summary: '',
      updated_at: updatedAt,
    };
  }

  const normalizedQuery = safeString(query);

  if (typeof provider !== 'function') {
    return {
      status: 'failed',
      query: normalizedQuery,
      sources: [],
      summary: '联网研究服务未配置，请关闭联网获取最新资料后重试。',
      updated_at: updatedAt,
    };
  }

  try {
    const result = await provider({
      query: normalizedQuery,
      now: updatedAt,
      ...(creativeContract ? { creativeContract } : {}),
    });
    const sources = Array.isArray(result && result.sources)
      ? result.sources.map(source => normalizeSource(source, updatedAt))
      : [];
    const summary = safeString(result && result.summary);
    const coverage = result?.coverage && typeof result.coverage === 'object' && !Array.isArray(result.coverage)
      ? result.coverage
      : {};

    if (!summary && sources.length === 0) {
      return {
        status: 'empty',
        query: normalizedQuery,
        sources: [],
        summary: '当前检索没有返回可用素材。',
        coverage,
        updated_at: updatedAt,
      };
    }

    return {
      status: 'ready',
      query: normalizedQuery,
      sources,
      summary,
      coverage,
      updated_at: updatedAt,
    };
  } catch (error) {
    const message = safeString(error && error.message) || '未知错误';
    return {
      status: 'failed',
      query: normalizedQuery,
      sources: [],
      summary: message.startsWith('联网研究失败：') ? message : `联网研究失败：${message}`,
      updated_at: updatedAt,
    };
  }
}

module.exports = {
  createResearchContext,
  normalizeSource,
};
