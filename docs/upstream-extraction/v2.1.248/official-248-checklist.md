# densable 2.1.248 — 官方更新清单 × tip 对照

> 来源：CHANGELOG **2.1.248**（49 bullets）。SEA `@anthropic-ai/claude-code-win32-x64@2.1.248` **SEA_OK**（`claude.exe` 226708128 · `--version` 2.1.248）。  
> 基线：本地 tip npm **2.7.50** = densable **2.1.247**。**本 pack 只盘点 2.1.248**（勿折入 249 空号 / 250 stub / 251+）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-09-20 — 对齐中。**HAVE 47**。`#16` leftover 宿主是 `AgentView.refresh`（官方 `gc` `#x`/`#E`/`load` PR 切片 + `V$n`/`Oo`/`KC` + Fh 缺字段）。  
> 口径：本地实现 + 已锁 SEA 函数体是合同。changelog 字面大于代码 → **不升桶、不 invent**。  
> 禁止 invent：云宿主、VSCode 插件体、`workflow-authoring` skill 正文。SEA 已钉的名字按体接，不按 changelog 加戏。  
> 本地已有 **不是** 本 pack 对齐：`Cwn`/`GC` ≠ `#1` `Yk`；既有 `/usage-credits` ≠ `#6` 整条。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **47** | #1–#31 #33–#38 #40–#49 |
| **PARTIAL** | **0** | |
| **GAP** | **0** | 未证伪前不标 GAP |
| **UNKNOWN** | **0** | |
| **N/A** | **2** | #32 云容器凭证 · #39 VSCode |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | restricted | `--restricted` / `CLAUDE_CODE_RESTRICTED=1`：去 shell/code 工具 + WebFetch（除非 `--tools`），文件工具锁 cwd，拒 bypassPermissions，忽略 user/project/local settings | **HAVE** | `O2`/`Yk`/`D2n`。eager `k3t` 清 setting-sources。`permissionSetup` 剥工具。cwd `vi`。spawn `restrictedSpawnEnv`。`up` `$L(Yk()?["--restricted"]:[])` 接 leftover `openNewSessionRow`。leftover `LaunchOptions` 已接整份 official Ie（`Yk`/`c7e`/`KEn`/`YEn`/`AL`/`Rwn`/`Cwn`/`GC` + leftover STATE wrappers `De`/`vu`/`AEn`/`a7e`/`BEn`/`_x`/`NGt`/`qC`/`f7e`… 走 `n().host.launchOptions`）。leftover `SettingsSource`/`ExtensionsConfig` 已接 official Fe/Oe（`xL`/`kde`/`G$`/`C4`/`xEe`/`Ade`/`Bp`… 走 `n().host.settingsSource` / `extensionsConfig`）。leftover Session 已接 official `yGt`/`en`/`un`/`n()`（sibling 袋 + leftover 已有 getter 改接 `n()` / `k.host`；`un()` id=`avt()??Iq()`；`Se` scroll `Zt=150`）。leftover `o_`/`XFe` 走 `k.host.credentialSlots`；leftover `Gri`/`Vri` 走 `k.host.requestLatches`。leftover SessionRefsGate wrappers + /clear /resume flag clear 走 n() bags。不 invent Yt / leftover expected/pinned / sessionSkillAllowlist wrappers。`Cwn`/`GC` `#w` 仍 ≠ `Yk` `#l`。`restricted.248.test.ts` / `launchOptions.248.test.ts` / `settingsHost.248.test.ts` / `forkRestrictedLaunchConfig.248.test.ts` |
| 2 | agent-cache-ttl | frontmatter `experimental.cacheTtl` `"5m"`/`"1h"` | **HAVE** | `mUt`/`jTt`。overage 忽略 `1h`。`agentFrontmatterCacheTtl.248.test.ts` |
| 3 | runner-client-label | `self-hosted-runner --client-label` / `SELF_HOSTED_RUNNER_CLIENT_LABEL` | **HAVE** | `rootRunner.ts` parse+env+`args.clientLabel??hostname()`。`clientLabel.248.test.ts` |
| 4 | managed-settings-diag | 托管设置加载失败：启动警告 + `/doctor` `/status` 说明未拉原因 | **HAVE** | `ISe`/`zre`/`WTt`/`cZe`/`Gf`。`/doctor`+`/status`。`managedSettingsLoadFail.248.test.ts` |
| 5 | web-setup-workflow-scope | `/web-setup`：gh token 缺 `workflow` scope 警告 | **HAVE** | `F()`/`at()`/`B()`。缺 scope 可继续。`webSetupWorkflowScope.248.test.ts` |
| 6 | usage-credits-enterprise | Enterprise Marketplace / 自助 / trial：向管理员要额度 | **HAVE** | `DN`/`Zur` 金标 7 项。`v_()` DISABLE 未回退。`usageCreditsEnterprise.248.test.ts` |
| 7 | xsession-3p | 同机 SendMessage/ListAgents：Bedrock/Vertex/Foundry + 关 telemetry | **HAVE** | `Po()` GB 默认 ON。`Ye`/cloudHop 未动。`harborKiteSameMachine.248.test.ts` |
| 8 | oauth-refresh-tool-cache | OAuth 刷新后工具定义重渲 → 约每小时 cache miss / 丢 thinking | **HAVE** | leftover `r_`。oauth-save `Ip()`。`s_`/`Gx` 默认 false。logout 仍 `IW`。`oauthRefreshToolCache.248.test.ts` |
| 9 | wakeup-resume-cache | overage 后 `--resume` `ScheduleWakeup` 定义变 → 首轮 cache miss | **HAVE** | `NAn`/`zce` pin `tengu_slate_anchor`。`Ivt`/`B1` `ignoreOverage`。接 `ScheduleWakeupTool.prompt()`。`wakeupResumeCache.248.test.ts` |
| 10 | desktop-30d | Desktop/Cowork 30 天清理 + `desktopSessionCleanupPeriodDays` | **HAVE** | `Ae` 从 `cleanupOldSessionFiles` 调。Ior skipIf=`Sgn`+`.desktop-released.json`。默认 Ce=0。无 `source==="desktop"` |
| 11 | refresh-lock-retry | 他进程占 refresh 锁 + token 过期：可重试错，不踢登录页 | **HAVE** | `Zye`/`OAuthRefreshLockTimeoutError`。ELOCKED 耗尽抛 Zye；Ho → `server_error` 金标重试句。`oauthRefreshLockTimeout.248.test.ts` |
| 12 | win-agents-keyboard | detach / win32-input-mode 后 agents 列表不吃键 | **HAVE** | `Yot` `?9001l` 写在 Windows detach。`win32InputModeAgents.248.test.ts` |
| 13 | login-console-fallback | 有 API key / helper 时 Console OAuth 先炸 → 回退 API-key 登录 | **HAVE** | `kxt`/`Ae`/`fallbackCures`。Keyless 句后 `startOAuthFlow`。`keylessConsoleFallback.248.test.ts` |
| 14 | model-name-code | `/model` / fast-mode：模型名当代码，`[1m]` 不当链接 | **HAVE** | `em`/`cGn`/`Dv`。`/model` `/fast` toast 接。`JKt` 仍 bold。`modelNoticeCode.248.test.ts` |
| 15 | agents-ci-trust | `CI` 时 agents 不再跳过 workspace trust | **HAVE** | `agentsTrust.tsx:77` `T()`：skip 仅 `IS_DEMO`/`CLAUBBIT`。`agentsTrust.248.test.ts` |
| 16 | pr-cache-malformed | PR-status cache 坏条目启动崩 | **HAVE** | 官方宿主 `class gc` `#x`/`#E`/`load`/`setRemoteWanted`/`#I`/`loadRemote`/`stopRemote`/`archiveRemote`。leftover `AgentView` + `fhFields.ts`（`Hu()`=`[]`，`Vu` 留 `remote-pending-`，`Z=!simpleView||initialJobId.startsWith("remote-")`）。`Zs=!1` 不 invent remote tabs / 第二份 cloud list。`rp` `Ct`/`Mt`/`Lt` 接 `fleetRpMerge`。`updatePendings` 接 `handleDispatch`/`openNewSessionRow`。`Oo` 仅 `template==="claude"`。不 invent 第二份 `Fh()`/`rp`/`Xw`。`fhFields.248.test.ts` / `loadRemote.248.test.ts` / `udsLiveFields.248.test.ts` |
| 17 | agent-stale-resurrect | 关机很久的后台会话当活的复活；应 stopped + 询问再 resume | **HAVE** | `deadEpochReapedAt` + `dead_epoch_transcript_gone`。fleet `ja`/`ip` 金标行。无 confirm overlay。`terminalHolder.248.test.ts` |
| 18 | agent-old-conv | 开新会话却打开更老对话并丢掉已输入 | **HAVE** | `Lc` 有 intent → 新会话，不 attach 旧 job。`ye(X.origin)`。`up` 不清 composer。`up` `$L` 接 `Yk()?["--restricted"]:[]`。`openNewSession.248.test.ts` |
| 19 | agents-already-open | 已在别终端 resume 的 stopped 会话又起第二进程 | **HAVE** | `terminalHolderOf` + Wr「Open in a terminal」。leftover spawn-refuse 未改。`terminalHolder.248.test.ts` |
| 20 | rm-merged-unpushed | worktree 已并进本地 default 但仍报未 push，删不掉 | **HAVE** | `oG`→`b1t`/`P0n` `primaryCheckoutVouches:true`。Ljr 仍 false。`pGe` 未动。`deleteJob.248.test.ts` |
| 21 | hook-invalid-answer | PermissionRequest/PreToolUse 无效答案：agents 行点名 hook+schema | **HAVE** | `wwt`/`Swt`/`Eve`/`Uct`。execute 循环 `noteHookFailure`。leftover `rA`=`bgNeedsInputBridge` 前缀 `needs`。不 invent 新 agents 行。`hookInvalidAnswer.248.test.ts` |
| 22 | hook-invalid-json | stdout `{…}` 非法 JSON：hook error + parse 信息 | **HAVE** | `hooks.ts` `lIe`：坏 JSON → validationError。`parseHookOutput.248.test.ts` |
| 23 | mcp-fake-claude-ai | 项目 `.mcp.json` 自称 claude.ai connector 不应列在受信 claude.ai 下 | **HAVE** | `ebn`/`_bt`。`MCPListPanel` 不再 `type===` 全进 claude.ai。无新 heading。`officialClaudeAiConnector.248.test.ts` |
| 24 | headershelper-401 | headersHelper 已给 Authorization，401 应重跑 helper 而非 OAuth discovery | **HAVE** | 官方宿主 `ko`/`Yt` @207025228。`connectAuthClassify.ts`：`ce` 静态 Authorization；`re` helper + minted bag（leftover `$Ze` = `getMcpServerHeaders`）；`ce` 或 `re` 则跳过 `ClaudeAuthProvider`。connect catch 先 `ko` 再 leftover `Yo`。`gC` 静态头跳过 oauth。不 invent `lyt`/`Ste`/`oKn` toast。`headersHelper401.248.test.ts` |
| 25 | login-gateway-hang | gateway 登录 + managed-settings 批准框挂死 | **HAVE** | `X` `reveal` + `d()`/`C()`。gateway `/login` `CHn`/`PKt`。Select 未改。`managedSettingsLoginHandoff.248.test.ts` |
| 26 | gateway-discovery-helper | 仅 `apiKeyHelper` 时 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` 不跑 | **HAVE** | `su`/`c9n`：helper 算凭证；trust skip 金标句。`gatewayDiscoveryHelper.248.test.ts` |
| 27 | logs-terminal-modes | `claude logs` 退出后鼠标跟踪 / bracketed paste / alt-screen 残留 | **HAVE** | `Pmr`+`tr()` 剥 DECSET。不 invent `cleanupTerminalModes`。`claudeLogsTeardown.248.test.ts` |
| 28 | trust-emoji-trunc | trust 规则截断切在 emoji 中间乱码 | **HAVE** | 248 `d` 用 `de`/`truncateCodeUnitsSafe`（247 `H` 是 `slice`）。leftover `/cd` `safeDisclosureEntry`。`Go` 仍只 join。`cdDisclosures.248.test.ts` |
| 29 | perm-mode-ctrl-c | Ctrl-C 后立刻 Shift-Tab：权限模式被「再按一次退出」挡住 | **HAVE** | REPL `a9`/`handleCycleMode` 先 `Vr` 清 exit hint。≠ fleet footer。`dismissExitHintIfShowing.248.test.ts` |
| 30 | ultrareview-secret-upload | 云会话 / ultrareview 勿上传 prod.env / tfvars / 凭证 swap/tmp | **HAVE** | `or`/`ar`/`rr`/`Ke` 接 `isSeedCredentialPath` → `seedWipWriteTree` leaveOut。云上传未 invent。`seedCredentialPath.248.test.ts` |
| 31 | rc-reconnect-prompt | RC 静默重连后对端看不到权限框 / 最新消息 | **HAVE** | 官方宿主 `remoteBridgeCore`。接 `pe`/`Ze`/`ot`/`xi`。gated local-only + reconnect `Ze.clear` + Local-only retract。initialize 接官方 `pending_*`（leftover schema 214 已有字段）。不 invent Hht / `yan`。`remoteBridgeReconnectPrompt.248.test.ts` |
| 32 | cloud-cred-startup | 云容器 session 凭证尚未可读就启动失败 | **N/A** | 云宿主。SEA 无 `not yet readable` / container creds |
| 33 | rc-flags-order | 全局旗标/包装器写在 `remote-control` 前，子命令旗标被拒 | **HAVE** | `allowUnknownOption` + `C(Y(L))`。`remoteControlFlags.248.test.ts` |
| 34 | startup-warn-column | 启动警告整列偏右一格 | **HAVE** | 248 `Fr` 去 `paddingLeft:1`（247 `Ds` 有）。`StatusNotices` 接 `Messages`。LogoV2 leftover 未动。`statusNoticesColumn.248.test.ts` |
| 35 | worktree-lock | 后台 worktree 会话应持锁，免被 cleanup / `git worktree remove` | **HAVE** | leftover `pGe`/`Gct` 未改。`adoptWorktreeForBgBoot` 接 `setup.ts` bg-boot。`worktreeBgLock.248.test.ts` |
| 36 | mention-ime | @mention 其它会话：IME 非拉丁对不上名 | **HAVE** | 宿主 `useTypeahead`。`bP`+`Bn=dr` 接 leftover `DM_AT_MENTION_RE`/`normalizeSessionNameKey`。不 invent Hangul/jamo。`dmAtMention.248.test.ts` `gold-248-36-host-hunt.txt` |
| 37 | crossSessionInbound | 非法值：用户警告+暂扣；托管拒收到修好 | **HAVE** | `N()` → hold/`invalidSetting`。无 managed refuse。`crossSessionInboundInvalid.248.test.ts` |
| 38 | usage-credits-hint-gate | `DISABLE_EXTRA_USAGE_COMMAND` 时限流文案不再叫 `/usage-credits` | **HAVE** | `v_()`/`Nde()` 金标句。`usageCreditsHintGate.248.test.ts`。未扩 `DN`（#6） |
| 39 | vscode-no-conversation | VSCode 未保存会话卡在 No conversation found | **N/A** | VSCode 宿主。SEA 无 `never saved` 插件句；同句是 CLI `--resume` |
| 40 | workflow-authoring | Workflow 描述 ~1k；写脚本说明进 `workflow-authoring` skill | **HAVE** | SEA `pXt` sha `498a85cdc7e27a20`。`Fmr` 注册 + `T()` 接 `processUserInput`。playbook 剥 slim。`workflowAuthoring.248.test.ts` |
| 41 | pr-badge-unchanged | PR 未变少打 GitHub；push / `gh pr` 仍立刻刷新 | **HAVE** | footer `usePrStatus` → `nge`/`wY`/`JE`。`p5e=60000` 仍在。`gh pr view` 未改。`prStatusNotModified.248.test.ts` |
| 42 | managed-env-no-approval | 客户端超时 / MCP 启动模式 / stream-watchdog env 不再触发批准框 | **HAVE** | LEh 四键入 `SAFE_ENV_VARS`。无 `startup-mode`。`managedEnvSafeWatchdog.248.test.ts` |
| 43 | ultrareview-gh-precheck | `/ultrareview <PR#>` 启动前检查 Claude 绑的 GitHub 能否访问该仓 | **HAVE** | `k`/`TUn`/`oae` 接 `reviewRemote` `Promise.all`+`gh pr view`。拒在 size 前。云 hop 未 invent。`githubAccessPrecheck.248.test.ts` |
| 44 | xsession-tmp-fallback | 默认目录不可用 → 用户私有 `/tmp`；`/status` 写出路径 | **HAVE** | `wZe`/`Wm` `/status` Peer address。leftover XDG/TMPDIR。无 `/tmp/claude-$USER`。`udsSocketDir.248.test.ts` |
| 45 | agent-shift-enter | agent 输入：shift+enter 换行，ctrl+enter 发送/挂上 | **HAVE** | `Fs`/`Lc`：ctrl+enter + `canDispatchAndOpen`。`agentDispatchKeys.248.test.ts` |
| 46 | loop-3p | `/loop` 自节奏动态 + 无 prompt 自治：Bedrock/Vertex/Foundry 也有 | **HAVE** | `loopDynamic.ts`/`loopFire.ts` 恒 true；`loop.ts` 去 GB。`loopAlwaysOn.248.test.ts` |
| 47 | anthropic-telemetry-log | Anthropic telemetry 失败 debug 前缀 `[Anthropic telemetry]` 不是 `[3P telemetry]` | **HAVE** | `anthropicTelemetryExport.ts` `Oht`/`QO`。3P OTEL 前缀仍留。`anthropicTelemetryExport.248.test.ts` |
| 48 | linux-userns-trust | user namespace 未映射 owner 的 root 等价信任只限规范系统目录 | **HAVE** | leftover UDS `walkSocketsPathComponents` 调 `tGn`/`p()`。金标 `cn`。未动 `tsn`/`F1t`。`udsOverflowuid.248.test.ts` |
| 49 | sendmessage-parent-reply | 子代理 SendMessage 到他会话：回复进父会话，不是子代理对话 | **HAVE** | `SendMessageTool/prompt.ts` `Pe()` 句。`sendMessageParentReply.248.test.ts` |

## 已锁合同

1. changelog 是索引。金标：`gold-248-feat-*.txt`、`gold-248-na-*.txt`、`gold-248-cache-verdict.txt`、`gold-248-agents-*.txt`。  
2. `#32` `#39` N/A。  
3. `#37` 非法值 → **hold**，不 invent refuse。`#40` 不 invent `pXt`。`#24` 不 invent `lyt`。`#31` 不 invent Hht。  
4. `#1` 已接。leftover `LaunchOptions` 已接整份 official Ie；leftover `SettingsSource`/`ExtensionsConfig` 已接 official Fe/Oe；leftover STATE wrappers 已改接 host；`Cwn`/`GC` `#w` 仍 ≠ `Yk`。`#16` Fh 缺字段 + `fleetRpMerge`/`updatePendings` + `setRemoteWanted`/`#I`/`loadRemote`/`stopRemote`/`archiveRemote`（`Hu()`=`[]`，`Zs=!1`）+ uds live fields 接 leftover `AgentView` / `fhFields.ts` / `udsClient.ts`，不另造 `Fh()`/`rp`/`Xw`/Yt/cloud list。

## 下一步

1. 初盘齐。有体再动小刀：`#3` `ra` · `#15` 去 CI skip · `#22` `lIe` · `#47` `Oht`/`QO` · `#49` `Pe()`。  
2. wave5 齐。HAVE `#6` `#12` `#33` `#35`。`#41` **PARTIAL**。  
3. `#16` `#24` `#31` HAVE。`#1`/`#18` `up` 接 `Yk()?["--restricted"]:[]`。leftover 整份 Ie + leftover Fe/Oe + leftover STATE wrappers + `loadRemote`/`setRemoteWanted`/`stopRemote`/`archiveRemote` 已接（`Hu()`=`[]`，`Zs=!1`）。
