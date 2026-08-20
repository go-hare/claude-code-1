# densable 2.1.235 · go-hare alignment

> Living board · SEA `2.1.235` · **no auto commit** · 2026-08-20

## Counts

| HAVE | PARTIAL | GAP | UNKNOWN | N/A |
| ---- | ------- | --- | ------- | --- |
| **18** | **0** | **0** | **0** | **1** |

## Status by item

| # | Item | Status |
| - | ---- | ------ |
| 1 | spellcheck underline-as-you-type | HAVE |
| 2 | LSP `hasEverConnected` | HAVE |
| 3 | md-list OIl + hanging | HAVE |
| 4 | highlight multiline shift | HAVE |
| 5 | Shift+Tab ERg collapse | HAVE |
| 6 | Agent `AVo` GP unavailable | HAVE |
| 7 | notebook `contentWithheld` | HAVE |
| 8 | slash `oX` unescape | HAVE |
| 9 | update-footer failureHint | HAVE |
| 10 | tasklist expand persist | HAVE |
| 11 | cloud CPU delta/same-ref | HAVE |
| 12 | `suppressAlwaysAllowRule` | HAVE |
| 13 | embedded/vendor ripgrep | **HAVE** |
| 14 | compact-off `/config` | HAVE |
| 15 | vim `savedCursorOffset` | HAVE |
| 16 | dialog `getFocusedValue` | HAVE |
| 17 | SendMessage `message_too_large` | HAVE |
| 18 | `claude rc` enterprise-gateway | HAVE |
| 19 | VSCode host focus | N/A |

## #13 HAVE（加强说明）

**产品面（挡 HAVE 的门槛）**
- sidecar microsoft/ripgrep-prebuilt **v15.0.1** → 报 `15.0.0 rev 3a612f88b8`
- **本地 15.0.x 新于 SEA embed 14.1.1**（故意不降级）
- `-m/-A/-C` + pathological fail-fast 行为探针 1:1
- densable `rejectOnInputError` / `RipgrepUsageError` (YTm/iaT) 已接线 Grep+Glob
- tests: `embeddedRipgrep.235` + `ripgrepUsageError.235`

**Non-blocking packaging 笔记（不降级 HAVE）**
- go-hare 用 sidecar，不做 SEA 式 Mach-O argv0 embed
- SEA-only `N4Grep*` 不移植
- 不 invent JS regex engine

用户确认「比官方新 / 打包差异不是问题」→ **HAVE**。

## Verification

- focused #1+#13: **27 pass / 0 fail**
- full `*235*`: **114 pass / 0 fail** (20 files)
- #13 状态：**HAVE**（产品门 + 版本更新；packaging 仅笔记）

## Remaining

| Status | Items |
| ------ | ----- |
| GAP | — |
| N/A | #19 VSCode host |

## Extra (not checklist row)

| Item | Status | Notes |
| ---- | ------ | ----- |
| CLI IDE bridge `uSm` / vscodeSdkMcp | **HAVE** | 14 gates + RnT + log_event + print options；verify **PASS**；`gold-vscode-ide-bridge.txt`；#19 仍 N/A |
| CLI SDK host（全交互面） | **HAVE / MATCH** | 用户「全部 跟 sdk 交互的」+「要 1:1」：control/uSm + **HIn meadow** + **vNh announcements**；GAP 0；`gold-cli-sdk-host.txt` |

## In flight

- 等「提交」再 Conventional Commit（**禁止**自动 commit/bump）
- 全量 `bun test` 仍有少量无关脆测（tui/otel/autoModeReset/#7 等）— 非本 land 阻塞；tsc 0

## Non-claims

- no invent gateway / VSCode host
- #8 ≠ artifact `decodeHtmlEntities`
- #5: open comment → **collapse only**
- #1: project/local spellcheck block ignored
- #13: **HAVE**；本地 rg 新于 SEA；sidecar≠embed 仅为笔记
- CLI IDE bridge HAVE ≠ #19 HAVE
- Do **not** commit until「提交」
