/**
 * densable 2.1.214 #34 — feature flags go stale after OAuth token rotation.
 *
 * densable refreshGrowthBookFeatures (X8n):
 *   if (clientCreatedWithAuth) {
 *     await checkAndRefreshOAuthTokenIfNeeded().catch(...)
 *     auth = getAuthHeaders().Authorization
 *     if (auth !== undefined && auth !== stampedAuthorization) {
 *       sameAccount =
 *         oauth.accountUuid === stampedAccountUuid &&
 *         oauth.organizationUuid === stampedOrganizationUuid
 *       if (!sameAccount) resetUserCache()
 *       refreshGrowthBookAfterAuthChange({ preserveLoggedExposures: sameAccount })
 *       return  // hard recreate with fresh headers
 *     }
 *   }
 *   // else light refreshFeatures({ skipCache: true })
 *
 * densable refreshGrowthBookAfterAuthChange (Iwe):
 *   resetGrowthBook({
 *     preservePendingExposures: true,
 *     preserveLoggedExposures: opts?.preserveLoggedExposures,
 *   })
 *   emit + re-init
 */

export type GrowthBookAuthStamp = {
  authorization: string | undefined
  accountUuid: string | undefined
  organizationUuid: string | undefined
}

export type GrowthBookAuthRefreshDecision =
  | { action: 'none' }
  | {
      action: 'recreate'
      sameAccount: boolean
      preserveLoggedExposures: boolean
    }

/**
 * densable: accountUuid===iji && organizationUuid===sji
 * (undefined === undefined is true — same "no account" stamp).
 */
export function isSameGrowthBookAuthAccount(
  stamped: Pick<GrowthBookAuthStamp, 'accountUuid' | 'organizationUuid'>,
  current: Pick<GrowthBookAuthStamp, 'accountUuid' | 'organizationUuid'>,
): boolean {
  return (
    current.accountUuid === stamped.accountUuid &&
    current.organizationUuid === stamped.organizationUuid
  )
}

/**
 * densable 2.1.227 createClient pre-init OAuth failure label.
 * `Al(refresh, DPS=5000, Sbf="timeout")` → catch → message===Sbf ? "timeout" : name
 */
export function formatGrowthBookPreInitOAuthFailure(error: unknown): string {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : String(error))
  const kind = err.message === 'timeout' ? 'timeout' : err.name || 'Error'
  return `GrowthBook: pre-init OAuth refresh failed (${kind})`
}

/**
 * densable 2.1.227 createClient auth-header catch label.
 * `E(\`GrowthBook: auth header resolution failed (${_n(c).name}), continuing without auth\`)`
 */
export function formatGrowthBookAuthHeaderResolutionFailure(
  error: unknown,
): string {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : String(error))
  const name = err.name || 'Error'
  return `GrowthBook: auth header resolution failed (${name}), continuing without auth`
}

/** densable createClient pre-init OAuth timeout budget (DPS). */
export const GROWTHBOOK_PRE_INIT_OAUTH_TIMEOUT_MS = 5000

/** densable Al(..., Sbf) timeout reject message. */
export const GROWTHBOOK_PRE_INIT_OAUTH_TIMEOUT_MESSAGE = 'timeout'

/**
 * densable X8n Authorization branch:
 *   if (o !== undefined && o !== oji) → hard recreate
 */
export function decideGrowthBookAuthRefresh(input: {
  clientCreatedWithAuth: boolean
  stamped: GrowthBookAuthStamp
  currentAuthorization: string | undefined
  currentAccountUuid: string | undefined
  currentOrganizationUuid: string | undefined
}): GrowthBookAuthRefreshDecision {
  if (!input.clientCreatedWithAuth) {
    return { action: 'none' }
  }
  const auth = input.currentAuthorization
  if (auth === undefined || auth === input.stamped.authorization) {
    return { action: 'none' }
  }
  const sameAccount = isSameGrowthBookAuthAccount(input.stamped, {
    accountUuid: input.currentAccountUuid,
    organizationUuid: input.currentOrganizationUuid,
  })
  return {
    action: 'recreate',
    sameAccount,
    // densable: Iwe({ preserveLoggedExposures: s })
    preserveLoggedExposures: sameAccount,
  }
}
