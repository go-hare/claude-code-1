import type { SetStateAction } from 'react'
import {
  apiFetchSessionHistory,
  apiBind,
  apiSendEvent,
  apiSendControl,
  apiInterrupt,
  getUuid,
} from '../api/client'
import { generateMessageUuid, isConversationClearedStatus } from './utils'
import type {
  AutomationState,
  EventPayload,
  SessionEvent,
  SessionTaskItem,
} from '../types'
import type {
  ThreadEntry,
  ToolCallData,
  ToolCallStatus,
  UserMessageEntry,
  AssistantMessageEntry,
  ToolCallEntry,
  UserMessageImage,
  PendingPermission,
} from './types'

// =============================================================================
// RCS Chat Adapter — Per-instance SSE + History -> ThreadEntry
// =============================================================================

export interface RCSChatAdapterOptions {
  onStatusChange?: (status: string) => void
  onError?: (error: string) => void
  onPermissionRequest?: (permission: PendingPermission) => void
  onPermissionResolved?: (requestId: string) => void
  onTasksChange?: (tasks: SessionTaskItem[]) => void
  onAutomationStateChange?: (state: AutomationState) => void
  onConversationCleared?: () => void
  onTurnComplete?: () => void
  onInterrupt?: () => void
}

interface ParsedToolResultBlock {
  toolCallId: string
  output: string
  isError: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function extractMessageContentBlocks(
  payload: EventPayload,
): Array<Record<string, unknown>> {
  const sources: unknown[] = [payload.message, payload.raw?.message]
  for (const src of sources) {
    const msg = asRecord(src)
    if (msg && Array.isArray(msg.content)) {
      return msg.content
        .map(block => asRecord(block))
        .filter((block): block is Record<string, unknown> => block !== null)
    }
  }
  return []
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content
      .map(item => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .filter(item => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text as string)
    if (texts.length > 0) return texts.join('\n')
    try {
      return JSON.stringify(content)
    } catch {
      return ''
    }
  }
  if (content === undefined || content === null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function extractToolResultBlocks(
  payload: EventPayload,
): ParsedToolResultBlock[] {
  const blocks = extractMessageContentBlocks(payload)
  const results: ParsedToolResultBlock[] = []
  for (const block of blocks) {
    if (block.type !== 'tool_result') continue
    const toolCallId =
      (typeof block.tool_use_id === 'string' && block.tool_use_id) ||
      (typeof block.tool_call_id === 'string' && block.tool_call_id) ||
      ''
    results.push({
      toolCallId,
      output: stringifyToolResultContent(block.content),
      isError: block.is_error === true,
    })
  }
  return results
}

function extractToolUseBlocks(
  payload: EventPayload,
): Array<Record<string, unknown>> {
  return extractMessageContentBlocks(payload).filter(
    block => block.type === 'tool_use',
  )
}

function extractEventText(payload: EventPayload): string {
  if (typeof payload.content === 'string' && payload.content) {
    return payload.content
  }
  const sources: unknown[] = [payload.message, payload.raw?.message]
  for (const src of sources) {
    if (typeof src === 'string' && src) return src
    const msg = asRecord(src)
    if (!msg) continue
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .map(block => asRecord(block))
        .filter((block): block is Record<string, unknown> => block !== null)
        .filter(
          block => block.type === 'text' && typeof block.text === 'string',
        )
        .map(block => block.text as string)
        .join('')
      if (text) return text
    }
  }
  return ''
}

function extractMessageUuid(payload: EventPayload): string | null {
  if (typeof payload.uuid === 'string' && payload.uuid) return payload.uuid
  if (typeof payload.raw?.uuid === 'string' && payload.raw.uuid) {
    return payload.raw.uuid
  }
  return null
}

function isSyntheticUserEvent(payload: EventPayload): boolean {
  return payload.isSynthetic === true || payload.raw?.isSynthetic === true
}

function extractTasksFromPayload(
  payload: EventPayload,
): SessionTaskItem[] | null {
  const rawTasks = Array.isArray(payload.tasks)
    ? payload.tasks
    : Array.isArray(payload.raw?.tasks)
      ? payload.raw.tasks
      : null
  if (!rawTasks) return null
  const items: SessionTaskItem[] = []
  for (let i = 0; i < rawTasks.length; i++) {
    const rec = asRecord(rawTasks[i])
    if (!rec) continue
    const id = typeof rec.id === 'string' && rec.id ? rec.id : `task-${i + 1}`
    const subject =
      (typeof rec.subject === 'string' && rec.subject) ||
      (typeof rec.title === 'string' && rec.title) ||
      id
    const status =
      typeof rec.status === 'string' && rec.status ? rec.status : 'pending'
    items.push({
      id,
      subject,
      status,
      ...(typeof rec.description === 'string'
        ? { description: rec.description }
        : {}),
      ...(typeof rec.owner === 'string' ? { owner: rec.owner } : {}),
    })
  }
  return items
}

function extractAutomationState(payload: EventPayload): AutomationState | null {
  const p = asRecord(payload)
  if (!p) return null
  if (typeof p.enabled !== 'boolean') {
    const raw = asRecord(payload.raw)
    if (!raw || typeof raw.enabled !== 'boolean') return null
    return {
      enabled: raw.enabled,
      phase:
        raw.phase === 'standby' || raw.phase === 'sleeping' ? raw.phase : null,
      next_tick_at:
        typeof raw.next_tick_at === 'number' ? raw.next_tick_at : null,
      sleep_until: typeof raw.sleep_until === 'number' ? raw.sleep_until : null,
    }
  }
  return {
    enabled: p.enabled,
    phase: p.phase === 'standby' || p.phase === 'sleeping' ? p.phase : null,
    next_tick_at: typeof p.next_tick_at === 'number' ? p.next_tick_at : null,
    sleep_until: typeof p.sleep_until === 'number' ? p.sleep_until : null,
  }
}

function findToolCallIndex(entries: ThreadEntry[], toolCallId: string): number {
  if (!toolCallId) return -1
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (
      entry &&
      entry.type === 'tool_call' &&
      entry.toolCall.id === toolCallId
    ) {
      return i
    }
  }
  return -1
}

function findMatchingToolCallForPermission(
  entries: ThreadEntry[],
  toolUseId: string,
  toolName: string,
): number {
  if (toolUseId) {
    const exact = findToolCallIndex(entries, toolUseId)
    if (exact >= 0) return exact
  }
  if (toolName) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (
        entry?.type === 'tool_call' &&
        entry.toolCall.status === 'running' &&
        entry.toolCall.title === toolName
      ) {
        return i
      }
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry?.type === 'tool_call' && entry.toolCall.status === 'running') {
      return i
    }
  }
  return -1
}

function applyToolResultToEntries(
  entries: ThreadEntry[],
  toolCallId: string,
  output: unknown,
  isError: boolean,
): ThreadEntry[] {
  let idx = findToolCallIndex(entries, toolCallId)
  if (idx < 0 && !toolCallId) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (
        entry?.type === 'tool_call' &&
        (entry.toolCall.status === 'running' ||
          entry.toolCall.status === 'waiting_for_confirmation')
      ) {
        idx = i
        break
      }
    }
  }
  if (idx < 0) return entries
  const entry = entries[idx] as ToolCallEntry
  const nextStatus: ToolCallStatus = isError ? 'error' : 'complete'
  return entries.map((e, i) =>
    i === idx
      ? {
          type: 'tool_call',
          toolCall: {
            ...entry.toolCall,
            status: nextStatus,
            rawOutput: { output: output ?? '' },
            permissionRequest: undefined,
          },
        }
      : e,
  )
}

function extractPermissionResponseInfo(payload: EventPayload): {
  requestId: string
  approved: boolean
} {
  const responseObj = asRecord(payload.response)
  const requestId =
    (typeof payload.request_id === 'string' && payload.request_id) ||
    (typeof responseObj?.request_id === 'string' && responseObj.request_id) ||
    ''
  const approved =
    payload.approved === true ||
    responseObj?.subtype === 'success' ||
    asRecord(responseObj?.response)?.behavior === 'allow'
  return { requestId, approved }
}

function finalizeRunningTools(entries: ThreadEntry[]): ThreadEntry[] {
  let changed = false
  const next = entries.map(entry => {
    if (entry.type !== 'tool_call' || entry.toolCall.status !== 'running') {
      return entry
    }
    changed = true
    return {
      type: 'tool_call' as const,
      toolCall: {
        ...entry.toolCall,
        status: 'complete' as ToolCallStatus,
      },
    }
  })
  return changed ? next : entries
}

export class RCSChatAdapter {
  private sessionId: string
  private setEntries: React.Dispatch<SetStateAction<ThreadEntry[]>>
  private eventSource: EventSource | null = null
  private disposed = false
  private runGen = 0
  private lastSeqNum = 0
  private seenEventIds = new Set<string>()
  private hadSseError = false
  private seenUserUuids = new Set<string>()
  private pendingOptimisticEntries: Array<{ uuid: string; text: string }> = []
  private onStatusChange?: (status: string) => void
  private onError?: (error: string) => void
  private onPermissionRequest?: (permission: PendingPermission) => void
  private onPermissionResolved?: (requestId: string) => void
  private onTasksChange?: (tasks: SessionTaskItem[]) => void
  private onAutomationStateChange?: (state: AutomationState) => void
  private onConversationCleared?: () => void
  private onTurnComplete?: () => void
  private onInterrupt?: () => void

  constructor(
    sessionId: string,
    setEntries: React.Dispatch<SetStateAction<ThreadEntry[]>>,
    options?: RCSChatAdapterOptions,
  ) {
    this.sessionId = sessionId
    this.setEntries = setEntries
    this.onStatusChange = options?.onStatusChange
    this.onError = options?.onError
    this.onPermissionRequest = options?.onPermissionRequest
    this.onPermissionResolved = options?.onPermissionResolved
    this.onTasksChange = options?.onTasksChange
    this.onAutomationStateChange = options?.onAutomationStateChange
    this.onConversationCleared = options?.onConversationCleared
    this.onTurnComplete = options?.onTurnComplete
    this.onInterrupt = options?.onInterrupt
  }

  getLastSeqNum(): number {
    return this.lastSeqNum
  }

  isDisposed(): boolean {
    return this.disposed
  }

  /** 初始化：绑定会话、加载历史、按需连接 SSE（支持取消与 StrictMode 重入） */
  async init(options?: { connectSse?: boolean }): Promise<void> {
    this.disposed = false
    const gen = ++this.runGen
    this.closeEventSource()
    this.lastSeqNum = 0
    this.seenEventIds.clear()
    this.hadSseError = false
    this.seenUserUuids.clear()
    this.pendingOptimisticEntries = []

    try {
      await apiBind(this.sessionId)
    } catch {
      // may already be bound
    }
    if (this.disposed || this.runGen !== gen) return

    await this.loadHistory(gen)
    if (this.disposed || this.runGen !== gen) return

    if (options?.connectSse !== false) {
      this.connectSSE(gen)
    }
  }

  /** 加载历史事件并转为 ThreadEntry，同时恢复未决权限与任务状态 */
  async loadHistory(expectedGen?: number): Promise<void> {
    const gen = expectedGen ?? this.runGen
    if (this.disposed || this.runGen !== gen) return
    const { events } = await apiFetchSessionHistory(this.sessionId)
    if (this.disposed || this.runGen !== gen) return
    if (!events || events.length === 0) return

    let historyEntries: ThreadEntry[] = []
    const pendingPermissions = new Map<string, PendingPermission>()
    let latestTasks: SessionTaskItem[] | null = null
    let latestAutomationState: AutomationState | null = null
    const nextSeenEventIds = new Set<string>()
    const nextSeenUserUuids = new Set<string>()
    let maxSeq = 0

    for (const event of events) {
      if (typeof event.seqNum === 'number' && event.seqNum > maxSeq) {
        maxSeq = event.seqNum
      }
      if (typeof event.id === 'string' && event.id) {
        nextSeenEventIds.add(event.id)
      }

      const serialized = JSON.stringify(event)
      if (/Remote Control connecting/i.test(serialized)) continue

      const payload = event.payload || ({} as EventPayload)

      if (event.type === 'status') {
        if (isConversationClearedStatus(payload as Record<string, unknown>)) {
          historyEntries = []
          pendingPermissions.clear()
          nextSeenUserUuids.clear()
        }
        continue
      }

      if (event.type === 'user' || event.type === 'user_message') {
        // 1. Pair embedded tool_result blocks with preceding tool calls
        const toolResults = extractToolResultBlocks(payload)
        for (const tr of toolResults) {
          historyEntries = applyToolResultToEntries(
            historyEntries,
            tr.toolCallId,
            tr.output,
            tr.isError,
          )
        }

        // 2. Skip synthetic system-generated user turns
        if (isSyntheticUserEvent(payload)) continue

        const text = extractEventText(payload)
        if (!text) continue

        // 3. Deduplicate outbound user messages against inbound echoed user events
        const msgUuid = extractMessageUuid(payload)
        if (msgUuid) {
          if (nextSeenUserUuids.has(msgUuid)) continue
          nextSeenUserUuids.add(msgUuid)
        } else {
          const prevEntry = historyEntries[historyEntries.length - 1]
          if (
            prevEntry?.type === 'user_message' &&
            prevEntry.content === text
          ) {
            continue
          }
        }

        historyEntries.push({
          type: 'user_message',
          id: msgUuid || event.id || `hist-user-${historyEntries.length}`,
          content: text,
        })
      } else if (event.type === 'assistant') {
        const text = extractEventText(payload)
        const toolBlocks = extractToolUseBlocks(payload)

        if (text && text.trim()) {
          historyEntries.push({
            type: 'assistant_message',
            id: event.id || `hist-asst-${historyEntries.length}`,
            chunks: [{ type: 'message', text }],
          })
        }

        for (const block of toolBlocks) {
          const toolId =
            (typeof block.id === 'string' && block.id) ||
            `hist-tool-${historyEntries.length}`
          if (findToolCallIndex(historyEntries, toolId) >= 0) continue
          historyEntries.push({
            type: 'tool_call',
            toolCall: {
              id: toolId,
              title: (typeof block.name === 'string' && block.name) || 'tool',
              status: 'running',
              rawInput: asRecord(block.input) || {},
            },
          })
        }
      } else if (event.type === 'tool_use') {
        const p = payload as Record<string, unknown>
        const toolId =
          (typeof p.tool_call_id === 'string' && p.tool_call_id) ||
          (typeof p.tool_use_id === 'string' && p.tool_use_id) ||
          `hist-tool-${historyEntries.length}`
        if (findToolCallIndex(historyEntries, toolId) >= 0) continue
        historyEntries.push({
          type: 'tool_call',
          toolCall: {
            id: toolId,
            title:
              (typeof p.tool_name === 'string' && p.tool_name) ||
              (typeof p.name === 'string' && p.name) ||
              'tool',
            status: 'running',
            rawInput: asRecord(p.tool_input) || asRecord(p.input) || {},
          },
        })
      } else if (event.type === 'tool_result') {
        const p = payload as Record<string, unknown>
        const callId =
          (typeof p.tool_call_id === 'string' && p.tool_call_id) ||
          (typeof p.tool_use_id === 'string' && p.tool_use_id) ||
          ''
        const output = p.output !== undefined ? p.output : (p.content ?? '')
        historyEntries = applyToolResultToEntries(
          historyEntries,
          callId,
          output,
          p.is_error === true,
        )
      } else if (
        event.type === 'control_request' ||
        event.type === 'permission_request'
      ) {
        const req = asRecord(payload.request)
        if (req && req.subtype === 'can_use_tool') {
          const requestId =
            (typeof payload.request_id === 'string' && payload.request_id) ||
            event.id ||
            ''
          if (!requestId) continue
          const toolName =
            (typeof req.tool_name === 'string' && req.tool_name) || 'unknown'
          const toolUseId =
            (typeof req.tool_use_id === 'string' && req.tool_use_id) ||
            (typeof req.tool_call_id === 'string' && req.tool_call_id) ||
            ''
          const toolInput =
            asRecord(req.input) || asRecord(req.tool_input) || {}
          const description =
            (typeof req.description === 'string' && req.description) || ''

          pendingPermissions.set(requestId, {
            requestId,
            toolName,
            toolInput,
            description,
          })

          const matchIdx = findMatchingToolCallForPermission(
            historyEntries,
            toolUseId,
            toolName,
          )
          if (matchIdx >= 0) {
            const entry = historyEntries[matchIdx] as ToolCallEntry
            historyEntries[matchIdx] = {
              type: 'tool_call',
              toolCall: {
                ...entry.toolCall,
                status: 'waiting_for_confirmation',
                permissionRequest: { requestId, options: [] },
              },
            }
          }
        }
      } else if (
        event.type === 'control_response' ||
        event.type === 'permission_response'
      ) {
        const { requestId, approved } = extractPermissionResponseInfo(payload)
        if (requestId) {
          pendingPermissions.delete(requestId)
          historyEntries = historyEntries.map(entry => {
            if (
              entry.type !== 'tool_call' ||
              entry.toolCall.permissionRequest?.requestId !== requestId
            ) {
              return entry
            }
            return {
              type: 'tool_call',
              toolCall: {
                ...entry.toolCall,
                status: approved ? 'running' : 'rejected',
                permissionRequest: undefined,
              },
            }
          })
        }
      } else if (event.type === 'interrupt') {
        pendingPermissions.clear()
        historyEntries = historyEntries.map(entry => {
          if (
            entry.type !== 'tool_call' ||
            (entry.toolCall.status !== 'running' &&
              entry.toolCall.status !== 'waiting_for_confirmation')
          ) {
            return entry
          }
          return {
            type: 'tool_call',
            toolCall: {
              ...entry.toolCall,
              status: 'canceled',
              permissionRequest: undefined,
            },
          }
        })
      } else if (event.type === 'result' || event.type === 'result_success') {
        historyEntries = finalizeRunningTools(historyEntries)
      } else if (event.type === 'task_state') {
        const tasks = extractTasksFromPayload(payload)
        if (tasks !== null) {
          latestTasks = tasks
        }
      } else if (event.type === 'automation_state') {
        const automation = extractAutomationState(payload)
        if (automation !== null) {
          latestAutomationState = automation
        }
      }
    }

    if (this.disposed || this.runGen !== gen) return

    this.lastSeqNum = maxSeq
    this.seenEventIds = nextSeenEventIds
    this.seenUserUuids = nextSeenUserUuids
    this.setEntries(historyEntries)

    if (latestTasks !== null) {
      this.onTasksChange?.(latestTasks)
    }
    if (latestAutomationState !== null) {
      this.onAutomationStateChange?.(latestAutomationState)
    }
    for (const perm of pendingPermissions.values()) {
      this.onPermissionRequest?.(perm)
    }
  }

  /** 连接本实例独占的 SSE 事件流（携带 from_sequence_num 防丢事件） */
  connectSSE(expectedGen?: number): void {
    const gen = expectedGen ?? this.runGen
    if (this.disposed || this.runGen !== gen) return
    this.closeEventSource()

    const uuid = getUuid()
    const params = new URLSearchParams({ uuid })
    if (this.lastSeqNum > 0) {
      params.set('from_sequence_num', String(this.lastSeqNum))
    }
    const url = `/web/sessions/${encodeURIComponent(this.sessionId)}/events?${params.toString()}`
    const es = new EventSource(url)
    this.eventSource = es

    es.addEventListener('message', (e: MessageEvent) => {
      if (this.disposed || this.runGen !== gen || this.eventSource !== es) {
        return
      }
      try {
        const data = JSON.parse(e.data) as SessionEvent
        if (!this.shouldProcessSeqEvent(data)) return
        this.handleEvent(data)
      } catch {
        // ignore parse errors
      }
    })

    es.addEventListener('error', () => {
      if (this.disposed || this.runGen !== gen || this.eventSource !== es) {
        return
      }
      this.hadSseError = true
    })
  }

  private shouldProcessSeqEvent(event: SessionEvent): boolean {
    if (typeof event.seqNum === 'number' && event.seqNum > 0) {
      const isServerRestartReset =
        (event.seqNum === 1 && this.lastSeqNum > 1) ||
        (this.hadSseError &&
          event.seqNum <= this.lastSeqNum &&
          typeof event.id === 'string' &&
          !this.seenEventIds.has(event.id))

      if (isServerRestartReset) {
        this.lastSeqNum = 0
        this.seenEventIds.clear()
      } else if (event.seqNum <= this.lastSeqNum) {
        return false
      }
      this.lastSeqNum = event.seqNum
    }
    this.hadSseError = false
    if (typeof event.id === 'string' && event.id) {
      this.seenEventIds.add(event.id)
    }
    return true
  }

  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  /** 断开 SSE 并递增生命周期代数以取消进行中的异步初始化 */
  disconnect(): void {
    this.disposed = true
    this.runGen += 1
    this.closeEventSource()
  }

  /** 处理实时 SSE 事件 */
  handleEvent(event: SessionEvent): void {
    if (this.disposed) return

    const type = event.type
    const payload = event.payload || ({} as EventPayload)

    // Skip bridge init noise
    const serialized = JSON.stringify(event)
    if (/Remote Control connecting/i.test(serialized)) return

    switch (type) {
      // ---- 用户消息 & 内嵌 tool_result ----
      case 'user':
      case 'user_message': {
        const toolResults = extractToolResultBlocks(payload)
        if (toolResults.length > 0) {
          this.setEntries(prev => {
            let next = prev
            for (const tr of toolResults) {
              next = applyToolResultToEntries(
                next,
                tr.toolCallId,
                tr.output,
                tr.isError,
              )
            }
            return next
          })
        }

        if (isSyntheticUserEvent(payload)) break

        const text = extractEventText(payload)
        if (!text) break

        const msgUuid = extractMessageUuid(payload)
        if (msgUuid) {
          if (this.seenUserUuids.has(msgUuid)) {
            const optIdx = this.pendingOptimisticEntries.findIndex(
              e => e.uuid === msgUuid,
            )
            if (optIdx >= 0) this.pendingOptimisticEntries.splice(optIdx, 1)
            break
          }
          this.seenUserUuids.add(msgUuid)
        } else if (
          this.pendingOptimisticEntries.length > 0 &&
          this.pendingOptimisticEntries[0]!.text === text
        ) {
          this.pendingOptimisticEntries.shift()
          break
        }

        const entryId = msgUuid || event.id || `user-${Date.now()}`
        this.setEntries(prev => {
          if (prev.some(e => e.type === 'user_message' && e.id === entryId)) {
            return prev
          }
          return [
            ...prev,
            {
              type: 'user_message',
              id: entryId,
              content: text,
            },
          ]
        })
        break
      }

      // ---- 助手消息 ----
      case 'assistant': {
        const content = extractEventText(payload)
        const toolBlocks = extractToolUseBlocks(payload)

        if (content && content.trim()) {
          this.setEntries(prev => {
            const lastEntry = prev[prev.length - 1]
            if (lastEntry?.type === 'assistant_message') {
              const lastChunk = lastEntry.chunks[lastEntry.chunks.length - 1]
              if (lastChunk?.type === 'message') {
                return [
                  ...prev.slice(0, -1),
                  {
                    ...lastEntry,
                    chunks: [
                      ...lastEntry.chunks.slice(0, -1),
                      { type: 'message', text: lastChunk.text + content },
                    ],
                  },
                ]
              }
              return [
                ...prev.slice(0, -1),
                {
                  ...lastEntry,
                  chunks: [
                    ...lastEntry.chunks,
                    { type: 'message', text: content },
                  ],
                },
              ]
            }

            const newEntry: AssistantMessageEntry = {
              type: 'assistant_message',
              id: event.id || `assistant-${Date.now()}`,
              chunks: [{ type: 'message', text: content }],
            }
            return [...prev, newEntry]
          })
        }

        if (toolBlocks.length > 0) {
          this.setEntries(prev => {
            let next = prev
            for (const block of toolBlocks) {
              const toolCallId =
                (typeof block.id === 'string' && block.id) ||
                `call-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
              if (findToolCallIndex(next, toolCallId) >= 0) continue
              const toolData: ToolCallData = {
                id: toolCallId,
                title: (typeof block.name === 'string' && block.name) || 'tool',
                status: 'running',
                rawInput: asRecord(block.input) || {},
              }
              next = [...next, { type: 'tool_call', toolCall: toolData }]
            }
            return next
          })
        }
        break
      }

      // ---- 独立工具调用 ----
      case 'tool_use': {
        const p = payload as Record<string, unknown>
        const toolCallId =
          (typeof p.tool_call_id === 'string' && p.tool_call_id) ||
          (typeof p.tool_use_id === 'string' && p.tool_use_id) ||
          `call-${Date.now()}`
        const toolData: ToolCallData = {
          id: toolCallId,
          title:
            (typeof p.tool_name === 'string' && p.tool_name) ||
            (typeof p.name === 'string' && p.name) ||
            'tool',
          status: 'running',
          rawInput: asRecord(p.tool_input) || asRecord(p.input) || {},
        }
        this.setEntries(prev => {
          if (findToolCallIndex(prev, toolCallId) >= 0) return prev
          return [...prev, { type: 'tool_call', toolCall: toolData }]
        })
        break
      }

      // ---- 独立工具结果 ----
      case 'tool_result': {
        const p = payload as Record<string, unknown>
        const callId =
          (typeof p.tool_call_id === 'string' && p.tool_call_id) ||
          (typeof p.tool_use_id === 'string' && p.tool_use_id) ||
          ''
        const output = p.output !== undefined ? p.output : (p.content ?? '')
        const isError = p.is_error === true
        this.setEntries(prev =>
          applyToolResultToEntries(prev, callId, output, isError),
        )
        break
      }

      // ---- 权限请求 ----
      case 'control_request':
      case 'permission_request': {
        const req = asRecord(payload.request)
        if (req && req.subtype === 'can_use_tool') {
          const requestId =
            (typeof payload.request_id === 'string' && payload.request_id) ||
            event.id ||
            ''
          const toolName =
            (typeof req.tool_name === 'string' && req.tool_name) || 'unknown'
          const toolUseId =
            (typeof req.tool_use_id === 'string' && req.tool_use_id) ||
            (typeof req.tool_call_id === 'string' && req.tool_call_id) ||
            ''
          const toolInput =
            asRecord(req.input) || asRecord(req.tool_input) || {}
          const description =
            (typeof req.description === 'string' && req.description) || ''

          this.setEntries(prev => {
            const realIdx = findMatchingToolCallForPermission(
              prev,
              toolUseId,
              toolName,
            )
            if (realIdx < 0) return prev
            const entry = prev[realIdx] as ToolCallEntry
            return prev.map((e, i) =>
              i === realIdx
                ? {
                    type: 'tool_call',
                    toolCall: {
                      ...entry.toolCall,
                      status: 'waiting_for_confirmation' as ToolCallStatus,
                      permissionRequest: { requestId, options: [] },
                    },
                  }
                : e,
            )
          })

          this.onPermissionRequest?.({
            requestId,
            toolName,
            toolInput,
            description,
          })
        }
        break
      }

      // ---- 权限响应 ----
      case 'control_response':
      case 'permission_response': {
        const { requestId, approved } = extractPermissionResponseInfo(payload)
        if (requestId) {
          this.updatePermissionToolState(requestId, approved)
          this.onPermissionResolved?.(requestId)
        }
        break
      }

      // ---- 会话状态 ----
      case 'session_status': {
        if (typeof payload.status === 'string') {
          this.onStatusChange?.(payload.status)
        }
        break
      }

      // ---- 状态事件（如 /clear） ----
      case 'status': {
        if (isConversationClearedStatus(payload as Record<string, unknown>)) {
          this.seenUserUuids.clear()
          this.pendingOptimisticEntries = []
          this.setEntries([])
          this.onConversationCleared?.()
        }
        break
      }

      // ---- 中断 ----
      case 'interrupt': {
        this.markRunningToolsCanceled()
        this.onInterrupt?.()
        break
      }

      // ---- 回合完成 ----
      case 'result':
      case 'result_success': {
        this.setEntries(prev => finalizeRunningTools(prev))
        this.onTurnComplete?.()
        break
      }

      // ---- 任务状态 ----
      case 'task_state': {
        const tasks = extractTasksFromPayload(payload)
        if (tasks !== null) {
          this.onTasksChange?.(tasks)
        }
        break
      }

      // ---- 自动化状态 ----
      case 'automation_state': {
        const automation = extractAutomationState(payload)
        if (automation !== null) {
          this.onAutomationStateChange?.(automation)
        }
        break
      }

      // ---- 错误 ----
      case 'error': {
        const errorMsg = String(
          (typeof payload.message === 'string' && payload.message) ||
            payload.content ||
            'Unknown error',
        )
        this.onError?.(errorMsg)
        break
      }

      // ---- 忽略的事件类型 ----
      case 'partial_assistant':
      case 'system':
        break
    }
  }

  private updatePermissionToolState(
    requestId: string,
    approved: boolean,
  ): void {
    this.setEntries(prev =>
      prev.map(entry => {
        if (entry.type !== 'tool_call') return entry
        if (entry.toolCall.permissionRequest?.requestId !== requestId) {
          return entry
        }
        return {
          type: 'tool_call',
          toolCall: {
            ...entry.toolCall,
            status: (approved ? 'running' : 'rejected') as ToolCallStatus,
            permissionRequest: undefined,
          },
        }
      }),
    )
  }

  private markRunningToolsCanceled(): void {
    this.setEntries(prev =>
      prev.map(entry => {
        if (entry.type !== 'tool_call') return entry
        if (
          entry.toolCall.status !== 'running' &&
          entry.toolCall.status !== 'waiting_for_confirmation'
        ) {
          return entry
        }
        return {
          type: 'tool_call',
          toolCall: {
            ...entry.toolCall,
            status: 'canceled' as ToolCallStatus,
            permissionRequest: undefined,
          },
        }
      }),
    )
  }

  /** 发送用户消息（失败时回滚乐观条目） */
  async sendMessage(text: string, images?: UserMessageImage[]): Promise<void> {
    if (!text.trim() && (!images || images.length === 0)) return

    const msgUuid = generateMessageUuid()
    const userEntry: UserMessageEntry = {
      type: 'user_message',
      id: msgUuid,
      content: text,
      images: images && images.length > 0 ? images : undefined,
    }
    this.seenUserUuids.add(msgUuid)
    this.pendingOptimisticEntries.push({ uuid: msgUuid, text })
    this.setEntries(prev => [...prev, userEntry])

    try {
      await apiSendEvent(this.sessionId, {
        type: 'user',
        uuid: msgUuid,
        content: text,
        message: { content: text },
      })
    } catch (err) {
      // Roll back optimistic message on send failure
      this.seenUserUuids.delete(msgUuid)
      const optIdx = this.pendingOptimisticEntries.findIndex(
        e => e.uuid === msgUuid,
      )
      if (optIdx >= 0) this.pendingOptimisticEntries.splice(optIdx, 1)
      this.setEntries(prev =>
        prev.filter(
          entry => !(entry.type === 'user_message' && entry.id === msgUuid),
        ),
      )
      throw err
    }
  }

  /** 响应权限请求（含 AskUserQuestion / ExitPlanMode） */
  async respondPermission(
    requestId: string,
    approved: boolean,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await apiSendControl(this.sessionId, {
      type: 'permission_response',
      approved,
      request_id: requestId,
      ...extra,
    })

    this.updatePermissionToolState(requestId, approved)
  }

  /** 中断当前操作 */
  async interrupt(): Promise<void> {
    this.markRunningToolsCanceled()
    await apiInterrupt(this.sessionId)
  }
}
