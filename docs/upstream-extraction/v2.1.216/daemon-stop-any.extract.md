# densable 2.1.216 — `claude daemon stop --any` (1:1)

> **id:** `daemon-stop-any` · Changelog #11  
> **Status:** **HAVE**  
> SEA: case `"stop"` ~239390058; lock helpers ~233686179; wUs/AUs ~231090715  
> Deep dig: `DEEP-1TO1.md` · dumps: `runtime-daemon-stop-fn.txt`, `daemon-stop-any.*`, `daemon-stop-any.wUs.raw.txt`

---

## 1. Product intent (changelog)

> Fixed `claude daemon stop --any` potentially terminating an unrelated process via a stale legacy daemon lockfile.

---

## 2. densable binary proof

| Needle | Hit | Offset | Notes |
|--------|-----|--------|-------|
| `daemon stop --any` | true | 124423173 | user hints + help |
| `also stop a transient` | true | 71526599 | help under stop |
| `legacy` | thin | — | changelog-only; fix is verification gate |
| `stale` | true | 239392700 | stale lock note |
| `lockfile` | true | 233686179 | `daemon.lock` / UTe |
| `async function wUs` | true | 231090715 | client bg reap |
| `async function AUs` | true | 231091950 | pid identity kill |
| `could not be verified as still ours` | true | 148977073 | kept note |

---

## 3. Cleaned densable schema / strings

### CLI

```text
claude daemon stop [--any] [--keep-workers]
stop  Shut down the supervisor and terminate background sessions
  --any           also stop a transient (non-service) daemon
  --keep-workers  leave detached sessions running
```

### User-facing strings (exact densable)

1. Gate verified, no service, no `--any`:  
   `no background service is installed, but a daemon is running (pid=${pid}, origin=${origin|unknown}). Run \`claude daemon stop --any\` to stop it.`

2. Gate unverified holder:  
   `no background service is installed, but pid=${pid} is holding the daemon lock. Run \`claude daemon stop --any\` to stop any background sessions and report on the holder.`

3. Unverified after fallback (`daemon_stop_holder_unverified`):  
   `(optional: terminated N background session(s); )the daemon was not stopped: pid=${pid} is holding ${daemon.lock path} but could not be verified as the daemon, so it was not signalled. If no daemon is running, delete that file; if pid ${pid} is a live process you own, stop it yourself.`

4. Stale note:  
   `note: ${daemon.lock path} is stale (pid=${pid} is not the daemon). The next daemon start reclaims it automatically.`

5. Success / empty: `stopped` | `stopped (terminated N background session(s))` | `no daemon running` | next-start note for `!service`

6. Windows supervisor still up: optional terminated prefix + taskkill instruction.

7. Reap kept warning:  
   `note: N background session(s) could not be verified as still ours and was/were left running (records kept). Re-run \`claude daemon stop\` to retry.`

8. LFp hint: `Stop it with \`claude daemon stop --any\` (a graceful, socket-based stop); if nothing is running at that pid, delete ${G5()}`

### Lock schema (UTe)

- Path: `<configDir>/daemon.lock`
- Loose read: `{ pid: number, version: string, startedAt?: number, origin?, procStart?, … }`
- **DSr** signalable: `procStart !== undefined`
- **hk** alive: kill0 + vhn cmdline + vla(procStart)

### Telemetry

- `tengu_daemon_control` `{ op_stop, ok, reaped, holderUnverified }`
- metrics: `daemon_stop` / `daemon_stop_failed` / `daemon_stop_holder_unverified`

---

## 4. Cleaned densable runtime

```js
async function daemonStop(args) {
  const keepWorkers = args.includes('--keep-workers');
  LTt(args, ['--keep-workers', '--any']); // warn extras

  const serviceInstalled = await oEe();
  const alive = await hk(); // UTe + kill0 + cmdline + procStart
  let verified = alive && DSr(alive) ? alive : null; // DSr: procStart !== undefined
  let holder = alive;
  let stalePid;

  if (!holder) {
    const raw = await UTe(); // loose: pid+version only
    if (raw && rR(raw.pid)) {
      const cmdlineOk = await vhn(raw.pid);
      const liveStart = cmdlineOk ? await l0(raw.pid, { skipCache: true }) : undefined;
      const bothHaveStart = raw.procStart !== undefined && liveStart !== undefined;
      if (!cmdlineOk || (bothHaveStart && liveStart !== raw.procStart)) {
        stalePid = raw.pid; // DO NOT signal
      } else if (bothHaveStart) {
        verified = holder = raw;
      } else {
        holder = raw; // live, unverified — report, no SIGTERM
      }
    }
  }

  // Gate: without service, refuse unless --any
  if (!serviceInstalled && holder && !args.includes('--any')) {
    // exact verified vs unverified stderr → exit 1
  }

  // Preferred: control socket shutdown
  const shut = await TC({ proto: PROTO, op: 'shutdown', reapWorkers: !keepWorkers });
  if (shut.ok && shut.op === 'shutdown') {
    const w = keepWorkers ? { reaped: 0, kept: 0 } : await wUs({ supervisorKilledAll: true });
    u(w.kept); // kept note
    const reaped = Math.max(shut.reaped, w.reaped);
    // service stop if installed; success
  }

  // Fallback:
  // serviceInstalled → t_n only
  // else if verified && !win32 → SIGTERM verified.pid only
  // never SIGTERM unverified
  // then wUs() unless keepWorkers
  // win32 verified → taskkill fail path (prefix terminated count)
  // !stopped && !verified && holder → holder_unverified fail
  // stalePid note; fmtStopped / no daemon running
}

async function wUs(e = {}) {
  // load roster.workers → Map short → {pid,procStart,ptySock,dispatch}
  // scan pty dir (.sock) or win pty-pids (.pid); orphan sidecars unlink
  // spare *.pty.sock not in known → spare:name targets
  // for each: bNt(ptySock) kill frame OR AUs(pid,procStart)
  // unverified → kept (skip roster delete)
  // else mark job via PIt + cleanup; delete workers not in kept
  return { reaped, kept }
}

async function AUs(pid, procStart) {
  // kill0; ESRCH → uLe → killed|gone; other → foreign
  // missing procStart → foreign
  // unreadable start (retry 250ms) → unverified
  // mismatch → foreign; match → uLe → killed|gone
}

function DSr(lock) { return lock.procStart !== undefined; }
async function UTe() { /* lstat file size<=65536; pid number + version string */ }
async function vhn(pid) {
  // /proc/pid/cmdline: parts[0]==='claude daemon' || slice(1,4).includes('daemon')
  // unreadable → true
}
```

### Mangled symbols

`LTt`, `oEe`, `t_n`, `hk`, `UTe`, `G5`/`DFp`, `DSr`, `vhn`, `vla`/`l0`, `rR`, `TC`, `wUs`, `AUs`, `bNt`, `uLe`, `PIt`, `QRe`, `bPo`, `LFp`, finish/telemetry helpers

---

## 5. go-hare land status (post-216)

| Path | Status |
|------|--------|
| `src/daemon/main.ts` `handleDaemonStop` | **HAVE** — densable order; control + fallback; `Math.max`; kept note; win32/holder prefixes |
| `src/daemon/daemonLock.ts` | **HAVE** UTe loose + DSr + classify + hk |
| `src/daemon/serviceInstall.ts` | **HAVE** `stopDaemonService` (t_n) |
| `src/daemon/controlSocketClient.ts` | **HAVE** transport shutdown |
| `src/daemon/clientBgReap.ts` | **HAVE** wUs/AUs/bNt/uLe + kept note |
| `src/daemon/bgWorker.ts` killPtyHost | **HAVE** densable bNt close + sidecar cleanup |
| tests | **HAVE** `daemonStop.216`, `readDaemonLockLoose.216`, `daemonStopReap.216` |

---

## 6. 1:1 implement steps (done)

1. CLI surface: `--any`, `--keep-workers` (LTt warn extras); help lines exact.
2. `readDaemonLockLoose` = UTe; DSr = procStart defined; hk classify.
3. handleDaemonStop densable order + no-service gate.
4. Control `shutdown` + client `wUs({supervisorKilledAll})` unless keepWorkers; `Math.max`.
5. Fallback service/SIGTERM then `wUs()`; holder_unverified / win32 prefixes with reaped.
6. Port wUs/AUs kill policy (foreign/unverified/kept).
7. Telemetry + tests; `bun run precheck`.

---

## 7. Tests

- No service + transient without `--any` refuses.
- `--any` + verified control/SIGTERM.
- Legacy lock live unrelated pid never SIGTERM.
- Stale note path.
- `holder_unverified` exit 1.
- `--keep-workers` skips client reap (code path).
- UTe accepts pid+version without startedAt; rejects size>65536.
- Help includes `--any` / `--keep-workers`.
- AUs: missing/mismatch procStart → foreign; dead → gone/killed.
- wUs: empty → 0/0; orphan sidecar unlink; foreign not killed + job stopped; supervisorKilledAll marks stopped.

---

## 8. Risks / do-not-simplify

- Local PID-only stop is the **exact** stale-legacy kill risk fixed in 2.1.216.
- hk treats any kill0 throw as dead (incl EPERM) — intentional for alive-read.
- vhn true when cmdline unreadable (macOS/Windows rely on procStart); locks without procStart non-signalable.
- AUs: missing procStart ⇒ **foreign** (never SIGTERM live pid).
- Windows never process.kill supervisor; client still reaps workers via sock/pid files.
- Do not invent RemoteSessionManager-style permission redelivery here (orthogonal #5).
