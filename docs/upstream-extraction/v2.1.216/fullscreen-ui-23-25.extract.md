# densable 2.1.216 #23–25 — fullscreen dialog edge / config footer / transcript footer

Official bullets:

> Fixed dialogs in fullscreen mode stretching past the right-hand edge of their panel  
> Fixed the `/config` settings list in fullscreen mode clipping its keyboard-hint footer  
> Fixed the transcript-mode (Ctrl+O) footer hint wrapping on terminals narrower than 104 columns

Three related UI clamps (do **not** invent a hard-coded `104` constant — densable
gates on measured string width vs columns).

## #23 Fullscreen dialogs past right edge

### densable gold

- FullscreenLayout modal slot: absolute bottom-anchored panel; content width is
  effectively `columns - 4` (paddingX=2 each side). `ModalContext.columns = columns - 4`.
- Dialog (`nr`): body/title stack; keyboard guide `flexShrink:0`.
- Pane inside modal: `paddingX:1, flexShrink:0` (skip own Divider).
- Settings list rows (sda): label `width:X` where
  `X = Math.min(44, Math.max(14, columns - 16))` + value `flexGrow:1, minWidth:0`
  + `wrap:"truncate-end"`.

### Local land

| File | Change |
|------|--------|
| `packages/@ant/ink/src/theme/Dialog.tsx` | `minWidth:0` body; title/subtitle `truncate-end`; footer `flexShrink:0` |
| `packages/@ant/ink/src/theme/Pane.tsx` | modal + non-modal `minWidth:0 width=100%` |
| `packages/@ant/ink/src/theme/Tabs.tsx` | `useModalOrTerminalSize` for content width (not raw terminal) |
| `src/components/FullscreenLayout.tsx` | modal inner Box `minWidth:0 width=100%` |
| `src/components/Settings/Config.tsx` | adaptive `labelWidth` + value `minWidth:0` |

## #24 `/config` keyboard-hint footer clip

### densable gold

```js
// sda
B = useRef(null)           // footer measure ref
[G, U] = useState(1)       // footerHeight
X = Math.min(44, Math.max(14, columns - 16))
J = contentHeight ?? min(floor(rows*0.8), 30)
Y = Math.max(5, J - 8 - G) // maxVisible
useLayoutEffect(() => {
  if (!B.current) return
  const h = measure(B.current).height
  if (h !== G) U(h)
}, [headerFocused, searchMode, columns, rows, G, submenu])
// footer:
R({ ref:B, flexDirection:"column", flexShrink:0, children: /* Byline hints */ })
```

### Local land

- `Config.tsx`: `footerRef` + `measureElement` + `configMaxVisibleRows(paneCap, footerHeight)`
- footer Box `flexShrink={0}` wrapping keyboard hints
- pure helpers in `src/utils/transcriptFooterHints.ts`

## #25 Transcript footer wrap &lt;104 cols

### densable gold (CZa)

```js
Rni = 2 // paddingLeft
F0S = `${↑↓} scroll · v to ${openIn} · ? for shortcuts`
// collapse only F0S when full left string would exceed columns:
oLI = Rni + Dt([dialog?, "Showing detailed transcript", `${toggle} to toggle`, F0S]
  .filter(Boolean).join(" · ")) + Dt(status|verbose) < columns
  ? F0S : "? for shortcuts"
// mid segment:
search ? "n/N to navigate"
  : virtualScroll ? oLI
  : suppressShowAll ? ""
  : `${ctrl+e} to ${showAll ? "collapse" : "show all"}`
// Text: dimColor, wrap:"truncate-end"
// Ktn: editor basename ≤8 chars else omit name
```

No literal `104` — changelog description only. Gate is `stringWidth(left)+pad < columns`.

### Local land

- pure `pickTranscriptVirtualScrollHints` in `transcriptFooterHints.ts`
- `TranscriptModeFooter` in `REPL.tsx` uses width gate + Byline + truncate-end
- densable-aligned virtual-scroll copy: `↑↓ scroll · v to open in <editor> · ? for shortcuts`

## Tests

`src/utils/__tests__/fullscreenUi.216.test.ts` — width gate, label col, maxVisible.

## Status

| # | Status |
|---|--------|
| 23 dialog right edge | HAVE |
| 24 config footer clip | HAVE |
| 25 transcript footer wrap | HAVE |
