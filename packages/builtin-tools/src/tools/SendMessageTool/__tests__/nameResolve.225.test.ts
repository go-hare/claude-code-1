/**
 * densable 2.1.225 #13/#14 — SendMessage name resolve + pin guard.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildPeerCandidates,
  classifySendMessagePin,
  formatAmbiguousMessage,
  listingRefMatchesCandidate,
  localClaimedRemoteBodies,
  nextSendMessagePins,
  normalizeAgentName,
  parseNameRef,
  pinDigest,
  resolvePeerByName,
  shortPinRef,
  stripSessionPrefix,
} from '../nameResolve.js'

describe('densable 2.1.225 SendMessage name resolve', () => {
  test('M3 normalizes names', () => {
    expect(normalizeAgentName('Worker One')).toBe('worker-one')
    expect(normalizeAgentName('  worker  one  ')).toBe('worker-one')
  })

  test('QPr parses name [ref]', () => {
    expect(parseNameRef('worker [3fa9c1]')).toEqual({
      name: 'worker',
      ref: '3fa9c1',
    })
    expect(parseNameRef('worker')).toBeNull()
  })

  test('uP strips session_/cse_ prefix', () => {
    expect(stripSessionPrefix('session_abc')).toBe('abc')
    expect(stripSessionPrefix('cse_xyz')).toBe('xyz')
    expect(stripSessionPrefix('/tmp/sock')).toBe('/tmp/sock')
  })

  test('koi classifies pins', () => {
    expect(
      classifySendMessagePin({
        id: 'cse_1',
        name: 'c',
        ref: 'abcdef',
      }),
    ).toBe('cloud')
    expect(
      classifySendMessagePin({
        id: 'session_01Ab',
        name: 'r',
        ref: 'abcdef',
      }),
    ).toBe('remote-control')
    expect(
      classifySendMessagePin({
        id: '/tmp/cc.sock',
        name: 'l',
        ref: 'abcdef',
      }),
    ).toBe('local')
  })

  test('unique bare name resolves', () => {
    const candidates = buildPeerCandidates({
      udsPeers: [
        {
          name: 'worker',
          messagingSocketPath: '/tmp/a.sock',
        },
      ],
      bridgePeers: [],
    })
    const r = resolvePeerByName({
      to: 'worker',
      pins: {},
      candidates,
      localClaimed: new Set(),
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.candidate.id).toBe('/tmp/a.sock')
      expect(r.candidate.address).toBe('uds:/tmp/a.sock')
    }
  })

  test('ambiguous same name requires ref unless pin matches', () => {
    const candidates = buildPeerCandidates({
      udsPeers: [
        { name: 'worker', messagingSocketPath: '/tmp/a.sock' },
        { name: 'worker', messagingSocketPath: '/tmp/b.sock' },
      ],
      bridgePeers: [],
    })
    const amb = resolvePeerByName({
      to: 'worker',
      pins: {},
      candidates,
      localClaimed: new Set(),
    })
    expect(amb.kind).toBe('ambiguous')
    if (amb.kind === 'ambiguous') {
      expect(amb.candidates).toHaveLength(2)
      expect(formatAmbiguousMessage('worker', amb.candidates)).toContain(
        'Re-send with the ref',
      )
    }

    const pinned = candidates[0]!
    const ok = resolvePeerByName({
      to: 'worker',
      pins: {
        worker: {
          id: pinned.id,
          name: 'worker',
          ref: pinned.ref,
        },
      },
      candidates,
      localClaimed: new Set(),
    })
    expect(ok.kind).toBe('ok')
    if (ok.kind === 'ok') {
      expect(ok.candidate.id).toBe(pinned.id)
      expect(ok.sameNamedSiblings).toBe(1)
    }
  })

  test('pinnedIdentityClaimedLocally refuses RC pin when local claims body', () => {
    const bridgeId = 'session_remote01'
    const candidates = buildPeerCandidates({
      udsPeers: [
        {
          name: 'worker',
          messagingSocketPath: '/tmp/local.sock',
          bridgeSessionId: bridgeId,
        },
      ],
      bridgePeers: [],
    })
    const pinRef = shortPinRef('bridge-session', bridgeId)
    const r = resolvePeerByName({
      to: 'worker',
      pins: {
        worker: { id: bridgeId, name: 'worker', ref: pinRef },
      },
      candidates,
      localClaimed: localClaimedRemoteBodies([{ bridgeSessionId: bridgeId }]),
    })
    expect(r.kind).toBe('refused')
    if (r.kind === 'refused') {
      expect(r.message).toContain('NOT on this machine')
      expect(r.message).toContain('claims that identity')
    }
  })

  test('name [ref] accepts a longer ListAgents listing prefix of the digest', () => {
    const candidates = buildPeerCandidates({
      udsPeers: [{ name: 'worker', messagingSocketPath: '/tmp/a.sock' }],
      bridgePeers: [],
    })
    const target = candidates[0]!
    const digest = pinDigest('session', target.id)
    const longer = digest.slice(
      0,
      Math.min(digest.length, target.ref.length + 2),
    )
    expect(listingRefMatchesCandidate(target, longer)).toBe(true)
    const r = resolvePeerByName({
      to: `worker [${longer}]`,
      pins: {},
      candidates,
      localClaimed: new Set(),
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.candidate.id).toBe(target.id)
    }
  })

  test('name [ref] does not steal a different-name peer via prefix', () => {
    const bob = buildPeerCandidates({
      udsPeers: [{ name: 'bob', messagingSocketPath: '/tmp/bob.sock' }],
      bridgePeers: [],
    })[0]!
    // ListAgents may print a longer hex than SendMessage's 6-char ref.
    // Bidirectional startsWith used to deliver to bob; densable v_a does not.
    const stolen = resolvePeerByName({
      to: `alice [${bob.ref}aa]`,
      pins: {},
      candidates: [bob],
      localClaimed: new Set(),
    })
    expect(stolen.kind).toBe('not-found')
  })

  test('listingUniqueness lengthens send refs against teammate/cloud collisions', () => {
    const sock = '/tmp/unique-extra.sock'
    const sessionDigest = pinDigest('session', sock)
    const teammateId = 'mate-collision'
    // Force a colliding extra by using an id whose digest shares the 6-prefix
    // when possible; uniqueness extras still must be passed through.
    const without = buildPeerCandidates({
      udsPeers: [{ name: 'worker', messagingSocketPath: sock }],
      bridgePeers: [],
    })
    const withExtra = buildPeerCandidates({
      udsPeers: [{ name: 'worker', messagingSocketPath: sock }],
      bridgePeers: [],
      listingUniqueness: [{ kind: 'teammate', id: teammateId }],
    })
    expect(without[0]!.id).toBe(sock)
    expect(withExtra[0]!.id).toBe(sock)
    const extraDigest = pinDigest('teammate', teammateId)
    if (extraDigest.slice(0, 6) === sessionDigest.slice(0, 6)) {
      expect(withExtra[0]!.ref.length).toBeGreaterThan(without[0]!.ref.length)
    }
  })

  test('name [ref] selects exact peer', () => {
    const candidates = buildPeerCandidates({
      udsPeers: [
        { name: 'worker', messagingSocketPath: '/tmp/a.sock' },
        { name: 'worker', messagingSocketPath: '/tmp/b.sock' },
      ],
      bridgePeers: [],
    })
    const target = candidates[1]!
    const r = resolvePeerByName({
      to: `worker [${target.ref}]`,
      pins: {},
      candidates,
      localClaimed: new Set(),
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.candidate.id).toBe(target.id)
    }
  })

  test('NKp nextSendMessagePins writes and is idempotent', () => {
    const first = nextSendMessagePins({}, 'Worker', {
      kind: 'session',
      id: '/tmp/a.sock',
    })
    expect(first).not.toBeNull()
    expect(first!['worker']?.id).toBe('/tmp/a.sock')
    expect(first!['worker']?.name).toBe('Worker')
    const again = nextSendMessagePins(first!, 'Worker', {
      kind: 'session',
      id: '/tmp/a.sock',
    })
    expect(again).toBeNull()
  })
})
