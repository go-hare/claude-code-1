import { describe, expect, test } from 'bun:test'
import WebSocket from 'ws'
import { BridgeClient } from '../bridgeClient.js'
import type {
  ChromeBridgeIdentityMismatchMetadata,
  ChromeBridgeTrackEventMetadata,
  ClaudeForChromeContext,
  Logger,
} from '../types.js'

function makeLogger(): {
  logger: Logger
  infos: string[]
  warns: string[]
} {
  const infos: string[] = []
  const warns: string[] = []
  return {
    infos,
    warns,
    logger: {
      info: msg => infos.push(msg),
      warn: msg => warns.push(msg),
      error: () => {},
      debug: () => {},
      silly: () => {},
    },
  }
}

function makeFakeWs(): {
  ws: WebSocket
  sent: string[]
  closed: boolean
} {
  const state = { sent: [] as string[], closed: false }
  const fake = {
    readyState: WebSocket.OPEN,
    send(data: string) {
      state.sent.push(data)
    },
    close() {
      state.closed = true
    },
    removeAllListeners() {},
  } as unknown as WebSocket
  return {
    ws: fake,
    sent: state.sent,
    get closed() {
      return state.closed
    },
  }
}

function makeContext(overrides: Partial<ClaudeForChromeContext> = {}): {
  context: ClaudeForChromeContext
  events: Array<{ name: string; meta: unknown }>
  warns: string[]
  infos: string[]
} {
  const { logger, infos, warns } = makeLogger()
  const events: Array<{ name: string; meta: unknown }> = []
  const context: ClaudeForChromeContext = {
    serverName: 'Claude in Chrome',
    logger,
    socketPath: '/tmp/test.sock',
    clientTypeId: 'claude-code',
    onToolCallDisconnected: () => 'disconnected',
    onAuthenticationError: () => {},
    trackEvent: (name, meta) => {
      events.push({ name, meta })
    },
    bridgeConfig: {
      url: 'wss://bridge.example',
      getUserId: async () => 'user-a',
      getOAuthToken: async () => 'tok-a',
    },
    ...overrides,
  }
  return { context, events, warns, infos }
}

function attachConnectedSocket(
  client: BridgeClient,
  ws: WebSocket,
  socketUserId: string,
  selectedDeviceId?: string,
): void {
  const internal = client as unknown as {
    ws: WebSocket | null
    connected: boolean
    authenticated: boolean
    socketUserId: string | undefined
    selectedDeviceId: string | undefined
  }
  internal.ws = ws
  internal.connected = true
  internal.authenticated = true
  internal.socketUserId = socketUserId
  internal.selectedDeviceId = selectedDeviceId
}

describe('BridgeClient identity boundary (P1-#38, official 2.1.328 $Hs)', () => {
  test('identity() handles ok, case-insensitive match, other, signed_out, hostHasAnswered, devUserId, and waiver', () => {
    let current: string | null | undefined
    let enforced = true
    const { context, warns } = makeContext({
      getCurrentUserId: () => current,
      isAccountMismatchEnforced: () => enforced,
    })
    const client = new BridgeClient(context)

    // Before host has ever answered, undefined returns 'ok'.
    expect(client.identity('user-a')).toBe('ok')

    // Once host answers with a matching user (case-insensitive), 'ok'.
    current = 'USER-A'
    expect(client.identity('user-a')).toBe('ok')

    // After host has answered once, undefined is treated as signed_out.
    current = undefined
    expect(client.identity('user-a')).toBe('signed_out')

    // Explicit null is signed_out.
    current = null
    expect(client.identity('user-a')).toBe('signed_out')

    // Different account is 'other' when enforced.
    current = 'user-b'
    expect(client.identity('user-a')).toBe('other')

    // When enforcement is waived, logs once and returns 'ok'.
    enforced = false
    expect(client.identity('user-a')).toBe('ok')
    expect(client.identity('user-a')).toBe('ok')
    expect(warns.length).toBe(1)

    // devUserId bypasses identity check altogether.
    const devCtx = makeContext({
      getCurrentUserId: () => null,
      bridgeConfig: {
        url: 'ws://localhost:8765',
        getUserId: async () => 'dev_user_local',
        getOAuthToken: async () => '',
        devUserId: 'dev_user_local',
      },
    })
    const devClient = new BridgeClient(devCtx.context)
    expect(devClient.identity('someone-else')).toBe('ok')
  })

  test('gates sendFrame, isConnected, hasActiveSelection, getSelectedDeviceId on identity() === ok', () => {
    let current: string | null = 'user-a'
    const { context } = makeContext({
      getCurrentUserId: () => current,
      getPersistedDeviceId: () => 'persisted-dev',
    })
    const client = new BridgeClient(context)
    const fake = makeFakeWs()
    attachConnectedSocket(client, fake.ws, 'user-a', 'dev-123')

    expect(client.isConnected()).toBe(true)
    expect(client.hasActiveSelection()).toBe(true)
    expect(client.getSelectedDeviceId()).toBe('dev-123')
    expect(client.sendFrame('{"type":"ping"}')).toBe(true)
    expect(fake.sent).toEqual(['{"type":"ping"}'])

    // Account changes to user-b -> all gated methods refuse!
    current = 'user-b'
    expect(client.isConnected()).toBe(false)
    expect(client.hasActiveSelection()).toBe(false)
    expect(client.getSelectedDeviceId()).toBeUndefined()
    expect(client.sendFrame('{"type":"tool_call"}')).toBe(false)
    expect(fake.sent).toEqual(['{"type":"ping"}'])

    // Signed out -> all gated methods refuse!
    current = null
    expect(client.isConnected()).toBe(false)
    expect(client.hasActiveSelection()).toBe(false)
    expect(client.getSelectedDeviceId()).toBeUndefined()
    expect(client.sendFrame('{"type":"tool_call"}')).toBe(false)
  })

  test('closeForOtherAccount emits chrome_bridge_identity_mismatch and cleans up; ensureConnected respects signed_out & other', async () => {
    let current: string | null = null
    const { context, events } = makeContext({
      getCurrentUserId: () => current,
    })
    const client = new BridgeClient(context)

    // signed_out prevents connecting immediately.
    expect(await client.ensureConnected()).toBe(false)

    // Connected as user-a, now signed in as user-b.
    const fake = makeFakeWs()
    attachConnectedSocket(client, fake.ws, 'user-a', 'dev-1')
    current = 'user-b'

    client.closeForOtherAccount('use')
    expect(fake.closed).toBe(true)
    expect(client.connectedUserId()).toBeUndefined()
    expect(events).toContainEqual({
      name: 'chrome_bridge_identity_mismatch',
      meta: { phase: 'use' },
    })

    // refusedForIdentity tracks connect-phase mismatch.
    expect(client.refusedForIdentity('user-a')).toBe(true)
    expect(events).toContainEqual({
      name: 'chrome_bridge_identity_mismatch',
      meta: { phase: 'connect' },
    })
    client.disconnect()
  })

  test('Wave 3D: types.ts directly exports ChromeBridgeIdentityMismatchMetadata and context identity hooks', () => {
    const connectMeta: ChromeBridgeIdentityMismatchMetadata = {
      phase: 'connect',
    }
    const useMeta: ChromeBridgeIdentityMismatchMetadata = { phase: 'use' }
    const unionMeta: ChromeBridgeTrackEventMetadata = connectMeta
    expect(unionMeta).toEqual({ phase: 'connect' })
    expect(useMeta).toEqual({ phase: 'use' })

    const { context } = makeContext({
      getCurrentUserId: () => 'user-x',
      isAccountMismatchEnforced: () => true,
    })
    expect(context.getCurrentUserId?.()).toBe('user-x')
    expect(context.isAccountMismatchEnforced?.()).toBe(true)
  })
})
