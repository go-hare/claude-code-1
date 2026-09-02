# densable 2.1.235 alignment board

> Living progress · go-hare tip · densable SEA `2.1.235` · **no auto commit**

## Counts

| HAVE | PARTIAL | GAP | UNKNOWN | N/A |
| ---- | ------- | --- | ------- | --- |
| **15 + analog 3** | **0** | **0** | **0** | **1** |

## Landed (HAVE)

| # | Item | Evidence |
| - | ---- | -------- |
| 1 | spellcheck underline-as-you-type | settings.spellcheck + spellcheck/* + PromptInput · `spellcheckProtocol.235` / `spellcheckSettings.235` |
| 2 | LSP `hasEverConnected` latch | manager GUr sticky + LSPTool.isEnabled + lpT · `hasEverConnected.235.test.ts` |
| 3 | md-list OIl=32 + hanging | ANSI `LIST_INDENT_CAP`/`listIndent` + Ink `MarkdownList` WIl/n6T · `markdownList.235.test.ts` |
| 4 | highlight multiline shift | ShimmeredInput / HighlightSegmenter |
| 5 | Shift+Tab comment `ERg` | resolveConfirmCycleModeAction + MODE_CYCLE_KEY + confirm shortcut · `confirmCycleMode.235.test.ts` |
| 6 | Agent `AVo` GP unavailable | Abf omit-gate + `tengu_feature_bad` pe taxonomy |
| 7 | notebook preview `contentWithheld` | notebookPermissionPreview + FilePermissionDialog · `*235*` |
| 8 | slash/local-command `oX` unescape | unescapeXmlEntities + UserLocal/Bash/Command · `unescapeXmlEntities.235.test.ts` |
| 9 | update-footer failureHint | classifyNpmInstallFailure + mergeAutoUpdaterResult + footer/Notifications · `autoUpdaterFailureHint.235.test.ts` |
| 10 | tasklist expand persist | GlobalConfig.showExpandedTodos |
| 11 | cloud CPU delta/same-ref | **HAVE (analog)** — RemoteAgentTask same-ref skip；changelog ≠ SEA 金标函数 |
| 12 | suppressAlwaysAllowRule | **HAVE (analog)** — consumer/strip 在；235 无独立 SEA producer。239 leftover Artifact **生产**赋值 |
| 13 | embedded/vendor ripgrep | **HAVE (analog)** — fail-fast 1:1；sidecar **15.0.x** ≠ SEA argv0 `rg 14.1.1` |
| 14 | compact-off `/config` | RPa + ZOl PTL · `*235*` |
| 15 | vim `savedCursorOffset` | promptInputCursorStore acf/Oyr/RgE + PromptInput remount · `promptInputCursorStore.235.test.ts` |
| 16 | dialog `getFocusedValue` | C4i sync bag + accept live read · `getFocusedValue.235.test.tsx` |
| 17 | SendMessage `message_too_large` | X1r + UdsMessageTooLargeError |
| 18 | `claude rc` enterprise-gateway | getBridgeDisabledReason parity |

## Analog residual（仍计 HAVE，不是 silent 1:1）

- **#11** changelog 非 SEA 字面
- **#12** 235 无独立 SEA producer；239 leftover Artifact 已生产赋值
- **#13** sidecar ≠ SEA argv0 embed

## PARTIAL

—（无）

## Next

1. #19 keep N/A
2. 等「提交」再 commit（禁止自动提交 / bump）

## Explicit non-claims

- #19 VSCode host N/A
- no invent enterprise gateway / Desktop-only surfaces
- #7 remoteWorkspace UI path not invented (helper API only)
- #12 does not invent artifact/MCP ask producers beyond consumer/accept strip
- #8 is display oX only — not artifact decodeHtmlEntities/TDr
- #5 densable ERg collapses open comment first (does **not** invent acceptFeedback on accept-session)
- #1 project/local spellcheck block ignored (do not invent)
- #13 **HAVE**：本地 rg **15.0.x 新于** SEA **14.1.1**（**禁止**降级）；sidecar vs SEA argv0 embed / 不移植 `N4Grep*` / 不 invent JS fail-fast 仅为打包笔记，**不挡 HAVE**
