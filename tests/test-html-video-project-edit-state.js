const assert = require('assert/strict');

const { buildProjectEditState } = require('../server/services/creative-video/html-video/projectEditState');

/**
 * 构造测试版本记录。
 * @param {string} id 版本 ID。
 * @param {string} createdAt 创建时间。
 * @param {string} type 变更类型。
 * @returns {object} 版本记录。
 */
function revision(id, createdAt, type) {
  return {
    id,
    created_at: createdAt,
    change: type ? { type } : null,
  };
}

/**
 * 构造测试导出记录。
 * @param {string} id 导出 ID。
 * @param {string} createdAt 创建时间。
 * @param {string} kind 导出类型。
 * @returns {object} 导出记录。
 */
function exportEntry(id, createdAt, kind = 'export') {
  return {
    id,
    kind,
    created_at: createdAt,
  };
}

{
  const state = buildProjectEditState({
    revisions: [
      revision('rev_edit', '2026-07-11T10:00:00.000Z', 'frame_inputs_patch'),
      revision('rev_render', '2026-07-11T10:00:02.010Z', 'render'),
    ],
    exports: [
      exportEntry('export_1', '2026-07-11T10:00:02.000Z'),
      exportEntry('preview_1', '2026-07-11T10:00:01.000Z', 'preview'),
    ],
  });

  assert.equal(state.latest_revision.id, 'rev_render');
  assert.equal(state.export_outdated, false);
  assert.equal(state.preview_outdated, false);
}

{
  const state = buildProjectEditState({
    revisions: [
      revision('rev_render', '2026-07-11T10:00:02.010Z', 'render'),
      revision('rev_draft', '2026-07-11T10:00:03.000Z', 'frame_html_draft'),
      revision('rev_discard', '2026-07-11T10:00:04.000Z', 'frame_html_draft_discard'),
      revision('rev_delete', '2026-07-11T10:00:05.000Z', 'delete_export'),
    ],
    exports: [exportEntry('export_1', '2026-07-11T10:00:02.000Z')],
  });

  assert.equal(state.latest_revision.id, 'rev_delete');
  assert.equal(state.export_outdated, false);
}

{
  const state = buildProjectEditState({
    revisions: [
      revision('rev_render', '2026-07-11T10:00:02.010Z', 'render'),
      revision('rev_accept', '2026-07-11T10:00:03.000Z', 'frame_html_draft_accept'),
    ],
    exports: [
      exportEntry('export_1', '2026-07-11T10:00:02.000Z'),
      exportEntry('preview_1', '2026-07-11T10:00:02.000Z', 'preview'),
    ],
  });

  assert.equal(state.export_outdated, true);
  assert.equal(state.preview_outdated, true);
}

console.log('html-video project edit state tests passed');
