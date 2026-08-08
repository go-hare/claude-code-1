/**
 * densable 2.1.218 #8 — non-interactive ultrareview dual registration.
 *
 * Do NOT mock.module('../reviewRemote.js') — Bun mock.module is process-global
 * and would poison ultrareview.218.test.ts (parse/nudge helpers).
 * Headless call path is thin glue over gate/launch already covered elsewhere;
 * here we lock densable nGd/oGd dual registration shape.
 */
import { describe, expect, test } from 'bun:test'
import { ultrareview, ultrareviewNonInteractive } from '../../review.js'

describe('ultrareview dual registration (densable nGd/oGd)', () => {
  test('interactive sibling is local-jsx named ultrareview', () => {
    expect(ultrareview.type).toBe('local-jsx')
    expect(ultrareview.name).toBe('ultrareview')
    if (ultrareview.type === 'local-jsx') {
      expect(typeof ultrareview.load).toBe('function')
    }
  })

  test('non-interactive sibling is local + supportsNonInteractive', () => {
    expect(ultrareviewNonInteractive.type).toBe('local')
    expect(ultrareviewNonInteractive.name).toBe('ultrareview')
    if (ultrareviewNonInteractive.type === 'local') {
      expect(ultrareviewNonInteractive.supportsNonInteractive).toBe(true)
      expect(typeof ultrareviewNonInteractive.load).toBe('function')
    }
  })

  test('headless module exports LocalCommandCall', async () => {
    if (ultrareviewNonInteractive.type !== 'local') {
      throw new Error('expected local command')
    }
    const mod = await ultrareviewNonInteractive.load()
    expect(typeof mod.call).toBe('function')
  })
})
