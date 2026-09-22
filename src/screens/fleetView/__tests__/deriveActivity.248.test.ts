/**
 * densable 2.1.248 #16 Oo — PR-all-MERGED success when template === aF.name
 * ("claude"). Do not invent leftover `bg` === official `claude`.
 *
 * GOLD: Oo @192124798 sha 361a3eb419980f02
 */
import { describe, expect, test } from 'bun:test'
import type { SessionEntry } from '../../../cli/bg/engine.js'
import { deriveActivity } from '../helpers.js'

function session(partial: Partial<SessionEntry> = {}): SessionEntry {
  return {
    pid: 1,
    sessionId: 's-1',
    cwd: '/tmp',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    kind: 'bg',
    status: 'busy',
    ...partial,
  }
}

const href = 'https://github.com/a/b/pull/16'
const merged = new Map([[href, { state: 'MERGED' as const }]])

describe('densable 2.1.248 #16 Oo PR-all-MERGED', () => {
  test('claude + idle + every non-frame child MERGED → success', () => {
    expect(
      deriveActivity(
        session({
          template: 'claude',
          tempo: 'idle',
          children: [{ href, kind: 'pr' }],
        }),
        merged,
      ),
    ).toBe('success')
  })

  test('leftover bg template does not take the official claude arm', () => {
    expect(
      deriveActivity(
        session({
          template: 'bg',
          tempo: 'idle',
          children: [{ href, kind: 'pr' }],
        }),
        merged,
      ),
    ).toBe('flowing')
  })

  test('tempo active skips the MERGED arm', () => {
    expect(
      deriveActivity(
        session({
          template: 'claude',
          tempo: 'active',
          children: [{ href, kind: 'pr' }],
        }),
        merged,
      ),
    ).toBe('flowing')
  })

  test('KC-dirty hrefs are dropped before the every(MERGED) check', () => {
    expect(
      deriveActivity(
        session({
          template: 'claude',
          tempo: 'idle',
          children: [{ href: `${href}\x01`, kind: 'pr' }],
        }),
        new Map([[`${href}\x01`, { state: 'MERGED' as const }]]),
      ),
    ).toBe('flowing')
  })

  test('open PR keeps flowing', () => {
    expect(
      deriveActivity(
        session({
          template: 'claude',
          tempo: 'idle',
          children: [{ href, kind: 'pr' }],
        }),
        new Map([[href, { state: 'OPEN' as const }]]),
      ),
    ).toBe('flowing')
  })
})
