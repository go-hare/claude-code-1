# densable 2.1.212 — Batch 3 Agents UX

Sources: densable SEA `claude.exe` 2.1.212 (`B5_`, `Nia`/`J5_`, `FFe`/`K2e`, `tYo`, fleet resume picker).

## #41 Footer `← N done` (densable `K2e` / FFe)

Flash window `Ozo = 2500` ms.

### Effect (reconstructed)

```js
// fY = needsInput, KAr = succeeded, Lzo = reducedMotion
// dpf = flash kind 'none'|'awaiting'|'done'
// fpf = temporary done-delta count when needs is empty
let prevNeeds = iNb.current
let prevSucceeded = sNb.current
iNb.current = fY
sNb.current = KAr
let needsChanged = prevNeeds !== undefined && fY !== undefined && fY !== prevNeeds
let succeededUp = prevSucceeded !== undefined && KAr !== undefined && KAr > prevSucceeded
let hasNeeds = fY !== undefined && fY > 0

// densable: when no needs-input and succeeded increased → pulse "N done"
if (!hasNeeds && succeededUp && !Lzo) {
  clearTimer()
  mpf(KAr - prevSucceeded) // fpf
  setTimeout(() => mpf(0), Ozo)
  return
}
if (!hasNeeds || (!needsChanged && !succeededUp) || Lzo) return
if (!needsChanged && AYe.current?.kind === 'awaiting') return
// set flash: needsChanged → 'awaiting' else 'done'; clear after Ozo
```

### Render

```js
// 1) nudge on + (needs===0|undefined) + fpf>0 → "← N done" (success color on N)
if (zAr && (fY === 0 || fY === undefined) && fpf > 0) {
  return [arrowLeft + ' ', <success>{fpf>99?'99+':fpf}</success>, ' done']
}
// 2) !nudge || needs undefined/0 → "← for agents"
// 3) needs>0 → "← N agent(s)" with flash color on count
```

### Local gap (pre-fix)

`AgentsFooterHint` early-returned on `needs===0` without `fpf` / `N done` branch.

---

## #37 Cold attach transcript (`Nia` + `B5_`)

Constants:

| Name | Value |
|------|-------|
| `FPp` | 262144 (last bytes of transcript) |
| `P5_` | 32768 (text budget) |
| `L5_` | 200 (max entries) |
| `M5_` | 4096 (markdown budget per assistant) |
| `O5_` | 50 ms (format time budget) |
| `B5_` | `"  Session is starting — showing its transcript until it appears. Ctrl+Z to detach"` |

### Attach path (reconstructed)

```js
// w = liveTranscriptPath ?? (launch.mode==='resume' ? launch.transcriptPath : undefined)
// x = !holdingFrame && isBooting && w != null
//     ? Nia(w, cols, rows, { colorLevel, theme })
//     : null
// ack includes cached: x !== null
// if (x !== null) write(CLEAR + ERASE + x)
// stall timeout: if empty buffer && (holdingFrame || x !== null) → do not overwrite with stall text
// else stall msg still "Session is starting — it will appear once ready. Ctrl+Z to detach"
//      (legacy string when no pre-render)
```

### `Nia(path, cols, rows, caps)`

- `lstat` file; empty/missing → null
- `readSync` last `min(size, FPp)` from `max(0, size-FPp)`
- if started mid-file, drop first partial line
- `J5_(utf8, cols, rows, caps)` → terminal frame ending with dim `B5_` footer lines

### Local gap (pre-fix)

`bgManager.handleAttachOp` always showed “it will appear once ready” with no `Nia` pre-render.

---

## #25 Force restart (`tYo`)

```js
tYo = "Press enter again to restart this session fresh — it has no saved " +
      "transcript (stopped before its first response; any conversation it was backgrounded from is untouched)."
```

Flow:

1. Open/respawn returns `errorCode === "fork_transcript_never_materialized"`
2. Banner `Bc(tYo)`; remember session id `ut.current = id`
3. Second Enter while banner is `tYo` → `forceRefusalRetry: true` on respawn

### Local gap (pre-fix)

ENOJOB auto-respawn without double-enter / tYo banner.

---

## #6 Agent view `/resume` picker

Overlay when dispatch input is `/resume` (or equivalent):

- Title: `Resume a past session`
- Footer: `↑/↓ to navigate · enter to resume as a background session · esc to close`
- Loading: `Looking for past sessions…`
- Fail: `Couldn't load past sessions — press esc, then try /resume again`
- Empty: `No past sessions to resume`
- Rows: title + relative age; includes soft-deleted / list-hidden sessions densable loads for resume

Enter → dispatch resume as **background** session (not foreground REPL resume).

### Local gap (pre-fix)

AgentView has slash suggestions but no `/resume` past-session overlay → bg resume.

---

## #46 Needs input bands

Band labels (densable `cYo`):

| key | label |
|-----|-------|
| review | Ready for review |
| blocked | Needs input |
| working | Working |
| done | Completed |

Producers that set blocked/`needs` (densable strings):

- `MCP input: …` (elicitation)
- `allow network: …` / sandbox (`worker-sandbox`)
- managed settings review (`review: managed settings change`)

Agent view + `claude agents --json` must surface these as **Needs input** / blocked, not Working.

### Local gap (pre-fix)

`deriveBand` treats `waiting` / `waitingFor` as blocked; producers for sandbox/MCP/managed-settings incomplete.

---

## Changelog (2.1.212)

- Typing `/resume` in the agent view now opens a picker of past sessions — including sessions deleted from the list — and resumes your pick as a background session
- Improved background agent attach: cold-attaching now instantly shows the formatted transcript while the session boots
- Changed the `←` footer hint to pulse `N done` for a moment when a background agent finishes while nothing needs your input
- Fixed reopening a stopped background session … shows why it can't and lets you force a restart
- agent view / `claude agents --json`: sandbox, MCP-input, managed-settings → "Needs input"
