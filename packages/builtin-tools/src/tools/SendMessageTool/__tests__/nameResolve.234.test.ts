/**
 * densable 2.1.234 #34 — searchTruncated plumbing through resolvePeerByName.
 */
import { describe, expect, test } from 'bun:test'
import { SESSION_LIST_SEARCH_TRUNCATED_BODY } from 'src/utils/sessionListIncompleteCopy.js'
import {
  buildPeerCandidates,
  formatAmbiguousMessage,
  resolvePeerByName,
  type PeerCandidate,
} from '../nameResolve.js'

function cand(
  partial: Omit<PeerCandidate, 'ref' | 'key'> & { key?: string; ref?: string },
): PeerCandidate {
  return {
    key: partial.key ?? partial.name.toLowerCase(),
    ref: partial.ref ?? 'abcdef',
    name: partial.name,
    kind: partial.kind,
    id: partial.id,
    address: partial.address,
    bridgeSessionId: partial.bridgeSessionId,
  }
}

describe('densable 2.1.234 #34 SendMessage searchTruncated', () => {
  test('resolvePeerByName propagates searchTruncated on ok / not-found / ambiguous', () => {
    const a = cand({
      name: 'worker',
      kind: 'session',
      id: '/tmp/a.sock',
      address: 'uds:/tmp/a.sock',
      ref: 'aaaaaa',
    })
    const b = cand({
      name: 'worker',
      kind: 'session',
      id: '/tmp/b.sock',
      address: 'uds:/tmp/b.sock',
      ref: 'bbbbbb',
    })

    const ok = resolvePeerByName({
      to: 'solo',
      pins: {},
      candidates: [
        cand({
          name: 'solo',
          kind: 'session',
          id: '/tmp/s.sock',
          address: 'uds:/tmp/s.sock',
        }),
      ],
      localClaimed: new Set(),
      searchTruncated: true,
    })
    expect(ok.kind).toBe('ok')
    if (ok.kind === 'ok') expect(ok.searchTruncated).toBe(true)

    const missing = resolvePeerByName({
      to: 'ghost',
      pins: {},
      candidates: [a],
      localClaimed: new Set(),
      searchTruncated: true,
    })
    expect(missing.kind).toBe('not-found')
    if (missing.kind === 'not-found') expect(missing.searchTruncated).toBe(true)

    const amb = resolvePeerByName({
      to: 'worker',
      pins: {},
      candidates: [a, b],
      localClaimed: new Set(),
      searchTruncated: true,
    })
    expect(amb.kind).toBe('ambiguous')
    if (amb.kind === 'ambiguous') expect(amb.searchTruncated).toBe(true)
  })

  test('formatAmbiguousMessage appends wWr when searchTruncated', () => {
    const msg = formatAmbiguousMessage(
      'worker',
      [
        cand({
          name: 'worker',
          kind: 'session',
          id: '/tmp/a.sock',
          address: 'uds:/tmp/a.sock',
          ref: 'aaaaaa',
        }),
        cand({
          name: 'worker',
          kind: 'session',
          id: '/tmp/b.sock',
          address: 'uds:/tmp/b.sock',
          ref: 'bbbbbb',
        }),
      ],
      { searchTruncated: true },
    )
    expect(msg).toContain(SESSION_LIST_SEARCH_TRUNCATED_BODY.trim())
  })

  test('buildPeerCandidates includes account bridge rows with dedupe', () => {
    const cands = buildPeerCandidates({
      udsPeers: [
        {
          name: 'local',
          messagingSocketPath: '/tmp/local.sock',
          bridgeSessionId: 'session_mirrored',
        },
      ],
      bridgePeers: [{ address: 'bridge:session_localreg', name: 'local-reg' }],
      accountBridgePeers: [
        { id: 'session_mirrored', title: 'should-skip-mirror' },
        { id: 'session_localreg', title: 'should-skip-localreg' },
        { id: 'session_remote', title: 'Remote Worker' },
      ],
    })
    const addresses = cands.map(c => c.address)
    expect(addresses).toContain('uds:/tmp/local.sock')
    expect(addresses).toContain('bridge:session_localreg')
    expect(addresses).toContain('bridge:session_remote')
    expect(addresses.filter(a => a.includes('mirrored'))).toHaveLength(0)
    expect(cands.filter(c => c.name === 'Remote Worker')).toHaveLength(1)
  })
})
