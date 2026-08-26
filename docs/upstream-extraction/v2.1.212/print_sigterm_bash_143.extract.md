# densable 2.1.212 — #10 print/SDK SIGTERM + Bash process tree + exit 143

Changelog:

> Fixed SIGTERM during a running Bash tool orphaning the command's process tree in print/SDK mode; the CLI now aborts the turn, kills the tree, and exits 143

## densable print `run()` signal handlers (`o5f` / print.ts)

```js
// SIGINT (ae):
if (B && !B.signal.aborted) B.abort(nC('user-cancel'))
V.abort()
Ts(0) // gracefulShutdown(0)

// SIGTERM (se):
if (B && !B.signal.aborted) B.abort(nC('remote-cancel'))
V.abort()
Ts(143) // gracefulShutdown(143)

process.on('SIGINT', ae)
process.on('SIGTERM', se)
uxs() // markPrintModeSignalHandlersRegistered → Vwo = true
```

- `B` = per-turn query `AbortController` (local `abortController`)
- `V` = session-level abort (`Oc(500)` max listeners) used for control/request paths
- `nC` = densable `createAbortErrorReason` (cached `DOMException AbortError`)
- Abort of `B` propagates into BashTool `exec(..., abortSignal)` → `ShellCommand` abort handler → `killProcessTree` / `treeKillNoFlash`

## densable global `setupGracefulShutdown` (`dxs`)

```js
let Vwo = false
function uxs() {
  Vwo = true
}

process.on('SIGINT', () => {
  if (Vwo) return
  Ts(0)
})
process.on('SIGTERM', () => {
  // diagnostics: uptime_s, ppid_changed, stdin_at_eof, stdin_destroyed, is_tty
  if (Vwo) return
  Ts(143)
})
```

Without `Vwo`, global SIGTERM called `Ts(143)` **without** aborting the query AbortController → Bash children orphaned.

## Local alignment

| densable | local |
|----------|-------|
| `uxs` / `Vwo` | `markPrintModeSignalHandlersRegistered` / `printModeSignalHandlersRegistered` |
| print SIGTERM se | `sigtermHandler` in `print.ts` → abort `remote-cancel` + `gracefulShutdown(143)` |
| print SIGINT ae | `sigintHandler` → abort `user-cancel` + `gracefulShutdown(0)` |
| global skip when Vwo | `setupGracefulShutdown` SIGINT/SIGTERM early return |
| `killProcessTree` on abort | existing `ShellCommand` + `treeKillNoFlash` (210) |
| exit 143 | `gracefulShutdown(143)` |

## Out of scope / related

- #30 false “Command timed out” on exit 143 (separate; `e2c=143` timeout code vs kill)
- densable session-level `V=Oc(500)` full wiring beyond query abort (control paths already use local abort)
