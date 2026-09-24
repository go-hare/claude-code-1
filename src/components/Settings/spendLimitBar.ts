import { areLimitsObserved } from '../../services/claudeAiLimits.js'

export type SpendLimitWindow = {
  utilization: number
  resets_at: number
}

export type SpendLimitBarModel = {
  type: 'bar'
  title: 'Spend limit'
  utilization: number
  resetsAtIso: string
  alwaysShowDateInReset: true
}

/**
 * densable 2.1.251 Dl empty arm copy (U+00B7 middle dot).
 * Gold: `HPe()?null:e(t,{dimColor:!0,children:"Spend limit · shown once your gateway reports one"})`
 */
export const SPEND_LIMIT_EMPTY_PLACEHOLDER =
  'Spend limit · shown once your gateway reports one'

export type SpendLimitPlaceholderModel = {
  type: 'placeholder'
  text: typeof SPEND_LIMIT_EMPTY_PLACEHOLDER
}

export type SpendLimitSectionModel =
  | SpendLimitBarModel
  | SpendLimitPlaceholderModel

/**
 * densable 2.1.251 `Dl` section model from `jL().overage` + `HPe`.
 *
 *   nm ? SpendBar : HPe() ? null : placeholder
 *
 * utilization is `Math.round(fraction * 100)`; resets_at is unix seconds
 * rendered as an ISO string; `alwaysShowDateInReset` is true.
 * `HPe` = `areLimitsObserved()` (`pm.limitsObserved`).
 */
export function spendLimitBarProps(
  overage: SpendLimitWindow | undefined,
): SpendLimitSectionModel | null {
  if (overage) {
    return {
      type: 'bar',
      title: 'Spend limit',
      utilization: Math.round(overage.utilization * 100),
      resetsAtIso: new Date(overage.resets_at * 1000).toISOString(),
      alwaysShowDateInReset: true,
    }
  }
  if (areLimitsObserved()) return null
  return {
    type: 'placeholder',
    text: SPEND_LIMIT_EMPTY_PLACEHOLDER,
  }
}
