import { afterEach, describe, expect, test } from 'bun:test'
import type { BgJobState } from '../../daemon/jobState.js'
import {
  _resetFleetNeedsInputNudgeStoreForTests,
  classifyFleetJobs,
  isTerminalFleetJob,
  jobNeedsInput,
  jobSucceeded,
} from '../fleetNeedsInputNudge.js'

function job(
  partial: Partial<BgJobState> &
    Pick<BgJobState, 'sessionId' | 'state' | 'tempo'>,
): BgJobState {
  return {
    detail: '',
    intent: 'x',
    cwd: '/tmp',
    template: 'bg',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: [],
    ...partial,
  }
}

afterEach(() => {
  _resetFleetNeedsInputNudgeStoreForTests()
})

describe('jobNeedsInput / isTerminalFleetJob', () => {
  test('blocked + needs → needs input', () => {
    expect(
      jobNeedsInput(
        job({
          sessionId: 'a',
          state: 'working',
          tempo: 'blocked',
          needs: 'ok?',
        }),
      ),
    ).toBe(true)
  })

  test('blocked without needs/block → false', () => {
    expect(
      jobNeedsInput(
        job({ sessionId: 'a', state: 'working', tempo: 'blocked' }),
      ),
    ).toBe(false)
  })

  test('terminal done is not needs-input', () => {
    const j = job({ sessionId: 'a', state: 'done', tempo: 'idle' })
    expect(isTerminalFleetJob(j)).toBe(true)
    expect(jobNeedsInput(j)).toBe(false)
    expect(jobSucceeded(j)).toBe(true)
  })

  test('done with open PR child is non-terminal (review band)', () => {
    const j = job({
      sessionId: 'a',
      state: 'done',
      tempo: 'idle',
      children: [{ id: '1', href: 'https://github.com/o/r/pull/1' }],
    })
    expect(isTerminalFleetJob(j)).toBe(false)
    expect(jobSucceeded(j)).toBe(false)
  })
})

describe('classifyFleetJobs', () => {
  test('counts needsInput / done / succeeded and skips current session', () => {
    const jobs = [
      {
        short: '1',
        state: job({
          sessionId: 'cur',
          state: 'working',
          tempo: 'blocked',
          needs: 'me',
        }),
      },
      {
        short: '2',
        state: job({
          sessionId: 'b',
          state: 'working',
          tempo: 'blocked',
          needs: 'help',
        }),
      },
      {
        short: '3',
        state: job({ sessionId: 'c', state: 'done', tempo: 'idle' }),
      },
      {
        short: '4',
        state: job({ sessionId: 'd', state: 'failed', tempo: 'idle' }),
      },
      {
        short: '5',
        state: job({ sessionId: 'e', state: 'working', tempo: 'active' }),
      },
    ]
    const snap = classifyFleetJobs(jobs, 'cur')
    expect(snap.needsInput).toBe(1)
    expect(snap.done).toBe(2)
    expect(snap.succeeded).toBe(1)
    expect(snap.active).toBe(2) // blocked b + active e
  })
})
