# densable 2.1.243 — 官方更新清单 × tip 对照

> 来源：CHANGELOG **2.1.243**（60 bullets）。SEA **已下载**（win32-x64 sha256 `895a32a6…`）。  
> 基线：本地 tip densable **2.1.243** + npm **2.7.48**（叠在 239 leftover / 2.7.47 上）。**本 pack 只盘点 2.1.243**（勿折入 240/241 空节、245+）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-09-04 — #24 补官方 `y`/`pe`/`me` 凭证目录锁。HAVE **49** / PARTIAL **0** / GAP **0** / N/A **11** / UNKNOWN **0**。  
> 口径：densable-first 1:1 · 官方函数体是合同 · 禁止「未锁就不搬」。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **49** | #1–#11 #13–#16 #18–#39 #44 #48–#58 |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **UNKNOWN** | **0** | — |
| **N/A** | **11** | VSCode 四条 + Desktop/cloud/官方 installer · 同缺 = 已对齐 |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | usage-loops-breakdown | `/usage` Loops：run count / tokens / per-run / last run | **HAVE** | SEA `Xu`/`Nh`/`qe`/`oe`：表头 Loops/every/runs/tokens/per run/last run；`loopUsage.ts` + Usage 表。 |
| 2 | settings-modelPicker | setting `modelPicker`：有序、带 label 的模型列表（含 Vertex/Bedrock id） | **HAVE** | schema + `pP`/`gP` + `getModelOptions` curated merge / replaceBuiltIn。 |
| 3 | settings-promptCacheTtl | `promptCacheTtl` + `subagentPromptCacheTtl`（主会话 1h / 子代理 5m） | **HAVE** | `sFr`/`FUr`：env > setting > ENABLE_1H > subscriber/`_zt`。 |
| 4 | settings-modelPricing | managed `modelPricing`：合同价 + 折扣乘子进 `/cost` / status / telemetry | **HAVE** | `compileModelPricing`/`Rx`/`xx`/`sy`/`Px`；trusted origin 才进 `calculateUSDCost`。 |
| 5 | login-console-keyless | `/login` → Console「Sign in with your Console account」（无 API key） | **HAVE** | `console_method`：wif vs legacy API key；`installOAuthTokens({skipApiKey})`。 |
| 6 | status-skipped-sources | `/status` `Skipped sources`：被更高优先级 managed 源盖掉的 managed 文件 | **HAVE** | remote/MDM 赢时列出 `managed-settings.json` / drop-ins。 |
| 7 | mcp-plugins-managed-marker | `/mcp` `/plugins` 给 org-managed claude.ai connector 标 `managed` | **HAVE** | SEA `enterprise_managed` → `enterpriseManaged`；列表 ` · managed`；详情 `Managed: by your organization`。 |
| 8 | tip-web-setup-github | 未连 GitHub 的 claude.ai 用户 → `/web-setup` tip | **HAVE** | tip `web-setup-github`：Pro/Max + gh auth + 未 sync。SEA 原文。 |
| 9 | status-github-web | `/status` 是否已连 GitHub（Pro/Max），否则指 `/web-setup` | **HAVE** | `Claude Code on the web` → `GitHub connected` / `Not set up · /web-setup to connect GitHub`。 |
| 10 | tasks-subagent-model-effort | `/tasks` + agent 详情显示子代理 model + effort | **HAVE** | `BackgroundTask` + `AsyncAgentDetailDialog` 画 `task.model` / `effort`（spawn 已 stamp）。 |
| 11 | mcp-p-sdk-reconnect | `-p` / SDK 远程 MCP 断线后自动重连或标 failed | **HAVE** | SEA `mS`/`ZA`/`JA`/`Hl`/`rS`/`du`/`t2t`/`XE`/`WKs`/`Ts`/`rN`：`mcpClientModule` peek/detach/identity；`$d` teardown + `cleanupConnectedMcpClients`；`peekSettled===w` 才 apply，否则 `Connection closed again while reconnecting`。AppState.mcp 有 `resourceTemplates`。勿与 239 #15 混。 |
| 12 | mcp-desktop-redirect-uri | Desktop 起的 MCP 登录 CIMD（Linear 等）Invalid redirect URI | **N/A** | SEA 0×`Invalid redirect URI`。Desktop 宿主 **同缺**。CLI 已有 stale CIMD `client_id` repair（`auth.ts`）。 |
| 13 | auto-mode-cached-disable | 临时 server-side disable 缓存 + 后续 flag 失败 → auto 一直不可用 | **HAVE** | SEA `Vo`/`wd`：空 cache → `gb-before-mode`；disk `enabled==="disabled"` → `gb-killswitch-recheck`；`Un(Pd(),1500)`。`getFeatureValueWithSource` 源 override/disabled/payload/disk/fallback。 |
| 14 | auto-mode-retry-unavailable | API 过载 retry 约 1 分钟后工具被拒 “temporarily unavailable” | **HAVE** | SEA `tBt`/`$ae=60000`/`Dae=120000`/`hon=60000`：xml_s1 `per_attempt` 每次 fetch 重置墙钟；xml_s2 `per_call`。`A$` `timeout`+`onFetchAttempt`→`fetchOverride`。`bzr`/`p$s`/`f$s`：`Pzr`=`VO`=`auto-mode-classifier-2026-07-16`；`ASe`=`$O=null`（latch 永不命中）。`hh=Qa&&!Li`、`td`=1P base URL。`sideQuery.extraBetas` + `wzr` catch。 |
| 15 | model-picker-ultracode | `/model` 选 Ultracode 被静默忽略 | **HAVE** | `ModelPicker` confirm 写 `ultracode: true` + wire effort。SEA 同形。 |
| 16 | resume-scroll-more-than-50 | `/resume` 只列最近 50，滚动再加载 | **HAVE** | `INITIAL_ENRICH_COUNT = 50` + `LogSelector.onLoadMore`。 |
| 17 | cloud-midturn-restart-hook | 云会话中途重启把 pending hook/bg 通知当 prompt | **N/A** | 无 pending-hook-as-prompt 金标。官方 mid-turn 是 bg-pty auth rekey，不是 CCR hook。云端 **同缺**。 |
| 18 | inbox-userns-rootless | 232 socket-dir 硬化后 userns / rootless 容器跨会话静默关 | **HAVE** | 默认根改为 `XDG_RUNTIME_DIR`‖`CLAUDE_CODE_TMPDIR`‖tmpdir；保留 `cc-socks/<pid-nonce>/messaging.sock`。祖先 walk：文件挡路 `Vi`、ELOOP `qi`。立即父目录仍 232 `assertPrivateDirectory`。 |
| 19 | overflow-text-leading-cols | 溢出容器的字（如 `/login` URL）重绘丢前几列 | **HAVE** | SEA `Zi`：`q=(Zo()?er:0)+F`。`Zo`=`useIsInsideModal`；`er`=`Io=2`（FullscreenLayout paddingX）；`F`=urlOutdent。URL 盒 `marginX:q?-q` + hint `paddingX:q` + Link `assumeSupport`。`/login`/teleport `F=modal?1:2`（Pane V/U）；setup-token/onboarding `F=1`。 |
| 20 | spellcheck-after-emoji | emoji 后直接打的错词不画线 | **HAVE** | SEA `w8e`/`Yhe`：`/\p{L}[\p{L}\p{M}]*(?:['\u2019][\p{L}\p{M}]+)*/gu`。首字必须是字母，emoji 尾部 VS/`\p{M}` 不会粘到后面的词。 |
| 21 | bg-subagent-wake-on-bash | 后台子代理最后一条 bg Bash 结束不唤醒 | **HAVE** | SEA `Lfe`：Jeo 扫 `agent:`/`workflow:`/`bash:`；`local_bash` 需 `notified&&Fl(status)` 才 tB。`qJ`=`tengu_concurrent_shore` 默认 ON 只闸 `uBn`/`pBn`（worktree / suppressTelemetry），不是 Jeo 条件。 |
| 22 | api-no-response-timeout-3m | API 一直不开头：~3min timeout → 重试一次 → `API Error: No response from API` | **HAVE** | SEA `ZMo`/`nOo`/`bEn`/`UYo=1`：`StreamNoResponseError` + first-byte wrap + format `No response from API`。 |
| 23 | client-error-not-model-output | auth / model-availability 等客户端错画成模型输出 | **HAVE** | SEA 导入图：`Ox=J$a` 红字、`Lx=NR`+`wx=he`→`Kx`。`Yl=_Tc=W`、`aT=VTc=u`。`if(y){C=f$e();if(C)throw new yz(C.url)}` 在 `FTn` 前。refresh `Xl`→`Hs.set`；`oo({error:"account_on_hold",content:YOn})`；`zz` `yz`→`auth_error`；withRetry `nd(new yz)`。dead-token：`ql`/`Ms`/`$s`/`Vk`/`zk`/`Wk`/`z0`；refresh `$s.has` skip；catch `Ms`→`Vk`。`oi`/`K0=32`/`$0`/`G0` 已搬；官方唯一调用方是 `jwo`（`plugins_scope_expansion` / `user:plugins`），本地 **同缺**，不 invent `jwo`。`z0` 清 `oi`。 |
| 24 | wif-ci-token-share | CI WIF：同 job 共享兑换 token；拒绝 fail-fast | **HAVE** | SEA `y`/`pe`/`me`/`H`/`Ee`/`lt`：user_oauth `y(H(Ee, after-recorded-401), fail-closed)`；OIDC env-quad `y(H(always), fail-open)`。锁凭证目录（stale 60s / 5·15 次）；`H` 仅 `always` 或 `failedAccessTokens.size>0` 才 adopt。`lt`=`invalidateWifToken`：记 **TokenCache 形 last-issued**（非 disk）后 `cached=null`；非 force 不 pin `failedAccessTokens` 中的 disk token；`pendingProfileRefresh` 在 pin 前合并；force/`lt` 后才经 H 采用 sibling。`withRetry` 401 → `lt(getLastIssuedWifAccessToken())`。 |
| 25 | companyAnnouncements-after-login | 本会话刚登录（如 `/logout` 后首启）不显示 server-managed announcements | **HAVE** | SEA `si`/`rf`/`Cc`/`ut`：空列表不 persist；`ut()`=`Oe.of(session.root)` 上的 `companyAnnouncement`；remote settings 到后再 `si(true)`。 |
| 26 | hook-if-cmdsubst | `Bash(cat *)` 在 `$()` / backtick 后续参数上误触发 | **HAVE** | SEA `C5s`/`P7r`：`command_substitution` 等走回退抽取，不再 `() => true`。`cat *` 只对抽出的顶层/内层命令匹配。 |
| 27 | plugin-marketplace-field-plugin-dir | `marketplace` 依赖 + `--plugin-dir` 同时加载永不 resolve | **HAVE** | `@inline` declarer：`verifyAndDemote`/`findReverseDependents`/`resolveDependencyClosure` 按 name-only 匹配；`dep-b@some-mkt` 满足 `dep-b@inline`。 |
| 28 | reload-plugins-lsp | `/reload-plugins` 关完最后一个 LSP 插件仍留 LSP tool；变更前 warn | **HAVE** | `Fn`/`Me`：`assessPluginReloadCacheImpact` 加 `lspToolChange`；`wouldInvalidateCache=(mcp||lsp)&&!toolSearch&&tokens`；`/reload-plugins` cache gate + `--force`；`sjo` 0-server reinit 清 `hasEverConnected`（`didLastConfigLoadFail` gate）。 |
| 29 | agents-flag-invalid-json | `--agents` 非法 JSON/定义静默忽略；应像 `--mcp-config` 一样退出 | **HAVE** | `Error: Invalid --agents configuration:` + `process.exit(1)`。 |
| 30 | status-invalid-mcp-filename | `/status` 「Found invalid entries in: .」无文件名（`~/.claude.json` MCP） | **HAVE** | user/local MCP 带 `getGlobalClaudeFile()`；文案 `Found invalid entries in:`；空/`.` 过滤。 |
| 31 | clear-keep-rename | `/clear` 从 prompt bar 抹掉 `/rename` 名，但新会话其实还留着 | **HAVE** | `F=!u&&ct()!==void 0` 留 `standaloneAgentContext.name`；`clearSessionMetadata({keepTitle:true})`。 |
| 32 | history-malformed-jsonl | `history.jsonl` 坏行弄坏 Ctrl+R / 上箭头 | **HAVE** | `history.ts` catch-skip malformed lines。SEA `YXs` 同形。 |
| 33 | vim-ctrl-bracket-modifyotherkeys | Ctrl+[ 在 modifyOtherKeys / kitty 下不离开 vim INSERT | **HAVE** | SEA `zb`：纯 Ctrl（无 shift/meta/super）把 91/`[` → `escape`、109/`m` → `return`、105/`i` → `tab`、104/`h` → `backspace`；remap 后 `ctrl` 清掉。CSI u `ESC[91;5u` 与 MOK `ESC[27;5;91~`。 |
| 34 | ide-no-proxy-case | IDE 连 localhost：`NO_PROXY` 有、`no_proxy` 无 → 仍走 `HTTPS_PROXY` | **HAVE** | SEA `Ne`/`S`：两 casing 不同则 `${no_proxy},${NO_PROXY}`；任一方 `*` 赢。`getNoProxy` + EnvHttpProxyAgent。 |
| 35 | sandbox-net-violation-exit0 | 被拦命令仍 exit 0 时 Bash 结果丢掉 network-violation 细节 | **HAVE** | SEA：annotate 增量 `f` 写进 success `stderr`（`[p,f].join(EOL)`）。exit 0 的 curl 403 仍带 `<sandbox_violations>`。 |
| 36 | usage-rate-limit-after-reset | 空闲跨过 reset 后 status/`/usage` 仍显示 reset 前百分比 | **HAVE** | SEA `Y0a`/`y()`/`I()`=`K0a`/`V0a`：headers seed，否则读 `cachedUsageUtilization`（`FNo` 1h TTL；账号不符清掉）。live `J()` 有 `q` 字段才 `V0a`（`UNo` 5m 防抖）。live API **不**做 ISO 窗口过滤。 |
| 37 | teleport-stash-uncommitted | `--teleport` 遇未提交直接退出，不提供 stash（picker 已有） | **HAVE** | `TeleportStash.tsx` CLI stash picker。 |
| 38 | web-setup-old-gh-cli | 旧 `gh`（无 `gh auth token`）已登录仍反复要 login | **HAVE** | SEA `yh`：unknown command / 空 stderr → 可选 `auth status`；`/web-setup` `allowNetworkFallbackForOldGh:true` → `gh_too_old`（2.17.0）不循环 login。 |
| 39 | chrome-native-host-stable-launcher | 自动更新清掉旧版本后 Chrome native host 失联；改走稳定 `claude` launcher | **HAVE** | SEA `no`/`j`/`Ie`：`pinToCurrentBinary = y26 && !B(W)`；wrapper argv=`[cmd,...prefix,--chrome-native-host]`；POSIX `exec quote`；Windows `"arg"` + `%`→`%%`；同内容仍修 0o755。MCP stdio 仍 `execPath --claude-in-chrome-mcp`。 |
| 40 | vscode-flags-default-mode | VSCode：flag 未拉到就开会话 → 默认 permission 而非 auto/配置 | **N/A** | CLI SEA 无 VSCode host · **同缺 = 已对齐**（同 239 #59）。 |
| 41 | vscode-focus-collapse | VSCode Focus view 展开节在子代理工具活动时自己收起 | **N/A** | 同上。 |
| 42 | startup-nonblocking-first-frame | sandbox/MCP 不挡首帧；bare 跳过 subcommand 注册；settings/trust 更便宜 | **N/A** | SEA「first frame」是 GIF 工具文案，不是 native 启动路径。go-hare `bun --compile` ≠ 官方 installer。**同缺**，不 invent。 |
| 43 | native-zstd-download | native 安装/自更新 zstd（Linux x64 ~75MB 而非 340MB） | **N/A** | zstd 在 bun/runtime。go-hare ≠ 官方 SEA 包装。**同缺**，不 invent installer。 |
| 44 | auth-token-org-telemetry | `ANTHROPIC_AUTH_TOKEN` 直连 API 的 usage telemetry 归到 org | **HAVE** | SEA `Qf`：`organizationUUID = oauth \|\| CLAUDE_CODE_ORGANIZATION_UUID`（account 同理）。无 JWT parse（`a`/`t` 为 `void 0`）。不 invent Sentry。 |
| 45 | native-skill-compact | bundled skill/prompt 更紧，native 大约小 2MB | **N/A** | 官方 native 包装项。go-hare ≠ SEA installer。**同缺**。 |
| 46 | native-ondemand-code | native 按需加载，大约少 40–70MB RSS | **N/A** | 同上。**同缺**。 |
| 47 | heap-gc-sooner | 长会话更早 GC | **N/A** | `--expose-gc` 是 bun runtime。SEA 无 `heap_gc` 产品面。**同缺**。 |
| 48 | login-ssh-url-copy | SSH `/login`：URL 立刻出；`c` 报告是否真拷到；fullscreen 选字 hint | **HAVE** | `D`/`XCb` headless → URL 立刻出，否则 3s。`c`=`/^c+$/` 报 `dt` path（native/`(Copied!)` · tmux-buffer · osc52）。`fr`=`ue&&Me!=="off"` Hold `Ht` hint。`Vo`=`jt` probe。 |
| 49 | effort-xhigh-thinking-off-error | thinking 关 + `xhigh`/`max`：点名档位、谁关的、`/effort high` | **HAVE** | `effortThinkingGuard`：档位 + `/effort high`/`--effort high` + 关 thinking 原因。 |
| 50 | loop-fold-idle-wakeups | `/loop` 连续空转折叠成一行 | **HAVE** | `Cfr` `tengu_loop_noop_fold` 默认 ON（`loopDynamic` + ScheduleWakeup prompt）。 |
| 51 | sandbox-bash-no-host-list | sandbox Bash prompt 不再列允许主机，让模型试 + 用户批 | **HAVE** | `getSimpleSandboxSection` 不再把 `allowedHosts` 写进模型 prompt；denied/sockets 仍列。 |
| 52 | sonnet5-standard-list-price | `/model` + `claude-api` skill：Sonnet 5 $2/$10 当标准价，不是限时 promo | **HAVE** | SEA `tier_2_10` `{2,10,2.5,4,0.2}`；`MODEL_COSTS` + picker + skill。 |
| 53 | macos-computer-use-finder | macOS computer use：点桌面/Dock/Finder 要授 Finder | **HAVE** | SEA `Ee`/`Tn`/`At`/`lr`/`Ze`：空 hit-test 合成 Finder；darwin menu-bar 重映射；desktop-shell 要 `request_access` 恰好 `"Finder"`/`"File Explorer"`。去掉 always-allowed。 |
| 54 | model-fast-effort-immediate-thirdparty | Bedrock/Vertex/Foundry 或关 telemetry 时 `/model` `/fast` `/effort` 立刻跑、不排队 | **HAVE** | `shouldInferenceConfigCommandBeImmediate`：ant / 3P / `DISABLE_TELEMETRY` / GB。 |
| 55 | rc-env-drop-recover | `claude remote-control` 服务器中途丢 environment 不再退出 stranded | **HAVE** | SEA `It`/`pn`/`tr`/`u`/`yt`/`ar`：poll **404**（非 expiry、非 crash-idle）最多 remint 3 次同 `environment_id`；成功后续 poll `recovered` + drain pending reconnect（最多 5）。410/expiry 走 `ar` 后缀；crash+env-gone 走 `yt`。`An()` 无 in-module 体 / 无 gate 名 → 产品路径 ON。 |
| 56 | rc-restart-nonadmin-stuck | RC 停再启后非 admin/owner Team·Enterprise 会话卡住 | **HAVE** | 无独立 admin/owner 文案。官方 `gn`：凡 `BridgeFatalError`（含 403）都是 rejected，`tr` 回 `"done"` 不空转。与 #55 remint 同一条。 |
| 57 | inbox-socket-30s-idle | 跨会话 inbox socket：30s 无完整行就关连接 | **HAVE** | SEA `It()`：`firstLineDeadlineMs` 默认 30s；首个换行（含空行）清定时器；telemetry `silent_connection_deadline`。不是 `socket.setTimeout` idle-on-any-data。239 2s auth 仍留。 |
| 58 | rc-other-machine-notice | resume 时 RC 被别的终端占着：说明看不到/到不了其它机器上的会话 | **HAVE** | SEA `w`/`_`：`Remote Control not started here · another Claude Code on this machine…` + messaging 时 other-machines 句。`localHolderGuard` decline/`Ht`；`/remote-control` observe 接管。 |
| 59 | vscode-history-trim | VSCode 长会话先丢旧 tool-activity 行 | **N/A** | CLI SEA 无 VSCode host · **同缺 = 已对齐**。 |
| 60 | vscode-ext-telemetry-org | VSCode 扩展自己的 usage telemetry 归到 org | **N/A** | 同上。 |

## 非 changelog 旁注

- 官方 CHANGELOG tip 已到 **2.1.248**。245 glibc、246–248 新 setting（`--restricted` / `experimental.cacheTtl` 等）**禁止**折进本 pack。
- 无 **2.1.242** / **2.1.244** 节。
- `#2` 不要把 `src/components/ModelPicker.tsx` 标 HAVE。
- `#3` 与 248 `experimental.cacheTtl` 是不同 knobs。
- `#11` 不要复用 239 #15 的 mid-session 5xx 证据交差。

## 下一步

1. **2.1.243 pack 已收口**（HAVE 49 / N/A 11 / UNKNOWN 0）。不要再挖本清单 UNKNOWN。
2. VSCode / Desktop / 官方 installer / JWT-org / Sentry 保持同缺，禁止 invent。
3. `#14` `ASe=$O=null`：`p$s` 死分支已按金标落地。`#23` `jwo` 同缺，不 invent plugins scope expansion。
4. 下一 pack 才看 245–248。
