# densable 2.1.235 alignment progress

Updated: 2026-08-31

## Status

| Phase | State |
| ----- | ----- |
| Changelog / GitHub body | **done** |
| densable SEA npm pack | **done** — `/tmp/official-235/plat/package/claude` · 2.1.235 · sha256 `83b8f806…` |
| Checklist HAVE/GAP | **done** — HAVE **15** + analog **3**（#11/#12/#13）/ PARTIAL **0** / GAP **0** / N/A **1** / UNKNOWN **0** |
| Implement 1:1 | **landed** CLI product **#1–#18**；**#11/#12/#13 HAVE (analog)**，不再 silent 1:1; **#19** N/A; **extra** CLI IDE bridge `uSm`/vscodeSdkMcp **HAVE**（非 #19） |

## Landed (HAVE) — verified + residual

1. **#14** compact-off `/config` — `shouldShowAutoCompactOffHint` (RPa) + ZOl assembled PTL text in `AssistantTextMessage`; nested response suppress; remoteAutocompactState hard-false; tests `shouldShowAutoCompactOffHint.235.test.ts`, `promptTooLongZOl.235.test.ts`
2. **#6** Agent `AVo` when GP unavailable — `isGeneralPurposeAvailable` (Abf) + omit gate in `AgentTool.call` / prompt branches; `tengu_subagent_type_miss` OMITTED + densable `pe` → `tengu_feature_bad{feature_name:subagent_launch,error_code:subagent_type_missing}`; `generalPurposeRequired.235.test.ts`
3. **#17** SendMessage `message_too_large` / X1r=1MiB — `MAX_UDS_LINE_CHARS` + `UdsMessageTooLargeError` (tFd en-US + em dash); send refuse + server line drop; SendMessage `errorClass` attach; `udsMessaging.lineCap.235.test.ts`
4. **#7** notebook preview failure reasons / `contentWithheld` — `notebookPermissionPreview.ts` (MG/GFt/CAa/`hasNotebookPreviewWithheldMarker`) + async `NotebookEditPermissionRequest`; exact `p` strings + em-dash messages; `FilePermissionDialog.contentWithheld` hides accept-session; `notebookPermissionPreview.235.test.ts`
5. **#12** `suppressAlwaysAllowRule` — `PermissionAskDecision.suppressAlwaysAllowRule` + `Tool.suppressesAlwaysAllowRule`; `shouldShowPersistentAllowOption` wired into Fallback/Skill/WebFetch/Monitor/Workflow/Bash/PowerShell; FilePermissionDialog `contentWithheld`/`suppressPersistentAllow` omits accept-session; accept-path `stripWholeToolGrantsForAsk` (`jze`) in `handleUserAllow` (+ interactive/swarm); tests `showAlwaysAllow.235` / `stripWholeToolGrantsForAsk.235` / `getFilePermissionOptions.235`
6. **#16** dialog `getFocusedValue` — CustomSelect C4i sync bag + `getFocusedValue()` live PFm; `selectFocusedOption` / `select:accept` / edge wrap / multi-select toggle live-read; `getFocusedValue.235.test.tsx`
7. **#8** slash/local-command display `oX` — `unescapeXmlEntities`（仅 `&amp;|&lt;|&gt;`，对齐 densable Fud/C7_）applied in `UserLocalCommandOutputMessage` / `UserBashOutputMessage` / `UserCommandMessage`；写侧 escapeXml/EHe 不 invent mass escape；**非** artifact decodeHtmlEntities/TDr。`unescapeXmlEntities.235.test.ts`
8. **#2** LSP `hasEverConnected` latch（GUr）— `manager.hasEverConnected` sticky OR over live `isLspConnected`；`LSPTool.isEnabled→hasEverConnected`；`shouldDeferLspTool`/`lpT` ever-connected 后短路；`hasEverConnected.235.test.ts`
9. **#5** Shift+Tab permission comment `ERg` — `resolveConfirmCycleModeAction`：yes/no comment 开 → 只折叠字段；否则 accept-session（**不** invent acceptFeedback 到 accept-session）；session-row shortcut=`confirm:cycleMode`；Confirmation `[MODE_CYCLE_KEY]`（Windows 无 VT → meta+m）；`confirmCycleMode.235.test.ts`
10. **#3** md-list OIl=32 + hanging — ANSI `LIST_INDENT_CAP`/`listIndent` hanging wrap + Ink `MarkdownList`（WIl/n6T flex）；G5T/MIl/DIl helpers；GFM checkbox skip；`markdownList.235.test.ts`
11. **#9** update-footer failureHint — `classifyNpmInstallFailure` + `mergeAutoUpdaterResult` + `EXE_LOCK_FAILURE_DAMP_THRESHOLD=2`；AutoUpdater/Notifications/Native footer 文案；REPL useState residual（非 densable AppState）。`autoUpdaterFailureHint.235.test.ts`
12. **#15** vim `savedCursorOffset` — densable `$4`/`acf`/`Oyr`/`RgE`：`promptInputCursorStore` + PromptInput remount restore / unmount save / NORMAL external Oyr / q4a vimMode sync。`promptInputCursorStore.235.test.ts`
13. **#1** spellcheck — densable `settings.spellcheck` + `src/utils/spellcheck/*`（protocol/tokenize/color/checker/settings/mhg）+ PromptInput underline merge。`spellcheckProtocol.235` / `spellcheckSettings.235`
14. **#13** embedded grep — **HAVE**：sidecar microsoft/ripgrep-prebuilt **v15.0.1**（`15.0.0 rev 3a612f88b8`，**新于** SEA embed `14.1.1`）`-m/-A/-C` + patho 行为 1:1；densable `rejectOnInputError`/`RipgrepUsageError`(YTm/iaT) 已接线 Grep+Glob。**禁止**降级 15→14 / **禁止** invent JS regex engine。打包 sidecar≠SEA argv0 embed / 不移植 `N4Grep*` 仅为 **non-blocking residual 笔记**。`embeddedRipgrep.235.test.ts` + `ripgrepUsageError.235.test.ts`

Also HAVE from dig/map (not this patch set): **#4** highlight-shift · **#10** tasklist expand · **#18** rc gateway. **#11** cloud CPU is **HAVE (analog)** (changelog ≠ SEA). **#12** analog 注脚（2026-09-01）：235 无独立 SEA producer；239 leftover Artifact `permissions.ts` **生产** `suppressAlwaysAllowRule:true`（不再写「生产零」）。

## Extra land (not checklist #1–#19 row)

15. **CLI IDE bridge / vscodeSdkMcp (`uSm`)** — densable 2.1.235 全量 `experiment_gates` 14 keys（`quiet_fern`/`cc_auth`/`slate_ribbon` 硬 true；cobalt miss→true；`RnT` 总写 `tengu_auto_mode_state`，`opt-in`→`enabled`）；`log_event` survey/nudge 特殊路由 + `tengu_vscode_` 前缀；`print.ts` options（`$re`/`HIn`/`vNh`/`VJg`/`Fjc`/`hUe`）；`hasSeenAutoDefaultNudge`；`file_updated` 仍 ant-only。测试 `vscodeSdkMcp.235.test.ts`。金标 `snippets/gold-vscode-ide-bridge.txt`。**#19 仍 N/A**。
16. **Quota rearm cap (`T0S`/`HEv=2`)** — 闭合 hollow：`onQuotaRejectedForAutoResume`（s0v）continuation claim + `main_thread` 429 → `consecutiveRearms++` / `$Za`/`rearmed`；`>=2` → `rearm_cap` + `cap-exhausted`；JEv `p4f=[60s,300s]`；`xxi` 同族 eligible（`yDe`/`ZWs`/`Wjo`，已纠正倒置极性）；`quotaRejected` 仅 error path；hAm bucket via `claude.ts`。金标 `snippets/gold-quota-rearm-T0S.txt`；board `boards/rearm-cap-board.md`。测试 `quotaAutoResume.234.test.ts`。

## Residual (intentional / non-blocking)

- **#14**: no settings-file `Vd(source==='userSettings')` branch until `autoCompactEnabled` persists into settings JSON; remoteAutocompactState absent.
- **#6**: throw remains plain `Error` (message 1:1), not densable `Vyt` class.
- **#17**: local wire.length check (in-meta auth) vs densable always-budget `Ddd` auth preamble; keep separate `MAX_UDS_FRAME_BYTES=64KiB` for non-messaging frames.
- **#7**: UI path passes `remoteWorkspace=false` (no invent remote gateway). Network-path gate uses `containsVulnerableUncPath(path, true)` (Windows-only; densable Qh/_u may also cover other network mounts).
- **#11 analog**: changelog 非 SEA 字面；RemoteAgentTask same-ref skip 是产品优化，不是剥出的 235 金标函数。
- **#12 analog**: consumer/UI/accept strip landed；`builtin-tools` 生产零 `suppressAlwaysAllowRule:true` / `suppressesAlwaysAllowRule`。SDK wire + remote ingress 可透传。SandboxPermissionRequest 仍走自己的 always-allow。不 invent 本地假 producer。
- **#13 analog**: fail-fast 行为 1:1；sidecar 15.0.x ≠ SEA argv0 `rg 14.1.1`。不挡产品 HAVE，也不当无注脚 1:1。
- **#16**: no VSCode #19 invent; render still uses React snapshot `focusedValue` (onFocus/UI), accept uses live getter.
- **#8**: no mass write-side escape in processSlashCommand; artifact-only decodeHtmlEntities/TDr remains separate surface.
- **#2**: process-lifetime sticky latch (no SEA reset); test-only `resetLspManagerForTests`/`setLspManagerForTests` are harness-only.
- **#5**: densable ERg collapses open comment; do not invent acceptFeedback on accept-session (dig gold).
- **#3**: marked GFM checkbox tokens skipped (densable folds into list_item.task); Ink path gated by `shouldUseInkListLayout` + screen-reader.
- **#9**: autoUpdaterResult stays REPL useState (not AppState); footer/hint behavior 1:1.
- **#15**: local `VimMode` is INSERT|NORMAL only; RgE keeps VISUAL* string collapse for SEA parity; hideVimModeIndicator / VISUAL LINE depth not invented.
- **#1**: spawn env uses `subprocessEnv()` (not densable full `tM` scrub); exit cleanup ≈ `process.once('exit')` not Ba。`fhg` overlap 已按 densable 对 **pre-merge base** 判定（互叠 spell ranges 可同留）；warn 字符串断言已锁。host 仍用 hook-local `{}`（非 PromptInput 注入 Ar.host）记 residual。
- **#13 (HAVE analog；packaging)**: 本地 vendor **15.0.x 新于** SEA **14.1.1**（故意不降级）。go-hare Mach-O 不 argv0-embed rg（sidecar）；SEA-only `N4Grep*Handler` 为 Bun embed/link 符号 — **不是**产品 GAP。`RipgrepUsageError` 是 densable input-reject 路径（非 patho-engine invent）。包装差已记账，不再写成无注脚 1:1。
- **CLI IDE bridge / SDK host**: `HIn` = harbor_willow \|\| `clientDataCache.meadow_lantern===true`；`vNh` = GB announcements top+SNh → JSON\|false；SEA 外发 ABSENT `file_updated` → 本地 ant-only；禁止把 `feedback_survey` / `sdk_stream_ended` 塞进 gates keys。
- **Quota rearm**: 不 invent `seven_day_overage_included` / storageV5 / Desktop·cloud handoff clients（仅 cancel reason）；本地 xxi family 用 `includes('opus'|'sonnet')` 近似 SEA `Wjo(entry.family)`（极性已 1:1）。

## CLI SDK host audit（用户：全部跟 sdk 交互的）

Explore + SEA strings：相对 densable 外发 SEA，**产品 GAP = 0**。
MATCH：uSm/print options、ide lock/sse-ide|ws-ide、ENTRYPOINT/tP、control `initialize`/`mcp_set_servers`、sdkClients merge→uSm、control 子类型宿主面、bridge control 族。
**1:1 residual closed**：`HIn` = harbor_willow \|\| `clientDataCache.meadow_lantern===true`；`vNh` = GB `tengu_startup_announcements` top+`SNh`/`isModelAllowed` → JSON\|false。金标 `snippets/gold-cli-sdk-host.txt` + `gold-vscode-ide-bridge.txt`。
Verification（gates land）：**PASS**；meadow/vNh 聚焦测已并入 `vscodeSdkMcp.235`（14 pass）+ tsc 0。

## Remaining

1. **#19** keep N/A（VSCode host-only）
2. 等用户「提交」再 commit / bump（**禁止**自动提交）

## Baseline

- tip densable **2.1.234** already landed · npm **2.7.44**
- densable-first 1:1 · no invent gateway/VSCode · no auto commit / no bump
