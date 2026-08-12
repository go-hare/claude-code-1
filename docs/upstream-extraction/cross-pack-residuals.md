# Cross-pack residual inventory (go-hare vs densable)

> 更新：**2026-08-12** — 修正 Feature/UDS·LAN·TEAMMEM OFF 神话；GKd 已接线；224 GAP0；**221 #12 → DEP-HAVE**；**221 #10 → HAVE**（API-request 路径 null-proto/hasOwn）；**createSdkMcpServer / `_registeredTools` 两边 plain 对齐**（非 residual）；**Ink kTd whole-token re-ESC + incomplete buffer → HAVE**（见 §2）。  
> 原则：densable-first 1:1；**不 invent** VSCode/cloud-only；**不 auto commit/push/bump**。

---

## 1. 官方残差（仍 open / invent-ban）

| ID | 条目 | 性质 | 说明 | 建议 |
| --- | --- | --- | --- | --- |
| **223 #3** | cloud session `/teleport` 本地继续提示（`claude --teleport <id>`） | **GAP** / invent-ban | SEA 有 hint；本地无 cloud session 提示产品面 | 不假造；有产品面再做 |

**已关闭（勿再当 open GAP）：**

| ID | 性质 | 说明 |
| --- | --- | --- |
| **221 #10** | **HAVE / 对齐**（API-request 路径） | 本地 crash 金标 = `filterSwarmFieldsFromSchema`/`toolToAPISchema`。null-proto + `hasOwn` + permission map。见 `hit-constructor-mcp-map.txt`。 |
| **createSdkMcpServer 产品 twin** | **HAVE / 对齐** densable `fVp` | `tool()` + `createSdkMcpServer()` → `{type:'sdk', name, instance}`。**registry 与 densable 1:1 plain `{}`**（不 invent 入口 null-proto）。`constructor` 名与 densable 同：already registered。测：`createSdkMcpServer.221.test.ts`。 |
| **MCP SDK `_registeredTools`** | **对齐 densable**（两边 plain） | SEA / public SDK / go-hare create 路径均为 plain + truthy；**不**本地 delta；**不** patch-package。#10 不靠 registry 修。 |

**非 open GAP（勿再当残差）：**

| ID | 性质 | 说明 |
| --- | --- | --- |
| **221 #12** large-upload TLS | **DEP-HAVE** | 修在 `@anthropic-ai/sandbox-runtime@0.0.70`（`MAX_SIGV4_RESIGN_BODY_BYTES` / BodyTooLarge）；CLI 仅 tlsTerminate 接线、**无**独立 large-upload locus → **不**勾 CLI HAVE，也**不** invent CLI handler。见 `official-221-checklist.md` |
| **224** 产品 | HAVE 29 · GAP 0 · N/A 2 | #15/#16/#24/#25 HAVE；#29/#31 VSCode N/A |
| **228** 产品 | checklist **18/18 HAVE**（#12 = **core-only**） | 含 l8t errorCode 13。**未 commit** 直至用户点名。**#12 宜按 PARTIAL/core-only 理解**，勿当完整云同步对等 |

---

---

## 2. 有意 tradeoff / 本地 delta（不是漏 port）

| 项 | 说明 |
| --- | --- |
| **228 #2 uio** | densable 只拒 exact-cwd / shadow 段 / WindowsApps；允许 `cwd\tools\git.exe` 等。相对 pre-228「拒全部 under-cwd」更松；对齐官方 #2 parent-of-Git。测试锁 ALLOWS non-shadow subdir。 |
| **228 #12 synced skills** | 只 harden core（shadow / sanitize / no `!`/`@`）；**不 invent** 完整 claude.ai 下载/ingest host；生产几乎不写 `loadedFrom:'syncedSkills'`（单测构造）。checklist 计 **HAVE** 时须自认 **core only**——相对「完整官方对等」宜 **PARTIAL** 理解。 |
| **228 #3 `/tui`** | 只 Bxa `--model` pin；**不 invent** 完整 densable `cui`（add-dir / effort / permission-mode）。 |
| **OWNER_ORG handoff (dBe)** | densable 常 `(live.org\|\|undef)===(handoff.org\|\|undef)`：handoff **无 ORG** 而 live **有 org** 会误 veto。本地：**仅 handoff 带了 OWNER_ORG 才比 org**；缺省 ORG 只比 account（有意产品修正，有注释 + 测）。 |
| **228 #14 ugi** | Vertex/GCP auth **仅 401** 进 cloud-auth cap；**403 不进 cap**（densable 金标，有测）。 |
| **Vertex 文案门** | `provider==='vertex' \|\| USE_ANTHROPIC_GOOGLE_CLOUD`；无 `anthropicGoogleCloud` provider id；pure vertex 仍 stamp KKd。 |
| **AWS GKd/VKd 文案** | **已接线**（非 open polish）：`formatBedrockAuthErrorMessage` → `getAssistantMessageFromError`（`isBedrockishAuthProvider` 等）；`bedrockAuthFailFast.228.test.ts`。cousin 于 228 #14，非未做。 |
| **228 #17 + l8t** | unread gate（Jqy/MCt）+ **l8t** Read-deny early gate（`errorCode:13`，`cannot be written/edited` ≠ generic unread）。**validateInput + call()** 同 skip（`shouldAllowCallDespiteMissingOrPartialRead`）；测：`fileEditReadGate.228` + `fileEditReadGate.call.228`（**subprocess 隔离**：wrapper 调 `.runner.ts`，避免 `mock.module` 污染全量 suite）。路径检查与现有 edit-deny 同粒度（densable `fT` 多路径为可接受细差）。 |
| **UDS `CLAUDE_CODE_MESSAGING_TOKEN`** | densable `$Y.set` → `process.env`（子进程继承）；capability 发布成功后才 export；stop/fail 清除。**不 invent** 非 env soft-auth；无 SEA 平台谓词不造 degraded unauth。细差：densable dual peer/child token，本地单 token。 |
| **Multi-API** | OpenAI / Gemini / Grok 兼容层（本地产品）。 |
| **`/poor`** | 降 token（跳 extract_memories / suggestion / verification 等）。 |
| **Feature flags** | **runtime** `feature()` 无 env → `false`。**build/dev** 注入 `DEFAULT_BUILD_FEATURES`（65+ ON，见 `scripts/defines.ts` / CLAUDE.md）。densable SEA 更接近全开；本地用 DEFAULT 表 + `FEATURE_*=1`。**禁止**再写「本地默认全 OFF」。 |
| **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS_CHANNELS\|PUSH\|WEBHOOKS** | **`DEFAULT_BUILD` ON**（2026-08-12 densable 228 产品面对齐）。非 build/dev 注入环境仍关。TEAMMEM 另有 OAuth + GitHub remote **运行时门**。历史「默认 OFF」是旧 deferral，**不是** densable 产品关。 |
| **VSCode / cloud-only** | 224 #29/#31、225 #12 等 **N/A**，不 invent 扩展面。 |
| **PS/Bash parse-unavailable** | 多处 fail-closed，可比 densable 更严。 |
| **classic replBridge handle** | 常 `noHistoryBackfill: undefined`；v2 mint / q5o 路径才 stamp（有意）。 |
| **228 #15 Spinner** | retry/stall 顺序为 214+ 延续，非 228 独 diff。 |
| **228 #7 SHR emit→clear hold 序** | densable 金标 **HAVE / 记账不修**（勿 invent「修序」）：(1) `sessionActivity` parked 时 **先** `emit('awaiting-action')` **再** `clearFollowUpHold(..., keepTimer=true)`；(2) `rootRunner` `awaiting-action && deferredHold` **短路不 arm idle**（防 mid-gap retire）；(3) `onBgResultFollowUpBusy(false)` **只翻** `deferredHold=false`，**不** re-arm idle。hold 结束靠 busy=false / childExited / grace→`maybeEmitTurnEnd`。**#7 已落地** = `countNonMonitorTasks` + dispose→childExited force-clear + stale ledger 不卡 busy=false——**不是**改 emit/clear 序。invent-ban：clear 先于 emit / 去 short-circuit / clear 后 re-arm = 偏离 densable。 |
| **Ink parse kTd whole-token re-ESC + incomplete** | densable 2.1.228 **HAVE / 1:1**（2026-08-12 用户 **对齐**）：`parseMultipleKeypresses` text 支 **仅** whole-token re-ESC `/^\[<\d+;\d+;\d+[Mm]$/` + X10 `/^\[M[\x60-\x7f][\x20-￿]{2}$/`；**无** `pendingSgr` / `absorbMm` / multi-event peel / CSI-u orphan peel（SEA 0）。incomplete CSI 在 `tokenizer.buffer()`（`KeyParseState.incomplete`），App `NORMAL_TIMEOUT=50` flush → sequence → `parseKeypress`。**xM_** pure `[<\d…` → `""`；2-param live burst `3;60M…` densable **也**会进 prompt——**不** invent KE 2-param empty。KE progressive sinks（leading-`<` / 3-param without `[` / mixed scrub）= **pre-existing local delta**，不扩。测：`parse-keypress-orphan-mouse` + `keyboard-event-orphan-mouse` + unicode CSI-u non-recovery；ink core `__tests__` 253 pass。 |
| **N9 remote effort** | 无 remote 改 effort 协议；**不**在 bridge 硬塞 N9。 |
| **`tengu_ccr_bridge`** | **不**默认 true（除非产品明确要 Anthropic-hosted RC）。 |

---

## 3. 可选 polish（修不修都合理）

| 优先级 | 项 | 说明 |
| --- | --- | --- |
| 低 | `declaredDialogKinds: []` 无法清空 | merge 用 `.length`；现网无清空调用方 |
| 策略 | uio 比 densable 更严 | under-cwd 全拒 + 仅 parent-of-Git / Program Files 白名单 → **偏离 densable 1:1**，勿当「对齐」做 |
| 产品 | synced skill 真 loader | 接上 ingest 后 harden 才有生产路径；属产品，不是小补丁 |
| 安全文档 | LAN TCP auth + UDP 明文 token | **已文档化威胁模型**（`pipes-and-lan.md` / `lan-pipes.md`）：握手防盲扫，非机密；不 invent 配对码/challenge 除非产品明确要 |
| 流程 | commit 228 pack | 脏树含 #10 + review criticals 未提交；用户点名再 Conventional Commit，**勿 auto bump/push** |
| 验证 | 全量 `bun run precheck` | typecheck 0；#17 定向 33（runner）+ 2 wrapper pass。全量 suite **~310 fail / 35 errors** 为**预存** mock 污染 / path 解析 / 顺序敏感（排除 #17 后同基线；#17 已 subprocess 隔离不再贡献）。**不**因 310 宣称 ship-green |

**已落地（脏树，未 commit）— 228 code-review criticals：**

| 项 | 修法 |
| --- | --- |
| LAN TCP pre-auth clients | `pendingAuthClients`；auth 成功才进 `clients`；broadcast/connectionCount 不含未认证 |
| attach master socket | `PipeMessageHandler` 第三参 source socket；`usePipeIpc` 不再 `clients[last]` |
| auth token compare | `pipeAuthTokensEqual` + `timingSafeEqual` |
| SHR hold/turn-end | `countNonMonitorTasks`（densable ce）替代 `tasks.size` |
| plugin symlink cleanup | `listPluginCacheSubdirs` 含 symlink，防 `removeIfEmpty` 误删 sole-link |

**已从 polish 删除（过时）：**

- ~~AWS GKd/VKd 文案未接线~~ → 见 §2 已接线  
- ~~224 checklist 粗计数 GAP 4~~ → 已更正 HAVE 29 / GAP 0  

---

## 4. 快速对照（避免再贴错）

```text
Feature flags
  runtime: feature() 无 env → false
  build/dev: DEFAULT_BUILD_FEATURES（65+ ON，含 UDS/LAN/TEAMMEM/KAIROS 外围等）
  densable SEA 更接近全开；本地用 DEFAULT 表 + FEATURE_*=1

UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS_CHANNELS|PUSH|WEBHOOKS
  DEFAULT_BUILD ON（228 densable 1:1）
  非注入环境仍关；TEAMMEM 另有 OAuth+GitHub remote 门
```
