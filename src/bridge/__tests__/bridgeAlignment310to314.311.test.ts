import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import {
  createTlsHandshakeTimeoutTransport,
  ERR_TLS_HANDSHAKE_STALLED,
} from '../bridgeApi.js'
import {
  handleServerControlRequest,
  resolveAsyncSetModelVerdict,
} from '../bridgeMessaging.js'
import {
  attachmentCapForMessage,
  DISK_FULL_ATTACHMENT_NOTICE,
  INBOUND_ATTACHMENT_CLOUD_MAX_COUNT,
  INBOUND_ATTACHMENT_MAX_COUNT,
  resolveInboundAttachments,
} from '../inboundAttachments.js'
import { postInterClaudeMessage } from '../peerSessions.js'
import {
  computeRegisterWorkerBackoffMs,
  isRetryableRegisterWorkerError,
  registerWorkerWithRetry,
  type ReplBridgeTransport,
} from '../replBridgeTransport.js'

describe('bridge 2.1.311–2.1.314 alignment (#1240, #1241, #1242, #1348, #1376, #1381, #1382, #1420)', () => {
  test('#1240: createTlsHandshakeTimeoutTransport bounds TLS handshake and is wired in bridgeApi/createSession', () => {
    const transport = createTlsHandshakeTimeoutTransport(40)
    expect(typeof transport.request).toBe('function')
    expect(ERR_TLS_HANDSHAKE_STALLED).toBe('ERR_TLS_HANDSHAKE_STALLED')

    const bridgeApiSrc = readFileSync(
      join(import.meta.dir, '../bridgeApi.ts'),
      'utf8',
    )
    expect(bridgeApiSrc).toContain('createTlsHandshakeTimeoutTransport(15_000)')
    const createSessionSrc = readFileSync(
      join(import.meta.dir, '../createSession.ts'),
      'utf8',
    )
    expect(createSessionSrc).toContain(
      'createTlsHandshakeTimeoutTransport(15_000)',
    )
  })

  test('#1241: postInterClaudeMessage sends anthropic-client-platform header', async () => {
    const src = readFileSync(
      join(import.meta.dir, '../peerSessions.ts'),
      'utf8',
    )
    expect(src).toContain(
      "'anthropic-client-platform': getAnthropicClientPlatform()",
    )
    expect(typeof postInterClaudeMessage).toBe('function')
  })

  test('#1242: attachmentCapForMessage uses 20 for Remote Control/cloud and 16 for SendFile, and reports missing/ENOSPC', async () => {
    expect(INBOUND_ATTACHMENT_MAX_COUNT).toBe(16)
    expect(INBOUND_ATTACHMENT_CLOUD_MAX_COUNT).toBe(20)
    expect(
      attachmentCapForMessage([{ sha256: undefined }, { sha256: undefined }]),
    ).toBe(20)
    expect(attachmentCapForMessage([{ sha256: 'abc' }])).toBe(16)
    expect(DISK_FULL_ATTACHMENT_NOTICE).toBe(
      'A file could not be saved: no space left on device',
    )

    // Without token, non-sha256 cloud attachments report missingFiles + notice
    const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    try {
      const res = await resolveInboundAttachments([
        { file_uuid: 'u1', file_name: 'a.txt' },
        { file_uuid: 'u2', file_name: 'b.txt' },
      ])
      expect(res.prefix).toContain('[2 attachments did not arrive]')
      expect(res.missingFiles).toEqual([
        { file_uuid: 'u1', reason: 'no_token' },
        { file_uuid: 'u2', reason: 'no_token' },
      ])
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = prev
    }
  })

  test('#1348: remoteBridgeCore awaits flushGoodbye after transport.close on skipArchive teardown', () => {
    const core = readFileSync(
      join(import.meta.dir, '../remoteBridgeCore.ts'),
      'utf8',
    )
    expect(core).toContain('await transport.flushGoodbye?.()')
    const transportSrc = readFileSync(
      join(import.meta.dir, '../replBridgeTransport.ts'),
      'utf8',
    )
    expect(transportSrc).toContain('flushGoodbye()')
  })

  test('#1376 & #1420: buildWorkspaceDiffResponse sets GIT_OPTIONAL_LOCKS=0 and normalizes autocrlf', () => {
    const src = readFileSync(
      join(import.meta.dir, '../buildWorkspaceDiffResponse.ts'),
      'utf8',
    )
    expect(src).toContain("GIT_OPTIONAL_LOCKS: '0'")
    expect(src).toContain('applyEol')
  })

  test('#1381: registerWorkerWithRetry retries transient errors with growing proportional-jitter waits', async () => {
    expect(isRetryableRegisterWorkerError({ status: 503 })).toBe(true)
    expect(isRetryableRegisterWorkerError({ status: 429 })).toBe(true)
    expect(isRetryableRegisterWorkerError({ status: 408 })).toBe(true)
    expect(isRetryableRegisterWorkerError(new Error('ECONNRESET'))).toBe(true)
    expect(isRetryableRegisterWorkerError({ status: 403 })).toBe(false)

    const w1 = computeRegisterWorkerBackoffMs(1, 2000, 0.25, () => 0.5)
    const w2 = computeRegisterWorkerBackoffMs(2, 2000, 0.25, () => 0.5)
    expect(w1).toBe(2000)
    expect(w2).toBe(4000)

    let attempts = 0
    const epoch = await registerWorkerWithRetry('https://example.com', 'tok', {
      baseMs: 1,
      maxAttempts: 4,
      registerFn: async () => {
        attempts++
        if (attempts < 3) {
          throw Object.assign(new Error('unavailable'), { status: 503 })
        }
        return 7
      },
    })
    expect(epoch).toBe(7)
    expect(attempts).toBe(3)

    let nonRetryCalls = 0
    await expect(
      registerWorkerWithRetry('https://example.com', 'tok', {
        baseMs: 1,
        maxAttempts: 4,
        registerFn: async () => {
          nonRetryCalls++
          throw Object.assign(new Error('forbidden'), { status: 403 })
        },
      }),
    ).rejects.toThrow('forbidden')
    expect(nonRetryCalls).toBe(1)
  })

  test('#1382: set_model awaits async Promise verdict, emits notices, and rejects only_if_model_is_current', async () => {
    const written: unknown[] = []
    const mockTransport = {
      write: mock(async (msg: unknown) => {
        written.push(msg)
      }),
    } as unknown as ReplBridgeTransport

    handleServerControlRequest(
      {
        type: 'control_request',
        request_id: 'req-1',
        request: {
          subtype: 'set_model',
          model: 'claude-opus-4-6',
        },
      } as unknown as Parameters<typeof handleServerControlRequest>[0],
      {
        transport: mockTransport,
        sessionId: 'sess-1',
        onSetModel: async () => {
          await new Promise(r => setTimeout(r, 10))
          return {
            ok: true,
            model: 'claude-opus-4-6',
            notices: ['Switched model'],
          }
        },
      },
    )

    // Wait for async verdict resolution
    await new Promise(r => setTimeout(r, 30))
    expect(written.length).toBe(2)
    expect((written[0] as { type: string; content: string }).content).toBe(
      'Switched model',
    )
    expect(
      (
        written[1] as {
          response: {
            subtype: string
            request_id?: string
            response?: { model: string }
          }
        }
      ).response,
    ).toEqual({
      subtype: 'success',
      request_id: 'req-1',
      response: { model: 'claude-opus-4-6' },
    })

    // Rejection case
    const responses: unknown[] = []
    await resolveAsyncSetModelVerdict({
      verdict: Promise.reject(new Error('boom')),
      respond: p => responses.push(p),
      inform: () => {},
    })
    expect(responses[0]).toEqual({
      subtype: 'error',
      error: 'set_model failed',
      error_code: 'internal_error',
    })

    // only_if_model_is_current rejected
    written.length = 0
    handleServerControlRequest(
      {
        type: 'control_request',
        request_id: 'req-2',
        request: {
          subtype: 'set_model',
          model: 'claude-opus-4-6',
          only_if_model_is_current: true,
        },
      } as unknown as Parameters<typeof handleServerControlRequest>[0],
      {
        transport: mockTransport,
        sessionId: 'sess-1',
      },
    )
    expect(written.length).toBe(1)
    expect(
      (written[0] as { response: { subtype: string; error: string } }).response
        .error,
    ).toContain('only_if_model_is_current')
  })
})
