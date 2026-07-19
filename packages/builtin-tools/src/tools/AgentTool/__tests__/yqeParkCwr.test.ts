import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTurnDurationMessage } from 'src/utils/messages.js'
import {
  countAgentKeepaliveChildren,
  hasLiveAgentKeepaliveChildren,
} from 'src/utils/task/framework.js'
import type { AppState } from 'src/state/AppState.js'

describe('densable Yqe park CWr + pe (JXt count)', () => {
  test('createTurnDurationMessage densable CWr pe/n fields', () => {
    const m = createTurnDurationMessage(1234, undefined, undefined, 2)
    expect(m.type).toBe('system')
    expect(m.subtype).toBe('turn_duration')
    expect(m.durationMs).toBe(1234)
    expect(
      (m as { pendingBackgroundAgentCount?: number }).pendingBackgroundAgentCount,
    ).toBe(2)
    // omit undefined pe
    const m2 = createTurnDurationMessage(10)
    expect(
      (m2 as { pendingBackgroundAgentCount?: number })
        .pendingBackgroundAgentCount,
    ).toBeUndefined()
  })

  test('countAgentKeepaliveChildren counts agent: only', () => {
    const state = {
      tasks: {
        parent: {
          type: 'local_agent',
          status: 'completed',
          keepaliveReasons: new Set([
            'agent:child1',
            'agent:child2',
            'workflow:w1',
          ]),
        },
      },
    } as unknown as AppState
    expect(countAgentKeepaliveChildren('parent', () => state)).toBe(2)
    expect(hasLiveAgentKeepaliveChildren('parent', () => state)).toBe(true)
    expect(countAgentKeepaliveChildren('missing', () => state)).toBe(0)
    expect(hasLiveAgentKeepaliveChildren('missing', () => state)).toBe(false)
  })

  test('JXt false when only non-agent keepalive', () => {
    const state = {
      tasks: {
        parent: {
          type: 'local_agent',
          status: 'completed',
          keepaliveReasons: new Set(['workflow:w1']),
        },
      },
    } as unknown as AppState
    expect(countAgentKeepaliveChildren('parent', () => state)).toBe(0)
    expect(hasLiveAgentKeepaliveChildren('parent', () => state)).toBe(false)
  })

  test('runAsyncAgentLifecycle park path: CWr + defer notify when JXt', () => {
    const utils = readFileSync(
      join(import.meta.dir, '../agentToolUtils.ts'),
      'utf8',
    )
    expect(utils).toContain('createTurnDurationMessage')
    expect(utils).toContain('countAgentKeepaliveChildren')
    expect(utils).toContain('parked on keepalive')
    expect(utils).toContain('deferring owner notification until resume')
    // order: completeAsyncAgent → stillHasAgentChildren park return → notifyOwner
    const completeIdx = utils.indexOf('completeAsyncAgent(agentResult')
    const parkIdx = utils.indexOf('if (stillHasAgentChildren)')
    const cwrIdx = utils.indexOf('createTurnDurationMessage(', parkIdx)
    const returnIdx = utils.indexOf('return', cwrIdx)
    const notifyIdx = utils.indexOf('if (notifyOwner())', returnIdx)
    expect(completeIdx).toBeGreaterThan(0)
    expect(parkIdx).toBeGreaterThan(completeIdx)
    expect(cwrIdx).toBeGreaterThan(parkIdx)
    expect(returnIdx).toBeGreaterThan(cwrIdx)
    expect(notifyIdx).toBeGreaterThan(returnIdx)
    // strips old turn_duration
    expect(utils).toContain("subtype === 'turn_duration'")
  })
})
