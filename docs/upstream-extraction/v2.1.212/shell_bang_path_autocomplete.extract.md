# densable 2.1.212 — #12 shell mode `!` path autocomplete submit

Changelog:

> Fixed shell mode (`!`) so path autocomplete no longer blocks Enter when the
> command already contains a path token

## Root cause

1. densable `lKs` (`getPathCompletions`) returns path items **without**
   `description` (only `id` / `displayText` / `metadata.type`).
2. PromptInput `onSubmit` early-return:

```js
let $0 =
  H_.suggestions.length > 0 &&
  H_.suggestions.every(Pw => Pw.description === 'directory')
if (H_.suggestions.length > 0 && !bn && !$0) {
  T(`[onSubmit] early return: suggestions showing (count=${…})`)
  return
}
```

3. While bash-path popup is open, `$0` is **false** (no `description`).
   Bare Enter must pass **`bn=true`** (`isSubmittingSlashCommand`) or the
   command is swallowed.

## densable `Ye` directory / bash-path bare Enter

```js
// Ye = (Lt) => { … }
else if (E === 'directory' && Yt < c.length) {
  if (Rt) {
    if (re.current === 'bash-path') {
      if ((ye.cancel(), Pe.cancel(), Lt === void 0)) {
        // bare Enter (return key calls Ye() with no Lt)
        if ((Ee(), !ie.current)) (ie.current = !0), r(q1e(), !0)
        return
      }
      // explicit Lt (Tab/select path): apply token, no submit
      …
      return
    }
    if (re.current === 'command-arg') {
      …
      Ee(), r(o, !0)
      return
    }
    // at-path: apply token only
  }
}
```

Telemetry / helpers:

| densable | meaning |
|----------|---------|
| `re.current="bash-path"` | `directorySourceRef` for `!` path word |
| `lKs` | files+dirs completions, **no** description |
| dir-only map | `description:"directory"` (command-arg /add-dir/cd) |
| `ie.current` | once-per-tick double Ye guard; reset `false` each render |
| `q1e()` | live input store value |
| `r(…, !0)` | `onSubmit(value, bn=true)` |

## densable return-key special case (bash-path)

```js
if (Lt.name === 'return' && !Lt.shift && !Lt.meta) {
  if (E === 'directory' && re.current === 'bash-path') {
    let Yt = q1e(),
      Rt = i + (Yt.length - o.length)
    if (Yt[Rt - 1] === '\\' || GLs()) return // GLs = Apple_Terminal && shift
  }
  Lt.preventDefault(), Ye()
}
```

Do **not** preventDefault when trailing `\` (line continuation) or Apple
Terminal shift-newline — leave to TextInput.

## Local alignment

| densable | local |
|----------|-------|
| `lKs` | `getPathCompletions` (no description) |
| dir-only | `getDirectoryCompletions` (`description: 'directory'`) |
| `re` bash-path | `directorySourceRef.current = 'bash-path'` in `useTypeahead` |
| Ye bare Enter `r(q1e(), !0)` | `onSubmit(input, true)` after `clearSuggestions` |
| `ie` | `bashPathSubmitGuardRef` |
| GLs / `\` | handleKeyDown return: defer when `\` or Apple_Terminal+shift |
| onSubmit `$0` gate | `PromptInput.tsx` `hasDirectorySuggestions` |

## Fix (this pack)

Previously local bash-path bare Enter called `onSubmit(input, **false**)`, so
with open lKs popup Enter early-returned and never ran the shell command.
Aligned to densable `r(…, !0)`.
