import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { loadBuddyPack } from './manifest.js'
import type { LoadedBuddyPack } from './types.js'

export function getBuddyPacksDir(homeDir = getClaudeConfigHomeDir()): string {
  return join(homeDir, 'buddies')
}

export function listBuddyPacks(
  homeDir = getClaudeConfigHomeDir(),
): LoadedBuddyPack[] {
  const root = getBuddyPacksDir(homeDir)
  if (!existsSync(root)) return []

  const packs: LoadedBuddyPack[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      packs.push(loadBuddyPack(join(root, entry.name)))
    } catch {
      // Ignore invalid local packs while listing. Explicit load still throws.
    }
  }
  return packs.sort((a, b) =>
    a.manifest.displayName.localeCompare(b.manifest.displayName),
  )
}
