/**
 * densable 2.1.232 #2 — peer @mention pure core (spv / p4p / f4p / d4p / l4p).
 */
import { describe, expect, test } from 'bun:test'
import {
  PEER_AT_MENTION_RE,
  PEER_MENTION_ASK_CANDIDATES,
  PEER_MENTION_BARE_MAX,
  PEER_MENTION_QUOTED_MAX,
  PEER_MENTION_TYPEAHEAD_CAP,
  buildPeerMentionPool,
  buildPeerMentionTypeahead,
  formatPeerMentionDisplay,
  isValidPeerMentionName,
  parsePeerMentions,
  resolvePeerMentions,
  type PeerMentionCandidate,
  type PeerMentionPool,
} from '../peerAtMention.js'

function cand(
  partial: Partial<PeerMentionCandidate> &
    Pick<PeerMentionCandidate, 'name' | 'id' | 'ref'>,
): PeerMentionCandidate {
  return {
    kind: 'session',
    where: 'this-machine',
    token: partial.name,
    address: `uds:${partial.id}`,
    ...partial,
  }
}

describe('peerAtMention densable 2.1.232 #2', () => {
  test('constants match densable tpv/rpv/epv/Qdv', () => {
    expect(PEER_MENTION_BARE_MAX).toBe(128)
    expect(PEER_MENTION_QUOTED_MAX).toBe(200)
    expect(PEER_MENTION_ASK_CANDIDATES).toBe(3)
    expect(PEER_MENTION_TYPEAHEAD_CAP).toBe(20)
  })

  test('spv / p4p: bare, quoted, and optional [ref]', () => {
    expect(parsePeerMentions('hey @alice check this')).toEqual([
      { name: 'alice' },
    ])
    expect(parsePeerMentions('ping @"my session" please')).toEqual([
      { name: 'my session' },
    ])
    expect(parsePeerMentions('@bob [a1b2c3] go')).toEqual([
      { name: 'bob', ref: 'a1b2c3' },
    ])
    // bare dropped when same name has ref
    expect(parsePeerMentions('@bob and @bob [deadbeef]')).toEqual([
      { name: 'bob', ref: 'deadbeef' },
    ])
    // densable spv leading boundary is ^|[\s。、？！] only — CJK letters do not open
    expect(parsePeerMentions('你好@carol。')).toEqual([])
    // space or CJK punct before @ does open; trailing 。 is a valid bare trail
    expect(parsePeerMentions('你好 @carol。')).toEqual([{ name: 'carol' }])
    expect(parsePeerMentions('。@carol')).toEqual([{ name: 'carol' }])
  })

  test('spv does not match agent-style or mid-word @', () => {
    expect(parsePeerMentions('email@example.com')).toEqual([])
    expect(parsePeerMentions('@agent-foo')).toEqual([]) // agent- prefix rejected by l4p
    expect(isValidPeerMentionName('agent-foo')).toBe(false)
    expect(isValidPeerMentionName('code-reviewer (agent)')).toBe(false)
  })

  test('l4p rejects quotes, angles, newlines, ref shape', () => {
    expect(isValidPeerMentionName('ok-name')).toBe(true)
    expect(isValidPeerMentionName('has"quote')).toBe(false)
    expect(isValidPeerMentionName('a<b')).toBe(false)
    expect(isValidPeerMentionName('x\ny')).toBe(false)
    expect(isValidPeerMentionName('[abc123]')).toBe(false)
  })

  test('u4p display: bare vs quoted', () => {
    expect(formatPeerMentionDisplay('alice')).toBe('@alice')
    expect(formatPeerMentionDisplay('my session')).toBe('@"my session"')
  })

  test('f4p unique bare → resolved; multi → ask', () => {
    const pool: PeerMentionPool = {
      candidates: [
        cand({ name: 'alice', id: '/tmp/a.sock', ref: 'aaaaaa' }),
        cand({ name: 'bob', id: '/tmp/b1.sock', ref: 'bbbbb1' }),
        cand({ name: 'bob', id: '/tmp/b2.sock', ref: 'bbbbb2' }),
      ],
      inProcess: new Set(),
      defaultNamed: new Set(),
    }
    const decisions = resolvePeerMentions(
      [{ name: 'alice' }, { name: 'bob' }],
      pool,
    )
    expect(decisions).toHaveLength(2)
    expect(decisions[0]).toMatchObject({
      kind: 'resolved',
      mention: '@alice',
    })
    expect(decisions[1]).toMatchObject({
      kind: 'ask',
      mention: '@bob',
      total: 2,
    })
    expect(
      decisions[1]!.kind === 'ask' && decisions[1].candidates,
    ).toHaveLength(2)
  })

  test('f4p ref exact hit / miss', () => {
    const pool: PeerMentionPool = {
      candidates: [cand({ name: 'alice', id: '/tmp/a.sock', ref: 'deadbe' })],
      inProcess: new Set(),
      defaultNamed: new Set(),
    }
    const hit = resolvePeerMentions([{ name: 'alice', ref: 'deadbe' }], pool)
    expect(hit).toEqual([
      {
        kind: 'resolved',
        mention: '@alice [deadbe]',
        candidate: { token: 'alice', where: 'this machine' },
      },
    ])
    const miss = resolvePeerMentions([{ name: 'alice', ref: 'ffffff' }], pool)
    expect(miss).toEqual([])
  })

  test('f4p skips inProcess names', () => {
    const pool: PeerMentionPool = {
      candidates: [cand({ name: 'self', id: '/tmp/s.sock', ref: 'ssssss' })],
      inProcess: new Set(['self']),
      defaultNamed: new Set(),
    }
    expect(resolvePeerMentions([{ name: 'self' }], pool)).toEqual([])
  })

  test('d4p typeahead id shape dm-peer-kind-ref-name', () => {
    const pool = buildPeerMentionPool({
      peerCandidates: [
        {
          name: 'worker',
          key: 'worker',
          kind: 'session',
          id: '/tmp/w.sock',
          address: 'uds:/tmp/w.sock',
          ref: 'abcdef',
        },
      ],
    })
    const rows = buildPeerMentionTypeahead(pool, 'wor')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('dm-peer-session-abcdef-worker')
    expect(rows[0]!.displayText).toBe('@worker')
    expect(rows[0]!.description).toContain('message session')
    expect(rows[0]!.description).toContain('this machine')
  })

  test('d4p empty prefix yields no rows', () => {
    const pool: PeerMentionPool = {
      candidates: [cand({ name: 'a', id: 'x', ref: '111111' })],
      inProcess: new Set(),
      defaultNamed: new Set(),
    }
    expect(buildPeerMentionTypeahead(pool, '')).toEqual([])
  })

  test('source locks: PEER_AT_MENTION_RE and peer_mention strings in tree', async () => {
    const src = await Bun.file(
      new URL('../peerAtMention.ts', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
    )
      .text()
      .catch(async () => {
        // windows path from file URL
        const { readFileSync } = await import('fs')
        const { join } = await import('path')
        return readFileSync(
          join(import.meta.dir, '../peerAtMention.ts'),
          'utf8',
        )
      })
    expect(src).toContain('PEER_AT_MENTION_RE')
    expect(src).toContain('dm-peer-')
    expect(src).toContain('tengu_at_mention_peer_')
    expect(PEER_AT_MENTION_RE.flags).toContain('g')
    expect(PEER_AT_MENTION_RE.flags).toContain('u')
  })
})
