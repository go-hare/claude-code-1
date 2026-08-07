# densable 2.1.216 #16 — GUI editor mouse/focus garbage + `/memory` no wait

## Official

> Fixed mouse and focus garbage in the terminal while a GUI editor from `/memory`, `/plan`, `/keybindings`, or Ctrl+G is open; `/memory` no longer waits for the editor to close

## densable gold

### Ink: `prepareTerminalForHandoff` / `restoreTerminalAfterHandoff`

```js
prepareTerminalForHandoff() {
  this.pause()
  this.options.stdout.write(
    (this.altScreenMouseTracking !== 'off' ? dde /* DISABLE_MOUSE_TRACKING */ : '') +
      hHt /* DFE focus off */,
  )
  this.suspendStdin()
}
restoreTerminalAfterHandoff() {
  this.resumeStdin()
  this.options.stdout.write(
    UNe(this.altScreenMouseTracking) /* enableMouseTracking */ + pKr /* EFE focus on */,
  )
  this.resume()
}
```

CSI constants: `dde` = SGR/ANY/BUTTON/NORMAL reset; `hHt`/`pKr` = focus 1004 l/h.

### `Wut` (editFileInEditor — wait for close, read content)

- Terminal editor: `enterAlternateScreen` / `exitAlternateScreen`
- **GUI**: `prepareTerminalForHandoff` → `spawnSync(bin, [...args, path], {stdio:'inherit'})` with overrides `code -w` / `subl --wait` → `restoreTerminalAfterHandoff`
- Error copy densable: `Couldn't open ${name} — …` / `closed unexpectedly` / `quit unexpectedly`

### `jCo` (openFileInExternalEditor — fire-and-forget for GUI)

```js
if (guiFamily) {
  spawn(bin, [...args, ...goto], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return true
}
// else terminal: enterAlternateScreen + spawnSync + exitAlternateScreen
```

### `/memory` densable `COb`

Uses **`jCo`**, not `Wut`:

```js
if (!jCo(path)) {
  onDone(`Couldn't open the memory file at ${rel} in an editor. If no editor is configured, set $EDITOR or $VISUAL, then run /memory again.`, { display: 'system' })
  return
}
// … editor hint …
onDone(`Opened memory file at ${rel}…`, { display: 'system' })
```

→ GUI path returns immediately (detached); terminal path still blocks via alt-screen.

## Local land

| File | Change |
|------|--------|
| `packages/@ant/ink/src/core/ink.tsx` | `prepareTerminalForHandoff` / `restoreTerminalAfterHandoff` |
| `src/utils/promptEditor.ts` | GUI uses handoff + spawnSync argv + densable errors |
| `src/utils/editor.ts` | `windowsHide: true`; drop win32 shell:true for GUI |
| `src/commands/memory/memory.tsx` | `openFileInExternalEditor` (jCo) not `editFileInEditor` |

## Tests

`src/utils/__tests__/guiEditorHandoff.216.test.ts`
