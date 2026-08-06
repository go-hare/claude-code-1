# densable 2.1.212 — 官方更新清单 × go-hare 对照

> 来源：用户提供的官方 2.1.212 release notes（与 upstream CHANGELOG `## 2.1.212` 一致）。  
> 基线：产品 2.7.27 / git `3dbad654`。  
> 状态图例：**GAP** 未对齐 · **PARTIAL** 有半截 · **AUDIT** 需对照 densable 再判 · **HAVE** 已有/非本版目标 · **LOW** 可选 cherry-pick

| # | 官方条目 | 状态 | 本地备注 |
|---|----------|------|----------|
| 1 | **`/fork` → 复制对话到新后台会话**（`claude agents` 单独一行，主会话继续）；原会话内子代理改 **`/subtask`** | **HAVE** | 2026-08-05 densable `nZ_→L2p→D$t keepParent` + residual-3 + P0–P1：L2p `Forking…`、`kei/Iei`、`Hei/xei` sticky、`gXe/rti`、`D6e` leaf、dual reg live、gwd/subtask agentId toast、bgIsolation/git/permission-mode/memory。extract: `keepParent-fork.extract.md` |
| 2 | **`claude auto-mode reset`**（确认提示，`--yes` 跳过） | **HAVE** | 2026-08-05 densable `PbS`：`autoModeResetHandler` + `--yes`；userSettings 删 `autoMode` |
| 3 | **WebSearch 会话上限** 默认 200，`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` | **HAVE** | densable `vtu`+soft return；`sessionSpawnCaps` + WebSearchTool |
| 4 | **子代理 spawn 上限** 默认 200，`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`；`/clear` 重置 | **HAVE** | densable `Etu`+throw；AgentTool `N()` + `/clear` reset |
| 5 | **MCP 调用 >2min 自动后台**，`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | **HAVE** | densable `Ncy`/`$cy`：默认 120s GB on；wired in mcp `client.ts` via monitor_mcp |
| 6 | **Agent view `/resume`**：含已删列表项的 picker → 作后台会话恢复 | **HAVE** | densable fWa/Tt：`openResumePicker` exclude 非 archived live ids；`listSessionsImpl` limit **B7b=200**；并集 soft-archived/Earlier；overlay → `submitDispatch` bg resume；extract `agents_ux_batch3.extract.md` |
| 7 | Plan mode 不再自动跑改文件类 Bash（`touch`/`rm`…），需权限或 SDK `canUseTool` | **HAVE** | 2026-08-05 densable: plan 跳过 acceptEdits fastpath；`checkWritePermissionForTool` plan ask；plan_mode_floor 扩到 non-RO；Zlr prePlan elevated 不建议 acceptEdits。extract: `plan_mode_bash_write.extract.md` |
| 8 | worktree 创建不跟随仓库内 `.claude/worktrees` 符号链接（防写出仓外） | **HAVE** | 2026-08-05 densable `xqi`: `assertWorktreeCreatePathsNotSymlinked` lstat `.claude`/`worktrees`/target + post-add containment; wired in `getOrCreateWorktree`. extract: `worktree_symlink_guard.extract.md` |
| 9 | hook `continue:false` 在 tool 失败/中流完成时不丢 halt；hook 基建错误 ≠ 用户拒绝 | **HAVE** | 2026-08-05 densable `LKr`: deny/catch/stop/success 均 emit `hook_stopped_continuation`；infra catch re-yield permission 或 ZFu stopReason。extract: `hook_continue_false_halt.extract.md` |
| 10 | print/SDK 下 Bash + SIGTERM：中止 turn、杀进程树、exit **143** | **HAVE** | 2026-08-05 densable `uxs/Vwo` + print `se`: SIGTERM abort `remote-cancel` + kill tree + `Ts(143)`；global SIGTERM no-op when print handlers registered。extract: `print_sigterm_bash_143.extract.md` |
| 11 | Windows `/background` & `--bg`：GP 禁 PS5.1 时 `uv_spawn` → 守护进程优先 **PS7** | **HAVE** | 2026-08-05 densable `YKh`: windows_fallback_path ProgramFiles/WindowsApps/.dotnet pwsh before 5.1; absolute System32 powershell last. extract: `windows_bg_ps7.extract.md` |
| 12 | shell mode `!`：路径 autocomplete 打开时仍能执行含路径命令 | **HAVE** | 2026-08-05 densable Ye `r(q1e(),!0)`：bash-path 裸 Enter bn=true 绕过 onSubmit `$0=every(description==="directory")`（lKs 无 description）；`ie` 双提交护栏；`\`/Apple shift 不 intercept。extract: `shell_bang_path_autocomplete.extract.md` |
| 13 | auto-mode 拒绝通知截断半个 emoji 不乱码 | **HAVE** | 2026-08-06 densable `Jd`：`truncateCodeUnitsSafe` + auto-mode deny reason `Jd(reason,79)+…`；extract: stringUtils |
| 14 | agent view 调度输入 Ctrl+J 换行 + `?` help 展示 | **HAVE** | 2026-08-06 densable Chat `ctrl+j`→`chat:newline`；AgentView/fleet help `ctrl+j for newline` |
| 15–18 | `/ultrareview`：PR 引用、远程 branch fetch、`/clear` 后计费确认、Desktop 非 git 文案 | **HAVE** | 2026-08-06 densable `yqr`/`YI_`/`XI_`/`nst`/`Ibp`/`M6e` + **YOo/JOo/Qre/Jes 全量**：size/`kPr`/`KJe`/`fm`/wrong_repo + telemetry + `source`/`tags:["ultrareview"]`/`bundleBaseRef`→Jes `baseRef` + explicit `onBundleFail`（≠too_large）+ stash_failed/no_changes + JOo 短 fail copy/`launched{mode,had_arg}`/Scope。extract: `ultrareview_15_18.extract.md` + `ultrareview_fn_{YOo,JOo,Qre_teleport,Jes_x1g_gitBundle}.js` |
| 19 | 托管会话：忽略 repo settings 的 mTLS/extra CA/OAuth scopes + 警告 | **HAVE** | 2026-08-05 densable LGm/KVt/PGm + s_o/byy：host-managed 剥离 mTLS/CA/OAuth scopes/proxy + 警告；`caCertsConfig` qp_ 跳过 settings NODE_EXTRA_CA_CERTS。extract: `hosted_mtls_ca_oauth_scopes.extract.md` |
| 20 | resume 后编辑曾 offset/limit 读过的文件 → 假 “File has not been read yet” | **HAVE** | 2026-08-05 densable Woo/HOe/xOe：`extractReadFilesFromMessages` 保留 ranged offset/limit + `isPartialView`；Edit/Write `!p||isPartialView` not-read + HOe stale bypass。extract: `fileEdit_not_read.extract.md` |
| 21 | print/SDK `--continue`/`--resume` 后 `ExitWorktree` “no active EnterWorktree” | **HAVE** | 2026-08-05 densable print `e_t`+`E$e`：`--continue`/`--resume` 在 `restoreSessionMetadata` 后 `restoreWorktreeForResume` + `adoptResumedSessionFile`；fork 仍 strip worktree。extract: `exit_worktree_print_resume.extract.md` |
| 22 | Remote Control 中途加入 → workflow agent 网格空 | **HAVE** | 2026-08-05 densable JT/FC/eDe + MGe drain + IGg/j8r full snapshot：`isReplBridgeActive` 真 gate；交互+bridge 入队 task_progress；useReplBridge writeSdkMessages task_*；agent `state:progress` + kGg=10s 全量 workflowProgress。extract: `rc_workflow_agent_grid.extract.md` |
| 23 | streaming control 请求 handler 未完就 mark complete → 重启丢请求 | **HAVE** | 2026-08-05 densable Ko/ra/Ns：outer 排除 control_request/bash_command；try/finally 仅 !Ko 时 completed；generate_session_title/side_question 走 ra。extract: `control_request_lifecycle.extract.md` |
| 24 | `/fork` 建的后台会话 state 写失败后丢 live-parent 保护 | **HAVE**（随 #1） | keepParent：先 snapshot 再 writeA8q；snapshot/write 失败 rm jobDir 且不伤 parent transcript；`forkSourceAlive:true` |
| 25 | 从 agent view 重开已停后台会话：resume 或说明原因+强制重启 | **HAVE** | densable Xyr/NPn/IAe/BJe/gpn：refuse 核心 + **BJe**；gpn **写** + **消费** `$=initial??queued??intent`（`w\|\|N` 跳过 intent）+ 成功 `queuedPrompt:void 0`；tYo/`forceRefusalRetry`。客户端 **hLp/D9e/gLp/Yia/Zxe** preflight（`xyrRespawn.ts` + AgentView ENOJOB）。**xSe/Uq_ 1:1**：`uqArgvPeel.ts`（Qyr/yie/IUe/r2o/WLp/t6_/n2o/GLp/VLp/qat/UNC）+ `xSeSpawn` e6_（含 cloud）→ mkdir → peel→launch → seed → isa → rescue；CLI `handleBgStart` 传 full argv |
| 26 | agent teams：停止中 teammate 重复 idle 通知 | **HAVE** | 2026-08-05 densable `hZc`/`gZc`：`id:"teammate-idle-notification"` + same-id function hook **replace**（非 append）；inProcessRunner `wasAlreadyIdle` skip 已有。extract: `teammate_duplicate_idle.extract.md` |
| 27 | plan 审批 footer 长路径拆开 “ctrl+g to edit” | **HAVE** | 2026-08-06 densable `Fe({chord:"ctrl+g",action:\`edit in ${ABb}\`})` + path 同 dim Text（KeyboardShortcutHint） |
| 28 | fullscreen 欢迎 banner 宽高同时 resize 后宽度不更新 | **HAVE** | 2026-08-06 densable `E0`/`YVe` 4-tuple：OffscreenFreeze pureCheck + columns/rows layoutEffect forceUpdate |
| 29 | 窄布局 diff 丢行号 / +/- | **HAVE** | 2026-08-06 densable StructuredDiff gutter `NoSelect fromLeftEdge flexShrink={0}` |
| 30 | @-mention 部分读后空附件；plugin 卸载错 marketplace；exit 143 假 “Command timed out” | **HAVE** | 2026-08-05 **exit 143** `command_timeout_exit_143`。2026-08-06 **@-mention Eio** `at_mention_partial_eio` + token-cap YAu/XAu。**plugin uninstall marketplace**：`_Fe` 候选仅在无 `@` 时扩 name@*；`wu_` `!a\|\|!p`；Lwe/are。extract: `plugin_uninstall_marketplace.extract.md` |
| 31 | OTel HTTP 非 chunked（Azure Monitor 411/400） | **HAVE** | 2026-08-05 densable `Lvd`/`YAo`/`Mvd`/`JAo`：Agent `addRequest` 缓冲 body 写 `Content-Length`；`getOTLPExporterConfig` 恒接 Mvd。extract: `otel_http_content_length.extract.md` |
| 32 | OTLP + TRACEPARENT 缺 trace_id/span_id（SDK/headless） | **HAVE** | 2026-08-05 densable `PKh`/`gu`/`DKh`：非交互 + TRACEPARENT extract → log `context`；interaction span 同 extract。extract: `otel_traceparent_log_context.extract.md` |
| 33 | 多图对话误 “Request too large” + 更好错误文案 | **HAVE** | 2026-08-05 densable `X8i`/`R5i=32MB`：copy 改为累积图/附件；413 分流 context window→PTL vs `request_too_large:` errorDetails；`Gvg`/`isMediaSizeError` 含 request_too_large。extract: `request_too_large_multi_image.extract.md` |
| 34 | WebSearch/Fetch 过载时别把 “API Error” 当结果正文 | **HAVE** | 2026-08-05 densable：`isApiErrorMessage` → throw `tn`/`TelemetrySafeError`（WebSearch `web-search-side-query-api-error`；WebFetch `web-fetch-apply-api-error`）；不把 overload 正文当 tool result。随 #35。extract: `web_tool_retry_529.extract.md` |
| 35 | WebSearch/Fetch 重试 529 + rate-limit 有界 backoff | **HAVE** | 2026-08-05 densable `swh`/`O6t`：`web_search_tool`+`web_fetch_apply` 入 FOREGROUND_529；`agent:*` prefix；withRetry 有界 backoff 继承。extract: `web_tool_retry_529.extract.md` |
| 36 | prompt cache：中段 system block 在 gateway/自定义 baseURL 可用 | **HAVE** | 2026-08-06 densable 1:1：J8t/o3/xNi/B6n/eN/Jdy + sticky KQn/e9i + Ydy midConvFallback + MidConvSystemRetryError；`/clear`/`/compact` 重置 sticky。extract: `mid_conversation_system_cache.extract.md` |
| 37 | 后台 agent 冷 attach 立即显示格式化 transcript | **HAVE** | densable Nia/J5_/B5_：`attachTranscriptPreview` + `handleAttachOp` cold preview；FPp=262144、M5_=4096、O5_=50ms、F5_=2、U5_=dark；caps `colorLevel`/`systemTheme`；**J5_ chalk.level + zn/color theme**（user subtle/text/userMessageBackground；assistant X5_=`applyMarkdown`；thinking italic；footer dim） |
| 38 | `SendMessage` 正文不重复进 replay history / tool results | **HAVE** | 2026-08-05 densable `vKg`/`xKg`/`Bs(…,50)`：mailbox 写全文；`routing.content` + `backfillObservableInput` 仅 50 宽预览；mapToolResult stringify 不再夹带长正文。extract: `sendmessage_body_preview.extract.md` |
| 39 | `/fork` 无标题时用 prompt 命名副本行 | **HAVE**（随 #1） | `resolveForkSessionName` / `deriveForkName` + densable glyph+prompt label |
| 40 | bare `/btw` 重开最近 side-question 面板 | **HAVE** | 2026-08-05 densable `IO_`/`lNt`/`Scn`/`yXs`：`VI_=20` history ring；空参 `lNt().at(-1)` + `initialResponse` 重开；`xhr` threadHistory + 非 synthetic 才 append；panel 历史列表/←→/`c`/`f`/`x`。extract: `btw_reopen_last.extract.md` |
| 41 | `←` footer 在 bg agent 完成时短暂闪 `N done` | **HAVE** | densable FFe/K2e：`AgentsFooterHint` fpf pulse `← N done`（Ozo=2500ms） |
| 42 | Task/`Agent` **`mode` 参数废弃**（忽略）；子代理默认继承父 permission mode | **HAVE** | 2026-08-05 densable：schema describe deprecated；call `void mode`；`plan_mode_required` 用父 mode；worker pool `agent.permissionMode??parent`（非 acceptEdits）。extract: `agent_mode_deprecated.extract.md` |
| 43 | Enterprise `forceLoginMethod` 扩到 VS Code / SDK / setup-token / install-github-app | **HAVE** | 2026-08-06 densable A9t/Stt/h5t/_ae + **g2s OIDC wizard**：enum+`forceLoginGatewayUrl`；setup-token / CLI / SDK / install-github-app 强制校验；`ConsoleOAuthFlow` `gateway_setup`→`GatewayConnect`（$zd/mOc/o2r/trust/gOc/device poll/Smc）→`gateway_done`。extract: `force_login_method.extract.md` |
| 44 | transcript 记录每条 assistant 的 **reasoning effort** | **HAVE** | 2026-08-05 densable `Ie`：`output_config.effort` string + MPe/AR → stamp `effort` on every AssistantMessage（stream stop / non-stream / 404 fallback）。`transcriptEffortFromOutputConfig` + claude.ts 三写。numeric effort_override 不落盘。extract: `transcript_assistant_effort.extract.md` |
| 45 | headless/SDK 中途 `set_model` 下轮即生效 | **HAVE** | 2026-08-05 densable print set_model：type check + default trim + RGf/DGf + allowlist/h5 step-down；Ye + HS + **mainLoopModelForSession**；条件 breadcrumbs（family/main 变化）；bridge onSetModel 同三写。extract: `set_model_next_turn.extract.md` |
| 46 | agents view / `--json`：等 sandbox/MCP-input/managed-settings → **“Needs input”** 非 “Working” | **HAVE** | densable Vce/a7u/c7u/UIb：slots 优先级 + a7u 双读 + `inFlight` stamp；c7u `permissionBridgeSubscribed`/`bridgeWriteChain`/await `e.inFlight`；dialog kinds；**tDt/shs/ihs** 真 registry（`shs`=**全量 replace** `t7r=e`）；**Tmo→l7u**；**ihs→u7u**（空 items 保留 fan，与 densable `o===void 0` 一致）。**JFa 全量生产者 1:1**：`jfaInFlightStamp.ts` VFa/qFa/zFa + W6e/Akd（+session_cron）+ AWt/vWt budget；`JFaInFlightProducer`（App 挂载 + AppState reader + React 路径亦 load tasksV2）+ framework stamp → full shs（无 budget 时 clear sticky） |
| 47 | Auth 面板标题 “Cloud authentication” → **“Authentication”** | **HAVE** | 2026-08-06 densable Auth panel title `"Authentication"`（AwsAuthStatusBox） |
| 48 | 2.1.200 说明勘误：tmux 3.6 无 synchronized output | **N/A** | 文档勘误 |

---

## 推荐实施批次（仍 extract-first）

### Batch 1 — 安全阀（#3 #4 #5）
会话级 WebSearch / subagent 上限 + MCP 长调用自动后台。风险低、与 UI 语义解耦。

### Batch 2 — Fork 语义分裂（#1 #24 #39）
- `/fork` = bg session copy + `deriveForkName` + live-parent  
- `/subtask` = 现有 in-session full-context fork（AgentTool / `spawnForkFromDirective` 会话内路径）  
- 文档 `fork-subagent.md` 同步改写  

### Batch 3 — Agents 体验（#6 #25 #37 #41 #46）
`/resume` picker、重开 stopped session、冷 attach transcript、`N done`、Needs input。

**2026-08-05 深层 residual 已落地**（surface Batch3 之后）：
- **#25** BJe + gpn 写/读闭环：`$=initial??queued??intent`；`w\|\|N` 跳过 intent；成功 clear `queuedPrompt`；**Xyr client preflight** hLp/D9e/Yia/Zxe（`xyrRespawn` + AgentView ENOJOB）；**xSe 壳** `xSeSpawn`（e6_/mkdir/seed/isa/rescue）
- **#46** c7u 链形 + a7u 双读/inFlight；**tDt 真计数**；**Tmo→l7u** + **ihs→u7u**；**JFa 全量** VFa/qFa/zFa/W6e/budget → shs；React producer 含 tasksV2
- **#6** fWa 语义：exclude 非 archived live + limit 200 + merge soft-archived
- **#37** M5_/O5_/F5_/U5_ + attach caps；**J5_ chalk theme / X5_ applyMarkdown**
- 测试：`transcriptProbe` + `xyrRespawn` + attach theme + bgNeeds tDt + `jfaInFlightStamp` + `xSeSpawn`（17 pass）；独立复验 **PASS**（e6_ CLI 接线 + todos reader + budget clear）
- extract：`xSe_JFa.extract.md` + `Uq_*.raw.js`；**Uq_ 全量 argv peel** 已落地 `uqArgvPeel.ts`（非子集旁路）

### Batch 4 — 可靠性 cherry-pick（#7–12 #20–23 #33–36 #38 #42–45）
按痛点选做；每项先 binary extract，禁止“简化版”替代。

### 暂不默认开
UDS_INBOX / LAN_PIPES / TEAMMEM；KAIROS 不再动；不把 214 EndConversation 混进 212。

---

## densable 关键常量（已从 2.1.212 二进制确认）

| 符号/env | 值 |
|----------|-----|
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | default **200** (`qpg`) |
| `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` | default **200** (`zpg`) |
| `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | 配置阈值；changelog **2 minutes** 默认行为需 call-site 再确认 |
| taskRegistry | `increment/get/reset` × (AgentSpawns, WebSearchCalls) |
| `/fork` / `/subtask` | 共用 `spawnForkFromDirective`（`xZr`）；description 不同 |

完整 pack：`docs/upstream-extraction/v2.1.212/pack-report.md`
