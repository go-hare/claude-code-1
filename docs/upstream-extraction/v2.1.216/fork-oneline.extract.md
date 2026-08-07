# densable 2.1.216 #30 — `/fork` confirmation one-liner

## Official

> Improved the `/fork` confirmation to one line with the new session's name, `claude attach` id, and a note when the copy shares your checkout

## densable gold

### `rBo` join

```js
function rBo(e) {
  return [e.state, ...e.name ? [e.name] : [], ...e.id ? [e.id] : [], ...e.chips].join(Npn)
}
// Npn = " · "
// Mpn = "session running"
// Tyr = "session waiting for a prompt"
// h6y = "session waiting"
// g6y = /^[0-9a-f]{8}$/  // attach short id
```

### L2p success path

```js
let Dlx = bfe.name ? DXs(Kc(Tf(bfe.name))) : void 0
let Hlx = nbn ? Mpn : Tyr // hadPrompt → running else waiting
let DTb = bfe.relocatedTo
  ? 'runs in the origin tree'
  : bfe.editsIn === 'this-tree'
    ? 'edits this checkout'
    : void 0
let Olx = rBo({ state: Hlx, name: Dlx, id: bfe.short, chips: DTb ? [DTb] : [] })
rbn(Olx, { display: 'system' })
```

### `HXs` parse (rejects multiline)

One-line only: `if (e.includes("\n")) return null`. Id = last 8-hex token; chips after id.

### Shared-checkout note

Chip **`edits this checkout`** when `editsIn === "this-tree"` (keepParent, same tree).  
**`own-worktree`** → no chip. Relocated → **`runs in the origin tree`**.

`claude attach id` in the official blurb = the **8-hex short id** field (user runs `claude attach <id>`), not a literal `claude attach` prefix in the toast.

## Local land

| File | Change |
|------|--------|
| `src/utils/spawnBackgroundSessionFork.ts` | `formatForkSessionToast` → densable rBo one-liner; `formatSessionStatusLine` / `parseSessionStatusLine` |
| tests | `spawnBackgroundSessionFork.test.ts` |

## Tests

`src/utils/__tests__/spawnBackgroundSessionFork.test.ts` — `formatForkSessionToast (densable rBo one-liner)`
