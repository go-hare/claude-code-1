import { resolve } from 'path'
import type {
  BuddyAssetMap,
  BuddyManifest,
  ResolvedBuddyAsset,
} from './types.js'

const ASSET_KEYS = [
  'ascii',
  'spritesheet',
  'model3d',
  'icon',
  'preview',
] as const

export function resolveBuddyAsset(
  manifest: BuddyManifest,
  packDir: string,
  kind: keyof BuddyAssetMap,
): ResolvedBuddyAsset | undefined {
  const asset = manifest.assets?.[kind]
  if (!asset) return undefined
  return { kind, path: resolve(packDir, asset) }
}

export function resolveBuddyAssets(
  manifest: BuddyManifest,
  packDir: string,
): ResolvedBuddyAsset[] {
  return ASSET_KEYS.flatMap(kind => {
    const asset = resolveBuddyAsset(manifest, packDir, kind)
    return asset ? [asset] : []
  })
}
