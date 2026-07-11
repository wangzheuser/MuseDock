---
name: musedock-video
description: Generate, inspect, revise, preview, retry, and export high-quality videos through the MuseDock MCP server. Always use this skill when the user asks to make a video with MuseDock, turn a topic/article/link into a video, check a MuseDock generation task, or modify narration, captions, duration, layout, visuals, TTS, or part of an existing MuseDock video. Use the MCP tools instead of curl or direct project-file edits.
compatibility: Requires a connected MCP server named musedock and a separately running MuseDock REST service.
---

<!-- musedock-video-skill -->

# MuseDock Video

Use the `musedock` MCP server as the action layer. This skill supplies the workflow; it does not replace backend validation.

## Start every workflow

1. Confirm that tools from the `musedock` MCP server are available. Tool names may be shown with a client-specific prefix; match the semantic tool name after the prefix.
2. If the server or tools are unavailable, stop and tell the user to start MuseDock and configure its MCP server. Do not fall back to editing files, calling internal APIs with `curl`, or inventing a finished video.
3. Call `check_system` before the first create or edit operation. If the analysis model, TTS, or render environment is not ready, report the exact missing item and stop.

## Create a high-quality video

1. Treat the text sent to `create_video` as the actual creative brief, not a search query.
2. If the input is only a short topic, lacks audience/platform/angle, or makes time-sensitive claims, call `analyze_video_idea` first.
3. Present the returned questions with their available choices and always allow a custom answer. If the user explicitly asks for direct generation, choose recommended/AI-decide answers without adding another approval step.
4. Call `compose_video_prompt` with the analysis and answers. Show the complete final prompt in chat so the user can edit it unless they explicitly requested direct generation.
5. Call `create_video` with the final prompt. Pass only settings the user chose; let MuseDock use its saved defaults for omitted values.
6. For current news, releases, prices, policies, or other unstable facts, keep research enabled and pass the concise `research_query` returned by prompt composition.
7. Save the returned `workflow_id` in the conversation. Never call `create_video` again just because rendering takes time.
8. Poll `get_video` every 15–30 seconds. Stop polling when status is `done` or `failed`.
9. On failure, call `get_retry_plan`, explain the proposed recovery scope, then call `retry_video` with the returned current plan code. Do not create a replacement workflow unless the user asks.
10. On completion, report the workflow ID, final local path/download URL, resolution, FPS, quality result, and any quality issues.

Read [references/options.md](references/options.md) when mapping aspect ratio, FPS, TTS, preview, or export options.

## Edit an existing video

1. Resolve phrases such as “刚才的视频” with `list_videos`; ask only if more than one task plausibly matches.
2. Call `inspect_video` before every edit sequence. Convert “第二段” or a scene title into the returned stable `frame_id`/`scene_id`; never assume an array index remains stable.
3. Keep the returned latest revision ID and pass it as `expected_revision_id` to mutating tools whenever supported. If `REVISION_CONFLICT` occurs, inspect again and re-evaluate the requested change instead of blindly retrying.
4. For exact narration, caption, duration, template, or input changes, use `update_scene`.
5. After changing narration, call `regenerate_narration` for that scene. Do not regenerate the whole video unless the user requests it or scene-level audio cannot be reused.
6. For layout, composition, visual hierarchy, animation, or broad natural-language changes, use `propose_video_edit`. Show the affected scenes and planned changes before generating drafts unless the user explicitly authorized the full edit.
7. Use `generate_edit_drafts` to create non-destructive drafts. Poll `get_operation` every 15–30 seconds until it finishes.
8. For every generated draft, call `create_scene_preview` with its `frame_id` and `draft_id`. Review the returned video path and layout QA; do not claim visual success from a plan alone.
9. Inspect the project again before accepting so the revision guard reflects the newly created drafts. Use `accept_video_edit` only when every selected draft and QA result are acceptable. Otherwise use `discard_video_edit`.
10. After accepted changes, call `inspect_video` again. Resolve pending drafts, stale narration, tail risk, and blocking layout issues before export.
11. Use `create_video_preview` for a full preview, then `export_video` for the final master. Poll both through `get_operation`.
12. Report exactly which scenes changed, whether TTS was regenerated, the new revision, final output path, and technical quality result.

Read [references/editing.md](references/editing.md) for examples and recovery rules.

## Long-running MCP operations

`generate_edit_drafts`, `create_scene_preview`, `regenerate_narration`, `inspect_video_layout`, `create_video_preview`, and `export_video` return an `operation_id` immediately.

- Poll with `get_operation` every 15–30 seconds.
- Do not start the same operation twice while it is `queued` or `running`.
- If the MCP process restarted and the operation is unavailable, recover state with `inspect_video`, `get_video`, or the export list rather than assuming failure.

## Quality and safety rules

- Never bypass MuseDock QA with direct project-file or HTML edits.
- Never ask for or expose model API keys, cookies, or provider credentials through MCP.
- Never put a video file into model context as base64. Return the path or download URL.
- Do not accept a visual draft merely because generation succeeded; inspect its QA and preview.
- Do not export while there are pending drafts, stale narration audio, tail-risk scenes, or blocking layout issues.
- Preserve unaffected scenes and audio. Prefer the smallest scene-level edit that satisfies the request.
- Restoring a revision creates a new revision; explain that it does not delete later history.

## Final response

For creation, include:

- Workflow ID and final status
- Video title or topic
- Output path/download URL
- Resolution and FPS
- Quality pass/publish-ready state
- Any unresolved warning

For editing, also include:

- Changed scene IDs/titles
- Accepted or discarded plan ID
- Whether narration/TTS changed
- New revision and whether re-export completed
