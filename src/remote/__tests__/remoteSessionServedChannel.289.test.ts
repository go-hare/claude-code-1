/**
 * densable 2.1.289 RSM inbound `un(g)` leftover — not print Host.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', () => ({
  ...logMock(),
  logError: mock(() => {}),
  logForDebugging: mock(() => {}),
}))
mock.module('src/services/analytics/index.js', analyticsMock)

import type {
  SDKControlCancelRequest,
  SDKControlRequest,
  SDKControlResponse,
} from '../../entrypoints/sdk/controlTypes.js'
import {
  RemoteSessionManager,
  type RemoteSessionCallbacks,
  type RemoteSessionConfig,
} from '../RemoteSessionManager.js'
import type { ServedChannelRequest } from '../../services/tools/remoteToolServe.js'
import { REMOTE_SERVE_REQUEST_ID_CAP } from '../../services/tools/remoteToolServe.js'

type Handleable = unknown

function makeManager(opts?: {
  onServed?: (request: ServedChannelRequest) => void
  onWorkerLive?: () => void
  onWorkerGone?: () => void
}): {
  manager: RemoteSessionManager
  served: ServedChannelRequest[]
  cancelled: Array<{ requestId: string; why: string }>
  sent: SDKControlResponse[]
  workerLive: { n: number }
  workerGone: { n: number }
  handle: (msg: unknown, extras?: Record<string, unknown>) => void
} {
  const served: ServedChannelRequest[] = []
  const cancelled: Array<{ requestId: string; why: string }> = []
  const sent: SDKControlResponse[] = []
  const workerLive = { n: 0 }
  const workerGone = { n: 0 }
  const config: RemoteSessionConfig = {
    sessionId: 'sess-test',
    getAccessToken: () => 'tok',
    orgUuid: 'org',
  }
  const callbacks: RemoteSessionCallbacks = {
    onMessage: () => {},
    onPermissionRequest: () => {},
    onServedChannelRequest: (request: ServedChannelRequest) => {
      served.push(request)
      opts?.onServed?.(request)
    },
    onServedChannelRequestCancelled: (requestId, why) => {
      cancelled.push({ requestId, why })
    },
    onWorkerLive: () => {
      workerLive.n++
      opts?.onWorkerLive?.()
    },
    onWorkerGone: () => {
      workerGone.n++
      opts?.onWorkerGone?.()
    },
  }
  const manager = new RemoteSessionManager(config, callbacks)
  ;(
    manager as unknown as {
      websocket: {
        sendControlResponse: (r: SDKControlResponse) => void
        close: () => void
      }
    }
  ).websocket = {
    sendControlResponse: r => {
      sent.push(r)
    },
    close: () => {},
  }
  const handle = (msg: unknown, extras?: Record<string, unknown>) => {
    ;(
      manager as unknown as {
        handleMessage: (m: Handleable, e?: Record<string, unknown>) => void
      }
    ).handleMessage(msg as Handleable, extras)
  }
  return {
    manager,
    served,
    cancelled,
    sent,
    workerLive,
    workerGone,
    handle,
  }
}

function remoteToolCall(requestId: string): SDKControlRequest {
  return {
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'remote_tool_call',
      instance_id: 'desk-1',
      host: 'desk',
      name: 'Bash',
      input: { command: 'echo hi' },
      envelope: { v: 1, call_id: 'tu_1' },
      tool_use_id: 'tu_1',
      issued_at: 1,
      deadline_ms: 58000,
    },
  } as SDKControlRequest
}

describe('RemoteSessionManager inbound served channel (gold un)', () => {
  test('parks a remote_tool_call when the callback is present', () => {
    const { handle, served } = makeManager()
    handle(remoteToolCall('req-serve'))
    expect(served).toHaveLength(1)
    expect(served[0]?.subtype).toBe('remote_tool_call')
    expect(served[0]?.requestId).toBe('req-serve')
  })

  test('control_request ageMs/attestationStatus reach onServedChannelRequest', () => {
    const { handle, served } = makeManager()
    handle({
      ...remoteToolCall('req-extra'),
      ageMs: 42,
      attestationStatus: 'ok',
    })
    expect(served).toHaveLength(1)
    expect(served[0]?.ageMs).toBe(42)
    expect(served[0]?.attestationStatus).toBe('ok')
  })

  test('gold handleMessage second-arg extras bag reaches onServedChannelRequest', () => {
    const { handle, served } = makeManager()
    handle(remoteToolCall('req-bag'), {
      ageMs: 99,
      attestationStatus: 'BELOW_FLOOR',
      modeStamp: 'present',
    })
    expect(served).toHaveLength(1)
    expect(served[0]?.ageMs).toBe(99)
    expect(served[0]?.attestationStatus).toBe('BELOW_FLOOR')
    expect(served[0]?.modeStamp).toBe('present')
  })

  test('duplicate in-hand id is skipped', () => {
    const { handle, served } = makeManager()
    handle(remoteToolCall('req-dup'))
    handle(remoteToolCall('req-dup'))
    expect(served).toHaveLength(1)
  })

  test('over-long request id is left unanswered', () => {
    const { handle, served } = makeManager()
    handle(remoteToolCall('x'.repeat(REMOTE_SERVE_REQUEST_ID_CAP + 1)))
    expect(served).toHaveLength(0)
  })

  test('no callback leaves it unanswered (not unsupported error)', () => {
    const config: RemoteSessionConfig = {
      sessionId: 'sess-test',
      getAccessToken: () => 'tok',
      orgUuid: 'org',
    }
    const sent: SDKControlResponse[] = []
    const manager = new RemoteSessionManager(config, {
      onMessage: () => {},
      onPermissionRequest: () => {},
    })
    ;(
      manager as unknown as {
        websocket: {
          sendControlResponse: (r: SDKControlResponse) => void
          close: () => void
        }
      }
    ).websocket = {
      sendControlResponse: r => {
        sent.push(r)
      },
      close: () => {},
    }
    ;(
      manager as unknown as { handleMessage: (m: Handleable) => void }
    ).handleMessage(remoteToolCall('req-none'))
    expect(sent).toHaveLength(0)
  })

  test('respondToServedChannelRequest sends cn-wrapped success', () => {
    const { manager, handle, sent } = makeManager()
    handle(remoteToolCall('req-ok'))
    expect(
      manager.respondToServedChannelRequest('req-ok', {
        result: { content: [{ type: 'text', text: 'ok' }] },
      }),
    ).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.response.subtype).toBe('success')
    expect(sent[0]?.response.request_id).toBe('req-ok')
    expect(
      manager.respondToServedChannelRequest('req-ok', { result: {} }),
    ).toBe(false)
  })

  test('missing websocket returns false after deleting pending', () => {
    const { manager, handle } = makeManager()
    handle(remoteToolCall('req-nows'))
    ;(manager as unknown as { websocket: null }).websocket = null
    expect(
      manager.respondToServedChannelRequest('req-nows', { result: {} }),
    ).toBe(false)
    expect(
      manager.respondToServedChannelRequest('req-nows', { result: {} }),
    ).toBe(false)
  })

  test('worker cancel retires the served request', () => {
    const { handle, cancelled } = makeManager()
    handle(remoteToolCall('req-cancel'))
    const cancel: SDKControlCancelRequest = {
      type: 'control_cancel_request',
      request_id: 'req-cancel',
    }
    handle(cancel)
    expect(cancelled).toEqual([{ requestId: 'req-cancel', why: 'worker' }])
  })

  test('disconnect drops in-hand served requests', () => {
    const { manager, handle, cancelled } = makeManager()
    handle(remoteToolCall('req-drop'))
    manager.disconnect()
    expect(cancelled).toEqual([{ requestId: 'req-drop', why: 'disconnected' }])
  })

  test('worker source fires onWorkerLive once; replayed skips', () => {
    const { handle, workerLive } = makeManager()
    handle(remoteToolCall('req-live'), {
      source: 'worker',
      replayed: false,
    })
    expect(workerLive.n).toBe(1)
    handle(remoteToolCall('req-live-2'), {
      source: 'worker',
      replayed: false,
    })
    expect(workerLive.n).toBe(1)
    const { handle: handle2, workerLive: live2 } = makeManager()
    handle2(remoteToolCall('req-replay'), {
      source: 'worker',
      replayed: true,
    })
    expect(live2.n).toBe(0)
  })

  test('respondToServedChannelRequest invokes onPosted accepted', () => {
    const { manager, handle } = makeManager()
    handle(remoteToolCall('req-posted'))
    const posted: Array<{ outcome: string; replyMs: number }> = []
    expect(
      manager.respondToServedChannelRequest(
        'req-posted',
        { result: {} },
        (outcome, replyMs) => {
          posted.push({ outcome: outcome.outcome, replyMs })
        },
      ),
    ).toBe(true)
    expect(posted).toEqual([{ outcome: 'accepted', replyMs: 0 }])
  })

  test('source-locks leftover inbound serve worker-live / probe opts', () => {
    const body = readFileSync(
      join(import.meta.dir, '../RemoteSessionManager.ts'),
      'utf8',
    )
    expect(body).toContain('noteWorkerLive')
    expect(body).toContain('reviveStreamForUserSend')
    expect(body).toContain('leftoverServedSendOpts')
    expect(body).toContain('remote_tools_probe')
    expect(body).toContain('@206741679')
    expect(body).toContain('@206767294')
    expect(body).toContain('@206768268')
    expect(body).toContain('@206760063')
    expect(body).toContain('@206773533')
  })

  test('disconnect leftover calls onWorkerGone after a live worker', () => {
    const { manager, handle, workerLive, workerGone } = makeManager()
    handle(remoteToolCall('req-gone'), {
      source: 'worker',
      replayed: false,
    })
    expect(workerLive.n).toBe(1)
    manager.disconnect()
    expect(workerGone.n).toBe(1)
  })
})
