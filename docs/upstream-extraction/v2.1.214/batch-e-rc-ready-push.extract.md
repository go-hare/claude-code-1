# densable 2.1.214 Batch E — #31 RC "session ready" push 门闩

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

Remote Control **未显式启用**（或仅 mirror / reattach / bg / teammate）时，仍可能向手机发 **"session ready"** push。

## densable 证据

### nZp — config

```js
function nZp(){
  if(!I0e())return null  // tengu_kairos_push_notifications
  let e=et("tengu_kairos_ready_nudge",null)
  if(e===!0)return{probability:1,maxImpressions:5,impressionKey:""}
  if(e===null||typeof e!=="object")return null
  // clamp probability [0,1], trunc maxImpressions default 5, string impressionKey
  return{probability:t,maxImpressions:r,impressionKey:n}
}
```

### oZp — gate

```js
function oZp(e,t,r){
  if(!t||r)return!1              // !explicitRC || outboundOnly|reattach
  if(ts()||L$()!=null)return!1   // isBg || agentId
  if(e.maxImpressions===0)return!1
  if(e.maxImpressions<0)return!0 // unlimited
  let n=bt()
  return((n.remoteControlReadyPushKey??"")===e.impressionKey
    ?n.remoteControlReadyPushCount??0:0)<e.maxImpressions
}
```

### iZp — counter + tip event

```js
function iZp(e){
  if(e.maxImpressions>=0)pr((t)=>{...remoteControlReadyPushCount/Key...})
  Ae("tips_rc_ready_push_send")
}
```

### bzu / YQp

```js
YQp="Your Claude Code session is ready — continue from your phone anytime."
function bzu(e,t){
  return{type:"assistant",message:{...,model:J0/*"<synthetic>"*/,
    content:[{type:"tool_use",name:Hty/*PushNotification*/,
      input:{message:e,status:"proactive"}}]},
    parent_tool_use_id:null,is_meta:!0,session_id:t,uuid:...}
}
```

### connected 调用点（useReplBridge 等价）

```js
// A.current = user activity while handle exists (Dkr=toi.subscribe)
// w.current = already-sent this connect cycle
// we = replBridgeExplicit; He = reattach (x.current)
case"connected":{
  ...
  if(zt&&!w.current&&!A.current){
    let vt=nZp()
    if(vt&&oZp(vt,we,He)){
      if(w.current=!0, vt.probability>=1||Math.random()<vt.probability)
        zt.writeSdkMessages([bzu(YQp,Et())]), iZp(vt)
    }
  }
}
```

注：`iZp` 与 `writeSdkMessages` 同在 probability 分支（逗号表达式 body）。

## 本地落地

| densable | 本地 |
|----------|------|
| nZp | `parseKairosReadyNudge` + `loadRemoteControlReadyNudgeConfig` |
| oZp | `shouldSendRemoteControlReadyPush` / `…Live` |
| iZp | `nextReadyPushImpressionState` + `recordRemoteControlReadyPushSent` |
| bzu/YQp | `createReadyPushSdkMessage` / `REMOTE_CONTROL_READY_PUSH_MESSAGE` |
| Dkr/toi | `onInteraction` in `bootstrap/state.ts`（flush 时 emit） |
| GlobalConfig | `remoteControlReadyPushKey` / `remoteControlReadyPushCount` |
| useReplBridge connected | 门闩 + write + writeSdkMessages |

## 状态

- **#31 HAVE**
