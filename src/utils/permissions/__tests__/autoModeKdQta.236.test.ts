/**
 * densable 2.1.236 #22 — KD() / qTa baked defaults when !KIt.
 * Bedrock/Vertex/Foundry + telemetry-off share the same severityByModel map.
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
import * as realGrowthbook from '../../../services/analytics/growthbook.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const getFeatureValueMock = mock((_key: string, defaultValue: unknown) => {
  return defaultValue
})
const isGrowthBookEnabledMock = mock(() => false)

// Snapshot real growthbook BEFORE mock — do not restore from growthbookMock().
const growthbookSnap = snapshotModuleExports(realGrowthbook)
function gbMockFactory() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: getFeatureValueMock,
    isGrowthBookEnabled: isGrowthBookEnabledMock,
  }
}
mock.module('src/services/analytics/growthbook.js', gbMockFactory)
mock.module('src/services/analytics/growthbook.ts', gbMockFactory)
mock.module('../../services/analytics/growthbook.js', gbMockFactory)
afterAll(() => {
  const restore = () => ({ ...growthbookSnap })
  mock.module('src/services/analytics/growthbook.js', restore)
  mock.module('src/services/analytics/growthbook.ts', restore)
  mock.module('../../services/analytics/growthbook.js', restore)
})

const {
  BAKED_AUTO_MODE_CONFIG,
  EMPTY_AUTO_MODE_CONFIG,
  resolveSeverityThresholds,
  resolveTenguAutoModeConfig,
} = await import('../autoModeFlags.js')

describe('resolveTenguAutoModeConfig (densable KD / qTa)', () => {
  beforeEach(() => {
    getFeatureValueMock.mockClear()
    isGrowthBookEnabledMock.mockClear()
    getFeatureValueMock.mockImplementation((_k, d) => d)
    isGrowthBookEnabledMock.mockImplementation(() => false)
  })

  afterEach(() => {
    getFeatureValueMock.mockImplementation((_k, d) => d)
    isGrowthBookEnabledMock.mockImplementation(() => false)
  })

  test('!KIt + empty remote → frozen qTa incl severityByModel', () => {
    isGrowthBookEnabledMock.mockImplementation(() => false)
    getFeatureValueMock.mockImplementation((_k, d) => d)

    const cfg = resolveTenguAutoModeConfig()
    expect(cfg).toBe(BAKED_AUTO_MODE_CONFIG)
    expect(cfg.twoStageClassifier).toBe(true)
    expect(cfg.sameTurnSiblingContext).toBe(true)
    expect(cfg.jsonlTranscript).toBe(true)
    expect(cfg.editRemovalVisibility).toBe(true)
    expect(cfg.editRemovalCap).toBe(3000)
    expect(cfg.outcomeVisibility).toBe(false)
    expect(cfg.repoVisibility).toBe(true)
    expect(cfg.gitStatusType).toBe(true)
    expect(cfg.gitStatusUploads).toBe(false)
    expect(cfg.severityByModel).toEqual({
      'claude-sonnet-5[1m]': { t1: 25, t2: 35 },
      'claude-opus-4-8[1m]': { t1: 45, t2: 35 },
      'claude-sonnet-5': { t1: 25, t2: 35 },
      'claude-opus-4-8': { t1: 45, t2: 35 },
    })
  })

  test('KIt + empty remote → Eri {}', () => {
    isGrowthBookEnabledMock.mockImplementation(() => true)
    getFeatureValueMock.mockImplementation((_k, d) => d)

    const cfg = resolveTenguAutoModeConfig()
    expect(cfg).toBe(EMPTY_AUTO_MODE_CONFIG)
    expect(cfg).toEqual({})
    expect(cfg.severityByModel).toBeUndefined()
  })

  test('remote non-empty → use remote (even when !KIt)', () => {
    isGrowthBookEnabledMock.mockImplementation(() => false)
    const remote = {
      twoStageClassifier: false as const,
      severityByModel: {
        'claude-sonnet-5': { t1: 10, t2: 20 },
      },
    }
    getFeatureValueMock.mockImplementation((key, d) =>
      key === 'tengu_auto_mode_config' ? remote : d,
    )

    const cfg = resolveTenguAutoModeConfig()
    expect(cfg).toBe(remote)
    expect(cfg.twoStageClassifier).toBe(false)
    expect(cfg.severityByModel?.['claude-sonnet-5']).toEqual({
      t1: 10,
      t2: 20,
    })
  })

  test('resolveSeverityThresholds uses qTa SEA keys when !KIt', () => {
    isGrowthBookEnabledMock.mockImplementation(() => false)
    getFeatureValueMock.mockImplementation((_k, d) => d)

    expect(resolveSeverityThresholds('claude-sonnet-5').value).toEqual({
      t1: 25,
      t2: 35,
    })
    expect(resolveSeverityThresholds('claude-opus-4-8').value).toEqual({
      t1: 45,
      t2: 35,
    })
    expect(resolveSeverityThresholds('claude-sonnet-5[1m]').value).toEqual({
      t1: 25,
      t2: 35,
    })
    expect(resolveSeverityThresholds('claude-opus-4-8[1m]').value).toEqual({
      t1: 45,
      t2: 35,
    })
    // Unknown model → null (block XML path, not invented thresholds)
    expect(resolveSeverityThresholds('claude-haiku-4-5').value).toBeNull()
  })
})
