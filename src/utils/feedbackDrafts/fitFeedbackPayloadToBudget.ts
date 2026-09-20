import { logForDebugging } from '../debug.js'
import {
  FEEDBACK_PAYLOAD_BUDGET_BYTES,
  FEEDBACK_PAYLOAD_RESERVE_BYTES,
} from './constants.js'
import type { DraftTranscriptMessage } from './parseDraftTranscriptMessages.js'

export type FeedbackSubmitPayload = {
  latestAssistantMessageId: string | null
  latestAssistantAPIMessageId: null
  lastInterruptedAssistantAPIMessageId: null
  message_count: number
  datetime: string
  description: string
  surface: string
  platform: NodeJS.Platform
  gitRepo: false
  commitSha: null
  version: string
  transcript: DraftTranscriptMessage[]
  rawTranscriptJsonl?: string
}

export type FeedbackPayloadTrim = {
  keptMessageCount: number
  totalMessageCount: number
  oversizedMessageCount: number
  rawTail: 'absent' | 'untouched' | 'omitted' | 'reduced'
  rawTailKeptBytes: number
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
}

/** densable leftover Me */
function messageJsonBytes(message: unknown): number {
  return Buffer.byteLength(JSON.stringify(JSON.stringify(message)).slice(1, -1))
}

/** densable leftover G */
function rawJsonlBytes(raw: string): number {
  const escaped = JSON.stringify(raw).slice(1, -1)
  return Buffer.byteLength(JSON.stringify(escaped).slice(1, -1))
}

/** densable leftover z — drop oldest size entries until `dropBytes` is freed. */
function dropPrefixToFreeBytes(
  sizes: number[],
  dropBytes: number,
): { start: number; keptBytes: number; oversized: Set<number> } {
  const oversized = new Set<number>()
  let start = 0
  let dropped = 0
  while (dropped < dropBytes && start < sizes.length) {
    dropped += sizes[start] ?? 0
    start++
  }
  let keptBytes = 0
  for (let i = start; i < sizes.length; i++) {
    keptBytes += sizes[i] ?? 0
  }
  return { start, keptBytes, oversized }
}

/** densable leftover Fe */
export function formatFeedbackPayloadTrim(
  trim: FeedbackPayloadTrim,
): string | null {
  const parts: string[] = []
  if (trim.keptMessageCount < trim.totalMessageCount) {
    parts.push(
      `kept ${trim.keptMessageCount} of ${trim.totalMessageCount} transcript messages (newest kept first)`,
    )
  }
  if (trim.rawTail === 'reduced') {
    parts.push(
      `kept ${Math.max(1, Math.round(trim.rawTailKeptBytes / 1024))} KiB of the raw session log (newest kept first)`,
    )
  } else if (trim.rawTail === 'omitted') {
    parts.push('omitted the raw session log')
  }
  if (parts.length === 0) return null
  return `transcript_truncated: ${parts.join('; ')} (trimmed client-side to fit the upload size limit)`
}

/** densable leftover ee */
export function fitFeedbackPayloadToBudget(payload: FeedbackSubmitPayload): {
  payload: FeedbackSubmitPayload
  trim: FeedbackPayloadTrim | null
} {
  const size = jsonBytes(payload)
  if (size <= FEEDBACK_PAYLOAD_BUDGET_BYTES) {
    return { payload, trim: null }
  }
  const excess =
    size - (FEEDBACK_PAYLOAD_BUDGET_BYTES - FEEDBACK_PAYLOAD_RESERVE_BYTES)
  const messageSizes = payload.transcript.map(
    message => messageJsonBytes(message) + 1,
  )
  const transcriptBytes = messageSizes.reduce((sum, next) => sum + next, 0)
  const rawBytes =
    payload.rawTranscriptJsonl === undefined
      ? 0
      : rawJsonlBytes(payload.rawTranscriptJsonl)
  const dropTranscriptBytes =
    excess <= transcriptBytes
      ? transcriptBytes - excess
      : Math.max(0, transcriptBytes - Math.max(0, excess - rawBytes))
  const { start, keptBytes, oversized } = dropPrefixToFreeBytes(
    messageSizes,
    dropTranscriptBytes,
  )
  const sliced = payload.transcript.slice(start)
  const kept =
    oversized.size === 0
      ? sliced
      : sliced.filter((_message, index) => !oversized.has(start + index))
  let remain = excess - (transcriptBytes - keptBytes)
  let raw = payload.rawTranscriptJsonl
  let rawTail: FeedbackPayloadTrim['rawTail'] =
    raw === undefined ? 'absent' : 'untouched'
  if (remain > 0 && raw !== undefined) {
    const dropRaw = rawBytes - remain
    if (dropRaw <= 0) {
      raw = undefined
      rawTail = 'omitted'
    } else {
      const lines = raw.split('\n')
      const lineSizes = lines.map(line => rawJsonlBytes(`${line}\n`))
      const trimmed = dropPrefixToFreeBytes(lineSizes, dropRaw)
      const keptLines = lines.slice(trimmed.start)
      const joined = (
        trimmed.oversized.size === 0
          ? keptLines
          : keptLines.filter(
              (_line, index) => !trimmed.oversized.has(trimmed.start + index),
            )
      ).join('\n')
      if (joined === '') {
        raw = undefined
        rawTail = 'omitted'
      } else {
        raw = joined
        rawTail = 'reduced'
      }
    }
  }
  const trim: FeedbackPayloadTrim = {
    keptMessageCount: kept.length,
    totalMessageCount: payload.transcript.length,
    oversizedMessageCount: oversized.size,
    rawTail,
    rawTailKeptBytes: raw === undefined ? 0 : Buffer.byteLength(raw),
  }
  const annotation = formatFeedbackPayloadTrim(trim)
  if (annotation === null) return { payload, trim: null }
  const { rawTranscriptJsonl: _raw, ...rest } = payload
  const next: FeedbackSubmitPayload = {
    ...rest,
    message_count: kept.length,
    description: `${payload.description}\n${annotation}`,
    transcript: kept,
    ...(raw !== undefined && { rawTranscriptJsonl: raw }),
  }
  const fitted = jsonBytes(next)
  if (fitted > FEEDBACK_PAYLOAD_BUDGET_BYTES) {
    logForDebugging(
      `fitFeedbackPayloadToBudget: still ${fitted} bytes after trim (budget ${FEEDBACK_PAYLOAD_BUDGET_BYTES})`,
      { level: 'error' },
    )
  }
  return { payload: next, trim }
}
