import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyBgReplyStateUpdate,
  BG_REPLY_NOT_RUNNING_ERROR,
  sendBgReply,
} from '../clientAttach.js'
import type { BgJobState } from '../jobState.js'
import {
  findContinuedInSessionId,
  scanParkedContinuedInTranscript,
} from '../transcriptProbe.js'

describe('v2.1.290 #112: Zxi parked continued-in cross-scan', () => {
  test('findContinuedInSessionId returns continuedInSessionId before real turns', () => {
    const tail = [
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'end_turn' },
      }),
      JSON.stringify({
        type: 'continued-in',
        continuedInSessionId: 'sess-next-123',
      }),
    ].join('\n')
    expect(findContinuedInSessionId(tail)).toBe('sess-next-123')
  })

  test('findContinuedInSessionId returns undefined if superseded by assistant end_turn', () => {
    const tail = [
      JSON.stringify({
        type: 'continued-in',
        continuedInSessionId: 'sess-old',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'end_turn' },
      }),
    ].join('\n')
    expect(findContinuedInSessionId(tail)).toBeUndefined()
  })

  test('scanParkedContinuedInTranscript finds matching parked .jsonl with parentUuid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxi-test-'))
    try {
      const target = join(dir, 'parked.jsonl')
      writeFileSync(
        target,
        [
          JSON.stringify({
            type: 'user',
            parentUuid: 'p1',
            message: { content: 'hi' },
          }),
          JSON.stringify({
            type: 'continued-in',
            continuedInSessionId: 'target-sess',
          }),
        ].join('\n'),
      )
      const found = await scanParkedContinuedInTranscript(dir, 'target-sess')
      expect(found).toBe(target)
      expect(
        await scanParkedContinuedInTranscript(dir, 'other-sess'),
      ).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('v2.1.290 #71: reply after bg finish', () => {
  test('applyBgReplyStateUpdate promotes terminal state back to working and clears output', () => {
    const prev: BgJobState = {
      short: 'abcd',
      sessionId: 's1',
      cwd: '/tmp',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'done',
      tempo: 'idle',
      output: 'old',
      suggestedReply: 'yes',
    } as unknown as BgJobState
    const next = applyBgReplyStateUpdate(prev, '  continue   now  ')
    expect(next.state).toBe('working')
    expect(next.tempo).toBe('active')
    expect(next.detail).toBe('continue now')
    expect(next.output).toBeNull()
    expect(next.suggestedReply).toBeUndefined()
  })

  test('sendBgReply maps ENOJOB to BG_REPLY_NOT_RUNNING_ERROR', async () => {
    const res = await sendBgReply('abcd', 'hello', {
      sendRequest: async () => ({ ok: false, code: 'ENOJOB', error: 'gone' }),
    })
    expect(res).toEqual({
      err: BG_REPLY_NOT_RUNNING_ERROR,
      code: 'ENOJOB',
    })
  })
})
