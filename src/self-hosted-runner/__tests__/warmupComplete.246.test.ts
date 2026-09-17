/**
 * densable 2.1.246 — PollWork `warmup_complete` + poll-loop `Be`/`ot`/`He`.
 *
 * Official pollWork body @207614666:
 *   {available_capacity, ...wake_source, ...warmup_complete}
 * Official loop @218488821:
 *   if (Be && !ot && !Ae && U>0) { try { ot = await He() } catch { ot = false } }
 *   pollWork(..., We ? Yi[te] : void 0, Be ? ot : void 0)
 * Be = warmupReportEnabledOverride ?? false
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSelfHostedRunnerApi } from '../runnerApi.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('densable 2.1.246 warmup_complete', () => {
  test('pollWork posts warmup_complete only when the 6th arg is defined', async () => {
    const post = mock(async (_url: string, body: Record<string, unknown>) => ({
      status: 200,
      data: { assignment_ids: [], session_assignments: [] },
      headers: {},
    }))
    const api = createSelfHostedRunnerApi({
      baseUrl: 'https://api.example.test',
      poolSecret: 's',
      http: { post, get: mock(), put: mock() } as never,
    })
    await api.pollWork('rtok', 'r1', 1, undefined, undefined, true)
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      available_capacity: 1,
      warmup_complete: true,
    })
    await api.pollWork('rtok', 'r1', 1)
    expect(post.mock.calls[1]?.[1]).toEqual({ available_capacity: 1 })
  })

  test('poll loop source-locks Be / He / warmup_complete wire', () => {
    const src = readFileSync(
      join(ROOT, 'self-hosted-runner/rootRunner.ts'),
      'utf8',
    )
    expect(src).toContain('warmupReportEnabledOverride ?? false')
    expect(src).toContain('opts.readWarmupComplete ?? readWarmupCompleteOs')
    expect(src).toContain('warmupReportEnabled ? warmupComplete : undefined')
    expect(src).toContain(
      '[runner:poll] warm-up complete (first network prefetch succeeded) — reporting warmup_complete=true from this poll on',
    )
    const apiSrc = readFileSync(
      join(ROOT, 'self-hosted-runner/runnerApi.ts'),
      'utf8',
    )
    expect(apiSrc).toContain('warmup_complete: warmupComplete')
  })
})
