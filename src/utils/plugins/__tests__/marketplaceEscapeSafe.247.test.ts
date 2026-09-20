/**
 * densable 2.1.247 #25 leftover — marketplace-supplied /plugin and
 * `claude plugin` output is escape-safe via official n0c / k + wrappers.
 * Name-schema regex/messages stay in marketplaceNameControl.247.test.ts.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import {
  At,
  Be,
  formatPluginCliLines,
  Io,
  Ot,
  re,
  Rt,
  sanitizeInvisibleText,
  se,
  UNPRINTABLE_PLUGIN_NAME,
  Ve,
  Vr,
  Wr,
} from '../escapeSafeText.js'

const FAMILY = '👨‍👩‍👧'

describe('marketplace escape-safe output 247 #25', () => {
  test('n0c/k strips ANSI and replaces Cc; 247 strips leading joiners', () => {
    expect(sanitizeInvisibleText('\x1b[31mRed\x1b[0m', ' ')).toBe('Red')
    expect(sanitizeInvisibleText('hi\u0007there', ' ')).toBe('hi there')
    expect(
      sanitizeInvisibleText('\u200Dhidden', ' ', { keepEmojiJoiners: true }),
    ).toBe('hidden')
    expect(sanitizeInvisibleText(FAMILY, ' ', { keepEmojiJoiners: true })).toBe(
      FAMILY,
    )
    expect(
      sanitizeInvisibleText('keep\nme\u0007ok', ' ', { keepNewlines: true }),
    ).toBe('keep\nme ok')
  })

  test('re/Io/At/U match official wrappers', () => {
    expect(re('\x1b[32mok\x1b[0m')).toBe('ok')
    expect(re(`hi\u0007${FAMILY}`)).toBe(`hi ${FAMILY}`)
    const osc = re('\x1b]8;;https://evil\x07name')
    expect(osc.includes('\u001b')).toBe(false)
    expect(osc.includes('\u0007')).toBe(false)
    expect(Io('line1\nline2\u0007x')).toBe('line1\nline2 x')
    expect(At('\u0007secret')).toBe('secret')
    expect(formatPluginCliLines(['a\u0007b', '\x1b[31mc'])).toBe('a b\nc')
  })

  test('se/Ve/Wr/Vr/Be/Ot lock official fallbacks', () => {
    expect(se(undefined)).toBeUndefined()
    expect(se('\u0007\u0007')).toBeUndefined()
    expect(se('  ok  ')).toBe('  ok  ')
    expect(Ve(undefined)).toBeUndefined()
    expect(Ve('https://example.com')).toBe('https://example.com')
    expect(Ve('javascript:alert(1)')).toBeUndefined()
    expect(Ve('not a url')).toBeUndefined()

    const sanitized = Wr({
      name: 'ok-plugin',
      version: '1.0.0\u0007',
      description: 'hello\n\u0007world',
      author: {
        name: 'Ann\u0007',
        email: 'a\u0007@b.c',
        url: 'https://example.com',
      },
      homepage: 'https://example.com',
      repository: 'http://git.example',
      license: 'MIT\u0007',
      keywords: ['one\u0007'],
    })
    expect(sanitized.version).toBe('1.0.0 ')
    expect(sanitized.description).toBe('hello\n world')
    expect(sanitized.author?.name).toBe('Ann ')
    expect(sanitized.keywords).toEqual(['one '])

    expect(Vr({ name: 'ok-plugin' })).toBe('ok-plugin')
    expect(Vr({ name: '\u0007\u0007' })).toBe(UNPRINTABLE_PLUGIN_NAME)
    expect(
      Vr({
        name: '\u0007',
        manifest: { displayName: 'Shown\u0007Name' },
        source: 'x',
      }),
    ).toBe('Shown Name')
    expect(Be('')).toBeUndefined()
    expect(Be(' x ')).toBe(' x ')
    expect(Ot({ manifest: { displayName: 'A' } })).toBe(true)
    expect(Ot({ name: 'x' })).toBe(false)
    expect(Rt('\u0007')).toBe('')
  })

  test('/plugin status lines wrap marketplace names with re()', () => {
    const root = join(import.meta.dir, '../../../commands/plugin')
    const browse = readFileSync(join(root, 'BrowseMarketplace.tsx'), 'utf8')
    const discover = readFileSync(join(root, 'DiscoverPlugins.tsx'), 'utf8')
    const manage = readFileSync(join(root, 'ManagePlugins.tsx'), 'utf8')
    const options = readFileSync(join(root, 'PluginOptionsFlow.tsx'), 'utf8')
    const add = readFileSync(join(root, 'AddMarketplace.tsx'), 'utf8')
    const ops = readFileSync(
      join(import.meta.dir, '../../../services/plugins/pluginOperations.ts'),
      'utf8',
    )
    expect(browse).toContain('re(plugin.name)')
    expect(discover).toContain('re(plugin.name)')
    expect(manage).toContain('re(selectedPlugin.plugin.name)')
    expect(manage).toContain('re(plugin.name)')
    expect(options).toContain('re(plugin.name)')
    expect(add).toContain(
      'setResult(re(`Successfully added marketplace: ${name}`))',
    )
    expect(discover).toContain(
      'setResult(re(`${result.message}${formatSingleInstallActivateSuffix(outcome)}`))',
    )
    expect(browse).toContain(
      'setResult(re(`${result.message}${formatSingleInstallActivateSuffix(outcome)}`))',
    )
    expect(manage).toContain(
      'setResult(re(`Plugin "${targetPlugin}" is not installed in this project`))',
    )
    expect(manage).toContain(
      'setResult(re(`${figures.tick} ${result.message}${suffix}`))',
    )
    expect(manage).toContain('reverseDependents.map(name => re(name))')
    expect(manage).toContain('setResult(re(msg))')
    expect(discover).toContain(
      'setResult(re(`${baseMsg}${formatSingleInstallActivateSuffix(outcome)}`))',
    )
    expect(browse).toContain(
      'setResult(re(`${baseMsg}${formatSingleInstallActivateSuffix(outcome)}`))',
    )
    expect(ops).toContain('re(failResult.pluginName)')
    expect(ops).toContain('re(pluginId)')
    const helpers = readFileSync(
      join(import.meta.dir, '../marketplaceHelpers.ts'),
      'utf8',
    )
    expect(helpers).toContain('re(f.name)')
    expect(helpers).toContain('re(reason)')
  })
})
