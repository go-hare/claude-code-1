/**
 * densable 2.1.216 #20 — Windows read-only commands on network/UNC paths
 * must not auto-allow; path-mode `sI(e, true)` catches bare + mixed forms.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const originalPlatform = {
  getPlatform: () => 'macos' as const,
  getIsWindows: () => false,
}

function mockWindows(): void {
  mock.module('src/utils/platform.js', () => ({
    getPlatform: () => 'windows' as const,
    getIsWindows: () => true,
  }))
}

function mockMacos(): void {
  mock.module('src/utils/platform.js', () => ({ ...originalPlatform }))
}

mockWindows()

import { containsVulnerableUncPath } from '../readOnlyCommandValidation.js'
import { validatePath } from '../../permissions/pathValidation.js'
import type { ToolPermissionContext } from '../../../Tool.js'

beforeEach(() => {
  mockWindows()
})

afterEach(() => {
  mockMacos()
})

const emptyCtx = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false,
} as unknown as ToolPermissionContext

describe('containsVulnerableUncPath densable sI (2.1.216 #20)', () => {
  test('non-windows always false', () => {
    mockMacos()
    expect(containsVulnerableUncPath('\\\\server\\share')).toBe(false)
    expect(containsVulnerableUncPath('\\\\server\\share', true)).toBe(false)
  })

  test('basic backslash + forward-slash UNC (command and path mode)', () => {
    expect(containsVulnerableUncPath('\\\\server\\share')).toBe(true)
    expect(containsVulnerableUncPath('//server/share')).toBe(true)
    expect(containsVulnerableUncPath('cat \\\\evil\\share\\a')).toBe(true)
  })

  test('path mode: bare leading // or \\\\', () => {
    expect(containsVulnerableUncPath('\\\\server', true)).toBe(true)
    expect(containsVulnerableUncPath('//server', true)).toBe(true)
  })

  test('path mode: single-separator mixed forms densable missed by command mode', () => {
    // densable path mode: /(?<![:\w])\/\\{1,}.../  and reverse
    expect(containsVulnerableUncPath('/\\server\\share', true)).toBe(true)
    expect(containsVulnerableUncPath('\\/server/share', true)).toBe(true)
    // command mode still requires 2+ separators for mixed
    expect(containsVulnerableUncPath('/\\server\\share', false)).toBe(false)
  })

  test('path mode: leading short flags stripped then rechecked', () => {
    expect(containsVulnerableUncPath('-n\\\\server\\share', true)).toBe(true)
    expect(containsVulnerableUncPath('-rf//server/share', true)).toBe(true)
  })

  test('WebDAV / DavWWWRoot / IPv4', () => {
    expect(containsVulnerableUncPath('\\\\host@SSL@8443\\p')).toBe(true)
    expect(containsVulnerableUncPath('\\\\x\\DavWWWRoot\\y')).toBe(true)
    expect(containsVulnerableUncPath('\\\\192.168.1.1\\share')).toBe(true)
  })

  test('http URL is not UNC', () => {
    expect(containsVulnerableUncPath('https://example.com/x')).toBe(false)
    expect(containsVulnerableUncPath('http://example.com/x', true)).toBe(false)
  })
})

describe('validatePath densable Rjr UNC (2.1.216 #20)', () => {
  test('UNC path denied with densable reason string', () => {
    const result = validatePath(
      '\\\\fileserver\\share\\readme.txt',
      'C:\\proj',
      emptyCtx,
      'read',
    )
    expect(result.allowed).toBe(false)
    expect(result.decisionReason).toEqual({
      type: 'other',
      reason: 'UNC network paths require manual approval',
    })
  })

  test('backtick in path requires manual approval (densable Rjr)', () => {
    mockMacos()
    const result = validatePath('foo`bar.txt', '/tmp/proj', emptyCtx, 'read')
    expect(result.allowed).toBe(false)
    expect(result.decisionReason?.type).toBe('other')
    if (result.decisionReason?.type === 'other') {
      expect(result.decisionReason.reason).toContain(
        'Shell expansion syntax in paths requires manual approval',
      )
    }
  })

  test('source contracts: Rjr path-mode sI + windows-% + backtick', () => {
    const unc = readFileSync(
      join(import.meta.dir, '../readOnlyCommandValidation.ts'),
      'utf8',
    )
    expect(unc).toContain('forPath = false')
    expect(unc).toContain('/^[\\\\/]{2}/')
    expect(unc).toContain('(?<![:\\w])')
    const pv = readFileSync(
      join(import.meta.dir, '../../permissions/pathValidation.ts'),
      'utf8',
    )
    expect(pv).toContain('containsVulnerableUncPath(cleanPath, true)')
    expect(pv).toContain("cleanPath.includes('`')")
    expect(pv).toContain(
      "getPlatform() === 'windows' && cleanPath.includes('%')",
    )
  })
})
