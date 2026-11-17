import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import {
  isVelvetPandaEnabled,
  abortOnNowPriorityCommand,
  backgroundForegroundBashToDeliverMessage,
  backgroundForegroundToolCalls,
  listForegroundToolCalls,
  holderBackgroundTasks,
  holderLocalAgentTasks,
  isQueuedNowPrompt,
  outstandingToolUseIds,
  outstandingToolUses,
  queuedNowAction,
  queuedNowHead,
  registerForegroundToolCall,
  resetQueuedNowCoordinatorForTests,
  sendQueuedNow,
  hostSendQueuedNow,
  queuedNowReadEvidence,
  readQueuedNowTurnEvidence,
  isQueuedNowHeldByDialog,
  queuedNowEngineDialog,
  unmovableDescendantShells,
  trySendQueuedNowKey,
  queuedNowTranscriptWithoutPending,
} from '../foregroundToolCalls.js'
import { setUserPromptWaitingFor } from '../sessionHost.js'
import { shellCallerFromContext } from '../../tasks/LocalShellTask/LocalShellTask.js'
import {
  enqueue,
  isFoldInFlight,
  promoteToNow,
  demoteFromNow,
  registerFoldInFlight,
  unregisterFoldInFlight,
  resetCommandQueue,
  getCommandQueue,
  suspendMidTurnFold,
  isMidTurnFoldSuspended,
} from '../messageQueueManager.js'

describe('densable 2.1.283 send-now backgroundNow', () => {
  afterEach(() => {
    resetQueuedNowCoordinatorForTests()
    resetCommandQueue()
    const { resetShutdownCommittedForTests } =
      require('../shutdownCommitted.js') as typeof import('../shutdownCommitted.js')
    resetShutdownCommittedForTests()
  })

  test('backgroundForegroundToolCalls detaches without throwing on a bad call', () => {
    const session = {}
    let moved = false
    const unregister = registerForegroundToolCall(session, {
      toolUseId: 'ok',
      backgroundNow: () => {
        moved = true
        return true
      },
    })
    registerForegroundToolCall(session, {
      toolUseId: 'bad',
      backgroundNow: () => {
        throw new Error('stay in foreground')
      },
    })
    expect(backgroundForegroundToolCalls(session)).toBe(1)
    expect(moved).toBe(true)
    expect(listForegroundToolCalls(session).length).toBe(2)
    unregister()
  })

  test('TTe keys foreground calls by session.root', () => {
    const root = {}
    const fork = { root }
    let n = 0
    registerForegroundToolCall(fork, {
      toolUseId: 'a',
      backgroundNow: () => {
        n++
        return true
      },
    })
    expect(listForegroundToolCalls({ root }).length).toBe(1)
    expect(backgroundForegroundToolCalls(root)).toBe(1)
    expect(n).toBe(1)
  })

  test('tNr helper stamps backgroundedToDeliverMessage', () => {
    const src = readFileSync(
      join(import.meta.dir, '../foregroundToolCalls.ts'),
      'utf8',
    )
    expect(src).toContain('backgroundForegroundBashToDeliverMessage')
    expect(src).toContain('sendQueuedNow')
    expect(src).toContain('hostSendQueuedNow')
    expect(src).toContain('isVelvetPandaEnabled')
    expect(src).toContain('queuedNowLowLatency')
    expect(src).toContain('class QueuedNowCoordinator')
    expect(src).toContain('class QueuedNowLowLatency')
    expect(src).toContain('#A()')
    expect(src).toContain('subscribeToCommandQueue')
    expect(src).toContain('queuedNowAction')
    expect(src).toContain('queuedNowHead')
    expect(src).toContain('outstandingToolUseIds')
    expect(src).toContain('holderBackgroundTasks')
    expect(src).toContain(':preamble-')
    expect(src).toContain('areBackgroundTasksDisabled')
    expect(src).toContain('isQueuedNowPrompt')
    expect(src).toContain('skipAttachments')
    expect(src).toContain('isHumanLikeOrigin')
    expect(src).toContain('getMainThreadAgentId')
    expect(src).toContain("head === 'behind_earlier'")
    expect(src).toContain('#e.size === 0')
    expect(src).toContain('#C')
    expect(src).toContain('#k(')
    expect(src).toContain('#w(')
    expect(src).toContain('promoteToNow')
    expect(src).toContain('isTurnRunning')
    expect(src).toContain('queuedNowHead(')
    expect(src).toContain('holderBackgroundTasks(')
    expect(src).toContain('mainId')
    expect(src).toContain('turn.guard.isRunning')
    expect(src).toContain('queuedNowTurnAgentId')
    expect(src).toContain('this.#t.messageQueue.isFoldInFlight')
    expect(src).toContain('TTe.peek')
    expect(src).toContain('leftoverIhrPeek')
    expect(src).toContain('transcripts?.[getMainThreadAgentId()]')
    expect(src).toContain("spinnerMode === 'tool-input'")
    expect(src).toContain("spinnerMode === 'requesting'")
    expect(src).toContain('isMainResponseStreaming')
    expect(src).toContain('opts?.lowLatency ?? queuedNowLowLatency')
    expect(src).toContain('unmovable_grace')
    expect(src).toContain('backgroundedToDeliverMessage: true')
    expect(src).toContain('trySendQueuedNowKey')
    expect(src).toContain('abortOnNowPriorityCommand')
    expect(src).toContain('queued_send_now')
    expect(src).toContain('queuedNowReadEvidence')
    expect(src).toContain('readQueuedNowTurnEvidence')
    expect(src).toContain('constructor(host: QueuedNowLowLatencyHost)')
    expect(src).toContain('constructor(deps: QueuedNowCAtBag)')
    expect(src).toContain('function xve(')
    expect(src).toContain('sendQueuedNow = (uuid: string | undefined)')
    expect(src).toContain('clock: this.#e.clock')
    expect(src).toContain("featureName: 'input_low_latency_submit'")
    expect(src).toContain('queuedNowTranscriptWithoutPending')
    expect(src).toContain('this.#n = this.#t.clock.setTimeout(this.#v, ms)')
    expect(src).not.toContain('timer.unref')
    expect(src).toContain('tengu_cancel')
    expect(src).toContain('QUEUED_NOW_DIALOG_SKIP_KINDS')
    expect(src).toContain('unmovableDescendantShells')
    expect(src).toContain('isSessionActivityReasonActive')
    expect(typeof backgroundForegroundBashToDeliverMessage).toBe('function')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).not.toContain('hostSendQueuedNow')
    expect(repl).toContain('trySendQueuedNowKey')
    expect(repl).toContain('queuedNowLowLatencyHost.sendQueuedNow(namedTaskId)')
    expect(repl).toContain('isVelvetPandaEnabled')
    expect(repl).toContain('spinnerStore: leftoverIhr')
  })

  test('Hs stand_by wait background interrupt cancel', () => {
    const base = {
      head: 'next',
      hasFoldTakenPrompt: false,
      isLocalTurnActive: true,
      isLocalTurnRunning: true,
      isHeldByDialog: false,
      holderCount: 0,
      unmovableHolderCount: 0,
      isExecuting: false,
      isAwaitingMovedResult: false,
      isCompacting: false,
      isUnmovableGraceOver: false,
      isBackgroundingDisabled: false,
      isMainRequestInFlight: true,
    }
    expect(queuedNowAction({ ...base, isLocalTurnActive: false }).action).toBe(
      'stand_by',
    )
    expect(queuedNowAction({ ...base, isHeldByDialog: true })).toEqual({
      action: 'wait',
      reason: 'held_by_dialog',
    })
    expect(queuedNowAction({ ...base, holderCount: 2 })).toEqual({
      action: 'background',
    })
    expect(
      queuedNowAction({
        ...base,
        holderCount: 1,
        unmovableHolderCount: 1,
        isExecuting: true,
      }),
    ).toEqual({ action: 'wait', reason: 'unmovable_grace' })
    expect(
      queuedNowAction({
        ...base,
        holderCount: 1,
        unmovableHolderCount: 1,
        isExecuting: true,
        isUnmovableGraceOver: true,
      }).action,
    ).toBe('interrupt')
    expect(
      queuedNowAction({
        ...base,
        holderCount: 1,
        unmovableHolderCount: 1,
        isExecuting: true,
        isUnmovableGraceOver: true,
        isBackgroundingDisabled: true,
      }).action,
    ).toBe('cancel')
  })

  test('Eo queuedNowHead behind_earlier and ended_by_hook', () => {
    const tracked = new Set(['b'])
    expect(
      queuedNowHead(
        [
          { uuid: 'a', priority: 'next', mode: 'prompt' },
          { uuid: 'b', priority: 'next', mode: 'prompt' },
        ],
        tracked,
      ),
    ).toEqual({ head: 'behind_earlier', uuid: 'b', priority: 'next' })
    expect(
      queuedNowHead(
        [
          {
            uuid: 'b',
            priority: 'later',
            mode: 'prompt',
            drainOnly: true,
            promptSubmitted: true,
          },
        ],
        tracked,
      ),
    ).toEqual({ head: 'ended_by_hook', uuid: 'b', priority: 'later' })
  })

  test('b0n outstandingToolUseIds drops answered tool_use', () => {
    expect(
      outstandingToolUseIds([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 't1' }],
          },
        },
        {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 't1' }],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 't2' }],
          },
        },
      ]),
    ).toEqual(new Set(['t2']))
  })

  test('Bs holderBackgroundTasks keeps outstanding running toolUseId', () => {
    expect(
      holderBackgroundTasks(
        [
          { status: 'running', toolUseId: 't2' },
          { status: 'running', toolUseId: 't1' },
          { status: 'running', isBackgrounded: true, toolUseId: 't2' },
        ],
        new Set(['t2']),
      ).map(t => t.toolUseId),
    ).toEqual(['t2'])
    expect(
      holderBackgroundTasks(
        [
          {
            status: 'running',
            type: 'local_bash',
            caller: 'inner',
            shellCommand: {},
            toolUseId: 'tu:preamble-1',
          },
        ],
        new Set(['tu']),
      ).map(t => t.toolUseId),
    ).toEqual(['tu:preamble-1'])
    expect(
      holderBackgroundTasks(
        [{ status: 'running', type: 'local_agent', toolUseId: 't2' }],
        new Set(['t2']),
      ),
    ).toEqual([])
    expect(
      holderBackgroundTasks(
        [
          {
            status: 'running',
            type: 'local_bash',
            shellCommand: {},
            caller: 'turn',
            toolUseId: 't2',
          },
        ],
        new Set(['t2']),
      ).map(t => t.caller),
    ).toEqual(['turn'])
    expect(
      holderBackgroundTasks(
        [
          {
            status: 'running',
            type: 'local_bash',
            toolUseId: 't2',
          },
        ],
        new Set(['t2']),
      ),
    ).toEqual([])
  })

  test('s$r holderLocalAgentTasks keeps outstanding running children', () => {
    expect(
      holderLocalAgentTasks(
        [
          {
            type: 'local_agent',
            status: 'running',
            toolUseId: 't2',
          },
          {
            type: 'local_agent',
            status: 'running',
            isBackgrounded: true,
            toolUseId: 't2',
            parentAgentId: 'sub',
          },
        ],
        new Set(['t2']),
      ).map(t => t.toolUseId),
    ).toEqual(['t2'])
    expect(
      holderLocalAgentTasks(
        [
          {
            type: 'local_agent',
            status: 'running',
            parentAgentId: 'sub',
            toolUseId: 't2',
          },
        ],
        new Set(['t2']),
      ),
    ).toEqual([])
  })

  test('b0n outstandingToolUses keeps tool names', () => {
    expect(
      outstandingToolUses([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 't2', name: 'Bash' }],
          },
        },
      ]).get('t2'),
    ).toBe('Bash')
  })

  test('uf isQueuedNowPrompt drops meta, skipAttachments, poll-event', () => {
    expect(isQueuedNowPrompt({ mode: 'prompt' })).toBe(true)
    expect(isQueuedNowPrompt({ mode: 'prompt', isMeta: true })).toBe(false)
    expect(isQueuedNowPrompt({ mode: 'prompt', skipAttachments: true })).toBe(
      false,
    )
    expect(isQueuedNowPrompt({ mode: 'poll-event' })).toBe(false)
    expect(isQueuedNowPrompt({ mode: 'task-notification' })).toBe(false)
  })

  test('kdt drops transcript rows whose uuid is in the pending queue', () => {
    const kept = { uuid: 'a' }
    const drop = { uuid: 'b' }
    const msgs = [kept, drop]
    expect(queuedNowTranscriptWithoutPending(msgs, [])).toBe(msgs)
    expect(queuedNowTranscriptWithoutPending(msgs, [{ uuid: 'b' }])).toEqual([
      kept,
    ])
  })

  test('cAt sendQueuedNow returns boolean and requires isRunning + uf prompt', () => {
    const uuid = randomUUID()
    enqueue({
      value: 'now please',
      mode: 'prompt',
      uuid,
      priority: 'next',
    })
    expect(
      sendQueuedNow(
        () => ({ tasks: {} }) as never,
        () => {},
        { isTurnRunning: () => false, isTurnActive: () => false },
      ),
    ).toBe(false)
    expect(
      sendQueuedNow(
        () => ({ tasks: {} }) as never,
        () => {},
        {
          isTurnRunning: () => true,
          isTurnActive: () => true,
          abortSignal: new AbortController(),
        },
      ),
    ).toBe(true)
  })

  test('hostSendQueuedNow: empty is $Ze path; uuid is Xj U_e', () => {
    const uuid = randomUUID()
    enqueue({
      value: 'now please',
      mode: 'prompt',
      uuid,
      priority: 'next',
    })
    expect(
      hostSendQueuedNow(
        'prompt',
        undefined,
        () => ({ tasks: {} }) as never,
        () => {},
        { isTurnRunning: () => false, isTurnActive: () => false },
      ),
    ).toBe(false)
    expect(
      hostSendQueuedNow(
        'prompt',
        undefined,
        () => ({ tasks: {} }) as never,
        () => {},
        {
          isTurnRunning: () => true,
          isTurnActive: () => true,
          abortSignal: new AbortController(),
        },
      ),
    ).toBe(true)
    expect(
      hostSendQueuedNow(
        'prompt',
        'queued',
        () => ({ tasks: {} }) as never,
        () => {},
        {
          isTurnRunning: () => true,
          isTurnActive: () => true,
          abortSignal: new AbortController(),
        },
      ),
    ).toBe(false)
    expect(
      hostSendQueuedNow(
        'bash',
        'queued',
        () => ({ tasks: {} }) as never,
        () => {},
        { isTurnRunning: () => true, isTurnActive: () => true },
      ),
    ).toBe(false)
  })

  test('isVelvetPandaEnabled is gold Cln tengu_velvet_panda', () => {
    expect(typeof isVelvetPandaEnabled()).toBe('boolean')
  })

  test('hostSendQueuedNow with opts.lowLatency uses that Xj instance', () => {
    const seen: Array<string | undefined> = []
    const host = {
      sendQueuedNow(uuid: string | undefined) {
        seen.push(uuid)
        return true
      },
    }
    expect(
      hostSendQueuedNow(
        'prompt',
        'agent-task',
        () => ({ tasks: {} }) as never,
        () => {},
        {
          isTurnRunning: () => true,
          isTurnActive: () => true,
          lowLatency: host,
        },
      ),
    ).toBe(true)
    expect(seen).toEqual(['agent-task'])
  })

  test('yt promoteToNow is per-uuid and refuses fold-in-flight', () => {
    const uuid = randomUUID()
    enqueue({
      value: 'a',
      mode: 'prompt',
      uuid,
      priority: 'next',
    })
    expect(promoteToNow(uuid)).toBe(true)
    expect(getCommandQueue()[0]?.priority).toBe('now')
    expect(promoteToNow(uuid)).toBe(false)
    expect(demoteFromNow(uuid, 'next')).toBe(true)
    expect(getCommandQueue()[0]?.priority).toBe('next')
    registerFoldInFlight([{ uuid }])
    expect(isFoldInFlight(uuid)).toBe(true)
    expect(promoteToNow(uuid)).toBe(false)
    unregisterFoldInFlight([{ uuid }])
    expect(promoteToNow(uuid)).toBe(true)
  })

  test('Ft suspendMidTurnFold latches until reset', () => {
    expect(isMidTurnFoldSuspended()).toBe(false)
    suspendMidTurnFold()
    expect(isMidTurnFoldSuspended()).toBe(true)
  })

  test('Ft ORs Mr shutdown committed', () => {
    const { markShutdownCommitted, resetShutdownCommittedForTests } =
      require('../shutdownCommitted.js') as typeof import('../shutdownCommitted.js')
    resetShutdownCommittedForTests()
    expect(isMidTurnFoldSuspended()).toBe(false)
    markShutdownCommitted()
    expect(isMidTurnFoldSuspended()).toBe(true)
    resetShutdownCommittedForTests()
    expect(isMidTurnFoldSuspended()).toBe(false)
  })

  test('Eo queuedNowHead not_ready when fold in flight', () => {
    expect(
      queuedNowHead(
        [{ uuid: 'b', priority: 'next', mode: 'prompt' }],
        new Set(['b']),
        undefined,
        { isFoldInFlight: id => id === 'b' },
      ),
    ).toEqual({ head: 'not_ready', uuid: 'b', priority: 'next' })
  })

  test('_abortOnNowPriorityCommand aborts when a now row exists', () => {
    const abort = new AbortController()
    abortOnNowPriorityCommand(abort)
    expect(abort.signal.aborted).toBe(false)
    const uuid = randomUUID()
    enqueue({
      value: 'a',
      mode: 'prompt',
      uuid,
      priority: 'next',
    })
    promoteToNow(uuid)
    abortOnNowPriorityCommand(abort)
    expect(abort.signal.aborted).toBe(true)
    expect(abort.signal.reason).toBe('interrupt')
  })

  test('$Ze trySendQueuedNowKey arms when the turn is active', () => {
    const uuid = randomUUID()
    enqueue({
      value: 'queued',
      mode: 'prompt',
      uuid,
      priority: 'next',
      agentId: getMainThreadAgentId(),
    })
    expect(
      trySendQueuedNowKey(
        () => ({ tasks: {} }) as never,
        () => {},
        {
          isTurnRunning: () => true,
          isTurnActive: () => true,
          abortSignal: new AbortController(),
          interruptForSubmit: () => false,
        },
      ),
    ).toBe(true)
  })

  test('KMt shellCallerFromContext inner/turn/agent', () => {
    expect(shellCallerFromContext({ innerCall: true })).toBe('inner')
    expect(
      shellCallerFromContext({ innerCall: true, agentId: 'sub' as never }),
    ).toBe('inner')
    expect(shellCallerFromContext({})).toBe('turn')
    expect(shellCallerFromContext({ agentId: 'sub' as never })).toBe('agent')
  })

  test('vdt queuedNowReadEvidence uses in-progress count', () => {
    expect(queuedNowReadEvidence({ inProgressToolUseCount: 2 })).toMatchObject({
      isToolCallStarting: true,
      isHeldByDialog: false,
    })
    expect(
      queuedNowReadEvidence({
        isHeldByDialog: true,
        isCompacting: true,
        isMainRequestAnnounced: false,
      }),
    ).toEqual({
      isHeldByDialog: true,
      isToolCallStarting: false,
      isCompacting: true,
      isMainRequestAnnounced: false,
    })
    const mainId = getMainThreadAgentId()
    expect(
      queuedNowReadEvidence({
        getAppState: () => ({
          transcripts: {
            [mainId]: { inProgressToolUseIDs: new Set(['t1']) },
          },
        }),
      }).isToolCallStarting,
    ).toBe(true)
    expect(
      queuedNowReadEvidence({
        getAppState: () => ({
          transcripts: {
            other: { inProgressToolUseIDs: new Set(['t1']) },
          },
        }),
      }).isToolCallStarting,
    ).toBe(false)
    expect(
      queuedNowReadEvidence({
        transcriptsInProgress: new Set(['t2']),
      }).isToolCallStarting,
    ).toBe(true)
    expect(
      queuedNowReadEvidence({ isMainResponseStreaming: true })
        .isMainRequestAnnounced,
    ).toBe(true)
  })

  test('vdt leftoverIhrPeek is gold N.get for mode and compacting', () => {
    const { leftoverIhrBind, leftoverIhrEvict, leftoverIhrMarkStoreMounted } =
      require('../collapseReadSearch.js') as typeof import('../collapseReadSearch.js')
    leftoverIhrMarkStoreMounted(true)
    leftoverIhrEvict(getMainThreadAgentId())
    try {
      leftoverIhrBind(getMainThreadAgentId()).setMode('tool-input')
      expect(queuedNowReadEvidence().isToolCallStarting).toBe(true)
      leftoverIhrBind(getMainThreadAgentId()).setMode('requesting')
      leftoverIhrBind(getMainThreadAgentId()).setCompacting(true)
      expect(queuedNowReadEvidence()).toMatchObject({
        isToolCallStarting: false,
        isCompacting: true,
        isMainRequestAnnounced: true,
      })
    } finally {
      leftoverIhrEvict(getMainThreadAgentId())
      leftoverIhrMarkStoreMounted(false)
    }
  })

  test('vdt readQueuedNowTurnEvidence matches gold host arity', () => {
    const {
      leftoverIhrBind,
      leftoverIhrPeek,
      leftoverIhrEvict,
      leftoverIhrMarkStoreMounted,
    } =
      require('../collapseReadSearch.js') as typeof import('../collapseReadSearch.js')
    leftoverIhrMarkStoreMounted(true)
    leftoverIhrEvict(getMainThreadAgentId())
    const session = {}
    setUserPromptWaitingFor(session, undefined)
    const mainId = getMainThreadAgentId()
    leftoverIhrBind(mainId).setMode('tool-input')
    leftoverIhrBind(mainId).setCompacting(false)
    try {
      expect(
        readQueuedNowTurnEvidence({
          turn: {
            guard: {
              isRunning: false,
              isActive: false,
              subscribe: () => () => {},
            },
            stream: { isMainResponseStreaming: false },
          },
          store: {
            getState: () => ({
              transcripts: {
                [mainId]: { inProgressToolUseIDs: new Set(['t1']) },
              },
            }),
          },
          session,
          spinnerStore: {
            get: leftoverIhrPeek,
          },
          dialogStore: { getState: () => ({ open: [] }) },
        }),
      ).toEqual({
        isHeldByDialog: false,
        isToolCallStarting: true,
        isCompacting: false,
        isMainRequestAnnounced: false,
      })
      leftoverIhrBind(mainId).setMode('requesting')
      leftoverIhrBind(mainId).setCompacting(true)
      setUserPromptWaitingFor(session, 'held')
      expect(
        readQueuedNowTurnEvidence({
          turn: {
            guard: {
              isRunning: true,
              isActive: true,
              subscribe: () => () => {},
            },
            stream: { isMainResponseStreaming: true },
          },
          store: { getState: () => ({ transcripts: {} }) },
          session,
          spinnerStore: {
            get: leftoverIhrPeek,
          },
          dialogStore: {
            getState: () => ({
              open: [{ userInvoked: false, kind: 'plugin_hint' }],
            }),
          },
        }),
      ).toEqual({
        isHeldByDialog: true,
        isToolCallStarting: false,
        isCompacting: true,
        isMainRequestAnnounced: true,
      })
    } finally {
      setUserPromptWaitingFor(session, undefined)
      leftoverIhrEvict(mainId)
      leftoverIhrMarkStoreMounted(false)
    }
  })

  test('hm aM skip kinds do not hold send-now', () => {
    expect(
      queuedNowEngineDialog([
        { userInvoked: false, kind: 'plugin_hint' },
        { userInvoked: false, kind: 'cost_threshold' },
      ]),
    ).toBe(null)
    expect(
      queuedNowEngineDialog([{ userInvoked: false, kind: 'permission_bash' }]),
    ).toEqual({ userInvoked: false, kind: 'permission_bash' })
    expect(
      isQueuedNowHeldByDialog([{ userInvoked: true, kind: 'slash' }]),
    ).toBe(true)
    expect(
      queuedNowReadEvidence({
        dialogOpen: [{ userInvoked: false, kind: 'permission_ask' }],
      }).isHeldByDialog,
    ).toBe(true)
    expect(
      queuedNowReadEvidence({
        dialogOpen: [{ userInvoked: false, kind: 'plugin_hint' }],
        waitingFor: 'dialog open',
      }).isHeldByDialog,
    ).toBe(true)
    expect(
      queuedNowReadEvidence({
        dialogOpen: [{ userInvoked: false, kind: 'plugin_hint' }],
      }).isHeldByDialog,
    ).toBe(false)
    const session = {}
    setUserPromptWaitingFor(session, 'held')
    expect(queuedNowReadEvidence({ session }).isHeldByDialog).toBe(true)
    setUserPromptWaitingFor(session, undefined)
    expect(queuedNowReadEvidence({ session }).isHeldByDialog).toBe(false)
  })

  test('Gs unmovableDescendantShells keeps descendant local_bash', () => {
    const holders = [
      {
        id: 'h',
        type: 'local_bash',
        status: 'running',
        caller: 'turn',
        shellCommand: {},
        toolUseId: 't1',
      },
    ]
    expect(
      unmovableDescendantShells(
        [
          ...holders,
          {
            type: 'local_agent',
            status: 'running',
            agentId: 'child',
            parentAgentId: undefined,
            toolUseId: 'ag',
          },
          {
            id: 'd',
            type: 'local_bash',
            status: 'running',
            agentId: 'child',
            caller: 'agent',
            shellCommand: {},
            toolUseId: 'sh',
          },
        ],
        new Set(['ag', 'sh']),
        holders,
      ).map(t => t.id),
    ).toEqual(['d'])
  })
})
