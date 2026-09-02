import { describe, expect, test } from 'bun:test'
import type { SessionEntry } from '../../../cli/bg/engine.js'
import {
  buildCustomGroupModeFlatRows,
  buildCwdBasenameMap,
  buildDirectoryModeFlatRows,
  buildFleetFooterHints,
  buildStateModeFlatRows,
  buildSimpleModeFlatRows,
  FLEET_SIMPLE_FINISHED_GROUP,
  simpleStatusBand,
  computeFleetColumnWidths,
  fleetHomeIdx,
  deriveBand,
  deriveStatsBand,
  doneCapForRows,
  fleetDoneFoldAt,
  fleetHeaderBudget,
  fleetXfaListEstimate,
  shouldCompactFleetHeader,
  expandPastedTextRefs,
  formatPastedTextPlaceholder,
  formatFleetImagePlaceholder,
  parseFleetPasteRefs,
  isFleetImagePasteKey,
  fleetPastedImageExt,
  materializeFleetPastedImages,
  fleetStateSortKey,
  planFleetReorder,
  shouldFleetViewReorder,
  FLEET_CLIPBOARD_IMAGE_NOT_FOUND,
  FLEET_CLIPBOARD_IMAGE_READ_FAILED,
  FLEET_SIMPLE_PINNED_GROUP,
  FLEET_STATE_GROUP_DESCRIPTIONS,
  FLEET_STATE_GROUP_LABELS,
  fleetViewPageJump,
  formatAttachError,
  formatJobAge,
  hasComposedDispatch,
  isOriginSessionId,
  navigateFleetViewByArrow,
  normalizeFleetGroupName,
  parseDispatch,
  partitionArchivedSessions,
  shouldFleetViewArrowDelegateToEditor,
  shouldFleetViewRightOpenFocusedRow,
  shouldFleetViewSimpleViewSkipLeftover,
  shouldFleetViewTabToggleAllAgents,
  shouldFleetViewCycleGroupMode,
  shouldFleetViewEnterBashFromBang,
  shouldFleetViewToggleHelp,
  isFleetComposerActive,
  buildFleetComposerSuggestions,
  fleetSuggestionDisplayText,
  sortFleetTemplatesByLastUsed,
  migrateAgentLastUsedFromJobs,
  isFleetNewSessionSpawnBusy,
  formatFleetNewSessionThrow,
  findFleetJobByShort,
  waitForFleetJobByShort,
  FLEET_DEFAULT_TEMPLATE_NAME,
  FLEET_NEW_SESSION_PENDING_MSG,
  FLEET_NEW_SESSION_WAIT_MS,
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
        group: 'state:review',
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
        group: 'dir:/a',
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

  test('honors stateSortOrder for unpinned after band', () => {
    const rows = sortSessions([
      session({ pid: 1, status: 'busy', stateSortOrder: 2, startedAt: 100 }),
      session({ pid: 2, status: 'busy', stateSortOrder: 0, startedAt: 50 }),
    ])
    expect(rows.map(s => s.pid)).toEqual([2, 1])
  })
})

describe('buildSimpleModeFlatRows (densable oxy)', () => {
  const now = 1_700_000_000_000
  const old = now - 172_800_000 - 1

  test('first row is newsession; no headers; home is 0', () => {
    const { rows } = buildSimpleModeFlatRows({
      sessions: [
        session({ pid: 1, status: 'busy', name: 'live' }),
        session({ pid: 2, status: 'waiting', name: 'need' }),
        session({ pid: 3, status: 'completed', name: 'done', updatedAt: now }),
      ],
      now,
      terminalRows: 40,
      showFinishedEarlier: false,
    })
    expect(rows[0]).toEqual({ kind: 'newsession' })
    expect(rows.some(r => r.kind === 'header')).toBe(false)
    expect(
      rows
        .filter(r => r.kind === 'job')
        .map(r => (r.kind === 'job' ? r.session.name : '')),
    ).toEqual(['need', 'live', 'done'])
  })

  test('pinned before needs/live/done; pinned still counted for budget', () => {
    const { rows } = buildSimpleModeFlatRows({
      sessions: [
        session({ pid: 1, status: 'busy', pinned: true, name: 'pin' }),
        session({ pid: 2, status: 'waiting', name: 'need' }),
        session({ pid: 3, status: 'busy', name: 'live' }),
      ],
      now,
      terminalRows: 40,
      showFinishedEarlier: false,
    })
    expect(rows.map(r => (r.kind === 'job' ? r.session.name : r.kind))).toEqual(
      ['newsession', 'pin', 'need', 'live'],
    )
  })

  test('Q5A=2: a single old done job does not fold', () => {
    const { rows } = buildSimpleModeFlatRows({
      sessions: [
        session({ pid: 1, status: 'completed', name: 'old', updatedAt: old }),
      ],
      now,
      terminalRows: 40,
      showFinishedEarlier: false,
    })
    expect(rows.find(r => r.kind === 'fold')).toBeUndefined()
    expect(rows.filter(r => r.kind === 'job')).toHaveLength(1)
  })

  test('old done jobs fold behind simple:finished; expand shows all', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        pid: 10 + i,
        status: 'completed',
        name: `d${i}`,
        updatedAt: old,
      }),
    )
    const folded = buildSimpleModeFlatRows({
      sessions,
      now,
      terminalRows: 20,
      showFinishedEarlier: false,
    })
    expect(folded.rows[0]).toEqual({ kind: 'newsession' })
    expect(folded.rows.find(r => r.kind === 'header')).toBeUndefined()
    expect(folded.rows.find(r => r.kind === 'fold')).toEqual({
      kind: 'fold',
      group: FLEET_SIMPLE_FINISHED_GROUP,
      hidden: 5,
    })
    expect(folded.rows.filter(r => r.kind === 'job')).toHaveLength(0)

    const expanded = buildSimpleModeFlatRows({
      sessions,
      now,
      terminalRows: 20,
      showFinishedEarlier: true,
    })
    expect(expanded.rows.find(r => r.kind === 'fold')).toBeUndefined()
    expect(expanded.rows.filter(r => r.kind === 'job')).toHaveLength(5)
  })

  test('sAn maps waiting → needs, busy → live, completed → done', () => {
    expect(simpleStatusBand(session({ pid: 1, status: 'waiting' }))).toBe(
      'needs',
    )
    expect(simpleStatusBand(session({ pid: 2, status: 'busy' }))).toBe('live')
    expect(simpleStatusBand(session({ pid: 3, status: 'completed' }))).toBe(
      'done',
    )
  })
})

describe('fleetHomeIdx (densable Wky)', () => {
  test('grouped: first same-cwd job at index 1 is home', () => {
    const job = session({ pid: 1, status: 'busy', cwd: '/proj', name: 'w' })
    const rows = [
      { kind: 'header' as const, group: 'working' },
      { kind: 'job' as const, session: job },
    ]
    expect(fleetHomeIdx(rows, '/proj')).toBe(1)
    expect(fleetHomeIdx(rows, '/other')).toBe(0)
  })

  test('earlier-only list homes on first earlier row', () => {
    const rows = [
      { kind: 'header' as const, group: 'earlier' },
      {
        kind: 'earlier' as const,
        session: session({ pid: 9, status: 'completed', archived: true }),
      },
    ]
    expect(fleetHomeIdx(rows, '/proj')).toBe(1)
  })
})

describe('buildFleetFooterHints newsession', () => {
  test('densable Wcu: arrowRight or enter to start', () => {
    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: false,
        ungroupPending: false,
        rowKind: 'newsession',
        canPin: false,
        canGroup: false,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      }),
    ).toContain('\u2192 or enter to start')
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
    ).toContain('Press Ctrl-C again to exit')

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

  test('@routine is separate from template agent field', () => {
    const r = parseDispatch(
      'look at flaky tests @nightly',
      [{ name: 'auth' }],
      {},
      [{ name: 'nightly' }],
    )
    expect(r.routine).toBe('nightly')
    expect(r.templateName).toBeUndefined()
    expect(r.intent).toBe('look at flaky tests')
    expect(r.matched).toBe(false)
    // Must not be collapsed into templateName (submitDispatch agent vs routine)
    expect(Object.hasOwn(r, 'templateName')).toBe(false)
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

  test('Eet skips Image so base64 never becomes intent', () => {
    expect(formatFleetImagePlaceholder(2)).toBe('[Image #2]')
    expect(
      expandPastedTextRefs('see [Image #2] please', { 2: 'iVBORw0KGgo=' }),
    ).toBe('see [Image #2] please')
    expect(parseFleetPasteRefs('see [Image #2] please')[0]).toMatchObject({
      id: 2,
      kind: 'Image',
    })
  })

  test('OOs: ctrl+v off Windows; meta+v on windows|wsl', () => {
    expect(isFleetImagePasteKey('v', { ctrl: true }, 'macos')).toBe(true)
    expect(isFleetImagePasteKey('v', { ctrl: true }, 'linux')).toBe(true)
    expect(isFleetImagePasteKey('v', { ctrl: true }, 'windows')).toBe(false)
    expect(isFleetImagePasteKey('v', { ctrl: true }, 'wsl')).toBe(true)
    expect(isFleetImagePasteKey('v', { meta: true }, 'windows')).toBe(true)
    expect(isFleetImagePasteKey('v', { meta: true }, 'wsl')).toBe(true)
    expect(isFleetImagePasteKey('v', { meta: true }, 'macos')).toBe(false)
    expect(isFleetImagePasteKey('x', { ctrl: true }, 'macos')).toBe(false)
    expect(FLEET_CLIPBOARD_IMAGE_NOT_FOUND).toBe('No image found in clipboard')
    expect(FLEET_CLIPBOARD_IMAGE_READ_FAILED).toBe(
      "Couldn't read an image from the clipboard",
    )
  })

  test('wbs writes pasted-N.ext and replaces [Image #N]', async () => {
    const wrote: string[] = []
    const out = await materializeFleetPastedImages(
      'look at [Image #1] thanks',
      { 1: { type: 'image', content: 'abc123', mediaType: 'image/png' } },
      '/jobs/abcd1234',
      {
        mkdir: async () => {},
        writeBase64: async (file, content) => {
          wrote.push(`${file}:${content}`)
        },
        join: (...parts) => parts.join('/'),
      },
    )
    expect(out).toBe('look at /jobs/abcd1234/pasted-1.png thanks')
    expect(wrote).toEqual(['/jobs/abcd1234/pasted-1.png:abc123'])
  })

  test('wbs ext is alphanumeric subtype only', () => {
    expect(fleetPastedImageExt('image/png')).toBe('png')
    expect(fleetPastedImageExt('image/jpeg')).toBe('jpeg')
    expect(fleetPastedImageExt('image/png; charset=utf-8')).toBe('png')
    expect(fleetPastedImageExt('image/svg+xml')).toBe('png')
    expect(fleetPastedImageExt('image/..\\secret')).toBe('png')
    expect(fleetPastedImageExt(undefined)).toBe('png')
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

describe('densable 2.1.239 JIy Ouu / aVA / page keys', () => {
  test('aVA composed when intent, match, cwd, or exec is set', () => {
    expect(hasComposedDispatch(parseDispatch('do the thing'))).toBe(true)
    expect(
      hasComposedDispatch(parseDispatch('review', [{ name: 'review' }])),
    ).toBe(true)
    expect(hasComposedDispatch(parseDispatch('!ls'))).toBe(true)
    expect(hasComposedDispatch(parseDispatch(''))).toBe(false)
  })

  test('JIy newline up/down delegates to leftover editor', () => {
    expect(shouldFleetViewArrowDelegateToEditor(false, 'a\nb')).toBe(true)
    expect(shouldFleetViewArrowDelegateToEditor(true, 'a\nb')).toBe(false)
    expect(shouldFleetViewArrowDelegateToEditor(false, 'single')).toBe(false)
  })

  test('Ouu wraps; composed+state freezes; composed else skips non-headers', () => {
    const rows = [
      { kind: 'header' as const, group: 'working' },
      { kind: 'job' as const, session: session({ pid: 1, status: 'busy' }) },
      { kind: 'header' as const, group: 'done' },
      {
        kind: 'job' as const,
        session: session({ pid: 2, status: 'completed' }),
      },
    ]
    expect(
      navigateFleetViewByArrow(rows, 1, 1, {
        hasComposedDispatch: false,
        byState: true,
        previewOpen: false,
      }),
    ).toBe(2)
    expect(
      navigateFleetViewByArrow(rows, 1, 1, {
        hasComposedDispatch: true,
        byState: true,
        previewOpen: false,
      }),
    ).toBe(1)
    expect(
      navigateFleetViewByArrow(rows, 0, 1, {
        hasComposedDispatch: true,
        byState: false,
        previewOpen: false,
      }),
    ).toBe(2)
  })

  test('JIy tab toggles all-agents only on empty prompt', () => {
    expect(shouldFleetViewTabToggleAllAgents(false, '', 'prompt', 2)).toBe(true)
    expect(shouldFleetViewTabToggleAllAgents(true, '', 'prompt', 2)).toBe(false)
    expect(shouldFleetViewTabToggleAllAgents(false, 'x', 'prompt', 2)).toBe(
      false,
    )
    expect(shouldFleetViewTabToggleAllAgents(false, '', 'bash', 2)).toBe(false)
    expect(shouldFleetViewTabToggleAllAgents(false, '', 'prompt', 0)).toBe(
      false,
    )
  })

  test('JIy right opens row only on empty prompt', () => {
    expect(shouldFleetViewRightOpenFocusedRow(false, '', 'prompt', false)).toBe(
      true,
    )
    expect(shouldFleetViewRightOpenFocusedRow(true, '', 'prompt', false)).toBe(
      false,
    )
    expect(
      shouldFleetViewRightOpenFocusedRow(false, 'x', 'prompt', false),
    ).toBe(false)
    expect(shouldFleetViewRightOpenFocusedRow(false, '', 'bash', false)).toBe(
      false,
    )
    expect(shouldFleetViewRightOpenFocusedRow(false, '', 'prompt', true)).toBe(
      false,
    )
  })

  test('JIy simpleView skips leftover when not preview/rename', () => {
    expect(shouldFleetViewSimpleViewSkipLeftover(true, false, false)).toBe(true)
    expect(shouldFleetViewSimpleViewSkipLeftover(true, true, false)).toBe(false)
    expect(shouldFleetViewSimpleViewSkipLeftover(true, false, true)).toBe(false)
    expect(shouldFleetViewSimpleViewSkipLeftover(false, false, false)).toBe(
      false,
    )
  })

  test('JIy simpleView skips group-cycle and bang-bash', () => {
    expect(shouldFleetViewCycleGroupMode(true)).toBe(false)
    expect(shouldFleetViewCycleGroupMode(false)).toBe(true)
    expect(shouldFleetViewEnterBashFromBang(true, '', 'prompt')).toBe(false)
    expect(shouldFleetViewEnterBashFromBang(false, '', 'prompt')).toBe(true)
    expect(shouldFleetViewEnterBashFromBang(false, 'x', 'prompt')).toBe(false)
    expect(shouldFleetViewToggleHelp('', 'prompt')).toBe(true)
    expect(shouldFleetViewToggleHelp('x', 'prompt')).toBe(false)
    expect(shouldFleetViewToggleHelp('', 'bash')).toBe(false)
  })

  test('GP isActive Ct: live unless simpleView/preview/overlay', () => {
    const live = {
      simpleView: false,
      previewOpen: false,
      renaming: false,
      groupEdit: false,
      attaching: false,
      resumePicker: false,
    }
    expect(isFleetComposerActive(live)).toBe(true)
    expect(isFleetComposerActive({ ...live, simpleView: true })).toBe(false)
    expect(isFleetComposerActive({ ...live, previewOpen: true })).toBe(false)
    expect(isFleetComposerActive({ ...live, renaming: true })).toBe(false)
    expect(isFleetComposerActive({ ...live, groupEdit: true })).toBe(false)
    expect(isFleetComposerActive({ ...live, attaching: true })).toBe(false)
    expect(isFleetComposerActive({ ...live, resumePicker: true })).toBe(false)
  })

  test('JIy shift+↑↓ is RqA reorder, not selection extend', () => {
    expect(shouldFleetViewReorder(0, false)).toBe(true)
    expect(shouldFleetViewReorder(1, false)).toBe(false)
    expect(shouldFleetViewReorder(0, true)).toBe(false)
  })

  test('RqA skips earlier; simpleView only pinned; state writes stateSortOrder', () => {
    const a = session({
      pid: 1,
      status: 'busy',
      short: 'job-aaaa',
      sessionId: 'job-aaaa-id',
      pinned: true,
      startedAt: 10,
    })
    const b = session({
      pid: 2,
      status: 'busy',
      short: 'job-bbbb',
      sessionId: 'job-bbbb-id',
      pinned: true,
      startedAt: 20,
    })
    const c = session({
      pid: 3,
      status: 'busy',
      short: 'job-cccc',
      sessionId: 'job-cccc-id',
      startedAt: 30,
    })
    const d = session({
      pid: 4,
      status: 'busy',
      short: 'job-dddd',
      sessionId: 'job-dddd-id',
      startedAt: 40,
    })
    const pinnedRows = [
      { kind: 'job' as const, session: a, group: FLEET_SIMPLE_PINNED_GROUP },
      { kind: 'job' as const, session: b, group: FLEET_SIMPLE_PINNED_GROUP },
    ]
    const simplePin = planFleetReorder(pinnedRows, 0, 1, {
      simpleView: true,
      groupMode: 'state',
    })
    expect(simplePin?.nextFocusedIdx).toBe(1)
    expect(simplePin?.patches.every(p => p.field === 'sortOrder')).toBe(true)

    const simpleLive = [
      { kind: 'job' as const, session: c, group: 'simple:live' },
      { kind: 'job' as const, session: d, group: 'simple:live' },
    ]
    expect(
      planFleetReorder(simpleLive, 0, 1, {
        simpleView: true,
        groupMode: 'state',
      }),
    ).toBeNull()

    const stateRows = [
      { kind: 'header' as const, group: 'working' },
      { kind: 'job' as const, session: c, group: 'state:working' },
      { kind: 'earlier' as const, session: a },
      { kind: 'job' as const, session: d, group: 'state:working' },
    ]
    const skipped = planFleetReorder(stateRows, 1, 1, {
      simpleView: false,
      groupMode: 'state',
    })
    expect(skipped?.nextFocusedIdx).toBe(3)
    expect(skipped?.patches.every(p => p.field === 'stateSortOrder')).toBe(true)

    const groupRows = [
      { kind: 'job' as const, session: c, group: 'group:alpha' },
      { kind: 'job' as const, session: d, group: 'group:alpha' },
    ]
    expect(
      planFleetReorder(groupRows, 0, 1, {
        simpleView: false,
        groupMode: 'group',
      }),
    ).toBeNull()
  })

  test('V0n: state:done uses firstTerminalAt', () => {
    const done = session({
      pid: 9,
      status: 'idle',
      short: 'job-done',
      sessionId: 'job-done-id',
      firstTerminalAt: 10,
      updatedAt: 99,
      startedAt: 1,
    })
    expect(fleetStateSortKey(done, 'state:done')).toBe(10)
    expect(fleetStateSortKey(done, 'done')).toBe(10)
    expect(fleetStateSortKey(done, 'state:working')).toBe(99)
  })

  test('FCy showAllAgents / @ / lead / matched hide', () => {
    const templates = [{ name: 'review', description: 'pr' }]
    const routines = [{ name: 'nightly' }]
    const repos = { myproj: '/a/myproj' }
    expect(
      buildFleetComposerSuggestions('', {
        templates,
        dispatch: parseDispatch(''),
        showAllAgents: true,
      }).map(s => s.name),
    ).toEqual(['review'])
    expect(
      buildFleetComposerSuggestions('@re', {
        templates,
        routines,
        repos,
        dispatch: parseDispatch('@re', templates, repos, routines),
      }).map(s => `${s.kind}:${s.name}`),
    ).toEqual(['agent:review'])
    expect(
      buildFleetComposerSuggestions('re', {
        templates,
        routines,
        repos,
        dispatch: parseDispatch('re', templates, repos, routines),
      }).map(s => fleetSuggestionDisplayText(s)),
    ).toEqual(['@review'])
    expect(
      buildFleetComposerSuggestions('review', {
        templates,
        dispatch: parseDispatch('review', templates),
      }),
    ).toEqual([])
    expect(
      buildFleetComposerSuggestions('!ls', {
        templates,
        dispatch: parseDispatch('!ls'),
      }),
    ).toEqual([])
  })

  test('ICy sorts by lastUsed desc then name', () => {
    const names = sortFleetTemplatesByLastUsed(
      [{ name: 'zeta' }, { name: 'alpha' }, { name: 'beta' }],
      { beta: 10, zeta: 5 },
    ).map(t => t.name)
    expect(names).toEqual(['beta', 'zeta', 'alpha'])
    expect(
      sortFleetTemplatesByLastUsed([{ name: 'b' }, { name: 'a' }]).map(
        t => t.name,
      ),
    ).toEqual(['a', 'b'])
  })

  test('UCy backfills max createdAt and skips default/existing/NaN', () => {
    const { next, changed } = migrateAgentLastUsedFromJobs({ keep: 1 }, [
      {
        template: FLEET_DEFAULT_TEMPLATE_NAME,
        createdAt: '2020-01-01T00:00:00Z',
      },
      { template: 'review', createdAt: '2024-01-01T00:00:00Z' },
      { template: 'review', createdAt: '2025-01-01T00:00:00Z' },
      { template: 'keep', createdAt: '2026-01-01T00:00:00Z' },
      { template: 'bad', createdAt: 'not-a-date' },
      { createdAt: '2024-01-01T00:00:00Z' },
    ])
    expect(changed).toBe(true)
    expect(next.keep).toBe(1)
    expect(next.review).toBe(Date.parse('2025-01-01T00:00:00Z'))
    expect(next.bad).toBeUndefined()
    expect(next[FLEET_DEFAULT_TEMPLATE_NAME]).toBeUndefined()
    expect(
      migrateAgentLastUsedFromJobs({ review: 9 }, [
        { template: 'review', createdAt: '2025-01-01T00:00:00Z' },
      ]).changed,
    ).toBe(false)
  })

  test('VIy busy gate and throw/pending copy', () => {
    expect(isFleetNewSessionSpawnBusy(false, null)).toBe(false)
    expect(isFleetNewSessionSpawnBusy(true, null)).toBe(true)
    expect(isFleetNewSessionSpawnBusy(false, 'abc')).toBe(true)
    expect(formatFleetNewSessionThrow(new Error('disk full'))).toBe(
      "Couldn't start a new session \u2014 disk full",
    )
    expect(FLEET_NEW_SESSION_PENDING_MSG).toBe(
      'Still starting \u2014 open the new session once it appears',
    )
    expect(FLEET_NEW_SESSION_WAIT_MS).toBe(5000)
  })

  test('VIy wait polls until short appears or deadline', async () => {
    expect(
      findFleetJobByShort(
        [{ short: 'aaaa1111' }, { id: 'bbbb2222' }],
        'bbbb2222',
      )?.id,
    ).toBe('bbbb2222')
    let loads = 0
    const found = await waitForFleetJobByShort(
      async () => {
        loads += 1
        return loads < 3 ? [] : [{ short: 'deadbeef' }]
      },
      'deadbeef',
      {
        deadlineAt: 1000,
        isCurrent: () => true,
        now: () => (loads < 3 ? 0 : 10),
        sleep: async () => {},
      },
    )
    expect(found?.short).toBe('deadbeef')
    expect(loads).toBe(3)

    const missed = await waitForFleetJobByShort(async () => [], 'nope', {
      deadlineAt: 0,
      isCurrent: () => true,
      now: () => 1,
      sleep: async () => {},
    })
    expect(missed).toBeUndefined()
  })

  test('page jump uses termRows-6', () => {
    expect(fleetViewPageJump('home', 4, 10, 20)).toBe(0)
    expect(fleetViewPageJump('end', 4, 10, 20)).toBe(9)
    expect(fleetViewPageJump('pageup', 8, 10, 20)).toBe(0)
    expect(fleetViewPageJump('pagedown', 0, 10, 20)).toBe(9)
  })
})
