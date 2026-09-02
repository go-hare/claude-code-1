/**
 * densable plan+bypass inherit: only when this session *entered* plan from
 * bypassPermissions (prePlanMode), not when bypass is merely listable
 * (Shift+Tab / ACP availableModes).
 *
 * `isBypassPermissionsModeAvailable` stays true so the cycle can reach
 * bypass; 2a / sandbox / MCP elevated / peer class must not treat that
 * as "already in bypass".
 */
import type { PermissionMode } from '../../types/permissions.js'

export type PlanBypassSnap = {
  mode: PermissionMode
  prePlanMode?: PermissionMode
}

/** Plan inherited from `--dangerously-skip-permissions` / bypass mode. */
export function isPlanActingAsBypass(snap: PlanBypassSnap): boolean {
  return snap.mode === 'plan' && snap.prePlanMode === 'bypassPermissions'
}

/** Session class is bypass (live bypass, or plan inherited from it). */
export function isSessionBypassClass(snap: PlanBypassSnap): boolean {
  return snap.mode === 'bypassPermissions' || isPlanActingAsBypass(snap)
}
