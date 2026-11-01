/**
 * densable 2.1.289 inbound `D7` @202257989 / `NGn` — stdin/bridge user JSON stamps.
 *
 * This `D7` parses `file_attachments` off the user frame. Gold
 * `function D7(` @187578359 is a path sanitizer — do not bind that offset.
 * `NGn` parses `turn_id` only when the caller already classified a relay human.
 * Never export densable ids.
 */

const TURN_ID_MAX = 128
const TURN_ID = /^[\x21-\x7e]+$/

export type InboundFileAttachment = {
  file_uuid: string
  file_name: string
  is_image?: boolean | null
  sha256?: string | null
  file_size?: number | null
}

function parseAttachment(value: unknown): InboundFileAttachment | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const rec = value as Record<string, unknown>
  if (typeof rec.file_uuid !== 'string' || typeof rec.file_name !== 'string') {
    return undefined
  }
  const parsed: InboundFileAttachment = {
    file_uuid: rec.file_uuid,
    file_name: rec.file_name,
  }
  if (rec.is_image !== undefined) {
    parsed.is_image = typeof rec.is_image === 'boolean' ? rec.is_image : null
  }
  if (rec.sha256 !== undefined) {
    parsed.sha256 = typeof rec.sha256 === 'string' ? rec.sha256 : null
  }
  if (rec.file_size !== undefined) {
    parsed.file_size = typeof rec.file_size === 'number' ? rec.file_size : null
  }
  return parsed
}

/** densable `D7`. Missing/non-array `file_attachments` → `[]`. */
export function parseInboundFileAttachments(
  frame: unknown,
): InboundFileAttachment[] {
  if (typeof frame !== 'object' || frame === null) return []
  if (!('file_attachments' in frame)) return []
  const list = (frame as { file_attachments?: unknown }).file_attachments
  if (!Array.isArray(list)) return []
  return list.flatMap(item => {
    const parsed = parseAttachment(item)
    return parsed ? [parsed] : []
  })
}

/**
 * densable `NGn`. `isRelayHuman===false` → undefined. turn_id must be
 * non-empty printable ASCII, length ≤ 128.
 */
export function parseInboundCcrTurnId(
  frame: unknown,
  { isRelayHuman }: { isRelayHuman: boolean },
): string | undefined {
  if (!isRelayHuman) return undefined
  if (typeof frame !== 'object' || frame === null) return undefined
  if (!('turn_id' in frame)) return undefined
  const turnId = (frame as { turn_id?: unknown }).turn_id
  if (
    typeof turnId !== 'string' ||
    turnId === '' ||
    turnId.length > TURN_ID_MAX ||
    !TURN_ID.test(turnId)
  ) {
    return undefined
  }
  return turnId
}

/**
 * densable `cBn` — Slack/projects/ccr stamps for a relay human.
 * Synthetic relay humans omit verifiedSlack/projects flags.
 */
export function relayHumanIdentityStamps({
  isRelayHuman,
  isSynthetic,
  ccrTurnId,
  isProjectsUser = false,
}: {
  isRelayHuman: boolean
  isSynthetic?: boolean
  ccrTurnId?: string
  isProjectsUser?: boolean
}): {
  verifiedSlackHumanTurn?: true
  projectsUserTurn?: true
  ccrTurnId?: string
} {
  if (!isRelayHuman) return {}
  return {
    ...(!isSynthetic && { verifiedSlackHumanTurn: true as const }),
    ...(!isSynthetic && isProjectsUser && { projectsUserTurn: true as const }),
    ...(ccrTurnId !== undefined && { ccrTurnId }),
  }
}
