# MessagesBoundary / React #185 vs densable 2.1.234 sticky gold

> SEA: `%LOCALAPPDATA%/Temp/official-234/plat/package/claude.exe`  
> sha256 `3f877e78543e2cb4daad61d18f06cc11028f9dffc1afd41ccf1f8f84cf02eb1b`  
> Extract: `gold-layout-js-0.txt` (offset ~307550315)  
> Date: 2026-08-18  
> **go-hare aligned 1:1 to densable sticky (2026-08-18)** — removed local #185 supersets.

## Why official “has no problem”

densable StickyTracker (`jpw`) early-returns on **`!force && lastIdx === idx`** *before* calling `setStickyPrompt`.

At bottom: walk is gated by `firstVisible > 0 && !isSticky` → `idx=-1`, `text=null`.  
First clear: `lastIdx` was `N` → `lastIdx=-1`, `set(null)`.  
Later frames: `lastIdx === idx === -1` → **return** (no setState).  

So even with `padCollapsed = sticky != null` and immediate miss clear, the feedback loop dies on the idx early-return. That is the real anti-#185 gate — **not** hysteresis.

Local supersets (`shouldClearStickyOnMiss`, `lastStickyText`, `scrolledAwayFromBottom` pad latch) were invents relative to 234 SEA and still left this session hitting `MessagesBoundary` (extra state paths fighting densable’s simpler gate).

## densable gold (minified)

### FullscreenLayout (`Wrn`)

```js
[R9D, H9D] = useState(null)
Yxh = { setStickyPrompt: H9D }   // raw setter
I6l = hideSticky ? null : R9D
FKi = I6l != null && I6l !== "clicked" ? I6l : null  // header
D9D = I6l != null                                    // padCollapsed
paddingTop = D9D ? 0 : 1
// pill: onClick={zxh} only — does NOT set 'clicked'
```

### StickyTracker (`jpw`)

```js
if (pending.idx >= 0) return
if (suppress === "armed") { suppress = "force"; return }
force = suppress === "force"; suppress = "none"
if (!force && lastIdx === idx) return
lastIdx = idx
if (text == null) { set(null); return }
set({ text, scrollTo: () => { set("clicked"); suppress = "armed"; ... } })
```

## go-hare after align

| 点 | densable 2.1.234 | go-hare (now) |
| --- | --- | --- |
| setter | raw `useState` | raw `useState` |
| padCollapsed | `sticky != null` | `sticky != null` |
| miss clear | immediate | immediate |
| dedup | idx only | idx only |
| pill click | parent only | `onPillClick` only |
| hysteresis helpers | absent | **removed** |

Overlay still hides header while permission overlay is in the ScrollBox (go-hare layout ≠ densable absolute modal pane).

## Snippets

- `gold-layout-js-0.txt`
- `src/components/VirtualMessageList.tsx` StickyTracker
- `src/components/FullscreenLayout.tsx` sticky chrome
- `src/components/__tests__/stickyClearHysteresis.test.ts` (idx-dedup mirror)
