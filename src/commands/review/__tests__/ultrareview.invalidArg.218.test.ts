/**
 * densable 2.1.218 #25 — /ultrareview invalid argument error feedback
 * so Claude can correct instead of retrying unchanged.
 *
 * densable surfaces correctable copy via formatLocalDiffTooLargeError /
 * formatEmptyDiffAgainstBaseError / pluralizeCount (shared with #7 path).
 */
import { describe, expect, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { mock } from 'bun:test'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
  logEventAsync: async () => {},
  stripProtoFields: <V>(v: V) => v,
  attachAnalyticsSink: () => {},
  _resetForTesting: () => {},
}))
mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => null,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
  getFeatureValue_DEPRECATED: async () => undefined,
  getFeatureValue_CACHED_WITH_REFRESH: async () => undefined,
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
  getDynamicConfig_BLOCKS_ON_INIT: async () => undefined,
  getDynamicConfig_CACHED_MAY_BE_STALE: () => undefined,
}))
mock.module('src/utils/execFileNoThrow.js', () => ({
  execFileNoThrow: async () => ({ code: 1, stdout: '', stderr: '' }),
  execFileNoThrowWithCwd: async () => ({ code: 1, stdout: '', stderr: '' }),
  execSyncWithDefaults_DEPRECATED: () => '',
}))

const {
  formatLocalDiffTooLargeError,
  formatEmptyDiffAgainstBaseError,
  pluralizeCount,
  parseUltrareviewArgs,
} = await import('../reviewRemote.js')

// densable DEFAULT_INVOCATION in reviewRemote (module-private) — product copy uses
// `/code-review ultra` / `/ultrareview` interchangeably for correctable hints.
const DEFAULT_INVOCATION = '/ultrareview'

describe('densable 2.1.218 #25 ultrareview correctable error feedback', () => {
  test('local_diff_too_large names limits and suggests closer base', () => {
    const msg = formatLocalDiffTooLargeError({
      filesCount: 120,
      totalLines: 50000,
      maxFiles: 100,
      maxLines: 10000,
      largestFilesSuffix: ' Largest files: a.ts (9,000 lines).',
      invocation: DEFAULT_INVOCATION,
    })
    expect(msg).toContain('Diff is too large for ultrareview')
    expect(msg).toContain('120')
    expect(msg).toContain('limits:')
    expect(msg).toContain('Pass a closer base branch')
    expect(msg).toContain(DEFAULT_INVOCATION)
    // correctable — not a bare "error" that invites blind retry
    expect(msg.toLowerCase()).not.toMatch(/^error$/)
  })

  test('empty_diff against base is correctable with branch suggestion', () => {
    const msg = formatEmptyDiffAgainstBaseError({
      diffAgainstRef: 'origin/main',
      mergeBaseSha: 'abcdef0123456789',
      hadExplicitBase: false,
      invocation: DEFAULT_INVOCATION,
    })
    expect(msg).toContain('No changes to review')
    expect(msg).toContain('origin/main')
    expect(msg).toContain('abcdef0')
    expect(msg).toContain('pass one explicitly')
    expect(msg).toContain(DEFAULT_INVOCATION)
  })

  test('pluralizeCount used in error copy', () => {
    expect(pluralizeCount(1, 'file')).toBe('file')
    expect(pluralizeCount(2, 'file')).toBe('files')
    expect(pluralizeCount(1, 'line')).toBe('line')
    expect(pluralizeCount(3, 'line')).toBe('lines')
  })

  test('parseUltrareviewArgs leaves prose intact for note path (not invalid)', () => {
    // descriptive args are valid #7 path — must not be treated as hard-invalid
    const r = parseUltrareviewArgs('review my auth changes')
    expect(r.scopeArgs).toBe('review my auth changes')
    expect(r.applyFixes).toBe(false)
  })
})
