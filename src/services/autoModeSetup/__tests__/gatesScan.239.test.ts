/**
 * densable gates + AutoModeScanTask smoke.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
} from '../../../constants/xml.js'
import type { AppState } from '../../../state/AppState.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import {
  getCommandQueueLength,
  peek,
  resetCommandQueue,
} from '../../../utils/messageQueueManager.js'

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'TRANSCRIPT_CLASSIFIER',
}))

mock.module('../classifierModel.js', () => ({
  resolveAutoModeSetupClassifierModel: () => 'claude-sonnet-4-5',
}))

describe('autoModeSetup gates', () => {
  let prevRemote: string | undefined

  beforeEach(() => {
    prevRemote = process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_REMOTE
  })

  afterEach(() => {
    if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prevRemote
  })

  test('B4w false when CLAUDE_CODE_REMOTE', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const { isAutoModeSetupBaseGate, isAutoModeSetupEnabled } = await import(
      '../gates.js'
    )
    expect(isAutoModeSetupBaseGate()).toBe(false)
    expect(isAutoModeSetupEnabled()).toBe(false)
  })

  test('B4w false for any non-empty CLAUDE_CODE_REMOTE (gold !V.CLAUDE_CODE_REMOTE)', async () => {
    process.env.CLAUDE_CODE_REMOTE = 'remote'
    const { isAutoModeSetupBaseGate, isAutoModeSetupEnabled } = await import(
      '../gates.js'
    )
    expect(isAutoModeSetupBaseGate()).toBe(false)
    expect(isAutoModeSetupEnabled()).toBe(false)
  })

  test('KHl true when base + model', async () => {
    // Isolate from prior CLAUDE_CODE_REMOTE mutation in this file.
    delete process.env.CLAUDE_CODE_REMOTE
    const gates = await import('../gates.js')
    // bun:bundle `feature()` is often compile-inlined and ignores mock.module.
    // When the mock sticks, assert the full KHl contract; otherwise only the
    // remote-off branch of B4w is observable here.
    if (gates.isAutoModeSetupBaseGate()) {
      expect(gates.isAutoModeSetupEnabled()).toBe(true)
    } else {
      expect(gates.isAutoModeSetupEnabled()).toBe(false)
    }
  })
})

describe('AutoModeScanTask Dag/Nfc/lhs', () => {
  beforeEach(() => {
    resetCommandQueue()
  })

  afterEach(() => {
    resetCommandQueue()
  })

  test('register running then finish completed', async () => {
    const {
      findRunningAutoModeScan,
      finishAutoModeScanTask,
      registerAutoModeScanTask,
    } = await import('../../../tasks/AutoModeScanTask/AutoModeScanTask.js')

    const store = createStore(getDefaultAppState())
    const setAppState = (fn: (prev: AppState) => AppState) => {
      store.setState(fn)
    }
    const abort = new AbortController()
    const id = registerAutoModeScanTask(setAppState, {
      abortController: abort,
      gathersFromGitHubOrg: false,
    })
    expect(findRunningAutoModeScan(store.getState().tasks)?.id).toBe(id)
    expect(getCommandQueueLength()).toBe(0)
    expect(finishAutoModeScanTask(id, setAppState, 'completed')).toBe(true)
    expect(findRunningAutoModeScan(store.getState().tasks)).toBeUndefined()
    expect(store.getState().tasks[id]?.status).toBe('completed')
    const queued = peek()
    expect(queued?.mode).toBe('task-notification')
    const value = String(queued?.value ?? '')
    expect(value).toContain(`<${TASK_NOTIFICATION_TAG}>`)
    expect(value).toContain(
      `<${TASK_TYPE_TAG}>auto_mode_scan</${TASK_TYPE_TAG}>`,
    )
    expect(value).toContain(
      `<${SUMMARY_TAG}>Task "scanning for auto-mode setup" completed successfully</${SUMMARY_TAG}>`,
    )
    expect(getCommandQueueLength()).toBe(1)
    expect(finishAutoModeScanTask(id, setAppState, 'failed')).toBe(false)
    expect(getCommandQueueLength()).toBe(1)
  })
})

describe('Nrn answers → recon flags', () => {
  test('scope/depth matrix', async () => {
    const { answersToReconFlags, DEFAULT_RECON_FLAGS } = await import(
      '../answers.js'
    )
    expect(answersToReconFlags(undefined)).toEqual({ ...DEFAULT_RECON_FLAGS })
    expect(
      answersToReconFlags({
        posture: 'mixed',
        scope: 'project',
        depth: 'both',
      }),
    ).toEqual({
      allProjects: false,
      shellHistory: true,
      homeRepos: true,
    })
    expect(
      answersToReconFlags({
        posture: 'enterprise',
        scope: 'all',
        depth: 'here',
      }),
    ).toEqual({
      allProjects: true,
      shellHistory: false,
      homeRepos: false,
    })
  })
})
