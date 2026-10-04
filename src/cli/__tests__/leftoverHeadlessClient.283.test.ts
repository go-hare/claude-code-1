/**
 * densable 2.1.283 leftover `tn` remaining compositor BODY wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `tn.drainOutbound` @202380196 · `tn.emit` @202380366
 *   leftover `tn.closeFromSignal` @202377840 · `tn.closeTransport` @202397544
 *   leftover `tn.tearDown` @202398197 · `tn.end` @202400327
 *   leftover `tn.settleOpener` @202378138 · `tn.openSession` @202384459
 *   leftover `tn.refuseWhileClosing` @202381897 · `tn.logEnded` @202398752
 *   leftover `tn.logWorkerInit` @202395409 · `tn.markWorkerReady` @202396589
 *   leftover `tn.attach` @202385551 BODY 8835 B
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  analyticsMock,
  pushAnalyticsLogEvent,
} from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: string[] = []
const events: Array<{ name: string; props: Record<string, unknown> }> = []

mock.module('../../utils/debug.js', () => ({
  ...debugMock(),
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))
mock.module('../../utils/debug.ts', () => ({
  ...debugMock(),
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())

const {
  attachHeadlessCloudClientSession,
  createHeadlessCloudClient,
  emitHeadlessFrame,
  formatHeadlessWorkerInitLine,
  logEnded,
  logWorkerInit,
  markWorkerReady,
  openSession,
  refuseWhileClosing,
  settleOpener,
} = await import('../leftoverHeadlessClient.js')
const { CLOUD_CLIENT_IS_CLOSING } = await import('../leftoverUnique.js')
const { CLOUD_SESSION_LOST_RECONNECTING } = await import(
  '../leftoverHeadlessCopy.js'
)

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

let restoreAnalytics: (() => void) | undefined
beforeEach(() => {
  restoreAnalytics = pushAnalyticsLogEvent((name, props) => {
    events.push({ name, props: props ?? {} })
  })
})
afterEach(() => {
  restoreAnalytics?.()
  restoreAnalytics = undefined
  debugLogs.length = 0
  events.length = 0
})

function openedSession(
  extra: Partial<Parameters<typeof attachHeadlessCloudClientSession>[1]> = {},
) {
  return {
    entry: 'attach' as const,
    sessionId: 'cse_1',
    cloudSession: () => ({ device: { status: 'unbound' } }),
    ...extra,
  }
}

describe('leftoverHeadlessClient 283 leftover tn remaining BODY', () => {
  test('source-locks leftover tn remaining methods; no minify public API', () => {
    const client = src('../leftoverHeadlessClient.ts')
    const leftoverUnique = src('../leftoverUnique.ts')
    const leftoverCopy = src('../leftoverHeadlessCopy.ts')
    const session = src('../cloudSession.ts')
    expect(client).toContain('leftover `tn.drainOutbound` @202380196')
    expect(client).toContain('leftover `tn.emit` @202380366')
    expect(client).toContain('leftover `tn.closeFromSignal` @202377840')
    expect(client).toContain('leftover `tn.closeTransport` @202397544')
    expect(client).toContain('leftover `tn.tearDown` @202398197')
    expect(client).toContain('leftover `tn.end` @202400327')
    expect(client).toContain('leftover `tn.settleOpener` @202378138')
    expect(client).toContain('leftover `tn.openSession` @202384459')
    expect(client).toContain('leftover `tn.refuseWhileClosing` @202381897')
    expect(client).toContain('leftover `tn.logEnded` @202398752')
    expect(client).toContain('leftover `tn.logWorkerInit` @202395409')
    expect(client).toContain('leftover `tn.markWorkerReady` @202396589')
    expect(client).toContain('leftover `tn.attach` @202385551')
    expect(client).toContain('attachHeadlessCloudClientSession')
    expect(client).toContain('initializeHeadlessCloudWorker')
    expect(client).toContain('logHeadlessDroppedFrameAfterStdoutClosed')
    expect(client).toContain('logHeadlessIgnoringFrameWhileClosing')
    expect(client).toContain('logHeadlessTransportCloseFailed')
    expect(client).toContain('logHeadlessSettlingOpenerWorkFailed')
    expect(client).toContain('logHeadlessDiscardedSessionNotReleased')
    expect(client).toContain('logHeadlessBuiltInToolNamesUnread')
    expect(client).toContain('logHeadlessNotPassingOwnQuestionDialog')
    expect(client).toContain('logHeadlessNotPassingUndeclaredDialog')
    expect(client).toContain('logHeadlessStreamError')
    expect(client).toContain('logHeadlessAttachPreflightFailed')
    expect(client).toContain('CLOUD_SESSION_LOST_RECONNECTING')
    expect(client).toContain('CLOUD_CLIENT_IS_CLOSING')
    expect(client).toContain('tengu_remote_headless_client_ended')
    expect(client).toContain('tengu_remote_headless_client_worker_ready')
    expect(client).toContain('tengu_remote_headless_client_seed_cut_short')
    expect(client).toContain('tengu_remote_headless_client_open_discarded')
    expect(client).toContain('tengu_remote_headless_client_worker_up')
    expect(client).toContain('tengu_remote_headless_client_started')
    expect(client).toContain('setSdkOauthTokenRefreshCallback')
    expect(client).toContain('failed to write to stdout:')
    expect(client).toContain(
      'session opened after the client ended; not attaching',
    )
    expect(client).toContain('logHeadlessNotPassingOwnQuestionDialog')
    expect(client).toContain('logHeadlessNotPassingUndeclaredDialog')
    expect(client).toContain('CLOUD_SESSION_LOST_RECONNECTING')
    expect(client).toContain('logHeadlessStreamError')
    expect(client).toContain('logHeadlessAttachPreflightFailed')
    expect(client).toContain('groupNotApplied')
    expect(client).toContain('armIdleDeadline')
    expect(client).toContain('onResponseUndelivered')
    expect(client).toContain('CLOUD_MESSAGE_NOT_DELIVERED')
    expect(client).toContain('new HeadlessCloudFrames')
    expect(client).toContain('new HeadlessCloudLiveness')
    expect(client).toContain('new HeadlessCloudFeatureHandles')
    expect(client).toContain('wrapHeadlessCloudFrames')
    expect(client).toContain('wrapHeadlessCloudLiveness')
    expect(client).toContain('wrapHeadlessCloudFeatures')
    expect(client).toContain('createHeadlessRemoteManager')
    expect(client).toContain('leftoverHeadlessManager')
    expect(client).toContain('client.session?.manager.reconnect')
    expect(client).toContain('holdLaterSendsBehindGates')
    expect(client).toContain('sendBehindGates')
    expect(session).toContain('class HeadlessCloudFrames')
    expect(session).toContain('class HeadlessCloudLiveness')
    expect(session).toContain('class HeadlessCloudFeatureHandles')
    expect(leftoverCopy).toContain('never the cloud session')
    expect(leftoverCopy).toContain('did not declare the kind')
    expect(leftoverCopy).toContain('Lost the connection to the cloud session')
    expect(leftoverCopy).toContain('[headlessCloudClient] stream error:')
    expect(leftoverCopy).toContain(
      '[headlessCloudClient] attach preflight failed:',
    )
    expect(client).not.toMatch(/^export class tn\b/m)
    const clientCode = client.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(clientCode).not.toContain('new WebSocket')
    expect(clientCode).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(clientCode).not.toContain('tengu_violin_amati')
    expect(clientCode).not.toContain('FOCUS_IN')
    expect(clientCode).not.toContain('settings.set')
    expect(leftoverCopy).toContain('leftoverHeadlessClient.ts')
    expect(leftoverUnique).toContain('leftoverHeadlessClient.ts')
    expect(leftoverUnique).toContain("from './leftoverHeadlessClient.js'")
    expect(session).toContain('class HeadlessCloudSdkHost')
    expect(session).toContain('{ done: new HeadlessCloudSdkHost')
  })

  test('emit-when-closed CALL leftoverHeadlessCopy drop log', () => {
    const client = createHeadlessCloudClient()
    const queued: Array<{ type: string }> = []
    client.io.outbound.enqueue = frame => {
      queued.push(frame)
    }
    client.outputOpen = false
    emitHeadlessFrame(client, { type: 'assistant' })
    expect(queued).toEqual([])
    expect(
      debugLogs.some(l =>
        l.includes(
          '[headlessCloudClient] dropped assistant frame after stdout closed',
        ),
      ),
    ).toBe(true)
  })

  test('refuseWhileClosing user/bash/control/default 1:1', () => {
    const users: unknown[] = []
    const bashes: unknown[] = []
    const queued: Array<Record<string, unknown>> = []
    const client = createHeadlessCloudClient(
      {},
      {
        submitUserMessage: frame => {
          users.push(frame)
        },
        submitBashCommand: frame => {
          bashes.push(frame)
        },
      },
    )
    client.io.outbound.enqueue = frame => {
      queued.push(frame)
    }
    refuseWhileClosing(client, { type: 'user' })
    refuseWhileClosing(client, { type: 'bash_command' })
    refuseWhileClosing(client, {
      type: 'control_request',
      request_id: 'req-1',
    })
    refuseWhileClosing(client, { type: 'system' })
    expect(users).toHaveLength(1)
    expect(bashes).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: 'req-1',
        error: CLOUD_CLIENT_IS_CLOSING,
      },
    })
    expect(CLOUD_CLIENT_IS_CLOSING).toBe('the cloud client is closing')
    expect(
      debugLogs.some(l =>
        l.includes('[headlessCloudClient] ignoring system frame while closing'),
      ),
    ).toBe(true)
  })

  test('logEnded reason bag 1:1 field names', () => {
    const client = createHeadlessCloudClient()
    client.opened = openedSession()
    client.outbound.stats = { sends: 2, forwards: 1, maxQueued: 4 }
    logEnded(client, 'disconnected', 1, 'live', 'stream_closed')
    const ended = events.find(
      e => e.name === 'tengu_remote_headless_client_ended',
    )
    expect(ended?.props).toMatchObject({
      reason: 'disconnected',
      exit_code: 1,
      ended_from: 'live',
      entry: 'attach',
      disconnect_code: 'stream_closed',
      container_start_failed: false,
      turns: 0,
      sends: 2,
      forwarded: 1,
      passed_through: 0,
      dialogs_not_declared: 0,
      dialogs_reserved_dropped: 0,
      max_queue: 4,
      max_held_for_init: 0,
      session_id_changes: 0,
      peer_content_omitted: 0,
      peer_tool_use_omitted: false,
      cloud_session_keys_dropped: 0,
      service_events_dropped: 0,
      unknown_frames_dropped: 0,
      peer_frames_dropped_before_init: 0,
      input_failed: false,
      watchdog_fires: 0,
      title: 'not_applicable',
      lines_written: 0,
      lines_suppressed: 0,
    })
    expect(ended?.props).toHaveProperty('duration_ms')
    expect(
      events.some(
        e =>
          e.name === 'tengu_feature_bad' &&
          e.props.feature_name === 'remote_headless_client' &&
          e.props.error_code === 'disconnected',
      ),
    ).toBe(true)
  })

  test('markWorkerReady via/wait_ms/queued + goLive SEAM', () => {
    let live = 0
    const client = createHeadlessCloudClient(
      {},
      {
        goLive: () => {
          live += 1
        },
      },
    )
    client.phase = 'awaiting_worker'
    client.connectEpoch = client.clock.now() - 40
    client.outbound.queuedCount = 3
    client.session = {
      manager: {
        disconnect: () => {},
        releaseHeldSends: async () => {},
        flushSends: async () => {},
        postControlRequest: () => ({
          posted: Promise.resolve({ outcome: 'accepted' }),
          response: Promise.resolve({}),
        }),
      },
      opened: openedSession(),
    }
    markWorkerReady(client, 'preflight')
    expect(client.phase).toBe('live')
    expect(live).toBe(1)
    const ready = events.find(
      e => e.name === 'tengu_remote_headless_client_worker_ready',
    )
    expect(ready?.props.via).toBe('preflight')
    expect(ready?.props.queued).toBe(3)
    expect(typeof ready?.props.wait_ms).toBe('number')
  })

  test('settleOpener / openSession discarded / logWorkerInit copies', async () => {
    const client = createHeadlessCloudClient()
    client.opened = {
      ...openedSession(),
      settle: async () => ({ level: 'warning', text: 'cut' }),
    }
    await settleOpener(client, 750, 'end')
    expect(
      events.some(
        e =>
          e.name === 'tengu_remote_headless_client_seed_cut_short' &&
          e.props.at === 'end',
      ),
    ).toBe(true)

    debugLogs.length = 0
    events.length = 0
    const discarded = createHeadlessCloudClient({
      openSession: async () => ({
        kind: 'opened',
        session: {
          ...openedSession(),
          dispose: async () => {
            throw new Error('held')
          },
        },
      }),
    })
    discarded.phase = 'ending'
    await openSession(discarded, {})
    expect(
      debugLogs.some(l =>
        l.includes(
          '[headlessCloudClient] session opened after the client ended; not attaching',
        ),
      ),
    ).toBe(true)
    expect(
      events.some(
        e =>
          e.name === 'tengu_remote_headless_client_open_discarded' &&
          e.props.entry === 'attach',
      ),
    ).toBe(true)
    expect(
      debugLogs.some(l =>
        l.includes(
          '[headlessCloudClient] discarded session not released: held',
        ),
      ),
    ).toBe(true)

    debugLogs.length = 0
    const unread = createHeadlessCloudClient({
      builtInToolNames: () => {
        throw new Error('no names')
      },
    })
    logWorkerInit(unread, { tools: ['Bash'] })
    expect(
      debugLogs.some(l =>
        l.includes(
          '[headlessCloudClient] built-in tool names could not be read:',
        ),
      ),
    ).toBe(true)
    expect(
      formatHeadlessWorkerInitLine(
        { claude_code_version: '2.1.283', tools: ['Bash', 'mcp__x'] },
        new Set(['Bash']),
      ),
    ).toContain('worker init: claude_code_version=2.1.283')
  })

  test('attachHeadlessCloudClientSession CALL initializeWorker + leftover copies', () => {
    const client = createHeadlessCloudClient({}, { hostDialogKinds: ['ask'] })
    attachHeadlessCloudClientSession(
      client,
      openedSession({
        workerAwaitsAnswer: true,
        initialSequenceNum: 2,
      }),
    )
    expect(client.workerInitializeReason).toBe('rearm_parked_prompt')
    expect(
      events.some(e => e.name === 'tengu_remote_headless_client_started'),
    ).toBe(true)

    const callbacks = client.features?.callbacks?.({
      onUserDialogRequest: undefined,
    }) as
      | {
          onUserDialogRequest?: (
            req: { dialog_kind: string },
            id: string,
          ) => void
          onError?: (err: { message: string }) => void
          onReconnecting?: () => void
          onWorkerUp?: (up: { generation: number; sessionMode: string }) => void
        }
      | undefined
    void callbacks
    client.features = {
      adopt: () => {},
      dispose: async () => {},
      callbacks: ports => ports,
      homeSeed: () => undefined,
      sendWait: () => null,
      reports: () => ({}),
      handles: () => [],
      statusFeeds: () => [],
      noteSession: () => {},
    }
    const ports: Record<string, (...args: never[]) => unknown> = {}
    attachHeadlessCloudClientSession(
      createHeadlessCloudClient({}, { hostDialogKinds: ['ask'] }),
      openedSession(),
      {
        createFeatures: () => ({
          adopt: () => {},
          dispose: async () => {},
          callbacks: given => {
            Object.assign(ports, given)
            return given
          },
          homeSeed: () => undefined,
          sendWait: () => null,
          reports: () => ({}),
          handles: () => [],
          statusFeeds: () => [],
          noteSession: () => {},
        }),
      },
    )
    debugLogs.length = 0
    ;(
      ports.onUserDialogRequest as (
        req: { dialog_kind: string },
        id: string,
      ) => void
    )?.({ dialog_kind: 'cloud_sync_consent' }, 'd1')
    expect(debugLogs.some(l => l.includes("never the cloud session's"))).toBe(
      true,
    )
    debugLogs.length = 0
    ;(
      ports.onUserDialogRequest as (
        req: { dialog_kind: string },
        id: string,
      ) => void
    )?.({ dialog_kind: 'undeclared_kind' }, 'd2')
    expect(debugLogs.some(l => l.includes('did not declare the kind'))).toBe(
      true,
    )
    debugLogs.length = 0
    ;(ports.onError as (err: { message: string }) => void)?.({
      message: 'boom',
    })
    expect(
      debugLogs.some(l =>
        l.includes('[headlessCloudClient] stream error: boom'),
      ),
    ).toBe(true)
    expect(CLOUD_SESSION_LOST_RECONNECTING).toBe(
      'Lost the connection to the cloud session — reconnecting…',
    )
  })

  test('attach create CALL armIdleDeadline; started spreads groupNotApplied', () => {
    let idle = 0
    const client = createHeadlessCloudClient(
      {},
      {
        armIdleDeadline: () => {
          idle += 1
        },
      },
    )
    attachHeadlessCloudClientSession(
      client,
      openedSession({
        entry: 'create',
        cloudSession: () => ({
          device: { status: 'unbound' },
          not_applied: [
            { kind: 'lost', name: 'a' },
            { kind: 'kept', name: 'b' },
            { kind: 'preference', name: 'c' },
          ],
        }),
      }),
    )
    expect(idle).toBe(1)
    const started = events.find(
      e => e.name === 'tengu_remote_headless_client_started',
    )
    expect(started?.props.not_applied_lost).toEqual([
      { kind: 'lost', name: 'a' },
    ])
    expect(started?.props.not_applied_kept).toEqual([
      { kind: 'kept', name: 'b' },
    ])
    expect(started?.props.not_applied_preference).toEqual([
      { kind: 'preference', name: 'c' },
    ])
    expect(client.frames?.stampedSessionId).toBe('cse_1')
    expect(client.liveness?.armStallWarning).toBeTypeOf('function')
    expect(client.features?.handles?.()).toEqual([])
    client.liveness?.halt()
  })

  test('attach default new st/ot/Ce hosts (not empty stubs)', () => {
    const client = createHeadlessCloudClient()
    attachHeadlessCloudClientSession(client, openedSession())
    expect(client.frames?.stampedSessionId).toBe('cse_1')
    expect(client.frames?.counts.peerFramesDroppedBeforeInit).toBe(0)
    expect(client.liveness?.stats?.title).toBe('none')
    expect(client.features?.reports?.()).toEqual({})
    expect(client.features?.handles?.()).toEqual([])
    expect(client.session?.manager.reconnect).toBeTypeOf('function')
    client.liveness?.halt()
  })

  test('onResponseUndelivered CALL CLOUD_MESSAGE_NOT_DELIVERED once per kind', () => {
    const queued: Array<Record<string, unknown>> = []
    const ports: Record<string, (...args: never[]) => unknown> = {}
    const client = createHeadlessCloudClient()
    client.io.outbound.enqueue = frame => {
      queued.push(frame as Record<string, unknown>)
    }
    attachHeadlessCloudClientSession(client, openedSession(), {
      createFeatures: () => ({
        adopt: () => {},
        dispose: async () => {},
        callbacks: given => {
          Object.assign(ports, given)
          return given
        },
        homeSeed: () => undefined,
        sendWait: () => null,
        reports: () => ({}),
        handles: () => [],
        statusFeeds: () => [],
        noteSession: () => {},
      }),
    })
    ;(ports.onResponseUndelivered as (id: string, kind: string) => void)?.(
      '1',
      'user',
    )
    ;(ports.onResponseUndelivered as (id: string, kind: string) => void)?.(
      '2',
      'user',
    )
    expect(
      queued.filter(
        f =>
          f.type === 'system' &&
          f.subtype === 'informational' &&
          String(f.content ?? '').includes(
            'Your message was not delivered to the cloud session',
          ),
      ),
    ).toHaveLength(1)
  })
})
