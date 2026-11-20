import type { Message } from '../../types/message.js'

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
 * Replaces the prior human-turn grouping (boundaries only at real user
 * prompts) with finer-grained API-round grouping, allowing reactive
 * compact to operate on single-prompt agentic sessions (SDK/CCR/eval
 * callers) where the entire workload is one human turn.
 *
 * Extracted to its own file to break the compact.ts ↔ compactMessages.ts
 * cycle (CC-1180) — the cycle shifted module-init order enough to surface
 * a latent ws CJS/ESM resolution race in CI shard-2.
 */
function isVirtualMessage(msg: Message): boolean {
  return (
    (msg.type === 'user' || msg.type === 'assistant') &&
    (msg as { isVirtual?: boolean }).isVirtual === true
  )
}

function isSyntheticApiErrorMessage(msg: Message): boolean {
  return msg.type === 'assistant' && msg.isApiErrorMessage === true
}

function hasUnresolvedToolUseInGroup(group: readonly Message[]): boolean {
  const unresolved = new Set<string>()
  for (const item of group) {
    if (item.type !== 'assistant' && item.type !== 'user') continue
    const content = item.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        unresolved.add(block.id)
      } else if (
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        unresolved.delete(block.tool_use_id)
      }
    }
  }
  return unresolved.size > 0
}

export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  const groups: Message[][] = []
  let current: Message[] = []
  // message.id of the most recently seen assistant. This is the sole
  // boundary gate: streaming chunks from the same API response share an
  // id, so boundaries only fire at the start of a genuinely new round.
  // normalizeMessages yields one AssistantMessage per content block, and
  // StreamingToolExecutor interleaves tool_results between chunks live
  // (yield order, not concat order — see query.ts:613). The id check
  // correctly keeps `[tu_A(id=X), result_A, tu_B(id=X)]` in one group.
  let lastAssistantId: string | undefined

  for (const msg of messages) {
    // Official 2.1.327 `jee(e)` (#394): keep virtual messages in the current
    // group, and keep synthetic/API-error messages (such as a max_output_tokens
    // truncation notice) inside the current group whenever there is still an
    // unanswered tool_use so compaction never splits/loses that reply's tool
    // call and its result.
    if (isVirtualMessage(msg)) {
      current.push(msg)
      continue
    }
    if (
      isSyntheticApiErrorMessage(msg) &&
      hasUnresolvedToolUseInGroup(current)
    ) {
      current.push(msg)
      continue
    }

    const resumedIncompleteThinking =
      msg.type === 'assistant' &&
      (msg as { resumedFromIncompleteThinking?: boolean })
        .resumedFromIncompleteThinking === true
    if (
      msg.type === 'assistant' &&
      msg.message!.id !== lastAssistantId &&
      !resumedIncompleteThinking &&
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
