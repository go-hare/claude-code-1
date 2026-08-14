# densable 2.1.232 #37 — `/code-review` high/xhigh/max also background

## Changelog

> `/code-review` high/xhigh/max 也走 bg agent

## densable gold (SEA 2.1.232)

### Skill context (not level-gated)

```js
getContext(e, t) {
  if (hS()) return 'inline' // CLAUDE_CODE_COORDINATOR_MODE (+ remote/env gates)
  if (zXh(t)) return 'inline' // CLAUDE_CODE_REPORT_FINDINGS + ReportFindings tool
  return 'fork' // all effort levels including high/xhigh/max
}
```

### Background default (densable `Zyi` ≈ local `Cvo`)

```js
function Zyi(e, t) {
  if (t || CT() || Nn()) return false // forceSync / non-interactive / disable-bg
  return e.background ?? true
}
```

### `FNb` is analytics, not a bg gate

```js
FNb = new Set(['verify', 'pr', 'commit', 'code-review', 'simplify', 'go'])
// skill-name set for telemetry — does NOT decide background vs inline
```

Effort levels (`low|medium|high|xhigh|max`) only affect prompt depth / last-effort memory — **not** fork vs inline.

## Local

- `src/commands/codeReview.ts`: `context: 'fork'`, `background: true` (static; no level branch)
- `src/utils/forkedSkillBackground.ts` `shouldBackgroundForkedSkill` = densable Zyi
- Residual (not required for #37 HAVE): densable dynamic `getContext` coordinator / ReportFindings → inline exceptions
- Tests: `codeReview.218.test.ts` + `codeReviewBg.232.test.ts`
