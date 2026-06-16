import { rollWithSeed } from '../companion.js'
import { renderFace, renderSprite, spriteFrameCount } from '../sprites.js'
import { BUDDY_PROTOCOL_VERSION, type BuddyManifest } from './types.js'

export const BUILTIN_BUDDY_ID = 'gohare-builtin'

export const builtinBuddyManifest: BuddyManifest = {
  schemaVersion: BUDDY_PROTOCOL_VERSION,
  id: BUILTIN_BUDDY_ID,
  displayName: 'Go Hare Buddy',
  description: 'The built-in terminal companion.',
  renderers: ['ascii'],
  defaultRenderer: 'ascii',
  states: {
    idle: { animation: 'idle' },
    thinking: { animation: 'thinking' },
    running: { animation: 'running' },
    waiting: { animation: 'waiting' },
    review: { animation: 'review' },
    failed: { animation: 'failed' },
    success: { animation: 'success' },
    pet: { animation: 'pet' },
    speaking: { animation: 'speaking' },
  },
  capabilities: {
    react: true,
    interactive: true,
  },
  permissions: {
    network: false,
    filesystem: false,
    model: 'optional',
  },
}

export function hatchBuiltinBuddy(seed: string) {
  return rollWithSeed(seed)
}

export function renderBuddyAscii(
  bones: Parameters<typeof renderSprite>[0],
  frame = 0,
): string[] {
  return renderSprite(bones, frame)
}

export { renderFace as renderBuddyFace, spriteFrameCount as getBuddyFrameCount }
