/**
 * densable Mu defer helpers — Uan / Ban / CSt / LEm toast strings (239).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  mI,
  registerAutoReactAvailability,
  resetArtifactAutoReactStoreForTests,
} from '../../services/artifactAutoReact/index.js'
import {
  countAbandonableLeftArrow,
  countNewMonitorsSincePress,
  formatDeferCapRestartableToast,
  formatDeferMonitorCancelToast,
  formatDeferSkipAbandonToast,
  isLeftArrowDeferStickyQueueCmd,
} from '../leftArrowConfirm.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT
})

function armAutoReact(): void {
  resetArtifactAutoReactStoreForTests()
  process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
  registerAutoReactAvailability(() => true)
  mI()
}

describe('leftArrowDefer densable Mu helpers (239)', () => {
  test('Ban: counts monitors not in carriedAtPress', () => {
    armAutoReact()
    const tasks = {
      a: {
        id: 'a',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'new-mon',
        frameLive: { slug: 'new-mon' },
      },
      b: {
        id: 'b',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'old-mon',
        frameLive: { slug: 'old-mon' },
      },
    } as never
    expect(countNewMonitorsSincePress(tasks, new Set(['old-mon']))).toBe(1)
    expect(
      countNewMonitorsSincePress(tasks, new Set(['old-mon', 'new-mon'])),
    ).toBe(0)
  })

  test('Ban: bare frameLive without autoReactArmed is not a monitor', () => {
    armAutoReact()
    const tasks = {
      a: {
        id: 'a',
        type: 'local_agent',
        status: 'running',
        frameLive: { slug: 'orphan' },
      },
    } as never
    expect(countNewMonitorsSincePress(tasks, new Set())).toBe(0)
  })

  test('CSt: only goal-checkin sticky', () => {
    expect(
      isLeftArrowDeferStickyQueueCmd({
        origin: { kind: 'task-notification', source: 'goal-checkin' },
      }),
    ).toBe(true)
    expect(
      isLeftArrowDeferStickyQueueCmd({
        origin: { kind: 'task-notification', source: 'other' },
      }),
    ).toBe(false)
    expect(
      isLeftArrowDeferStickyQueueCmd({ origin: { kind: 'channel' } }),
    ).toBe(false)
  })

  test('Uan: empty tasks → 0 abandonable', () => {
    expect(countAbandonableLeftArrow({})).toBe(0)
  })

  test('toast strings match densable LEm / Ban / skip', () => {
    expect(formatDeferCapRestartableToast(1)).toContain('1 running subagent')
    expect(formatDeferCapRestartableToast(2)).toContain('2 running subagents')
    expect(formatDeferSkipAbandonToast(1)).toContain('1 background task')
    expect(formatDeferMonitorCancelToast(2)).toContain(
      '2 Artifact comment monitors',
    )
  })
})
