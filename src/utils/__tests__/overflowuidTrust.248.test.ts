/**
 * densable 2.1.248 #48 — overflowuid / uid_map / canonical-dir trust.
 *
 * GOLD: gold-248-cache-verdict.txt / gold-248-cache-4.txt
 * C()/P() @182940121 · y=65534 @182939595
 * Apply p/d/g + eGn from Linux SEA @198269713 (win32 apply DCE'd).
 * daemon tsn / F1t(e) @183796022 are NOT this bullet.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { A, C, N, P, eGn, p, tGn, v, y } from '../overflowuidTrust.js'
import type { UsernsTrustSnapshot } from '../overflowuidTrust.js'

const src = readFileSync(
  join(import.meta.dir, '../overflowuidTrust.ts'),
  'utf8',
)

const CANONICAL = [
  '/',
  '/dev',
  '/dev/shm',
  '/run',
  '/run/user',
  '/tmp',
  '/var',
  '/var/tmp',
  '/var/run',
  '/home',
  '/var/home',
  '/root',
  '/var/roothome',
  '/mnt',
  '/mnt/wslg',
] as const

const OVERFLOW_SNAP: UsernsTrustSnapshot = {
  unmappedOwnerUid: 65534,
  uidCollapses: false,
  rootUidAmbiguous: false,
}

const AMBIGUOUS_ROOT_SNAP: UsernsTrustSnapshot = {
  unmappedOwnerUid: undefined,
  uidCollapses: false,
  rootUidAmbiguous: true,
}

describe('densable 2.1.248 #48 overflowuid C/P + uid_map', () => {
  test('y is 65534 and C/P gold bodies are in the module', () => {
    expect(y).toBe(65534)
    expect(src).toContain("k('/proc/sys/kernel/overflowuid', 'utf8')")
    expect(src).toContain("k('/proc/self/uid_map', 'utf8')")
    expect(src).toContain('if (!/^\\d+$/.test(n)) return')
    expect(src).toContain('return Number.isSafeInteger(t) ? t : void 0')
    expect(src).toContain('innerStart')
    expect(src).toContain('hostStart')
    expect(src).toContain('count >= 4294967295')
  })

  test('P parses overflowuid text 1:1', () => {
    expect(P('65534')).toBe(65534)
    expect(P(' 65534\n')).toBe(65534)
    expect(P('0')).toBe(0)
    expect(P('00')).toBe(0)
    expect(P('')).toBeUndefined()
    expect(P('foo')).toBeUndefined()
    expect(P('65534.0')).toBeUndefined()
    expect(P('+65534')).toBeUndefined()
    expect(P('-1')).toBeUndefined()
    expect(P('1e2')).toBeUndefined()
    expect(P('65534\n65535')).toBeUndefined()
    expect(P('9007199254740992')).toBeUndefined()
  })

  test('v parses uid_map; invalid line fails the whole map', () => {
    expect(v('')).toEqual([])
    expect(v('\n\n')).toEqual([])
    expect(v('0 100000 1')).toEqual([
      { innerStart: 0, hostStart: 100000, count: 1 },
    ])
    expect(v('0 0 4294967295')).toEqual([
      { innerStart: 0, hostStart: 0, count: 4294967295 },
    ])
    expect(v('0 100000 1\n1 100001 65535\n')).toEqual([
      { innerStart: 0, hostStart: 100000, count: 1 },
      { innerStart: 1, hostStart: 100001, count: 65535 },
    ])
    expect(v('0 0 0')).toBeUndefined()
    expect(v('-1 0 1')).toBeUndefined()
    expect(v('0 -1 1')).toBeUndefined()
    expect(v('0 0')).toBeUndefined()
    expect(v('a 0 1')).toBeUndefined()
    expect(v('0 0 1 extra')).toBeUndefined()
  })

  test('N is identity only for one full 32-bit range at inner 0', () => {
    expect(N([{ innerStart: 0, hostStart: 0, count: 4294967295 }])).toBe(true)
    expect(N([{ innerStart: 0, hostStart: 0, count: 4294967296 }])).toBe(true)
    expect(N([{ innerStart: 0, hostStart: 0, count: 4294967294 }])).toBe(false)
    expect(N([{ innerStart: 0, hostStart: 100000, count: 1 }])).toBe(false)
    expect(N([])).toBe(false)
    expect(
      N([
        { innerStart: 0, hostStart: 0, count: 4294967295 },
        { innerStart: 0, hostStart: 0, count: 1 },
      ]),
    ).toBe(false)
  })

  test('A returns overflowuid only when it is outside every inner range', () => {
    const mapped = [{ innerStart: 0, hostStart: 100000, count: 65536 }]
    expect(A(mapped, 65534)).toBeUndefined()
    expect(A(mapped, 65536)).toBe(65536)
    expect(A([], 65534)).toBeUndefined()
    expect(A(mapped, undefined)).toBeUndefined()
  })

  test('C/tGn do not throw when /proc is absent', async () => {
    const overflow = await C()
    expect(overflow === undefined || Number.isSafeInteger(overflow)).toBe(true)
    const snap = await tGn()
    expect(snap === undefined || typeof snap.uidCollapses === 'boolean').toBe(
      true,
    )
  })
})

describe('densable 2.1.248 #48 canonical-dir apply', () => {
  test('eGn is the gold canonical system dir set only', () => {
    const dirs = eGn()
    expect(dirs.size).toBe(CANONICAL.length)
    for (const dir of CANONICAL) expect(dirs.has(dir)).toBe(true)
    expect(dirs.has('/home/alice')).toBe(false)
    expect(dirs.has('/tmp/foo')).toBe(false)
    expect(dirs.has('/var/roothome/x')).toBe(false)
    expect(dirs.has('/mnt/wslg/run')).toBe(false)
  })

  test('overflowuid owner is trusted only on a canonical dir', () => {
    expect(p(65534, false, '/tmp', 0, OVERFLOW_SNAP)).toBe(true)
    expect(p(65534, false, '/var/roothome', 0, OVERFLOW_SNAP)).toBe(true)
    expect(p(65534, false, '/mnt/wslg', 0, OVERFLOW_SNAP)).toBe(true)
    expect(p(65534, false, '/home/alice', 0, OVERFLOW_SNAP)).toBe(false)
    expect(p(65534, false, '/tmp/foo', 0, OVERFLOW_SNAP)).toBe(false)
    expect(p(65534, false, undefined, 0, OVERFLOW_SNAP)).toBe(false)
  })

  test('classic root (uid 0, not ambiguous) is trusted off the canonical set', () => {
    expect(p(0, false, '/home/alice', 1000, OVERFLOW_SNAP)).toBe(true)
    expect(p(0, false, '/tmp', 1000, OVERFLOW_SNAP)).toBe(true)
    expect(p(1001, false, '/tmp', 1000, OVERFLOW_SNAP)).toBe(false)
  })

  test('uid 0 is canonical-only when overflowuid is 0 (rootUidAmbiguous)', () => {
    expect(p(0, false, '/tmp', 1000, AMBIGUOUS_ROOT_SNAP)).toBe(true)
    expect(p(0, false, '/home/alice', 1000, AMBIGUOUS_ROOT_SNAP)).toBe(false)
  })

  test('own uid is trusted; in-flight denies root-equivalent', () => {
    expect(p(1000, false, '/home/alice', 1000, OVERFLOW_SNAP)).toBe(true)
    expect(p(65534, true, '/tmp', 0, OVERFLOW_SNAP)).toBe(false)
    expect(p(0, true, '/tmp', 1000, OVERFLOW_SNAP)).toBe(false)
    expect(p(1000, true, '/tmp', 1000, OVERFLOW_SNAP)).toBe(true)
  })

  test('no getuid (non-unix) trusts; identity snapshot is classic root only', () => {
    expect(p(65534, false, '/tmp', undefined, OVERFLOW_SNAP)).toBe(true)
    expect(p(65534, false, '/tmp', 0, undefined)).toBe(false)
    expect(p(0, false, '/home/alice', 1000, undefined)).toBe(true)
  })

  test('uidCollapses blocks the own-uid shortcut', () => {
    const collapsed: UsernsTrustSnapshot = {
      unmappedOwnerUid: undefined,
      uidCollapses: true,
      rootUidAmbiguous: false,
    }
    expect(p(65534, false, '/tmp', 65534, collapsed)).toBe(false)
    expect(p(0, false, '/tmp', 65534, collapsed)).toBe(true)
  })

  test('module does not steal daemon tsn or F1t materializeLinks', () => {
    expect(src).not.toContain('without a uid mapping')
    expect(src).not.toContain('unshare -Ur')
    expect(src).not.toContain('materializeLinks')
    expect(src).not.toContain('function F1t')
    expect(src).not.toContain('M$t')
    expect(src).toContain(
      't === void 0 || s(c) || (!O && (d(c) ? g(v) : c === 0))',
    )
  })
})
