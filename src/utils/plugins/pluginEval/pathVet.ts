/**
 * densable plugin-eval `Ny` — refuse automounter / UNC / unexaminable
 * repo-authored paths before walking them.
 *
 * Gold `Ny(e, t, r, i=[])` at SEA 193058305. First gold `Ny` @178502334 is a
 * session-store helper — skip that name. Ancestry walk is gold `k3(fh, …)`.
 */

import { resolve } from 'path'
import {
  isNyForeignToAnchor,
  pluginEvalFs,
  UNVERIFIED_ANCESTRY,
  walkPluginEvalAncestry,
} from './pathAncestry.js'

export class PluginEvalPathError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'PluginEvalPathError'
    this.code = code
  }
}

/** densable `n1` — /net, /net/<host>, macOS /Network, /home map dirs. */
export function isAutomounterMapDir(path: string): boolean {
  if (!path.startsWith('/')) return false
  const parts = path.split('/').filter(p => p !== '' && p !== '.')
  if (parts.length < 1 || parts.length > 3 || parts.includes('..')) return false
  const first = (parts[0] ?? '').toLowerCase()
  if (first === 'net') return parts.length <= 2
  if (first === 'network') return parts.length <= 2
  return first === 'home' && parts.length === 1
}

/** densable `Yi` — spelling walks into /net or /Network. */
export function isAutomounterPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  const parts: string[] = []
  for (const n of path.split('/')) {
    if (n === '' || n === '.') continue
    if (n === '..') {
      parts.pop()
      continue
    }
    parts.push(n)
    const head = (parts[0] ?? '').toLowerCase()
    if (head === 'net' || head === 'network') return true
  }
  return false
}

/** densable `Il` — real WSL distro UNC. */
export function isWslDistroUnc(path: string): boolean {
  const m = /^[/\\]{2}wsl(?:\$|\.localhost)[/\\]([^/\\]*)/i.exec(path)
  if (m === null) return false
  return !/^\.{0,2}[. ]*$/.test(m[1] ?? '')
}

/** densable dotted/empty WSL host. */
export function isDottedWslUnc(path: string): boolean {
  const m = /^[/\\]{2}wsl(?:\$|\.localhost)[/\\]([^/\\]*)/i.exec(path)
  if (m === null) return false
  return /^\.{0,2}[. ]*$/.test(m[1] ?? '')
}

/** densable `rb`. */
export function isUncPath(path: string): boolean {
  if (path.startsWith('\\\\?\\')) return false
  return /^[/\\]{2}[^/\\]+/.test(path)
}

/** densable `Pf`. */
export function isNetworkReachingPath(path: string): boolean {
  return isAutomounterPath(path) || isUncPath(path) || isDottedWslUnc(path)
}

function displayPath(rel: string): string {
  return rel.replaceAll('\\', '/')
}

/** densable `Ya` — characters that cannot be scoped in a permission rule. */
const EVAL_PATH_UNSAFE_CHARS = /[()[\]{}*?!#\\]/

/**
 * densable `On` @212231087 — refuse whitespace / UNC / unsafe chars before
 * interpolating a path into Write(dir/**) deny rules.
 */
export function assertEvalPathScopable(path: string, surface: string): void {
  for (const segment of path.split(/[/\\]/)) {
    if (segment !== segment.trim()) {
      throw new PluginEvalPathError(
        `${surface} directory name "${displayPath(segment)}" starts or ends with whitespace, which cannot be scoped safely in a permission rule — rename it`,
        'eval path segment has edge whitespace',
      )
    }
  }
  const folded =
    process.platform === 'win32' ? path.replaceAll('\\', '/') : path
  if (folded.startsWith('//')) {
    throw new PluginEvalPathError(
      `${surface} is on a network (UNC) path, which cannot be scoped — run the evaluation from a local checkout`,
      'eval path is UNC',
    )
  }
  if (EVAL_PATH_UNSAFE_CHARS.test(folded)) {
    const bad =
      folded.split('/').find(s => EVAL_PATH_UNSAFE_CHARS.test(s)) ?? ''
    throw new PluginEvalPathError(
      `${surface} directory name "${displayPath(bad)}" contains a character that cannot be scoped safely in a permission rule (one of ( ) [ ] { } * ? ! # or a backslash) — rename it`,
      'eval path unsafe for permission rule',
    )
  }
}

/**
 * densable `Ny(base, rel, surface, extraAnchors=[])`.
 */
export async function vetPluginEvalPath(
  base: string,
  rel: string,
  surface: string,
  extraAnchors: string[] = [],
): Promise<void> {
  const resolved = resolve(base, rel)
  const shown = displayPath(rel)
  const anchors = [base, ...extraAnchors]
  if (
    (isAutomounterPath(rel) && !isAutomounterMapDir(rel)) ||
    (isAutomounterPath(resolved) && !isAutomounterMapDir(resolved))
  ) {
    throw new PluginEvalPathError(
      `${surface}: ${shown} is an automounter path (macOS /Network, or the bare /net root) — refusing it (a lookup there is a network request)`,
      'plugin eval: a repo-authored path is an automounter path — refusing it',
    )
  }
  // gold `p = Il(n) || Il(t) && !_i(n, e)`
  const skipNetwork =
    isWslDistroUnc(resolved) ||
    (isWslDistroUnc(rel) && !isNyForeignToAnchor(resolved, base))
  // gold `_i(t, e) && extra.every(h => _i(n, h)) && !p`
  if (
    isNyForeignToAnchor(rel, base) &&
    extraAnchors.every(h => isNyForeignToAnchor(resolved, h)) &&
    !skipNetwork
  ) {
    throw new PluginEvalPathError(
      `${surface}: ${shown} is a network-reaching path (UNC / automount) — refusing it`,
      'plugin eval: a repo-authored path is network-reaching — refusing it',
    )
  }
  let landed: string | undefined
  const y = await walkPluginEvalAncestry(pluginEvalFs, resolved, {
    anchors,
    surfaceNetworkRaw: true,
    unreadableAncestry: 'unverified',
    onOutcome: h => {
      if (h.kind === 'resolved') landed = h.path
    },
  })
  if (y === UNVERIFIED_ANCESTRY) {
    throw new PluginEvalPathError(
      `${surface}: ${shown} passes through a component that cannot be examined (unreadable, a link or junction whose target does not exist, or a symlink chain too long to follow) — refusing it (it could not be vetted)`,
      'plugin eval: a repo-authored path has an unexaminable component — refusing it',
    )
  }
  if (y !== undefined) {
    throw new PluginEvalPathError(
      `${surface}: ${shown} passes through a symlink to a network-reaching path (or a dotted one that cannot be vetted) — refusing it`,
      'plugin eval: a repo-authored path links to a network-reaching path — refusing it',
    )
  }
  if (landed !== undefined && isAutomounterMapDir(landed)) {
    throw new PluginEvalPathError(
      `${surface}: ${shown} leads to an automounter map directory (/net, /net/<host>; macOS /Network, /home) — refusing it (naming anything in it asks the automounter or a host)`,
      'plugin eval: a repo-authored path lands on an automounter map directory — refusing it',
    )
  }
}
