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
