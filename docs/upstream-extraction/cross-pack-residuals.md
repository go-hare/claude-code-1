# Cross-pack residual inventory (go-hare vs densable)

> 更新：**2026-09-02** — tip **densable 2.1.239 leftover** + npm **2.7.46**。  
> 原则：densable-first 1:1；**不 invent** VSCode/cloud-only；**不 auto commit/push/bump**。  
> 分 pack 金标仍以各 `official-*-checklist.md` / board 为准。README / README_EN 计数已按本文件纠偏（229 `#12` tip=`localhost`；232 PARTIAL 2；236/238 本机 HAVE；239 工作树）。  
> **口径（钉死）**：同缺 / 无函数体 / 官方 opt-in / tip=现行官方 → **已对齐**，**不是 tip 缺口**，**禁止**再写进「还差什么」。  
> **过期勿再当 open**：08-27「#11/#27/#4/#13 → PARTIAL」、08-29「239 PARTIAL 2」、09-01「#25 保持 generation gate」、把 invent-ban 表当成待办。

---

## 0. 当前 tip（239）

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

**交付面（唯一还差）：** 工作树大量未提交源码 + 全量 `precheck` 未跑。不是再挖 229–239 changelog。

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
下一刀: 提交切片 + precheck；勿重开 212–235 invent 表
```
