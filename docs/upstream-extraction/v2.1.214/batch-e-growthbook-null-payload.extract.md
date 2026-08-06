# densable 2.1.214 Batch E — #15 GrowthBook null / 畸形 payload

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

1. feature 评估结果为 **null** 时调用方可能崩溃或拿到错误类型  
2. remote-eval payload 中 **null / 非 object / value-less / 畸形 experiment** 条目若整表写入，会 **清空磁盘缓存**（flag blackout）

## densable 证据

### nji — null → default

```js
function nji(e,t){return e===null?t:e}
// LUc: s = nji(Ble.get(e), default)
```

### RUc — processRemoteEvalPayload

```js
async function RUc(e){
  let t=e.getPayload()
  if(!t?.features||Object.keys(t.features).length===0) return !1
  // skip null / non-object → i[]
  // skip malformed experiment → s[]
  // skip value===undefined → l[]  (null value is KEPT)
  if(a.size===0) return !1   // do not wipe prior maps/disk
  await e.setPayload({...t, features:o})
  if(mMe!==e) return !1
  // only then clear Trt/G8n/Ble and replace
  return !0
}
// one-shot logs: QBi/ZBi/eji
```

## 本地落地

| densable | 本地 |
|----------|------|
| nji | `coalesceNullFeatureValue` — `getFeatureValueInternal` + `_CACHED_MAY_BE_STALE` |
| RUc skip/no-wipe | `processRemoteEvalFeatures` pure + `processRemoteEvalPayload` 委托 |
| QBi/ZBi/eji | `loggedSkippedNonObjectFeatures` 等；`resetGrowthBook` 在 `!preserveLoggedExposures` 时清 |

## 状态

- **#15 HAVE**
