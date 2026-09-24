/**
 * densable shouldShowAutoDefaultNudge — returns currentMode when REPL should
 * open auto_default_nudge, else null.
 *
 * Minimal contract (no invent GB/cloud gates): seen latch + auto product
 * surface (`isAutoModeAvailable`, kept in lockstep with TRANSCRIPT_CLASSIFIER
 * / verifyAutoModeGateAccess) + not already auto.
 *
 * 2.1.251 #42 unattended gate is gold `oc` / `wt` / `pie` / `f_`.
 */
import type { ToolPermissionContext } from '../Tool.js'
import { getGlobalConfig } from '../utils/config.js'
import { getBootstrapSession } from '../utils/sessionRoot.js'

/**
 * densable `oc` @179077773 sha=`aecdf37202398f48`
 * `function oc(){return n().surfaceCapabilities.replBridgeActive()}`
 */
export function oc(): boolean {
  return getBootstrapSession().surfaceCapabilities.replBridgeActive()
}

/**
 * densable `wt` @181075144 sha=`829b48cc05768f45`
 * `function wt(){return C2()==="bg"}` — C2 is CLAUDE_CODE_SESSION_KIND.
 */
export function wt(): boolean {
  return process.env.CLAUDE_CODE_SESSION_KIND === 'bg'
}

/**
 * densable `pie` @179065859 sha=`49a2d1eeb577cf11`
 * `function pie(){return n().host.extensionsConfig.teammateAgentId()}`
 */
export function pie(): unknown {
  return getBootstrapSession().host.extensionsConfig.teammateAgentId()
}

/**
 * densable `f_` @181075177 sha=`75721126dac5149a`
 * `function f_(){return oc()||wt()||pie()!==void 0}`
 */
export function f_(): boolean {
  return oc() || wt() || pie() !== undefined
}

export function shouldShowAutoDefaultNudge(
  ctx: ToolPermissionContext,
): string | null {
  if (getGlobalConfig().hasSeenAutoDefaultNudge) return null
  if (!ctx.isAutoModeAvailable) return null
  if (ctx.mode === 'auto') return null
  return ctx.mode
}
