/**
 * densable 2.1.283 leftover gold `class st` @202335343 drop-before-init wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { HeadlessCloudFrames } from '../cloudSession.js'
import {
  PEER_HELD_FOR_INIT_CAP,
  createHeadlessPeerInitBag,
  notePeerFrameBeforeInit,
  peerFramesDroppedBeforeInit,
} from '../headlessFramesDrop.js'

const src = readFileSync(
  join(import.meta.dir, '../headlessFramesDrop.ts'),
  'utf8',
)

describe('headlessFramesDrop 283 leftover gold class st wrap', () => {
  test('source-locks gold class st; no minify public class st', () => {
    expect(src).toContain('gold `class st` @202335343')
    expect(src).toContain('peerFramesDroppedBeforeInitCount')
    expect(src).toContain('peerHeldForInit')
    expect(src).toContain('maxHeldForInit')
    expect(src).toContain('counts.peerFramesDroppedBeforeInit')
    expect(src).not.toMatch(/^export class st\b/m)
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('notePeerFrameBeforeInit held vs dropped; getter alias', () => {
    expect(PEER_HELD_FOR_INIT_CAP).toBe(200)
    const bag = createHeadlessPeerInitBag()
    notePeerFrameBeforeInit(bag, {
      holdingForInit: false,
      dropped: true,
      held: true,
    })
    expect(bag).toEqual(createHeadlessPeerInitBag())
    notePeerFrameBeforeInit(bag, {
      holdingForInit: true,
      dropped: false,
      held: true,
    })
    notePeerFrameBeforeInit(bag, {
      holdingForInit: true,
      dropped: false,
      held: true,
    })
    expect(bag.peerHeldForInit).toBe(2)
    expect(bag.maxHeldForInit).toBe(2)
    notePeerFrameBeforeInit(bag, {
      holdingForInit: true,
      dropped: true,
      held: false,
    })
    expect(bag.peerFramesDroppedBeforeInitCount).toBe(1)
    expect(peerFramesDroppedBeforeInit(bag)).toBe(1)
  })

  test('HeadlessCloudFrames host hold/drop increments gold st fields', () => {
    const frames = new HeadlessCloudFrames({
      entry: 'create',
      sessionId: 'cse_1',
    })
    expect(frames.peerFramesDroppedBeforeInitCount).toBe(0)
    expect(frames.peerHeldForInit).toBe(0)
    expect(frames.maxHeldForInit).toBe(0)
    expect(frames.handle({ type: 'user' }, 'host')).toBe('hold')
    expect(frames.peerHeldForInit).toBe(1)
    expect(frames.maxHeldForInit).toBeGreaterThanOrEqual(1)
    expect(frames.counts.peerFramesDroppedBeforeInit).toBe(0)
    frames.peerHeldForInit = PEER_HELD_FOR_INIT_CAP
    expect(frames.handle({ type: 'user' }, 'host')).toBe('drop')
    expect(frames.peerFramesDroppedBeforeInitCount).toBe(1)
    expect(frames.counts.peerFramesDroppedBeforeInit).toBe(1)
    frames.releaseHeld()
    expect(frames.peerHeldForInit).toBe(0)
    expect(frames.holdingForInit).toBe(false)
    expect(frames.handle({ type: 'user' }, 'host')).toBe('emit')
  })
})
