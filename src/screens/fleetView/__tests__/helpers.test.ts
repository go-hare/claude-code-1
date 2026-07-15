import { describe, expect, test } from 'bun:test'
import type { SessionEntry } from '../../../cli/bg/engine.js'
import {
  buildDirectoryModeFlatRows,
  buildStateModeFlatRows,
  deriveBand,
  doneCapForRows,
  FLEET_STATE_GROUP_LABELS,
  pickIcon,
} from '../helpers.js'

function session(
  partial: Partial<SessionEntry> & Pick<SessionEntry, 'pid' | 'status'>,
): SessionEntry {
  return {
    sessionId: partial.sessionId ?? `s-${partial.pid}`,
    cwd: partial.cwd ?? '/tmp',
    startedAt: partial.startedAt ?? 1,
    kind: partial.kind ?? 'bg',
    engine: partial.engine ?? 'detached',
    name: partial.name,
    pinned: partial.pinned,
    waitingFor: partial.waitingFor,
    prReviewState: partial.prReviewState,
    lastMessage: partial.lastMessage,
    updatedAt: partial.updatedAt,
    ...partial,
  }
}

describe('deriveBand', () => {
  test('maps waiting and waitingFor to blocked', () => {
    expect(deriveBand(session({ pid: 1, status: 'waiting' }))).toBe('blocked')
    expect(
      deriveBand(session({ pid: 2, status: 'busy', waitingFor: 'ok?' })),
    ).toBe('active') // busy short-circuits before waitingFor
    expect(
      deriveBand(session({ pid: 3, status: 'running', waitingFor: 'ok?' })),
    ).toBe('blocked')
  })

  test('completed with open PR review → review', () => {
    expect(
      deriveBand(
        session({
          pid: 1,
          status: 'completed',
          prReviewState: 'pending',
        }),
      ),
    ).toBe('review')
    expect(
      deriveBand(
        session({
          pid: 2,
          status: 'completed',
          prReviewState: 'approved',
        }),
      ),
    ).toBe('completed')
  })
})

describe('pickIcon', () => {
  test('terminal band uses bullet; others asterisk', () => {
    expect(pickIcon('completed', 'success')).toBe('\u2219')
    expect(pickIcon('completed', 'failure')).toBe('\u2219')
    expect(pickIcon('active', 'flowing')).toBe('\u273B')
    expect(pickIcon('blocked', 'stuck')).toBe('\u273B')
    expect(pickIcon('review', 'success')).toBe('\u273B')
  })
})

describe('buildStateModeFlatRows', () => {
  test('official group order: pinned → review → blocked → working → done', () => {
    const rows = buildStateModeFlatRows({
      pinned: [session({ pid: 1, status: 'busy', pinned: true, name: 'p' })],
      review: [
        session({
          pid: 2,
          status: 'completed',
          prReviewState: 'pending',
          name: 'r',
        }),
      ],
      blocked: [session({ pid: 3, status: 'waiting', name: 'b' })],
      working: [session({ pid: 4, status: 'busy', name: 'w' })],
      done: [session({ pid: 5, status: 'completed', name: 'd' })],
      foldedGroups: new Set(),
      doneCap: 10,
      doneCapExpanded: false,
    })
    const headers = rows
      .filter(r => r.kind === 'header')
      .map(r => (r.kind === 'header' ? r.group : ''))
    expect(headers).toEqual(['pinned', 'review', 'blocked', 'working', 'done'])
    expect(FLEET_STATE_GROUP_LABELS.review).toBe('Ready for review')
    expect(rows.filter(r => r.kind === 'job')).toHaveLength(5)
  })

  test('review sessions appear as jobs (not ghost-count only)', () => {
    const rows = buildStateModeFlatRows({
      pinned: [],
      review: [
        session({
          pid: 9,
          status: 'completed',
          prReviewState: 'changes_requested',
          name: 'needs-review',
        }),
      ],
      blocked: [],
      working: [],
      done: [],
      foldedGroups: new Set(),
      doneCap: 2,
      doneCapExpanded: false,
    })
    expect(rows).toEqual([
      { kind: 'header', group: 'review' },
      {
        kind: 'job',
        session: expect.objectContaining({ name: 'needs-review' }),
      },
    ])
  })

  test('doneCap inserts fold row; expanded shows all', () => {
    const done = Array.from({ length: 5 }, (_, i) =>
      session({ pid: 100 + i, status: 'completed', name: `d${i}` }),
    )
    const folded = buildStateModeFlatRows({
      pinned: [],
      review: [],
      blocked: [],
      working: [],
      done,
      foldedGroups: new Set(),
      doneCap: 2,
      doneCapExpanded: false,
    })
    expect(folded.filter(r => r.kind === 'job')).toHaveLength(2)
    expect(folded.find(r => r.kind === 'fold')).toEqual({
      kind: 'fold',
      group: 'done',
      hidden: 3,
    })

    const expanded = buildStateModeFlatRows({
      pinned: [],
      review: [],
      blocked: [],
      working: [],
      done,
      foldedGroups: new Set(),
      doneCap: 2,
      doneCapExpanded: true,
    })
    expect(expanded.filter(r => r.kind === 'job')).toHaveLength(5)
    expect(expanded.find(r => r.kind === 'fold')).toBeUndefined()
  })

  test('foldedGroups hides jobs but keeps header', () => {
    const rows = buildStateModeFlatRows({
      pinned: [],
      review: [],
      blocked: [session({ pid: 1, status: 'waiting' })],
      working: [session({ pid: 2, status: 'busy' })],
      done: [],
      foldedGroups: new Set(['blocked']),
      doneCap: 5,
      doneCapExpanded: false,
    })
    expect(rows.map(r => r.kind)).toEqual(['header', 'header', 'job'])
    expect(rows[0]).toEqual({ kind: 'header', group: 'blocked' })
    expect(rows[1]).toEqual({ kind: 'header', group: 'working' })
  })
})

describe('buildDirectoryModeFlatRows', () => {
  test('cwd headers are selectable and foldable', () => {
    const rows = buildDirectoryModeFlatRows({
      groups: [
        ['/a', [session({ pid: 1, status: 'busy', cwd: '/a' })]],
        [
          '/b',
          [
            session({ pid: 2, status: 'busy', cwd: '/b' }),
            session({ pid: 3, status: 'waiting', cwd: '/b' }),
          ],
        ],
      ],
      foldedGroups: new Set(['dir:/b']),
    })
    expect(rows).toEqual([
      { kind: 'header', group: 'dir:/a' },
      {
        kind: 'job',
        session: expect.objectContaining({ pid: 1 }),
      },
      { kind: 'header', group: 'dir:/b' },
    ])
  })
})

describe('doneCapForRows', () => {
  test('at least 2 and ~1/5 of rows', () => {
    expect(doneCapForRows(10)).toBe(2)
    expect(doneCapForRows(50)).toBe(10)
  })
})
