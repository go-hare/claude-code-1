import type { StatusLineCommandInput } from '../types/statusLine.js'

export type StatusLineRawWindow = {
  utilization: number
  resets_at: number
}

export type StatusLineRawUtilization = {
  five_hour?: StatusLineRawWindow
  seven_day?: StatusLineRawWindow
  overage?: StatusLineRawWindow
}

/**
 * densable 2.1.251 `X1e` rate_limits.
 * `spend_limit` is included only when the provider is `"gateway"` and
 * `jL().overage` is present. `used_percentage` is utilization × 100
 * (not rounded). The object is omitted when no window is present.
 */
export function statusLineRateLimits(
  raw: StatusLineRawUtilization,
  provider: string,
): StatusLineCommandInput['rate_limits'] | undefined {
  const fiveHour = raw.five_hour
    ? {
        used_percentage: raw.five_hour.utilization * 100,
        resets_at: raw.five_hour.resets_at,
      }
    : undefined
  const sevenDay = raw.seven_day
    ? {
        used_percentage: raw.seven_day.utilization * 100,
        resets_at: raw.seven_day.resets_at,
      }
    : undefined
  const spendLimit =
    provider === 'gateway' && raw.overage
      ? {
          used_percentage: raw.overage.utilization * 100,
          resets_at: raw.overage.resets_at,
        }
      : undefined
  if (!fiveHour && !sevenDay && !spendLimit) return undefined
  return {
    ...(fiveHour && { five_hour: fiveHour }),
    ...(sevenDay && { seven_day: sevenDay }),
    ...(spendLimit && { spend_limit: spendLimit }),
  }
}
