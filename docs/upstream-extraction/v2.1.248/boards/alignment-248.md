# Alignment board — densable 2.1.248

> **开 pack** · 2026-09-20 · SEA_OK **2.1.248**（226708128） · changelog 是索引  
> HAVE **47** / PARTIAL **0** / GAP **0** / UNKNOWN **0** / N/A **2**  
> tip：npm **2.7.50** = 247 · **只盘 248** · 不折入 249+  
> 计数以 `official-248-checklist.md` 为准。

## 桶

| 桶 | # |
| -- | - |
| HAVE | #1 #2 #3 #4 #5 #6 #7 #8 #9 #10 #11 #12 #13 #14 #15 #16 #17 #18 #19 #20 #21 #22 #23 #24 #25 #26 #27 #28 #29 #30 #31 #33 #34 #35 #36 #37 #38 #40 #41 #42 #43 #44 #45 #46 #47 #48 #49 |
| PARTIAL | |
| GAP | |
| UNKNOWN | |
| N/A | #32 云容器凭证 · #39 VSCode |

## 并行初盘（2026-09-20）

1. changelog 49 条已落。SEA `--version` **2.1.248**。  
2. 四路本地扫已并。**扫员标的 GAP/HAVE 不进桶**。  
3. [#1–7 剥体](abd13bf9-df80-4727-be2e-2550b383a567) 已并。  
4. [leftover/N/A 剥体](23cb3bd1-5df6-49cc-9284-8e6d634e0d72) 已并 `gold-248-na-table.txt`。`#10` tentative N/A **再驳回**。`#31` 无新体。`#32`/`#39` N/A 坐实。  
5. [agents/UI 剥体](0f99add3-ee52-45aa-8613-4628d0778e2c) 已并。  
6. [cache/MCP 剥体](588a4e1f-8866-4ab1-a27e-e475dd452fe7) 已并 `gold-248-cache-verdict.txt`。四路剥体齐。

## 本地 leftover（初盘齐）

反面已接：`#11` `#13` `#15` `#22` `#26` `#37` `#38`。

半截：无。`#16` leftover 宿主 `AgentView.refresh` + `V$n`/`Oo`/`KC` + Fh 缺字段 + `fleetRpMerge`/`updatePendings` + `setRemoteWanted`/`#I`/`loadRemote`/`stopRemote`/`archiveRemote`（`Hu()`=`[]`，`Zs=!1`）+ uds `peerProtocol`/`jobId`/`status`。leftover `LaunchOptions` 已接整份 official Ie；leftover `SettingsSource`/`ExtensionsConfig` 已接 official Fe/Oe；leftover Session 已接 official `yGt`/`en`/`un`/`n()`（sibling 袋 + leftover 已有 getter 改接 `n()` / `k.host`；`un()` id=`avt()??Iq()`；`Se` scroll `Zt=150`）；leftover `o_`/`XFe` 走 `k.host.credentialSlots`；leftover `Gri`/`cTn` 单向 mark + `/clear` `requestLatches.reset()`；leftover `qC` 不再被 FORCE 盖住（FORCE 只在 nested_marker）；leftover Ue/We/Ge + `TelemetryHandles`(Be) + `Diagnostics`(He) + `DEFAULT_SURFACE_CAPS`(Yt const，非 class) + `SettingsOwner`(mGt) 已补；砍 bag 字段 STATE 双写（含 slowOps/errorLog→diagnostics）；leftover SessionRefsGate wrappers + /clear /resume flag clear 走 n() bags；`Cwn`/`GC` `#w` ≠ `Yk`。`/update`/`/restart` Mhr：tip gate `isEnabled:!1` + `fleetHostCall`；refuse 序 bg(`RW`/`Uc`) → transcript drift → `wU(...,GC())` → hoe；bg daemon respawn + foreground `acceptTuiRelaunch` + `replBridgeSkipNextArchive`；AgentView `Lc` 接 `fleetHostCall`（exit/login/update）。`tae` 全序有体臂已接：`_t`/`On`/`hg`/FORCE/`Lt`/`Om`/tui/`GHe`/`uft`/`gqn`(thin)/`GC`/seen/`mwt`；`gqn` 无 leftover `gbGateSource` 宿主（inject default false）。STATE residual：`kairosActive` only（SEA `"kairosActive"`/`"setKairos"`/`"is_assistant_mode"` hits=0；仅 `tengu_kairos_*` analytics + `userMsgOptIn`/`brief mode` 文案，无 host 槽）— KEEP STATE；header latches/`promptCache1hEligible`/`teleportedSessionIds`/`replBridgeSessionId` SEA hits=0 → KEEP STATE；砍 `sessionSource`；`getIsRemoteMode`/`setIsRemoteMode` 改接 `surfaceCapabilities`（官方 On/P4，砍 `STATE.isRemoteMode`）；`promptAssembly` Jkn/A7e 砍 size≥100 invent + STATE 双写，clear 接 `noteInvalidation`；砍 `STATE.lastEmittedDate` 双写；`lastMainRequestId`/`pendingPostCompaction`/`lastApiCompletionTimestamp` 改接 `requestJournal`；砍死 STATE type/init（~79 bag 镜像含 cost/Ie/Fe/telemetry/loop* 等；`gold-248-state-dead-fields.txt`）— State 仅留 19 槽：KEEP STATE 15 + KEEP g() type residual 4（sessionCron/cachedClaudeMd/registeredHooks/mainThreadAgentType）；`SettingsPrimer`+`settingsPrime`+Vjt/T/O/k_/k/wKn/v/_Ke/Gqe/z/`kC`/`Zve` 已补（`projectLocalLayerReaders.legacyLocalSettingsPath` + R() `"legacy local settings"`；`gold-248-SKn-leftover-map.txt`）— SettingsPrimer UNKNOWN 清零；生产调用点 `$pn`/`Npn`/`_Ke`→`init.ts`，`nHe`→`setup.ts`+`ExitWorktreeTool`（`gold-248-settings-call-sites.txt`；deeplink L0n / cloud attestation invent-ban）；`#16` Hu=`[]`/Zs=!1 invent-ban 再核（`gold-248-16-fh-verdict.txt`）；Ie/`requestJournal` 薄 wrapper 已补。

## 已钉（有体窗口，未接）

| # | 钉子 | 本地 |
| - | ---- | ---- |
| 1 | `O2`/`Yk`/`D2n` + `--restricted` parse + `up` `$L` + leftover `Cwn`/`GC` | **HAVE** `restricted.ts` + `main.tsx` `k3t` + leftover `openNewSessionRow`；整份 Ie 在 leftover `LaunchOptions`（`Yk`/`c7e`/`KEn`/`AL`/`Cwn` + leftover STATE wrappers）；leftover Fe/Oe 在 `SettingsSource`/`ExtensionsConfig`；he.#s=`DEFAULT_SURFACE_CAPS`(official Yt const，非 class)；`#w` ≠ `#l` |
| 2 | `mUt`/`jTt` `agent_frontmatter` | **HAVE** `promptCacheTtl.ts` |
| 3 | `ra` `--client-label` + env | **HAVE** `rootRunner.ts` |
| 4 | `ISe`/`zre`/`Gmr`/`qgn` | **HAVE** `loadStatus.ts` |
| 5 | `F()` workflow present/missing | **HAVE** `ghTokenWorkflowScope.ts` |
| 6 | `DN`/`Zur`/`v_` | **HAVE** `auth.ts` DN 7 项 |
| 7 | `Po()` 同机门（≠ `Ye()` 跨机） | **HAVE** `isHarborKiteEnabled` |
| 10 | `Ae`/`xe` + Ior skipIf `Sgn` | **HAVE** `cleanupOldSessionFiles` 调 `Ae` |
| 11 | `Zye` LockTimeout | **HAVE** `accountOnHold.ts`/`auth.ts`/`errors.ts` |
| 13 | `kxt`/`fallbackCures` | **HAVE** `getAuthStatus.ts`/`ConsoleOAuthFlow.tsx` |
| 15 | `T()` `Me(!1)` | **HAVE** `agentsTrust.tsx` |
| 16 | `uXe`/`K$n`/`q$n` + `gc` `#x`/`#E` + `V$n`/`Oo`/`KC` + Fh 缺字段 + `rp` `Ct`/`Mt`/`Lt` + `setRemoteWanted`/`#I`/`loadRemote`/`stopRemote`/`archiveRemote` | **HAVE** leftover `prStatuses.ts` + `fhFields.ts` `fleetRpMerge`/`loadRemoteJobs`/`stopRemote`/`archiveRemote` + `AgentView` X/a；`Hu()`=`[]`；`Zs=!1`；不 invent 第二份 `Fh()`/`rp`/`Xw`/cloud list |
| 19 | `terminalHolderOf` + Wr | **HAVE** leftover spawn-refuse 未改 |
| 21 | `wwt`/`Swt`/`Eve` + leftover `rA` | **HAVE** `hooks.ts` + `bgNeedsInputBridge` 前缀 needs |
| 22 | `lIe` | **HAVE** |
| 24 | `ko`/`Yt` + `ce`/`re` skip `EFe` | **HAVE** `connectAuthClassify.ts`；`re` 要 minted Authorization；不 invent `lyt` |
| 26 | `su`/`c9n` | **HAVE** `residualMoreEnvGates.ts` |
| 27 | `Pmr` | **HAVE** `tr()` 剥 DECSET |
| 30 | `rr`/`or`/`ar`/`Ke` | **HAVE** `seedWipWriteTree` leaveOut；云未 invent |
| 31 | `pe`/`Ze`/`ot`/`xi` | **HAVE** `remoteBridgeCore`；不 invent Hht |
| 33 | `b`/`C`/`w`/`R` | **HAVE** `remoteControlFlags.ts` |
| 35 | `pGe`/`Gct` + bg-boot `j` | **HAVE** leftover 锁未改；`setup.ts` 接 adopt |
| 36 | `bP` + `Bn=dr` | **HAVE** `useTypeahead` + `dmAtMention.ts`；不 invent Hangul |
| 37 | `N()`/`invalidSetting` → hold | **HAVE** `settings.ts` |
| 38 | `v_()`/`Nde()` | **HAVE** |
| 40 | `Fmr`/`gTt`/`T` + SEA `pXt` | **HAVE** `processUserInput` 接 `T()` |
| 41 | `A$` + 304 streak | **HAVE** footer `nge` → `wY`/`JE` |
| 43 | `TUn`/`oae`/`k` | **HAVE** `reviewRemote` 并行 probe；云未 invent |
| 46 | register 去 GB | **HAVE** |
| 42 | LEh STREAM_WATCHDOG+NONBLOCKING | **HAVE** `managedEnvConstants.ts` |
| 45 | `Fs` `canDispatchAndOpen` | **HAVE** |
| 47 | `Oht`/`QO` | **HAVE** |
| 48 | overflowuid（≠ `tsn`） | **HAVE** UDS `walkSocketsPathComponents` 调 `tGn`/`p()` |
| 49 | `Pe()` | **HAVE** `prompt.ts` |

## 下一刀

1. `#16` `#24` `#31` HAVE。`#1`/`#18` `up` 接 `Yk()?["--restricted"]:[]`。leftover `Cwn`/`GC` + leftover Fe/Oe + leftover Session `n()` + leftover STATE wrappers + Fh 缺字段已接。

## 邻版

| 版本 | 处理 |
| ---- | ---- |
| 247 | 已收口，不回改 |
| 249 | 官方无节 |
| 250 | stub，不折入 |
| 251+ | 未开 |
