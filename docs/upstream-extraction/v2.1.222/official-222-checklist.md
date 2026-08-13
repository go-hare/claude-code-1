# densable 2.1.222 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.222 release notes（`changelog-2.1.222.md`，**21 条**）。  
> densable 二进制 SEA：`%TEMP%/official-222/plat/package/claude.exe`（win32-x64）；`// Version: 2.1.222` HIT ×3；size **279014048**；sha256 `032cb799d2abfaa6ca440f6458304b9a2a250521063d21ebcea7f3c77c443db7`。  
> 基线：本地 tip 含 densable **2.1.221** 收口 + npm **2.7.34**；**本 pack 只对齐 2.1.222**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。  
> 更新：2026-08-10 — pack 初扫（changelog + win32 SEA + 本地对照）。  
> 计数：**HAVE 21 · PARTIAL 0 · GAP 0 · N/A 0 · UNKNOWN 0**（21）。2026-08-10 全量收口（含 #19 raw git blob）。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.221** | sandbox mask / PS 引号路径 / bareAssignmentNames / ToolSearch 等 39 条 | **已收口**（2.7.34） |
| **2.1.222** | worktree isolation 全会话 / SendMessage classifier / RC auto-start 源限制 / **ultraplan remove** 等 21 条 | **本 pack** |
| **2.1.223+** | 勿折入 | — |

## densable 关键符号（SEA 221→222 增量 / 锚）

| 符号 / 字符串 | 含义 | 221→222 |
| --- | --- | --- |
| `// Version: 2.1.222` (×3) | 版本锚 | NEW |
| `worktree-isolated session` / `isolation fences` | #1 全会话 worktree 隔离文案 | NEW |
| `Message to another agent requires classifier review` | #17 SendMessage 走 auto-mode classifier | NEW |
| `claude.ai rejected the session token` / `Run /login, then reconnect` | #10 connector 假 needs-auth → /login | NEW |
| `Longer summaries are truncated to … characters rather than rejected` | #12 SendMessage summary 截断 | NEW |
| `repo-scoped settings cannot enable Remote Control; set it at user scope (/config)` | #20 project/local 不能开 RC auto-start | NEW |
| `You've already sent a usage credit request to your admin` | #3 usage-credits 文案（221 亦有） | SAME |
| `Connection closed mid-response` | #5 流关闭文案 | SAME |
| `--no-textconv` / `--no-ext-diff` | #19 raw git blob | SAME |
| `tool due to disable-model-invocation` + `Do not replicate this skill's workflow` | #18 skill 拒绝文案 | SAME 基线；改进措辞需再对 |
| `/ultraplan` / `ultraplan` 计数 ≈221 | #21 changelog 称 remove，但 win32 SEA **仍残留**大量 ultraplan 串（dead/teleport residual 可能） | 产品面仍待 SEA 注册表核对 |
| `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` | #16 host model 优先 | SAME |

证据：`snippets/hit-*.txt`、`snippets/sea-meta.txt`、`snippets/sea-sha256.txt`。

## 全量对照（21 条）

| # | 官方条目（摘要） | 状态 | 本地备注 |
| --- | --- | --- | --- |
| 1 | worktree-isolated 会话/subagent 不能对 main checkout 跑破坏性 git；隔离覆盖 **file edits + Bash · every session type** | **HAVE** | densable Qgt/dun/bRo/hSd/QEd/Vyr：`resolveIsolationRoot`（agentWorktree \|\| session.worktreePath）、`isolationSubject`（session vs agent noun/possessive）、`qRu` session-aware roots、write fence `checkWorktreeIsolationWrite(path, root)` + dun 文案、Shell `isolationRoot = f??p??Qgt` 跑 VRu/ZRu（context_lost/worktree_gone 仍只看 p）。FileEdit/Write/Notebook 经 hsr。见 `worktreeIsolationEverySession.222.test.ts`、`snippets/hit-worktree-isolated-session.txt`。 |
| 2 | PreToolUse auto-allow 钩子不能绕过 bg agent 任务工具限制（summaries / compaction / renames） | **HAVE** | densable O3：`requireCanUseTool:i?.requireCanUseTool??!0`（221→222 NEW）；pdn 在 hook allow 且 `a` 时仍走 canUseTool 金句 `but canUseTool is required`。go-hare：`runForkedAgent` 默认 `requireCanUseTool: overrides?.requireCanUseTool ?? true`；`resolveHookPermissionDecision` 已有 gate。见 `requireCanUseTool.222.test.ts`、`snippets/hit-pretooluse-requireCanUseTool.txt`。 |
| 3 | `/usage-credits` Team/Enterprise成员 dismiss 后 usage credit request 仍显示已发送、无法再发 | **HAVE** | densable BTr：`getMyAdminRequests(..., ['pending'])` 仅 pending 拦截；dismissed 不拦。返回 `confirm-admin-request`→`ConfirmAdminUsageRequest`（$$n）再 `submitAdminUsageCreditRequest`（iea）。文案 `You've already sent a usage credit request to your admin.`。见 `usageCreditsDismissRerequest.222.test.ts`、`snippets/hit-usage-credits-dismiss-rerequest.txt`。 |
| 4 | 启动 connectivity check 在 HTTPS proxy 后挂死 → 与 API 同 proxy transport + 明确超时 | **HAVE** | densable Coh：`checkEndpoints` 并行 `/api/hello`+`/v1/oauth/hello`，`AbortSignal.timeout(10s)`，`getProxyFetchOptions`（Wh）+ `getSSLErrorHint`（wft）；`PreflightStep` 展示 usedProxy/sslHint/network-config。见 `preflightConnectivity.222.test.ts`、`snippets/hit-preflight-proxy-connectivity.txt`。 |
| 5 | 已完成响应误报 `Connection closed mid-response` | **HAVE** | densable `La&&To&&at===null` → `tengu_streaming_close_after_complete`（`planStreamCloseAfterComplete` + `claude.ts` message_delta/open-block 状态）。已完成响应不再吐 mid-response banner。证据：`snippets/h5-close-after-complete-beautified.txt`、`src/utils/streamKeepAlive.ts`。 |
| 6 | `/usage` MCP 份额只计**真正消费了该 server tool results** 的请求 | **HAVE** | densable Br/To+ARd+V：MCP `call` stamp `activeMcpServer/Tool`；query 在 API loop 前 `captureAndClear`（仅 main/subagent）；`addToTotalSessionCost` OTEL `mcp_server.name`/`mcp_tool.name`。streaming tool executor reset 再 ARd。见 `mcpUsageAttribution.ts`、`mcpUsageAttribution.222.test.ts`、`snippets/hit-mcp-usage-attribution.txt`。 |
| 7 | 分支 push 之后才创建的 PR（含 GitHub REST）仍要链到 session | **HAVE** | densable RPo/ndn/jwd/Pc_/Ic_/Rc_/K$s/Lzr：push 后 `gh pr view`；失败则 pendingBranchLinks 最多 5 次重试；create/curl REST stdout URL → link + clear cwd。go-hare：`gitOperationTracking` + bootstrap `pendingBranchLinks`。见 `postPushPrLink.222.test.ts`、`snippets/hit-post-push-pr-link.txt`。 |
| 8 | org 限制下 `model: opus` 族别名应 step-down 到族内**最新允许**模型，而非掉到 parent | **HAVE** | densable coe/a$/K7r/Idp：`stepDownRestrictedFamilyAliasPick`+`newestAllowedModelInFamily`；`getAgentModel` 在 `!isModelAllowed` 时 a$ 族内最新，否则 parent inherit；Idp 仅在 resolved 允许时回 parent exact。见 `agent.ts`、`modelAllowlist.ts`、`agentFamilyStepDown.222.test.ts`、`snippets/hit-agent-family-step-down.txt`。 |
| 9 | 自定义 `ANTHROPIC_BASE_URL` gateway keep-alive ping 误触发 stream idle timeout | **HAVE** | densable `Tfb`（vfb=10s / Afb=30）：`withStreamKeepAlivePings` 在 `chunkTimes.lastAt` 推进且无 SSE 时合成 `{type:"ping"}`，`claude.ts` for-await 上 `Gi()`+`_0r` 重置 idle。证据：`snippets/h9-Tfb-complete.txt`、`src/utils/streamKeepAlive.ts`。 |
| 10 | claude.ai connector session token 无效时假 needs-auth → 显示 `/login` hint | **HAVE** | densable LOs/`CLAUDEAI_BEARER_REJECTED`：`createClaudeAiProxyFetch` 401+!tokenChanged → throw；`fetchToolsForClient` 设 `discoveryBearerRejected`/`toolsListError`；`MCPRemoteServerMenu` Issue + `reconnectHelpers` ati 金句 `/login`。见 `snippets/hit-session-token-login.txt`、`claudeAiBearerRejected.222.test.ts`。 |
| 11 | 工具本地已不可用（如 MCP 移除）时 tool error 仍要展示 | **HAVE** | densable Wli 221→222：tool def 缺失不再 return null，仍返 `{tool?,toolUse}`；仅 tool_use block 缺失才 null。Brief(`SendUserMessage`) 可从 base registry 恢复。`UserToolErrorMessage` → Fallback。见 `toolGoneErrorDisplay.222.test.ts`、`snippets/hit-tool-gone-error-display.txt`。 |
| 12 | `SendMessage` 长 summary **截断**而非 reject | **HAVE** | densable OIp/Cpr=200：`SEND_MESSAGE_SUMMARY_MAX_CHARS`、schema `.max(200)`、`coerceSendMessageInput` + `Tool.coerceInput` 管线（`toolExecution` 先 coerce 再 safeParse + `tengu_tool_input_coerced`）。见 `snippets/hit-summary-truncate.txt`、`sendMessageClassifierAndTruncate.222.test.ts`。 |
| 13 | subagent transcript spinner effort 用 **subagent `effort:`** 而非 session effort | **HAVE** | densable `But(h??Zi(), m??F)`：`resolveSpinnerEffortSource` 在 `viewingAgentTaskId`→`local_agent` 时用 task/`selectedAgent` 的 `effort`+`model`，否则 session F+Zi。`Spinner.tsx` 经此再 `getEffortSuffix`。见 `spinnerSubagentEffort.222.test.ts`。 |
| 14 | file watcher FS error / teardown 罕见崩溃 | **HAVE** | densable FileChanged：`on('error')`/`ready` + `tengu_feature_{bad,ok}`（`file_watcher_start`/`fs_error`/`file_watcher_change_detected`）、`aHe` drop remote UNC、dispose/restart **null-first close**；settings/keybindings/cron 补 `on('error')`；keybindings densable `usePolling:true,interval:2000`。见 `fileWatcherErrorTeardown.222.test.ts`、`snippets/hit-file-watcher-error-teardown.txt`。 |
| 15 | `--ax-screen-reader` 退格不再整行重读；EOL 删除只 echo 删掉的字符 | **HAVE** | densable NEW `prevScreenReaderParkDeclared`+`Htd`+`tAo`(CSI K)：EOL pure-suffix delete → CHA(keep)+CSI K+park（不整行 2K rewrite）。go-hare：`suffixDelete` plan/materialize + ink `prevScreenReaderParkDeclared`。见 `screenReaderEolDelete.222.test.ts`、`snippets/hit-screen-reader-eol-delete.txt`。 |
| 16 | `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 时 host model-selection 优先于磁盘 stale `managed-settings.json` | **HAVE** | densable Gfg/b6i/nfc/Wfg：`buildHostModelOverlay` + `stripHostManagedPolicyModelKeys` + policy `finishPolicySettingsForHost`；parent `--managed-settings`/`parentManagedSettings`；schema `fallbackModel[]`/`enforceAvailableModels`。见 `hostModelOverlay.222.test.ts`、`snippets/hit-host-managed-model-precedence.txt`。 |
| 17 | auto mode：`SendMessage` 发出前经 permission **classifier** 评估 | **HAVE** | densable Pjs：`checkPermissions` 在 auto 或 plan+`isAutoModeActive` → `passthrough` + 金句 `Message to another agent requires classifier review.`（保留 feature-gated bridge/LAN ask）。见 `snippets/hit-sendmessage-classifier.txt`、`sendMessageClassifierAndTruncate.222.test.ts`。 |
| 18 | `disable-model-invocation` 拒绝：让 Claude **请用户跑 skill**，勿复制 workflow | **HAVE** | densable koa+mvn：`Ask the user to run /${skill}…` + `Do not replicate this skill's workflow…`；coordinator 走 report-to-coordinator。go-hare：`formatDisableModelInvocationMessage` + validateInput。见 `disableModelInvocation.222.test.ts`、`snippets/hit-disable-model-invocation-222.txt`。 |
| 19 | `/diff`、RC workspace diff、web file-edit diff 用 raw git blob（`--no-ext-diff` / `--no-textconv`） | **HAVE** | densable `gnr`；go-hare `RAW_GIT_DIFF_FLAGS`：`preserveGitStateForIssue`（diff+format-patch）、`gitDiff` URo/jRo、`reviewRemote` shortstat/numstat。见 `rawGitDiffFlags.222.test.ts`、`snippets/hit-no-textconv.txt`。 |
| 20 | RC auto-start：repo-local settings **不能打开**（仍可关）；开只能 user scope `/config` | **HAVE** | densable X_t/rMe：`SettingsSchema.remoteControlAtStartup`；project/local `false` 硬关；policy/user/GlobalConfig 可开；project/local `true` 仅 log ignore 金句。见 `snippets/hit-rc-repo-scoped.txt`、`remoteControlAtStartup.222.test.ts`。 |
| 21 | **Removed ultraplan feature** | **HAVE** | densable changelog 产品 remove；SEA 仍有 `/ultraplan`/zAr residual（≠ 零串）。go-hare：`DEFAULT_BUILD_FEATURES` **去掉** `ULTRAPLAN`（build/dev/vite 同源）；`/ultraplan` 注册 + REPL/PromptInput/processUserInput/ExitPlanMode 入口仍 `feature('ULTRAPLAN')` gate；teleport/`isUltraplan`/ccrSession/`ULTRAPLAN_TAG` residual 保留。`FEATURE_ULTRAPLAN=1` 可复活。见 `ultraplanProductOff.222.test.ts`。 |

## 故意不扩 / 站位

| 项 | 策略 |
| -- | ---- |
| UDS_INBOX / LAN_PIPES / TEAMMEM | **DEFAULT_BUILD ON**（2026-08-12；本 pack 当时 deferral 已过时） |
| KAIROS | 不扩产品面 |
| #21 ultraplan | extract densable 拆除面再 1:1；**禁止**假「已 remove」 |
| invent N9 remote effort | 无协议不硬塞 |

## 优先落地顺序（剩余）

1. ~~PARTIAL 收口（#19）~~ **HAVE**  
2. ~~#1–#21~~ **全部 HAVE（21/21）**


## 证据文件

- `changelog-2.1.222.md`
- `snippets/sea-meta.txt` / `snippets/sea-sha256.txt`
- `snippets/hit-version.txt`
- `snippets/hit-worktree-isolated-session.txt` / `hit-isolation-fences.txt`
- `snippets/hit-sendmessage-classifier.txt`
- `snippets/hit-session-token-login.txt`
- `snippets/hit-summary-truncate.txt`
- `snippets/hit-rc-repo-scoped.txt`
- `snippets/hit-disable-model-invocation.txt`
- `snippets/hit-usage-credit-request.txt`
- `snippets/hit-connection-closed.txt`
- `snippets/hit-no-textconv.txt`
- `snippets/hit-ultraplan.txt`
- `snippets/hit-mcp-usage-attribution.txt`
- `snippets/hit-agent-family-step-down.txt`
- `snippets/hit-pretooluse-requireCanUseTool.txt`
- `snippets/hit-post-push-pr-link.txt`
- `snippets/hit-tool-gone-error-display.txt`
- `snippets/hit-disable-model-invocation-222.txt`
- `snippets/hit-file-watcher-error-teardown.txt`
- `snippets/hit-screen-reader-eol-delete.txt`
- `snippets/hit-host-managed-model-precedence.txt`

## SEA 获取

```text
npm pack @anthropic-ai/claude-code-win32-x64@2.1.222
# → %TEMP%/official-222/plat/package/claude.exe
```

## Explicit non-claims

- **不要**把 221 已 HAVE 条目重算进 222 完成度。  
- **不要**因 SEA 仍有 `ultraplan` 字符串就声称官方未 remove（changelog 是产品契约；二进制 residual 需另表）。  
- #2/#6/#7/#8/#11/#18 已 extract densable 后 1:1 落地；表头 **21/21 HAVE**，无剩余 PARTIAL。
