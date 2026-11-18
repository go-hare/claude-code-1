import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('2.1.299 #663 /clear writes bridgeSessionId tombstone before rotating session ID', () => {
  test('clearConversation calls clearBridgeSession before regenerateSessionId', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'conversation.ts'),
      'utf8',
    )
    const clearBridgeIdx = src.indexOf('clearBridgeSession()')
    const regenIdx = src.indexOf('regenerateSessionId({')
    expect(clearBridgeIdx).toBeGreaterThan(-1)
    expect(regenIdx).toBeGreaterThan(clearBridgeIdx)
  })
})
