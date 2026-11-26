import { isInSigcontResumeGrace } from '@anthropic/ink'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionRoot.js'
import { isWithinSigcontGraceWindow } from '../CustomSelect/use-select-input.js'

/**
 * #1622: Guard against keys typed right after prompt submission or before
 * a slow permission prompt settles.
 * #445 / #520: Esc is never guarded (callers must NOT call this for cancel/Esc),
 * while answers also respect the brief SIGCONT resume grace window.
 */

export const PERMISSION_SUBMIT_GUARD_MS = 500
export const PERMISSION_MOUNT_SETTLE_MS = 300

const submitGuardBySession = new RootSessionSlot<{
  lastSubmitTimestamp: number
}>(() => ({ lastSubmitTimestamp: 0 }))

function getSubmitGuardState(): { lastSubmitTimestamp: number } {
  return submitGuardBySession.of(getBootstrapSession())
}

export function recordPromptSubmitTime(now = Date.now()): void {
  getSubmitGuardState().lastSubmitTimestamp = now
}

export function getLastPromptSubmitTime(): number {
  return getSubmitGuardState().lastSubmitTimestamp
}

export function resetPromptSubmitTimeForTests(): void {
  getSubmitGuardState().lastSubmitTimestamp = 0
}

export function isWithinPermissionKeyGuard(
  mountedAt: number,
  now = Date.now(),
  submitGuardMs = PERMISSION_SUBMIT_GUARD_MS,
  mountSettleMs = PERMISSION_MOUNT_SETTLE_MS,
): boolean {
  const { lastSubmitTimestamp } = getSubmitGuardState()
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
