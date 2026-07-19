import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realMessageQueue from '../../../utils/messageQueueManager.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const enqueued: Array<{
  value: string
  mode?: string
  priority?: string
  agentId?: string
  taskId?: string
}> = []

// Spread real messageQueueManager so process-global mock.module keeps full
// surface for sibling LocalShellTask suites. Do NOT mock config/growthbook/
// bootstrap — incomplete mocks poison addSlowOperation / saveGlobalConfig.
function messageQueueMock() {
  return {
    ...realMessageQueue,
    enqueuePendingNotification: (cmd: (typeof enqueued)[number]) => {
      enqueued.push(cmd)
      return true
    },
  }
}
mock.module('src/utils/messageQueueManager.js', messageQueueMock)
mock.module('../../utils/messageQueueManager.js', messageQueueMock)

const {
  createTokenBucket,
  createLineBatcher,
  createMonitorEventSink,
  enqueueMonitorEventNotification,
  MONITOR_EVENT_BUCKET_CAPACITY,
  MONITOR_EVENT_REFILL_MS,
  MONITOR_EVENT_KILL_WINDOW_MS,
  MONITOR_EVENT_MAX_LINE_CHARS,
  MONITOR_EVENT_MAX_BATCH_CHARS,
} = await import('../monitorEventNotify.js')

describe('monitorEventNotify densable Aio/Nre', () => {
  beforeEach(() => {
    enqueued.length = 0
  })

  afterEach(() => {
    enqueued.length = 0
  })

  test('token bucket capacity rns=10, refill wio=2000', () => {
    let t = 0
    const b = createTokenBucket(
      MONITOR_EVENT_BUCKET_CAPACITY,
      MONITOR_EVENT_REFILL_MS,
      () => t,
    )
    for (let i = 0; i < MONITOR_EVENT_BUCKET_CAPACITY; i++) {
      expect(b.tryConsume()).toBe(true)
    }
    expect(b.tryConsume()).toBe(false)
    t += MONITOR_EVENT_REFILL_MS
    expect(b.tryConsume()).toBe(true)
    expect(b.tryConsume()).toBe(false)
    t += MONITOR_EVENT_REFILL_MS * 3
    expect(b.tryConsume()).toBe(true)
    expect(b.tryConsume()).toBe(true)
    expect(b.tryConsume()).toBe(true)
    expect(b.tryConsume()).toBe(false)
  })

  test('line batcher trims, truncates long lines, debounce-flushes', () => {
    const batches: string[] = []
    // object holder so nested schedule can assign without TS null narrowing
    const hold: { fire: (() => void) | null } = { fire: null }
    const batcher = createLineBatcher(
      b => batches.push(b),
      cb => {
        hold.fire = cb
        return () => {
          hold.fire = null
        }
      },
    )
    batcher.onData('  hello  \n')
    batcher.onData('world\n')
    expect(batches).toHaveLength(0)
    hold.fire?.()
    expect(batches).toEqual(['hello\nworld'])

    const long = 'x'.repeat(MONITOR_EVENT_MAX_LINE_CHARS + 50)
    batcher.onData(long + '\n')
    hold.fire?.()
    expect(batches[1]).toContain('...(truncated)')
    expect(batches[1]!.length).toBeLessThanOrEqual(
      MONITOR_EVENT_MAX_LINE_CHARS + '...(truncated)'.length,
    )
  })

  test('Nre enqueues Monitor event with priority next + Ul escape', () => {
    enqueueMonitorEventNotification(
      'Watch <app>',
      'line with <tag> & amps',
      'task-1',
      { agentId: 'agent-nested' as any },
    )
    expect(enqueued).toHaveLength(1)
    const cmd = enqueued[0]!
    expect(cmd.mode).toBe('task-notification')
    expect(cmd.priority).toBe('next')
    expect(cmd.agentId).toBe('agent-nested')
    // Official: task-id is XML body only, not QueuedCommand.taskId
    expect(cmd.taskId).toBeUndefined()
    expect(cmd.value).toContain('Monitor event: "Watch &lt;app&gt;"')
    expect(cmd.value).toContain(
      '<event>line with &lt;tag&gt; &amp; amps</event>',
    )
    expect(cmd.value).toContain('<task-id>task-1</task-id>')
    expect(cmd.value).not.toContain('PushNotification')
  })

  test('Aio delivers under rate limit; suppresses then reports', () => {
    let t = 0
    const kills: number[] = []
    let scheduled: Array<() => void> = []
    const sink = createMonitorEventSink({
      description: 'logs',
      agentId: 'agent-logs' as any,
      taskRef: { id: 'm1' },
      killTask: () => kills.push(t),
      now: () => t,
      schedule: cb => {
        scheduled.push(cb)
        return () => {
          scheduled = scheduled.filter(x => x !== cb)
        }
      },
    })

    // 10 allowed immediately (bucket capacity)
    for (let i = 0; i < MONITOR_EVENT_BUCKET_CAPACITY; i++) {
      sink.onData(`evt-${i}\n`)
      // flush each line immediately
      const cbs = [...scheduled]
      scheduled = []
      for (const cb of cbs) cb()
    }
    expect(enqueued.length).toBe(MONITOR_EVENT_BUCKET_CAPACITY)
    expect(enqueued[0]!.value).toContain('Monitor event: "logs"')
    expect(enqueued[0]!.value).toContain('<event>evt-0</event>')

    // next ones suppressed (no token)
    enqueued.length = 0
    sink.onData('flood-a\n')
    for (const cb of [...scheduled]) {
      scheduled = []
      cb()
    }
    // no event yet while suppressed (housekeeping only after a successful consume)
    expect(enqueued).toHaveLength(0)

    // refill one token → suppress notice + delivery
    t += MONITOR_EVENT_REFILL_MS
    sink.onData('after-refill\n')
    for (const cb of [...scheduled]) {
      scheduled = []
      cb()
    }
    expect(enqueued.length).toBe(2)
    expect(enqueued[0]!.value).toContain('events suppressed')
    expect(enqueued[0]!.value).toContain('TaskStop')
    // housekeeping: no PushNotification hint
    expect(enqueued[0]!.value).not.toContain('PushNotification')
    expect(enqueued[1]!.value).toContain('<event>after-refill</event>')
    expect(kills).toHaveLength(0)
  })

  test('Aio auto-kills after O9g sustained flood', () => {
    let t = 0
    const kills: number[] = []
    let scheduled: Array<() => void> = []
    const flush = () => {
      const cbs = [...scheduled]
      scheduled = []
      for (const cb of cbs) cb()
    }
    const sink = createMonitorEventSink({
      description: 'noisy',
      agentId: 'agent-noisy' as any,
      taskRef: { id: 'm2' },
      killTask: () => kills.push(t),
      now: () => t,
      schedule: cb => {
        scheduled.push(cb)
        return () => {
          scheduled = scheduled.filter(x => x !== cb)
        }
      },
    })

    // densable kill requires a failed tryConsume while windowStart is still
    // active (>O9g). Window resets on successful consume only when the last
    // suppress was > wio*3 ago — so flood must stay continuous (last suppress
    // recent) while outrunning the 1-token / 2s refill for 30s+.
    for (let i = 0; i < MONITOR_EVENT_BUCKET_CAPACITY; i++) {
      sink.onData(`ok-${i}\n`)
      flush()
    }
    enqueued.length = 0

    // Step every 100ms, 3 lines/step (> refill rate) for O9g + a bit.
    const step = 100
    const end = MONITOR_EVENT_KILL_WINDOW_MS + 500
    for (let ms = 0; ms <= end && kills.length === 0; ms += step) {
      t = ms
      sink.onData(`flood-${ms}-a\n`)
      sink.onData(`flood-${ms}-b\n`)
      sink.onData(`flood-${ms}-c\n`)
      flush()
    }

    expect(kills.length).toBeGreaterThanOrEqual(1)
    expect(kills[0]!).toBeGreaterThan(MONITOR_EVENT_KILL_WINDOW_MS)
    expect(enqueued.some(e => e.value.includes('Monitor stopped'))).toBe(true)
    expect(enqueued.some(e => e.value.includes('too much output'))).toBe(true)
    expect(sink.isKilled()).toBe(true)

    // further data ignored
    enqueued.length = 0
    sink.onData('after-kill\n')
    flush()
    expect(enqueued).toHaveLength(0)
  })

  test('finish flushes partial buffer and latches killed', () => {
    let scheduled: Array<() => void> = []
    const sink = createMonitorEventSink({
      description: 'partial',
      agentId: 'agent-partial' as any,
      taskRef: { id: 'm3' },
      killTask: () => {},
      schedule: cb => {
        scheduled.push(cb)
        return () => {
          scheduled = scheduled.filter(x => x !== cb)
        }
      },
    })
    sink.onData('no-newline-yet')
    expect(enqueued).toHaveLength(0)
    sink.finish()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.value).toContain('<event>no-newline-yet</event>')
    expect(sink.isKilled()).toBe(true)
  })

  test('batch char cap YFu applied', () => {
    const batches: string[] = []
    const hold: { fire: (() => void) | null } = { fire: null }
    const batcher = createLineBatcher(
      b => batches.push(b),
      cb => {
        hold.fire = cb
        return () => {
          hold.fire = null
        }
      },
    )
    // Many medium lines that together exceed YFu
    const line = 'y'.repeat(200)
    for (let i = 0; i < 20; i++) {
      batcher.onData(line + '\n')
    }
    hold.fire?.()
    expect(batches).toHaveLength(1)
    expect(batches[0]!.length).toBeLessThanOrEqual(
      MONITOR_EVENT_MAX_BATCH_CHARS + '\n...(truncated)'.length,
    )
    expect(batches[0]!).toContain('...(truncated)')
  })

  test('constants match densable rns/wio/O9g/Cio/YFu/L9g', () => {
    expect(MONITOR_EVENT_BUCKET_CAPACITY).toBe(10)
    expect(MONITOR_EVENT_REFILL_MS).toBe(2000)
    expect(MONITOR_EVENT_KILL_WINDOW_MS).toBe(30_000)
    expect(MONITOR_EVENT_MAX_LINE_CHARS).toBe(500)
    expect(MONITOR_EVENT_MAX_BATCH_CHARS).toBe(3000)
  })
})
