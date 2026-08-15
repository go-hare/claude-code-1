# densable 2.1.232 #39 — remint / onClose `Ls` gold

Source: SEA `%LOCALAPPDATA%/Temp/official-232/plat/package/claude.exe`
sha256 `ec9e32479bc887809003c91384c6c3a26e7691856d1916f72f6f6d21800f3bd6`

## Constants

```js
var yjp=3,_jp=3600000,bjp,yuv,_uv=600000,
  vjp=30000,Sjp=300000,Ejp=5000,buv=14,
  vuv="could not reach the Remote Control server for about 30 minutes",
  wjp="the connection to the Remote Control server kept dropping after each reconnect",
  Ajp,Tjp;
// xjp init:
// bjp=24*yjp, yuv=24*_jp,
// Ajp=`the connection to the Remote Control server dropped more than ${bjp} times in 24 hours`,
// Tjp={attempts:buv,exhaustedDetail:vuv}
```

Heartbeat budget `kjp()`:
- `charge(now, patience)` → `hourly_exhausted` | `daily_exhausted` | `charged`
- hourly window `_jp=1h`, cap `yjp=3`
- daily window `yuv=24h`, cap `bjp=72` (when patience)
- healthy baseline via `noteHealthyBeat` when gap ≥ `_uv=600000`

Leak ceiling:
```js
So = init_retry_max_attempts*http_timeout_ms
   + (init_retry_max_attempts-1)*init_retry_max_delay_ms
Qn = oauth_retry_base_delay_ms*(2**oauth_retry_max_attempts-1)
   + oauth_retry_max_attempts*So
ms = 2*(15000+So+Qn)
// defaults → 362000
```

Other:
- `si=3` general consecutive recovery cap (`_o`)
- `Ws` 4094 without healthy beat cap `si=3`
- `yt=3`, `Wt=3600000` epoch_stale re-registrations/hour
- `Zr=5000` epoch_stale recovery jitter upper bound
- oauth defaults: `oauth_retry_max_attempts:3`, `oauth_retry_base_delay_ms:2000`

## `function Ls($t,Jr,qo=!1)`

```js
function Ls($t,Jr,qo=!1){
  let Si=!1;
  clearTimeout(Qf);
  if(Uo)return!1;
  if(!qo)w(`[remote-bridge] v2 transport closed (code=${$t})`),
    N("tengu_bridge_repl_ws_closed",{code:$t,v2:!0,close_cause:Co(Jr),recovery_in_flight:Tr});
  if(Tr){
    let tu=Fi?Date.now()-Fi:0;
    if(tu<=ms)return Ei={code:$t??4092,cause:Jr},!1; // DEFER
    w(`authRecoveryInFlight held … (> ceiling …) — treating as leaked…`,{level:"error"}),
    xr("error","bridge_repl_v2_recovery_flag_leaked"),Vo(),Ei=void 0,Si=!0; // LEAK force
  }
  if(kd($t)){
    if(_o>=si){ /* recovery_exhausted */ return!1 }
    if($t===4094&&!qo){ if(Ws>=si){ /* cred_recovery_exhausted */ return!1 } Ws++ }
    if($t===4093&&!qo){
      let tu=Ua.charge(Date.now(),ut());
      switch(tu){
        case"hourly_exhausted":case"daily_exhausted": /* heartbeat_budget_exhausted */ return!1
        case"charged":break
      }
    }
    // 4090+epoch_stale+Ot(): Ba window, yt cap, nn(4090, Math.random()*Zr)
    return _o++,nn($t),!1
  }
  // fail Ds(...)
}
```

## Local mapping

| densable | local |
|----------|-------|
| `Ls` | `handleTransportClose` in `remoteBridgeCore.ts` |
| pre-gate | `disposeTransportClose` (`ignore`/`defer`/`leak`/`fail`; recover unused) |
| `kd` | `isRecoverableCloseCode` — **no bare 4090** |
| kd budgets | `evaluateRecoverableCloseBudgets` |
| `4090+epoch_stale+Ot` | `isEpochStaleRecoverableClose` + `evaluateEpochStaleRecoveryBudget` |
| `Ot` | GB `tengu_bridge_recover_stale_epoch` default **false** |
| `ut` | GB `tengu_bridge_recovery_patience` default true |
| `Ua=kjp()` | `createHeartbeatRecoveryBudget` |
| `ms` | `computeRecoveryLeakCeilingMs(cfg)` |
| `Tr/Fi/Vo` | `authRecoveryInFlight` / `recoveryStartedAtMs` / `clearRecoveryFlag` |
| `Ei` | `deferredClose: {code, cause}` (not cleared on rebuild) |
| `ul` + th `_o=0` | `onHealthyTransport` on `setOnConnect` |
| `nn` | `recoverFromCloseCode(code, delayMs?)` (simplified vs densable) |
| `oa` | `CLOSE_CODE_RECOVERY` |
| `Tjp` | `HEARTBEAT_4093_REMINT_CAP` |

Tests: `src/bridge/__tests__/remintRecovery.232.test.ts`

## Status (checklist #39)

- **PARTIAL** — densable `nn` + `G7` closer:
  - `Ls` gate / budgets / leak / `ul`+`_o` onConnect: **HAVE**
  - `Xn/To/Vo` recovery flight ownership: **HAVE**
  - OAuth adopt loop + reauth detail: **HAVE**
  - remintCap gated by `ut()` patience: **HAVE**
  - **G7/zNn/Dm** teleportedSessionIds + remint/rebuild suppress: **HAVE**
    - `markTeleportedSessionId` / `isTeleportedSessionId` / `clearTeleportedSessionId`
    - writers: `setTeleportedSessionInfo`, `teleportToRemote` success
    - readers: `recoverFromCloseCode` entry + mid-loop; `rebuildTransport` → `suppressed_teleported`
- **Hde/mdt + gzp (HAVE this pass)**
  - `fetchRemoteCredentials` → `BridgeCredentialResult` (`terminal:!0/!1` | creds | null)
  - `isNonTerminalBridgeFailure` / `isTerminalBridgeFailure` / adopt + late-refresh paths
  - `CLASSIFIED_CLOSE_REASON_CODES` gzp; CCRClient `onEpochMismatch(reason)`; transport `setOnClose(code, cause)`
- **Still residual**
  - no `remoteBridgeCore` integration tests yet (defer/leak/stale gen e2e)
