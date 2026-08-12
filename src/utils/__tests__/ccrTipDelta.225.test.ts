/**
 * densable 2.1.225 #10 — CCR tip sidecar + validated delta rehydrate.
 *
 * Gold: Etf/wtf/Ctf/J0a/Dsi/Q0a
 *   client-gated | no-sidecar | tip-not-in-tail
 *   updateCCRTipFromAckedBatch skips session_agent_id rows
 *   hydrateFromCCRv2InternalEvents appends when tip in local tail
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UUID } from 'crypto'

describe('densable 2.1.225 #10 CCR tip delta rehydrate', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ccr-tip-225-'))
    process.env.CLAUDE_CONFIG_DIR = home
  })

  afterEach(async () => {
    const { clearSessionMetadata, resetProjectForTesting } = await import(
      '../sessionStorage.js'
    )
    clearSessionMetadata()
    resetProjectForTesting()
    delete process.env.CLAUDE_CONFIG_DIR
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  test('getCCRTipPathForSession is sibling .ccr-tip.json', async () => {
    const { getCCRTipPathForSession, getTranscriptPathForSession } =
      await import('../sessionStorage.js')
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as UUID
    const tip = getCCRTipPathForSession(sid)
    const transcript = getTranscriptPathForSession(sid)
    expect(tip.endsWith('.ccr-tip.json')).toBe(true)
    expect(tip).toBe(transcript.replace(/\.jsonl$/, '.ccr-tip.json'))
  })

  test('writeCCRTip / readCCRTip round-trip', async () => {
    const { writeCCRTip, readCCRTip } = await import('../sessionStorage.js')
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as string
    await writeCCRTip(sid, 'evt-uuid-1')
    const tip = await readCCRTip(sid)
    expect(tip?.eventId).toBe('evt-uuid-1')
    expect(typeof tip?.updatedAt).toBe('string')
  })

  test('getValidatedCCRTip client-gated when enableDelta false', async () => {
    const { getValidatedCCRTip, writeCCRTip } = await import(
      '../sessionStorage.js'
    )
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as string
    await writeCCRTip(sid, 'x')
    const r = await getValidatedCCRTip(sid, false)
    expect(r).toEqual({ fallbackReason: 'client-gated' })
  })

  test('getValidatedCCRTip no-sidecar when tip missing', async () => {
    const { getValidatedCCRTip, getCCRTipPathForSession } = await import(
      '../sessionStorage.js'
    )
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as string
    // Ensure no leftover tip from prior cases (sessionId is process-global).
    try {
      rmSync(getCCRTipPathForSession(sid), { force: true })
    } catch {
      /* ignore */
    }
    const r = await getValidatedCCRTip(sid, true)
    expect(r).toEqual({ fallbackReason: 'no-sidecar' })
  })

  test('getValidatedCCRTip tip-not-in-tail when uuid absent from transcript', async () => {
    const { getValidatedCCRTip, writeCCRTip, getTranscriptPathForSession } =
      await import('../sessionStorage.js')
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as string
    const path = getTranscriptPathForSession(sid)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ type: 'user', uuid: 'local-1', message: { content: 'hi' } })}\n`,
    )
    await writeCCRTip(sid, 'missing-uuid')
    const r = await getValidatedCCRTip(sid, true)
    expect(r).toEqual({ fallbackReason: 'tip-not-in-tail' })
  })

  test('getValidatedCCRTip returns eventId when tip in tail', async () => {
    const { getValidatedCCRTip, writeCCRTip, getTranscriptPathForSession } =
      await import('../sessionStorage.js')
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as string
    const path = getTranscriptPathForSession(sid)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ type: 'user', uuid: 'local-tip', message: { content: 'hi' } })}\n`,
    )
    await writeCCRTip(sid, 'local-tip')
    const r = await getValidatedCCRTip(sid, true)
    expect(r).toEqual({ eventId: 'local-tip' })
  })

  test('updateCCRTipFromAckedBatch writes last non-subagent transcript uuid', async () => {
    const { updateCCRTipFromAckedBatch, readCCRTip } = await import(
      '../sessionStorage.js'
    )
    const { getSessionId } = await import('../../bootstrap/state.js')
    await updateCCRTipFromAckedBatch([
      {
        payload: { type: 'user', uuid: 'u1' },
        session_agent_id: 'agent-a',
      },
      { payload: { type: 'assistant', uuid: 'a1' } },
      { payload: { type: 'progress', uuid: 'p1' } },
    ])
    const tip = await readCCRTip(getSessionId() as string)
    expect(tip?.eventId).toBe('a1')
  })

  test('updateCCRTipFromAckedBatch still advances when foreground row has agent_id', async () => {
    // densable J0a only skips session_agent_id — agent_id on fg must not block tip.
    const { updateCCRTipFromAckedBatch, readCCRTip } = await import(
      '../sessionStorage.js'
    )
    const { getSessionId } = await import('../../bootstrap/state.js')
    await updateCCRTipFromAckedBatch([
      {
        payload: { type: 'assistant', uuid: 'fg-with-agent-id' },
        agent_id: 'main',
      },
    ])
    const tip = await readCCRTip(getSessionId() as string)
    expect(tip?.eventId).toBe('fg-with-agent-id')
  })

  test('hydrateFromCCRv2InternalEvents delta-appends when tip in local tail', async () => {
    const {
      setInternalEventReader,
      hydrateFromCCRv2InternalEvents,
      writeCCRTip,
      getTranscriptPathForSession,
      readCCRTip,
    } = await import('../sessionStorage.js')
    const { getSessionId } = await import('../../bootstrap/state.js')
    const sid = getSessionId() as string
    const path = getTranscriptPathForSession(sid)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ type: 'user', uuid: 'u0', message: { role: 'user', content: 'hi' } })}\n`,
    )
    await writeCCRTip(sid, 'u0')

    // densable after_event_id is exclusive of the tip — tip not in response
    // (A=false) + tip in local tail (R=true) → delta append path.
    setInternalEventReader(
      async after => {
        expect(after).toBe('u0')
        return {
          events: [
            {
              event_id: 'a1',
              payload: {
                type: 'assistant',
                uuid: 'a1',
                message: { role: 'assistant', content: 'yo' },
              },
            },
          ],
        }
      },
      async () => ({ events: [] }),
    )

    const ok = await hydrateFromCCRv2InternalEvents(sid, null, true, false)
    expect(ok).toBe(true)
    const body = readFileSync(path, 'utf8')
    expect(body).toContain('"uuid":"u0"')
    expect(body).toContain('"uuid":"a1"')
    // tip advanced to last written
    const tip = await readCCRTip(sid)
    expect(tip?.eventId).toBe('a1')
  })

  test('source wiring: remoteIO tip batch + after_event_id', async () => {
    const { readFileSync } = await import('node:fs')
    const { join: pathJoin } = await import('node:path')
    const remoteIo = readFileSync(
      pathJoin(import.meta.dir, '../../cli/remoteIO.ts'),
      'utf8',
    )
    expect(remoteIo).toContain('updateCCRTipFromAckedBatch')
    expect(remoteIo).toContain('onInternalBatchAcked')
    expect(remoteIo).toContain('tengu_ccr_delta_rehydrate')
    const ccr = readFileSync(
      pathJoin(import.meta.dir, '../../cli/transports/ccrClient.ts'),
      'utf8',
    )
    expect(ccr).toContain('after_event_id')
    expect(ccr).toContain('onInternalBatchAcked')
    // Important #1: early-exit is opt-in via callback return, not callback presence
    expect(ccr).toContain("errorAction === 'early-exit'")
    expect(ccr).toContain("return 'early-exit'")
    const storage = readFileSync(
      pathJoin(import.meta.dir, '../sessionStorage.ts'),
      'utf8',
    )
    expect(storage).toContain('tip-not-in-tail')
    expect(storage).toContain('client-gated')
    expect(storage).toContain('no-sidecar')
    expect(storage).toContain('Failed to write CCR tip sidecar')
    // Important #2: J0a only skips session_agent_id (not agent_id)
    expect(storage).toMatch(/if \(!row \|\| row\.session_agent_id\) continue/)
    expect(storage).not.toMatch(
      /if \(!row \|\| row\.session_agent_id \|\| row\.agent_id\) continue/,
    )
  })
})
