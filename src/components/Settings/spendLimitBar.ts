export type SpendLimitWindow = {
  utilization: number
  resets_at: number
}

export type SpendLimitBarModel = {
  title: 'Spend limit'
  utilization: number
  resetsAtIso: string
  alwaysShowDateInReset: true
}

/**
 * densable 2.1.251 `Dl` when `jL().overage` is set.
 * utilization is `Math.round(fraction * 100)`; resets_at is unix seconds
 * rendered as an ISO string; `alwaysShowDateInReset` is true.
 *
 * Official empty branch: `HPe() ? null : "Spend limit · shown once your
 * gateway reports one"` (U+00B7). gold-i `HPe` is `return pm.limitsObserved`.
 * Local `claudeAiLimits` (the `pm` / `getRawUtilization` store) has
 * `rawUtilization` and `currentLimits` only — `limitsObserved` is ABSENT
 * under that name and no other. Do not invent the field or a second copy
 * of the sentence until the store grows that flag.
 */
export function spendLimitBarProps(
  overage: SpendLimitWindow | undefined,
): SpendLimitBarModel | null {
  if (!overage) return null
  return {
    title: 'Spend limit',
    utilization: Math.round(overage.utilization * 100),
    resetsAtIso: new Date(overage.resets_at * 1000).toISOString(),
    alwaysShowDateInReset: true,
  }
}
