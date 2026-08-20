import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as realConfig from '../config.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import type { FullscreenBootConfigSlice } from '../fullscreen.js'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_ABS_JS = join(CONFIG_DIR, '../config.js')
const CONFIG_ABS_TS = join(CONFIG_DIR, '../config.ts')

const configSnap = snapshotModuleExports(realConfig)

type BootConfig = FullscreenBootConfigSlice & Record<string, unknown>

let configState: BootConfig = {}
const saveCalls: BootConfig[] = []

const getGlobalConfigMock = mock(() => {
  // Prefer in-memory canary slice only — avoid leaking real ~/.claude.json sticky.
  return {
    ...configState,
  } as ReturnType<typeof realConfig.getGlobalConfig>
})
const saveGlobalConfigMock = mock(
  (updater: (current: BootConfig) => BootConfig) => {
    const next = updater({ ...configState })
    configState = {
      fullscreenBootPending: next.fullscreenBootPending,
      fullscreenBootStrikes: next.fullscreenBootStrikes,
      fullscreenAutoDisabled: next.fullscreenAutoDisabled,
    }
    saveCalls.push(configState)
    return configState as ReturnType<typeof realConfig.getGlobalConfig>
  },
)

const configMockFactory = () => ({
  ...configSnap,
  getGlobalConfig: getGlobalConfigMock,
  saveGlobalConfig: saveGlobalConfigMock,
})

// fullscreen.ts uses require('./config.js') — Bun matches by resolved id; cover
// relative + alias + absolute so process-global mock.module intercepts iIh.
const CONFIG_MOCK_IDS = [
  '../config.js',
  './config.js',
  'src/utils/config.js',
  CONFIG_ABS_JS,
  CONFIG_ABS_TS,
] as const

for (const id of CONFIG_MOCK_IDS) {
  mock.module(id, configMockFactory)
}

import * as realAnalytics from '../../services/analytics/index.js'
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
}))

afterAll(() => {
  const restore = () => ({ ...configSnap })
  for (const id of CONFIG_MOCK_IDS) {
    mock.module(id, restore)
  }
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
})

import {
  FULLSCREEN_BOOT_STICKY_STRIKES,
  FULLSCREEN_CLASSIC_FALLBACK_MESSAGE,
  FULLSCREEN_STICKY_OFF_MESSAGE,
  _resetForTesting,
  buildFullscreenBootReconcileContext,
  clearFullscreenBootHealthy,
  getCrashAutoOff,
  isFullscreenEnvEnabled,
  reconcileFullscreenBootAtLaunch,
  reconcileFullscreenBootConfig,
  setCrashAutoOff,
} from '../fullscreen.js'

// Match fullscreen.ts MACRO.VERSION without reading MACRO in the test file
// (Bun define injection applies to src modules; test files may not see MACRO).
const VERSION = buildFullscreenBootReconcileContext(0).version

function pendingEntry(
  overrides: Partial<{
    startedAt: number
    version: string
    host: string
    platform: string
    died: 'render_error'
  }> = {},
) {
  return {
    startedAt: overrides.startedAt ?? 1_000,
    version: overrides.version ?? VERSION,
    host: overrides.host ?? 'testhost',
    platform: overrides.platform ?? 'macos',
    ...(overrides.died ? { died: overrides.died } : {}),
  }
}

const ORIG = {
  NO_FLICKER: process.env.CLAUDE_CODE_NO_FLICKER,
  DISABLE_ALT: process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN,
  SESSION_KIND: process.env.CLAUDE_CODE_SESSION_KIND,
  EXIT_AFTER: process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER,
}

beforeEach(() => {
  configState = {}
  saveCalls.length = 0
  getGlobalConfigMock.mockClear()
  saveGlobalConfigMock.mockClear()
  _resetForTesting()
  delete process.env.CLAUDE_CODE_NO_FLICKER
  delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
  delete process.env.CLAUDE_CODE_SESSION_KIND
  delete process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER
})

afterEach(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  restore('CLAUDE_CODE_NO_FLICKER', ORIG.NO_FLICKER)
  restore('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN', ORIG.DISABLE_ALT)
  restore('CLAUDE_CODE_SESSION_KIND', ORIG.SESSION_KIND)
  restore('CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER', ORIG.EXIT_AFTER)
  _resetForTesting()
})

describe('reconcileFullscreenBootConfig (eIh)', () => {
  test('dead pending on same version → strike; Qbw=2 trips sticky', () => {
    const ctx = {
      now: 50_000,
      version: VERSION,
      host: 'testhost',
      platform: 'macos',
      ownPid: 999,
      isGone: () => true,
      stickyStrikes: FULLSCREEN_BOOT_STICKY_STRIKES,
    }

    const first = reconcileFullscreenBootConfig(
      {
        fullscreenBootPending: {
          '111': pendingEntry({ startedAt: 40_000 }),
        },
      },
      ctx,
    )
    expect(first.decision).toEqual({
      kind: 'strike',
      strikes: 1,
      newStrikes: 1,
      pendingAgeMs: 10_000,
    })
    expect(first.next.fullscreenBootStrikes).toEqual({
      count: 1,
      version: VERSION,
    })
    expect(first.next.fullscreenAutoDisabled).toBeUndefined()

    const second = reconcileFullscreenBootConfig(
      {
        fullscreenBootPending: {
          '222': pendingEntry({
            startedAt: 45_000,
            died: 'render_error',
          }),
        },
        fullscreenBootStrikes: { count: 1, version: VERSION },
      },
      ctx,
    )
    expect(second.decision.kind).toBe('tripped')
    if (second.decision.kind === 'tripped') {
      expect(second.decision.strikes).toBe(2)
      expect(second.decision.newStrikes).toBe(1)
    }
    expect(second.next.fullscreenAutoDisabled).toEqual({
      version: VERSION,
      at: 50_000,
      strikes: 2,
    })
    expect(second.next.fullscreenBootStrikes).toBeUndefined()
  })

  test('existing sticky for version → disabled without new strikes', () => {
    const { decision, next } = reconcileFullscreenBootConfig(
      {
        fullscreenAutoDisabled: {
          version: VERSION,
          at: 1,
          strikes: 2,
        },
        fullscreenBootPending: {
          '333': pendingEntry({ died: 'render_error' }),
        },
      },
      {
        now: 10,
        version: VERSION,
        host: 'testhost',
        platform: 'macos',
        ownPid: 1,
        isGone: () => true,
      },
    )
    expect(decision).toEqual({ kind: 'disabled' })
    expect(next.fullscreenAutoDisabled?.version).toBe(VERSION)
  })
})

describe('clearFullscreenBootHealthy (sIh)', () => {
  test('healthy clears pending pid + strikes', () => {
    const input: FullscreenBootConfigSlice = {
      fullscreenBootPending: {
        '42': pendingEntry(),
        '43': pendingEntry({ startedAt: 2 }),
      },
      fullscreenBootStrikes: { count: 1, version: VERSION },
    }
    const cleared = clearFullscreenBootHealthy(input, 42, true)
    expect(cleared.fullscreenBootPending).toEqual({
      '43': pendingEntry({ startedAt: 2 }),
    })
    expect(cleared.fullscreenBootStrikes).toBeUndefined()
  })

  test('withdraw clears pending only (keeps strikes)', () => {
    const cleared = clearFullscreenBootHealthy(
      {
        fullscreenBootPending: {
          '42': pendingEntry(),
        },
        fullscreenBootStrikes: { count: 1, version: VERSION },
      },
      42,
      false,
    )
    expect(cleared.fullscreenBootPending).toBeUndefined()
    expect(cleared.fullscreenBootStrikes).toEqual({
      count: 1,
      version: VERSION,
    })
  })
})

describe('crashAutoOff latch + iIh reconcile', () => {
  test('session latch forces Ps/isFullscreenEnvEnabled off (env force-on still wins)', () => {
    setCrashAutoOff(true)
    expect(getCrashAutoOff()).toBe(true)
    expect(isFullscreenEnvEnabled()).toBe(false)

    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('reconcileFullscreenBootAtLaunch sets crashAutoOff + writes oSw on strike', () => {
    configState = {
      fullscreenBootPending: {
        '777': pendingEntry({
          startedAt: Date.now() - 5_000,
          host: require('os').hostname(),
          platform: require('../platform.js').getPlatform(),
          died: 'render_error',
        }),
      },
    }

    const writes: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk))
      return true
    }) as typeof process.stderr.write

    try {
      const decision = reconcileFullscreenBootAtLaunch(Date.now())
      expect(decision.kind).toBe('strike')
      expect(getCrashAutoOff()).toBe(true)
      expect(writes.some(w => w === FULLSCREEN_CLASSIC_FALLBACK_MESSAGE)).toBe(
        true,
      )
      expect(configState.fullscreenBootStrikes?.count).toBe(1)
    } finally {
      process.stderr.write = origWrite
    }
  })

  test('reconcileFullscreenBootAtLaunch trips sticky and writes iSw at Qbw', () => {
    const host = require('os').hostname() as string
    const platform = require('../platform.js').getPlatform() as string
    configState = {
      fullscreenBootStrikes: { count: 1, version: VERSION },
      fullscreenBootPending: {
        '778': pendingEntry({
          startedAt: Date.now() - 1_000,
          host,
          platform,
          died: 'render_error',
        }),
      },
    }

    const writes: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk))
      return true
    }) as typeof process.stderr.write

    try {
      const decision = reconcileFullscreenBootAtLaunch(Date.now())
      expect(decision.kind).toBe('tripped')
      expect(getCrashAutoOff()).toBe(true)
      expect(writes.some(w => w === FULLSCREEN_STICKY_OFF_MESSAGE)).toBe(true)
      expect(configState.fullscreenAutoDisabled?.version).toBe(VERSION)
      expect(configState.fullscreenBootStrikes).toBeUndefined()
    } finally {
      process.stderr.write = origWrite
    }
  })
})
