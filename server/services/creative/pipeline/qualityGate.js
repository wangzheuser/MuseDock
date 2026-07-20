const { validateEditorialPlan } = require('./editorialPlan');

/**
 * 把任意值归一化为数组。
 * @param {unknown} value 原始值。
 * @returns {Array<unknown>} 数组。
 */
function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 判断布局问题是否会阻断发布。
 * @param {object} issue 布局问题。
 * @returns {boolean} 是否阻断。
 */
function isBlockingLayoutIssue(issue = {}) {
  const severity = String(issue.severity || '').toLowerCase();
  if (['info', 'warning'].includes(severity)) return false;
  return severity === 'error'
    || severity === 'blocking'
    || /overlap|overflow|safe_zone|unreadable|tiny_text|遮挡|溢出|不可读/.test(String(issue.code || issue.type || issue.message || '').toLowerCase());
}

/**
 * 从项目结果中收集布局问题。
 * @param {object} projectStageResult 工程阶段结果。
 * @returns {Array<object>} 去重后的布局问题。
 */
function collectLayoutIssues(projectStageResult = {}) {
  const hyperframes = projectStageResult.hyperframes_freeform || {};
  const project = hyperframes.project || projectStageResult.project || {};
  // 历史失败报告用于审计，发布门禁只认最近一次复检结果。
  const latestReport = arrayOrEmpty(project.layout_qa_reports)
    .slice()
    .sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0))[0];
  const issues = [
    ...arrayOrEmpty(project.layout_qa?.issues),
    ...arrayOrEmpty(hyperframes.layout_qa?.issues),
    ...arrayOrEmpty(hyperframes.visual_inspect?.issues),
    ...arrayOrEmpty(latestReport?.issues),
  ];
  const seen = new Set();
  return issues.filter(issue => {
    const key = JSON.stringify([issue.code, issue.type, issue.frame_id, issue.message, issue.user_message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 汇总所有发布门禁，唯一计算 publish_ready。
 * @param {object} input QA 输入。
 * @returns {object} QA Report V2。
 */
function buildQualityReport({ contract = {}, evidencePack = {}, editorialPlan = {}, productionSpec = {}, projectStageResult = {} } = {}) {
  const editorial = validateEditorialPlan(editorialPlan, contract, evidencePack);
  const missingEvidence = arrayOrEmpty(evidencePack?.coverage?.missing_critical_requirement_ids);
  const layoutIssues = collectLayoutIssues(projectStageResult);
  const blockingLayoutIssues = layoutIssues.filter(isBlockingLayoutIssue);
  const hyperframes = projectStageResult.hyperframes_freeform || {};
  const project = hyperframes.project || projectStageResult.project || {};
  const readyForEdit = project.ready_for_edit === true || hyperframes.ready_for_edit === true;
  const renderStatus = String(hyperframes.render?.status || '').toLowerCase();
  const inspectStatus = String(hyperframes.visual_inspect?.status || '').toLowerCase();
  const timingApplicable = productionSpec.timing_status !== 'not_applicable';
  const timingPassed = !timingApplicable || productionSpec.timing_status === 'ready';
  const technicalPassed = Boolean(
    project.html_video_project_path
    || project.project_dir
    || hyperframes.html_video_project_path
    || hyperframes.project_dir,
  )
    && !['failed', 'error'].includes(renderStatus)
    && !['failed', 'error'].includes(inspectStatus);
  const exported = ['rendered', 'done', 'exported'].includes(renderStatus) && readyForEdit !== true;
  const checks = {
    contract_coverage: {
      passed: editorial.issues.every(issue => issue.code !== 'contract_requirement_uncovered'),
      issues: editorial.issues.filter(issue => issue.code === 'contract_requirement_uncovered'),
    },
    factual_grounding: {
      passed: missingEvidence.length === 0 && editorial.success,
      missing_requirement_ids: missingEvidence,
      issues: editorial.issues.filter(issue => issue.code !== 'contract_requirement_uncovered'),
    },
    narration_timing: {
      passed: timingPassed,
      target_duration_sec: productionSpec.target?.duration_sec || 0,
      actual_duration_sec: productionSpec.actual_duration_sec || 0,
      deviation_ratio: productionSpec.duration_deviation_ratio || 0,
    },
    layout: {
      passed: blockingLayoutIssues.length === 0,
      issues: layoutIssues,
      blocking_issues: blockingLayoutIssues,
    },
    technical: {
      passed: technicalPassed,
      render_status: renderStatus,
      inspect_status: inspectStatus,
    },
  };
  const allChecksPassed = Object.values(checks).every(check => check.passed === true);
  return {
    version: 2,
    checks,
    passed: allChecksPassed,
    publish_ready: allChecksPassed && exported,
    needs_review: !allChecksPassed || !exported,
  };
}

/**
 * 根据稳定产物和 QA 计算产品状态。
 * @param {object} input 状态输入。
 * @returns {string} 产品状态。
 */
function resolveProductStatus({ evidencePack = {}, editorialPlan = {}, productionSpec = {}, qualityReport = {} } = {}) {
  if (arrayOrEmpty(evidencePack?.coverage?.missing_critical_requirement_ids).length) return 'research_incomplete';
  if (!arrayOrEmpty(editorialPlan.scenes).length) return 'draft';
  if (!arrayOrEmpty(productionSpec.scenes).length) return 'planned';
  if (qualityReport.publish_ready === true) return 'publish_ready';
  if (qualityReport.passed === true) return 'editable';
  return 'needs_review';
}

module.exports = {
  buildQualityReport,
  collectLayoutIssues,
  isBlockingLayoutIssue,
  resolveProductStatus,
};
