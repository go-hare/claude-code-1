/**
 * densable 2.1.218 Batch B pure helpers:
 * - uun parseUltrareviewArgs
 * - kgr previewInstructions
 * - pNo resolveUltrareviewBranchArg (prose / embedded_pr / branch)
 * - dun ultrareviewLaunchAcknowledgementNudge
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
  logEventAsync: async () => {},
  stripProtoFields: <V>(v: V) => v,
  attachAnalyticsSink: () => {},
  _resetForTesting: () => {},
}))
// Full surface: Bun mock.module is process-global; partial re-exports break
// named imports pulled transitively via git/teleport/gitignore graph.
// Snapshot + afterAll restore so null GB flags do not leak into fullscreen co-suites.
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
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
afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

// densable pNo: multi-word is branch only when rev-parse succeeds.
// Mock only the exec layer — do NOT mock src/utils/git.js. Incomplete git
// mocks drop dirIsInGitRepo and break the teleport/gitignore import graph
// (Bun mock.module is process-global; partial re-exports fail named imports).
let revParseHits = new Set<string>()
mock.module('src/utils/execFileNoThrow.js', () => ({
  execFileNoThrow: async (_cmd: string, args: string[]) => {
    // git rev-parse --verify --quiet <ref>
    const ref = args[args.length - 1] ?? ''
    return { code: revParseHits.has(ref) ? 0 : 1, stdout: '', stderr: '' }
  },
  execFileNoThrowWithCwd: async () => ({
    code: 1,
    stdout: '',
    stderr: '',
  }),
  // re-export surface from execFileNoThrowPortable — partial mock breaks
  // named imports in git/teleport graph (Bun mock.module process-global)
  execSyncWithDefaults_DEPRECATED: () => '',
}))

const {
  parseUltrareviewArgs,
  previewInstructions,
  resolveUltrareviewBranchArg,
  ultrareviewLaunchAcknowledgementNudge,
} = await import('../reviewRemote.js')

afterEach(() => {
  revParseHits = new Set()
})

describe('parseUltrareviewArgs (densable uun)', () => {
  test('strips leading and trailing --fix/--comment', () => {
    expect(parseUltrareviewArgs('--fix 42 --comment')).toEqual({
      scopeArgs: '42',
      applyFixes: true,
      comment: true,
    })
    expect(parseUltrareviewArgs('--comment --fix main')).toEqual({
      scopeArgs: 'main',
      applyFixes: true,
      comment: true,
    })
    expect(parseUltrareviewArgs('feature/x --fix')).toEqual({
      scopeArgs: 'feature/x',
      applyFixes: true,
      comment: false,
    })
  })

  test('leaves middle prose intact (flags only edges)', () => {
    const r = parseUltrareviewArgs('review my auth --fix changes')
    // densable uun only strips leading/trailing flag tokens, not mid-string
    expect(r.scopeArgs).toBe('review my auth --fix changes')
    expect(r.applyFixes).toBe(false)
  })

  test('empty scope after flags', () => {
    expect(parseUltrareviewArgs('--fix')).toEqual({
      scopeArgs: '',
      applyFixes: true,
      comment: false,
    })
  })
})

describe('previewInstructions (densable kgr)', () => {
  test('collapses whitespace', () => {
    expect(previewInstructions('review   my\nauth')).toBe('review my auth')
  })

  test('truncates with ellipsis at max', () => {
    const long = 'a'.repeat(100)
    const out = previewInstructions(long, 10)
    expect(out.length).toBe(10)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('resolveUltrareviewBranchArg (densable pNo)', () => {
  test('single-token is always branch', async () => {
    await expect(resolveUltrareviewBranchArg('main')).resolves.toEqual({
      kind: 'branch',
      baseArg: 'main',
    })
  })

  test('empty is branch with empty base', async () => {
    await expect(resolveUltrareviewBranchArg('')).resolves.toEqual({
      kind: 'branch',
      baseArg: '',
    })
  })

  test('multi-word valid ref is branch', async () => {
    revParseHits.add('origin/foo bar')
    await expect(resolveUltrareviewBranchArg('foo bar')).resolves.toEqual({
      kind: 'branch',
      baseArg: 'foo bar',
    })
  })

  test('multi-word non-ref prose → instructions + empty base', async () => {
    await expect(
      resolveUltrareviewBranchArg('review my auth changes'),
    ).resolves.toEqual({
      kind: 'prose',
      instructions: 'review my auth changes',
      baseArg: '',
    })
  })

  test('embedded PR number in prose → embedded_pr', async () => {
    const r = await resolveUltrareviewBranchArg(
      'please review PR 123 carefully',
    )
    expect(r.kind).toBe('embedded_pr')
    if (r.kind === 'embedded_pr') {
      expect(r.display).toBe('#123')
      expect(r.prToken).toBe('123')
    }
  })

  test('embedded PR URL in prose → embedded_pr', async () => {
    const r = await resolveUltrareviewBranchArg(
      'look at https://github.com/a/b/pull/99 please',
    )
    expect(r.kind).toBe('embedded_pr')
    if (r.kind === 'embedded_pr') {
      expect(r.display).toContain('/pull/99')
      expect(r.prToken).toContain('/pull/99')
    }
  })

  test('leading dash multi-word non-ref stays branch (correctable fail path)', async () => {
    await expect(
      resolveUltrareviewBranchArg('-not a flag branch'),
    ).resolves.toEqual({
      kind: 'branch',
      baseArg: '-not a flag branch',
    })
  })
})

describe('ultrareviewLaunchAcknowledgementNudge (densable dun)', () => {
  test('base acknowledgement', () => {
    const n = ultrareviewLaunchAcknowledgementNudge()
    expect(n).toContain('already visible to the user')
    expect(n).toContain('task-notification')
    expect(n).not.toContain('--fix')
  })

  test('includes --fix note', () => {
    expect(ultrareviewLaunchAcknowledgementNudge(true)).toContain(
      'passed --fix',
    )
  })

  test('includes prose instructions note (truncated)', () => {
    const n = ultrareviewLaunchAcknowledgementNudge(
      false,
      'review my auth changes carefully',
    )
    expect(n).toContain('review note, not a base branch')
    expect(n).toContain('review my auth changes carefully')
  })
})
