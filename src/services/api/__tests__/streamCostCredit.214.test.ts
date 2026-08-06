/**
 * densable 2.1.214 #38 — multi-frame message_delta cost credit (gr)
 */
import { describe, expect, test } from 'bun:test'
import {
  onMessageDeltaCostCredit,
  onMessageStopCostCredit,
  type StreamCostCreditState,
} from '../streamCostCredit.js'

describe('onMessageDeltaCostCredit densable gr', () => {
  test('first delta with null stop_reason → pending, no credit', () => {
    expect(onMessageDeltaCostCredit('none', null)).toEqual({
      next: 'pending',
      shouldCredit: false,
    })
  })

  test('subsequent cumulative deltas with null stop_reason stay pending', () => {
    expect(onMessageDeltaCostCredit('pending', null)).toEqual({
      next: 'pending',
      shouldCredit: false,
    })
    expect(onMessageDeltaCostCredit('pending', undefined)).toEqual({
      next: 'pending',
      shouldCredit: false,
    })
  })

  test('delta with stop_reason credits once from none or pending', () => {
    expect(onMessageDeltaCostCredit('none', 'end_turn')).toEqual({
      next: 'credited',
      shouldCredit: true,
    })
    expect(onMessageDeltaCostCredit('pending', 'end_turn')).toEqual({
      next: 'credited',
      shouldCredit: true,
    })
  })

  test('further deltas after credited never re-credit (double-count fix)', () => {
    expect(onMessageDeltaCostCredit('credited', 'end_turn')).toEqual({
      next: 'credited',
      shouldCredit: false,
    })
    expect(onMessageDeltaCostCredit('credited', null)).toEqual({
      next: 'credited',
      shouldCredit: false,
    })
  })

  test('multi-frame sequence: only final stop_reason credits once', () => {
    let state: StreamCostCreditState = 'none'
    let credits = 0
    for (const stop of [null, null, null, 'end_turn', 'end_turn'] as const) {
      const t = onMessageDeltaCostCredit(state, stop)
      state = t.next
      if (t.shouldCredit) credits++
    }
    expect(state).toBe('credited')
    expect(credits).toBe(1)
  })
})

describe('onMessageStopCostCredit densable gr', () => {
  test('pending at message_stop credits once', () => {
    expect(onMessageStopCostCredit('pending')).toEqual({
      next: 'credited',
      shouldCredit: true,
    })
  })

  test('none / already credited do not credit on stop', () => {
    expect(onMessageStopCostCredit('none')).toEqual({
      next: 'none',
      shouldCredit: false,
    })
    expect(onMessageStopCostCredit('credited')).toEqual({
      next: 'credited',
      shouldCredit: false,
    })
  })
})
