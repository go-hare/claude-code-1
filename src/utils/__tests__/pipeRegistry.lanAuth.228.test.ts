import { describe, expect, test } from 'bun:test'
import type { LanAnnounce } from '../lanBeacon.js'
import { mergeWithLanPeers, type PipeRegistry } from '../pipeRegistry.js'

describe('mergeWithLanPeers authToken', () => {
  test('preserves beacon authToken on LAN entries', () => {
    const registry: PipeRegistry = {
      version: 1,
      mainMachineId: null,
      main: null,
      subs: [],
    }
    const peers = new Map<string, LanAnnounce>([
      [
        'peer-a',
        {
          proto: 'claude-pipe-v1',
          pipeName: 'peer-a',
          machineId: 'm1',
          hostname: 'host',
          ip: '192.168.1.10',
          tcpPort: 12345,
          role: 'main',
          ts: Date.now(),
          authToken: 'secret-token-abc',
        },
      ],
    ])
    const merged = mergeWithLanPeers(registry, peers)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.source).toBe('lan')
    expect(merged[0]!.authToken).toBe('secret-token-abc')
    expect(merged[0]!.tcpEndpoint).toEqual({
      host: '192.168.1.10',
      port: 12345,
    })
  })
})
