import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

/**
 * densable concurrent onQuery re-queue: Ace-visible meta must survive
 * tryStart() contention with origin/isMeta/skipSlashCommands preserved.
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
})
