import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type BuddyProfile = {
  id: string
  name: string
  personality?: string
  packId?: string
  seed?: string
  hatchedAt: number
  muted?: boolean
  lastPetAt?: number
}

export type HatchBuddyOptions = {
  id?: string
  name?: string
  personality?: string
  packId?: string
  seed?: string
  now?: number
}

export function generateBuddySeed(now = Date.now()): string {
  return `buddy-${now}-${Math.random().toString(36).slice(2, 10)}`
}

export function hatchBuddy(options: HatchBuddyOptions = {}): BuddyProfile {
  const now = options.now ?? Date.now()
  return {
    id: options.id ?? `buddy-${now}`,
    name: options.name ?? 'Buddy',
    personality: options.personality,
    packId: options.packId,
    seed: options.seed ?? generateBuddySeed(now),
    hatchedAt: now,
    muted: false,
  }
}

export function petBuddy(
  profile: BuddyProfile,
  now = Date.now(),
): BuddyProfile {
  return { ...profile, muted: false, lastPetAt: now }
}

export function muteBuddy(profile: BuddyProfile): BuddyProfile {
  return { ...profile, muted: true }
}

export function unmuteBuddy(profile: BuddyProfile): BuddyProfile {
  return { ...profile, muted: false }
}

export function getBuddyProfilePath(
  homeDir = getClaudeConfigHomeDir(),
): string {
  return join(homeDir, 'buddy-profile.json')
}

export function loadBuddy(
  path = getBuddyProfilePath(),
): BuddyProfile | undefined {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')) as BuddyProfile
}

export function saveBuddy(
  profile: BuddyProfile,
  path = getBuddyProfilePath(),
): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
}
