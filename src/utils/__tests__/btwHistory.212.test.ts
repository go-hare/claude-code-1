/**
 * densable 2.1.212 #40 — bare /btw reopens last side-question panel via
 * lNt/Scn history ring (VI_=20).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  appendBtwHistory,
  clearBtwHistory,
  createBtwHistoryState,
  getBtwHistory,
  resetBtwHistory,
  _setGlobalBtwHistoryStateForTesting,
} from '../sideQuestion.js'

afterEach(() => {
  _setGlobalBtwHistoryStateForTesting(createBtwHistoryState())
})

describe('densable #40 btw history (lNt / Scn / VI_=20)', () => {
  test('appendBtwHistory grows ring and getBtwHistory returns entries', () => {
    appendBtwHistory('q1', 'a1')
    appendBtwHistory('q2', 'a2')
    expect(getBtwHistory()).toEqual([
      { question: 'q1', response: 'a1' },
      { question: 'q2', response: 'a2' },
    ])
  })

  test('at(-1) is last entry for bare /btw reopen', () => {
    appendBtwHistory('first', 'one')
    appendBtwHistory('second', 'two')
    const last = getBtwHistory().at(-1)
    expect(last).toEqual({ question: 'second', response: 'two' })
  })

  test('caps at 20 entries (VI_)', () => {
    for (let i = 0; i < 25; i++) {
      appendBtwHistory(`q${i}`, `a${i}`)
    }
    const hist = getBtwHistory()
    expect(hist).toHaveLength(20)
    expect(hist[0]).toEqual({ question: 'q5', response: 'a5' })
    expect(hist.at(-1)).toEqual({ question: 'q24', response: 'a24' })
  })

  test('clearBtwHistory empties; bare reopen would Usage', () => {
    appendBtwHistory('q', 'a')
    clearBtwHistory()
    expect(getBtwHistory()).toEqual([])
    expect(getBtwHistory().at(-1)).toBeUndefined()
  })

  test('resetBtwHistory replaces ring (x clear keep-current)', () => {
    appendBtwHistory('old', 'a')
    appendBtwHistory('keep', 'b')
    resetBtwHistory([{ question: 'keep', response: 'b' }])
    expect(getBtwHistory()).toEqual([{ question: 'keep', response: 'b' }])
  })

  test('reopen list excludes last when initialResponse set (yXs slice)', () => {
    appendBtwHistory('q1', 'a1')
    appendBtwHistory('q2', 'a2')
    // densable: CNt===void 0 ? lNt() : lNt().slice(0,-1)
    const initialResponse = getBtwHistory().at(-1)!.response
    const listForPanel =
      initialResponse === undefined
        ? getBtwHistory()
        : getBtwHistory().slice(0, -1)
    expect(listForPanel).toEqual([{ question: 'q1', response: 'a1' }])
  })
})
