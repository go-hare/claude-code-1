/**
 * densable J$u / k6g / $er / Vio — sync agent error recovery (pure).
 * Kept separate from agentToolUtils to avoid circular load with AgentTool.tsx.
 */

import { AbortError } from 'src/utils/errors.js'
import type { Message as MessageType, ContentItem } from 'src/types/message.js'
import {
  extractTextContent,
  getLastAssistantMessage,
  isSyntheticMessage,
} from 'src/utils/messages.js'

/**
 * densable Vio — AgentApiErrorTerminationError (rate_limit/overloaded/server_error).
 * Gold: throw new Vio(Tu(ie.message.content), ie.error) when isApiErrorMessage mid-stream.
 */
export class AgentApiErrorTerminationError extends Error {
  readonly errorKind: string
  constructor(message: string, errorKind: string) {
    super(
      message
        ? `Agent terminated early due to an API error: ${message}`
        : 'Agent terminated early due to an API error',
    )
    this.name = 'AgentApiErrorTerminationError'
    this.errorKind = errorKind
  }
}

/** densable x6g — recoverable API error kinds for k6g partial recover. */
export const RECOVERABLE_AGENT_API_ERROR_KINDS = new Set([
  'rate_limit',
  'overloaded',
  'server_error',
])

const PARTIAL_OUTPUT_CUTOFF_SUFFIX =
  'Everything below is PARTIAL output recovered from the agent before it was cut off. The agent did NOT finish its task — treat these results as incomplete.'

/**
 * densable $er — last non-api-error assistant has recoverable text.
 */
export function hasRecoverableAssistantText(
  messages: MessageType[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type !== 'assistant') continue
    if ((m as { isApiErrorMessage?: boolean }).isApiErrorMessage) continue
    const text = extractTextContent(
      (m.message?.content as ContentItem[]) ?? [],
      '\n',
    )
    if (text) return true
  }
  return false
}

/**
 * densable k6g — if Vio + recoverable kind + filtered history has $er text,
 * return history (api-error assistants stripped) + cutoffNote.
 */
export function tryRecoverApiErrorPartial(
  error: unknown,
  messages: MessageType[],
): { history: MessageType[]; cutoffNote: string } | null {
  if (!(error instanceof AgentApiErrorTerminationError)) return null
  if (!RECOVERABLE_AGENT_API_ERROR_KINDS.has(error.errorKind)) return null
  const history = messages.filter(
    m =>
      !(
        m.type === 'assistant' &&
        (m as { isApiErrorMessage?: boolean }).isApiErrorMessage
      ),
  )
  if (!hasRecoverableAssistantText(history)) return null
  // densable Fer(e.message,{prependMarker:!1}).sanitized — full e.message
  // (includes Vio prefix "Agent terminated early due to an API error: …");
  // prependMarker:false skips secret-finding header only, does not strip Vio.
  const sanitized = error.message
  const cutoffNote = `${sanitized}\n\n${PARTIAL_OUTPUT_CUTOFF_SUFFIX}`
  return { history, cutoffNote }
}

export type SyncAgentErrorRecovery = {
  history: MessageType[]
  cutoffNote?: string
}

/**
 * densable J$u(e,t) — sync-agent error recovery for partial results.
 * - k6g Vio partial → history + cutoffNote
 * - AbortError → always return history (no rethrow)
 * - Vio or no recoverable text → rethrow (unless Abort)
 * - else non-abort with text → return history (sync_error_partial)
 */
export function recoverSyncAgentErrorHistory(
  error: unknown,
  messages: MessageType[],
): SyncAgentErrorRecovery {
  const partial = tryRecoverApiErrorPartial(error, messages)
  if (partial) return partial

  const isAbort =
    error instanceof AbortError ||
    (error instanceof Error && error.name === 'AbortError')

  if (
    error instanceof AgentApiErrorTerminationError ||
    !hasRecoverableAssistantText(messages)
  ) {
    if (!isAbort) throw error
  }
  return { history: messages }
}

/**
 * densable Yqe post-stream Vio producer:
 * `let ie=FH(g); if(ie?.isApiErrorMessage&&!_ce(ie)) throw new Vio(Tu(...),ie.error)`
 * Call after async stream ends, before Jeo/finalize/complete.
 * Synthetic interrupt API-error assistants (`_ce`) are skipped so cancel stays Abort/Xl.
 */
export function throwIfLastAssistantIsApiError(
  messages: MessageType[],
): void {
  const last = getLastAssistantMessage(messages)
  if (!last) return
  if (!(last as { isApiErrorMessage?: boolean }).isApiErrorMessage) return
  if (isSyntheticMessage(last)) return
  const text = extractTextContent(
    (last.message?.content as ContentItem[]) ?? [],
    '\n',
  )
  // Gold: Vio(Tu(content), ie.error) — error is SDKAssistantMessageError string.
  const errorKind = String(
    (last as { error?: string | undefined }).error ?? '',
  )
  throw new AgentApiErrorTerminationError(text, errorKind)
}

/**
 * densable H6g(e,t,r) — prefer registry transcript when strictly longer than
 * stream messages before Cns/finalize.
 * Gold: `let n=e.getTranscript(t); return n&&n.messages.length>r.length?n.messages:r`
 * Pure: pass transcript messages (local: retain task.messages).
 */
export function preferLongerAgentMessages(
  streamMessages: MessageType[],
  transcriptMessages: MessageType[] | undefined | null,
): MessageType[] {
  if (
    transcriptMessages &&
    transcriptMessages.length > streamMessages.length
  ) {
    return transcriptMessages
  }
  return streamMessages
}
