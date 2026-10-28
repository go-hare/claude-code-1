import { describe, expect, test } from 'bun:test'
import { djb2Hash } from '../../utils/hash.js'
import {
  TURN_COMPLETION_VERBS,
  turnCompletionVerbFromUuid,
} from '../turnCompletionVerbs.js'

describe('densable 2.1.289 ig turn-completion verb', () => {
  test('hashes uuid with djb2 >>> 0 % 8, not lodash sample', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const index = (djb2Hash(uuid) >>> 0) % TURN_COMPLETION_VERBS.length
    expect(turnCompletionVerbFromUuid(uuid)).toBe(TURN_COMPLETION_VERBS[index])
    expect(turnCompletionVerbFromUuid(uuid)).toBe(
      turnCompletionVerbFromUuid(uuid),
    )
  })

  test('empty uuid is Baked (hash 0)', () => {
    expect(turnCompletionVerbFromUuid('')).toBe('Baked')
  })

  test('SystemTextMessage uses uuid hash, not lodash sample', async () => {
    const src = await Bun.file(
      new URL(
        '../../components/messages/SystemTextMessage.tsx',
        import.meta.url,
      ),
    ).text()
    expect(src).toContain('turnCompletionVerbFromUuid')
    expect(src).not.toContain("from 'lodash-es/sample.js'")
  })
})
