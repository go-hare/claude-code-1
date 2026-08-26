# densable 2.1.212 — #21 ExitWorktree after print/SDK `--continue`/`--resume`

Changelog:

> Fixed `ExitWorktree` failing with "no active EnterWorktree session" after
> resuming a session with `--continue`/`--resume` in print/SDK mode

## densable symbols

| densable | role |
|----------|------|
| `Py()` | `getCurrentWorktreeSession` — module `z1r` |
| `LXn(e)` / `X6t(e)` | `restoreWorktreeSession` — set `z1r` |
| `e_t(worktreeSession, relocatedCwd?)` | `restoreWorktreeForResume` |
| `hne` | `saveWorktreeState` |
| `E$e` | `adoptResumedSessionFile` |
| `JCe` | `restoreSessionMetadata` |

## densable `e_t` (restoreWorktreeForResume)

```js
function e_t(e, t) {
  let r = Py()
  if (r) {
    hne(r)
    return
  } // fresh --worktree wins
  if (!e) {
    if (e === null) return
    // optional relocatedCwd-only path …
    return
  }
  try {
    process.chdir(e.worktreePath)
  } catch {
    hne(null)
    return
  }
  yv(e.worktreePath)
  g$(Ct())
  LXn(e) // restoreWorktreeSession
  // clear caches / refresh git branch …
}
```

## densable print continue/resume

```js
// after switchSession / restoreSessionStateFromLog:
JCe(t.forkSession ? { ...o, worktreeSession: void 0, … } : o)
if (!t.forkSession)
  try {
    e_t(o.worktreeSession)
  } catch (i) {
    we(i)
  }
if (!t.forkSession && r && o.sessionId) E$e()
```

Interactive / CLI `processResumedConversation` already called `e_t` via
`restoreWorktreeForResume`. **print.ts** previously only called
`restoreSessionMetadata` — transcript cache updated, but `currentWorktreeSession`
stayed `null` → ExitWorktree `validateInput` → no-op message.

## Local fix

`src/cli/print.ts` both `--continue` and `--resume` paths:

```ts
if (!options.forkSession) {
  try {
    restoreWorktreeForResume(result.worktreeSession)
  } catch (error) {
    logError(error)
  }
  if (persistSession && result.sessionId) {
    adoptResumedSessionFile()
  }
}
```

ExitWorktree continues to use `getCurrentWorktreeSession()`; no tool change required once print rehydrates session state.
