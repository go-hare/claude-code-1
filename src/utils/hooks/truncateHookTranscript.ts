/**
 * densable z2y / G2y / V2y residual — truncate Stop/SubagentStop transcript
 * to a fraction of the evaluator model context window (default ikd=0.5).
 * Behavior only (no tengu analytics).
 */

import { groupMessagesByApiRound } from '../../services/compact/grouping.js'
import { roughTokenCountEstimationForMessages } from '../../services/tokenEstimation.js'
import type { Message } from '../../types/message.js'
import {
  getContextWindowForModel,
  MODEL_CONTEXT_WINDOW_DEFAULT,
} from '../context.js'
import { logForDebugging } from '../debug.js'
import { createUserMessage } from '../messages.js'
import { jsonStringify } from '../slowOperations.js'
import { tokenCountFromLastAPIResponse } from '../tokens.js'

/** densable ikd — default budget fraction of model context window. */
export const HOOK_TRANSCRIPT_BUDGET_FRACTION = 0.5

/**
 * densable G2y — last non-synthetic assistant usage total tokens.
 * Local: tokenCountFromLastAPIResponse already skips synthetic model usage.
 */
export function lastUsageTokenCount(messages: Message[]): number {
  return tokenCountFromLastAPIResponse(messages)
}

/**
 * densable V2y — rough token estimate for one API-round group.
 * user/assistant: rough content estimate; other types: JSON length / 4.
 */
export function estimateGroupTokens(group: Message[]): number {
  let tokens = 0
  for (const msg of group) {
    if (msg.type === 'assistant' || msg.type === 'user') {
      tokens += roughTokenCountEstimationForMessages([msg])
    } else {
      tokens += Math.ceil(jsonStringify(msg).length / 4)
    }
  }
  return Math.ceil(tokens)
}

/**
 * densable model window for z2y: Z_(t)||pL(t)?1e6:rGt.
 * Local uses getContextWindowForModel (handles [1m], caps, model cards).
 */
export function evaluatorContextWindow(model: string): number {
  const window = getContextWindowForModel(model)
  return window > 0 ? window : MODEL_CONTEXT_WINDOW_DEFAULT
}

/**
 * densable z2y(e,t,r=ikd) — keep recent API rounds under floor(window*r).
 * When last-usage tokens already fit budget, return e unchanged.
 * On truncate: prepend a synthetic user notice + kept tail.
 */
export function truncateTranscriptForHookEvaluator(
  messages: Message[],
  model: string,
  budgetFraction: number = HOOK_TRANSCRIPT_BUDGET_FRACTION,
): Message[] {
  const window = evaluatorContextWindow(model)
  const budget = Math.floor(window * budgetFraction)
  if (lastUsageTokenCount(messages) <= budget) {
    return messages
  }

  // densable uQt ≈ groupMessagesByApiRound (local lacks virtual/resumed split nuance)
  const groups = groupMessagesByApiRound(messages)
  let used = 0
  let start = groups.length
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!
    const groupTokens = estimateGroupTokens(group)
    // densable: if (a < i.length && s+d > o) break — keep at least the last group
    if (start < groups.length && used + groupTokens > budget) {
      break
    }
    used += groupTokens
    start = i
  }

  const kept = groups.slice(start).flat()
  const dropped = messages.length - kept.length
  if (dropped <= 0) {
    return messages
  }

  logForDebugging(
    `Hooks: truncated Stop transcript ${messages.length}→${kept.length} msgs (budget ${budget}, model ${model})`,
  )

  const notice = createUserMessage({
    content: `[Earlier conversation truncated to fit the hook evaluator's context window — ${dropped} earlier messages omitted. Evaluate the condition against the recent transcript below; if the required evidence may be in the omitted prefix, return {"ok": false, "reason": "insufficient evidence in transcript"}.]`,
  })
  return [notice, ...kept]
}
