# densable 2.1.214 Batch E — #38 multi-frame message_delta cost double-count

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

流式 `message_delta` 的 `usage` 是 **cumulative**。旧路径每帧都 `addToTotalSessionCost(full usage)` → 多帧时 cost/token 翻倍。

## densable 证据

```
// sHe = updateUsage (input/cache >0 guard; output_tokens ??)
// gr ∈ { "none", "pending", "credited" }

case "message_delta":
  tt = sHe(tt, zo.usage)
  // write usage/stop_reason onto ALL yielded assistant msgs (ve)
  for (let Qo of ve) {
    Qo.message.usage = tt
    Qo.message.stop_reason = wt
    Qo.message.stop_details = zo.delta.stop_details ?? null
  }
  if (wt !== null && gr !== "credited") {
    gr = "credited"
    tr += Zce(cost, tt, model, ...)   // once
  } else if (gr === "none") {
    gr = "pending"
  }

case "message_stop":
  if (gr === "pending") {
    gr = "credited"
    tr += Zce(...)
  }
```

Zce ≈ `addToTotalSessionCost`（session + OTel counters）。

## 本地落地

| densable | 本地 |
|----------|------|
| `gr` | `StreamCostCreditState` in `streamCostCredit.ts` |
| message_delta gate | `onMessageDeltaCostCredit` → `claude.ts` |
| message_stop gate | `onMessageStopCostCredit` |
| write all `ve` | `for (const msg of newMessages)` |
| `sHe` | existing `updateUsage`（>0 input guards 已对齐） |

测试：`streamCostCredit.214.test.ts`

## 状态

- **#38 HAVE**
