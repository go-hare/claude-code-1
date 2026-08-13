# densable 2.1.216 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.216 release notes（`CHANGELOG.upstream.md` / `changelog-2.1.216.md`，**40 条**）。  
> densable 二进制：`/tmp/official-216/plat/package/claude`（`npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.216`，**249 225 584** bytes；VERSION **2.1.216**）。  
> 基线：产品 **2.7.30** / densable **2.1.215** 已落地（`1eb81339`，`/verify`+`/code-review` disableModelInvocation）。  
> 状态图例：**GAP** 未对齐 · **PARTIAL** 有半截 · **AUDIT** 需再判 · **HAVE** 已有 · **N/A** 不适用 · **LOW** 可选  
> 约定：**extract densable first → 1:1**，禁止简化版替代。KAIROS 不再加码。UDS/LAN/TEAMMEM pack 当时写默认 OFF — **2026-08-12 起 `DEFAULT_BUILD` ON**。  
> 详包：`pack-report.md` · FS disable 专文：`sandbox-filesystem-disabled.extract.md`

## 邻版关系

| 版 | 性质 | go-hare |
|----|------|---------|
| **2.1.214** | 大包（安全阀 + EndConversation + PS/Bash + bg daemon） | **已收口**（2.7.30） |
| **2.1.215** | `/verify` + `/code-review` 禁止模型自启 | **已落地**（`1eb81339`） |
| **2.1.216** | 长会话 / sandbox / worktree / bg / UI 可靠性大包（40 条） | **本清单** |
| **2.1.217+** | 后续 | **另开 pack** |

---

## 全量对照（40 条官方）

编号 = `changelog-2.1.216.md` 条目顺序。

| # | 官方条目（摘要） | 状态 | 本地备注 |
|---|----------|------|----------|
| 1 | **`sandbox.filesystem.disabled`**：跳过 FS 隔离、保留网络 egress | **HAVE** | schema + zRg resolve + dual facade（OUTER getFs* raw / convert·wrap unrestricted）+ Bou override.filesystem + uCg `[]`；network 保留；project/local 忽略、managed lock。tests: `sandbox.filesystem.disabled.216` |
| 2 | 长会话 message normalization 二次方变慢 | **HAVE** | densable LN：`assistantIdToIndex` Map + `mapScanFrom` cursor；tool_result/api_system TRANSPARENT。tests: `normalizeMessagesForAPI.quadratic.216.test.ts` + messages CC-1215 rewrite |
| 3 | auto mode 在 OAuth 过期/轮换后因 “HTTP 401” classifier 误拒绝 | **HAVE** | sideQuery 401/revoked → `handleOAuth401Error` + rebuild single retry + `tengu_oauth_401_sidequery_recovered`；fO_/mO_/Mhd；hUd/f6d empty；handoff CYu allow-with-warning。tests: `sideQuery.oauth401.216` + `classifierErrorKind.216` + `autoMode401FailClosed.216` |
| 4 | AskUserQuestion 自由文本中立措辞（勿强迫 continue） | **HAVE** | pure structured → continue；free-text/notes → careful-read；`response` / AFK c7u / `notes:`。tests: `mapToolResult.216.test.ts` |

| 5 | Claude Code **on the web** idle 后重问/丢答案 | **HAVE** | server `l1S` success reinit + pending_*；Query SDK `processPendingPermission/Dialog`（`@anthropic-ai/claude-agent-sdk`）；`RemoteSessionManager` densable 仅 dialog redelivery（与 SEA 一致，非 permission）。extract: `web-idle-reinit.extract.md`. tests: `sdkReinitRedelivery.216` + remote 214 |
| 6 | @-mention / hooks / vim paste / statusline 双跑 / resume-picker hang | **HAVE** | 四针：Eio+H1e contentNotInModelContext；vim Poa/Hmn；statusline skip-first；resume IQf sticky。extract: `ui-umbrella-6.extract.md`. tests: `dotRepeat.216` / `statusLineSkipFirst.216` / `resumePickerHang.216` / `fileStateHOe` |
| 7 | 恢复的 bg agent 退回 default agent（prompt + tool 限制） | **HAVE** | densable Aye：sidecar `isFork`/agentType/model/spawnMode/worktree*/cwd + H4d `$Ns` merge；resume j/B/G 选 agent + exact tools。tests: `resumeAgentIdentity.216.test.ts` |
| 8 | worktree 子 agent 经 `git -C` / `--git-dir` / `GIT_DIR`/`GIT_WORK_TREE` 指回共享 checkout | **HAVE** | `worktreeGitIsolation.ts` XB scrub + Bash shared-checkout deny；worktree git lifecycle 全 `gitWorktreeEnv()`。tests: `worktreeGitIsolation.216.test.ts` (15) |
| 9 | worktree 会话落到其他项目残留 worktree | **HAVE** | densable DXi: resume 时 `gitdir` parent dev/ino vs `<repoGitDir>/worktrees`；`git_worktree_resume_foreign_repo` + densable 文案。tests: `worktreeForeignRepo.216.test.ts` |
| 10 | bg 无 git 的 worktree 删不掉 | **HAVE** | `deleteJob.ts`：`gitError` 短路 dirty/unpushed，`force\|\|gitError` → left_in_place + 仍 rm jobdir（214 C2e 系） |
| 11 | `claude daemon stop --any` 经陈旧 legacy lock 误杀无关进程 | **HAVE** | UTe/DSr + `--any` gate + never SIGTERM unverified + t_n；**client wUs/AUs** (`clientBgReap.ts`)：control 后 `supervisorKilledAll` + fallback `wUs`；`--keep-workers` 跳过；`Math.max` reaped；kept note；win32/holder 前缀。tests: `daemonStop.216` + `readDaemonLockLoose.216` + `daemonStopReap.216` |

| 12 | 有 bg tasks 时长会话 idle 下 Esc-Esc 不打开 rewind picker | **HAVE** | densable Opu/x4：chat:cancel isActive 仅 editable 队列（排除 task-notification）；idle Esc 落到 doublePress→message selector。extract: `esc-esc-rewind.extract.md`. tests: `escEscRewind.216.test.ts` |
| 13 | Bash 权限：`&&` 列表 / 否定里的 redirect | **HAVE** | densable `uxg`/`$uu`：peel list/negation leaf + `A && B` post-A redirect scope + `$FOO` target。tests: `listNegationRedirect.216.test.ts` |
| 14 | Agent list Ctrl+X×2 删除失败；worker 死后已删会话重现 | **HAVE** | densable wL/yte tombstone 过滤 refresh；active/blocked 先 stop+justKilled arm(2000ms)；第二击 C2e force；Esc→bte。extract: `agent-list-ctrlx-delete.extract.md`. tests: `agentViewDelete.216.test.ts` |
| 15 | 高优先级消息在 startup window 取消新建 bg subagent | **HAVE** | densable L(G&&!B)+post-setup gate：async local 对 reason `"interrupt"` 免疫；`assertCanSpawnSubagent({allowInterrupt})`；Flt 无 parentAbort。tests: `bgStartupCancel.216.test.ts` |
| 16 | GUI 编辑器打开时鼠标/焦点垃圾；`/memory` 不等待关闭 | **HAVE** | densable prepare/restoreTerminalForHandoff + Wut GUI handoff + `/memory` jCo 不阻塞。extract: `gui-editor-mouse.extract.md`. tests: `guiEditorHandoff.216.test.ts` |
| 17 | Claude-in-Chrome 缺 scope 时 403 重连循环 | **HAVE** | densable JKn/yhn：enable 前拒无 profile/office/ccr_inference；disable 文案 1:1。extract: `chrome-403.extract.md`. tests: `oauthValidateScope.216` + `shouldEnableClaudeInChrome` |
| 18 | workflow / scheduled-task 写跟随 `.claude` 符号链接逃出项目 | **HAVE** | densable **YNn/M6/nWr/L1a**：`symlinkWriteGuard`（Fle/VEt/YNn/M6/Bhe）+ `writeCronTasks` nWr + `saveDynamicWorkflow` L1a；workflow-engine `persistInline` 本地 YNn（零 core 依赖）。tests: `symlinkWriteGuard.216` + `claudeDirWriteGuard.216` + `persistInline` |

| 19 | MCP re-auth 在新登录成功前撤销可用凭据；bg needs-auth 命令不可用 | **HAVE** | densable QLu→ebe→eMu UI；t7r 永久 refresh clear → toast；oKn=n5e\|DYt(prg WeakSet)\|Fce（**非** headersHelper 字符串）；CLI 仍 wat 与 densable 一致。tests: `mcpReauth.216.test.ts` |
| 20 | Windows 只读命令访问网络路径不弹权限 | **HAVE** | densable `sI(e,forPath)` path-mode + Rjr `sI(o,!0)`；RO Bash/PS 走 path-mode；`%` windows-only + backtick。tests: `uncNetworkPath.216.test.ts` |
| 21 | Bash 非 ASCII 与真实 shell 词边界一致 | **HAVE** | densable `guu`：`isWordChar` 含 `>= \\x80`。tests: `nonAsciiWordBoundary.216.test.ts` |
| 22 | PowerShell 含不可见 Unicode 的权限校验 | **HAVE** | densable `XAu`/`r0e`/`Wjg` schema refine；PS+Bash `command` 拒 C0/C1（留 TAB/LF）。tests: `controlChars.216` + `controlCharsSchema.216` |
| 23 | 全屏 dialog 超出 panel 右缘 | **HAVE** | densable minWidth:0 + ModalContext columns；Dialog/Pane/Tabs/FullscreenLayout clamp。extract: `fullscreen-ui-23-25.extract.md` |
| 24 | `/config` 全屏 keyboard-hint footer 被裁 | **HAVE** | densable sda：footer measure + flexShrink:0 + maxVisible=contentHeight-8-footer；labelWidth=min(44,max(14,cols-16))。tests: `fullscreenUi.216` |
| 25 | Ctrl+O transcript footer &lt;104 列换行 | **HAVE** | densable CZa 宽高门：stringWidth 折叠 virtual-scroll 段；无硬编码 104。tests: `fullscreenUi.216` |
| 26 | Prometheus exporter 非法 `# UNIT` 行 | **HAVE** | densable unit gate = OTEL 0.215 `descriptor.unit ? # UNIT : ""`；pure `prometheusUnitLine` 回归。extract: `prometheus-unit.extract.md`. tests: `prometheusUnitLine.216.test.ts` |
| 27 | 会话中改 skill/command 后 slash 菜单不刷新 | **HAVE** | densable XoS：agents 目录 + .md filter + idle poll + JoS fingerprint + stream-json `commands_changed` + mOf agents reload。extract: `skill-menu-refresh.extract.md`. tests: `skillMenuRefresh.216.test.ts` |
| 28 | 插件 skill frontmatter `name` 丢失 plugin 前缀（autocomplete） | **HAVE** | densable uzr：`D=\`${I}\${x}\`` + aliases；非 bare displayName。extract: `plugin-skill-prefix.extract.md`. tests: `pluginSkillPrefix.216.test.ts` |
| 29 | 遥测：permission-prompt 失败≠用户拒绝；中断报 user abort | **HAVE** | densable rx_: other+h8t→user_abort; fail/stream/schema→config. extract: `telemetry-user-abort.extract.md`. tests: `telemetryUserAbort.216.test.ts` |
| 30 | `/fork` 确认一行：新会话名 + attach id + 共享 checkout 注 | **HAVE** | densable rBo：`state · name · 8-hex · [edits this checkout]`。extract: `fork-oneline.extract.md`. tests: `spawnBackgroundSessionFork.test.ts` |
| 31 | PowerShell `git`/`gh` 参数校验加强 | **HAVE** | densable `I5g`/`oDu`/`H5g`/`XIu`：危险全局 flag 扩集、ls-remote 全 positional 拒、gh 恒 false。tests: `gitGhArgs.216.test.ts` |
| 32 | `/ultrareview` diff 过大：限额、实测大小、最大贡献文件 | **HAVE** | densable DHp largest files + limits 文案。extract: `ultrareview-size.extract.md`. tests: `reviewRemote.normalize.test.ts` |
| 33 | `/code-review ultra` 空 diff：点名 base ref + 建议显式 base | **HAVE** | merge-base empty_diff 点名 ref+sha + 显式 base 建议。extract: `ultrareview-size.extract.md`. tests: `reviewRemote.normalize.test.ts` |
| 34 | spend limit 调整被拒时展示服务端 reason | **HAVE** | densable Per+HWr：仅 user_facing message；dialog/nudge 文案 1:1。extract: `spend-limit-reason.extract.md`. tests: `spendLimitReason.216.test.ts` |
| 35 | `/context` 超窗明确警告；失败的 `/compact` 显示为 error | **HAVE** | densable Ftn 超窗红字 + markdown Over limit；stderr isError。extract: `context-over-limit.extract.md`. tests: `contextOverLimit.216.test.ts` |
| 36 | `/rewind` 不经 symlink/hardlink 恢复或删除；报告 skip 数 | **HAVE** | Q3g + **Z3g** `restoreBackupNoFollow`（O_NOFOLLOW）+ `realParentDir`；`fileHistoryRewind` 返回 `{filesChanged,skippedLinks}`；SDK `skippedLinks` + densable lrl describe；`handleRewindFiles` 透传；**TYn** MessageSelector + CLI Warning 文案 1:1。tests: `fileHistory.rewindSafe.216` |

| 37 | bg：`/mcp` 与 `/install-github-app` 无 client 时 park needs input | **HAVE** | densable CUt/zpd/gQp + sof/CRb；`bgCommandNeedsPark` + `subscribeAttacherCaps`；MCP reconnect needs-auth 文案。extract: `needs-input-bg.extract.md`. tests: `bgCommandNeedsPark.216.test.ts` |
| 38 | dataviz：默认 palette 重排 + 四序列 direct label 指引 | **HAVE** | densable 同 8 hex 重排：blue→**orange**→aqua→yellow→magenta→green→violet→red；ladder@4 yellow+orange + all-pairs cap 3。extract: `dataviz-palette.extract.md`. tests: `dataviz.216.test.ts` |
| 39 | **[VSCode]** 阿/希/波 RTL 混排 | **N/A** | 非本 CLI fork 产品面 |
| 40 | cloud 会话 container 中途重启丢 in-flight；resume 重跑 interrupted turn | **HAVE** | densable Szu max-age + BJr telemetry；detect/transform/print auto-resume 已有。CCR UI 文案 N/A。extract: `interrupted-turn-cloud.extract.md`. tests: `interruptedTurnStale.216.test.ts` |

---

## 统计（pack 日 2026-08-06）

| 状态 | 条数 | 说明 |
|------|------|------|
| **HAVE** | **38** | +#5 SDK reinit success redelivery（web idle） |
| **GAP** | **0** | — |
| **PARTIAL** | **0** | — |
| **AUDIT** | **0** | — |
| **N/A** | **1** | #39 VSCode RTL（扩展产品面，非本 CLI） |
| **合计** | **40** | Batch D closeout: 仅剩 N/A #39 |

> 收口目标：P0 批（#1/#2/#8/#11/#18/#36…）→ HAVE 后再谈 UI 抛光。  
> **禁止**在未 extract densable 时把 PARTIAL 直接标 HAVE。

---

## densable 二进制证据（抽样）

| 符号 / 字符串 | 含义 |
|---------------|------|
| `filesystem.disabled` + skip FS isolation describe | 设置项 schema + 语义 |
| `Gvg`/`Wvg`/`Hou`/`Bou` FS-off 分支 | 运行时：空 deny / `allowOnly:["/"]`，网络仍限 |
| `XB` 清 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR`/`GIT_INDEX_FILE` | worktree git 隔离 |
| `redirects git to the shared checkout` / `[worktree] blocked shell exec` | 用户/日志文案 |
| `preNormalizedMessageCount` / `query_message_normalization_*` | 长会话 normalize 计测 |
| `claude daemon stop --any` | 停 transient daemon |
| `` `# UNIT ${r} …` `` | Prometheus 单位行 |
| `user_abort` | 中断 vs 拒绝遥测 |
| Chrome OAuth scope disable 文案 | 403 循环相关 |
| `needs input` | bg park |

---

## 推荐实施批次

### Batch A — P0 隔离 / 数据完整（优先）

1. #1 `sandbox.filesystem.disabled`  
2. #8 worktree git 重定向防护（`XB` + 参数）  
3. #36 `/rewind` symlink/hardlink skip + count  
4. #18 workflow/cron 写不 follow `.claude` symlink  
5. #11 `daemon stop --any` 陈旧 lock 安全  
6. #20 Windows 网络路径权限（与 #21/#22 可同批 shell）

### Batch B — P0/P1 会话正确性

1. #2 normalize 线性化 — **HAVE**  
2. #3 auto-mode 401 — **HAVE**  
3. #7 resume agent identity — **HAVE**  
4. #15 bg startup cancel — **HAVE**  
5. #19 MCP re-auth 时序 — **HAVE** 

### Batch C — P1 权限 / slash / 遥测 / 文案

1. #13/#21/#22/#31 shell 权限  
2. #29 telemetry abort vs reject  
3. #4 AskUser 中立措辞  
4. #27/#28 skill 菜单与 plugin 前缀  
5. #12/#14 Esc-Esc / Ctrl+X  
6. #32/#33/#35 review/context 文案与 UI  

### Batch D — P2 / 跳过

1. #16/#23–26/#30/#34/#37/#38 抛光  
2. #17 Chrome 403  
3. **#39** VSCode RTL 仍 N/A（无扩展产品面）。#5/#40 已落地 CLI 共用 transport 路径  

### 暂不默认开

- 2.1.217+  
- 重开 215 skill 策略  
- UDS/LAN/TEAMMEM/KAIROS 加码（pack 当时；当前 DEFAULT_BUILD 已 ON，勿再当产品关）  

---

## 落地规则

1. **每条**先 densable extract（本目录 `*.clean.txt` / 新 `*.extract.md`），再改代码。  
2. 测试命名可带 `.216.` 便于回溯。  
3. 仅当测试 + densable 对照通过时把本表 **GAP/PARTIAL → HAVE**。  
4. 版本 bump 等产品收口时再做（当前仍 2.7.30 / 对齐线 215）。  
