import { afterEach, describe, expect, test } from 'bun:test'
import {
  bindMainThreadTurn,
  getMainThreadTurn,
  releaseMainThreadTurn,
  resetMainThreadTurn,
} from '../mainThreadTurn.js'

afterEach(() => {
  resetMainThreadTurn()
})

describe('densable 2.1.289 dRt/Sss/yHr/g_e', () => {
  test('bind current cancel once; release only matching turnId', () => {
    let aborted = 0
    bindMainThreadTurn({
      turnId: 't1',
      abort: () => {
        aborted++
      },
      startedBy: 'person',
    })
    const slot = getMainThreadTurn()
    expect(slot?.turnId).toBe('t1')
    expect(slot?.isPersonStarted).toBe(true)
    expect(slot?.cancelled()).toBe(false)
    slot?.cancel()
    slot?.cancel()
    expect(aborted).toBe(1)
    expect(slot?.cancelled()).toBe(true)
    releaseMainThreadTurn('other')
    expect(getMainThreadTurn()?.turnId).toBe('t1')
    releaseMainThreadTurn('t1')
    expect(getMainThreadTurn()).toBeUndefined()
  })

  test('automatic startedBy is not person', () => {
    bindMainThreadTurn({
      turnId: 't2',
      abort: () => {},
      startedBy: 'automatic',
    })
    expect(getMainThreadTurn()?.isPersonStarted).toBe(false)
  })
})
