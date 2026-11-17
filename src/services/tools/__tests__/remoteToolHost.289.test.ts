import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  RemoteToolHosts,
  ToolStateSlots,
  type RemoteToolRoutedHost,
} from '../../../utils/toolState.js'
import {
  acceptRemoteMachineAnnounce,
  announceWaitAlreadyExpired,
  announcedRemoteMachines,
  markRemoteMachineAway,
  noteRemoteMachineHeard,
  clearAnnouncedRemoteMachines,
  displayRemoteHostName,
  hostsForTable,
  isReservedRemoteHostName,
  namesRemoteHost,
  remoteHostForwardRefusal,
  remoteHostNotForwardedMessage,
  machineAdoptingMcpTool,
  machineServingTool,
  remoteHostRoute,
  remoteHostSchemaProperty,
  remoteHostUnknownMessage,
  remoteHostUnreachableMessage,
  remoteToolsAnnounceSwitch,
  requestedRemoteHost,
  resolveAnnouncedMachine,
  waitForAnnouncedMachine,
  applyBridgeRemoteHosts,
  bridgeHostsFromToolList,
  createBridgeTransport,
  parseBridgeToolList,
  DEVICE_PASSTHROUGH_META,
  refreshRemoteToolHosts,
  REMOTE_TOOL_EXECUTION_META,
  RemoteSessionRegistry,
  syncSessionRemoteHosts,
} from '../remoteToolHost.js'

import { currentRemoteToolHost, noteRemoteToolHost } from '../remoteToolCall.js'

const PREV_FORWARD = process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD

afterEach(() => {
  if (PREV_FORWARD === undefined) {
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD
  } else {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = PREV_FORWARD
  }
  delete process.env.CLAUDE_CODE_REMOTE_TOOLS_SESSION_CHANNEL
  clearAnnouncedRemoteMachines()
})

describe('remote host name (densable i / tE)', () => {
  test('reserved names are this session, not a machine', () => {
    expect(isReservedRemoteHostName('container')).toBe(true)
    expect(isReservedRemoteHostName('this-machine')).toBe(true)
    expect(requestedRemoteHost({ _host: 'container' })).toBeUndefined()
    expect(requestedRemoteHost({ _host: '  this-machine  ' })).toBeUndefined()
    expect(namesRemoteHost({ _host: '' })).toBe(false)
    expect(namesRemoteHost({})).toBe(false)
    expect(requestedRemoteHost({ _host: 'desk' })).toBe('desk')
  })
})

describe('remote host refusal (densable sOn, attached empty)', () => {
  test('forwarding off stays local', () => {
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD
    expect(remoteHostForwardRefusal({ _host: 'desk' })).toBeUndefined()
  })

  test('forwarding on with no announced machine is unknown_host', () => {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    expect(remoteHostForwardRefusal({ _host: 'desk' })).toEqual({
      result: false,
      message: remoteHostUnreachableMessage(),
    })
    expect(remoteHostNotForwardedMessage()).toContain('"_host"')
  })

  test('tv strips control characters and caps at 40', () => {
    expect(displayRemoteHostName('desktop')).toBe('desktop')
    expect(displayRemoteHostName('a'.repeat(50))).toHaveLength(40)
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    expect(remoteHostUnknownMessage('a'.repeat(50))).toContain(
      `"${'a'.repeat(40)}"`,
    )
  })

  test('$2 adds _host only while forwarding is on', () => {
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD
    expect(remoteHostSchemaProperty()).toBeUndefined()
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    expect(remoteHostSchemaProperty()?._host.type).toBe('string')
  })

  test('switches are channel, then forward, else switch_off', () => {
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD
    expect(remoteToolsAnnounceSwitch()).toBe('switch_off')
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    expect(remoteToolsAnnounceSwitch()).toBe('on')
    process.env.CLAUDE_CODE_REMOTE_TOOLS_SESSION_CHANNEL = '0'
    expect(remoteToolsAnnounceSwitch()).toBe('channel_off')
  })

  test('an announced machine is offline, not served, or remote', () => {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    expect(
      acceptRemoteMachineAnnounce({
        instanceId: 'inst',
        name: 'Desk',
        tools: [{ name: 'Read', refusedInputFields: [] }],
      }).status,
    ).toBe('invalid')
    expect(
      acceptRemoteMachineAnnounce({
        instanceId: 'inst',
        name: 'desk',
        tools: [{ name: 'Read', refusedInputFields: [] }],
        protocolVersions: [1],
        passthrough: ['mcp__desk__read'],
      }).status,
    ).toBe('announced')
    expect(
      acceptRemoteMachineAnnounce({
        instanceId: 'inst',
        name: 'desk',
        tools: [],
      }).status,
    ).toBe('withdrawn')
    acceptRemoteMachineAnnounce({
      instanceId: 'inst',
      name: 'desk',
      tools: [{ name: 'Read', refusedInputFields: [] }],
      protocolVersions: [1],
    })
    expect(remoteHostRoute({ _host: 'DESK' }, 'Read').kind).toBe('error')
    expect(remoteHostUnknownMessage('DESK')).toContain('use "desk"')
    expect(remoteHostRoute({ _host: 'desk' }, 'Bash')).toMatchObject({
      kind: 'error',
    })
    expect(remoteHostRoute({ _host: 'desk' }, 'Read')).toMatchObject({
      kind: 'remote',
    })
    expect(remoteHostForwardRefusal({ _host: 'desk' })).toBeUndefined()
  })

  test('reserved host is not a refusal even when forwarding is on', () => {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = 'true'
    expect(remoteHostForwardRefusal({ _host: 'container' })).toBeUndefined()
  })

  test('route readers use the same ZO as accept', async () => {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    const slots = new ToolStateSlots()
    expect(
      acceptRemoteMachineAnnounce(
        {
          instanceId: 'inst-1',
          name: 'desk',
          tools: [{ name: 'Read', refusedInputFields: [] }],
          protocolVersions: [1],
          passthrough: ['mcp__desk__read'],
        },
        slots,
      ).status,
    ).toBe('announced')
    expect(remoteHostRoute({ _host: 'desk' }, 'Read').kind).toBe('error')
    expect(remoteHostRoute({ _host: 'desk' }, 'Read', false, slots).kind).toBe(
      'remote',
    )
    expect(resolveAnnouncedMachine('desk', slots).kind).toBe('remote')
    expect(machineServingTool('Read', slots)?.name).toBe('desk')
    expect(machineAdoptingMcpTool('mcp__desk__read', slots)?.name).toBe('desk')
    expect(hostsForTable(slots)).toHaveLength(1)
    expect(hostsForTable()).toEqual([])
    expect(
      await waitForAnnouncedMachine(
        'desk',
        new AbortController().signal,
        1,
        slots,
      ),
    ).toBe('announced')
    clearAnnouncedRemoteMachines(slots)
    expect(hostsForTable(slots)).toEqual([])
    expect(remoteHostRoute({ _host: 'desk' }, 'Read', false, slots).kind).toBe(
      'error',
    )
  })
})

describe('session announce isolation', () => {
  const announce = (slots?: ToolStateSlots, name = 'desk') =>
    acceptRemoteMachineAnnounce(
      {
        instanceId: `${name}-instance`,
        name,
        tools: [{ name: 'Read', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      slots,
    )

  test('an expired wait in A does not prevent B waiting for its own announce', async () => {
    const first = new ToolStateSlots()
    const second = new ToolStateSlots()
    const signal = new AbortController().signal
    expect(await waitForAnnouncedMachine('missing', signal, 0, first)).toBe(
      'gave_up',
    )
    expect(announceWaitAlreadyExpired(first)).toBeNumber()
    expect(announceWaitAlreadyExpired(second)).toBeUndefined()
    expect(announceWaitAlreadyExpired()).toBeUndefined()
    const pending = waitForAnnouncedMachine('desk', signal, 500, second)
    announce(second)
    expect(await pending).toBe('announced')
    expect(announceWaitAlreadyExpired(second)).toBeUndefined()
  })

  test('another session or default announce cannot settle the caller wait', async () => {
    const first = new ToolStateSlots()
    const second = new ToolStateSlots()
    const controller = new AbortController()
    let settled = false
    const pending = waitForAnnouncedMachine(
      'desk',
      controller.signal,
      500,
      first,
    ).then(kind => {
      settled = true
      return kind
    })
    announce(second)
    announce()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    announce(first)
    expect(await pending).toBe('announced')
  })

  test('an unrelated machine announce in the same session does not end the target wait', async () => {
    const slots = new ToolStateSlots()
    let settled = false
    const pending = waitForAnnouncedMachine(
      'wanted',
      new AbortController().signal,
      500,
      slots,
    ).then(result => {
      settled = true
      return result
    })
    announce(slots)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'wanted-inst',
        name: 'wanted',
        tools: [{ name: 'Read', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      slots,
    )
    expect(await pending).toBe('announced')
  })

  test('aborting unsubscribes only that session wait', async () => {
    const slots = new ToolStateSlots()
    const controller = new AbortController()
    const pending = waitForAnnouncedMachine(
      'desk',
      controller.signal,
      500,
      slots,
    )
    controller.abort()
    expect(await pending).toBe('aborted')
    expect(announceWaitAlreadyExpired(slots)).toBeUndefined()
    announce(slots)
  })

  test('clearing A preserves default and B, including their wait markers', async () => {
    const first = new ToolStateSlots()
    const second = new ToolStateSlots()
    announce(first)
    announce(second)
    announce()
    await waitForAnnouncedMachine(
      'missing',
      new AbortController().signal,
      0,
      second,
    )
    const waited = announceWaitAlreadyExpired(second)
    clearAnnouncedRemoteMachines(first)
    expect(announcedRemoteMachines(first)).toEqual([])
    expect(announcedRemoteMachines(second)).toHaveLength(1)
    expect(announcedRemoteMachines()).toHaveLength(1)
    expect(announceWaitAlreadyExpired(second)).toBe(waited)
  })

  test('renaming and withdrawing an instance removes its aliases but preserves a replacement', () => {
    const slots = new ToolStateSlots()
    const registry = slots.get(RemoteSessionRegistry)
    const first = {
      instanceId: 'first',
      name: 'old-desk',
      tools: [{ name: 'Read', refusedInputFields: [] }],
    }
    acceptRemoteMachineAnnounce(first, slots)
    acceptRemoteMachineAnnounce({ ...first, name: 'new-desk' }, slots)
    expect(registry.entries().map(machine => machine.name)).toEqual([
      'new-desk',
    ])
    // A captured instance follows a rename, while a replacement has a new id.
    noteRemoteMachineHeard('old-desk', 'renamed-epoch', slots, 'first')
    expect(registry.entries()[0]?.epoch).toBe('renamed-epoch')
    acceptRemoteMachineAnnounce({ ...first, instanceId: 'replacement' }, slots)
    acceptRemoteMachineAnnounce({ ...first, tools: [] }, slots)
    expect(registry.entries().map(machine => machine.instanceId)).toEqual([
      'replacement',
    ])
    expect(registry.withdrawnThisLife('new-desk')).toBe(true)
    expect(registry.withdrawnThisLife('old-desk')).toBe(false)
    expect(
      acceptRemoteMachineAnnounce(
        { instanceId: 'absent', name: 'absent-desk', tools: [] },
        slots,
      ).status,
    ).toBe('withdrawn')
    expect(registry.withdrawnThisLife('absent-desk')).toBe(true)
  })

  test('passthrough, plumbing, and ignored-only reannounces are not withdrawals', () => {
    const slots = new ToolStateSlots()
    for (const extra of [
      { passthrough: ['mcp__desk__read'] },
      { plumbing: ['RemoteToolOutcome'] },
      { ignoredTools: ['FutureTool'] },
    ]) {
      const input = {
        instanceId: 'instance',
        name: 'desk',
        tools: [],
        ...extra,
      }
      expect(acceptRemoteMachineAnnounce(input, slots).status).toBe('announced')
      expect(acceptRemoteMachineAnnounce(input, slots).status).toBe('announced')
      expect(announcedRemoteMachines(slots)).toHaveLength(1)
    }
  })

  test('a withdrawal notifies only its session and clear preserves lifetime markers', async () => {
    const slots = new ToolStateSlots()
    const registry = slots.get(RemoteSessionRegistry)
    let notices = 0
    registry.onNextAnnounce(() => {
      notices++
    })
    acceptRemoteMachineAnnounce(
      { instanceId: 'absent', name: 'desk', tools: [] },
      slots,
    )
    expect(notices).toBe(1)
    await waitForAnnouncedMachine(
      'missing',
      new AbortController().signal,
      0,
      slots,
    )
    const waited = announceWaitAlreadyExpired(slots)
    registry.clear()
    expect(registry.hasAnnouncedThisLife()).toBe(true)
    expect(registry.withdrawnThisLife('desk')).toBe(true)
    expect(announceWaitAlreadyExpired(slots)).toBe(waited)
  })

  test('a host table resolves only its own synchronized rows', () => {
    const first = new ToolStateSlots()
    const second = new ToolStateSlots()
    announce(undefined, 'default-desk')
    announce(first, 'first-desk')
    syncSessionRemoteHosts(first, 'test')
    const own = first.get(RemoteToolHosts)
    const other = second.get(RemoteToolHosts)
    expect(own.resolve('first-desk').kind).toBe('remote')
    expect(own.resolve('default-desk')).toEqual({ kind: 'unknown' })
    expect(other.resolve('default-desk')).toEqual({ kind: 'unknown' })
    expect(other.resolve('first-desk')).toEqual({ kind: 'unknown' })
    expect(other.resolve('this-machine').kind).toBe('local')
    const previous = currentRemoteToolHost()
    try {
      noteRemoteToolHost({
        hostName: 'global-handle',
        instanceId: 'foreign-instance',
        live: { status: 'online', lastHeardAt: Date.now() },
        stale: false,
      })
      expect(other.resolve('global-handle')).toEqual({ kind: 'unknown' })
    } finally {
      noteRemoteToolHost(previous)
    }
  })
})

describe('session remote liveness', () => {
  test('probe results and replacement reads stay within the caller session', () => {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    const first = new ToolStateSlots()
    const second = new ToolStateSlots()
    for (const [slots, instanceId] of [
      [first, 'first-instance'],
      [second, 'second-instance'],
    ] as const) {
      acceptRemoteMachineAnnounce(
        {
          instanceId,
          name: 'desk',
          tools: [{ name: 'Read', refusedInputFields: [] }],
          protocolVersions: [1],
        },
        slots,
      )
    }
    markRemoteMachineAway('desk', 'probe_missed', first)
    expect(announcedRemoteMachines(first)[0]).toMatchObject({
      status: 'offline',
      stale: true,
    })
    expect(announcedRemoteMachines(second)[0]).toMatchObject({
      status: 'online',
      stale: false,
    })
    noteRemoteMachineHeard('desk', 'first-epoch', first)
    expect(announcedRemoteMachines(first)[0]).toMatchObject({
      status: 'online',
      epoch: 'first-epoch',
    })
    expect(announcedRemoteMachines(second)[0]?.epoch).toBeUndefined()
    expect(announcedRemoteMachines()).toEqual([])
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'first-replacement',
        name: 'desk',
        tools: [{ name: 'Read', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      first,
    )
    expect(announcedRemoteMachines(first)[0]?.instanceId).toBe(
      'first-replacement',
    )
    expect(announcedRemoteMachines(second)[0]?.instanceId).toBe(
      'second-instance',
    )
    // A late callback still carries the instance captured before replacement.
    noteRemoteMachineHeard('desk', 'old-epoch', first, 'first-instance')
    markRemoteMachineAway('desk', 'probe_missed', first, 'first-instance')
    expect(announcedRemoteMachines(first)[0]).toMatchObject({
      instanceId: 'first-replacement',
      status: 'online',
      stale: false,
    })
    expect(announcedRemoteMachines(first)[0]?.epoch).toBeUndefined()
    markRemoteMachineAway('desk', 'probe_missed', first, 'first-replacement')
    expect(announcedRemoteMachines(first)[0]?.status).toBe('offline')
    noteRemoteMachineHeard('desk', 'new-epoch', first, 'first-replacement')
    expect(announcedRemoteMachines(first)[0]).toMatchObject({
      status: 'online',
      epoch: 'new-epoch',
    })
  })
})

describe('QFn hostsForTable / syncSessionRemoteHosts', () => {
  test('hostsForTable is session-source ZO rows', () => {
    expect(hostsForTable()).toEqual([])
    expect(
      acceptRemoteMachineAnnounce({
        instanceId: 'inst-1',
        name: 'desk',
        tools: [{ name: 'Bash', refusedInputFields: [] }],
        protocolVersions: [1],
        passthrough: ['mcp__desk__read'],
      }).status,
    ).toBe('announced')
    const rows = hostsForTable()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'remote',
      source: 'session',
      name: 'desk',
      instanceId: 'inst-1',
      status: 'online',
      enforcement: 'self',
    })
    expect([...rows[0]!.servedTools]).toEqual(['Bash'])
    expect(rows[0]!.passthroughTools?.get('mcp__desk__read')).toEqual({
      localName: 'mcp__desk__read',
    })
    expect(rows[0]!.protocol).toEqual({ kind: 'compatible', version: 1 })
  })

  test('QFn copies ZO into rF session source and withdraws it', () => {
    const slots = new ToolStateSlots()
    const rF = slots.get(RemoteToolHosts)
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'inst-1',
        name: 'desk',
        tools: [{ name: 'Bash', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      slots,
    )
    syncSessionRemoteHosts(slots, 'resolve')
    expect(rF.sourceHosts('session').map(h => h.name)).toEqual(['desk'])
    expect(rF.sourceHosts('session')[0]?.servedTools?.has('Bash')).toBe(true)
    expect(rF.resolve('desk').kind).toBe('remote')
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'inst-1',
        name: 'desk',
        tools: [],
      },
      slots,
    )
    syncSessionRemoteHosts(slots, 'resolve')
    expect(rF.sourceHosts('session')).toEqual([])
    expect(hostsForTable()).toEqual([])
  })

  test('QFn identity skip does not wipe a matching table', () => {
    const slots = new ToolStateSlots()
    const rF = slots.get(RemoteToolHosts)
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'inst-1',
        name: 'desk',
        tools: [{ name: 'Read', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      slots,
    )
    syncSessionRemoteHosts(slots, 'resolve')
    syncSessionRemoteHosts(slots, 'resolve')
    expect(rF.sourceHosts('session')).toHaveLength(1)
    expect(rF.sourceHosts('session')[0]?.status).toBe('online')
  })

  test('Wit QFn still copies session hosts', async () => {
    const slots = new ToolStateSlots()
    const rF = slots.get(RemoteToolHosts)
    acceptRemoteMachineAnnounce(
      {
        instanceId: 'inst-1',
        name: 'desk',
        tools: [{ name: 'Bash', refusedInputFields: [] }],
        protocolVersions: [1],
      },
      slots,
    )
    await refreshRemoteToolHosts(slots, 'resolve')
    expect(rF.sourceHosts('session').map(h => h.name)).toEqual(['desk'])
  })

  test('ne empty bridge keeps prior hosts offline', () => {
    const slots = new ToolStateSlots()
    const rF = slots.get(RemoteToolHosts)
    rF.replaceRemoteHosts('bridge', [
      { source: 'bridge', name: 'box-1', instanceId: 'i1', status: 'online' },
    ])
    expect(rF.sourceHosts('bridge')[0]?.status).toBe('online')
    applyBridgeRemoteHosts(slots, [], { trigger: 'resolve' })
    expect(rF.sourceHosts('bridge').map(h => h.name)).toEqual(['box-1'])
    expect(rF.sourceHosts('bridge')[0]?.status).toBe('offline')
  })

  test('rF.hosts merges online-first and fills passthrough', () => {
    const rF = new RemoteToolHosts()
    rF.replaceRemoteHosts('session', [
      { source: 'session', name: 'desk', instanceId: 's1', status: 'online' },
    ])
    rF.replaceRemoteHosts('bridge', [
      {
        source: 'bridge',
        name: 'desk',
        instanceId: 'b1',
        status: 'offline',
        passthroughTools: new Map([['mcp__desk__read', { localName: 'read' }]]),
      },
    ])
    const remotes = rF
      .hosts()
      .filter((h): h is RemoteToolRoutedHost => h.kind !== 'local')
    expect(remotes.map(h => h.name)).toEqual(['desk'])
    expect(remotes[0]?.status).toBe('online')
    expect(remotes[0]?.passthroughTools?.get('mcp__desk__read')).toEqual({
      localName: 'read',
    })
    expect(rF.resolve('desk').kind).toBe('remote')
  })

  test('ne drops reserved bridge names', () => {
    const slots = new ToolStateSlots()
    const rF = slots.get(RemoteToolHosts)
    applyBridgeRemoteHosts(
      slots,
      [
        {
          source: 'bridge',
          name: 'container',
          instanceId: 'i1',
          status: 'online',
        },
        { source: 'bridge', name: 'box-1', instanceId: 'i2', status: 'online' },
      ],
      { trigger: 'resolve' },
    )
    expect(rF.sourceHosts('bridge').map(h => h.name)).toEqual(['box-1'])
  })

  test('Z lists served tools onto attached-machine', () => {
    const hosts = bridgeHostsFromToolList([
      { name: 'Bash' },
      { name: 'mcp__desk__read' },
    ])
    expect(hosts).toHaveLength(1)
    expect(hosts[0]?.name).toBe('attached-machine')
    expect(hosts[0]?.source).toBe('bridge')
    expect(hosts[0]?.servedTools?.has('Bash')).toBe(true)
    expect(bridgeHostsFromToolList([])).toEqual([])
  })

  test('Z _meta target name wins over attached-machine', () => {
    const hosts = bridgeHostsFromToolList([
      {
        name: 'Bash',
        _meta: {
          [REMOTE_TOOL_EXECUTION_META]: {
            v: 1,
            tool: 'Bash',
            target: { name: 'desk' },
            protocol_versions: [1],
          },
        },
      },
      {
        name: 'mcp__desk__read',
        _meta: {
          [DEVICE_PASSTHROUGH_META]: {
            v: 1,
            tool: 'read',
            target: { name: 'desk' },
          },
        },
      },
    ])
    expect(hosts[0]?.name).toBe('desk')
    expect(hosts[0]?.status).toBe('online')
    expect(hosts[0]?.passthroughTools?.get('mcp__desk__read')).toEqual({
      localName: 'read',
    })
    const withExtras = parseBridgeToolList([
      {
        name: 'Bash',
        _meta: {
          [REMOTE_TOOL_EXECUTION_META]: {
            tool: 'Bash',
            target: {
              name: 'desk',
              kind: 'personal_machine',
              platform: 'darwin',
            },
          },
        },
      },
      { name: 'sync_files' },
      {
        name: 'mcp__desk__read',
        _meta: { [DEVICE_PASSTHROUGH_META]: { tool: 'nope' } },
      },
    ])
    expect(withExtras.hosts[0]?.description).toEqual({
      name: 'desk',
      kind: 'personal_machine',
      platform: 'darwin',
    })
    expect(withExtras.hosts[0]?.plumbingTools?.has('sync_files')).toBe(true)
    expect(
      withExtras.hosts[0]?.rejectedPassthroughTools?.has('mcp__desk__read'),
    ).toBe(true)
  })

  test('Z two_names and unreadable counts', () => {
    const two = parseBridgeToolList([
      {
        name: 'Bash',
        _meta: {
          [REMOTE_TOOL_EXECUTION_META]: {
            tool: 'Bash',
            target: { name: 'desk' },
          },
        },
      },
      {
        name: 'Read',
        _meta: {
          [REMOTE_TOOL_EXECUTION_META]: {
            tool: 'Read',
            target: { name: 'box-2' },
          },
        },
      },
    ])
    expect(two.invalid).toBe('two_names')
    expect(two.hosts[0]?.status).toBe('offline')
    const unread = parseBridgeToolList([{ name: 'Bash' }])
    expect(unread.unreadable).toBe(1)
    expect(unread.hosts[0]?.name).toBe('attached-machine')
    const markers = parseBridgeToolList([
      {
        name: 'mcp__desk__read',
        _meta: { [DEVICE_PASSTHROUGH_META]: { tool: 'nope' } },
      },
    ])
    expect(markers.unreadableMarkers).toBe(1)
    expect(markers.hosts).toHaveLength(1)
  })

  test('W _F invokeToolRaw passes abort signal', async () => {
    const ac = new AbortController()
    let captured: {
      params?: { name?: string; arguments?: Record<string, unknown> }
      options?: { signal?: AbortSignal; timeout?: number }
    } = {}
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      config: { type: 'sdk' },
      client: {
        callTool: async (params, options) => {
          captured = { params, options }
          return { content: params.name, isError: false }
        },
      },
    })
    expect(transport).toBeDefined()
    const sent = await transport!.call(
      'Bash',
      { cmd: 'ls', _host: 'desk' },
      { v: 1, op: 'outcome_of' },
      {
        signal: ac.signal,
        deadlineMs: 15_000,
        toolUseId: 't',
      },
    )
    expect(sent?.kind).toBe('result')
    expect(captured.params?.arguments).not.toHaveProperty('_host')
    expect(captured.options?.signal).toBe(ac.signal)
    expect(captured.options?.timeout).toBeGreaterThan(0)
    expect(captured.params?.arguments?.__remote_tool_call).toEqual({
      v: 1,
      op: 'outcome_of',
    })
  })

  test('W transport is stored on the bridge host', async () => {
    let captured: {
      params?: {
        name?: string
        arguments?: Record<string, unknown>
        _meta?: Record<string, unknown>
      }
      options?: { signal?: AbortSignal; timeout?: number }
    } = {}
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      config: { type: 'sdk' },
      client: {
        callTool: async (params, options) => {
          captured = { params, options }
          return { content: params.name, isError: false }
        },
      },
    })
    expect(transport).toBeDefined()
    const hosts = bridgeHostsFromToolList([{ name: 'Bash' }], transport)
    expect(hosts[0]?.transport).toBe(transport)
    const sent = await transport!.call(
      'Bash',
      { cmd: 'ls' },
      { v: 1, op: 'outcome_of' },
      {
        signal: new AbortController().signal,
        deadlineMs: 15_000,
        toolUseId: 't',
      },
    )
    expect(sent?.kind).toBe('result')
    expect(sent?.envelope).toBeUndefined()
    expect(typeof sent?.elapsedMs).toBe('number')
    expect(typeof sent?.responseBytes).toBe('number')
    expect(transport!.kind).toBe('bridge')
    expect(transport!.limits).toEqual({
      maxRequestBytes: 4_128_768,
      defaultDeadlineMs: 58_000,
    })
    expect(captured.params?.arguments?.__remote_tool_call).toEqual({
      v: 1,
      op: 'outcome_of',
    })
    expect(captured.params?._meta?.['claudecode/toolUseId']).toBe('t')
    await expect(
      transport!.callPlumbing!(
        'Bash',
        {},
        {
          signal: new AbortController().signal,
          deadlineMs: 1000,
        },
      ),
    ).rejects.toThrow('callPlumbing: not a bridge plumbing tool')
  })

  test('Re X() maps office_bridge.kind timeout', async () => {
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      config: { type: 'sdk' },
      client: {
        callTool: async () => ({
          content: 'x',
          isError: true,
          _meta: { 'office_bridge.kind': 'timeout' },
        }),
      },
    })
    const sent = await transport!.call(
      'Bash',
      {},
      {},
      {
        signal: new AbortController().signal,
        deadlineMs: 1,
        toolUseId: 't',
      },
    )
    expect(sent?.kind).toBe('timed_out')
    expect(sent?.capMs).toBe(1)
  })

  test('Re present includes elapsedMs and responseBytes', async () => {
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      config: { type: 'sdk' },
      client: {
        callTool: async () => ({
          content: 'done',
          isError: false,
          structuredContent: {
            'anthropic/remoteToolExecution': {
              outcome: 'completed',
              target: { name: 'desk', working_dir: '/' },
              output: { ok: true },
            },
          },
        }),
      },
    })
    const sent = await transport!.call(
      'Bash',
      {},
      {},
      {
        signal: new AbortController().signal,
        deadlineMs: 15_000,
        toolUseId: 't',
      },
    )
    expect(sent?.kind).toBe('result')
    expect(sent?.envelope?.outcome).toBe('completed')
    expect(sent?.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(sent?.responseBytes).toBeGreaterThan(0)
  })

  test('X not_connected sets machineNotAnswering', async () => {
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      config: { type: 'sdk' },
      client: {
        callTool: async () => ({
          content: 'offline',
          isError: true,
          _meta: { 'office_bridge.kind': 'not_connected' },
        }),
      },
    })
    const sent = await transport!.call(
      'Bash',
      {},
      {},
      {
        signal: new AbortController().signal,
        deadlineMs: 1_000,
        toolUseId: 't',
      },
    )
    expect(sent).toMatchObject({
      kind: 'unreachable',
      detail: 'bridge: not_connected',
      machineNotAnswering: true,
    })
  })

  test('J can return approval_unverified', async () => {
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      config: { type: 'sdk' },
      client: {
        callTool: async () => {
          throw Object.assign(new Error('approval'), {
            code: -32003,
            data: {
              args_sha256: 'abc',
              tool_name: 'Bash',
              tool_use_id: 'tu-1',
            },
          })
        },
      },
    })
    const sent = await transport!.call(
      'Bash',
      {},
      {},
      {
        signal: new AbortController().signal,
        deadlineMs: 15_000,
        toolUseId: 'tu-1',
      },
    )
    expect(sent?.kind).toBe('approval_unverified')
  })

  test('V remaining deadline after T().ensureConnectedClient is unreachable', async () => {
    const orig = Date.now
    let now = 1_000_000
    Date.now = () => {
      const value = now
      now += 5_000
      return value
    }
    try {
      const transport = createBridgeTransport({
        name: 'remote-devices',
        type: 'connected',
        config: { type: 'sdk' },
        client: {
          callTool: async () => ({ content: 'should-not-run' }),
        },
      })
      const sent = await transport!.call(
        'Bash',
        {},
        {},
        {
          signal: new AbortController().signal,
          deadlineMs: 1,
          toolUseId: 't',
        },
      )
      expect(sent?.kind).toBe('unreachable')
      expect(sent?.detail).toContain(
        'deadline reached before the request could be sent',
      )
    } finally {
      Date.now = orig
    }
  })

  test('M T().ensureConnectedClient failure is unreachable', async () => {
    const transport = createBridgeTransport({
      name: 'remote-devices',
      type: 'connected',
      client: {
        callTool: async () => ({ content: 'nope' }),
      },
    })
    const sent = await transport!.call(
      'Bash',
      {},
      {},
      {
        signal: new AbortController().signal,
        deadlineMs: 1,
        toolUseId: 't',
      },
    )
    expect(sent?.kind).toBe('unreachable')
  })

  test('j leftover evicts failed connect memo on connect_failed', () => {
    const src = readFileSync(
      join(import.meta.dir, '../remoteToolHost.ts'),
      'utf8',
    )
    expect(src).toContain('evictStaleFailedConnectMemoForServe')
    expect(src).toContain('invokeToolRaw')
    expect(src).toContain("kind === 'connect_failed'")
    const clientSrc = readFileSync(
      join(import.meta.dir, '../../mcp/client.ts'),
      'utf8',
    )
    expect(clientSrc).toContain(
      'export async function evictStaleFailedConnectMemoForServe',
    )
    expect(clientSrc).toContain("settled?.type !== 'failed'")
    expect(clientSrc).toContain('export function invokeToolRaw')
    expect(clientSrc).toContain('invokeToolRaw,')
    expect(clientSrc).toContain('ensureConnectedClient,')
  })

  test('ZO class accept is the session registry', () => {
    const zo = new RemoteSessionRegistry()
    expect(zo.hasAnnouncedThisLife()).toBe(false)
    expect(
      zo.accept({
        instanceId: 'i',
        name: 'desk',
        tools: [{ name: 'Read', refusedInputFields: [] }],
        protocolVersions: [1],
      }).status,
    ).toBe('announced')
    expect(zo.hasAnnouncedThisLife()).toBe(true)
    expect(zo.hostsForTable()[0]?.name).toBe('desk')
    expect(
      zo.accept({
        instanceId: 'i',
        name: 'desk',
        tools: [],
      }).status,
    ).toBe('withdrawn')
    expect(zo.entries()).toEqual([])
    expect(zo.withdrawnThisLife('desk')).toBe(true)
  })

  test('replaceRemoteHosts stores provided transport as-is', () => {
    const rF = new RemoteToolHosts()
    const calls: string[] = []
    const transport = {
      call: async (toolName: string) => {
        calls.push(toolName)
        return { kind: 'result' as const }
      },
    }
    rF.replaceRemoteHosts('session', [
      {
        source: 'session',
        name: 'desk',
        instanceId: 'i',
        status: 'online',
        transport,
      },
    ])
    const resolved = rF.resolve('desk')
    expect(resolved.kind).toBe('remote')
    if (resolved.kind === 'remote') {
      expect(resolved.host.transport).toBe(transport)
    }
  })
})
