# MuseDock options

Read this reference only when selecting or explaining creation, preview, and export options.

## Creation

| Field | Values | Guidance |
|---|---|---|
| `aspect_ratio` | `9:16`, `16:9`, `1:1`, `4:5` | Use `9:16` for Douyin/Shorts/Reels; `16:9` for landscape platforms. |
| `duration_sec` | 15–180 | Use the user's target; do not silently expand a 30-second request to 60 seconds. |
| `fps` | 30, 60 | 30 is the default; use 60 for motion-heavy output when longer render time is acceptable. |
| `playback_speed` | 0.1–2.0, one decimal | Sets this task's default final-export speed; use 1.0 unless the user requests a speed change. |
| `template_id` | MuseDock template ID | When set, also pass `aspect_ratio`. |
| `use_research` | boolean | Keep enabled for current facts, news, prices, policies, releases, or uncertain claims. |
| `generate_audio` | boolean | Keep enabled unless the user explicitly wants a silent video. |
| `generate_captions` | boolean | Keep enabled for social video unless explicitly disabled. |
| `auto_sfx` | boolean | Keep enabled by default; it can be adjusted later in the browser editor. |
| `tts_voice` | configured MuseDock voice | Omit to use the saved default voice. |
| `emotional_voice` | boolean | Omit to use the saved default. |

Only pass explicit overrides. MuseDock settings remain the source of default values.

## Preview and export

| Field | Values | Guidance |
|---|---|---|
| `platform` | Free platform identifier | Use the matching platform preset when the user names a platform. |
| `width` / `height` | Positive integers | Must match the project canvas; do not use export as an aspect-ratio converter. |
| `fps` | 30, 60 | Following the project FPS is preferred. |
| `playback_speed` | 0.1–2.0, one decimal | Omit to inherit the task's default export speed; tasks without one use 1.0. |
| `tail_protection` | `pad_end`, `none` | Use `pad_end` unless the user explicitly wants the original hard end. |

The final result should include the quality report. A low bitrate on a mostly static CRF17 video is not by itself proof of poor visual quality; rely on the complete report and encoding metadata.
