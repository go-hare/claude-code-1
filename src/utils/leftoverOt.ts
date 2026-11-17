/**
 * densable leftover `y` / `m` / `p` @180259146.
 * y → tengu_feature_ok {feature_name}
 * m → tengu_feature_bad {feature_name, error_code}
 * p → tengu_feature_sad {feature_name, error_code}
 * Gold `i()` is tengu logEvent. Catalog names are feature_name, not the event.
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'

function featureName(
  name: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/** densable `gge` — error_code token or `nonconforming`. */
function leftoverErrorCode(
  n: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return (
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(n) ? n : 'nonconforming'
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

type LeftoverAttrs = Record<string, string | number | boolean | undefined>

/** densable `y(name, attrs?)`. */
export function leftoverY(event: string, extra?: LeftoverAttrs): void {
  logEvent('tengu_feature_ok', {
    feature_name: featureName(event),
    ...Object.fromEntries(
      Object.entries(extra ?? {}).map(([k, v]) => [
        k,
        v as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ]),
    ),
  })
}

/** densable `m(name, reason, attrs?)`. */
export function leftoverM(
  event: string,
  reason: string,
  extra?: LeftoverAttrs,
): void {
  logEvent('tengu_feature_bad', {
    ...Object.fromEntries(
      Object.entries(extra ?? {}).map(([k, v]) => [
        k,
        v as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ]),
    ),
    feature_name: featureName(event),
    error_code: leftoverErrorCode(reason),
  })
}

/** densable `p(name, reason, attrs?)`. */
export function leftoverP(
  event: string,
  reason: string,
  extra?: LeftoverAttrs,
): void {
  logEvent('tengu_feature_sad', {
    ...Object.fromEntries(
      Object.entries(extra ?? {}).map(([k, v]) => [
        k,
        v as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ]),
    ),
    feature_name: featureName(event),
    error_code: leftoverErrorCode(reason),
  })
}
