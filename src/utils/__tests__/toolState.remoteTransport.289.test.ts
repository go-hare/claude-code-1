import { afterEach, describe, expect, test } from 'bun:test'
import {
  getCurrentStructuredIO,
  setCurrentStructuredIO,
  type StructuredIO,
} from '../../cli/structuredIO.js'
import {
  acceptRemoteMachineAnnounce,
  RemoteSessionRegistry,
  syncSessionRemoteHosts,
} from '../../services/tools/remoteToolHost.js'
import { RemoteToolHosts, ToolStateSlots } from '../toolState.js'

const originalIO = getCurrentStructuredIO()
const originalForward = process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD

afterEach(() => {
  setCurrentStructuredIO(originalIO)
  if (originalForward === undefined) {
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD
  } else {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = originalForward
  }
})

function announcedHost() {
  process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
  const slots = new ToolStateSlots()
  expect(
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'inst-local',
        name: 'desk',
        tools: [{ name: 'Bash', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      slots,
    ).status,
  ).toBe('announced')
  syncSessionRemoteHosts(slots, 'test')
  const host = slots.get(RemoteToolHosts).sourceHosts('session')[0]!
  const call = (signal = new AbortController().signal) =>
    host.transport.call(
      'Bash',
      { task_id: 't1', _host: 'desk' },
      { op: 'status' },
      {
        signal,
        deadlineMs: 123,
        toolUseId: 'tool-1',
      },
    )
  return { slots, host, call }
}

function answerWith(response: Record<string, unknown>) {
  const requests: unknown[] = []
  setCurrentStructuredIO({
    requestRemoteToolCall: async (request: unknown) => {
      requests.push(request)
      return response
    },
  } as unknown as StructuredIO)
  return requests
}

describe('289 session host transport bound to its announce slot', () => {
  test('a synced host sends and reads the actual result', async () => {
    const { call } = announcedHost()
    const requests = answerWith({
      envelope: {
        outcome: 'completed',
        target: { name: 'desk', working_dir: '/work' },
        output: { task_id: 't1', status: 'working' },
      },
      content: [{ type: 'text', text: 'working' }],
    })
    expect(await call()).toMatchObject({
      kind: 'result',
      envelope: { outcome: 'completed', output: { status: 'working' } },
      content: [{ type: 'text', text: 'working' }],
      isError: false,
    })
    expect(requests).toMatchObject([
      {
        instanceId: 'inst-local',
        host: 'desk',
        name: 'Bash',
        input: { task_id: 't1' },
        deadlineMs: 123,
        toolUseId: 'tool-1',
      },
    ])
    expect((requests[0] as { input: object }).input).not.toHaveProperty('_host')
  })

  test('offline state stays offline and the existing transport sees withdrawal', async () => {
    const { slots, call } = announcedHost()
    const requests = answerWith({ kind: 'cancelled' })
    slots.get(RemoteSessionRegistry).machines[0]!.status = 'offline'
    syncSessionRemoteHosts(slots, 'test')
    expect(slots.get(RemoteToolHosts).sourceHosts('session')[0]!.status).toBe(
      'offline',
    )
    expect(await call()).toMatchObject({ kind: 'unreachable' })
    expect(requests).toHaveLength(0)
    slots.get(RemoteSessionRegistry).clear()
    expect(await call()).toMatchObject({
      kind: 'unreachable',
      machineNotAnswering: true,
      detail: 'the machine is not announcing on this session',
    })
  })

  test('a host silent for over a minute probes and resumes the same session transport', async () => {
    const { slots, call } = announcedHost()
    const row = slots.get(RemoteSessionRegistry).machines[0]!
    row.lastHeardAt = Date.now() - 61_000
    const probes: unknown[] = []
    const calls: unknown[] = []
    setCurrentStructuredIO({
      requestRemoteToolsProbe: async (request: unknown) => {
        probes.push(request)
        return { result: { epoch: 'fresh-epoch' } }
      },
      requestRemoteToolCall: async (request: unknown) => {
        calls.push(request)
        return {
          envelope: {
            outcome: 'completed',
            target: { name: 'desk', working_dir: '/work' },
            output: { status: 'done' },
          },
        }
      },
    } as unknown as StructuredIO)
    expect(await call()).toMatchObject({ kind: 'result' })
    expect(probes).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(row.epoch).toBe('fresh-epoch')
    expect(row.lastHeardAt).toBeGreaterThan(Date.now() - 1000)
    await call()
    expect(probes).toHaveLength(1)
  })

  test('a missed probe marks its instance offline without sending a call', async () => {
    const { slots, call } = announcedHost()
    const row = slots.get(RemoteSessionRegistry).machines[0]!
    row.lastHeardAt = Date.now() - 61_000
    let calls = 0
    setCurrentStructuredIO({
      requestRemoteToolsProbe: async () => ({ kind: 'deadline' }),
      requestRemoteToolCall: async () => {
        calls++
        return {}
      },
    } as unknown as StructuredIO)
    expect(await call()).toMatchObject({
      kind: 'unreachable',
      machineNotAnswering: true,
    })
    expect(row.status).toBe('offline')
    expect(row.stale).toBe(true)
    expect(calls).toBe(0)
  })

  test('a replacement announced during a missed probe rebinds the call to the new instance', async () => {
    const { slots, call } = announcedHost()
    slots.get(RemoteSessionRegistry).machines[0]!.lastHeardAt =
      Date.now() - 61_000
    let sent: unknown
    setCurrentStructuredIO({
      requestRemoteToolsProbe: async () => {
        acceptRemoteMachineAnnounce(
          {
            instanceId: 'inst-new',
            name: 'desk',
            tools: [{ name: 'Bash', refusedInputFields: [] }],
            protocolVersions: [1],
          },
          slots,
        )
        return { kind: 'deadline' }
      },
      requestRemoteToolCall: async (request: unknown) => {
        sent = request
        return {
          envelope: {
            outcome: 'completed',
            target: { name: 'desk', working_dir: '/work' },
          },
        }
      },
    } as unknown as StructuredIO)
    expect(await call()).toMatchObject({ kind: 'result' })
    expect(sent).toMatchObject({ instanceId: 'inst-new' })
    expect(slots.get(RemoteSessionRegistry).machines[0]!.status).toBe('online')
  })

  test('cancellation returns without sending', async () => {
    const { call } = announcedHost()
    const requests = answerWith({})
    expect(await call(AbortSignal.abort())).toEqual({ kind: 'cancelled' })
    expect(requests).toHaveLength(0)
  })

  test.each([
    [{ kind: 'cancelled' }, { kind: 'cancelled' }],
    [{ kind: 'deadline' }, { kind: 'timed_out', capMs: 123 }],
    [
      { kind: 'unreachable', detail: 'machine disconnected' },
      { kind: 'unreachable', detail: 'machine disconnected' },
    ],
    [
      { kind: 'failed', detail: 'service refused' },
      { kind: 'transport_error', detail: 'send failed: service refused' },
    ],
    [{ kind: 'dropped' }, { kind: 'dropped' }],
    [
      { envelope: { outcome: 'unknown' } },
      {
        kind: 'transport_error',
        detail: 'malformed result envelope',
        unreadableResult: true,
      },
    ],
  ])('keeps transport classification for %j', async (response, expected) => {
    const { call } = announcedHost()
    answerWith(response)
    expect(await call()).toMatchObject(expected)
  })

  test('RemoteToolHosts snapshot tracks tool/protocol changes and passthroughHost', () => {
    const hosts = new RemoteToolHosts()
    const base = {
      source: 'bridge' as const,
      name: 'desk',
      instanceId: 'bridge',
      servedTools: new Set(['Bash']),
      protocol: { kind: 'compatible' as const, version: 1 },
    }
    expect(hosts.replaceRemoteHosts('bridge', [base]).changed).toBe(true)
    expect(hosts.replaceRemoteHosts('bridge', [base]).changed).toBe(false)
    expect(
      hosts.replaceRemoteHosts('bridge', [
        {
          ...base,
          servedTools: new Set(['Bash', 'FileRead']),
          passthroughTools: new Map([
            ['device_bash', { localName: 'mcp__remote-devices__device_bash' }],
          ]),
        },
      ]).changed,
    ).toBe(true)
    expect(hosts.passthroughHost('device_bash')?.name).toBe('desk')
  })

  test('findDeviceBridgeClient validates CCR proxy origin, mcp_url, and toolbox_mcp_server_id', async () => {
    const { findDeviceBridgeClient } = await import(
      '../../services/tools/remoteToolHost.js'
    )
    const { resetMcpCcrIngressCapture } = await import(
      '../../services/mcp/mcpConnectTimeout.js'
    )
    resetMcpCcrIngressCapture({
      SESSION_INGRESS_URL: 'https://ingress.example',
    })
    try {
      const validUrl =
        'https://ingress.example/v2/ccr-sessions/cse_123/mcp?mcp_url=' +
        encodeURIComponent('wss://bridge.claudeusercontent.com/devices/mcp') +
        '&toolbox_mcp_server_id=remote-devices'
      expect(
        findDeviceBridgeClient([
          {
            type: 'connected',
            name: 'remote-devices',
            config: { url: 'https://evil.example/devices/mcp' },
          },
          {
            type: 'connected',
            name: 'remote-devices',
            config: {
              url:
                'https://ingress.example/v2/ccr-sessions/cse_123/mcp?mcp_url=' +
                encodeURIComponent('wss://evil.example/devices/mcp'),
            },
          },
          {
            type: 'connected',
            name: 'remote-devices',
            config: { url: validUrl },
          },
        ]),
      ).toMatchObject({ config: { url: validUrl } })
    } finally {
      resetMcpCcrIngressCapture()
    }
  })
})
