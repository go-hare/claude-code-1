/**
 * densable 2.1.229 QGo/Jsa/ex/Rhe gates for tryReactiveCompact.
 *
 * densable:
 *   function ex(){ if(Q.DISABLE_COMPACT)return!1;
 *     if(fn(process.env.DISABLE_AUTO_COMPACT))return!1;
 *     return pd("autoCompactEnabled",!0).value }
 *   function Rhe(){ if remote && !tengu_reactive_compact_remote → false; return true }
 *   function Jsa(e){
 *     return !hasAttempted && !$Ir(querySource)
 *       && (hasPrecomputedSwap || !yAt(querySource))
 *       && ex() && Rhe() && !aborted
 *   }
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.ts'

const realGrowthbook = await import('../../analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
let remoteGb = false
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) => {
    if (key === 'tengu_reactive_compact_remote') return remoteGb
    return growthbookSnap.getFeatureValue_CACHED_MAY_BE_STALE?.(key, fallback)
  },
}))

const realConfig = await import('../../../utils/config.js')
const configSnap = snapshotModuleExports(realConfig)
let autoCompactEnabled = true
mock.module('src/utils/config.js', () => ({
  ...configSnap,
  getGlobalConfig: () => ({
    ...((configSnap.getGlobalConfig?.() as object) ?? {}),
    autoCompactEnabled,
  }),
}))

const {
  canAttemptReactiveCompact,
  isReactiveCompactExEnabled,
  isReactiveCompactRemoteAllowed,
  isReactiveCompactBlockedQuerySource,
  REACTIVE_COMPACT_SKIP_QUERY_SOURCES,
  tryReactiveCompact,
} = await import('../reactiveCompact.js')

const prevDisableCompact = process.env.DISABLE_COMPACT
const prevDisableAuto = process.env.DISABLE_AUTO_COMPACT
const prevRemote = process.env.CLAUDE_CODE_REMOTE

beforeEach(() => {
  autoCompactEnabled = true
  remoteGb = false
  delete process.env.DISABLE_COMPACT
  delete process.env.DISABLE_AUTO_COMPACT
  delete process.env.CLAUDE_CODE_REMOTE
})

afterEach(() => {
  autoCompactEnabled = true
  remoteGb = false
})

afterAll(() => {
  if (prevDisableCompact === undefined) delete process.env.DISABLE_COMPACT
  else process.env.DISABLE_COMPACT = prevDisableCompact
  if (prevDisableAuto === undefined) delete process.env.DISABLE_AUTO_COMPACT
  else process.env.DISABLE_AUTO_COMPACT = prevDisableAuto
  if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
  else process.env.CLAUDE_CODE_REMOTE = prevRemote
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
})

describe('densable ex() / isReactiveCompactExEnabled', () => {
  test('default on when autoCompactEnabled and no DISABLE_*', () => {
    expect(isReactiveCompactExEnabled()).toBe(true)
  })

  test('DISABLE_COMPACT → false', () => {
    process.env.DISABLE_COMPACT = '1'
    expect(isReactiveCompactExEnabled()).toBe(false)
  })

  test('DISABLE_AUTO_COMPACT → false (densable ex, not emergency bypass)', () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    expect(isReactiveCompactExEnabled()).toBe(false)
  })

  test('autoCompactEnabled:false → false', () => {
    autoCompactEnabled = false
    expect(isReactiveCompactExEnabled()).toBe(false)
  })
})

describe('densable Rhe() / isReactiveCompactRemoteAllowed', () => {
  test('non-remote always true', () => {
    expect(isReactiveCompactRemoteAllowed()).toBe(true)
  })

  test('CLAUDE_CODE_REMOTE without GB → false', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    remoteGb = false
    expect(isReactiveCompactRemoteAllowed()).toBe(false)
  })

  test('CLAUDE_CODE_REMOTE with tengu_reactive_compact_remote → true', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    remoteGb = true
    expect(isReactiveCompactRemoteAllowed()).toBe(true)
  })
})

describe('densable Jsa / canAttemptReactiveCompact', () => {
  const base = {
    hasAttempted: false,
    querySource: 'repl_main_thread',
    aborted: false,
  }

  test('happy path allows attempt', () => {
    expect(canAttemptReactiveCompact(base)).toBe(true)
  })

  test('hasAttempted → false', () => {
    expect(canAttemptReactiveCompact({ ...base, hasAttempted: true })).toBe(
      false,
    )
  })

  test('aborted → false', () => {
    expect(canAttemptReactiveCompact({ ...base, aborted: true })).toBe(false)
  })

  test('$Ir querySource compact → false', () => {
    expect(isReactiveCompactBlockedQuerySource('compact')).toBe(true)
    expect(canAttemptReactiveCompact({ ...base, querySource: 'compact' })).toBe(
      false,
    )
  })

  test('yAt skip sources without precomputed swap → false', () => {
    for (const src of REACTIVE_COMPACT_SKIP_QUERY_SOURCES) {
      expect(canAttemptReactiveCompact({ ...base, querySource: src })).toBe(
        false,
      )
    }
  })

  test('yAt skip sources WITH hasPrecomputedSwap → true (densable branch)', () => {
    expect(
      canAttemptReactiveCompact({
        ...base,
        querySource: 'prompt_suggestion',
        hasPrecomputedSwap: true,
      }),
    ).toBe(true)
  })

  test('ex() off → false', () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    expect(canAttemptReactiveCompact(base)).toBe(false)
  })

  test('remote Rhe closed → false', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    remoteGb = false
    expect(canAttemptReactiveCompact(base)).toBe(false)
  })
})

describe('tryReactiveCompact respects Jsa (no summarize when gated)', () => {
  test('returns null without calling compact when DISABLE_AUTO_COMPACT', async () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    // If gate fails, we never touch toolUseContext — pass empty cacheSafeParams
    const out = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages: [],
      cacheSafeParams: {},
    })
    expect(out.result).toBeNull()
    expect(out.failure).toBeUndefined()
  })
})
