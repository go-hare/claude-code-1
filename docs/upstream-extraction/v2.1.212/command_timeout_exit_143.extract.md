# densable 2.1.212 — #30 false "Command timed out" on exit 143

Changelog (partial):

> Fixed … and false "Command timed out" on exit code 143

(Other #30 sub-items: @-mention partial read, plugin uninstall marketplace — separate.)

## densable ShellCommand `#w` (handleExit)

```js
let t = this.#e === "killed"  // wasKilled BEFORE status flip
if (this.#e === "running" || this.#e === "backgrounded") this.#e = "completed"
// ...
interrupted: t && e === Xzn  // Xzn=137 SIGKILL
// ...
if (this.#s) o(`Command killed: output file exceeded ${Vzn}`)
else if (t && e === e2c) o(`Command timed out after ${Ms(this.#d)}`)  // e2c=143
// only when wasKilled && 143 — not every exit 143
```

Constants: `Xzn=137`, `e2c=143`. Timeout path: `static #m` → `#C(e2c)` sets status `killed` then resolves 143.

## Local alignment

| densable | local | status |
|----------|-------|--------|
| wasKilled gate on timeout message | `#handleExit` `wasKilled && code === SIGTERM` | **HAVE** |
| interrupted only killed+137 | `wasKilled && code === SIGKILL` | **HAVE** |
| timeout `#doKill(143)` | `#handleTimeout` → `#doKill(SIGTERM)` | **HAVE** (pre-existing) |

## Related

- `src/utils/ShellCommand.ts`
- `src/utils/__tests__/ShellCommand.timeout143.212.test.ts`
