# densable 2.1.232 — 官方更新清单 × go-hare 对照

> 来源：官方 CHANGELOG / GitHub release **v2.1.232**（**49 条**）。  
> densable SEA：`%TEMP%/official-232/plat/package/claude.exe`（win32-x64）；`// Version: 2.1.232` HIT ×3；size **319026336**；sha256 `ec9e32479bc887809003c91384c6c3a26e7691856d1916f72f6f6d21800f3bd6`。  
> 基线：本地 tip densable **2.1.231**（HAVE 1 + cup/r8o residual）+ npm **2.7.39**。**本 pack 只对齐 2.1.232**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent gateway-only / Desktop-only。  
> 更新：2026-08-15 — residual 对齐 #4 strict YM_/procStart stamp、#16 v2 Era、#26 thinking-only re-stream、#39 remint 接线源锁；#46/#47 文案收口。**HAVE 45 · PARTIAL 0 · N/A 4**。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.231** | MCP OAuth 预注册 redirect | **已收口** |
| **2.1.232** | fork 默认 / @mention / GitLab / 权限 / RC / sandbox… **49 条** | **本 pack** |
| **2.1.233+** | 未提取 | 勿折入 |

## 当前计数（2026-08-14 审查后）

| 状态 | 条数 | 说明 |
| ---- | ---- | ---- |
| **HAVE** | **45** | 产品主路径 + 测试/gold 已锁；部分条仍有 **标注 residual**（见下 residual 清单） |
| **PARTIAL** | **0** | #39 remint Ls+flight 编排集成测已补（2026-08-15） |
| **GAP** | **0** | — |
| **N/A** | **4** | #10/#11/#22 gateway；#45 Cowork |
| **UNKNOWN** | **0** | — |

> **HAVE ≠ 零 residual**。下表「residual」字段表示相对 densable SEA 仍欠的深度；按「不要可接受 residual」标准，继续深抽时优先 residual 清单。

### Residual 清单（HAVE 内仍欠 densable 深度）

| # | residual 摘要 |
| - | ------------- |
| 2 | cloud sessions / 完整 inProcess team-file / `Fii` defaultNamed 池（无云端不 invent） |
| 17 | cloud-worker isolation 面未再扩（无云端不 invent） |
| 31 | densable `/usage-credits` vs 本地 `/extra-usage` 产品名（非本条范围） |
| 42 | changelog takeover/end/delete 产品语义非独立 slash 金句 |
| 47 | SEA `Started Linux seccomp violation monitor` 属 SRT/UI 面；本地依赖 sandbox-runtime，不扩独立 monitor |

**已收口（2026-08-15 residual 对齐）**

| # | 收口说明 |
| - | -------- |
| 4 | registry `registerSession` 写入 `procStart`/`procStartFt`；YM_ 默认 **strict**（无 start 身份不算 holder）；lenient 仅 opt-in |
| 16 | v2 `ERA_NEGOTIATION_FAILED` + probe timeout 文案/`REQUEST_TIMEOUT` 分类；无 densable `_anthropicProbeTimedOut` 亦可 |
| 26 | thinking-only → `tengu_streaming_watchdog_retry` / `tengu_streaming_stale_connection_retry` `after_thinking_only`，caps Po=1 / sr=2 |
| 39 | Ls+flight 编排测 + `remoteBridgeCore` remint **接线源锁**；真网 e2e 仍非本仓默认（无云端不 invent live harness） |
| 46 | #46 本条=UDS socket dir `0o700`+拒 symlink（已 HAVE）；daemon/Chrome 0700 为独立面非本条 residual |

## densable 关键符号（SEA → 本地）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `// Version: 2.1.232` (×3) | 版本锚 | NEW |
| `FORK_SUBAGENT` / densable `Drb` | fork 产品默认 ON（非 ant） | `forkSubagentGate` **HAVE**（env force；ant/coordinator 关） |
| `background by default` | 非 teammate agent 默认 bg | AgentTool `run_in_background !== false` **有** |
| `SendMessage` / bare name resolve | 精确唯一名直送 | `nameResolve` / SendMessageTool **有** |
| `Dialog expiry` / `Messages from your other sessions` | /config 文案 | Config.tsx rows **HAVE** |
| `additionalMarketplaces` / `allowedMarketplaces` | settings 别名 | `settingsAliases.ts` **HAVE** |
| `glpat-` / `glrt-` 全家桶 | GitLab 秘钥红action | secretScanner **HAVE** |
| `PSDefaultParameterValues` | PS 权限绕过 | Cer/CUp **HAVE** |
| `gitlab.com` nested | marketplace | QDi **HAVE** |
| `sandbox.ripgrep` / `bwrapPath` / `socatPath` | sandbox 托管二进制源限制 | resolver + managed 审批 **HAVE** |
| remint `Ls`/`kd`/`nn`/`Tjp` | RC ~30min 重连 | 门控+Ls+flight 编排 **HAVE**；浅 residual=无全量 network e2e |

## 全量对照（49 条）

| # | 官方条目（摘要） | 状态 | 本地备注 |
| - | ---------------- | ---- | -------- |
| 1 | Subagent forking **默认开**；`subagent_type:"fork"` 继承会话+cache；交互非 teammate spawn **默认 background** | **HAVE** | densable `Drb`/`FDd`/`_Ie`：非 ant 默认 `"default"`（开）；`CLAUDE_CODE_FORK_SUBAGENT` true/false 强制；coordinator/non-interactive 仍关。本地 `forkSubagentGate` 1:1（**不再** GB default false）。Agent bg 默认 `run_in_background!==false` 已 HAVE。编译 `FORK_SUBAGENT` 仍可选（AgentTool OR 便携门）。测试 `forkDefaultOn.232.test.ts` + residualEnvGates |
| 2 | 输入 `@` 按名 mention 另一 Claude 会话 → SendMessage | **HAVE** | densable `spv`/`p4p`/`l4p`/`f4p`/`d4p`/`_mv`：`peerAtMention.ts` + attachment `peer_mention`（human-typed `preExpansionInput`，滤 file token）+ messages → SendMessage bare name / ask 消歧 + typeahead `dm-peer-…` + analytics `tengu_at_mention_peer_*`；门 `feature('UDS_INBOX')`≈`ig()`。池=UDS+bridge（`buildPeerCandidates`）；**residual**：cloud sessions / 完整 inProcess team-file teammates / densable `Fii` defaultNamed 全量。测试 `peerAtMention.232.test.ts`；snippet `gold-peer-at-mention.md` |
| 3 | SendMessage 对唯一 live bare name 直送，不先要 ref | **HAVE** | densable `T5f`：prompt bare-name 金句 1:1（唯一 live 直送 / ref 仅歧义 / in-process 优先 / `from`→`to` / permission laundering）；resolve：`tryDeliverToLocalAgent` 先于 `resolvePeerByName`。测试 `sendMessageBareName.232.test.ts` + `nameResolve.225`；snippet `gold-sendmessage-bare-name.md` |
| 4 | 同机 interactive 会话名唯一：`name-word-word` 变体 | **HAVE** | pure `ZM_`/`JM_`/`kp` + **/rename** + **startup `Bid`** + **`G$o` recheck** + pid `nameSource`/`nameSince` + GB default true + **`Nid`/`sessionNameState`** + **`QM_`/`XAt`** + **`jid`**。**YM_ strict**：`registerSession` 写入 `procStart`/`procStartFt`（`getProcessLstartString`+`buildProcessStartIdentityFields`）；`findNameHolders` 要求 start 身份；`lenientHolders` 仅 opt-in。测试 `sessionNameUniqueness.232`；snippet `gold-session-name-uniqueness.md` + `gold-session-name-bid-gso.md` |
| 5 | `/config`：Dialog expiry + Messages from other sessions | **HAVE** | densable `l9p`/`c9p`/`rDa`/`ig`：`Config.tsx` 行 label 1:1 + options `default|60s|5m|10m|never` / `default|accept|hold|refuse`；managed-outside-user 隐藏；inbound 行 `CLAUDE_CODE_HARBOR_KITE`/`tengu_harbor_kite`/`UDS_INBOX`。resolver 自 224。测试 `configDialogRows.232.test.ts`；snippet `gold-config-dialog-expiry-rows.md` |
| 6 | GitLab token 红action 全家桶 + glab 与 gh 同级沙箱/路径保护 | **HAVE** | **token**：`secretScanner` glpat/gldt `{20,}` + glrt/gloas/glptt/glagent/glimt/glsoat/glcbt/glft/glffct。**glab 路径**：`sandbox-adapter` denyWrite 对齐 densable `` `${t}/.config/glab-cli` `` + `` `${r}/.git/glab-cli` ``（与 gh 同级） |
| 7 | Plugin marketplace 支持 bare `gitlab.com`（含 nested subgroups） | **HAVE** | densable `QDi`/`I9S`/`sTb`/`aTb`：HTTPS `gitlab.com` ≥2 path 段（nested subgroup）→ `source:'git'`+`.git`；拒 `api`/`-` 段、WSr 反斜杠 host；shorthand 非 `owner/repo` 返回 densable 错误文案；clone SSH/HTTPS auth 失败提示用真实 host（非硬编码 GitHub）。测试 `parseMarketplaceGitlab.232.test.ts`；snippet `gold-gitlab-marketplace-QDi.md` |
| 8 | Settings 别名 `additionalMarketplaces` / `allowedMarketplaces` | **HAVE** | densable `BIy`/`sRe`：`settingsAliases.ts` + `parseSettingsFileUncached` / `validateSettingsFileContent` 在 schema 前 rewrite；双 key 警告文案 1:1。测试 `settingsAliases.232.test.ts` |
| 9 | Enterprise `blockedMarketplaces` url 对 bare repo git clone 仍拦截 | **HAVE** | densable `Qob`/`CWo`：`areSourcesEquivalentForBlocklist` 增 `git`↔`url`（`stripDotGit` 规范化）；url↔url 走 hostname fold。测试 `blockedMarketplacesUrlGit.232.test.ts`；snippet `gold-blocked-marketplaces-url-git.md` |
| 10 | Gateway desktop: overlay 接受全部 Desktop settings + schema 校验 | **N/A** | go-hare 不发 gateway 控制面 |
| 11 | Gateway managed.policies empty groups / bad email_domain fail boot | **N/A** | 同上 |
| 12 | Fable 5 再进 `/advisor` + usage-credits consent `/model fable` | **HAVE** | densable catalog `claude-fable-5` `advisor_rank:5` + `_Nb` 含 `fable`：`modelSupportsAdvisor`/`isValidAdvisorModel` 含 fable family；consent 文案 `fableConsent.ts`/`FABLE_ADVISOR_CREDITS_NOTICE`（gJt）+ `/model fable`。测试 `advisorApplied.test.ts`；snippet `gold-fable-advisor-sjc.md` |
| 13 | PS：变量写参不能静默改 `$PSDefaultParameterValues` | **HAVE** | densable `Cer`/`CUp`/`Loi`/`Jka`：`commonParameters.ts` `hasDangerousVariableWriteCommonParam`；`isAllowlistedCommand` 在 allowAllFlags 前拒绝。Set-Variable 路径仍由 `checkRuntimeStateManipulation` 覆盖。测试 `cer.commonParams.232.test.ts` |
| 14 | Win：Git Bash 跟 Cygwin 符号链接写需权限 | **HAVE** | densable `Yun`/`Xun`/`s8g`/`s8s`：`cygwinSymlinkCookie.ts` + `pathValidation` Windows 分支（cookie → chain deny-scan → safetyCheck `classifierApprovable:false`）；SAn `containsPathTraversal` 同步。测试 `cygwinSymlinkCookie.232.test.ts`。ADS/8.3 完整 n8g/ahs 用 trailing-dot fail-closed 近似 |
| 15 | Nested git 不继承父目录 trust | **HAVE** | densable `ged`/`yed`/`v6e`/`TR_`：`walkHasTrustDialogAcceptedBounded`（git root 界内 walk，根上无 match 即停）；`walkHasTrustDialogAccepted` 用 `findGitRoot` 绑定；`isPathTrusted` 先查 canonical key 再 `ged`；`advisoryNoFsProbe` 无界 walk。测试 `nestedGitTrust.232.test.ts`；snippet `gold-nested-git-trust.md` |
| 16 | MCP connect：协议版本探测失败/畸形不卡满 30s | **HAVE** | densable `y0`/`Obf`/`IiS`/`oMf`/`k5a` + auto→pinned-legacy：`mcpConnectTimeout.ts` classify/budget/preserve + `client.ts` recreate+remaining race。**v2 对齐**：`ERA_NEGOTIATION_FAILED` / SdkError；probe timeout 认 `Version negotiation probe timed out` + `REQUEST_TIMEOUT`（无 SEA stamp）。金文案 `probe_timeout`/`probe_failed`/`closed`。测试 `mcpConnectTimeout.232.test.ts`；snippet `gold-mcp-connect-timeout-y0.md` |
| 17 | RC：云会话内 bridge 不继承 transcript/credentials | **HAVE** | densable：cloud→elevated bridge 拒达（`elevated-security session unreachable from a cloud session`）；reattach mint 用 fresh `/bridge` credentials，不回放本地 transcript。本地 `remoteBridgeCore` reattach + `/bridge` creds 分离；peer 门同文案族。**residual**：完整 cloud-worker isolation 面未再扩 |
| 18 | RC：Desktop/IDE 启动 resume 重附既有 session | **HAVE** | densable `reattachSessionId`/`reattachSequenceNum` + unarchive；本地 `initReplBridge`/`remoteBridgeCore` 同字段 + `CLAUDE_BRIDGE_REATTACH_*` + left-arrow reattach |
| 19 | RC：idle 时新 client 不显示 unreachable | **HAVE** | densable `unreachableFromHere` 仅 `environment_kind==="bridge"` 且本端不可达时标；idle/list 不因 idle 本身标 unreachable。本地 bridge session meta 同字段 |
| 20 | RC bridge：worker 重启恢复 history | **HAVE** | densable reattach + `initialSequenceNum` 保留 pointer；本地 `reattachSequenceNum` → transport；skipArchive on left-arrow reattach |
| 21 | RC：claude.ai 会话已删时 resume 开替换而非 login 失败（227 回归） | **HAVE** | densable unarchive `outcome==="gone"` → mint fresh（`bridge_repl_v2_reattach_fallback`）；非 login fail。本地 `remoteBridgeCore` gone → mint fresh + 文案 retry/fresh session |
| 22 | Cloud gateway `/login` managed settings 失败可感知 | **N/A** | go-hare 不发 gateway 控制面；与 #10–11 同 |
| 23 | Voice native：连接拒绝立即显示，不卡 listening | **HAVE** | densable connect `.catch` + `M5h`：`useVoice` `attemptConnect` promise reject → 立即 `Voice connection failed…` + `recordVoiceEarlyFailure` + `idle`（不挂 recording）；空转写 `formatEmptyVoiceTranscriptError`。测试 `formatEmptyVoiceTranscriptError.232.test.ts`；snippet `gold-voice-connect-exception.md` |
| 24 | mTLS 证书轮换自动 reload | **HAVE** | densable `XEt`/`y3b`/`g3b`/`DDy`/`oeu`/`neu`：`reloadMtlsClientMaterialFromEnvAsync`（失败/mismatch 保留旧 material）+ `tryReloadMtlsOnStaleTlsConnection`；`withRetry` 在 TLS stale（Cye∪EPROTO/FailedToOpenSocket/ERR_OSSL_*/ERR_SSL_*）上 reload 并 `disableKeepAlive`+新 client。门 `CLAUDE_CODE_CLIENT_CERT` + 非 `CLAUDE_CODE_DISABLE_MTLS_RELOAD_ON_STALE_CONNECTION`。测试 `mtls.test.ts`；snippet `gold-mtls-y3b-xet.md` |
| 25 | 畸形 AWS/Vertex region 回退默认 | **HAVE** | densable `NNe`/`C5g`/`x5g` + `HSs`/`A5t`/`Vgo`/`oVe`：`sanitizeCloudRegion` 校验 `/^[a-z]{2,}(?:-[a-z0-9]+){0,4}$/i`；畸形 `AWS_REGION`/`AWS_DEFAULT_REGION`→`us-east-1`，`CLOUD_ML_REGION`/model override→`us-east5`。测试 `envUtils.test.ts`；snippet `gold-cloud-region-nne.md` |
| 26 | stream idle timeout Bedrock/Vertex/gateway 可恢复 | **HAVE** | densable `YLr`/`P5p`：`classifyAPIError` → `api_timeout`；byte watchdog 门；partial finalize。**thinking-only re-stream**：`thinkingOnlyStreamRetry.ts` + `claude.ts` `streamAttempt` 环 — idle → `tengu_streaming_watchdog_retry`（Po=1）、stale → `tengu_streaming_stale_connection_retry`（sr=2）`after_thinking_only:true`。测试 `classifyAPIError.streamIdle.232` + `thinkingOnlyStreamRetry.232` |
| 27 | overlay 截断宽度 / start-truncated ellipsis | **HAVE** | densable 显示层 start 截断走 grapheme/`truncateStartToWidth`（`…` 前缀）；与 #28 同 `truncate.ts` 族。overlay/路径 middle truncate 另有 `truncatePathMiddle` |
| 28 | mid-emoji 截断乱字符 | **HAVE** | densable `ts`/`Zz`/`n6e`/`and`/`AP_`：显示宽走 `truncate.ts` grapheme+stringWidth；码元走 `truncateCodeUnitsSafe` 丢高位代理。测试 ZWJ family + Jd surrogate；snippet `gold-mid-emoji-truncate.md` |
| 29 | known_marketplaces.json 并发写竞态 | **HAVE** | densable `ict`/`KKd`/`TL`/`G_`/`yY`：`createKeyedSerialQueue` + `updateKnownMarketplacesConfig`（per-path 串行 + `${path}.lock` retries 5/100–1000ms + 失败 fallback 写 + `tengu_known_marketplaces_fallback_write`）。seed/add/remove/refresh/autoUpdate/lastUpdated 经 RMW。测试 `knownMarketplacesLock.232.test.ts`；snippet `gold-known-marketplaces-lock-ict.md` |
| 30 | `/update` `/tui` 不因可存活工作拒绝重启 | **HAVE** | densable `XBE` 仅拒：bg session (`$s`) + session-only permission rules (`xah`/`dln`)；**无** running-agents/surviving-work 门。本地 `/tui` `acceptTuiRelaunch`/`buildTuiRelaunchPlan` 同样不扫 active agents。 |
| 31 | usage-limit 指引不在 SDK/remote 建议不可用 slash | **HAVE** | densable `sOm` upsell 仅 Ink `RateLimitMessage`/`eLi`（`shouldShowUpsell=ZGt\|\|Yi`≈mock/subscriber）；`if(eKn) upsell=null`。API 文案 `getRateLimitErrorMessage` **不**拼 `/upgrade`/`/usage-credits`。SDK/print 无 Ink 组件 → 不会建议交互 slash。**residual**：densable 金句用 `/usage-credits`，本地 UI 仍 `/extra-usage` 产品名（非 232 本条范围） |
| 32 | `--advisor fable` consent 文案 | **HAVE** | densable gJt + `Run /model fable to review and enable`：`FABLE_ADVISOR_CREDITS_NOTICE`；CLI `--advisor` 已注册；Fable consent dialog 金句 1:1（`getFableConsentCopy`）。与 #12 同族 |
| 33 | fullscreen 长会话不每帧全量 re-normalize | **HAVE** | densable `wih`/`pBE`/`mfT`：`useVirtualScroll` Float64Array offsets + 仅可见 range 测量；列宽变化 **scale** 缓存高度（不清空全量）；`mfT` 增量 itemKeys + dup `#N`。本地 `VirtualMessageList` + `useVirtualScroll` 1:1 注释 densable。**residual**：与 densable 同构，无额外全量 normalizeMessages 调用 |
| 34 | managed settings 审批 dialog 改进 + sandbox binary 需批 | **HAVE** | densable `sJc`/`d7e`/`Dwv`/`Owv`：`extractDangerousSettings` 将 `sandbox.bwrapPath`/`socatPath`/`ripgrep` 写入 shellSettings 并进审批列表；schema 文案「Only honored from admin-controlled managed settings」。dialog 标题「Managed settings require approval」已有。测试 `benignEnv.218.test.ts`；snippet `gold-fable-advisor-sjc.md` |
| 35 | `/feedback` `/bug` 响应中立即可开 | **HAVE** | densable/`local` `isEnabled` 仅 3P provider + `DISABLE_*` + essential-traffic + ant + `allow_product_feedback`；**无**「最后一条必须非中立」门。`/feedback` alias `/bug` 始终可进交互表单。 |
| 36 | `/plugin install` 先 refresh marketplace | **HAVE** | densable `gvm`/`zqr`/`jqr`：scoped `name@mkt` **始终**先 refresh（非 miss-only）；essential-traffic 无 FORCE 例外；仅 github/git/url；seed ineligible。`tryRefreshMarketplaceBeforeScopedInstall` + install success 缓存告警。测试 `scopedInstallRefresh.232.test.ts`；snippet `gold-plugin-install-refresh-zqr.md`。221 miss 路径 `tryRefreshMarketplaceOnCatalogMiss` 仍用于 discovery |
| 37 | `/code-review` high/xhigh/max 也走 bg agent | **HAVE** | densable `getContext`→`fork`（仅 coordinator `hS` / ReportFindings `zXh` 才 inline）；`Zyi`=`background??true`；effort 不门控 bg。本地 `context:'fork'`+`background:true` + `shouldBackgroundForkedSkill`。`FNb` 仅为 skill analytics set。测试 `codeReviewBg.232.test.ts`；snippet `gold-code-review-bg-levels.md` |
| 38 | 粘贴/剪贴板图非阻塞读 | **HAVE** | densable `hasClipboardImage`/`readClipboardImage`/`chat:imagePaste`/`tengu_collage_kaleidoscope`：`usePasteHandler` `void getImageFromClipboard()` fire-and-forget + `.finally(finishPaste)`；`PASTE_PENDING_SAFETY_MS=30_000`；native darwin 快路径。测试 `imagePasteNonBlocking.232.test.ts`；snippet `gold-image-paste-nonblocking.md` |
| 39 | RC 断网 ~30min 重连 | **HAVE** | **Ls+nn+G7+Hde+gzp**：`kd` 无裸 4090；leak/`Ei`/`Vo`；budgets；`Xn/To`；OAuth adopt；patience remintCap；G7；**Hde/mdt**；**gzp**。**测**：`remintRecovery.232` Ls+flight 编排 + **`remoteBridgeCoreRemintWiring.232`** 源锁（disposeTransportClose/createRecoveryFlight/G7/remintCap）。**非目标**：真网 e2e（无云端不 invent）。另：`teleportedSessionG7`/`bridgeCredentialResult.232` |
| 40 | RC resume 不静默抢同机另一 CC 的 RC | **HAVE** | densable/本地：`non-owner` / suppressed reattach（228 #5）+ pointer/owner 门；`Remote Control is already connected` 拒绝重复 Project 绑定。不静默抢已连接会话 |
| 41 | agent panel：完成即隐 + `/tasks` footer；overflow 左移 | **HAVE** | densable `kye=30000`=`PANEL_GRACE_MS`；`kT` terminal→`evictAfter`；`isLocalAgentPanelActive` 完成且无 KA 不显示。Footer pill `getPillLabel` + ↓ view CTA；overflow `calculateHorizontalScrollWindow` 左右箭头（选中左移窗口）。`/tasks` 命令进 dialog |
| 42 | RC 终端说明 takeover/end/delete | **HAVE** | densable 终端 hint 1:1：`space to show/hide QR code` · `w to toggle spawn mode`（`bridgeUI.ts`）；idle/active footer（`buildIdleFooterText`/`buildActiveFooterText`）；失败 `Run /remote-control to retry`（224+）。状态 Reconnecting/Failed/Reconnected。**residual**：changelog「takeover/end/delete」多为产品语义，非独立 slash 金句 |
| 43 | Bash `< file` 重定向全平台权限检查 | **HAVE** | densable `auS`：AST `op==="<"` → `validateInputRedirections`；**DEFAULT_BUILD_FEATURES 含 `TREE_SITTER_BASH`**（默认构建可走 AST）。无 AST 时 **`extractInputRedirections` fallback** 仍门控简单 `< file`（`/dev/null` 跳过；`<<`/`<<<`/`<&` 不检）。测试 `inputRedirect.232.test.ts` |
| 44 | resume 已完成 bg agent 文案缩短 | **HAVE** | densable `D5f`/`Y8a`/`hi`/`dle`：`formatResumedAgentMessage` + `resumeAgentBackground.finalText`（`awaitCompletion`→`extractTextContent`）；SendMessage stopped/evicted 走 `awaitCompletion:true` + D5f 短文案（`Resumed agent…Result:` / `Resuming agent…`；id 截 7）。测试 `formatResumedAgentMessage.232.test.ts`；snippet `gold-resume-completed-d5f.md` |
| 45 | Cowork 不 inline 用户记忆外链 @-import | **N/A** | Cowork 产品面；go-hare 不发 |
| 46 | cross-session socket dir：拒 symlink/他人目录 | **HAVE** | densable `refusing to bind` / `owned by uid` / `ENOTOWNED`：UDS `ensureSocketParent` + `assertPrivateDirectory`（拒 symlink/非目录/broad `0o077`/wrong uid；mkdir `0o700`）；错误前缀 `[uds-messaging] Failed to set up sockets directory (refusing to bind):`。capability 同门。测试 `udsMessaging` + `crossSessionSocketDir.232`；snippet `gold-cross-session-socket-dir.md`。daemon/Chrome MCP 0700 为**独立产品面**（非本条 residual） |
| 47 | Linux sandbox protected-path bypass 加固 | **HAVE** | densable 路径加固族：`Mmr` trailing-slash strip + Windows path bypass `classifierApprovable:false` + denyWrite（含 232 glab）+ #34 managed sandbox binary + #48 ripgrep 源限制。SEA seccomp violation monitor 文案属 **SRT/UI** residual，不 invent 独立 monitor |
| 48 | `sandbox.ripgrep` 仅 user/managed/`--settings`，project 不可覆盖 | **HAVE** | densable `sJc`/`rkt`/`XEn`/`Mad`：schema describe 1:1；`resolveSandboxRipgrep`（policy→flag→user，忽略 project/local）；`resolveSandboxBwrapPath`/`SocatPath` 仅 policy；`convertToSandboxRuntimeConfig` 用 resolver 而非 merged settings。测试 `sandbox.ripgrep.232.test.ts` |
| 49 | 去掉 custom subagent 启动 tip + `/powerup` nudge | **HAVE** | densable tip 列表 **无** `custom-agents`；保留 `agent-flag`。`powerup-onboarding` 仍在 densable（`tengu_alder_compass` 默认 false）。本地删除 `custom-agents` tip。测试 `customAgentsTipRemoved.232.test.ts`；snippet `gold-tip-remove-custom-agents.md` |

## 优先落地顺序（审查后）

| 优先级 | 项 | 状态 |
| ------ | -- | ---- |
| done | #1 FORK 默认 ON、#3–9、#12–16、#23–25、#28–30、#34–38、#43–44、#46、#48–49… | **HAVE** |
| done | Gateway #10–11/#22、Cowork #45 | **N/A** |
| done | **#39 remint** Ls+flight 编排集成测 | **HAVE**（2026-08-15） |
| open（可选） | residual 清单 #17/#31/#42/#47 深抽 | HAVE 内 residual（#4/#16/#26/#39 已收口） |
| hygiene | commit 时 **只 stage 232**；排除 `docs/logo*`、`v2.1.212/**` dumps | dirty ~358 路径 |

## SEA 获取

```text
npm pack @anthropic-ai/claude-code-win32-x64@2.1.232
# → %TEMP%/official-232/plat/package/claude.exe
```

## Explicit non-claims

- **不要**把 231 OAuth 重算进 232。  
- **不要** invent gateway Desktop 控制面（#10/#11/#22 = N/A）。  
- **不要** invent Cowork-only（#45 = N/A）。  
- Agent **background 默认** ≠ **fork 默认开**（#1 两句已分判；fork 产品默认 ON 已 HAVE）。  
- **不要**把「HAVE + residual」写成 densable 零差距；#39 已升 **HAVE**，仍可有浅 residual（无全量 network e2e）。  
- **不要** `git add .` 整树提交：排除 logo 与 `v2.1.212` extract dumps。
