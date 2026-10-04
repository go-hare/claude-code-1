/**
 * densable plugin-eval POSIX ancestry walker `k3`/`fh`/`de`/`Mn`.
 * Gold SEA `function k3(e,n,r,i)` @175645325. Ny @193058305 calls
 * `k3(fh, n, {anchors, surfaceNetworkRaw:true, unreadableAncestry:"unverified"})`.
 * First minify `k3n` @178682193 is OAuth — skip that name.
 */

import { constants as fsConstants } from 'fs'
import { lstat, open, readlink } from 'fs/promises'
import * as d from 'path'
import { getErrnoCode } from '../../errors.js'

/** densable `Uh`. */
export const UNVERIFIED_ANCESTRY = '\0unverified-ancestry'
/** densable `PBt`. */
export const OPAQUE_LINK_TEXT = '\0opaque-link-text'

const z = d.sep

export type AncestryFs = {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>
  openDirNoFollow(path: string): Promise<void>
  readlink(path: string): Promise<string>
}

export type AncestryOutcome =
  | { kind: 'resolved'; path: string }
  | { kind: 'absent'; at: string; remaining: string[] }

export type AncestryOptions = {
  anchors?: string[]
  anchor?: string
  surfaceNetworkRaw?: boolean
  unreadableAncestry?: 'unverified'
  literalLinkText?: 'opaque'
  launchAncestry?: string | null
  onOutcome?: (h: AncestryOutcome) => void
  onCollapsedLanding?: (landed: string) => void
  onHop?: (h: { composed: string; leaf: boolean; text: string }) => void
}

type Step =
  | { kind: 'lstat'; path: string }
  | { kind: 'opendirNofollow'; path: string }
  | { kind: 'readlink'; path: string }

type Errno = { errno: string }

/** densable `fh` subset used by Ny. */
export const pluginEvalFs: AncestryFs = {
  async lstat(path) {
    return lstat(path)
  },
  async openDirNoFollow(path) {
    const handle = await open(
      path,
      fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    )
    await handle.close()
  },
  async readlink(path) {
    return readlink(path)
  },
}

function errnoOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'errno' in error) {
    const value = (error as { errno?: unknown }).errno
    if (typeof value === 'string') return value
  }
  return getErrnoCode(error)
}

/** densable `Gh`. */
function hasDotDot(path: string): boolean {
  return /(^|[\\/])\.\.([\\/]|$)/.test(path)
}

/** densable `ol`. */
function hasDotish(path: string): boolean {
  return /(^|[\\/])\.{1,2}[. ]*([\\/]|$)/.test(path)
}

/** densable `Ln`. */
function isUncSpelling(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

/** densable `C`. */
function isNetHostShape(parts: string[]): boolean {
  const first = (parts[0] ?? '').toLowerCase()
  const second = (parts[1] ?? '').toLowerCase()
  return (
    (parts.length === 2 && first === 'net') ||
    (parts.length === 3 && first === 'network' && second === 'servers')
  )
}

/** densable `r9`. */
function automounterHost(path: string): string | null {
  if (!path.startsWith('/')) return null
  const parts: string[] = []
  for (const n of path.split('/')) {
    if (n === '' || n === '.') continue
    if (n === '..') {
      parts.pop()
      continue
    }
    parts.push(n)
    if (isNetHostShape(parts)) return n.toLowerCase()
  }
  return null
}

/** densable walker `Yi` / `Wi` / `J_e`. */
export function isAutomounterWalk(path: string): boolean {
  if (!path.startsWith('/')) return false
  const parts: string[] = []
  for (const n of path.split('/')) {
    if (n === '' || n === '.') continue
    if (n === '..') {
      parts.pop()
      continue
    }
    parts.push(n)
    if (isNetHostShape(parts)) return true
  }
  return false
}

/** densable walker `rb` — bare `/net`. */
export function isBareNetRoot(path: string): boolean {
  if (!path.startsWith('/')) return false
  const parts: string[] = []
  for (const n of path.split('/')) {
    if (n === '' || n === '.') continue
    if (n === '..') {
      parts.pop()
      continue
    }
    parts.push(n)
  }
  return parts.length === 1 && (parts[0] ?? '').toLowerCase() === 'net'
}

/** densable `TN` / `Uk`. */
export function isMacNetworkPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  const parts: string[] = []
  for (const n of path.split('/')) {
    if (n === '' || n === '.') continue
    if (n === '..') {
      parts.pop()
      continue
    }
    parts.push(n)
    if (parts.length === 1 && (parts[0] ?? '').toLowerCase() === 'network') {
      return true
    }
  }
  return false
}

/** densable `F_`. */
export function isDarwinHiddenVolPath(path: string): boolean {
  if (!/\/\.(?:vol|file|nofollow|resolve)(?:\/|$)/i.test(path)) return false
  if (!path.startsWith('/')) return false
  const parts: string[] = []
  for (const n of path.split('/')) {
    if (n === '' || n === '.') continue
    if (n === '..') {
      parts.pop()
      continue
    }
    parts.push(n)
    if (parts.length === 1 && /^\.(?:vol|file|nofollow|resolve)$/i.test(n)) {
      return true
    }
  }
  return false
}

/** densable `Il` — real WSL distro UNC (`\\wsl$\Ubuntu\…`), not dotted/empty host. */
export function isWslDistroUnc(path: string): boolean {
  const m = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]*)/i.exec(path)
  if (m === null) return false
  return !/^\.{0,2}[. ]*$/.test(m[1] ?? '')
}

/** densable dotted/empty WSL host (`\\wsl$\.` / `\\wsl$\..`). */
export function isDottedWslUnc(path: string): boolean {
  const m = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]*)/i.exec(path)
  if (m === null) return false
  return /^\.{0,2}[. ]*$/.test(m[1] ?? '')
}

/** densable walker `ns` = UNC && !Il. */
function isNetworkUnc(path: string): boolean {
  return isUncSpelling(path) && !isWslDistroUnc(path)
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** densable `$e`. */
function isUnder(path: string, root: string): boolean {
  const a = stripTrailingSlash(path)
  const b = stripTrailingSlash(root)
  return a === b || a.startsWith(b === '/' ? b : `${b}/`)
}

/** densable `n9`. */
function uncForeignTo(path: string, anchor: string): boolean {
  if (!isUncSpelling(path)) return false
  if (/^[\\/]{2}[?.][\\/]/.test(path)) return true
  if (hasDotish(path)) return true
  const host = path.match(/^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)/i)?.[1]
  const other = anchor.match(/^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)/i)?.[1]
  return (
    host === undefined || host.toLowerCase() !== (other ?? '').toLowerCase()
  )
}

/** densable `iO`. */
function isForeignToAnchor(path: string, anchor: string): boolean {
  if (isDarwinHiddenVolPath(path)) return true
  if (isAutomounterWalk(path)) {
    const host = automounterHost(path)
    if (host === null || host !== automounterHost(anchor)) return true
  }
  return uncForeignTo(path, anchor)
}

/**
 * densable `_i(path, anchor)` — UNC / automount / darwin hidden-vol foreign
 * to the eval anchor. Ny uses this, not path.resolve prefix.
 */
export function isNyForeignToAnchor(path: string, anchor: string): boolean {
  const resolved = d.resolve(anchor, path)
  for (const candidate of [path, resolved]) {
    if (isDarwinHiddenVolPath(candidate)) return true
    if (isMacNetworkPath(candidate) || isBareNetRoot(candidate)) return true
    if (isForeignToAnchor(candidate, anchor)) return true
  }
  return false
}

/** densable `ae`. */
function dotDotEscapes(path: string, anchors: string[] | undefined): boolean {
  return (
    anchors !== undefined &&
    anchors.some(
      a =>
        isUncSpelling(a) &&
        !isForeignToAnchor(path, a) &&
        (isUnder(path, a) || isAutomounterWalk(path)),
    )
  )
}

/** densable `Et`. */
function anchorUnderPath(path: string, anchors: string[] | undefined): boolean {
  return (
    anchors !== undefined &&
    anchors.some(a => isUncSpelling(a) && isUnder(a, path))
  )
}

/** densable `M`. */
function allAnchorsAllowAutomount(
  path: string,
  anchors: string[] | undefined,
): boolean {
  return anchors === undefined || anchors.every(a => isForeignToAnchor(path, a))
}

/** densable `le`. */
function allAnchorsAllowUnc(
  path: string,
  anchors: string[] | undefined,
): boolean {
  return anchors === undefined || anchors.every(a => uncForeignTo(path, a))
}

/** densable `ue`. */
function joinRemaining(
  prefix: string,
  rest: string[],
  onCollapsed?: (landed: string) => void,
): string {
  const dotted = hasDotDot(prefix)
  if (rest.length === 0 || dotted || rest.some(s => s === '.' || s === '..')) {
    if (onCollapsed !== undefined && (rest.length > 0 || dotted)) {
      onCollapsed(d.join(prefix, ...rest))
    }
    return dotted ? stripTrailingSlash(d.join(prefix)) : prefix
  }
  return d.join(prefix, ...rest)
}

/** densable `Ot`. */
function optionAnchors(
  options: AncestryOptions | undefined,
): string[] | undefined {
  if (options?.anchors !== undefined && options.anchors.length > 0) {
    return options.anchors
  }
  if (options?.anchor !== undefined) return [options.anchor]
  return undefined
}

/** densable `xt`. */
function unverifiedOnError(
  error: unknown,
  options: AncestryOptions | undefined,
  hopped: boolean,
  restDotish: boolean,
  firstTrailing: boolean,
): string | undefined {
  if (options?.unreadableAncestry !== 'unverified') return undefined
  const code = errnoOf(error)
  if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
  if (code === 'ENAMETOOLONG' && !hopped && !restDotish && !firstTrailing) {
    return undefined
  }
  return UNVERIFIED_ANCESTRY
}

/** densable `vt`. */
function collapseUncRemainder(
  composed: string,
  anchors: string[] | undefined,
  onCollapsed?: (landed: string) => void,
): string | undefined {
  const host = isAutomounterWalk(composed) ? automounterHost(composed) : null
  if (host === null || !allAnchorsAllowAutomount(host, anchors))
    return undefined
  const joined = d.join(composed)
  if (
    isAutomounterWalk(joined) &&
    automounterHost(joined) === automounterHost(host)
  ) {
    return joined
  }
  return joinRemaining(composed, [], onCollapsed)
}

function* walkSteps(
  path: string,
  options: AncestryOptions | undefined,
): Generator<Step, string | undefined, unknown> {
  const anchors = optionAnchors(options)
  if (hasDotDot(path) && !dotDotEscapes(path, anchors)) return path
  if (
    (isNetworkUnc(path) && allAnchorsAllowUnc(path, anchors)) ||
    (isAutomounterWalk(path) && allAnchorsAllowAutomount(path, anchors))
  ) {
    return undefined
  }
  const resolved = d.resolve(path)
  const parsed = d.parse(resolved)
  let prefix = parsed.root
  let rest = resolved.slice(parsed.root.length).split(z).filter(Boolean)
  let hops = 0
  let launched = false
  let examined = false
  let seen: Set<string> | undefined
  const hopCap = 64
  const restDotish = () => rest.some(s => hasDotish(s))
  const firstTrailing = () => /[. ]$/.test(rest[0] ?? '')

  while (rest.length > 0 && hops < hopCap) {
    if (launched && hasDotish(rest[0] ?? '')) return UNVERIFIED_ANCESTRY
    const here = d.join(prefix, rest[0] ?? '')
    if (
      (isAutomounterWalk(here) && allAnchorsAllowAutomount(here, anchors)) ||
      (hasDotDot(here) &&
        !(dotDotEscapes(here, anchors) || anchorUnderPath(here, anchors)))
    ) {
      return joinRemaining(here, rest.slice(1), options?.onCollapsedLanding)
    }
    if (isDarwinHiddenVolPath(here)) {
      if (
        options?.surfaceNetworkRaw === true ||
        options?.unreadableAncestry === 'unverified'
      ) {
        return UNVERIFIED_ANCESTRY
      }
      return joinRemaining(here, rest.slice(1), options?.onCollapsedLanding)
    }
    const devFd = here !== '/dev/fd' && isUnder(here, '/dev/fd')
    if (
      devFd &&
      d.dirname(here) === '/dev/fd' &&
      rest.some((v, i) => i > 0 && (v === '..' || v === '.'))
    ) {
      rest.shift()
      while (rest[0] === '.' && rest.length > 1) rest.shift()
      prefix = here
      continue
    }
    const st = (
      devFd ? { errno: 'ENOENT' } : yield { kind: 'lstat', path: here }
    ) as { isSymbolicLink(): boolean } | Errno | string | undefined
    if (
      st === undefined ||
      typeof st === 'string' ||
      (typeof st === 'object' && 'errno' in st)
    ) {
      const err =
        typeof st === 'object' && st !== null && 'errno' in st ? st : undefined
      if (
        err !== undefined &&
        err.errno !== 'ENOENT' &&
        err.errno !== 'ENOTDIR' &&
        err.errno !== 'ENAMETOOLONG'
      ) {
        const opened = yield { kind: 'opendirNofollow', path: here }
        if (typeof opened === 'string') {
          examined = true
          rest.shift()
          prefix = here
          continue
        }
      }
      if (
        options?.launchAncestry &&
        !examined &&
        err !== undefined &&
        (err.errno === 'EPERM' || err.errno === 'EACCES') &&
        isUnder(here, options.launchAncestry)
      ) {
        launched = true
        rest.shift()
        prefix = here
        continue
      }
      if (
        err !== undefined &&
        (err.errno === 'ENOENT' || err.errno === 'ENOTDIR')
      ) {
        options?.onOutcome?.({
          kind: 'absent',
          at: prefix,
          remaining: [...rest],
        })
      }
      return unverifiedOnError(
        err,
        options,
        hops > 0,
        restDotish(),
        firstTrailing(),
      )
    }
    examined = true
    if (!st.isSymbolicLink()) {
      rest.shift()
      prefix = here
      continue
    }
    hops++
    const key = `${here}\0${rest.join('\0')}`
    seen ??= new Set()
    if (seen.has(key)) return undefined
    seen.add(key)
    const text = yield { kind: 'readlink', path: here }
    if (typeof text !== 'string') {
      return unverifiedOnError(
        text,
        options,
        hops > 0,
        restDotish(),
        firstTrailing(),
      )
    }
    if (options?.literalLinkText === 'opaque' && hasDotish(text)) {
      return OPAQUE_LINK_TEXT
    }
    if (!d.isAbsolute(text)) {
      const segs = text.split(z).filter(Boolean)
      if (options?.surfaceNetworkRaw === true) {
        const composed =
          (prefix.endsWith(d.sep) ? prefix : prefix + d.sep) +
          [...segs, ...rest.slice(1)].join(d.sep)
        const collapsed = collapseUncRemainder(
          composed,
          anchors,
          options?.onCollapsedLanding,
        )
        if (collapsed !== undefined) return collapsed
      }
      rest.shift()
      options?.onHop?.({
        composed: d.resolve(prefix, text, ...rest),
        leaf: rest.length === 0,
        text,
      })
      rest = [...segs, ...rest]
      continue
    }
    if (
      options?.surfaceNetworkRaw === true &&
      rest.length > 1 &&
      isNetworkUnc(text)
    ) {
      const collapsed = collapseUncRemainder(
        [text, ...rest.slice(1)].join(d.sep),
        anchors,
        options?.onCollapsedLanding,
      )
      if (collapsed !== undefined) return collapsed
    }
    if (
      (isNetworkUnc(text) && allAnchorsAllowUnc(text, anchors)) ||
      (isAutomounterWalk(text) && allAnchorsAllowAutomount(text, anchors)) ||
      (hasDotDot(text) &&
        !(
          dotDotEscapes(text, anchors) ||
          (rest.length > 1 && anchorUnderPath(text, anchors))
        ))
    ) {
      rest.shift()
      return joinRemaining(text, rest, options?.onCollapsedLanding)
    }
    if (
      options?.surfaceNetworkRaw === true &&
      hasDotish(text) &&
      (isNetworkUnc(text) ||
        isAutomounterWalk(text) ||
        isUncSpelling(text) ||
        isBareNetRoot(text))
    ) {
      rest.shift()
      return rest.length === 0 ? text : `${text}${d.sep}${rest.join(d.sep)}`
    }
    rest.shift()
    options?.onHop?.({
      composed: rest.length === 0 ? text : d.resolve(text, ...rest),
      leaf: rest.length === 0,
      text,
    })
    const root = d.parse(text).root || d.sep
    prefix = root
    examined = false
    rest = [...text.slice(root.length).split(z).filter(Boolean), ...rest]
  }
  if (rest.length > 0 && options?.literalLinkText === 'opaque') {
    return OPAQUE_LINK_TEXT
  }
  if (rest.length > 0) return UNVERIFIED_ANCESTRY
  if (hops > 0 && isNetworkUnc(prefix)) return prefix
  if (hasDotDot(prefix) && !dotDotEscapes(prefix, anchors)) return prefix
  if (rest.length === 0)
    options?.onOutcome?.({ kind: 'resolved', path: prefix })
  return undefined
}

/**
 * densable `k3(fs, path, options, signal)`.
 */
export async function walkPluginEvalAncestry(
  fsImpl: AncestryFs,
  path: string,
  options?: AncestryOptions,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const gen = walkSteps(path, options)
  let sent: unknown
  for (;;) {
    const step = gen.next(sent)
    if (step.done) return step.value
    if (signal?.aborted === true) return UNVERIFIED_ANCESTRY
    try {
      if (step.value.kind === 'lstat') {
        sent = await fsImpl.lstat(step.value.path)
      } else if (step.value.kind === 'opendirNofollow') {
        await fsImpl.openDirNoFollow(step.value.path)
        sent = 'ok'
      } else {
        sent = await fsImpl.readlink(step.value.path)
      }
    } catch (error) {
      sent = { errno: errnoOf(error) ?? 'EIO' }
    }
  }
}

/** densable `_i` subset for Ny extra-anchor network reach. */
export function isNetworkReachingForAnchor(
  path: string,
  anchor: string,
): boolean {
  const resolved = d.resolve(anchor, path)
  if (uncForeignTo(path, anchor) || uncForeignTo(resolved, anchor)) return true
  const host = automounterHost(anchor)
  for (const spelling of [path, resolved]) {
    if (isAutomounterWalk(spelling)) {
      const other = automounterHost(spelling)
      if (other === null || other !== host) return true
    }
    if (
      isMacNetworkPath(spelling) ||
      isBareNetRoot(spelling) ||
      isDarwinHiddenVolPath(spelling)
    ) {
      return true
    }
  }
  return false
}
