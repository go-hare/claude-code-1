# densable 2.1.236 · alignment board

> Living board · 2026-09-01 · **no auto commit** · SEA `/tmp/official-236/plat/package/claude`（再挖用 239 SEA）  
> Scope: checklist **#1–#33** · invent-ban intact · Batch A/B/C **done** · 本地对齐即 HAVE · GAP **0**  
> 计数以 `official-236-checklist.md` 为准：HAVE **32** / PARTIAL **0** / N/A **1**

## Status

| Phase | State |
| ----- | ----- |
| SEA pack | **done** |
| Fan-out dig/map | **done** |
| Synthesis | **done** — HAVE **32** / PARTIAL **0** / GAP **0** / N/A **1** |
| Implement | **Batch A/B/C done** |

## Counts

| HAVE | PARTIAL | GAP | N/A |
| ---- | ------- | --- | --- |
| 32 | 0 | 0 | 1 |

## HAVE（32）

| # | key |
| - | --- |
| 1 | ANTHROPIC_DEFAULT_MODEL |
| 6 | model-picker-height（`LFh`/`sgM`；无 XKl → ngM=0） |
| 7 | sendmessage-malformed-tag（`vMi`/`U4f`） |
| 9 | fullscreen-resize-message（Project C `Axc`/`xxc`/`frameSink`） |
| 11 | managed-settings-prompt（NMs 单宿主产品面证齐 2026-08-31） |
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
| 18 | clawd-eyes（239 `Bwg` 标准 pose；无 iTerm.app 分支） |
| 19 | recap-cap |
| 20 | startup-session-counter |
| 21 | auto-mode-monitor |
| 22 | auto-mode-bedrock-defaults |
| 23 | status-showUntrackedFiles |
| 4 | cwd-removed（IHn + `tryProcessCwd` spawn/clipboard） |
| 25 | goal-idle-checkin（Wsv 空 deferring re-arm） |
| 26 | usage-credits-row |
| 27 | sigterm-print（print + REPL `remote-cancel` + 143） |
| 28 | slash-typo-enter（`l4t`/`cie`/`UD`/`pe` + headless unavailable；不 invent `RV`/`ZZr`/`rcm`） |
| 29 | rc-offline-seconds（立刻 deregister，无 timer） |
| 30 | sendmessage-burst |
| 10 | fullscreen-blank-band（与官方 CLI 同缺独立合同） |
| 24 | model-picker-highlight（无 newest-only 机，不 invent） |
| 31 | title-chip-align（FSh/kPE + `$Ir` 单 `─`；非 footer titleChip） |
| 32 | footer-right-margin（Notifications flex-end + overlay pad；无统一 helper） |

## PARTIAL（0）

— none —

## GAP

— none —

## N/A

| # | key | 原因 |
| - | --- | ---- |
| 33 | vscode-a11y | invent-ban：VSCode 宿主 screen-reader |

## Numbering / invent-ban

Official release has **33** bullets (#1–#33). Do **not** invent gateway / Desktop·cloud handoff / `$t()`/`tn()` cloud backend / fold **237**. Local storageV5 `Rc` = `getProject()` (already wired).

### #9 fullscreen-resize（HAVE · Project C + Ink 金标都齐）

- **金标基准**：densable **2.1.239** SEA。
  - sticky 消息：`Axc`/`xxc`/`Qvt`；`q$0=100` / `uyn=1e4` / `dyn=4`。
  - **Ink 面**（不是「无金标」）：`forceRedraw(e)`、`syncTerminalSize`/`handleResize`、`resetFramesForAltScreen`。dump：`.tmp-peel-ink-resize.txt`。
- **tip**：`axc.ts` + `useAxcFrameSink` + `serializeGapBackfill` + `terminalSize.ts`（`dCi`/`pCi`）+ `ink.tsx` `syncTerminalSize`/`handleResize`/`onComputeLayout`。alt 仍 `resetFramesForAltScreen`（densable 亦 **suspend Axc**）；主屏 sticky 默认 OFF。
- **禁止**：把 pending 折进 xxc `'tick'`；invent `dropSubtreeCache`；把 Axc 硬塞 alt `handleResize`；把 Ink resize 金标折成 `#10` blank-band。
- 证据：`official-236-checklist.md` #9。

### #31 title-chip / #32 footer-right（HAVE · 金标已落）

- `#31` 不是 footer `titleChip`。239 `zRr({hideSessionTitle:FSh()})` + `$Ir`：Tasks V2 可见时藏 standalone 名/色；chip 右缘一条 `─`（= footer `paddingRight={1}`）。
- `#32` Notifications 列 `flex-end` + `flexShrink:1` + overlay `paddingLeft:2, paddingRight:1`。无统一 helper。
- **禁止**：invent `titleChip` / prideGradient / newest-only / 第二套 right-margin 函数。
