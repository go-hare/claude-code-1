/**
 * densable 2.1.217 #5 — background session isolation containment
 * (`hsr` / `a9u` / `XNe` / `N6g` / `T_s` / `VRu` / `qRu`).
 *
 * Canonicalizes (realpath + lexical forms, 8-hop, device-ns, trailing
 * dot/space, Windows 8.3 short-name secondary containment) so a symlinked
 * working directory cannot let bg / worktree-isolated sessions write into
 * the shared checkout (or escape the worktree) by spelling a path that only
 * matches on the unresolved side.
 *
 * Call sites densable:
 * - FileWrite / FileEdit / NotebookEdit `validateInput` before content checks
 *   (`errorCode` 7 / 12) via `hsr`
 * - Shell exec with `agentWorktree` via `VRu` (cwd) + `ZRu` (git redirect)
 */

import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import { ENTER_WORKTREE_TOOL_NAME } from '@claude-code/builtin-tools/tools/EnterWorktreeTool/constants.js'
import { isBgSession } from './concurrentSessions.js'
import { getCwd, getCwdOverride } from './cwd.js'
import { logForDebugging } from './debug.js'
import { findCanonicalGitRoot, findGitRoot } from './git.js'
import { expandPath } from './path.js'
import { getPlatform } from './platform.js'
import { getSettings_DEPRECATED } from './settings/settings.js'
import { isClaudeWorktreesPath } from './worktreeGitIsolation.js'
import { getCurrentWorktreeSession } from './worktree.js'

export type BgIsolationMode = 'worktree' | 'none'

/**
 * densable zge()/aGh subset for isolation mode — job state.bgIsolation when
 * this process is a bg/daemon worker with CLAUDE_JOB_DIR (densable Jtt).
 * densable binary's aGh setter is inert in 2.1.217 pack; job env + state.json
 * is the durable equivalent used by spawn (xSeSpawn sets CLAUDE_BG_ISOLATION).
 */
function getJobBgIsolationFromJobDir(): BgIsolationMode | undefined {
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (!jobDir) return undefined
  try {
    // Lazy require to avoid daemon↔utils cycle at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join: pathJoin } = require('path') as typeof import('path')
    const stateFile = pathJoin(jobDir, 'state.json')
    if (!existsSync(stateFile)) return undefined
    const raw = readFileSync(stateFile, 'utf-8')
    const state = JSON.parse(raw) as { bgIsolation?: string }
    const s = state.bgIsolation
    if (s === 'worktree' || s === 'none') return s
  } catch {
    // ignore
  }
  return undefined
}

/**
 * densable T_s — env CLAUDE_BG_ISOLATION wins; else zge()?.bgIsolation (job);
 * else settings.worktree.bgIsolation.
 * Undefined means default worktree isolation for bg sessions (only `"none"` disables).
 */
export function resolveBgIsolationMode(): BgIsolationMode | undefined {
  const env = process.env.CLAUDE_BG_ISOLATION
  if (env === 'worktree' || env === 'none') return env
  const fromJob = getJobBgIsolationFromJobDir()
  if (fromJob) return fromJob
  try {
    const settings = getSettings_DEPRECATED() as
      | { worktree?: { bgIsolation?: string } }
      | undefined
    const s = settings?.worktree?.bgIsolation
    if (s === 'worktree' || s === 'none') return s
  } catch {
    // settings unavailable
  }
  return undefined
}

export type CanonicalPath = {
  /** densable lexical — NFC-normalized spelling used for display / first hop. */
  lexical: string
  /**
   * densable `canonical` — realpath when resolvable; null when unresolvable
   * (dot-segment / device / unreadable) and not network-skipped.
   */
  canonical: string | null
  /** densable `skipped` — network-shaped (UNC / /net) without resolving. */
  skipped: boolean
  /**
   * densable `surfaced` — intermediate spelling surfaced when resolution
   * refuses (e.g. resolves-to-network, non-convergent). Used by tKr when the
   * root is unresolvable.
   */
  surfaced?: string
}

/** densable path platform for N6g/XNe — win32 | darwin | posix-like. */
type PathPlatform = 'win32' | 'darwin' | 'linux'

function pathPlatform(): PathPlatform {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

/** densable Cd — NFC normalize (local identity + NFC for cross-platform compare). */
function Cd(e: string): string {
  return e.normalize('NFC')
}

/** densable Zw — raw `.` / `..` path segments. */
function Zw(e: string): boolean {
  return /(^|[\\/])\.{1,2}([\\/]|$)/.test(e)
}

/** densable G5t — Windows device-namespace `\\?\` / `\\.\`. */
function G5t(e: string): boolean {
  return /^[\\/]{2}[?.][\\/]/.test(e)
}

/** densable kc — UNC-shaped (starts with // or \\). */
function kc(e: string): boolean {
  return /^[\\/]{2}/.test(e)
}

/** densable Sf — WSL UNC that is treated as local-ish, not network-skip. */
function Sf(e: string): boolean {
  return /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(e)
}

/** densable Zj — UNC that is not WSL → network skip. */
function Zj(e: string): boolean {
  return kc(e) && !Sf(e)
}

/** densable jRu — trailing dot/space before separator or end (Windows). */
const jRu = /[. ](?=[\\/]|$)/

/** densable M6g — separator char for containment prefix. */
function M6g(e: string): string {
  return e.startsWith('/') ? '/' : '\\'
}

/** densable uat — collapse separators to `\` while preserving UNC `\\` prefix. */
function uat(e: string): string {
  const unc = /^[\\/]{2}/.test(e)
  return (
    (unc ? '\\\\' : '') +
    (unc ? e.replace(/^[\\/]{2,}/, '') : e).replace(/[\\/]+/g, '\\')
  )
}

/** densable rfi — lower-case ASCII for /net host. */
function rfi(e: string): string {
  return e.replace(/[A-Z]/g, t => t.toLowerCase())
}

/**
 * densable GPr — normalize `/net/<host>/...` host casing (darwin case-insensitive host).
 */
function GPr(e: string, t: PathPlatform = 'win32'): string {
  const re =
    t === 'darwin' ? /^\/net\/([^/]+)(\/.*|$)/i : /^\/net\/([^/]+)(\/.*|$)/
  const m = re.exec(e)
  if (!m) return e
  return '/net/' + rfi(m[1]!).replace(/\.$/, '') + m[2]
}

/**
 * densable TPn — strip trailing DNS-style `.` after UNC host (except wsl.localhost).
 * `\\server.\share` → `\\server\share`
 */
function TPn(e: string): string {
  const t = /^([\\/]{2,})([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.(?=[\\/]|$)/.exec(
    e,
  )
  if (t === null || t[2]!.toLowerCase() === 'wsl.localhost') return e
  return t[1]![0]!.repeat(2) + t[2] + e.slice(t[1]!.length + t[2]!.length + 1)
}

/**
 * densable Ihe / Qfl — `/net/...` automount shape (posix).
 */
function Qfl(e: string): string | null {
  if (!e.startsWith('/')) return null
  const t: string[] = []
  for (const r of e.split('/')) {
    if (r === '' || r === '.') continue
    if (r === '..') {
      t.pop()
      continue
    }
    t.push(r)
    if (t.length === 2 && t[0]!.toLowerCase() === 'net') {
      return '/' + t.join('/')
    }
  }
  return null
}

function Ihe(e: string): boolean {
  return Qfl(e) !== null
}

/**
 * densable VPr — strip macOS Data volume prefix for standard mount points.
 * `/System/Volumes/Data/Users/...` → `/Users/...`
 */
const DARWIN_DATA_PREFIX = '/System/Volumes/Data/'
const DARWIN_STRIP_ROOTS = [
  'Users',
  'Volumes',
  'private',
  'tmp',
  'var',
  'opt',
  'Applications',
  'Library',
  'System',
]

function VPr(e: string): string {
  if (!e.startsWith(DARWIN_DATA_PREFIX)) return e
  const r = e.slice(DARWIN_DATA_PREFIX.length)
  for (const n of DARWIN_STRIP_ROOTS) {
    if (r === n || r.startsWith(n + '/')) return '/' + r
  }
  return e
}

/**
 * densable O6g — unwrap `\\?\C:\...` / `\\?\UNC\...` after realpath; null if other device-ns.
 */
function O6g(e: string): string | null {
  if (!G5t(e)) return e
  const drive = /^[\\/]{2}\?[\\/]([A-Za-z]:[\\/].*)$/.exec(e)
  if (drive) return drive[1]!
  const unc = /^[\\/]{2}\?[\\/]UNC[\\/](.+)$/i.exec(e)
  if (unc) return '\\\\' + unc[1]
  return null
}

/**
 * densable wPn — unwrap native realpath `\\?\` forms for short-name expansion.
 */
function wPn(e: string): string {
  if (e.startsWith('\\\\?\\UNC\\')) return '\\\\' + e.slice(8)
  if (e.startsWith('\\\\?\\') && e.length >= 7 && e[5] === ':') {
    return e.slice(4)
  }
  return e
}

/** densable ube — refuse spelling for containment (canonical null). */
function ube(e: string, reason: string, surfaced?: string): CanonicalPath {
  logForDebugging(
    `bg-containment: refusing ${reason} spelling for containment: ${e}`,
    { level: 'warn' },
  )
  if (surfaced === undefined) {
    return { lexical: e, canonical: null, skipped: false }
  }
  return { lexical: e, canonical: null, skipped: false, surfaced }
}

/**
 * densable eq path FS surface — subset of densable Byi/iPm used by eq/dre.
 */
type EqFs = {
  readlinkSync: (p: string) => string
  realpathSync: (p: string) => string
  lstatSync: (p: string) => { isSymbolicLink: () => boolean }
}

function getEqFs(): EqFs {
  return {
    readlinkSync,
    realpathSync,
    lstatSync,
  }
}

/** densable Mt — extract errno code string from thrown value. */
function Mt(e: unknown): string | undefined {
  if (
    e &&
    typeof e === 'object' &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
  ) {
    return (e as { code: string }).code
  }
  return undefined
}

/**
 * densable MWe — UNC host (lower-cased); null for device-namespace non-UNC.
 */
function MWe(e: string): string | null {
  if (/^[\\/]{2}[?.][\\/](?!unc[\\/])/i.test(e)) return null
  return (
    e
      .match(/^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)/i)?.[1]
      ?.replace(/[A-Z]/g, t => t.toLowerCase()) ?? null
  )
}

/**
 * densable W5t — UNC path is "foreign" relative to anchor(s).
 * Used by ROn for anchor filtering under surfaceNetworkRaw.
 */
function W5t(e: string, t: string): boolean {
  if (!kc(e)) return false
  if (G5t(e)) return true
  if (Zw(e)) return true
  const r = MWe(e)
  return r === null || r !== MWe(t)
}

/**
 * densable vPn — AF_UNIX / network host extract for bf paths.
 * densable 2.1.217 pack: always null (bf itself is always false).
 */
function vPn(_e: string): string | null {
  return null
}

/**
 * densable bf — non-UNC "network-shaped" path class.
 * densable 2.1.217 pack: always false (dead branch kept for 1:1 structure).
 */
function bf(_e: string): boolean {
  return false
}

/** densable Qj — bf-path foreign relative to anchor (vPn host mismatch). */
function Qj(e: string, t: string): boolean {
  if (!bf(e)) return false
  const r = vPn(e)
  return r === null || r !== vPn(t)
}

/** densable JMr — every anchor allows bf-path e. */
function JMr(e: string, t: string[] | undefined): boolean {
  return t === undefined || t.every(r => Qj(e, r))
}

/** densable ROn — every anchor allows UNC-path e. */
function ROn(e: string, t: string[] | undefined): boolean {
  return t === undefined || t.every(r => W5t(e, r))
}

/** densable b_l — normalize anchors option. */
function b_l(
  e: EqOptions | { anchors?: string[]; anchor?: string } | undefined,
): string[] | undefined {
  if (e && 'anchors' in e && e.anchors !== undefined && e.anchors.length > 0) {
    return e.anchors
  }
  if (e && 'anchor' in e && e.anchor !== undefined) return [e.anchor]
  return undefined
}

/** densable $yi — only `..` segments (stricter than Zw which also matches `.`). */
const $yi = /(^|[\\/])\.\.([\\/]|$)/

/** densable xAt — sentinel for unverified ancestry under surfaceNetworkRaw. */
const xAt = '\0unverified-ancestry'

/** densable tPm — strip `.`/`..` tail for nPm collapse. */
function tPm(e: string): string {
  let t = ''
  for (const n of e.split(/([\\/]+)/)) {
    if (n === '.' || n === '..') break
    t += n
  }
  const r = t.replace(/(?<=[^\\/])[\\/]+$/, '')
  return r === '' ? e : r
}

/** densable rPm / nPm — collapse trailing separators; UNC leave as-is. */
function rPm(e: string): string {
  const t = join(e).replace(/(?<=[^\\/])[\\/]+$/, '')
  if (kc(t) && !Sf(t)) return t
  return tPm(e)
}
const nPm = rPm

/**
 * densable y_l — join remaining segments under a landed absolute prefix,
 * collapsing when landing on Zw / `.`/`..` remainder.
 */
function y_l(e: string, t: string[], r?: (landed: string) => void): string {
  const n = Zw(e)
  if (t.length === 0 || n || t.some(o => o === '.' || o === '..')) {
    if (r !== undefined && (t.length > 0 || n)) r(join(e, ...t))
    return n ? nPm(e) : e
  }
  return join(e, ...t)
}

/**
 * densable oPm — strip `/./` segments when surfaceDotDotTargets walks absolute
 * symlink targets.
 */
function oPm(e: string, t: PathPlatform = pathPlatform()): string {
  const r = e.replace(
    t === 'win32' ? /[\\/]\.(?=[\\/]|$)/g : /\/\.(?=\/|$)/g,
    '',
  )
  if (r === '') return e[0] ?? e
  if (t === 'win32' && /^[A-Za-z]:$/.test(r)) return r + e[2]
  return r
}

export type EqOptions = {
  /** densable surfaceDotDotTargets — surface raw `..` symlink targets. */
  surfaceDotDotTargets?: boolean
  /** densable surfaceNetworkRaw — surface network-shaped / Zw landings raw. */
  surfaceNetworkRaw?: boolean
  /** densable anchors — multi-root filter for foreign UNC/bf paths. */
  anchors?: string[]
  /** densable anchor — single-root form of anchors. */
  anchor?: string
  /** densable onCollapsedLanding — callback when y_l collapses. */
  onCollapsedLanding?: (landed: string) => void
}

/**
 * densable dre — resolve through absolute symlink collapses (network-aware).
 * Returns a string when resolution short-circuits; undefined to continue eq.
 */
function dre(
  e: EqFs,
  t: string,
  r?: EqOptions & { anchors?: string[]; surfaceNetworkRaw?: boolean },
): string | undefined {
  const n = b_l(r)
  if ((kc(t) && !Sf(t) && ROn(t, n)) || (bf(t) && JMr(t, n))) {
    return undefined
  }
  const o = resolve(t)
  const i = (() => {
    // densable Ym.parse(o).root
    if (/^[A-Za-z]:[\\/]/.test(o)) return o.slice(0, 3)
    if (/^[\\/]{2}/.test(o)) {
      const m = /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?/.exec(o)
      return m ? m[0]! : o.slice(0, 2)
    }
    return o.startsWith('/') ? '/' : ''
  })()
  let s = i
  let a = o
    .slice(i.length)
    .split(/[\\/]+/)
    .filter(Boolean)
  let l = 0
  const c = 64
  while (a.length > 0 && l < c) {
    const u = join(s, a[0]!)
    if (bf(u) && JMr(u, n)) {
      return y_l(u, a.slice(1), r?.onCollapsedLanding)
    }
    let d: { isSymbolicLink: () => boolean }
    try {
      d = e.lstatSync(u)
    } catch {
      return undefined
    }
    if (!d.isSymbolicLink()) {
      a.shift()
      s = u
      continue
    }
    l++
    let p: string
    try {
      p = e.readlinkSync(u)
    } catch {
      return undefined
    }
    if (!isAbsolute(p)) {
      a.shift()
      a = [...p.split(/[\\/]+/).filter(Boolean), ...a]
      continue
    }
    let f = p
    if ((kc(f) && !Sf(f) && ROn(f, n)) || (bf(f) && JMr(f, n))) {
      a.shift()
      return y_l(f, a, r?.onCollapsedLanding)
    }
    if (r?.surfaceNetworkRaw === true && Zw(f)) {
      a.shift()
      return a.length === 0 ? f : f + sep + a.join(sep)
    }
    a.shift()
    const g =
      (() => {
        if (/^[A-Za-z]:[\\/]/.test(f)) return f.slice(0, 3)
        if (/^[\\/]{2}/.test(f)) {
          const m = /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?/.exec(f)
          return m ? m[0]! : f.slice(0, 2)
        }
        return f.startsWith('/') ? '/' : sep
      })() || sep
    s = g
    a = [
      ...f
        .slice(g.length)
        .split(/[\\/]+/)
        .filter(Boolean),
      ...a,
    ]
  }
  if (a.length > 0 && r?.surfaceNetworkRaw) return xAt
  return undefined
}

/**
 * densable eq — full path resolution engine for containment and other surfaces.
 *
 * N6g calls `eq(fs, path, {surfaceDotDotTargets:true})` only.
 * Other product surfaces may pass `surfaceNetworkRaw`.
 *
 * Returns undefined when the path cannot be resolved (N6g treats as
 * lexical===canonical identity form).
 */
export function eq(e: EqFs, t: string, r?: EqOptions): string | undefined {
  const n = b_l(r)
  if ((kc(t) && !Sf(t)) || bf(t)) {
    if (
      n !== undefined &&
      ((bf(t) && !JMr(t, n)) || (kc(t) && !Sf(t) && !ROn(t, n)))
    ) {
      return dre(e, t, {
        anchors: n,
        surfaceNetworkRaw: r?.surfaceNetworkRaw,
      })
    }
    return t
  }
  const o = dre(
    e,
    t,
    r?.surfaceNetworkRaw === true
      ? { surfaceNetworkRaw: true, anchors: n }
      : undefined,
  )
  if (o !== undefined) return o
  let i = t
  const s: string[] = []
  const a = r?.surfaceDotDotTargets === true
  const l = (c: string): string =>
    s.length === 0 ? c : a && $yi.test(c) ? [c, ...s].join(sep) : join(c, ...s)
  while (i !== dirname(i)) {
    let c: string | undefined
    let u: string | undefined
    try {
      c = e.readlinkSync(i)
    } catch (d) {
      u = Mt(d)
    }
    if (c !== undefined) {
      if (a && $yi.test(c)) {
        return l(isAbsolute(c) ? c : dirname(i) + sep + c)
      }
      const d = isAbsolute(c) ? c : resolve(dirname(i), c)
      if (
        (kc(d) && !Sf(d)) ||
        bf(d) ||
        (r?.surfaceNetworkRaw === true && Zw(d))
      ) {
        return r?.surfaceNetworkRaw === true && s.length > 0
          ? d + sep + s.join(sep)
          : l(d)
      }
      try {
        const p = e.realpathSync(i)
        return l(p)
      } catch {
        let p = i
        let f = 0
        const m = 64
        while (f < m) {
          let g: string
          try {
            g = e.readlinkSync(p)
          } catch {
            break
          }
          if (a && $yi.test(g)) {
            p = isAbsolute(g) ? g : dirname(p) + sep + g
            break
          }
          const y = isAbsolute(g) ? (a ? oPm(g) : g) : resolve(dirname(p), g)
          if (
            (kc(y) && !Sf(y) && ROn(y, n)) ||
            (bf(y) && JMr(y, n)) ||
            (r?.surfaceNetworkRaw === true && Zw(y))
          ) {
            p = y
            break
          }
          let _: { isSymbolicLink: () => boolean }
          try {
            _ = e.lstatSync(y)
          } catch {
            p = y
            break
          }
          if (!_.isSymbolicLink()) {
            p = y
            break
          }
          p = y
          f++
        }
        if (f >= m && r?.surfaceNetworkRaw === true) return xAt
        return r?.surfaceNetworkRaw === true &&
          s.length > 0 &&
          ((kc(p) && !Sf(p)) || bf(p) || Zw(p))
          ? p + sep + s.join(sep)
          : l(p)
      }
    }
    if (u === 'ENOENT') {
      s.unshift(basename(i))
      i = dirname(i)
      continue
    }
    try {
      const d = e.realpathSync(i)
      if (d !== i) return l(d)
    } catch (d) {
      if (a) throw d
    }
    return undefined
  }
  return undefined
}

/**
 * densable N6g uses eq with surfaceDotDotTargets only.
 * Convenience wrapper over getEqFs().
 */
function resolveForContainment(
  input: string,
  surfaceDotDotTargets: boolean,
): string | undefined {
  return eq(getEqFs(), input, { surfaceDotDotTargets })
}

/**
 * densable N6g — single-hop path engine for bg containment.
 * Platform path: win32 device-ns / trailing-dot / UNC skip; darwin VPr + /net;
 * realpath via eq; refuse resolves-to-network / device / dot-segment.
 */
export function N6g(
  raw: string,
  platform: PathPlatform = pathPlatform(),
): CanonicalPath {
  if (Zw(raw)) return ube(Cd(raw), 'dot-segment')
  let r = Cd(raw)

  if (platform === 'win32') {
    // collapse excess leading separators after first: \\\\ → \\
    r = r.replace(/^([\\/])[\\/]{2,}/, (_a, l: string) => l + l)
    if (G5t(r)) return ube(r, 'device-namespace')
    r = TPn(r)
    if (jRu.test(r)) return ube(r, 'trailing-dot-or-space')
    if (Zj(r)) return { lexical: uat(r), canonical: null, skipped: true }
    r = uat(r)
  } else {
    r = r.replace(/\/{2,}/g, '/')
    if (platform === 'darwin') r = VPr(r)
    if (Ihe(r)) {
      return { lexical: GPr(r, platform), canonical: null, skipped: true }
    }
  }

  const n = resolveForContainment(r, true)
  if (n === undefined) {
    return { lexical: r, canonical: r, skipped: false }
  }

  let o: string | null = platform === 'win32' ? O6g(n) : n
  if (o === null) return ube(r, 'resolves-to-device-namespace')

  let i =
    platform === 'win32'
      ? o
      : platform === 'darwin'
        ? VPr(o.replace(/^\/{2,}/, '/'))
        : o.replace(/^\/{2,}/, '/')

  if (Zj(i) || Ihe(i)) {
    const surfaced = GPr(Cd(platform === 'win32' ? uat(i) : i), platform)
    return ube(r, 'resolves-to-network', surfaced)
  }
  if (Zw(i)) return ube(r, 'resolves-to-dot-segment')
  if (platform === 'win32' && jRu.test(i)) {
    return ube(r, 'resolves-to-trailing-dot-or-space')
  }

  const s = platform === 'win32' ? uat(i) : i.replace(/\/{2,}/g, '/')
  return { lexical: r, canonical: Cd(s), skipped: false }
}

/**
 * densable XNe — up to 8-hop N6g loop until convergence; refuse non-convergent
 * symlink rings and carry first-hop lexical + optional surfaced.
 */
export function XNe(
  raw: string,
  platform: PathPlatform = pathPlatform(),
): CanonicalPath {
  let first: CanonicalPath | undefined
  let o = raw
  try {
    for (let i = 0; i < 8; i++) {
      const s = N6g(o, platform)
      first ??= s
      if (s.skipped) {
        return i === 0 ? s : ube(first.lexical, 'resolves-to-network')
      }
      if (s.canonical === null) {
        return i === 0 ? s : { ...s, lexical: first.lexical }
      }
      if (s.canonical === o) {
        // densable: if still a symlink at fixed point → non-convergent
        try {
          if (lstatSync(o).isSymbolicLink()) {
            return ube(
              first.lexical,
              'resolution-not-convergent',
              o !== raw ? o : undefined,
            )
          }
        } catch (err) {
          // densable Kt ≈ ENOENT; on win32 try realpath dirname
          const code =
            err !== null &&
            typeof err === 'object' &&
            'code' in err &&
            typeof (err as { code: unknown }).code === 'string'
              ? (err as { code: string }).code
              : undefined
          if (code !== 'ENOENT' && code !== 'ENOTDIR') {
            // unexpected — densable rethrows non-ENOENT from lstat when not Kt
            // treat other errors as non-convergent only if win32 dirname fails
          }
          if (platform === 'win32') {
            try {
              realpathSync(dirname(o))
            } catch (l) {
              const lc =
                l !== null &&
                typeof l === 'object' &&
                'code' in l &&
                typeof (l as { code: unknown }).code === 'string'
                  ? (l as { code: string }).code
                  : undefined
              if (lc !== 'ENOENT' && lc !== 'ENOTDIR') {
                return ube(
                  first.lexical,
                  'resolution-not-convergent',
                  o !== raw ? o : undefined,
                )
              }
            }
          }
        }
        return {
          lexical: first.lexical,
          canonical: o,
          skipped: false,
        }
      }
      o = s.canonical
    }
  } catch {
    return ube(
      first?.lexical ?? Cd(raw),
      'resolution-error',
      o !== raw ? o : undefined,
    )
  }
  return ube(
    first!.lexical,
    'resolution-not-convergent',
    o !== raw ? o : undefined,
  )
}

/**
 * densable XNe entry used by containment: expand + resolve then XNe.
 * Public name kept as canonicalizeForBgContainment for existing call sites.
 */
export function canonicalizeForBgContainment(raw: string): CanonicalPath {
  const expanded = expandPath(raw)
  // densable feeds absolute/lexical path into XNe; expand ~ and resolve relative.
  let absolute: string
  try {
    absolute = isAbsolute(expanded) ? expanded : resolve(getCwd(), expanded)
  } catch {
    absolute = resolve(expanded)
  }
  return XNe(absolute, pathPlatform())
}

function isUnresolvable(c: CanonicalPath): boolean {
  return c.canonical === null && !c.skipped
}

/** densable YNe */
export function isUnresolvableCanonical(c: CanonicalPath): boolean {
  return isUnresolvable(c)
}

/** densable tnr — path is root or strictly under root (optional case-fold). */
export function pathUnderRoot(
  path: string,
  root: string,
  caseFold = true,
): boolean {
  const p = caseFold ? path.toLowerCase() : path
  const r = caseFold ? root.toLowerCase() : root
  if (p === r) return true
  const i = M6g(r)
  const rootWithSep = r.endsWith(i) ? r : r + i
  return p.startsWith(rootWithSep)
}

/** densable LRt */
function LRt(e: string, t: string): boolean {
  return pathUnderRoot(e, t, true)
}

/**
 * densable Uyi / APn — expand Windows 8.3 short names via realpathSync.native
 * walking parents; identity when already long / network / device.
 */
function isUyiSkip(e: string): boolean {
  return (kc(e) && !Sf(e)) || Ihe(e) || G5t(e)
}

const APN_RETRY_CODES = new Set([
  'UNKNOWN',
  'EPERM',
  'EACCES',
  'EBUSY',
  'EAGAIN',
])
const APN_MAX_TRIES = 4
const APN_WAIT_MS = 50

function APn(e: string): string | null {
  for (let t = 0; ; t++) {
    try {
      // densable realpathSync.native — Bun/Node expose .native on win32.
      const realNative = (
        realpathSync as typeof realpathSync & {
          native?: (p: string) => string
        }
      ).native
      const real = realNative ? realNative(e) : realpathSync(e)
      return wPn(real)
    } catch (r) {
      const n =
        r !== null &&
        typeof r === 'object' &&
        'code' in r &&
        typeof (r as { code: unknown }).code === 'string'
          ? (r as { code: string }).code
          : undefined
      if (
        n === undefined ||
        !APN_RETRY_CODES.has(n) ||
        t >= APN_MAX_TRIES - 1
      ) {
        return null
      }
      // densable Atomics.wait spin; approximate with busy-ish short sleep via
      // SharedArrayBuffer when available, else no-op retry.
      try {
        const buf = new Int32Array(new SharedArrayBuffer(4))
        Atomics.wait(buf, 0, 0, APN_WAIT_MS)
      } catch {
        // ignore
      }
    }
  }
}

function Uyi(e: string): string {
  if (isUyiSkip(e)) return e
  let t = e
  let r = ''
  for (;;) {
    if (!Zw(t)) {
      const o = APn(t)
      if (o !== null) {
        const i = r === '' ? o : o + sep + r
        if (isUyiSkip(i)) return e
        return i
      }
    }
    const n = dirname(t)
    if (n === t) return e
    r = r === '' ? basename(t) : basename(t) + sep + r
    t = n
  }
}

/** densable $6g / wco — cache of Uyi(root) for F6g. */
const SHORT_NAME_CACHE = new Map<string, string>()
const SHORT_NAME_CACHE_MAX = 64

/**
 * densable F6g — Windows 8.3 secondary containment: if either path expands
 * under short-name realpath to a form that casefold-contains the other root.
 */
function F6g(e: string | null, t: string | null): boolean {
  if (getPlatform() !== 'windows') return false
  if (e === null || t === null) return false
  const r = Uyi(e)
  let n = SHORT_NAME_CACHE.get(t)
  if (n === undefined) {
    n = Uyi(t)
    if (SHORT_NAME_CACHE.size >= SHORT_NAME_CACHE_MAX) SHORT_NAME_CACHE.clear()
    SHORT_NAME_CACHE.set(t, n)
  }
  if (r === e && n === t) return false
  return LRt(Cd(uat(r)), Cd(uat(n)))
}

/**
 * densable tKr — does target "touch" root (lexical or canonical containment)?
 * Unresolvable target → true (deny-side). Network target vs local root → true.
 * densable also ORs F6g(canonical, canonical) for Windows 8.3.
 */
export function pathTouchesRoot(
  target: CanonicalPath,
  root: CanonicalPath,
): boolean {
  if (isUnresolvable(target)) return true
  if (isUnresolvable(root)) {
    if (target.skipped) return true
    if (LRt(target.lexical, root.lexical)) return true
    if (target.canonical !== null && LRt(target.canonical, root.lexical)) {
      return true
    }
    if (
      root.surfaced !== undefined &&
      (LRt(target.lexical, root.surfaced) ||
        (target.canonical !== null && LRt(target.canonical, root.surfaced)))
    ) {
      return true
    }
    return false
  }
  if (target.skipped && !root.skipped) {
    logForDebugging(
      `bg-containment: denying network-shaped target against a local root: ${target.lexical}`,
      { level: 'warn' },
    )
    return true
  }
  if (target.skipped || root.skipped) {
    return LRt(target.lexical, root.lexical)
  }
  return (
    LRt(target.lexical, root.lexical) ||
    (target.canonical !== null &&
      root.canonical !== null &&
      LRt(target.canonical, root.canonical)) ||
    F6g(target.canonical, root.canonical)
  )
}

/** densable Cco — path is inside worktree (canonical when both resolved). */
export function pathInsideWorktree(
  target: CanonicalPath,
  worktree: CanonicalPath,
): boolean {
  if (isUnresolvable(target) || isUnresolvable(worktree)) return false
  if (target.skipped !== worktree.skipped) return false
  if (target.skipped) {
    return pathUnderRoot(target.lexical, worktree.lexical, false)
  }
  if (target.canonical === null || worktree.canonical === null) return false
  return pathUnderRoot(target.canonical, worktree.canonical, false)
}

/**
 * densable l9u — when file touches shared root but is not inside worktree,
 * classify as contained (block) / unresolvable / network.
 */
export function classifySharedContainment(
  file: CanonicalPath,
  shared: CanonicalPath,
): 'contained' | 'unresolvable' | 'network' {
  if (isUnresolvable(file)) return 'unresolvable'
  if (file.skipped && !shared.skipped && !isUnresolvable(shared)) {
    return 'network'
  }
  return 'contained'
}

/**
 * densable rKr — case-mismatch hint when casefold containment holds (tnr true)
 * but Cco (case-sensitive) already failed.
 */
function caseMismatchHint(
  fileCanonical: string | null,
  worktreeCanonical: string | null,
  worktreePath: string,
): string {
  if (fileCanonical === null || worktreeCanonical === null) return ''
  if (pathUnderRoot(fileCanonical, worktreeCanonical, true)) {
    return ` (this path differs from the registered spelling only by letter case — respell it to match ${worktreePath} exactly)`
  }
  return ''
}

function unresolvableMessage(worktreePath?: string): string {
  return worktreePath === undefined
    ? 'This write was blocked because the path is spelled in a form that cannot be safely resolved (for example through a symlink storing a raw dot segment, a network-share or device-namespace shape, or an unreadable ancestor directory). Retry the edit addressing the file by a direct, plainly-spelled path.'
    : `This write was blocked because the path is spelled in a form that cannot be safely resolved (for example through a symlink storing a raw dot segment, a network-share or device-namespace shape, or an unreadable ancestor directory). If the file is inside the worktree ${worktreePath}, address it by its direct symlink-free path instead.`
}

function networkMessage(worktreePath?: string): string {
  return worktreePath === undefined
    ? "This write was blocked because the path is network-shaped (a UNC share or /net automount spelling) while this session's checkout is local. Isolating cannot unblock it. If the file is genuinely local, retry the edit addressing it by its local, plainly-spelled path."
    : `This write was blocked because the path is network-shaped (a UNC share or /net automount spelling) while this session's checkout is local. Isolating cannot unblock it. If the file is genuinely inside the worktree ${worktreePath}, address it by its local, plainly-spelled path instead.`
}

/**
 * densable a9u — when writing under shared root but outside worktree → block.
 * Returns block message or null (allow).
 */
export function checkWorktreeIsolationWrite(
  filePath: string,
  sharedCheckout: string,
  worktreePath: string,
  kind: 'agent' | 'session',
): string | null {
  const file = canonicalizeForBgContainment(filePath)
  const shared = canonicalizeForBgContainment(sharedCheckout)
  if (!pathTouchesRoot(file, shared)) {
    return null
  }
  const wt = canonicalizeForBgContainment(worktreePath)
  if (pathInsideWorktree(file, wt)) {
    return null
  }
  const cls = classifySharedContainment(file, shared)
  if (cls === 'unresolvable') return unresolvableMessage(worktreePath)
  if (cls === 'network') return networkMessage(worktreePath)

  const hint = caseMismatchHint(file.canonical, wt.canonical, worktreePath)
  if (kind === 'agent') {
    return `This agent is isolated in the worktree ${worktreePath}. Edit the worktree copy of this file instead of the shared-checkout path.${hint}`
  }
  return `This session is now isolated in ${worktreePath}. Edit the worktree copy of this file instead of the shared-checkout path.${hint}`
}

/**
 * densable dge — path is already a git worktree (not main repo root).
 * densable: Ic(e) !== null && Zu(e) !== Ic(e)
 */
export function isGitWorktreeCheckout(dir: string): boolean {
  const gitRoot = findGitRoot(dir)
  if (gitRoot === null) return false
  const canonical = findCanonicalGitRoot(dir)
  if (canonical !== null && canonical !== gitRoot) {
    try {
      if (realpathSync(canonical) !== realpathSync(gitRoot)) return true
    } catch {
      if (canonical !== gitRoot) return true
    }
  }
  try {
    const realDir = realpathSync(dir)
    if (isClaudeWorktreesPath(dir) || isClaudeWorktreesPath(realDir)) {
      return true
    }
    const originalRoot = findGitRoot(getOriginalCwd())
    if (originalRoot && realpathSync(originalRoot) !== realpathSync(gitRoot)) {
      return true
    }
  } catch {
    if (isClaudeWorktreesPath(dir)) return true
  }
  return false
}

export type BgIsolationWriteContext = {
  agentId?: string
  /** densable agentWorktree — isolated agent worktree path. */
  agentWorktree?: string
}

/**
 * densable hsr — block writes that escape bg / worktree isolation.
 * Returns deny message or null.
 */
export function checkBgIsolationWriteBlock(
  filePath: string,
  ctx: BgIsolationWriteContext = {},
): string | null {
  // densable: agent worktree first (subagent isolation: "worktree")
  // densable: t.agentWorktree first; local fallback: cwd ALS under .claude/worktrees
  const agentWt =
    ctx.agentWorktree ??
    (() => {
      const ov = getCwdOverride()
      return ov && isClaudeWorktreesPath(ov) ? ov : undefined
    })()

  if (agentWt) {
    // densable a9u(e, sn(), agentWorktree) — shared root is originalCwd, not
    // the agent override cwd (which may already be the worktree).
    return checkWorktreeIsolationWrite(
      filePath,
      getOriginalCwd(),
      agentWt,
      'agent',
    )
  }

  // densable: SESSION_KIND!=="bg" && !zge() → null.
  // zge/aGh is inert in densable 2.1.217 pack; CLAUDE_JOB_DIR is the durable
  // job handle (Jtt fallback) so daemon workers with job dir still gate.
  const isBg = isBgSession()
  const hasJob = Boolean(process.env.CLAUDE_JOB_DIR)
  // densable also gates on jy() (EnterWorktree session) after the bg/zge check;
  // local: treat active EnterWorktree session even outside bg (stricter, safe).
  const session = getCurrentWorktreeSession()
  if (!isBg && !hasJob && !session) {
    return null
  }

  if (session) {
    return checkWorktreeIsolationWrite(
      filePath,
      session.originalCwd,
      session.worktreePath,
      'session',
    )
  }

  // Pre-isolation bg: must EnterWorktree before writing shared checkout
  if (resolveBgIsolationMode() === 'none') {
    return null
  }

  // densable: t.agentId ? sn() : Tt() — sn=originalCwd, Tt=getCwd() fallback sn
  const sharedRoot = ctx.agentId
    ? getOriginalCwd()
    : (() => {
        try {
          return getCwd()
        } catch {
          return getOriginalCwd()
        }
      })()
  const file = canonicalizeForBgContainment(filePath)
  const shared = canonicalizeForBgContainment(sharedRoot)
  if (!pathTouchesRoot(file, shared)) {
    return null
  }

  // densable: if not a git repo and no worktree hooks, skip (can't isolate)
  if (findGitRoot(sharedRoot) === null) {
    return null
  }
  // densable dge: already in a worktree → no pre-isolation block
  if (isGitWorktreeCheckout(sharedRoot) || isClaudeWorktreesPath(getCwd())) {
    return null
  }

  const cls = classifySharedContainment(file, shared)
  if (cls === 'unresolvable') return unresolvableMessage()
  if (cls === 'network') return networkMessage()

  if (ctx.agentId) {
    return `This subagent's parent bg session hasn't isolated yet, so writes to the shared checkout are blocked. Re-spawn this agent with \`isolation: "worktree"\`, or have the parent call ${ENTER_WORKTREE_TOOL_NAME} before spawning. (To disable this guard for this repo, set \`"worktree": {"bgIsolation": "none"}\` in .claude/settings.json.)`
  }
  return `This background session hasn't isolated its changes yet. Call ${ENTER_WORKTREE_TOOL_NAME} first so edits land in a worktree instead of the shared checkout, then retry this edit using the worktree path. (To disable this guard for this repo, set \`"worktree": {"bgIsolation": "none"}\` in .claude/settings.json.)`
}

/**
 * densable B6g — does git-root spelling match worktree lexical after platform normalize?
 */
function B6g(
  gitRoot: string | null,
  worktreeLexical: string,
  platform: PathPlatform = pathPlatform(),
): boolean {
  if (gitRoot === null) return false
  let n = platform === 'darwin' ? VPr(gitRoot) : gitRoot
  if (platform !== 'win32') n = GPr(n, platform)
  else n = uat(TPn(n))
  return n === worktreeLexical
}

export type CwdEscapeCheck = {
  dir: CanonicalPath
  worktree: CanonicalPath
  roots: CanonicalPath[]
  escaped: boolean
}

/**
 * densable qRu — cwd escapes worktree isolation if it touches any shared root
 * and is not inside the worktree.
 * roots: [Ic(sn)??sn, Zu(sn), (B6g(Ic(wt), wt.lexical) && dge(wt) ? Zu(wt) : null)]
 */
export function qRu(cwd: string, agentWorktree: string): CwdEscapeCheck {
  const dir = canonicalizeForBgContainment(cwd)
  const worktree = canonicalizeForBgContainment(agentWorktree)
  const sn = getOriginalCwd()
  const platform = pathPlatform()
  const gitOfSn = findGitRoot(sn)
  const canonicalOfSn = findCanonicalGitRoot(sn) ?? sn
  const gitOfWt = findGitRoot(agentWorktree)
  const includeWtCanonical =
    B6g(gitOfWt, worktree.lexical, platform) &&
    isGitWorktreeCheckout(agentWorktree)
  const rawRoots: Array<string | null> = [
    gitOfSn ?? sn,
    canonicalOfSn,
    includeWtCanonical ? findCanonicalGitRoot(agentWorktree) : null,
  ]
  const uniq = [...new Set(rawRoots.filter((l): l is string => l !== null))]
  const roots = uniq.map(l => canonicalizeForBgContainment(l))
  const escaped =
    roots.some(l => pathTouchesRoot(dir, l)) &&
    !pathInsideWorktree(dir, worktree)
  return { dir, worktree, roots, escaped }
}

/** densable nKr — qRu.escaped */
export function nKr(cwd: string, agentWorktree: string): boolean {
  return qRu(cwd, agentWorktree).escaped
}

/**
 * densable VRu — shell cwd gate for worktree-isolated agents.
 * Returns densable deny message or null.
 */
export function checkAgentWorktreeCwdEscape(
  cwd: string,
  agentWorktree: string,
): string | null {
  const r = qRu(cwd, agentWorktree)
  if (!r.escaped) return null
  if (isUnresolvable(r.dir)) {
    return `This command was blocked because its working directory is spelled in a form that cannot be safely resolved (for example through a symlink storing a raw dot segment, a network-share or device-namespace shape, or an unreadable ancestor directory). If the directory is inside the worktree ${agentWorktree}, re-run the command from its direct symlink-free path.`
  }
  if (r.dir.skipped && !r.roots.some(n => n.skipped || isUnresolvable(n))) {
    return `This command was blocked because its working directory is network-shaped (a UNC share or /net automount spelling) while the protected checkout is local. If the directory is genuinely inside the worktree ${agentWorktree}, re-run the command from its local, plainly-spelled path.`
  }
  const hint = caseMismatchHint(
    r.dir.canonical,
    r.worktree.canonical,
    agentWorktree,
  )
  return `This agent is isolated in the worktree ${agentWorktree}, but this command's working directory resolved to the shared checkout (${cwd}). Refusing to run it there — commands from a worktree-isolated agent must run inside its worktree. Re-run the command from ${agentWorktree}.${hint}`
}

/**
 * densable worktree_gone recovery refuse when the only recovery target is
 * the parent shared checkout (se===0 → sn()).
 */
export function checkAgentWorktreeGoneRecovery(
  goneCwd: string,
  agentWorktree: string,
): string {
  return `This agent is isolated in the worktree ${agentWorktree}, but its working directory "${goneCwd}" no longer exists and the only recovery target is the parent session's shared checkout. Refusing to run there — the isolation worktree appears to have been removed. Report this instead of retrying.`
}

/**
 * densable relative check used by job filters — realpath-aware path under root.
 * Exported for tests / sessionStore callers.
 */
export function isPathInsideCanonicalRoot(path: string, root: string): boolean {
  const p = canonicalizeForBgContainment(path)
  const r = canonicalizeForBgContainment(root)
  if (p.canonical && r.canonical) {
    const rel = relative(r.canonical, p.canonical)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }
  return pathUnderRoot(p.lexical, r.lexical)
}
