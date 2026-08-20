# language-warn-dual-path adversarial refute

Claim: Both gold language-ignore strings present (`mhg` runtime + `AuE` PATH-resolve).

## Checklist
- [x] Locate gold strings for mhg / AuE
- [x] Verify runtime path (`useSpellcheckHighlights.ts`)
- [x] Verify PATH-resolve path (`checker.ts` / `resolveSpellcheckCommand`)
- [x] Check packaging residual / #13 preference impact
- [x] Decide HAVE / PARTIAL / GAP + refuted

## Findings
- Gold primary (`mhg`): `` `[spellcheck] ignoring spellcheck.language "${d}": not a plain dictionary name` ``
  - Present in `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/useSpellcheckHighlights.ts`
- Gold secondary (`AuE`): `` `[spellcheck] ignoring language "${t}" (not a plain dictionary name); the checker's default dictionary applies` ``
  - Present in `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/checker.ts` `resolveSpellcheckCommand`
- densable also sanitizes in `mhg` before `DCc`/`AuE`; AuE warn remains defensive secondary path. Local mirrors that.
- `#13` packaging residual is unrelated to this warn-string claim; risk note satisfied.

## Verdict
- refuted: false
- suggestedStatus: HAVE
