# densable 2.1.212 — #23 streaming control_request lifecycle

Changelog:

> Fixed streaming-mode control requests being marked complete before their handler finished, which could lose the request on session restart

## densable print stdin loop (verbatim shape)

```js
for await (let We of e.structuredInput) {
  let Rr = 'uuid' in We ? We.uuid : void 0
  // Outer: only non-user events that do NOT own lifecycle
  if (
    Rr &&
    We.type !== 'user' &&
    We.type !== 'bash_command' &&
    We.type !== 'control_response' &&
    We.type !== 'control_request'
  )
    e.onCommandLifecycle?.(Rr, 'completed')

  if (We.type === 'control_request') {
    let Ko = false
    // ra — started now; completed when Fr settles (F&F with wait)
    let ra = Fr => {
      Ko = true
      if (Rr) e.onCommandLifecycle?.(Rr, 'started')
      Promise.resolve()
        .then(Fr)
        .finally(() => {
          if (Rr) e.onCommandLifecycle?.(Rr, 'completed')
        })
        .catch(Hn => we(Hn))
    }
    // Ns — completed now; Fr continues (long mcp_call)
    let Ns = Fr => {
      Ko = true
      if (Rr) e.onCommandLifecycle?.(Rr, 'completed')
      Promise.resolve()
        .then(Fr)
        .catch(Hn => we(Hn))
    }
    try {
      // ... subtype handlers; some call ra(...) / Ns(...)
      // get_workspace_diff / stage_file / register_repo_root / add_directory → ra
      // mcp_call → Ns
      // initialize / set_model / ... → await inline (Ko stays false)
    } finally {
      if (Rr && !Ko) e.onCommandLifecycle?.(Rr, 'completed')
    }
    continue
  }
}
```

## densable symbols

| densable | role | local |
|----------|------|-------|
| `Rr` | event uuid | `eventId` |
| `Ko` | deferred ownership flag | `lifecycleDeferred` |
| `ra` | F&F + lifecycle after settle | `deferControlLifecycleUntilDone` |
| `Ns` | complete now + F&F continue | `completeControlLifecycleImmediately` |
| `e.onCommandLifecycle` | CCR/SDK lifecycle | `notifyCommandLifecycle` |

## Gap fixed vs pre-align local

| before | after |
|--------|-------|
| outer loop completed **all** non-user / non-control_response (including **control_request**) on the same tick | outer excludes `control_request` + `bash_command` |
| no finally ownership | `try/finally` completes only if !deferred |
| `generate_session_title` / `side_question` bare `void (async ()=>...)()` after early complete | `deferControlLifecycleUntilDone` (densable `ra`) |

## Local files

- `src/utils/controlRequestLifecycle.ts` — pure predicates
- `src/cli/print.ts` — outer filter + Ko/ra/Ns + finally; wire `ra` on generate_session_title + side_question
- `src/utils/__tests__/controlRequestLifecycle.212.test.ts`

## Notes

- densable also uses `ra` for workspace_diff / stage_file / register_repo_root / add_directory and `Ns` for mcp_call — those subtypes are not all present locally; helpers are ready when ported.
- `continue` / `break` inside try still run `finally` (JS semantics) — matches densable.
