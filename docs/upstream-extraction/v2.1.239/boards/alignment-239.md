# Alignment board — densable 2.1.239

> Living board · 2026-08-29 · SEA `%TEMP%\official-239\package\claude.exe`  
> 计数 HAVE **52** / PARTIAL **2** / GAP **0** / UNKNOWN **2** / N/A **3**  
> tip：npm **2.7.46** + 239 leftover（willow crate）· **不**折入 240/241  
> 计数以 `official-239-checklist.md` 为准（2026-08-27 假 HAVE 纠偏 `#4`/`#13` → PARTIAL）。

## 桶

| 桶 | # |
| -- | - |
| HAVE | #1 #2 #3 #6 #7 #8 #9 #10 #11 #12 #14 #15 #16 #17 #18 #19 #20 #21 #22 #23 #24 #25 #26 #27 #28 #29 #30 #31 #32 #33 #34 #35 #36 #37 #38 #39 #40 #41 #42 #43 #45 #46 #47 #48 #49 #50 #51 #52 #53 #55 #57 #58 |
| PARTIAL | #4 @synced 灌目录死 · #13 交互 plan resume 缺 CCR E2E |
| GAP | — |
| N/A | #5 #54 #59 |
| UNKNOWN | #44 #56（已搁置） |

## 本轮落地（缺功能按官方补）

1. **#10** JetBrains `ABS` skip + `wBS=500` baseline timeout + `_ol=3` 停采；fetch `EBS=2000`。
2. **#24** `pnh` 锁死回复、去掉 `<message>`（changelog 被 markdown 吃空的 tag）。
3. **#27** `wNe`/`ZGn`/`I8r`：`~/.claude/themes` + `custom:${slug}` 合并 `effortUltra`。
4. **#34** `FullscreenLayout` `MODAL_TRANSCRIPT_PEEK=2` 已是官方行为，标 HAVE。
5. **#50** `DHm`/`G1w`/`DEe`：ListAgents 自报名字；SendMessage 自己不再说 no agent named。
6. **#33** `yvf=400` / `Jhf` latch / Button+Select `dropAsStray` / `yln` option onClick。
7. **#19** `MTs`：已删目录 / ENOENT 祖先 → `null`，在当前目录 resume。
8. **#26** `Qyf`/`Qpr`/`Jyf`：拆包 SGR 鼠标 hold/drop，不再插入 `"35;150;7M"`。
9. **#51** `OHm`/`Z1w`：ListAgents 列出 live teammates（in-process / pane / roster + K1w shadow）。
10. **#58** `HYb`/`IWd`/`xWd`：`sessions/${pid}.${hash}.key` + `{peerToken}` + dead-owner 排名 + 完整 `od`/`KGo`（FDn+kw + in-place/snapshot/`exactMode`/`flush`）。
11. **#47** `flo`/`mlo`：`ihr("hook_exec", ees)` / `finally shr`，`ees="startup-hook-hold"`（只保活，不 bump mainLoop）。
12. **#37** `ies`：cwd 没了走 `originalCwd → projectRoot → homedir`，兜底 tmpdir。
13. **#11** `Ntl`/`Cuy`：`inFlightDrainBatch` 同引用 clear；Esc restore 等 drain；`Ruy` snapshot\|\|isActive；batch 跳过 `passive`。
14. **#29** `JIy` vim Esc：INSERT→NORMAL 保稿；viewing-agent INSERT 不 abort。
15. **#28** PreToolUse `defer`：print-only/solo-only + `r1t`/`Zrp`/`Qrp` + `H8f`/`JNs` `deferred_tool_use`。
16. **#13** `planModeResume`：`QnT`/`y_u`/`XWy`/`__u`；`qqe`=ExitPlanMode；`KS`=`getDenyRuleForTool`；`Ibu=(epoch??1)>1`；Jqy 在 OMo 后立刻回 plan；`$qy` restored\|declined notify。

## 刻意不落

- **#4** 已落 CLI。**不** invent 云端谁灌 `syncedPluginDirs`、`R9a` disable-all、`T0r`/`zXl`、`e.skill` merge、整段 `vas` iN。
- **#13** 已落 CLI 写/读。**不** invent `EaT` / `nxh` / `rxh` 升级 / RCS `internal_metadata` store / `running_background_tasks`。
- **#15** print `type==="failed"` 已 1:1。**不** invent `ZMf`/`cnl`/`settledCachedDialFailures`。
- **#55** `sourcePath??storedImagePaths.get` 已 1:1。**不** invent `savedFilePath` / 云端 upload。
- **#44 / #56 已搁置**（2026-08-24）：复挖补了邻近图，仍无本地 1:1。#44=`En_` gateway webhook；#56=`KFy`/`Ohu`/`yUy` 云 relay。不 invent。
- **#6 `p()`** Fable-5 extra-usage 隐藏 reset 后缀；无 tip 对等类型。
- **#16 sidecar** `dirname(jsonl)/<id>/custom-title.json`；tip 已有 `reAppendSessionMetadata`。
- **#17 `H8s`** symlink-ancestor walker；`iHn` 只落 `hg\|\|Hg`。
- **#23 `L7`/`xsr`** CRLF 与歧义 closing `---` 不 invent。
- **#25 `tQ_`** 运行时把坏条目 stub 成 `unsupported`；无 tip 对等机器，不 invent。
- **#31 `voice.mode`** hold/tap 是官方 /voice 另面，changelog 不是它。
- **#40 `ALe`/`did:`** 不 invent strip `/`、不删 `tcp:`。
- **#50** 未 invent `$_a` heldNames/formerNames host；用 `getCurrentSessionTitle` 代替 `QV()?.name`。不 invent 整段 `V1w`。
- **#36 `j()` U-set** ancestor walker 不 invent。
- **#38 二次 OLp** 对 resolvedPath 不 invent。
- **#51** 已落 OHm/Z1w；不 invent 整段 `V1w`/`Q1w`/`J1w`/`GCe` 全局 `pYb`。
- **#58** 已落 HYb/IWd + 完整 `od`/`KGo`；不 invent RC 跨机 hop、`qGo`/`bfe`。
- **#53 `d9p`** gateway+429 不重试；未 invent。
- live-sources **无**「SDK major-version upgrade guides」heading。
- **#49 `Km`/riv** 自动 trust、`queuedGoalOrigin`、interactive CLI `--continue` OMo。
- **#19** tip `ccb` 二进制名；不 invent `existsSync` 第二套门。
- **#33** Select 遥测 / `Thf()` / job-list onClick。
- **#26** `pendingSgr` 第二套名字。
- **#37** 已落 ies；不 invent WorktreeCreate `ies(r.cwd,e.project)` / host WeakMap。
- **#11** 已落 Cuy drain；不把 restore 改成只查 `iIi`。
- **#28** 已落 defer 全路径；不把 defer 当 deny。
- **#29** 已落 JIy Esc；不 invent 完整 FleetView vim。
- **#35** oSn agent 钻取 / `Wct` filter / `g6t` / `isMidTurn` / tmux `uq()` 半高。
- **#14** `Tk`/`oge` sanitizer、`zRr` 重写、`(task …)` title 后缀。
- **#30** `SelectionState.scope` / `virtualFocusCol` / FleetView extend。
- **#46** `jcs`/`__r`/`Wwe`/`GPi` hide、`ZHe` `PMr`/`JO`/`Yc`、`lCi`。
- **#42** `kill-paste-hint`、`interrupt` store、`myr`/pastedContents history extras。
- **#27** 未 invent v5 `userConfigDir` / `zTi` watcher。
- **#2 `eEv`/`Lhp`/`firstStartVersion`** 不接进 `isFullscreenEnvEnabled`（会改 tip default-on）。
- **#20** 不 invent `composerSidebarBackground` / `skill` / `autoAcceptShimmer`。
- **#21** 不 invent upsell 遥测事件。
- **#1** 不 invent `/cost` 文案 / `hOt` 第三参；web search 不乘 1.1。
- **#45** 不 invent 第二套 compact-skill reminder；不改 `todo_reminder`。
- **#39** 不 invent `title_write_coalesced` 遥测、`/rename` `userInitiated`、repl `shouldSend` 断连门。
- **storageV5**（2026-08-25 用户明确不接）：`MQA` 第二参 / `_O` / `BMi` host 不接；team 文件保持磁盘-only。
- **AppState `teammateColors` / `Iin`**：tip 已有模块级 `assignTeammateColor`，不迁 AppState 字段。
- **artifact `readArtifactForModel` / cobalt `ASe`/`UQ`/`fxv`**：官方 Artifact 读面未接。`RJr`/`ASe` 在无 cobalt host 时为 false；`_pr` fail copy 已按官方字符串落地。
- **Lto `extractAttachments` / `n4t` / `SXr`**：`n4t` 0-hit 不 invent。Lto 保留 optional collector + `SXr` drain；slash 不传 `n4t`。
- **Lto `recordInvocation` / `forkReadFileState` / `isMeta` prompt**：已按官方落地。`a()` 读 `iXe` 已有 content（首次为空）；bg 走 `onTerminalSuccess`；live-duplicate 立刻 `T()`。`g` 用 tip `READ_FILE_STATE_CACHE_SIZE`（官方 `pq=5000` 不改全局）。不 invent `applyAttributionOp`/`HJr`/`shareFileHistory`/`storageV5` sidecar。
- **SendMessage `Qei`/`ELe`/`g0m`**：已按官方落地。`w0m` 只是 UDS 下 `message` 空串 default（不是 first-line summary 自动填）。不 invent `VEt` 进 validate（自送仍在 `call()` / `hasInlineUdsToken`）、`did:` strip、`p_a` decode、官方 `cloud-session` 专臂 / `Ken`/`GEt`、`rg()` GrowthBook harbor kite（本地仍用 `UDS_INBOX`）。
- **`/model` `URa`/`wyp`/`W4r`/`I0v G4r`**：已按官方 C0v 门落地。subscriber / firstParty PAYG / gateway **不**硬编码 URa；anthropicAws 与真 3P 才插入；wyp 只用 `ANTHROPIC_DEFAULT_FABLE_MODEL`；当前模型是 fable 时 rewrite Iyp 同行或 W4r URa。G4r 用官方 `fht`（`includes("claude-fable-5")`），与 Iyp 正则分开。print/SDK `stepFamilyAliasToAllowed` 的 fable 走 `XNn`，不再掉进 haiku else。不 invent `H0v` Fable (disabled)、`$Ra` inject、`OPENAI_DEFAULT_FABLE_MODEL`、W4r 内 `Nyp` remap、完整 `UNn` catalog 倒序扫描。

## 下一刀

1. **#44 / #56 已搁置**，不进下一刀。
2. Artifact 读面仍无 cobalt host，不 invent `readArtifactForModel` / `ASe`/`UQ`/`fxv`/`J4n`。
3. leftover 停着：`PPi` session/branch · `V1w` · `/config` bvr · `U_c` catalog · `H_a` preamble · storageV5。不 invent。
4. **跨 pack 236 #9**（fullscreen-resize）：Project C 已落 HAVE（`Axc`/`xxc`/`frameSink`）。sticky 默认 OFF。**不要**把 pending 折进 xxc `'tick'`。不折入本 pack changelog HAVE。

## 日志

- 2026-08-24：`npm pack @anthropic-ai/claude-code-win32-x64@2.1.239` → `--version` 2.1.239 · 337672352 · sha256 `0bc1304c…`。changelog 59 条 + probe + 初盘 checklist。
- 2026-08-24：落地 #3 #41 #43 #52 #57（1:1 金标）。
- 2026-08-24：挖轮落地 #6 #7 #31 #32 #53。
- 2026-08-24：继续轮落地 #8 #40 + #51 prompt。
- 2026-08-24：对齐轮落地 #25 + #58 jWe。
- 2026-08-24：继续轮落地 #58 lQ + #12 HAVE 复述。
- 2026-08-24：继续轮落地 #36 G()+CXq config.worktree。
- 2026-08-24：继续轮落地 #22 globstar + #38 HAVE 复述。
- 2026-08-24：继续轮落地 #9 cku + #17 QZs/lNr + #18 Llh + #16 HAVE 复述。
- 2026-08-24：继续轮落地 #49 nuy/ueu + OMo（picker 在 S1 之后）。
- 2026-08-24：继续轮落地 #35 mYe/tTe + oSn 行预算；#14 标 PARTIAL。
- 2026-08-24：继续轮落地 #14 IZg optionWindow + clampFieldRows。
- 2026-08-24：继续轮落地 #30 selection:extend* + S()/z2t。
- 2026-08-24：继续轮落地 #46 e7h + hbo/ros FilePathLink clamp。
- 2026-08-24：继续轮落地 #23 HG/bf parseFrontmatter BOM。
- 2026-08-24：继续轮落地 #42 masked skip history/kill-ring。
- 2026-08-24：继续 24 条 UNKNOWN — 落地 #2 V1y 去 GB + #20 fWv hover + #21 udc impression。
- 2026-08-24：查其余 UNKNOWN — 落地 #1 tWb/eWb 1.1× + #45 invoked_skills reminder + #39 `_ts` title writer。
- 2026-08-24：缺功能按官方补 — 落地 #10 ABS skip + #24 pnh + #27 ZGn/I8r + #34 peek HAVE + #50 DHm/G1w/DEe。
- 2026-08-24：继续轮落地 #33 yvf/Jhf/yln + #19 MTs/MoA。
- 2026-08-24：继续轮落地 #26 Qyf/Qpr/Jyf droppedMousePrefix。
- 2026-08-24：继续轮落地 #51 OHm/Z1w live teammates listing。
- 2026-08-24：继续轮落地 #58 HYb/IWd `sessions/${pid}.${hash}.key`。
- 2026-08-24：#58 写路径对齐 `od` 默认臂（j4e/FDn wx + kw rename）。
- 2026-08-24：#58 写路径补齐 KGo 其余臂（in-place truncate / TY_·kY_ snapshot / exactMode+flush / Jer）。
- 2026-08-24：落地 #47 flo/mlo `hook_exec` + `startup-hook-hold`（SubagentStart/SessionEnd 不包）。
- 2026-08-24：落地 #37 ies hook cwd（originalCwd → projectRoot → homedir / tmpdir）。
- 2026-08-24：落地 #11 Cuy inFlightDrain + #29 JIy vim Esc + #28 PreToolUse defer 同 trace（r1t/Zrp/Qrp/H8f/JNs）。
- 2026-08-24：复挖剩余 UNKNOWN — changelog 字面大多 0，但 CLI 机器找到了。#13 升 GAP（`planModeOnResume`/`y_u`/`XWy`）；#15/#44/#55/#56 写清邻近符号与 0-hit。
- 2026-08-24：落地 #13 `planModeResume`（`YWy`/`QnT`/`y_u`/`XWy`/`__u`/`Ibu`；`qqe`=ExitPlanMode；`KS`=`getDenyRuleForTool`）。HAVE 51 / GAP 1。
- 2026-08-24：复挖 #15/#44/#55/#56。#15 print `xn.some(type==="failed")` 与 tip `hasFailedSdkClients` 1:1 → HAVE。#55 `sourcePath??D.get` 1:1 → HAVE。#44 `Cew`/`JQn` 仍 retry remote 403 → 留 UNKNOWN。#56 只锁 comma-split + fail-closed，host 表/`KFy` 未锁 → 留 UNKNOWN。HAVE 53 / UNKNOWN 2。
- 2026-08-24：#44/#56 搁置（找不到 1:1 改点，不再复挖、不 invent）。239 收口：HAVE 53 / GAP 1 / UNKNOWN 2 parked / N/A 3。
- 2026-08-24：用户要再挖。#4 字面 0 是因为 `iN="synced"`；`R9a`/`I9a`/`kff`/`syncedPluginDirs` 齐，灌目录来源仍云端 → 仍 GAP。#44=`En_` CRI webhook `precheck`+`x-should-retry:false`（网关）。#56=`KFy`+`Ohu` 只排 `api.anthropic.com`。#44/#56 继续搁置。
- 2026-08-24：落地 #4 CLI（`iN`/`I9a`/`kff` `e.synced`/`lQt`+`loadSyncedPlugins`/`D9u.synced`；enable/disable 走已有 `plugin@marketplace`）。**不** invent 下载面。HAVE 54 / GAP 0。#44/#56 仍搁置。
- 2026-08-25：SendMessage 补 239 leftover（非 changelog 新条）：`E0m`/`FTl`/`KRw`/`BEm`/`Kwe`。无组队时 `message` 仅 string；`to` describe 用 ListAgents 名；prompt 去掉 `*`/scheme 行与 “no busy”；`summary` 不再 required；空串在 uds early-return 之前拒。**不** invent summary 自动填、Qei、cloud hop。测：`sendMessage.schema.239.test.ts`。
- 2026-08-25：Agent/team leftover（非 changelog 新条）：`MQA`/`V2y` 隐式单 team（`session-${id.slice(0,8)}`）；`team_name` deprecated ignored；name `B4f`+reserved `main`；spawn 只读 `teamContext`；官方两句 prompt。**不** invent 全员 `isolation: remote`、AppState `teammateColors`、重写 KAIROS `assistant-*`。测：`sessionTeam.239.test.ts` / `implicitTeam.239.test.ts`。
- 2026-08-25：leftover 续挖落地 `Tno` + built-in `web-fetch`（`bpr`/`WIe`/`aAi`/`Iq`/`Gji`/`mSl`）。schema 永远 `worktree|remote`（availability is gated）；prompt remote 句改 `Tno`；失败文案 `Cannot launch cloud agent:`。**storageV5 按用户不接**。测：`webFetchAgent.239.test.ts` / `agentIsolationRemote.239.test.ts`。
- 2026-08-25：leftover 落地 `GIe`/`Cgr`/`snt`/`kgr`/`dpw`/`_tm`/`_pr` + WebFetch `tpw` raw wrap。`runAgent` `y=!0`；Lto 只加 `availableTools`+`webFetchReadmissionAllowed`+`rAi`；hook deny 拼 `_tm`。测：`webFetchAdmission.239.test.ts` / `webFetchRaw.239.test.ts`。
- 2026-08-25：1:1 补先前未落的 leftover：`Q2r`/`BH`；`YHp`/`eC`/`KHp`（`tool.prompt` 传 `model`）；`dpw` main 臂走 `getMainThreadAgentType`（官方 `OB`）；`oSi` + Lto `contextLayers`/`frozenCommandDenies`（Skill `b` / slash `replaceCommandRules:true`）；`El`/`Mht`/`Gp`/`RJr`/`spw` `_pr` fail。不 invent `readArtifactForModel` / attachments。测：`confusableTagScrub.239.test.ts` / `webFetchPrompt.239.test.ts` / `artifactUrl.239.test.ts` / `overlayForkedCommandAppState.239.test.ts`。
- 2026-08-25：Lto leftover 收口 `isMeta` / `a()`=`iXe`+`bft` / `g`+partial strip / `SXr` / Skill+slash `recordInvocationOnSuccess`→zqe `onTerminalSuccess` / `override.readFileState`。不 invent `n4t`/`HJr`/`shareFileHistory`。测：`prepareForkedCommandContext.239.test.ts`。
- 2026-08-25：SendMessage leftover 收口 `Qei`/`ELe`/`Yc` + `g0m`/`h0m`。`validateInput` 走官方空 to / 空 bridge|uds target / UNC·NT 必须是 named pipe；`call()` 在 explicit `bridge:` 与 resolved `bridge-session` 上 `ao()==="firstParty"&&!fa()`。测：`sendMessage.qei.239.test.ts`。
- 2026-08-25：`/model` leftover 收口 `URa`/`wyp`/`W4r`/`G4r`/`Iyp`/`kci`/`Rci`/`Cci` fable + C0v 门 + I0v `G4r(s)` pin。测：`fablePicker.239.test.ts`。
- 2026-08-25：print/SDK leftover：`L4` 在本地 host 上 fable 走 `XNn`（不再 haiku else）；G4r 对齐 `fht`；suggestion 加 `fable`/`fable[1m]`。不 invent `UNn` 倒序 catalog。测：`printSetModel.239.test.ts`。
- 2026-08-25：#28 review 修：Y 为 `deny > defer > ask > allow`；toolHooks latch 官方 `c`/`u`，流结束才 yield defer。测：`preToolUseDefer.239.test.ts`。
- 2026-08-25：print 空输入门 1:1 官方 `!te&&!Q&&!U`。`Q`=`$2l` 尾 1MB（不接 storageV5 `RQi`）；`U`=SessionStart `pendingInitialUserMessage`；resume/continue 空 stdin 走 *No deferred tool marker found…*。`JNs` 只吃 constructor `deferredToolUse`。`M2l`/`utn` 保留 `$2l` toolUseID。测：`preToolUseDefer.239.test.ts` / `scanDeferredToolUse.239.test.ts`。
- 2026-08-25：#58 receipt/idle 走官方 `T4r→Tli→cmp`：`sendUdsControl`（ELe + IWd/mti + `noFollowSymlink` + `expectPeerPid`）。hold-receipt / `peer_idle_notice` 不再 `readUdsCapabilityToken`+`sendUdsMessage`。不 invent 官方 `H_a` preamble、flush 存 peer pid、`sendToUdsSocket` user-send `noFollowSymlink`。测：`sendUdsControl.239.test.ts`。
- 2026-08-25：#58 leftover 五条：b1e/mBr 清扫走 `fBr`+`b7`；inbox `authRequired=requireAuth??mti()`（Unix 不强制、key publish 失败 warn 降级）；`isPeerAlive`=`ump` 250ms 裸 connect；`sendToUdsSocket` 改 `ELe`；SendMessage `Xen→Jio→VEt` + Zio/Kwm/`claimed_locally`。不 invent 官方 `H_a` 预导行、SendUserFile 跨会话寄文件。测：`registrySweep.239.test.ts` / `isPeerAlive.239.test.ts` / `jio.239.test.ts`。
- 2026-08-26：leftover `tengu_willow_crate` REPL diff tab（`P6e`/`h0c`/`nhu`/`Ocs`）。GB 关 / 非 fullscreen / 非 git / <110 列 → 仍走 `DiffDialog`。面板只接 `useDiffData` uncommitted。**不** invent `PPi` session/branch、`V1w`、`bvr`、`U_c`、`H_a`、storageV5。测：`replDiffTab.239.test.ts` / `diff.239.test.ts`。
- 2026-08-26：跨 pack **236 #9** 以 **239 SEA** 复核锁定 invent-ban（`Axc`/`q$0=100`/`uyn=1e4`）；tip-equiv≠HAVE；真 1:1=Project C。见 `cross-pack-residuals.md` / `official-236-checklist` #9。
- 2026-08-26：邻 pack 236 `#6` 收口：`LFh=14` chrome + `sgM` 动态槽；固定 `maxVisible=10` 已删。无 XKl → `ngM=0`。测：`modelPickerVisible.236.test.ts`。
- 2026-08-29：诚实度对齐 checklist — 桶从 HAVE 54 / PARTIAL 0 改为 HAVE **52** / PARTIAL **2**（`#4`/`#13`）。不抬 HAVE。08-26 日志里 236 #9 invent-ban 已被 Project C HAVE 取代（见 `official-236-checklist.md`）。
