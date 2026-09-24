# densable 2.1.251 — 官方更新清单 × tip 对照

> 来源：CHANGELOG **2.1.251**（71 bullets）。SEA **已下**（`%TEMP%\official-251\package\claude.exe`，217360032 bytes，`--version` 2.1.251）。  
> 基线：本地 tip npm **2.7.54**（251 leftover 已入库；sticky clamp 对齐）。**本 pack 只盘点 2.1.251**（勿折入 249 跳号 / 250 stub / 252 hotfix）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-09-24 — leftover dig：#46 `eBt`+`Mn=200`+fullscreen append-or-move → **HAVE**。  
> 口径：本地实现 + 已锁 SEA 函数体是合同。changelog 字面大于代码 → **不升桶、不 invent**。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **65** | #1–#13 #15–#20 #22–#44 #46 #48–#69。金标函数体与本地一致 |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **UNKNOWN** | **0** | — |
| **N/A** | **6** | #14 Desktop · #21 #45 云 · #47 体积 · #70 #71 VSCode |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | | Added `PreModelSwitch` and `PostModelSwitch` hook events (block, confirm, or ann | **HAVE** | `hdt`/`ydt`/`KSn`/`Ewe`/`Osn`/`Lsn`；`cre`/`hr`/`gie`/`hJ`/`_I`（Bedrock GetInferenceProfile）；`gRn`→`requestJournal.applyResumeSeed`/`stageResumeSeed`。`pEt` 仍 `randomUUID`（`Kt`/`we` ABSENT） |
| 2 | | Added live streaming of a foreground subagent's tool calls and results to Remote | **HAVE** | `Ce`/`bEn`/`idt`/`san`：`parent_tool_use_id` 工具帧；`IN`/`eG`/`no` tool_use_meta；`MLe`/`jd` 剥 cc-memory；`vp`=`normalizeMessages`；`tX`/`K`/`rbe`/`j8t`/`jUe`。changelog「foreground subagent」不在 writer 体 |
| 3 | | Added a Spend limit bar to `/usage` and a `rate_limits.spend_limit` status line  | **HAVE** | `HPe`=`areLimitsObserved`/`pm.limitsObserved`；`isStaleObservation`/`emitStatusChange`/`resetCurrentLimits` 写臂；`Dl`：`overage→bar` / `HPe→null` / else placeholder `Spend limit · shown once your gateway reports one`（U+00B7）。status line `spend_limit` 已接 |
| 4 | | Added a per-session prompt-cache line to `/cost` (hit ratio, misses, tokens re-c | **HAVE** | `xhe`/`O6e`/`cL`/`c$t`/`u$t`/`D6e` live；`oqe`/`whn` 投影；main-thread credit 经 `addToTotalSessionCost` 记入 |
| 5 | | Added `attach`, `logs`, `stop`, `respawn`, and `rm` to `claude --help`; the `--r | **HAVE** | 顶层 `claude respawn <id>\|--all` 走 `cEr`/`respawnHandler`。`--help` 文案与 gold 一致 |
| 6 | | Fixed file tools (Read, Write, Edit) following a symlink swapped inside the work | **HAVE** | `UWt`/`DH`/`ao`/`Ut`/`H`/`I`/`aV`/`ht`：权限快照后 `O_NOFOLLOW` 重开 + 用户路径 hop + 单次 `readlink(/proc/self/fd/${fd})`。fd **祖先循环 gold MISS**（SEA 未实现，不 invent） |
| 7 | | Fixed plugin commands declared in a marketplace entry being able to point outsid | **HAVE** | `VHt`=`applyPluginCommandSources`：`Pe.source` 逃出 → `path-traversal`/`commands`；`Pe.content&&O` 记 inline；空 content / 未注入 `O` skip；string list 同构 |
| 8 | | Fixed project settings being able to enable detailed beta tracing or raw API bod | **HAVE** | `dropDominatedBetaTracingEndpoint` + `applyOtelFamilyClaims`：OTLP 族、`j` 非 otlp logs/traces exporter、`Oe`/`!ENABLE_TELEMETRY` 臂；`N`/`vyr` 项目剥离（#68） |
| 9 | | Fixed the Workflow tool reading (and quoting in errors) a `scriptPath` outside w | **HAVE** | `qhn` 拒 UNC/NT；`Oo`/`iJ`/`zl`/`Ryr` 在打开前；非 Read/Write 工具集不可读。`It` 引用调用方路径 |
| 10 | | Fixed Grep and Glob not applying `Read(...)` deny rules to files reached through | **HAVE** | `E2t`/`oht`/`_Y`/`lY`：deny 双边编译 + hop/NT/Jo/UNC + 单次 `readlink(/proc/self/fd/${fd})` + absolute/PATH rg spawn 合同。fd **祖先循环 gold MISS**（与 #6 同，不 invent） |
| 11 | | Fixed conversations getting stuck on "text content blocks must be non-empty" err | **HAVE** | `jlt` + `thinking_only_retry` + `turnCompanion`；`pte` 400→`empty_text_block`；continue bag `Pe.thinkingOnlyNudged:!0`（query loop State，非 React AppState） |
| 12 | | Fixed the first launch on a fresh install starting in default mode instead of au | **HAVE** | `kgn` 无模式尾走 `Uht`=`isAutoDefaultLaunchEnabled`（`tengu_harbor_willow` \|\| `meadow_lantern===true`）。`fromAutoFallback` 已接 |
| 13 | | Fixed Opus 5 requests failing with "effort … is not supported when thinking is d | **HAVE** | `GMt`：outgoing `{type:disabled}` + `bJn` + (`Vm`\|\|`SJn`) → `ga.effort=Wht`。`Mc` omit 不钳。`d6e` 解析 400 不 throw。机械 `sX`/`queryHaiku`/`queryWithModel`。`Du()`=`Ln.of(session.root)` `Ge` bag；`i5n` skip `cd`/`hydrate` |
| 14 | | Fixed replying to a message Claude Desktop delivered from another session: `Send | **N/A** | SEA `SendMessage` `call` 在 `Ke(e.to)` 时走 Desktop session messaging。本 CLI 不 invent Desktop handoff |
| 15 | | Fixed TUI lag with many parallel subagents: per-second progress ticks now replac | **HAVE** | `iCe`=`applyMessageStoreAction`：`replace-last-ephemeral-progress` 窗 **Mn=200**（SEA `var Mn=200`），REPL 已接线。`eBt` 见 #46 |
| 46 | | Improved CPU usage during turns in interactive sessions by cutting redundant UI  | **HAVE** | SEA 产品臂：`Nt()` fullscreen → `append-or-move-by-uuid`=`eBt`（同 uuid 移尾、不重复）；`Mn=200` 进度替换窗；Ink `scheduleRender=ep(_,16,{leading,trailing})` 本地已有。changelog 字面 0。本地：`appendOrMoveByUuid` + REPL fullscreen 接线 + Mn 64→200 |
| 16 | | Fixed agent teams: a teammate's final answer not reaching the team lead — it now | **HAVE** | `lyr`：`$e` 后 `ce(s,4000)`，超长则 `xP` + SendMessage 截断句（失败用短句）。`IMe` 仍不 `xP(summary)` / `e5e` |
| 17 | | Fixed background subagents being unable to reply to a message from an unnamed si | **HAVE** | `Ce`：teammate 名 → registry 名 → teammate `identity.agentName`，否则 `from` 是 id；`agentType` 只当 `local_agent` 的 `displayName`。信封用 `.from` |
| 18 | | Fixed managed-settings `disableAutoMode` arriving mid-session not moving an alre | **HAVE** | `iJt`：`(hM().length===0\|\|o5()) && Bdt && Qan`。`Bdt`=auto 或 plan+stash。`BFt` 恢复 stash、`auto_gate_denied`、清 availability |
| 19 | | Fixed a "switch to Opus 1M for 5x more context" tip that appeared even when the  | **HAVE** | `n`/`HK`/`ky`：opus/sonnet 且已是 native 1M 时 tip 为 null；否则 `Tip: You have access to ${name} with ${multiplier}x more context` |
| 20 | | Fixed Claude apps gateway sessions treating a stored Anthropic profile (e.g. a C | **HAVE** | `Ztt`=`buildAccountProperties`：`wl&&!Wd&&TYe` 过期 Login；`${subscription} account`；`Wd`→Profile。`odn` 在 `x-should-retry` 前三条 401 臂（`wl+Xt` / `!$V+Wd` / `AL`）。`M()` inject ABSENT 不 invent |
| 21 | | Fixed cloud sessions telling Claude the model had changed when the host was only | **N/A** | SEA **MISS**：changelog 短语命中 0。`XEn`/`yit` 是 cache-break 诊断，不是宿主初始模型抑制器 |
| 22 | | Fixed Remote Control reporting a failure when an organization's policy disables  | **HAVE** | SEA：`org_denied`→`Xb("policy_denied")`+`W?.("policy_disabled",v_n())`；hook `!ks&&np` quiet notice + disable RC。本地：`BridgeState.policy_disabled`；`initReplBridge` 不再 `failed`；`useReplBridge` quiet notice + 关 RC，不 invent failure toast。changelog「quiet notice」字面 0，产品臂是 `policy_disabled` |
| 23 | | Fixed `/mcp reconnect` on Remote Control showing a generic withheld-detail error | **HAVE** | `qge`/`Qo`/`XS`/`G8`/`y$`：另一会话禁用返回补救句（复数 `N MCP server(s)…`）；`/mcp reconnect` 与 RC `mcp_reconnect` 接线；singular `y$` 仅 gate |
| 24 | | Fixed `--input-format stream-json`: client-injected assistant tool calls sent wi | **HAVE** | `stampIdLessAssistant*`：`assistant && !message.id && requestId===void 0` 补 `YSn` id；structuredIO/print/`toInternalMessages`/resume 合并前已接。`aVn` 的 `ibn`/`abn` 丢块臂未整段搬，产品合同是 stamp |
| 25 | | Fixed session transcripts being silently overwritten when a directory change rel | **HAVE** | `dpe`=`setAsideExistingTranscript`：`HA`→`.superseded-<ts>`；`Y(ENOENT)` 空返回；默认臂 `DVt(lutimes)`。`S0e` 失败 `HA` 还原。`Vjn` ABSENT 不 invent |
| 26 | | Fixed background sessions and their subagents being unable to edit files inside  | **HAVE** | `Q$`=`checkBgIsolationWriteBlock`：`u.canonical!==null && Fkn(u.canonical)` 放行。`Fkn`=`isLinkedGitWorktree`（`lvt`/`ue`：gitRoot≠canonicalGitRoot） |
| 27 | | Fixed background sessions occasionally starting without any plugin skills (and s | **HAVE** | `$Y`=`reservedMarketplaceLoadRefusal`；`fke` 拒 `..`；`zS` official seed `find`；`qFe` `Be=Pe!==void 0&&$Y===null` 才 `_gr=[30,70,150]` 重读 |
| 28 | | Fixed selecting text in an opened background session inside tmux over SSH: it no | **HAVE** | `zue`/`W`/`h`：SSH `Al()?.ssh ?? !!SSH_CONNECTION`；attacher tmux 走 `-S` socket 否则 `$TMUX`；`load-buffer -w` 失败再无 `-w` |
| 29 | | Fixed SDK and cloud sessions hanging indefinitely when an SDK MCP server's hands | **HAVE** | `sendMcpMessage` 默认 `_e=70000`；仅 `rot()`=false（无 method 或 `id===null`）武装 70s。`Rd`=`setupSdkMcpClients` `Promise.allSettled`，只把抛错那台标 `failed` |
| 30 | | Fixed self-hosted runner leaving a stuck session's Bash tool processes running a | **HAVE** | `ug`/`P`：System32 `taskkill /PID /T /F` + `stdio:ignore`/`windowsHide`；失败 `f`→log + `tengu_bash_tool_kill_error{stage}`。`SessionChildSupervisor.terminate`→`ug`。SEA `Fr`/`ir` BODY 但 `treeSnapshot` **从未赋值**（死臂），本地同 no-op，不 invent snapshot builder |
| 31 | | Fixed `/usage-credits` for Team and Enterprise members whose admin set the org's | **HAVE** | `uen`/`mhe`/`wb`/`den`/`Gj`/`hqe`：`member_*`/`group_zero` 与 spend-cap 分流；`out_of_credits`/seat_tier/org_service + `progressSavedSuffix`/`tengu_vellum_anchor`。Fable `seven_day_overage_included` 未映射不 invent |
| 32 | | Fixed `--worktree --tmux` with a merge-request number on a gitlab.com origin try | **HAVE** | `X3`：剥 www 后精确 `github.com` / `gitlab.com` / `bitbucket.org`。`*.gitlab.com` 不再当 gitlab |
| 33 | | Fixed Ctrl+G failing with "Emacs quit unexpectedly" in background sessions for e | **HAVE** | `z`/`L` open `/dev/tty`+`login_tty(0)`；`uo` switch：`acquired`→`rNt`+`tengu_feature_ok`；`already`→`rNt`；`failed`/`ffi_unavailable`/`not_a_tty`→`tengu_feature_sad`；`J` diagnostics。setup daemon 路径已接 |
| 34 | | Fixed an `additionalDirectories` entry containing a null byte crashing startup,  | **HAVE** | `lr` addDirectories drop `\0`/trim-empty；`mbe`/`zk` → `containsNullByte`；settings startup 同滤。`np(...,{caseFold:!1})` ABSENT 不 invent（本地 `pathInWorkingPath` 大小写归一） |
| 35 | | Fixed the MCP server menu's copy shortcut: it now says how the sign-in URL was c | **HAVE** | `ZW`=`useMcpCopiedVia`：URL 变先 reset；copy 去抖+generation；via 分 native / tmux-buffer / osc52。`Q4` 未剥不 invent |
| 36 | | Fixed italic text (such as the session recap line) rendering as highlighted bloc | **HAVE** | `jJn`=`filterItalicOffTokens`：`TERM` 以 `screen` 开头时丢掉 italic-off。`StylePool.intern` 与 `applyTextStyles` 都走它 |
| 37 | | Fixed `claude mcp add --header` and `claude mcp add-json` help text naming the w | **HAVE** | `Lr`：`--header` 为 HTTP/SSE；`--transport` 为 `stdio, sse, http`；stdio `-e` 示例 `claude mcp add my-server -e API_KEY=xxx -- npx my-mcp-server`。`jr` add-json 列表同 gold |
| 38 | | Fixed `claude ultrareview` and `/ultrareview` waiting the full 30 minutes when t | **HAVE** | `dnt` RemoteAgentTask + CLI `awaitRemoteSessionResult`：`startupFailure && tengu_linear_brook` 在 poll_timeout 前 throw `cloud session could not start`（j8/K8/G8 字段已接） |
| 39 | | Fixed Bash permission checks auto-approving commands that assign an arithmetic e | **HAVE** | `DENSABLE_YPG_EQI` 与 `or` 同集同序；`densableUVu` 与 `Qo` 同序（`[` / 反引号 / `$(` / 占位符，再要求纯整数） |
| 40 | | Fixed backgrounded sessions (`←`, `/background`, `--bg`) losing a Vertex/Bedrock | **HAVE** | `Oo`=`copyProviderGatewayEnv`：endpoint + SKIP_* + CUSTOM_HEADERS；`WNe` 空；非 exec `So` 并入 dispatch.env |
| 41 | | Fixed `claude --bg --model fable` on Max plans stopping to ask for usage credits | **HAVE** | `G5`=`sdkDialogHostActive`；`Xpe`=`sdkSupportedDialogKinds`；`f6e`：`e==nullish→false`，`G5&&!(Xpe??[]).includes(Nee.kind)→false`，else true。`gP`/`shouldPromptFableOverageConsent`；bg 无 host 不弹。`Nee.kind=fable_overage_consent_prompt` |
| 42 | | Fixed the one-time "make auto mode your default" offer appearing in unattended s | **HAVE** | `oc`/`wt`/`pie`/`f_` 1:1；`maybeRequestAutoDefaultNudge`：`wt()`→`f_()` 先 skip。`_re` 仅 `this.#o` sibling arm ABSENT，非 unattended 门合同 |
| 43 | | Fixed the managed-settings approval prompt re-appearing after signing in again t | **HAVE** | `Zor`/`wt`/`fEt` 同 hash 跳过；`ie` org+account；`ae`=`recordOrgConsent`（storage `mode:384` / `atomicWrite(...,384)`）；`oe`/`se` 已接。#54 dialog listing 另条 |
| 44 | | Fixed disabled `/bug` and `/share` reporting that `/feedback` was disabled; tips | **HAVE** | `TG(e="/feedback")` 插命令名；`n`→`gRt` 传 `/share` 或 `/bug`；`/feedback` 默认仍 `TG()`。无 `/feedback` 改名 |
| 45 | | Fixed cloud session creation advising GitHub setup after a transient GitHub conn | **N/A** | SEA `V_e`/`wT`：瞬时失败说 retry。云会话创建，不 invent |
| 47 | | Improved install size: the native binary is about 5 MB smaller
 | **N/A** | 安装体积。SEA **MISS**：体积针命中 0，没有函数 |
| 48 | | Improved cloud sessions: when the session's network proxy drops a connection dur | **HAVE** | SEA `An` README + `xe` env note + `Ept`/`yBt` bag + GET `/__agentproxy/status` 带 `recentRelayFailures`（host/reason）。本地 `agentProxyPrompt`/`setAgentProxyNote` + `computeEnvInfo` 注入 + relay status/onclose 记 failure。**不是** Bash tool-result 改写器（changelog 字面大于代码） |
| 49 | | Improved `/schedule` to explain that MCP servers configured in Claude Code can't | **HAVE** | `F` note + `we` 计数句；`resolveConnectorFetchSkipReason`（lockdown/restricted/optout/safe-mode/missing-scope）+ unlisted twin；`scheduleRemoteAgents` 接线 |
| 50 | | Improved framing of messages from your own subagents: Claude is told the sender  | **HAVE** | `RMe`=`wrapPeerOriginText`：`lineage==="descendant"`→`K`，else `A`；`activityObservation`/`hostInjected` 臂与 gold 同序 |
| 51 | | Improved the prompt placeholder to read "Message @name…" while viewing a backgro | **HAVE** | `wCe`/`_Mn`/`Bpe`/`Iln`：viewed teammate/local_agent → `Message @name…`。`tt()` transcript 表 ABSENT（Iln 由调用方传 bag，不 invent） |
| 52 | | Improved sanitization of MCP server names in error messages, menus, and command  | **HAVE** | `Bfe`/`An`/`fr`：Cc/Cf → 空格，collapse + NFC + 反引号，宽 80。`Qt` 另有弯引号替换 |
| 53 | | Improved Amazon Bedrock session start under `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOS | **HAVE** | `Pbt` skip：`await ME(),gl();return`（`resolveBedrockRegionMe`/`seedModelStringsGl`）；`S`/`F`/`R`/`U`/`B`→`[]`，`zje`→`undefined`；不 await `ef` |
| 54 | | Improved the managed settings approval dialog to list only the settings that cha | **HAVE** | `eAn`/`c5`/`Oe`：`c5(changed)?changed:full`；unchanged/removed 计数句与 gold 一致；sandbox 经 `sandboxSettings`（#66） |
| 55 | | Improved retry when the model's tool call is malformed: the broken output is now | **HAVE** | 墓碑 + `Blt` 一次；`CAt`/`bjn`；exhausted `qo`+`x0e`+`OS(ct,A,Li)`。`OS` gold 体：`!Jh\|\|!cT\|\|!repl_main_thread\|\|agentId` 短路；`Jh`/`cT` ABSENT → structured no-op（不 invent tracker） |
| 56 | | Changed `/radio` to be available on Bedrock, Vertex AI, Foundry, and Claude Plat | **HAVE** | 命令对象无 `isEnabled`。`call` 只打开 https://clau.de/radio，成功与失败两句与 gold 一致 |
| 57 | | Changed Claude in Chrome so browser actions always go through Claude Code's perm | **HAVE** | exclusive `Nq`/`Dme`/`TD` + Host `VQt` call 四臂：`skip_all` / `follow_a_plan`(+domains/`onPermissionRequest`) / `ask`；`Pvr` bag（`bridgeBinding`+`resolvedHostByToolUseId`）；`toolRendering.call`→`handleToolCall`+overrides |
| 58 | | Changed `CLAUDE_CODE_SUBAGENT_MODEL` to set the default subagent model rather th | **HAVE** | `sY`/`jR`=`getDefaultSubagentModel`/`getAgentModel`：spawn `r` → agent `e` → env `sY`；`inherit` 走 parent；Bedrock 区前缀继承 |
| 59 | | Changed the default commit trailer to `Co-Authored-By: Claude Code` when the act | **HAVE** | `BZn`：`lp`（fable-5/`GP`）+ `(!dr()\|\|jo()\|\|ZO)` → `AVt(NJ.firstParty)`；`rDt`→AVt；`ZO`→`Claude`；else `Claude Code`。`dr`/`jo`/`$U`/`NJ` 已接 |
| 60 | | Changed the default model for seat-based Enterprise subscriptions to Opus 5, mat | **HAVE** | `wo`/`pbr`/`Xbt`/`rw`/`UJ`：seat enterprise→opus；`enterprise_usage_based` 含；Bedrock/Vertex `aw`：`rw()`→sonnet else opus；`overridesMap: modelOverrides ?? UJ() ?? {}` |
| 61 | | Changed `/effort` to save your default effort level per model, so each model kee | **HAVE** | `p5e`=`fn(Xe(Mt(e),{deterministic:!0}))`：`getCanonicalName` + strip `[1m]`；`G3` 无 max；`K`/`J` 写 `modelSettings[canonical]`；左右循环不 N9 |
| 62 | | Changed analytics to no longer turn off before sign-in solely because managed se | **HAVE** | `Zq`：宿主旗标保持开，否则 `!firstParty`。`Kh` 无 `NODE_ENV==='test'`。`gi`/`bW`/`e2` 仍在 |
| 63 | | Changed the footer PR badge on Bedrock, Vertex, and Foundry, and when telemetry  | **HAVE** | `ign` REST + `Kfn`/`_ke`/`bke`；`ugn` fork/upstream remap（`dgn`/`Itt`/`pgn`/`cgn` parent + `rememberBaseRepo`）；`Hi`=`getProxyFetchOptions` spread 到 list/agn/pgn fetch。`gh pr view` 仍 URL 缓存 |
| 64 | | Changed how Bash command output files are created and read back when commands ru | **HAVE** | Que exclusive `O_CREAT\|O_EXCL\|O_NOFOLLOW`/`wx`；XX leaf nlink-1 + open；`vt` 开后 ino/dev/nlink 身份复核。嵌套 `V` 目录 bag 仍 stand-in 于 leaf 路径，产品读合同已 1:1 |
| 65 | | Changed plugin/LSP install suggestions and the auto-mode default offer to wait u | **HAVE** | plugin/LSP 等 draft 清空；effort 走 `G$`。REPL `modalChrome`=`jx`；`dialogSuppressReason`=`hostParkToSuppressReason(Vd)` |
| 66 | | Changed server-managed settings that terminate sandbox TLS, route sandbox traffi | **HAVE** | `qe` 11 键序；`so`/`ro`/`he`/`oo`/`no`；VU 投影进 `sandboxSettings`；runtime adapter 透传 weaker/proxy/tls/`allowAppleEvents`/`allowMachLookup`。`.restrictive` 读为 0 |
| 67 | | Changed `ANTHROPIC_CUSTOM_HEADERS` from managed or project settings to require a | **HAVE** | `Rn` 名字语法、`$Kt` line_break/nul/non_ascii、`Cn` 敏感名、`Tn` 审批门与 gold 一致 |
| 68 | | Changed project-level `.claude/settings.json` `env` to no longer set `CLAUDE_CON | **HAVE** | `N` 从项目/本地 `settings.env` 删 `vyr`（tracing + `CLAUDE_*` / `TMP*`），`managedEnv`/`settings` apply 已接 |
| 69 | | Removed syntax highlighting for six rarely used languages (1c, gml, isbl, mathem | **HAVE** | SEA `Ec`/`Pwe` 178 语无 1c/gml/isbl/mathematica/maxima/sqf（gold-f 旁 0）。本地 `stripDensableRemovedHljsLanguages` + import-time unregister；`supportsLanguage`/`highlight` 拒这六 id。无单独 uninstall BODY，合同是集合差 |
| 70 | | [VSCode] Fixed the sign-in screen's "Bedrock, Foundry, or Vertex" button opening | **N/A** | VSCode 登录锚点。本 CLI SEA **MISS**，无扩展源 |
| 71 | | [VSCode] Changed the Remote Control banner to a footer pill (shown while Remote  | **N/A** | VSCode RC footer pill。本 CLI SEA **MISS**（`footer pill` 是终端 SDKFooterIndicator） |

## 已锁合同

1. changelog 是索引。金标在 `snippets/gold-251-a.md` … `gold-251-l.md`。  
2. 扫员结论只写 `snippets/scan-251-*.md`。LOCAL 且 SEA 未剥的不升 HAVE。  
3. SEA BODY + 本地 ABSENT = GAP。SEA BODY + 本地只沾边 = PARTIAL。STRING-ONLY / 未剥 = UNKNOWN。  
4. 249 跳号、250 stub、252 另包。不 invent VSCode / 云宿主。
