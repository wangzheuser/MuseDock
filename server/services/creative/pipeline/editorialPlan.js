const crypto = require('crypto');
const { extractLatinAnchors, extractNumberAnchors } = require('./evidencePack');

/**
 * 把任意值归一化为字符串。
 * @param {unknown} value 原始值。
 * @returns {string} 归一化文本。
 */
function safeString(value) {
  return String(value ?? '').trim();
}

/**
 * 把任意值归一化为字符串数组并去重。
 * @param {unknown} value 原始值。
 * @returns {string[]} 字符串数组。
 */
function stringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(safeString)
    .filter(Boolean))];
}

/**
 * 生成内容哈希。
 * @param {unknown} value 待计算内容。
 * @returns {string} SHA-256 哈希。
 */
function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/**
 * 读取 Brief 中的场景列表。
 * @param {object} brief 导演输出。
 * @returns {Array<object>} 场景列表。
 */
function getBriefScenes(brief = {}) {
  if (Array.isArray(brief?.storyboard?.scenes)) return brief.storyboard.scenes;
  if (Array.isArray(brief?.storyboard)) return brief.storyboard;
  return [];
}

/**
 * 将 Brief 归一化为唯一的 Editorial Plan。
 * @param {object} brief 导演输出。
 * @param {object} contract Creative Contract。
 * @param {object} evidencePack Evidence Pack。
 * @returns {object} Editorial Plan V2。
 */
function buildEditorialPlan(brief = {}, contract = {}, evidencePack = {}) {
  const requirements = Array.isArray(contract.must_cover) ? contract.must_cover : [];
  const claims = Array.isArray(evidencePack.claims) ? evidencePack.claims : [];
  const objectiveRequirementIds = requirements
    .filter(item => item.evidence_required !== true)
    .map(item => item.id);
  const scenes = getBriefScenes(brief).map((scene, index) => {
    const explicitRequirementIds = stringArray(scene.requirement_ids || scene.requirementIds);
    const requirementIds = [...new Set([...objectiveRequirementIds, ...explicitRequirementIds])];
    const evidenceRequired = requirementIds.some(id => requirements
      .find(requirement => requirement.id === id)?.evidence_required === true);
    const linkedClaims = evidenceRequired ? claims : [];
    return {
      ...scene,
      id: safeString(scene.id || scene.scene_id || `scene_${String(index + 1).padStart(2, '0')}`),
      order: Number(scene.order || scene.index || index + 1),
      narration_text: safeString(scene.narration_text || scene.narration || scene.voiceover || scene.script),
      requirement_ids: requirementIds,
      claim_ids: linkedClaims.map(claim => claim.id),
      source_ids: [...new Set(linkedClaims.flatMap(claim => stringArray(claim.source_ids)))],
    };
  });
  const plan = {
    version: 2,
    title: safeString(brief.title),
    summary: safeString(brief.summary),
    premise_check: safeString(brief.premise_check),
    thesis: safeString(brief.thesis),
    audience_takeaways: stringArray(brief.audience_takeaways),
    audio_direction: brief.audio_direction && typeof brief.audio_direction === 'object' ? brief.audio_direction : {},
    design_md: safeString(brief.design_md),
    scenes,
    contract_hash: safeString(contract.input_hash),
    evidence_hash: safeString(evidencePack.input_hash),
  };
  return { ...plan, input_hash: hashValue(plan) };
}

/**
 * 汇总场景中会直接展示或朗读的文本。
 * @param {object} scene Editorial 场景。
 * @returns {string} 场景可见文本。
 */
function sceneVisibleText(scene = {}) {
  return [
    scene.headline,
    scene.narration_text,
    scene.update_detail,
    scene.source_attribution,
    ...(Array.isArray(scene.evidence_points) ? scene.evidence_points : []),
    ...(Array.isArray(scene.visual_text?.keywords) ? scene.visual_text.keywords : []),
    ...(Array.isArray(scene.visual_text?.cards) ? scene.visual_text.cards : []),
  ].map(safeString).filter(Boolean).join(' ');
}

/**
 * 校验 Editorial Plan 的需求覆盖、证据引用和数字一致性。
 * @param {object} plan Editorial Plan。
 * @param {object} contract Creative Contract。
 * @param {object} evidencePack Evidence Pack。
 * @returns {object} 确定性校验结果。
 */
function validateEditorialPlan(plan = {}, contract = {}, evidencePack = {}) {
  const issues = [];
  const requirements = Array.isArray(contract.must_cover) ? contract.must_cover : [];
  const claims = Array.isArray(evidencePack.claims) ? evidencePack.claims : [];
  const sources = Array.isArray(evidencePack.sources) ? evidencePack.sources : [];
  const requirementIds = new Set(requirements.map(item => item.id));
  const claimsById = new Map(claims.map(item => [item.id, item]));
  const sourceIds = new Set(sources.map(item => item.id));
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const coveredRequirementIds = new Set(scenes.flatMap(scene => stringArray(scene.requirement_ids)));

  if (!scenes.length) issues.push({ code: 'editorial_scenes_empty', message: 'Editorial Plan 没有场景。' });
  requirements.filter(item => item.critical !== false).forEach(requirement => {
    if (!coveredRequirementIds.has(requirement.id)) {
      issues.push({
        code: 'contract_requirement_uncovered',
        requirement_id: requirement.id,
        message: `关键要求未进入脚本：${requirement.text}`,
      });
    }
  });

  scenes.forEach(scene => {
    const sceneRequirementIds = stringArray(scene.requirement_ids);
    const sceneClaimIds = stringArray(scene.claim_ids);
    const sceneSourceIds = stringArray(scene.source_ids);
    sceneRequirementIds.filter(id => !requirementIds.has(id)).forEach(id => {
      issues.push({ code: 'editorial_requirement_unknown', scene_id: scene.id, requirement_id: id, message: `场景引用了不存在的要求 ${id}。` });
    });
    sceneClaimIds.filter(id => !claimsById.has(id)).forEach(id => {
      issues.push({ code: 'editorial_claim_unknown', scene_id: scene.id, claim_id: id, message: `场景引用了不存在的 Claim ${id}。` });
    });
    sceneSourceIds.filter(id => !sourceIds.has(id)).forEach(id => {
      issues.push({ code: 'editorial_source_unknown', scene_id: scene.id, source_id: id, message: `场景引用了不存在的来源 ${id}。` });
    });

    const evidenceRequired = sceneRequirementIds.some(id => requirements
      .find(item => item.id === id)?.evidence_required === true);
    if (evidenceRequired && !sceneClaimIds.length) {
      issues.push({ code: 'editorial_claim_missing', scene_id: scene.id, message: '事实核验场景没有 Claim 引用。' });
    }
    if (evidenceRequired && !sceneSourceIds.length) {
      issues.push({ code: 'editorial_source_missing', scene_id: scene.id, message: '事实核验场景没有来源引用。' });
    }

    const linkedClaims = sceneClaimIds.map(id => claimsById.get(id)).filter(Boolean);
    sceneRequirementIds.filter(id => requirements
      .find(item => item.id === id)?.evidence_required === true)
      .filter(id => !linkedClaims.some(claim => stringArray(claim.requirement_ids).includes(id)))
      .forEach(id => {
        issues.push({
          code: 'editorial_requirement_claim_mismatch',
          scene_id: scene.id,
          requirement_id: id,
          message: `场景要求 ${id} 没有对应的 Claim 支持。`,
        });
      });
    const allowedSourceIds = new Set(linkedClaims.flatMap(claim => stringArray(claim.source_ids)));
    sceneSourceIds.filter(id => !allowedSourceIds.has(id)).forEach(id => {
      issues.push({ code: 'editorial_source_claim_mismatch', scene_id: scene.id, source_id: id, message: `来源 ${id} 不属于该场景引用的 Claim。` });
    });
    const visibleNumbers = extractNumberAnchors(sceneVisibleText(scene));
    const evidenceText = linkedClaims.map(claim => claim.text).join(' ').replace(/[\s,，]/g, '').toLowerCase();
    if (evidenceRequired) {
      visibleNumbers.filter(number => !evidenceText.includes(number)).forEach(number => {
        issues.push({ code: 'editorial_number_ungrounded', scene_id: scene.id, value: number, message: `场景数字 ${number} 没有被引用 Claim 支持。` });
      });
      extractLatinAnchors(sceneVisibleText(scene)).filter(anchor => !evidenceText.includes(anchor)).forEach(anchor => {
        issues.push({ code: 'editorial_entity_ungrounded', scene_id: scene.id, value: anchor, message: `场景实体 ${anchor} 没有被引用 Claim 支持。` });
      });
    }
  });

  return {
    success: issues.length === 0,
    issues,
    covered_requirement_ids: [...coveredRequirementIds],
    message: issues.length ? issues.map(item => item.message).join('；') : '',
  };
}

/**
 * 把 Editorial Plan 投影回旧 Brief 结构，兼容现有 TTS 和编辑器。
 * @param {object} brief 原始 Brief。
 * @param {object} plan Editorial Plan。
 * @returns {object} 兼容 Brief。
 */
function projectEditorialPlanToBrief(brief = {}, plan = {}) {
  return {
    ...brief,
    pipeline_version: 2,
    editorial_plan_hash: safeString(plan.input_hash),
    storyboard: {
      ...(brief.storyboard && !Array.isArray(brief.storyboard) ? brief.storyboard : {}),
      scenes: Array.isArray(plan.scenes) ? plan.scenes : [],
    },
  };
}

module.exports = {
  buildEditorialPlan,
  projectEditorialPlanToBrief,
  sceneVisibleText,
  validateEditorialPlan,
};
