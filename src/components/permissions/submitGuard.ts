import { isInSigcontResumeGrace } from '@anthropic/ink'
import { isWithinSigcontGraceWindow } from '../CustomSelect/use-select-input.js'

/**
 * #1622: Guard against keys typed right after prompt submission or before
 * a slow permission prompt settles.
 * #445 / #520: Esc is never guarded (callers must NOT call this for cancel/Esc),
 * while answers also respect the brief SIGCONT resume grace window.
 */

export const PERMISSION_SUBMIT_GUARD_MS = 500
export const PERMISSION_MOUNT_SETTLE_MS = 300

let lastSubmitTimestamp = 0

export function recordPromptSubmitTime(now = Date.now()): void {
  lastSubmitTimestamp = now
}

export function getLastPromptSubmitTime(): number {
  return lastSubmitTimestamp
}

export function resetPromptSubmitTimeForTests(): void {
  lastSubmitTimestamp = 0
}

export function isWithinPermissionKeyGuard(
  mountedAt: number,
  now = Date.now(),
  submitGuardMs = PERMISSION_SUBMIT_GUARD_MS,
  mountSettleMs = PERMISSION_MOUNT_SETTLE_MS,
): boolean {
  if (lastSubmitTimestamp > 0 && now - lastSubmitTimestamp < submitGuardMs) {
    return true
  }
  if (mountedAt > 0 && now - mountedAt < mountSettleMs) {
    return true
  }
  if (isWithinSigcontGraceWindow(now) || isInSigcontResumeGrace(() => now)) {
    return true
  }
  return false
}
