# densable 2.1.251 — 官方更新清单 × tip 对照

> 来源：CHANGELOG **2.1.251**（71 bullets）。SEA **已下**（`%TEMP%\official-251\package\claude.exe`，217360032 bytes，`--version` 2.1.251）。  
> 基线：本地 tip npm **2.7.51** = densable **2.1.248**。**本 pack 只盘点 2.1.251**（勿折入 249 跳号 / 250 stub / 252 hotfix）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-09-23 — leftover #5 #9 #12 #18 #40 #62 #65 → **HAVE**。#13 `Vm` 字段已接到 builder。  
> 口径：本地实现 + 已锁 SEA 函数体是合同。changelog 字面大于代码 → **不升桶、不 invent**。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **17** | #5 #9 #12 #16 #17 #18 #19 #32 #36 #39 #40 #52 #56 #62 #65 #67 #68。金标函数体与本地一致 |
| **PARTIAL** | **44** | #1 #2 #4 #6 #7 #8 #10 #11 #13 #15 #20 #23 #24 #25 #26 #27 #28 #29 #30 #31 #33 #34 #35 #37 #38 #41 #42 #43 #44 #49 #50 #51 #53 #54 #55 #57 #58 #59 #60 #61 #63 #64 #66 #69 |
| **GAP** | **1** | #3 `HPe`/`limitsObserved` ABSENT，不 invent |
| **UNKNOWN** | **3** | SEA STRING-ONLY：#22 #46 #48 |
| **N/A** | **6** | #14 Desktop · #21 #45 云 · #47 体积 · #70 #71 VSCode |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | | Added `PreModelSwitch` and `PostModelSwitch` hook events (block, confirm, or ann | **PARTIAL** | `KSn`/`Ewe`/`Osn`/`Lsn`/`executePreModelSwitchHooks` 已接 `/model` 与 print。`ask` 当 no-switch。`gRn` 空；`cre`/`hJ` 无 Bedrock `_I`；`pEt` 是 randomUUID |
| 2 | | Added live streaming of a foreground subagent's tool calls and results to Remote | **PARTIAL** | 带 `parent_tool_use_id` 的工具帧写入 bridge。`task_progress` 仍是状态。`vp`/`tX`/`IN`/`MLe`/`K`/`rbe`/`j8t`/`jUe`/`Ce` 已锁；「foreground subagent」不在写入函数里 |
| 3 | | Added a Spend limit bar to `/usage` and a `rate_limits.spend_limit` status line  | **GAP** | gateway `spend_limit` 与 Spend limit 条已接。`HPe` 已锁：`return pm.limitsObserved`；空窗句在 `Dl` 里。本地空窗仍恒藏，未接 `HPe` |
| 4 | | Added a per-session prompt-cache line to `/cost` (hit ratio, misses, tokens re-c | **PARTIAL** | `oqe`/`whn` 投影已接。`xhe.record` / `c$t`/`u$t` 已锁；本地实会话仍空 |
| 5 | | Added `attach`, `logs`, `stop`, `respawn`, and `rm` to `claude --help`; the `--r | **HAVE** | 顶层 `claude respawn <id>\|--all` 走 `cEr`/`respawnHandler`。`--help` 文案与 gold 一致 |
| 6 | | Fixed file tools (Read, Write, Edit) following a symlink swapped inside the work | **PARTIAL** | Read/Write/Edit 在权限快照后用 `O_NOFOLLOW` 重开。`/proc/self/fd` 祖先循环是 **MISS**（`ao` 只跟用户路径 symlink），不 invent |
| 7 | | Fixed plugin commands declared in a marketplace entry being able to point outsid | **PARTIAL** | 命令源逃出插件目录时记 `path-traversal` / `commands`。`VHt` 的 inline content 分支未逐行对 |
| 8 | | Fixed project settings being able to enable detailed beta tracing or raw API bod | **PARTIAL** | 项目 env 限 SAFE_ENV_VARS；无 `dropDominatedBetaTracingEndpoint` |
| 9 | | Fixed the Workflow tool reading (and quoting in errors) a `scriptPath` outside w | **HAVE** | `qhn` 拒 UNC/NT；`Oo`/`iJ`/`zl`/`Ryr` 在打开前；非 Read/Write 工具集不可读。`It` 引用调用方路径 |
| 10 | | Fixed Grep and Glob not applying `Read(...)` deny rules to files reached through | **PARTIAL** | deny 对 lexical 与 canonical 两边编译。`E2t` 有 linux/wsl 单次 `readlink(/proc/self/fd/${fd})`；祖先循环 **MISS** |
| 11 | | Fixed conversations getting stuck on "text content blocks must be non-empty" err | **PARTIAL** | `jlt` + `thinking_only_retry` + `turnCompanion`。`classifyAPIError` 已接 `pte` 的 400 → `empty_text_block`。`thinkingOnlyNudged` 不在 State 上 |
| 12 | | Fixed the first launch on a fresh install starting in default mode instead of au | **HAVE** | `kgn` 无模式尾走 `Uht`=`isAutoDefaultLaunchEnabled`（`tengu_harbor_willow` \|\| `meadow_lantern===true`）。`fromAutoFallback` 已接 |
| 13 | | Fixed Opus 5 requests failing with "effort … is not supported when thinking is d | **PARTIAL** | SJn 钳 `high`；非 SJn 不再 throw；`d6e` 解析 400。`ThinkingConfig.mechanical` 已接到 builder；无机械关 thinking 的调用点 |
| 14 | | Fixed replying to a message Claude Desktop delivered from another session: `Send | **N/A** | SEA `SendMessage` `call` 在 `Ke(e.to)` 时走 Desktop session messaging。本 CLI 不 invent Desktop handoff |
| 15 | | Fixed TUI lag with many parallel subagents: per-second progress ticks now replac | **PARTIAL** | `iCe` 已落到 `applyMessageStoreAction`（`replace-last-ephemeral-progress`，窗 Mn=64）。仍不是完整消息库对象 |
| 16 | | Fixed agent teams: a teammate's final answer not reaching the team lead — it now | **HAVE** | `lyr`：`$e` 后 `ce(s,4000)`，超长则 `xP` + SendMessage 截断句（失败用短句）。`IMe` 仍不 `xP(summary)` / `e5e` |
| 17 | | Fixed background subagents being unable to reply to a message from an unnamed si | **HAVE** | `Ce`：teammate 名 → registry 名 → teammate `identity.agentName`，否则 `from` 是 id；`agentType` 只当 `local_agent` 的 `displayName`。信封用 `.from` |
| 18 | | Fixed managed-settings `disableAutoMode` arriving mid-session not moving an alre | **HAVE** | `iJt`：`(hM().length===0\|\|o5()) && Bdt && Qan`。`Bdt`=auto 或 plan+stash。`BFt` 恢复 stash、`auto_gate_denied`、清 availability |
| 19 | | Fixed a "switch to Opus 1M for 5x more context" tip that appeared even when the  | **HAVE** | `n`/`HK`/`ky`：opus/sonnet 且已是 native 1M 时 tip 为 null；否则 `Tip: You have access to ${name} with ${multiplier}x more context` |
| 20 | | Fixed Claude apps gateway sessions treating a stored Anthropic profile (e.g. a C | **PARTIAL** | `/status` 已有 Profile 行（`isProfileAuthActive`）。`Ztt`/`odn` 过期登录整段未逐行对 |
| 21 | | Fixed cloud sessions telling Claude the model had changed when the host was only | **N/A** | SEA **MISS**：changelog 短语命中 0。`XEn`/`yit` 是 cache-break 诊断，不是宿主初始模型抑制器 |
| 22 | | Fixed Remote Control reporting a failure when an organization's policy disables  | **UNKNOWN** | SEA STRING-ONLY：`yGt` 仍返回 kind:error |
| 23 | | Fixed `/mcp reconnect` on Remote Control showing a generic withheld-detail error | **PARTIAL** | 另一会话禁用时返回 `qge` 的补救句。`Qo`/`XS`/`G8` 未逐行对 |
| 24 | | Fixed `--input-format stream-json`: client-injected assistant tool calls sent wi | **PARTIAL** | 无 id 的 assistant 在合并前补上 `message.id`。不是 `aVn` 整段反序列化 |
| 25 | | Fixed session transcripts being silently overwritten when a directory change rel | **PARTIAL** | relocate 先改名为 `.superseded-<ts>`，失败再改回。完整 `dpe` 已锁；`DVt`/`HA` 是 `lutimes`/`rename` 导入 |
| 26 | | Fixed background sessions and their subagents being unable to edit files inside  | **PARTIAL** | 本地有 write block；SEA 对链接 worktree 放行。未对上该分支 |
| 27 | | Fixed background sessions occasionally starting without any plugin skills (and s | **PARTIAL** | `fke`=`validateOfficialNameSource` 拒 `..`；`reservedMarketplaceLoadRefusal` 是 `$Y`/`rme`。`zS` official installLocation 未逐行对 |
| 28 | | Fixed selecting text in an opened background session inside tmux over SSH: it no | **PARTIAL** | osc `attacherCaps` + `-S` socket。完整 `zue`/`W`/`h` 未逐行对 |
| 29 | | Fixed SDK and cloud sessions hanging indefinitely when an SDK MCP server's hands | **PARTIAL** | 非 JSON-RPC request 的 `sendMcpMessage` 等 70s。只有抛错的那台标失败 |
| 30 | | Fixed self-hosted runner leaving a stuck session's Bash tool processes running a | **PARTIAL** | Windows abort 走 `taskkill /T /F`。进程树身份核对与 analytics `stage` 未接 |
| 31 | | Fixed `/usage-credits` for Team and Enterprise members whose admin set the org's | **PARTIAL** | `member_*` 与 `group_zero_credit_limit` 文案对上 `uen`/`mhe`。其它 overage 分支未逐行对 |
| 32 | | Fixed `--worktree --tmux` with a merge-request number on a gitlab.com origin try | **HAVE** | `X3`：剥 www 后精确 `github.com` / `gitlab.com` / `bitbucket.org`。`*.gitlab.com` 不再当 gitlab |
| 33 | | Fixed Ctrl+G failing with "Emacs quit unexpectedly" in background sessions for e | **PARTIAL** | `applyBgWorkerCttyOutcome` 已接 setup（acquired 标 tty+ok）。`J` 是诊断 stand-in |
| 34 | | Fixed an `additionalDirectories` entry containing a null byte crashing startup,  | **PARTIAL** | `addDirectories` drop `\0`。`mbe`/`gbe`/`zk` workspace 未逐行对 |
| 35 | | Fixed the MCP server menu's copy shortcut: it now says how the sign-in URL was c | **PARTIAL** | `ZW`=`useMcpCopiedVia` `{copiedVia, copy, reset}`。菜单文案已按 via 分 native / tmux-buffer / osc52 |
| 36 | | Fixed italic text (such as the session recap line) rendering as highlighted bloc | **HAVE** | `jJn`=`filterItalicOffTokens`：`TERM` 以 `screen` 开头时丢掉 italic-off。`StylePool.intern` 与 `applyTextStyles` 都走它 |
| 37 | | Fixed `claude mcp add --header` and `claude mcp add-json` help text naming the w | **PARTIAL** | `--header` / `--transport` / `add-json` 文案对上 `Lr`/`jr`。整段命令注册未逐行对 |
| 38 | | Fixed `claude ultrareview` and `/ultrareview` waiting the full 30 minutes when t | **PARTIAL** | reviewRemote 失败即停；RemoteAgentTask 仍等 30 分钟。SEA `dnt` |
| 39 | | Fixed Bash permission checks auto-approving commands that assign an arithmetic e | **HAVE** | `DENSABLE_YPG_EQI` 与 `or` 同集同序；`densableUVu` 与 `Qo` 同序（`[` / 反引号 / `$(` / 占位符，再要求纯整数） |
| 40 | | Fixed backgrounded sessions (`←`, `/background`, `--bg`) losing a Vertex/Bedrock | **HAVE** | `Oo`=`copyProviderGatewayEnv`：endpoint + SKIP_* + CUSTOM_HEADERS；`WNe` 空；非 exec `So` 并入 dispatch.env |
| 41 | | Fixed `claude --bg --model fable` on Max plans stopping to ask for usage credits | **PARTIAL** | `So` 走 `urr(awn())`。`gP`=`shouldPromptFableOverageConsent`：`f6e` 无 `requestDialog` 不弹框，bg 不 abort。`G5`/`Xpe` 种类白名单 ABSENT |
| 42 | | Fixed the one-time "make auto mode your default" offer appearing in unattended s | **PARTIAL** | `oc`=`isUnattendedAutoDefaultNudgeSession`（含 `replBridgeActive`），`openAutoDefaultNudge` 已接 |
| 43 | | Fixed the managed-settings approval prompt re-appearing after signing in again t | **PARTIAL** | `Zor`=`hasDangerousSettingsChangedAgainstBaseline` 同 hash 跳过。`ie`/`ae` 未逐行对 |
| 44 | | Fixed disabled `/bug` and `/share` reporting that `/feedback` was disabled; tips | **PARTIAL** | 禁用原因用被调用的命令名。`n`→`Tie`→`TG` 已锁：`/share` 或 `/bug`，没有 `/feedback` 改名 |
| 45 | | Fixed cloud session creation advising GitHub setup after a transient GitHub conn | **N/A** | SEA `V_e`/`wT`：瞬时失败说 retry。云会话创建，不 invent |
| 46 | | Improved CPU usage during turns in interactive sessions by cutting redundant UI  | **UNKNOWN** | SEA STRING-ONLY：没有裁掉重绘的函数 |
| 47 | | Improved install size: the native binary is about 5 MB smaller
 | **N/A** | 安装体积。SEA **MISS**：体积针命中 0，没有函数 |
| 48 | | Improved cloud sessions: when the session's network proxy drops a connection dur | **UNKNOWN** | SEA STRING-ONLY：`An` 提示里有 host/reason；Bash 工具结果仍是裸 reset。不 invent 改写 |
| 49 | | Improved `/schedule` to explain that MCP servers configured in Claude Code can't | **PARTIAL** | 空连接器说明与本地 MCP 计数句已接。`F`/`we` 的 skip-reason 句没有本地状态，未接 |
| 50 | | Improved framing of messages from your own subagents: Claude is told the sender  | **PARTIAL** | descendant 用金标 `K` 整句。`RMe` 的 activityObservation / hostInjected 分支未逐行对 |
| 51 | | Improved the prompt placeholder to read "Message @name…" while viewing a backgro | **PARTIAL** | `Iln`=`resolveViewedTask`（`d??y`）已接 PromptInput。REPL 仍内联 viewed-task，没有 `tt()` transcript 表 |
| 52 | | Improved sanitization of MCP server names in error messages, menus, and command  | **HAVE** | `Bfe`/`An`/`fr`：Cc/Cf → 空格，collapse + NFC + 反引号，宽 80。`Qt` 另有弯引号替换 |
| 53 | | Improved Amazon Bedrock session start under `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOS | **PARTIAL** | 宿主旗标下 `S`/`F`/`R`/`U`/`B` 返回 `[]`，`zje` 返回 `undefined`。`ME`/`gl` 未接。列表体是空 stub，不是真发现 |
| 54 | | Improved the managed settings approval dialog to list only the settings that cha | **PARTIAL** | 变更集非空只列变更键，并显示 unchanged/removed 计数。沙箱键仍在 `shellSettings`。引言 `tAn` 未接 |
| 55 | | Improved retry when the model's tool call is malformed: the broken output is now | **PARTIAL** | 墓碑 + `Blt` 重试一次。`CAt`/`bjn`、`qo` 墓碑 api-error、`x0e` StopFailure 已接。`OS`/`markApiFailure` 本地无 tracker，未 invent |
| 56 | | Changed `/radio` to be available on Bedrock, Vertex AI, Foundry, and Claude Plat | **HAVE** | 命令对象无 `isEnabled`。`call` 只打开 https://clau.de/radio，成功与失败两句与 gold 一致 |
| 57 | | Changed Claude in Chrome so browser actions always go through Claude Code's perm | **PARTIAL** | 本地 Chrome 权限门默认关；SEA 除非 bypass 否则走 ask |
| 58 | | Changed `CLAUDE_CODE_SUBAGENT_MODEL` to set the default subagent model rather th | **PARTIAL** | spawn、agent 模型优先，env 只在都没指定时生效。未对 `jR` 的 Bedrock 重写逐行 |
| 59 | | Changed the default commit trailer to `Co-Authored-By: Claude Code` when the act | **PARTIAL** | `AVt` 已知模型；`ZO`/`DOe`（catalog / Claude 3 / mythos）→ `Claude`；其余 `Claude Code`。`BZn` 的 `lp`/`dr`/`jo` 第一臂与完整 `rDt` 未接 |
| 60 | | Changed the default model for seat-based Enterprise subscriptions to Opus 5, mat | **PARTIAL** | `wo().state` 与 `pbr` 已接。`aw` 在 Bedrock/Vertex 上默认 opus，`rw()` 时 sonnet。overrides 是 `{}` 不是 `UJ()` |
| 61 | | Changed `/effort` to save your default effort level per model, so each model kee | **PARTIAL** | `/effort` 与 ModelPicker 确认都写 `modelSettings[canonical]`。`G3` 不含 `max`。左右循环不 N9。`p5e` 不是金标 `fn(Xe(Mt))` |
| 62 | | Changed analytics to no longer turn off before sign-in solely because managed se | **HAVE** | `Zq`：宿主旗标保持开，否则 `!firstParty`。`Kh` 无 `NODE_ENV==='test'`。`gi`/`bW`/`e2` 仍在 |
| 63 | | Changed the footer PR badge on Bedrock, Vertex, and Foundry, and when telemetry  | **PARTIAL** | `ign` 已接 `Accept` / API-version / etag / 同 origin 跳转 / `agn` review。缺 fork remap、`Hi()`、token cache。`gh pr view` 仍是 URL 缓存 |
| 64 | | Changed how Bash command output files are created and read back when commands ru | **PARTIAL** | `getTaskOutput` / `getTaskOutputSize` / `getStdout` 已过 `XX`。本地 `XX` 是 lstat/nlink，不是 gold 的 `V`/`vt`/`O_NOFOLLOW` 开读 |
| 65 | | Changed plugin/LSP install suggestions and the auto-mode default offer to wait u | **HAVE** | plugin/LSP 等 draft 清空；effort 走 `G$`。REPL `modalChrome`=`jx`；`dialogSuppressReason`=`hostParkToSuppressReason(Vd)` |
| 66 | | Changed server-managed settings that terminate sandbox TLS, route sandbox traffi | **PARTIAL** | 本地有通用审批对话框；SEA 把削弱沙箱的键放进 hash |
| 67 | | Changed `ANTHROPIC_CUSTOM_HEADERS` from managed or project settings to require a | **HAVE** | `Rn` 名字语法、`$Kt` line_break/nul/non_ascii、`Cn` 敏感名、`Tn` 审批门与 gold 一致 |
| 68 | | Changed project-level `.claude/settings.json` `env` to no longer set `CLAUDE_CON | **HAVE** | `N` 从项目/本地 `settings.env` 删 `vyr`（tracing + `CLAUDE_*` / `TMP*`），`managedEnv`/`settings` apply 已接 |
| 69 | | Removed syntax highlighting for six rarely used languages (1c, gml, isbl, mathem | **PARTIAL** | 本地仍整包 highlight.js；SEA grammar 旁无这六个语言名 |
| 70 | | [VSCode] Fixed the sign-in screen's "Bedrock, Foundry, or Vertex" button opening | **N/A** | VSCode 登录锚点。本 CLI SEA **MISS**，无扩展源 |
| 71 | | [VSCode] Changed the Remote Control banner to a footer pill (shown while Remote  | **N/A** | VSCode RC footer pill。本 CLI SEA **MISS**（`footer pill` 是终端 SDKFooterIndicator） |

## 已锁合同

1. changelog 是索引。金标在 `snippets/gold-251-a.md` … `gold-251-l.md`。  
2. 扫员结论只写 `snippets/scan-251-*.md`。LOCAL 且 SEA 未剥的不升 HAVE。  
3. SEA BODY + 本地 ABSENT = GAP。SEA BODY + 本地只沾边 = PARTIAL。STRING-ONLY / 未剥 = UNKNOWN。  
4. 249 跳号、250 stub、252 另包。不 invent VSCode / 云宿主。
