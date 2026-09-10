# 白板创作阶段 0 合同

本目录对应 MuseDock 自有的 `musedock-whiteboard-phase0-v1` 合同。当前能力是主题、正文或 SRT 的内容与分镜草案、版本化修订及联合批准；批准后停在 `phase0_complete`，不代表媒体已完成。

流程参考 `srt-whiteboard-animation` 的阶段 0 规则。参考时入口 `SKILL.md` 的 SHA-256 为 `08c007f42ce65edbbe823fcdd4eeec628e7f28b819aaf30f2275d8db05ab8ebd`；六个视觉模板的 ID 与名称来自其 `scripts/visual_style_presets.py`，文件 SHA-256 为 `e1b003d84b10098beb1e43906eddfc4b85edeed276b78fff10e70aa5f045f415`。

本次没有复制上游执行脚本、媒体、字体或画笔资产，也不依赖用户机器上的 Skill 目录。画面描述规则和候选 schema 由本仓库版本化；与上游完整媒体 schema 的适配属于后续阶段，不能直接将阶段 0 草案当作正式音频、图片或渲染输入。

模型只返回固定 schema 的 candidate，不接收文件写入、审批或媒体工具。服务端创建独立 attempt，最多进行一次结构补正；正式产物及批准由确定性服务校验并写入。请求结果不明时停在 `unknown_external_outcome`，普通重试不可重新发起外部请求。
