import { safeParseJSON, stripMarkdownJsonFence } from '../utils/json.js'

/**
 * Parse model-emitted structured JSON.
 *
 * densable: strip outer fence (eee) first, then parse with shouldLogError=false
 * (Ol(eee(e), !1)) so speculative model text never logError as SyntaxError.
 * Mid-string fence / prose+object fall back to balanced `{…}` extract.
 */
export function parseStructuredJSONObject(
  text: string,
): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  // densable eee path first — silent on failure (model output is speculative).
  const stripped = stripMarkdownJsonFence(trimmed)
  const parsed =
    safeParseJSON(stripped, false) ??
    (stripped !== trimmed ? safeParseJSON(trimmed, false) : null) ??
    safeParseJSON(extractJsonFromFencedBlock(trimmed), false) ??
    safeParseJSON(extractBalancedJsonObject(trimmed), false)

  return parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : null
}

function extractJsonFromFencedBlock(text: string): string | null {
  // densable eee only peels outer fence; keep mid-string ```json … ``` extract
  // as fork fallback for models that wrap JSON mid-prose.
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return match?.[1]?.trim() || null
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  return text.slice(start, end + 1)
}
