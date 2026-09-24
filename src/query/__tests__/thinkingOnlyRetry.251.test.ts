/**
 * densable 2.1.251 #11 — jlt + thinking_only_retry.
 * Gold Pe continues with thinkingOnlyNudged:!0 on the loop bag (not React AppState).
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

  test('nudge is turnCompanion, yielded, and thinking_only_retry with Pe latch', () => {
    const at = querySrc.indexOf("reason: 'thinking_only_retry'")
    expect(at).toBeGreaterThan(0)
    const window = querySrc.slice(at - 900, at + 80)
    expect(window).toContain('THINKING_ONLY_RETRY_PROMPT')
    expect(window).toContain('turnCompanion: true')
    expect(window).toContain('yield nudgeMessage')
    expect(window).toContain('isMeta: true')
    expect(window).toContain('stopHookActive')
    expect(window).not.toContain('stopHookActive: undefined')
    // densable Pe.thinkingOnlyNudged:!0 on the continue bag
    expect(window).toContain('thinkingOnlyNudged: true')
    expect(window.toLowerCase()).not.toContain('bedrock')
    expect(window.toLowerCase()).not.toContain('vertex')
    expect(window.toLowerCase()).not.toContain('foundry')
  })

  test('State bag carries thinkingOnlyNudged; first iteration seeds false', () => {
    const stateBlock = querySrc.slice(
      querySrc.indexOf('type State = {'),
      querySrc.indexOf('export async function* query('),
    )
    expect(stateBlock).toContain('thinkingOnlyNudged: boolean')
    expect(querySrc).toContain('thinkingOnlyNudged: false')
    expect(querySrc).toContain('thinkingOnlyNudged,')
    // not a free loop-local latch
    expect(querySrc).not.toMatch(/let thinkingOnlyNudged\s*=/)
    expect(querySrc).not.toContain('normalizeMessagesForAPI(messagesForQuery')
  })

  test('success arm does not clear the Pe latch mid-window', () => {
    const at = querySrc.indexOf("reason: 'thinking_only_retry'")
    expect(at).toBeGreaterThan(0)
    const window = querySrc.slice(at, at + 900)
    expect(window).not.toContain('thinkingOnlyNudged = false')
    expect(window).not.toContain('else if (thinkingOnlyNudged)')
  })
})
