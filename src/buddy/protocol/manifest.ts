import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  BUDDY_PROTOCOL_VERSION,
  BUDDY_RENDERERS,
  BUDDY_STATES,
  type BuddyManifest,
  type BuddyRenderer,
  type BuddyState,
  type LoadedBuddyPack,
} from './types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRenderer(value: unknown): value is BuddyRenderer {
  return (
    typeof value === 'string' &&
    BUDDY_RENDERERS.includes(value as BuddyRenderer)
  )
}

function isState(value: string): value is BuddyState {
  return BUDDY_STATES.includes(value as BuddyState)
}

export function validateBuddyManifest(value: unknown): BuddyManifest {
  if (!isObject(value)) {
    throw new Error('Buddy manifest must be an object')
  }

  if (value.schemaVersion !== BUDDY_PROTOCOL_VERSION) {
    throw new Error(
      `Buddy manifest schemaVersion must be ${BUDDY_PROTOCOL_VERSION}`,
    )
  }

  if (!isString(value.id)) throw new Error('Buddy manifest id is required')
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value.id)) {
    throw new Error(
      'Buddy manifest id may only contain letters, numbers, dots, underscores, and dashes',
    )
  }

  if (!isString(value.displayName)) {
    throw new Error('Buddy manifest displayName is required')
  }

  if (!Array.isArray(value.renderers) || value.renderers.length === 0) {
    throw new Error('Buddy manifest renderers must be a non-empty array')
  }

  const renderers = value.renderers
  if (!renderers.every(isRenderer)) {
    throw new Error('Buddy manifest renderers contains an unknown renderer')
  }

  if (!isRenderer(value.defaultRenderer)) {
    throw new Error('Buddy manifest defaultRenderer is invalid')
  }

  if (!renderers.includes(value.defaultRenderer)) {
    throw new Error(
      'Buddy manifest defaultRenderer must be listed in renderers',
    )
  }

  if (!isObject(value.states)) {
    throw new Error('Buddy manifest states must be an object')
  }

  for (const [state, spec] of Object.entries(value.states)) {
    if (!isState(state)) {
      throw new Error(`Buddy manifest contains unknown state: ${state}`)
    }
    if (!isObject(spec) || !isString(spec.animation)) {
      throw new Error(`Buddy manifest state ${state} must define animation`)
    }
    if (
      'row' in spec &&
      (!Number.isInteger(spec.row) || (spec.row as number) < 0)
    ) {
      throw new Error(
        `Buddy manifest state ${state} row must be a non-negative integer`,
      )
    }
    if (
      'frames' in spec &&
      (!Number.isInteger(spec.frames) || (spec.frames as number) <= 0)
    ) {
      throw new Error(
        `Buddy manifest state ${state} frames must be a positive integer`,
      )
    }
  }

  if (!('idle' in value.states)) {
    throw new Error('Buddy manifest must define an idle state')
  }

  return value as BuddyManifest
}

export function loadBuddyManifestFile(path: string): BuddyManifest {
  return validateBuddyManifest(JSON.parse(readFileSync(path, 'utf8')))
}

export function loadBuddyPack(dir: string): LoadedBuddyPack {
  const manifestPath = join(dir, 'buddy.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Buddy pack is missing buddy.json: ${dir}`)
  }
  return {
    dir,
    manifestPath,
    manifest: loadBuddyManifestFile(manifestPath),
  }
}
