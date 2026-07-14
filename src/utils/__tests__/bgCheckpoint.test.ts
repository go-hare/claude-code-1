import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  adoptTelemetry,
  buildAdoptWritePayload,
  buildMidTurnPrefill,
  emptyCheckpointPayload,
  mergeCheckpointPayloads,
  PREFILL_MAX_CHARS,
  readAdoptPrefill,
  truncatePartialTextForPrefill,
  writeAdoptJson,
} from '../bgCheckpoint.js'

const tmpDirs: string[] = []
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await rm(d, { recursive: true, force: true }).catch(() => {})
  }
})

describe('truncatePartialTextForPrefill', () => {
  test('keeps last max chars', () => {
    const s = 'a'.repeat(PREFILL_MAX_CHARS + 10)
    const out = truncatePartialTextForPrefill(s)
    expect(out.length).toBe(PREFILL_MAX_CHARS)
    expect(out.endsWith('a')).toBe(true)
  })
  test('trimEnd', () => {
    expect(truncatePartialTextForPrefill('hi  \n')).toBe('hi')
  })
})

describe('buildMidTurnPrefill', () => {
  test('only abort-then-fork with text', () => {
    expect(
      buildMidTurnPrefill({
        via: 'idle-fork',
        partialText: 'x',
      }),
    ).toBeUndefined()
    expect(
      buildMidTurnPrefill({
        via: 'abort-then-fork',
        partialText: '  partial  ',
        boundaryUuid: 'b1',
      }),
    ).toEqual({ text: '  partial', boundaryUuid: 'b1' })
  })
  test('skips when bridge or agents present', () => {
    expect(
      buildMidTurnPrefill({
        via: 'abort-then-fork',
        partialText: 'x',
        bridgeActive: true,
      }),
    ).toBeUndefined()
    expect(
      buildMidTurnPrefill({
        via: 'abort-then-fork',
        partialText: 'x',
        agentsCount: 1,
      }),
    ).toBeUndefined()
  })
})

describe('mergeCheckpointPayloads / Nro', () => {
  test('prefer incoming prefill + max writtenAtMs', () => {
    const a = emptyCheckpointPayload(100)
    a.shells = [{ id: 1 }]
    const b = buildAdoptWritePayload({
      base: emptyCheckpointPayload(200),
      prefill: { text: 'p' },
    })
    const m = mergeCheckpointPayloads(a, b)
    expect(m.writtenAtMs).toBe(200)
    expect(m.prefill?.text).toBe('p')
    expect(m.shells).toHaveLength(1)
  })
  test('adoptTelemetry counts', () => {
    expect(
      adoptTelemetry({
        writtenAtMs: 1,
        shells: [1, 2],
        cron: [{ id: 'c', cron: '*', prompt: 'p' }],
        agents: [1],
        workflows: [],
      }),
    ).toEqual({
      adopted_shells: 2,
      adopted_agents: 1,
      adopted_workflows: 0,
      adopted_cron: 1,
    })
  })
})

describe('writeAdoptJson / readAdoptPrefill (official sQt)', () => {
  test('round-trips prefill', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-'))
    tmpDirs.push(dir)
    await writeAdoptJson(
      dir,
      buildAdoptWritePayload({
        prefill: { text: 'partial <x>', boundaryUuid: 'u1' },
      }),
    )
    await expect(readAdoptPrefill(dir)).resolves.toEqual({
      text: 'partial <x>',
      boundaryUuid: 'u1',
    })
  })
  test('merges second write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-'))
    tmpDirs.push(dir)
    await writeAdoptJson(dir, {
      writtenAtMs: 1,
      shells: [{ a: 1 }],
      cron: [],
    })
    const written = await writeAdoptJson(
      dir,
      buildAdoptWritePayload({
        base: { writtenAtMs: 2, shells: [], cron: [] },
        prefill: { text: 'p2' },
      }),
    )
    expect(written.shells).toHaveLength(1)
    expect(written.prefill?.text).toBe('p2')
  })
})
