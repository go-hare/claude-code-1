import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

/**
 * densable concurrent onQuery re-queue: Ace-visible meta must survive
 * tryStart() contention with origin/isMeta/skipSlashCommands preserved.
 * Official also rides stopHookActive (e9) + clientPlatform (t5) on the
 * enqueue payload — not message extras / priority inventing.
 */
describe('REPL concurrent onquery densable Ace', () => {
  const src = readFileSync(join(import.meta.dir, '../REPL.tsx'), 'utf8')

  test('uses isMetaVisibleOrigin instead of blanket !isMeta drop', () => {
    expect(src).toContain('isMetaVisibleOrigin')
    expect(src).toContain('tengu_concurrent_onquery_detected')
    expect(src).toContain('skipSlashCommands: isMetaVisibleOrigin')
    // Must not use the old blanket filter that drops all meta
    expect(src).not.toContain(
      ".filter((m): m is UserMessage => m.type === 'user' && !m.isMeta)",
    )
  })

  test('re-queues with origin / isMeta / agentId', () => {
    expect(src).toContain('origin: m.origin')
    expect(src).toContain('isMeta: m.isMeta')
    expect(src).toContain('agentId: getMainThreadAgentId()')
  })

  test('official e9/t5: stopHookActive + clientPlatform on concurrent re-queue', () => {
    expect(src).toContain('stopHookActive')
    expect(src).toContain('clientPlatform')
    // Must ride onQuery args (e9/t5), not invent priority from message extras
    expect(src).toContain(
      '...(stopHookActive !== undefined ? { stopHookActive } : {})',
    )
    expect(src).toContain(
      '...(clientPlatform !== undefined ? { clientPlatform } : {})',
    )
  })
})
