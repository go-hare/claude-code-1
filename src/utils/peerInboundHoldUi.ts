/**
 * densable 2.1.224 #5 — interactive hold surface pure helpers.
 *
 * SEA: axv / T5l / neh / cxv·lxv (via crossSessionInbound) / Rdr·vg_ / toast copy.
 * UI host (sya toast + gGn dialog) lives in usePeerInboundUdsDrain + PeerInboundApprovalDialog.
 */

import type {
  HeldPeerInboundMessage,
  PeerInboundHoldCause,
  PeerInboundReleaseReason,
} from './crossSessionInbound.js'
import {
  peerInboundHoldCauseMessage,
  peerInboundReleaseReasonMessage,
} from './crossSessionInbound.js'
import { dialogExpiryToMs } from './settings/settings.js'

export const UNIDENTIFIED_PEER_SESSION = 'an unidentified session'

export type PeerInboundHoldPreview = {
  address: string
  verifiedPeerPid: number | undefined
  claimedName: string
  /** Short toast preview (first line, ≤120 + expand hint). */
  preview: string
  /** Dialog body (up to 8 lines × 240). */
  dialogBody: string
  truncated: boolean
}

/**
 * densable T5l — strip pairing/quote punctuation so peer-supplied text
 * cannot spoof terminal chrome. Dash-like chars collapse to ASCII hyphen.
 */
export function sanitizePeerDisplayText(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[\p{Ps}\p{Pe}\p{Pi}\p{Pf}"'−]/gu, '')
    .replace(/\p{Pd}/gu, t => (t === '-' ? '-' : '-'))
}

function truncateChars(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max)
}

function plural(n: number, unit: string): string {
  return n === 1 ? unit : `${unit}s`
}

/**
 * densable axv — build address / preview / dialogBody from a held command.
 */
export function buildPeerInboundHoldPreview(
  message: unknown,
): PeerInboundHoldPreview {
  const cmd =
    message && typeof message === 'object'
      ? (message as {
          origin?: {
            kind?: string
            from?: string
            name?: string
            verifiedPeerPid?: number
            body?: string
          }
          value?: unknown
        })
      : undefined
  const origin =
    cmd?.origin?.kind === 'peer'
      ? cmd.origin
      : (undefined as
          | {
              from?: string
              name?: string
              verifiedPeerPid?: number
              body?: string
            }
          | undefined)

  const rawFrom = typeof origin?.from === 'string' ? origin.from : ''
  const address =
    rawFrom.length > 0 && rawFrom !== 'unknown'
      ? sanitizePeerDisplayText(rawFrom)
      : UNIDENTIFIED_PEER_SESSION

  const pid = origin?.verifiedPeerPid
  const verifiedPeerPid =
    typeof pid === 'number' && Number.isInteger(pid) && pid > 0
      ? pid
      : undefined

  const claimedName =
    typeof origin?.name === 'string' && origin.name.length > 0
      ? sanitizePeerDisplayText(origin.name)
      : ''

  let body = ''
  if (typeof origin?.body === 'string') {
    body = origin.body
  } else if (typeof cmd?.value === 'string') {
    body = cmd.value
  } else if (Array.isArray(cmd?.value) && cmd.value.length > 0) {
    body = `Unpreviewable content: ${cmd.value.length} ${plural(cmd.value.length, 'block')}, ~${JSON.stringify(cmd.value).length} chars. The FULL content is delivered on approve`
  }

  const lines = (body.length > 0 ? body.split('\n') : []).map(l =>
    sanitizePeerDisplayText(l),
  )
  const lineCount = lines.length
  const charCount = body.length
  const first = lineCount > 0 ? (lines[0] ?? '') : ''
  const firstTrunc = truncateChars(first, 120)
  const toastTruncated = lineCount > 1 || firstTrunc !== first
  const preview =
    firstTrunc +
    (toastTruncated
      ? ` …[${lineCount} ${plural(lineCount, 'line')}, ${charCount} chars total — expand to review before approving]`
      : '')

  const dialogLines = lines.slice(0, 8).map(l => truncateChars(l, 240))
  const dialogTruncated =
    lineCount > 8 || dialogLines.some((l, i) => l !== lines[i])
  const dialogBody =
    dialogLines.join('\n') +
    (dialogTruncated
      ? `\n…[${lineCount} ${plural(lineCount, 'line')}, ${charCount} chars total — full body will be delivered on approve]`
      : '')

  return {
    address,
    verifiedPeerPid,
    claimedName,
    preview,
    dialogBody,
    truncated: toastTruncated || dialogTruncated,
  }
}

/**
 * densable neh — hold-cause copy shown inside the approval dialog.
 */
export function peerInboundDialogCauseMessage(
  cause: PeerInboundHoldCause,
): string {
  switch (cause) {
    case 'mode-mismatch':
      return "The sending session's permission mode class doesn't match this session's, so it wasn't delivered automatically."
    case 'no-mode-asserted':
      return 'The sender did not attest its permission mode, and this session bypasses permission prompts.'
    case 'explicit-setting':
      return 'Your "crossSessionInbound" setting is "hold".'
    case 'bypass-default':
      return 'This session is not prompting for permissions.'
    case 'mode-unknown':
      return "This session's permission mode could not be determined."
  }
}

/**
 * densable toast on hold (sya → ll(..., "warning")).
 */
export function buildHeldPeerMessageToast(
  entry: HeldPeerInboundMessage,
  heldCount: number,
  cause: PeerInboundHoldCause,
): string {
  const d = buildPeerInboundHoldPreview(entry.message)
  const nameBit = d.claimedName ? ` (peer claims name: ${d.claimedName})` : ''
  const pidBit = d.verifiedPeerPid ? ` [verified pid ${d.verifiedPeerPid}]` : ''
  const previewBit = d.preview ? `; preview: «${d.preview}»` : ''
  return `Held peer message — from ${d.address}${pidBit}${nameBit}${previewBit} — not delivered to Claude (${heldCount} held). ${peerInboundHoldCauseMessage(cause)}`
}

/**
 * densable toast on release (IRn).
 */
export function buildReleasedPeerMessagesToast(
  count: number,
  reason: PeerInboundReleaseReason | string,
): string {
  return `Released ${count} held cross-session ${plural(count, 'message')} to Claude's queue (${peerInboundReleaseReasonMessage(reason)}).`
}

/**
 * densable Rdr — dialog timeout ms for hold approval.
 * env CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS (positive) wins via dialogExpiryToMs;
 * setting `never` → 0 (no timer); unset → 5m default via getDialogExpiry.
 */
export function resolvePeerInboundDialogTimeoutMs(): number {
  return dialogExpiryToMs() ?? 0
}

/** densable: only mode-mismatch / no-mode-asserted open the approval dialog. */
export function shouldPromptPeerInboundApproval(
  cause: PeerInboundHoldCause,
): boolean {
  return cause === 'mode-mismatch' || cause === 'no-mode-asserted'
}
