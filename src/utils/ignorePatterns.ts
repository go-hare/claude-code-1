/**
 * Official 2.1.207: bad gitignore-style patterns (bracket globs etc.) must not
 * throw when building `ignore()` matchers — filter them out, warn once, and
 * treat as matching nothing.
 */
import ignore from 'ignore'
import memoize from 'lodash-es/memoize.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'

export type IgnorePatternSite =
  | 'claudemd_rule_globs'
  | 'skill_paths'
  | 'file_suggestions_ignore'
  | 'worktreeinclude'

/** Split ignore-file content into non-empty lines (official BGn). */
export function splitIgnoreFileLines(content: string): string[] {
  return content.split(/\r?\n/).filter(Boolean)
}

/**
 * Probe whether a single pattern compiles under `ignore`. Returns null when
 * OK, or the error message when the pattern is empty/whitespace or when
 * `ignore().add([pattern])` throws.
 *
 * Note: ignore@7 often accepts historically-bad globs at `.add()` time; we
 * still drop empty patterns (they match nothing useful and used to throw on
 * older ignore versions / path checks).
 */
export const probeIgnorePatternCompileError = memoize(
  (pattern: string): string | null => {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      return 'empty pattern'
    }
    try {
      ignore().add([pattern]).test('probe')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },
)

const warnUncompilableIgnorePattern = memoize(
  (site: IgnorePatternSite, pattern: string): void => {
    const detail = probeIgnorePatternCompileError(pattern) ?? 'unknown'
    logForDebugging(
      `[${site}] gitignore-style pattern failed to compile (${detail}); treating it as matching nothing: ${pattern}`,
      { level: 'warn' },
    )
    logEvent('tengu_uncompilable_ignore_pattern', {
      site: site as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  },
  (site, pattern) => `${site}\0${pattern}`,
)

/**
 * Official `zet`: keep only patterns that compile; drop bad ones after a
 * once-per-(site,pattern) warning.
 */
export function filterCompilableIgnorePatterns(
  patterns: readonly string[],
  site: IgnorePatternSite,
): string[] {
  return patterns.filter(pattern => {
    if (probeIgnorePatternCompileError(pattern) === null) return true
    warnUncompilableIgnorePattern(site, pattern)
    return false
  })
}
