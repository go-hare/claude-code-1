/** densable leftover Oe / parseDraftTranscriptMessages */

export type DraftTranscriptUserMessage = {
  type: 'user'
  uuid: string
  timestamp: string
  message: unknown
  isMeta?: true
  toolUseResult?: unknown
  isCompactSummary?: true
}

export type DraftTranscriptAssistantMessage = {
  type: 'assistant'
  uuid: string
  timestamp: string
  message: unknown
  requestId?: unknown
}

export type DraftTranscriptMessage =
  | DraftTranscriptUserMessage
  | DraftTranscriptAssistantMessage

function draftTranscriptFromRecord(
  rec: Record<string, unknown>,
): DraftTranscriptMessage | null {
  if (rec.type !== 'user' && rec.type !== 'assistant') return null
  if (typeof rec.uuid !== 'string' || typeof rec.timestamp !== 'string') {
    return null
  }
  if (rec.isSidechain === true || !rec.message) return null
  if (rec.type === 'user') {
    return {
      type: 'user',
      uuid: rec.uuid,
      timestamp: rec.timestamp,
      message: rec.message,
      ...(rec.isMeta === true && { isMeta: true as const }),
      ...(rec.toolUseResult !== undefined && {
        toolUseResult: rec.toolUseResult,
      }),
      ...(rec.isCompactSummary === true && {
        isCompactSummary: true as const,
      }),
    }
  }
  return {
    type: 'assistant',
    uuid: rec.uuid,
    timestamp: rec.timestamp,
    message: rec.message,
    requestId: rec.requestId,
  }
}

/** densable leftover ye — Oe-shaped filter on live session messages */
export function sessionMessagesToDraftTranscript(
  messages: readonly unknown[],
): DraftTranscriptMessage[] {
  const out: DraftTranscriptMessage[] = []
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) continue
    const next = draftTranscriptFromRecord(item as Record<string, unknown>)
    if (next) out.push(next)
  }
  return out
}

/** densable leftover Oe */
export function parseDraftTranscriptMessages(
  raw: string,
): DraftTranscriptMessage[] {
  const out: DraftTranscriptMessage[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const next = draftTranscriptFromRecord(parsed as Record<string, unknown>)
    if (next) out.push(next)
  }
  return out
}
