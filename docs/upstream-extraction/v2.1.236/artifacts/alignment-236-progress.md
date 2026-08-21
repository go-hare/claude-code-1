# densable 2.1.236 · Alignment Progress

> 2026-08-20 · SEA `2.1.236` · tip baseline **2.1.235 / npm 2.7.45** · **no auto commit/bump**  
> 口径：**加强升档 + 其余与 SEA 1:1** · Batch A/B/C **done** · GAP **0**

## Status

| Phase | State |
| ----- | ----- |
| SEA pack | **done** — `/tmp/official-236/plat/package/claude` · sha256 `6bc4ba992d…` · 317044624 B |
| Changelog / checklist | **updated** — HAVE **19** / PARTIAL **13** / GAP **0** |
| Dig / map | **done** |
| Implement | **Batch A+B+C done** |

## Counts

| HAVE | PARTIAL | GAP | N/A | UNKNOWN |
| ---- | ------- | --- | --- | ------- |
| **19** | **13** | **0** | **1** (#33) | **0** |

### HAVE（19）

| # | key |
| - | --- |
| 1 | ANTHROPIC_DEFAULT_MODEL |
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
| 25 | goal-idle-checkin |
| 26 | usage-credits-row |
| 30 | sendmessage-burst |

### PARTIAL（13）

`#4` `#6` `#7` `#9` `#10` `#11` `#18` `#24` `#27` `#28` `#29` `#31` `#32`

- `#18/#24/#31/#32`：SEA hit `found:false`/weak — **PARTIAL**（gold-weak，invent-ban，不硬造 UI 修复）

### GAP

— none —

### N/A

`#33` VSCode host a11y — invent-ban

## Batch A landed

`#1` `#15` `#19` `#21` `#23`

## Batch B landed

- `#13` `#14` — MIS environments + fable `dialog_unanswered`
- `#5` — fullscreen boot canary / crashAutoOff / sticky
- `#30` — UDS outbound `sentInBurst` refuse-before-send
- `#2` — `notify_when_idle` + `peer_idle_notice`
- artifact: https://cloud-artifacts.claude-code-best.win/30d/weO9IlabzJ3jmpy4FgN_U.html

## Batch C landed

- `#17` self-hosted-runner inFlight / ordered release / shutdown
- `#26` Usage credits Team/Enterprise + `formatUsageCreditsAmount`
- `#22` DO_NOT_TRACK + KIt + KD→qTa severityByModel
- `#18/#24/#31/#32` gold-weak → PARTIAL

## precheck

- **`12044 pass / 21 skip / 0 fail`**（1169 files）· typecheck/biome 绿（审查 C1+I1–I7 修后）
- 污染清零：`environments.malformed.236` snapshot、MagicDocs `readFileBytes`、tip/uds/vscode/rateLimit/surfacePick restore、**`quotaAutoResume.234` live-namespace 假 restore**、KdQta/GitStatus/vscodeSdkMcp/fullscreen analytics restore

## Next

1. **审查 C1+I1–I7 已修 + verification PASS**（未 commit）— https://cloud-artifacts.claude-code-best.win/30d/8hM_HxRGrEJYzyznTAsUJ.html
2. residual 仍：`#30` Ola·Dla、`#2` hold-policy、`#14` Fo/Wlt、gold-weak UI；I1 tip 无 `bt/E5d`（errno 收窄，不 invent）
3. **no auto commit / push / bump** until explicit

## Residual landed（未 commit）

- `#14` `dialog_queued_at_park`：SEA `J1t`/`xo` 已接线；**I2** 起 park timeout 亦仅 `xo`（`Ns=xo&&On>0`）；Fo/Wlt 未 invent
- **审查 fix（C1+I1–I7）已落地**：bare-name pure idle；parent_aborted→aborted_streaming；QHr 收窄；fullscreen `$a`/await/status；bridge/tcp+notify 分离

Board: `docs/upstream-extraction/v2.1.236/boards/alignment-236.md`  
Checklist: `docs/upstream-extraction/v2.1.236/official-236-checklist.md`
