import type { Message, UserMessage } from '../types/message.js'

// tool_result messages share type:'user' with human turns; the discriminant
// is the optional toolUseResult field. Four PRs (#23977, #24016, #24022,
// #24025) independently fixed miscounts from checking type==='user' alone.
/** densable R6e — user turn that is not meta and not a tool_result carrier. */
export function isHumanTurn(m: Message): m is UserMessage {
  return m.type === 'user' && !m.isMeta && m.toolUseResult === undefined
}

/**
 * densable Ite (inline) — origin absent/undefined/null or kind==='human'.
 * Kept local to avoid messagePredicates → sessionTitle → messages cycle.
 */
function isIteHumanOrigin(
  origin: { kind?: string } | null | undefined,
): boolean {
  return origin === undefined || origin === null || origin.kind === 'human'
}

/**
 * densable I7t — real human user for title/bridge derivation:
 * R6e && !isCompactSummary && Ite(origin).
 * Stricter than isHumanTurn (excludes compact summaries + non-human origins).
 */
export function isRealHumanUserMessage(m: Message): m is UserMessage {
  if (!isHumanTurn(m)) return false
  if ((m as { isCompactSummary?: boolean }).isCompactSummary) return false
  return isIteHumanOrigin(
    (m as { origin?: { kind?: string } | null }).origin,
  )
}

/**
 * densable v7c — human turn OR queued_command attachment with human origin.
 * Used where queue-origin human prompts count like keyboard turns.
 */
export function isHumanTurnOrQueuedHumanAttachment(m: Message): boolean {
  if (isHumanTurn(m)) return true
  if (m.type !== 'attachment') return false
  const att = (
    m as { attachment?: { type?: string; origin?: { kind?: string } } }
  ).attachment
  return att?.type === 'queued_command' && att.origin?.kind === 'human'
}

/**
 * densable E7c — normalize inbound origin to `{kind:'human'}` only when it is
 * already a human-kind object. If `skip` is true, returns undefined (bridge
 * paths that already resolved origin elsewhere). Non-objects / non-human
 * kinds collapse to undefined.
 */
export function normalizeHumanOriginOnly(
  origin: unknown,
  skip?: boolean,
): { kind: 'human' } | undefined {
  if (skip) return undefined
  if (
    typeof origin === 'object' &&
    origin !== null &&
    'kind' in origin &&
    (origin as { kind?: string }).kind === 'human'
  ) {
    return { kind: 'human' }
  }
  return undefined
}

/** densable Ace origin shape (open field on Message / QueuedCommand). */
export type SystemVisibleOriginLike = {
  kind?: string
  senderTaskId?: string
} | null | undefined

/**
 * densable Ace — origins that stay visible / countable / skip-slash even when
 * tagged isMeta (channel, observer, observer-activity, peer with senderTaskId).
 * Second arg (includeAllPeers): when true, bare peer origins also qualify.
 */
export function isSystemVisibleOrigin(
  origin: SystemVisibleOriginLike,
  includeAllPeers?: boolean,
): boolean {
  const includePeers =
    typeof includeAllPeers === 'boolean' ? includeAllPeers : false
  if (origin == null || typeof origin !== 'object') return false
  if (origin.kind === 'channel') return true
  if (origin.kind === 'observer') return true
  if (origin.kind === 'observer-activity') return true
  if (origin.kind === 'peer') {
    if (origin.senderTaskId !== undefined) return true
    if (includePeers) return true
  }
  return false
}
