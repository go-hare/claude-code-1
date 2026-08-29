# densable 2.1.239 — Project C / 236 #9 Axc callgraph (LOCKED)

**SEA:** `%TEMP%\official-239-pkg\package\claude.exe` (2.1.239, ~337MB)  
**Probe (Phase-1):** `probe-project-c-axc.mjs` → `gold-project-c-axc-probe.txt`, `gold-project-c-axc-methods.txt`, `gold-project-c-axc-draw.txt`  
**Probe (Phase-2):** `probe-project-c-xxc.mjs` → `gold-project-c-xxc-host.txt`, `gold-project-c-frameSink-ink.txt`  
**Lock date:** 2026-08-28

## Identity

| densable symbol | role |
|-----------------|------|
| **`Axc`** | Sticky-scroll **main-screen** transcript compositor (`nativeHistory` + DECSTBM-ish pump) |
| **`xxc` / host** | React host (`useInsertionEffect`): constructs `Axc`, installs **`Ink.frameSink`**, layout-effect → `handleResize` |
| **`Qvt` arm** | Frame loop calls `frameSink(frame, stylePool)`; `"tick"` keeps RAF/drain alive |

Mangle rename vs older digs: **`l5w` → `q$0`** (batch); bottom chrome **`Ran` → `dyn`**. Contract isomorphic.

## Constants (class tail @ 321276105)

```js
var Mko = "\x1B[0m", Exc = "\x1B[K", q$0 = 100, uyn = 1e4, dyn = 4
```

| const | value | meaning |
|-------|-------|---------|
| `q$0` | `100` | `tickPump` lines per tick (was `l5w` in 236 dig notes) |
| `uyn` | `10000` | `nativeHistory` hard cap |
| `dyn` | `4` | reserved bottom chrome rows; `contentHeight = max(2, rows - dyn)` |

## Class fields (ctor @ 321269869)

```
out, cols, rows, onWrite
buf="", lastFrame="", syncOpen=false
suspended=false, restored=false
tailSlack=0, contentOverlayRows=0, overlayRatchet=0
onScreen=[], replayPending=false, committedTop=0
nativeHistory=[], pumpCursor=-1
_backfillNeeded=false, _gapRange=null
_suspendedCols=0, _suspendedRows=0
contentHeight = max(2, rows - dyn)
```

## Locked callgraph

```
Ink.draw / scheduleRender
  └─ frameSink(frame, stylePool)          // installed by xxc host; tip: ABSENT
       │
       ├─ if Ink.isAltScreenActive:
       │     Axc.suspend() once → return false   // Axc OFF in alt-screen
       │
       ├─ if wasSuspended: Axc.resume(cols, rows)
       │     └─ size changed vs suspend snapshot?
       │           → resetTransientState
       │           → replayPending=true
       │           → pumpCursor = nativeHistory.length>0 ? 0 : -1
       │
       ├─ stillPumping = Axc.tickPump()   // batch q$0; false when done
       │
       ├─ computeLayout(bottomLines, overlayLines)
       │     contentHeight = max(2, rows - max(dyn, bottom.length))
       │
       ├─ Axc.syncViewport(viewportModel, contentHeight)
       │     ├─ if suspended → return
       │     ├─ if pumpCursor >= 0 → return     // ★ early-return while pumping
       │     ├─ scroll-out lines → nativeHistory (cap uyn)
       │     ├─ gap / backfill flags
       │     └─ paint onScreen vs viewport.lines
       │
       ├─ consumeGapRange / consumeBackfillNeeded → primeBackfill(lines)
       │     └─ append history, arm pumpCursor, replayPending
       │
       └─ Axc.draw(layout) → commitImmediate
            return (stillPumping || primed) ? "tick" : true
                 // ★ "tick" keeps frame loop spinning until pump drains

React useLayoutEffect([cols, rows])
  └─ Axc.handleResize(cols, rows)
       ├─ same dims / suspended → "noop" (still update cols/rows if suspended)
       ├─ width change OR height shrink → "replay"
       │     resetTransientState; replayPending; pumpCursor=0|-1; commit
       └─ else height grow only → "adjust" (DECSTBM resize, no pump arm)
```

## Method contracts (bodies in `gold-project-c-axc-methods.txt`)

### `handleResize(e,t)` → `"noop" | "replay" | "adjust"`

- noop: same cols/rows, or suspended (store dims)
- replay: `cols` changed **or** `rows` shrank → clear+reset+arm pump
- adjust: rows grew only → update scroll region, no pump

### `tickPump()` → `boolean` (more work?)

- `pumpCursor < 0` → `false`
- emit up to **`q$0`** history lines into scroll region row 1, LF-scroll
- restore DECSTBM to `contentHeight`; `commitImmediate`
- when cursor past end → `pumpCursor = -1`
- return `pumpCursor >= 0`

### `syncViewport(e,t)`

- **early-return if `pumpCursor >= 0`** (no scroll-commit / onScreen mutate during pump)
- early-return if `suspended`
- on `replayPending`: clear flag; re-anchor `committedTop`
- scroll-out: push `onScreen` lines into `nativeHistory`, splice to `uyn`
- may set `_gapRange` / `_backfillNeeded`

### `resume(e,t)` / `suspend()` / `restore()`

- suspend: stash cols/rows, exit compositor region
- resume: if dims differ from stash → same arm as resize-replay
- restore: teardown (once)

### `primeBackfill(lines)` / `switchTranscript()`

- prime: append under `uyn` cap; set `pumpCursor` to pre-append length (adjusted if splice); `replayPending`
- switch: wipe history + reset + `replayPending` (no pump arm — cursor `-1`)

### `draw(layout)`

- suspended → return
- sync markers + overlay chrome + frame dedupe via `lastFrame`
- does **not** call `tickPump` (caller / frameSink does)

## Tip ↔ densable gap table

| densable | tip (`packages/@ant/ink`) | honest status |
|----------|---------------------------|---------------|
| `class Axc` | **none** | missing |
| `nativeHistory` scrolled-line ring | **none** (React VML keeps message nodes) | invent-ban to fake from React |
| `tickPump` / `q$0=100` | **none** | missing |
| `pumpCursor` / `replayPending` | **none** | missing |
| `syncViewport` early-return while pumping | **none** | missing |
| `frameSink` → `"tick"` | **none** (`ink.tsx` has no `frameSink`; gold: `gold-project-c-frameSink-ink.txt`) | Phase-2 wire target |
| `xxc` host + layout-effect `handleResize` | tip `FullscreenLayout` is React/Yoga sticky; no Axc (gold: `gold-project-c-xxc-host.txt`) | Phase-2 host target |
| `recordContentWrite` | **none** | Phase-2 wire target |
| `Yp.get(process.stdout)` | `instances.get(stdout)` (`instances.ts`) | HAVE |
| `isAltScreenActive` getter | `ink.tsx:1783` | HAVE |
| `Ink.handleResize` → `resetFramesForAltScreen` | **present** (alt-screen cell blit reset) | **≠** Axc replay; different product surface |
| `dyn=4` bottom chrome | tip chrome via Yoga `minHeight` / layout | not Axc `computeLayout` |

**Critical architecture note:** densable `frameSink` **suspends Axc while `isAltScreenActive`**. Axc is the **main-screen sticky-scroll compositor**. Tip fullscreen defaults to **alt-screen** + `resetFramesForAltScreen`. Wiring a fake pump into alt-screen `handleResize` would invent a path densable does not take.

## Phase-1 decision

**(b)-leaning scaffold:** tip has no scrolled-line `nativeHistory` capture and no `frameSink`. Inventing history from React VML is **invent-ban**.

**Phase-1 =** locked gold + callgraph + **pure** `nativeHistoryPump` module + unit tests locking constants / resize arm / batch / sync early-return. **Defer Ink wire** until a real scrollback capture path exists (or tip gains densable main-screen compositor mode).

**#9 HAVE?** **No** — not end-to-end; tip-equiv VML/`columns` remains; Project C still open.

## Next steps (not Phase-1)

1. Peel `xxc` host + `J$0` gap renderer + `tSs` line serializer fully.
2. Decide tip product: main-screen sticky compositor **or** keep alt-screen (then #9 stays tip-equiv forever).
3. If main-screen path: add `frameSink` to Ink, host component, then wire pump.
4. Only then reconsider 236 #9 HAVE.

---

## Phase-2 wire checklist (xxc host + Ink.frameSink)

**Gold written 2026-08-28:**
- `gold-project-c-xxc-host.txt` — full `function xxc(...)` + `X$0` / `J$0` helpers
- `gold-project-c-frameSink-ink.txt` — Ink `Z2t.onRender` invoke + `"tick"|true|false` contract
- Probe: `probe-project-c-xxc.mjs`

**Product gate (unchanged):** densable sink **suspends Axc while `isAltScreenActive`** and returns `false` so Ink cell-diffs. Tip fullscreen defaults to **alt-screen**. Do **not** invent Axc inside alt-screen `handleResize`. Phase-2 wire only makes sense if tip gains a **main-screen** sticky path that mounts an `xxc`-shaped host.

### Concrete tip file targets

| # | tip file | densable surface | action |
|---|----------|------------------|--------|
| 1 | `packages/@ant/ink/src/core/ink.tsx` | `frameSink=null` field | Add writable `frameSink: ((frame, stylePool) => "tick" \| true \| false) \| null` |
| 2 | `packages/@ant/ink/src/core/ink.tsx` ~`onRender` after `this.renderer(...)` (~L926) | `if(this.frameSink){...}` @ SEA 308652923 | Hook: call sink with `(frame, stylePool)`; truthy → swap front/back, early-return (skip `writeDiffToTerminal` ~L1268); `"tick"` → `drainTimer=setTimeout(onRender, FRAME_INTERVAL_MS>>2)` parallel to scrollDrain ~L1289 |
| 3 | `packages/@ant/ink/src/core/ink.tsx` | `recordContentWrite=(e,t)=>…` | Add public method / arrow used as Axc `onWrite` (tip: **ABSENT**) |
| 4 | `packages/@ant/ink/src/core/ink.tsx` | `getStylePool()` / `getCharPool()` / `getHyperlinkPool()` | Expose getters (stylePool is private today) for host/`J$0` |
| 5 | `packages/@ant/ink/src/core/ink.tsx:1783` | `get isAltScreenActive` | **HAVE** — sink uses it for suspend |
| 6 | `packages/@ant/ink/src/core/instances.ts` | `Yp.get(process.stdout)` | **HAVE** as `instances.get(stdout)` (`InkInstancesMap` / densable `$yf`) — host looks up Ink here |
| 7 | `packages/@ant/ink/src/core/nativeHistoryPump.ts` | `class Axc` | Phase-1 pure pump **HAVE**; wire as compositor only after (1–4) + host |
| 8 | New React host (tip-equiv of `xxc`) | `function xxc` @ SEA 321277029 | `useInsertionEffect`: construct pump, `ink.frameSink=…`, cleanup `frameSink=null`+`restore`; `useLayoutEffect([cols,rows])` → `handleResize`. Candidates: sticky main-screen layout near `ScrollBox` / REPL chrome — **not** alt-screen Fullscreen path |
| 9 | Gap serializer (defer) | `J$0` / `tSs` / `wTg` | Needed for `primeBackfill` from Yoga DOM; Phase-2 can stub empty backfill until peel lands |

### Phase-2 acceptance (wire + J$0 → #9 HAVE)

- [x] Ink exposes `frameSink` + invoke arm with `"tick"|true|false` semantics matching gold
- [x] Host installs sink via `instances.get(stdout)` and clears on unmount (`useAxcFrameSink` / `AxcStickyHost` / `AxcFrameSinkBridge`)
- [x] Alt-screen: sink returns `false` / suspends pump (no invent into alt blit)
- [x] Main-screen path (opt-in `CLAUDE_CODE_AXC_STICKY_MAIN=1`): REPL skips `AlternateScreen`; FullscreenLayout wraps `AxcFrameSinkBridge`; pump `"tick"` drainTimer
- [x] densable `J$0` gap/backfill serializer (`serializeGapBackfill` → `primeBackfill`)
- [x] Product: tip default fullscreen remains **alt** (densable also suspends Axc in alt; official docs = alt fullscreen). Main sticky is opt-in — not invent.
- [x] Screen-row capture via densable `tSs` (not VML invent)

**#9 HAVE?** **Yes** (2026-08-28) — Axc/xxc/frameSink/J$0 合同齐；alt tip-equiv `resetFramesForAltScreen`；主屏 sticky 门控可用。

### Tip surfaces (Phase-2)

| tip | densable |
|-----|----------|
| `packages/@ant/ink/src/core/ink.tsx` `frameSink` / `recordContentWrite` / `getStylePool` | Z2t |
| `packages/@ant/ink/src/core/axc.ts` | `Axc` |
| `packages/@ant/ink/src/components/AxcStickyHost.tsx` + `useAxcFrameSink` | `xxc` |
| `CLAUDE_CODE_AXC_STICKY_MAIN=1` + REPL skip alt | main sticky product path |
| `src/components/FullscreenLayout.tsx` `AxcFrameSinkBridge` | tip Yoga kept; sink installed |
