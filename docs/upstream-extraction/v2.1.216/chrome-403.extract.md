# densable 2.1.216 #17 — Claude-in-Chrome 403 reconnect loop (missing OAuth scope)

## Official

> Fixed Claude-in-Chrome 403-looping on reconnect when the session's OAuth token lacks a required scope.

## densable gold

### `JKn()` — scopes accepted by `/api/oauth/validate`

```js
function JKn() {
  let e = ys()?.scopes
  return (
    Array.isArray(e) &&
    (e.includes(WCe) || // WCe = user:profile
      e.includes('user:office') ||
      e.includes('user:ccr_inference'))
  )
}
```

Related densable helpers:

- `ID()` — profile only (`WCe`)
- `QLe(e)` — arbitrary scope includes

### `yhn(e)` — should-enable Chrome (`Dtn` successor)

```js
function yhn(e) {
  if (!JKn())
    return (
      C(
        '[Claude in Chrome] Disabled: OAuth token has no scope accepted by /api/oauth/validate (needs user:profile, user:office, or user:ccr_inference; env-var and setup-token sessions default to user:inference only)',
      ),
      !1
    )
  if (e === !0) return !0
  if (e === !1) return !1
  if (Z.CLAUDE_CODE_ENABLE_CFC === !0) return !0
  if (Z.CLAUDE_CODE_ENABLE_CFC === !1) return !1
  if (dn()) return !1 // non-interactive
  let t = bt()
  if (t.claudeInChromeDefaultEnabled !== void 0)
    return t.claudeInChromeDefaultEnabled
  return !1
}
```

### Auto-enable base `Z4o`

```js
function Z4o() {
  return (
    fQe() !== !1 &&
    Z.CLAUDE_CODE_ENABLE_CFC !== !1 &&
    bt().claudeInChromeDefaultEnabled === void 0 &&
    U1() &&
    Xo() &&
    JKn()
  )
}
```

### Call site (main wiring)

```js
let _r = yhn(Xt.chrome) && Xo()
// … enterprise / safe-mode skips …
else if (_r) {
  /* setup chrome MCP */
}
```

**Root cause:** env-var / setup-token OAuth hardcodes `scopes: ['user:inference']`. Bridge `/api/oauth/validate` rejects that → 403 → reconnect loop if Chrome MCP is still wired. densable refuses enable **before** flag/CFC, so MCP never starts.

**Not densable for this fix:** inventing WS close-code stop-reconnect. Fix is enable-time gate only.

## Local land

| File | Change |
|------|--------|
| `src/utils/auth.ts` | pure `oauthScopesAcceptedByValidate` + `hasOauthValidateAcceptedScope` (JKn) |
| `src/utils/claudeInChrome/setup.ts` | `shouldEnableClaudeInChrome` = yhn (JKn first + densable disable log); `Z4o`/`hasBaseChromeAutoEnableEligibility` ends with JKn |
| tests | `oauthValidateScope.216.test.ts` + updated `shouldEnableClaudeInChrome.test.ts` |

## Tests

- `src/utils/__tests__/oauthValidateScope.216.test.ts`
- `src/utils/claudeInChrome/__tests__/shouldEnableClaudeInChrome.test.ts`
