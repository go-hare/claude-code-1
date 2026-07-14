import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, test } from 'bun:test'
import {
  BUDDY_PROTOCOL_VERSION,
  builtinBuddyManifest,
  createBuddyRuntime,
  dispatchBuddyEvent,
  hatchBuddy,
  listBuddyPacks,
  loadBuddyPack,
  muteBuddy,
  parseBuddyReaction,
  petBuddy,
  renderBuddyPackAscii,
  reactBuddy,
  resolveBuddyAsset,
  validateBuddyManifest,
} from '../protocol/index.js'

const validManifest = {
  schemaVersion: BUDDY_PROTOCOL_VERSION,
  id: 'spark',
  displayName: 'Spark',
  description: 'A tiny coding companion.',
  renderers: ['ascii', 'spritesheet', 'three'],
  defaultRenderer: 'ascii',
  assets: {
    ascii: 'ascii.json',
    spritesheet: 'assets/spritesheet.webp',
    model3d: 'assets/model.glb',
  },
  states: {
    idle: { animation: 'idle' },
    running: { animation: 'running', row: 7, frames: 6 },
  },
}

describe('buddy protocol', () => {
  test('validates a buddy manifest', () => {
    expect(validateBuddyManifest(validManifest).id).toBe('spark')
  })

  test('rejects unknown states and renderers', () => {
    expect(() =>
      validateBuddyManifest({
        ...validManifest,
        renderers: ['ascii', 'hologram'],
      }),
    ).toThrow('unknown renderer')

    expect(() =>
      validateBuddyManifest({
        ...validManifest,
        states: {
          idle: { animation: 'idle' },
          sleeping: { animation: 'sleep' },
        },
      }),
    ).toThrow('unknown state')
  })

  test('loads and lists local buddy packs', () => {
    const home = mkdtempSync(join(tmpdir(), 'buddy-protocol-'))
    const packDir = join(home, 'buddies', 'spark')
    mkdirSync(join(packDir, 'assets'), { recursive: true })
    writeFileSync(join(packDir, 'buddy.json'), JSON.stringify(validManifest))
    writeFileSync(
      join(packDir, 'ascii.json'),
      JSON.stringify({ states: { idle: [['(^_^)']], running: [['run']] } }),
    )

    const loaded = loadBuddyPack(packDir)
    expect(loaded.manifest.displayName).toBe('Spark')
    expect(listBuddyPacks(home).map(pack => pack.manifest.id)).toEqual([
      'spark',
    ])
    expect(renderBuddyPackAscii(loaded, 'idle')).toEqual(['(^_^)'])
  })

  test('resolves relative assets from pack directory', () => {
    // Use a platform-absolute pack dir so path.resolve does not join cwd.
    const packDir = join(tmpdir(), 'spark-pack')
    const asset = resolveBuddyAsset(
      validateBuddyManifest(validManifest),
      packDir,
      'model3d',
    )
    expect(asset?.path.replaceAll('\\', '/')).toBe(
      join(packDir, 'assets', 'model.glb').replaceAll('\\', '/'),
    )
  })

  test('runtime maps host events to stable states', async () => {
    const runtime = createBuddyRuntime(builtinBuddyManifest)

    await dispatchBuddyEvent(runtime, {
      type: 'task.progress',
      text: 'building',
    })
    expect(runtime.state).toBe('running')

    await dispatchBuddyEvent(runtime, {
      type: 'task.waiting',
      reason: 'approval',
    })
    expect(runtime.state).toBe('waiting')

    await dispatchBuddyEvent(runtime, { type: 'task.failed', error: 'boom' })
    expect(runtime.state).toBe('failed')
  })

  test('buddy profile helpers hatch, pet, and mute predictably', () => {
    const buddy = hatchBuddy({
      name: 'Spark',
      personality: 'warm',
      packId: 'spark-pack',
      seed: 'fixed',
      now: 123,
    })

    expect(buddy).toMatchObject({
      id: 'buddy-123',
      name: 'Spark',
      packId: 'spark-pack',
      seed: 'fixed',
      hatchedAt: 123,
      muted: false,
    })
    expect(petBuddy(muteBuddy(buddy), 456)).toMatchObject({
      muted: false,
      lastPetAt: 456,
    })
  })

  test('parses and generates buddy reactions through caller supplied model', async () => {
    expect(parseBuddyReaction('{"reaction":"Ship it."}')).toBe('Ship it.')
    expect(parseBuddyReaction('Plain reaction')).toBe('Plain reaction')
    expect(parseBuddyReaction('{"reaction":42}')).toBeNull()

    const reaction = await reactBuddy({
      buddy: { name: 'Spark', personality: 'warm', species: 'robot' },
      transcript: 'user: hello',
      generate: async input => {
        expect(input.schema.required).toEqual(['reaction'])
        expect(input.systemPrompt).toContain('Spark')
        return '{"reaction":"On it."}'
      },
    })

    expect(reaction).toBe('On it.')
  })
})
