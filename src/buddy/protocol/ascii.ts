import { readFileSync } from 'fs'
import { resolveBuddyAsset } from './assets.js'
import type { BuddyState, LoadedBuddyPack } from './types.js'

export type BuddyAsciiAsset = {
  states: Partial<Record<BuddyState, string[][]>>
}

export function loadBuddyAsciiAsset(path: string): BuddyAsciiAsset {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (typeof value !== 'object' || value === null || !('states' in value)) {
    throw new Error('Buddy ASCII asset must define states')
  }
  return value as BuddyAsciiAsset
}

export function renderBuddyPackAscii(
  pack: LoadedBuddyPack,
  state: BuddyState = 'idle',
  frame = 0,
): string[] {
  const asset = resolveBuddyAsset(pack.manifest, pack.dir, 'ascii')
  if (!asset)
    throw new Error(`Buddy pack ${pack.manifest.id} has no ASCII asset`)
  const ascii = loadBuddyAsciiAsset(asset.path)
  const frames = ascii.states[state] ?? ascii.states.idle
  if (!frames?.length) {
    throw new Error(`Buddy ASCII asset has no frames for state ${state}`)
  }
  return frames[Math.abs(frame) % frames.length]!
}
