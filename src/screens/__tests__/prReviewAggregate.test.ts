import { describe, expect, test } from 'bun:test'
import { prReviewStateSeverity, worstPrReviewState } from '../AgentView.js'
import type { SessionEntry } from '../../cli/bg/engine.js'

type Review = SessionEntry['prReviewState']

describe('prReviewStateSeverity / worstPrReviewState', () => {
  test('severity ranks changes_requested highest', () => {
    expect(prReviewStateSeverity('changes_requested')).toBeGreaterThan(
      prReviewStateSeverity('pending'),
    )
    expect(prReviewStateSeverity('pending')).toBeGreaterThan(
      prReviewStateSeverity('draft'),
    )
    expect(prReviewStateSeverity('draft')).toBeGreaterThan(
      prReviewStateSeverity('approved'),
    )
    expect(prReviewStateSeverity('approved')).toBeGreaterThan(
      prReviewStateSeverity(undefined),
    )
  })

  test('worst across multi-PR list picks changes_requested over approved', () => {
    const states: Review[] = ['approved', 'changes_requested', 'pending']
    expect(worstPrReviewState(states)).toBe('changes_requested')
  })

  test('worst returns undefined for empty / all-undefined', () => {
    expect(worstPrReviewState([])).toBeUndefined()
    expect(worstPrReviewState([undefined, undefined])).toBeUndefined()
  })

  test('worst prefers pending over draft', () => {
    expect(worstPrReviewState(['draft', 'pending', 'approved'])).toBe('pending')
  })
})
