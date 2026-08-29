/**
 * densable 2.1.239 ProposeGoalTool (ikw / vgi) — call / isEnabled 1:1.
 *
 * Process-global mock.module — snapshot + afterAll restore
 * (EndConversationTool / chromeInstallOpener.239 pattern).
 * Dynamic import AFTER mocks.
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/utils/errors.js'
import {
  GOAL_PROPOSAL_KIND,
  goalProposalSpec,
} from 'src/dialog/specs/jsuKinds.js'
import { TOOL_RESULT_ASK_USER, TOOL_RESULT_DIRECT } from '../prompt.js'
import { PROPOSE_GOAL_CONDITION_MAX_CHARS } from '../constants.js'

const events: Array<[string, Record<string, unknown>]> = []
const enqueueCalls: unknown[] = []
const logErrorMock = mock((err: unknown) => {
  void err
})

let gbProposeGoal = true
let nonInteractive = false
let remote = false
let setting: 'auto' | 'alwaysAsk' | 'disabled' | undefined = 'auto'
let restoreGate: { message: string; code: string } | null = null
let nextUuid = 'latch-1'
const savedSessionKind = process.env.CLAUDE_CODE_SESSION_KIND

const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: (name: string, props: Record<string, unknown> = {}) => {
    events.push([name, props])
  },
}))

const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) =>
    key === 'tengu_propose_goal' ? gbProposeGoal : fallback,
}))

const realBootstrap = await import('src/bootstrap/state.js')
const bootstrapSnap = snapshotModuleExports(realBootstrap)
mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getIsNonInteractiveSession: () => nonInteractive,
  getIsRemoteMode: () => remote,
  getMainThreadAgentId: () => 'main-thread',
}))

const realSettings = await import('src/utils/settings/settings.js')
const settingsSnap = snapshotModuleExports(realSettings)
mock.module('src/utils/settings/settings.js', () => ({
  ...settingsSnap,
  getSecuritySensitiveSetting: (key: string) =>
    key === 'modelProposedGoals' && setting !== undefined ? [setting] : [],
}))

const realRestore = await import(
  'src/services/goal/restoreGoalFromTranscript.js'
)
const restoreSnap = snapshotModuleExports(realRestore)
mock.module('src/services/goal/restoreGoalFromTranscript.js', () => ({
  ...restoreSnap,
  getGoalRestoreGate: () => restoreGate,
}))

const realQueue = await import('src/utils/messageQueueManager.js')
const queueSnap = snapshotModuleExports(realQueue)
mock.module('src/utils/messageQueueManager.js', () => ({
  ...queueSnap,
  enqueue: (command: unknown) => {
    enqueueCalls.push(command)
  },
}))

const realCrypto = await import('src/utils/crypto.js')
const cryptoSnap = snapshotModuleExports(realCrypto)
mock.module('src/utils/crypto.js', () => ({
  ...cryptoSnap,
  randomUUID: () => nextUuid,
}))

const realLog = await import('src/utils/log.js')
const logSnap = snapshotModuleExports(realLog)
mock.module('src/utils/log.js', () => ({
  ...logSnap,
  logError: logErrorMock,
}))

const realOtel = await import('src/utils/telemetry/events.js')
const otelSnap = snapshotModuleExports(realOtel)
mock.module('src/utils/telemetry/events.js', () => ({
  ...otelSnap,
  logOTelEvent: async () => {},
}))

afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/settings/settings.js', () => ({ ...settingsSnap }))
  mock.module('src/services/goal/restoreGoalFromTranscript.js', () => ({
    ...restoreSnap,
  }))
  mock.module('src/utils/messageQueueManager.js', () => ({ ...queueSnap }))
  mock.module('src/utils/crypto.js', () => ({ ...cryptoSnap }))
  mock.module('src/utils/log.js', () => ({ ...logSnap }))
  mock.module('src/utils/telemetry/events.js', () => ({ ...otelSnap }))
  if (savedSessionKind === undefined) {
    delete process.env.CLAUDE_CODE_SESSION_KIND
  } else {
    process.env.CLAUDE_CODE_SESSION_KIND = savedSessionKind
  }
})

const { ProposeGoalTool } = await import('../ProposeGoalTool.js')
const { resetGoalProposalAvailableLatchForTests } = await import(
  '../proposeGoalGate.js'
)

type AppSlice = {
  pendingGoalProposal?: string
  queuedGoalOrigin?: { condition: string; origin: string }
  toolPermissionContext: { mode: string }
}

function makeContext(opts: {
  agentId?: string
  planMode?: boolean
  pendingLatch?: string
  requestDialog?:
    | ((
        spec: { kind: string },
        payload: unknown,
        options?: unknown,
      ) => Promise<unknown>)
    | undefined
  omitRequestDialog?: boolean
}) {
  const box: { state: AppSlice } = {
    state: {
      pendingGoalProposal: opts.pendingLatch,
      toolPermissionContext: { mode: opts.planMode ? 'plan' : 'default' },
    },
  }
  const requestDialog =
    opts.omitRequestDialog === true
      ? undefined
      : (opts.requestDialog ?? mock(async () => ({ approved: false })))
  return {
    agentId: opts.agentId,
    getAppState: () => box.state,
    setAppState: (f: (prev: AppSlice) => AppSlice) => {
      box.state = f(box.state)
    },
    requestDialog,
    box,
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Bun.sleep(0)
}

function sadCodes(): string[] {
  return events
    .filter(([name]) => name === 'tengu_feature_sad')
    .map(([, props]) => String(props.error_code))
}

beforeEach(() => {
  events.length = 0
  enqueueCalls.length = 0
  logErrorMock.mockClear()
  gbProposeGoal = true
  nonInteractive = false
  remote = false
  setting = 'auto'
  restoreGate = null
  nextUuid = 'latch-1'
  delete process.env.CLAUDE_CODE_SESSION_KIND
  resetGoalProposalAvailableLatchForTests()
})

describe('ProposeGoalTool.isEnabled', () => {
  test('false when noninteractive / remote / bg / GB off / setting disabled', () => {
    nonInteractive = true
    expect(ProposeGoalTool.isEnabled()).toBe(false)

    nonInteractive = false
    remote = true
    expect(ProposeGoalTool.isEnabled()).toBe(false)

    remote = false
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(ProposeGoalTool.isEnabled()).toBe(false)

    delete process.env.CLAUDE_CODE_SESSION_KIND
    gbProposeGoal = false
    expect(ProposeGoalTool.isEnabled()).toBe(false)

    gbProposeGoal = true
    setting = 'disabled'
    expect(ProposeGoalTool.isEnabled()).toBe(false)
    expect(
      events.some(([name]) => name === 'tengu_goal_proposal_available'),
    ).toBe(false)
  })

  test('true + once-log tengu_goal_proposal_available when GB on + auto', () => {
    expect(ProposeGoalTool.isEnabled()).toBe(true)
    expect(ProposeGoalTool.isEnabled()).toBe(true)
    const available = events.filter(
      ([name]) => name === 'tengu_goal_proposal_available',
    )
    expect(available).toHaveLength(1)
    expect(available[0]?.[1]).toEqual({ setting: 'auto' })
  })
})

describe('ProposeGoalTool.call gates', () => {
  test('agent context throws', async () => {
    const ctx = makeContext({ agentId: 'subagent-1' })
    await expect(
      ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never),
    ).rejects.toThrow('ProposeGoal cannot be used in agent contexts')
    expect(enqueueCalls).toHaveLength(0)
  })

  test('session_shape sad + throw', async () => {
    nonInteractive = true
    const ctx = makeContext({})
    await expect(
      ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never),
    ).rejects.toThrow(
      'Goal proposals are only available in interactive local sessions.',
    )
    expect(sadCodes()).toContain('session_shape')
  })

  test('empty after canonicalize throws', async () => {
    const ctx = makeContext({})
    await expect(
      ProposeGoalTool.call({ condition: '\n\n​' }, ctx as never),
    ).rejects.toThrow(
      'The goal condition is empty once whitespace and invisible characters are removed. Provide a visible condition.',
    )
  })

  test('interior tab expansion over 500 is TelemetrySafeError', async () => {
    const ctx = makeContext({})
    // Leading tabs are trimmed after $ci; interior tabs survive. 250 + 6 + 250 = 506.
    const condition = `${'x'.repeat(250)}\t${'x'.repeat(250)}`
    await expect(
      ProposeGoalTool.call({ condition }, ctx as never),
    ).rejects.toBeInstanceOf(
      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    )
    await expect(
      ProposeGoalTool.call({ condition }, ctx as never),
    ).rejects.toThrow(/exceeds 500 characters once canonicalized/)
  })

  test('clear keyword throws', async () => {
    const ctx = makeContext({})
    await expect(
      ProposeGoalTool.call({ condition: 'CLEAR' }, ctx as never),
    ).rejects.toThrow(
      'ProposeGoal only proposes a new goal; it cannot clear one. The user can clear an active goal with /goal clear.',
    )
  })

  test('wro gate TelemetrySafeError + sad(code)', async () => {
    restoreGate = { message: 'hooks blocked', code: 'hooks_gate' }
    const ctx = makeContext({})
    await expect(
      ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never),
    ).rejects.toBeInstanceOf(
      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    )
    expect(sadCodes()).toContain('hooks_gate')
  })

  test('plan_mode sad + throw', async () => {
    const ctx = makeContext({ planMode: true })
    await expect(
      ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never),
    ).rejects.toThrow(
      'Plan mode is active, so a goal cannot be proposed yet. Keep planning; propose the goal after the plan is approved.',
    )
    expect(sadCodes()).toContain('plan_mode')
  })

  test('setting_disabled sad + throw', async () => {
    setting = 'disabled'
    const ctx = makeContext({})
    await expect(
      ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never),
    ).rejects.toThrow(
      'The user has disabled model-proposed goals in their settings. Do not propose goals; the user can set one themselves with /goal.',
    )
    expect(sadCodes()).toContain('setting_disabled')
  })

  test('requestDialog undefined throws even when ask_user false', async () => {
    const ctx = makeContext({ omitRequestDialog: true })
    await expect(
      ProposeGoalTool.call(
        { condition: 'bun test exits 0', ask_user: false },
        ctx as never,
      ),
    ).rejects.toThrow(
      'Goal proposals need an interactive session to render the approval prompt; none is available here.',
    )
  })

  test('pending latch throws', async () => {
    const ctx = makeContext({ pendingLatch: 'already-open' })
    await expect(
      ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never),
    ).rejects.toThrow(
      "A goal proposal is already awaiting the user's decision. Keep working; if it is approved you will receive a kickoff message.",
    )
  })
})

describe('ProposeGoalTool.call ask_user false', () => {
  test('ebl proposal_direct + enqueue /goal as task-notification', async () => {
    const ctx = makeContext({})
    const result = await ProposeGoalTool.call(
      { condition: 'bun test exits 0', ask_user: false },
      ctx as never,
    )
    expect(result.data).toEqual({
      condition: 'bun test exits 0',
      askUser: false,
    })
    expect(ctx.box.state.queuedGoalOrigin).toEqual({
      condition: 'bun test exits 0',
      origin: 'proposal_direct',
    })
    expect(enqueueCalls).toEqual([
      {
        agentId: 'main-thread',
        mode: 'prompt',
        value: '/goal bun test exits 0',
        origin: { kind: 'task-notification' },
      },
    ])
    const proposed = events.find(([name]) => name === 'tengu_goal_proposed')
    expect(proposed?.[1]).toEqual({
      promptLength: 'bun test exits 0'.length,
      askUser: false,
      forcedAsk: false,
    })
    // densable Ee("goal_propose") is tengu_feature_ok, not an OTel event.
    expect(events.find(([name]) => name === 'tengu_feature_ok')?.[1]).toEqual({
      feature_name: 'goal_propose',
    })
    expect(ctx.requestDialog).not.toHaveBeenCalled()
  })
})

describe('ProposeGoalTool.call dialog', () => {
  test('ask_user true fire-and-forget requestDialog Qg-only {condition} queueBehind', async () => {
    let resolveDialog: ((v: unknown) => void) | undefined
    const requestDialog = mock(
      () =>
        new Promise(resolve => {
          resolveDialog = resolve
        }),
    )
    const ctx = makeContext({ requestDialog })
    const result = await ProposeGoalTool.call(
      { condition: 'bun test exits 0' },
      ctx as never,
    )
    expect(result.data).toEqual({
      condition: 'bun test exits 0',
      askUser: true,
    })
    expect(ctx.box.state.pendingGoalProposal).toBe('latch-1')
    expect(requestDialog).toHaveBeenCalledTimes(1)
    const [spec, payload, options] = requestDialog.mock.calls[0] as unknown as [
      { kind: string },
      unknown,
      unknown,
    ]
    expect(spec.kind).toBe(GOAL_PROPOSAL_KIND)
    expect(payload).toEqual({ condition: 'bun test exits 0' })
    expect(options).toEqual({ queueBehind: true })
    expect(enqueueCalls).toHaveLength(0)

    resolveDialog?.({ approved: true })
    await flush()
    expect(ctx.box.state.queuedGoalOrigin).toEqual({
      condition: 'bun test exits 0',
      origin: 'proposal_approved',
    })
    expect(enqueueCalls).toEqual([
      {
        agentId: 'main-thread',
        mode: 'prompt',
        value: '/goal bun test exits 0',
        origin: { kind: 'auto-continuation' },
      },
    ])
    expect(ctx.box.state.pendingGoalProposal).toBeUndefined()
    const decided = events.find(
      ([name]) => name === 'tengu_goal_proposal_decided',
    )
    expect(decided?.[1]).toEqual({ decision: 'approved' })
  })

  test('alwaysAsk + ask_user false still dialogs (forcedAsk)', async () => {
    setting = 'alwaysAsk'
    const requestDialog = mock(async () => ({
      approved: false,
      explicit: true,
    }))
    const ctx = makeContext({ requestDialog })
    const result = await ProposeGoalTool.call(
      { condition: 'bun test exits 0', ask_user: false },
      ctx as never,
    )
    expect(result.data.askUser).toBe(true)
    const proposed = events.find(([name]) => name === 'tengu_goal_proposed')
    expect(proposed?.[1]).toEqual({
      promptLength: 'bun test exits 0'.length,
      askUser: true,
      forcedAsk: true,
    })
    await flush()
    expect(enqueueCalls).toHaveLength(0)
    const decided = events.find(
      ([name]) => name === 'tengu_goal_proposal_decided',
    )
    expect(decided?.[1]).toEqual({ decision: 'declined' })
  })

  test('unanswered when approved false without explicit', async () => {
    const requestDialog = mock(async () => ({ approved: false }))
    const ctx = makeContext({ requestDialog })
    await ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never)
    await flush()
    const decided = events.find(
      ([name]) => name === 'tengu_goal_proposal_decided',
    )
    expect(decided?.[1]).toEqual({ decision: 'unanswered' })
    expect(enqueueCalls).toHaveLength(0)
  })

  test('stale latch → approved_stale, no enqueue', async () => {
    let resolveDialog: ((v: unknown) => void) | undefined
    const requestDialog = mock(
      () =>
        new Promise(resolve => {
          resolveDialog = resolve
        }),
    )
    const ctx = makeContext({ requestDialog })
    await ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never)
    ctx.box.state.pendingGoalProposal = 'other-latch'
    resolveDialog?.({ approved: true })
    await flush()
    const decided = events.find(
      ([name]) => name === 'tengu_goal_proposal_decided',
    )
    expect(decided?.[1]).toEqual({ decision: 'approved_stale' })
    expect(enqueueCalls).toHaveLength(0)
    expect(ctx.box.state.pendingGoalProposal).toBe('other-latch')
  })

  test('approved + disabled → approved_disabled + sad dropped', async () => {
    let resolveDialog: ((v: unknown) => void) | undefined
    const requestDialog = mock(
      () =>
        new Promise(resolve => {
          resolveDialog = resolve
        }),
    )
    const ctx = makeContext({ requestDialog })
    await ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never)
    setting = 'disabled'
    resolveDialog?.({ approved: true })
    await flush()
    const decided = events.find(
      ([name]) => name === 'tengu_goal_proposal_decided',
    )
    expect(decided?.[1]).toEqual({ decision: 'approved_disabled' })
    expect(sadCodes()).toContain('approved_dropped_disabled')
    expect(enqueueCalls).toHaveLength(0)
  })

  test('approved + plan → approved_plan_mode + sad dropped', async () => {
    let resolveDialog: ((v: unknown) => void) | undefined
    const requestDialog = mock(
      () =>
        new Promise(resolve => {
          resolveDialog = resolve
        }),
    )
    const ctx = makeContext({ requestDialog })
    await ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never)
    ctx.box.state.toolPermissionContext.mode = 'plan'
    resolveDialog?.({ approved: true })
    await flush()
    const decided = events.find(
      ([name]) => name === 'tengu_goal_proposal_decided',
    )
    expect(decided?.[1]).toEqual({ decision: 'approved_plan_mode' })
    expect(sadCodes()).toContain('approved_dropped_plan_mode')
    expect(enqueueCalls).toHaveLength(0)
  })

  test('requestDialog reject logs and clears latch', async () => {
    const requestDialog = mock(async () => {
      throw new Error('dialog failed')
    })
    const ctx = makeContext({ requestDialog })
    await ProposeGoalTool.call({ condition: 'bun test exits 0' }, ctx as never)
    await flush()
    expect(logErrorMock).toHaveBeenCalled()
    expect(ctx.box.state.pendingGoalProposal).toBeUndefined()
    expect(enqueueCalls).toHaveLength(0)
  })
})

describe('ProposeGoalTool surface', () => {
  test('name / defer / readonly / concurrency / result size', () => {
    expect(ProposeGoalTool.name).toBe('ProposeGoal')
    expect(ProposeGoalTool.shouldDefer).toBe(true)
    expect(ProposeGoalTool.isReadOnly()).toBe(true)
    expect(ProposeGoalTool.isConcurrencySafe()).toBe(false)
    expect(ProposeGoalTool.maxResultSizeChars).toBe(1000)
  })

  test('mapToolResult + classifier + render', () => {
    expect(
      ProposeGoalTool.mapToolResultToToolResultBlockParam(
        { condition: 'x', askUser: false },
        'tu_1',
      ),
    ).toEqual({
      tool_use_id: 'tu_1',
      type: 'tool_result',
      content: TOOL_RESULT_DIRECT,
    })
    expect(
      ProposeGoalTool.mapToolResultToToolResultBlockParam(
        { condition: 'x', askUser: true },
        'tu_2',
      ).content,
    ).toBe(TOOL_RESULT_ASK_USER)
    expect(
      ProposeGoalTool.toAutoClassifierInput({
        condition: 'bun test exits 0',
        ask_user: false,
      }),
    ).toBe('ask_user=false: bun test exits 0')
    expect(
      ProposeGoalTool.renderToolUseMessage({
        condition: 'bun test exits 0',
      }),
    ).toBe('Propose goal: bun test exits 0')
    expect(PROPOSE_GOAL_CONDITION_MAX_CHARS).toBe(500)
  })

  test('getAllBaseTools registers ikw; Dot default is {approved:false}', () => {
    const toolsSrc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../../src/tools.ts',
      ),
      'utf8',
    )
    expect(toolsSrc).toContain('ProposeGoalTool')
    expect(goalProposalSpec.default).toEqual({ approved: false })
  })
})
