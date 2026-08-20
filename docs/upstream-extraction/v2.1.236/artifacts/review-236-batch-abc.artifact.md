# densable 2.1.236 · Batch A/B/C Code Review

> Scope: **全部未提交** Batch A/B/C 改动（~74 paths）  
> 口径：densable-first **1:1** · invent-ban · **no auto commit**  
> SEA：`2.1.236` · sha256 `6bc4ba992d…`  
> Updated: **2026-08-20** · Final  
> Agents：fable/uds · fullscreen/runner/usage · autoMode/pollution · adversarial verify workflow

## Status

| Item | State |
| ---- | ----- |
| Diff map | **done**（8 clusters） |
| Focused tests (earlier) | **58 pass / 0 fail** |
| #14 verification | **PASS**（queued_at_park 主合同） |
| Adversarial agents | **done** |
| Review-then | **非 clean** — 1 Critical · 7 Important · 若干 Suggestions |
| Fix C1+I1–I7 | **landed（未 commit）** · focused **72 pass** · precheck **12044/0 fail** |
| Verification gate | **PASS**（agent `a022838c774c2ab81`；spot-check 复跑一致；workflow `wae07jkuk` allOk） |

## Critical

### C1. bare-name 纯 `notify_when_idle` 会先发空消息（破坏 “costs nothing”）

- **文件：** `packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts`  
  - `pureIdleSubscribe`：`~1514-1515`  
  - early pure 路径仅 `addr.scheme === 'uds'`：`~1569-1586`  
  - bare-name peer resolve 门闩：`typeof input.message === 'string'`（**无** `trim().length > 0`）：`~1857-1862`  
  - resolve 成功后：`sendToUdsSocket(cand.id, input.message)` 再 subscribe：`~1953-1996`  
  - 未 resolve 才落到 `THIS_MACHINE_ONLY`：`~2021-2033`
- **Why：** `UDS_INBOX` schema 把 `message` default 成 `''`。省略 message 的纯订阅在 bare name 上仍走进 peer-resolve；空串满足 `typeof === 'string'`，于是对 UDS peer **写出空 cross-session 文本**（并占 outbound pacer token），再订阅。SEA prompt 金标：`Omit message for a pure subscription that costs that session nothing`（`gold-notify_when_idle.txt`）。若解析到 bridge peer，还可能空发 RC 且**不**订阅。
- **Failure：** `SendMessage({ to: "worker", notify_when_idle: true })` 本应零成本订阅，实际污染对端 inbox / 计数。
- **Fix：**  
  1. peer-resolve / 文本发送要求 `trim().length > 0`；  
  2. bare-name 纯订阅：resolve → `maybeSubscribePeerIdle`（与 explicit `uds:` 对称）；  
  3. 非本机目标继续 `NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY`。

## Important

### I1. QHr/refund 过宽：post-write timeout 也会退 token

- **文件：** `src/utils/udsClient.ts`  
  - `isUdsConnectFailError`：任意 `UdsPeerConnectionError` → true：`~89-93`  
  - `sendToUdsSocket`：connect 成功并 `write` 后，timeout / socket error 仍包成 `UdsPeerConnectionError`：`~409-433`
- **SEA：** `qKo` = `ENOENT | ECONNREFUSED | (bt && errorClass===E5d)`（`hit-sendmessage-burst.txt`）；catch 仅 `QHr` 时 `refund`。
- **Failure：** 已写出但对端 ack 慢 → refund → `sentInBurst` 低估 → 本应 paced 的后续发送被放行（inbox drop / falsely paced 合同反面）。
- **Fix：** 仅 pre-write connect-fail refund；收窄 predicate；补「connect+write 后 timeout → 不 refund」回归。

### I2. `query` 无条件武装 60s `parkTimeoutMs`（SEA 仅 `xo && On>0`）

- **文件：** `src/query.ts:1062` 始终 `parkTimeoutMs: resolveFableBridgeDialogTimeoutMsOrDefault()`；`fableConsent.ts:378+` 只要 `parkTimeoutMs>0` 就 `setTimeout` abort。  
- **SEA：** `Ns=xo&&On>0?setTimeout...`；queue watch 也仅 `xo`（`gold-fable5-credits-rc.txt`）。tip 的 watch 已按 `xo` 门控，**timeout 本身没有**。
- **Failure：** 本地交互选 Fable、用户 >60s 才点同意 → `dialog_unanswered` **硬 abort**（无 soft fallback）。相对 SEA 是 invent 本地自动超时。
- **Fix：** 仅 `shouldWatchFableParkCommandQueue()`（或等价 `xo`）为真时传入/武装 `parkTimeoutMs`。

### I3. park 期间父 abort → soft `dialog_declined` + auto-fallback（SEA：`aborted_streaming`）

- **文件：** `fableConsent.ts` Ar：`cancelled && localAbort.aborted && !input.signal?.aborted`（`~410-418`）；父 abort 时 Ar 不成立 → 落到 soft `dialog_declined` + `fallbackModel`（`~662-673`）；`query.ts:1079-1093` 对 `dialog_declined` 切模型。
- **SEA：** 父 `Ln.aborted` 在 `if(Ar)` **之前**走 `aborted_streaming`；Ar 要求 `!Ln.aborted`。
- **Failure：** 用户/上层取消 consent dialog 时可能静默切到 fallback，而不是 abort streaming。
- **Fix：** 父 abort 优先映射 `aborted_streaming` / 等价 cancel；禁止该路径 `dialog_declined`+fallback。

### I4. fullscreen 缺 SEA `$a` dispose → short success 不清 strikes

- **文件：** `src/utils/fullscreen.ts`  
  - arm 时 `cleanup` no-op：`~932-934`  
  - exit hook：`clearFullscreenBootHealthy(..., false)`（**不清 strikes**）+ `isProcessRunning(process.pid)`：`~870-887`
- **SEA：** `aIh` 注册 `$a(() => cIh(armed && firstFrameAt && clean exit ? "healthy" : "withdrawn"))`；`healthy` → `sIh(..., clearStrikes=true)`（`gold-fullscreen-fallback.txt` BLOCK C）。
- **Failure：** 1 strike 后，用户成功进 fullscreen、首帧已记，但在 `eSw=10s` 前正常退出 → strikes 残留；再失败一次即 sticky `tripped`（false-disable 加速）。
- **Fix：** 对齐 `$a`/`cIh`；healthy settle 清 strikes；勿用 self-pid running 当 withdraw 门。

### I5. `armFullscreenBootCanary` 未 await → pending 与 render_error 竞态

- **文件：** `src/main.tsx:3177-3180` `void armFullscreenBootCanary().catch(...)` 后立刻 `createRoot`；arm 内 async `saveGlobalConfig`（`fullscreen.ts:946-966`）。
- **SEA：** `aIh` 返回前 `await sn(...fullscreenBootPending...)`。
- **Failure：** 极早 unrecoverable render 时 pending 可能尚未落盘 → `markFullscreenBootRenderError` 见不到 entry → 无 `died` / 无 strike → **single-fail→classic 合同落空**。
- **Fix：** createRoot 前 `await armFullscreenBootCanary()`；合并写入勿覆盖已有 `died:"render_error"`。

### I6. `/tui status` 把单次 `crashAutoOff` 标成 “repeatedly failed”

- **文件：** `src/commands/tui/index.ts:289-296`：`isFullscreenStickyAutoDisabled() || getCrashAutoOff()` 共用 sticky 文案。
- **SEA：** 两条后缀分家（sticky vs didn’t finish starting）（gold BLOCK E）；单次 `strike` 也会置 `crashAutoOff`。
- **Failure：** 一次 boot 失败后 status 声称「反复失败并已关闭」，用户以为已 sticky；实际下次仍会再试 fullscreen。
- **Fix：** 仅 sticky/`NDn` 用 repeatedly-failed；单次 crashAutoOff/pending 用 didn’t-finish 文案。

### I7. `bridge`/`tcp` + `notify_when_idle`（含带 message）在 validateInput/call 整单拒绝，消息也不投递

- **文件：** validateInput `~1348-1355` 对 bridge/tcp+notify **直接 false**；call `~1541-1552` 对 bridge/tcp+notify 直接 `THIS_MACHINE_ONLY`（无先投递 message）。
- **SEA：** 订阅仅本机；**带 message 时应先投递再订阅**；非本机订阅拒绝不应吞掉已声明的文本投递（prompt：`With a message: deliver it now AND subscribe`）。
- **Failure：** `to: bridge:…` + message + notify → 整调用失败，对端收不到消息。
- **Fix：** validate/call 对「有非空 message」允许投递；订阅侧单独 append refuse note（与 bare mailbox+notify 注释路径对称）。纯 notify 仍可硬拒。

## Suggestions

1. **SendMessage** `scheme === 'other' && !pureIdleSubscribe && false` 死分支（`~1533-1538`）— 删掉或改成真 gate。  
2. **bare-name send 失败**缺 explicit `uds:` 路径的 “Nothing was subscribed either…” 文案对称（`~2004-2014` vs `~1693-1711`）。  
3. **runner-17** pickup 日志用 `occupiedSlotCount()+1` vs SEA `active.size+1` — 弱漂移；门控用 occupied 正确，**勿升 bug**。  
4. **postSessionInFlight.decrement** 可 `Math.max(0, …)` 防未来多路径 settle。  
5. **测试污染（harness）：**  
   - `vscodeSdkMcp.235.test.ts` growthbook 薄 mock + afterAll 未恢复  
   - `autoModeKdQta.236.test.ts` growthbook mock 无 afterAll  
   - `surfacePick.eGu.221.test.ts` growthbook 未 restore  
   - `autoModeGitStatus.untracked.236.test.ts` `execFileNoThrow` 未 restore  
   - `fullscreenBootCanary.236.test.ts` analytics mock 可能 unrestored  
   Bun `mock.module` 进程全局 — 建议统一 snapshot restore；产品逻辑本身 #22/#26 未见合同破洞。  
6. **yoloClassifier `parseXmlBlock`：** 冲突检测扫 raw `text`、解析扫 `stripped` — gold 弱；标观察项，勿 invent。

## Clean / 非本轮 bug

| 项 | 结论 |
| -- | ---- |
| #14 `dialog_queued_at_park` + J1t/`xo` watch | 主合同对齐；timeout/queue → abort、无 fallback |
| #30 reserve-before-send / refuse `x5d` / Windows+no-inbox noop / pace key | 主合同正确 |
| #17 ordered release / inFlight ++/-- / occupied 门控 | 未见 release 早于 post-session / 稳定 leak |
| #26 Team\|Enterprise credits 门 / 0% clamp / `am` 货币格式 | **clean** |
| #22 KD/qTa/KIt + `DO_NOT_TRACK` 产品路径 | 大体 densable-aligned（harness 污染另计） |
| Fo/Wlt interactionFired 1s | **documented residual** |
| Ola/Dla `credit`/`debit` receipt call-sites | **documented residual** |
| #2 hold-policy notice 矩阵 | **documented residual** |
| gold-weak #18/#24/#31/#32 | invent-ban PARTIAL，不升 bug |
| #33 VSCode host a11y | N/A invent-ban |

## Residuals（保持，不 invent）

- #14 Fo/Wlt  
- #30 Ola/Dla receipt  
- #2 hold-policy matrix  
- #5 canary peripheral（`$a`/`uv` 产品洞已升 Important；其余 peripheral 仍 residual）  
- gold-weak #18/#24/#31/#32  
- usage `$sT` 符号表字节级哈希未对拍（行为已测）

## Recommended fix order（仍 **no commit** until explicit）

1. **C1** bare-name pure idle（产品合同）  
2. **I2+I3** fable park 门控 + 父 abort（#14 行为正确性）  
3. **I1** QHr 收窄（#30 pacing 正确性）  
4. **I4+I5+I6** fullscreen canary settle / await / status 文案（#5）  
5. **I7** bridge/tcp+notify 与 message 投递分离  
6. harness mock restore（CI 稳定性）

## 已修（C1 + I1–I7 · 未 commit）

> 用户「修」+ Critical+Important 全修 · I3=`parent_aborted`→`aborted_streaming` · plan `iridescent-wobbling-chipmunk` · **仍 no commit/push/bump**

| ID | 落地 | 关键证据 |
| -- | ---- | -------- |
| **C1** | bare-name 纯 `notify_when_idle`：`resolvePeerByName` → `maybeSubscribePeerIdle`，**不** `sendToUdsSocket('')`；文本门 `trim().length > 0` | `SendMessageTool.ts` C1 块；`sendMessageNotifyIdle.236` / bareName 顺序探针 |
| **I1** | `isUdsConnectFailError` 仅 ENOENT/ECONNREFUSED（含 cause）；post-write timeout **不** refund | `udsClient.ts` qKo；`udsOutboundPacer.236` |
| **I2** | `parkTimeoutMs` 仅 `xo`（`shouldWatchFableParkCommandQueue`）；show* 亦 `Ns=xo&&On>0` | `query.ts` + `fableConsent.ts`；parkTimeout 测 |
| **I3** | 父 abort → flow `parent_aborted` → query `{reason:'aborted_streaming'}`；无 `dialog_declined`+fallback | `fableConsent.ts` / `query.ts`；parent_aborted 测 |
| **I4** | arm cleanup=`onExit`→`settleFullscreenBootCanary(healthy\|withdrawn)`；backup 去 self-pid 门 | `fullscreen.ts` |
| **I5** | `main.tsx` `await armFullscreenBootCanary()`；同 pid `died:render_error` 不覆盖 | `main.tsx` + arm save |
| **I6** | sticky-only → repeatedly-failed；else crashAutoOff/pending → didn’t-finish | `commands/tui/index.ts` |
| **I7** | validate/call：纯 notify 才硬拒 bridge/tcp；有 message 先投递再 append `THIS_MACHINE_ONLY` | SendMessage I7 注释路径；notifyIdle 探针 |
| **Harness** | KdQta / GitStatus / surfacePick / vscodeSdkMcp / fullscreen analytics：real-module snapshot + afterAll restore | 对应 `*.test.ts` |

**precheck（修后）：** `12044 pass / 21 skip / 0 fail`（1169 files）· typecheck/biome 绿。

**仍不碰（invent-ban residual）：** Fo/Wlt · Ola/Dla · hold-policy · gold-weak UI · #33 N/A。

## Verdict

**审查当时：非 clean**（1 Critical + 7 Important）。  
**修后（未 commit）：** Critical+Important **已落地**；adversarial verification **PASS**（focused 72 + typecheck + `/tmp` probes 6 + harness co-run；coordinator spot-check 复跑一致）。仍 **no commit/bump** until explicit。
