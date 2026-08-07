# densable 2.1.216 #14 — Agent list Ctrl+X×2 delete + zombie reappear

## Official

> Fixed pressing Ctrl+X twice in the agent list failing to delete a session, and deleted sessions reappearing when their background worker had died

## densable gold (`/tmp/official-216/plat/package/claude`)

### Tombstone (zombie reappear fix)

```js
wL = useRef(new Set)           // job short / id tombstone
yte = useRef(new Set)          // full sessionId / resumeSessionId
jF = useRef(new Map)           // short → [sessionId, resumeSessionId]

// refresh list
$r = … .filter((yl) => !wL.current.has(yl.id))

// FSS factory 3rd arg (mutate list):
// when gr (tombstone id) set: wL.add(gr); yte add session ids; return cleanup that deletes them
Ste = useMemo(() => FSS(refresh, setStopping, (mapFn, tombstoneId, guardId) => {
  if (tombstoneId) { wL.add(tombstoneId); … yte … }
  setJobs(prev => prev ? mapFn(prev) : prev)
  return () => { wL.delete(tombstoneId); yte cleanup }
}, setDeleteRefused), [refresh])
```

### Delete arm (cO / cy / bte)

```js
[cy, Xae] = useState(null)     // { id, justKilled, group, sortKey }
Pk = useRef(null)              // mirror of cy
bte = useRef(new Set)          // Esc-cancelled arms
cO = (id, justKilled=false, group, sortKey) => {
  const next = id === null ? null : { id, justKilled, group, sortKey }
  if (next) { clearExitArm(); bte.delete(next.id) }
  Pk.current = next; Xae(next)
}
Oc(() => cO(null), cy ? 2000 : null)  // auto-clear 2s

// Esc while armed: bte.add(Pk.id); cO(null)
```

### R4e("x") — first vs second press

```js
// active/blocked: if not already armed for this id → cO(id, label==="stop") + run stop; return
// (stop failure: if !wL && still listed && (Pk null|same) && !bte → re-arm justKilled:false)
// else cO(null); run delete (completed bands)
```

### FSS stop / delete

```js
stop: optimistic state→stopped; yKe kill confirm; patch disk; finally unguard+refresh
delete: n(id,null) clear refused; optimistic filter r(..., id) with tombstone;
        uUe(id,{force:true}); finally release tombstone + refresh;
        kept worktree → "…; the session was not deleted"
```

### UI strings

- row/footer: `ctrl+x again to ungroup` | `stopped · ctrl+x again to delete` | `ctrl+x again to delete`
- footer densable: `… · esc to keep`
- error: `not deleted` / `Worktree kept at …; the session was not deleted`

## Local land

| File | Change |
|------|--------|
| `src/screens/AgentView.tsx` | `deletedJobIdsRef`/`deletedSessionIdsRef` tombstone filter on refresh; optimistic delete; `justKilled` arm; active/blocked first X → `killJobConfirmed` + arm; 2000ms arm timeout; Esc → bte |
| `src/screens/fleetView/helpers.ts` | `FLEET_DELETE_ARM_MS=2000`; footer `justKilled` + `esc to keep` |
| already | `deleteJob(short,{force:true})` (2.1.214 C2e) |

## Tests

`src/screens/__tests__/agentViewDelete.216.test.ts`
