import { describe, expect, test } from 'bun:test'
import {
  allocateNumberedJobName,
  parseJobNameGeneration,
  settleBackgroundSeedName,
} from '../jobNameSettle.js'

describe('parseJobNameGeneration (official ro)', () => {
  test('plain name is generation 1', () => {
    expect(parseJobNameGeneration('my-session')).toEqual({
      base: 'my-session',
      generation: 1,
    })
  })

  test('parses trailing (N)', () => {
    expect(parseJobNameGeneration('my-session (2)')).toEqual({
      base: 'my-session',
      generation: 2,
    })
  })
})

describe('allocateNumberedJobName (official Ln)', () => {
  test('keeps the name when it is free', () => {
    expect(allocateNumberedJobName('my-session', ['other'])).toBe('my-session')
  })

  test('numbers the next row when the base is taken', () => {
    expect(allocateNumberedJobName('my-session', ['my-session'])).toBe(
      'my-session (2)',
    )
  })

  test('walks past existing generations', () => {
    expect(
      allocateNumberedJobName('my-session', ['my-session', 'my-session (2)']),
    ).toBe('my-session (3)')
  })

  test('compares via normalized keys', () => {
    expect(allocateNumberedJobName('My Session', ['my-session'])).toBe(
      'My Session (2)',
    )
  })
})

describe('settleBackgroundSeedName (official co)', () => {
  test('leaves unnamed seeds alone', async () => {
    const seed = await settleBackgroundSeedName(
      { intent: 'x' },
      { listNames: async () => ['my-session'] },
    )
    expect(seed).toEqual({ intent: 'x' })
  })

  test('sets nameSource collision when numbering', async () => {
    const seed = await settleBackgroundSeedName(
      { intent: 'x', name: 'my-session', nameSource: 'user' },
      { listNames: async () => ['my-session'] },
    )
    expect(seed.intent).toBe('x')
    expect(seed.name).toBe('my-session (2)')
    expect(seed.nameSource as string).toBe('collision')
  })

  test('returns the seed when listing times out', async () => {
    const seed = await settleBackgroundSeedName(
      { intent: 'x', name: 'my-session', nameSource: 'user' },
      {
        timeoutMs: 10,
        listNames: () => new Promise(() => {}),
      },
    )
    expect(seed.name).toBe('my-session')
    expect(seed.nameSource).toBe('user')
  })
})
