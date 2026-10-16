import { toAgentId } from 'src/types/ids.js'

export const TEAM_LEAD_NAME = 'team-lead'
/**
 * densable D6 — reserved SendMessage recipient for the main conversation.
 * Teammate/agent display names must not claim this (see pzg / registerName).
 */
export const MAIN_RECIPIENT_NAME = 'main'
/** densable REe — reserved spawn `name` (any spelling after Dr). */
export const USER_RECIPIENT_NAME = 'user'
/** densable aet — reserved spawn `name` (any spelling after Dr). */
export const SYSTEM_RECIPIENT_NAME = 'system'
/**
 * densable B4f — Agent `name` schema: letter/digit start, then
 * letters/digits/_/- up to 64 chars total.
 */
export const AGENT_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * densable `Dr` — NFKC, drop Cc/Cf (keep whitespace), trim, lower, spaces→`-`.
 */
export function normalizeSpawnAgentName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ch => (/\s/.test(ch) ? ch : ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/**
 * densable `uO` — spawn `name` is reserved (main / team-lead / user / system
 * in any spelling) or already an agent-id shape (`OA`).
 */
export function isReservedSpawnAgentName(name: string): boolean {
  const n = normalizeSpawnAgentName(name)
  return (
    n === MAIN_RECIPIENT_NAME ||
    n === TEAM_LEAD_NAME ||
    n === USER_RECIPIENT_NAME ||
    n === SYSTEM_RECIPIENT_NAME ||
    toAgentId(n) !== null
  )
}
export const SWARM_SESSION_NAME = 'claude-swarm'
export const SWARM_VIEW_WINDOW_NAME = 'swarm-view'
export const TMUX_COMMAND = 'tmux'
export const HIDDEN_SESSION_NAME = 'claude-hidden'

/**
 * Gets the socket name for external swarm sessions (when user is not in tmux).
 * Uses a separate socket to isolate swarm operations from user's tmux sessions.
 * Includes PID to ensure multiple Claude instances don't conflict.
 */
export function getSwarmSocketName(): string {
  return `claude-swarm-${process.pid}`
}

/**
 * Environment variable to override the command used to spawn teammate instances.
 * If not set, defaults to process.execPath (the current Claude binary).
 * This allows customization for different environments or testing.
 */
export const TEAMMATE_COMMAND_ENV_VAR = 'CLAUDE_CODE_TEAMMATE_COMMAND'

/**
 * Environment variable set on spawned teammates to indicate their assigned color.
 * Used for colored output and pane identification.
 */
export const TEAMMATE_COLOR_ENV_VAR = 'CLAUDE_CODE_AGENT_COLOR'

/**
 * Environment variable set on spawned teammates to require plan mode before implementation.
 * When set to 'true', teammates must enter plan mode and get approval before writing code.
 */
export const PLAN_MODE_REQUIRED_ENV_VAR = 'CLAUDE_CODE_PLAN_MODE_REQUIRED'
