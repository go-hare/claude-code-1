/**
 * densable 2.1.247 J$ pin helpers for `forceLoginOrgUUID`.
 *
 * Schema is `string | string[]`. Validation (`validateForceLoginOrg`) accepts
 * any listed org. The OAuth authorize URL only takes one `orgUUID`.
 */

/**
 * densable J$ — `typeof n === "string" ? [n] : n`.
 * `undefined` is the only unset. An empty array is a deny-all pin.
 */
export function normalizeForceLoginOrgUuids(pin: undefined): undefined
export function normalizeForceLoginOrgUuids(pin: string | string[]): string[]
export function normalizeForceLoginOrgUuids(
  pin: string | string[] | undefined,
): string[] | undefined
export function normalizeForceLoginOrgUuids(
  pin: string | string[] | undefined,
): string[] | undefined {
  if (pin === undefined) {
    return undefined
  }
  return typeof pin === 'string' ? [pin] : pin
}

/**
 * OAuth authorize URL takes one `orgUUID`. densable login sites only pass a
 * string pin (`typeof === "string"`); an array is left unhinted and J$ checks
 * after login.
 *
 * A 1-element array is the same pin as a string (`["uuid"]` vs `"uuid"`), so
 * we hint that UUID. Two or more stay unhinted: picking [0] would pre-select
 * one org when any listed org is permitted.
 */
export function oauthLoginOrgUUIDHint(
  pin: string | string[] | undefined,
  methodMismatch: boolean,
): string | undefined {
  if (methodMismatch) {
    return undefined
  }
  const permitted = normalizeForceLoginOrgUuids(pin)
  if (permitted === undefined || permitted.length !== 1) {
    return undefined
  }
  return permitted[0]
}
