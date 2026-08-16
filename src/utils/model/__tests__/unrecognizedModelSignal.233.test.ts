/**
 * densable 2.1.233 #16 — unrecognized model stderr signal (FRi / xLS).
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
import { getIsInteractive, setIsInteractive } from 'src/bootstrap/state.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

// Spread the real modules so these process-global mocks only swap the one export
// each assertion spies on, instead of blanking the rest for co-running suites.
const logMock = {
  ...snapshotModuleExports(await import('../../debug.js')),
  logForDebugging: mock((_message?: unknown) => {}),
}
mock.module('src/utils/debug.ts', () => logMock)
mock.module('src/utils/debug.js', () => logMock)

const analyticsMock = {
  ...snapshotModuleExports(
    await import('../../../services/analytics/index.js'),
  ),
  logEvent: mock((_name: string, _payload: Record<string, unknown>) => {}),
}
mock.module('src/services/analytics/index.ts', () => analyticsMock)
mock.module('src/services/analytics/index.js', () => analyticsMock)

// Drive interactivity through the real setter instead of mocking bootstrap/state:
// getIsNonInteractiveSession() is just !STATE.isInteractive, and a process-global
// mock of it pins every co-running suite (telemetry/events.ts reads the same gate).
const savedIsInteractive = getIsInteractive()

// Use the real `recognizePrintModel` (densable est). It short-circuits to
// `recognized` off first-party, so pin the provider via env instead of mocking
// printSetModel — a process-global mock there blanks `decidePrintSetModel` for
// co-running suites in this directory. Re-pinned per test because env leaks from
// other suites would otherwise route getAPIProvider() to a third party.
const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_GATEWAY',
] as const

const savedApiKey = process.env.ANTHROPIC_API_KEY
const savedBaseUrl = process.env.ANTHROPIC_BASE_URL
const savedProviderEnv = PROVIDER_ENV_KEYS.map(
  k => [k, process.env[k]] as const,
)

function pinFirstPartyProvider(): void {
  process.env.ANTHROPIC_API_KEY =
    savedApiKey || 'test-key-for-unrecognized-model-signal'
  delete process.env.ANTHROPIC_BASE_URL
  for (const key of PROVIDER_ENV_KEYS) delete process.env[key]
}

pinFirstPartyProvider()

import {
  resetUnrecognizedModelSignalClaimsForTests,
  signalUnrecognizedModel,
  stripModelContextSuffixes,
  UNRECOGNIZED_MODEL_SIGNAL_TAG,
} from '../unrecognizedModelSignal.js'

beforeEach(() => {
  pinFirstPartyProvider()
  setIsInteractive(false)
})

afterEach(() => {
  resetUnrecognizedModelSignalClaimsForTests()
  logMock.logForDebugging.mockClear()
  analyticsMock.logEvent.mockClear()
  setIsInteractive(savedIsInteractive)
  delete process.env.CLAUDE_CODE_SESSION_KIND
})

afterAll(() => {
  if (savedApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = savedApiKey
  }
  if (savedBaseUrl !== undefined) {
    process.env.ANTHROPIC_BASE_URL = savedBaseUrl
  }
  for (const [key, value] of savedProviderEnv) {
    if (value !== undefined) process.env[key] = value
  }
})

describe('stripModelContextSuffixes densable kd', () => {
  test('strips [1m] / [2m]', () => {
    expect(stripModelContextSuffixes('claude-opus-4-6[1m]')).toBe(
      'claude-opus-4-6',
    )
    expect(stripModelContextSuffixes('x[2M]')).toBe('x')
  })
})

describe('signalUnrecognizedModel densable FRi', () => {
  test('known claude-* form does not warn', () => {
    signalUnrecognizedModel('claude-sonnet-4-5', 'repl_main_thread')
    expect(analyticsMock.logEvent).not.toHaveBeenCalled()
  })

  test('unknown id emits tengu_api_unrecognized_model once', () => {
    signalUnrecognizedModel('totally-fake-model-xyz', 'sdk')
    expect(analyticsMock.logEvent).toHaveBeenCalledTimes(1)
    const [name, payload] = analyticsMock.logEvent.mock.calls[0]!
    expect(name).toBe('tengu_api_unrecognized_model')
    expect(String(payload.model)).toContain('totally-fake-model-xyz')

    // once per claim
    signalUnrecognizedModel('totally-fake-model-xyz', 'sdk')
    expect(analyticsMock.logEvent).toHaveBeenCalledTimes(1)
  })

  test('tag constant matches densable xLS', () => {
    expect(UNRECOGNIZED_MODEL_SIGNAL_TAG).toBe(
      '[claude-code:unrecognized_model]',
    )
  })

  test('interactive session uses debug warn not only claim', () => {
    setIsInteractive(true)
    signalUnrecognizedModel('not-a-real-model-abc', 'repl_main_thread')
    expect(analyticsMock.logEvent).toHaveBeenCalled()
    expect(logMock.logForDebugging).toHaveBeenCalled()
    const msg = String(logMock.logForDebugging.mock.calls[0]![0])
    expect(msg).toContain(UNRECOGNIZED_MODEL_SIGNAL_TAG)
  })
})
