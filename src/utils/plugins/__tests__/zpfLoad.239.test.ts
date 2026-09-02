/**
 * densable 2.1.239 Zpf Aff/Tff + J1h R9a filter.
 */
import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'path'
import type { LoadedPlugin } from '../../../types/plugin.js'
import {
  folderShadowedByManifestWarnings,
  isAllowedPluginUrl,
  isInvalidZpfPluginName,
  isZpfZipPath,
  manifestPathsCoverFolder,
  nameFromMissingSyncedManifest,
  nameFromSyncedManifest,
  resolvePluginRelPath,
  stripUnprintablePluginVersion,
  syncedIdsMissingFromSettings,
  ZPF_URL_FETCH_TIMEOUT_MS,
  ZPF_URL_MAX_BYTES,
  zpfAffNameError,
} from '../zpfLoad.js'

function plugin(name: string, version?: string): LoadedPlugin {
  return {
    name,
    manifest: { name, version },
    path: `/tmp/${name}`,
    source: `${name}@inline`,
    repository: `${name}@inline`,
    enabled: true,
  }
}

describe('densable Zpf Aff / Tff', () => {
  test('QAi is case-insensitive .zip', () => {
    expect(isZpfZipPath('/tmp/foo.ZIP')).toBe(true)
    expect(isZpfZipPath('/tmp/foo')).toBe(false)
  })

  test('Eff: empty / @ / path / control is invalid', () => {
    expect(isInvalidZpfPluginName('', false, false)).toBe(true)
    expect(isInvalidZpfPluginName('foo@bar', false, false)).toBe(true)
    expect(isInvalidZpfPluginName('foo/bar', false, false)).toBe(true)
    expect(isInvalidZpfPluginName('ok', false, false)).toBe(false)
    expect(isInvalidZpfPluginName('dir', true, false)).toBe(false)
    expect(isInvalidZpfPluginName('dir@x', true, true)).toBe(true)
  })

  test('Aff drops invalid name and keeps plugin when valid', () => {
    expect(
      zpfAffNameError(plugin('bad@name'), 'synced[0]', '/p/plugin.json', true)
        ?.type,
    ).toBe('manifest-validation-error')
    expect(
      zpfAffNameError(plugin('ok'), 'inline[0]', '/p/plugin.json', false),
    ).toBeNull()
  })

  test('Tff strips unprintable version', () => {
    const p = plugin('demo', '1.0.0\u0000')
    stripUnprintablePluginVersion(p)
    expect(p.manifest.version).toBeUndefined()
    const clean = plugin('demo', '1.0.0')
    stripUnprintablePluginVersion(clean)
    expect(clean.manifest.version).toBe('1.0.0')
  })
})

describe('densable J1h R9a filter', () => {
  test('R9a: empty or missing name is skip, not basename', () => {
    expect(nameFromSyncedManifest({ name: 'demo' })).toBe('demo')
    expect(nameFromSyncedManifest({ name: '' })).toBeUndefined()
    expect(nameFromSyncedManifest({ name: 'bad@name' })).toBeUndefined()
    expect(nameFromSyncedManifest({})).toBeUndefined()
    expect(nameFromSyncedManifest(null)).toBeUndefined()
  })

  test('R9a: absent plugin.json uses srt basename when valid', () => {
    expect(nameFromMissingSyncedManifest('demo')).toBe('demo')
    expect(nameFromMissingSyncedManifest('bad@name')).toBeUndefined()
    expect(nameFromMissingSyncedManifest('')).toBeUndefined()
  })

  test('Gn unique name@synced minus settings keys (zD)', () => {
    expect(
      syncedIdsMissingFromSettings(['Demo', 'Demo', 'other'], ['demo@synced']),
    ).toEqual(['other@synced'])
    expect(
      syncedIdsMissingFromSettings([undefined, 'x'], ['x@synced']),
    ).toEqual([])
    expect(syncedIdsMissingFromSettings(['ghost'], [])).toEqual([
      'ghost@synced',
    ])
  })
})

describe('--plugin-url scheme allowlist', () => {
  test('https and loopback http only', () => {
    expect(isAllowedPluginUrl(new URL('https://example.com/p.zip'))).toBe(true)
    expect(isAllowedPluginUrl(new URL('http://127.0.0.1:8080/p.zip'))).toBe(
      true,
    )
    expect(isAllowedPluginUrl(new URL('http://localhost/p.zip'))).toBe(true)
    expect(isAllowedPluginUrl(new URL('http://example.com/p.zip'))).toBe(false)
    expect(isAllowedPluginUrl(new URL('file:///tmp/p.zip'))).toBe(false)
  })
})

describe('densable JAi / Kpf folder-shadowed-by-manifest', () => {
  const root = resolve('tmp-plugin-kpf')
  const commandsDir = join(root, 'commands')

  test('Kpf: string path covering the default folder is not shadowed', () => {
    expect(manifestPathsCoverFolder('commands', root, commandsDir)).toBe(true)
    expect(manifestPathsCoverFolder('./extra', root, commandsDir)).toBe(false)
  })

  test('irt: path escaping the plugin root is null', () => {
    expect(resolvePluginRelPath(root, '../outside')).toBeNull()
    expect(resolvePluginRelPath(root, 'commands')).toBe(commandsDir)
  })

  test('JAi emits folder-shadowed-by-manifest when folder exists and Kpf is false', () => {
    const warnings = folderShadowedByManifestWarnings(
      root,
      'demo@inline',
      'demo',
      { name: 'demo', commands: './extra-commands' },
      {
        commands: true,
        agents: false,
        outputStyles: false,
        themes: false,
        workflows: false,
      },
    )
    expect(warnings).toEqual([
      {
        type: 'folder-shadowed-by-manifest',
        source: 'demo@inline',
        plugin: 'demo',
        component: 'commands',
        folderPath: commandsDir,
        manifestFields: ['commands'],
      },
    ])
  })

  test('JAi skips when Kpf covers the folder or the folder is missing', () => {
    expect(
      folderShadowedByManifestWarnings(
        root,
        'demo@inline',
        'demo',
        { name: 'demo', commands: 'commands' },
        {
          commands: true,
          agents: false,
          outputStyles: false,
          themes: false,
          workflows: false,
        },
      ),
    ).toEqual([])
    expect(
      folderShadowedByManifestWarnings(
        root,
        'demo@inline',
        'demo',
        { name: 'demo', commands: './extra' },
        {
          commands: false,
          agents: false,
          outputStyles: false,
          themes: false,
          workflows: false,
        },
      ),
    ).toEqual([])
  })

  test('Zpf url-kind fetch caps match official IyS / Vtt', () => {
    expect(ZPF_URL_FETCH_TIMEOUT_MS).toBe(30_000)
    expect(ZPF_URL_MAX_BYTES).toBe(268_435_456)
  })
})
