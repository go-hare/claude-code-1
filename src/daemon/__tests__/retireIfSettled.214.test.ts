/**
 * densable 2.1.214 #27 — retireIfSettled settle predicate.
 * Idle / blocked non-exec workers must be reclaimable (not terminal-only).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  EMPTY_PROMPT_NEEDS,
  hasBlockingInFlight,
  isBhSettled,
  isEligibleForRetire,
  isTerminalState,
  RETIRE_DETRITUS_KINDS,
  type BgJobState,
} from '../jobState.js'

const ROOT = join(import.meta.dir, '../..')

function base(over: Partial<BgJobState> = {}): BgJobState {
  return {
    state: 'working',
    detail: '',
    tempo: 'active',
    intent: 'x',
    sessionId: 's',
    cwd: '/tmp',
    template: 'bg',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: [],
    ...over,
  }
}

describe('densable retire settle helpers #27', () => {
  test('isBhSettled = terminal && tempo !== active', () => {
    expect(isBhSettled(base({ state: 'done', tempo: 'idle' }))).toBe(true)
    expect(isBhSettled(base({ state: 'done', tempo: 'active' }))).toBe(false)
    expect(isBhSettled(base({ state: 'working', tempo: 'idle' }))).toBe(false)
    expect(isTerminalState(base({ state: 'done', tempo: 'idle' }))).toBe(true)
  })

  test('isEligibleForRetire: tempo idle non-exec (#27 root fix)', () => {
    const idle = base({ state: 'working', tempo: 'idle' })
    expect(isEligibleForRetire(idle, { launchMode: 'prompt' })).toBe(true)
    expect(isEligibleForRetire(idle, { launchMode: 'resume' })).toBe(true)
    // exec never retires on idle alone without bh
    expect(isEligibleForRetire(idle, { launchMode: 'exec' })).toBe(false)
  })

  test('isEligibleForRetire: blocked+blocked non-exec', () => {
    const blocked = base({ state: 'blocked', tempo: 'blocked' })
    expect(isEligibleForRetire(blocked, { launchMode: 'prompt' })).toBe(true)
    expect(isEligibleForRetire(blocked, { launchMode: 'exec' })).toBe(false)
  })

  test('isEligibleForRetire: active working not settled', () => {
    expect(
      isEligibleForRetire(base({ state: 'working', tempo: 'active' }), {
        launchMode: 'prompt',
      }),
    ).toBe(false)
  })

  test('isEligibleForRetire: interactiveLineage empty prompt special', () => {
    const st = base({
      state: 'working',
      tempo: 'blocked',
      needs: EMPTY_PROMPT_NEEDS,
      interactiveLineage: true,
    })
    expect(
      isEligibleForRetire(st, {
        launchMode: 'prompt',
        workerCliVersion: '2.1.214',
        hostCliVersion: '2.1.214',
      }),
    ).toBe(true)
    expect(
      isEligibleForRetire(st, {
        launchMode: 'prompt',
        workerCliVersion: '2.1.214',
        hostCliVersion: '9.9.9',
      }),
    ).toBe(false)
  })

  test('hasBlockingInFlight: detritus-only ok when bh-settled', () => {
    const st = base({
      state: 'done',
      tempo: 'idle',
      inFlight: {
        tasks: 1,
        queued: 0,
        kinds: [...RETIRE_DETRITUS_KINDS],
      },
    })
    expect(hasBlockingInFlight(st)).toBe(false)
    expect(
      hasBlockingInFlight({
        ...st,
        inFlight: { tasks: 1, queued: 0, kinds: ['session_cron'] },
      }),
    ).toBe(true)
    expect(
      hasBlockingInFlight({
        ...st,
        inFlight: { tasks: 0, queued: 1, kinds: [] },
      }),
    ).toBe(true)
  })

  test('bgWorker.retireIfSettled uses isEligibleForRetire + host-managed', () => {
    const src = readFileSync(join(ROOT, 'daemon/bgWorker.ts'), 'utf8')
    expect(src).toContain('isEligibleForRetire')
    expect(src).toContain('hasBlockingInFlight')
    expect(src).toContain('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST')
    expect(src).toContain("reason: 'host-managed'")
    // must not gate solely on isTerminalState for retire settle
    const retireStart = src.indexOf('async retireIfSettled')
    const retireEnd = src.indexOf('// --- Spawn logic ---', retireStart)
    const body = src.slice(retireStart, retireEnd)
    expect(body).toContain('isEligibleForRetire')
    expect(body).not.toMatch(/if \(!isTerminalState\(state\)\)/)
  })
})
