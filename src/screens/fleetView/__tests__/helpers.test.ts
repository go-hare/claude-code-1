import { describe, expect, test } from 'bun:test'
import type { SessionEntry } from '../../../cli/bg/engine.js'
import {
  buildCustomGroupModeFlatRows,
  buildCwdBasenameMap,
  buildDirectoryModeFlatRows,
  buildFleetFooterHints,
  buildStateModeFlatRows,
  computeFleetColumnWidths,
  deriveBand,
  deriveStatsBand,
  doneCapForRows,
  fleetDoneFoldAt,
  fleetHeaderBudget,
  fleetXfaListEstimate,
  shouldCompactFleetHeader,
  expandPastedTextRefs,
  formatPastedTextPlaceholder,
  FLEET_STATE_GROUP_DESCRIPTIONS,
  FLEET_STATE_GROUP_LABELS,
  formatAttachError,
  formatJobAge,
  isOriginSessionId,
  normalizeFleetGroupName,
  parseDispatch,
  partitionArchivedSessions,
  pickIcon,
  sessionArtifactLabel,
  sortSessions,
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

  test('doneCap=0 folds all done jobs; Infinity shows all', () => {
    const done = Array.from({ length: 3 }, (_, i) =>
      session({ pid: 200 + i, status: 'completed', name: `z${i}` }),
    )
    const zero = buildStateModeFlatRows({
      pinned: [],
      review: [],
      blocked: [],
      working: [],
      done,
      foldedGroups: new Set(),
      doneCap: 0,
      doneCapExpanded: false,
    })
    expect(zero.filter(r => r.kind === 'job')).toHaveLength(0)
    expect(zero.find(r => r.kind === 'fold')).toEqual({
      kind: 'fold',
      group: 'done',
      hidden: 3,
    })

    const inf = buildStateModeFlatRows({
      pinned: [],
      review: [],
      blocked: [],
      working: [],
      done,
      foldedGroups: new Set(),
      doneCap: Number.POSITIVE_INFINITY,
      doneCapExpanded: false,
    })
    expect(inf.filter(r => r.kind === 'job')).toHaveLength(3)
    expect(inf.find(r => r.kind === 'fold')).toBeUndefined()
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

describe('shouldCompactFleetHeader / fleetHeaderBudget (densable XFa)', () => {
  test('tall terminal with few list rows keeps full header', () => {
    expect(shouldCompactFleetHeader(54, 5)).toBe(false)
    expect(fleetHeaderBudget(54, 5).compactHeader).toBe(false)
    expect(fleetHeaderBudget(54, 5).doneCap).toBeGreaterThanOrEqual(3)
  })

  test('short 20-row terminal with many rows compacts (hide Clawd)', () => {
    // 20 - 8 chrome - 4 full header - 12 list = -4 < 3 → compact
    expect(shouldCompactFleetHeader(20, 12)).toBe(true)
    expect(fleetHeaderBudget(20, 12).compactHeader).toBe(true)
  })

  test('borderline: full header only when remaining free rows >= 3', () => {
    // remaining(full) = rows - 8 - 4 - list
    // 30-8-4-15 = 3 → full
    expect(fleetHeaderBudget(30, 15).compactHeader).toBe(false)
    // 30-8-4-16 = 2 → compact
    expect(fleetHeaderBudget(30, 16).compactHeader).toBe(true)
  })

  test('fleetXfaListEstimate matches densable t formulas', () => {
    // state: non-done + max(0, groups*2-1)
    expect(
      fleetXfaListEstimate({
        mode: 'state',
        distinctGroupCount: 3,
        visibleNonDoneJobs: 5,
      }),
    ).toBe(5 + 5) // max(0, 3*2-1)=5
    expect(
      fleetXfaListEstimate({
        mode: 'state',
        distinctGroupCount: 0,
        visibleNonDoneJobs: 2,
      }),
    ).toBe(2)
    // other: allJobs + groupPad
    expect(
      fleetXfaListEstimate({
        mode: 'other',
        distinctGroupCount: 2,
        allJobs: 10,
      }),
    ).toBe(10 + 3)
  })

  test('fleetDoneFoldAt uses densable JFa=3 hysteresis', () => {
    // total 4, doneCap 2 → 4 < 2+3 → no fold
    expect(fleetDoneFoldAt(4, 0, 2)).toBe(Number.POSITIVE_INFINITY)
    // total 5, doneCap 2 → 5 >= 5 → fold at 2
    expect(fleetDoneFoldAt(5, 0, 2)).toBe(2)
    // doneCap 0 with enough items folds everything
    expect(fleetDoneFoldAt(3, 0, 0)).toBe(0)
    expect(fleetDoneFoldAt(2, 0, 0)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('deriveStatsBand (densable O7e / RU)', () => {
  test('busy/running → active; waiting → blocked; completed → completed', () => {
    expect(deriveStatsBand(session({ pid: 1, status: 'busy' }))).toBe('active')
    expect(deriveStatsBand(session({ pid: 2, status: 'waiting' }))).toBe(
      'blocked',
    )
    expect(deriveStatsBand(session({ pid: 3, status: 'completed' }))).toBe(
      'completed',
    )
  })

  test('pinned busy still active; PR-review completed still completed (not review)', () => {
    expect(
      deriveStatsBand(session({ pid: 1, status: 'busy', pinned: true })),
    ).toBe('active')
    expect(
      deriveStatsBand(
        session({
          pid: 2,
          status: 'completed',
          prReviewState: 'pending',
        }),
      ),
    ).toBe('completed')
  })
})

describe('sessionArtifactLabel + computeFleetColumnWidths', () => {
  test('zhO multi / single / bare PR labels', () => {
    expect(
      sessionArtifactLabel(
        session({ pid: 1, status: 'busy', prCount: 3, prNumber: 1 }),
      ),
    ).toBe('3 PRs')
    expect(
      sessionArtifactLabel(
        session({
          pid: 2,
          status: 'busy',
          prNumber: 42,
          prUrl: 'https://github.com/o/r/pull/42',
        }),
      ),
    ).toBe('PR #42')
    expect(
      sessionArtifactLabel(
        session({
          pid: 3,
          status: 'busy',
          prUrl: 'https://github.com/o/r/pull/x',
        }),
      ),
    ).toBe('PR')
    expect(sessionArtifactLabel(session({ pid: 4, status: 'busy' }))).toBe('')
  })

  test('$hO clamps label 12–40 and hides artifact when empty', () => {
    const noPr = computeFleetColumnWidths([
      session({ pid: 1, status: 'busy', name: 'ab' }),
    ])
    expect(noPr.label).toBe(12)
    expect(noPr.artifact).toBe(0)
    expect(noPr.age).toBeGreaterThanOrEqual(3)

    const withPr = computeFleetColumnWidths([
      session({
        pid: 2,
        status: 'busy',
        name: 'x'.repeat(50),
        prNumber: 99,
        prUrl: 'https://github.com/o/r/pull/99',
      }),
    ])
    expect(withPr.label).toBe(40)
    expect(withPr.artifact).toBe('PR #99'.length)
  })
})

describe('formatAttachError', () => {
  test('maps ENOJOB / still-starting class to settle copy', () => {
    expect(formatAttachError('ENOJOB: job not found')).toBe(
      'Session is still starting \u2014 try again in a moment',
    )
    expect(formatAttachError('socket missing')).toBe(
      'Session is still starting \u2014 try again in a moment',
    )
  })

  test("prefixes other failures with Couldn't attach", () => {
    expect(formatAttachError('timeout')).toBe("Couldn't attach \u2014 timeout")
    expect(formatAttachError("Couldn't attach \u2014 boom")).toBe(
      "Couldn't attach \u2014 boom",
    )
    expect(formatAttachError(undefined)).toBe("Couldn't attach to that session")
  })
})

describe('formatJobAge', () => {
  test('official mostSignificantOnly units (s/m/h/d)', () => {
    const now = 1_000_000_000_000
    expect(formatJobAge(now - 19_000, now)).toBe('19s')
    expect(formatJobAge(now - 90_000, now)).toBe('1m')
    expect(formatJobAge(now - 3_600_000, now)).toBe('1h')
    expect(formatJobAge(now - 86_400_000, now)).toBe('1d')
    expect(formatJobAge(now - 30 * 86_400_000, now)).toBe('30d')
  })

  test('invalid / future timestamps do not explode', () => {
    const now = 1_000_000_000_000
    expect(formatJobAge(Number.NaN, now)).toBe('')
    expect(formatJobAge(now + 5_000, now)).toBe('0s')
  })
})

describe('isOriginSessionId', () => {
  test('matches full sessionId, short, or prefix', () => {
    const s = session({
      pid: 1,
      status: 'busy',
      sessionId: 'abcdef12-3456-7890',
      short: 'ab12cd',
    })
    expect(isOriginSessionId(s, 'abcdef12-3456-7890')).toBe(true)
    expect(isOriginSessionId(s, 'ab12cd')).toBe(true)
    expect(isOriginSessionId(s, 'abcdef12')).toBe(true)
    expect(isOriginSessionId(s, 'other')).toBe(false)
    expect(isOriginSessionId(s, undefined)).toBe(false)
  })
})

describe('partitionArchivedSessions', () => {
  test('splits archived into earlier', () => {
    const { active, earlier } = partitionArchivedSessions([
      session({ pid: 1, status: 'busy', archived: true }),
      session({ pid: 2, status: 'busy' }),
      session({ pid: 3, status: 'completed', archived: true }),
    ])
    expect(active.map(s => s.pid)).toEqual([2])
    expect(earlier.map(s => s.pid)).toEqual([1, 3])
  })
})

describe('normalizeFleetGroupName', () => {
  test('trims, strips control, rejects empty and reserved', () => {
    expect(normalizeFleetGroupName('  alpha  ')).toBe('alpha')
    expect(normalizeFleetGroupName('')).toBeUndefined()
    expect(normalizeFleetGroupName('   ')).toBeUndefined()
    expect(normalizeFleetGroupName('pinned')).toBeUndefined()
    expect(normalizeFleetGroupName('(ungrouped)')).toBeUndefined()
    expect(normalizeFleetGroupName('working')).toBeUndefined()
  })

  test('caps at 64 chars', () => {
    const long = 'g'.repeat(80)
    expect(normalizeFleetGroupName(long)?.length).toBe(64)
  })
})

describe('sortSessions', () => {
  test('honors sortOrder after band', () => {
    const rows = sortSessions([
      session({ pid: 1, status: 'busy', sortOrder: 2, startedAt: 100 }),
      session({ pid: 2, status: 'busy', sortOrder: 0, startedAt: 50 }),
      session({ pid: 3, status: 'waiting', startedAt: 200 }),
    ])
    expect(rows.map(s => s.pid)).toEqual([3, 2, 1])
  })
})

describe('buildCustomGroupModeFlatRows', () => {
  test('group headers + earlier fold', () => {
    const rows = buildCustomGroupModeFlatRows({
      groups: [
        ['alpha', [session({ pid: 1, status: 'busy', group: 'alpha' })]],
        ['(ungrouped)', [session({ pid: 2, status: 'busy' })]],
      ],
      foldedGroups: new Set(),
      earlier: [session({ pid: 9, status: 'completed', archived: true })],
      earlierExpanded: false,
    })
    expect(
      rows
        .filter(r => r.kind === 'header')
        .map(r => (r.kind === 'header' ? r.group : '')),
    ).toEqual(['group:alpha', 'group:(ungrouped)', 'earlier'])
    expect(rows.find(r => r.kind === 'fold')).toEqual({
      kind: 'fold',
      group: 'earlier',
      hidden: 1,
    })
  })
})

describe('buildFleetFooterHints', () => {
  test('exit / group / help / list chords', () => {
    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: false,
        ungroupPending: false,
        canPin: true,
        canGroup: true,
        canRename: true,
        openSlots: 3,
        exitArmed: true,
        runningCount: 2,
        helpOpen: false,
      }),
    ).toContain('Press Esc/Ctrl-C again to exit')

    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'group',
        deletePending: false,
        ungroupPending: false,
        canPin: false,
        canGroup: true,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      }),
    ).toContain('enter to set group')

    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: false,
        ungroupPending: false,
        rowKind: 'job',
        band: 'blocked',
        canPin: true,
        canGroup: true,
        canRename: true,
        pinned: false,
        openSlots: 1,
        exitArmed: false,
        runningCount: 1,
        helpOpen: false,
      }),
    ).toMatch(/ctrl\+e to set group/)

    expect(FLEET_STATE_GROUP_DESCRIPTIONS.blocked.length).toBeGreaterThan(0)
    expect(FLEET_STATE_GROUP_LABELS.working).toBe('Working')
  })

  test('help mode and mention / bash dispatch footer', () => {
    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: false,
        ungroupPending: false,
        canPin: true,
        canGroup: true,
        canRename: true,
        canMention: true,
        openSlots: 2,
        exitArmed: false,
        runningCount: 0,
        helpOpen: true,
      }),
    ).toContain('@ to mention')

    expect(
      buildFleetFooterHints({
        focusArea: 'dispatch',
        viewMode: 'list',
        deletePending: false,
        ungroupPending: false,
        canPin: false,
        canGroup: false,
        canRename: false,
        bashMode: true,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      }),
    ).toContain('enter run bash')
  })
})

describe('parseDispatch (official e$a)', () => {
  test('bash ! prefix', () => {
    expect(parseDispatch('!ls -la')).toEqual({
      intent: '',
      matched: true,
      exec: 'ls -la',
    })
    expect(parseDispatch('!')).toEqual({
      intent: '',
      matched: false,
      exec: '',
    })
    // empty / whitespace still carries exec key (AgentView empty-bash path)
    expect(parseDispatch('!   ').exec).toBe('')
    expect(Object.hasOwn(parseDispatch('!'), 'exec')).toBe(true)
    expect(Object.hasOwn(parseDispatch('fix me'), 'exec')).toBe(false)
  })

  test('skips a:/s:/o: prefixes', () => {
    expect(parseDispatch('a:foo').matched).toBe(false)
    expect(parseDispatch('s:bar').intent).toBe('')
  })

  test('@mention strips template / cwd / routine', () => {
    const r = parseDispatch(
      'fix flaky @auth @myrepo',
      [{ name: 'auth' }],
      { myrepo: '/tmp/myrepo' },
      [],
    )
    expect(r.templateName).toBe('auth')
    expect(r.cwd).toBe('/tmp/myrepo')
    expect(r.intent).toBe('fix flaky')
    expect(r.matched).toBe(true)
  })

  test('leading template token', () => {
    const r = parseDispatch('review look at pr', [{ name: 'review' }])
    expect(r.matched).toBe(true)
    expect(r.templateName).toBe('review')
    expect(r.intent).toBe('look at pr')
  })

  test('matched template alone is enough for H5b (empty intent ok)', () => {
    const r = parseDispatch('review', [{ name: 'review' }])
    expect(r.matched).toBe(true)
    expect(r.intent).toBe('')
    // AgentView short-prompt guard skips when matched
    expect(r.matched || r.intent.length >= 4).toBe(true)
  })
})

describe('paste helpers', () => {
  test('formatPastedTextPlaceholder + expandPastedTextRefs', () => {
    expect(formatPastedTextPlaceholder(1, 0)).toBe('[Pasted text #1]')
    expect(formatPastedTextPlaceholder(2, 3)).toBe('[Pasted text #2 +3 lines]')
    const expanded = expandPastedTextRefs('before [Pasted text #1] after', {
      1: 'HELLO',
    })
    expect(expanded).toBe('before HELLO after')
  })

  test('buildCwdBasenameMap', () => {
    const map = buildCwdBasenameMap([
      session({ pid: 1, status: 'running', cwd: '/a/myproj' }),
      session({ pid: 2, status: 'running', cwd: '/b/other' }),
    ])
    expect(map.myproj).toBe('/a/myproj')
    expect(map.other).toBe('/b/other')
  })
})
