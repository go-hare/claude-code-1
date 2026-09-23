/**
 * densable 2.1.251 #11 — jlt + thinking_only_retry already local.
 * Gold also sets turnCompanion and yields the nudge. State has no
 * thinkingOnlyNudged field — do not invent one.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THINKING_ONLY_RETRY_PROMPT } from '../../query.js'

const querySrc = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')

describe('densable 2.1.251 #11 thinking-only nudge', () => {
  test('jlt text is the gold visible-output prompt', () => {
    expect(THINKING_ONLY_RETRY_PROMPT).toBe(
      '[Your previous response had no visible output. Please continue and produce a user-visible response.]',
    )
  })

  test('nudge is turnCompanion, yielded, and thinking_only_retry', () => {
    const at = querySrc.indexOf("reason: 'thinking_only_retry'")
    expect(at).toBeGreaterThan(0)
    const window = querySrc.slice(at - 800, at + 80)
    expect(window).toContain('THINKING_ONLY_RETRY_PROMPT')
    expect(window).toContain('turnCompanion: true')
    expect(window).toContain('yield nudgeMessage')
    expect(window).toContain('isMeta: true')
    expect(window.toLowerCase()).not.toContain('bedrock')
    expect(window.toLowerCase()).not.toContain('vertex')
    expect(window.toLowerCase()).not.toContain('foundry')
  })

  test('does not invent thinkingOnlyNudged on State or normalizeMessagesForAPI', () => {
    const stateBlock = querySrc.slice(
      querySrc.indexOf('type State = {'),
      querySrc.indexOf('export async function* query('),
    )
    expect(stateBlock).not.toContain('thinkingOnlyNudged')
    expect(querySrc).not.toContain('normalizeMessagesForAPI(messagesForQuery')
  })
})
