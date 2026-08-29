# Cross-pack residual inventory (go-hare vs densable)

> 更新：**2026-08-29** — tip **densable 2.1.239 leftover** + npm **2.7.46**。  
> 原则：densable-first 1:1；**不 invent** VSCode/cloud-only；**不 auto commit/push/bump**。  
> 分 pack 金标仍以各 `official-*-checklist.md` / board 为准。本文只记**跨 pack 仍 open** 与有意 delta。  
> **过期**：2026-08-13 稿把 228 当 tip、写「65+ feature ON」「全量 ~310 fail」。现码 `DEFAULT_BUILD_FEATURES` **42** ON（`scripts/defines.ts` / CLAUDE.md）。全量 suite 数以当下 `bun run precheck` 为准，勿再引用 310。  
> **本轮 triage（2026-08-27）**：假 HAVE 纠偏 — **236 #11/#27**、**239 #4/#13**、**234 #4** → **PARTIAL**。完整单宿主 NMs 切轨另立项（Project NMs）。  
> **诚实度（2026-08-29）**：236 **#9** Project C → HAVE（checklist HAVE **22** / PARTIAL **10**）。**#11 仍 PARTIAL**（不抬 HAVE）；§1b 过期缺口（Hnu Fallback / `DIALOG_LAYOUTS={}` / ProposeGoal 无 tool）已关。239 board 假 HAVE 54 已对齐 checklist HAVE **52** / PARTIAL **2**。

---

## 0. 当前 tip（239）

| 项 | 状态 |
| --- | --- |
| 239 changelog | HAVE **52** / PARTIAL **2**（#4 @synced 灌目录死；#13 交互 plan resume）/ GAP **0** / UNKNOWN **2 parked**（#44/#56）/ N/A **3** |
| 239 leftover | willow crate REPL diff tab **已落**（GB 关走 DiffDialog；uncommitted only）。LOCAL `tengu_willow_mode:'dialog'` 已删。 |
| 236 | HAVE **22** / PARTIAL **10** / N/A **1**（`#9` Project C HAVE；`#11` NMs 产品面 + `#27` REPL SIGTERM 仍 PARTIAL） |
| 234 | HAVE **43** / PARTIAL **1**（`#4` quota 仅 REPL）/ GAP **1** / N/A **6** |
| 237 | HAVE **3** |
| 238 | HAVE **34** / PARTIAL **5**（live E2E / chrome UI / 官方自己也不隔离；不抬 HAVE） |
| 240 / 241 | 官方无 bullets。**不**折入 |

---

## 1. 官方残差（仍 open / invent-ban）

| ID | 条目 | 性质 | 说明 | 建议 |
| --- | --- | --- | --- | --- |
| **223 #3** | cloud session `/teleport` 本地继续提示 | **GAP** / invent-ban | SEA 有 hint；本地无 cloud session 产品面 | 不假造 |
| **234 #35** | profile `/login` | **GAP** / invent-ban | 无官方 login 面 | 不 invent |
| **234 #4** | quota auto-resume | **PARTIAL** | REPL + rate-limit HAVE；print 无 | 不 invent print UI 除非 SEA 已 peel |
| **228 #12** | synced skills ingest | **PARTIAL** | core harden 已齐；无 claude.ai 下载 host | 不 invent ingest |
| **239 #4** | `@synced` 云插件 | **PARTIAL** | CLI 语法有；`setSyncedPluginDirs` 生产零调用 | 同 228 #12；不 invent 云灌 |
| **239 #13** | cloud plan mode resume | **PARTIAL** | print + 交互 hydrate/`y_u` 已接；continue 不调；缺端到端 CCR 证齐 | 不抬 HAVE |
| **236 #11** | managed-settings NMs | **PARTIAL** | 基建 + sXg 早装 + modal Host mount；产品面未切单宿主（见 §1b）。mLo 只有 EQr；elicitation/sandbox 仍 focused | 不抬 HAVE |
| **236 #27** | SIGTERM remote-cancel | **PARTIAL** | print + REPL `registerInteractiveShutdownAbort` 已打同因；全路径证齐前不抬 | 不抬 HAVE |
| **236** | `#4/#10/#28/#29` 等 | **PARTIAL** gold-weak | 有邻近机、无完整 SEA 合同 | 再挖可以，禁止第二套 |
| **236** | `#18/#24/#31/#32` | **PARTIAL** gold-false | SEA `found:false` | invent-ban |
| **238** | `#4/#16/#18/#24/#25` | **PARTIAL** stay | 代码合同 1:1；骨架 E2E 不抬 HAVE | 保持 PARTIAL |
| **coordinator resume** | `print.ts` lazy module / `saveMode` | parked soft | tip 已有 env/`result.mode` 落盘；Bun null `modeApi` 补 `matchSessionMode` 翻转等证据不足 | **本轮不必修** |
| **239 #44/#56** | org-policy webhook / web Bash proxy | **UNKNOWN parked** | gateway CRI / 云 MITM | 禁止本地 webhook / 假 host 表 |
| **239 leftover** | `PPi` · `V1w` · `bvr` · `U_c` · `H_a` · storageV5 | parked | 无本地 host | invent-ban |

### 1b. NMs 产品面缺口（金标单宿主 vs tip 双轨）

金标：**NMs + Bgp(kdy)** 一条宿主。tip：store/mailbox/jsu 表有，REPL 产品面**未全切**。**236 #11 仍 PARTIAL，禁止抬 HAVE。**

| 缺口 | 事实（2026-08-29） |
| --- | --- |
| **已切 NMs（勿再当 orphan）** | `goal_proposal`（ProposeGoalTool `l(Dot)`）；`auto_mode_setup_review` / flagged-allow；`auto_default_nudge`；`ide_onboarding` `sdu(CHr)`；`cost_threshold`；`permission_browser` Hnu（Allow / allow-domain / Deny，不再 Fallback） |
| **仍 focused（金标也是）** | elicitation `_Zt`；sandbox / worker-sandbox 走 `focusedInputDialog` |
| **仍 orphan spec** | `it2_setup` / `computer_use_approval` 仅 `jsuKinds`，生产无 opener（不 invent） |
| **modal** | `DIALOG_LAYOUTS` 只有 `permission_exit_plan_mode_v2`（金标 mLo 也只有 EQr）；fullscreen 挂 `variant="modal"`；GSn 仍 inline |
| **permission_* 单 renderer** | 除 browser 外 Host 仍进 `PermissionPromptRenderer`，只读 `requestId`；`showingDiffInIDE` 在 descriptor 上 Host 不读 |

**P1 半截（只记账，本轮不改码）：** 238 identity_changed 文案在、classifier stub；**232 #43** 已纠偏为 PARTIAL（233 回滚 / 产品路径不调用）；raccoon `/compact` GB 默认 false；policyHelpers consent 门 tip no-op。GoalProposal extras（`stillWorking`/`currentCondition`）是死字段；1:1 是 renderer 现场读 `vou()`/`wt(nFA)`，禁止造 payload。

**已关闭（勿再当 open GAP）：**

| ID | 性质 | 说明 |
| --- | --- | --- |
| **221 #10** | **HAVE** | API-request null-proto / `hasOwn` / permission map |
| **createSdkMcpServer** | **HAVE** | densable `fVp`；registry plain `{}` |
| **221 #12** large-upload TLS | **DEP-HAVE** | 修在 `@anthropic-ai/sandbox-runtime`；CLI 无独立 locus |
| **236 #6** | **HAVE**（2026-08-26） | `LFh=14` chrome + `sgM` 动态槽；无 XKl → `ngM=0` |
| **236 #9** | **HAVE**（2026-08-29） | Project C `Axc`/`xxc`/`frameSink`；sticky 默认 OFF |
| **Hnu / ymn / ProposeGoal** | **HAVE**（WT，未 commit unless asked） | permission_browser 真 UI；auto-mode review gold copy；ProposeGoal 独立工具 |

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
| **zRr / `useSwarmBanner`** | 门控已对齐 `Object.keys(teammates).length > 1`；fork 留：detection=`windows-terminal` 时 WT 文案（pre-229）；不 port prideGradient / hideSessionTitle。 |
| **有据留存（非隐藏双规）** | `teammateDefaultModel` 类型死键（legacy unread）；232 `#43` redirect helper 产品不调；goal idle tip invent 已三处标注 SEA Wsv。 |
| **已清双规** | `CLAUDE_CODE_SPAWN_TUI_RELAUNCH` / `isTuiRelaunchSpawnEnabled`（官方 0 hits；accept 仅 `spawn:false` 测）。 |

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
