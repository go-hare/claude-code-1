/**
 * densable wHa — poll settings.subagentStatusLine while panel agents exist
 * and write AppState.taskDecorations.
 */
import { useEffect, useRef } from 'react'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from '../state/AppState.js'
import { useTerminalSize } from './useTerminalSize.js'
import {
  AGENT_PANEL_GUTTER_WIDTH,
  executeSubagentStatusLine,
  getSubagentStatusLineCommand,
  getVisiblePanelAgentTasks,
  SUBAGENT_STATUS_LINE_INITIAL_DELAY_MS,
  SUBAGENT_STATUS_LINE_POLL_MS,
  taskDecorationsEqual,
  updateTokenSamples,
} from '../utils/subagentStatusLine.js'
import { logForDebugging } from '../utils/debug.js'

/**
 * densable wHa effect. Mount near CoordinatorTaskPanel (footer).
 * Clears decorations when the setting is absent or no panel tasks remain.
 */
export function useSubagentStatusLine(): void {
  const store = useAppStateStore()
  const setAppState = useSetAppState()
  const { columns } = useTerminalSize()

  // Settings may lag policy-only resolution; gate on both presence and vHa.
  const configured = useAppState(
    s => s.settings?.subagentStatusLine?.command !== undefined,
  )
  // densable: when managed-only, still require policy command to exist.
  const enabled =
    configured &&
    (!shouldAllowManagedOnlyGate() ||
      getSubagentStatusLineCommand() !== undefined)

  const visibleCount = useAppState(s =>
    enabled ? getVisiblePanelAgentTasks(s.tasks).length : 0,
  )

  const inFlight = useRef(false)
  const samplesRef = useRef(new Map<string, number[]>())

  useEffect(() => {
    if (!enabled) {
      setAppState(prev =>
        Object.keys(prev.taskDecorations ?? {}).length === 0
          ? prev
          : { ...prev, taskDecorations: {} },
      )
      return
    }

    let cancelled = false

    const tick = (): void => {
      if (inFlight.current) return
      const state = store.getState()
      const visible = getVisiblePanelAgentTasks(state.tasks)
      updateTokenSamples(
        samplesRef.current,
        visible.map(y => ({
          id: y.id,
          tokenCount: y.progress?.tokenCount ?? 0,
        })),
      )
      if (visible.length === 0) {
        setAppState(prev =>
          Object.keys(prev.taskDecorations ?? {}).length === 0
            ? prev
            : { ...prev, taskDecorations: {} },
        )
        return
      }
      inFlight.current = true
      const nameById = new Map<string, string>()
      for (const [name, id] of state.agentNameRegistry) {
        nameById.set(id, name)
      }
      const cols = Math.max(0, columns - AGENT_PANEL_GUTTER_WIDTH)
      void executeSubagentStatusLine(
        visible,
        cols,
        nameById,
        samplesRef.current,
      )
        .then(result => {
          if (cancelled) return
          setAppState(prev => {
            const liveIds = new Set(visible.map(b => b.id))
            const next: { [id: string]: { content: string } } = {}
            for (const [id, dec] of Object.entries(result)) {
              if (liveIds.has(id)) next[id] = dec
            }
            return taskDecorationsEqual(prev.taskDecorations ?? {}, next)
              ? prev
              : { ...prev, taskDecorations: next }
          })
        })
        .catch(err => {
          logForDebugging(`subagentStatusLine tick failed: ${String(err)}`, {
            level: 'error',
          })
        })
        .finally(() => {
          inFlight.current = false
          // densable: if tasks drained mid-flight, clear immediately.
          if (
            !cancelled &&
            getVisiblePanelAgentTasks(store.getState().tasks).length === 0
          ) {
            tick()
          }
        })
    }

    if (visibleCount === 0) {
      tick()
      return
    }

    const initial = setTimeout(tick, SUBAGENT_STATUS_LINE_INITIAL_DELAY_MS)
    let poll = setTimeout(function loop() {
      try {
        tick()
      } finally {
        poll = setTimeout(loop, SUBAGENT_STATUS_LINE_POLL_MS)
      }
    }, SUBAGENT_STATUS_LINE_POLL_MS)

    return () => {
      cancelled = true
      clearTimeout(initial)
      clearTimeout(poll)
    }
  }, [enabled, visibleCount, columns, store, setAppState])
}

function shouldAllowManagedOnlyGate(): boolean {
  // Inline to avoid importing hooksConfigSnapshot into render path via cycles;
  // getSubagentStatusLineCommand already re-checks managed-only at exec time.
  try {
    const { shouldAllowManagedHooksOnly } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/hooks/hooksConfigSnapshot.js') as typeof import('../utils/hooks/hooksConfigSnapshot.js')
    return shouldAllowManagedHooksOnly()
  } catch {
    return false
  }
}
