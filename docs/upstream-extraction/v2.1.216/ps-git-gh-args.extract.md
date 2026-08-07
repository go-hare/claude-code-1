# densable 2.1.216 #31 — PowerShell `git`/`gh` argument validation

## Changelog

> Improved validation of `git` and `gh` command arguments in the PowerShell tool

## densable gold (SEA 2.1.216 ~224966640+)

### Sets

```js
// I5g — reject outright (dangerous globals)
I5g = new Set([
  "-c","-C","--exec-path","--config-env",
  "--git-dir","--work-tree","--bare",
  "--attr-source","--help","-h","--shallow-file",
])
// oDu — value-taking: skip next token when no `=`
oDu = new Set([
  "-c","-C","--exec-path","--config-env",
  "--git-dir","--work-tree","--namespace",
  "--super-prefix","--shallow-file",
])
D5g = ["-c","-C"]  // attached short forms
```

### `H5g` / `JIu` (isGitSafe)

```js
function Ris(e){ return e.map(t => qAe(wW(t.replace(/`[\r\n]+\s*/g,"")))) }
function H5g(e){
  let t = Ris(e)
  if (!iDu(e,t)) return false
  return JIu(e) && JIu(t)
}
// JIu: $ reject; D5g attached; I5g reject; oDu skip-by-2;
// subcommand via vjr; ls-remote: reject any positional (incl. after --);
// validateFlags
```

### `O5g` / `XIu` (isGhSafe)

```js
function O5g(e){
  let t = Ris(e)
  if (!iDu(e,t)) return false
  return XIu(e) && XIu(t)
}
function XIu(e){ return false }  // densable: gh never RO auto-allow
```

### Related Bash-only (`U9g`/`q9g`/`Ros`)

Used by Bash worktree/git-pin modeling (`vxu`), **not** the PS RO `JIu` path. Local Bash path is separate; this item is PowerShell tool.

## Local port

| densable | local (`readOnlyValidation.ts`) |
|----------|----------------------------------|
| `I5g` | `DANGEROUS_GIT_GLOBAL_FLAGS` (+`--bare`/`--help`/`-h`/`--shallow-file`) |
| `oDu` | `GIT_GLOBAL_FLAGS_WITH_VALUES` |
| `D5g` | `DANGEROUS_GIT_SHORT_FLAGS_ATTACHED` |
| `qAe`/`wW`/`Ris` | `normalizeUnicodeDashes` / `stripPsBacktickEscapes` / `normalizeGitArgv` |
| `iDu` | `gitArgvNormalizeInvariant` |
| `JIu`/`H5g` | `isGitSafeCore` / `isGitSafe` |
| `XIu` | `isGhSafe` → always `false` |

## Tests

`packages/builtin-tools/src/tools/PowerShellTool/__tests__/gitGhArgs.216.test.ts`

## Residuals

- densable `Ais` UNC per-arg reject inside `JIu` when `It()==="windows"` — local RO path already gates UNC earlier via permissions/`containsVulnerableUncPath`; not re-duplicated in `isGitSafeCore` unless a future audit shows bypass.
- densable `OIu` escape table `c5g` for alternate Sis maps — local uses plain Sis (wW) only.
