# Alignment board — densable 2.1.251

> **开 pack** · 2026-09-22 · SEA **已下** · changelog 是索引  
> HAVE **17** / PARTIAL **44** / GAP **1** / UNKNOWN **3** / N/A **6**  
> tip：npm **2.7.51** = 248 · **只盘 251** · 不折入 249/250/252  
> 计数以 `official-251-checklist.md` 为准。扫员单独结论不升 HAVE。函数体未锁不升 HAVE。

## 桶

| 桶 | # |
| -- | - |
| HAVE | #5 #9 #12 #16 #17 #18 #19 #32 #36 #39 #40 #52 #56 #62 #65 #67 #68 |
| PARTIAL | #1 #2 #4 #6 #7 #8 #10 #11 #13 #15 #20 #23 #24 #25 #26 #27 #28 #29 #30 #31 #33 #34 #35 #37 #38 #41 #42 #43 #44 #49 #50 #51 #53 #54 #55 #57 #58 #59 #60 #61 #63 #64 #66 #69 |
| GAP | #3 |
| UNKNOWN | #22 #46 #48 |
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
