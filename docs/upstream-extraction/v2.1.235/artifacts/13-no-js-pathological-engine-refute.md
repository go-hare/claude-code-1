# Refute — claim `13-no-js-pathological-engine`

Updated: 2026-08-20

## Verdict

- `refuted`: **true** (against full **HAVE**)
- `suggestedStatus`: **PARTIAL**

## Why HAVE fails

Product invent-ban is largely satisfied (no JS pathological engine; native vendor rg carries `-m/-A/-C` + short-circuit strings). Full HAVE still fails because packaging parity is incomplete and intentionally residual:

1. SEA: argv0-embedded `rg` inside single Mach-O.
2. Local: sidecar vendor `15.0.0` (`src/utils/vendor/ripgrep/...` / package vendor), not argv0 Mach-O embed.
3. Board/checklist/progress + user preference keep **#13 PARTIAL** while residual remains.
4. `votes/embedded-rg-verdict.md` claiming HAVE conflicts with `artifacts/embedded-rg-verdict.md` / alignment board (**PARTIAL**).
5. `embeddedRipgrep.235.test.ts` locks `-m/-A/-C` only; it does not lock a pathological hang/fail-fast probe (docs overclaim patho coverage).

## Non-claims preserved

- Do not invent JS GrepHandler / pathological regex engine.
- Do not downgrade vendor 15 → SEA 14.1.1.
