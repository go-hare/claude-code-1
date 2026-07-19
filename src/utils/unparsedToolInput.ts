/**
 * densable e5t / uTt / mm / UEe — marker object for tool_use inputs whose
 * streamed JSON failed to parse. normalizeContentFromAPI stores the raw
 * prefix; toolExecution short-circuits with errorCode JSON_PARSE.
 */

/** densable e5t */
export const UNPARSED_TOOL_INPUT_KEY = '__unparsedToolInput' as const

export type UnparsedToolInputPayload = {
  /** densable mm(raw, 2048) — truncated raw bytes for steers / debug */
  raw: string
  /** original input string length (pre-truncate) */
  len: number
}

export type UnparsedToolInputMarker = {
  [UNPARSED_TOOL_INPUT_KEY]: UnparsedToolInputPayload
}

/**
 * densable mm — truncate string to maxLen code units without splitting a
 * high surrogate at the cut point.
 */
export function truncateUtf16Safe(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value
  const sliced = value.slice(0, maxLen)
  const last = sliced.charCodeAt(maxLen - 1)
  // high surrogate (U+D800–U+DBFF) at end would orphan the pair
  if (last >= 0xd800 && last <= 0xdbff) {
    return sliced.slice(0, -1)
  }
  return sliced
}

/** densable marker producer: { [e5t]: { raw: mm(input,2048), len } } */
export function makeUnparsedToolInput(
  rawInput: string,
): UnparsedToolInputMarker {
  return {
    [UNPARSED_TOOL_INPUT_KEY]: {
      raw: truncateUtf16Safe(rawInput, 2048),
      len: rawInput.length,
    },
  }
}

/**
 * densable uTt — true only for a plain object with exactly one own entry:
 * __unparsedToolInput → { raw: string, len: number }.
 */
export function isUnparsedToolInput(
  value: unknown,
): value is UnparsedToolInputMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const entries = Object.entries(value)
  if (entries.length !== 1) return false
  const [key, payload] = entries[0]!
  return (
    key === UNPARSED_TOOL_INPUT_KEY &&
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as UnparsedToolInputPayload).raw === 'string' &&
    typeof (payload as UnparsedToolInputPayload).len === 'number'
  )
}

/** densable UEe — short label for UI / diagnostics when input is unparsed. */
export function unparsedToolInputLabel(value: unknown): string | null {
  if (!isUnparsedToolInput(value)) return null
  const { len } = value[UNPARSED_TOOL_INPUT_KEY]
  return `input JSON failed to parse — ${len} bytes`
}

/**
 * densable steer template used when toolExecution short-circuits JSON_PARSE.
 * Shows first ≤200 chars of the raw prefix.
 */
export function formatUnparsedToolInputError(
  toolName: string,
  marker: UnparsedToolInputMarker,
): string {
  const { raw, len } = marker[UNPARSED_TOOL_INPUT_KEY]
  const preview = truncateUtf16Safe(raw, 200)
  return (
    `${toolName} was called with input that could not be parsed as JSON. ` +
    `You sent (first ${preview.length} of ${len} bytes): ${preview} ` +
    `Common causes: unescaped backslashes in file paths (use / or \\\\), ` +
    `unescaped control characters, or truncated output. Retry with valid JSON.`
  )
}
