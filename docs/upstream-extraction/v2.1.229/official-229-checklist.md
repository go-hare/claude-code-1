# densable 2.1.229 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.229 release notes（`changelog-2.1.229.md`，**32 条**，GitHub release body 为权威）。  
> densable 二进制 SEA：`/tmp/official-229/plat/package/claude`（darwin-arm64）；`// Version: 2.1.229` HIT ×6；size **294720528**；sha256 `d732f0ba0a539c58c2ffcaef06ed03b4e523726f0cb6cc27b3a5b7e7ae0a7a21`；vs 228 **+5 422 384**。  
> 基线：本地 tip densable **2.1.228**（HAVE 17 + PARTIAL 1 #12）。**本 pack 只对齐 2.1.229**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN** · **NOOP**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent cloud/VSCode-only。  
> 更新：2026-09-02 — 钉：#12 本 pack 曾落 127.0.0.1 主机名；**tip 以 231 localhost 为准**（listen 仍 127.0.0.1）。此前 08-13 落地 #12/#10/#29/#28/#26/#24/#5。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.228** | layout hang / Windows git / SHR / plugins / skills / … | tip（HAVE 17 + PARTIAL 1） |
| **2.1.229** | 32 条：RC continue docs / SHR hooks / SSE keepalive / plugin command / ListAgents offline·cloud / … | **本 pack** |
| **2.1.230+** | 未提取 | 勿折入 |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `function eBr` → `http://127.0.0.1:${port}/callback` | MCP OAuth redirect（**229 SEA**） | **HAVE（被 231 覆盖）** tip `buildRedirectUri` = **localhost**（231 `JFr`）；listen 仍 `127.0.0.1` |
| `function Hzo` + `ignoreEnvOptOut` | attribution 可忽略 env opt-out | **HAVE** `getAttributionHeader({ignoreEnvOptOut})` |
| sideQuery `forceAttributionHeader` + `p&&!j5t()?{ignoreEnvOptOut:!0}` | auto-mode classifier 强制 billing header | **HAVE** sideQuery + yoloClassifier + autoMode |
| `function j5t(){return cfe()===null&&b1()}` | 无 API key 的 Claude.ai subscriber 不 force | **HAVE** `isApiKeyAbsentClaudeAISubscriber` |
| `function n_g(e,t="darwin")` + Windows error string | win32 禁止 default baseDir | **HAVE** `assertWindowsBaseDirSource` + `baseDirSource` |
| `baseDirSource: "default"\|"env"\|"flag"` | parseArgs 追踪 baseDir 来源 | **HAVE** `RootRunnerArgs.baseDirSource` |
| `connected===!1?"offline"` + `case"cloud"` | ListAgents offline/cloud 标签 | **HAVE** ListPeersTool `resolvePeerStatusLabel` + format |
| `class FZp` / `$Zp` / `m_S=5000` / `h_S=270000` | workflow 同 prefix 错峰 | **HAVE** `workflow/prefixStagger.ts` + backend wire |
| `getUnbracketedIpv6DomainWarnings` / Otv / Dtv | sandbox IPv6 doctor | **HAVE** sandbox-adapter + doctorDiagnostic |
| `Y8e`/`BOn`/`aPp`/`Vjb` dangerous-flag deny | commit-push-pr | **HAVE** commit-push-pr + disallowedTools pipeline |
| plugin marketplace `source:"command"` + `mode:"link"` | command 源插件 | **HAVE** schema+c6_/bxd/d6_/Oxd + ptm/btm/x0v/ftm + sourceCommand persist + zvt bag |
| `function Ysa` + `bq · automatic compaction failed` | PTL 解释 compact 失败 | **HAVE** reactiveCompact Ysa/bua + query wire |
| `function nst` / `CIr` / `AIr` | non-string tool input 字段剔除 | **HAVE** `safeToolInput.ts` + collapse/teamMem/REPL hint wire |
| `Math.max(0, …)` before `.repeat` / ProgressBar width clamp | narrow terminal RangeError | **HAVE** ProgressBar + MarkdownTable separator/border |
| `function Rwr` / `Xpr` / `UOo` + expandPath `_$` | Windows `\\?\` / UNC strip | **HAVE** `path.ts` stripWindowsExtendedPathPrefix + expandPath wire |
| `YAm` + print `Input contained only whitespace` | stream-json / --print blank | **HAVE** processUserInput blank gate + print.ts early stderr |
| `o9m`/`i9m`/`s9m`/`n9m` + envTokenWasSet snapshot | `/login` OAUTH_TOKEN 成功后复告 | **HAVE** `oauthTokenEnvWarning.ts` + login.tsx |
| `__S` + `b_S=__S(os.availableParallelism())` | workflow 容器 CPU 并发 | **HAVE** workflow-engine constants |
| `fwp`/`hwp`/`_wp` unrecoverable `request_body_over_limit` | messages alone >32MB fail-once | **HAVE** `requestBodySize.ts` + errors 413 |
| `CODE_REVIEW` prompt `--comment` + `claude_args` inline MCP | GH review 发帖 | **HAVE** `github-app.ts` CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT |
| `Ume`/`.in_use` + `$6_` exit + `vTn` orphan skip | plugin one-shot liveness | **HAVE** `pluginInUseMarkers.ts` + loader/orphan wire |
| `mfT` itemKeys `#N` + `loggedDups` | stream 双打/消失 | **HAVE** `VirtualMessageList.buildVirtualItemKeys` |
| `_he`/`Gjo`/`V2o`/`sQ_` + `baseline.size===0` | diagnostics UI stall | **HAVE** `diagnosticTracking.ts` |
| `Un`/`fCo`/`TSt`/`k0s` + `r_h`/`KzT` + sendResult idle | RC slash spinner (worker_status) | **HAVE** `shouldReportRunningForMessages` + `shouldDeferBridgeResult`（本地更强） |
| `RAu`/`Hte`/`ufe` + `sae`/`kAu`/`Gp` | 1M access：subscriber 仅 first-party/unix socket 才 extra-usage | **HAVE** `check1mAccess.ts` |
| `AYh` + `dropForEnterpriseMcpConfig` + remote `Ia` | managed-mcp exclusive soft-skip | **HAVE** `mcpHermeticFilter` + main + print |
| `Ksc` unlink/error/close + FILE_STABILITY 300 | scheduled-tasks watcher | **HAVE** `cronScheduler.ts` |
| `gjw`/`yjw`/`Pyg` + `launcher_hooks` / `.ccr-launcher` / `launcher-settings.json` | CCR server hooks for SHR | **HAVE** `launcherHooks.ts` + session wire |
| SSE `event: ping` keepalive | gateway long-think | **N/A** host surface（client Tfb HAVE 222） |
| `h0t`/`rR` `GCM_INTERACTIVE` | SHR GCM fail-fast | **HAVE** `GIT_H0T_ENV` + runGitPrepare |
| `--base-dir (or SELF_HOSTED_RUNNER_BASE_DIR) is required on Windows…` | win32 错误文案 1:1 | **HAVE** |

## 条目对照（32）

| # | 官方要点 | 判定 | 本地证据 / densable 金标 | 备注 |
| - | -------- | ---- | ------------------------ | ---- |
| 1 | Document `claude remote-control --continue` | **HAVE** | `bridgeMain.ts` resume/`--continue` 文案与解析已有 | docs/help surface 对齐即可；产品面已有 |
| 2 | Server-supplied Claude Code hooks for SHR | **HAVE** | densable gjw/yjw/Pyg/`launcher_hooks` → `.ccr-launcher` + `launcher-settings.json` + `--settings`；`launcherHooks.ts` + sessionChild/Handler/Confine/Seed wire | 本轮落地；snippets/server-hooks-shr.txt |
| 3 | SSE keepalive pings on gateway stream (Vertex/Bedrock idle) | **N/A** | densable `tBw=\`event: ping\n...\`` + gateway protocol docs（host emit during silent gaps）；本地 client `streamKeepAlive.ts` Tfb 已是 222 面 | **host/gateway 产品面**，不 invent CLI gateway emit；client 合成 ping 已有 |
| 4 | Plugin marketplace `command` sources + `mode:"link"` | **HAVE** | densable dFe/d0t/c6_/bxd/d6_/Oxd + ptm/btm/x0v/ftm/HPd/zvt/**qvt**/lDs/_qu + UI Ikr shown HK；Oxd **early zvt**；sandbox jEr `lDs(RPo())→denyWrite` + cDs bHo；DXS `_qu` foldCase；schema + install/update CLI `-y` | residual：qvt 非 no-op（denyWrite fold）；UI update recorded 1:1；snippets/plugin-command-cli-ptm-zvt.txt |
| 5 | ListAgents: disconnected RC → `offline`；cloud → `cloud` | **HAVE** | densable Esf/gAS；`ListPeersTool` status labels + bridge `connected` | 本轮落地 + tests |
| 6 | Long responses partly disappear / printed twice while streaming | **HAVE** | densable `mfT`；`VirtualMessageList.buildVirtualItemKeys` + keysCacheRef | 本轮落地 + tests |
| 7 | Crash when tool call had non-string glob/file_path/command | **HAVE** | densable nst/CIr/AIr；`safeToolInput.ts` + collapseReadSearch/teamMemoryOps/CollapsedReadSearchContent | 本轮落地 + tests |
| 8 | RangeError narrow terminal progress/table (`--continue`/`--resume`) | **HAVE** | densable `Math.max(0,…)` before repeat；`ProgressBar` width clamp + `MarkdownTable` separator/border | 本轮落地 + tests |
| 9 | Windows crash on `\\?\` / UNC path in tool/message | **HAVE** | densable Rwr/Xpr/UOo；`path.ts` strip + expandPath Windows branch | 本轮落地 + tests |
| 10 | Auto mode fails when attribution header env disabled | **HAVE** | Hzo `ignoreEnvOptOut` + sideQuery `forceAttributionHeader` + auto_mode call sites | 本轮落地 + tests |
| 11 | `/model` rejects Sonnet/Opus 1M for claude.ai + custom BASE_URL | **HAVE** | densable RAu/Hte/ufe；`check1mAccess.ts` `isFirstPartySubscriberFor1mAccess` + tests | 本轮落地；snippets/check1m-rau-11.txt |
| 12 | MCP OAuth redirect 127.0.0.1 not localhost | **HAVE（历史）** | 229 SEA `eBr` 曾用 `127.0.0.1` 主机名。**tip 现码 = 231 `JFr` localhost**（`oauthPort.ts`）。勿按本行把 tip 改回 `127.0.0.1` | 被 231 覆盖；listen 仍 `127.0.0.1` |
| 13 | RC clients stuck working spinner after laptop slash command | **HAVE** | densable `Un`/`fCo`/`TSt`/`k0s`/`r_h`；本地 `shouldReportRunningForMessages`（滤 local-command-caveat）+ `shouldDeferBridgeResult` + `reportState('idle')` | 本地 **beyond** densable fCo；勿 regress；见 snippets/rc-spinner-13.txt |
| 14 | GitHub Code Review workflow completes without posting review | **HAVE** | densable tKm `--comment` + `claude_args` inline MCP；`github-app.ts` CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT | 本轮落地 + tests |
| 15 | Multi-second UI stalls after large IDE diagnostics edit | **HAVE** | densable `Gjo`/`V2o`/`sQ_` + baseline early-return；`diagnosticTracking.ts` | 本轮落地 + tests |
| 16 | One-shot `claude plugin` leaves stray liveness file | **HAVE** | densable IId/vId/$6_/PId/vTn；`pluginInUseMarkers.ts` + assemblePluginLoadResult + orphan GC skip | 本轮落地 + tests |
| 17 | Dynamic workflows use host core count in CPU-limited containers | **HAVE** | densable `__S`/`b_S=availableParallelism`；`workflowDefaultConcurrencyFromParallelism` + `DEFAULT_MAX_CONCURRENCY` | 本轮落地 + tests |
| 18 | File-watcher leak after atomic replace + Windows scheduled-tasks FS error | **HAVE** | densable Ksc；`cronScheduler` unlink/clear + error warn + close null；222 fileChanged teardown | 确认 HAVE；snippets/cron-watcher-18.txt |
| 19 | stream-json whitespace-only message → 400 | **HAVE** | densable YAm + print whitespace error；processUserInput + print.ts | 本轮落地 + tests |
| 20 | Messages alone >32MB: fail once clear, no compaction retry | **HAVE** | densable fwp/hwp/_wp；`requestBodySize.ts` + 413 unrecoverable → `request_body_over_limit`（非 media strip） | 本轮落地 + tests |
| 21 | Desktop OTEL export rejected by Desktop-managed gateway | **N/A** | Desktop-only invent-ban | 不 invent |
| 22 | SHR/remote exit when managed-mcp.json + server MCP; skip+warn | **HAVE** | densable AYh/Ia/GUo；`mcpHermeticFilter` enterprise reason + main soft-drop warn + print mcp_set_servers ignore | 本轮落地；snippets/managed-mcp-remote-22.txt |
| 23 | SHR git hangs on GCM prompt; fail-fast missing creds | **HAVE** | densable `h0t` + `rR` `GCM_INTERACTIVE:h0t.GCM_INTERACTIVE`；`GIT_H0T_ENV` + `runGitPrepare`；plugin `GIT_NO_PROMPT_ENV` + GCM | 本轮落地；snippets/gcm-fail-fast-23.txt |
| 24 | Workflow same-prefix stagger (`CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`) | **HAVE** | densable FZp；`workflow/prefixStagger.ts` + `claudeCodeBackend` enter/responded/done | 本轮落地 + tests |
| 25 | "prompt is too long" explains compaction recovery failure | **HAVE** | densable Ysa/bua/Qa m0b=300；`formatAutomaticCompactionFailed` + `tryReactiveCompact` failure + query annotate | 本轮落地 + tests |
| 26 | Sandbox IPv6 bracket + doctor unbracketed warnings | **HAVE** | densable iA_/sA_/Otv/Dtv；sandbox-adapter + doctor | 本轮落地 + tests |
| 27 | `/login` repeats `CLAUDE_CODE_OAUTH_TOKEN` override warning after success | **HAVE** | densable o9m/i9m/s9m/n9m；`oauthTokenEnvWarning.ts` + login call snapshot | 本轮落地 + tests |
| 28 | `/commit-push-pr` no auto-approve dangerous git/gh flags | **HAVE** | densable aPp/Y8e/BOn/Vjb；narrow allow + DISALLOWED_TOOLS + slash→REPL/QueryEngine deny union | 本轮落地 + tests |
| 29 | SHR Windows requires explicit `--base-dir` | **HAVE** | densable `n_g` + `baseDirSource`；`assertWindowsBaseDirSource` | 本轮落地 + tests |
| 30 | [VSCode] Report problem / `/bug` built-in feedback | **N/A** | invent-ban | |
| 31 | [VSCode] `/btw` panel resizable | **N/A** | invent-ban | |
| 32 | [VSCode] session groups in sidebar | **N/A** | invent-ban | |

## 计数（2026-08-13 落地 #4 residual ptm/zvt → HAVE 27）

| 状态 | 条数 | 条目 |
| ---- | ---- | ---- |
| **HAVE** | **27** | **#1、#2、#4、#5、#6、#7、#8、#9、#10、#11、#12、#13、#14、#15、#16、#17、#18、#19、#20、#22、#23、#24、#25、#26、#27、#28、#29** |
| **HAVE/PARTIAL** | **0** | — |
| **PARTIAL / PARTIAL-GAP** | **0** | — |
| **GAP** | **0** 大项 | — |
| **UNKNOWN** | **0** | — |
| **N/A** | **5** | **#3** SSE host ping、**#21、#30–#32** |
| **NOOP** | **0** | — |

**合计 32**（计数随续扫修正）。

## 本轮落地

1. **#12**（历史落地）`buildRedirectUri` 曾 → `http://127.0.0.1:${port}/callback`（229 `eBr`）。**tip 现码被 231 `JFr` 覆盖为 `localhost`**；listen 仍 `127.0.0.1`。勿回写。
2. **#10** `getAttributionHeader({ignoreEnvOptOut})` + `sideQuery.forceAttributionHeader` + auto-mode call sites（yoloClassifier ×3 + autoMode critique）
3. **#29** `baseDirSource` + `assertWindowsBaseDirSource`（densable `n_g` 文案 1:1）+ main 接线
4. **#28** `commit-push-pr.ts` densable aPp allow + Vjb deny；`disallowedTools` 经 slash → handlePromptSubmit → REPL/QueryEngine 并入 `alwaysDenyRules.command`（**sticky deny**：densable xai 仅 `length>0` 时 union、**不清空**；与 allow 的「下一次非 skill turn 传 [] 清空」不对称——会话级 harden，非 skill 作用域）
5. **#26** `sandbox-adapter` iA_/sA_ + doctor Otv/Dtv issue 文案 1:1
6. **#24** `workflow/prefixStagger.ts`（FZp）+ `claudeCodeBackend` enter/responded/done
7. **#5** ListAgents offline/cloud labels（Esf）+ bridge `connected`/`transport`
8. **#4** plugin `source:"command"` — `pluginCommandSource.ts`（dFe/d0t/c6_/bxd/d6_/Oxd）+ schema + managed `disableCommandPluginSources` + `cachePlugin` case + version contentSha slot
8b. **#4 residual** ptm/btm/x0v/ftm + install persist/zvt + CLI install `-y`；**update R0v** consent→cachePlugin + persist/zvt + CLI update `-y`；lDs + `_qu` DXS consumer + comparable cache invalidate（verifier FAIL 修复后 HAVE）
9. **#25** densable Ysa/bua — `formatAutomaticCompactionFailed` + `tryReactiveCompact` failure + `query.ts` annotate PTL on compact fail
10. **#7** densable nst/CIr/AIr — `safeToolInput.ts` + collapse/teamMem/REPL progress display wire（non-string glob/file_path/command 不崩溃）
11. **#8** narrow terminal RangeError — `ProgressBar` width clamp + `MarkdownTable` separator/border `Math.max(0,…)` before `.repeat`
12. **#9** densable Rwr/Xpr/UOo — `path.ts` `stripWindowsExtendedPathPrefix` + expandPath Windows early UNC normalize
13. **#19** densable YAm + print whitespace — `processUserInput` blank gate + `print.ts` early stderr for whitespace-only
14. **#27** densable o9m/i9m/s9m/n9m — `oauthTokenEnvWarning.ts` + login.tsx 启动快照 envTokenWasSet / startingMessage，成功后复告（gateway 抑制）
15. **#17** densable `__S`/`b_S` — `workflowDefaultConcurrencyFromParallelism` + `os.availableParallelism()` 默认并发（容器 cgroup 感知）
16. **#20** densable fwp/hwp/_wp — messages alone >32MB → `request_body_over_limit` fail-once 清晰文案，不走 media strip/compact 重试
17. **#14** densable tKm — `CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT` 加 `--comment` + `claude_args` 允许 `mcp__github_inline_comment__create_inline_comment`
18. **#16** densable IId/vId/$6_/PId/vTn — `pluginInUseMarkers.ts`：load 写 `.in_use/<pid>`、exit 清本进程、orphan 删前 live 检查
19. **#15** densable Gjo/V2o/sQ_ — `diagnosticFingerprint` + Set 相等 + `baseline.size===0` early-return + single-pass getNewDiagnostics + drive-letter strip
20. **#6** densable mfT — `buildVirtualItemKeys` sibling `#N` 去重 + keysCacheRef 增量 append
21. **#13** densable Un/fCo/sendResult + r_h — 本地已有 `shouldReportRunningForMessages` / `shouldDeferBridgeResult` / `reportState` idle（beyond densable；无新代码）
22. **#11** densable RAu/Hte/ufe — `check1mAccess.ts`：subscriber 仅 first-party BASE_URL / `ANTHROPIC_UNIX_SOCKET` 才走 extra-usage；custom gateway 放行 1M
23. **#22** densable AYh/Ia — `mcpHermeticFilter` enterprise reason + `main.tsx` remote soft-drop warn + `print.ts` mcp_set_servers ignore reason
24. **#18** densable Ksc — 确认 `cronScheduler` unlink/error/close 与 FILE_STABILITY=300 已 1:1（无新代码）
25. **#2** densable gjw/yjw/Pyg — `launcherHooks.ts` + sessionChild `--settings` + sessionHandler materialize + confine `repoDisablesAllHooks` + seed skip `.ccr-launcher` + cleanup
26. **#23** densable `h0t`/`rR` — `GIT_H0T_ENV` + `runGitPrepare` 注入 `GCM_INTERACTIVE:never`；plugin `GIT_NO_PROMPT_ENV` 对齐 h0t
27. **#3** 判 **N/A** host/gateway `event: ping`（client Tfb 已是 222）；snippets/sse-keepalive.txt 写明不 invent

测试：
- `src/self-hosted-runner/__tests__/gitPrepare.224.test.ts`（#23 h0t）
- `src/self-hosted-runner/__tests__/launcherHooks.229.test.ts`
- `src/services/mcp/__tests__/oauthPort.229.test.ts`
- `src/utils/model/__tests__/check1mAccess.229.test.ts`
- `src/utils/__tests__/mcpHermeticFilter.229.test.ts`
- `src/constants/__tests__/attributionHeader.229.test.ts`
- `src/self-hosted-runner/__tests__/rootRunner.baseDir.229.test.ts`
- `src/commands/__tests__/commit-push-pr.229.test.ts`
- `src/utils/sandbox/__tests__/ipv6DomainWarnings.229.test.ts`
- `src/workflow/__tests__/prefixStagger.229.test.ts`
- `packages/builtin-tools/src/tools/ListPeersTool/__tests__/listAgents.offline.229.test.ts`
- `src/utils/plugins/__tests__/pluginCommandSource.229.test.ts`
- `src/services/compact/__tests__/automaticCompactionFailed.229.test.ts`
- `src/utils/__tests__/safeToolInput.229.test.ts`
- `packages/@ant/ink/src/theme/__tests__/ProgressBar.229.test.ts`
- `src/components/__tests__/MarkdownTable.229.test.ts`
- `src/utils/__tests__/path.unc.229.test.ts`
- `src/utils/processUserInput/__tests__/blankPrompt.229.test.ts`
- `src/commands/login/__tests__/oauthTokenEnvWarning.229.test.ts`
- `packages/workflow-engine/src/__tests__/concurrency.test.ts`（#17 __S / availableParallelism）
- `src/services/api/__tests__/requestBodySize.229.test.ts`
- `src/constants/__tests__/githubApp.codeReview.229.test.ts`
- `src/utils/plugins/__tests__/pluginInUse.229.test.ts`
- `src/services/__tests__/diagnosticTracking.229.test.ts`
- `src/components/__tests__/buildVirtualItemKeys.229.test.ts`
- `src/bridge/__tests__/bridgeMessaging.test.ts`（#13 caveat 不 re-open running）
- `src/bridge/__tests__/bridgeResultScheduling.test.ts`（#13 defer result）

## 明确不做

- 不 invent VSCode（#30–#32）/ Desktop OTEL（#21）/ gateway SSE host ping（#3）
- 不 invent **超出 densable 的** qvt 额外 watcher / full kgt realpath/zee walk（densable qvt=`cDs.emit` + sandbox bHo + **jEr lDs→denyWrite** 已 1:1；`_qu` 用 densable kgt foldCase 默认 true，无完整 canonical walk）
- UI `/plugin` update **不**克隆 Ink TTY ptm：densable `Me("update")` → `_5r(..., {})` → recorded consent（fail-closed）已是 1:1，勿当 GAP 改掉
- 不 auto commit / bump / push，除非用户明确要求
- 不把 2.1.230+ 折入本 pack

## 下一步

1. #4 residual **齐**（CLI ptm、Oxd early zvt、qvt/cDs、**jEr lDs→denyWrite**、lDs/_qu foldCase DXS、UI install shown / update recorded、uninstall gUo batch）；#7 Write/Edit resume `expandPath` nst 门已补
2. 无 229 大项 GAP；N/A 保持 #3/#21/#30–#32；用户要求时再 `bun run precheck` 全绿 + commit

## 跨 pack

见 `docs/upstream-extraction/cross-pack-residuals.md`。本 pack 不回写 228 PARTIAL #12 synced skills。
