# Alignment board — densable 2.1.251

> **开 pack** · 2026-09-22 · SEA **已下** · changelog 是索引  
> HAVE **65** / PARTIAL **0** / GAP **0** / UNKNOWN **0** / N/A **6**  
> tip：npm **2.7.52**（#13 GMt 已发）· leftover pack 已合 main `043891e2` · **只盘 251** · 不折入 249/250/252  
> 计数以 `official-251-checklist.md` 为准。扫员单独结论不升 HAVE。函数体未锁不升 HAVE。

## 桶

| 桶 | # |
| -- | - |
| HAVE | #1 #2 #3 #4 #5 #6 #7 #8 #9 #10 #11 #12 #13 #15 #16 #17 #18 #19 #20 #22 #23 #24 #25 #26 #27 #28 #29 #30 #31 #32 #33 #34 #35 #36 #37 #38 #39 #40 #41 #42 #43 #44 #46 #48 #49 #50 #51 #52 #53 #54 #55 #56 #57 #58 #59 #60 #61 #62 #63 #64 #65 #66 #67 #68 #69 |
| PARTIAL | — |
| GAP | — |
| UNKNOWN | — |
| N/A | #14 #21 #45 #47 #70 #71 |

## 并行初盘

1. changelog 71 条已落 `changelog-2.1.251.md`。  
2. 四路本地扫已落：`scan-251-a.md`（#1–#18）、`scan-251-b.md`（#19–#36）、`scan-251-c.md`（#37–#54）、`scan-251-d.md`（#55–#71）。**扫员标的 HAVE/GAP 不进桶**。  
3. SEA 已下：`%TEMP%\official-251\package\claude.exe` **217360032** bytes，`--version` **2.1.251 (Claude Code)**。六路剥体已齐：`gold-251-a.md` … `gold-251-f.md`。桶已按 gold × 本地扫回写：GAP 37 / PARTIAL 14 / UNKNOWN 20 / HAVE 0。  
3b. 动工只改有函数体的 GAP/PARTIAL。UNKNOWN 20 条不动（未剥或 STRING-ONLY）。不 invent #22 quiet notice、#46 重绘、#70 #71 VSCode。  
3c. [Implement 251 hooks usage](3a45314e-84b5-4bae-80ae-f3ba224cc188)：#1 schema/`jw`、#3 gateway `spend_limit`、#4 `oqe`/`whn` 投影已落地，colocated 测试 27 pass。`hdt`/`ydt`/`KSn` 与 live tracker 未接，因为 callee 不在 gold。**桶不变**。  
3d. 2026-09-22 16:39 五路死于 `PROXY 127.0.0.1:12000`，未重派。半成品在树上、未测完：[Implement 251 session RC](42781b40-0e5d-444d-9aa8-31ff0a066cf2)、[Retry 251 path security](ec9751d8-5f37-4dfa-ab65-c5ecccee9321)、[Implement 251 cli bg](9f830ffc-9f14-4fd9-b999-bfd6851e5b1c)。[Retry 251 model effort](cb4225c1-8022-4b6e-95a1-eec8461d5a79) 与 [Retry 251 managed rest](bf101c9c-0721-4992-8984-f5a69b2b4a14) 没有产品改动。  
3e. 本会话补上半成品类型错误，并落地到 PARTIAL（不升 HAVE）：#13 opus-5 effort 钳到 high、#16 idle `result`、#18 policy `disableAutoMode` 退回 default、#19 已是 1M 则藏升级 tip、#25 `.superseded-<ts>`、#36 `TERM=screen` 不发 italic、#39 `densableUVu` 对上 `Qo`、#42 bg/teammate 不弹 auto default nudge、#44 禁用文案用命令名、#56 `/radio`、#58 子代理模型 env 降为默认、#59 认不出的模型拖车为 Claude Code、#62 分析开关改看 `gatewayAuth()`。  
3f. [251 cli bg gaps](f7229b62-4889-40a9-8dd4-4c764b85ac84)：#33 daemon 启动走 `z()`/`L()`（结果分支 callee 不在 gold）、#34 启动解析丢掉 `\0` 目录（权限更新与 workspace 校验未接）、#37 帮助文案对上 `Lr`/`jr`、#41 非 exec 派发写 `urr`、bg 会话读 `oEn`（`awn`/`Yp` 不在 gold）。四条留在 PARTIAL。测试 24 pass。  
3g. [251 model effort gaps](f78693a4-ef06-44ef-9226-6d41cbffcf64)：#60 非 usage-based Enterprise 默认走 opus（`wo().state` 与 Bedrock/Vertex 的 `aw` 未接）、#61 `/effort` 按模型写入 `modelSettings`。两条留在 PARTIAL。测试 27 pass。`tsc --noEmit` 通过。  
3h. [251 managed rest gaps](c10eb4cc-25fe-4154-b0d2-22efde81291f)：#30 Windows `taskkill /T /F`、#31 $0 额度问管理员、#49 schedule 的 MCP 不能挂 routine、#50 descendant 用 `K`、#53 宿主托管且有 model id 时跳过 profile 发现、#54 审批框列变更键、#67 敏感自定义头要审批。七条留在 PARTIAL。新测试 30 pass。  
3i. [251 session RC gaps](838bd0aa-5d31-4f45-beb5-2e0f41a5c5c1)：#2 工具帧、#23 reconnect 补救、#24 无 id assistant 补 `message.id`、#27 空 catalog 重读、#29 非 request 等 70s、#35 `copiedVia`、#55 `query.ts` 墓碑重试。七条留在 PARTIAL。新测试 33 pass。  
3j. 路径安全那路没有产出。#6 #7 #10 树上已有实现，改到 PARTIAL。#9 打开 `scriptPath` 之前先核对 cwd 或已添加目录，校验失败不读文件。#1 `hdt`/`ydt`/`KSn` 与 #3 空窗 `HPe` 的函数体不在 gold，仍是 GAP。  
3k. 对着已锁函数体升 HAVE：#19 `n`/`HK`/`ky`（已是 native 1M 则升级 tip 为 null）、#39 `Qo`/`or`（整数特殊变量非纯整数不自动放行）、#56 `/radio` 的 `call` 只打开 https://clau.de/radio。其余 PARTIAL 的金标函数里还有未接分支，不升。  
3l. 六路再剥（只写 gold，不改桶）：[Peel 251 unknown local](88fe9834-c1c9-4302-aa5c-308df3347318) `gold-251-g.md` #11 #15 #20 #28 #32 #43 #52 #64 #65 #68；[Peel 251 unknown skip](d39e1397-517f-485b-9823-b7a9ffca1af8) `gold-251-h.md` #14 #17 #21 #22 #45–#48 #70 #71；[Peel 251 gap callees](851d1064-c917-462e-8027-ebc850a4c716) `gold-251-i.md` #1/#3 被调用函数；[Peel 251 partial path](00c59a25-8421-4af1-aa1e-9aa69f4b1759) `gold-251-j.md` #2 #4 #6 #9 #10 #16 #18；[Peel 251 partial cli](dceab3ee-ec42-41b7-8a51-a8fb6d7a9eba) `gold-251-k.md` #25 #27 #33 #34 #35 #36 #41 #42 #44 #51；[Peel 251 partial model](54d55199-bab3-4c72-97f0-8da11143bf09) `gold-251-l.md` #53 #55 #59–#63 #67。  
3m. [Peel 251 partial model](54d55199-bab3-4c72-97f0-8da11143bf09) 已落 `gold-251-l.md`，点名的被调用函数都是 **BODY**。#53 `NU`/`ME`/`gl`；宿主旗标下 bedrock `S`/`F`、vertex `R`/`U`、mantle `B` 返回 `[]`，`zje` 返回 `undefined`。#55 `CAt`/`x0e`/`OS`/`qo` 无 Bedrock/Vertex/Foundry 分支。#59 `AVt`。#60 `wo`/`pbr`/`aw`。#61 `G3` 不含 `max`。#62 `Zq` 整段。#63 `ign` 整段 REST。#67 `Rn`/`$Kt`/`Cn`。桶仍是 PARTIAL，本地还没对上这些体。  
3n. [Peel 251 gap callees](851d1064-c917-462e-8027-ebc850a4c716) 已落 `gold-251-i.md`，点名的 #1/#3 被调用函数都是 **BODY**。#1：`Osn`/`Lsn` 等插件注册，`z_` 是 `async function*`（`Xxt`→`Qxt`），`Hye=30000`，Kle/yEt 是 `Ln` 单例。#3：`HPe` 是 `pm.limitsObserved`，空窗句已在 `Dl`（间隔号是 U+00B7）。#1/#3 仍是 GAP：本地没有 `hdt`/`ydt`/`KSn` 运行时，空窗仍恒藏。  
3o. [Peel 251 partial path](00c59a25-8421-4af1-aa1e-9aa69f4b1759) 已落 `gold-251-j.md`。#2 #4 #9 #16 #18 缺的被调用函数是 **BODY**。#6 `/proc/self/fd` 祖先循环 **MISS**（`ao` 只跟用户路径）。#10 `E2t` 有单次 `readlink(/proc/self/fd/${fd})`，祖先循环同样 **MISS**。不 invent。桶仍是 PARTIAL。  
3p. [Peel 251 unknown skip](d39e1397-517f-485b-9823-b7a9ffca1af8) 已落 `gold-251-h.md`。#17 `Ce` **BODY**（`from` 是 name/id）→ **GAP**。#14 Desktop `call` **BODY** → **N/A**（不 invent Desktop）。#21 **MISS**、#45 云 `V_e`/`wT` **BODY**、#47 **MISS**、#70 #71 **MISS** → **N/A**。#22 #46 #48 仍是 STRING-ONLY / UNKNOWN。  
3q. [Peel 251 unknown local](88fe9834-c1c9-4302-aa5c-308df3347318) 已落 `gold-251-g.md`，十条都是 **BODY**。本地都有沾边实现，升 **PARTIAL**，不升 HAVE。#11 `pte` 未接；#15 不是 `iCe`；#20 无 `/status` Profile 行；#28 只看 `$TMUX`；#32 本地还认 `*.gitlab.com`；#43 `Zor` 未逐行对；#52 本地是 U+FFFD 不是 `fr`/`An`；#64 读路径未拒 `nlink≠1`；#65 未对 `Vd`/`jx`/`G$`；#68 本地 `N` 只剥 tracing。  
3r. [Peel 251 partial cli](dceab3ee-ec42-41b7-8a51-a8fb6d7a9eba) 已落 `gold-251-k.md`。#25 `dpe` 全段 + `DVt`/`HA` 是 lutimes/rename 导入；#27 `$Y`/`fke`/`zS`；#33 `rNt`/`_`/`g`/`J`；#34 `lr`/`mbe`/`gbe`/`zk`；#35 `ZW`；#36 `jJn`；#41 `awn`/`Yp`；#42 `oc`；#44 `n`→`Tie`→`TG`（无 `/feedback` 改名）；#51 `dKe`/`kr`/`Ld`/`Iln`。十条仍是 PARTIAL。  
3s. [Align 251 Ce sender](f245e8ba-79c4-4e64-aaa5-240152e097aa) 对上 `Ce`：`from` 是 name/id，`agentType` 只当 `local_agent` 的 `displayName`。信封用 `.from`。#17 → **HAVE**。  
3t. [Align 251 query](0e48bd77-fb0c-4c49-b6dd-def417dc329c) #11 接上 `pte` 的 `empty_text_block`，nudge 带 `turnCompanion`。#55 接上 `CAt`/`bjn`、`qo`、`x0e`；`OS` 未 invent。两条仍是 PARTIAL。  
3u. [Align 251 model l](f4d96ae3-c5ba-4007-a58a-4d0ecc8e129f) #67 `Rn`/`$Kt`/`Cn`/`Tn` 对上 → **HAVE**。#53 旗标空列表是 stub；#59 缺 `ZO`→Claude；#60 缺 `UJ()`；#61 确认已按模型写，`p5e` 未对；#62 多 `NODE_ENV===test`；#63 缺 review/`Accept`。这六条仍是 PARTIAL。  
3v. [Align 251 hooks usage](38800d73) #1 运行时已接 `/model` 与 print（`KSn`/`Ewe`/`Osn`/`Lsn`）→ **PARTIAL**。`gRn` 空、`cre`/`hJ` 无 Bedrock `_I`、`pEt` 是 randomUUID、`ask` 当 no-switch。#3 `HPe`=`pm.limitsObserved` 本地 ABSENT → 仍 **GAP**，不 invent。  
3w. [Align 251 cli bg](dbcda97e) 与 [Align 251 gold-g](42aeff82) 半成品已在树。#32 `X3` 精确 host、#52 `Bfe`/`An`/`fr`、#68 `N` `vyr` → **HAVE**。#15 `iCe`、#20 Profile 行、#27 `$Y`/`fke`、#28 `-S`、#33 ctty outcome、#34 `\0` drop、#35 `ZW`、#42 `oc`、#43 `Zor`、#51 `dKe` → 仍 PARTIAL。  
3x. 本会话接 leftover：#36 `jJn` 进 `StylePool.intern` → **HAVE**。#41 spawn 走 `awn()`。#64 读路径过 `XX`。#65 plugin/LSP 等 draft，effort 走 `G$`。#41/#64/#65 仍 PARTIAL（`gP`、gold `V`/`vt`、zIr chrome）。  
3y. [Align 251 AVt ZO](e8c1c595) #59 接上 `ZO`→`Claude`。`BZn` 第一臂与完整 `rDt` 未接 → 仍 **PARTIAL**。  
3z. [Align 251 lyr idle](9a13f950) #16 `lyr`/`ce`/`$e`/`xP` 对上 → **HAVE**。`IMe` 的 `xP(summary)` / `e5e` 未接。  
3aa. [Align 251 ign REST](40a79dfa) #63 接上 `Accept` / review / etag。fork remap、`Hi()`、token cache 未接 → 仍 **PARTIAL**。  
3ab. [Align 251 Iln view](07e67e73) #51 `Iln` 进 PromptInput。REPL 仍内联 viewed-task → 仍 **PARTIAL**。  
3ac. 本会话 leftover：#62 `Kh` 去掉 `NODE_ENV==='test'`、#40 `Oo` 复制 SKIP_*、#9 `qhn`/`Oo` 打开前 → **HAVE**。#13 非 SJn 不再 throw，`Vm`/`d6e` ABSENT → 仍 PARTIAL。#38 poll 无 `startupFailure` 字段，不 invent。#4 `xhe`/`Yen`/`Ven` 绑定未剥、#41 `gP` callee、#27 `Zv`、#61 `deterministic` ABSENT。Workflow 8 路死于当前进程仍继承 xhigh throw。  
3ad. 主线程续 leftover：#12 `kgn` 走 `Uht`=`isAutoDefaultLaunchEnabled`、#65 REPL `jx`/`Vd` 当 chrome → **HAVE**。#13 `d6e` 解析已接，`Vm` 调用点仍 ABSENT。#18 `Qan`/`hM`/`o5` 已接，不升 HAVE（`iJt` 整段未逐行）。  
3ae. #41 `gP`/`f6e`：无 host 不弹框、不 abort（`--bg`）。`G5`/`Xpe` ABSENT → 仍 PARTIAL。#4 `Yen`/`Ven`/`x6e` 绑定未剥。#27 不用整份 marketplace cache 当 `Zv`（会放过坏 source）。  
3af. 1:1 leftover：#18 `Bdt`/`BFt`（plan+stash、restore、`auto_gate_denied`、清 availability）→ **HAVE**。#5 顶层 `claude respawn`=`cEr` → **HAVE**。#13 `mechanical` 接到 builder，无机械调用点 → 仍 PARTIAL。  
3ag. leftover pack 合入 main `043891e2`（#13 四文件冲突保留 main 已发版 GMt/`d6e`/`Vm`/`sX`）。#13 → **HAVE**（`GMt` clamp、机械 `sX`、`Du`/`Ge`/`Ln.of`、`i5n` skip `cd`/`hydrate`）。本波对 PARTIAL 有锁金标体的条目 1:1；不 invent #3 `HPe`、#6/#10 `/proc/self/fd` 祖先、STRING-ONLY #22/#46/#48、Desktop/云/VSCode N/A。  
3ah. 续 leftover：#7 `VHt` inline content、#37 `Lr`/`jr` 帮助示例 → **HAVE**。#8 `dropDominatedBetaTracingEndpoint` 已接，非 OTLP/`CLAUDE_CODE_ENABLE_TELEMETRY` 臂未抽出 → 仍 PARTIAL。#11 `stopHookActive` 透传，`thinkingOnlyNudged` 不进 State → 仍 PARTIAL。Grok Chat Completions 加 `store:false`（xAI 超大响应 400，非 251 条目）。  
3ai. batch B：#35 `ZW`/`useMcpCopiedVia` → **HAVE**。#42 pie 不是 `host.extensionsConfig.teammateAgentId`、#44 `wur` 未传 mode/readFileState、#34 `pathInWorkingPath` 大小写归一 ≠ gold `np(...,{caseFold:!1})`、#49 skip-reason 无本地状态 → 仍 PARTIAL。#69 grammar 拆除函数 MISS。  
3aj. 续 leftover：#15 `iCe` REPL 接线、#28 `zue`/`W`/`h` osc → **HAVE**。#42 `#r` 金标 `f_()` 仍跑 `_re`，本地整段 skipped → 仍 PARTIAL。#16 `IMe` `xP(summary)` 已接，`e5e` 无体。#43 `Zor`/`ie` 已接，`ae` persist 未剥。#8/#58/#59/#61/#63/#69 callee MISS。  
3ak. #26 `Fkn`/`Q$` linked-worktree 写放行、#27 `$Y`/`qFe` `Be` 重读门 → **HAVE**。#41 `gP`/`f6e` 已接，`G5`/`Xpe` ABSENT。#31 `uen` 剩余 overage 臂已接，`den`/`Gj` 未剥。#34 `np` 体 ABSENT。#38 poll `startupFailure` schema 未剥。  
3al. #25 `dpe`/`S0e`/`DVt`/`HA` → **HAVE**。#8 非 OTLP/`ENABLE_TELEMETRY` 臂是 prose 映射、callee 无体，不升。#42 `_re` 无体。#1 `gRn`/`cre`/`hJ`/`pEt` hop banned。#2 `san` callee 不在 bridge。  
3am. #29 `sendMcpMessage` `_e=70000`/`rot`/`Rd` allSettled → **HAVE**。#38 `dnt` poll `startupFailure` 已接，CLI `O` 无对等阻塞 poll → 仍 PARTIAL。#55 单次 tengu + tombstone/Blt 已接，`OS` ABSENT。  
3an. #20 `Ztt`/`odn`（过期 Login + 401 三臂）→ **HAVE**。#43 `Zor`/`ie`/`ae`（同 hash 跳过 + consent `mode:384`）→ **HAVE**。#57 exclusive `Nq`/`Dme` 已 1:1，Host `Pvr` wrap 外 → 仍 PARTIAL。#6/#10 独占 O_NOFOLLOW/E2t 已 1:1，`/proc/self/fd` ancestor **MISS** 不 invent。#66 `qe`→sandboxSettings/runtime 已接，`so`/`ro` 未剥满 → 仍 PARTIAL。#38 CLI `O` 仍 ABSENT。  
3ao. #31 `uen`/`mhe`/`wb`/`den`/`Gj` → **HAVE**。#44 `TG`/`n` → **HAVE**。#54 `eAn`/`Oe`/`c5` → **HAVE**。#66 `qe`/`so`/`ro`/`he`/`oo`/`no` + runtime 透传 → **HAVE**。#51 PromptInput `Iln`/`Bpe` 已锁，`tt()` ABSENT → 仍 PARTIAL。#53 host 空 stub 已锁，`ME`/`gl` 不 invent → 仍 PARTIAL。#4 投影已锁，live `xhe` ABSENT → 仍 PARTIAL。  
3ap. #33 `z`/`L`/`rNt`/`_`/`g`/`J` uo switch → **HAVE**。#2 bridge frames exclusive 已锁，nested `vp`/`IN`/`MLe` callees blocked_miss → 仍 PARTIAL。#11 `pte` empty_text_block 已接，`thinkingOnlyNudged` 不进 State → 仍 PARTIAL。#59 trailer AVt/ZO 已锁，`rDt`/`lp` ABSENT → 仍 PARTIAL。#63 `ign` REST 已锁，fork/`Hi` ABSENT → 仍 PARTIAL。#49 skip-reason 无本地状态 → 仍 PARTIAL。  
3aq. #24 stream-json `stampIdLessAssistant*` 合并前补 id → **HAVE**（`aVn` ibn/abn 丢块不 invent）。#38 CLI `O` blocked_miss 无 call site → 仍 PARTIAL。#42 unattended `wt`/`oc`/`f_` 已锁，`_re` ABSENT → 仍 PARTIAL。#30 `ug`/`P` taskkill 已锁，`Fr`/`ir`/analytics stage ABSENT → 仍 PARTIAL。#41 `f6e` nullish host 已修，`G5`/`Xpe` ABSENT → 仍 PARTIAL。  
3ar. #34 `lr`/`mbe`/`zk` null-byte drop → **HAVE**（`np` ABSENT 不 invent）。  
3as. #8 `applyOtelFamilyClaims` 非 OTLP/`ENABLE_TELEMETRY` 臂 + dropDominated → **HAVE**。#50 `RMe` 全分支（K/A/activity/hostInjected）→ **HAVE**。#58 `sY`/`jR` spawn>agent>env → **HAVE**。  
3at. #60 `wo`/`pbr`/`Xbt`/`aw`/`UJ` → **HAVE**。#61 `K`/`G3`/`J` 已锁，`p5e`≠`fn(Xe(Mt))` → 仍 PARTIAL。#64 create/read `O_EXCL`/`O_NOFOLLOW`/nlink 已锁，`V`/`vt` ABSENT → 仍 PARTIAL。  
3au. #23 `qge` 复数补救句（去掉 invent 的 singular 优先）→ **HAVE**。#11 continue bag `Pe.thinkingOnlyNudged:!0` → **HAVE**。  
3av. #51 `wCe`/`Bpe`/`Iln` placeholder → **HAVE**（`tt()` ABSENT 不 invent）。#59 `lp`/`jo` 第一臂 BODY ABSENT → blocked_miss。#61 `Xe`/`deterministic` ABSENT → blocked_miss。#42 unattended gate 1:1，`_re` ABSENT → 仍 PARTIAL。  
3aw. #4 `xhe`/`O6e`/`D6e` live + `oqe`/`whn` → **HAVE**。#53 `Pbt` `await ME(),gl()` + host 空 stub → **HAVE**。#63 `Kfn`/`_ke` 已接，`ugn`/`Hi` ABSENT → 仍 PARTIAL。  
3ax. #1 `cre`/`hJ`/`_I`/`gRn` requestJournal seed → **HAVE**（`pEt`/`Kt`/`we` 仍 ABSENT stand-in）。  
3ay. leftover dig：#42 `oc`/`wt`/`pie`/`f_` + opener 先 skip → **HAVE**（`_re` sibling ABSENT 不 invent）。#55 `CAt`/`bjn`/`qo`/`x0e` + exhausted `OS(ct,A,Li)` gold 体（`!Jh` 短路）→ **HAVE**。#64 Que/XX leaf 已锁，`V`/`vt` ABSENT → 仍 PARTIAL。#57 Nq/Dme/TD 1:1，Host `Pvr` ABSENT → 仍 PARTIAL。#41 `G5`/`Xpe`、#49 skip-reason 态、#59 `lp`/`jo`、#61 `Xe`、#63 `ugn`/`Hi`、#38 CLI `O`、#2 nested、#6/#10 fd ancestor、#30 `Fr`/`ir`、#69 grammar → 永久 blocked_miss / MISS。colocated 23 pass。  
3az. leftover dig **ruthless 复核**（agent HAVE 建议）：#6 `UWt`/`DH`/`ao` + #10 `E2t`/`oht` exclusive 产品臂已 1:1 且 colocated 绿 → **HAVE**。残余 fd 祖先循环是 gold **MISS**（SEA 未实现，与 blocked_miss 缺 callee 不同），不 invent、不压 PARTIAL。#42/#55 本波前已 HAVE，复核保持。拒升：#30 `Fr`/`ir`/stage analytics 仅 call-site；#41 `G5`/`Xpe` 白名单 BODY ABSENT；#57 Host `Pvr` four-arm ABSENT（Nq/Dme exclusive 已 1:1）；#64 disk-output nested `V`/`vt` ABSENT；#49 skip-reason 态袋无 producer；#63 `ugn`/`Hi` BODY ABSENT；#38 CLI 阻塞 poll `O` ABSENT；#2 nested `vp`/`IN`/`MLe` callee ABSENT；#59 `lp`/`dr`/`jo` 第一臂 + 完整 `rDt` ABSENT；#61 `p5e`≠`fn(Xe(Mt))` / `Xe` ABSENT；#69 六语 grammar 拆除仅负扫描、本地仍整包 hljs。→ 仍 **PARTIAL**。无代码改动 / 无 commit。  
3ba. #30 深剥 SEA：`P`/`f`/`ug` 1:1（taskkill + `tengu_bash_tool_kill_error{stage:"taskkill"}`）；`Fr`/`ir`/`Ir` 虽有 BODY，但 runner 类 `treeSnapshot` **全二进制仅 declare/clear、无赋值** → 身份 reap 在 gold 亦死臂。本地 `killSessionProcessTree` 接 `f` analytics；reap 保持 no-op。→ **HAVE**。剩余 PARTIAL 10 条均为 ABSENT callee / 无 producer / grammar MISS。  
3bb. SEA 再剥：#41 `G5`/`Xpe` BODY（`sdkDialogHostActive` / `sdkSupportedDialogKinds`）+ `f6e` 白名单 → **HAVE**。#63 `ugn`（upstream/`pgn` parent + `baseRepoCache`）+ `Hi`=`getProxyFetchOptions` → **HAVE**。colocated fable+prStatus 30 pass。仍 PARTIAL：#2 nested、#38 CLI O、#49 skip-reason 态、#57 Host Pvr、#59 lp/jo、#61 Xe、#64 V/vt、#69 grammar。  
3bc. 续剥落地：#38 `awaitRemoteSessionResult` 接 CLI `O`（`startupFailure&&tengu_linear_brook` 先于 timeout）→ **HAVE**。#59 `BZn` 第一臂 `lp`/`dr`/`jo`/`NJ` → **HAVE**。#61 `p5e` 注释+`getCanonicalName`+`[1m]` strip 对 gold 链 → **HAVE**。#64 `vt` 开后身份复核 → **HAVE**。仍 PARTIAL 4：#2 nested callees、#49 skip-reason 无 producer、#57 Host `Pvr`、#69 grammar 负扫描 MISS。  
3bd. #2 `IN`/`eG`/`no`/`MLe`/`jd` 接 san 助手帧 tool_use_meta + cc-memory 剥 → **HAVE**。#49 `resolveConnectorFetchSkipReason` + we 尾句 + schedule 接线 → **HAVE**。仍 PARTIAL 2：#57 Host `VQt` call（`resolvedHostByToolUseId`/`follow_a_plan` four-arm）未整段搬（sessionState 禁 invent bag）；#69 六语仅 SEA 负扫描、本地仍整包 hljs、无拆除函数 BODY。  
3be. #57：SEA 剥 `resolvedHost*` bag 合法；`chromeCallPermission` 四臂 + `Pvr` `setChromeBinding(context,socket)` + `toolRendering.call`→`handleToolCall`+overrides；`@ant/claude-for-chrome-mcp` 导出 `handleToolCall`/`PermissionOverrides`。colocated 6 pass → **HAVE**。#69 仍 PARTIAL（无 unregister BODY）。  
3bf. #3：`HPe`=`areLimitsObserved`/`pm.limitsObserved`；`isStaleObservation`/`emitStatusChange`/`resetCurrentLimits` 写臂；`Dl` 三臂 `overage→bar` / `HPe→null` / else `Spend limit · shown once your gateway reports one`（U+00B7）；`Usage`/`spendLimitBar` 接线。colocated 16 pass → **HAVE**。GAP **0**。仍 PARTIAL #69；UNKNOWN #22/#46/#48 STRING-ONLY 不 invent。  
3bg. leftover dig #69/#22/#46/#48：SEA `Ec`/`Pwe` 178 键确认无六语 → `cliHighlight` import-time `unregisterLanguage` + supports/highlight 门 → **#69 HAVE**。#22 再剥：`yGt` BODY 仍返回 policy 句，`oe` 仍 `{kind:"error",message:b}`，`quiet notice`=0 → **UNKNOWN**（changelog quiet 无产品臂；本地 `getBridgeDisabledReason` 已有同句）。#46 无 UI-cut 函数 → **UNKNOWN**。#48 `An` 仅 agent-proxy prompt「bare reset / recentRelayFailures」→ **UNKNOWN**（不 invent Bash 结果改写）。PARTIAL **0**。  
3bh. #22 深剥产品臂（changelog quiet 字面 0 但 BODY 有）：init `nt==="org_denied"`→`Xb("policy_denied")`+`W?.("policy_disabled",v_n())`；hook `!ks&&np` log `Init declined by org policy` + informational notice + 关 RC，**不** `failed`/`surfaceBridgeFailure`。本地对齐：`BridgeState`+`policy_disabled`；`initReplBridge`；`useReplBridge` quiet 分支；generic null 不再 invent `check debug logs` error。colocated 5 pass → **HAVE**。仍 UNKNOWN #46（无 UI-cut 函数）#48（仅 An prompt）。  
3bi. #48 官方有完整产品臂（非 Bash rewrite）：`An(port,ca)` README（bare reset + recentRelayFailures 句）+ `xe` short note + `Ept`/`yBt` bag 进 env `<env>` + GET `/__agentproxy/status` 返回 `recentRelayFailures`。本地：`agentProxyPrompt.ts`、`upstreamproxy` 启时写 README/`setAgentProxyNote`、`computeEnvInfo` 注入、`relay` status + onclose 记 failure。colocated 4 pass → **HAVE**。  
3bj. #46 深剥：changelog 字面 0，但 SEA 有 turn 期 UI 减负产品臂——(1) `var Mn=200`（本地错 64）进度 replace 窗；(2) `eBt` BODY（先前误标 ABSENT）`append-or-move-by-uuid`；(3) `Nt()` fullscreen 才走 eBt else append；(4) Ink `aT=16` throttle 本地已有。本地：`EPHEMERAL_PROGRESS_SCAN_WINDOW=200`、`appendOrMoveByUuid`、REPL `isFullscreenEnvEnabled` 接线。colocated 10 pass → **HAVE**。UNKNOWN **0**。  
4. [Peel 251 path security](6063bccd-8b1d-4ad0-a620-e8131d57c4a2) 已落 `gold-251-b.md`：#6 `UWt`/`DH`、#7 `VHt`、#8 `dropDominatedBetaTracingEndpoint`+`N`、#9 `Rst`、#10 `E2t`/`oht` 均为 **BODY**。本地扫仍是 ABSENT，**不进桶**。  
5. [Peel 251 model sandbox](b1448830-6ac1-4579-9265-520d32c2f706) 已落 `gold-251-f.md`：#55–#63、#66、#67、#69 均为 **BODY**。#55 是共用 tombstone（摘录里没有 Bedrock/Vertex/Foundry 分支）。#59 拖车由 `BZn` 拼出 `Claude Code`，字面串命中 0。#63 页脚走 `ign` REST；`gh pr view` 只留在 URL 缓存。#69 六个语言名不在 highlight.js grammar 旁。**不进桶**。  
6. [Peel 251 model teams](8dea6252-994e-4be9-b868-7cd75fbd915f) 已落 `gold-251-c.md`：#12 `kgn`/`Uht`、#13 `ga.effort=Wht`（`Wht="high"`，`bJn` 为 xhigh/max）、#16 `JH`/`IMe` 带 `result`、#18 `Int`→`BFt` `setMode` default 均为 **BODY**。#17 **STRING-ONLY**（`from was the agent type` 命中 0，未见把 `from` 改成地址的函数）。**不进桶**。  
7. [Peel 251 session RC](824dd8e7-cd03-45bb-84eb-3b9700b97139) 已落 `gold-251-d.md`：#19、#23–#27、#29–#31、#33–#36 为 **BODY**。#22 **STRING-ONLY**（`yGt` 仍返回 `kind:"error"`，`quiet notice` 命中 0）。#29 的 `_e=70000` 只在 `rot()` 为 false（非 JSON-RPC request）时武装。跳过 #20 #21 #28 #32。**不进桶**。  
8. [Peel 251 hooks usage](9ec8d5fd-66c2-44ea-ac43-484d6dc8fe4d) 已落 `gold-251-a.md`：#1 `hdt`/`ydt`/`KSn`、#3 `X1e`、#4 `oqe`、#5 `We`/`cEr` 为 **BODY**。#2 **BODY** 但「foreground subagent」不在 `san`/`Ce` 里；工具帧走 `parent_tool_use_id`，嵌套后台写受 `forwardSubagentText` 门控。**不进桶**。  
9. [Peel 251 cli managed](691fa987-8f1c-47d2-b504-958fabbdcd5f) 已落 `gold-251-e.md`：#37–#42、#44、#49–#51、#53、#54 为 **BODY**。#46 **STRING-ONLY**（`re-render` 命中是 pre-rendered / React 文档 / ConPTY / changelog 散文）。#54 `Oe` 在 `c5(changed)` 为真时只列变更键，否则退回整包 `jn`。跳过 #43 #45 #47 #48 #52。**不进桶**。

## N/A（SEA 已剥）

- #14 Desktop `SendMessage` handoff（有体，不 invent）。  
- #21 云宿主初始模型（MISS）。  
- #45 云会话 GitHub 瞬时失败（`V_e`/`wT`，不 invent 云宿主）。  
- #47 安装体积（MISS）。  
- #70 #71 `[VSCode]`（本 CLI SEA MISS）。
