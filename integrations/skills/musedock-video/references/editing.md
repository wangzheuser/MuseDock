# MuseDock editing examples

Read this reference when the user requests a partial edit or when an edit operation fails.

## Exact narration edit

User: “把第三段旁白改得更通俗，其他内容不变。”

1. `inspect_video`
2. Resolve the third scene to its stable `frame_id`.
3. `update_scene` with only `narration_text` and `expected_revision_id`.
4. `regenerate_narration` for that frame.
5. Poll `get_operation`.
6. `inspect_video` again and verify stale narration/tail risk are clear.
7. Preview and export only if requested.

## Visual structure edit

User: “第二段信息太密，改成左右对比，但不要改旁白。”

1. `inspect_video`
2. `propose_video_edit` with the resolved frame ID and the explicit “do not change narration” constraint.
3. Explain affected frames.
4. `generate_edit_drafts`
5. Poll `get_operation`.
6. Call `create_scene_preview` for each generated `frame_id` and `draft_id`.
7. Review each preview path and layout QA result.
8. Call `inspect_video` again to obtain the latest revision.
9. `accept_video_edit` or `discard_video_edit`.
10. Preview and export.

## Conflict recovery

If a mutating tool returns `REVISION_CONFLICT`:

1. Call `inspect_video` again.
2. Compare the user's requested change with the latest scene state.
3. Rebuild the smallest patch against the new revision.
4. Do not overwrite unrelated browser edits.

## Failed background operation

- Read `get_operation.error` and report its backend code.
- For TTS failure, the edited text may already be saved; inspect before retrying.
- For layout failure, keep the draft and either revise the instruction or discard it.
- For export failure, inspect project state and existing exports before starting another export.
