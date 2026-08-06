# densable 2.1.214 Batch E — #39 advisor thinking 误报 "check your network"

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

advisor server_tool 思考期间，SSE 事件层可能长时间无 text/token 增长，旧 UI 用 token silence / 3s red spinner 或误报网络 stall 文案 **check your network**。

## densable 证据

### 字节时钟 s8h + `_chunkTimes`

```js
// FMh wrap:
let _={lastAt:0}, v=new Response(s8h(u.body,g,y,_),u);
Object.defineProperty(v,"_chunkTimes",{value:_});

// s8h pull:
if(n) n.lastAt=performance.now();
```

### stall 调度（query 主环）

```js
Avs=20000, gSy=90000
Rn = at?._chunkTimes
la = performance.now()
dt = Math.min(JUi(vn()), Te?Ke:Infinity)
Gt = Math.min(gSy, dt-Avs)

ss = () => {
  if (!onRetryStatus || !Rn) return
  let Yo=Rn.lastAt, sl=performance.now()
  Uo=setTimeout(()=>{
    if (performance.now()-sl < Avs/2) return
    if (Rn.lastAt > Yo) { ss(); return }
    let hl = performance.now()-Rn.lastAt
    if (Vr && hl < Gt) { ss(); return }
    let Ss = Rn.lastAt===0 ? performance.now()-la : hl
    qo=!0
    onRetryStatus({kind:"stalled", deadline: Date.now()+Math.max(0,dt-Ss)})
  }, Avs)
  Uo.unref?.()
}
```

### advisor 门闩 Vr

```js
// content_block_start server_tool_use name==="advisor" → Vr=!0
// content_block_start advisor_tool_result → Vr=!1
```

### UI Msn

```
yxe.kind==="stalled"
→ "Waiting for API response" · will retry in {n4s} · check your network
```

## 本地落地

| densable | 本地 |
|----------|------|
| s8h `n.lastAt` + `_chunkTimes` | `bodyIdleWatchdog` `createBodyChunkTimes` / wrap 4th arg / `rewrapResponseWithBody` defineProperty |
| `at._chunkTimes` | `getResponseChunkTimes(streamResponse)` in `claude.ts` |
| Avs/gSy/dt/Gt + ss | `advisorNetworkStall.ts` + `claude.ts` `scheduleNetworkStallPoll` |
| Vr | existing `isAdvisorInProgress` |
| onRetryStatus | `Options.onRetryStatus` ← `ToolUseContext.setRetryStatus` ← REPL state |
| Msn UI | `SpinnerAnimationRow` when `retryStatus.kind==="stalled"` |

## 状态

- **#39 HAVE**
