# densable 2.1.212 — #26 agent teams duplicate idle notifications

Changelog:

> Fixed agent teams: a stopping teammate could send the leader duplicate idle notifications when team initialization re-ran within a session

## Root cause (densable)

Process-based teammates register a Stop function hook via `hZc` / `gZc` (`addFunctionHook` / `addHookToSession`) with a **stable id**:

```js
hZc(e, t, "Stop", "", async (u, d) => {
  // setMemberActive + createIdleNotification + writeToMailbox
  return !0
}, "Failed to send idle notification to team leader", {
  timeout: 1e4,
  id: "teammate-idle-notification",
})
```

`gZc` **replaces** same-id function hooks instead of appending:

```js
let m = o.type === "function" && o.id
  ? f.hooks.findIndex(y => y.hook.type === "function" && y.hook.id === o.id)
  : -1
let g = m >= 0
  ? f.hooks.with(m, { hook: o, onHookSuccess: i })
  : [...f.hooks, { hook: o, onHookSuccess: i }]
```

Without replace-by-id, `useSwarmInitialization` / `initializeTeammateHooks` re-run stacks multiple Stop hooks → multiple idle mailbox writes on stop.

### Secondary guard (in-process runner)

`vKg` path already skips when task was already idle:

```js
let Ye = Ue?.type === "in_process_teammate" && Ue.isIdle
if (!Ye && !y) await R$u(...)
else T(`[inProcessRunner] Skipping duplicate idle notification for ${t.agentName}`)
```

Local already had `wasAlreadyIdle` + skip log for this branch.

## Local alignment

| densable | local | status |
|----------|-------|--------|
| `id: "teammate-idle-notification"` | `teammateInit.ts` options.id | **HAVE** |
| `gZc` replace-by-id | `sessionHooks.addHookToSession` | **HAVE** |
| `wasAlreadyIdle` skip | `inProcessRunner` | **HAVE** (pre-existing) |

## Related files

- `src/utils/hooks/sessionHooks.ts`
- `src/utils/swarm/teammateInit.ts`
- `src/utils/swarm/inProcessRunner.ts`
- `src/utils/hooks/__tests__/sessionHooks.replaceById.212.test.ts`
