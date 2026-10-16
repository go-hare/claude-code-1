/**
 * densable Ijn / bc / Jr / sIr — hosted comment-thread capability gate
 * (2.1.289). Gold @194249769 / @210847643.
 *
 * Gold Jr/Ijn gate on dH() = Nt() = launchOptions.diskless(). Tip has no
 * diskless() getter (KEEP). Jr/Ijn use isAnthropicHostedRemoteSession —
 * the hosted session where page-owned threads apply. Not named dH.
 */
import type { PermissionDenyDecision } from '../../../types/permissions.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isAnthropicHostedRemoteSession } from '../frameRelay.js'
import { yt } from './provenance.js'

/** densable Rc @210847694 */
export const PAGE_THREADS_UNREAD =
  "could not read whether this page keeps its own comment threads, so nothing was posted or resolved \u2014 try once more; if it fails again, tell the user they can do it on the artifact's own page"

/** densable Jr @210847643 */
export function Jr(): { readBack: true } | undefined {
  return isAnthropicHostedRemoteSession() ? { readBack: true } : undefined
}

/** densable sIr @194205838 — these roles do not write page-owned threads. */
export function sIr(role: string | undefined): boolean {
  return role === 'reader' || role === 'viewer' || role === 'commenter'
}

/**
 * densable Ijn @194249769 — hosted session could not read whether the page
 * keeps its own comment threads.
 */
export function Ijn(slug: string): boolean {
  if (!isAnthropicHostedRemoteSession()) return false
  const status = yt(slug)
  if (sIr(status?.role)) return false
  return (
    status?.lastCapsReadAt === undefined || status.capabilitiesUnknown === true
  )
}

/** densable bc @210847894 */
export function bc(action: 'reply' | 'resolve'): PermissionDenyDecision {
  logForDebugging(`[artifact] artifact_comment_${action} page_threads_unread`)
  return {
    behavior: 'deny',
    message: PAGE_THREADS_UNREAD,
    decisionReason: {
      type: 'other',
      reason: "the page's declaration could not be read",
    },
  }
}
