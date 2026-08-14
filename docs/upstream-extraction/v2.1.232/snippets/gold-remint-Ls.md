# densable 2.1.232 #39 — remint onClose `Ls` gold

Extracted from SEA `claude.exe` 2.1.232.

## Constants

```js
yjp=3, _jp=3600000, bjp=24*yjp, yuv=24*_jp, _uv=600000
vjp=30000, Sjp=300000, Ejp=5000, buv=14
vuv="could not reach the Remote Control server for about 30 minutes"
wjp="the connection to the Remote Control server kept dropping after each reconnect"
Ajp=`the connection to the Remote Control server dropped more than ${bjp} times in 24 hours`
Tjp={attempts:buv, exhaustedDetail:vuv}
// leak ceiling
So=init_retry_max_attempts*http_timeout_ms+(init_retry_max_attempts-1)*init_retry_max_delay_ms
Qn=oauth_retry_base_delay_ms*(2**oauth_retry_max_attempts-1)+oauth_retry_max_attempts*So
ms=2*(15000+So+Qn)  // default cfg → 362000
si=3  // consecutive recovery cap
yt=3, Wt=3600000, Zr=5000  // epoch_stale budget + jitter
```

## `kjp` heartbeat budget

```js
function kjp(){
  let e=[], t=Number.NEGATIVE_INFINITY
  return {
    charge(r,n){
      e=e.filter(i=>r-i<yuv)
      if(n&&e.length>=bjp)return"daily_exhausted"
      if(pr(e,i=>r-i<_jp&&(!n||i>=t))>=yjp)return"hourly_exhausted"
      return e.push(r),"charged"
    },
    noteHealthyBeat(r){
      let n=e.at(-1)
      if(n!==void 0&&r-n>=_uv)t=r
    }
  }
}
```

## Flag helpers

```js
function Xn(){return wn++,sn=wn,Tr=!0,Fi=Date.now(),zi=!1,sn} // raise
function To($t){if(sn!==$t)return!1;return sn=0,Tr=!1,Fi=0,!0}
function Vo(){sn=0,Tr=!1,Fi=0} // force clear (leak)
```

## `Ls($t, Jr, qo=!1)`

```js
function Ls($t,Jr,qo=!1){
  let Si=!1
  clearTimeout(Qf)
  if(Uo)return!1
  if(!qo)w(`[remote-bridge] v2 transport closed (code=${$t})`),
    N("tengu_bridge_repl_ws_closed",{code:$t,v2:!0,close_cause:Co(Jr),recovery_in_flight:Tr})
  if(Tr){
    let tu=Fi?Date.now()-Fi:0
    if(tu<=ms)return Ei={code:$t??4092,cause:Jr},!1 // DEFER
    w(`authRecoveryInFlight held …s (> ceiling …s) — treating as leaked…`,{level:"error"})
    xr("error","bridge_repl_v2_recovery_flag_leaked"),Vo(),Ei=void 0,Si=!0
  }
  if(kd($t)){
    if(_o>=si){ Ds(`Transport recovery exhausted (code ${$t})`); return!1 }
    if($t===4094&&!qo){ if(Ws>=si){…cred_recovery_exhausted…;return!1} Ws++ }
    if($t===4093&&!qo){
      switch(Ua.charge(Date.now(),ut())){
        case"hourly_exhausted":case"daily_exhausted": Ds(wjp|Ajp); return!1
        case"charged":break
      }
    }
    // 4090 epoch_stale + Ot(): Ba hour window yt=3, nn(4090, random*Zr)
    return _o++, nn($t), !1
  }
  // fail Ds(...)
}
```

## Local 1:1 map

| densable | local |
|----------|--------|
| `Ls` | `handleTransportClose` in `remoteBridgeCore.ts` |
| `dispose` pre-budget | `disposeTransportClose` → ignore/defer/leak/recover/fail |
| `ms` | `computeRecoveryLeakCeilingMs(cfg)` |
| `Ua`/`kjp` | `createHeartbeatRecoveryBudget` |
| budgets | `evaluateRecoverableCloseBudgets` |
| `Ei` | `deferredClose: {code,cause}` |
| `Tr`/`Fi`/`Vo` | `authRecoveryInFlight`/`recoveryStartedAtMs`/`clearRecoveryFlag` |
| `nn` | `recoverFromCloseCode(code, delayMs?)` |
| `oa`/`Tjp` | `CLOSE_CODE_RECOVERY` / `HEARTBEAT_4093_REMINT_CAP` |
