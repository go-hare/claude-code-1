# densable 2.1.239 SEA — `#11` residual dig: `sXg` / `queueBehind` / DialogStore

SEA: `%TEMP%\official-239\package\claude.exe`  
Date: 2026-08-26  
Scope: **peel only** — invent-ban on tip port until this contract is accepted as a chunk.

## Verdict

| Layer | densable | tip today | 1:1? |
| --- | --- | --- | --- |
| Dual-Ink negotiation (Q2m/J2m/`$yf`/mSs) | HAVE | HAVE | yes |
| Same-Ink consent registration | `sXg(Gm)` → `cMl` | `installManagedSettingsRequester` | **shape only** |
| Dialog request API | `Bgp(kdy)` + `Qg` specs | `printRequestDialog` (print/SDK) + REPL local promise | **no** |
| Queue semantics | DialogStore `open(..., queueBehind)` | `focusedInputDialog` priority preempt | **no** |
| UI host | `NMs` + `jsu[GSn]→h2A→zko` | REPL `focusedInputDialog==='managed-settings'` | **no** |

→ **Superseded 2026-08-28**：NMs Host + mLo EQr landed → checklist `#11` **HAVE**. Still do **not** invent a half-`Bgp` or AppState field as “dialog host”.

---

## Call chain (钉死)

```
REPL mount:
  jd = useRef(kdy())           // mailbox: request/reply/subscribe/onCancel/onUpdate
  hLo(jd.current)              // mailbox → DialogStore (EK/Srs)
  Gm = useMemo(() => Bgp(jd.current), [])
  useEffect(() => sXg(Gm), [Gm])

sXg(Gm):
  return cMl((t,r) => Gm(GSn, s_A(t,r), { queueBehind: true })),
         () => cMl(null)

s_A(settings, updates):
  yield {settings}; for await (u of updates) yield {settings:u}

GSn = Qg({
  kind: "managed_settings_security",
  payload: z.object({settings: ...}),
  result: z.enum(["approved","rejected","deferred_no_consent_surface"]),
  default: "deferred_no_consent_surface",
})

Q2m → n.review(replRequester, settings)
  → replRequester = Gm(GSn, asyncIter, {queueBehind:true})
  → Bgp/$Ev → kdy.request({kind,payload},{queueBehind})
  → hLo → DialogStore.open(entry)
  → NMs reads dQc()=open.at(-1), jsu[GSn]=h2A → zko
  → answer(id, "approved"|"rejected") → kdy.reply → Bgp resolves
```

Standalone path (no REPL requester / no Ink wait) remains `mSs` / `nIe(...zko...)` — already tip-aligned.

---

## Pealed primitives

### `Qg` / `Bgp` / `NEv` / `$Ev` (offs≈305027200)

- `Qg(e){return e}` — identity typed dialog spec.
- `Bgp(store)` → async `(spec, payload|AsyncIterable, opts?)`.
- One-shot → `NEv`; streaming updates (`Symbol.asyncIterator`) → `$Ev` (`update` while awaiting `replied`).
- Parse fail / cancel / throw → `spec.default`.
- `opts.queueBehind` only forwarded on streaming `$Ev` request (managed-settings uses this arm via `s_A`).

### `kdy()` mailbox (offs≈323041865)

```js
function kdy(){
  // subscribe / onCancel / onUpdate emitters + pending Map
  request({kind,payload}, {signal, queueBehind}) → {id, replied, update}
  reply(msg) // resolves pending
}
```

### `bGl()` DialogStore (offs≈317898601)

```js
open(n){
  if (n.queueBehind && open.length>0) return {open:[n, ...open]} // under current top
  // else push end = become top; if stealing top, stamp swappedAt
}
update / answer / dismiss / dismissKind / onClosed
```

### AppStateProvider wiring (offs≈317951258)

```js
[Uwh] = useState(bGl)   // factory once
// ...
<Srs.Provider value={Uwh}>  // EK() = useDialogStore
```

Tip `AppStateProvider` has `MailboxProvider` only — **no** `Srs` / DialogStore.

### `hLo(channel)` (offs≈323220523)

Subscribe channel → `DialogStore.open`; cancel→`dismiss`; update→`update`; `onClosed`→`channel.reply`.

REPL calls `hLo(jd.current)` at mount; `NMs` also calls `hLo(channel)` when `channel` prop set (modal mount often omits channel — effect no-ops).

### `wrs` / `dQc` / `RPs`

- `wrs()` = top of `open` (`at(-1)`).
- `dQc()` = `wrs()` unless legacy suppress (`zIr()`).
- `RPs()` = `none|suppressed|visible` for modal chrome.

### `NMs` DialogHost (offs≈323218… / mount≈326537518)

```js
// REPL fullscreen modal slot:
ozs = KA ? {content: jsx(NMs,{variant:"modal"}), visible: wi==="visible"} : ...
// also inline: jsx(NMs,{}) near prompt stack
```

Host logic:

1. `Kse = dQc()`; null → null  
2. layout filter: `(layouts[kind]??"inline") !== variant` → null  
3. `Gsu = components[kind]`; missing → `dismiss`  
4. `answer` wraps `DialogStore.answer` with swap debounce (`c_y` vs `swappedAt`/`rau`)  
5. render `jsx(Gsu,{payload, answer})` (+ optional notification banner)

### kind registry `jsu` (managed-settings arm)

```js
h2A = ({payload, answer}) =>
  jsx(zko, {
    settings: payload.settings,
    onAccept: () => answer("approved"),
    onReject: () => answer("rejected"),
  })
jsu = { ...vM(GSn, h2A), ... }  // many other kinds
y2A[GSn.kind] = "dialog open"     // waitingFor / tab status string
```

Gold dump: `gold-dialog-host-render.txt`.

---

## tip map (honest)

| densable | tip | note |
| --- | --- | --- |
| `cMl` / `registerRequester` | `consentRequester.ts` `installManagedSettingsRequester` | HAVE for Q2m wait |
| `sXg(Gm)` | REPL `useEffect` + `setManagedSettingsReview` | **no** `GSn`/`queueBehind` |
| `Bgp`+`kdy` | `createPrintRequestDialog` (print kinds only) | interactive REPL **not** on this bus |
| `bGl`+`Srs`+`NMs`+`jsu` | `focusedInputDialog` + local queues | priority can **preempt** permission; densable **queues behind** |
| `h2A`→`zko` | same dialog component under `focusedInputDialog==='managed-settings'` | UI copy OK; host ≠ |

Peer UDS `usePeerInboundUdsDrain` documents a **local** `queueBehind` substitute for one slot — not DialogStore.

---

## Invent-ban / port gate

Full 1:1 `#11` host requires a **chunk**, not a patch:

1. `bGl` + `Srs` on `AppStateProvider` (gold: `useState(bGl)`)
2. `kdy` + `Bgp` + `Qg` + `hLo`
3. `NMs` + at least `jsu[GSn]=h2A` (porting full `jsu` = many kinds — peel each before claiming)
4. REPL: `sXg(Gm)` + modal `NMs` mount; retire `managedSettingsReview` / focusedInputDialog branch
5. Keep default interactive `void loadRemoteManagedSettings()` (densable does not await)

**Closed 2026-08-28**：`#11` **HAVE**（dual-Ink + NMs product openers + mLo EQr）。ConsentRow brand / form elicitation / worker-sandbox 仍 invent-ban 或金标 focused，不挡 #11。

## Snippet files

| file | content |
| --- | --- |
| `gold-bgp-qg.txt` | `Qg`/`Bgp`/`NEv`/`$Ev` raw |
| `gold-dialog-store.txt` | mailbox/store vicinity |
| `gold-dialog-host-EK.txt` | `EK`/`wrs`/`Srs` |
| `gold-dialog-host-render.txt` | `jsu`/`h2A`/`NMs` |
| this file | dig contract |
