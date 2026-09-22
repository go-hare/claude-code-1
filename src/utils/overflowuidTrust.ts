/**
 * densable 2.1.248 #48 — Linux userns overflowuid + uid_map trust.
 *
 * Gold C()/P() @182940121 (win32 SEA; y=65534 @182939595).
 * Apply from Linux SEA (win32 DCE-stubbed `_()`): eGn/tGn/L/A + p
 * @198269713 — root-equivalent trust only for canonical system dirs
 * when the owner maps to overflowuid.
 * Production: leftover UDS `walkSocketsPathComponents` calls `tGn`/`p`.
 * daemon `tsn` / `F1t` are leftover and ≠ this module.
 */

import { readFile as k } from 'fs/promises'

/** densable y @182939595 */
export const y = 65534

export type UidMapRange = {
  innerStart: number
  hostStart: number
  count: number
}

export type UsernsTrustSnapshot = {
  unmappedOwnerUid: number | undefined
  uidCollapses: boolean
  rootUidAmbiguous: boolean
}

const M = new Set([
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
])

/** Linux eGn() @178758755 — canonical system dirs only. */
export function eGn(): Set<string> {
  return M
}

/**
 * densable C() @182940121
 * `async function C(){try{return P(await k("/proc/sys/kernel/overflowuid","utf8"))}catch{return}}`
 */
export async function C(): Promise<number | undefined> {
  try {
    return P(await k('/proc/sys/kernel/overflowuid', 'utf8'))
  } catch {
    return
  }
}

/**
 * densable P() @182940157 sha=f0e48cdda0d992f1
 * `function P(e){let n=e.trim();if(!/^\d+$/.test(n))return;let t=Number(n);return Number.isSafeInteger(t)?t:void 0}`
 */
export function P(e: string): number | undefined {
  let n = e.trim()
  if (!/^\d+$/.test(n)) return
  let t = Number(n)
  return Number.isSafeInteger(t) ? t : void 0
}

/**
 * densable v() uid_map parse @182939595
 * Invalid line → whole parse fails (undefined). Empty lines skipped.
 */
export function v(e: string): UidMapRange[] | undefined {
  let n: UidMapRange[] = []
  for (let t of e.split('\n')) {
    if (t.trim() === '') continue
    let r = t.trim().split(/\s+/)
    let o = Number(r[0])
    let s = Number(r[1])
    let u = Number(r[2])
    if (
      r.length !== 3 ||
      !Number.isSafeInteger(o) ||
      o < 0 ||
      !Number.isSafeInteger(s) ||
      s < 0 ||
      !Number.isSafeInteger(u) ||
      u <= 0
    )
      return
    n.push({ innerStart: o, hostStart: s, count: u })
  }
  return n
}

/** densable N() — identity map (one range innerStart===0 && count>=4294967295). */
export function N(e: UidMapRange[]): boolean {
  return e.length === 1 && e[0].innerStart === 0 && e[0].count >= 4294967295
}

/** Linux D() — read /proc/self/uid_map (win32 gold `_()` was DCE stub). */
async function D(): Promise<UidMapRange[] | undefined> {
  try {
    return v(await k('/proc/self/uid_map', 'utf8'))
  } catch {
    return
  }
}

/**
 * Linux A() @178759505 sha=00b2c79307872f85
 * Unmapped inner uid (overflowuid not in any inner range).
 */
export function A(e: UidMapRange[], t: number | undefined): number | undefined {
  if (e.length === 0 || t === void 0) return
  return e.some(r => t >= r.innerStart && t < r.innerStart + r.count)
    ? void 0
    : t
}

/** Linux L() @178759831 — snapshot from a parsed (non-identity) map. */
export async function L(
  e: UidMapRange[],
  t: number | undefined,
): Promise<UsernsTrustSnapshot> {
  let n = await C()
  let r = n ?? y
  return {
    unmappedOwnerUid: A(e, n),
    uidCollapses: e.length === 0 || (t !== void 0 && t === r),
    rootUidAmbiguous: n === 0,
  }
}

/** Linux tGn() @178759625 — userns trust snapshot; identity / host → undefined. */
export async function tGn(): Promise<UsernsTrustSnapshot | undefined> {
  let e = process.getuid?.()
  let t = await D()
  if (t === void 0) {
    let n = (await C()) ?? y
    return e === n
      ? {
          unmappedOwnerUid: void 0,
          uidCollapses: true,
          rootUidAmbiguous: n === 0,
        }
      : void 0
  }
  if (N(t)) return
  return L(t, e)
}

/**
 * Linux apply p() @198269713:
 * `p=(c,O,v)=>t===void 0||s(c)||!O&&(d(c)?g(v):c===0)`
 * `d` = overflowuid-unmapped owner or uid 0 when overflowuid is 0
 * `g` = resolved path ∈ eGn()
 */
export function p(
  c: number,
  O: boolean,
  v: string | undefined,
  t: number | undefined,
  r: UsernsTrustSnapshot | undefined,
): boolean {
  let s = (owner: number) => owner === t && !r?.uidCollapses
  let d = (owner: number) =>
    r !== undefined &&
    ((r.unmappedOwnerUid !== undefined && owner === r.unmappedOwnerUid) ||
      (owner === 0 && r.rootUidAmbiguous))
  let g = (path: string | undefined) => path !== undefined && eGn().has(path)
  return t === void 0 || s(c) || (!O && (d(c) ? g(v) : c === 0))
}
