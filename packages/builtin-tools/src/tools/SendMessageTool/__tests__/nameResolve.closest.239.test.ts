/**
 * densable 2.1.239 leftover closest / yRw — nQr + matchedBy prefix, not mutual prefix.
 */
import { describe, expect, test } from 'bun:test'
import {
  closestNormalizedNames,
  damerauLevenshtein,
  leftoverClosestPeers,
  leftoverPrefixPeers,
  resolvePeerByName,
  type PeerCandidate,
} from '../nameResolve.js'

function cand(
  name: string,
  id: string,
  extra?: Partial<PeerCandidate>,
): PeerCandidate {
  return {
    name,
    key: name.toLowerCase(),
    kind: 'session',
    id,
    address: `uds:${id}`,
    ref: extra?.ref ?? 'abcdef',
    ...extra,
  }
}

describe('densable 2.1.239 nQr / yRw leftover closest', () => {
  test('c4t is Damerau–Levenshtein including transposition', () => {
    expect(damerauLevenshtein('abc', 'abc')).toBe(0)
    expect(damerauLevenshtein('abc', 'abx')).toBe(1)
    expect(damerauLevenshtein('abc', 'acb')).toBe(1)
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3)
  })

  test('nQr keeps exact names and drops abs(len) > 2', () => {
    expect(
      closestNormalizedNames('alpha-bot', [
        'alpha-bot',
        'alpha-bot-2',
        'alpin-bot',
      ]),
    ).toEqual(['alpha-bot', 'alpha-bot-2', 'alpin-bot'])
    expect(closestNormalizedNames('alpha', ['alpha-bot'])).toEqual([])
    expect(closestNormalizedNames('worker', ['workr', 'workers'])).toEqual([
      'workr',
      'workers',
    ])
  })

  test('tTl leftoverClosest includes exact-key peers so same-name DEe is live', () => {
    const peers = [
      cand('alpha-bot', '/tmp/same.sock'),
      cand('alpin-bot', '/tmp/near.sock'),
      cand('alpha-bot-2', '/tmp/prefix.sock'),
    ]
    const closest = leftoverClosestPeers('alpha-bot', peers)
    expect(closest.map(c => c.name)).toEqual([
      'alpha-bot',
      'alpin-bot',
      'alpha-bot-2',
    ])
    expect(closest.some(c => c.name === 'alpha-bot')).toBe(true)
  })

  test('yRw prefix is candidate.startsWith(query) when query length >= 3', () => {
    const peers = [
      cand('worker', '/tmp/w.sock'),
      cand('work', '/tmp/short.sock'),
    ]
    expect(leftoverPrefixPeers('wor', peers).map(c => c.name)).toEqual([
      'worker',
      'work',
    ])
    expect(leftoverPrefixPeers('wo', peers)).toEqual([])
    expect(leftoverPrefixPeers('worker [abcdef]', peers)).toEqual([])
  })

  test('resolvePeerByName exact miss with prefix hits is ambiguous prefix', () => {
    const r = resolvePeerByName({
      to: 'wor',
      pins: {},
      candidates: [cand('worker', '/tmp/w.sock')],
      localClaimed: new Set(),
    })
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.matchedBy).toBe('prefix')
      expect(r.total).toBe(1)
      expect(r.candidates[0]?.name).toBe('worker')
    }
  })

  test('resolvePeerByName same-name collision is ambiguous exact', () => {
    const r = resolvePeerByName({
      to: 'worker',
      pins: {},
      candidates: [
        cand('worker', '/tmp/a.sock', { ref: 'aaaaaa' }),
        cand('worker', '/tmp/b.sock', { ref: 'bbbbbb' }),
      ],
      localClaimed: new Set(),
    })
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.matchedBy).toBe('exact')
      expect(r.total).toBe(2)
    }
  })
})
