import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import { getActiveApiToken, getUuid } from '../api/client'
import { generateMessageUuid } from './utils'
import type { SessionEvent, EventPayload } from '../types'

// ============================================================
// SSE Event Bus — shared between SSE listener and transport
// ============================================================

type SSEEventHandler = (event: SessionEvent) => void

class SSEEventBus {
  private listeners: Set<SSEEventHandler> = new Set()
  private eventSource: EventSource | null = null
  private _lastSeqNum = 0
  private seenEventIds = new Set<string>()
  private hadError = false

  get lastSeqNum() {
    return this._lastSeqNum
  }

  /** Register a listener for SSE events */
  onEvent(handler: SSEEventHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  /** Connect to the SSE stream for a session */
  connect(sessionId: string, fromSeqNum = 0): void {
    this.disconnect()
    this._lastSeqNum = fromSeqNum
    const uuid = getUuid()
    const params = new URLSearchParams({ uuid })
    if (fromSeqNum > 0) {
      params.set('from_sequence_num', String(fromSeqNum))
    }
    const url = `/web/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`
    const es = new EventSource(url)
    this.eventSource = es

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as SessionEvent
        if (typeof data.seqNum === 'number' && data.seqNum > 0) {
          const isServerRestartReset =
            (data.seqNum === 1 && this._lastSeqNum > 1) ||
            (this.hadError &&
              data.seqNum <= this._lastSeqNum &&
              typeof data.id === 'string' &&
              !this.seenEventIds.has(data.id))
          if (isServerRestartReset) {
            this._lastSeqNum = 0
            this.seenEventIds.clear()
          } else if (data.seqNum <= this._lastSeqNum) {
            return
          }
          this._lastSeqNum = data.seqNum
        }
        this.hadError = false
        if (typeof data.id === 'string' && data.id) {
          this.seenEventIds.add(data.id)
        }
        for (const handler of this.listeners) {
          handler(data)
        }
      } catch {
        // ignore parse errors
      }
    })

    es.addEventListener('error', () => {
      this.hadError = true
    })
  }

  /** Disconnect the SSE stream */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this._lastSeqNum = 0
    this.seenEventIds.clear()
    this.hadError = false
  }
}

// Singleton event bus
export const sseBus = new SSEEventBus()

// ============================================================
// RCS ChatTransport — bridges RCS SSE to AI SDK UIMessageChunk
// ============================================================

interface RCSTransportOptions {
  sessionId: string
  onPermissionRequest?: (event: SessionEvent) => void
  onSessionStatus?: (status: string) => void
  onError?: (error: string) => void
}

export class RCSTransport implements ChatTransport<UIMessage> {
  private sessionId: string
  private onPermissionRequest?: (event: SessionEvent) => void
  private onSessionStatus?: (status: string) => void
  private onError?: (error: string) => void
  private unsub: (() => void) | null = null

  constructor(options: RCSTransportOptions) {
    this.sessionId = options.sessionId
    this.onPermissionRequest = options.onPermissionRequest
    this.onSessionStatus = options.onSessionStatus
    this.onError = options.onError
  }

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'user') {
      return new ReadableStream({ start: c => c.close() })
    }

    const text = lastMessage.parts
      .filter(
        (
          p: UIMessage['parts'][number],
        ): p is Extract<typeof p, { type: 'text' }> => p.type === 'text',
      )
      .map((p: { text: string }) => p.text)
      .join('')

    if (!text.trim()) {
      return new ReadableStream({ start: c => c.close() })
    }

    // Subscribe BEFORE POSTing so early SSE responses cannot be missed
    const bufferedEvents: SessionEvent[] = []
    let liveHandler: SSEEventHandler | null = null
    const unsub = sseBus.onEvent(event => {
      if (liveHandler) {
        liveHandler(event)
      } else {
        bufferedEvents.push(event)
      }
    })
    this.destroy()
    this.unsub = unsub

    const uuid = getUuid()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-UUID': uuid,
    }
    const apiToken = getActiveApiToken()
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`
    }

    let response: Response
    try {
      response = await fetch(
        `/web/sessions/${encodeURIComponent(this.sessionId)}/events`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'user',
            uuid: generateMessageUuid(),
            content: text,
            message: { content: text },
          }),
          signal: abortSignal,
        },
      )
    } catch (err) {
      this.destroy()
      throw err
    }

    if (!response.ok) {
      this.destroy()
      const rawText = await response.text().catch(() => '')
      let errMsg = response.statusText || 'Failed to send message'
      try {
        const data = JSON.parse(rawText) as {
          error?: string | { message?: string; type?: string }
        }
        if (typeof data.error === 'string') {
          errMsg = data.error
        } else if (data.error?.message || data.error?.type) {
          errMsg = data.error.message || data.error.type || errMsg
        }
      } catch {
        if (rawText.trim()) errMsg = rawText.trim()
      }
      throw new Error(errMsg)
    }

    return new ReadableStream<UIMessageChunk>({
      start: controller => {
        let textCounter = 0
        let started = false
        let closed = false

        const safeEnqueue = (chunk: UIMessageChunk) => {
          if (closed) return
          try {
            controller.enqueue(chunk)
          } catch {
            closed = true
            cleanup()
          }
        }

        const safeClose = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {
            // already closed
          }
          cleanup()
        }

        const ensureStarted = () => {
          if (!started && !closed) {
            started = true
            safeEnqueue({
              type: 'start',
              messageId: `msg-${Date.now()}`,
            })
          }
        }

        const onAbort = () => {
          safeEnqueue({ type: 'abort', reason: 'Aborted' })
          safeClose()
        }

        const cleanup = () => {
          liveHandler = null
          if (this.unsub === unsub) {
            this.unsub()
            this.unsub = null
          }
          if (abortSignal) {
            abortSignal.removeEventListener('abort', onAbort)
          }
        }

        const handler = (event: SessionEvent) => {
          if (closed) return
          const type = event.type
          const payload = event.payload || ({} as EventPayload)

          const serialized = JSON.stringify(event)
          if (/Remote Control connecting/i.test(serialized)) return

          switch (type) {
            case 'assistant': {
              const content =
                typeof payload.content === 'string' ? payload.content : ''
              if (content && content.trim()) {
                const textId = `text-${Date.now()}-${++textCounter}`
                ensureStarted()
                safeEnqueue({ type: 'text-start', id: textId })
                safeEnqueue({
                  type: 'text-delta',
                  id: textId,
                  delta: content,
                })
                safeEnqueue({ type: 'text-end', id: textId })
              }

              const msg = payload.message as Record<string, unknown> | undefined
              if (
                msg &&
                typeof msg === 'object' &&
                Array.isArray(msg.content)
              ) {
                const toolBlocks = (
                  msg.content as Array<Record<string, unknown>>
                ).filter(b => b.type === 'tool_use')
                for (const block of toolBlocks) {
                  ensureStarted()
                  const toolCallId =
                    (block.id as string) ||
                    `call-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
                  safeEnqueue({
                    type: 'tool-input-available',
                    toolCallId,
                    toolName: (block.name as string) || 'tool',
                    input: block.input || {},
                  })
                }
              }
              // Keep stream open for tool calls / multi-step replies; close on result or session idle
              break
            }

            case 'tool_use': {
              ensureStarted()
              const p = payload as Record<string, unknown>
              const toolCallId =
                (p.tool_call_id as string) ||
                (p.tool_use_id as string) ||
                `call-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
              safeEnqueue({
                type: 'tool-input-available',
                toolCallId,
                toolName: (p.tool_name as string) || 'tool',
                input: p.tool_input || {},
              })
              break
            }

            case 'tool_result': {
              ensureStarted()
              const p = payload as Record<string, unknown>
              const resultCallId =
                (p.tool_call_id as string) ||
                (p.tool_use_id as string) ||
                `call-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
              const output =
                typeof p.output === 'string' ? p.output : p.content || ''
              safeEnqueue({
                type: 'tool-output-available',
                toolCallId: resultCallId,
                output: String(output),
              })
              break
            }

            case 'control_request':
            case 'permission_request': {
              const req = payload.request as Record<string, unknown> | undefined
              if (req && req.subtype === 'can_use_tool') {
                this.onPermissionRequest?.(event)
              }
              break
            }

            case 'result':
            case 'result_success': {
              ensureStarted()
              safeEnqueue({ type: 'finish', finishReason: 'stop' })
              safeClose()
              break
            }

            case 'session_status': {
              if (typeof payload.status === 'string') {
                this.onSessionStatus?.(payload.status)
                if (
                  payload.status === 'idle' ||
                  payload.status === 'archived' ||
                  payload.status === 'inactive'
                ) {
                  ensureStarted()
                  safeEnqueue({ type: 'finish', finishReason: 'stop' })
                  safeClose()
                }
              }
              break
            }

            case 'error': {
              const errorText = String(
                (typeof payload.message === 'string' && payload.message) ||
                  payload.content ||
                  'Unknown error',
              )
              this.onError?.(errorText)
              ensureStarted()
              safeEnqueue({
                type: 'error',
                errorText,
              })
              safeEnqueue({ type: 'finish', finishReason: 'error' })
              safeClose()
              break
            }

            case 'interrupt': {
              ensureStarted()
              safeEnqueue({
                type: 'abort',
                reason: 'Session interrupted',
              })
              safeClose()
              break
            }

            default:
              return
          }
        }

        if (abortSignal) {
          if (abortSignal.aborted) {
            onAbort()
            return
          }
          abortSignal.addEventListener('abort', onAbort)
        }

        liveHandler = handler
        for (const buffered of bufferedEvents.splice(0)) {
          if (closed) break
          handler(buffered)
        }
      },
      cancel: () => {
        this.destroy()
      },
    })
  }

  /** Not supported — RCS doesn't have stream resumption */
  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null)
  }

  /** Clean up listeners */
  destroy(): void {
    if (this.unsub) {
      this.unsub()
      this.unsub = null
    }
  }
}
