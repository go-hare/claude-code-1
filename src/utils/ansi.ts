/**
 * Local strip-ansi re-export for densable residual callers (footerLinks etc.).
 * Prefer this over a direct `strip-ansi` import so tree-shaking / mock sites
 * stay consistent.
 */
import stripAnsiDefault from 'strip-ansi'

/** Strip ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  return stripAnsiDefault(text)
}

export default stripAnsi
