/**
 * densable 2.1.235 #1 — spellcheck.color validation (edE / SLe / Wdp).
 */

import type { Color } from '@anthropic/ink'

const ANSI_COLOR_NAMES = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
])

/** densable uhg — default misspell color is theme error key. */
export const DEFAULT_SPELLCHECK_COLOR = 'error' as const

/** densable SLe / phg — accept rgb / #hex / ansi256(n) / ansi:<name>. */
export function isValidSpellcheckColorValue(value: string): boolean {
  if (typeof value !== 'string') return false
  if (/^rgb\(\s?\d{1,3},\s?\d{1,3},\s?\d{1,3}\s?\)$/.test(value)) return true
  if (/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value)) {
    return true
  }
  if (/^ansi256\(\d{1,3}\)$/.test(value)) return true
  if (value.startsWith('ansi:')) return ANSI_COLOR_NAMES.has(value.slice(5))
  return false
}

/**
 * densable edE — normalize user color string.
 * Bare terminal names (`red`) are accepted via `ansi:red`.
 * Invalid → theme error key (`error`).
 */
export function normalizeSpellcheckColor(
  value: string | undefined,
): typeof DEFAULT_SPELLCHECK_COLOR | Color {
  if (value === undefined) return DEFAULT_SPELLCHECK_COLOR
  const trimmed = value.trim().replace(/\s+(?=[^()]*\))/g, '')
  const ansiPrefixed = `ansi:${trimmed}` as Color
  if (isValidSpellcheckColorValue(ansiPrefixed)) return ansiPrefixed
  if (isValidSpellcheckColorValue(trimmed)) return trimmed as Color
  // Caller may also log; keep densable edE message available via return sentinel.
  return DEFAULT_SPELLCHECK_COLOR
}
