# densable 2.1.235 — 官方更新清单 × go-hare 对照

> 来源：GitHub release **v2.1.235**（2026-08-18T20:38:54Z）+ densable SEA darwin-arm64。  
> SEA：`/tmp/official-235/plat/package/claude` · `2.1.235 (Claude Code)` · size **313334608** · sha256 `83b8f806f6f2eea316cfe246628e6c23374711d868f1fd0409db551b877b7748`。  
> 基线：本地 tip densable **2.1.234**（quota auto-resume 等已有）+ npm **2.7.44**。**本 pack 只对齐 2.1.235**（勿折入 234 residual）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 约定：**extract densable first → 1:1**。不 invent gateway / VSCode host。不自动 commit/push/bump。  
> 更新：2026-08-20 — #13 升 **HAVE**（本地 rg **15.0.x 新于** SEA **14.1.1**；sidecar 打包仅为 non-blocking 笔记）：HAVE **18** / PARTIAL **0** / GAP **0** / N/A **1** / UNKNOWN **0**。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.234** | quota auto-resume / selection:clear / GitLab MR badge / NT-namespace… | tip **已有**（邻版笔记见 `changelog-2.1.234-neighbor.md`） |
| **2.1.235** | spellcheck / LSP cache latch / md list / highlight / Shift+Tab comment / Agent GP 门 / notebook 预览 / slash HTML / update footer / tasklist expand / cloud CPU / perm grant / embedded grep / compact-off / vim preserve / dialog race / SendMessage size / rc gateway / VSCode focus · **19 条** | **本 pack** |

## 当前计数（2026-08-20）

| 状态 | 条数 | 说明 |
| ---- | ---- | ---- |
| **HAVE** | **18** | #1 spellcheck · #2 LSP · #3 md-list · #4 highlight · #5 Shift+Tab · #6 AVo · #7 notebook · #8 oX · #9 update-footer · #10 tasklist · #11 cloud CPU · #12 suppressAlways · #13 embedded grep（15.0.x **新于** SEA 14.1.1）· #14 compact-off · #15 vim · #16 getFocusedValue · #17 message_too_large · #18 rc gateway |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **N/A** | **1** | #19 VSCode host-only focus jump |
| **UNKNOWN** | **0** | 全量已分类 |

> densable-first：有 SEA 金句/符号才标 HAVE/PARTIAL/GAP；#19 宿主面明确 invent-ban。

## densable 关键符号（SEA → 本地）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `settings.spellcheck` / `vKe=[aspell,hunspell,ispell]` / `input_spellcheck` | 可选 underline-as-you-type 拼写检查 | **HAVE** — schema + protocol/tokenize/color/checker + useSpellcheckHighlights |
| `hasEverConnected` / `GUr` / `LSPTool.isEnabled` latch | mid-session LSP disconnect 不整段 cache break | **HAVE** — manager latch + LSPTool.isEnabled + lpT short-circuit |
| `listDepth` / `listIndent` / `OIl=32` / hanging wrap `WIl`/`n6T` | 嵌套列表 depth 3+ + hanging indent | **HAVE** — ANSI list_item hanging + LIST_INDENT_CAP=32 + Ink MarkdownList (WIl/n6T) |
| `HighlightedInput` multiline `Eeo+1` / `visiblePos`/`stringPos` | 多行 prompt highlight 偏移 | **HAVE** — ShimmeredInput + HighlightSegmenter |
| `confirm:cycleMode` / `ERg` collapse / Dnp meta+m | Shift+Tab 在 comment 开时折叠字段；否则 accept-session | **HAVE** — resolveConfirmCycleModeAction + confirm shortcut + MODE_CYCLE_KEY |
| `AVo` / `Abf` / `Vyt` / `tengu_subagent_type_miss` OMITTED | 省略 subagent_type 且 GP 不可用 → 明确错误 | **HAVE** — constants + generalPurposeAvailability + call/prompt |
| `B7S`/`Jqn` / `contentWithheld` / notebook preview `p` reasons | notebook delete/replace 说明为何不可审 | **HAVE** — notebookPermissionPreview + FilePermissionDialog.contentWithheld |
| `oX`/`C7_`/`Fud` unescape `&amp;|&lt;|&gt;` | mid-turn slash/local-command 显示实体 | **HAVE** — unescapeXmlEntities + User* display |
| `Update installed · Restart to apply/update` / `autoUpdaterResult` / failureHint | bg auto-update footer | **HAVE** — failureHint 已落地；REPL useState residual（非 AppState） |
| `showExpandedTodos` ↔ `expandedView` seed/persist | ctrl+t 恢复会话不再总折叠 | **HAVE** — GlobalConfig + main seed + onChangeAppState |
| `/ultrareview` `/autofix-pr` + delta poll / same-ref skip | cloud bg 事件流勿每更新重扫重渲 | **HAVE** — RemoteAgentTask polling + updateTaskState |
| `PermissionAskDecision.suppressAlwaysAllowRule` | don't-ask-again 与 grant 覆盖一致；无法完整展示则 withhold | **HAVE** — ask field + Tool.suppressesAlwaysAllowRule + showAlwaysAllow + stripWholeToolGrantsForAsk + contentWithheld |
| SEA embed `rg 14.1.1` / local vendor `15.0.0` + `after_context_left` | embedded/sidecar ripgrep 病态 fail-fast + `-m`/`-A/-C` | **HAVE** — 本地 **15.0.x 新于** SEA；行为 1:1 + `RipgrepUsageError`；sidecar≠argv0 仅笔记；**禁止**降级；`embeddedRipgrep.235` / `ripgrepUsageError.235` |
| ` · auto-compact is off · /config to turn it on` / `RPa` | context-limit 提示 autocompact off | **HAVE** — ZOl + shouldShowAutoCompactOffHint |
| `savedCursorOffset` / `acf` / `RgE`/`Oyr` + `app:toggleTranscript` | vim NORMAL+cursor 跨 ctrl+o 保留 | **HAVE** — promptInputCursorStore + PromptInput remount/unmount |
| `getFocusedValue` / `o.state` sync bag / `selectFocusedOption` live read | dialog 方向键+Enter 同 tick 选导航项 | **HAVE** — C4i bag + getFocusedValue + accept live read |
| `X1r=1048576` / `tFd` / `message_too_large` | SendMessage 过大 upfront refuse | **HAVE** — MAX_UDS_LINE_CHARS + UdsMessageTooLargeError |
| `vqo=getBridgeDisabledReason` / `mib`+`Glt(Og())` gateway | `claude rc` 同 interactive enterprise-gateway 门 | **HAVE** — cli.tsx + bridgeEnabled + remoteControlEndpointReason |
| `claude-vscode` / ABSENT preserveFocus/WebviewPanel… | VS Code 多 tab focus 乱跳 | **N/A** — 宿主扩展；CLI SEA 无 host API |

## 全量对照（19 条）

| # | 官方条目（摘要） | 状态 | 本地备注 |
| - | ---------------- | ---- | -------- |
| 1 | optional `spellcheck`（aspell/hunspell/ispell underline-as-you-type） | **HAVE** | densable `settings.spellcheck` + `vKe`/`hs_`/`zTu`/`qTu`/`WTu`/`GTu`/`lhg`/`mhg`/`fhg`/`ihg`。本地 `src/utils/spellcheck/*` + PromptInput merge + TextHighlight.underline。user/flag/managed 整块优先；project/local 忽略告警。residual：spawn env 用 `subprocessEnv()`（非 densable `tM` 全量 scrub）；cleanup 用 `process.once(exit)` 近似 Ba。`spellcheckProtocol.235.test.ts`。snippet `hit-spellcheck.txt` |
| 2 | LSP disconnect/reconnect 整段 prompt-cache 失效 | **HAVE** | densable：`LSPTool.isEnabled` latch `hasEverConnected`（GUr）；live `isConnected` 分离；`lpT` 在 ever-connected 后短路，避免 toolSchemasChanged→`tengu_prompt_cache_break`。本地 `manager.hasEverConnected` sticky + `LSPTool.isEnabled→hasEverConnected` + `shouldDeferLspTool` 短路；`hasEverConnected.235.test.ts`。snippet `hit-lsp-cache.txt` |
| 3 | nested markdown list depth 3+ + hanging indent | **HAVE** | densable OIl=32 + ANSI `list_item` hanging (`listIndent`/`MIl`/`G5T`) + Ink `MarkdownList`（Hqi/WIl/n6T，GIl 门 + screen-reader 回退 ANSI）。`markdownList.235.test.ts`。snippet `hit-md-list.txt` |
| 4 | prompt input highlight 多行偏移 | **HAVE** | `ShimmeredInput`/`HighlightedInput` 跨 `\n` 推进 start；`HighlightSegmenter` dual `visiblePos`/`stringPos`；`BaseTextInput` `viewportCharOffset`；PromptInput combinedHighlights（btw/slash/ultrathink/mentions）。snippet `hit-highlight-shift.txt` |
| 5 | Shift+Tab 在 permission comment 字段误关字段；应批 edit + session-wide | **HAVE** | densable ERg：yes/no comment 开 → 只折叠字段（不 accept-session）；否则 accept-session。session-row shortcut=`confirm:cycleMode`；Confirmation 绑定 `MODE_CYCLE_KEY`（Windows 无 VT → meta+m）。`confirmCycleMode.235.test.ts`。snippet `hit-shift-tab-comment.txt` |
| 6 | Agent 省略 `subagent_type` 且 GP 不可用 → 明确错误列可用 agents | **HAVE** | `AVo`/`SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE` + Abf/`isGeneralPurposeAvailable`；call omit 门 + prompt Thf 文案；`tengu_subagent_type_miss` OMITTED + `tengu_feature_bad{feature_name:subagent_launch,error_code:subagent_type_missing}`（densable `pe`）；`generalPurposeRequired.235.test.ts`。residual：抛 plain Error 非 `Vyt`/`AgentTypeError`（文案 1:1）。snippet `hit-agent-default.txt` |
| 7 | notebook delete/replace 对话框读不到 cell 时说明原因 | **HAVE** | `notebookPermissionPreview.ts`（MG/GFt/CAa/sRe）+ async NotebookEditPermissionRequest；exact `p` reasons + em-dash messages；`contentWithheld` 隐藏 accept-session。`notebookPermissionPreview.235.test.ts`。remoteWorkspace API 完整但 UI 传 false（不 invent gateway）。snippet `hit-notebook-dialog.txt` |
| 8 | 流式响应中 slash 命令显示 HTML entities | **HAVE** | densable 写侧 Ua/EHe；显侧 `oX(C7_/Fud)`。本地 `unescapeXmlEntities`（仅 `&amp;|&lt;|&gt;`）+ `UserLocalCommandOutputMessage`/`UserBashOutputMessage`/`UserCommandMessage` 显示前解。**非** artifact `decodeHtmlEntities`/TDr。`unescapeXmlEntities.235.test.ts`。snippet `hit-slash-html.txt` |
| 9 | bg auto-update 后 footer 不显示 Update installed | **HAVE** | success footer 已有；`failureHint`/`consecutiveExeLockFailures` + npm classify + AutoUpdater/Notifications 文案（npm prefix / exe lock / generic doctor）。REPL useState 非 AppState 记 residual。`autoUpdaterFailureHint.235.test.ts` |
| 10 | ctrl+t 恢复/重开有 open tasks 的会话时任务列表总折叠 | **HAVE** | `GlobalConfig.showExpandedTodos` seed `expandedView`；onChange 双向持久化；`app:toggleTodos` + `tengu_toggle_todos`；TaskCreate/Update `set_expanded_view`。residual：`_e(todo_toggle_panel)`；teammates 循环差异。snippet `hit-tasklist-expand.txt` |
| 11 | cloud `/ultrareview`/`/autofix-pr` bg 内存/CPU（勿每更新重扫重渲） | **HAVE** | changelog 优化文案非 SEA 字面；产品路径：RemoteAgentTask `lastEventId` delta poll + `cachedReviewContent` 增量 + `!logGrew&&statusUnchanged` same-ref skip（`updateTaskState`）。**不** invent VSCode host。snippet `hit-cloud-cpu.txt` |
| 12 | permission 展示与 don't-ask-again 覆盖一致；无法完整展示则 withhold | **HAVE** | `PermissionAskDecision.suppressAlwaysAllowRule` + `Tool.suppressesAlwaysAllowRule`；`shouldShowPersistentAllowOption`（Ink hosts）；`stripWholeToolGrantsForAsk` on handleUserAllow / interactive+swarm；SDK `suppress_always_allow_rule` schema + remote/direct ingress map；notebook `contentWithheld` omit accept-session。`suppressAlwaysAllow.235.test.ts`。不 invent gateway/VSCode hosts。snippet `hit-perm-grant.txt` |
| 13 | embedded grep 病态 fail-fast；`-m N`+`-A/-C` context | **HAVE** | sidecar microsoft/ripgrep-prebuilt **v15.0.1**（`15.0.0 rev 3a612f88b8`，**新于** SEA embed `14.1.1`）；`-m/-A/-C`+patho 行为 1:1；densable `rejectOnInputError`/`iaT`/`RipgrepUsageError`(YTm) 已接线 Grep+Glob。打包 sidecar≠SEA argv0 / 不移植 `N4Grep*` 为 **non-blocking 笔记**（用户确认「不是问题」）。**禁止**降级到 14.1.1 / **禁止** invent JS regex engine。`embeddedRipgrep.235.test.ts` + `ripgrepUsageError.235.test.ts`。snippet `hit-embedded-grep.txt` |
| 14 | context-limit 在 auto-compact off 时提示 `/config` | **HAVE** | ZOl/`buildPromptTooLongContextLimitText` + RPa/`shouldShowAutoCompactOffHint`；nested MessageResponse 抑制；`*235*` tests。snippet `hit-compact-off-msg.txt` |
| 15 | vim NORMAL + cursor 在 ctrl+o / 关 panel 时保留 | **HAVE** | densable `$4`/`acf`/`Oyr`/`RgE`：unmount 存 `savedCursorOffset`，remount NORMAL `Oyr` clamp；外部 input 变更 NORMAL 也走 Oyr。本地 `promptInputCursorStore` + PromptInput remount/unmount + q4a vimMode sync。residual：本地 VimMode 仅 INSERT|NORMAL（RgE 保 VISUAL* 字符串兼容）；hideVimModeIndicator / VISUAL LINE 深度不 invent。`promptInputCursorStore.235.test.ts`。snippet `hit-vim-preserve.txt` |
| 16 | dialog 方向键+Enter 竞态选中导航项 | **HAVE** | densable C4i：`o.state` sync bag + `getFocusedValue()` live read；`selectFocusedOption`/`select:accept`/edge wrap 用 live getter；`getFocusedValue.235.test.tsx`。snippet `hit-dialog-race.txt` / `gold-dialog-getFocusedValue.txt` |
| 17 | SendMessage 过大 upfront refuse（非静默丢） | **HAVE** | `MAX_UDS_LINE_CHARS=1048576`（X1r）+ `UdsMessageTooLargeError`/`message_too_large`；send 前 refuse；server line drop；SendMessage 透传 errorClass；`udsMessaging.lineCap.235.test.ts`。snippet `hit-sendmessage-size.txt` |
| 18 | `claude rc` 与交互启动同一 enterprise-gateway availability check | **HAVE** | cli.tsx `getBridgeDisabledReason`→bridgeMain；interactive `checkBridgePrerequisites` 同门；gateway → `getRemoteControlEndpointDisabledReason` + `isEnterpriseGatewaySession`（Glt）。snippet `hit-rc-gateway.txt` |
| 19 | [VSCode] 多 Claude tab/panel restore/reload focus 乱跳 | **N/A** | 宿主扩展面。SEA **ABSENT** preserveFocus/createWebviewPanel/ViewColumn/onDidChangeViewState…；仅有 `claude-vscode` / `anthropic.claude-code*` / SSE bridge 标识。**禁止 invent** extension 代码。snippet `hit-vscode-focus.txt` |

## Explicit non-claims / invent-ban

- **#19**：VS Code extension host-only。CLI SEA / go-hare **不** invent webview panel focus 修复。  
- **不 invent** apps gateway 控制面 / Desktop-only Notification / Cowork。  
- **#11**：changelog「re-scanned and re-rendered」为 release-notes 语义；落地以 RemoteAgentTask delta/same-ref 为准，不 invent 新云端 UI 字符串。  
- **#13**：对齐 densable **embedded** ripgrep 产品行为 + vendor **15.0.x**（**新于** SEA 14.1.1）；禁止用 JS prompt/settings 伪实现 / **禁止**降级；sidecar≠argv0 embed 仅为笔记，不挡 HAVE。  
- **#8**：artifact-only `decodeHtmlEntities`/`TDr` **不是**本条；本条是 slash/local-command 显示路径 `oX`。  
- **#1**：spellcheck 整块仅 user/flag/managed；禁止把 project/local settings 块当成有效配置 invent 进产品。  
- 提交时勿 stage `/tmp` SEA bin；docs snippets（文本）可入仓。  
- **本 pack 只 2.1.235**；tip 已有 2.1.234，勿把 234 residual 折进本清单实现范围。

## 实现优先级（densable-backed）

1. ~~**#14** compact-off 文案~~ → **HAVE**  
2. ~~**#6** Agent `AVo`~~ → **HAVE**  
3. ~~**#17** SendMessage `message_too_large` / X1r~~ → **HAVE**  
4. ~~**#4 / #10 / #11 / #18**~~ → **HAVE**（map 确认既有/已对齐）  
5. ~~**#16** dialog `getFocusedValue`~~ → **HAVE**  
6. ~~**#8** slash/local-command `oX` unescape~~ → **HAVE**  
7. ~~**#2** LSP `hasEverConnected` latch~~ → **HAVE**  
8. ~~**#12** `suppressAlwaysAllowRule`~~ → **HAVE**  
9. ~~**#7** notebook preview `contentWithheld`~~ → **HAVE**  
10. ~~**#5** Shift+Tab ERg collapse~~ → **HAVE**  
10b. ~~**#3** md-list OIl+hanging~~ → **HAVE**  
10c. ~~**#9** update-footer failureHint~~ → **HAVE**  
11. ~~**#15** vim `savedCursorOffset`~~ → **HAVE**  
12. ~~**#1** spellcheck~~ → **HAVE**  
13. ~~**#13** embedded+vendor ripgrep~~ → **HAVE**（15.0.x 新于 SEA；sidecar 笔记不挡）  
14. **#19** 保持 **N/A**

## 提交建议 stage 范围（落地后）

```text
docs/upstream-extraction/v2.1.235/
src/components/CustomSelect/**
src/services/lsp/** + packages/builtin-tools/.../LSPTool/**
src/utils/xml.ts + src/components/messages/User*Command*Message*
src/types/permissions* / permission dialog* / NotebookEditPermission*
src/components/permissions/FilePermissionDialog/**
src/utils/markdown.ts (+ Ink list path if landed)
src/components/AutoUpdater* / PromptInput/Notifications* / AppState autoUpdaterResult
src/components/PromptInput/** (vim savedCursorOffset / spellcheck)
src/utils/settings/** (spellcheck schema)
src/utils/vendor/ripgrep/** (+ package embed bump if #13)
**/*235*.test.ts
```
