/**
 * densable FPw / Kkl / bPw / kPw / TPw — auto-reply act gates (2.1.239).
 */
import { un } from './store.js'

/** densable uPw — default hourly auto-turn cap. */
export const HOURLY_AUTO_TURN_CAP = 60
/** densable yPw / _Pw — GB override clamp. */
export const HOURLY_CAP_MIN = 1
export const HOURLY_CAP_MAX = 600
/** densable kPw — consecutive pipeline denials before pause. */
export const PIPELINE_DENIAL_CAP = 3
/** densable TPw — consecutive autos before breaker. */
export const CONSECUTIVE_AUTO_BREAKER = 3
/** densable sbr — fixed fast-ack copy. */
export const FAST_ACK_TEXT =
  "I'm on it. I'll reply here once I've taken a look."
/** densable oCl — tip suffix when notifying for manual Artifact reply. */
export const MANUAL_REPLY_HINT =
  ' Once you have finished acting on the thread, post a brief reply saying what you did — first check the thread; if a Claude reply answering it already stands, do NOT post another — and resolve the thread when done.'

/** densable bPw */
export function maxAutoTurnsPerHour(): number {
  const o = un().autoReact.maxAutoTurnsOverride
  if (o !== null && o > 0) {
    return Math.min(Math.max(o, HOURLY_CAP_MIN), HOURLY_CAP_MAX)
  }
  return HOURLY_AUTO_TURN_CAP
}

/**
 * densable FPw — keep timestamps in last hour; true if under cap.
 */
export function underHourlyAutoCap(
  turnTimestamps: number[],
  nowMs: number,
): { ok: boolean; timestamps: number[] } {
  const filtered = turnTimestamps.filter(t => nowMs - t < 3_600_000)
  return { ok: filtered.length < maxAutoTurnsPerHour(), timestamps: filtered }
}

export type GateNoticeKind = 'cap' | 'plan' | 'notify_only' | 'pipeline'

/** densable Kkl / vam summary. */
export function formatGateSummary(artifactName: string): string {
  return artifactName || 'artifact'
}

/** densable Kkl */
export function formatGateNotice(
  trigger: 'comment' | 'activation',
  kind: GateNoticeKind,
  url: string,
  artifactName: string,
): { summary: string; detail: string } {
  const summary = formatGateSummary(artifactName)
  const lead =
    trigger === 'activation'
      ? `You were activated on a comment thread of artifact ${url} that has existing comments`
      : `Human comments sent to Claude are waiting on activated threads of artifact ${url}`
  switch (kind) {
    case 'cap':
      return {
        summary,
        detail: `${lead} — auto-reply held back (hourly cap); use the Artifact tool to read and reply.${MANUAL_REPLY_HINT}`,
      }
    case 'plan':
      return {
        summary,
        detail: `${lead} — auto-reply is paused while in plan mode; use the Artifact tool to read and reply.`,
      }
    case 'notify_only':
      return {
        summary,
        detail: `${lead}. Auto-reply is notify-only in this permission mode — read and reply with the Artifact tool when ready (further comments will not repeat this notice).${MANUAL_REPLY_HINT}`,
      }
    case 'pipeline':
      return {
        summary,
        detail: `Automatic replies or edits on artifact ${url} are being blocked by a permission hook or content gate, or repeatedly refused by the session's configuration — recent attempts were refused or dropped after composing. Affected threads are paused; a successful auto-reply anywhere on this artifact resumes them.`,
      }
  }
}

export type PermissionModeLike =
  | 'plan'
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'auto'
  | 'dontAsk'
  | string

export type ReplyPermissionVerdict = 'allow' | 'deny' | 'ask'

/**
 * densable probe empty reply — tip maps canUseTool / mode to verdict.
 * allow → auto-post; ask → notify_only; deny → declined.
 */
export function verdictFromPermissionMode(
  mode: PermissionModeLike | undefined,
): ReplyPermissionVerdict {
  if (mode === 'plan') return 'ask' // plan handled separately; treat as no auto
  if (
    mode === 'bypassPermissions' ||
    mode === 'acceptEdits' ||
    mode === 'auto'
  ) {
    return 'allow'
  }
  // dontAsk: never auto-post. Outer tool pipeline maps ask→deny; this
  // scanner path does not go through hasPermissionsToUseTool.
  if (mode === 'dontAsk') return 'deny'
  // default / unknown → ask (notify-only) unless host overrides checkReplyPermission
  return 'ask'
}
