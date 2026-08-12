import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

// Mock dgram before importing LanBeacon
const mockSocket = {
  on: mock(() => mockSocket),
  bind: mock((port: number, cb: () => void) => cb()),
  addMembership: mock(() => {}),
  setMulticastInterface: mock(() => {}),
  setMulticastTTL: mock(() => {}),
  setBroadcast: mock(() => {}),
  dropMembership: mock(() => {}),
  send: mock(() => {}),
  close: mock(() => {}),
}

// Spread+flag pattern: previously this was a bare `mock.module('dgram', ...)`
// which leaked the stub createSocket into every later test file in the
// process via Bun's last-write-wins module mock cache. Spread real dgram
// + gate the stub behind useLanBeaconDgramStubs so other tests see real UDP.
let useLanBeaconDgramStubs = false
mock.module('dgram', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require('dgram') as Record<string, unknown>
  return {
    ...real,
    default: real,
    createSocket: ((...args: unknown[]) =>
      useLanBeaconDgramStubs
        ? mockSocket
        : (real.createSocket as (...a: unknown[]) => unknown)(
            ...args,
          )) as typeof real.createSocket,
  }
})

beforeAll(() => {
  useLanBeaconDgramStubs = true
})
afterAll(() => {
  useLanBeaconDgramStubs = false
})

const { LanBeacon, normalizeLanHost, resolveLanPeerAuthToken } = await import(
  '../lanBeacon.js'
)

type MockCall = [string, ...unknown[]]

function getMessageHandler():
  | ((msg: Buffer, rinfo: { address: string; port: number }) => void)
  | undefined {
  const calls = mockSocket.on.mock.calls as unknown as MockCall[]
  const call = calls.find(c => c[0] === 'message')
  return call?.[1] as
    | ((msg: Buffer, rinfo: { address: string; port: number }) => void)
    | undefined
}

describe('LanBeacon', () => {
  let beacon: InstanceType<typeof LanBeacon>

  const announceData = {
    pipeName: 'cli-test1234',
    machineId: 'machine-abc',
    hostname: 'test-host',
    ip: '192.168.1.10',
    tcpPort: 7100,
    role: 'main' as const,
  }

  beforeEach(() => {
    mockSocket.on.mockClear()
    mockSocket.bind.mockClear()
    mockSocket.send.mockClear()
    mockSocket.close.mockClear()
    mockSocket.addMembership.mockClear()
    mockSocket.dropMembership.mockClear()
    beacon = new LanBeacon(announceData)
  })

  afterEach(() => {
    beacon.stop()
  })

  test('start initializes socket and sends first announce', () => {
    beacon.start()
    expect(mockSocket.bind).toHaveBeenCalledTimes(1)
    expect(mockSocket.addMembership).toHaveBeenCalledWith(
      '224.0.71.67',
      '192.168.1.10',
    )
    expect(mockSocket.setMulticastTTL).toHaveBeenCalledWith(1)
    // First announce sent immediately
    expect(mockSocket.send).toHaveBeenCalled()
  })

  test('getPeers returns empty map initially', () => {
    beacon.start()
    expect(beacon.getPeers().size).toBe(0)
  })

  test('stop closes socket and clears peers', () => {
    beacon.start()
    beacon.stop()
    expect(mockSocket.close).toHaveBeenCalled()
  })

  test('processes incoming announce from different peer', () => {
    beacon.start()

    const messageHandler = getMessageHandler()
    if (!messageHandler) return

    const peerAnnounce = JSON.stringify({
      proto: 'claude-pipe-v1',
      pipeName: 'cli-peer5678',
      machineId: 'machine-xyz',
      hostname: 'peer-host',
      ip: '192.168.1.20',
      tcpPort: 7102,
      role: 'sub',
      ts: Date.now(),
    })

    let discoveredPeer: any = null
    beacon.on('peer-discovered', (peer: any) => {
      discoveredPeer = peer
    })

    messageHandler(Buffer.from(peerAnnounce), {
      address: '192.168.1.20',
      port: 7101,
    })

    expect(beacon.getPeers().size).toBe(1)
    expect(beacon.getPeers().has('cli-peer5678')).toBe(true)
    expect(discoveredPeer).not.toBeNull()
    expect(discoveredPeer.pipeName).toBe('cli-peer5678')
  })

  test('ignores self-announces', () => {
    beacon.start()

    const messageHandler = getMessageHandler()
    if (!messageHandler) return

    const selfAnnounce = JSON.stringify({
      proto: 'claude-pipe-v1',
      pipeName: 'cli-test1234', // same as our pipeName
      machineId: 'machine-abc',
      hostname: 'test-host',
      ip: '192.168.1.10',
      tcpPort: 7100,
      role: 'main',
      ts: Date.now(),
    })

    messageHandler(Buffer.from(selfAnnounce), {
      address: '192.168.1.10',
      port: 7101,
    })
    expect(beacon.getPeers().size).toBe(0)
  })

  test('ignores non-claude-pipe protocol messages', () => {
    beacon.start()

    const messageHandler = getMessageHandler()
    if (!messageHandler) return

    const foreignMessage = JSON.stringify({
      proto: 'something-else',
      pipeName: 'cli-foreign',
    })

    messageHandler(Buffer.from(foreignMessage), {
      address: '192.168.1.30',
      port: 7101,
    })
    expect(beacon.getPeers().size).toBe(0)
  })

  test('updateAnnounce changes role', () => {
    beacon.updateAnnounce({ role: 'sub' })
    beacon.start()
    // The send call should include the updated role
    const sendCalls = mockSocket.send.mock.calls as unknown as [
      Buffer,
      ...unknown[],
    ][]
    const sendCall = sendCalls[0]
    if (sendCall) {
      const payload = JSON.parse(sendCall[0].toString())
      expect(payload.role).toBe('sub')
    }
  })
})

describe('normalizeLanHost / resolveLanPeerAuthToken', () => {
  const peer = {
    proto: 'claude-pipe-v1' as const,
    pipeName: 'cli-lan-peer',
    machineId: 'm1',
    hostname: 'vmwin11',
    ip: '192.168.50.27',
    tcpPort: 58853,
    role: 'main' as const,
    ts: Date.now(),
    authToken: 'secret-token-xyz',
  }

  test('normalizeLanHost maps loopback aliases', () => {
    expect(normalizeLanHost('localhost')).toBe('127.0.0.1')
    expect(normalizeLanHost('LOCALHOST')).toBe('127.0.0.1')
    expect(normalizeLanHost('::1')).toBe('127.0.0.1')
    expect(normalizeLanHost('[::1]')).toBe('127.0.0.1')
    expect(normalizeLanHost('192.168.1.10')).toBe('192.168.1.10')
  })

  test('resolve by exact pipeName prefers name over host', () => {
    const other = {
      ...peer,
      pipeName: 'cli-other',
      ip: '10.0.0.1',
      authToken: 'other-token',
    }
    expect(
      resolveLanPeerAuthToken([peer, other], {
        host: '10.0.0.1',
        port: 58853,
        pipeName: 'cli-lan-peer',
      }),
    ).toBe('secret-token-xyz')
  })

  test('resolve by host:port with hostname field', () => {
    expect(
      resolveLanPeerAuthToken([peer], {
        host: 'vmwin11',
        port: 58853,
      }),
    ).toBe('secret-token-xyz')
  })

  test('resolve localhost against 127.0.0.1 peer', () => {
    const local = {
      ...peer,
      ip: '127.0.0.1',
      hostname: 'localhost',
      authToken: 'local-tok',
    }
    expect(
      resolveLanPeerAuthToken([local], {
        host: 'localhost',
        port: 58853,
      }),
    ).toBe('local-tok')
  })

  test('missing token or port mismatch → undefined', () => {
    expect(
      resolveLanPeerAuthToken([{ ...peer, authToken: undefined }], {
        host: peer.ip,
        port: peer.tcpPort,
      }),
    ).toBeUndefined()
    expect(
      resolveLanPeerAuthToken([peer], {
        host: peer.ip,
        port: 1,
      }),
    ).toBeUndefined()
  })
})
