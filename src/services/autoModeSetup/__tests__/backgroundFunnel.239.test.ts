/**
 * densable N6t funnel tail — the resolved event is followed by
 * `Ee`/`pe`/`be` → tengu_feature_ok / _bad / _sad.
 *
 * Process-global mock.module — snapshot + afterAll restore
 * (ProposeGoalTool.239 pattern). Dynamic import AFTER mocks.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import type { AppState } from '../../../state/AppState.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import { resetCommandQueue } from '../../../utils/messageQueueManager.js'
import type { BackgroundAutoModeSetupArgs } from '../background.js'
import type { AutoModeWriteResult } from '../write.js'

const events: Array<[string, Record<string, unknown>]> = []

const realAnalytics = await import('../../analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: (name: string, props: Record<string, unknown> = {}) => {
    events.push([name, props])
  },
}))

afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
})

const PROPOSAL = {
  environment: ['CI=1'],
  allow: [],
  soft_deny: [],
  hard_deny: [],
  remove_from_permissions_allow: [],
  notes: [],
}

const WRITE_RESULT: AutoModeWriteResult = {
  filePath: '/tmp/settings.json',
  autoModeKeysWritten: ['environment'],
  environmentEntriesPreserved: 0,
  permissionsAllowRemoved: [],
  permissionsAllowNotFound: [],
  permissionsAllowSkipped: false,
  warnings: [],
}

function makeArgs(
  overrides: Partial<BackgroundAutoModeSetupArgs>,
): BackgroundAutoModeSetupArgs {
  const store = createStore(getDefaultAppState())
  return {
    answers: { posture: 'mixed', scope: 'project', depth: 'here' },
    mode: 'append',
    permissionContext: {} as never,
    setAppState: (fn: (prev: AppState) => AppState) => {
      store.setState(fn)
    },
    requestDialog: (async () => 'accept') as never,
    propose: (async () => ({ ok: true, proposal: PROPOSAL })) as never,
    write: (async () => WRITE_RESULT) as never,
    ...overrides,
  }
}

function funnel(name: string): Record<string, unknown> | undefined {
  return events.find(([n]) => n === name)?.[1]
}

describe('logWizardResolved funnel tail (densable N6t)', () => {
  beforeEach(() => {
    events.length = 0
    resetCommandQueue()
  })

  test('saved → Ee / tengu_feature_ok', async () => {
    const { runBackgroundAutoModeSetup } = await import('../background.js')
    await runBackgroundAutoModeSetup(makeArgs({}))

    expect(funnel('tengu_auto_mode_setup_wizard_resolved')).toEqual({
      choice: 'saved',
      step: 'background',
      mode: 'append',
    })
    expect(funnel('tengu_feature_ok')).toEqual({
      feature_name: 'auto_mode_setup_wizard',
    })
    expect(funnel('tengu_feature_sad')).toBeUndefined()
    expect(funnel('tengu_feature_bad')).toBeUndefined()
  })

  test('decline → be / tengu_feature_sad carries the choice', async () => {
    const { runBackgroundAutoModeSetup } = await import('../background.js')
    await runBackgroundAutoModeSetup(
      makeArgs({ requestDialog: (async () => 'decline') as never }),
    )

    expect(funnel('tengu_feature_sad')).toEqual({
      feature_name: 'auto_mode_setup_wizard',
      error_code: 'decline',
    })
    expect(funnel('tengu_feature_ok')).toBeUndefined()
  })

  test('write failure → pe / tengu_feature_bad carries the step', async () => {
    const { runBackgroundAutoModeSetup } = await import('../background.js')
    await runBackgroundAutoModeSetup(
      makeArgs({
        write: (async () => {
          throw new Error('disk full')
        }) as never,
      }),
    )

    expect(funnel('tengu_feature_bad')).toEqual({
      feature_name: 'auto_mode_setup_wizard',
      error_code: 'background_write',
    })
    expect(funnel('tengu_feature_ok')).toBeUndefined()
  })
})
