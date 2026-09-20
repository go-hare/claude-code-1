# Cross-pack residual inventory (go-hare vs densable)

> 更新：**2026-09-20** — tip **densable 2.1.247**（git）+ npm **2.7.49**。246 金标 **HAVE 59 / GAP 0 / UNKNOWN 0 / N/A 2**。**247 已入库**（HAVE 31 / N/A 2），未 bump。RC torn-pair / auth-revive 已接。  
> 原则：densable-first 1:1；**不 invent** VSCode/cloud-only；**不 auto commit/push/bump**。  
> **09-15：`src/utils/storageV5/` 已全面语义化** — 该模块 219 个 `leftover*` 符号全部改成描述性英文名，官方最小化名 + 偏移移入各符号的 doc comment（`densable leftover \`Ur\`=\`R6c\`=\`Wn\` @207286302` 这种形式，156 条）。**在该模块内按 `leftoverXx` grep 已经找不到东西，改按 doc comment 里的官方名搜。** 动因：`leftover` 前缀会把仅大小写不同的官方名（`ne` vs `Ne`）塌缩成同一个标识符，已经造成过一次 TS2440，另有 `Ke`/`Dt` 两对跨模块同名是同类隐患。模块外（`sessionNameJobSidecar.ts` 的 `leftoverRv`、`sessionPersistenceSync.ts` 的 `leftoverR`）仍是旧惯例。  
> 分 pack 金标仍以各 `official-*-checklist.md` / board 为准。README / README_EN 计数已按本文件纠偏（229 `#12` tip=`localhost`；232 PARTIAL 2；236/238 本机 HAVE；239 leftover 已进 **2.7.47**；243+246 已进 **2.7.48**，全平台重编 **2.7.49**）。  
> **口径（钉死）**：同缺 / 无函数体 / 官方 opt-in / tip=现行官方 → **已对齐**，**不是 tip 缺口**，**禁止**再写进「还差什么」。  
> **过期勿再当 open**：08-27「#11/#27/#4/#13 → PARTIAL」、08-29「239 PARTIAL 2」、09-01「#25 保持 generation gate」、把 invent-ban 表当成待办。

---

## 0. 当前 tip（246）

| 项 | 状态 |
| --- | --- |
| 239 changelog | HAVE **59** / PARTIAL **0** / GAP **0** / UNKNOWN **0** / N/A **0** |
| 239 leftover | willow + `PPi`/`_zS`/`bzS`/`H_s`/`VFf`/`V1w`/`bvr` **HAVE**（leftover 无体符号 = 对齐，见 §2） |
| 236 | HAVE **32** / PARTIAL **0** / N/A **1** |
| 235 | HAVE **15** + analog **3** / N/A **1**（analog = 注脚，不是缺口） |
| 234 | HAVE **45** / PARTIAL **0** / N/A **6** |
| 232 | HAVE **43** / PARTIAL **2**（changelog 账；tip=现行官方）/ N/A **4** |
| 237 | HAVE **3** |
| 238 | HAVE **39** / PARTIAL **0** |
| 240 / 241 | 官方无 bullets。**不**折入 |
| **243** | SEA 已下 · HAVE **49** / PARTIAL **0** / N/A **11** / UNKNOWN **0**。见 `v2.1.243/`。 |
| **246** | SEA 已下 · **以代码为准**。HAVE **59** / PARTIAL **0** / GAP **0** / UNKNOWN **0** / N/A **2**。见 `v2.1.246/`。**不**折入 244 空号、245 glibc。 |
| **247** | **已入库** · SEA 已下。HAVE **31** / PARTIAL **0** / UNKNOWN **0** / N/A **2**（#23 #24 云）。#1 leftover `/config` 行 + `sr` + leftover `/feedback`/`/bug` 命令表 + `jr`/`Dfs`/`Ri`/`Nfs` + `ot` `ye`/`ogr`/`W` + `$t`=`Lwc` + `Lfs` `DE` leftover-locked。`ye`/`Ht`/`Jt` 无体 = 对齐。#8 `lre` leftover 已接（不 invent MB/stderr cap）。#19 `Yjo` aside。#25 `n0c`/`k` 打印。见 `v2.1.247/`。**未 bump（npm 仍 2.7.49）。不**折入 248+。 |

**交付面：** 243 + 246 已进仓（npm **2.7.49**）。247 已入库，**未 bump**。246 HAVE **59** / UNKNOWN **0** / N/A **2**。2026-09-08 升 #5 / #7 / #8 / #35 / #36 / #37 HAVE；#45 HAVE（09-15b）。#7 勿 invent `markStartupDialogBlocked`。#55 勿 invent 全文 auto-continue。窄 HAVE 勿按 changelog 扩写。#35 勿在 stream/`Owe` 合成 `toolu_`（修在 Messages UI）。#45 勿 invent JWT parse。#37 勿把空 `{}` 当 corrupt。#30 勿镜像 bash-path Te()。#46 勿 invent 切片。#52 勿 invent 全局 Q3e skill key。#40 勿 invent 交互 `my` / 空 `iX`。RC persist / `scan_torn` 官方同形；勿 invent `sK` / `Qtt` / `L`·`te`·`_e`。Desktop `useRenderInput("ToolGroup")` 同缺。勿重开 212–243 invent 表。

---

## 1. tip 产品缺口

**无。** 229+ changelog 本机路径按工作树已收口。

232 桶 `#14`/`#43` 仍标 PARTIAL = **232 changelog 被 233 收回的账**，tip 对现行官方 1:1（产品不调 helper）。**不是 tip 缺口，勿复活。**

---

## 2. 已对齐（禁止当「还差 / 未 1:1」）

下列全部是 tip=现行官方或同缺。**不要**再列进待办、不要喂 agent 去「补」。

| ID | 事实 | 判定 |
| --- | --- | --- |
| **229 #12 / 231** | 229 曾落 `127.0.0.1` 主机名；**tip = 231 `localhost`**；listen `127.0.0.1` | HAVE（勿回写 229） |
| **232 #14 / #43** | 产品不调 Cygwin/`< file` helper（233 回滚） | tip 1:1；232 账 PARTIAL |
| **235 #11/#12/#13** | 产品路径在；changelog≠SEA / 无 235 producer / sidecar≠argv0 | HAVE (analog) |
| **236 #25** | `Bqn`/`Wsv` 30→60→120 + 空 deferring re-arm。**2026-09-02 已删 tip invent `goalIdleArmGeneration`**；cancel=`clearTimeout` only | HAVE |
| **236 #10/#18/#24/#27/#28/#29/#31/#32** | 本机合同已落 | HAVE |
| **239 #4** | `@synced` + hydrate；默认 `CLAUDE_CODE_SYNC_PLUGINS` OFF = 官方 opt-in | HAVE |
| **239 #13** | 本机 `Jqy` continue 无 `y_u`；resume 有 `y_u`。无云端 E2E ≠ 缺口 | HAVE |
| **239 #44 / #56** | `En_`/`Ohu`/`G1s`；官方无本地 cri writer / `KFy` hosted | HAVE（同缺） |
| **239 leftover `uea`/`HR0`** | leftover 只有调用点、无函数体；抽出金标（`snapshotSequence` + delay 0）已接 | HAVE |
| **xCs `monitor_ws`** | 金标无 detail case；list + x | HAVE |
| **storageV5 `Rc`** | `getProject().appendEntry` 已接；形参 `_storageV5` 对齐调用形。不 invent `$t()`/`tn()` | HAVE |
| **I5 Windows bypass** | win32 无 uid → fail-open = densable | HAVE |
| **223 #3 teleport** | 无 cloud session 产品面 | invent-ban（非 tip 缺口） |
| **238 identity_changed** | 文案/sd/_u 在；classifier 只 emit `signed_out`（leftover #3 禁 invent owner-pin） | HAVE |
| **raccoon `/compact`** | GB 默认 false = 官方 | HAVE |
| **GoalProposal** | payload 只有 `{condition}`；`stillWorking` 现场读 busy host（非死 payload 字段） | HAVE |
| **246 #18 `FLn` / `_ue`族** | `FLn`=`Ut`；`a0n` 已接。`_ue` @212712253 有体；`$Me`/`nx`/`Vyn`/`Gyn`/`rp` = barrel 别名 `Ir`/`ie`/`Jo`/`Bo`/`ve` @204973621，本地 leftover 已 1:1。**非**无声明 | HAVE（09-16 leftover 分类拿掉） |
| **246 #49 `fe`/`Z`/`bo`** | `fe`/`Z` 是 hook 本地 ref（非导入），`bo` 已定位。名字已接，本条无剩余真洞 | HAVE（09-16 leftover 分类拿掉） |
| **246 #55 `ae`** | `ae`/`Ze` 体在；官方宿主是 turn-tail `ze()`（非 query/GJn）。本地 `analyzeTurnTail` 已接。勿 invent 塞进 query | HAVE（09-16 leftover 分类拿掉） |
| **246 #16 `Ur`/`Ol`/`Ma`** | barrel `R6c`/`S6c`/`U6c` = `Wn` @207286302 / `$n` @207286901 / `Yn` @207288501；本地 `atomicWriteStagedRename`/`inPlaceWriteOpenTruncate`/`symlinkAwareAtomicWrite`/`dispatchDisciplineWrite` 已按体重搬 | HAVE（09-16 leftover 分类拿掉） |
| **246 #16 `Xa`族** | `Xa`/`_y`/`Ql` `listRecursive` + `Fc`/`ds`/`pf`/`yf`/`kf`/`Ds`/`km`/`Jf`/`Zf` leftover-wired。不编 `Failed` 空壳 | HAVE（09-16 leftover 分类拿掉） |
| **246 #16 `Fb`+`Lt` / `Sb`/`vd`** | lease/subscribe leftover-wired（`storageLease.ts` / `storageSubscribe.ts`） | HAVE（09-16 leftover 分类拿掉） |
| **246 #16 `Ee` 的 `Ze(t)`** | `import{basename as Ze}from"path"` @207234005；本地 `basename(globalConfigFile)` 已接。旧「撞名/仍 null」作废 | HAVE（09-16 leftover 分类拿掉） |

---

## 3. 有意本地 delta（产品，不是漏 port）

| 项 | 说明 |
| --- | --- |
| **Multi-API** | OpenAI / Gemini / Grok |
| **`/poor`** | 降 token |
| **Feature flags** | runtime 无 env → false；build/dev **42** ON |
| **UDS 单 token** | densable dual peer/child；本地单 token |
| **N9 remote effort** | 无 remote 改 effort 协议 |
| **`tengu_ccr_bridge`** | 不默认 true |
| **VSCode / gateway / Desktop** | invent-ban 宿主面 |

---

## 4. 快速对照

```text
还差 = 未提交 WT + precheck
不差 = 同缺 / 无函数体 / opt-in / tip=现行官方 / analog 注脚

#25: 已删 goalIdleArmGeneration（09-02）
229 #12: tip=231 localhost（勿回写 127.0.0.1）
下一刀: 246 HAVE **59** / GAP 0 收官，走 precheck + 进仓；RC torn/revive 已接；persist / scan_torn 官方同形；勿 invent sK / Qtt / L·te·_e

09-15c #47/#48 → HAVE；09-15b #28/#31/#45 → HAVE；UNKNOWN **0**
09-16 leftover 分类拿掉，四条升 HAVE：
  #18 FLn/Ut/a0n + _ue/$Me… = 有体，本地已接（别名非无声明）
  #49 qb       = `qb(){if(!Po())return;return}` 官方空壳；fe/Z/bo 名字已接
  #55 ae/Ze    = 体在；宿主 analyzeTurnTail / ze()，不塞 query
  #16 Ur/Ol/Ma = Wn/$n/Yn 已按体重搬
  #16 Ze(t)    = path.basename，本地 kind-copy 已接
  #16 Xa族     = Xa/_y/Ql + Fc/ds/… leftover-wired；不编 Failed 空壳
  #16 Fb/Sb/vd = lease/subscribe leftover-wired
```
