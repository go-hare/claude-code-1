import { describe, expect, test } from 'bun:test'
import { CronCreateTool } from '../../../packages/builtin-tools/src/tools/ScheduleCronTool/CronCreateTool.js'
import { computeNextCronRun, parseCronExpression } from '../cron.js'
import {
  DEFAULT_CRON_JITTER_CONFIG,
  jitteredNextCronRunMs,
  nextScheduledFireAtMs,
  oneShotJitteredNextCronRunMs,
} from '../cronTasks.js'

describe('2.1.299 cron DST & nextFireAt alignments', () => {
  test('#638: nextScheduledFireAtMs matches jittered recurring & one-shot times', () => {
    const createdAt = Date.UTC(2026, 5, 1, 12, 0, 0)
    const id = '80000000'
    const recurringFire = nextScheduledFireAtMs(
      { id, cron: '0 * * * *', createdAt, recurring: true },
      DEFAULT_CRON_JITTER_CONFIG,
    )
    expect(recurringFire).toBe(
      jitteredNextCronRunMs(
        '0 * * * *',
        createdAt,
        id,
        DEFAULT_CRON_JITTER_CONFIG,
      ),
    )

    const oneShotFire = nextScheduledFireAtMs(
      { id, cron: '0 15 * * *', createdAt, recurring: false },
      DEFAULT_CRON_JITTER_CONFIG,
    )
    expect(oneShotFire).toBe(
      oneShotJitteredNextCronRunMs(
        '0 15 * * *',
        createdAt,
        id,
        DEFAULT_CRON_JITTER_CONFIG,
      ),
    )
  })

  test('#638: CronCreateTool returns nextFireAt in output data', async () => {
    const out = await CronCreateTool.call({
      cron: '*/5 * * * *',
      prompt: 'ping',
      recurring: true,
      durable: false,
    })
    expect(typeof out.data.nextFireAt).toBe('number')
    expect(out.data.nextFireAt!).toBeGreaterThan(Date.now() - 1000)
  })

  test('#666: computeNextCronRun skips repeated DST fall-back hour for recurring crons and respects oneShot', () => {
    const prevTz = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // 2026-11-01 01:30 EDT (first 1:30am, UTC 05:30)
      const first130 = new Date('2026-11-01T05:30:00.000Z')
      const fields = parseCronExpression('45 1 * * *')!

      // One-shot at 1:45am from first 1:30am: fires at first 1:45am (05:45Z)
      const oneShot1 = computeNextCronRun(fields, first130, { oneShot: true })
      expect(oneShot1?.toISOString()).toBe('2026-11-01T05:45:00.000Z')

      // Recurring 1:45am from first 1:45am (05:45Z) must NOT re-fire in the repeated 1:45am EST (06:45Z);
      // it must advance to the next day 2026-11-02 01:45 EST (06:45Z).
      const afterFirst145 = new Date('2026-11-01T05:45:00.000Z')
      const recurringNext = computeNextCronRun(fields, afterFirst145)
      expect(recurringNext?.toISOString()).toBe('2026-11-02T06:45:00.000Z')

      // Wildcard hour every-minute cron during repeated 1am hour (06:15Z = second 1:15am EST):
      // recurring skips repeated hour -> 07:00Z (2:00am EST)
      const everyMin = parseCronExpression('* * * * *')!
      const inRepeatedHour = new Date('2026-11-01T06:15:00.000Z')
      expect(computeNextCronRun(everyMin, inRepeatedHour)?.toISOString()).toBe(
        '2026-11-01T07:00:00.000Z',
      )
      // one-shot fires at the very next minute 06:16Z
      expect(
        computeNextCronRun(everyMin, inRepeatedHour, {
          oneShot: true,
        })?.toISOString(),
      ).toBe('2026-11-01T06:16:00.000Z')
    } finally {
      if (prevTz === undefined) delete process.env.TZ
      else process.env.TZ = prevTz
    }
  })
})
