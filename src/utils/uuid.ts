import { randomBytes, type UUID } from 'crypto'
import type { AgentId } from 'src/types/ids.js'

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate uuid
 * @param maybeUUID The value to be checked if it is a uuid
 * @returns string as UUID or null if it is not valid
 */
export function validateUuid(maybeUuid: unknown): UUID | null {
  // UUID format: 8-4-4-4-12 hex digits
  if (typeof maybeUuid !== 'string') return null

  return uuidRegex.test(maybeUuid) ? (maybeUuid as UUID) : null
}

/** densable `r` / `o` — label already `[\w-]{1,63}`. */
const AGENT_ID_LABEL_OK = /^[\w-]{1,63}$/

/**
 * densable `Lg` — `a{label-}{16 hex}` or `a{16 hex}`.
 * If the label fails `[\w-]{1,63}`, strip non-word/hyphen then slice 63.
 * Hyphens stay (`fix-the-flaky` is already ok). Empty label → unlabeled.
 */
export function createAgentId(label?: string): AgentId {
  let tag = label
  if (tag && !AGENT_ID_LABEL_OK.test(tag)) {
    tag = tag.replace(/[^\w-]/g, '').slice(0, 63)
  }
  const suffix = randomBytes(8).toString('hex')
  return (tag ? `a${tag}-${suffix}` : `a${suffix}`) as AgentId
}
