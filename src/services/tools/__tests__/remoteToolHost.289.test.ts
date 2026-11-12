import { afterEach, describe, expect, test } from 'bun:test'
import {
  acceptRemoteMachineAnnounce,
  clearAnnouncedRemoteMachines,
  displayRemoteHostName,
  isReservedRemoteHostName,
  namesRemoteHost,
  remoteHostForwardRefusal,
  remoteHostNotForwardedMessage,
  remoteHostRoute,
  remoteHostSchemaProperty,
  remoteHostUnknownMessage,
  remoteHostUnreachableMessage,
  remoteToolsAnnounceSwitch,
  requestedRemoteHost,
} from '../remoteToolHost.js'

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
})
