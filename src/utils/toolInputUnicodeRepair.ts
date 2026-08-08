/**
 * densable 2.1.218 #3 — jYd / L6s / Cky / qYd / vky
 *
 * After JSON.parse of tool_use.input, Windows paths may still contain the
 * two-character sequence `\` + `u` + four hex digits (e.g. `C:\Users\u4e2d`).
 * A naive double-escaped-unicode repair turns those into CJK, breaking the path.
 * densable Cky short-circuits whole strings that look like drive/UNC paths.
 */

import { logEvent } from 'src/services/analytics/index.js'

/** densable qYd — non-global probe for surrogate-pair or BMP `\uXXXX`. */
export const UNICODE_ESCAPE_PROBE =
  /\\u([dD][89aAbB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})/

/** densable vky — global replace form of qYd. */
export const UNICODE_ESCAPE_GLOBAL = new RegExp(
  UNICODE_ESCAPE_PROBE.source,
  'g',
)

/**
 * densable Cky — drive path (`C:\` / `C:/`) or UNC-ish `\\server\` share start.
 * When matched, L6s leaves `\u…` path segments literal.
 */
export const WINDOWS_PATH_UNICODE_SKIP =
  /(?:^|[^A-Za-z])[A-Za-z]:[\\/]|(?:^|[\s"'=])\\\\[^\s\\/]+[\\/](?!\\)/

export type UnicodeRepairStats = {
  repairedStrings: number
  windowsPathSkips: number
}

/**
 * densable L6s — recursive unescape with Windows path skip.
 */
export function repairDoubleEscapedUnicodeDeep(
  value: unknown,
  stats: UnicodeRepairStats,
): unknown {
  if (typeof value === 'string') {
    if (!value.includes('\\u')) return value
    if (!UNICODE_ESCAPE_PROBE.test(value)) return value
    // Reset lastIndex after non-global .test (qYd has no g, but be safe if swapped)
    UNICODE_ESCAPE_PROBE.lastIndex = 0
    if (WINDOWS_PATH_UNICODE_SKIP.test(value)) {
      stats.windowsPathSkips++
      return value
    }
    const repaired = value.replace(
      UNICODE_ESCAPE_GLOBAL,
      (
        match,
        high: string | undefined,
        low: string | undefined,
        bmp: string | undefined,
        offset: number,
      ) => {
        // odd number of preceding backslashes => already escaped; keep match
        let l = offset
        while (l > 0 && value[l - 1] === '\\') l--
        if ((offset - l) & 1) return match
        // surrogate pair: \uD800-\uDBFF \uDC00-\uDFFF
        if (high !== undefined && low !== undefined) {
          return String.fromCharCode(parseInt(high, 16), parseInt(low, 16))
        }
        const c = parseInt(bmp as string, 16)
        // lone surrogate: keep literal (do not emit invalid UTF-16)
        if (c >= 55296 && c <= 57343) return match
        return String.fromCharCode(c)
      },
    )
    if (repaired !== value) stats.repairedStrings++
    return repaired
  }
  if (Array.isArray(value)) {
    return value.map(item => repairDoubleEscapedUnicodeDeep(item, stats))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = repairDoubleEscapedUnicodeDeep(v, stats)
    }
    return out
  }
  return value
}

/**
 * densable jYd — entry + telemetry.
 * Call after nested-string coerce (qPy) and before tool-specific normalizeToolInput (UYd).
 */
export function repairDoubleEscapedUnicode(value: unknown): unknown {
  const stats: UnicodeRepairStats = {
    repairedStrings: 0,
    windowsPathSkips: 0,
  }
  const repaired = repairDoubleEscapedUnicodeDeep(value, stats)
  if (stats.repairedStrings > 0 || stats.windowsPathSkips > 0) {
    logEvent('tengu_repair_double_escaped_unicode', {
      repaired_strings: stats.repairedStrings,
      windows_path_skips: stats.windowsPathSkips,
    })
  }
  return repaired
}
