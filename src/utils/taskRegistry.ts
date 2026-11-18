/**
 * densable `Xm(e,n)` — ToolUseContext.taskRegistry.
 * Gold GetTask `Po` reads `.get`; permission `xSl` reads `.all()`.
 */
import type { AppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import type { TaskState } from '../tasks/types.js'
import {
  createWebSearchBudget,
  type WebSearchBudget,
} from './sessionSpawnCaps.js'
import { createSignal } from './signal.js'
import {
  applyTaskOffsetsAndEvictions,
  evictTerminalTask,
  registerTask,
  updateTaskState,
} from './task/framework.js'

type SetAppState = (updater: (prev: AppState) => AppState) => void

/** densable `Cft`. */
export type TaskTranscript = {
  messages: readonly Message[]
  inProgressToolUseIDs: Set<string>
}

const EMPTY_MESSAGES: Message[] = []
const EMPTY_IN_PROGRESS = new Set<string>()
export const EMPTY_TASK_TRANSCRIPT: TaskTranscript = {
  messages: EMPTY_MESSAGES,
  inProgressToolUseIDs: EMPTY_IN_PROGRESS,
}

/** densable `Qn().taskEvicted`. */
export const taskEvicted = createSignal<[string]>()

export type TaskRegistry = {
  get(id: string): TaskState | undefined
  all(): { [taskId: string]: TaskState }
  register(task: TaskState): void
  update<T extends TaskState>(id: string, updater: (task: T) => T): void
  mutateAppState?(updater: (prev: AppState) => AppState): void
  remove(id: string): void
  evictTerminal(id: string): void
  applyOffsetsAndEvict(offsets: Record<string, number>, evicted: string[]): void
  getTranscript(id: string): TaskTranscript | undefined
  updateTranscript(
    id: string,
    updater: (prev: TaskTranscript) => TaskTranscript,
  ): void
  incrementWebSearchCalls(): void
  getWebSearchCalls(): number
  resetWebSearchCalls(): void
  getWebSearchBudget(): WebSearchBudget
  resetWebSearchBudget(): void
  takeConcurrencySlot(): () => void
  getConcurrentSubagents(): number
}

/** densable `Xm(getAppState, setAppState)`. */
export function createTaskRegistry(
  getAppState: () => AppState,
  setAppState: SetAppState,
  options?: { refillWebSearchBudgetByDefault?: boolean },
): TaskRegistry {
  let webSearchCalls = 0
  let webSearchBudget: WebSearchBudget | undefined
  const refillWebSearchBudgetByDefault =
    options?.refillWebSearchBudgetByDefault ?? false
  return {
    get(id) {
      return getAppState().tasks?.[id]
    },
    all() {
      return getAppState().tasks ?? {}
    },
    register(task) {
      registerTask(task, setAppState)
    },
    update(id, updater) {
      updateTaskState(id, setAppState, updater)
    },
    mutateAppState(updater) {
      setAppState(updater)
    },
    remove(id) {
      taskEvicted.emit(id)
      setAppState(prev => {
        if (!Object.hasOwn(prev.tasks, id)) return prev
        const { [id]: _removed, ...tasks } = prev.tasks
        const transcripts = prev.transcripts ?? {}
        if (!(id in transcripts)) {
          return { ...prev, tasks }
        }
        const { [id]: _tr, ...rest } = transcripts
        return { ...prev, tasks, transcripts: rest }
      })
    },
    evictTerminal(id) {
      evictTerminalTask(id, setAppState)
    },
    applyOffsetsAndEvict(offsets, evicted) {
      applyTaskOffsetsAndEvictions(setAppState, offsets, evicted)
    },
    getTranscript(id) {
      return getAppState().transcripts?.[id]
    },
    updateTranscript(id, updater) {
      setAppState(prev => {
        const current = prev.transcripts?.[id] ?? EMPTY_TASK_TRANSCRIPT
        const next = updater(current)
        if (next === current) return prev
        return {
          ...prev,
          transcripts: { ...prev.transcripts, [id]: next },
        }
      })
    },
    incrementWebSearchCalls() {
      webSearchCalls++
    },
    getWebSearchCalls() {
      return webSearchCalls
    },
    resetWebSearchCalls() {
      webSearchCalls = 0
    },
    getWebSearchBudget() {
      webSearchBudget ??= createWebSearchBudget({
        refillsByDefault: refillWebSearchBudgetByDefault,
      })
      return webSearchBudget
    },
    resetWebSearchBudget() {
      webSearchBudget = undefined
      webSearchCalls = 0
    },
    takeConcurrencySlot() {
      setAppState(prev => ({
        ...prev,
        runningSubagents: (prev.runningSubagents ?? 0) + 1,
      }))
      let released = false
      return () => {
        if (released) return
        released = true
        setAppState(prev => {
          const n = Math.max(0, (prev.runningSubagents ?? 0) - 1)
          if (n === prev.runningSubagents) return prev
          return { ...prev, runningSubagents: n }
        })
      }
    },
    getConcurrentSubagents() {
      return getAppState().runningSubagents ?? 0
    },
  }
}
