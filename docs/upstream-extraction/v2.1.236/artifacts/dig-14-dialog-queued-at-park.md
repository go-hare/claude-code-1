# Dig · #14 `dialog_queued_at_park` residual

> 2026-08-20 · densable SEA **2.1.236** · tip HAVE 主合同已落地 · **`dialog_queued_at_park` 已落地**  
> 口径：1:1 · invent-ban · **no auto commit**

## 一句话

用户可见合同（RC park 超时 **禁止** auto-fallback → `model_error`）已 **HAVE**。  
SEA 第二分叉也已接线：`xo` 下 park 期新 `J1t`（主线程 `mode==="prompt"`）→ `dialog_queued_at_park`；纯 timeout → `dialog_unanswered`。  
**Residual 仍挂：** SEA `Fo`/`Wlt`（interactionFired 1s 抑制）tip 无 `userPresence` 等价，未 invent。

## SEA 金标（`gold-fable5-credits-rc.txt`）

Park 块要点：

1. `On=iXe()` park timeout；本地 `Bn` AbortController；父 `Ln` 不因 timeout abort。
2. `Ar = Pt==="cancelled" && Bn.aborted && !Ln.aborted` → **unanswered 路径**。
3. **`vr` 分叉**（仅 `xo` 桥/RC 面开启订阅时）：
   - `hi = Set(snapshot.filter(J1t).map(uuid))` park 开始时快照
   - `subscribe(Fn)`：若出现 **新的** `J1t` 命令 → `vr=true` + `Bn.abort()`（可早于 timeout）
   - `Fo`/`Wlt`：交互后短窗抑制误触发（弱金标，勿 invent）
4. `if (Ar) pe("model_fable_consent", vr ? "dialog_queued_at_park" : "dialog_unanswered")` → 同一用户文案 → `{reason:"model_error"}`，**无** `fallbackModel` / `query_model_change`。

用户可见：两种 reason **同文案、同 abort、同禁 fallback**。  
产品差：telemetry 标签 +（可选）队列增长时提前关掉 dialog。

## tip 现状（落地后）

| 层 | 状态 |
| -- | ---- |
| `showFableOverageConsentDialog` | parkTimeout → `unanswered` **或** `queued_at_park`（`xo` watch + 新 J1t） |
| `runFableOverageConsentFlow` | 两者 → `dialog_*` + `shouldAbort` + 无 `fallbackModel`；throw 仍 `dialog_unanswered` |
| SEA 金标钉死 | `J1t = ix&&mode==="prompt"`；`xo=!rkt()&&vIt()`；`rkt=sdkDialogHostActive`；`vIt=bridge\|\|bg\|\|teammate` |
| helpers | `isFableParkQueuePrompt` / `shouldWatchFableParkCommandQueue`；DI `watchCommandQueue?` |
| `query.ts` | 不变：`parkTimeoutMs` + `shouldAbort` → `model_error` |
| 测试 | 含 xo gate / J1t / queued_at_park early-abort；既有 unanswered 回归 |
| residual | **Fo/Wlt** interactionFired 1s 抑制未 port（tip 无 userPresence） |

## tip vs SEA

```
SEA:  park + (timeout | 新 J1t 入队)
        → Ar
        → pe(..., vr ? dialog_queued_at_park : dialog_unanswered)
        → model_error（同 copy）

tip:  park + timeout（或 throw）
        → unanswered
        → 永远 dialog_unanswered
        → model_error（同 copy）
      （无 subscribe / 无 vr / 无提前 abort）
```

## 为什么现在不做（挖「为什么不做」）

1. **主 checklist 合同已 HAVE** — 官方痛点是「60s 后自动切 fallback」；Batch B 已修。
2. **残余 = 遥测标签 + 可选早 abort** — 用户文案不因 `dialog_queued_at_park` 改变。
3. **invent-ban 风险集中在辅符号**：
   - `J1t` 过滤器精确形状（何种 QueuedCommand 算「新命令」）
   - `xo` / `rkt` / `vIt`（何时才 subscribe）
   - `Fo` / `Wlt` 1s 交互抑制
   猜错会污染 telemetry 或误杀 dialog。
4. **类型已预留 reason** — 落地成本低，但必须先钉死 `J1t`/`xo` 再动生产路径。
5. tip 已有 queue snapshot/subscribe — **不是缺基础设施**，是 **consent park 未接线**。
6. tip 已有邻近路径易误认成「已对齐」：
   - `printRequestDialog` 的入场 `queued_at_park` cancel（队列**已有**命令时不弹）
   - `print.ts` 的 `'now'` interrupt subscribe  
   二者都 **≠** SEA park 等待中 `vr` live watcher；不要把它们当成 `#14` residual 已关。

## 若要落地（最小 1:1，仍须先补金标）

1. SEA 再挖：`J1t`、`xo=!rkt()&&vIt()`、`Fo`/`Wlt`、`Rs=uuid` 等价物。
2. `showFableOverageConsentDialog`（或 flow）在 `parkTimeoutMs` 路径：
   - park 起：`hi = snapshot.filter(J1tEq).map(id)`
   - `subscribe`：新 J1t → `queuedDuringPark=true` + `localAbort.abort()`
   - finally unsubscribe；timeout 仍保留
3. `unanswered && queuedDuringPark` → reason `dialog_queued_at_park`，否则 `dialog_unanswered`；两者都 `shouldAbort`、无 fallback。
4. 测试：入队触发 early abort + reason；纯 timeout 仍 `dialog_unanswered`；soft cancel 不变。
5. **禁止** invent `bridge_dialog_timeout`；**禁止** 改用户 copy / 放开 fallback。

## 建议

- **保持 residual**，除非明确说「修 14 / 落地 queued_at_park」。
- checklist `#14` 维持 **HAVE**；progress Next 可继续列本 residual。
- 同档可选残余仍：`#30` Ola/Dla receipt、`#2` hold-policy notice、`#5` canary 外围。

## 证据指针

- SEA：`docs/upstream-extraction/v2.1.236/snippets/gold-fable5-credits-rc.txt`
- tip：`src/utils/fableConsent.ts`（≈294–511）
- tip 测：`src/utils/__tests__/fableConsent.parkTimeout.236.test.ts`
- tip 接线：`src/query.ts`（≈1023–1077）
- tip queue：`src/utils/messageQueueManager.ts`（`subscribeToCommandQueue` / `getCommandQueueSnapshot`）
