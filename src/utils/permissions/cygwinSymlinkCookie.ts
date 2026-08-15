/**
 * densable 2.1.232 #14 — `Yun` / `Xun` / `s8g` / `s8s`
 *
 * Git Bash (Cygwin/MSYS) follows **emulated** symlinks that Node does not:
 * plain files whose contents start with the ASCII cookie `!<symlink>` (optionally
 * UTF-16LE after a BOM). Windows `.lnk` shell shortcuts are the same class of
 * "Node sees a file, Bash follows a target" mismatch.
 *
 * When a path walk hits such a cookie, validation must require manual approval
 * (safetyCheck, not classifier-approvable) — densable `IRr` Windows branch.
 */

import path from 'path'
import { getErrnoCode } from '../errors.js'
import type { FsOperations } from '../fsOperations.js'
import { posixPathToWindowsPath } from '../windowsPaths.js'

const win32 = path.win32

/** densable `Nnt` — Cygwin/MSYS symlink cookie magic. */
export const CYGWIN_SYMLINK_COOKIE = Buffer.from('!<symlink>', 'ascii')

/**
 * densable `oSt` — Windows Shell Link (.lnk) header prefix
 * (CLSID + LinkFlags start).
 */
export const SHELL_LINK_HEADER = Buffer.from([
  0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
])

/** densable `t8g` — alternate names tried when a segment is missing. */
const COOKIE_NAME_SUFFIXES = ['.lnk', '.exe', '.exe.lnk'] as const

/** densable `a8g` — max cookie-chain hops in `Xun`. */
const MAX_COOKIE_CHAIN = 64

/** densable `i8g` — max bytes to read when decoding cookie target. */
const COOKIE_READ_MAX = CYGWIN_SYMLINK_COOKIE.length + 2 + 8192

/** densable `s8s` */
export const CYGWIN_SYMLINK_MESSAGE =
  'Path traverses a Cygwin-emulated symlink (Git Bash follows it, Node does not) — manual approval required'

/**
 * densable `u8s` — message with optional destination for the UI.
 */
export function formatCygwinSymlinkMessage(displayTarget?: string): string {
  if (displayTarget === undefined || displayTarget.length === 0) {
    return CYGWIN_SYMLINK_MESSAGE
  }
  // densable HRr truncates long destinations; keep short full form.
  const shown =
    displayTarget.length > 200
      ? `${displayTarget.slice(0, 200)}…`
      : displayTarget
  return `${CYGWIN_SYMLINK_MESSAGE} (destination: ${shown})`
}

export type YunOptions = {
  onCookieRemainder?: (remainingSegments: string[]) => void
}

export type XunResult = {
  scanCandidates: string[]
  displayTarget: string | undefined
}

/**
 * densable `l8g` / local `containsPathTraversal` cousin used inside Xun:
 * `..` after a real segment (may escape via cookie).
 */
function hasDotDotAfterSegment(path: string): boolean {
  let sawReal = false
  for (const part of path.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (sawReal) return true
    } else {
      sawReal = true
    }
  }
  return false
}

/**
 * densable `s8g` — if `path` is a Cygwin cookie file, return the target string
 * (first null-terminated reading). Optionally report latin1 vs utf-8 alternate.
 */
export function readCygwinCookieTarget(
  fs: FsOperations,
  path: string,
  opts?: { onAlternateReading?: (alt: string) => void },
): string | undefined {
  try {
    if (!fs.lstatSync(path).isFile()) return undefined
  } catch {
    return undefined
  }
  let n: { buffer: Buffer; bytesRead: number }
  try {
    n = fs.readSync(path, { length: COOKIE_READ_MAX })
  } catch {
    return undefined
  }
  const o = n.buffer.subarray(0, n.bytesRead)
  const magicLen = CYGWIN_SYMLINK_COOKIE.length
  if (
    o.length <= magicLen ||
    !o.subarray(0, magicLen).equals(CYGWIN_SYMLINK_COOKIE)
  ) {
    return undefined
  }
  let s = o.subarray(magicLen)
  const firstNull = (d: string): string | undefined => {
    const p = d.indexOf('\x00')
    const f = p === -1 ? d : d.slice(0, p)
    return f.length > 0 ? f : undefined
  }
  // UTF-16LE BOM
  if (s.length >= 2 && s[0] === 0xff && s[1] === 0xfe) {
    s = s.subarray(2)
    return firstNull(
      s.subarray(0, s.length - (s.length % 2)).toString('utf16le'),
    )
  }
  let utf8: string | undefined
  try {
    utf8 = new TextDecoder('utf-8', { fatal: true }).decode(s)
  } catch {
    utf8 = undefined
  }
  const latin1 = firstNull(s.toString('latin1'))
  if (utf8 === undefined) return latin1
  const u = firstNull(utf8)
  if (u !== undefined && latin1 !== undefined && latin1 !== u) {
    opts?.onAlternateReading?.(latin1)
  }
  return u
}

/**
 * densable `r8g` — path is a cookie file, shell-link, or real symlink.
 */
function isCookieOrLinkPath(
  fs: FsOperations,
  path: string,
): string | undefined {
  try {
    const st = fs.lstatSync(path)
    if (!st.isFile()) {
      return st.isSymbolicLink() ? path : undefined
    }
    const n = fs.readSync(path, { length: SHELL_LINK_HEADER.length })
    if (
      n.bytesRead >= SHELL_LINK_HEADER.length &&
      n.buffer.subarray(0, SHELL_LINK_HEADER.length).equals(SHELL_LINK_HEADER)
    ) {
      return path
    }
    if (
      n.bytesRead >= CYGWIN_SYMLINK_COOKIE.length &&
      n.buffer
        .subarray(0, CYGWIN_SYMLINK_COOKIE.length)
        .equals(CYGWIN_SYMLINK_COOKIE)
    ) {
      return path
    }
  } catch (err) {
    const code = getErrnoCode(err)
    if (
      code === 'ENOENT' ||
      code === 'ERR_INVALID_ARG_VALUE' ||
      code === 'ERR_INVALID_ARG_TYPE'
    ) {
      return undefined
    }
    // Other errors: treat conservatively as hit if basename looks like cookie host
    return path
  }
  return undefined
}

/**
 * densable `Yun` — walk `absolutePath` segment-by-segment. Return the first
 * path that is a Cygwin cookie / shell link / unresolved trailing-dot trap, or
 * undefined if the walk is clean.
 *
 * `fs` is densable `br()` (getFsImplementation).
 */
export function findCygwinEmulatedSymlink(
  fs: FsOperations,
  absolutePath: string,
  opts?: YunOptions,
): string | undefined {
  // densable pVe: MinGW/Cygwin drive forms → Windows
  let t = posixPathToWindowsPath(absolutePath)
  // Skip device / extended paths we cannot safely walk (densable hre subset)
  if (/^\\\\\?\\volume\{/i.test(t) || /^\\\\\.\\/i.test(t)) {
    return undefined
  }

  const o = win32.resolve(t)
  const parsed = win32.parse(o)
  const root = parsed.root
  let segments = o
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)
  let a = root
  let linkDepth = 0

  while (segments.length > 0) {
    const c = segments.shift()!
    a = win32.join(a, c)

    // Trailing dots/spaces: Windows strips them; Git Bash may not — densable trap
    if (c !== '.' && c !== '..' && /[. ]$/.test(c)) {
      const f = c.replace(/[. ]+$/, '')
      if (f === '' || f === '.' || f === '..') {
        return a
      }
      // Conservative: any trailing-dot segment requires approval (ADS/8.3
      // collision helpers n8g/ahs are densable extras; fail closed).
      return a
    }

    let u: ReturnType<FsOperations['lstatSync']>
    try {
      u = fs.lstatSync(a)
    } catch (err) {
      const m = getErrnoCode(err)
      if (
        m !== 'ENOENT' &&
        m !== 'ERR_INVALID_ARG_VALUE' &&
        m !== 'ERR_INVALID_ARG_TYPE'
      ) {
        // Unexpected error mid-walk — fail closed
        return a
      }
      // Missing segment: try alternate cookie names (foo.lnk / foo.exe)
      const h = a.replace(/[. ]+$/, '')
      let g: string | undefined
      for (const y of h === a ? [a] : [h, a]) {
        for (const b of COOKIE_NAME_SUFFIXES) {
          g = isCookieOrLinkPath(fs, y + b)
          if (g !== undefined) break
        }
        if (g !== undefined) break
      }
      if (g !== undefined) {
        opts?.onCookieRemainder?.([...segments])
        return g
      }
      // Missing path with no cookie alternate — remaining walk is create-target;
      // densable returns undefined (no cookie hit).
      return undefined
    }

    if (u.isSymbolicLink()) {
      if (++linkDepth >= 64) return a
      let f: string
      try {
        f = fs.readlinkSync(a)
      } catch (err) {
        return getErrnoCode(err) === 'ENOENT' ? undefined : a
      }
      const m = win32.isAbsolute(f) ? f : win32.resolve(win32.dirname(a), f)
      if (/^\\\\\?\\volume\{/i.test(m) || /^\\\\\.\\/i.test(m)) return undefined
      if (win32.isAbsolute(f)) {
        const h = posixPathToWindowsPath(f)
        const g = win32.parse(h).root || win32.sep
        a = g
        segments = [
          ...h
            .slice(g.length)
            .split(/[\\/]+/)
            .filter(Boolean),
          ...segments,
        ]
      } else {
        a = win32.dirname(a)
        segments = [...f.split(/[\\/]+/).filter(Boolean), ...segments]
      }
      continue
    }

    if (!u.isFile()) {
      // Directory — continue into children
      continue
    }

    // Regular file mid-path or final: check cookie / .lnk
    let d: { buffer: Buffer; bytesRead: number }
    try {
      d = fs.readSync(a, { length: SHELL_LINK_HEADER.length })
    } catch {
      return a
    }
    if (
      d.bytesRead >= CYGWIN_SYMLINK_COOKIE.length &&
      d.buffer
        .subarray(0, CYGWIN_SYMLINK_COOKIE.length)
        .equals(CYGWIN_SYMLINK_COOKIE)
    ) {
      opts?.onCookieRemainder?.([...segments])
      return a
    }
    // densable-aligned with isCookieOrLinkPath: Shell Link magic is enough —
    // do not require a `.lnk` extension (extensionless .lnk headers exist).
    if (
      d.bytesRead >= SHELL_LINK_HEADER.length &&
      d.buffer.subarray(0, SHELL_LINK_HEADER.length).equals(SHELL_LINK_HEADER)
    ) {
      opts?.onCookieRemainder?.([...segments])
      return a
    }
    // File that is not a cookie ends the walk (leaf file) — clean if final.
    return undefined
  }
  return undefined
}

/**
 * densable `Xun` — follow cookie chain from hit path for deny-rule scan
 * candidates + display destination.
 */
export function expandCygwinCookieChain(
  fs: FsOperations,
  cookiePath: string,
  remainder?: string[],
): XunResult {
  if (/[. ]$/.test(win32.basename(cookiePath))) {
    return { scanCandidates: [], displayTarget: undefined }
  }

  const n =
    remainder !== undefined && remainder.length > 0
      ? win32.join(...remainder)
      : undefined
  const o: string[] = []
  const seen = new Set<string>()
  let s = cookiePath
  let lastRaw: string | undefined
  let lastResolved: string | undefined
  let endedClean = false
  let hadDotDot = false

  for (let p = 0; p < MAX_COOKIE_CHAIN; p++) {
    let alt: string | undefined
    const m = readCygwinCookieTarget(fs, s, {
      onAlternateReading: v => {
        alt = v
      },
    })
    if (m === undefined) {
      endedClean = p > 0
      break
    }
    // densable Fu/Th: skip null-device style targets
    if (m === 'nul' || m === 'NUL') break

    const h = m.replace(/\\/g, '/')
    const g = posixPathToWindowsPath(h)
    const y = win32.isAbsolute(g)
      ? win32.resolve(g)
      : win32.resolve(win32.dirname(s), g)
    if (seen.has(y)) break
    seen.add(y)
    o.push(y)
    if (n !== undefined) o.push(win32.join(y, n))

    // Also keep POSIX-style target for Git Bash path space
    if (
      h.startsWith('/') &&
      !h.startsWith('//') &&
      h !== y.replace(/\\/g, '/')
    ) {
      o.push(h)
      if (remainder !== undefined && remainder.length > 0) {
        o.push(`${h.replace(/\/+$/, '')}/${remainder.join('/')}`)
      }
    }

    if (alt !== undefined && alt !== 'nul' && alt !== 'NUL') {
      const v = alt.replace(/\\/g, '/')
      const S = posixPathToWindowsPath(v)
      const A = win32.isAbsolute(S)
        ? win32.resolve(S)
        : win32.resolve(win32.dirname(s), S)
      if (!seen.has(A)) {
        o.push(A)
        if (n !== undefined) o.push(win32.join(A, n))
      }
    }

    if (
      hasDotDotAfterSegment(m) ||
      (p > 0 && /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(m))
    ) {
      hadDotDot = true
    }
    lastRaw = h
    lastResolved = y
    if (
      y.split(/[\\/]+/).some(v => v !== '.' && v !== '..' && /[. ]$/.test(v))
    ) {
      break
    }
    let b: ReturnType<FsOperations['lstatSync']> | undefined
    try {
      b = fs.lstatSync(y)
    } catch {
      b = undefined
    }
    if (b === undefined || !b.isFile()) {
      endedClean = true
      break
    }
    s = y
  }

  let d: string | undefined
  if (
    endedClean &&
    !hadDotDot &&
    lastRaw !== undefined &&
    lastResolved !== undefined
  ) {
    d =
      lastRaw.startsWith('/') && !lastRaw.startsWith('//')
        ? lastRaw
        : lastResolved
  }
  return { scanCandidates: o, displayTarget: d }
}
