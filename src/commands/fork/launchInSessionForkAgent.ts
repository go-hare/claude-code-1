/**
 * densable 2.1.212 `xZr` equivalent for gwd/subtask slash paths.
 *
 * densable returns structured `{ agentId, name }` after launching a full-context
 * background agent (`N7` + `G5e`). Local product path uses AgentTool async
 * launch (`run_in_background: true`, omit `subagent_type` when fork gate is on)
 * and normalizes the tool result to the same shape so toast code can do:
 *   `${FORK_GLYPH} forked ${name} (${agentId.slice(-4)})`
 *
 * On preflight/launch miss densable returns `null` (callers emit coordinator /
 * first-turn errors). This helper returns `null` when agentId cannot be read.
 */
import { AgentTool } from '@claude-code/builtin-tools/tools/AgentTool/AgentTool.js'
import { logForDebugging } from '../../utils/debug.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import type { Message } from '../../types/message.js'

export type InSessionForkLaunchResult = {
  agentId: string
  name: string
}

/**
 * densable `pwd` — first 3 tokens, lowercased, ≤24, fallback `"fork"`.
 */
export function deriveInSessionForkName(prompt: string): string {
  return (
    prompt
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'fork'
  )
}

/** densable description = collapsed prompt, 50 chars with ellipsis. */
export function deriveInSessionForkDescription(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim()
  return oneLine.length > 50 ? `${oneLine.slice(0, 49)}…` : oneLine
}

/**
 * densable `xZr(directive, context, canUseTool)` → `{agentId, name} | null`.
 *
 * Caller owns usage/coordinator/fork-child/first-turn guards (i$y / s$y).
 * This only launches and returns the structured result densable toasts on.
 */
export async function launchInSessionForkAgent(
  directive: string,
  context: LocalJSXCommandContext,
  lastAssistantMessage: Message,
): Promise<InSessionForkLaunchResult | null> {
  const name = deriveInSessionForkName(directive)
  const input = {
    prompt: directive,
    run_in_background: true,
    description: deriveInSessionForkDescription(directive),
    name,
  }

  const canUseTool = context.canUseTool
  if (!canUseTool) {
    logForDebugging('In-session fork: canUseTool missing', { level: 'error' })
    return null
  }

  const result = await AgentTool.call(
    input as never,
    context,
    canUseTool,
    lastAssistantMessage as never,
  )

  const agentId = extractAgentIdFromToolResult(result)
  if (!agentId) {
    logForDebugging(
      `In-session fork: AgentTool returned no agentId (name=${name})`,
      { level: 'error' },
    )
    return null
  }

  // densable always pairs pwd name with nM agentId when non-null.
  return { agentId, name }
}

/**
 * AgentTool async path returns `{ data: { status: 'async_launched', agentId } }`.
 * Accept a few nested shapes so tests / mid-refactor streams still resolve.
 */
export function extractAgentIdFromToolResult(
  result: unknown,
): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const rec = result as Record<string, unknown>

  const direct = pickAgentId(rec)
  if (direct) return direct

  const data = rec.data
  if (data && typeof data === 'object') {
    const fromData = pickAgentId(data as Record<string, unknown>)
    if (fromData) return fromData
  }

  // Async-iterable / progress-yield fallback (not densable primary path).
  return undefined
}

function pickAgentId(rec: Record<string, unknown>): string | undefined {
  // Prefer explicit agentId — densable nM / AgentTool async_launched.
  for (const key of ['agentId', 'agent_id'] as const) {
    const v = rec[key]
    if (typeof v === 'string' && v.length >= 4) return v
  }
  return undefined
}
