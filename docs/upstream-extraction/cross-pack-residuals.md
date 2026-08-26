# Cross-pack residual inventory (go-hare vs densable)

> 更新：**2026-08-26** — tip **densable 2.1.239 leftover** + npm **2.7.46**。  
> 原则：densable-first 1:1；**不 invent** VSCode/cloud-only；**不 auto commit/push/bump**。  
> 分 pack 金标仍以各 `official-*-checklist.md` / board 为准。本文只记**跨 pack 仍 open** 与有意 delta。  
> **过期**：2026-08-13 稿把 228 当 tip、写「65+ feature ON」「全量 ~310 fail」。现码 `DEFAULT_BUILD_FEATURES` **42** ON（`scripts/defines.ts` / CLAUDE.md）。全量 suite 数以当下 `bun run precheck` 为准，勿再引用 310。

---

## 0. 当前 tip（239）

| 项 | 状态 |
| --- | --- |
| 239 changelog | HAVE **54** / PARTIAL **0** / GAP **0** / UNKNOWN **2 parked**（#44/#56）/ N/A **3** |
| 239 leftover | willow crate REPL diff tab **已落**（GB 关走 DiffDialog；uncommitted only） |
| 236 | HAVE **20** / PARTIAL **12** / N/A **1**（2026-08-26 `#6` `LFh`/`sgM` → HAVE） |
| 237 | HAVE **3** |
| 238 | HAVE **34** / PARTIAL **5**（live E2E / chrome UI / 官方自己也不隔离；不抬 HAVE） |
| 240 / 241 | 官方无 bullets。**不**折入 |

---

## 1. 官方残差（仍 open / invent-ban）

| ID | 条目 | 性质 | 说明 | 建议 |
| --- | --- | --- | --- | --- |
| **223 #3** | cloud session `/teleport` 本地继续提示 | **GAP** / invent-ban | SEA 有 hint；本地无 cloud session 产品面 | 不假造 |
| **234 #35** | profile `/login` | **GAP** / invent-ban | 无官方 login 面 | 不 invent |
| **228 #12** | synced skills ingest | **PARTIAL** | core harden 已齐；无 claude.ai 下载 host | 不 invent ingest |
| **236** | `#4/#7/#10/#11/#27–#29` 等 | **PARTIAL** gold-weak | 有邻近机、无完整 SEA 合同 | 再挖可以，禁止第二套 |
| **236 #9** | fullscreen-resize-message | **PARTIAL** invent-ban | 金标=**239** `Axc`（`nativeHistory`+`tickPump`/`q$0=100`）；tip=`resetFrames`+React；tip-equiv=VML/`columns`/`layoutEpoch` | **禁止伪泵**；真 1:1=**Project C**（另立项） |
| **236** | `#18/#24/#31/#32` | **PARTIAL** gold-false | SEA `found:false` | invent-ban |
| **238** | `#4/#16/#18/#24/#25` | **PARTIAL** stay | 代码合同 1:1；骨架 E2E 不抬 HAVE | 保持 PARTIAL |
| **239 #44/#56** | org-policy webhook / web Bash proxy | **UNKNOWN parked** | gateway CRI / 云 MITM | 禁止本地 webhook / 假 host 表 |
| **239 leftover** | `PPi` · `V1w` · `bvr` · `U_c` · `H_a` · storageV5 | parked | 无本地 host | invent-ban |

**已关闭（勿再当 open GAP）：**

| ID | 性质 | 说明 |
| --- | --- | --- |
| **221 #10** | **HAVE** | API-request null-proto / `hasOwn` / permission map |
| **createSdkMcpServer** | **HAVE** | densable `fVp`；registry plain `{}` |
| **221 #12** large-upload TLS | **DEP-HAVE** | 修在 `@anthropic-ai/sandbox-runtime`；CLI 无独立 locus |
| **236 #6** | **HAVE**（2026-08-26） | `LFh=14` chrome + `sgM` 动态槽；无 XKl → `ngM=0` |

---

## 2. 有意 tradeoff / 本地 delta（不是漏 port）

| 项 | 说明 |
| --- | --- |
| **228 #2 uio** | densable 只拒 exact-cwd / shadow 段 / WindowsApps；允许 `cwd\tools\git.exe` 等。相对 pre-228「拒全部 under-cwd」更松；对齐官方 #2 parent-of-Git。 |
| **228 #12 synced skills** | **PARTIAL**：只 harden core；**不 invent** 完整 claude.ai 下载/ingest host。 |
| **228 #3 `/tui`** | 只 Bxa `--model` pin；**不 invent** 完整 densable `cui`（add-dir / effort / permission-mode）。 |
| **OWNER_ORG handoff (dBe)** | 仅 handoff 带了 OWNER_ORG 才比 org；缺省 ORG 只比 account（有意产品修正）。 |
| **228 #14 ugi** | Vertex/GCP auth **仅 401** 进 cloud-auth cap；**403 不进 cap**。 |
| **AWS GKd/VKd 文案** | 已接线（`formatBedrockAuthErrorMessage`）。 |
| **228 #17 + l8t** | unread gate + Read-deny `errorCode:13`。 |
| **UDS `CLAUDE_CODE_MESSAGING_TOKEN`** | 能力发布成功后才 export；细差：densable dual peer/child token，本地单 token。 |
| **Multi-API** | OpenAI / Gemini / Grok 兼容层（本地产品）。 |
| **Grok `reasoning_effort`** | 本地产品补丁（非 densable）。**禁止**裸 `grok-4` / `grok-4.20` 行。 |
| **`/poor`** | 降 token（跳 extract_memories / suggestion / verification 等）。 |
| **Feature flags** | **runtime** `feature()` 无 env → `false`。**build/dev** 注入 `DEFAULT_BUILD_FEATURES`（**42** ON）。densable SEA 更接近全开。**禁止**再写「本地默认全 OFF」或「65+」。 |
| **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS_CHANNELS\|PUSH\|WEBHOOKS** | **`DEFAULT_BUILD` ON**。非注入环境仍关。TEAMMEM 另有 OAuth + GitHub remote **运行时门**。 |
| **VSCode / cloud-only** | 224 #29/#31、225 #12、229 #30–#32、235 #19、236 #33、239 #59 等 **N/A**。 |
| **PS/Bash parse-unavailable** | 多处 fail-closed，可比 densable 更严。 |
| **N9 remote effort** | 无 remote 改 effort 协议；**不**在 bridge 硬塞 N9。 |
| **`tengu_ccr_bridge`** | **不**默认 true（除非产品明确要 Anthropic-hosted RC）。 |
| **willow crate `PPi`** | `/diff` 只接 `useDiffData` uncommitted；session/branch 无 host。 |

---

## 3. 可选 polish（修不修都合理）

| 优先级 | 项 | 说明 |
| --- | --- | --- |
| 低 | `declaredDialogKinds: []` 无法清空 | merge 用 `.length`；现网无清空调用方 |
| 策略 | uio 比 densable 更严（若再收） | 勿当「对齐」做 under-cwd 全拒 |
| 产品 | synced skill 真 loader | 接上 ingest 后 harden 才有生产路径 |
| 安全文档 | LAN TCP auth + UDP 明文 token | 已文档化威胁模型；不 invent 配对码 |

---

## 4. 快速对照（避免再贴错）

```text
Feature flags
  runtime: feature() 无 env → false
  build/dev: DEFAULT_BUILD_FEATURES（42 ON，含 UDS/LAN/TEAMMEM/KAIROS 外围）
  densable SEA 更接近全开；本地用 DEFAULT 表 + FEATURE_*=1

UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS_CHANNELS|PUSH|WEBHOOKS
  DEFAULT_BUILD ON（228 densable 1:1）
  非注入环境仍关；TEAMMEM 另有 OAuth+GitHub remote 门

tip
  densable 239 leftover + npm 2.7.46
  下一刀不是重开 212–235
```
