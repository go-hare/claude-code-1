import { describe, expect, test } from 'bun:test'

import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../../../Tool.js'
import {
  applyPlanModeResumeFromInternal,
  classifyPlanModeOnResume,
  createPlanModeResumeTracker,
  isRestartedWorker,
  parseExternalPermissionMode,
  parseRecordedWorkerPermissionMode,
  restoredWorkerHasMetadata,
  syncWorkerPermissionModeRecord,
} from '../planModeResume.js'

function ctx(
  mode: ToolPermissionContext['mode'] = 'default',
): ToolPermissionContext {
  return { ...getEmptyToolPermissionContext(), mode }
}

function state(mode: ToolPermissionContext['mode'] = 'default') {
  return { toolPermissionContext: ctx(mode) }
}

function enterPlan<T extends { toolPermissionContext: ToolPermissionContext }>(
  prev: T,
): T {
  return {
    ...prev,
    toolPermissionContext: {
      ...prev.toolPermissionContext,
      prePlanMode: prev.toolPermissionContext.mode,
      mode: 'plan',
    },
  }
}

const allowRestore = {
  isGuardEnabled: () => true,
  isExitPlanModeEnabled: () => true,
  isExitPlanModeDenied: () => false,
  enterPlan,
  log: () => {},
}

describe('densable 2.1.239 #13 QnT / H8', () => {
  test('absent when worker_permission_mode is missing or null', () => {
    expect(parseRecordedWorkerPermissionMode(undefined)).toBe('absent')
    expect(parseRecordedWorkerPermissionMode(null)).toBe('absent')
    expect(parseRecordedWorkerPermissionMode({})).toBe('absent')
    expect(
      parseRecordedWorkerPermissionMode({ worker_permission_mode: null }),
    ).toBe('absent')
  })

  test('returns the external mode when H8 accepts it', () => {
    expect(
      parseRecordedWorkerPermissionMode({ worker_permission_mode: 'plan' }),
    ).toBe('plan')
    expect(
      parseRecordedWorkerPermissionMode({
        worker_permission_mode: 'acceptEdits',
      }),
    ).toBe('acceptEdits')
    expect(parseExternalPermissionMode('manual')).toBe('default')
    expect(
      parseRecordedWorkerPermissionMode({ worker_permission_mode: 'manual' }),
    ).toBe('default')
  })

  test('invalid for bubble / unknown / non-string (not permissionModeFromString default)', () => {
    expect(
      parseRecordedWorkerPermissionMode({ worker_permission_mode: 'bubble' }),
    ).toBe('invalid')
    expect(
      parseRecordedWorkerPermissionMode({ worker_permission_mode: 'nope' }),
    ).toBe('invalid')
    expect(
      parseRecordedWorkerPermissionMode({ worker_permission_mode: 1 }),
    ).toBe('invalid')
  })
})

describe('densable 2.1.239 #13 y_u', () => {
  test('re-enters plan from internal record (was default)', () => {
    const tracker = createPlanModeResumeTracker()
    const warns: string[] = []
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      {
        ...allowRestore,
        log: msg => {
          warns.push(msg)
        },
      },
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('plan')
    expect(next.toolPermissionContext.prePlanMode).toBe('default')
    expect(tracker.source).toBe('internal')
    expect(tracker.trustedMode).toBe('default')
    expect(tracker.recordedMode).toBe('plan')
    expect(classifyPlanModeOnResume(tracker)).toBe('restored')
    expect(warns.some(m => m.includes('re-entering plan mode'))).toBe(true)
  })

  test('skips when already in plan', () => {
    const tracker = createPlanModeResumeTracker()
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      allowRestore,
    )(state('plan'))
    expect(next.toolPermissionContext.mode).toBe('plan')
    expect(tracker.source).toBe('none')
    expect(classifyPlanModeOnResume(tracker)).toBe('none')
  })

  test('skips forkSession (recorded plan + trusted default → declined)', () => {
    const tracker = createPlanModeResumeTracker()
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      { ...allowRestore, forkSession: true },
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('default')
    expect(tracker.source).toBe('none')
    expect(classifyPlanModeOnResume(tracker)).toBe('declined')
  })

  test('skips when guard is off', () => {
    const tracker = createPlanModeResumeTracker()
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      { ...allowRestore, isGuardEnabled: () => false },
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('default')
    expect(classifyPlanModeOnResume(tracker)).toBe('declined')
  })

  test('skips when ExitPlanMode is disabled (official qqe.isEnabled)', () => {
    const tracker = createPlanModeResumeTracker()
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      { ...allowRestore, isExitPlanModeEnabled: () => false },
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('default')
    expect(classifyPlanModeOnResume(tracker)).toBe('declined')
  })

  test('skips when KS finds a deny rule for ExitPlanMode', () => {
    const tracker = createPlanModeResumeTracker()
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      { ...allowRestore, isExitPlanModeDenied: () => true },
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('default')
    expect(classifyPlanModeOnResume(tracker)).toBe('declined')
  })

  test('skips when recorded is not plan', () => {
    const tracker = createPlanModeResumeTracker()
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'acceptEdits' },
      tracker,
      allowRestore,
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('default')
    expect(tracker.recordedMode).toBe('acceptEdits')
    expect(classifyPlanModeOnResume(tracker)).toBe('none')
  })

  test('invalid recordedMode warns and does not restore', () => {
    const tracker = createPlanModeResumeTracker()
    const logs: string[] = []
    const next = applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'bubble' },
      tracker,
      {
        ...allowRestore,
        log: msg => {
          logs.push(msg)
        },
      },
    )(state('default'))
    expect(next.toolPermissionContext.mode).toBe('default')
    expect(tracker.recordedMode).toBe('invalid')
    expect(classifyPlanModeOnResume(tracker)).toBe('none')
    expect(
      logs.some(m =>
        m.includes(
          'ignoring unrecognized internal_metadata.worker_permission_mode',
        ),
      ),
    ).toBe(true)
  })
})

describe('densable 2.1.239 #13 Ibu / XWy', () => {
  test('Ibu: unset/1 is not restarted; >1 is', () => {
    expect(isRestartedWorker(undefined)).toBe(false)
    expect(isRestartedWorker(null)).toBe(false)
    expect(isRestartedWorker(1)).toBe(false)
    expect(isRestartedWorker(2)).toBe(true)
  })

  test('XWy skips enable when restarted and no restored metadata', () => {
    let enabled = false
    const writes: Array<Record<string, unknown>> = []
    syncWorkerPermissionModeRecord({
      enable: () => {
        enabled = true
      },
      notifyInternal: m => {
        writes.push(m)
      },
      currentMode: 'plan',
      planModeOnResume: 'restored',
      restored: { external: null, internal: null },
      restartedWorker: true,
    })
    expect(enabled).toBe(false)
    expect(writes).toEqual([])
    expect(restoredWorkerHasMetadata({ external: null, internal: null })).toBe(
      false,
    )
  })

  test('XWy enables and writes current mode when planModeOnResume is defined', () => {
    let enabled = false
    const writes: Array<Record<string, unknown>> = []
    syncWorkerPermissionModeRecord({
      enable: () => {
        enabled = true
      },
      notifyInternal: m => {
        writes.push(m)
      },
      currentMode: 'plan',
      planModeOnResume: 'none',
      restored: { external: { permission_mode: 'default' }, internal: {} },
      restartedWorker: true,
    })
    expect(enabled).toBe(true)
    expect(writes).toEqual([{ worker_permission_mode: 'plan' }])
  })

  test('XWy enables but does not write when planModeOnResume is undefined', () => {
    let enabled = false
    const writes: Array<Record<string, unknown>> = []
    syncWorkerPermissionModeRecord({
      enable: () => {
        enabled = true
      },
      notifyInternal: m => {
        writes.push(m)
      },
      currentMode: 'default',
      planModeOnResume: undefined,
      restored: { external: { permission_mode: 'default' }, internal: null },
      restartedWorker: false,
    })
    expect(enabled).toBe(true)
    expect(writes).toEqual([])
  })
})
