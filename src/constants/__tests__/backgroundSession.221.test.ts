/**
 * densable 2.1.221 #28 — Background Session finish policy (hIb / EGu).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  getBackgroundSessionInstructions,
  getScratchpadInstructions,
} from '../prompts.js'

const SNAP_KEYS = [
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_JOB_DIR',
  'CLAUDE_BG_ISOLATION',
] as const

function snapEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {}
  for (const k of SNAP_KEYS) {
    prev[k] = process.env[k]
  }
  return prev
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const k of SNAP_KEYS) {
    if (prev[k] === undefined) delete process.env[k]
    else process.env[k] = prev[k]
  }
}

describe('getBackgroundSessionInstructions densable 2.1.221', () => {
  let prev: Record<string, string | undefined>

  afterEach(() => {
    if (prev) restoreEnv(prev)
  })

  test('null when not a bg session', () => {
    prev = snapEnv()
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.CLAUDE_JOB_DIR
    expect(getBackgroundSessionInstructions()).toBeNull()
  })

  test('null when bg without CLAUDE_JOB_DIR', () => {
    prev = snapEnv()
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    delete process.env.CLAUDE_JOB_DIR
    expect(getBackgroundSessionInstructions()).toBeNull()
  })

  test('includes commit/push survival + draft PR + never push main', () => {
    prev = snapEnv()
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_JOB_DIR = '/tmp/job-test-221'
    delete process.env.CLAUDE_BG_ISOLATION

    const text = getBackgroundSessionInstructions()
    expect(text).not.toBeNull()
    expect(text!).toContain('# Background Session')
    expect(text!).toContain('commit before finishing')
    expect(text!).toContain('Open a draft PR when the task calls for one')
    expect(text!).toContain('Never push to main/master, force-push, or merge.')
    expect(text!).toContain(join('/tmp/job-test-221', 'tmp'))
    expect(text!).toContain('EnterWorktree')
    expect(text!).toContain('don\'t refer to yourself as "a background agent."')
  })

  test('isolation none skips shipping paragraph', () => {
    prev = snapEnv()
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_JOB_DIR = '/tmp/job-test-221-none'
    process.env.CLAUDE_BG_ISOLATION = 'none'

    const text = getBackgroundSessionInstructions()
    expect(text).not.toBeNull()
    expect(text!).toContain('work in place rather than isolating')
    expect(text!).not.toContain('commit before finishing')
    expect(text!).not.toContain('Open a draft PR when the task calls for one')
  })

  test('scratchpad suppressed for bg sessions', () => {
    prev = snapEnv()
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_JOB_DIR = '/tmp/job-test-221-scratch'
    // getScratchpadInstructions may still be null if scratchpad disabled;
    // when SESSION_KIND=bg it must not return scratchpad guidance.
    const scratch = getScratchpadInstructions()
    if (scratch !== null) {
      // If scratchpad is enabled globally, bg must still suppress it.
      expect(scratch).not.toContain('Scratchpad Directory')
    }
    expect(scratch).toBeNull()
  })
})
