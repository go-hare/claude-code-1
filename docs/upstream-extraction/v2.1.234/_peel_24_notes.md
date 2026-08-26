# densable 2.1.234 #24 — IDE diff tab close during permission re-prompt

> Changelog: *Fixed IDE diff tab closing during permission re-prompt answering new prompt with previous input*

## Gold (SEA)

| Symbol | Role |
|--------|------|
| `Fmi` | claim-once resolver (`resolve` / `isResolved` / `claim`) |
| `Mrf` | IDE diff racer: `y` closeTab latch + `if(y\|\|!a())return` before apply |
| `Rrf` | `openDiff` + `o()=>y` abort check (`l()`) |
| `L4n` | Dialog host: `onReprompt` aborts, teardown (`closeTab`), rebuilds descriptor |
| `tnf` | Bridge/channel racers; `runHooks` → `"reprompted"in x` → `onReprompt` |
| `m4n.runHooks` | allow+`updatedInput` → recheck; still `ask` → `{reprompted, finalInput}` |

## Bug mechanism

1. File edit permission opens IDE diff (`openDiff`).
2. PermissionRequest hook returns **allow** with **rewritten** `updatedInput`, but recheck still **ask** → re-prompt.
3. Old IDE tab closes / resolves with the **previous** accept payload.
4. Without `y||!claim()`, that stale `updatedInput` answers the **new** prompt.

## Local 1:1 port

| densable | Local |
|----------|-------|
| `Fmi` | `createResolveOnce` (already) |
| `Mrf.y` + claim gate | per-session `{closed, tabName}` — never un-close a shared ref |
| `Rrf` `o()=>y` | `showDiffInIDE(..., isClosed)` `assertNotClosed` |
| `L4n` teardown on re-prompt | `useDiffInIDE` effect deps `[filePath, editsKey, editMode]` close+reopen |
| `runHooks` reprompt | `PermissionContext.runHooks` → `{reprompted, finalInput}` |
| `tnf`/`onReprompt` | `interactiveHandler` updates queue **without** `claim()` |

## Tests

`src/hooks/__tests__/ideDiffReprompt.234.test.ts` — closed latch + runHooks reprompt shape.

## Status

**HAVE** (targeted). Full precheck deferred.
