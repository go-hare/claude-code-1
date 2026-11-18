import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { formatFleetRowWhen } from '../helpers.js'

const AGENT_VIEW_SRC = readFileSync(
  join(import.meta.dir, '..', '..', 'AgentView.tsx'),
  'utf8',
)

describe('fleetView v2.1.290 (#50/#67 /loop countdown, #49/#66 forceUnresponsive/Esc, #156 /effort & nextTurn)', () => {
  test('formatFleetRowWhen shows "in <dur>" when nextAt > now, else job age', () => {
    const now = 1_000_000
    expect(formatFleetRowWhen(now - 120_000, now + 45_000, now)).toBe('in 45s')
    expect(formatFleetRowWhen(now - 120_000, now - 1000, now)).toBe('2m')
    expect(formatFleetRowWhen(now - 120_000, null, now)).toBe('2m')
  })

  test('AgentView passes loopNextAt to SessionRow and uses formatFleetRowWhen', () => {
    expect(AGENT_VIEW_SRC).toContain(
      'formatFleetRowWhen(session.startedAt, loopNextAt)',
    )
    expect(AGENT_VIEW_SRC).toContain('loopNextAt={')
  })

  test('AgentView wires forceUnresponsive (non-Esc) and replyOnResume to onAction open', () => {
    expect(AGENT_VIEW_SRC).not.toContain('void _forceUnresponsive')
    expect(AGENT_VIEW_SRC).toContain('forceUnresponsive: true, replyOnResume:')
    expect(AGENT_VIEW_SRC).toContain("trigger !== 'esc'")
  })

  test('AgentView handles /effort and sendReplyToSession supports nextTurn', () => {
    expect(AGENT_VIEW_SRC).toContain("quitToken === '/effort'")
    expect(AGENT_VIEW_SRC).toContain('nextTurn: true')
  })
})
