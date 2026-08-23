/**
 * densable 2.1.238 isolation worktree pin validator (`ODt` / `Ezd` / `yXo`).
 *
 * Refuses a path as an isolation worktree when git's resolved working tree is
 * elsewhere (`core.worktree` redirect / checkout discovered above it), when
 * git metadata aliases another repo's refs, or when the pin is the session's
 * own launch tree / protected checkout.
 *
 * Path compare is SEA `FZ`/`Dft`/`XFr`/`h8` via bgIsolationContainment
 * (`canonicalizeForBgContainment` / `pathTouchesRoot` / `pathInsideWorktree` /
 * `isUnresolvableCanonical`) — lazy-required to avoid worktree.ts cycles.
 */

import { spawnSync } from 'child_process'
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from 'fs'
import { lstat, open as openAsync, readdir } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { uniq } from './array.js'
import type { CanonicalPath } from './bgIsolationContainment.js'
import { getErrnoCode } from './errors.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { findCanonicalGitRoot, findGitRoot, gitExe } from './git.js'

const PIN_GIT_TIMEOUT_MS = 2000
const GITDIR_BACKPOINTER_CAP = 65536
const REF_SCAN_MAX_DEPTH = 12
const REF_SCAN_MAX_ENTRIES = 4096

/** densable `da` — neutralize hooks/fsmonitor for identity probes. */
const GIT_SAFE_FLAGS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=',
] as const

const REV_PARSE_IDENTITY = [
  ...GIT_SAFE_FLAGS,
  'rev-parse',
  '--absolute-git-dir',
  '--show-toplevel',
  '--git-common-dir',
] as const

const REV_PARSE_BARE = [
  ...GIT_SAFE_FLAGS,
  'rev-parse',
  '--absolute-git-dir',
  '--git-common-dir',
] as const

/** densable `kUo` subset + GIT_CONFIG_{KEY,VALUE}_N (bh). */
const GIT_SCRUB_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_SHALLOW_FILE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
] as const

const GIT_CONFIG_KV = /^GIT_CONFIG_(KEY|VALUE)_\d+$/i

export type IsolationPinOkReason = 'verified' | 'not-a-git-worktree'

export type IsolationPinFailReason =
  | 'unverifiable'
  | 'pin-is-protected-checkout'
  | 'pin-is-own-launch-tree'
  | 'invalid-linked-worktree'
  | 'work-tree-elsewhere'
  | 'shared-git-dir'

export type IsolationPinResult =
  | { ok: true; reason: IsolationPinOkReason }
  | { ok: false; reason: IsolationPinFailReason; message: string }

export type IsolationGitIds = {
  gitDir: string
  topLevel: string
  commonDir: string
  isBare?: boolean
  backPointer: string | null
  symlinkedRefStore: string[]
  unexaminableRefStore: string[]
}

export type IsolationPinProbe = {
  entry: 'present' | 'absent' | 'unverifiable'
  ids: IsolationGitIds | 'error' | 'no-repo'
}

export type IsolationPinProbeAtRoot = IsolationPinProbe & { root: string }

export type IsolationPinOptions = {
  requireWitnessForSelfOwningPins?: boolean
  declineSelfOwningPinUnderLiveRoot?: boolean
}

type PathCompare = 'same' | 'distinct' | 'indeterminate'

type ContainmentFns = {
  canonicalizeForBgContainment: (raw: string) => CanonicalPath
  isUnresolvableCanonical: (c: CanonicalPath) => boolean
  pathTouchesRoot: (target: CanonicalPath, root: CanonicalPath) => boolean
  pathInsideWorktree: (
    target: CanonicalPath,
    worktree: CanonicalPath,
  ) => boolean
}

let containmentFns: ContainmentFns | undefined

function containment(): ContainmentFns {
  if (!containmentFns) {
    // Lazy: bgIsolationContainment → worktree.ts → this module.
    const mod = require('./bgIsolationContainment.js') as ContainmentFns
    containmentFns = {
      canonicalizeForBgContainment: mod.canonicalizeForBgContainment,
      isUnresolvableCanonical: mod.isUnresolvableCanonical,
      pathTouchesRoot: mod.pathTouchesRoot,
      pathInsideWorktree: mod.pathInsideWorktree,
    }
  }
  return containmentFns
}

/** densable `Tg` — UNC-shaped and not WSL. */
function isUncNotWsl(path: string): boolean {
  return (
    /^[\\/]{2}/.test(path) && !/^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(path)
  )
}

/** densable `Bg` — `/net/<host>/...` automount spelling. */
function isNetAutomount(path: string): boolean {
  if (!path.startsWith('/')) return false
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
    if (parts.length === 2 && parts[0]!.toLowerCase() === 'net') return true
  }
  return false
}

function skipLiveDir(path: string | null | undefined): boolean {
  if (path === null || path === undefined) return true
  return isUncNotWsl(path) || isNetAutomount(path)
}

/**
 * densable `A9` — unique live-launch dirs from cwd (+ extras), dropping
 * UNC/`/net` spellings that cannot be pinned.
 */
export function liveLaunchDirs(
  cwd: string,
  ...extra: Array<string | null | undefined>
): string[] {
  if (skipLiveDir(cwd)) return []
  return uniq(
    [findGitRoot(cwd), findCanonicalGitRoot(cwd), ...extra].filter(
      (p): p is string => !skipLiveDir(p),
    ),
  )
}

/** densable `to` over live dirs, dropping UNC/`/net`. */
export function uniqueLiveRoots(
  paths: Array<string | null | undefined>,
): string[] {
  return uniq(paths.filter((p): p is string => !skipLiveDir(p)))
}

/** densable `Irt` — process cwd realpath at probe time. */
export function processLaunchCwd(): string {
  try {
    return realpathSync(process.cwd())
  } catch {
    return process.cwd()
  }
}

/** densable `K9g`. */
export function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** densable resume poison: hard refuse vs retryable unverifiable/own-launch. */
export function isHardIsolationPinRefuse(
  reason: IsolationPinFailReason,
): boolean {
  return reason !== 'unverifiable' && reason !== 'pin-is-own-launch-tree'
}

/** densable `JL` — C0 (U+0000–U+001F) + DEL + C1 (U+007F–U+009F). */
function isControlCharCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

export function sanitizePinMessage(message: string): string {
  let out = ''
  for (let i = 0; i < message.length; i++) {
    const ch = message[i]!
    out += isControlCharCode(ch.charCodeAt(0)) ? ' ' : ch
  }
  return out
}

/** densable `bh({LC_ALL:"C"})` for identity probes. */
function pinProbeEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const unset: NodeJS.ProcessEnv = {}
  for (const key of GIT_SCRUB_KEYS) unset[key] = undefined
  const extraUpper = new Set(Object.keys(extra ?? {}).map(k => k.toUpperCase()))
  for (const key of Object.keys(process.env)) {
    const upper = key.toUpperCase()
    if (
      GIT_SCRUB_KEYS.includes(upper as (typeof GIT_SCRUB_KEYS)[number]) ||
      GIT_CONFIG_KV.test(key) ||
      (extraUpper.has(upper) && extra && !(key in extra))
    ) {
      unset[key] = undefined
    }
  }
  return { ...process.env, ...unset, ...extra }
}

function envForSpawn(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

function spawnUtf8(out: string | Buffer | null | undefined): string {
  if (out == null) return ''
  return typeof out === 'string' ? out : out.toString('utf8')
}

function hasControlChars(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (isControlCharCode(line.charCodeAt(i))) return true
  }
  return false
}

function entryFromLstatError(err: unknown): 'absent' | 'unverifiable' {
  const code = getErrnoCode(err)
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unverifiable'
}

function isNotAGitRepository(stderr: string): boolean {
  return /not a git repository/i.test(stderr)
}

function mustRunInWorkTree(stderr: string): boolean {
  return stderr.includes('this operation must be run in a work tree')
}

/** densable `fje` — parent checkout of a `.claude/worktrees/<slug>` pin. */
function claudeWorktreeParentCheckout(pin: string): string | null {
  return basename(dirname(pin)) === 'worktrees' &&
    basename(dirname(dirname(pin))) === '.claude'
    ? dirname(dirname(dirname(pin)))
    : null
}

function FZ(path: string): CanonicalPath {
  return containment().canonicalizeForBgContainment(path)
}

function h8(c: CanonicalPath): boolean {
  return containment().isUnresolvableCanonical(c)
}

/** densable `Mzd` — bidirectional predicate → same/distinct/indeterminate. */
function Mzd(
  a: string,
  b: string,
  pred: (left: CanonicalPath, right: CanonicalPath) => boolean,
): PathCompare {
  const n = FZ(a)
  const o = FZ(b)
  if (h8(n) || h8(o)) return 'indeterminate'
  if (n.skipped !== o.skipped) return 'indeterminate'
  return pred(n, o) && pred(o, n) ? 'same' : 'distinct'
}

/** densable `Yke` — path equality (bidirectional XFr / pathInsideWorktree). */
function Yke(a: string, b: string): PathCompare {
  const { pathInsideWorktree } = containment()
  return Mzd(a, b, pathInsideWorktree)
}

/** densable `j1n` — bidirectional containment (Dft / pathTouchesRoot). */
function j1n(a: string, b: string): PathCompare {
  const { pathTouchesRoot } = containment()
  return Mzd(a, b, pathTouchesRoot)
}

/**
 * densable `U1n(e,t)` — fail-closed "e contains t".
 * Unresolvable / skipped-mismatch → true (refuse rather than assume).
 */
function U1n(container: string, inner: string): boolean {
  const r = FZ(container)
  const n = FZ(inner)
  if (h8(r) || h8(n)) return true
  if (r.skipped !== n.skipped) return true
  return containment().pathTouchesRoot(n, r)
}

/** densable `wzd` — pin is a registered `.claude/worktrees` child of commonDir's parent. */
function wzd(pin: string, commonDir: string): boolean {
  const parent = claudeWorktreeParentCheckout(pin)
  return parent !== null && j1n(parent, dirname(commonDir)) === 'same'
}

function x3e(pin: string, detail: string): IsolationPinResult {
  return {
    ok: false,
    reason: 'unverifiable',
    message: sanitizePinMessage(
      `Refusing to use ${pin} as an isolation worktree: ${detail}, so its git identity could not be verified. Isolation is refused rather than assumed — recreate the worktree (or remove the corrupt .git entry) and retry.`,
    ),
  }
}

function extraProbeRoots(
  _pin: string,
  live: string[],
  ids: IsolationGitIds,
): string[] {
  const n = basename(ids.commonDir) === '.git' ? dirname(ids.commonDir) : null
  return uniq([...live, ...(n !== null ? [n] : [])])
}

/**
 * densable `yXo` — judge a probed pin. Exported for unit tests with fake ids.
 */
export function evaluateIsolationWorktreePin(
  pin: string,
  probe: IsolationPinProbe,
  pinIsSymlink: boolean,
  allLive: string[],
  protectedSet: Set<string>,
  liveSet: Set<string>,
  extraProbes: IsolationPinProbeAtRoot[],
  requireWitnessForSelfOwningPins = false,
  declineSelfOwningPinUnderLiveRoot = false,
): IsolationPinResult {
  if (pinIsSymlink) {
    return x3e(
      pin,
      'it is a symbolic link, so the tree it would isolate into cannot be pinned down',
    )
  }
  if (probe.entry === 'unverifiable') {
    return x3e(pin, 'its .git entry exists but could not be examined')
  }
  const c = probe.ids
  if (c === 'error') {
    return x3e(pin, 'git could not be run to resolve it')
  }
  if (typeof c === 'object' && c.isBare === true) {
    return x3e(pin, 'it is a bare repository, not a working tree')
  }
  if (c === 'no-repo') {
    if (probe.entry !== 'absent') {
      return x3e(pin, 'a .git entry exists there but git could not resolve it')
    }
    for (const f of allLive) {
      if (!protectedSet.has(f)) continue
      if (U1n(pin, f)) {
        return {
          ok: false,
          reason: 'pin-is-protected-checkout',
          message: sanitizePinMessage(
            `Refusing to use ${pin} as an isolation worktree: it contains the protected checkout ${f}, so adopting it would disarm every isolation check for that checkout.`,
          ),
        }
      }
    }
    for (const f of liveSet) {
      if (U1n(pin, f)) {
        return {
          ok: false,
          reason: 'pin-is-own-launch-tree',
          message: sanitizePinMessage(
            `This resume was started from inside ${pin}, a non-git directory — nothing can confirm it as a separate isolation tree from there. Run the resume from the project checkout instead.`,
          ),
        }
      }
    }
    return { ok: true, reason: 'not-a-git-worktree' }
  }
  if (c.symlinkedRefStore.length > 0) {
    return {
      ok: false,
      reason: 'invalid-linked-worktree',
      message: sanitizePinMessage(
        `Refusing to use ${pin} as an isolation worktree: its git metadata has symbolic links in place of ${c.symlinkedRefStore.join(', ')}, which aliases another repository's refs into this tree. Recreate the worktree with git worktree add, then retry.`,
      ),
    }
  }
  if (c.unexaminableRefStore.length > 0) {
    return x3e(
      pin,
      `its ref storage could not be fully examined (${c.unexaminableRefStore[0]})`,
    )
  }
  const u = Yke(c.topLevel, pin)
  if (u === 'indeterminate') {
    return x3e(
      pin,
      `its working tree resolves to a path that cannot be safely compared (${c.topLevel})`,
    )
  }
  if (u === 'distinct') {
    return {
      ok: false,
      reason: 'work-tree-elsewhere',
      message: sanitizePinMessage(
        `Refusing to use ${pin} as an isolation worktree: git resolves its working tree to ${c.topLevel} (a core.worktree redirect, or a checkout discovered above it), so commands run there would write outside the worktree. Remove the redirect, restore the worktree's own .git, or recreate the worktree, then retry.`,
      ),
    }
  }
  const d = Yke(c.commonDir, c.gitDir) !== 'distinct'
  for (const f of extraProbes) {
    const m = allLive.includes(f.root)
    const h = j1n(f.root, pin)
    if (
      h !== 'same' &&
      liveSet.has(f.root) &&
      !protectedSet.has(f.root) &&
      U1n(pin, f.root)
    ) {
      if (!d && wzd(pin, c.commonDir)) continue
      if (!d) {
        return {
          ok: false,
          reason: 'pin-is-own-launch-tree',
          message: sanitizePinMessage(
            `The worktree ${pin} contains the directory this resume ran from, and nothing in this session vouches for its worktree registration — an isolation worktree never contains its own launch position. Run the resume from the project checkout instead.`,
          ),
        }
      }
      return {
        ok: false,
        reason: 'pin-is-own-launch-tree',
        message: sanitizePinMessage(
          `This resume was started from inside ${pin} (or a directory it contains), which is its own repository — it cannot be confirmed as a separate isolation worktree from there. Run the resume from the project checkout instead.`,
        ),
      }
    }
    if (h === 'same') {
      if (m && protectedSet.has(f.root)) {
        return {
          ok: false,
          reason: 'pin-is-protected-checkout',
          message: sanitizePinMessage(
            `Refusing to use ${pin} as an isolation worktree: it is the checkout this session launched from. An honest launch-from-inside and a forged record are indistinguishable here, so both are refused — launch from the parent checkout to enter or resume this worktree.`,
          ),
        }
      }
      if (m && d) {
        return {
          ok: false,
          reason: 'pin-is-own-launch-tree',
          message: sanitizePinMessage(
            `This resume was started from inside ${pin}, which is its own repository — it cannot be confirmed as a separate isolation worktree from there. Run the resume from the project checkout instead.`,
          ),
        }
      }
      continue
    }
    if (f.entry === 'unverifiable') {
      return x3e(
        pin,
        `the protected checkout ${f.root} has a .git entry that could not be examined`,
      )
    }
    if (typeof f.ids !== 'object') {
      if (f.ids === 'no-repo') continue
      return x3e(
        pin,
        `the protected checkout ${f.root} has git metadata that could not be resolved`,
      )
    }
    const g = j1n(c.gitDir, f.ids.gitDir)
    if (g === 'indeterminate') {
      return x3e(
        pin,
        `its git directory (${c.gitDir}) could not be safely compared with the protected checkout's`,
      )
    }
    if (g === 'same') {
      return {
        ok: false,
        reason: 'shared-git-dir',
        message: sanitizePinMessage(
          `Refusing to use ${pin} as an isolation worktree: its git directory is the shared checkout's own (${c.gitDir}), so git commands there move the protected checkout's branches and refs. This usually means the worktree's .git file is stale or was rewritten — recreate the worktree, then retry.`,
        ),
      }
    }
  }
  if (d && protectedSet.size === 0) {
    if (requireWitnessForSelfOwningPins) {
      return {
        ok: false,
        reason: 'pin-is-own-launch-tree',
        message: sanitizePinMessage(
          `The worktree ${pin} is its own repository and nothing vouches for it from this session — it cannot be resumed or re-entered. Re-create it (a fresh isolated tree); the existing tree and its work remain on disk at ${pin} for manual recovery.`,
        ),
      }
    }
    if (declineSelfOwningPinUnderLiveRoot) {
      for (const f of liveSet) {
        if (j1n(f, pin) !== 'same' && U1n(f, pin)) {
          return {
            ok: false,
            reason: 'pin-is-own-launch-tree',
            message: sanitizePinMessage(
              `The worktree ${pin} sits under the directory this resume ran from, and nothing else vouches for it — it cannot be resumed or re-entered. Re-create it (a fresh isolated tree); the existing tree and its work remain on disk at ${pin} for manual recovery. Where it has a parent checkout, resuming from there also works.`,
            ),
          }
        }
      }
    }
  }
  for (const f of allLive) {
    if (j1n(f, pin) === 'same') continue
    if (!U1n(pin, f)) continue
    if (liveSet.has(f) && !protectedSet.has(f)) {
      if (!d && wzd(pin, c.commonDir)) continue
      if (!d) {
        return {
          ok: false,
          reason: 'pin-is-own-launch-tree',
          message: sanitizePinMessage(
            `The worktree ${pin} contains the directory this resume ran from, and nothing in this session vouches for its worktree registration — an isolation worktree never contains its own launch position. Run the resume from the project checkout instead.`,
          ),
        }
      }
      return {
        ok: false,
        reason: 'pin-is-own-launch-tree',
        message: sanitizePinMessage(
          `This resume was started from inside ${pin} (or a directory it contains), which is its own repository — it cannot be confirmed as a separate isolation worktree from there. Run the resume from the project checkout instead.`,
        ),
      }
    }
    return {
      ok: false,
      reason: 'pin-is-protected-checkout',
      message: sanitizePinMessage(
        `Refusing to use ${pin} as an isolation worktree: it contains the protected checkout ${f}, so adopting it would disarm every isolation check for that checkout.`,
      ),
    }
  }
  const p = Yke(c.commonDir, c.gitDir)
  if (p === 'indeterminate') {
    return x3e(
      pin,
      `its git metadata (common dir ${c.commonDir}) could not be safely compared`,
    )
  }
  if (p === 'distinct') {
    const f = Yke(dirname(c.gitDir), join(c.commonDir, 'worktrees'))
    const m =
      c.backPointer !== null &&
      Yke(resolve(c.gitDir, c.backPointer), join(pin, '.git')) === 'same'
    if (f !== 'same' || !m) {
      return {
        ok: false,
        reason: 'invalid-linked-worktree',
        message: sanitizePinMessage(
          `Refusing to use ${pin} as an isolation worktree: it uses another repository's refs (${c.commonDir}) without being a registered worktree of it (its admin directory or back-pointer does not check out). Recreate the worktree with git worktree add, then retry.`,
        ),
      }
    }
  }
  return { ok: true, reason: 'verified' }
}

function parseBareIdentity(
  pin: string,
  stdout: string,
): IsolationGitIds | null {
  const lines = stdout.split('\n').filter(o => o.length > 0)
  if (lines.length !== 2) return null
  if (lines.some(hasControlChars)) return null
  const n = lines[1]!
  return {
    gitDir: lines[0]!,
    topLevel: pin,
    commonDir: isAbsolute(n) ? n : join(pin, n),
    isBare: true,
    backPointer: null,
    symlinkedRefStore: [],
    unexaminableRefStore: [],
  }
}

function parseWorktreeIdentity(
  pin: string,
  stdout: string,
): Omit<
  IsolationGitIds,
  'backPointer' | 'symlinkedRefStore' | 'unexaminableRefStore' | 'isBare'
> | null {
  const lines = stdout.split('\n').filter(o => o.length > 0)
  if (lines.length !== 3) return null
  if (lines.some(hasControlChars)) return null
  const n = lines[2]!
  return {
    gitDir: lines[0]!,
    topLevel: lines[1]!,
    commonDir: isAbsolute(n) ? n : resolve(pin, n),
  }
}

async function readGitdirBackPointer(gitDir: string): Promise<string | null> {
  try {
    const path = join(gitDir, 'gitdir')
    if (!(await lstat(path)).isFile()) return null
    const fh = await openAsync(path, 'r')
    try {
      if ((await fh.stat()).size > GITDIR_BACKPOINTER_CAP) return null
      const buf = Buffer.alloc(GITDIR_BACKPOINTER_CAP)
      const { bytesRead } = await fh.read(buf, 0, GITDIR_BACKPOINTER_CAP, 0)
      return buf.toString('utf-8', 0, bytesRead).trim()
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

function readGitdirBackPointerSync(gitDir: string): string | null {
  try {
    const path = join(gitDir, 'gitdir')
    if (!lstatSync(path).isFile()) return null
    const fd = openSync(path, 'r')
    try {
      if (fstatSync(fd).size > GITDIR_BACKPOINTER_CAP) return null
      const buf = Buffer.alloc(GITDIR_BACKPOINTER_CAP)
      const n = readSync(fd, buf, 0, GITDIR_BACKPOINTER_CAP, 0)
      return buf.toString('utf-8', 0, n).trim()
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

async function scanRefStore(
  gitDir: string,
): Promise<{ symlinks: string[]; unexaminable: string[] }> {
  const symlinks: string[] = []
  const unexaminable: string[] = []
  let names: string[]
  try {
    names = await readdir(gitDir)
  } catch (err) {
    if (entryFromLstatError(err) !== 'absent') {
      unexaminable.push('(git dir unreadable)')
    }
    names = []
  }
  if (names.length > REF_SCAN_MAX_ENTRIES) {
    unexaminable.push('(over-cap top-level entries)')
    names = []
  }
  await Promise.all(
    names.map(async name => {
      try {
        if ((await lstat(join(gitDir, name))).isSymbolicLink()) {
          symlinks.push(name)
        }
      } catch (err) {
        if (entryFromLstatError(err) !== 'absent') unexaminable.push(name)
      }
    }),
  )
  await scanRefsDir(join(gitDir, 'refs'), 'refs', 0, symlinks, unexaminable, {
    entries: REF_SCAN_MAX_ENTRIES,
  })
  return { symlinks, unexaminable }
}

async function scanRefsDir(
  dir: string,
  label: string,
  depth: number,
  symlinks: string[],
  unexaminable: string[],
  budget: { entries: number },
): Promise<void> {
  if (depth > REF_SCAN_MAX_DEPTH) {
    unexaminable.push(`${label} (too deep to examine)`)
    return
  }
  if (budget.entries <= 0) {
    unexaminable.push(`${label} (too many entries to examine)`)
    return
  }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    if (entryFromLstatError(err) !== 'absent') {
      unexaminable.push(`${label} (unreadable)`)
    }
    return
  }
  for (const name of names) {
    if (--budget.entries < 0) {
      unexaminable.push(`${label} (too many entries to examine)`)
      return
    }
    const child = join(dir, name)
    const childLabel = `${label}/${name}`
    try {
      const st = await lstat(child)
      if (st.isSymbolicLink()) {
        symlinks.push(childLabel)
      } else if (st.isDirectory()) {
        await scanRefsDir(
          child,
          childLabel,
          depth + 1,
          symlinks,
          unexaminable,
          budget,
        )
      }
    } catch (err) {
      if (entryFromLstatError(err) !== 'absent') {
        unexaminable.push(`${childLabel} (unreadable)`)
      }
    }
  }
}

function scanRefStoreSync(gitDir: string): {
  symlinks: string[]
  unexaminable: string[]
} {
  const symlinks: string[] = []
  const unexaminable: string[] = []
  let names: string[]
  try {
    names = readdirSync(gitDir)
  } catch (err) {
    if (entryFromLstatError(err) !== 'absent') {
      unexaminable.push('(git dir unreadable)')
    }
    names = []
  }
  if (names.length > REF_SCAN_MAX_ENTRIES) {
    unexaminable.push('(over-cap top-level entries)')
    names = []
  }
  for (const name of names) {
    try {
      if (lstatSync(join(gitDir, name)).isSymbolicLink()) {
        symlinks.push(name)
      }
    } catch (err) {
      if (entryFromLstatError(err) !== 'absent') unexaminable.push(name)
    }
  }
  scanRefsDirSync(join(gitDir, 'refs'), 'refs', 0, symlinks, unexaminable, {
    entries: REF_SCAN_MAX_ENTRIES,
  })
  return { symlinks, unexaminable }
}

function scanRefsDirSync(
  dir: string,
  label: string,
  depth: number,
  symlinks: string[],
  unexaminable: string[],
  budget: { entries: number },
): void {
  if (depth > REF_SCAN_MAX_DEPTH) {
    unexaminable.push(`${label} (too deep to examine)`)
    return
  }
  if (budget.entries <= 0) {
    unexaminable.push(`${label} (too many entries to examine)`)
    return
  }
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if (entryFromLstatError(err) !== 'absent') {
      unexaminable.push(`${label} (unreadable)`)
    }
    return
  }
  for (const name of names) {
    if (--budget.entries < 0) {
      unexaminable.push(`${label} (too many entries to examine)`)
      return
    }
    const child = join(dir, name)
    const childLabel = `${label}/${name}`
    try {
      const st = lstatSync(child)
      if (st.isSymbolicLink()) {
        symlinks.push(childLabel)
      } else if (st.isDirectory()) {
        scanRefsDirSync(
          child,
          childLabel,
          depth + 1,
          symlinks,
          unexaminable,
          budget,
        )
      }
    } catch (err) {
      if (entryFromLstatError(err) !== 'absent') {
        unexaminable.push(`${childLabel} (unreadable)`)
      }
    }
  }
}

async function gitEntryKind(
  pin: string,
): Promise<'present' | 'absent' | 'unverifiable'> {
  try {
    await lstat(join(pin, '.git'))
    return 'present'
  } catch (err) {
    return entryFromLstatError(err)
  }
}

function gitEntryKindSync(pin: string): 'present' | 'absent' | 'unverifiable' {
  try {
    lstatSync(join(pin, '.git'))
    return 'present'
  } catch (err) {
    return entryFromLstatError(err)
  }
}

async function pinIsSymlink(pin: string): Promise<boolean> {
  try {
    return (await lstat(pin)).isSymbolicLink()
  } catch {
    return false
  }
}

function pinIsSymlinkSync(pin: string): boolean {
  try {
    return lstatSync(pin).isSymbolicLink()
  } catch {
    return false
  }
}

async function pinPathMissing(pin: string): Promise<boolean> {
  try {
    await lstat(pin)
    return false
  } catch (err) {
    const code = getErrnoCode(err)
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}

function pinPathMissingSync(pin: string): boolean {
  try {
    lstatSync(pin)
    return false
  } catch (err) {
    const code = getErrnoCode(err)
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}

async function resolveGitIds(
  pin: string,
): Promise<IsolationGitIds | 'error' | 'no-repo'> {
  const env = pinProbeEnv({ LC_ALL: 'C' })
  const t = await execFileNoThrowWithCwd(gitExe(), [...REV_PARSE_IDENTITY], {
    cwd: pin,
    env,
    timeout: PIN_GIT_TIMEOUT_MS,
    preserveOutputOnError: true,
  })
  if (t.code !== 0) {
    if (await pinPathMissing(pin)) return 'no-repo'
    if (mustRunInWorkTree(t.stderr)) {
      const i = await execFileNoThrowWithCwd(gitExe(), [...REV_PARSE_BARE], {
        cwd: pin,
        env,
        timeout: PIN_GIT_TIMEOUT_MS,
        preserveOutputOnError: true,
      })
      if (i.code === 0) {
        const s = parseBareIdentity(pin, i.stdout)
        if (s !== null) {
          const [backPointer, refs] = await Promise.all([
            readGitdirBackPointer(s.gitDir),
            scanRefStore(s.gitDir),
          ])
          return {
            ...s,
            backPointer,
            symlinkedRefStore: refs.symlinks,
            unexaminableRefStore: refs.unexaminable,
          }
        }
      }
      return 'error'
    }
    return isNotAGitRepository(t.stderr) ? 'no-repo' : 'error'
  }
  const r = parseWorktreeIdentity(pin, t.stdout)
  if (r === null) return 'error'
  const [backPointer, refs] = await Promise.all([
    readGitdirBackPointer(r.gitDir),
    scanRefStore(r.gitDir),
  ])
  return {
    ...r,
    backPointer,
    symlinkedRefStore: refs.symlinks,
    unexaminableRefStore: refs.unexaminable,
  }
}

function resolveGitIdsSync(pin: string): IsolationGitIds | 'error' | 'no-repo' {
  const env = pinProbeEnv({ LC_ALL: 'C' })
  let t: ReturnType<typeof spawnSync>
  try {
    t = spawnSync(gitExe(), [...REV_PARSE_IDENTITY], {
      cwd: pin,
      env: envForSpawn(env),
      timeout: PIN_GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return 'error'
  }
  const stderr = spawnUtf8(t.stderr)
  const stdout = spawnUtf8(t.stdout)
  if (t.status !== 0) {
    if (pinPathMissingSync(pin)) return 'no-repo'
    if (mustRunInWorkTree(stderr)) {
      let o: ReturnType<typeof spawnSync>
      try {
        o = spawnSync(gitExe(), [...REV_PARSE_BARE], {
          cwd: pin,
          env: envForSpawn(env),
          timeout: PIN_GIT_TIMEOUT_MS,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch {
        return 'error'
      }
      if (o.status === 0) {
        const i = parseBareIdentity(pin, spawnUtf8(o.stdout))
        if (i !== null) {
          const refs = scanRefStoreSync(i.gitDir)
          return {
            ...i,
            backPointer: readGitdirBackPointerSync(i.gitDir),
            symlinkedRefStore: refs.symlinks,
            unexaminableRefStore: refs.unexaminable,
          }
        }
      }
      return 'error'
    }
    return isNotAGitRepository(stderr) ? 'no-repo' : 'error'
  }
  const r = parseWorktreeIdentity(pin, stdout)
  if (r === null) return 'error'
  const refs = scanRefStoreSync(r.gitDir)
  return {
    ...r,
    backPointer: readGitdirBackPointerSync(r.gitDir),
    symlinkedRefStore: refs.symlinks,
    unexaminableRefStore: refs.unexaminable,
  }
}

async function probePin(pin: string): Promise<IsolationPinProbe> {
  const [entry, ids] = await Promise.all([
    gitEntryKind(pin),
    resolveGitIds(pin),
  ])
  return { entry, ids }
}

function probePinSync(pin: string): IsolationPinProbe {
  return { entry: gitEntryKindSync(pin), ids: resolveGitIdsSync(pin) }
}

/** densable `ODt`. */
export async function probeIsolationWorktreePin(
  pin: string,
  protectedRoots: string[] = [],
  liveRoots: string[] = [],
  options?: IsolationPinOptions,
): Promise<IsolationPinResult> {
  const [probe, symlink] = await Promise.all([probePin(pin), pinIsSymlink(pin)])
  const protectedSet = new Set(protectedRoots)
  const liveSet = new Set(liveRoots)
  const allLive = uniq([...protectedRoots, ...liveRoots])
  const requireWitness = options?.requireWitnessForSelfOwningPins === true
  const declineSelf = options?.declineSelfOwningPinUnderLiveRoot === true
  if (typeof probe.ids !== 'object') {
    return evaluateIsolationWorktreePin(
      pin,
      probe,
      symlink,
      allLive,
      protectedSet,
      liveSet,
      [],
      requireWitness,
      declineSelf,
    )
  }
  const extra = await Promise.all(
    extraProbeRoots(pin, allLive, probe.ids).map(async root => ({
      root,
      ...(await probePin(root)),
    })),
  )
  return evaluateIsolationWorktreePin(
    pin,
    probe,
    symlink,
    allLive,
    protectedSet,
    liveSet,
    extra,
    requireWitness,
    declineSelf,
  )
}

/** densable `Ezd` — sync variant for runtime containment. */
export function probeIsolationWorktreePinSync(
  pin: string,
  protectedRoots: string[] = [],
  liveRoots: string[] = [],
  options?: IsolationPinOptions,
): IsolationPinResult {
  const probe = probePinSync(pin)
  const symlink = pinIsSymlinkSync(pin)
  const protectedSet = new Set(protectedRoots)
  const liveSet = new Set(liveRoots)
  const allLive = uniq([...protectedRoots, ...liveRoots])
  const requireWitness = options?.requireWitnessForSelfOwningPins === true
  const declineSelf = options?.declineSelfOwningPinUnderLiveRoot === true
  if (typeof probe.ids !== 'object') {
    return evaluateIsolationWorktreePin(
      pin,
      probe,
      symlink,
      allLive,
      protectedSet,
      liveSet,
      [],
      requireWitness,
      declineSelf,
    )
  }
  const extra = extraProbeRoots(pin, allLive, probe.ids).map(root => ({
    root,
    ...probePinSync(root),
  }))
  return evaluateIsolationWorktreePin(
    pin,
    probe,
    symlink,
    allLive,
    protectedSet,
    liveSet,
    extra,
    requireWitness,
    declineSelf,
  )
}

function throwIfPinRefused(result: IsolationPinResult): IsolationPinResult {
  if (!result.ok) {
    // densable: de("git_worktree_create","git_worktree_create_root_rejected")
    logEvent('git_worktree_create_root_rejected', {})
    throw new Error(result.message)
  }
  return result
}

/** densable create/resume hang: ODt then throw Yv(message). */
export async function assertIsolationWorktreeAllowed(
  pin: string,
  protectedRoots: string[] = [],
  liveRoots: string[] = [],
  options?: IsolationPinOptions,
): Promise<IsolationPinResult> {
  return throwIfPinRefused(
    await probeIsolationWorktreePin(pin, protectedRoots, liveRoots, options),
  )
}
