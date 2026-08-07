# densable 2.1.216 #12 — Esc-Esc idle + bg → rewind picker

## Official

> Fixed Esc-Esc at an idle prompt not opening the rewind picker in long-running sessions with background tasks

## densable gold (`/tmp/official-216/plat/package/claude`)

### Cancel keybinding (`xja` ≈ `CancelRequestHandler`)

```js
// queue filter (x4) — Mkg = Set(["task-notification"])
function Nkg(e){return!Mkg.has(e)}
function x4(e){return Nkg(e.mode)&&!e.isMeta&&pue(e.origin)}
function Opu(){return Sy.getCommandQueue().some(x4)}

// isActive for chat:cancel (Esc)
// O = abortSignal live || isExternalLoading
// q = queue.some(x4)   ← NOT full queue length
// D = loop wakeups (Yit)
// k = hasRunningBgTasks (NrS) — used by soft cancel only, NOT in G
G = B && !F && (O || q || D) && !W && !u && !j
An("chat:cancel", () => P(!0), { context: "Chat", isActive: G })

// handleCancel P(force)
// if abort/external → onCancel
// if Opu() → popCommandFromQueue
// if !force && k → kill bg agents
// else onCancel
// chat:cancel always passes force=true → does NOT kill bg on Esc
```

### PromptInput empty Esc

```js
if (name === "escape") {
  if (d6()) return // side dialogs
  if (vim && !NORMAL) return
  if (!FW()) { // KB_COHESION dead flag → always enter
    if (et.some(x4)) { popAllEditable(); return }
  }
  if (hasMessages && !input && !isLoading) doublePressEscFromEmpty() // → onShowMessageSelector
}
```

### Root cause of #12

Long-running sessions with background agents leave `task-notification` entries in the command queue. Local `chat:cancel` used `queuedCommandsLength > 0` (any entry) for `isActive`, so Esc was always claimed by cancel while only bg notifications sat in the queue. Cancel then tried to pop / no-op, and Esc never reached PromptInput double-press → message selector (rewind picker).

densable `Opu` / `x4` exclude `task-notification` (and meta / non-human origins).

## Local land

| File | Change |
|------|--------|
| `src/utils/messageQueueManager.ts` | `hasEditableCommandsInQueue()` = `queue.some(isQueuedCommandEditable)` (Opu) |
| `src/hooks/useCancelRequest.ts` | Esc/Ctrl+C isActive + pop path use editable filter, not raw length |
| PromptInput | already used `isQueuedCommandEditable` for pop + `doublePressEscFromEmpty` |

## Tests

`src/utils/__tests__/escEscRewind.216.test.ts`
