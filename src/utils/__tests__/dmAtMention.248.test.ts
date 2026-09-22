/**
 * densable 2.1.248 #36 — @mention IME / NFKC fold (official bP + Bn=dr).
 *
 * GOLD: official-248 claude.exe
 *   bP @202917073  /(^|[\s\u3002\u3001\uFF1F\uFF01])@([\p{L}\p{N}\p{M}\u200C\u200D_-]*)$/u
 *   caller @202924106  Bn=dr(jn[2]??"")
 *   teammates/agents  dr(name).startsWith(Bn)
 *   Ejn @186136100  p=dr(u.name); p.startsWith(t)  (t already folded)
 * Unique vs 247 xD: `[\w-]*` + toLowerCase (no dr, no \p{L}).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DM_AT_MENTION_RE,
  foldDmAtMentionQuery,
  mentionNameMatchesFoldedQuery,
} from '../dmAtMention.js'
import {
  buildPeerMentionPool,
  buildPeerMentionTypeahead,
  isValidPeerMentionName,
} from '../peerAtMention.js'
import { normalizeSessionNameKey } from '../sessionNameUniqueness.js'

const typeaheadSrc = readFileSync(
  join(import.meta.dir, '../../hooks/useTypeahead.tsx'),
  'utf8',
)

describe('densable 2.1.248 #36 bP + dr mention fold', () => {
  test('bP captures CJK / combining marks / ZWJ (247 [w-] did not)', () => {
    expect(foldDmAtMentionQuery('@会话')).toBe(normalizeSessionNameKey('会话'))
    expect(foldDmAtMentionQuery('@cafe\u0301')).toBe(
      normalizeSessionNameKey('cafe\u0301'),
    )
    expect(foldDmAtMentionQuery('@name\u200Dmore')).toBe(
      normalizeSessionNameKey('namemore'),
    )
    expect('@会话'.match(/[\w-]*$/)?.[0]).toBe('')
  })

  test('bP CJK punct boundary (。、？！) opens @', () => {
    expect(foldDmAtMentionQuery('你好。@名字')).toBe(
      normalizeSessionNameKey('名字'),
    )
    expect(foldDmAtMentionQuery('、@abc')).toBe('abc')
    expect(foldDmAtMentionQuery('email@x')).toBe(null)
  })

  test('NFKC query fold: fullwidth Latin + compatibility', () => {
    expect(foldDmAtMentionQuery('@ＡＢＣ')).toBe('abc')
    expect(foldDmAtMentionQuery('@①')).toBe(normalizeSessionNameKey('①'))
  })

  test('dr(name).startsWith(Bn): CJK / NFD / fullwidth', () => {
    const cjk = foldDmAtMentionQuery('@会')
    expect(cjk).not.toBeNull()
    expect(mentionNameMatchesFoldedQuery('会话名', cjk!)).toBe(true)
    expect(mentionNameMatchesFoldedQuery('其他', cjk!)).toBe(false)

    const nfd = foldDmAtMentionQuery('@cafe\u0301')
    expect(nfd).not.toBeNull()
    expect(mentionNameMatchesFoldedQuery('Café', nfd!)).toBe(true)
    expect(mentionNameMatchesFoldedQuery('Café extra', nfd!)).toBe(true)

    const fw = foldDmAtMentionQuery('@Ａｂ')
    expect(fw).not.toBeNull()
    expect(mentionNameMatchesFoldedQuery('Abc-session', fw!)).toBe(true)
  })

  test('Ejn leftover: buildPeerMentionTypeahead folds name (CJK / NFKC)', () => {
    const pool = buildPeerMentionPool({
      peerCandidates: [
        {
          name: '会话名',
          key: '会话名',
          kind: 'session',
          id: '/tmp/cjk.sock',
          address: 'uds:/tmp/cjk.sock',
          ref: 'aabbcc',
        },
        {
          name: 'Café Work',
          key: 'Café Work',
          kind: 'session',
          id: '/tmp/cafe.sock',
          address: 'uds:/tmp/cafe.sock',
          ref: 'ddeeff',
        },
      ],
    })
    expect(isValidPeerMentionName('会话名')).toBe(true)
    const cjkRows = buildPeerMentionTypeahead(pool, '会')
    expect(cjkRows.map(r => r.displayText)).toContain('@"会话名"')
    const nfkcRows = buildPeerMentionTypeahead(pool, 'cafe\u0301')
    expect(nfkcRows.some(r => r.displayText.includes('Café'))).toBe(true)
  })

  test('useTypeahead HOST wires bP + normalizeSessionNameKey (not toLowerCase)', () => {
    expect(typeaheadSrc).toContain('DM_AT_MENTION_RE')
    expect(typeaheadSrc).toContain('normalizeSessionNameKey(atMatch[2]')
    expect(typeaheadSrc).toContain('mentionNameMatchesFoldedQuery')
    expect(typeaheadSrc).not.toContain('.toLowerCase().startsWith(partialName)')
    expect(typeaheadSrc).not.toContain('/(^|\\s)@([\\w-]*)$/')
    expect(DM_AT_MENTION_RE.flags).toContain('u')
  })
})
