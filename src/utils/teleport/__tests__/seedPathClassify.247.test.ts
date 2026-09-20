/**
 * densable 2.1.247 — `_465` le/be/Yi forged/alias listing (eYn/hs).
 */
import { describe, expect, test } from 'bun:test'
import { getPlatform } from '../../platform.js'
import { sanitizeSeedDisplay, truncateSeedDisplay } from '../seedDisplay.js'
import { isSeedCredentialPath } from '../seedCredentialPath.js'
import {
  classifySeedListing,
  formatSeedListingRefuse,
  isLegacyBundleEnabled,
  seedPathHasWindowsAdsOrTrailingDot,
  seedPathIsWindows83Alias,
  seedPathListingOk,
  seedPathSegmentsOk,
  shouldRunSeedListingGate,
} from '../seedPathClassify.js'
import { parseDiffTreeZ } from '../seedWipInspect.js'

describe('densable seed listing le/be/Yi', () => {
  test('Qe rejects empty / . / .. segments', () => {
    expect(seedPathSegmentsOk('src/foo.ts')).toBe(true)
    expect(seedPathSegmentsOk('src/../foo.ts')).toBe(false)
    expect(seedPathSegmentsOk('src/./foo.ts')).toBe(false)
    expect(seedPathSegmentsOk('/abs/foo.ts')).toBe(false)
  })

  test('Yi marks .. hop as forged', () => {
    expect(
      classifySeedListing({
        staged: [{ path: 'src/../secret' }],
        working: [],
      }),
    ).toEqual([{ path: 'src/../secret', why: 'forged' }])
  })

  test('plain relative path is not refused', () => {
    expect(
      classifySeedListing({
        staged: [{ path: 'src/foo.ts' }],
        working: [{ path: 'src/foo.ts' }],
      }),
    ).toEqual([])
  })

  test('win/wsl ADS colon and trailing-dot', () => {
    const win = getPlatform() === 'windows' || getPlatform() === 'wsl'
    expect(seedPathHasWindowsAdsOrTrailingDot('file:stream')).toBe(win)
    expect(seedPathHasWindowsAdsOrTrailingDot('foo.')).toBe(win)
    expect(seedPathListingOk('file:stream')).toBe(!win)
  })

  test('win/wsl 8.3 alias', () => {
    const win = getPlatform() === 'windows' || getPlatform() === 'wsl'
    expect(seedPathIsWindows83Alias('FILE~1.TXT')).toBe(win)
    expect(
      classifySeedListing({
        staged: [{ path: 'FILE~1.TXT' }],
        working: [],
      }),
    ).toEqual(win ? [{ path: 'FILE~1.TXT', why: 'alias' }] : [])
  })

  test('SXo forged message', () => {
    const msg = formatSeedListingRefuse([{ path: 'src/../x', why: 'forged' }])
    expect(msg).toContain('git itself never writes')
    expect(msg).toContain('src/../x')
  })

  test('SXo alias message', () => {
    const msg = formatSeedListingRefuse([{ path: 'FILE~1.TXT', why: 'alias' }])
    expect(msg).toContain('8.3 short names')
    expect(msg).toContain('FILE~1.TXT')
  })

  test('TCt i: explicit harden on; false off; default not windows && !gXo', () => {
    expect(shouldRunSeedListingGate(true)).toBe(true)
    expect(shouldRunSeedListingGate(false)).toBe(false)
    expect(shouldRunSeedListingGate(undefined)).toBe(
      getPlatform() !== 'windows' && !isLegacyBundleEnabled(),
    )
  })

  test('gXo CLAUDE_CODE_LEGACY_BUNDLE === true only', () => {
    expect(isLegacyBundleEnabled({ CLAUDE_CODE_LEGACY_BUNDLE: 'true' })).toBe(
      true,
    )
    expect(isLegacyBundleEnabled({ CLAUDE_CODE_LEGACY_BUNDLE: '1' })).toBe(true)
    expect(isLegacyBundleEnabled({ CLAUDE_CODE_LEGACY_BUNDLE: 'yes' })).toBe(
      false,
    )
  })

  test('$l maps Cc/Cf to space; bp appends char count', () => {
    expect(sanitizeSeedDisplay('a\u0001b')).toBe('a b')
    expect(truncateSeedDisplay('hi', 10)).toBe('hi')
    expect(truncateSeedDisplay('abcdefghij', 4)).toBe('abcd… [+6 chars]')
  })

  test('sn leaves out .env / .ssh and keeps .env.example', () => {
    expect(isSeedCredentialPath('.env')).toBe(true)
    expect(isSeedCredentialPath('.ssh/id_rsa')).toBe(true)
    expect(isSeedCredentialPath('.env.example')).toBe(false)
    expect(isSeedCredentialPath('src/foo.ts')).toBe(false)
  })

  test('SXo credential leftover names added/changed/resurrected', () => {
    const msg = formatSeedListingRefuse([
      { path: '.env', why: 'added' },
      { path: '.ssh/id_rsa', why: 'changed' },
    ])
    expect(msg).toContain('named like credentials or keys')
    expect(msg).toContain('added to git')
    expect(msg).toContain('differs from what is committed')
    expect(msg).toContain('Then retry.')
  })

  test('ze parses NUL diff-tree pairs', () => {
    const meta =
      ':100644 100644 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 M'
    const parsed = parseDiffTreeZ(`${meta}\0src/foo.ts\0`)
    expect(parsed).toEqual([
      {
        path: 'src/foo.ts',
        oldMode: '100644',
        newMode: '100644',
        oldId: '0000000000000000000000000000000000000000',
        newId: '1111111111111111111111111111111111111111',
        status: 'M',
      },
    ])
  })

  test('gitBundle host wires listing gate + uncommitted_credentials', async () => {
    const src = await Bun.file(
      new URL('../gitBundle.ts', import.meta.url),
    ).text()
    expect(src).toContain('shouldRunSeedListingGate')
    expect(src).toContain('probeSeedGitLayout')
    expect(src).toContain('buildSeedWipCommit')
    expect(src).toContain('uncommitted_credentials')
    expect(src).toContain('leaveOutUncommittedCredentialFiles')
    expect(src).toContain('makeSeedAdminDir')
    expect(src).toContain('hardenForDeviceSessions === true')
    expect(src).toContain('refuseSeedHomeRoot')
    expect(src).toContain('AbortSignal.timeout(180000)')
  })
})
