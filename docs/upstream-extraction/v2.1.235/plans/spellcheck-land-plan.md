# densable 2.1.235 #1 spellcheck — LAND PLAN (1:1)

> Status: **plan only** — do not treat checklist `HAVE` until the close-out steps below land and `*235*` tests pass.  
> Gold: `docs/upstream-extraction/v2.1.235/snippets/gold-spell-{protocol,policy,ui}.txt` (+ `gold-spellcheck*.txt`, `hit-spellcheck.txt`).  
> Convention: densable-first 1:1. No invent of VSCode host / enterprise gateway / Desktop-only surfaces.

## 0) Current local inventory (already present — do not re-scaffold)

| Area | Path | densable map | Note |
| ---- | ---- | ------------ | ---- |
| Zod schema | `/Users/apple/work-py/hare-code/claude-code-1/src/utils/settings/types.ts` | `spellcheck:{enabled,checker,language,color}` + outer describe | **Present** after `syntaxHighlightingDisabled` |
| Protocol helpers | `src/utils/spellcheck/protocol.ts` | `vKe/hs_/hEn/zTu/qTu/WTu/GTu/jTu/rdE` | Args/banner/request/parse/normalize checker |
| Tokenize | `src/utils/spellcheck/tokenize.ts` | `lhg` | Code-span / camelCase / CJK skips |
| Color | `src/utils/spellcheck/color.ts` | `edE/uhg` (`ndE` is verdicts stub, **not** color) | Default `"error"` |
| Checker session + host WeakMap | `src/utils/spellcheck/checker.ts` | `AuE/Bv/ihg/DCc/ohg/nhg` + timeouts | ~588 LOC; spawn + restart-once |
| Tier resolve | `src/utils/spellcheck/settings.ts` | `lRt`/`dhg` over user/flag/managed | Project/local ignore warns |
| Hook + fhg | `src/utils/spellcheck/useSpellcheckHighlights.ts` | `mhg` + `fhg` | Debounce 250ms; priority 2 |
| Barrel | `src/utils/spellcheck/index.ts` | — | Re-exports |
| Highlight type + paint | `src/utils/textHighlighting.ts`, `src/components/PromptInput/ShimmeredInput.tsx` | `underline` on `TextHighlight` → Ink `Text` | Present |
| PromptInput wiring | `src/components/PromptInput/PromptInput.tsx` | `mhg` call + `fhg(Er,Xr)` | Imports + merge at end of `combinedHighlights` |
| Partial tests | `src/utils/spellcheck/__tests__/spellcheckProtocol.235.test.ts` | protocol/color/tokenize only | **Incomplete** for land |

**Product gap remaining (why checklist still GAP):** incomplete densable 1:1 close-outs (fhg overlap semantics, host identity, normalizer warn sites, session/policy tests, active-gate fidelity) — **not** missing scaffolds.

## 1) densable contract (must keep 1:1)

### Protocol (`gold-spell-protocol.txt`)
- Checkers `vKe = ["aspell","hunspell","ispell"]`; language `hs_ = /^[A-Za-z][A-Za-z0-9_.,-]{0,63}$/`.
- Args `zTu`: aspell `-a --encoding=utf-8 --sug-mode=ultra [--lang=]`; hunspell `-a -i utf-8 [-d]`; ispell `-a [-d]`.
- Banner `qTu`: must start `@(#) International Ispell`; discriminate Aspell/Hunspell; else ispell.
- Handshake `jTu = "!\n"` after banner; pipe `WTu = ^words\n`; parse `GTu` (`''` end; `*|+|-` correct; `&|?|#` misspelled).
- Timeouts/budgets: `RuE=3000`, `xuE=15000`, `IuE=1000`, `PuE=1`, `thg=3`, `OuE={aspell:256,hunspell:16,ispell:256}`, `DuE=128`, `HuE=4096`, `NuE=65536`, `FuE=10000`, `OCc=80`.
- Telemetry **call sites**: `Ce("input_spellcheck", checker_lookup_failed|checker_not_found)`, `_e("input_spellcheck",{backend})`, `pe("input_spellcheck", reason)` → local may map onto `logEvent('input_spellcheck', …)` **without inventing densable Ce/_e/pe wrappers**.

### Policy (`gold-spell-policy.txt`)
- Allowed tiers only: **policy/managed → flag → user** whole-block first-defined-wins.
- **Ignore** project `.claude/settings.json` and local `.claude/settings.local.json` entirely (warn only).
- `enabled === true` only turns checking on.
- Exact warns:
  1. `a spellcheck block in project or local settings is ignored, whatever else is configured; set it in your user settings (~/.claude/settings.json) instead`
  2. `the spellcheck block in ${sourceDisplay} applies (as a whole, over any lower tier) and has no usable "enabled": true, so spell checking is off`
- Checker unknown → warn + `"auto"`; language invalid → warn + checker default; color invalid → warn + theme `"error"`.
- Prefer runtime language warn: `[spellcheck] ignoring spellcheck.language "${d}": not a plain dictionary name` (mhg). Alternate AuE string-table variant stays secondary.

### UI (`gold-spell-ui.txt`)
- Lifecycle: `resolving|starting|ready|unavailable` (+ internal `idle`).
- Host singleton: WeakMap keyed by PromptInput host object identity; remint on `${checker}:${language??""}`; dispose on disable.
- `fhg(base, spell)`: keep all base ranges; append spell range **iff it does not overlap any base range** (test against original base array `e`, **not** the accumulating result).
- Misspell highlight: `{start,end,color:edE(...),underline:true,priority:2}`.
- Paint via existing PromptInput → `HighlightedInput`/`ShimmeredInput` path (no SEA symbol named `HighlightedInput` required).

## 2) Ordered implementation steps (edit/create)

### Step A — Fix densable divergences in existing modules (edit only)
1. **`fhg` overlap semantics** — edit `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/useSpellcheckHighlights.ts` `mergeNonOverlapping` / `mergeSpellcheckHighlights`:
   - Overlap check must use the **pre-merge base array**, not the accumulating `out` (gold `fhg`).
2. **Normalizer warn sites** — edit:
   - `src/utils/spellcheck/protocol.ts` `normalizeSpellcheckChecker` (`rdE`): on unknown, log exact `[spellcheck] unknown spellcheck.checker "${e}"; looking for aspell, hunspell, ispell instead` then return `"auto"`.
   - `src/utils/spellcheck/color.ts` `normalizeSpellcheckColor` (`edE`): on unrecognized, log exact `[spellcheck] ignoring unrecognized spellcheck.color "${e}"; using the theme's error color` then return `"error"`.
   - Trim hook duplicate logs so each warn fires once at the densable site (avoid double-print).
3. **Host identity** — edit hook + PromptInput:
   - densable `mhg({host: Ar.host, …})`. Prefer PromptInput-stable `host` object (module/ref owned by PromptInput) passed into `useSpellcheckHighlights`, instead of a hook-private `{}` that cannot be shared if multiple consumers appear.
   - Keep `getOrCreateSpellcheckChecker` / `disposeSpellcheckChecker` WeakMap API (`DCc`/`ohg`).
4. **Active gate fidelity** — edit PromptInput call site:
   - densable: `active: mode === "prompt" && !overlayA && !overlayB`.
   - Local today: `active: !isModalOverlayActive` only. Align to prompt-mode ∧ ¬modal overlays without inventing extra gates (`screenReader` already inside hook via `isScreenReaderModeEnabled`).

### Step B — Settings / policy hardening (edit)
5. Keep reading via `getSecuritySensitiveSetting('spellcheck')` + source walk in `src/utils/spellcheck/settings.ts` — **do not** field-merge across tiers; **do not** use `getInitialSettings()` effective merge for enablement.
6. Confirm warn #2 uses `getSettingSourceDisplayNameLowercase(source)` (local stand-in for densable `xwn`); do not invent a second pretty-name table.
7. Schema already in `types.ts` — only touch if describe/prose drifts from gold outer describe; no project/local influence.

### Step C — Checker session polish (edit `checker.ts` only if tests expose drift)
8. Keep constants at gold values; spawn `stdio:pipe×3`, `env: subprocessEnv()` (≈ densable `tM`), `cwd: homedir()`, `windowsHide: true`, `extendEnv` sanitized (no invent of unrecovered `aMo` body).
9. Preserve restart-once (`PuE=1` / `IuE=1000`), slow-batch disable (`thg=3` → `checker_too_slow`), banner/response timeouts, terse handshake, verdict cache cap.
10. Telemetry: keep `logEvent('input_spellcheck', …)` call-site parity; **non-claim** exact densable `Ce/_e/pe` implementations.

### Step D — PromptInput / paint (edit; no new renderer)
11. Confirm `combinedHighlights` ends with `return mergeSpellcheckHighlights(highlights, spellcheckHighlights)` (already present).
12. Confirm `TextHighlight.underline?: boolean` and `ShimmeredInput` passes `underline={part.highlight?.underline}` (already present). Do **not** invent a separate `HighlightedInput` symbol.
13. Color type stays `keyof Theme | Color | undefined` — accept `ansi:` / `#rrggbb` / `rgb()` / `ansi256(n)` via existing Ink `Color` strings; do not invent a JS color dictionary.

### Step E — Tests (`*235*`) — create/extend
14. **Primary land test file (extend):**  
   `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/__tests__/spellcheckProtocol.235.test.ts`  
   Expand beyond protocol/tokenize/color to cover:
   - **Policy**: project/local ignore warn; whole-block no `enabled:true` warn; `enabled===true` only; checker/language/color exact warn strings.
   - **fhg**: base ranges preserved; spell range dropped on base overlap; two spell ranges that only overlap each other both kept when neither overlaps base.
   - **Session (mocked spawn / fake duplex)**: banner→handshake; `^words` batch; misspell/correct/end; restart-once then unavailable; banner timeout; no real aspell required in CI.
   - **Hook/merge smoke** (lightweight): misspell → `{underline:true, priority:2, color}` shape.
15. Optional split if file grows: `spellcheckSettings.235.test.ts`, `spellcheckChecker.235.test.ts` under the same `__tests__/` — still `*235*` suffix.
16. Mock rules: mock spawn/`which`/settings sources / `logForDebugging` / analytics; do **not** mock pure protocol/tokenize helpers. Prefer shared `tests/mocks/log` / `debug` patterns. Avoid process-global `mock.module` pollution of unrelated suites.

### Step F — Verification / checklist
17. `bun test src/utils/spellcheck/__tests__/spellcheckProtocol.235.test.ts` (and any sibling `*235*`).
18. `bun run precheck` (typecheck + lint fix + full test) — must be zero-error.
19. Update `docs/upstream-extraction/v2.1.235/official-235-checklist.md` + `alignment-board.md`: #1 **GAP → HAVE** only after Steps A–E green. Mention residuals explicitly (telemetry wrappers, spawn helper bodies).

## 3) Files summary

### Edit
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/useSpellcheckHighlights.ts` — fhg base-only overlap; host arg; dedupe warns
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/protocol.ts` — `rdE` warn inside normalizer
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/color.ts` — `edE` warn inside normalizer
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/settings.ts` — only if source/warn drift
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/checker.ts` — only if session tests expose drift
- `/Users/apple/work-py/hare-code/claude-code-1/src/components/PromptInput/PromptInput.tsx` — pass host; tighten `active` gate
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/settings/types.ts` — only if schema prose drifts (already present)
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/textHighlighting.ts` / `ShimmeredInput.tsx` — only if underline/color paint regresses (already present)

### Create / extend tests
- `/Users/apple/work-py/hare-code/claude-code-1/src/utils/spellcheck/__tests__/spellcheckProtocol.235.test.ts` (**canonical *235* land file**; extend)
- Optional: `spellcheckSettings.235.test.ts`, `spellcheckChecker.235.test.ts`

### Do **not** create (already covered / invent-ban)
- Separate `resolveChecker.ts` / `hostRegistry.ts` / `mergeHighlights.ts` / `hooks/useSpellcheckHighlights.ts` — local already collocates under `src/utils/spellcheck/*`.
- New Ink highlighter component named `HighlightedInput`.
- densable `Ce`/`_e`/`pe`/`aMo`/`tM`/`Ei` body reimplementations beyond call-site parity.
- Project/local spellcheck enablement paths.
- VSCode host / enterprise gateway / Desktop Notification spell surfaces.

## 4) Explicit non-claims

1. **Not claiming** recovered densable bodies for `Ce` / `_e` / `pe` telemetry wrappers — only call-site event names/payloads.
2. **Not claiming** full recovery of `aMo` spawn helper, `tM` env sanitizer, or `Ei` session-store internals — local uses `spawn` + `subprocessEnv` + `WeakMap`.
3. **Not inventing** VSCode extension host spellcheck, apps gateway control plane, or Desktop-only notification UX.
4. **Not** enabling spellcheck from project/local settings (ignore + warn only).
5. **Not** field-merging `enabled/checker/language/color` across tiers — whole block from highest allowed tier.
6. **Not** requiring a SEA symbol literally named `HighlightedInput`; paint path is local `ShimmeredInput`/`HighlightedInput` + Ink `Text.underline`.
7. **Not** treating alternate language warn string-table variant as the primary runtime string (mhg form wins).
8. **Not** marking checklist **HAVE** until Steps A–E + precheck are green; stubs/wiring alone ≠ closed land.
9. **Not** inventing a JS color name dictionary beyond Ink/`edE` acceptance forms.
10. **Not** folding 2.1.234 residuals or unrelated 235 items (#13 embedded rg, #19 VSCode focus) into this land.

## 5) Ready-to-land gate

Plan is **ready to execute** when implementers:
1. Apply Step A divergences first (fhg + warn sites + host/active).
2. Extend `spellcheckProtocol.235.test.ts` (and optional siblings) for policy/session/fhg.
3. Pass targeted `*235*` tests + `bun run precheck`.
4. Flip checklist #1 GAP → HAVE with residuals listed.

Until then: implementation scaffolds exist, but **#1 remains GAP** for densable 1:1 close-out.
