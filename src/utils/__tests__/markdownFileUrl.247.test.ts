/**
 * densable 2.1.247 #29 — FE / d(a) + locked helpers (not changelog guesses).
 * Gold: gold-29-d-full.txt, gold-29-helper-*.txt
 *
 * Win32 SEA stubs: J() and Dtb() are `return !1`. /net is NOT a Txd/Fxd
 * predicate on this SEA.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { formatToken } from '../markdown.js'
import { sanitizeMarkdownHref, toSafeFileUrl } from '../markdownFileUrl.js'

const safeLocal = join(process.cwd(), 'README.md')

describe('densable 2.1.247 #29 FE / d(a)', () => {
  test('safe local path → file URL', () => {
    expect(toSafeFileUrl(safeLocal)).toBe(pathToFileURL(safeLocal).href)
  })

  test('network UNC // and \\\\ → null (Fxd / Txd)', () => {
    expect(toSafeFileUrl('//server/share/f')).toBeNull()
    expect(toSafeFileUrl('\\\\server\\share\\f')).toBeNull()
  })

  test('NT object \\??\\ → null (Fxd v)', () => {
    expect(toSafeFileUrl('\\??\\C:\\foo')).toBeNull()
  })

  test('control char in path → null (Etb / Zzd)', () => {
    expect(toSafeFileUrl(join(process.cwd(), 'x\x01y'))).toBeNull()
  })

  test('hostname !== "" after pathToFileURL → null', () => {
    const unc = '\\\\server\\share\\f'
    try {
      const href = pathToFileURL(unc).href
      expect(new URL(href).hostname !== '' || toSafeFileUrl(unc) === null).toBe(
        true,
      )
    } catch {
      expect(toSafeFileUrl(unc)).toBeNull()
    }
    expect(toSafeFileUrl(unc)).toBeNull()
  })

  test('win32 J/Dtb stubs do not invent /net automount reject', () => {
    const automount = '/net/host/file'
    expect(toSafeFileUrl(automount)).not.toBeNull()
  })
})

describe('densable 2.1.247 #29 markdown pt', () => {
  test('https scheme passes', () => {
    expect(sanitizeMarkdownHref('https://example.com/a')).toBe(
      'https://example.com/a',
    )
  })

  test('control char → null (Zzd / re)', () => {
    expect(sanitizeMarkdownHref('https://example.com/\x01x')).toBeNull()
  })

  test('leading invisible → null (Ee / Atb T)', () => {
    expect(sanitizeMarkdownHref('\u200Bhttps://example.com/a')).toBeNull()
  })

  test('trailing whitespace → null', () => {
    expect(sanitizeMarkdownHref('https://example.com/a ')).toBeNull()
  })

  test('network path href → null (Ctb / u)', () => {
    expect(sanitizeMarkdownHref('//server/share/f')).toBeNull()
  })

  test('safe file: href → file URL', () => {
    const fileHref = pathToFileURL(safeLocal).href
    expect(sanitizeMarkdownHref(fileHref)).toBe(fileHref)
  })

  test('formatToken: unsafe network href is plain text', () => {
    const rendered = formatToken(
      {
        type: 'link',
        raw: '[t](//server/share/f)',
        href: '//server/share/f',
        title: null,
        text: 't',
        tokens: [{ type: 'text', raw: 't', text: 't' }],
      } as never,
      'dark' as never,
    )
    expect(rendered).toBe('t')
    expect(rendered).not.toContain(']8;;')
  })

  test('formatToken: leading invisible href is plain text', () => {
    const rendered = formatToken(
      {
        type: 'link',
        raw: '[t](\u200Bhttps://example.com)',
        href: '\u200Bhttps://example.com',
        title: null,
        text: 't',
        tokens: [{ type: 'text', raw: 't', text: 't' }],
      } as never,
      'dark' as never,
    )
    expect(rendered).toBe('t')
  })
})
