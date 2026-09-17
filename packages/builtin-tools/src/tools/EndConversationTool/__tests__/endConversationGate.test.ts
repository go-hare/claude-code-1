import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import {
  applyGrowthbookFeatureGetters,
  pushGrowthbookFeatureGetter,
} from '../../../../../../tests/mocks/growthbook.js'

// GrowthBook is process-global; snapshot + shared getter stack so siblings
// keep fallback/real semantics when this file's mock is last-write-wins.
const gbMock = mock(() => false as unknown)
let useEndConversationModel = false
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (flag: string, fallback: unknown) =>
    applyGrowthbookFeatureGetters(
      flag,
      fallback,
      growthbookSnap.getFeatureValue_CACHED_MAY_BE_STALE as (
        n: string,
        d: unknown,
      ) => unknown,
    ),
}))

const realSearchExtra = await import('src/utils/searchExtraTools.js')
const searchExtraSnap = snapshotModuleExports(realSearchExtra)
mock.module('src/utils/searchExtraTools.js', () => ({
  ...searchExtraSnap,
  isSearchExtraToolsEnabledOptimistic: () =>
    useEndConversationModel
      ? true
      : (
          searchExtraSnap.isSearchExtraToolsEnabledOptimistic as () => boolean
        )(),
}))

const realModel = await import('src/utils/model/model.js')
const modelSnap = snapshotModuleExports(realModel)
mock.module('src/utils/model/model.js', () => ({
  ...modelSnap,
  getMainLoopModel: ((...args: unknown[]) =>
    useEndConversationModel
      ? 'claude-opus-4-8'
      : (modelSnap.getMainLoopModel as (...a: unknown[]) => unknown)(
          ...args,
        )) as typeof modelSnap.getMainLoopModel,
}))

let popGb: (() => void) | undefined
beforeAll(() => {
  useEndConversationModel = true
  popGb = pushGrowthbookFeatureGetter((_flag, fallback) => {
    const v = gbMock()
    return v === undefined ? fallback : v
  })
})
afterAll(() => {
  useEndConversationModel = false
  popGb?.()
})

import {
  compileAllowedEntrypointsRegex,
  isEndConversationToolEnabled,
  modelMeetsEndConversationFloor,
  parseEndConversationFlagValue,
} from '../endConversationGate.js'

describe('parseEndConversationFlagValue', () => {
  test('true enables with default cli entrypoints', () => {
    const v = parseEndConversationFlagValue(true)
    expect(v.enabled).toBe(true)
    expect(v.allowedEntrypoints.test('cli')).toBe(true)
    expect(v.allowedEntrypoints.test('sdk')).toBe(false)
  })

  test('object with scope compiles alternation', () => {
    const v = parseEndConversationFlagValue({ scope: 'cli|sdk' })
    expect(v.enabled).toBe(true)
    expect(v.allowedEntrypoints.test('cli')).toBe(true)
    expect(v.allowedEntrypoints.test('sdk')).toBe(true)
    expect(v.allowedEntrypoints.test('web')).toBe(false)
  })

  test('false / unknown disables', () => {
    expect(parseEndConversationFlagValue(false).enabled).toBe(false)
    expect(parseEndConversationFlagValue(null).enabled).toBe(false)
    expect(parseEndConversationFlagValue('yes').enabled).toBe(false)
  })
})

describe('compileAllowedEntrypointsRegex', () => {
  test('invalid pattern returns null', () => {
    expect(compileAllowedEntrypointsRegex('(unclosed')).toBeNull()
  })

  test('non-string returns null', () => {
    expect(compileAllowedEntrypointsRegex(42)).toBeNull()
  })
})

describe('modelMeetsEndConversationFloor', () => {
  test('opus 4-8 meets floor', () => {
    expect(modelMeetsEndConversationFloor('claude-opus-4-8')).toBe(true)
    expect(modelMeetsEndConversationFloor('claude-opus-4-8-20260501')).toBe(
      true,
    )
  })

  test('opus below floor fails', () => {
    expect(modelMeetsEndConversationFloor('claude-opus-4-7')).toBe(false)
    expect(modelMeetsEndConversationFloor('claude-opus-4')).toBe(false)
  })

  test('sonnet 5 meets; sonnet 4 fails', () => {
    expect(modelMeetsEndConversationFloor('claude-sonnet-5')).toBe(true)
    expect(modelMeetsEndConversationFloor('claude-sonnet-4-5')).toBe(false)
  })

  test('unknown family fails', () => {
    expect(modelMeetsEndConversationFloor('claude-haiku-4-5')).toBe(false)
    expect(modelMeetsEndConversationFloor('gpt-4o')).toBe(false)
  })
})

describe('isEndConversationToolEnabled', () => {
  const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

  afterEach(() => {
    if (prevEntrypoint === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
    }
    gbMock.mockReset()
    gbMock.mockImplementation(() => false)
  })

  test('disabled without entrypoint', () => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    gbMock.mockImplementation(() => true)
    expect(isEndConversationToolEnabled('claude-opus-4-8')).toBe(false)
  })

  test('disabled when GB false', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    gbMock.mockImplementation(() => false)
    expect(isEndConversationToolEnabled('claude-opus-4-8')).toBe(false)
  })

  test('enabled when GB true + cli + floor', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    gbMock.mockImplementation(() => true)
    expect(isEndConversationToolEnabled('claude-opus-4-8')).toBe(true)
  })

  test('disabled for wrong entrypoint', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk'
    gbMock.mockImplementation(() => true)
    expect(isEndConversationToolEnabled('claude-opus-4-8')).toBe(false)
  })
})
