/**
 * densable 2.1.234 #34 — incomplete session-list disclosure copy.
 *
 * SEA symbols:
 * - Gff — success-path suffix when searchTruncated
 * - wWr — not-found / ambiguous body suffix when searchTruncated
 * - iza — short Note: fragment ("your session list was too long…")
 * - CSf — ListAgents listing note when listTruncated
 *
 * Peel: docs/upstream-extraction/v2.1.234/_peel_34_*.txt
 */

/** densable Gff — append after successful SendMessage when search was truncated */
export const SESSION_LIST_SEARCH_TRUNCATED_SUCCESS_SUFFIX =
  '; your session list was too long to check completely, so a same-named session beyond what was searched would not have been seen'

/**
 * densable wWr — leading newline + sentence appended to not-found / ambiguous
 * model messages when searchTruncated.
 */
export const SESSION_LIST_SEARCH_TRUNCATED_BODY =
  '\nYour session list was too long to check completely, so a session by that name may exist beyond what was searched.'

/** densable iza — short phrase for display Note: lines */
export const SESSION_LIST_SEARCH_TRUNCATED_SHORT =
  'your session list was too long to check completely'

/**
 * densable CSf — ListAgents / formatForModel listing note when listTruncated.
 * Uses em dash (U+2014) matching SEA.
 */
export const SESSION_LIST_TRUNCATED_LISTING_NOTE =
  '(session list too long to fetch completely — sessions beyond the first pages are missing from this listing)'

/** densable cloudListFailed listing note (model path aKv / vWa) */
export const CLOUD_SESSION_LIST_FAILED_LISTING_NOTE =
  '(cloud session list could not be fetched just now — cloud sessions are missing from this listing; a later listing retries)'

/** densable bridgeWalkFailed + rows present note (aKv) */
export const ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE =
  '(account session list incomplete just now — those rows carry no [ref] and are not messageable by name until a later listing completes)'

/** densable v_i / S_i fragment for success path */
export function appendSearchTruncatedSuccessSuffix(
  message: string,
  searchTruncated: boolean | undefined,
): string {
  if (!searchTruncated) return message
  return `${message}${SESSION_LIST_SEARCH_TRUNCATED_SUCCESS_SUFFIX}`
}

/** densable not-found / ambiguous body append */
export function appendSearchTruncatedBody(
  message: string,
  searchTruncated: boolean | undefined,
): string {
  if (!searchTruncated) return message
  return `${message}${SESSION_LIST_SEARCH_TRUNCATED_BODY}`
}

/** densable display Note: `${iza} — it may exist beyond what was searched.` */
export function searchTruncatedDisplayNote(
  searchTruncated: boolean | undefined,
): string {
  if (!searchTruncated) return ''
  return ` Note: ${SESSION_LIST_SEARCH_TRUNCATED_SHORT} — it may exist beyond what was searched.`
}

/**
 * densable aKv / vWa trailing notes block for ListAgents listing.
 * Returns lines (without leading indent); caller joins.
 */
export function listAgentsIncompleteNotes(opts: {
  listTruncated?: boolean
  cloudListFailed?: boolean
  bridgeWalkIncomplete?: boolean
}): string[] {
  const notes: string[] = []
  if (opts.bridgeWalkIncomplete) {
    notes.push(ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE)
  }
  if (opts.cloudListFailed) {
    notes.push(CLOUD_SESSION_LIST_FAILED_LISTING_NOTE)
  }
  if (opts.listTruncated) {
    notes.push(SESSION_LIST_TRUNCATED_LISTING_NOTE)
  }
  return notes
}
