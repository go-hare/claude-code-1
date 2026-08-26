# densable 2.1.212 — Xyr full respawn ceremony

Source: SEA `claude.exe` 2.1.212 (`async function Xyr` @ 243542281).

## Call graph

```
Xyr(short, opts?)
  ka(jobDir)                     // read state
  hLp(daemonShort)               // alive probe
  [if alive && !force] → already running
  [if exec expired && !force] → exec_output_expired
  D9e(short, state) | parallel Yia when daemonUp&&!alive&&!present
  wait gLp(short) clear ≤3s
  IAe(resumeId, cwd, linkScanPath)  // NPn probe
  [!hasMessages && none && same session && !force && !forceRefusalRetry]
      → refuse + gpn(initialPrompt)  // NO BJe
  [!hasMessages otherwise]
      → BJe(path) quarantine
  [R = hasMessages && !exec]
      → Zxe(resumeId) resume_session_live_elsewhere
  $ = initialPrompt ?? queuedPrompt ?? (w||N ? void : intent)
  D = [...R?--resume: [], flags, ...$?-- $:[]]
  xSe(D, sessionId, "fleet", cwd, meta, bridge, short)
  success → state patch queuedPrompt:void 0
```

## Symbols

| Sym | Role |
|-----|------|
| `hLp` | `op:has` → `{alive, present, daemonUp}`; fallback roster pid probe `Gyr` |
| `gLp` | present-only poll after kill |
| `D9e` | `op:kill` (+ESTARTING retry); ENOJOB/ENOCONN → `Yia` SIGTERM fallback |
| `Yia` | scan live bg sessions by jobId/session prefix; SIGTERM + wait |
| `Zxe` | `listAllLiveSessions`; conflict if same sessionId other non-interactive pid |
| `xSe`/`Uq_` | spawn ceremony (local `dispatch`+`seedJobState` subset) |
| `gpn` | `queuedPrompt` write |
| `$` | prompt selection (see gpn consume) |

## Local mapping (go-hare)

| densable | local |
|----------|-------|
| hLp | daemon `case 'has'` + client `sendControlRequest({op:'has'})` |
| D9e | daemon `case 'kill'` + client kill with ESTARTING retry / Yia-lite |
| Zxe | `listAllLiveSessions` from `udsClient` |
| IAe/NPn/BJe/gpn/$ | `transcriptProbe` + bgManager dispatch gate (**done**) |
| xSe | `handleDispatch` / spare claim / cold spawn |

## Gaps closed by client preflight (this batch)

AgentView ENOJOB path before dispatch:

1. `has` → if alive && !force → "already running"
2. if !force: `kill` + wait present clear (≤3s) with unconfirmed bail
3. Zxe conflict when resume has messages
4. then existing gate + `$` + dispatch
