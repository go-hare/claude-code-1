/**
 * densable 2.1.243 #53 — desktop / Dock / Finder require a Finder grant.
 * Official `At` / `lr` / `Ze` + "finder" / "file explorer" resolve.
 */
import { describe, expect, test } from 'bun:test'
import { _test } from '../toolCalls.js'

describe('densable 2.1.243 #53 desktop shell', () => {
  test('At: Finder is always desktop-shell', () => {
    expect(_test.isDesktopShell('com.apple.finder')).toBe(true)
  })

  test('At: ordinary apps are not desktop-shell', () => {
    expect(_test.isDesktopShell('com.apple.Safari')).toBe(false)
    expect(_test.isDesktopShell('com.google.Chrome')).toBe(false)
  })

  test('Ze: exact grant wins', () => {
    expect(
      _test.lookupGrantedTier(
        'com.apple.Safari',
        [
          {
            bundleId: 'com.apple.Safari',
            displayName: 'Safari',
            tier: 'full',
            grantedAt: 1,
          },
        ],
        'darwin',
      ),
    ).toBe('full')
  })

  test('Ze: Finder grant covers desktop-shell on darwin', () => {
    expect(
      _test.lookupGrantedTier(
        'com.apple.finder',
        [
          {
            bundleId: 'com.apple.finder',
            displayName: 'Finder',
            tier: 'click',
            grantedAt: 1,
          },
        ],
        'darwin',
      ),
    ).toBe('click')
  })

  test('Ze: ungranted Finder is undefined', () => {
    expect(
      _test.lookupGrantedTier(
        'com.apple.finder',
        [
          {
            bundleId: 'com.apple.Safari',
            displayName: 'Safari',
            tier: 'full',
            grantedAt: 1,
          },
        ],
        'darwin',
      ),
    ).toBeUndefined()
  })

  test('resolveRequestedApps maps Finder on darwin', () => {
    const [resolved] = _test.resolveRequestedApps(
      ['Finder'],
      [],
      new Set(),
      'darwin',
    )
    expect(resolved?.resolved?.bundleId).toBe('com.apple.finder')
    expect(resolved?.resolved?.displayName).toBe('Finder')
  })

  test('resolveRequestedApps maps File Explorer when WINDIR explorer path exists', () => {
    if (!_test.FILE_EXPLORER_PATH) return
    const [resolved] = _test.resolveRequestedApps(
      ['File Explorer'],
      [],
      new Set(),
      'win32',
    )
    expect(resolved?.resolved?.bundleId).toBe(_test.FILE_EXPLORER_PATH)
    expect(resolved?.resolved?.displayName).toBe('File Explorer')
  })
})
