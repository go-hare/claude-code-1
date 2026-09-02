/**
 * densable Fme / Qui / RNt / A0r — synced item leaf names.
 *
 * Official: Uvp → yc display-hazard → $1e dotted → RNt reserved /
 * legacy Windows alias → ekv under the sync root.
 */

import { basename, isAbsolute, join, relative, sep } from 'path'

/** densable `uGe`. */
export const SYNCED_MANIFEST_LEAF = 'manifest.json'
/** densable `dGe`. */
export const SYNCED_STAGING_DIRNAME = '.staging'
/** densable `Zui`. */
export const SYNCED_TRASH_DIRNAME = '.trash'

/** densable `xNt`. */
export class LegacyReservedSpellingError extends Error {
  constructor() {
    super('synced item name is a legacy alias of a reserved path')
    this.name = 'LegacyReservedSpellingError'
  }
}

/** densable `HWr`. */
export function stripTrailingDotSpace(name: string): string {
  return name.replace(/[. ]+$/, '')
}

/**
 * densable `jx` — lowercase + Turkish/long-s fold, strip bidi, drop `:…`
 * and trailing `. ` (empty fold falls back to the lowered string).
 */
export function foldSyncedLeafName(name: string): string {
  const lowered = name
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u017f/g, 's')
  return (
    lowered
      .replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '')
      .replace(/:.*$/, '')
      .replace(/[. ]+$/, '') || lowered
  )
}

/**
 * densable `p9` — strip bidi, map capital ß, NFD + case fold.
 */
export function foldSyncedPathKey(path: string): string {
  return path
    .replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '')
    .replace(/\u1e9e/g, '\xdf')
    .normalize('NFD')
    .toUpperCase()
    .toLowerCase()
}

/** densable `yc`. */
export function stripDisplayHazardControls(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ')
}

/** densable `Uvp`. */
export function sanitizeSyncedItemName(name: string): string {
  const leaf = stripTrailingDotSpace(name.replace(/[<>:"|?*\\/]/g, '_'))
  if (!leaf) throw new Error('synced item name resolves to sync root')
  return leaf
}

/** densable `ekv`. */
export function joinUnderSyncRoot(name: string, root: string): string {
  const dest = join(root, name)
  const rel = relative(root, dest)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('synced item name escapes the sync root')
  }
  return dest
}

/** densable `$1e`. */
export function isReservedDottedSyncedName(name: string): boolean {
  return foldSyncedLeafName(name).startsWith('.')
}

/** densable `MHa` — iVE reserved + e2t skipEntry segment. */
export function isSyncedZipReservedSegment(name: string): boolean {
  return foldSyncedLeafName(name) === '.git'
}

/** densable `Fvp` — Windows device / `~N` 8.3 alias. */
export function isWindowsReservedSyncedName(name: string): boolean {
  const stem = name
    .slice(0, name.indexOf('.') === -1 ? name.length : name.indexOf('.'))
    .replace(/ +$/, '')
  return (
    /~\d/.test(name) ||
    /^(con|prn|aux|nul|com[0-9\u00B9\u00B2\u00B3]|lpt[0-9\u00B9\u00B2\u00B3])$/.test(
      stem,
    )
  )
}

/** densable `RNt`. */
export function resolveSyncedItemLeaf(name: string, root: string): string {
  const leaf = sanitizeSyncedItemName(name)
  const folded = foldSyncedPathKey(foldSyncedLeafName(leaf))
  if (folded === SYNCED_MANIFEST_LEAF || folded === SYNCED_STAGING_DIRNAME) {
    if (
      leaf.toLowerCase() === SYNCED_MANIFEST_LEAF ||
      leaf.toLowerCase() === SYNCED_STAGING_DIRNAME
    ) {
      throw new Error('synced item name resolves to reserved path')
    }
    throw new LegacyReservedSpellingError()
  }
  if (isWindowsReservedSyncedName(folded)) {
    if (isWindowsReservedSyncedName(leaf.toLowerCase())) {
      throw new Error('synced item name resolves to reserved path')
    }
    throw new LegacyReservedSpellingError()
  }
  return joinUnderSyncRoot(leaf, root)
}

/** densable `Qui` / `A0r`. */
export function resolveSyncedPluginDir(name: string, root: string): string {
  const leaf = sanitizeSyncedItemName(name)
  if (stripDisplayHazardControls(leaf) !== leaf) {
    throw new Error('synced item name contains display-hazard characters')
  }
  if (isReservedDottedSyncedName(leaf)) {
    throw new Error('synced item name resolves to reserved path')
  }
  return resolveSyncedItemLeaf(name, root)
}

/** Basename used only for tests / logs — dest path is A0r, not path.basename. */
export function syncedPluginLeafName(name: string): string {
  return sanitizeSyncedItemName(basename(name))
}
