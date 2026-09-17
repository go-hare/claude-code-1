/**
 * Shared mock for src/services/analytics/growthbook.js
 *
 * Bun mock.module is process-global (last-write-wins). Incomplete mocks of
 * growthbook break later files that import real exports (e.g. messages.ts →
 * getDynamicConfig_BLOCKS_ON_INIT). Keep this list complete when growthbook
 * gains exports.
 *
 * Per-suite values go through `pushGrowthbookFeatureGetter` so the last
 * mock.module factory can still honor another file's active override.
 */
export type GrowthbookFeatureGetter = (
  name: string,
  fallback: unknown,
) => unknown

const featureGetters: GrowthbookFeatureGetter[] = []

export function pushGrowthbookFeatureGetter(
  fn: GrowthbookFeatureGetter,
): () => void {
  featureGetters.push(fn)
  return () => {
    const i = featureGetters.lastIndexOf(fn)
    if (i >= 0) featureGetters.splice(i, 1)
  }
}

export function applyGrowthbookFeatureGetters(
  name: string,
  fallback: unknown,
  base?: GrowthbookFeatureGetter,
): unknown {
  if (featureGetters.length > 0) {
    return featureGetters[featureGetters.length - 1]!(name, fallback)
  }
  return base ? base(name, fallback) : fallback
}

export function growthbookMock() {
  return {
    getFeatureValue_CACHED_MAY_BE_STALE: (n: string, d: unknown) =>
      applyGrowthbookFeatureGetters(n, d),
    getDynamicConfig_CACHED_MAY_BE_STALE: (_n: string, d: unknown) => d,
    getDynamicConfig_BLOCKS_ON_INIT: async (_n: string, d: unknown) => d,
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
    getFeatureValue_DEPRECATED: async () => undefined,
    // Real API is sync (deprecated wrapper over CACHED_MAY_BE_STALE).
    // Returning a Promise poisons co-running suites that call it without await.
    getFeatureValue_CACHED_WITH_REFRESH: (n: string, d: unknown) =>
      applyGrowthbookFeatureGetters(n, d),
    // densable KIt — default false in mocks so KD→qTa paths are testable.
    isGrowthBookEnabled: () => false,
    hasGrowthBookEnvOverride: () => false,
    getAllGrowthBookFeatures: () => ({}),
    getGrowthBookConfigOverrides: () => ({}),
    setGrowthBookConfigOverride: () => {},
    clearGrowthBookConfigOverrides: () => {},
    getApiBaseUrlHost: () => undefined,
    onGrowthBookRefresh: () => {},
    initializeGrowthBook: async () => {},
    checkSecurityRestrictionGate: async () => false,
    checkGate_CACHED_OR_BLOCKING: async () => false,
    refreshGrowthBookAfterAuthChange: () => {},
    resetGrowthBook: () => {},
    refreshGrowthBookFeatures: async () => {},
    setupPeriodicGrowthBookRefresh: () => {},
    stopPeriodicGrowthBookRefresh: () => {},
    GROWTHBOOK_PERMISSION_MODE_WAIT_MS: 1500,
    awaitGrowthBookInitForPermissionMode: async () => {},
    awaitGrowthBookBeforePermissionMode: async () => {},
    hasAnyGrowthBookOverrides: () => false,
    resolveGrowthBookIdentityIds: (user: {
      organizationUuid?: string
      accountUuid?: string
    }) => {
      // Mirror real Qf env pin — AUTH_TOKEN suites set CLAUDE_CODE_*_UUID.
      const organizationUUID =
        user.organizationUuid ||
        process.env.CLAUDE_CODE_ORGANIZATION_UUID ||
        undefined
      const accountUUID =
        user.accountUuid || process.env.CLAUDE_CODE_ACCOUNT_UUID || undefined
      return {
        ...(organizationUUID ? { organizationUUID } : {}),
        ...(accountUUID ? { accountUUID } : {}),
      }
    },
    getFeatureValueWithSource: (n: string, d: unknown) => ({
      value: applyGrowthbookFeatureGetters(n, d),
      source: 'fallback' as const,
    }),
  }
}
