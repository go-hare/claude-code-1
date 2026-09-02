/**
 * densable autoReact reply / durable / frameLive re-arm (2.1.239) — 1:1 locks.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  addUnattendedReplies,
  bumpUnattendedReply,
  drainUnattendedReplies,
  formatUnattendedReplyNotice,
  FRAME_LIVE_ENTRY_CAP,
  markStaleFrameLive,
  mergeFrameLiveEntries,
  mI,
  parseDurableRegistry,
  parkUnresumedFrameLive,
  publishDurableRegistry,
  rearmCarriedFrameLive,
  registerAutoReactAvailability,
  resetArtifactAutoReactStoreForTests,
  restoreDurableRegistry,
  setDurableRegistrySink,
  stampUnattendedIntoFrameLive,
  Stn,
  takeUnattendedReplies,
  un,
  upsertDurableWatchRow,
} from '../../services/artifactAutoReact/index.js'
import {
  mergeCheckpointPayloads,
  emptyCheckpointPayload,
} from '../bgCheckpoint.js'
import type { SetAppState } from '../../Task.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT
  delete process.env.CLAUDE_CODE_REMOTE
})

function armAutoReact(): void {
  resetArtifactAutoReactStoreForTests()
  process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
  registerAutoReactAvailability(() => true)
  mI()
}

function makeSetAppState(): {
  setAppState: SetAppState
  tasks: () => Record<string, unknown>
} {
  let state = { tasks: {} as Record<string, unknown> }
  const setAppState: SetAppState = updater => {
    state = updater(state as never) as typeof state
  }
  return { setAppState, tasks: () => state.tasks }
}

describe('unattended reply pipeline (Skl/wkl/Ekl/C3i/oDE)', () => {
  test('wkl/Ekl/LAm/C3i counters', () => {
    bumpUnattendedReply('a')
    bumpUnattendedReply('a')
    addUnattendedReplies('b', 3)
    expect(takeUnattendedReplies('a')).toBe(2)
    expect(takeUnattendedReplies('a')).toBe(0)
    const drained = drainUnattendedReplies()
    expect(drained.total).toBe(3)
    expect(drained.bySlug.get('b')).toBe(3)
    expect(drainUnattendedReplies().total).toBe(0)
  })

  test('oDE stamps and drains into frameLive', () => {
    addUnattendedReplies('x', 2)
    const stamped = stampUnattendedIntoFrameLive([
      { slug: 'x', writtenAtMs: 1 },
      { slug: 'y', writtenAtMs: 2, unattendedReplies: 1 },
    ])
    expect(stamped.find(e => e.slug === 'x')?.unattendedReplies).toBe(2)
    expect(stamped.find(e => e.slug === 'y')?.unattendedReplies).toBe(1)
    expect(drainUnattendedReplies().total).toBe(0)
  })

  test('Akl notice copy', () => {
    expect(
      formatUnattendedReplyNotice(1, { where: ' on u', stop: ' stop' }),
    ).toBe('Claude auto-replied to 1 comment on u while you were away. stop')
    expect(formatUnattendedReplyNotice(2)).toContain('2 comments')
  })
})

describe('xGl mergeFrameLiveEntries + uKy merge', () => {
  test('sums unattended and newest wins; caps at jNt', () => {
    const merged = mergeFrameLiveEntries([
      {
        entries: [{ slug: 'a', writtenAtMs: 1, unattendedReplies: 2 }],
        fallbackBasis: 1,
      },
      {
        entries: [
          { slug: 'a', writtenAtMs: 5, title: 'new' },
          { slug: 'b', writtenAtMs: 3 },
        ],
        fallbackBasis: 5,
      },
    ])
    expect(merged[0]?.slug).toBe('a')
    expect(merged[0]?.title).toBe('new')
    expect(merged[0]?.unattendedReplies).toBe(2)
    expect(merged).toHaveLength(2)
  })

  test('mergeCheckpointPayloads uses xGl for frameLive', () => {
    const a = emptyCheckpointPayload(10)
    a.frameLive = [{ slug: 'a', writtenAtMs: 1, unattendedReplies: 1 }]
    const b = emptyCheckpointPayload(20)
    b.frameLive = [{ slug: 'a', writtenAtMs: 20, title: 't' }]
    const m = mergeCheckpointPayloads(a, b)
    expect(m.frameLive).toEqual([
      { slug: 'a', writtenAtMs: 20, title: 't', unattendedReplies: 1 },
    ])
  })
})

describe('durable registry (lxl/d6e/sxm)', () => {
  test('upsert + publish via sink when REMOTE', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const published: unknown[] = []
    setDurableRegistrySink(p => published.push(p.artifact_durable_watches))
    upsertDurableWatchRow({
      slug: 's1',
      triggerId: 'trig-1',
      since: '2026-01-01T00:00:00.000Z',
      events: ['comment'],
    })
    publishDurableRegistry()
    expect(published).toHaveLength(1)
    const body = published[0] as {
      v: number
      rows: Record<string, { trigger_id: string }>
    }
    expect(body.v).toBe(1)
    expect(body.rows.s1.trigger_id).toBe('trig-1')
  })

  test('restoreDurableRegistry parses + applies stops', () => {
    restoreDurableRegistry(
      {
        artifact_durable_watches: {
          v: 1,
          rows: {
            s2: {
              trigger_id: 't2',
              since: '2026-01-01T00:00:00.000Z',
              events: ['comment'],
            },
          },
          stopped: { s3: { at_ms: 42 } },
          orphans: ['orphan-1'],
        },
      },
      { sink: null },
    )
    expect(un().durable.rows.get('s2')?.triggerId).toBe('t2')
    expect(un().durable.orphanTriggers.has('orphan-1')).toBe(true)
    expect(un().commentMonitorIntent.bySlug.get('s3')?.state).toBe('stopped')
    expect(un().durable.stopLatches.isStopped('s3')).toBe(true)
  })

  test('parseDurableRegistry rejects incomplete envelopes', () => {
    expect(parseDurableRegistry({ rows: {} })).toBeNull()
  })
})

describe('CNy portable rearmCarriedFrameLive', () => {
  test('re-arms non-stale entries into monitor_ws + Stn', () => {
    armAutoReact()
    const { setAppState, tasks } = makeSetAppState()
    const result = rearmCarriedFrameLive(
      [
        { slug: 'art-1', writtenAtMs: Date.now(), title: 'Hello' },
        { slug: 'stale-1', writtenAtMs: 1, stale: true },
      ],
      { setAppState, autoReactEnabled: true },
    )
    expect(result.rearmed).toEqual(['art-1'])
    expect(result.skipped.some(s => s.slug === 'stale-1')).toBe(true)
    expect(Stn().has('art-1')).toBe(true)
    const mon = Object.values(tasks()).find(
      t => (t as { type?: string }).type === 'monitor_ws',
    ) as { autoReactArmed?: boolean; frameLive?: { slug: string } }
    expect(mon?.autoReactArmed).toBe(true)
    expect(mon?.frameLive?.slug).toBe('art-1')
  })

  test('disabled parks unresumed when jobDir set', () => {
    armAutoReact()
    const { setAppState } = makeSetAppState()
    const result = rearmCarriedFrameLive(
      [{ slug: 'park-1', writtenAtMs: Date.now() }],
      {
        setAppState,
        autoReactEnabled: false,
        jobDir: '/tmp/job',
        owner: '1',
      },
    )
    expect(result.willRearm).toBe(false)
    expect(un().unresumedFrameLive.get('/tmp/job')?.entries[0]?.slug).toBe(
      'park-1',
    )
    parkUnresumedFrameLive('/tmp/job', [], '1') // no-op when empty
  })

  test('markStaleFrameLive ages out', () => {
    const now = 10_000
    const marked = markStaleFrameLive(
      [
        { slug: 'old', writtenAtMs: 1 },
        { slug: 'new', writtenAtMs: 9990 },
      ],
      now,
      100,
    )
    expect(marked.find(e => e.slug === 'old')?.stale).toBe(true)
    expect(marked.find(e => e.slug === 'new')?.stale).toBeUndefined()
  })

  test('entry cap is densable jNt', () => {
    expect(FRAME_LIVE_ENTRY_CAP).toBe(15)
  })
})
