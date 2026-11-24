import { getUuid } from './client'
import type { SessionEvent } from '../types'

let currentEventSource: EventSource | null = null

export function connectSSE(
  sessionId: string,
  onEvent: (event: SessionEvent) => void,
  fromSeqNum = 0,
): void {
  disconnectSSE()

  const uuid = getUuid()
  const params = new URLSearchParams({ uuid })
  if (fromSeqNum > 0) {
    params.set('from_sequence_num', String(fromSeqNum))
  }
  const url = `/web/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`
  const es = new EventSource(url)
  currentEventSource = es

  let lastSeenSeq = fromSeqNum
  const seenEventIds = new Set<string>()
  let hadError = false

  es.addEventListener('message', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as SessionEvent
      if (typeof data.seqNum === 'number' && data.seqNum > 0) {
        const isServerRestartReset =
          (data.seqNum === 1 && lastSeenSeq > 1) ||
          (hadError &&
            data.seqNum <= lastSeenSeq &&
            typeof data.id === 'string' &&
            !seenEventIds.has(data.id))
        if (isServerRestartReset) {
          lastSeenSeq = 0
          seenEventIds.clear()
        } else if (data.seqNum <= lastSeenSeq) {
          return
        }
        lastSeenSeq = data.seqNum
      }
      hadError = false
      if (typeof data.id === 'string' && data.id) {
        seenEventIds.add(data.id)
      }
      onEvent(data)
    } catch {
      // ignore parse errors
    }
  })

  es.addEventListener('error', () => {
    hadError = true
    // EventSource auto-reconnects
  })
}

export function disconnectSSE(): void {
  if (currentEventSource) {
    currentEventSource.close()
    currentEventSource = null
  }
}
