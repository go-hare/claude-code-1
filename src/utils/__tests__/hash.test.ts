import { createHash } from 'crypto'
import { describe, expect, test } from 'bun:test'
import {
  djb2Hash,
  errorAnalyticsFromThrown,
  errorConstructorForAnalytics,
  hashContent,
  hashErrorMessageForAnalytics,
  hashPair,
  nodeErrnoCodeForAnalytics,
  redactForErrorMessageHash,
  sampleToolMemoryUsage,
  shortSha256Hex12,
  stackFramesForAnalytics,
  toolMemoryDeltasForAnalytics,
  uniqueJoin,
} from '../hash'

describe('djb2Hash', () => {
  test('returns a number', () => {
    expect(typeof djb2Hash('hello')).toBe('number')
  })

  test('returns 0 for empty string', () => {
    expect(djb2Hash('')).toBe(0)
  })

  test('is deterministic', () => {
    expect(djb2Hash('test')).toBe(djb2Hash('test'))
  })

  test('different strings produce different hashes', () => {
    expect(djb2Hash('abc')).not.toBe(djb2Hash('def'))
  })

  test('returns 32-bit integer', () => {
    const hash = djb2Hash('some long string to hash')
    expect(Number.isSafeInteger(hash)).toBe(true)
  })

  test("has known answer for 'hello'", () => {
    expect(djb2Hash('hello')).toBe(99162322)
  })
})

describe('hashContent', () => {
  test('returns a string', () => {
    expect(typeof hashContent('hello')).toBe('string')
  })

  test('is deterministic', () => {
    expect(hashContent('test')).toBe(hashContent('test'))
  })

  test('different strings produce different hashes', () => {
    expect(hashContent('abc')).not.toBe(hashContent('def'))
  })

  test('returns numeric string for empty string', () => {
    expect(hashContent('')).toMatch(/^\d+$/)
  })

  test('returns numeric string format', () => {
    expect(hashContent('hello')).toMatch(/^\d+$/)
  })
})

describe('hashPair', () => {
  test('returns a string', () => {
    expect(typeof hashPair('a', 'b')).toBe('string')
  })

  test('is deterministic', () => {
    expect(hashPair('a', 'b')).toBe(hashPair('a', 'b'))
  })

  test('order matters', () => {
    expect(hashPair('a', 'b')).not.toBe(hashPair('b', 'a'))
  })

  test('disambiguates different splits', () => {
    expect(hashPair('ts', 'code')).not.toBe(hashPair('tsc', 'ode'))
  })

  test('handles empty strings', () => {
    expect(hashPair('', '')).toMatch(/^\d+$/)
    expect(hashPair('', 'a')).toMatch(/^\d+$/)
    expect(hashPair('a', '')).toMatch(/^\d+$/)
    expect(hashPair('', 'a')).not.toBe(hashPair('a', ''))
  })
})

describe('shortSha256Hex12 densable bu', () => {
  test('returns 12-char lowercase hex', () => {
    const h = shortSha256Hex12('hello')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(h).toBe(
      createHash('sha256').update('hello').digest('hex').slice(0, 12),
    )
  })

  test('is deterministic and content-sensitive', () => {
    expect(shortSha256Hex12('a')).toBe(shortSha256Hex12('a'))
    expect(shortSha256Hex12('a')).not.toBe(shortSha256Hex12('b'))
  })
})

describe('uniqueJoin densable Ho', () => {
  test('dedupes preserving first-seen order', () => {
    expect(uniqueJoin(['invalid_type', 'too_small', 'invalid_type'])).toBe(
      'invalid_type,too_small',
    )
  })

  test('empty → empty string', () => {
    expect(uniqueJoin([])).toBe('')
  })
})

describe('hashErrorMessageForAnalytics densable PC/y2r/bu', () => {
  test('redacts url/email/path before hash', () => {
    const raw =
      'failed https://example.com/x user@x.com /Users/alice/secret/file.ts'
    const redacted = redactForErrorMessageHash(raw)
    expect(redacted).toContain('<url>')
    expect(redacted).toContain('<email>')
    expect(redacted).toContain('<path>')
    expect(redacted).not.toContain('example.com')
    expect(redacted).not.toContain('alice')
  })

  test('hash is 12 hex of redacted text', () => {
    const msg = 'path /tmp/foo/bar missing'
    const h = hashErrorMessageForAnalytics(msg)
    expect(h).toBe(shortSha256Hex12(redactForErrorMessageHash(msg)))
    expect(h).toMatch(/^[0-9a-f]{12}$/)
  })

  test('long hex → <id>; b64 and ipv4 densable y2r', () => {
    const hex = 'a'.repeat(16)
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' // 32 b64 chars
    const raw = `token ${hex} blob ${b64}== host 10.0.0.1 port 12345`
    const redacted = redactForErrorMessageHash(raw)
    expect(redacted).toContain('<id>')
    expect(redacted).not.toContain('<hex>')
    expect(redacted).not.toContain(hex)
    expect(redacted).toContain('<b64>')
    expect(redacted).not.toContain(b64)
    expect(redacted).toContain('<ip>')
    expect(redacted).not.toContain('10.0.0.1')
    expect(redacted).toContain('<num>')
  })
})

describe('errorAnalyticsFromThrown densable PC', () => {
  test('plain Error → hash + constructor, no errno', () => {
    const err = new Error('boom /Users/alice/x')
    const r = errorAnalyticsFromThrown(err)
    expect(r.error_message_hash).toBe(
      shortSha256Hex12(redactForErrorMessageHash('boom /Users/alice/x')),
    )
    expect(r.error_constructor).toBe('Error')
    expect(r.error_code).toBeUndefined()
  })

  test('ENOENT-like object → error_code densable _p', () => {
    const err = Object.assign(new Error('no file'), { code: 'ENOENT' })
    const r = errorAnalyticsFromThrown(err)
    expect(r.error_code).toBe('ENOENT')
    expect(nodeErrnoCodeForAnalytics(err)).toBe('ENOENT')
    expect(nodeErrnoCodeForAnalytics({ code: 'not-upper' })).toBeUndefined()
  })

  test('non-Error scalar → hash only', () => {
    const r = errorAnalyticsFromThrown('plain string fail')
    expect(r.error_message_hash).toMatch(/^[0-9a-f]{12}$/)
    expect(r.error_constructor).toBeUndefined()
  })

  test('constructor filter densable K_t', () => {
    expect(errorConstructorForAnalytics(new TypeError('x'))).toBe('TypeError')
    expect(errorConstructorForAnalytics('x')).toBeUndefined()
  })

  test('stack frame extract densable O2h', () => {
    const stack =
      'Error: x\n' +
      '    at foo (hash.ts:10:5)\n' +
      '    at bar (other.ts:2:1)\n' +
      '    at /abs/path/file.js:1:1\n'
    const { names, topFrame } = stackFramesForAnalytics(stack)
    expect(names).toEqual(['foo', 'bar'])
    expect(topFrame).toBe('hash.ts:10:5')
  })
})

describe('toolMemoryDeltasForAnalytics densable G/Z', () => {
  test('sample has rss/heap/external numbers', () => {
    const s = sampleToolMemoryUsage()
    expect(typeof s.rss).toBe('number')
    expect(typeof s.heapUsed).toBe('number')
    expect(typeof s.external).toBe('number')
  })

  test('deltas subtract before from after', () => {
    const d = toolMemoryDeltasForAnalytics(
      { rss: 100, heapUsed: 50, external: 10 },
      { rss: 130, heapUsed: 40, external: 12 },
    )
    expect(d).toEqual({
      rssDeltaBytes: 30,
      heapUsedDeltaBytes: -10,
      externalDeltaBytes: 2,
    })
  })
})
