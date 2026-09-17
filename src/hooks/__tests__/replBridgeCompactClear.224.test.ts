/**
 * densable 2.1.224 #21 — RC clients see compact progress + boundary; /clear
 * propagates conversation_reset (not silent pause / stale transcript).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hook = readFileSync(join(import.meta.dir, '../useReplBridge.tsx'), 'utf8')
const clear = readFileSync(
  join(import.meta.dir, '../../commands/clear/conversation.ts'),
  'utf8',
)
const mappers = readFileSync(
  join(import.meta.dir, '../../utils/messages/mappers.ts'),
  'utf8',
)
const sdkQ = readFileSync(
  join(import.meta.dir, '../../utils/sdkEventQueue.ts'),
  'utf8',
)
const repl = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)

describe('densable 2.1.224 #21 RC compact progress + /clear', () => {
  test('writeMessages filter includes compact_boundary (densable PSt)', () => {
    expect(hook).toContain('isEligibleBridgeMessage')
    expect(hook).toContain("m.subtype === 'compact_boundary'")
    expect(hook).toContain('isCompactionOrSummaryMarker')
  })

  test('toSDKMessages maps compact_boundary for RC wire', () => {
    expect(mappers).toContain("message.subtype === 'compact_boundary'")
    expect(mappers).toContain("subtype: 'compact_boundary' as const")
  })

  test('sdkEventQueue declares status + conversation_reset events', () => {
    expect(sdkQ).toContain("subtype: 'status'")
    expect(sdkQ).toContain("type: 'conversation_reset'")
    expect(sdkQ).toContain('new_conversation_id: string')
  })

  test('bridge drain forwards status + conversation_reset', () => {
    expect(hook).toContain('leftoverL_e')
    expect(hook).toContain('leftoverA_e')
    expect(hook).toContain('hasMatchingQueuedSdkEvent')
    expect(hook).toContain('isBridgeForwardableSdkEvent')
    expect(sdkQ).toContain("event.type === 'conversation_reset'")
    expect(sdkQ).toContain("event.subtype === 'status'")
  })

  test('REPL setSDKStatus enqueues compacting status for bridge', () => {
    expect(repl).toContain('setSDKStatus:')
    expect(repl).toContain("subtype: 'status'")
    expect(repl).toContain("status === 'requesting'")
    expect(repl).toContain('enqueueSdkEvent')
  })

  test('/clear notifies conversation_reset after regenerateSessionId', () => {
    expect(clear).toContain("type: 'conversation_reset' as const")
    expect(clear).toContain('new_conversation_id:')
    // order: regenerate then notify call (not the function definition)
    const regen = clear.indexOf(
      'regenerateSessionId({ setCurrentAsParent: true })',
    )
    expect(regen).toBeGreaterThan(-1)
    const afterRegen = clear.slice(regen)
    expect(afterRegen).toContain('notifyRemoteConversationCleared()')
    // old wrong wire shape gone
    expect(clear).not.toContain("status: 'conversation_cleared'")
  })
})
