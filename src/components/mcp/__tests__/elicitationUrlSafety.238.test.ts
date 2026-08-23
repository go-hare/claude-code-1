/**
 * densable 2.1.238 #11 WBc — URL elicitation one-click / exact-show / overflow.
 * Gold is NOT `url.length > 4096 → ''`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  BROWSER_READY_MAX,
  URL_EXTENDS_PAST_SCREEN,
  URL_NOT_EXACT,
  URL_TOO_LONG_FOR_BROWSER,
  URL_WITHHELD_MARKER,
  browserReadyLength,
  canOneClickOpen,
  hrefForOpen,
  isExactShowableUrl,
  knockAcceptIfUnsafe,
  toggleAcceptDecline,
  urlOverflowsScreen,
  urlPromptWarning,
} from '../elicitationUrlSafety.js'

const SRC_DIR = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.238 #11 WBc R2g / y2 / PCr', () => {
  test('R2g = length + 3*meta + 4*quote + backslash + 16', () => {
    expect(browserReadyLength('https://ex.com')).toBe(
      'https://ex.com'.length + 16,
    )
    // `(` is a shell meta; `"` is both meta (kqE) and quote
    expect(browserReadyLength('(')).toBe(1 + 3 + 16)
    expect(browserReadyLength('"')).toBe(1 + 3 + 4 + 16)
    expect(browserReadyLength('\\')).toBe(1 + 1 + 16)
  })

  test('A2g is 8000 (not 4096)', () => {
    expect(BROWSER_READY_MAX).toBe(8000)
  })

  test('URL length 4096 is not a blanking cap', () => {
    const url = `https://example.com/${'a'.repeat(4096 - 'https://example.com/'.length)}`
    expect(url.length).toBe(4096)
    const href = hrefForOpen(url)
    expect(isExactShowableUrl(url, href)).toBe(true)
    expect(canOneClickOpen(href, true)).toBe(true)
    expect(href).not.toBe('')
  })

  test('y2 requires exact AND R2g(href) <= A2g', () => {
    const short = 'https://example.com/ok'
    expect(canOneClickOpen(short, true)).toBe(true)
    expect(canOneClickOpen(short, false)).toBe(false)

    const long = `https://example.com/${'a'.repeat(8000)}`
    expect(browserReadyLength(long)).toBeGreaterThan(BROWSER_READY_MAX)
    expect(canOneClickOpen(long, true)).toBe(false)
  })

  test('hidden / newline / tab withhold exact-show (KCt-lite)', () => {
    const raw = 'https://example.com/a\nb'
    expect(isExactShowableUrl(raw, hrefForOpen(raw))).toBe(false)
    expect(canOneClickOpen(hrefForOpen(raw), false)).toBe(false)

    const tab = 'https://example.com/\tok'
    expect(isExactShowableUrl(tab, tab)).toBe(false)
  })

  test('PCr: width<20 or rows-12<1 overflows; a short URL on a large screen does not', () => {
    expect(urlOverflowsScreen('https://ex.com', 10, 40)).toBe(true)
    expect(urlOverflowsScreen('https://ex.com', 80, 10)).toBe(true)
    expect(urlOverflowsScreen('https://ex.com', 80, 40)).toBe(false)
  })

  test('PCr: space-free URL longer than columns-6 hard-wraps and overflows 80×40', () => {
    // wrapWidth=74, lineBudget=28 → need >28 lines → >2072 chars
    const url = `https://example.com/${'a'.repeat(2100)}`
    expect(urlOverflowsScreen(url, 80, 40)).toBe(true)
    expect(urlOverflowsScreen('https://ex.com', 80, 40)).toBe(false)
  })

  test('warning strings are SEA-exact', () => {
    expect(urlPromptWarning(true, false, false)).toBe(URL_TOO_LONG_FOR_BROWSER)
    expect(URL_TOO_LONG_FOR_BROWSER).toContain('’')
    expect(urlPromptWarning(false, false, false)).toBe(URL_NOT_EXACT)
    expect(urlPromptWarning(true, true, true)).toBe(URL_EXTENDS_PAST_SCREEN)
    expect(urlPromptWarning(true, true, false)).toBeNull()
  })

  test('IqE knocks accept→decline; other focus stays', () => {
    expect(knockAcceptIfUnsafe('accept')).toBe('decline')
    expect(knockAcceptIfUnsafe('decline')).toBe('decline')
    expect(knockAcceptIfUnsafe('open')).toBe('open')
  })

  test('PqE toggles accept↔decline', () => {
    expect(toggleAcceptDecline('accept')).toBe('decline')
    expect(toggleAcceptDecline('decline')).toBe('accept')
  })

  test('Ufr prefers URL.href; invalid input is returned as-is', () => {
    expect(hrefForOpen('https://example.com/a b')).toBe(
      new URL('https://example.com/a b').href,
    )
    expect(hrefForOpen('not a url')).toBe('not a url')
  })

  test('dialog source gold: Accept gated on oneClick; STREAM-style 4096 blank absent', () => {
    const dialog = readFileSync(
      join(SRC_DIR, '..', 'ElicitationDialog.tsx'),
      'utf8',
    )
    expect(dialog).toContain('if (!oneClick)')
    expect(dialog).toContain('{oneClick && (')
    expect(dialog).toContain('URL_WITHHELD_MARKER')
    expect(dialog).not.toMatch(/url\.length\s*>\s*4096/)
    expect(URL_WITHHELD_MARKER).toContain('approval withheld')
  })
})
