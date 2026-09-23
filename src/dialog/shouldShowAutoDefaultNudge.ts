/**
 * densable shouldShowAutoDefaultNudge — returns currentMode when REPL should
 * open auto_default_nudge, else null.
 *
 * Minimal contract (no invent GB/cloud gates): seen latch + auto product
 * surface (`isAutoModeAvailable`, kept in lockstep with TRANSCRIPT_CLASSIFIER
 * / verifyAutoModeGateAccess) + not already auto.
 */
import { isReplBridgeActive } from '../bootstrap/state.js'
import type { ToolPermissionContext } from '../Tool.js'
import { getGlobalConfig } from '../utils/config.js'

/**
 * densable `#r` / `f_` — `oc() || wt() || pie() !== void 0`.
 * `oc` is `n().surfaceCapabilities.replBridgeActive()`.
 * `wt` is `CLAUDE_CODE_SESSION_KIND==="bg"`. `pie` is `teammateAgentId()`.
 */
export function isUnattendedAutoDefaultNudgeSession(input: {
  sessionKind: string | undefined
  teammateAgentId: string | undefined
  replBridgeActive?: boolean
}): boolean {
  return (
    (input.replBridgeActive ?? isReplBridgeActive()) ||
    input.sessionKind === 'bg' ||
    input.teammateAgentId !== undefined
  )
}

export function shouldShowAutoDefaultNudge(
  ctx: ToolPermissionContext,
): string | null {
  if (getGlobalConfig().hasSeenAutoDefaultNudge) return null
  if (!ctx.isAutoModeAvailable) return null
  if (ctx.mode === 'auto') return null
  return ctx.mode
}
