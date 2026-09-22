/**
 * densable 2.1.248 #49 — Pe() parent-reply sentence.
 *
 * Source probe (same style as sendMessageBareName.232): bun:bundle `feature()`
 * is a compile-time macro, so getPrompt() cannot flip UDS_INBOX under bun test.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const promptSrc = readFileSync(join(import.meta.dir, '../prompt.ts'), 'utf8')

describe('densable 2.1.248 #49 Pe parent reply', () => {
  test('UDS_INBOX Cross-session block says replies land on the parent conversation', () => {
    expect(promptSrc).toContain("feature('UDS_INBOX')")
    expect(promptSrc).toContain(
      "Cross-session messages travel between SESSIONS: if you are a subagent, your send goes out under your parent session's address, and any reply is delivered to the parent session's conversation, not to you.",
    )
  })
})
