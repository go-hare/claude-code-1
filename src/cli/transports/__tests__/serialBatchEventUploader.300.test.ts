import { describe, expect, test } from 'bun:test'
import {
  PayloadTooLargeError,
  PartialRetryableError,
  ResendInTwoError,
  RetryableError,
  type SendMeta,
  SerialBatchEventUploader,
} from '../SerialBatchEventUploader.js'

describe('SerialBatchEventUploader 1:1 SEA alignment (#590)', () => {
  test('urgent lane preempts normal pending and yields after MAX_URGENT_STREAK=4', async () => {
    const sent: Array<{
      batch: string[]
      urgent: boolean
      followsUrgent: boolean
    }> = []
    let releaseHold!: () => void
    const holdPromise = new Promise<void>(r => {
      releaseHold = r
    })

    const uploader = new SerialBatchEventUploader<string>({
      maxBatchSize: 1,
      maxQueueSize: 100,
      baseDelayMs: 5,
      maxDelayMs: 50,
      jitterMs: 0,
      send: async (batch, meta) => {
        if (batch[0] === 'first') await holdPromise
        sent.push({
          batch,
          urgent: meta.urgent,
          followsUrgent: meta.followsUrgent,
        })
      },
    })

    await uploader.enqueue('first')
    await uploader.enqueue(['n1', 'n2'])
    await uploader.enqueue(['u1', 'u2', 'u3', 'u4', 'u5'], { urgent: true })
    releaseHold()
    await uploader.flush()

    // 'first' -> 4 urgent ('u1'..'u4') -> yields to 1 normal ('n1' with followsUrgent=true) -> 'u5' -> 'n2'
    expect(sent.map(s => s.batch[0])).toEqual([
      'first',
      'u1',
      'u2',
      'u3',
      'u4',
      'n1',
      'u5',
      'n2',
    ])
    expect(sent[5]).toEqual({
      batch: ['n1'],
      urgent: false,
      followsUrgent: true,
    })
    expect(sent[6]).toEqual({
      batch: ['u5'],
      urgent: true,
      followsUrgent: false,
    })
    uploader.close()
  })

  test('ResendInTwoError splits cuttable batch at together boundary', async () => {
    const batches: Array<{ items: Array<{ id: number }>; cuttable: boolean }> =
      []
    let splitOnce = false
    const uploader = new SerialBatchEventUploader<{ id: number }>({
      maxBatchSize: 10,
      maxQueueSize: 100,
      baseDelayMs: 5,
      maxDelayMs: 50,
      jitterMs: 0,
      gatherTick: true,
      send: async (batch, meta) => {
        batches.push({ items: batch, cuttable: meta.cuttable })
        if (!splitOnce && meta.cuttable) {
          splitOnce = true
          throw new ResendInTwoError()
        }
      },
    })

    await uploader.enqueue([{ id: 1 }, { id: 2 }], { together: true })
    await uploader.enqueue({ id: 3 })
    await uploader.flush()

    expect(batches).toHaveLength(3)
    expect(batches[0]).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      cuttable: true,
    })
    expect(batches[1]).toEqual({
      items: [{ id: 1 }, { id: 2 }],
      cuttable: false,
    })
    expect(batches[2]).toEqual({
      items: [{ id: 3 }],
      cuttable: false,
    })
    uploader.close()
  })

  test('PayloadTooLargeError halves dynamic byteCap down to minBytes', async () => {
    const seenSizes: number[] = []
    let failFirst = true
    const uploader = new SerialBatchEventUploader<{ payload: string }>({
      maxBatchSize: 10,
      maxBatchBytes: 1000,
      maxQueueSize: 100,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterMs: 0,
      send: async batch => {
        seenSizes.push(batch.length)
        if (failFirst) {
          failFirst = false
          throw new PayloadTooLargeError('too big', 10)
        }
      },
    })

    await uploader.enqueue([
      { payload: 'a'.repeat(80) },
      { payload: 'b'.repeat(80) },
      { payload: 'c'.repeat(80) },
    ])
    await uploader.flush()

    expect(seenSizes[0]).toBe(3)
    expect(seenSizes[1]).toBe(1)
    expect(seenSizes.slice(1).reduce((a, b) => a + b, 0)).toBe(3)
    uploader.close()
  })

  test('PartialRetryableError and RetryableError track attempt kind correctly', async () => {
    const attempts: SendMeta['attempt'][] = []
    let step = 0
    const uploader = new SerialBatchEventUploader<string>({
      maxBatchSize: 10,
      maxQueueSize: 100,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterMs: 0,
      send: async (_batch, meta) => {
        attempts.push(meta.attempt)
        step++
        if (step === 1) throw new RetryableError('retry', 1)
        if (step === 2) throw new PartialRetryableError('partial', 1)
      },
    })

    await uploader.enqueue(['a', 'b'])
    await uploader.flush()

    expect(attempts).toEqual(['first', 'resend', 'resend'])
    uploader.close()
  })

  test('close({ retainUndelivered: true }) retains unsent items and withdraw() removes matching items', async () => {
    const uploader = new SerialBatchEventUploader<string>({
      maxBatchSize: 10,
      maxQueueSize: 100,
      baseDelayMs: 10,
      maxDelayMs: 100,
      jitterMs: 0,
      send: async () => {
        await new Promise(r => setTimeout(r, 50))
      },
    })

    uploader.setHold({ rule: 'test_hold', maxAgeMs: 5000 })
    await uploader.enqueue(['keep-1', 'drop-1', 'keep-2'])
    expect(uploader.held().count).toBe(3)
    expect(uploader.withdraw(x => x.startsWith('drop'))).toBe(1)
    expect(uploader.pendingCount).toBe(2)

    const count = uploader.close({ retainUndelivered: true })
    expect(count).toBe(2)
    expect(uploader.takeUndelivered()).toEqual(['keep-1', 'keep-2'])
    expect(uploader.discardUndelivered()).toBe(0)
  })
})
