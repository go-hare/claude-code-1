# densable 2.1.238 · alignment progress

> 2026-08-21 · invent-ban · **no commit/bump** until「提交」  
> SEA：`/tmp/official-238/plat/package/claude` · size **321263536** · sha256 `1c196c456373b57818ae87df84aecee96cb659448c0d6a6bbb401ac5758431b2`

## Counts

| HAVE | PARTIAL | GAP | UNKNOWN | N/A |
| ---- | ------- | --- | ------- | --- |
| **34** | **5** | **0** | **0** | **0** |

## Done

- [x] inventory scaffold + SEA fingerprint
- [x] Batch1 **#1** HAVE
- [x] Batch2 **#2/#3** mint/pane + **Qxn/psr 三指针 HAVE** + **leftover ggw/ayi/P5r**（update full entry + install `marketplaceSource`）
- [x] Batch3 **#4 PARTIAL**（live E2E）+ **#5 F4y 1:1 HAVE**
- [x] **#22 HAVE** leftover standalone reuse-on-registration（删 leftover-clear；YKT/JKT/FDl；occupancy live-pid only；无 storageV5）· verifier `a6cb3d5b000528f23` **PASS**
- [x] UNKNOWN dig **#6–#39** inventory
- [x] **Batch A** #8 #9 #11(DAA) #13 #34 #37
- [x] **Batch B** #38 #39（≠ marketplace）
- [x] **Batch C** #19 #21 #26 #27 #33
- [x] remaining 1:1 **#17 T9r** · **#11 WBc** · **#7 s3T/pze** · **#10 Zdu/w5y/E5y**
- [x] leftover 1:1 **#12 `$0f`** · **#15 hasReleasedTerminal** · **#32 regex walker/QSa** · **#36 dT + probe clamp**
- [x] leftover-dig 1:1 **#23 SOt** · **#28 spare hide** · **#29/#30 sendPeerReceipt**
- [x] leftover-dig **#6** qWT→HWT 生产调用点 → HAVE（不 invent display-window GC）
- [x] leftover review **#1+#2** SEA `ggw`/`ayi`/`P5r`：update 全量 entry + `runEntryHelper:explicit` + `marketplaceSource`；install 传 source 对象；autoupdate `entry_helper_deferred` skip。**HAVE 内金标修**：qhi bind / dwo per-view pin（非 Map）/ CLI `shownEntryHelper` zgh / LSP `explicitInstall:!1` / ManagePlugins 始终 pinned / EZn rwe-after-ODt（磁盘孤儿是 SEA）。**不** land leftover #3 `identity_changed`。**不**改 leftover #4/#5。测：`entryHelperUpdate.238.test.ts` + `marketplaceHeadersHelper.238.test.ts` + `isolationWorktreePin.238.test.ts`（49/0/142）。verifier `a164c43238580e28c` **PASS**（parent spot-check 同）。
- [x] **审查未提交 → 「修」** HAVE 内金标修（计数不变）：**PCr** `wrapAnsi({trim:false, hard:true})`；**Oyw** declined\|unconfirmed → `Aborted — the command was not run.`（不 invent Se）；**Zxv** 三数组无 `.default([])`，truncated persist 拒 hydrate。测：`elicitationUrlSafety.238` + `marketplaceHeadersHelper.238` + `entryHelperUpdate.238` + `promptCacheBreakDetection.238`（69/0/227）。verifier `ab80148f3b6fa9a20` **PASS**（parent spot-check 同）。
- [x] **重新审查 → 「修」** marketplace 层 `_5n`/`ret`/`P5r`（计数不变）：mint 只跑 `trustedDeclaration.headersHelper`（`ret()` operator extraKnown / 信任后 repo-tier），**永不** `known_marketplaces.json` state helper；`resolveMarketplaceArchiveAuth` 只转发 static；ayi **qhi 先于** archive auth；pluginLoader archive P5r：J8p → same-origin `_5n` → G4S。**不** invent marketplace-add TTY / pane pluginId Map / leftover #3/#4/#5。测：`marketplaceHeadersHelper.238` + `entryHelperUpdate.238` + `headersHelperSchema.238`（49/0/121）。verifier `ae7349be302bd45f4` **PASS**（parent spot-check 同：qhi&lt;auth / J8p&lt;_5n&lt;G4S / 无 state mint / pane `command\0archiveUrl`）。
- [x] **审查 238 → 「修」** settings-source extraKnown overlay `DNt`/`Ryt`/`vBa`（计数不变）：Ryt named-key only（不 URL-scan、不读 known_marketplaces.json）；vBa 仅 settings-source archive，addDir strip helper；DNt URL mismatch 清空 entry；policySettings helper + !psr 抛 O3n（不等 q9）；无 overlay + settings/undefined marketplaceSource **strip catalog helper**（Browse/Discover/Manage 传 `marketplaceSource`）；g5n overlay 不需 `strict:false`；G4S 只看 KQe；P5r/ayi/ggw/bin 走 overlay；pane identity 仍 `command\0archiveUrl`。**不** invent leftover #3/#4/#5 / marketplace-add TTY / pane pluginId Map / Z5r `{name}` stub。测：`marketplaceHeadersHelper.238.test.ts`（41/0/121）。verifier `a22dc16b8a9b3c818` **PASS**（parent spot-check 同：41/0/121；tsc EXIT 0；`src/commands/plugin` 无 `getArchiveHeadersHelperForPane`）。
- [x] **残差分类 →「现在修」** GOLD_HARD（计数不变）：**Y8p/K8p** `cacheMarketplaceFromUrl` `maxContentLength=5242880` + catalog `beforeRedirect`（同源豁免 / 跨源 https+!blocked / drop inherited）；**Y_e/PN_/vBu** ManagedSettings `extraKnownMarketplaces[*].headersHelper` disclosure（含 `additionalMarketplaces` alias；**不** invent TrustDialog / add-TTY）；**KQe** `entryHasArchiveHeadersHelper` 空串缺席；**Fme** `split('@')` length===2；红测 fixture 补 `marketplaceSource`（**不**改 DNt undefined→strip）。测：`marketplaceCatalogRedirect.238` + `extraKnownDisclosure.238` + `entryHasAndFme.238` + `entryHelperUpdate.238` + `marketplaceHeadersHelper.238`（74/0/188）· biome 9 files · `bun run precheck` 12559/0。verifier `af33141f95d46e7e0` **PASS**（parent spot-check 同：74/0/188；DNt undefined → `{kind:'run', runEntryHelper:false}`；jhi=5242880）。
- [x] **再审查未提交 →「两项都修」**：`resolveMarketplaceArchiveAuth` 对齐 Fme（禁 `slice(1).join('@')`）；`official-238-checklist` 计数/状态拉回 board **34/5**（#4/#16/#25 回 PARTIAL；#18/#24 本就 PARTIAL）。不 invent leftover #3/#4/#5；**no commit**。
- [x] leftover-dig **#35** SEA extract Uoy + $oy → `SKILL_FILES` HAVE
- [x] **#20** EM0 remote nested-user repair / local exit HAVE
- [x] **#31 HAVE** macos-bare-claude-startup：`joa`/`Akd`/`LDn(Uoa=250)`/`jg`/`mkd` generation；无 darwin early-return；fast path 250ms deadline；REPL preAction 无界。测：`keychainPrefetch.238.test.ts` + `sleep.test.ts` withDeadline

## Extra（非 checklist）

- [x] typedIntoEmpty 白闪 1:1 — `Hi` latch + `uT(force,reason)` + `autoScrollEnabled`（settings??global??true）；无 3s 窗口；OJh wheel-past-max；`case 'bottom'` 仍 `scrollToBottom`；ScrollBox `alreadySticky` 保留

## Remaining

| # | 备注 |
| - | ---- |
| PARTIAL ×5 | gold-soft：#4 live E2E · #16 live discover · #18 user-visible isolation · #24 chrome · #25 live remint E2E |

## Review 1:1（HAVE 内金标修，计数不变）

- [x] **#6** qWT midConvFallback `e8\|\|fZ`（effort beta）；**不** invent `c8m`
- [x] **#18 子集** r1f first-call `pendingChanges=null` + overage `"TTL flip expected"`；TTL 阶梯已有
- [x] **#2/#3** q8s `additionalMarketplaces` alias 表面；**无** MN_
- [x] **#20** `V.X`=`Un()`/`isEnvTruthy`；`"0"`/`"false"` **仍 repair**（纠正上一轮 raw env FAIL）
- [x] **#6** oOl 缺 `source` throw

## Parked→aligned（HAVE 内，计数不变 · 2026-08-23）

- [x] **TrustDialog HH disclosure** SEA `BSy`/`aRs`/`sRs` + copy；`repoHelperSources` 含 marketplace + `.mcp.json` / local MCP HH；**不** invent ManagedSettings / allow/addDirs disclosure。测：`marketplaceHelperSources.238.test.ts`
- [x] **cold marketplaceName** `loadAndCacheMarketplace(..., marketplaceName?)`；cache-miss/bulk 传 name（SEA `ABa`）；named refresh 仍传。测：`marketplaceColdName.238.test.ts`
- 计数仍 **HAVE 34 / PARTIAL 5 / GAP 0 / UNKNOWN 0**。**no commit** until「提交」。

## Review-2（HAVE 内金标修，计数不变）

- [x] **#33** f8r `u2t`/`qnv` `req_…`；UUID 非 origin；无 `x-request-id`；空 `cf-ray` → other
- [x] **#27** TMn then KL；垃圾 sid / `session_` 空后缀 → `no-container-address`；无 live-handle fallback
- [x] **#11** MYg Ih 先；改写 overflow → null；FJe tilde 非 basename
- [x] **#32** Bop default `i&&(QSa(s)||QSa(e.text))||/]].*[;\n&|<>]/s`（`isDoubleBracket`）
- [x] **#32 Gop empty-walk**（verifier FAIL → fix）：empty-children `string` 返回 inner；`` ` ``/`$(` → unparsed cmdsub；Bop 可 `QSa(s)||QSa(e.text)`
- [x] **#38/#39** Aiv/Riv/H4S/cwd/overlay；local 不 scrub；bare dynamic 非 resident
- [x] **#9** CLI `--worktree` wrapper ODt；**PPl create 仍无 ODt**

## Tests（review-2）

```
bun test \
  src/cli/transports/__tests__/nonOrigin403.238.test.ts \
  src/bridge/__tests__/remoteControlSendGate.238.test.ts \
  src/components/permissions/__tests__/dontAskAgainLabel.238.test.ts \
  src/services/mcp/__tests__/headersHelper.238.test.ts \
  src/utils/bash/__tests__/batchA214.residual.test.ts \
  src/cli/__tests__/nestedUserRepair.238.test.ts \
  src/utils/__tests__/isolationWorktreePin.238.test.ts \
  src/services/api/__tests__/promptCacheBreakDetection.238.test.ts \
  src/services/api/__tests__/qwtMidConvFallback.238.test.ts \
  src/services/remoteManagedSettings/__tests__/qxnConsent.238.test.ts \
  src/utils/__tests__/subagentCacheEvict.test.ts
```
# 85 pass / 0 fail / 199 expects（2026-08-22 · 7-file review-2 + Gop empty-walk）
# verifier a42e3a8e10d97b70a **PASS**（先前 af0557a8cf1aa1357 FAIL：empty-children `string` 未达 Bop）

## PARTIAL gold-hard（#14/#16/#24 · 2026-08-22）

- [x] **#14 HAVE** DH/pAb on ink `wrapAnsi`：`cAb` 256/truecolor + wrap `\n` → 39/49 reopen。wrap-text `{hard:true}` 走 DH。**不** invent ColorDiff。测：`wrapAnsi.pAb.238.test.ts`
- [x] **#16 PARTIAL** Pwi + invalid-env warn + LGa/`xwi` denylist（GB-path only；env auto 不跑 denylist）；stdio GB 永远 legacy；ocv 含 stdio/ccr-proxy。**n_f/Cke/pMn**：http + CCR URL → `ccr-proxy`。**N_f-on-claudeai-proxy 1:1**：oGn/L_f/H_f/F_f/$Yp；reconnect `{includeDiscover:false}`。**不** N_f-on-stdio；**不** invent `cliOwnedConfigs`。live discover 仍 soft。测：`claudeAiProxyStateless.238.test.ts`（28）+ `mcpConnectTimeout.238.test.ts`
- [x] **#24 PARTIAL** Zkd set_model 非 string / `{ok:false}`；REPL `decideReplBridgeSetModel` + toast + concrete default；SDK 同合同无 RGf。**KSl/ASm/qjt 1:1**：`drawsFromUsageCredits`；copy **` · Draws from usage credits`**；ASm OFF 永不 bill；`useReplBridge` 传 `decision.model`。`/fast` subtitle + Cep/kep 1M suffix 同金标。CLI-absent `MHs`/`zpt` fail-closed。**不** invent chrome UI。测：`extraUsage.238.test.ts` + `fastMode.modelSwitch.218.test.ts` + `setModelControl.238.test.ts`（32/0/55）。verifier `a378e3cf191711ab5` **PASS**
- [x] **#5 HAVE** F4y 1:1：`egressProxyAuth.ts` VtC/ZtC/erC/trC/H4y/$4y；rootRunner 在 Connecting+capWarn 后、git 前 `enableEgressProxyAuth`；sessionChild `H4y` overlay；orchestrator `$4y` TelemetrySafeError。close **不** restore `process.env`。**禁止** CCR `upstreamproxy` / session `proxyAuthHelper`。测：`egressProxyAuth.238.test.ts` 32 pass
- [x] **#22 HAVE** 删 leftover-clear。YKT `pid`/`procStart` optional；JKT boolean；FDl `{noClear}`。`!S&&fe` writer-alive defer / standalone reuse-on-registration。`--session-id` occupancy live other pid only。leftover adopt + race + `preserveOnShutdown`/`ownsPointer` + hourly `procStart`。**无** storageV5。测：`bridgePointer.238.test.ts` 12 pass
- [x] **#25 PARTIAL** cr/kt/Gt/yr/exhausted copy + OAi typed 401 + x1r onExhausted after Ccb=3；mintFreshSession `typeof !== 'string'`；remint Hde after adopt 仍 `OAUTH_REAUTH_REQUIRED_DETAIL`。**禁止** 3rd onStateChange kind / adaptiveBuffer。live remint E2E 仍 soft。测：`loginExpiredCopy.238.test.ts`
- [x] **#18 PARTIAL gold-hard** q$t persist + **t1f extras**：Zxv `anyDeferLoading`/`is1hCacheTTL`/`queryDepth`/`cacheDiagnosis`/`messageHashes`/`perBlockHashes`/`perBlockLengths`；YLf billing strip；e1f=-1 skip；MQa PKo=`computer-use`；MWT latch **独立于** tracking 门；r1f 7th DWT `previousMessageId`。`cachedMCEnabled` 仅内存。CLI 不落盘；writeFile 非 vd。用户可见 `/model`/`/effort` isolation 仍 soft。测：`promptCacheBreakDetection.238.test.ts` 20 pass / 0 fail / 92 expects。q$t verifier `a3d0608a58c376411` **PASS** · t1f extras verifier `aa3b3ec7430b3fa93` **PASS**
- [x] **#4 PARTIAL gold-hard** F/onClosed/G()/Ne/Je/banner/Another SIGTERM 1:1：`F` 初值 true，`beginDrain` 不清 F；poll `finally` `onClosed` 无条件（含 maxMs=0）；`G(ue)` 首次信号+drain；forced-hook **Another SIGTERM**；banner supervisor timeout；始终传 `te`；`X` 只在 ceiling 置 true；`cr` ceiling 前 serve 新 assignment；`Pe` 含 `Ne`。测：`rootRunner.238.test.ts` + `postSessionInFlight.236.test.ts`。verifier `ab65d8ecfee9e4ab8` **PASS**（54/0/152；parent spot-check 同）。live-session ceiling E2E 仍 soft。
- [ ] **stay PARTIAL** #4 live E2E · #16 live discover · #18 user-visible isolation · **#24 chrome UI** · #25 live remint E2E

```
bun test \
  packages/@ant/ink/src/core/__tests__/wrapAnsi.pAb.238.test.ts \
  src/bridge/__tests__/setModelControl.238.test.ts \
  src/services/mcp/__tests__/mcpConnectTimeout.238.test.ts \
  src/services/mcp/__tests__/mcpConnectTimeout.232.test.ts \
  src/utils/model/__tests__/printSetModel.212.test.ts \
  src/utils/__tests__/fastMode.modelSwitch.218.test.ts
```
# 64 pass / 0 fail / 162 expects（2026-08-22 · PARTIAL gold-hard）

## Gold (this land)

- **#2/#3 HAVE** OBu triple-pointer：`sessionCache`/`verifiedPayload`/`consentedPayload`；Qxn 指针相等；psr = origin≠remote \|\| Qxn（origin=remote iff sessionCache populated）。RMr fail stale 无 verified；304 verified 无 W8s；apply verified + W8s on approved/no_check_needed；deferred_non_interactive verified 无 consent；404 verified+W8s。seedFromDisk 仅无 helper/marketplace 表面才 auto-consent。**leftover #1+#2**：SEA `ggw` planner + `cachePlugin` 全量 `entry` + `marketplaceSource`；SEA `ayi` `marketplaceSource` 进 `P5r`。**qhi/dwo/zgh**：`compareConsentedEntryHelper`；pane per-view `{record,pinned}`（非 module Map）；CLI `shownEntryHelper` 绑 zgh；refresh 缺 shown + helper → BXi + confirm-in-terminal；LSP `explicitInstall:!1`；ManagePlugins 始终 `pinned()`；EZn 本地组装 → ODt → rwe（不 invent disk rm）。browse/startup 默认不 mint。**无** storageV5 backendView / MN_ attestation。verifier `a164c43238580e28c` **PASS**（44/0/135；parent spot-check：LSP false / zgh exact / EZn assign_before=0）。
- **#6 HAVE** qWT 在 `query_message_normalization_end` 之后调 HWT（含 midConvFallback）。immutable；一层 nested；placeholder 仅整条 message；nested 空数组；telemetry iff byte overflow。**不** invent display-window GC。
- **#20 HAVE** EM0/wM0：local exit；remote repair/drop；`V.X`=`isEnvTruthy`（`"0"`/`"false"` 仍 repair）；malformed control_request remote drop。
- **review-2** #33 f8r `req_` · #27 TMn/KL · #11 MYg Ih/FJe · #32 Bop default + **Gop empty-walk** · #38/#39 Aiv/Riv/H4S · #9 CLI wrapper ODt（PPl create 无 ODt）。计数不变。
- **#5 HAVE** F4y 1:1 from SEA：`egressProxyAuth.ts` VtC minter / ZtC loopback CONNECT+absolute-form HTTP / erC rewrite `spu` / trC restore originals for mint env / H4y session overlay / $4y orchestrator TelemetrySafeError / Sre `configureGlobalAgents`。rootRunner 在 Connecting+capWarn 后、git 前 enable；close **不** restore `process.env`。**禁止** CCR `upstreamproxy` / session `proxyAuthHelper`。测：`egressProxyAuth.238.test.ts`（32 pass / 0 fail）。
- **#22 HAVE** leftover standalone pointer reuse-on-registration（densable YKT/JKT/FDl/`!S&&fe`）。删 leftover-clear。occupancy 仅 live writer pid。`--session-id` 用已有 `getBridgeSessionWithNotFound`。**禁止** storageV5 / `getBridgeSessionOrStatus` invent。测：`bridgePointer.238.test.ts`（12 pass / 0 fail / 28 expects）。
- **#16 PARTIAL gold-hard** Pwi invalid-env warn + `xwi`/`LGa` denylist（GB-path only；env auto early-return 不跑 denylist）。stdio GB 永远 legacy。**n_f/Cke/pMn**：`http` + same-origin Gia path → `ccr-proxy`（GB `tengu_mcp_protocol_negotiation_ccr`）。**N_f-on-claudeai-proxy 1:1**（`claudeAiProxyStateless.ts`）：`oGn`/`fqn`/`L_f`/`H_f`/`N_f`/`F_f`/`$Yp`；Accept-Encoding identity always；reconnect wrap `{includeDiscover:false}`。**禁止** N_f-on-stdio / `cliOwnedConfigs` WeakSet / W9 v2 tasks invent。live `server/discover` E2E 仍 gold-soft。测：`claudeAiProxyStateless.238.test.ts`（28）+ `mcpConnectTimeout.238.test.ts`。verifier `ad23505a20e7f6438` **PASS**（pre-n_f）· n_f verifier `ac118907c655cdf83` **PASS**（42/0/93）· **N_f verifier `a4bf07aa9f60da1a8` PASS**（51/0/99；parent spot-check 同）。
- **#25 PARTIAL gold-hard** copy cr/kt/Gt/yr/exhausted + OAi typed 401 `{terminal:false,reason:"oauth_rejected"}` + FOf grouping + x1r `onExhausted` after Ccb=3。mintFreshSession `typeof !== 'string'`。remint Hde after adopt 仍 `OAUTH_REAUTH_REQUIRED_DETAIL`。**禁止** 3rd onStateChange kind / adaptiveBuffer。live remint E2E 仍 gold-soft。测：`loginExpiredCopy.238.test.ts`。
- **#18 PARTIAL gold-hard** q$t persist + t1f extras：Zxv extras 1:1；MWT/pje 独立于 YNe；DWT previousMessageId；e1f skip；YLf strip；PKo=`computer-use` only。`cachedMCEnabled` 不 persist。CLI 不落盘。q$t verifier `a3d0608a58c376411` **PASS** · t1f extras verifier `aa3b3ec7430b3fa93` **PASS**（20/0/92；parent spot-check 同）。
- **#4 PARTIAL gold-hard** F/onClosed/G()/Ne/Je 1:1。verifier `ab65d8ecfee9e4ab8` **PASS**（54 pass / 0 fail / 152 expects；biome EXIT 0；parent spot-check 同）。live ceiling E2E 仍 gold-soft。
- **#31 HAVE** changelog「bare `claude` starts sooner on macOS」= keychain prefetch 238（非 binary 字面、非 #34 DGT）。`joa` 无 darwin guard；`Akd` try/catch + `windowsHide` + killed→null；`FHr='pending'`；oauth `.then` 独立；`mkd(stdout, generation)`；`LDn(e)` 无界 vs `jg(MDn,Uoa=250)`；`Ftn` sequential `await LDn(Uoa)`；preAction 仍 `LDn()`。测：`keychainPrefetch.238.test.ts` + `sleep.test.ts` withDeadline。**禁止** invent darwin module-load / napi lazy。

## Standing

densable-first **1:1** · concurrency **3** · 中文 · invent-ban · **no commit** until「提交」
