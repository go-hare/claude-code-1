# densable 2.1.216 — bg subagent startup cancel immunity (1:1)

> **id:** `bg-startup-cancel` · Changelog #15  
> **Status:** **HAVE** (L(G&&!B) + post-setup abort gate + independent async abort; landed 2026-08-06)  
> SEA: `/tmp/official-216/plat/package/claude`

---

## 1. Product intent (changelog)

> Fixed background subagents getting cancelled when a high-priority message arrives during their startup window

High-priority / submit-interrupt aborts the **parent** turn with reason `"interrupt"` (`REPL` `priority==='now'`, `handlePromptSubmit`). Background subagents must still complete spawn registration during the pre-`Flt` startup window.

---

## 2. densable binary proof

| Needle | Hit | Notes |
|--------|-----|-------|
| `&&Me==="interrupt"` | 1 | L(Me) body |
| `G&&Me==="interrupt"` | 1 | post-setup gate before Flt |
| `parentAbortController` | 5 | Flt / MCP auto-bg / resume |
| `function Flt({agentId` | 1 | async task register; `c?JG(c):Bc()` |
| `function q_(e)` | 1 (abort helper) | DOMException AbortError → `.message` |
| `CLAUDE_BG_STARTUP_WEDGE_MS` | true | **False lead** — bg *job* stuck-on-startup-dialog, not #15 |

---

## 3. densable runtime (cleaned)

### Abort reason (`q_`)

```js
function q_(e) {
  return e instanceof DOMException && e.name === "AbortError" ? e.message : e
}
```

### Spawn-slot L(Me) — densable N()

```js
let L = (Me = false) => {
  if (l.abortController.signal.aborted) {
    let Ze = q_(l.abortController.signal.reason)
    if (!(Me && Ze === "interrupt")) throw new wl // AbortError family
  }
  // cap check + incrementTotalAgentSpawns
}
// ...
let B = j === "remote" // isolation remote
let G = B || (o === true || F.background === true || O || q || (!S && o !== false)) && !W
L(G && !B) // Me only for local async — not remote
```

### Post-setup gate (after worktree / prompt awaits, before Flt)

```js
if (l.abortController.signal.aborted) {
  let Me = q_(l.abortController.signal.reason)
  if (!(G && Me === "interrupt")) throw await De() /* cleanup worktree */, new wl
}
if (G) {
  // Flt({...}) WITHOUT parentAbortController → independent Bc() abort
}
```

### Async register independence

```js
function Flt({ ..., parentAbortController: c, ... }) {
  let f = c ? JG(c) : Bc() // linked only when parentAbortController set
  // resume may pass parentAbortController:i?s.abortController:void 0
}
```

MCP auto-bg (`fo_`) still links via `L6r(parent, child)` — separate product path; not #15.

---

## 4. Local port (1:1)

| densable | Local |
|----------|-------|
| `q_` | `getAbortReasonMessage` / `isInterruptAbortReason` in `src/utils/abortController.ts` |
| `L(Me)` | `assertCanSpawnSubagent({ allowInterrupt })` in `sessionSpawnCaps.ts` |
| `L(G&&!B)` | `consumeSessionSpawnSlot(shouldRunAsync && !isRemoteIsolation)` in `AgentTool.tsx` |
| post-setup `if (!(G&&Me==="interrupt")) throw await De(), wl` | abort check before `registerAsyncAgent` / sync path; `cleanupWorktreeIfNeeded()` then `AbortError` |
| Flt no parent link for async G | existing "Don't link to parent's abort controller" on `registerAsyncAgent` |

### Call-site order (product-critical)

1. Resolve `shouldRunAsync` (G) and `isRemoteIsolation` (B) **before** spawn-slot consume.  
2. `L(G&&!B)` with interrupt immunity.  
3. Worktree / system-prompt / observer awaits (startup window).  
4. Second abort gate with same `G && reason==="interrupt"` immunity.  
5. `registerAsyncAgent` with independent abort controller.

---

## 5. Tests

`src/utils/__tests__/bgStartupCancel.216.test.ts`

- interrupt + `allowInterrupt` continues + increments  
- interrupt without allow / non-interrupt with allow still throw  
- AgentTool source wires L(G&&!B) + post-setup gate + independent abort  

---

## 6. Residual / non-goals

- **Not** `CLAUDE_BG_STARTUP_WEDGE_MS` (job tempo dialog wedge).  
- Resume path `parentAbortController:i?…` link is resume-specific; #15 is spawn startup.  
- MCP auto-bg parent link (`L6r`) unchanged.  
- Product version stays **2.7.30** unless asked.
