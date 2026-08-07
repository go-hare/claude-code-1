# densable 2.1.216 #34 — spend limit reject shows server reason

## Official

> Improved the spend limit adjustment prompt to show the server's reason when a spend limit change is rejected

## densable gold

### `Per(e)` — user-facing API error message only

```js
function Per(e) {
  if (!bx(e)) return null // axios error
  let r = e.response?.data?.error
  if (r?.details?.error_visibility !== 'user_facing') return null
  return r.message ?? null
}
```

### `HWr(e, t)` — update spend limit

```js
async function HWr(e, t) {
  // … mock path omitted …
  try {
    let n = await Ci.put(
      '/api/oauth/organizations/:orgUUID/overage_spend_limit',
      { is_enabled: true, monthly_credit_limit: e, currency: t },
      { auth: 'teleport-org' },
    )
    if (!n.ok) throw Error(`overage_spend_limit unavailable: ${n.reason}`)
    return {
      ok: true,
      disabledUntil: n.data?.disabled_until ?? null,
      usedCredits: n.data?.used_credits ?? null,
      reason: null,
    }
  } catch (n) {
    // log…
    return {
      ok: false,
      disabledUntil: null,
      usedCredits: null,
      reason: Per(n),
    }
  }
}
```

### UI copy

- Dialog adjust-limit: `k.reason ? \`Failed to update spend limit: ${k.reason}\` : "Failed to update spend limit"`
- Nudge save: `byt.reason ? \`Could not update your spend limit: ${byt.reason}\` : "Could not update your spend limit. Press Enter to retry."`
- Success: `Monthly limit set to unlimited` / `Monthly limit updated to ${yd(...)}`

## Local land

| File | Change |
|------|--------|
| `src/services/api/usageCredits.ts` | `extractUserFacingApiErrorReason` (Per), `updateSpendLimit` (HWr), format helpers |
| `src/components/ExtraUsageDialog.tsx` | limit_confirm uses HWr + reason copy |
| tests | `spendLimitReason.216.test.ts` |

## Tests

`src/services/api/__tests__/spendLimitReason.216.test.ts`
