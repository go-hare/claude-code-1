import { describe, expect, test } from 'bun:test'
import {
  resurrectSessionCronsFromScan,
  runOrphanCronResumePass,
  scanSessionCronsFromMessages,
} from '../orphanCronResume.js'
import { DEFAULT_CRON_JITTER_CONFIG } from '../cronTasks.js'

describe('scanSessionCronsFromMessages (Rqb cron subset)', () => {
  test('collects CronCreate call + result and CronDelete id', () => {
    const r = scanSessionCronsFromMessages([
      {
        type: 'assistant',
        timestamp: new Date(1_000_000).toISOString(),
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'cc1',
              name: 'CronCreate',
              input: { cron: '0 * * * *', prompt: 'ping' },
            },
            {
              type: 'tool_use',
              id: 'cd1',
              name: 'CronDelete',
              input: { id: 'dead' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'cc1', is_error: false },
          ],
        },
        toolUseResult: {
          id: 'cron-1',
          durable: false,
          recurring: true,
        },
      },
    ])
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]?.toolUseId).toBe('cc1')
    expect(r.results.get('cc1')).toMatchObject({ id: 'cron-1', durable: false })
    expect(r.deletedCronIds.has('dead')).toBe(true)
  })
})

describe('resurrectSessionCronsFromScan (Pqb)', () => {
  test('resurrects non-durable recurring session cron', () => {
    const added: Array<{ id: string; cron: string; prompt: string }> = []
    let enabled: boolean | undefined
    const r = resurrectSessionCronsFromScan(
      {
        calls: [
          {
            toolUseId: 'cc1',
            input: { cron: '*/5 * * * *', prompt: 'check' },
            createdAt: Date.now() - 60_000,
          },
        ],
        results: new Map([
          ['cc1', { id: 'abc12345', durable: false, recurring: true }],
        ]),
        deletedCronIds: new Set(),
      },
      {
        cronEnabled: true,
        getLiveCronIds: () => new Set(),
        addSessionCron: t => added.push(t),
        setScheduledTasksEnabled: v => {
          enabled = v
        },
      },
    )
    expect(r.resurrected).toBe(1)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      id: 'abc12345',
      cron: '*/5 * * * *',
      prompt: 'check',
      recurring: true,
    })
    expect(enabled).toBe(true)
  })

  test('skips durable, deleted, live, and aged recurring', () => {
    const added: string[] = []
    const now = Date.now()
    const scan = {
      calls: [
        {
          toolUseId: 'd',
          input: { cron: '* * * * *', prompt: 'd' },
          createdAt: now,
        },
        {
          toolUseId: 'del',
          input: { cron: '* * * * *', prompt: 'x' },
          createdAt: now,
        },
        {
          toolUseId: 'live',
          input: { cron: '* * * * *', prompt: 'l' },
          createdAt: now,
        },
        {
          toolUseId: 'old',
          input: { cron: '* * * * *', prompt: 'o' },
          createdAt: now - DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs - 1,
        },
      ],
      results: new Map([
        ['d', { id: 'dur1', durable: true, recurring: true }],
        ['del', { id: 'gone', durable: false, recurring: true }],
        ['live', { id: 'alive', durable: false, recurring: true }],
        ['old', { id: 'stale', durable: false, recurring: true }],
      ]),
      deletedCronIds: new Set(['gone']),
    }
    const r = resurrectSessionCronsFromScan(scan, {
      nowMs: now,
      cronEnabled: true,
      getLiveCronIds: () => new Set(['alive']),
      addSessionCron: t => added.push(t.id),
      setScheduledTasksEnabled: () => {},
    })
    expect(r.resurrected).toBe(0)
    expect(added).toEqual([])
    expect(r.skipped).toBe(4)
  })

  test('cronEnabled false is no-op', () => {
    const r = resurrectSessionCronsFromScan(
      {
        calls: [
          {
            toolUseId: 'cc1',
            input: { cron: '* * * * *', prompt: 'p' },
            createdAt: Date.now(),
          },
        ],
        results: new Map([['cc1', { id: 'x', durable: false }]]),
        deletedCronIds: new Set(),
      },
      { cronEnabled: false, addSessionCron: () => {} },
    )
    expect(r).toEqual({ resurrected: 0, skipped: 0 })
  })

  test('Pqb product path sources getCronJitterConfig (official trt)', async () => {
    // Official Pqb: o=trt() — live tengu_kairos_cron_config, not frozen default.
    const src = await Bun.file(
      new URL('../orphanCronResume.ts', import.meta.url),
    ).text()
    const fnStart = src.indexOf('export function resurrectSessionCronsFromScan')
    const fnBody = src.slice(fnStart, fnStart + 4500)
    expect(fnBody).toContain('getCronJitterConfig')
    expect(fnBody).toContain('cronJitterConfig')
    // Injected jitterConfig still preferred when provided (tests).
    expect(fnBody).toContain('opts?.jitterConfig')
  })
})

describe('runOrphanCronResumePass', () => {
  test('end-to-end scan + resurrect', () => {
    const added: string[] = []
    const r = runOrphanCronResumePass(
      [
        {
          type: 'assistant',
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'cc1',
                name: 'CronCreate',
                input: { cron: '0 9 * * *', prompt: 'morning' },
              },
            ],
          },
        },
        {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'cc1', is_error: false },
            ],
          },
          toolUseResult: { id: 'morn01', durable: false, recurring: true },
        },
      ],
      {
        cronEnabled: true,
        getLiveCronIds: () => [],
        addSessionCron: t => added.push(t.id),
        setScheduledTasksEnabled: () => {},
      },
    )
    expect(r.scanned).toBe(1)
    expect(r.resurrected).toBe(1)
    expect(added).toEqual(['morn01'])
  })
})
