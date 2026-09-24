/**
 * densable 2.1.251 #54 — Oe lists changed keys, else the full bag.
 */
import { describe, expect, test } from 'bun:test'
import type { SettingsJson } from '../../../utils/settings/types.js'
import {
  extractDangerousSettings,
  formatRemovedApprovalCount,
  formatUnchangedApprovalCount,
  listManagedSettingsForApproval,
} from '../utils.js'

describe('densable 2.1.251 #54 managed settings changed keys', () => {
  test('non-empty changed set lists only the changed keys', () => {
    const baseline = {
      apiKeyHelper: 'old-helper',
      env: { HTTP_PROXY: 'http://old:1' },
    } as SettingsJson
    const current = extractDangerousSettings({
      apiKeyHelper: 'new-helper',
      env: { HTTP_PROXY: 'http://old:1' },
    } as SettingsJson)
    const listed = listManagedSettingsForApproval(baseline, current)
    expect(listed.items).toEqual(['apiKeyHelper'])
    expect(listed.unchangedCount).toBe(1)
    expect(formatUnchangedApprovalCount(listed.unchangedCount)).toBe(
      '\uFF0B 1 other active setting unchanged since your last approval',
    )
  })

  test('equal bags list the full set and hide the unchanged line', () => {
    const settings = {
      apiKeyHelper: 'helper',
      env: { HTTP_PROXY: 'http://old:1' },
    } as SettingsJson
    const current = extractDangerousSettings(settings)
    const listed = listManagedSettingsForApproval(settings, current)
    expect(listed.items).toContain('apiKeyHelper')
    expect(listed.items).toContain('HTTP_PROXY')
    expect(listed.unchangedCount).toBe(0)
    expect(formatUnchangedApprovalCount(listed.unchangedCount)).toBeNull()
  })

  test('removed keys use the Oe count sentence', () => {
    const baseline = {
      apiKeyHelper: 'helper',
      env: { HTTP_PROXY: 'http://old:1' },
    } as SettingsJson
    const current = extractDangerousSettings({
      apiKeyHelper: 'helper',
    } as SettingsJson)
    const listed = listManagedSettingsForApproval(baseline, current)
    expect(listed.removedCount).toBe(1)
    expect(formatRemovedApprovalCount(1)).toBe(
      '\u2212 1 previously approved setting no longer requires approval',
    )
    expect(formatRemovedApprovalCount(2)).toBe(
      '\u2212 2 previously approved settings no longer require approval',
    )
    expect(listed.items).toContain('apiKeyHelper')
    expect(listed.items).not.toContain('HTTP_PROXY')
  })

  test('first approval with no baseline lists every current key', () => {
    const current = extractDangerousSettings({
      apiKeyHelper: 'helper',
      claudeMd: '# policy',
    } as SettingsJson)
    const listed = listManagedSettingsForApproval(null, current)
    expect(listed.items).toContain('apiKeyHelper')
    expect(listed.items).toContain('claudeMd')
    expect(listed.unchangedCount).toBe(0)
    expect(listed.removedCount).toBe(0)
  })

  test('sandbox bag is compared separately from shellSettings', () => {
    const baseline = {
      apiKeyHelper: 'helper',
      sandbox: { bwrapPath: '/old/bwrap' },
    } as SettingsJson
    const current = extractDangerousSettings({
      apiKeyHelper: 'helper',
      sandbox: { bwrapPath: '/new/bwrap' },
    } as SettingsJson)
    expect(current.sandboxSettings['sandbox.bwrapPath']).toBe('/new/bwrap')
    expect(current.shellSettings['sandbox.bwrapPath']).toBeUndefined()
    const listed = listManagedSettingsForApproval(baseline, current)
    expect(listed.items).toEqual(['sandbox.bwrapPath'])
    expect(listed.unchangedCount).toBe(1)
    expect(formatUnchangedApprovalCount(listed.unchangedCount)).toBe(
      '＋ 1 other active setting unchanged since your last approval',
    )
  })
})
