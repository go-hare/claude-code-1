/**
 * densable 2.1.283 leftover tn.attach default new gPe wrap.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  LeftoverSseFrameBuffer,
  REMOTE_CONTROL_CLOSED,
  cloudSessionEventsStreamUrl,
  createCloudSessionEventsClient,
  createCloudSessionStreamController,
  createHeadlessRemoteManager,
  emptyHeadlessManager,
  handleCloudSessionFrame,
  isSendGateWithhold,
  leftoverDeliverCloudSessionFrame,
  leftoverParseSseBlock,
  leftoverSseFindFrameDelim,
  leftoverSseNewlineWidth,
  readCloudSessionEventsStream,
  runSendGate,
  wrapRemoteSessionManager,
} = await import('../leftoverHeadlessManager.js')

const src = readFileSync(
  join(import.meta.dir, '../leftoverHeadlessManager.ts'),
  'utf8',
)
const client = readFileSync(
  join(import.meta.dir, '../leftoverHeadlessClient.ts'),
  'utf8',
)

describe('leftoverHeadlessManager 283 leftover gPe wrap', () => {
  test('source-locks leftover gPe wrap; no minify public API', () => {
    expect(src).toContain('leftover `class gPe` @202087858')
    expect(src).toContain('leftover `tn.attach` @202385551')
    expect(src).toContain('createHeadlessRemoteManager')
    expect(src).toContain('wrapRemoteSessionManager')
    expect(src).toContain('RemoteSessionManager')
    expect(src).toContain('emptyHeadlessManager')
    expect(src).toContain('leftover `releaseHeldSends`')
    expect(src).toContain('leftover `Oe` @202086500')
    expect(src).toContain('leftover `Kt` @202086539')
    expect(src).toContain('RELEASE_HELD_SENDS_TIMEOUT_MS = 1500')
    expect(src).toContain("onRelease: opts.onRelease ?? 'send'")
    expect(src).toContain("onExit: opts.onExit ?? 'as_release'")
    expect(src).toContain('host.sendControl')
    expect(src).toContain('leftover `sendBehindGates` @202102201')
    expect(src).toContain('sendsInFlight')
    expect(src).toContain('heldSendCount')
    expect(src).toContain('chainedSends')
    expect(src).toContain('lastHeld')
    expect(src).toContain('postCloudSessionEvents')
    expect(src).toContain('cloudSessionEventsStreamUrl')
    expect(src).toContain('/events/stream')
    expect(src).toContain('sendPayloadToRemoteSession')
    expect(src).toContain('leftover `readStream` @202071152')
    expect(src).toContain('readCloudSessionEventsStream')
    expect(src).toContain('text/event-stream')
    expect(src).toContain('leftover `u` @195682346')
    expect(src).toContain('leftover `m` @195682502')
    expect(src).toContain('leftover `h` @195682753')
    expect(src).toContain('leftoverParseSseBlock')
    expect(src).toContain('leftoverSseFindFrameDelim')
    expect(src).toContain('firstDefinedGate')
    expect(src).toContain('leftover `class Sbt` @195682933')
    expect(src).toContain('LeftoverSseFrameBuffer')
    expect(src).toContain('leftover `handleFrame` @199852425')
    expect(src).toContain('handleCloudSessionFrame')
    expect(src).toContain('leftover `deliver` @199856946')
    expect(src).toContain('leftoverDeliverCloudSessionFrame')
    expect(src).toContain('createCloudSessionStreamController')
    expect(src).toContain('leftover SessionsV2Client `class ue` @199846147')
    expect(src).toContain('createCloudSessionEventsClient')
    expect(src).toContain('Last-Event-ID')
    expect(src).toContain('recoverTrustedDeviceTokenAfterUntrusted')
    expect(src).toContain('getTrustedDeviceTokenIfGateOn')
    expect(src).toContain('TRUSTED_DEVICE_TOKEN_HEADER')
    expect(src).toContain('sending no td-v1 header')
    expect(src).toContain(
      'untrusted_device on SSE connect — re-enrolled, reconnecting',
    )
    expect(src).toContain('401 on SSE connect — refreshing')
    expect(src).toContain('seams.stream?.handleStreamEnd()')
    expect(src).toContain('isViolinWoodEnabled')
    expect(src).not.toMatch(/^export function Xle\b/m)
    expect(src).not.toMatch(/^export function gy\b/m)
    expect(src).toContain('CLOUD_EVENTS_LIVENESS_MS = 45_000')
    expect(src).toContain('CLOUD_EVENTS_RECONNECT_BUDGET = 5')
    expect(src).toContain('leftover `zt` @199899723')
    expect(src).toContain('leftover `Bt` @199899933')
    expect(src).toContain('runSendGate')
    expect(src).toContain('isSendGateWithhold')
    expect(src).toContain('leftover `Fe`')
    expect(src).toContain('wrapSendGateWithheld')
    expect(src).not.toMatch(/^export class gPe\b/m)
    expect(src).not.toMatch(/^export class Sbt\b/m)
    expect(src).not.toMatch(/^export function zt\b/m)
    expect(src).not.toMatch(/^export class ue\b/m)
    expect(src).not.toContain('new WebSocket')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(code).not.toContain('tengu_violin_amati')
    expect(code).not.toContain('FOCUS_IN')
    expect(code).not.toContain('settings.set')
    expect(client).toContain('createHeadlessRemoteManager')
    expect(client).toContain('leftoverHeadlessManager')
    expect(client).toContain('client.session?.manager.reconnect')
  })

  test('missing orgUuid/token stays on no-socket stub', () => {
    const manager = createHeadlessRemoteManager({ sessionId: 'cse_1' })
    expect(manager.connect).toBeTypeOf('function')
    manager.connect?.()
    expect(manager.reconnect).toBeTypeOf('function')
    manager.reconnect?.()
    expect(emptyHeadlessManager().disconnect).toBeTypeOf('function')
  })

  test('wrapRemoteSessionManager exposes connect/disconnect/reconnect', () => {
    const calls: string[] = []
    const host = {
      connect: () => {
        calls.push('connect')
      },
      disconnect: () => {
        calls.push('disconnect')
      },
      reconnect: () => {
        calls.push('reconnect')
      },
      cancelSession: () => {
        calls.push('interrupt')
      },
      isConnected: () => true,
      sendControl: () => {},
    }
    const wrapped = wrapRemoteSessionManager(
      host as unknown as Parameters<typeof wrapRemoteSessionManager>[0],
    )
    wrapped.connect?.()
    wrapped.reconnect?.()
    void wrapped.sendControlRequest?.({ subtype: 'interrupt' })
    wrapped.disconnect()
    expect(calls).toEqual(['connect', 'reconnect', 'interrupt', 'disconnect'])
  })

  test('leftover gPe addSendGate/releaseHeldSends/postControlRequest 1:1', async () => {
    const manager = emptyHeadlessManager()
    const retire = manager.addSendGate?.(async () => {}, {
      onRelease: 'withhold',
    })
    expect(retire).toBeTypeOf('function')
    retire?.()
    const released = await manager.releaseHeldSends(undefined, {
      exiting: true,
      final: true,
    })
    expect(released).toEqual({
      unsent: 0,
      refused: [],
      unconfirmed: 0,
      stillHeld: 0,
    })
    const posted = manager.postControlRequest(
      { subtype: 'initialize' },
      {
        answerExpected: false,
        background: true,
        timeoutMs: 1,
        signal: new AbortController().signal,
      },
    )
    expect(await posted.posted).toEqual({ outcome: 'accepted' })

    const wrapped = wrapRemoteSessionManager({
      connect: () => {},
      disconnect: () => {},
      reconnect: () => {},
      cancelSession: () => {},
      isConnected: () => false,
      sendControl: () => {},
    } as unknown as Parameters<typeof wrapRemoteSessionManager>[0])
    const closed = wrapped.postControlRequest(
      { subtype: 'initialize' },
      {
        answerExpected: false,
        background: true,
        timeoutMs: 1,
        signal: new AbortController().signal,
      },
    )
    expect(await closed.posted).toEqual(REMOTE_CONTROL_CLOSED)
    expect(REMOTE_CONTROL_CLOSED).toEqual({
      outcome: 'failed',
      cause: 'closed',
    })
  })

  test('leftover sendBehindGates registers heldSends; flushSends waits in-flight', async () => {
    const manager = emptyHeadlessManager()
    expect(manager.heldSendCount?.()).toBe(0)
    let release!: () => void
    const pending = new Promise<string>(resolve => {
      release = () => resolve('sent')
    })
    const behind = manager.sendBehindGates?.(() => pending, {
      messageUuid: 'u1',
    })
    expect(manager.heldSendCount?.()).toBe(1)
    const flushed = manager.flushSends(20)
    release()
    expect(await behind).toBe('sent')
    await flushed
    expect(manager.heldSendCount?.()).toBe(0)

    manager.addSendGate?.(async () => ({ go: false, reason: 'held' }), {
      onRelease: 'withhold',
    })
    const withheld = await manager.sendBehindGates?.(() =>
      Promise.resolve('sent'),
    )
    expect(withheld).toEqual({
      ok: false,
      reason: 'held',
      withheld: true,
    })

    const stringGate = emptyHeadlessManager()
    stringGate.addSendGate?.(async () => 'held')
    expect(
      await stringGate.sendBehindGates?.(() => Promise.resolve('sent')),
    ).toBe('sent')

    const throwing = emptyHeadlessManager()
    throwing.addSendGate?.(async () => {
      throw new Error('gate boom')
    })
    expect(
      await throwing.sendBehindGates?.(() => Promise.resolve('sent')),
    ).toBe('sent')

    const racing = emptyHeadlessManager()
    let chainedFirst = 0
    let chainedSecond = 0
    const a = racing.sendBehindGates?.(async () => {
      chainedFirst = racing.chainedSendCount?.() ?? 0
      return 'a'
    })
    const b = racing.sendBehindGates?.(async () => {
      chainedSecond = racing.chainedSendCount?.() ?? 0
      return 'b'
    })
    expect(await a).toBe('a')
    expect(await b).toBe('b')
    expect(chainedFirst).toBeGreaterThanOrEqual(1)
    expect(chainedSecond).toBeGreaterThanOrEqual(1)
    expect(racing.chainedSendCount?.()).toBe(0)

    expect(
      cloudSessionEventsStreamUrl('cse_1', {
        fromSequenceNum: 3,
        controlOnly: true,
      }),
    ).toContain('/v1/code/sessions/cse_1/events/stream')
    expect(
      cloudSessionEventsStreamUrl('cse_1', {
        fromSequenceNum: 3,
        controlOnly: true,
      }),
    ).toContain('from_sequence_num=3')
    expect(
      cloudSessionEventsStreamUrl('cse_1', {
        fromSequenceNum: 3,
        controlOnly: true,
      }),
    ).toContain('control_only=1')

    const firstGate = emptyHeadlessManager()
    firstGate.addSendGate?.(
      () =>
        new Promise(() => {
          /* gold Be: hanging sibling must not block first defined withhold */
        }),
    )
    firstGate.addSendGate?.(async () => ({ go: false, reason: 'first' }))
    const firstDefined = await firstGate.sendBehindGates?.(() =>
      Promise.resolve('sent'),
    )
    expect(firstDefined).toEqual({
      ok: false,
      reason: 'first',
      withheld: true,
    })

    const frames: Array<{ event?: string; data?: string }> = []
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: client_event\ndata: {"ok":true}\n\n'),
        )
        controller.close()
      },
    })
    await readCloudSessionEventsStream(
      'https://example.test/v1/code/sessions/cse_1/events/stream',
      {},
      new AbortController().signal,
      {
        fetch: async (_href, init) => {
          expect((init?.headers as Record<string, string>).Accept).toBe(
            'text/event-stream',
          )
          return new Response(body, { status: 200 })
        },
        onFrame: frame => {
          frames.push(frame)
        },
      },
    )
    expect(frames).toEqual([{ event: 'client_event', data: '{"ok":true}' }])

    const keepaliveResets: number[] = []
    const keepaliveBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(':keepalive\n\n'))
        controller.close()
      },
    })
    await readCloudSessionEventsStream(
      'https://example.test/v1/code/sessions/cse_1/events/stream',
      {},
      new AbortController().signal,
      {
        fetch: async () => new Response(keepaliveBody, { status: 200 }),
        stream: {
          resetLivenessTimer: () => {
            keepaliveResets.push(1)
          },
          handleStreamEnd: () => {},
        },
      },
    )
    expect(keepaliveResets.length).toBeGreaterThan(0)

    const sse = new LeftoverSseFrameBuffer()
    expect(
      sse.push('event: client_event\ndata: {"payload":{"type":"user"}}\n\n'),
    ).toEqual([
      {
        event: 'client_event',
        data: '{"payload":{"type":"user"}}',
      },
    ])
    expect(
      sse.push(new TextEncoder().encode('event: ping\ndata: x\n\n')),
    ).toEqual([{ event: 'ping', data: 'x' }])

    expect(isSendGateWithhold({ go: false, reason: 'x' })).toBe(true)
    expect(isSendGateWithhold({ go: true, reason: 'x' })).toBe(false)
    expect(isSendGateWithhold('held')).toBe(false)
    expect(await runSendGate(async () => 'held', {})).toBeUndefined()
    expect(
      await runSendGate(async () => ({ go: false, reason: 'x' }), {}),
    ).toEqual({ go: false, reason: 'x' })
    expect(
      await runSendGate(async () => {
        throw new Error('boom')
      }, {}),
    ).toBeUndefined()

    expect(
      handleCloudSessionFrame(
        'client_event',
        '1',
        '{"payload":{"type":"user"},"source":"worker","sequence_num":1}',
      ).kind,
    ).toBe('deliver')
    expect(
      handleCloudSessionFrame('client_event', '1', '{"event_type":"x"}').kind,
    ).toBe('drop')
    expect(
      handleCloudSessionFrame(
        'client_event',
        '1',
        '{"payload":{"type":"user","tool_use_result":{}},"source":"host"}',
      ).kind,
    ).toBe('drop')
    expect(
      handleCloudSessionFrame('catch_up_truncated', undefined, '{}').kind,
    ).toBe('control')
    expect(
      handleCloudSessionFrame(
        'ephemeral_event',
        undefined,
        '{"event_type":"tool_host_ended","payload":{"work_id":"w1"}}',
      ).kind,
    ).toBe('control')
    expect(
      handleCloudSessionFrame('delivery_update', undefined, '{}').kind,
    ).toBe('ignore')
    expect(handleCloudSessionFrame('not_a_frame', undefined, '{}').kind).toBe(
      'ignore',
    )

    expect(leftoverSseNewlineWidth('\n', 0)).toBe(1)
    expect(leftoverSseNewlineWidth('\r\n', 0)).toBe(2)
    expect(leftoverSseNewlineWidth('\r', 0)).toBe(-1)
    expect(leftoverSseFindFrameDelim('event: a\ndata: b\n\n', 0)).toEqual({
      contentEnd: 'event: a\ndata: b'.length,
      afterDelim: 'event: a\ndata: b\n\n'.length,
    })
    expect(leftoverParseSseBlock('event: ping\ndata: x')).toEqual({
      event: 'ping',
      data: 'x',
    })
    expect(leftoverParseSseBlock(':keepalive')).toEqual({})

    const delivered: Array<Record<string, unknown>> = []
    leftoverDeliverCloudSessionFrame(
      {
        onDeliver: payload => {
          delivered.push(payload)
        },
      },
      { type: 'user' },
      {},
    )
    expect(delivered).toEqual([{ type: 'user' }])
    leftoverDeliverCloudSessionFrame(
      {
        onDeliver: () => {
          throw new Error('boom')
        },
      },
      { type: 'user' },
      {},
    )

    const connects: number[] = []
    const stream = createCloudSessionStreamController({
      connect: () => {
        connects.push(1)
        stream.state = 'connected'
      },
    })
    expect(stream.isConnected()).toBe(false)
    stream.connect()
    expect(stream.isConnected()).toBe(true)
    stream.connect()
    expect(connects).toHaveLength(1)
    stream.handleStreamEnd()
    expect(stream.state).toBe('idle')
    expect(stream.reconnectAttempts).toBe(1)
    stream.close()
    expect(stream.state).toBe('closed')
    expect(stream.isRevivable()).toBe(false)

    const encoder2 = new TextEncoder()
    const fetched: Array<{ href: string; lastEvent?: string }> = []
    const clientBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder2.encode(
            'event: client_event\ndata: {"payload":{"type":"user"},"source":"worker"}\n\n',
          ),
        )
        controller.close()
      },
    })
    const eventsClient = createCloudSessionEventsClient(
      {
        sessionId: 'cse_1',
        orgUuid: 'org_1',
        getAccessToken: async () => 'tok',
        authHeaders: async () => ({ Authorization: 'Bearer tok' }),
      },
      {
        fetch: async (href, init) => {
          fetched.push({
            href: String(href),
            lastEvent: (init?.headers as Record<string, string>)?.[
              'Last-Event-ID'
            ],
          })
          return new Response(clientBody, { status: 200 })
        },
      },
    )
    eventsClient.lastSequenceNum = 7
    eventsClient.connect()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetched[0]?.href).toContain('/v1/code/sessions/cse_1/events/stream')
    expect(fetched[0]?.href).toContain('from_sequence_num=7')
    expect(fetched[0]?.lastEvent).toBe('7')
    eventsClient.close()
  })

  test('403 untrusted_device on SSE connect recovers via Xle wrap', async () => {
    const recovered: Array<string | undefined> = []
    let ended = false
    await readCloudSessionEventsStream(
      'https://example/v1/code/sessions/cse_1/events/stream',
      {
        Authorization: 'Bearer tok',
        'X-Trusted-Device-Token': 'old',
      },
      new AbortController().signal,
      {
        fetch: async () =>
          new Response(
            JSON.stringify({ error: { resource: 'untrusted_device' } }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        recoverTrustedDeviceToken: async sent => {
          recovered.push(sent)
          return true
        },
        stream: {
          resetLivenessTimer() {},
          handleStreamEnd() {
            ended = true
          },
        },
      },
    )
    expect(recovered).toEqual(['old'])
    expect(ended).toBe(true)
  })

  test('401 on SSE connect refreshes then handleStreamEnd', async () => {
    let ended = false
    let refreshed = false
    await readCloudSessionEventsStream(
      'https://example/v1/code/sessions/cse_1/events/stream',
      { Authorization: 'Bearer tok' },
      new AbortController().signal,
      {
        fetch: async () => new Response('no', { status: 401 }),
        getAccessToken: async () => 'tok',
        onAuth401: async () => {
          refreshed = true
          return true
        },
        stream: {
          resetLivenessTimer() {},
          handleStreamEnd() {
            ended = true
          },
          reconnectAttempts: 0,
          keepRedialling: false,
        },
      },
    )
    expect(refreshed).toBe(true)
    expect(ended).toBe(true)
  })
})
