# densable 2.1.212 — xSe / Uq_ spawn shell + JFa inFlight producer

Source: densable SEA `claude.exe` 2.1.212.

## xSe (client spawn ceremony)

```js
async function xSe(e, t, r = "shell", n, o, i, s) {
  let a = e6_(e)
  if (a) return { ok: false, error: a, reason: "gate_blocked" }
  let l = t ?? usa.randomUUID()
  let c = s ?? l.slice(0, 8)
  let u = nc(c) // jobDir
  try {
    await Pde.mkdir(dsa.join(u, "tmp"), { recursive: true })
    return await Uq_(e, r, n, o, i, {
      sessionId: l,
      short: c,
      jobDir: u,
      freshDir: t === undefined,
    })
  } catch (d) {
    if (r !== "fleet" && r !== "spare")
      await Pde.rm(u, { recursive: true, force: true }).catch(() => {})
    return {
      ok: false,
      error: `Couldn't start the session — ${ue(d)}`,
      reason: `spawn_failed_${Hp(d) ?? Ufe(d) ?? "unknown"}`,
    }
  }
}
```

### e6_ gate (argv)

- `--print` / `-p` → conflict with `--bg` (unattachable)
- `bypassPermissions` / `--dangerously-skip-permissions` without disclaimer accepted
- `--permission-mode auto` without opt-in

### Uq_ (build + seed + isa + rescue)

1. Parse argv → launch (exec | resume | prompt), env (providerEnv, permission rules, memory, forkSourceAlive), isolation
2. Shell: UNC path warning (Windows)
3. **Seed state** when `t !== "fleet" && t !== "spare"`:
   - freshDir → write full job state
   - existing + empty respawnFlags + new flags → patch respawnFlags
4. Build dispatch `X` + `isa(X)` (control `op:dispatch`)
5. On ok → `{ok:true, short, sessionId, idle, name}`
6. Rescue: `ack-timeout` | `enoconn` | `estarting`
   - list jobs: same short + nonce + !outcome → rescued ok
   - ack-timeout + short missing → redispatch with same nonce
7. short-alive / stale-short error shapes

### Uq_ argv peel (full)

Raw: `Uq_.raw.js`, `Uq_helpers.raw.js`, `Uq_peel_more.raw.js`

| densable | role |
|----------|------|
| `Qyr` | index of first non-value `--` |
| `yie` | value-index set (skip flag values) |
| `IUe` | peel short combined flags (`-cp` → `-c` + `-p`) |
| `r2o` | read long/short flag value |
| `WLp` | `--resume` / `-r` session id |
| `t6_` | last positional intent (skip resume id) |
| `n2o` | strip resume/continue/session-id/fork for respawnFlags |
| `GLp` | strip `--session-id` for prompt launch args |
| `VLp` | flags-only (drop bare positionals) before qat when no `--` |
| `qat` | allowlist filter for persisted respawnFlags (Hne/$Yr/zRt sets) |
| `sue`/`Xve` | UNC neutralize warn list (shell) |
| session-id warn | shell + explicit `--session-id` → stderr ignore warn |
| launch | exec \| resume(`S&&y`) \| prompt(`[...W,...GLp]`) |

Local: `src/daemon/uqArgvPeel.ts` + `xSeSpawn.buildDispatchRequest` peels when `argv` present; `handleBgStart` passes full `filteredArgs`.

## JFa / shs producer

```js
function JFa({ tasks: KFa }) {
  let FSn = W6e(KFa)           // count + kinds (+ session_cron)
  let YFa = PCt()              // command queue length
  let Abf = qe(Zjb)            // AppState.todos[sessionId]
  let Tbf = iFs()              // TaskCreate list (tasksV2)
  let XFa = [...VFa(KFa), ...qFa(Abf), ...zFa(Tbf)]
  let Xjb = AWt()              // turn token budget target (Fei)
  let Jjb = Xjb !== null ? { spent: vWt(), target: Xjb } : undefined
  useEffect(() => {
    shs({ tasks: FSn.count, queued: YFa, kinds: FSn.kinds, items: XFa, budget: Jjb })
  }, deps)
  return null
}
```

### W6e / Akd

```js
function c0(e) {
  // running|pending AND not (isBackgrounded===false)
}
function Akd(e) {
  return Object.values(e)
    .filter(c0)
    .filter(t => t.type !== "remote_agent" && t.type !== "dream")
    .filter(t => !(t.type === "monitor_ws" && t.ambient))
}
function W6e(e) {
  let t = Akd(e), r = aR().length // sessionCronTasks
  let n = unique(t.map(Tkd))
  if (r > 0) n.push("session_cron")
  return { count: t.length + r, kinds: n, ... }
}
function Tkd(e) {
  return isLocalBash(e) && e.kind === "monitor" ? "monitor" : e.type
}
```

### VFa / qFa / zFa

- **VFa**: map each task type → fan item(s); workflow expands `workflow_agent` progress rows; failed statuses `failed|cancelled|killed|error`
- **qFa(todos)**: `id: todo:${hash36(content)}`, kind todo, label activeForm when in_progress
- **zFa(tasksV2)**: `id: todo:${id}`, subject/activeForm

### Budget

- `vWt = LA() - $ei` → local `getTurnOutputTokens()`
- `AWt = Fei` → local `getCurrentTurnTokenBudget()`
- When target null → `budget: undefined` (shs full replace clears sticky budget)

### shs / u7u (already local)

- `shs(e){ t7r = e; ihs.emit() }` full replace
- u7u: empty items → keep prior fan; budget key via Xat
