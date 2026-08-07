# densable 2.1.216 #32 / #33 — ultrareview size + empty-diff copy

## Official

- #32: Improved the `/ultrareview` diff-too-large error to show configured limits, measured diff size, and largest contributing files
- #33: Improved `/code-review ultra` empty-diff message to name the exact base ref and suggest passing an explicit base

## densable gold

### #32 `local_diff_too_large` (branch path)

```js
// yno() → {maxFiles, maxLines} from tengu_review_bughunter_config
// v = Dro(shortstat); w = linesAdded+linesRemoved
// numstat: git -c core.quotepath=false diff --no-ext-diff --no-textconv --numstat <mergeBase>
// D = DHp(numstat) // top 3
error = `Diff is too large for ultrareview: ${files} ${file|s}, ${lines} ${line|s} changed (limits: ${maxFiles} …, ${maxLines} …).${D} Pass a closer base branch (\`${t} <branch>\`) to narrow the scope, or split the change.`

function DHp(e, t=3) {
  // Hmo(numstat) → perFileStats; sort by lines desc; top t
  return ` Largest files: path (N lines), ….`
}
```

PR path remains: `PR #N is too large for ultrareview (files, lines). Split… or run \`${t}\` on a narrower local diff.`

### #33 `empty_diff` (merge-base path)

```js
// used_origin_ref / had_explicit_base telemetry
error = `No changes to review: the diff against ${p} (merge-base ${g.slice(0,7)}) is empty. If you have local edits, stage or commit them first. If your branch was already merged or you meant a different base, ${suggest}.`
// suggest: hadArg → try a different base; else pass one explicitly
```

Empty-tree fallback empty_diff still uses the older “It doesn't look like you have any…” strings (unchanged).

## Local land

| File | Change |
|------|--------|
| `src/commands/review/reviewRemote.ts` | `parseGitNumstat` / `formatLargestDiffFiles` / `formatLocalDiffTooLargeError` / `formatEmptyDiffAgainstBaseError`; merge-base empty + too-large paths use them |
| tests | `reviewRemote.normalize.test.ts` #32/#33 pure cases |

## Tests

`src/commands/review/__tests__/reviewRemote.normalize.test.ts`
