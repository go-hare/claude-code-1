import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTurnDurationMessage } from 'src/utils/messages.js'
import {
  countAgentKeepaliveChildren,
  hasLiveAgentKeepaliveChildren,
} from 'src/utils/task/framework.js'
import type { AppState } from 'src/state/AppState.js'

/**
 * densable Yqe park CWr + pe (JXt count) + defer BRt source anchors.
 * Runtime park path is in agentToolUtils.runAsyncAgentLifecycle.
 */
describe('densable Yqe park CWr + pe (JXt count)', () => {
  test('createTurnDurationMessage densable CWr pe/n fields', () => {
    const m = createTurnDurationMessage(1234, undefined, undefined, 2)
    expect(m.type).toBe('system')
    expect(m.subtype).toBe('turn_duration')
    expect(m.durationMs).toBe(1234)
    expect(
      (m as { pendingBackgroundAgentCount?: number })
        .pendingBackgroundAgentCount,
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
            'flag:idle-window',
          ]),
        },
      },
    } as unknown as AppState
    expect(countAgentKeepaliveChildren('parent', () => state)).toBe(2)
    expect(hasLiveAgentKeepaliveChildren('parent', () => state)).toBe(true)
    expect(countAgentKeepaliveChildren('missing', () => state)).toBe(0)
    expect(hasLiveAgentKeepaliveChildren('missing', () => state)).toBe(false)
  })

  test('JXt false when only non-agent keepalive (bot/workflow)', () => {
    const state = {
      tasks: {
        parent: {
          type: 'local_agent',
          status: 'completed',
          keepaliveReasons: new Set(['workflow:w1', 'flag:idle-window']),
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
    expect(utils).toContain('sweepAndDetectLiveAgentChildren')
    expect(utils).toContain('parkAgentOnKeepaliveDeferNotify')
    expect(utils).toContain('suppressTelemetry')
    // order: completeAsyncAgent → post-complete JXt park return → enqueue
    const completeIdx = utils.indexOf('completeAsyncAgent(agentResult')
    const parkIdx = utils.indexOf(
      'parkAgentOnKeepaliveDeferNotify(',
      completeIdx,
    )
    const returnIdx = utils.indexOf('return', parkIdx)
    const notifyIdx = utils.indexOf('enqueueAgentNotification({', returnIdx)
    expect(completeIdx).toBeGreaterThan(0)
    expect(parkIdx).toBeGreaterThan(completeIdx)
    expect(returnIdx).toBeGreaterThan(parkIdx)
    expect(notifyIdx).toBeGreaterThan(returnIdx)
    // post-complete re-check JXt (not pre-only)
    expect(utils).toContain('hasLiveAgentKeepaliveChildren')
    // strips old turn_duration
    expect(utils).toContain("subtype === 'turn_duration'")
  })

  test('AgentTool mid-bg complete path also defers BRt on JXt', () => {
    const agent = readFileSync(
      join(import.meta.dir, '../AgentTool.tsx'),
      'utf8',
    )
    expect(agent).toContain('sweepAndDetectLiveAgentChildren')
    expect(agent).toContain('parkAgentOnKeepaliveDeferNotify')
    expect(agent).toContain('suppressTelemetry: preCompleteJxt')
    const completeIdx = agent.indexOf('completeAsyncAgent(agentResult')
    const parkIdx = agent.indexOf(
      'parkAgentOnKeepaliveDeferNotify(',
      completeIdx,
    )
    const returnIdx = agent.indexOf('return;', parkIdx)
    const notifyIdx = agent.indexOf('enqueueAgentNotification({', returnIdx)
    expect(completeIdx).toBeGreaterThan(0)
    expect(parkIdx).toBeGreaterThan(completeIdx)
    expect(returnIdx).toBeGreaterThan(parkIdx)
    expect(notifyIdx).toBeGreaterThan(returnIdx)
  })
})
