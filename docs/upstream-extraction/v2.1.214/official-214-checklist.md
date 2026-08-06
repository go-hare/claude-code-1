# densable 2.1.214 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.214 release notes（用户粘贴 + `CHANGELOG.upstream.md`；与 Releasebot / ClaudeCodeLog 一致）。  
> densable 二进制：`/tmp/official-214/package/claude.exe`（`npm pack @anthropic-ai/claude-code-win32-x64@2.1.214`）。  
> 基线：产品 **2.7.29** / densable **2.1.212 收口**（`official-212-checklist` 0 GAP）。  
> 状态图例：**GAP** 未对齐 · **PARTIAL** 有半截 · **AUDIT** 需对照 densable 再判 · **HAVE** 已有 · **N/A** 不适用 · **LOW** 可选  
> 约定：**extract densable first → 1:1**，禁止简化版替代。KAIROS 不再加码；UDS/LAN/TEAMMEM 默认 OFF。

## 邻版关系


| 版           | 性质                                              | go-hare         |
| ----------- | ----------------------------------------------- | --------------- |
| **2.1.212** | 大包（fork/caps/ultrareview/agents…）               | **已收口**（2.7.29） |
| **2.1.213** | 近空壳 bump（无独立 CLI changelog）                     | **跳过**          |
| **2.1.214** | 大包（安全阀 + EndConversation + PS/Bash + bg daemon） | **本清单**         |


---

## 全量对照（47 条）


| #   | 官方条目                                                                                   | 状态              | 本地备注                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **single-segment `dir/`** allow** 不再 any-depth 误放行（仅 `<cwd>/dir`）                      | **HAVE**        | densable `o1d`/`zw`：`adjustPermissionPatternForIgnore` + `matchingRuleForInput`；allow 单段 cwd-only，deny/ask any-depth。见 `batch-a-permissions.landed.md`。                                                                                                                                 |
| 2   | **Win PowerShell 5.1** 权限检查 bypass                                                     | **HAVE**        | densable write-stem shadow：`psShadowStem`/`psCommandBaseAndStem` + Windows multi-subcmd ask 文案。见 `batch-a-permissions.landed.md` residual #2。                                                                                                                                               |
| 3   | Bash **fd redirect** fail-closed                                                       | **HAVE**        | densable `hnu`/`h6i`：`precheckFileRedirect` + `walkFileRedirect`（fd-var / close-fd+word / `>& -` / multi-target）。                                                                                                                                                                       |
| 4   | Bash 命令 **>10_000 字符** 一律 prompt                                                       | **HAVE**        | densable `Jru`/`K0e`：`parseCommandRaw`→`PARSE_ABORTED`；analyzer too-complex；`F7u`；次级 CE/Uto/zOe/Eys（`commands.ts`/`sedValidation`）；Shu/Gx/vhu 经 parse-abort 主链 fail-closed。见 `batch-a-permissions.landed.md`。                                                                                                                                    |
| 5   | Bash **zsh `[[ ]]` 下标/修饰符** 不再当 inert                                                  | **HAVE**        | densable `fnu`/`mnu`/`pnu`/`tnu`：`precheckTestCommand` + `detectZshSubscriptOrModifier`。                                                                                                                                                                                                  |
| 6   | Bash `**help`/`man`** 不再错误 auto-approve                                                | **HAVE**        | densable man/help `additionalCommandIsDangerousCallback` + safeFlags（man 无 `-l`；help 仅 `-d`）。                                                                                                                                                                                          |
| 7   | **Remote 权限提示** 不得在本地确认前 proceed                                                       | **HAVE**        | densable `aBa`：permission+dialog answered-elsewhere；`pending_user_dialog_requests` redelivery/`remote_dialog_redelivery`；`result` 清双方；EEf=`useRemoteUserDialog`（R5b 仅 O5）。`remoteSessionPermissionRace214` + `useRemoteUserDialog214`。                                                                 |
| 8   | **EndConversation** 工具（滥用/越狱结束会话）                                                      | **HAVE**        | 1:1：`EndConversationTool` + gate/floor/GB `tengu_umber_kestrel` + two-step Mqu + fork no-op + `ended-by-model` + AppState `endedByModel` + processUserInput/compact/Agent/fork refuse + resume hydrate + deferred hint + sibling `conversation_ended`。详见 `end-conversation.extract.md`。 |
| 9   | 长工具调用 **progress heartbeat**                                                           | **HAVE**        | densable `_Lu`/`Pss=30s`：`src/utils/toolHeartbeat.ts`；`toolExecution` call 包装（`agentId` skip + Agent no-op）；`queryHelpers` twin `tool_progress` + `heartbeat:true`；SDK schema optional `heartbeat`。详见 `heartbeat-otel.extract.md`。                                                      |
| 10  | memory frontmatter **ISO `modified`**                                                  | **HAVE**        | densable `Zto`/`hRg`/`CBc`/`BYh`：`stampNewMemoryContent`（`src/memdir/stampNewMemoryContent.ts`）挂 FileWrite/FileEdit；首写 `originSessionId`+ISO `modified`+`node_type`，续写 `hRg` 仅改 `modified`（保留 `#` 尾注）。team 路径 `zle` 跳过 provenance 全量改写。测试 `stampNewMemoryContent.214.test.ts`。 |
| 11  | OTel：`message.uuid` / `client_request_id` / `tool_source`                              | **HAVE**        | `user_prompt`/`assistant_response` → `message.uuid`；`api_request`/`api_error` → `client_request_id`；`tool_decision` → densable `u8n` `tool_source`（`toolSource.ts`）。                                                                                                                    |
| 12  | `**CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`**（默认 60KB trunc）                               | **HAVE**        | densable `Ptg`/`W1`/`Dtg=61440`：`getOTelContentMaxLength` + `truncateOTelContent`（动态 KB/character marker）；beta `truncateContent` 委托。                                                                                                                                                    |
| 13  | `**subagentStatusLine` payload + reasoning effort**                                    | **HAVE**        | densable `effort:g.effort`：`LocalAgentTaskState.effort` 注册时 stamp；`SubagentStatusTaskRow.effort` + payload map。官方 changelog “reasoning effort” = effort 字段（无单独 reasoningEffort 符号）。                                                                                                     |
| 14  | **docker/podman daemon-redirect** 权限提示（`--url`/`--connection`/`--identity`/remote）     | **HAVE**        | densable `oGr`/`aQn`：`DOCKER_DAEMON_REDIRECT_FLAGS` + `dockerDaemonRedirectIsDangerous` 挂在 `docker logs`/`inspect`。                                                                                                                                                                     |
| 15  | GrowthBook **null / 畸形 payload** 不崩、不清缓存                                               | **HAVE**        | densable nji/RUc：`coalesceNullFeatureValue`（null→default）；`processRemoteEvalFeatures` 跳过 null/非 object/value-less/畸形 experiment，`values.size===0` 不刷盘。见 `batch-e-growthbook-null-payload.extract.md`。                                                                                        |
| 16  | Bash `**pkill -f` 误杀自身**（Linux）                                                        | **HAVE**        | densable `K2g` snapshot 函数 + Shell spawn `CLAUDE_PID`（TCt 式 env）。                                                                                                                                                                                                                       |
| 17  | `**--settings`** 指向 device/超大文件：>2MiB 启动失败                                             | **HAVE**        | densable `bj`/`qvl`/`Jme=2097152`：`assertRegularFileWithinMaxBytes` + `FLAG_SETTINGS_MAX_BYTES`；`loadSettingsFromFlag` 三路文案（not found / MiB limit / Cannot use settings file）。测试 `flagSettingsMaxBytes.214.test.ts`。见 `batch-e-settings-shell.extract.md`。 |
| 18  | Win 公司代理 **streaming "Socket is closed"**                                              | **HAVE**        | densable `T2`/`Sxg`/`Cye`/`EYy`：`extractConnectionErrorDetails` 识别 Bun `The socket connection was closed unexpectedly` → `ConnectionClosed`；`isStaleConnectionError` 扩至 Cye 全集；retry 必 `disableKeepAlive()`。见 `batch-c-ps-win.extract.md`。 |
| 19  | **stream-json** 退出 drain 按队列字节扩展（非固定 2s）                                               | **HAVE**        | densable `fVt`/`zRn`/`Ds`/`hll`/`P_m=262144`/`L_m=30s`：`process.ts` 字节记账 + 按队列扩展 budget；`gracefulShutdown` failsafe `zRn+1500` + body `fVt(500,false)` + 正常路径 `await fVt()`。测试 `process.stdoutDrain.214.test.ts`。见 `batch-e-stdout-drain.extract.md`。 |
| 20  | **scheduled tasks** 自有 prompt 不再当 untrusted                                            | **HAVE**        | densable `Q9i`/`J9i`/`RZn`/`ivg`/`pVr`：`wrapScheduledTaskDisclaimer` + `isScheduledTaskOrigin`；task-notification `scheduled-trigger`→Q9i else J9i；local autonomy `scheduled-task` 同 Q9i；`prepareAutonomyTurnPrompt` stamp。见 `batch-e-schedule-prompt.extract.md`。 |
| 21  | PS 子进程 **stdin 等待导致 hang→timeout**                                                     | **HAVE**        | densable `$Gc` `stdin:"ignore"`：`ShellProvider.stdin` + `createPowerShellProvider` + `Shell.ts` stdio[0]。测试 `powershellProvider.214.test.ts`。                                                                                                                                              |
| 22  | PS 下 Python **stdin 非 UTF-8 → UnicodeDecodeError**                                     | **HAVE**        | densable `Arg.PYTHONIOENCODING=utf-8:surrogateescape`（仅未设置时注入）。`powershellProvider.getEnvironmentOverrides`。                                                                                                                                                                          |
| 23  | PS 下 Python **stdout 非 ASCII → UnicodeEncodeError**；PS7 错误含 raw ANSI                   | **HAVE**        | densable `Erg`：`$OutputEncoding = UTF8Encoding` + `$PSStyle.OutputRendering = PlainText` + `NO_COLOR=1`（FORCE_COLOR 时跳过）。`POWERSHELL_ENCODING_PREAMBLE` / `vrg` skip。                                                                                                                      |
| 24  | PS 将 `**where.exe`/`fc.exe`/`diff.exe` 合法否定答案当 error**                                 | **HAVE**        | densable `u9u`/`Qhs`/`Lny`/`Pny`/`F7r`：`.exe`+有输出才走 where/fc/diff 信息码；git grep/diff 子命令；grep/rg/findstr/robocopy 常驻。`PowerShellTool/commandSemantics.ts` + 测试。                                                                                                                              |
| 25  | PS 5.1 `**>`/`>>` 写 UTF-16LE**                                                         | **HAVE**        | densable `Erg`：`$PSDefaultParameterValues['Out-File:Encoding']='utf8'` 前缀（`vrg` 不跳过时）。同 #23 preamble。                                                                                                                                                                                  |
| 26  | **bg daemon** 下线时删掉继任者 control socket                                                  | **HAVE**        | densable aAp `close({skipUnlink})` + BG4 `close({displaced\|skipPathCleanup})`：yield 不 unlink/rm 实例目录。`controlSocket.ts`/`bgManager.ts`/`main.ts` onYield。测试 `controlSocketSkipUnlink.214.test.ts`。见 `batch-d-bg-daemon.extract.md`。                                              |
| 27  | bg 会话 `**←`/`/background` 空闲** 仍占 daemon+worker                                        | **HAVE**        | densable `bh`/`retireIfSettled`：`isEligibleForRetire` 回收 tempo:idle + blocked-blocked + YP lineage；detritus L4d + host-managed。`jobState.ts`/`bgWorker.ts`。测试 `retireIfSettled.214.test.ts`。见 `batch-d-bg-daemon.extract.md`。 |
| 28  | 完成后台会话 `**claude rm`/agent view 无法删**（service idle）                                    | **HAVE**        | densable C2e/gJ_：`deleteJob` kill_unconfirmed→worktree gates→rm jobdir；`claude rm`/`daemon rm` + AgentView `deleteJob(force:true)`。见 `batch-d-bg-daemon.extract.md`。                                                                                                                    |
| 29  | **非 git 目录** 派发的 bg 会话无法从 agents view 删                                                | **HAVE**        | densable FleetView `C2e(id,{force:!0})`：force 下 remove 失败/非 git → left_in_place 仍删 jobdir（session deleted）。AgentView 同 force。                                                                                                                                                     |
| 30  | 重开 stopped bg：session store **不可读目录** 导致无法恢复 transcript                                | **HAVE**        | densable `$yi`/`Dyi`/`gTe` + NMt `isFile`：目录名 `*.jsonl`/`access` 伪命中跳过；projectsScan 仅 `$yi==="has"` 且唯一命中；`listCandidates` withFileTypes+isFile；attach/resolve 路径 isFile。测试 `transcriptProbe`/`listCandidates.214`。见 extract。 |
| 31  | RC **"session ready" push** 在未显式启用 RC 时误发                                              | **HAVE**        | densable `nZp`/`oZp`/`iZp`/`bzu`/`YQp`：GB `tengu_kairos_push_notifications` + `tengu_kairos_ready_nudge`；`oZp` 要求 `replBridgeExplicit`，拒绝 outbound/reattach/bg/agentId；impression `remoteControlReadyPush*`；`useReplBridge` connected + `onInteraction` 活动闩。见 `batch-e-rc-ready-push.extract.md`。 |
| 32  | `**/install-github-app` + `/mcp` settings**：agent-view 可开；仅无终端 bg 拒绝                   | **HAVE**        | densable Pte=`isBg&&!attacherCaps`：`isBgSessionWithoutTerminal` + rendezvous `attacher-caps`→`setAttacherCaps`；/mcp panel & /install-github-app & MCP OAuth 拒绝；enable/disable 仍可。测试 `bgNoTerminal.214.test.ts`。                                                                       |
| 33  | `**--settings` 启用的 plugins** 不加载（≥2.1.181 回归）                                          | **HAVE**        | densable `Dhy`/`LPt`/`iI`：`flagSettingsEnabledPlugins.ts` + `migrateFromEnabledPlugins` 收录 flag-only true→user 记录 + `copyPluginToVersionedCache`；policy false 跳过。见 `batch-e-flag-settings-plugins.extract.md`。 |
| 34  | **OAuth 轮换后 feature flags 变 stale**                                                    | **HAVE**        | densable X8n/Iwe/mYt：`refreshGrowthBookFeatures` 先 `checkAndRefreshOAuthTokenIfNeeded`，Authorization≠戳记则 `refreshGrowthBookAfterAuthChange({preserveLoggedExposures:sameAccount})`；`resetGrowthBook` 支持 preservePending/Logged；创建时戳 oji/iji/sji。见 `batch-e-oauth-flag-stale.extract.md`。 |
| 35  | `**/ultrareview` 无 merge base** → 提供审查全部 tracked files                                 | **HAVE**        | densable `IXs`/`Wau`/`Z$o`/`tFo`：`EMPTY_TREE_SHA` + `isEmptyTreeFallbackEnabled`；非 shallow 时 empty-tree shortstat；`bundleForceScope:squashed`；文案 all files / no common history。见 `batch-e-ultrareview-empty-tree.extract.md`。 |
| 36  | `**claude update`/`doctor` hang**、`/status` 空白：shell-config 路径是**目录**                  | **HAVE**        | densable `mnn`/`cMs`：`readFileLines` EISDIR soft-skip；`findClaudeAlias` 跳过 unreadable（L4e/BEt/CXy）。测试 `shellConfig.214.test.ts`。见 `batch-e-settings-shell.extract.md`。                                                                                                      |
| 37  | memory frontmatter 值在 **inline `#`** 被截断                                               | **HAVE**        | densable `km(quoteLossyValues)`：`quoteLossyFrontmatterValues` 在 parse 前给含 `#` 的裸值加引号；`rewriteHazard` 无法保真时走 serialize 路径。同 `stampNewMemoryContent.214.test.ts`。                                                                                                                                    |
| 38  | **cost/token 双计**：多帧 cumulative `message_delta`                                        | **HAVE**        | densable `gr`/`sHe`/`Zce`：`streamCostCredit.ts` none→pending→credited；仅 stop_reason≠null 或 message_stop(pending) 调一次 `addToTotalSessionCost`；写回全部 newMessages usage。测试 `streamCostCredit.214.test.ts`。见 `batch-e-message-delta-cost.extract.md`。 |
| 39  | advisor thinking 时误报 **"check your network"**                                          | **HAVE**        | densable s8h/`_chunkTimes.lastAt` + Avs/Gt/Vr：`bodyIdleWatchdog` 打 lastAt；`advisorNetworkStall.ts` 调度；`claude.ts` onRetryStatus；Spinner Msn 文案。见 `batch-e-advisor-network-stall.extract.md`。                                                                                      |
| 40  | hooks **exit 2** 在 stdout JSON schema 失败时仍应 block                                      | **HAVE**        | densable `if(ge&&we.status!==2)` + exit2 synthesize blockingError：`hooks.ts` 主路径/次级路径 + `hookExit2Priority.ts`。见 `batch-e-hooks-exit2.extract.md`。                                                                                                                              |
| 41  | OTel 在 turn async context **外** 丢 interaction `trace_id`/`span_id`                     | **HAVE**        | densable 214：`getOTelEventParentContext` 序 = active span → interaction bridge（`interactionOtelContext` + sessionTracing enterWith 同步）→ non-interactive TRACEPARENT extract。测试 `otelEventParentContext.214.test.ts`。见 `otel-out-of-context-trace.extract.md`。                          |
| 42  | MCP prompts/resources **瞬时错误** 清空 slash commands/resources                             | **HAVE**        | densable keep-previous：`mcpListChangedRefresh.ts` + list_changed handler；prompts 全量保留；resources 字段级 allSettled；fetch rethrow + 初连 settleEmpty。测试 `mcpListChangedRefresh.214.test.ts`。见 `batch-e-mcp-list-changed.extract.md`。 |
| 43  | `**claude rc` home 目录 trust** 文案：永不落盘 + 建议项目目录                                         | **HAVE**        | densable `Rdr.homedir()===At()`：interactive home copy（`claude rc` + never saved）+ headless em-dash Remote Control copy；`bridgeMain.ts` 两路径。见 `batch-d-bg-daemon.extract.md`。                                                                                                          |
| 44  | **Changed**：hook `if:` 单段 `dir/`** 仅 cwd；any-depth 用 `**/dir/**`（deny/ask 仍 any-depth） | **HAVE**        | densable `hqe`：`matchesPathRule`；File/Notebook `preparePermissionMatcher` 改用 hqe（非裸 wildcard）。                                                                                                                                                                                          |
| 45  | **Changed**：`file -m/--magic-file`、`-f/--files-from` 需权限（非只读 auto-allow）               | **HAVE**        | `BashTool/readOnlyValidation` `file.safeFlags` 去掉 `-m`/`--magic-file`/`-f`/`--files-from`。                                                                                                                                                                                              |
| 46  | **Changed**：stale-connection 后 **禁用 keep-alive 池**，重试新 socket                          | **HAVE**        | densable `Pwi`/`EYy`：stale 时**无 GB 门闩**直接 `disableKeepAlive()`；`getProxyFetchOptions`  sticky `keepalive:false`。本地移除 `tengu_disable_keepalive_on_econnreset` 默认 false 门闩。`staleConnection.214.test.ts`。                                                                                     |
| 47  | **Changed**：SessionStart hooks `**source: "fork"`**（fork 新建 ≠ `"resume"`）              | **HAVE**        | densable matcher/schema/`I1e(xr==="fork"?"fork":"resume")`/`forkSession?"fork"` + title cache 含 fork：`sessionStart`/`hooks`/`REPL`/`conversationRecovery`/`main`/`print`/SDK schema。见 `batch-d-bg-daemon.extract.md`。                                                                  |


---

## 统计（Batch E 全收口后）


| 状态            | 条数      | 说明                                                                              |
| ------------- | ------- | ------------------------------------------------------------------------------- |
| **HAVE**      | **47**  | A+B+C+D+E 全量（#1–47，含 #31 RC ready-push）                                      |
| **PARTIAL**   | **0**   | —                                                                               |
| **GAP**       | **0**   | —                                                                               |
| **GAP/AUDIT** | **0**   | —                                                                      |
| **N/A / LOW** | **0**   | —                                                                               |


> Batch A 全量落地见 `batch-a-permissions.landed.md`。禁止在未 extract 的情况下「猜实现」。

---

## densable 二进制证据（抽样）


| 符号 / 字符串                                                                                                                                           | 含义                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `EndConversation`, `END_CONVERSATION_TOOL_NAME`, `isEndConversationToolEnabled`, `parseEndConversationFlagValue`, `modelMeetsEndConversationFloor` | EndConversation 工具 + GB/模型门闩 |
| `tengu_end_conversation_tool_call`, `tengu_umber_kestrel`                                                                                          | 遥测 / 相关 flag                 |
| `tool_heartbeat`, `yield-twin tool_progress heartbeat`                                                                                             | 长工具 heartbeat                |
| `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`                                                                                                              | OTel 内容截断 env                |
| `tool_source`（builtin / mcp / sdk_host…）                                                                                                           | OTel tool provenance         |
| `subagentStatusLine`                                                                                                                               | 状态行（本地已有壳，缺 effort）          |


---

## 推荐实施批次（仍 extract-first）

### Batch A — 安全阀（优先）


| 官方 #            | 主题                                                             |
| --------------- | -------------------------------------------------------------- |
| **1 + 44**      | path glob：allow 单段 cwd-only；hook if 同步；deny/ask 保持 any-depth   |
| **2–6, 14, 45** | Bash/PS 权限 fail-closed + docker daemon-redirect + `file -m/-f` |
| **16**          | pkill 自保                                                       |
| **7**           | remote 权限确认 race                                               |


### Batch B — EndConversation + 可观测


| 官方 #          | 主题                                                               |
| ------------- | ---------------------------------------------------------------- |
| **8**         | EndConversation 全量 1:1（flag、模型 floor、reflection、marker、shutdown） |
| **9**         | tool progress heartbeat                                          |
| **11–12, 41** | OTel 字段 + content max + out-of-context trace                     |
| **13**        | subagentStatusLine + effort（小补丁）                                 |
| **10, 37**    | memory frontmatter `modified` + `#` 截断                           |


### Batch C — PowerShell / Windows 可靠性


| 官方 #       | 主题                                             |
| ---------- | ---------------------------------------------- |
| **21–25**  | stdin hang、编解码、where/fc/diff、UTF-16LE redirect |
| **18, 46** | Socket closed / keep-alive 禁用                  |


### Batch D — 后台会话 / daemon / RC


| 官方 #      | 主题                                                   |
| --------- | ---------------------------------------------------- |
| **26** | control socket skipUnlink on yield — **HAVE** |
| **27–30** | idle 回收、rm/delete、unreadable-folder reopen — **HAVE** |
| **31** | RC push gate — **GAP/KAIROS skip** |
| **32**    | agent-view vs headless 命令拒绝（AUDIT）                    |
| **43**    | rc home trust 文案 — **HAVE**                           |
| **47**    | SessionStart `source: "fork"` — **HAVE**              |


### Batch E — 边角 / 回归


| 官方 #                             | 主题                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **17, 36**                       | settings 2MiB + shell-config 目录 — **HAVE**（`batch-e-settings-shell.extract.md`）                                                                                       |
| **19**                           | stream-json drain 按队列字节 — **HAVE**（`batch-e-stdout-drain.extract.md`）                                                                                                 |
| **20**                           | scheduled tasks assigned-task banner — **HAVE**（`batch-e-schedule-prompt.extract.md`）                                                                                   |
| **35**                           | ultrareview empty-tree / no_merge_base — **HAVE**（`batch-e-ultrareview-empty-tree.extract.md`）                                                                              |
| **38**                           | multi-frame message_delta cost credit — **HAVE**（`batch-e-message-delta-cost.extract.md`）                                                                                |
| **42**                           | MCP list_changed keep previous — **HAVE**（`batch-e-mcp-list-changed.extract.md`）                                                                                         |
| **33, 40**                        | plugins `--settings`、hook exit2 — **HAVE**                                                                                                                               |
| **34, 39**                        | OAuth flag 刷新 — **HAVE**；advisor “check your network” — **HAVE**                                                                                                            |


### 故意后置 / 不动

- **UDS_INBOX / LAN_PIPES / TEAMMEM**：默认 OFF  
- **KAIROS**：不再加码  
- **2.1.213**：无独立 changelog，不单开对齐  
- **GrowthBook #15/#34**：均已 HAVE（null/malformed + OAuth 轮换）

---

## 下一步

1. densable 214 二进制已下载（Windows：`%TEMP%/official-214`；历史路径 `/tmp/official-214`）。
2. **Batch A 已落地**：#1+#44 path glob、#2 PS5.1 shadow、#3 fd redirect、#4 dual 10k parse-abort/F7u、#5 zsh `[[ ]]`、#6 help/man、#7 remote race dismiss、#14 docker aQn、#16 pkill K2g、#45 file flags。
3. **Batch A 残留已收口**（#2/#4–7）；验证见 `batchA214.residual.test.ts` + `remoteSessionPermissionRace214.test.ts`。
4. **Batch B 已收口**（#8/#9/#11–13 + tails #10/#37/#41）。
5. **Batch C 已收口**（#21–25 PS + #18/#46 socket/keep-alive）。extract：`batch-c-ps-win.extract.md`。
6. **Batch D 已收口**（#26–30/#32/#43/#47；#31 KAIROS skip）。extract：`batch-d-bg-daemon.extract.md`。
7. **Batch E 已收口**：#15/#17/#19/#20/#33/#34/#35/#36/#38/#39/#40/#42。extract：含 `batch-e-growthbook-null-payload` / `batch-e-oauth-flag-stale` / `batch-e-advisor-network-stall` 等。
8. **残留**：仅 #31 KAIROS skip（站位规则不再加码）。
9. **214 产品 0 GAP**（KAIROS 故意跳过不计入）。

## 关联

- 212 收口：`docs/upstream-extraction/v2.1.212/official-212-checklist.md`  
- 上游原文：`docs/upstream-extraction/v2.1.214/CHANGELOG.upstream.md`  
- Batch A extract：`batch-a-security.1to1.md` · 落地：`batch-a-permissions.landed.md`  
- EndConversation：`end-conversation.extract.md` · heartbeat/OTel：`heartbeat-otel.extract.md`  
- Batch C PS/Win：`batch-c-ps-win.extract.md`  
- Batch D bg/daemon/RC：`batch-d-bg-daemon.extract.md`  
- EndConversation 研究文：[https://www.anthropic.com/research/end-subset-conversations](https://www.anthropic.com/research/end-subset-conversations)

