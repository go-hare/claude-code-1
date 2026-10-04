/**
 * Organization policy limits — product-cut.
 *
 * Official Team/Enterprise fetches restrictions from Anthropic and can deny
 * remote control, workflows, feedback, etc. This fork never applies org
 * policy: every feature is allowed, nothing is enforced, no network.
 */

export type PolicyDenyKind = 'cache_miss' | 'org_denied'

export function _resetPolicyLimitsForTesting(): void {}

export function initializePolicyLimitsLoadingPromise(): void {}

export function isPolicyLimitsEligible(): boolean {
  return false
}

export async function waitForPolicyLimitsToLoad(): Promise<void> {}

export function isPolicyEnforced(_policy: string): boolean {
  return false
}

export function isPolicyAllowed(_policy: string): boolean {
  return true
}

export function getPolicyDenyKind(_policy: string): PolicyDenyKind | null {
  return null
}

export function isRemotePolicyAllowed(_policy: string): boolean {
  return true
}

export async function loadPolicyLimits(): Promise<void> {}

export async function primePolicyLimitsCache(
  _storageV5?: unknown,
): Promise<void> {}

export async function refreshPolicyLimits(): Promise<void> {}

export async function clearPolicyLimitsCache(): Promise<void> {}

export function startBackgroundPolling(): void {}

export function stopBackgroundPolling(): void {}
