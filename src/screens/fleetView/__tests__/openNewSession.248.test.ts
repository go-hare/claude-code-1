/**
 * densable 2.1.248 #18 — open new session without attaching an older job
 * or dropping a typed prompt into idle-shell spawn.
 *
 * Gold `up` @192190196 sha=c787d79639381466
 * Gold `ye(X.origin)` @192261457 / `lt(Ie.origin)` / `mf(Ke.origin)` /
 *   `Du=(H)=>up(ra,H)`
 * Gold `willInsertNewline` @192073232/@192269870 (`xe` shift|meta|backslash)
 * Gold `np` `{kind:"newsession",origin:w,group:Rb}` Rb=`simple:new-session`
 *   @192174826
 * Gold `Lc` @192158881: composed intent → new session; empty newsession →
 *   `lt(Ie.origin)`. `up` does not `setQuery("")` — do not invent clear-on-new.
 * Gold `dropDraft` @192150926 / attach `!keepQuery` @192287275 / `sp`
 *   @192184937 sha=d2d0ec8103689cec — production-wired on attach after the
 *   prompt is consumed, not inside `up`.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { setRestrictedSessionFlag } from '../../../utils/restricted.js'
import {
  buildSimpleModeFlatRows,
  decideFleetReturnAction,
  FLEET_NEW_SESSION_PENDING_MSG,
  FLEET_SIMPLE_NEW_SESSION_GROUP,
  fleetNewSessionRowOrigin,
  fleetUpExtraArgs,
  fleetUpRestrictedArgs,
  formatFleetNewSessionThrow,
  hasFleetLcDispatchIntent,
  isFleetDispatchAndOpenKey,
  isFleetDispatchNewlineKey,
  parseDispatch,
  shouldFleetKeepQueryOnOpen,
  shouldFleetViewRightOpenFocusedRow,
} from '../helpers.js'

const HELPERS = readFileSync(join(import.meta.dir, '../helpers.ts'), 'utf8')
const AGENT_VIEW = readFileSync(
  join(import.meta.dir, '../../AgentView.tsx'),
  'utf8',
)

afterEach(() => {
  setRestrictedSessionFlag(false)
})

describe('densable 2.1.248 #18 openNewSession / ye(X.origin)', () => {
  test('gold Rb group ident is simple:new-session', () => {
    expect(FLEET_SIMPLE_NEW_SESSION_GROUP).toBe('simple:new-session')
    expect(HELPERS).toContain('Rb')
    expect(HELPERS).toContain('simple:new-session')
  })

  test('gold np newsession row carries origin + Rb group', () => {
    const { rows } = buildSimpleModeFlatRows({
      sessions: [],
      now: 0,
      terminalRows: 20,
      showFinishedEarlier: false,
      fallbackOrigin: '/tmp/origin',
    })
    expect(rows[0]).toEqual({
      kind: 'newsession',
      origin: '/tmp/origin',
      group: 'simple:new-session',
    })
  })

  test('gold ye(X.origin) / lt(Ie.origin) / mf(Ke.origin) / Du aliases', () => {
    expect(AGENT_VIEW).toContain('ye(X.origin)')
    expect(AGENT_VIEW).toContain('lt(Ie.origin)')
    expect(AGENT_VIEW).toContain('mf(Ke.origin)')
    expect(AGENT_VIEW).toContain('Du=(H)=>up(ra,H)')
    expect(AGENT_VIEW).toContain('openNewSessionRow')
    expect(AGENT_VIEW).toContain('fleetNewSessionRowOrigin')
    expect(HELPERS).toContain('ye(X.origin)')
    expect(HELPERS).toContain('lt(Ie.origin)')
  })

  test('fleetNewSessionRowOrigin prefers row.origin', () => {
    expect(
      fleetNewSessionRowOrigin(
        { kind: 'newsession', origin: '/from-row' },
        '/fallback',
      ),
    ).toBe('/from-row')
    expect(fleetNewSessionRowOrigin({ kind: 'job' }, '/fallback')).toBe(
      '/fallback',
    )
  })

  test('gold Lc: composed intent/routine/matched is dispatch-new, not older job', () => {
    const intent = parseDispatch('do the thing')
    expect(hasFleetLcDispatchIntent(intent)).toBe(true)
    expect(
      decideFleetReturnAction({ parsed: intent, focusedKind: 'job' }),
    ).toBe('dispatch-new')
    expect(
      decideFleetReturnAction({ parsed: intent, focusedKind: 'newsession' }),
    ).toBe('dispatch-new')
    expect(
      decideFleetReturnAction({
        parsed: parseDispatch('review', [{ name: 'review' }]),
        focusedKind: 'job',
      }),
    ).toBe('dispatch-new')
  })

  test('gold Lc: empty newsession → lt(Ie.origin); empty job → open-focused', () => {
    const empty = parseDispatch('')
    expect(hasFleetLcDispatchIntent(empty)).toBe(false)
    expect(
      decideFleetReturnAction({ parsed: empty, focusedKind: 'newsession' }),
    ).toBe('newsession')
    expect(decideFleetReturnAction({ parsed: empty, focusedKind: 'job' })).toBe(
      'open-focused',
    )
    expect(
      decideFleetReturnAction({ parsed: empty, focusedKind: 'fold' }),
    ).toBe('fold')
  })

  test('gold Lc: cwd-only (no intent) does not attach an older job', () => {
    expect(
      decideFleetReturnAction({
        parsed: parseDispatch('@myrepo', [], { myrepo: '/tmp/myrepo' }),
        focusedKind: 'job',
      }),
    ).toBe('none')
  })

  test('gold up / VIy throw and row_pending copy 1:1', () => {
    expect(formatFleetNewSessionThrow(new Error('disk full'))).toBe(
      "Couldn't start a new session \u2014 disk full",
    )
    expect(FLEET_NEW_SESSION_PENDING_MSG).toBe(
      'Still starting \u2014 open the new session once it appears',
    )
    expect(HELPERS).toContain('fleet_view_new_session')
  })

  test('gold dropDraft / keepQuery / sp idents — not clear-on-new inside up', () => {
    expect(HELPERS).toContain('keepQuery')
    expect(HELPERS).toContain('dropDraft')
    expect(HELPERS).toContain('function sp')
    expect(HELPERS).toContain('d2d0ec8103689cec')
    expect(shouldFleetKeepQueryOnOpen(parseDispatch('do the thing'))).toBe(true)
    expect(shouldFleetKeepQueryOnOpen(parseDispatch(''))).toBe(false)
    expect(AGENT_VIEW).toContain('does not `setQuery("")`')
    expect(AGENT_VIEW).not.toMatch(
      /const openNewSessionRow = useCallback\(\s*async \(origin\?: string\) => \{[\s\S]{0,400}setDispatchInput\(''\)/,
    )
  })

  test('gold willInsertNewline leftover #45 is not stolen', () => {
    expect(HELPERS).toContain('willInsertNewline')
    expect(HELPERS).toContain('@192073232')
    expect(HELPERS).toContain('@192269870')
    expect(
      isFleetDispatchNewlineKey({ return: true, shift: true, ctrl: false }, ''),
    ).toBe(true)
    expect(
      isFleetDispatchAndOpenKey({ return: true, ctrl: true, shift: false }),
    ).toBe(true)
    expect(
      isFleetDispatchAndOpenKey({ return: true, ctrl: true, shift: true }),
    ).toBe(false)
    expect(AGENT_VIEW).toContain('isFleetDispatchNewlineKey(key, input)')
    expect(AGENT_VIEW).toContain(
      'isFleetDispatchAndOpenKey(key) && canDispatchAndOpen',
    )
  })

  test('empty-right still requires empty prompt before ye(X.origin)', () => {
    expect(shouldFleetViewRightOpenFocusedRow(false, '', 'prompt', false)).toBe(
      true,
    )
    expect(
      shouldFleetViewRightOpenFocusedRow(false, 'typed', 'prompt', false),
    ).toBe(false)
  })

  test('AgentView production-wires origin pass and Lc dispatch-new', () => {
    expect(AGENT_VIEW).toContain('decideFleetReturnAction')
    expect(AGENT_VIEW).toContain("returnAction === 'dispatch-new'")
    expect(AGENT_VIEW).toContain(
      'openNewSessionRow(fleetNewSessionRowOrigin(currentRow, getCwd()))',
    )
    expect(AGENT_VIEW).toContain(
      'openNewSessionRow(fleetNewSessionRowOrigin(row, getCwd()))',
    )
    expect(AGENT_VIEW).toContain('fallbackOrigin: getCwd()')
    expect(AGENT_VIEW).not.toContain('void openNewSessionRow();')
    expect(
      AGENT_VIEW.match(/fleetUpExtraArgs\(dispatchExtraArgs\)/g)?.length,
    ).toBe(4)
  })

  test('up $L first arg is Yk()?["--restricted"]:[]', () => {
    setRestrictedSessionFlag(false)
    expect(fleetUpRestrictedArgs()).toEqual([])
    expect(fleetUpExtraArgs(['--effort', 'high'])).toEqual(['--effort', 'high'])
    setRestrictedSessionFlag(true)
    expect(fleetUpRestrictedArgs()).toEqual(['--restricted'])
    expect(fleetUpExtraArgs([])).toEqual(['--restricted'])
    expect(fleetUpExtraArgs(['--restricted'])).toEqual(['--restricted'])
    expect(fleetUpExtraArgs(['--effort', 'high'])).toEqual([
      '--effort',
      'high',
      '--restricted',
    ])
    expect(HELPERS).toContain("isRestrictedSession() ? ['--restricted'] : []")
  })
})
