/**
 * densable 2.1.233 #16 — unrecognized model stderr signal (FRi / xLS).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

const logMock = {
  logForDebugging: mock(() => {}),
}
mock.module('src/utils/debug.ts', () => logMock)
mock.module('src/utils/debug.js', () => logMock)

const analyticsMock = {
  logEvent: mock(() => {}),
}
mock.module('src/services/analytics/index.ts', () => analyticsMock)
mock.module('src/services/analytics/index.js', () => analyticsMock)

const stateMock = {
  getIsNonInteractiveSession: mock(() => true),
}
mock.module('src/bootstrap/state.ts', () => stateMock)
mock.module('src/bootstrap/state.js', () => stateMock)

// densable est approximation — only claude-* catalog is "known"
mock.module('src/utils/model/printSetModel.ts', () => ({
  recognizePrintModel: (model: string) =>
    /^claude-\S+$/i.test(model.trim())
      ? { recognized: true as const }
      : { recognized: false as const, shape: 'other' as const },
}))
mock.module('src/utils/model/printSetModel.js', () => ({
  recognizePrintModel: (model: string) =>
    /^claude-\S+$/i.test(model.trim())
      ? { recognized: true as const }
      : { recognized: false as const, shape: 'other' as const },
}))

import {
  resetUnrecognizedModelSignalClaimsForTests,
  signalUnrecognizedModel,
  stripModelContextSuffixes,
  UNRECOGNIZED_MODEL_SIGNAL_TAG,
} from '../unrecognizedModelSignal.js'

afterEach(() => {
  resetUnrecognizedModelSignalClaimsForTests()
  logMock.logForDebugging.mockClear()
  analyticsMock.logEvent.mockClear()
  stateMock.getIsNonInteractiveSession.mockImplementation(() => true)
  delete process.env.CLAUDE_CODE_SESSION_KIND
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
    stateMock.getIsNonInteractiveSession.mockImplementation(() => false)
    signalUnrecognizedModel('not-a-real-model-abc', 'repl_main_thread')
    expect(analyticsMock.logEvent).toHaveBeenCalled()
    expect(logMock.logForDebugging).toHaveBeenCalled()
    const msg = String(logMock.logForDebugging.mock.calls[0]![0])
    expect(msg).toContain(UNRECOGNIZED_MODEL_SIGNAL_TAG)
  })
})
