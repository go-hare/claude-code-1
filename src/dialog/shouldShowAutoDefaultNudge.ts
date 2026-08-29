/**
 * densable shouldShowAutoDefaultNudge — returns currentMode when REPL should
 * open auto_default_nudge, else null.
 *
 * Minimal contract (no invent GB/cloud gates): seen latch + auto product
 * surface (`isAutoModeAvailable`, kept in lockstep with TRANSCRIPT_CLASSIFIER
 * / verifyAutoModeGateAccess) + not already auto.
 */
import type { ToolPermissionContext } from '../Tool.js'
import { getGlobalConfig } from '../utils/config.js'

export function shouldShowAutoDefaultNudge(
  ctx: ToolPermissionContext,
): string | null {
  if (getGlobalConfig().hasSeenAutoDefaultNudge) return null
  if (!ctx.isAutoModeAvailable) return null
  if (ctx.mode === 'auto') return null
  return ctx.mode
}
