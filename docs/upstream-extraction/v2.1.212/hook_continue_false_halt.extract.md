# densable 2.1.212 — #9 continue:false halt + hook infra ≠ user reject

Changelog:

> Fixed a `continue:false` hook's halt being dropped when the tool fails or completes mid-stream, and hook infrastructure errors being misreported as user rejections

## densable `LKr` (PreToolUse halt attachment)

```js
function LKr(e, { toolName: t, toolUseID: r, message: n }) {
  e.push({
    message: xa({
      type: 'hook_stopped_continuation',
      message: n,
      hookName: `PreToolUse:${t}`,
      toolUseID: r,
      hookEvent: 'PreToolUse',
    }),
  })
}
```

`query.ts` sets `shouldPreventContinuation` when it sees `hook_stopped_continuation` attachment → return `{ reason: 'hook_stopped' }`.

## densable emit sites (I = shouldPreventContinuation from PreToolUse `continue:false`)

| path | condition | message |
|------|-----------|---------|
| PreToolUse `stop` case | `I && ae.stopReason && !aborted` | `oe \|\| "Execution stopped by hook"` |
| permission deny | `I && U.behavior==="deny" && U.decisionReason.type==="hook" && !aborted` | `R ?? se` |
| permission updatedInput schema fail | `I && !aborted` | `R \|\| "Execution stopped by hook"` |
| tool success after PostToolUse | `I && !aborted` | `R \|\| "Execution stopped by hook"` |
| tool **catch** (fail mid-stream) | `I && !isAbort && !aborted` | `R \|\| "Execution stopped by hook"` |

Local gap before fix: success path only; deny / catch / stop dropped the halt.

## densable PreToolUse infra error (`ZFu`)

```js
// per-result catch after hook_error_during_execution attachment:
if (u) {
  // u = last hookPermissionResult already decided
  yield { type: 'hookPermissionResult', hookPermissionResult: u }
  return
} else {
  yield {
    type: 'stop',
    stopReason:
      d ??
      'PreToolUse hook failed with an unexpected error. The tool call was not executed; other configured hooks may not have completed.',
  }
}
```

Bare `yield { type: 'stop' }` without ZFu was misread as a generic cancel / user reject surface. ZFu text is infrastructure, not a user denial.

## Local alignment

| densable | local |
|----------|-------|
| `LKr` | `pushPreToolUsePreventContinuation` in `toolExecution.ts` |
| success / deny-hook / catch / stop+stopReason | wired |
| ZFu + re-yield last permission | `runPreToolUseHooks` catch in `toolHooks.ts` |
| stop payload may include `stopReason` | `| { type: 'stop'; stopReason?: string }` |

## Out of scope / partial

- densable `toolDenialKind` / `aVu` outcome visibility on deny messages (separate auto-mode surface)
- densable schema-invalid `updatedInput` LKr site (local may lack that validation path)
