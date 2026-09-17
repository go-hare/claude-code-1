/**
 * densable 2.1.246 #40 — official `uy` / `fu` / `pu` / `my`.
 *
 * Print `--continue` hydrates from an open transcript plan segment.
 * Interactive `--continue` still skips `y_u` (239 gold).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../../../Tool.js'
import {
  applyPlanModeResumeFromInternal,
  classifyPlanModeOnResume,
  clearRestoredWorkerForPlanResumeForTests,
  createPlanModeResumeTracker,
  hydratePlanModeFromRestoredWorker,
  hydratePlanModeFromTranscript,
  scanTranscriptPlanState,
  setSkipPlanModeResumeBecauseContinue,
  shouldHydratePlanFromTranscript,
  type TranscriptPlanScanMessage,
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

const hydrateOpts = {
  isGuardEnabled: () => true,
  isExitPlanModeEnabled: () => true,
  isExitPlanModeDenied: () => false,
  enterPlan,
  log: () => {},
}

function attachment(
  type: 'plan_mode' | 'plan_mode_reentry' | 'plan_mode_exit',
): TranscriptPlanScanMessage {
  return { type: 'attachment', attachment: { type } }
}

function userText(
  text: string,
  extra: Partial<TranscriptPlanScanMessage> = {},
): TranscriptPlanScanMessage {
  return {
    type: 'user',
    message: { content: text },
    ...extra,
  }
}

function toolResult(
  id: string,
  extra: {
    is_error?: boolean
    content?: string
    toolUseResult?: unknown
  } = {},
): TranscriptPlanScanMessage {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          is_error: extra.is_error,
          content: extra.content,
        },
      ],
    },
    toolUseResult: extra.toolUseResult,
  }
}

function toolUse(name: string, id: string): TranscriptPlanScanMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, id }] },
  }
}

describe('densable 2.1.246 #40 uy', () => {
  test('plan_mode / plan_mode_reentry → open', () => {
    expect(scanTranscriptPlanState([attachment('plan_mode')])).toBe('open')
    expect(scanTranscriptPlanState([attachment('plan_mode_reentry')])).toBe(
      'open',
    )
  })

  test('plan_mode_exit → exited', () => {
    expect(scanTranscriptPlanState([attachment('plan_mode_exit')])).toBe(
      'exited',
    )
  })

  test('later human non-plan then plan_mode → none', () => {
    expect(
      scanTranscriptPlanState([
        attachment('plan_mode'),
        userText('ship it', {
          permissionMode: 'default',
          origin: { kind: 'human' },
        }),
      ]),
    ).toBe('none')
  })

  test('<command-name>/plan and permissionMode plan → open', () => {
    expect(
      scanTranscriptPlanState([userText('<command-name>/plan</command-name>')]),
    ).toBe('open')
    expect(
      scanTranscriptPlanState([
        userText('keep planning', { permissionMode: 'plan' }),
      ]),
    ).toBe('open')
  })

  test('successful ExitPlanMode → exited; EnterPlanMode → open', () => {
    expect(
      scanTranscriptPlanState([
        toolUse('ExitPlanMode', 'exit-1'),
        toolResult('exit-1'),
      ]),
    ).toBe('exited')
    expect(
      scanTranscriptPlanState([
        toolUse('EnterPlanMode', 'enter-1'),
        toolResult('enter-1'),
      ]),
    ).toBe('open')
  })

  test('leader-approval tool_result is not a success ExitPlanMode', () => {
    expect(
      scanTranscriptPlanState([
        toolUse('ExitPlanMode', 'exit-lead'),
        toolResult('exit-lead', {
          content: 'Your plan has been submitted to the team lead for review',
        }),
      ]),
    ).toBe('none')
  })

  test('empty / unrelated → none', () => {
    expect(scanTranscriptPlanState([])).toBe('none')
    expect(scanTranscriptPlanState([userText('hello')])).toBe('none')
  })
})

describe('densable 2.1.246 #40 fu', () => {
  test('false when ExitPlanMode disabled or forkSession', () => {
    expect(
      shouldHydratePlanFromTranscript({
        permissionModeSuppliedOnInvocation: false,
        isExitPlanModeEnabled: () => false,
      }),
    ).toBe(false)
    expect(
      shouldHydratePlanFromTranscript({
        permissionModeSuppliedOnInvocation: false,
        forkSession: true,
        isExitPlanModeEnabled: () => true,
      }),
    ).toBe(false)
  })

  test('true when sdkUrl or permissionModeSuppliedOnInvocation === false', () => {
    expect(
      shouldHydratePlanFromTranscript({
        sdkUrl: 'wss://example',
        isExitPlanModeEnabled: () => true,
      }),
    ).toBe(true)
    expect(
      shouldHydratePlanFromTranscript({
        permissionModeSuppliedOnInvocation: false,
        isExitPlanModeEnabled: () => true,
      }),
    ).toBe(true)
  })

  test('false when invocation supplied a permission mode and no sdkUrl', () => {
    expect(
      shouldHydratePlanFromTranscript({
        permissionModeSuppliedOnInvocation: true,
        isExitPlanModeEnabled: () => true,
      }),
    ).toBe(false)
    expect(
      shouldHydratePlanFromTranscript({
        isExitPlanModeEnabled: () => true,
      }),
    ).toBe(false)
  })
})

describe('densable 2.1.246 #40 my / pu', () => {
  test('continue hydrates from open plan_mode when mode was not supplied', () => {
    let app = state('default')
    const onResume = hydratePlanModeFromTranscript(
      f => {
        app = f(app)
      },
      [attachment('plan_mode')],
      {
        permissionModeSuppliedOnInvocation: false,
        ...hydrateOpts,
      },
    )
    expect(onResume).toBe('restored')
    expect(app.toolPermissionContext.mode).toBe('plan')
  })

  test('skips when --permission-mode was supplied', () => {
    let app = state('default')
    const onResume = hydratePlanModeFromTranscript(
      f => {
        app = f(app)
      },
      [attachment('plan_mode')],
      {
        permissionModeSuppliedOnInvocation: true,
        ...hydrateOpts,
      },
    )
    expect(onResume).toBe('none')
    expect(app.toolPermissionContext.mode).toBe('default')
  })

  test('transcriptOpen + trusted default → declined when deny blocks enter', () => {
    let app = state('default')
    const onResume = hydratePlanModeFromTranscript(
      f => {
        app = f(app)
      },
      [attachment('plan_mode')],
      {
        permissionModeSuppliedOnInvocation: false,
        ...hydrateOpts,
        isExitPlanModeDenied: () => true,
      },
    )
    expect(app.toolPermissionContext.mode).toBe('default')
    expect(onResume).toBe('declined')
  })
})

describe('densable 2.1.246 #40 resume mu-then-pu', () => {
  test('internal plan record wins; pu does not overwrite source', () => {
    clearRestoredWorkerForPlanResumeForTests()
    let app = state('default')
    const onResume = hydratePlanModeFromRestoredWorker(
      f => {
        app = f(app)
      },
      { external: null, internal: { worker_permission_mode: 'plan' } },
      {
        lane: 'print',
        transcript: [attachment('plan_mode')],
        applyTranscriptHydrate: true,
        permissionModeSuppliedOnInvocation: false,
        ...hydrateOpts,
      },
    )
    expect(onResume).toBe('restored')
    expect(app.toolPermissionContext.mode).toBe('plan')
  })

  test('absent worker record + open transcript → pu restores', () => {
    clearRestoredWorkerForPlanResumeForTests()
    let app = state('default')
    const onResume = hydratePlanModeFromRestoredWorker(
      f => {
        app = f(app)
      },
      { external: null, internal: null },
      {
        lane: 'print',
        transcript: [attachment('plan_mode')],
        applyTranscriptHydrate: true,
        permissionModeSuppliedOnInvocation: false,
        ...hydrateOpts,
      },
    )
    expect(onResume).toBe('restored')
    expect(app.toolPermissionContext.mode).toBe('plan')
  })

  test('continue skip still blocks y_u', () => {
    clearRestoredWorkerForPlanResumeForTests()
    setSkipPlanModeResumeBecauseContinue(true)
    let app = state('default')
    const onResume = hydratePlanModeFromRestoredWorker(
      f => {
        app = f(app)
      },
      { external: null, internal: { worker_permission_mode: 'plan' } },
      { lane: 'interactive' },
    )
    expect(onResume).toBe('none')
    expect(app.toolPermissionContext.mode).toBe('default')
    clearRestoredWorkerForPlanResumeForTests()
  })

  test('mu records uy(transcript) when recordedMode is plan', () => {
    const tracker = createPlanModeResumeTracker()
    applyPlanModeResumeFromInternal(
      { worker_permission_mode: 'plan' },
      tracker,
      {
        ...hydrateOpts,
        transcript: [attachment('plan_mode_exit')],
      },
    )(state('plan'))
    expect(tracker.recordTranscriptState).toBe('exited')
    expect(classifyPlanModeOnResume(tracker)).toBe('none')
  })
})

describe('densable 2.1.246 #40 print/main wiring', () => {
  test('print --continue calls my; resume success passes transcript to pu', () => {
    const print = readFileSync(
      join(import.meta.dir, '../../../cli/print.ts'),
      'utf8',
    )
    const main = readFileSync(
      join(import.meta.dir, '../../../main.tsx'),
      'utf8',
    )
    expect(print).toContain('hydratePlanModeFromTranscript')
    expect(print).toContain('Official 246 `my(messages)`')
    expect(print).toContain('applyTranscriptHydrate: messages !== undefined')
    expect(main).toContain('permissionModeSuppliedOnInvocationFromKo')
    expect(main).toContain('agentPermissionMode')
    expect(main).not.toContain(
      'permissionModeSuppliedOnInvocation: permissionModeCli !== undefined',
    )
  })
})
