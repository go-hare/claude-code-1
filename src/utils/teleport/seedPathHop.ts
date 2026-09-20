/**
 * densable `_465` `Y` / `Ai` — ancestor symlink state for Wi/mn/er/Kt.
 * Gold: gold-forged-Kt.txt
 */

import { lstat } from 'fs/promises'
import { join } from 'path'
import { getErrnoCode } from '../errors.js'
import { getPlatform } from '../platform.js'

export type SeedHopState = 'clear' | 'symlink' | 'unreadable'

/** densable `Ai` */
export function splitSeedRelPath(path: string): string[] {
  return (
    getPlatform() === 'windows' ? path.replaceAll('\\', '/') : path
  ).split('/')
}

/** densable `Y` — walk ancestors of `rel` under `workTree`. */
export async function seedAncestorHopState(
  workTree: string,
  rel: string,
): Promise<SeedHopState> {
  let cur = workTree
  for (const part of splitSeedRelPath(rel).slice(0, -1)) {
    cur = join(cur, part)
    try {
      if ((await lstat(cur)).isSymbolicLink()) return 'symlink'
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'clear'
      return 'unreadable'
    }
  }
  return 'clear'
}
