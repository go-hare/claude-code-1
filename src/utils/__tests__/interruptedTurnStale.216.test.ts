/**
 * densable 2.1.216 #40 — Szu max-age suppress for interrupted turn resume.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isResumeInterruptedTurnStale } from '../conversationRecovery.js'

const ROOT = join(import.meta.dir, '../..')

describe('isResumeInterruptedTurnStale densable Szu', () => {
  const prev = process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS
    } else {
      process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS = prev
    }
  })

  test('unset env → never stale', () => {
    const env = { ...process.env }
    delete env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS
    const msgs = [
      {
        type: 'user',
        timestamp: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ]
    expect(isResumeInterruptedTurnStale(msgs, env, Date.now())).toBe(false)
  })

  test('0 → never stale', () => {
    const env = {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '0',
    }
    const msgs = [
      {
        type: 'user',
        timestamp: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ]
    expect(isResumeInterruptedTurnStale(msgs, env, Date.now())).toBe(false)
  })

  test('fresh message within max age → not stale', () => {
    const env = {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '3600000',
    }
    const now = Date.now()
    const msgs = [
      { type: 'user', timestamp: new Date(now - 60_000).toISOString() },
    ]
    expect(isResumeInterruptedTurnStale(msgs, env, now)).toBe(false)
  })

  test('old message past max age → stale', () => {
    const env = {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '1000',
    }
    const now = Date.now()
    const msgs = [
      { type: 'user', timestamp: new Date(now - 5000).toISOString() },
    ]
    expect(isResumeInterruptedTurnStale(msgs, env, now)).toBe(true)
  })

  test('skips system/progress when finding last timestamp', () => {
    const env = {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '1000',
    }
    const now = Date.now()
    const msgs = [
      { type: 'user', timestamp: new Date(now - 5000).toISOString() },
      { type: 'system', timestamp: new Date(now).toISOString() },
      { type: 'progress', timestamp: new Date(now).toISOString() },
    ]
    expect(isResumeInterruptedTurnStale(msgs, env, now)).toBe(true)
  })

  test('invalid numeric falls back to 1h default', () => {
    const env = {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: 'not-a-number',
    }
    const now = Date.now()
    expect(
      isResumeInterruptedTurnStale(
        [{ type: 'user', timestamp: new Date(now - 1000).toISOString() }],
        env,
        now,
      ),
    ).toBe(false)
    expect(
      isResumeInterruptedTurnStale(
        [
          {
            type: 'user',
            timestamp: new Date(now - 3_600_000 - 1).toISOString(),
          },
        ],
        env,
        now,
      ),
    ).toBe(true)
  })

  test('no timestamped messages → stale', () => {
    const env = {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS: '1000',
    }
    expect(
      isResumeInterruptedTurnStale([{ type: 'user' }], env, Date.now()),
    ).toBe(true)
  })
})

describe('deserialize Szu + BJr source contracts', () => {
  test('conversationRecovery wires isResumeInterruptedTurnStale + stale event', () => {
    const src = readFileSync(
      join(ROOT, 'utils/conversationRecovery.ts'),
      'utf8',
    )
    expect(src).toContain('isResumeInterruptedTurnStale')
    expect(src).toContain('tengu_resume_stale_turn_suppressed')
  })

  test('print.ts logs tengu_resume_interrupted_turn on auto-resume', () => {
    const src = readFileSync(join(ROOT, 'cli/print.ts'), 'utf8')
    expect(src).toContain('tengu_resume_interrupted_turn')
    expect(src).toContain('synthetic_continue')
    expect(src).toContain('resubmit')
  })
})
