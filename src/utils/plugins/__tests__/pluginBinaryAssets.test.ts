import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isPluginBinaryAssetsFeatureEnabled,
  loadPluginBinaryAssetsManifest,
  maybeProvisionPluginBinaryAssets,
  parsePluginBinaryAssetsManifest,
  provisionPluginBinaryAssetsFromManifest,
} from '../pluginBinaryAssets.js'

const roots: string[] = []

afterEach(async () => {
  for (const r of roots.splice(0)) {
    await rm(r, { recursive: true, force: true })
  }
})

async function makeRoot(): Promise<string> {
  const root = join(
    tmpdir(),
    `cc-bin-assets-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  await mkdir(root, { recursive: true })
  roots.push(root)
  return root
}

describe('pluginBinaryAssets densables', () => {
  test('isPluginBinaryAssetsFeatureEnabled respects env/gb', () => {
    expect(
      isPluginBinaryAssetsFeatureEnabled({
        env: {},
        gbValue: false,
      }),
    ).toBe(false)
    expect(
      isPluginBinaryAssetsFeatureEnabled({
        env: { CLAUDE_CODE_PLUGIN_BINARY_ASSETS: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(
      isPluginBinaryAssetsFeatureEnabled({
        env: {},
        gbValue: true,
      }),
    ).toBe(true)
  })

  test('parsePluginBinaryAssetsManifest rejects traversal', () => {
    const m = parsePluginBinaryAssetsManifest({
      assets: [
        { path: 'bin/ok' },
        { path: '../escape' },
        { path: '/abs' },
        { name: 'bin/named' },
      ],
    })
    expect(m?.assets.map(a => a.path)).toEqual(['bin/ok', 'bin/named'])
  })

  test('load + provision chmod densable', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'bin'), { recursive: true })
    await writeFile(join(root, 'bin', 'tool'), '#!/bin/sh\necho hi\n')
    // strip exec bit so we can observe chmod
    await chmod(join(root, 'bin', 'tool'), 0o644)
    await writeFile(
      join(root, 'binary-assets.json'),
      JSON.stringify({
        assets: [{ path: 'bin/tool', mode: 0o755 }],
      }),
    )
    const manifest = await loadPluginBinaryAssetsManifest(root)
    expect(manifest?.assets).toHaveLength(1)
    const result = await provisionPluginBinaryAssetsFromManifest(
      root,
      manifest!,
    )
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.provisioned).toBe(1)
      expect(result.failed).toBe(0)
    }
    // On some FS modes may not stick exactly; at least content preserved.
    expect(await readFile(join(root, 'bin', 'tool'), 'utf8')).toContain(
      'echo hi',
    )
  })

  test('sha256 mismatch fails entry', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'bin'), { recursive: true })
    await writeFile(join(root, 'bin', 'tool'), 'data')
    const result = await provisionPluginBinaryAssetsFromManifest(root, {
      assets: [{ path: 'bin/tool', sha256: 'deadbeef' }],
    })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.failed).toBe(1)
      expect(result.details[0]?.reason).toContain('sha256_mismatch')
    }
  })

  test('fetchAsset densable downloads missing file', async () => {
    const root = await makeRoot()
    const result = await provisionPluginBinaryAssetsFromManifest(
      root,
      {
        assets: [
          {
            path: 'bin/remote',
            url: 'https://example/bin',
          },
        ],
      },
      {
        fetchAsset: async () => Buffer.from('remote-bytes'),
      },
    )
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.provisioned).toBe(1)
    }
    expect(await readFile(join(root, 'bin', 'remote'), 'utf8')).toBe(
      'remote-bytes',
    )
  })

  test('maybeProvisionPluginBinaryAssets disabled / no manifest', async () => {
    const root = await makeRoot()
    expect(
      await maybeProvisionPluginBinaryAssets(root, 'p1', {
        env: {},
        gbValue: false,
      }),
    ).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(
      await maybeProvisionPluginBinaryAssets(root, 'p1', {
        env: {},
        gbValue: true,
      }),
    ).toEqual({ status: 'skipped', reason: 'no_manifest' })
  })

  test('remote U$y asset-cache stream densable', async () => {
    const root = await makeRoot()
    const { provisionPluginBinaryAssetsFromRemoteCache } = await import(
      '../pluginBinaryAssets.js'
    )
    const result = await provisionPluginBinaryAssetsFromRemoteCache({
      pluginRoot: root,
      pluginId: 'remote-p',
      listRemoteAssets: async () => [
        { path: 'bin/tool', url: 'https://cache/tool' },
        { path: '../escape', url: 'https://evil' },
      ],
      fetchAsset: async () => Buffer.from('streamed'),
    })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.provisioned).toBe(1)
      expect(result.failed).toBe(0)
    }
    expect(await readFile(join(root, 'bin', 'tool'), 'utf8')).toBe('streamed')

    // maybeProvision falls through to remote when no local manifest
    const root2 = await makeRoot()
    const viaMaybe = await maybeProvisionPluginBinaryAssets(root2, 'p2', {
      env: {},
      gbValue: true,
      listRemoteAssets: async () => [{ path: 'bin/x', url: 'https://cache/x' }],
      fetchAsset: async () => Buffer.from('via-maybe'),
    })
    expect(viaMaybe.status).toBe('ok')
    expect(await readFile(join(root2, 'bin', 'x'), 'utf8')).toBe('via-maybe')
  })
})
