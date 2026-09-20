/**
 * densable 2.1.247 #29 — FE / d(a) + locked helpers.
 *
 * Gold: gold-29-d-full.txt, gold-29-helper-*.txt
 * Bodies are the win32 247 SEA contract. J/Dtb are official stubs
 * (`return !1`); do not invent /net automount here.
 */
import { isAbsolute, resolve, win32 } from 'path'
import { pathToFileURL } from 'url'
import { getCwd } from './cwd.js'

/** densable Zzd / markdown pt `re`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable Zzd
const Zzd = /[\x00-\x1F\x7F-\x9F]/

/** densable Atb `T` — leading class for Btb `k` and markdown `Ee`. */
const LEADING_CLASS = String.raw`\s\u2800\uFFF9-\uFFFB\p{Cc}\p{M}\p{Default_Ignorable_Code_Point}`
const LEADING_INVISIBLE = new RegExp(`^[${LEADING_CLASS}]+`, 'u')

const PCT = /(?:%[0-9A-Fa-f]{2}){1,512}/g
const PCT_ONE = /^%[0-9A-Fa-f]{2}/
const NT_OBJECT = /^[\\/]\?\?[\\/]/
/** densable markdown `ft`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** densable byd / R. */
function byd(t: string): string {
  if (t.startsWith('\\\\?\\UNC\\')) return '\\\\' + t.slice(8)
  if (t.startsWith('\\\\?\\') && t.length >= 7 && t[5] === ':') {
    return t.slice(4)
  }
  return t
}

/** densable ye used by v — path.win32.normalize. */
function yeWin(t: string): string {
  return win32.normalize(t)
}

/** densable myd / v. */
function v(t: string): boolean {
  return NT_OBJECT.test(t) || (t.includes('??') && NT_OBJECT.test(yeWin(t)))
}

/** densable Fxd / P. */
function Fxd(t: string): boolean {
  return /^[\\/]{2}/.test(t) || v(t)
}

/** densable Rxd / J — win32 bu stub. */
function J(_t: string): boolean {
  return false
}

/** densable Txd / Zo. */
function Txd(t: string): boolean {
  return Fxd(t) || J(t)
}

/** densable Dtb / a — win32 stub. */
function Dtb(_e: string): boolean {
  return false
}

/** densable Btb / k. */
function k(e: string): string {
  return e.replace(LEADING_INVISIBLE, '')
}

/** densable _552 `f`. */
function pctBytes(e: string): Uint8Array {
  return Uint8Array.from(e.slice(1).split('%'), r => parseInt(r, 16))
}

/** densable Ftb / N. */
function N(e: string): [string, string] {
  if (!e.includes('%')) return [e, e]
  const dec = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
  return [
    e.replace(PCT, (t, o: number) => {
      const i = o + t.length
      return dec.decode(pctBytes(t), {
        stream: PCT_ONE.test(e.slice(i, i + 3)),
      })
    }),
    e.replace(PCT, t =>
      Array.from(pctBytes(t), o => String.fromCharCode(o)).join(''),
    ),
  ]
}

/** densable Ctb / u. */
function u(e: string, r: [string, string] = N(e)): boolean {
  return (
    Fxd(e) || Dtb(e) || Zzd.test(r[0]!) || r.map(k).some(t => Fxd(t) || Dtb(t))
  )
}

/** densable Etb / j. */
function Etb(e: string): boolean {
  const r = e.slice(7)
  return u(r) || u(r.slice(1))
}

/**
 * densable FE / d(a) — path → file URL, or null when unsafe.
 */
export function toSafeFileUrl(a: string): string | null {
  try {
    const r = byd(a)
    const o = byd(resolve(r))
    if (Txd(r) || Fxd(o) || Dtb(r) || Dtb(o)) return null
    const t = pathToFileURL(r)
    return t.hostname !== '' || Etb(t.href) ? null : t.href
  } catch {
    return null
  }
}

/** densable markdown `dt`. */
function dt(e: string, abs: (p: string) => boolean = isAbsolute): string {
  if (/^\/[A-Za-z]:(?=[\\/]|$)/.test(e) && abs(e.slice(1))) {
    return e.slice(1)
  }
  return e
}

/** densable markdown `ut` — file: href through FE. */
export function sanitizeFileHref(e: string): string | null {
  if (!/^file:/i.test(e)) return e
  let t = e.slice(5)
  if (t.startsWith('//')) {
    t = t.slice(2)
    if (t === 'localhost') t = '/'
    else if (t.startsWith('localhost/')) t = t.slice(9)
  }
  const n = t.search(/[#?]/)
  const hash = n === -1 ? '' : t.slice(n)
  let o = n === -1 ? t : t.slice(0, n)
  if (o === '') return null
  try {
    o = decodeURIComponent(o)
  } catch {
    // official swallows decode errors and keeps o
  }
  o = dt(o)
  const abs = isAbsolute(o) ? o : resolve(getCwd(), o)
  const s = toSafeFileUrl(abs)
  if (s === null) return null
  const c = s + hash
  return Etb(c) ? null : c
}

/**
 * densable markdown `pt` — OSC8 target or null (plain text).
 */
export function sanitizeMarkdownHref(e: string): string | null {
  const t = sanitizeFileHref(e)
  if (
    t === null ||
    Zzd.test(t) ||
    LEADING_INVISIBLE.test(t) ||
    t !== t.trimEnd()
  ) {
    return null
  }
  if (SCHEME.test(t)) return t
  const n = N(t)
  const hasFile = n.some(o => /^file:/i.test(k(o)))
  return u(t, n) || hasFile ? null : t
}
