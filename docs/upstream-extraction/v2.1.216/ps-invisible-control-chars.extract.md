# densable 2.1.216 #22 — PowerShell invisible / control-char permission validation

## Changelog

> Fixed PowerShell tool permission validation of commands containing invisible Unicode characters

## densable gold (SEA 2.1.216)

### Schema refine (primary gate)

PowerShell `fullInputSchema` (and Bash / Workflow / bridge string fields):

```js
function XAu(e){
  if(e===9||e===10)return!1  // TAB, LF allowed
  return e<32||e>=127&&e<=159  // C0 + DEL + C1
}
function r0e(e){
  for(let t=0;t<e.length;t++)if(XAu(e.charCodeAt(t)))return!1
  return!0
}
function K_(e){
  let t=""
  for(let r=0;r<e.length;r++)t+=XAu(e.charCodeAt(r))?"\uFFFD":e[r]
  return t
}
Wjg="command contains control characters that would be hidden in the approval dialog"
// PowerShell:
command: T.string().refine(r0e, Wjg)
// Bash: refine(r0e, Ya_) with Ya_ === Wjg
// Workflow script: refine(r0e, bS_)  // "script contains …"
```

SEA: `XAu`/`r0e` ~224655790; `Wjg` ~225059031; PS schema refine ~225059780.

### Related (NOT this item's primary gap)

- `zaa` — set_cwd / path **unsafe_path** Unicode property regex (Cc/Cf/Zl/Zp/DI + U+2800 + non-space Zs). Different surface (Cd trust boundary).
- `Jv_` / `Qid` — EnterWorktree path display sanitize (replace with U+FFFD). Display-only.
- Local `partiallySanitizeUnicode` — MCP/prompt Cf/Co/Cn strip; not the PS tool schema gate.

## Gap (pre-land)

Local `PowerShellTool` / `BashTool` `command: z.string()` had **no** `refine(r0e)`.

Bash still has separate security-path `CONTROL_CHAR_RE` (ask on misparse path) — densable also does **schema-level** fail-closed before permission UI.

## Local port

| densable | local |
|----------|-------|
| `XAu` | `isHiddenControlCode` in `src/utils/controlChars.ts` |
| `r0e` | `hasNoHiddenControlChars` |
| `K_` | `replaceHiddenControlChars` |
| `Wjg`/`Ya_` | `CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG` |
| PS/Bash schema | `.refine(hasNoHiddenControlChars, …)` on `command` |

## Tests

- `src/utils/__tests__/controlChars.216.test.ts`
- `packages/builtin-tools/src/tools/PowerShellTool/__tests__/controlCharsSchema.216.test.ts`

## Residuals

- Workflow `script` refine (`bS_`) and bridge URL refine not in #22 scope — land if checklist expands.
- `zaa` set_cwd unsafe_path property class is a separate Cd path item if still open.
