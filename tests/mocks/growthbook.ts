/**
 * Shared mock for src/services/analytics/growthbook.js
 *
 * Bun mock.module is process-global (last-write-wins). Incomplete mocks of
 * growthbook break later files that import real exports (e.g. messages.ts →
 * getDynamicConfig_BLOCKS_ON_INIT). Keep this list complete when growthbook
 * gains exports.
 */
export function growthbookMock() {
  return {
    getFeatureValue_CACHED_MAY_BE_STALE: (_n: string, d: unknown) => d,
    getDynamicConfig_CACHED_MAY_BE_STALE: (_n: string, d: unknown) => d,
    getDynamicConfig_BLOCKS_ON_INIT: async (_n: string, d: unknown) => d,
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
    getFeatureValue_DEPRECATED: async () => undefined,
    // Real API is sync (deprecated wrapper over CACHED_MAY_BE_STALE).
    // Returning a Promise poisons co-running suites that call it without await.
    getFeatureValue_CACHED_WITH_REFRESH: (_n: string, d: unknown) => d,
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
  }
}
