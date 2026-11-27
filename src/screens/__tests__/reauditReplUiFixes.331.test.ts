import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { feature } from 'bun:bundle'
import { getInkHostAdapter } from '@anthropic/ink'
import {
  getCurrentTurnTokenBudget,
  snapshotOutputTokensForTurn,
} from '../../bootstrap/state.js'
import '../../entrypoints/init.js'
import {
  clearCompactCleanupCallbacksForTesting,
  registerCompactCleanup,
  runPostCompactCleanup,
} from '../../services/compact/postCompactCleanup.js'
import {
  type AppStateStore,
  getDefaultAppState,
} from '../../state/AppStateStore.js'
import { createStore } from '../../state/store.js'
import type { Message, UserMessage } from '../../types/message.js'
import { createAbortErrorReason } from '../../utils/abortController.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from '../../utils/config.js'
import { createUserMessage } from '../../utils/messages.js'
import { runWithNewHostSession } from '../../utils/sessionRoot.js'
import { TurnController } from '../repl/TurnController.js'
import { type RunReplTurnDeps, runReplTurn } from '../repl/runReplTurn.js'
import {
  syncTerminalOnlyBlockingDialogs,
  type TerminalBlockingDialogBridge,
} from '../repl/useReplTurnOrchestration.js'

const REPO_ROOT = join(import.meta.dir, '../../..')

function makeRunReplTurnDeps(
  overrides: Partial<RunReplTurnDeps> & {
    turn: TurnController
    store: AppStateStore
    messagesRef: { current: Message[] }
  },
): RunReplTurnDeps {
  const { turn, store, messagesRef, ...rest } = overrides
  return {
    store,
    queryGuard: turn.guard,
    initialMcpClients: [],
    titleDisabled: true,
    sessionTitle: 'test',
    haikuTitleAttemptedRef: { current: true },
    setHaikuTitle: () => {},
    commands: [],
    setConversationId: () => {},
    setAppState: () => {},
    messagesRef,
    resetLoadingState: () => {},
    setAbortController: () => {},
    pipeReturnHadErrorRef: { current: false },
    relayPipeMessage: () => {},
    resetTimingRefs: () => {},
    setMessages: (action: Parameters<RunReplTurnDeps['setMessages']>[0]) => {
      messagesRef.current =
        typeof action === 'function' ? action(messagesRef.current) : action
    },
    responseLengthRef: { current: 0 },
    apiMetricsRef: { current: [] },
    setStreamingToolUses: () => {},
    clearStreamingText: () => {},
    displayTransform: { newTurn: () => {} },
    mrOnBeforeQuery: async () => {},
    mrOnTurnComplete: async () => {},
    setLastQueryCompletionTime: () => {},
    sendBridgeResultRef: { current: () => {} },
    loadingStartTimeRef: { current: 0 },
    totalPausedMsRef: { current: 0 },
    swarmStartTimeRef: { current: null },
    swarmBudgetInfoRef: { current: undefined },
    backgroundWaitStartTimeRef: { current: null },
    proactiveActive: false,
    inputValueRef: { current: '' },
    restoreMessageSyncRef: { current: () => {} },
    ...rest,
  } as unknown as RunReplTurnDeps
}

describe('Re-Audit REPL & UI Lifecycle Fixes (2.1.331)', () => {
  const initialProjectConfigSnapshot = { ...getCurrentProjectConfig() }

  afterEach(() => {
    clearCompactCleanupCallbacksForTesting()
    snapshotOutputTokensForTurn(null)
    saveCurrentProjectConfig(current => {
      for (const k of Object.keys(current)) {
        if (!(k in initialProjectConfigSnapshot)) {
          delete (current as Record<string, unknown>)[k]
        }
      }
      return { ...initialProjectConfigSnapshot }
    })
  })

  // =========================================================================
  // P1-B1: entrypoints/init.ts eagerly registers Ink host adapter callbacks
  // =========================================================================
  describe('P1-B1: entrypoints/init.ts eager Ink host adapter registration', () => {
    test('importing entrypoints/init.ts eagerly registers getFeatureFlag, isScreenReaderModeEnabled, and isTmuxControlMode', () => {
      const adapter = getInkHostAdapter()
      expect(typeof adapter.sessionRoot?.getBootstrapSession).toBe('function')
      expect(typeof adapter.getFeatureFlag).toBe('function')
      expect(typeof adapter.isScreenReaderModeEnabled).toBe('function')
      expect(typeof adapter.isTmuxControlMode).toBe('function')
    })
  })

  // =========================================================================
  // P1-B3: runReplTurn finally performs all sync cleanup BEFORE queryGuard.end() & mrOnTurnComplete
  // =========================================================================
  describe('P1-B3: runReplTurn finally cleanup ordering and Turn N+1 isolation', () => {
    test('completes all sync cleanup (setAbortController(null), token budget, bridge, duration) before queryGuard.end and before awaiting mrOnTurnComplete so Turn N+1 is never clobbered', async () => {
      const store = createStore(getDefaultAppState())
      const turn = new TurnController({ store })
      const messagesRef = { current: [] as Message[] }

      const ac1 = new AbortController()
      const ac2 = new AbortController()
      let liveAc: AbortController | null = ac1
      let resetLoadingCalls = 0
      let bridgeResultCalls = 0
      const order: string[] = []

      const mrEntered = Promise.withResolvers<void>()
      const mrRelease = Promise.withResolvers<void>()

      let observedAtMrStart:
        | {
            guardActive: boolean
            liveAc: AbortController | null
            resetLoadingCalls: number
            bridgeResultCalls: number
            tokenBudget: number | null
            hasTurnDuration: boolean
          }
        | undefined

      const deps1 = makeRunReplTurnDeps({
        turn,
        store,
        messagesRef,
        resetLoadingState: () => {
          resetLoadingCalls++
          order.push('resetLoadingState')
        },
        sendBridgeResultRef: {
          current: () => {
            bridgeResultCalls++
            order.push('sendBridgeResult')
          },
        },
        setAbortController: ac => {
          liveAc = ac
          order.push(`setAbortController:${ac === null ? 'null' : 'ac'}`)
        },
        mrOnTurnComplete: async () => {
          order.push('mrOnTurnComplete:start')
          observedAtMrStart = {
            guardActive: turn.guard.isActive,
            liveAc,
            resetLoadingCalls,
            bridgeResultCalls,
            tokenBudget: getCurrentTurnTokenBudget(),
            hasTurnDuration: messagesRef.current.some(
              m =>
                m.type === 'system' &&
                'subtype' in m &&
                m.subtype === 'turn_duration',
            ),
          }
          mrEntered.resolve()
          await mrRelease.promise
          order.push('mrOnTurnComplete:end')
        },
      })

      try {
        snapshotOutputTokensForTurn(12_345)
        const turn1Promise = runReplTurn(
          {
            newMessages: [createUserMessage({ content: 'turn 1' })],
            abortController: ac1,
            shouldQuery: false,
            additionalAllowedTools: [],
            mainLoopModelParam: 'claude-sonnet-4-6',
          },
          deps1,
        )

        await mrEntered.promise
        // By the time mrOnTurnComplete runs, queryGuard is released AND all sync cleanup already ran!
        expect(observedAtMrStart?.guardActive).toBe(false)
        expect(observedAtMrStart?.liveAc).toBeNull()
        expect(observedAtMrStart?.resetLoadingCalls).toBeGreaterThanOrEqual(1)
        expect(observedAtMrStart?.bridgeResultCalls).toBe(1)
        expect(observedAtMrStart?.hasTurnDuration).toBe(true)
        if (feature('TOKEN_BUDGET')) {
          expect(observedAtMrStart?.tokenBudget).toBeNull()
        }

        // While Turn 1's mrOnTurnComplete is awaiting, Turn 2 starts and sets ac2 + budget 99_999
        liveAc = ac2
        snapshotOutputTokensForTurn(99_999)
        const turn2Started = Promise.withResolvers<void>()
        const turn2Release = Promise.withResolvers<void>()
        const deps2 = makeRunReplTurnDeps({
          turn,
          store,
          messagesRef,
          setAbortController: ac => {
            liveAc = ac
          },
          mrOnBeforeQuery: async () => {
            turn2Started.resolve()
            await turn2Release.promise
          },
        })
        const turn2Promise = runReplTurn(
          {
            newMessages: [createUserMessage({ content: 'turn 2' })],
            abortController: ac2,
            shouldQuery: false,
            additionalAllowedTools: [],
            mainLoopModelParam: 'claude-sonnet-4-6',
            input: 'turn 2',
          },
          deps2,
        )
        await turn2Started.promise

        const turn2MsgCountBeforeTurn1MrFinish = messagesRef.current.length

        // Finish Turn 1's slow mrOnTurnComplete while Turn 2 is in flight
        mrRelease.resolve()
        await turn1Promise

        // Turn 2's AbortController, token budget, messages, and active queryGuard MUST remain untouched!
        expect(liveAc).toBe(ac2)
        expect(getCurrentTurnTokenBudget()).toBe(99_999)
        expect(messagesRef.current.length).toBe(
          turn2MsgCountBeforeTurn1MrFinish,
        )
        expect(turn.guard.isActive).toBe(true)

        // Cleanly finish Turn 2
        turn2Release.resolve()
        await turn2Promise
        expect(liveAc).toBeNull()
        expect(turn.guard.isActive).toBe(false)
        expect(order.indexOf('setAbortController:null')).toBeLessThan(
          order.indexOf('mrOnTurnComplete:start'),
        )
      } finally {
        turn.dispose()
      }
    })

    test('catches and logs errors thrown by mrOnTurnComplete without failing or wedging queryGuard', async () => {
      const store = createStore(getDefaultAppState())
      const turn = new TurnController({ store })
      const messagesRef = { current: [] as Message[] }
      let liveAc: AbortController | null = new AbortController()

      const deps = makeRunReplTurnDeps({
        turn,
        store,
        messagesRef,
        setAbortController: ac => {
          liveAc = ac
        },
        mrOnTurnComplete: async () => {
          throw new Error('simulated mrOnTurnComplete crash')
        },
      })

      try {
        const result = await runReplTurn(
          {
            newMessages: [createUserMessage({ content: 'boom' })],
            abortController: liveAc,
            shouldQuery: false,
            additionalAllowedTools: [],
            mainLoopModelParam: 'claude-sonnet-4-6',
          },
          deps,
        )
        expect(result).toBe(true)
        expect(liveAc).toBeNull()
        expect(turn.guard.isActive).toBe(false)
      } finally {
        turn.dispose()
      }
    })

    test('user-cancel prompt restore after await mrOnTurnComplete is skipped if a newer generation ran during the await', async () => {
      const store = createStore(getDefaultAppState())
      const turn = new TurnController({ store })
      const messagesRef = { current: [] as Message[] }
      const restored: UserMessage[] = []

      const mrEntered = Promise.withResolvers<void>()
      const mrRelease = Promise.withResolvers<void>()
      const ac1 = new AbortController()
      ac1.abort(createAbortErrorReason('user-cancel'))

      const deps1 = makeRunReplTurnDeps({
        turn,
        store,
        messagesRef,
        restoreMessageSyncRef: {
          current: m => restored.push(m),
        },
        mrOnTurnComplete: async () => {
          mrEntered.resolve()
          await mrRelease.promise
        },
      })

      try {
        const turn1 = runReplTurn(
          {
            newMessages: [createUserMessage({ content: 'cancelled turn 1' })],
            abortController: ac1,
            shouldQuery: false,
            additionalAllowedTools: [],
            mainLoopModelParam: 'claude-sonnet-4-6',
          },
          deps1,
        )

        await mrEntered.promise

        // Turn 2 starts and completes while Turn 1's mrOnTurnComplete is awaiting,
        // leaving queryGuard.isActive === false again, but with a newer generation!
        const gen2 = turn.guard.tryStart()
        expect(gen2).not.toBeNull()
        expect(turn.guard.end(gen2!)).toBe(true)
        expect(turn.guard.isActive).toBe(false)

        mrRelease.resolve()
        await turn1

        // Turn 1 must NOT restore because queryGuard.generation !== thisGeneration
        expect(restored).toHaveLength(0)
      } finally {
        turn.dispose()
      }
    })
  })

  // =========================================================================
  // P1-B4: registerCompactCleanup uses Set + returns unsubscribe; REPL uses useEffect
  // =========================================================================
  describe('P1-B4: registerCompactCleanup Set & unsubscribe + REPL useEffect wiring', () => {
    test('deduplicates identical callbacks in a Set and returns an idempotent session-scoped unsubscribe', () => {
      runWithNewHostSession({ id: 'reaudit-compact-cleanup' }, () => {
        let countA = 0
        let countB = 0
        const cbA = () => {
          countA++
        }
        const cbB = () => {
          countB++
        }

        const unsubA1 = registerCompactCleanup(cbA)
        const unsubA2 = registerCompactCleanup(cbA) // duplicate same ref -> Set deduplicates
        const unsubB = registerCompactCleanup(cbB)

        runPostCompactCleanup('repl_main_thread')
        expect(countA).toBe(1)
        expect(countB).toBe(1)

        // Unsubscribing cbA stops future calls to cbA without affecting cbB
        unsubA1()
        unsubA2() // idempotent
        runPostCompactCleanup('repl_main_thread')
        expect(countA).toBe(1)
        expect(countB).toBe(2)

        unsubB()
        runPostCompactCleanup('repl_main_thread')
        expect(countA).toBe(1)
        expect(countB).toBe(2)
      })
    })

    test('REPL.tsx registers compact cleanup inside useEffect with contentReplacementStateRef dep (not render body)', () => {
      const replSrc = readFileSync(
        join(REPO_ROOT, 'src/screens/REPL.tsx'),
        'utf8',
      )
      expect(replSrc).toMatch(
        /useEffect\(\s*\(\) =>\s*registerCompactCleanup\(\(\) => \{\s*contentReplacementStateRef\.current = createContentReplacementState\(\);\s*\}\),\s*\[contentReplacementStateRef\],\s*\);/,
      )
    })
  })

  // =========================================================================
  // P2-4: PromptInput only queues pendingExternalChangeRef for genuine external input changes
  // =========================================================================
  describe('P2-4: PromptInput avoids spurious prompt.change landing fires on typed keystrokes', () => {
    test('captures isExternalInputChange before updating lastInternalInputRef and gates pendingExternalChangeRef on it', () => {
      const promptSrc = readFileSync(
        join(REPO_ROOT, 'src/components/PromptInput/PromptInput.tsx'),
        'utf8',
      )
      expect(promptSrc).toContain(
        'const isExternalInputChange = input !== lastInternalInputRef.current;',
      )
      expect(promptSrc).toMatch(
        /if \(input !== prevPropInputRef\.current\) \{\s*if \(isExternalInputChange\) \{\s*pendingExternalChangeRef\.current = \{ before: prevPropInputRef\.current, after: input \};/,
      )

      // Behavioral verification of the ref transition invariant:
      let lastInternalInput = ''
      let prevPropInput = ''
      let liveInput = ''
      const landingEvents: Array<{ before: string; after: string }> = []

      const simulateRender = (input: string) => {
        const isExternalInputChange = input !== lastInternalInput
        if (isExternalInputChange) {
          lastInternalInput = input
        }
        let pendingExternal: { before: string; after: string } | null = null
        if (input !== prevPropInput) {
          if (isExternalInputChange) {
            pendingExternal = { before: prevPropInput, after: input }
          }
          prevPropInput = input
          liveInput = input
        }
        if (pendingExternal !== null) {
          landingEvents.push(pendingExternal)
        }
      }

      const simulateTrackAndSetInput = (value: string) => {
        lastInternalInput = value
        liveInput = value
        simulateRender(value)
      }

      // Internal typed keystrokes must NOT queue landing external-change events
      simulateTrackAndSetInput('h')
      simulateTrackAndSetInput('he')
      simulateTrackAndSetInput('hel')
      expect(landingEvents).toEqual([])
      expect(liveInput).toBe('hel')

      // Genuine external prop update (e.g. STT / history injection) MUST queue exactly one landing event
      simulateRender('injected externally')
      expect(landingEvents).toEqual([
        { before: 'hel', after: 'injected externally' },
      ])
      expect(liveInput).toBe('injected externally')

      // Subsequent internal keystroke after external update still does NOT fire spurious landing event
      simulateTrackAndSetInput('injected externally!')
      expect(landingEvents).toHaveLength(1)
    })
  })

  // =========================================================================
  // P2-6: Remote Control bridge late connect & reconnect syncs already-open blocking dialogs
  // =========================================================================
  describe('P2-6: syncTerminalOnlyBlockingDialogs syncs open dialogs on late bridge connect & reconnect', () => {
    function makeBridge(name: string) {
      const calls: Array<{ kind: string; active: boolean }> = []
      const bridge: TerminalBlockingDialogBridge & {
        name: string
        calls: Array<{ kind: string; active: boolean }>
      } = {
        name,
        calls,
        setTerminalOnlyBlockingDialog(kind: string, active: boolean) {
          calls.push({ kind, active })
        },
      }
      return bridge
    }

    test('late connect after dialog opened notifies bridge; reconnect to new bridge or after disconnect re-notifies open dialogs', () => {
      const activeKindsRef = { current: new Set<string>() }
      const lastSyncedBridgeRef: {
        current: TerminalBlockingDialogBridge | null
      } = { current: null }

      // 1. Dialog opens BEFORE bridge connects (bridge === null)
      syncTerminalOnlyBlockingDialogs(
        null,
        new Set(['exit_flow', 'mcp_elicitation']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(activeKindsRef.current.size).toBe(0)
      expect(lastSyncedBridgeRef.current).toBeNull()

      // 2. Bridge A connects while dialogs are already open -> MUST send true for both!
      const bridgeA = makeBridge('A')
      syncTerminalOnlyBlockingDialogs(
        bridgeA,
        new Set(['exit_flow', 'mcp_elicitation']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(bridgeA.calls).toEqual([
        { kind: 'exit_flow', active: true },
        { kind: 'mcp_elicitation', active: true },
      ])
      expect(lastSyncedBridgeRef.current).toBe(bridgeA)

      // 3. Unchanged re-sync on same bridgeA -> no duplicate notifications
      syncTerminalOnlyBlockingDialogs(
        bridgeA,
        new Set(['exit_flow', 'mcp_elicitation']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(bridgeA.calls).toHaveLength(2)

      // 4. One dialog closes on bridgeA -> sends false for closed kind only
      syncTerminalOnlyBlockingDialogs(
        bridgeA,
        new Set(['exit_flow']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(bridgeA.calls).toEqual([
        { kind: 'exit_flow', active: true },
        { kind: 'mcp_elicitation', active: true },
        { kind: 'mcp_elicitation', active: false },
      ])

      // 5. Bridge reconnects directly to a new handle bridgeB while exit_flow is still open
      const bridgeB = makeBridge('B')
      syncTerminalOnlyBlockingDialogs(
        bridgeB,
        new Set(['exit_flow']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(bridgeB.calls).toEqual([{ kind: 'exit_flow', active: true }])
      expect(lastSyncedBridgeRef.current).toBe(bridgeB)

      // 6. Bridge disconnects (null) and later reconnects with the SAME bridgeB handle
      syncTerminalOnlyBlockingDialogs(
        null,
        new Set(['exit_flow']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(activeKindsRef.current.size).toBe(0)
      expect(lastSyncedBridgeRef.current).toBeNull()

      syncTerminalOnlyBlockingDialogs(
        bridgeB,
        new Set(['exit_flow']),
        activeKindsRef,
        lastSyncedBridgeRef,
      )
      expect(bridgeB.calls).toEqual([
        { kind: 'exit_flow', active: true },
        { kind: 'exit_flow', active: true },
      ])
    })
  })
})
