/**
 * Official residual UI / TUI env gates (portable pure helpers).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

/**
 * Official agent-view disable densable — env CLAUDE_CODE_DISABLE_AGENT_VIEW
 * OR settings.disableAgentView.
 */
export function isAgentViewDisabled(
  env: NodeJS.ProcessEnv = process.env,
  settingsDisableAgentView?: boolean,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_AGENT_VIEW)) return true
  return settingsDisableAgentView === true
}

/**
 * Official oUn densable — human-readable agent-view disable reason, or null.
 */
export function getAgentViewDisabledReason(
  env: NodeJS.ProcessEnv = process.env,
  settingsDisableAgentView?: boolean,
): string | null {
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_AGENT_VIEW)) {
    return 'is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW'
  }
  if (settingsDisableAgentView === true) {
    return "is disabled by the 'disableAgentView' setting"
  }
  return null
}

export function isAlternateScreenDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN)
}

export function isWorkingSyncDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_WORKING_SYNC)
}

/**
 * Official OQ_ — env CLAUDE_CODE_ENABLE_MENU_KIND_LANES OR GB tengu_mint_lanes.
 */
export function isMenuKindLanesEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_ENABLE_MENU_KIND_LANES)) return true
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_mint_lanes', false)
}

/**
 * Official MQ_ — source lane tag for slash-menu when lanes enabled.
 * project | org | undefined (user/builtin omit).
 */
export function resolveCommandSourceTag(
  source: string | undefined,
): 'project' | 'org' | undefined {
  switch (source) {
    case 'projectSettings':
    case 'localSettings':
      return 'project'
    case 'plugin':
    case 'policySettings':
    case 'managed':
      return 'org'
    default:
      return undefined
  }
}

/**
 * Official J4p — suggestion kind lane: prompt → skill, else action.
 */
export function resolveCommandKindLane(
  cmd: { type?: string } | undefined,
): 'skill' | 'action' {
  if (cmd?.type === 'prompt') return 'skill'
  return 'action'
}

export function isForceFullscreenUpsellEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL)
}

/** Official LogoV2 — force full logo (skip condensed) when truthy. */
export function isForceFullLogoEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_FULL_LOGO)
}

/**
 * Official QueryEngine densable — eager session-storage flush when
 * CLAUDE_CODE_EAGER_FLUSH or CLAUDE_CODE_IS_COWORK is truthy.
 */
export function isEagerFlushEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_EAGER_FLUSH) ||
    isEnvTruthy(env.CLAUDE_CODE_IS_COWORK)
  )
}

export function isForceSyncOutputEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_SYNC_OUTPUT)
}

export function getForceTipId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_FORCE_TIP_ID?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function isNotificationPresenceCheckDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK)
}

/** Official Ayn — user considered present if last interaction within 60s. */
export const DEFAULT_NOTIFICATION_PRESENCE_MS = 60_000

/**
 * Official V8o densable pure — whether the user is "present" for push
 * suppression. Optional override (tests/GB) wins; else lastInteractionAgeMs
 * under threshold. Does not read bootstrap state — pass the age in.
 */
export function isUserPresentForNotification(input?: {
  /** When set, short-circuits (official fht/q8o override). */
  override?: boolean
  lastInteractionAgeMs?: number
  thresholdMs?: number
}): boolean {
  if (input?.override !== undefined) return input.override
  const age = input?.lastInteractionAgeMs
  if (age === undefined || !Number.isFinite(age)) return false
  const threshold = input?.thresholdMs ?? DEFAULT_NOTIFICATION_PRESENCE_MS
  return age < threshold
}

/**
 * Official PushNotification densable gate:
 * when not remote and presence check is enabled and user is present → suppress.
 */
export function shouldSuppressPushForUserPresence(input?: {
  env?: NodeJS.ProcessEnv
  isRemote?: boolean
  override?: boolean
  lastInteractionAgeMs?: number
  thresholdMs?: number
}): boolean {
  if (input?.isRemote) return false
  if (isNotificationPresenceCheckDisabled(input?.env)) return false
  return isUserPresentForNotification({
    override: input?.override,
    lastInteractionAgeMs: input?.lastInteractionAgeMs,
    thresholdMs: input?.thresholdMs,
  })
}

/** Comma-separated allowlist of terminal MCP tool names, if set. */
export function getTerminalMcpTools(
  env: NodeJS.ProcessEnv = process.env,
): string[] | null {
  const raw = env.CLAUDE_CODE_TERMINAL_MCP_TOOLS
  if (raw === undefined) return null
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Official `bes` densable — Set of terminal MCP tool names from env.
 * Empty when unset/blank (callers treat empty as "feature off").
 */
export function getTerminalMcpToolSet(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const list = getTerminalMcpTools(env)
  return new Set(list ?? [])
}

type TerminalMcpMessageLike = {
  type?: string
  isMeta?: boolean
  message?: {
    content?: unknown
  }
}

/**
 * Official `C1u` densable — walk messages newest-first; when the latest
 * non-meta user turn is pure tool_results and a successful result maps to a
 * terminal-MCP tool_use, return true (thinking-only nudge should skip).
 */
export function messagesEndWithSuccessfulTerminalMcpTool(
  messages: readonly TerminalMcpMessageLike[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const terminal = getTerminalMcpToolSet(env)
  if (terminal.size === 0) return false
  const okIds = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.type === 'user') {
      if (m.isMeta) continue
      const content = m.message?.content
      if (!Array.isArray(content)) return false
      let sawResult = false
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as {
          type?: string
          is_error?: boolean
          tool_use_id?: string
        }
        if (b.type === 'tool_result') {
          sawResult = true
          if (!b.is_error && typeof b.tool_use_id === 'string') {
            okIds.add(b.tool_use_id)
          }
        }
      }
      if (!sawResult) return false
    } else if (m.type === 'assistant') {
      const content = m.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as { type?: string; id?: string; name?: string }
        if (
          b.type === 'tool_use' &&
          typeof b.id === 'string' &&
          okIds.has(b.id) &&
          typeof b.name === 'string' &&
          terminal.has(b.name)
        ) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Official `NIs` densable — extract `input.text` from assistant tool_use
 * blocks whose name is in TERMINAL_MCP_TOOLS (bg classifier text surface).
 */
export function extractTerminalMcpToolTexts(
  message: TerminalMcpMessageLike | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const content = message?.message?.content
  if (!Array.isArray(content)) return ''
  const terminal = getTerminalMcpToolSet(env)
  if (terminal.size === 0) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      const b = block as {
        type?: string
        name?: string
        input?: { text?: unknown }
      }
      if (
        b.type !== 'tool_use' ||
        typeof b.name !== 'string' ||
        !terminal.has(b.name)
      ) {
        return ''
      }
      return typeof b.input?.text === 'string' ? b.input.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

export type QuestionPreviewFormat = 'markdown' | 'html'

/**
 * Official densable — CLAUDE_CODE_QUESTION_PREVIEW_FORMAT when markdown|html.
 * Invalid/missing → undefined (caller applies client-type default).
 */
export function resolveQuestionPreviewFormat(
  env: NodeJS.ProcessEnv = process.env,
): QuestionPreviewFormat | undefined {
  const raw = env.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT
  if (raw === 'markdown' || raw === 'html') return raw
  return undefined
}

/**
 * Official qpg densable — CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS positive int
 * or undefined (caller falls through to GB / default 25000).
 */
export function resolveFileReadMaxOutputTokens(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const override = env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS
  if (!override) return undefined
  const parsed = parseInt(override, 10)
  if (!Number.isNaN(parsed) && parsed > 0) return parsed
  return undefined
}

/**
 * Official Nzt densable — SYNTAX_HIGHLIGHT env falsy disables color-diff.
 * Returns 'env' when disabled, null when available.
 */
export function getSyntaxHighlightUnavailableReason(
  env: NodeJS.ProcessEnv = process.env,
): 'env' | null {
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

/**
 * Official wog densable core — CLAUDE_CODE_SCROLL_SPEED parse, clamp (0, 20].
 * Invalid/≤0/absent → defaultBase.
 *
 * Official F3i auto defaultBase is 3 when not wheelFlood (else 1); jediTerm
 * uses 2. Callers that want the official auto base pass it in (see
 * resolveWheelProfile / readScrollSpeedBase). Bare default stays 1 for
 * backward-compatible call sites.
 */
export function resolveScrollSpeedBase(
  env: NodeJS.ProcessEnv = process.env,
  defaultBase = 1,
): number {
  const raw = env.CLAUDE_CODE_SCROLL_SPEED
  if (!raw) return defaultBase
  const n = parseFloat(raw)
  if (Number.isNaN(n) || n <= 0) return defaultBase
  return Math.min(n, 20)
}

/**
 * densable tIu — MCP _meta requests end-of-turn via claude/endTurn.
 */
export function mcpMetaHasEndTurn(
  mcpMeta:
    | {
        _meta?: Record<string, unknown>
      }
    | null
    | undefined,
): boolean {
  return mcpMeta?._meta?.['claude/endTurn'] === true
}

/** densable HNg — frozen MCP meta tombstone for end-turn in subagent path. */
export const MCP_END_TURN_META = Object.freeze({
  _meta: Object.freeze({ ['claude/endTurn']: true as const }),
})

/**
 * densable mts — when agentId is set, only pass through end-turn mcpMeta
 * (as frozen HNg); otherwise pass full meta. Main-thread keeps full mcpMeta.
 */
export function mcpMetaForToolResultMessage(
  agentId: string | undefined,
  mcpMeta:
    | {
        _meta?: Record<string, unknown>
        structuredContent?: Record<string, unknown>
      }
    | undefined,
):
  | {
      _meta?: Record<string, unknown>
      structuredContent?: Record<string, unknown>
    }
  | undefined {
  if (!agentId) return mcpMeta
  return mcpMetaHasEndTurn(mcpMeta) ? MCP_END_TURN_META : undefined
}

export type ToolEndTurnSource = 'tool' | 'mcp_meta'

/**
 * densable fts — if a user tool_result message requests end-of-turn and has
 * no is_error tool_result block, return source (`tool` via toolEndsTurn, or
 * `mcp_meta` via claude/endTurn); else false.
 */
export function endTurnSourceFromUserMessage(message: {
  type?: string
  toolEndsTurn?: boolean
  mcpMeta?: {
    _meta?: Record<string, unknown>
  }
  message?: {
    content?: unknown
  }
}): ToolEndTurnSource | false {
  if (message.type !== 'user') return false
  const source: ToolEndTurnSource | false = message.toolEndsTurn
    ? 'tool'
    : mcpMetaHasEndTurn(message.mcpMeta)
      ? 'mcp_meta'
      : false
  if (!source) return false
  const content = message.message?.content
  if (
    Array.isArray(content) &&
    content.some(
      block =>
        !!block &&
        typeof block === 'object' &&
        (block as { type?: string; is_error?: boolean }).type ===
          'tool_result' &&
        (block as { is_error?: boolean }).is_error === true,
    )
  ) {
    return false
  }
  return source
}

/**
 * First end-turn source among messages (densable ze accumulation).
 */
export function endTurnSourceFromMessages(
  messages: readonly {
    type?: string
    toolEndsTurn?: boolean
    mcpMeta?: { _meta?: Record<string, unknown> }
    message?: { content?: unknown }
  }[],
): ToolEndTurnSource | false {
  let found: ToolEndTurnSource | false = false
  for (const m of messages) {
    const s = endTurnSourceFromUserMessage(m)
    if (s) found = s
  }
  return found
}
