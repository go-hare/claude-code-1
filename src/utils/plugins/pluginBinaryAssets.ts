/**
 * Official B$y / nEo densable surface for plugin binary asset provisioning.
 *
 * Official U$y streams per-binary assets into plugin `bin/` with sha256
 * verify + asset-cache. This densifies:
 *  - B$y gate (env OR GB tengu_plugin_binary_assets)
 *  - local manifest apply densable (chmod + optional injectable fetch)
 *  - maybeProvisionPluginBinaryAssets entry used by install helpers
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logForDebugging } from '../debug.js'
import { isPluginBinaryAssetsEnabled } from '../residualFinalEnvGates.js'

const LOG_TAG = '[pluginBinaryAssets]'

/** Official-ish plugin binary manifest names under plugin root. */
export const PLUGIN_BINARY_MANIFEST_NAMES = [
  'binary-assets.json',
  'bin-assets.json',
  '.binary-assets.json',
] as const

export type PluginBinaryAssetEntry = {
  /** Relative path under plugin root (usually bin/foo). */
  path: string
  /** Optional sha256 hex of expected bytes. */
  sha256?: string
  /** Optional remote URL for denser download host. */
  url?: string
  /** Mode bits (default 0o755). */
  mode?: number
}

export type PluginBinaryAssetsManifest = {
  assets: PluginBinaryAssetEntry[]
}

/**
 * Official B$y with GrowthBook tengu_plugin_binary_assets (default false).
 */
export function isPluginBinaryAssetsFeatureEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (input?.gbValue !== undefined) {
    return isPluginBinaryAssetsEnabled({ env, gbValue: input.gbValue })
  }
  const gb = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_plugin_binary_assets',
    false,
  )
  return isPluginBinaryAssetsEnabled({ env, gbValue: Boolean(gb) })
}

/**
 * Pure densable — parse manifest JSON into asset entries.
 */
export function parsePluginBinaryAssetsManifest(
  raw: unknown,
): PluginBinaryAssetsManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const list = Array.isArray(obj.assets)
    ? obj.assets
    : Array.isArray(obj.binaries)
      ? obj.binaries
      : Array.isArray(raw)
        ? (raw as unknown[])
        : null
  if (!list) return null
  const assets: PluginBinaryAssetEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const path =
      typeof e.path === 'string'
        ? e.path
        : typeof e.name === 'string'
          ? e.name
          : null
    if (
      !path ||
      path.includes('..') ||
      path.startsWith('/') ||
      path.startsWith('\\')
    ) {
      continue
    }
    assets.push({
      path,
      ...(typeof e.sha256 === 'string' ? { sha256: e.sha256 } : {}),
      ...(typeof e.url === 'string' ? { url: e.url } : {}),
      ...(typeof e.mode === 'number' ? { mode: e.mode } : {}),
    })
  }
  return { assets }
}

export async function loadPluginBinaryAssetsManifest(
  pluginRoot: string,
): Promise<PluginBinaryAssetsManifest | null> {
  for (const name of PLUGIN_BINARY_MANIFEST_NAMES) {
    try {
      const text = await readFile(join(pluginRoot, name), 'utf8')
      const parsed = parsePluginBinaryAssetsManifest(JSON.parse(text))
      if (parsed && parsed.assets.length > 0) return parsed
    } catch {
      // try next name
    }
  }
  return null
}

function sha256Hex(buf: Uint8Array): string {
  // Lazy require so tests/bootstrap don't pull crypto at module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update(buf).digest('hex')
}

export type PluginBinaryAssetsProvisionResult =
  | { status: 'skipped'; reason: 'disabled' }
  | { status: 'skipped'; reason: 'no_manifest' }
  | {
      status: 'ok'
      provisioned: number
      failed: number
      details: Array<{ path: string; ok: boolean; reason?: string }>
    }

export type ProvisionPluginBinaryAssetsDeps = {
  /** Injectable download for assets with url (denser network host). */
  fetchAsset?: (url: string) => Promise<Uint8Array>
  /** Optional chmod override (tests). */
  chmod?: (path: string, mode: number) => Promise<void>
  log?: (msg: string) => void
}

/**
 * Official U$y local densable — apply manifest: verify existing files, chmod,
 * optionally fetch missing assets via injectable host.
 */
export async function provisionPluginBinaryAssetsFromManifest(
  pluginRoot: string,
  manifest: PluginBinaryAssetsManifest,
  deps: ProvisionPluginBinaryAssetsDeps = {},
): Promise<PluginBinaryAssetsProvisionResult> {
  const log =
    deps.log ?? ((msg: string) => logForDebugging(msg, { level: 'debug' }))
  const chmodFn =
    deps.chmod ??
    (async (p: string, mode: number) => {
      await chmod(p, mode)
    })
  const details: Array<{ path: string; ok: boolean; reason?: string }> = []
  let provisioned = 0
  let failed = 0

  for (const asset of manifest.assets) {
    const abs = join(pluginRoot, asset.path)
    try {
      let bytes: Uint8Array | null = null
      try {
        bytes = await readFile(abs)
      } catch {
        bytes = null
      }
      if (!bytes && asset.url && deps.fetchAsset) {
        const fetched = await deps.fetchAsset(asset.url)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, fetched)
        bytes = fetched
        log(`${LOG_TAG} downloaded ${asset.path}`)
      }
      if (!bytes) {
        failed++
        details.push({
          path: asset.path,
          ok: false,
          reason: asset.url ? 'missing_and_no_fetch' : 'missing_file',
        })
        continue
      }
      if (asset.sha256) {
        const hash = sha256Hex(bytes)
        if (hash.toLowerCase() !== asset.sha256.toLowerCase()) {
          failed++
          details.push({
            path: asset.path,
            ok: false,
            reason: `sha256_mismatch expected=${asset.sha256} got=${hash}`,
          })
          continue
        }
      }
      await chmodFn(abs, asset.mode ?? 0o755)
      provisioned++
      details.push({ path: asset.path, ok: true })
    } catch (err) {
      failed++
      details.push({
        path: asset.path,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { status: 'ok', provisioned, failed, details }
}

/**
 * Official U$y remote asset-cache densable — stream/list remote binary assets
 * into a local manifest shape, then apply via provisionPluginBinaryAssetsFromManifest.
 *
 * Hosts inject `listRemoteAssets` (and usually `fetchAsset`). Without them this
 * is a pure no-op that returns skipped.
 */
export async function provisionPluginBinaryAssetsFromRemoteCache(input: {
  pluginRoot: string
  pluginId: string
  /**
   * Official asset-cache list densable — returns path + optional url/sha256/mode.
   */
  listRemoteAssets: () => Promise<PluginBinaryAssetEntry[]>
  fetchAsset?: ProvisionPluginBinaryAssetsDeps['fetchAsset']
  log?: (msg: string) => void
}): Promise<PluginBinaryAssetsProvisionResult> {
  const log =
    input.log ?? ((msg: string) => logForDebugging(msg, { level: 'debug' }))
  let assets: PluginBinaryAssetEntry[]
  try {
    assets = await input.listRemoteAssets()
  } catch (err) {
    log(
      `${LOG_TAG} ${input.pluginId}: remote asset list failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { status: 'skipped', reason: 'no_manifest' }
  }
  // Reuse parse filter (traversal reject) via a synthetic manifest.
  const manifest = parsePluginBinaryAssetsManifest({ assets })
  if (!manifest || manifest.assets.length === 0) {
    return { status: 'skipped', reason: 'no_manifest' }
  }
  log(
    `${LOG_TAG} ${input.pluginId}: remote U$y densable applying ${manifest.assets.length} asset(s)`,
  )
  return provisionPluginBinaryAssetsFromManifest(input.pluginRoot, manifest, {
    ...(input.fetchAsset ? { fetchAsset: input.fetchAsset } : {}),
    log,
  })
}

/**
 * Official nEo entry densable: gate + local manifest apply, with optional
 * remote asset-cache stream densable when no local manifest.
 */
export async function maybeProvisionPluginBinaryAssets(
  pluginRoot: string,
  pluginId: string,
  input?: {
    env?: NodeJS.ProcessEnv
    gbValue?: boolean
    fetchAsset?: ProvisionPluginBinaryAssetsDeps['fetchAsset']
    /**
     * Official U$y remote list densable. When local manifest missing and this
     * is provided, streams remote assets into plugin root.
     */
    listRemoteAssets?: () => Promise<PluginBinaryAssetEntry[]>
  },
): Promise<PluginBinaryAssetsProvisionResult> {
  if (!isPluginBinaryAssetsFeatureEnabled(input)) {
    return { status: 'skipped', reason: 'disabled' }
  }
  const manifest = await loadPluginBinaryAssetsManifest(pluginRoot)
  if (!manifest) {
    if (input?.listRemoteAssets) {
      return provisionPluginBinaryAssetsFromRemoteCache({
        pluginRoot,
        pluginId,
        listRemoteAssets: input.listRemoteAssets,
        ...(input.fetchAsset ? { fetchAsset: input.fetchAsset } : {}),
        log: msg => logForDebugging(msg, { level: 'debug' }),
      })
    }
    logForDebugging(
      `${LOG_TAG} ${pluginId}: feature enabled; no local binary-assets manifest (remote U$y stream denser)`,
      { level: 'info' },
    )
    return { status: 'skipped', reason: 'no_manifest' }
  }
  const result = await provisionPluginBinaryAssetsFromManifest(
    pluginRoot,
    manifest,
    {
      ...(input?.fetchAsset ? { fetchAsset: input.fetchAsset } : {}),
      log: msg => logForDebugging(msg, { level: 'debug' }),
    },
  )
  logForDebugging(
    `${LOG_TAG} ${pluginId}: provisioned=${result.status === 'ok' ? result.provisioned : 0} failed=${result.status === 'ok' ? result.failed : 0}`,
    { level: 'info' },
  )
  return result
}
