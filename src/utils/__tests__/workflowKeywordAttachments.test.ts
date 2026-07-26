import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)
// mock.module is process-global (last-write-wins) — snapshot the real modules
// and spread them so co-suites keep the full export surface. Replacing
// analytics/index wholesale stomps attachAnalyticsSink / _resetForTesting and
// silently breaks scrollTelemetry.test.ts when it loads later.
const analyticsSnap = snapshotModuleExports(
  await import('src/services/analytics/index.js'),
)
const growthbookSnap = snapshotModuleExports(
  await import('src/services/analytics/growthbook.js'),
)

let settingsState: {
  workflowKeywordTriggerEnabled?: boolean
  enableWorkflows?: boolean
  disableWorkflows?: boolean
} = {}

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => settingsState,
    getSettingsForSource: () => ({}),
  }),
)

mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
}))

mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, defaultValue: unknown) =>
    defaultValue ?? true,
}))

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const { getWorkflowKeywordAttachments } = await import(
  'src/utils/attachments.js'
)
const { hasUltracodeKeyword, findUltracodeTriggerPositions } = await import(
  'src/utils/ultraplan/keyword.js'
)

describe('hasUltracodeKeyword (densable fSs/vCd)', () => {
  test('word-boundary match', () => {
    expect(hasUltracodeKeyword('please ultracode this')).toBe(true)
    expect(findUltracodeTriggerPositions('please ultracode this').length).toBe(
      1,
    )
  })
  test('skips path/identifier context', () => {
    expect(hasUltracodeKeyword('src/ultracode/foo.ts')).toBe(false)
    expect(hasUltracodeKeyword('ultracode.tsx')).toBe(false)
    expect(hasUltracodeKeyword('--ultracode-mode')).toBe(false)
  })
  test('skips quoted and slash commands', () => {
    expect(hasUltracodeKeyword('say "ultracode" aloud')).toBe(false)
    expect(hasUltracodeKeyword('/rename ultracode foo')).toBe(false)
  })
})

describe('getWorkflowKeywordAttachments (densable p2y)', () => {
  beforeEach(() => {
    settingsState = {}
    delete process.env.CLAUDE_CODE_DISABLE_WORKFLOWS
  })

  test('human-typed with keyword → workflow_keyword_request', () => {
    const out = getWorkflowKeywordAttachments('please ultracode the fix', {
      isHumanTypedPrompt: true,
    })
    expect(out).toEqual([{ type: 'workflow_keyword_request' }])
  })

  test('uses preExpansionInput for detection (paste-safe)', () => {
    const out = getWorkflowKeywordAttachments(
      'expanded with [Pasted text #1]',
      {
        isHumanTypedPrompt: true,
        preExpansionInput: 'please ultracode this',
      },
    )
    expect(out).toEqual([{ type: 'workflow_keyword_request' }])
  })

  test('non-human origin → empty', () => {
    const out = getWorkflowKeywordAttachments('please ultracode the fix', {
      isHumanTypedPrompt: false,
    })
    expect(out).toEqual([])
  })

  test('suppressWorkflowKeyword → empty', () => {
    const out = getWorkflowKeywordAttachments('please ultracode the fix', {
      isHumanTypedPrompt: true,
      suppressWorkflowKeyword: true,
    })
    expect(out).toEqual([])
  })

  test('no keyword → empty', () => {
    const out = getWorkflowKeywordAttachments('please fix the bug', {
      isHumanTypedPrompt: true,
    })
    expect(out).toEqual([])
  })

  test('workflowKeywordTriggerEnabled false → empty', () => {
    settingsState = { workflowKeywordTriggerEnabled: false }
    const out = getWorkflowKeywordAttachments('please ultracode the fix', {
      isHumanTypedPrompt: true,
    })
    expect(out).toEqual([])
  })

  test('disableWorkflows / FE off → empty', () => {
    settingsState = { disableWorkflows: true }
    const out = getWorkflowKeywordAttachments('please ultracode the fix', {
      isHumanTypedPrompt: true,
    })
    expect(out).toEqual([])
  })
})
