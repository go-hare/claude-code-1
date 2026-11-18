import { describe, expect, test } from 'bun:test'
import { findSession, rankJobNameMatch } from '../bg.js'

describe('cli/bg v2.1.290 (#7 partial name attach/logs)', () => {
  test('rankJobNameMatch scores exact name 3, substring name 2, intent 1, none 0', () => {
    expect(
      rankJobNameMatch(
        { name: 'fix-auth', displayIntent: 'Fix login bug', intent: 'fix' },
        'fix-auth',
      ),
    ).toBe(3)
    expect(
      rankJobNameMatch(
        { name: 'fix-auth', displayIntent: 'Fix login bug', intent: 'fix' },
        'auth',
      ),
    ).toBe(2)
    expect(
      rankJobNameMatch(
        { name: 'other', displayIntent: 'Fix login bug', intent: 'fix' },
        'login',
      ),
    ).toBe(1)
    expect(
      rankJobNameMatch(
        { name: 'other', displayIntent: 'Fix login bug', intent: 'fix' },
        'zzz',
      ),
    ).toBe(0)
  })

  test('findSession matches unique partial case-insensitive session name', () => {
    const sessions = [
      {
        pid: 101,
        sessionId: 'aaaa1111',
        kind: 'bg' as const,
        cwd: '/tmp',
        startedAt: 1,
        name: 'Auth-Refactor',
      },
      {
        pid: 102,
        sessionId: 'bbbb2222',
        kind: 'bg' as const,
        cwd: '/tmp',
        startedAt: 2,
        name: 'UI-Polish',
      },
    ]

    expect(findSession(sessions, 'auth')?.sessionId).toBe('aaaa1111')
    expect(findSession(sessions, 'polish')?.sessionId).toBe('bbbb2222')
    // Ambiguous partial name returns undefined
    expect(findSession(sessions, '-')?.sessionId).toBeUndefined()
  })
})
