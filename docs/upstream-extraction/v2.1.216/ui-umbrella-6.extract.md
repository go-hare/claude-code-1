# densable 2.1.216 #6 — @-mention / hooks / vim paste / statusline / resume-picker

Official bullet:

> Fixed @-mentions silently attaching nothing after file-modifying hooks, vim
> dot-repeat of `c`-operators and paste, statusline running twice on resume,
> and resume-picker hangs on failure

Four independent needles (do **not** ship as one false HAVE without each).

## 1. @-mentions empty after file-modifying hooks

### densable gold

- `aoy` / `Ccr` at-mention path: `already_read_file` only when `H1e(l)` full-enough
  (`mGe` + `!contentNotInModelContext`) **and**
  `(content !== "" || (contentLength ?? 0) === 0)` **and** mtime match.
- Partial / offset reads must re-read so attachment is not empty after limited Read
  or post-hook rewrite with stale partial cache.
- File suggestion index: `Pxs` clear + `btn` refresh on typeahead; git index mtime
  throttle (not the silent-empty root for @ attach).

### Local

- **HAVE**: `generateFileAttachment` densable Eio + H1e
  (`contentNotInModelContext` / empty `contentLength` gate) on
  `FileState` + `isFullEnoughFileRead`. tests: `fileStateHOe` +
  `generateFileAttachment.eio.212`.

## 2. vim `c`-operator + paste dot-repeat

### densable gold

```js
// Poa: openLine | substitute | *change* ops
function Poa(e) {
  if (!e) return false
  switch (e.type) {
    case 'openLine':
    case 'substitute':
      return true
    case 'operator':
    case 'operatorFind':
    case 'operatorTextObj':
    case 'visualOp':
      return e.op === 'change'
    default:
      return false
  }
}

// recordChange: lastChange=X; if Poa(X) && INSERT → S.current=X
// Esc INSERT:
//   visualOp+change+S → visualChange{span,linewise,text:inserted}
//   insertedText && Poa(U) && !visualOp && S → {...U, insertedText}
//   else insertedText || (claimEmptyInsert && !Poa) → insert{text}
// Hmn paste: recordChange({type:'paste', after, count}) then mutate
// F replay: if insertedText wrap enterInsert to re-type after op
```

### Local land

| File | Change |
|------|--------|
| `src/vim/types.ts` | `insertedText?` on ops; `paste` / `visualChange`; `isChangeOperatorRecord` (Poa) |
| `src/vim/operators.ts` | `executePaste` records paste |
| `src/hooks/useVimInput.ts` | Esc merge + S ref + paste/visualChange replay + withInsertedText |

tests: `src/vim/__tests__/dotRepeat.216.test.ts`

## 3. statusline twice on resume

### densable gold

```js
W = useRef(true)
useEffect(() => {
  if (W.current) {
    W.current = false
    return
  }
  // deps changed → debounced O()
}, [tokenUsage, permissionMode, vimMode, model, ...])
// separate mount effect: O() once
```

### Local land

`StatusLine.tsx`: `skipFirstStatusDepsEffect` mirrors densable `W` so mount
`doUpdate()` is the sole initial run.

tests: `src/components/__tests__/statusLineSkipFirst.216.test.ts`

## 4. resume-picker hangs on failure

### densable gold

```js
async function pe(be) {
  if (q.current) return
  q.current = true
  O(true) // resuming
  try {
    /* cross-project / pre-load */
  } catch (Me) {
    Re(Jo(pn(Me), 'resume picker: pre-load failed'))
    j({ sessionId: vS(be) ?? void 0 }) // sticky fail
    return
  }
  let De = false,
    Ge = 'load_error'
  try {
    let Me = await mFe(...)
    if (!Me) {
      M('tengu_session_resumed', {
        entrypoint: 'picker',
        success: false,
        failure_reason: 'not_found_picker',
      })
      De = true
      throw Error('Failed to load conversation')
    }
    Ge = 'processing_error'
    /* ... success → U resume data ... */
  } catch (Me) {
    if (!De)
      M('tengu_session_resumed', {
        entrypoint: 'picker',
        success: false,
        failure_reason: Se(Ge),
        error_name: pn(Me).name,
      })
    Re(Jo(pn(Me), 'resume picker: onSelect failed'))
    j({ sessionId: vS(be) ?? void 0 }) // sticky IQf — no rethrow
  }
}
// IQf: "Failed to resume the conversation." + retry copy with session id
```

### Local land

`ResumeConversation.tsx`: `selectingRef` + `resumeFailed` sticky UI; catch no longer rethrows.

tests: `src/screens/__tests__/resumePickerHang.216.test.ts`

## Status

| Symptom | Status after this land |
|---------|------------------------|
| @-mention after hooks | HAVE (Eio + H1e contentNotInModelContext) |
| vim c + paste | HAVE (types + paste record + Esc merge + replay) |
| statusline double | HAVE (skip-first deps effect) |
| resume-picker hang | HAVE (sticky fail UI) |

Umbrella #6 → **HAVE** (four needles landed + tests).
