import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from '../../types/message.js'
import { TranscriptLogger } from '../useLogMessages.js'

function makeUser(uuid: string, text = 'hi'): Message {
  return {
    type: 'user',
    uuid: uuid as UUID,
    message: { role: 'user', content: text },
  } as unknown as Message
}

function makeAssistant(uuid: string, text = 'hello'): Message {
  return {
    type: 'assistant',
    uuid: uuid as UUID,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  } as unknown as Message
}

function makeProgress(uuid: string): Message {
  return {
    type: 'progress',
    uuid: uuid as UUID,
    data: { type: 'hook_progress' },
  } as unknown as Message
}

describe('#1320 TranscriptLogger (MDe) state machine', () => {
  test('holdFloor skips resumed messages when ignore transitions true -> false and records new reply', async () => {
    const calls: Array<{
      sliceUuids: string[]
      parentHint: UUID | undefined
    }> = []
    const logger = new TranscriptLogger(async (slice, _opts, parentHint) => {
      calls.push({
        sliceUuids: slice.map(m => m.uuid),
        parentHint,
      })
      return (slice[slice.length - 1]?.uuid as UUID | undefined) ?? null
    })

    const resumed = [makeUser('u1'), makeAssistant('a1')]
    // While ignore=true on resume, holdFloor is set to 2.
    await logger.write(resumed, { ignore: true })
    expect(logger.holdFloor).toBe(2)
    expect(calls).toHaveLength(0)

    // User sends first prompt after resume; ignore transitions to false.
    const withNewUser = [...resumed, makeUser('u2')]
    await logger.write(withNewUser, { ignore: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sliceUuids).toEqual(['u2'])
    expect(calls[0]!.parentHint).toBeUndefined()

    // First assistant reply arrives incrementally -> chains onto u2.
    const withFirstReply = [...withNewUser, makeAssistant('a2')]
    await logger.write(withFirstReply, { ignore: false })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.sliceUuids).toEqual(['a2'])
    expect(calls[1]!.parentHint).toBe('u2' as UUID)
  })

  test('detects non-loggable tail mutation and falls back to full write when tail uuid changes', async () => {
    const calls: Array<{ sliceUuids: string[]; parentHint: UUID | undefined }> =
      []
    const logger = new TranscriptLogger(async (slice, _opts, parentHint) => {
      calls.push({ sliceUuids: slice.map(m => m.uuid), parentHint })
      return (slice[slice.length - 1]?.uuid as UUID | undefined) ?? null
    })

    await logger.write([makeUser('u1'), makeProgress('p1')], { ignore: false })
    expect(logger.lastTailUuid).toBe('p1' as UUID)
    expect(logger.lastLoggable?.uuid).toBe('u1' as UUID)

    // Non-loggable progress p1 replaced by p2 while a1 appended: still intact because u1 is intact and p2 is non-loggable
    await logger.write(
      [makeUser('u1'), makeProgress('p2'), makeAssistant('a1')],
      {
        ignore: false,
      },
    )
    expect(calls[1]!.sliceUuids).toEqual(['a1'])
    expect(calls[1]!.parentHint).toBe('u1' as UUID)
  })

  test('parentWait serializes overlapping full-array writes and replays latest next', async () => {
    let resolveFirst!: (uuid: UUID | null) => void
    let hangNext = false
    const calls: Array<string[]> = []
    const logger = new TranscriptLogger(async slice => {
      calls.push(slice.map(m => m.uuid))
      if (hangNext) {
        hangNext = false
        return new Promise<UUID | null>(r => {
          resolveFirst = r
        })
      }
      return (slice[slice.length - 1]?.uuid as UUID | undefined) ?? null
    })

    // Seed initial state
    await logger.write([makeUser('u1')], { ignore: false })
    calls.length = 0
    hangNext = true

    // Compaction (first uuid changed) triggers parentWait
    const p1 = logger.write([makeUser('u2'), makeAssistant('a2')], {
      ignore: false,
    })
    expect(logger.parentWait).toBeDefined()

    // Concurrent write while parentWait is active is queued in parentWait.next
    void logger.write([makeUser('u2'), makeAssistant('a2'), makeUser('u3')], {
      ignore: false,
    })
    expect(calls).toHaveLength(1)

    resolveFirst('a2' as UUID)
    await p1
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['u3'])
  })
})
