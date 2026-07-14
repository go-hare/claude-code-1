/**
 * Official WYn / Nbg — CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS clamp.
 *
 * When the main agent can auto-background a long-running command, the
 * effective timeout may be lowered by this env so the command can be
 * backgrounded sooner. Floor is 2000ms (official Nbg).
 */

export const AUTO_BACKGROUND_TIMEOUT_FLOOR_MS = 2000

/**
 * Official WYn pure body.
 * Only applies when isMainAgent && canAutoBackground.
 * Invalid/non-positive env values leave requestedTimeoutMs unchanged.
 */
export function clampTimeoutForAutoBackground(input: {
  requestedTimeoutMs: number | undefined
  isMainAgent: boolean
  canAutoBackground: boolean
  env?: NodeJS.ProcessEnv
  floorMs?: number
}): number | undefined {
  const requested = input.requestedTimeoutMs
  if (!input.isMainAgent || !input.canAutoBackground) return requested
  if (requested === undefined) return requested

  const env = input.env ?? process.env
  const raw = env.CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS
  if (!raw) return requested
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return requested
  const floor = input.floorMs ?? AUTO_BACKGROUND_TIMEOUT_FLOOR_MS
  return Math.min(requested, Math.max(parsed, floor))
}

/**
 * Resolve agent auto-background delay (getAutoBackgroundMs portable).
 * env CLAUDE_AUTO_BACKGROUND_TASKS / CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS
 * or GB tengu_auto_background_agents → default 120_000; else 0 (disabled).
 */
export function resolveAgentAutoBackgroundMs(input?: {
  env?: NodeJS.ProcessEnv
  gbEnabled?: boolean
  defaultMs?: number
}): number {
  const env = input?.env ?? process.env
  const truthy = (v: string | undefined): boolean => {
    if (!v) return false
    const n = v.toLowerCase().trim()
    return n === '1' || n === 'true' || n === 'yes' || n === 'on'
  }
  const enabled =
    truthy(env.CLAUDE_AUTO_BACKGROUND_TASKS) ||
    truthy(env.CLAUDE_CODE_AUTO_BACKGROUND_TASKS) ||
    input?.gbEnabled === true
  if (!enabled) return 0
  // Prefer explicit timeout env when set and positive.
  const raw = env.CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS
  if (raw) {
    const parsed = parseInt(raw, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.max(parsed, AUTO_BACKGROUND_TIMEOUT_FLOOR_MS)
    }
  }
  return input?.defaultMs ?? 120_000
}
