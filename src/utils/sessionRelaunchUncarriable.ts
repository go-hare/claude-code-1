/**
 * densable 2.1.248 shared W4e + GC(#w) refuse for session relaunch surfaces.
 *
 * Official call sites:
 * - /update Mhr `g=(e)=>{let r=wU(he(t),GC());...}` @192086231
 * - gateway le `m=wU(c,GC())` @205714430
 * - /tui already wires the same pair via getTuiRelaunchRefuseMessage
 *
 * #w only — do not substitute Yk / restrictedSession (#l).
 */

import type { ToolPermissionContext } from '../types/permissions.js'
import { getForkRestrictedLaunchConfig } from './forkReplayLaunchConfig.js'
import { getTuiUncarriableReasons } from './tuiRelaunchCarry.js'

export type RelaunchPermissionCtx = Pick<
  ToolPermissionContext,
  | 'alwaysAllowRules'
  | 'alwaysDenyRules'
  | 'alwaysAskRules'
  | 'additionalWorkingDirectories'
>

/**
 * official wU(ctx, GC()) — empty ⇒ carryable.
 */
export function getSessionRelaunchUncarriableReasons(
  ctx: RelaunchPermissionCtx,
  forkRestricted: boolean = getForkRestrictedLaunchConfig(),
): string[] {
  return getTuiUncarriableReasons(ctx, forkRestricted)
}

/**
 * official /update uncarriable copy (Mhr `g`).
 */
export function formatUpdateUncarriableRefuseMessage(
  reasons: readonly string[],
  opts: {
    sessionPersistenceDisabled?: boolean
    commentMonitor?: boolean
  } = {},
): string {
  const continueHint = opts.sessionPersistenceDisabled
    ? ''
    : ' (add --continue to return to this conversation)'
  const monitorHint = opts.commentMonitor
    ? ' Exiting also stops the auto-replies to artifact comments until the next publish.'
    : ''
  return `Can't switch to the new version from inside this session — it has restrictions a restart can't carry over (${reasons.join('; ')}). Nothing was changed; exit and start claude again for the new version${continueHint}.${monitorHint}`
}

/**
 * official le refuse: `this session has restrictions a restart can't carry over (...)`
 */
export function formatGatewayRelaunchUncarriableRefuseMessage(
  reasons: readonly string[],
): string {
  return `this session has restrictions a restart can't carry over (${reasons.join('; ')})`
}
