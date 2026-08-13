/**
 * densable 2.1.229 #5 — ListAgents offline / cloud status labels.
 */
import { describe, expect, test } from 'bun:test'
import { __test } from '../ListPeersTool.js'

const { formatPeersListing, resolvePeerStatusLabel } = __test

describe('densable 2.1.229 #5 ListAgents offline/cloud', () => {
  test('Esf: connected===false → offline', () => {
    expect(
      resolvePeerStatusLabel({
        address: 'bridge:abc',
        connected: false,
        transport: 'bridge',
      }),
    ).toBe('offline')
  })

  test('cloud transport → cloud', () => {
    expect(
      resolvePeerStatusLabel({
        address: 'cloud:xyz',
        transport: 'cloud',
        connected: true,
      }),
    ).toBe('cloud')
  })

  test('connected peer has no status tag', () => {
    expect(
      resolvePeerStatusLabel({
        address: 'uds:/tmp/x.sock',
        transport: 'uds',
        connected: true,
      }),
    ).toBeUndefined()
  })

  test('listing appends offline/cloud after name [ref]', () => {
    const listing = formatPeersListing([
      {
        address: 'bridge:dead',
        name: 'laptop',
        connected: false,
        transport: 'bridge',
        cwd: '/tmp',
      },
      {
        address: 'cloud:sess1',
        name: 'remote',
        transport: 'cloud',
      },
      {
        address: 'uds:/tmp/a.sock',
        name: 'local',
        connected: true,
        transport: 'uds',
      },
    ])
    expect(listing).toContain('laptop [bridge:dead] offline @ /tmp')
    expect(listing).toContain('remote [cloud:sess1] cloud')
    expect(listing).toContain('local [uds:/tmp/a.sock]')
    expect(listing).not.toMatch(/local \[uds:\/tmp\/a\.sock\] (offline|cloud)/)
  })
})
