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
  toolWindowStartTime?: number
  turnStartTime?: number
  totalPausedMs?: number
}

const EMPTY_MESSAGES: Message[] = []
const EMPTY_IN_PROGRESS = new Set<string>()
export const EMPTY_TASK_TRANSCRIPT: TaskTranscript = {
  messages: EMPTY_MESSAGES,
  inProgressToolUseIDs: EMPTY_IN_PROGRESS,
}

/**
 * Official 2.1.331 `$s` + `Dfr` (@324430533, @321743485):
 * - When a `queued_command` attachment arrives carrying `source_uuid` matching
 *   the already-displayed human/coordinator prompt message, re-stamp that entry
 *   in place with the attachment's UUID so the bubble is not duplicated.
 * - Otherwise append, moving an existing entry with the same UUID to the tail.
 */
export function appendTranscriptMessage(
  messages: readonly Message[],
  message: Message,
): Message[] {
  if (message.type === 'attachment') {
    const attachment = (
      message as { attachment?: { type?: string; source_uuid?: string } }
    ).attachment
    if (
      attachment?.type === 'queued_command' &&
      typeof attachment.source_uuid === 'string'
    ) {
      const idx = messages.findLastIndex(m => m.uuid === attachment.source_uuid)
      if (idx !== -1) {
        const next = messages.slice()
        next[idx] = { ...messages[idx]!, uuid: message.uuid }
        return next
      }
    }
  }
  const existingIdx = messages.findLastIndex(m => m.uuid === message.uuid)
  if (existingIdx === -1) {
    return [...messages, message]
  }
  return [...messages.filter(m => m.uuid !== message.uuid), message]
}

/**
 * Official 2.1.331 `mwe` + `RUn` (@324595586, @313440982):
 * Incrementally maintain `inProgressToolUseIDs` from streamed assistant
 * `tool_use` and user `tool_result` blocks; stamps `toolWindowStartTime` when
 * transitioning from empty to active. Returns `undefined` when unchanged.
 */
export function applyMessageToInProgressToolUseIDs(
  prev: Set<string>,
  message: Message,
):
  | { inProgressToolUseIDs: Set<string>; toolWindowStartTime?: number }
  | undefined {
  const content = (
    message as {
      message?: {
        content?: ReadonlyArray<{
          type?: string
          id?: string
          tool_use_id?: string
        }>
      }
    }
  ).message?.content
  if (!Array.isArray(content)) {
    return undefined
  }
  let next: Set<string> | undefined
  if (message.type === 'assistant') {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        !prev.has(block.id)
      ) {
        next ??= new Set(prev)
        next.add(block.id)
      }
    }
  } else if (message.type === 'user') {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string' &&
        (next ?? prev).has(block.tool_use_id)
      ) {
        next ??= new Set(prev)
        next.delete(block.tool_use_id)
      }
    }
  }
  if (!next) {
    return undefined
  }
  return prev.size === 0 && next.size > 0
    ? { inProgressToolUseIDs: next, toolWindowStartTime: Date.now() }
    : { inProgressToolUseIDs: next }
}

/**
 * Official 2.1.331 `$Xe` (@343108513) prefix-preserving UUID merge between
 * disk-loaded sidechain messages and live in-memory messages.
 * Disk provides the historical prefix; overlapping UUIDs keep the live object
 * reference; live-only messages are appended as the tail.
 */
export function mergeDiskAndLiveTranscriptMessages(
  disk: readonly Message[],
  live: readonly Message[],
): Message[] {
  if (disk.length === 0) return live.length === 0 ? [] : [...live]
  if (live.length === 0) return [...disk]
  const liveByUuid = new Map<string, Message>()
  for (const m of live) {
    liveByUuid.set(m.uuid, m)
  }
  const diskUuids = new Set<string>()
  const merged: Message[] = []
  for (const m of disk) {
    diskUuids.add(m.uuid)
    merged.push(liveByUuid.get(m.uuid) ?? m)
  }
  for (const m of live) {
    if (!diskUuids.has(m.uuid)) {
      merged.push(m)
    }
  }
  return merged
}

/**
 * Official 2.1.331 `yS.updateTranscript` message append helper:
 * Unconditionally updates `AppState.transcripts[taskId]` (matching official
 * `mwe` @324596523 — not gated on `task.retain`; evicted on terminal eviction,
 * `remove`, or `/clear`). Skips `api_error` system retries (matches official
 * `mwe` @324596400).
 */
export function updateTaskTranscriptMessage(
  taskId: string,
  message: Message,
  setAppState: SetAppState,
): void {
  if (
    message.type === 'system' &&
    (message as { subtype?: string }).subtype === 'api_error'
  ) {
    return
  }
  setAppState(prev => {
    const current = prev.transcripts?.[taskId] ?? EMPTY_TASK_TRANSCRIPT
    const nextMessages = appendTranscriptMessage(current.messages, message)
    const toolPatch = applyMessageToInProgressToolUseIDs(
      current.inProgressToolUseIDs,
      message,
    )
    return {
      ...prev,
      transcripts: {
        ...prev.transcripts,
        [taskId]: {
          ...current,
          messages: nextMessages,
          ...toolPatch,
        },
      },
    }
  })
}

/**
 * Seed initial prompt messages into `AppState.transcripts[taskId]` without
 * dropping any live messages already buffered for this task.
 */
export function seedTaskTranscriptMessages(
  taskId: string,
  initialMessages: readonly Message[],
  setAppState: SetAppState,
): void {
  if (initialMessages.length === 0) return
  setAppState(prev => {
    const current = prev.transcripts?.[taskId] ?? EMPTY_TASK_TRANSCRIPT
    const merged = mergeDiskAndLiveTranscriptMessages(
      initialMessages,
      current.messages,
    )
    return {
      ...prev,
      transcripts: {
        ...prev.transcripts,
        [taskId]: {
          ...current,
          messages: merged,
        },
      },
    }
  })
}

/**
 * Official 2.1.331 `pQo` / `Lli` (@324550551, @324590200):
 * Stamp the wall-clock `turnStartTime` (and optional `totalPausedMs`) on
 * `AppState.transcripts[taskId]` when a subagent or teammate turn starts so
 * the focused spinner (`sje`) displays that agent's own elapsed timer.
 */
export function setTaskTranscriptTurnStart(
  taskId: string,
  turnStartTime: number,
  setAppState: SetAppState,
): void {
  setAppState(prev => {
    const current = prev.transcripts?.[taskId] ?? EMPTY_TASK_TRANSCRIPT
    if (current.turnStartTime === turnStartTime) {
      return prev
    }
    return {
      ...prev,
      transcripts: {
        ...prev.transcripts,
        [taskId]: {
          ...current,
          turnStartTime,
        },
      },
    }
  })
}

/**
 * Clear active `inProgressToolUseIDs` on `AppState.transcripts[taskId]` when a
 * subagent run finishes, fails, parks, or is killed (leaving `messages` intact
 * for viewing until eviction).
 */
export function clearTaskTranscriptInProgressToolUseIDs(
  taskId: string,
  setAppState: SetAppState,
): void {
  setAppState(prev => {
    const current = prev.transcripts?.[taskId]
    if (!current || current.inProgressToolUseIDs.size === 0) {
      return prev
    }
    return {
      ...prev,
      transcripts: {
        ...prev.transcripts,
        [taskId]: {
          ...current,
          inProgressToolUseIDs: new Set<string>(),
        },
      },
    }
  })
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
