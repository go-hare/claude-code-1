import type { Message } from '../../types/message.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'

/**
 * densable uQt flag readers — Message is an open index type; fields are
 * optional runtime marks from REPL virtual rows / resume paths.
 */
function isVirtualMessage(msg: Message): boolean {
  return (
    (msg.type === 'user' || msg.type === 'assistant') &&
    (msg as { isVirtual?: boolean }).isVirtual === true
  )
}

function isResumedFromIncompleteThinking(msg: Message): boolean {
  return (
    msg.type === 'assistant' &&
    (msg as { resumedFromIncompleteThinking?: boolean })
      .resumedFromIncompleteThinking === true
  )
}

/**
 * Groups messages at API-round boundaries: one group per API round-trip.
 * A boundary fires when a NEW assistant response begins (different
 * message.id from the prior assistant). For well-formed conversations
 * this is an API-safe split point — the API contract requires every
 * tool_use to be resolved before the next assistant turn, so pairing
 * validity falls out of the assistant-id boundary. For malformed inputs
 * (dangling tool_use after resume/truncation) the fork's
 * ensureToolResultPairing repairs the split at API time.
 *
 * densable uQt residual:
 * - `isVirtual` user/assistant rows stay in the current group and do **not**
 *   update the last-assistant id gate (REPL inner tool_use/result virtuals).
 * - `resumedFromIncompleteThinking` assistants do **not** open a new group
 *   even when message.id changes (resume continuation of same logical turn).
 *
 * Replaces the prior human-turn grouping (boundaries only at real user
 * prompts) with finer-grained API-round grouping, allowing reactive
 * compact to operate on single-prompt agentic sessions (SDK/CCR/eval
 * callers) where the entire workload is one human turn.
 *
 * Extracted to its own file to break the compact.ts ↔ compactMessages.ts
 * cycle (CC-1180) — the cycle shifted module-init order enough to surface
 * a latent ws CJS/ESM resolution race in CI shard-2.
 */
export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  const groups: Message[][] = []
  let current: Message[] = []
  // message.id of the most recently seen **non-virtual** assistant. This is
  // the sole boundary gate: streaming chunks from the same API response share
  // an id, so boundaries only fire at the start of a genuinely new round.
  // normalizeMessages yields one AssistantMessage per content block, and
  // StreamingToolExecutor interleaves tool_results between chunks live
  // (yield order, not concat order — see query.ts:613). The id check
  // correctly keeps `[tu_A(id=X), result_A, tu_B(id=X)]` in one group.
  let lastAssistantId: string | undefined

  // In a well-formed conversation the API contract guarantees every
  // tool_use is resolved before the next assistant turn, so lastAssistantId
  // alone is a sufficient boundary gate. Tracking unresolved tool_use IDs
  // would only do work when the conversation is malformed (dangling tool_use
  // after resume-from-partial-batch or max_tokens truncation) — and in that
  // case it pins the gate shut forever, merging all subsequent rounds into
  // one group. We let those boundaries fire; the summarizer fork's own
  // ensureToolResultPairing at claude.ts:1136 repairs the dangling tu at
  // API time.
  for (const msg of messages) {
    // densable uQt: virtual rows append but never gate a boundary / id update
    if (isVirtualMessage(msg)) {
      current.push(msg)
      continue
    }
    if (
      msg.type === 'assistant' &&
      msg.message!.id !== lastAssistantId &&
      !isResumedFromIncompleteThinking(msg) &&
      current.length > 0
    ) {
      groups.push(current)
      current = [msg]
    } else {
      current.push(msg)
    }
    if (msg.type === 'assistant') {
      lastAssistantId = msg.message!.id
    }
  }

  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}

/**
 * densable yqr(e) — API-round groups for reactive compact / PTL gates:
 * `uQt(Zb(e).filter(progress))` where Zb is slice-from-last-compact-boundary.
 * Uses includeSnipped:true so densable Zb is pure slice (no HISTORY_SNIP view).
 */
export function groupApiRoundsAfterCompactBoundary(
  messages: Message[],
): Message[][] {
  const afterBoundary = getMessagesAfterCompactBoundary(messages, {
    includeSnipped: true,
  })
  const withoutProgress = afterBoundary.filter(m => m.type !== 'progress')
  return groupMessagesByApiRound(withoutProgress)
}

/**
 * densable lvu(e) — true when yqr(e) has fewer than 2 API rounds
 * (nothing to compact / nothing for reactive PTL group gate).
 */
export function hasFewerThanTwoApiRounds(messages: Message[]): boolean {
  return groupApiRoundsAfterCompactBoundary(messages).length < 2
}
