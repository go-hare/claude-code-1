# densable 2.1.236 · alignment board

> Living board · 2026-08-29 · **no auto commit** · SEA `/tmp/official-236/plat/package/claude`  
> Scope: checklist **#1–#33** · invent-ban intact · Batch A/B/C **done** · `#6`/`#7`/`#9` HAVE · GAP **0**  
> 计数以 `official-236-checklist.md` 为准：HAVE **22** / PARTIAL **10** / N/A **1**

## Status

| Phase | State |
| ----- | ----- |
| SEA pack | **done** |
| Fan-out dig/map | **done** |
| Synthesis | **done** — HAVE **22** / PARTIAL **10** / GAP **0** / N/A **1** |
| Implement | **Batch A/B/C done** |

## Counts

| HAVE | PARTIAL | GAP | N/A |
| ---- | ------- | --- | --- |
| 22 | 10 | 0 | 1 |

## HAVE（22）

| # | key |
| - | --- |
| 1 | ANTHROPIC_DEFAULT_MODEL |
| 6 | model-picker-height（`LFh`/`sgM`；无 XKl → ngM=0） |
| 7 | sendmessage-malformed-tag（`vMi`/`U4f`） |
| 9 | fullscreen-resize-message（Project C `Axc`/`xxc`/`frameSink`） |
| 2 | notify_when_idle |
| 3 | sandbox-wildcard-deny |
| 5 | fullscreen-fallback |
| 8 | subprocess-unhandled |
| 12 | tmux-title |
| 13 | cloud-env-empty |
| 14 | fable5-credits-rc |
| 15 | guest-pass-malformed |
| 16 | skills-hot-reload-cwd |
| 17 | self-hosted-runner |
| 19 | recap-cap |
| 20 | startup-session-counter |
| 21 | auto-mode-monitor |
| 22 | auto-mode-bedrock-defaults |
| 23 | status-showUntrackedFiles |
| 25 | goal-idle-checkin（HAVE；tip invent: empty-clear + arm gen） |
| 26 | usage-credits-row |
| 30 | sendmessage-burst |

## PARTIAL（10）

`#4` cwd-removed · `#10` fullscreen-blank-band · `#11` managed-settings-prompt（NMs 产品面未单宿主，禁止抬 HAVE） · `#18` clawd-eyes（gold-weak） · `#24` model-picker-highlight（gold-weak） · `#27` sigterm-print · `#28` slash-typo-enter · `#29` rc-offline-seconds · `#31` title-chip-align（gold-weak） · `#32` footer-right-margin（gold-weak）

## GAP

— none —

## N/A

| # | key | 原因 |
| - | --- | ---- |
| 33 | vscode-a11y | invent-ban：VSCode 宿主 screen-reader |

## Numbering / invent-ban

Official release has **33** bullets (#1–#33). Do **not** invent gateway / Desktop·cloud handoff / storageV5 / fold **237**.

### #9 fullscreen-resize（HAVE · Project C 已落）

- **金标基准**：densable **2.1.239** SEA（`Axc`/`xxc`/`Qvt`；`q$0=100` / `uyn=1e4` / `dyn=4`）。
- **tip**：`axc.ts` + `useAxcFrameSink` + `serializeGapBackfill` 合同齐。alt fullscreen 仍 `resetFramesForAltScreen`（densable 亦在 alt **suspend Axc**）；主屏 sticky 默认 OFF。
- **禁止**：把 pending 折进 xxc `'tick'`；invent `dropSubtreeCache`；把 Axc 硬塞 alt `handleResize`。
- 证据：`official-236-checklist.md` #9。
