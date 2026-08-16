/**
 * densable 2.1.233 #18 — Todo/Task tools model gate (uX / N_v / lCr / O_v).
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

const growthbookMock = {
  getFeatureValue_CACHED_MAY_BE_STALE: mock((_k: string, d: unknown) => d),
}
mock.module('src/services/analytics/growthbook.ts', () => growthbookMock)
mock.module('src/services/analytics/growthbook.js', () => growthbookMock)

// The `undefined model` case falls through to getMainLoopModel(), so pin the
// resolved model via env rather than mocking src/utils/model/model.js —
// `mock.module` is process-global and would leak into every co-running suite.
const savedAnthropicModel = process.env.ANTHROPIC_MODEL

import {
  isTodoToolsEnabledForModel,
  modelAllowsTodoToolsByDefault,
  modelMeetsTodoToolsDisabledFloor,
} from '../todoToolsGate.js'

beforeEach(() => {
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5'
})

afterAll(() => {
  if (savedAnthropicModel === undefined) {
    delete process.env.ANTHROPIC_MODEL
  } else {
    process.env.ANTHROPIC_MODEL = savedAnthropicModel
  }
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS
  delete process.env.USER_TYPE
  delete process.env.CLAUDE_CODE_SESSION_KIND
  delete process.env.CLAUDE_CODE_TODO_TOOLS_OPT_IN
  delete process.env.CLAUDE_CODE_BG_TAKEOVER
  growthbookMock.getFeatureValue_CACHED_MAY_BE_STALE.mockClear()
  growthbookMock.getFeatureValue_CACHED_MAY_BE_STALE.mockImplementation(
    (_k: string, d: unknown) => d,
  )
})

describe('modelMeetsTodoToolsDisabledFloor densable lCr/O_v', () => {
  test('opus 4.8+ blocked; opus 4.7 allowed', () => {
    expect(modelMeetsTodoToolsDisabledFloor('claude-opus-4-8')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-opus-4-9')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-opus-5-0')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-opus-4-7')).toBe(false)
    expect(modelMeetsTodoToolsDisabledFloor('claude-opus-4-6')).toBe(false)
  })

  test('sonnet/fable/mythos major 5+ blocked', () => {
    expect(modelMeetsTodoToolsDisabledFloor('claude-sonnet-5')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-sonnet-5-0')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-fable-5')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-mythos-5')).toBe(true)
    expect(modelMeetsTodoToolsDisabledFloor('claude-sonnet-4-5')).toBe(false)
    expect(modelMeetsTodoToolsDisabledFloor('claude-sonnet-4')).toBe(false)
  })

  test('unrecognized / bare aliases not blocked', () => {
    expect(modelMeetsTodoToolsDisabledFloor('opus')).toBe(false)
    expect(modelMeetsTodoToolsDisabledFloor('gpt-4')).toBe(false)
  })
})

describe('modelAllowsTodoToolsByDefault densable N_v', () => {
  test('inverse of floor', () => {
    expect(modelAllowsTodoToolsByDefault('claude-opus-4-8')).toBe(false)
    expect(modelAllowsTodoToolsByDefault('claude-opus-4-7')).toBe(true)
  })
})

describe('isTodoToolsEnabledForModel densable uX', () => {
  test('undefined model → true', () => {
    expect(isTodoToolsEnabledForModel(undefined)).toBe(true)
    expect(isTodoToolsEnabledForModel('')).toBe(true)
  })

  test('allowed model → true without env', () => {
    expect(isTodoToolsEnabledForModel('claude-sonnet-4-5')).toBe(true)
  })

  test('blocked model → false unless env/GB', () => {
    expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(false)
    expect(isTodoToolsEnabledForModel('claude-sonnet-5')).toBe(false)
  })

  test('CLAUDE_CODE_ENABLE_TODO_TOOLS force-on', () => {
    process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = '1'
    expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(true)
  })

  test('tengu_rosy_wren GB force-on', () => {
    growthbookMock.getFeatureValue_CACHED_MAY_BE_STALE.mockImplementation(
      (k: string, d: unknown) => (k === 'tengu_rosy_wren' ? true : d),
    )
    expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(true)
  })

  test('USER_TYPE=ant always on', () => {
    process.env.USER_TYPE = 'ant'
    expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(true)
  })

  // densable QR() — bg session force-on
  test('CLAUDE_CODE_SESSION_KIND=bg force-on (QR)', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(true)
  })

  // densable Ads residual env
  test('CLAUDE_CODE_TODO_TOOLS_OPT_IN force-on (Ads residual)', () => {
    process.env.CLAUDE_CODE_TODO_TOOLS_OPT_IN = '1'
    expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(true)
  })

  // densable Tds → replaceTodoToolsOptIn
  test('setTodoToolsOptIn (bootstrap launch option) force-on', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setTodoToolsOptIn } =
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    setTodoToolsOptIn(true)
    try {
      expect(isTodoToolsEnabledForModel('claude-opus-4-8')).toBe(true)
    } finally {
      setTodoToolsOptIn(false)
    }
  })
})
