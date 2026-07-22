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
 * Park-on-keepalive: turn_duration pe count + defer owner notify source anchors.
 * Runtime park path is in agentToolUtils.runAsyncAgentLifecycle.
 */
describe('agent keepalive park + defer owner notify', () => {
  test('createTurnDurationMessage pe/n pendingBackgroundAgentCount fields', () => {
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

  test('hasLiveAgentKeepaliveChildren false when only non-agent keepalive', () => {
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

  test('runAsyncAgentLifecycle park path: turn_duration + defer notify when live children', () => {
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
    // isIdle tracking (shared tracker)
    expect(utils).toContain('createLocalAgentIsIdleTracker')
    expect(utils).toContain('computeLocalAgentIsIdle')
    expect(utils).toContain('updateLocalAgentIsIdle')
    // mid-bg path in AgentTool must seed + track (verifier residual)
    const agentTool = readFileSync(
      join(import.meta.dir, '../AgentTool.tsx'),
      'utf8',
    )
    expect(agentTool).toContain('createLocalAgentIsIdleTracker')
    expect(agentTool).toContain('seedFromMessages')
    expect(agentTool).toContain('isIdleTracker.track')
    // order: sweep → finalize(suppress) → complete(skipJeo) → if live children park → else enqueue
    const sweepIdx = utils.indexOf('sweepAndDetectLiveAgentChildren(')
    const suppressIdx = utils.indexOf('suppressTelemetry: preCompleteJxt')
    const completeIdx = utils.indexOf('completeAsyncAgent(agentResult')
    const skipJeoIdx = utils.indexOf('skipJeo: true', completeIdx)
    const parkIdx = utils.indexOf(
      'parkAgentOnKeepaliveDeferNotify(',
      completeIdx,
    )
    const parkGateIdx = utils.indexOf('if (preCompleteJxt)', completeIdx)
    const returnIdx = utils.indexOf('return', parkIdx)
    const notifyIdx = utils.indexOf('enqueueAgentNotification({', returnIdx)
    expect(sweepIdx).toBeGreaterThan(0)
    expect(suppressIdx).toBeGreaterThan(sweepIdx)
    expect(completeIdx).toBeGreaterThan(suppressIdx)
    expect(skipJeoIdx).toBeGreaterThan(completeIdx)
    expect(parkGateIdx).toBeGreaterThan(completeIdx)
    expect(parkIdx).toBeGreaterThan(parkGateIdx)
    expect(returnIdx).toBeGreaterThan(parkIdx)
    expect(notifyIdx).toBeGreaterThan(returnIdx)
    // same preComplete flag for park — no post-complete hasLiveAgentKeepaliveChildren re-sample
    const postComplete = utils.slice(completeIdx, parkIdx)
    expect(postComplete).not.toContain('hasLiveAgentKeepaliveChildren(')
    // strips old turn_duration
    expect(utils).toContain("subtype === 'turn_duration'")
  })

  test('AgentTool mid-bg complete path also defers owner notify on live children', () => {
    const agent = readFileSync(
      join(import.meta.dir, '../AgentTool.tsx'),
      'utf8',
    )
    expect(agent).toContain('sweepAndDetectLiveAgentChildren')
    expect(agent).toContain('parkAgentOnKeepaliveDeferNotify')
    expect(agent).toContain('suppressTelemetry: preCompleteJxt')
    expect(agent).toContain('skipJeo: true')
    expect(agent).toContain('if (preCompleteJxt)')
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
    // mid-bg: no post-complete re-sample between complete and park
    expect(agent.slice(completeIdx, parkIdx)).not.toContain(
      'hasLiveAgentKeepaliveChildren(',
    )
  })
})
