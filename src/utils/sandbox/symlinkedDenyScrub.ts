/**
 * densable 2.1.247 #11 — after-command scrub for denyWrite paths that
 * were symlinks at convert time (Zt / LZ / UZ / BZ), plus wrap-time
 * VZ (promote now-symlink candidates) and FZ (yN write-root bag).
 *
 * Gold: snippets/gold-11-unk-247-LZ.txt + gold-11-unk-chain-247-after-*.txt
 * 246 TZ only skipped an unchanged symlink; 247 LZ also skips unlink when
 * hops sit outside every sandbox write root (home-manager/stow retarget).
 * No home-manager/stow special cases — the body is generic.
 */
import { lstatSync, readlinkSync, realpathSync, rmSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { logEvent } from '../../services/analytics/index.js'
import { getCwdState, getOriginalCwd } from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getClaudeTempDir } from '../permissions/filesystem.js'
import { getPlatform } from '../platform.js'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { resetStagingDirIdentities } from './wrapPreflight.js'

/** densable CZ — hop-walk budget in bu() */
const HOP_WALK_BUDGET = 32

export type SymlinkedDenyScrubEntry = {
  literal: string
  resolved: string
  hopDirectories: string[] | null
  danglingBaseline: boolean
}

type ScrubSpare = {
  index: number
  stillSymlink: boolean
  currentHopDirectories: string[]
  observedEnd: string | undefined
  dangling: boolean
}

type FilesystemConfig = {
  disabled?: boolean
  allowWrite: string[]
  denyWrite: string[]
}

type RuntimeConfig = {
  filesystem: FilesystemConfig
}

const state = {
  symlinkedDenyScrubPaths: [] as SymlinkedDenyScrubEntry[],
  denyLiteralSymlinkCandidates: [] as string[],
  wrapCwdsThisSession: new Set<string>(),
  wrapWriteRootsThisSession: new Set<string>(),
  unconfinedWrapThisSession: false,
  // densable Te() / mN — CLI session, not sandbox-runtime
  builtConfigEnforcesAllowlist: new WeakMap<object, boolean>(),
  installedFilterRequestEnforcesAllowlist: false,
  installsSinceInitializeStartedAllEnforce: true,
  initializationPromise: undefined as object | undefined,
}

let collator: Intl.Collator | undefined

export function getSymlinkedDenyScrubPaths(): readonly SymlinkedDenyScrubEntry[] {
  return state.symlinkedDenyScrubPaths
}

export function getDenyLiteralSymlinkCandidates(): readonly string[] {
  return state.denyLiteralSymlinkCandidates
}

/** densable convert: wipe lists before C.map(Zt). Wrap sets stay session-long. */
export function clearSymlinkedDenyLists(): void {
  state.symlinkedDenyScrubPaths.length = 0
  state.denyLiteralSymlinkCandidates.length = 0
}

export function resetSymlinkedDenyScrubState(): void {
  resetStagingDirIdentities()
  clearSymlinkedDenyLists()
  state.wrapCwdsThisSession.clear()
  state.wrapWriteRootsThisSession.clear()
  state.unconfinedWrapThisSession = false
  state.builtConfigEnforcesAllowlist = new WeakMap()
  state.installedFilterRequestEnforcesAllowlist = false
  state.installsSinceInitializeStartedAllEnforce = true
  state.initializationPromise = undefined
}

/** densable Pa `set(Ya, Nu)` — official Nu is always `false`. */
export function rememberBuiltConfigAllowlist(
  cfg: object,
  enforces: boolean,
): void {
  state.builtConfigEnforcesAllowlist.set(cfg, enforces)
}

/** densable Te().initializationPromise assignment / clear */
export function setSandboxInitializationPromise(
  promise: object | undefined,
): void {
  state.initializationPromise = promise
}

/** densable init: `installsSinceInitializeStartedAllEnforce = true` */
export function markInstallsSinceInitializeStarted(): void {
  state.installsSinceInitializeStartedAllEnforce = true
}

/**
 * densable after `Re.initialize`:
 * `installedFilter = (WeakMap.get(i) ?? false) && installsSince`
 */
export function finishSandboxInitializeAllowlist(cfg: object): void {
  state.installedFilterRequestEnforcesAllowlist =
    (state.builtConfigEnforcesAllowlist.get(cfg) ?? false) &&
    state.installsSinceInitializeStartedAllEnforce
}

/** densable init-fail: `installedFilterRequestEnforcesAllowlist = false` */
export function failSandboxInitializeAllowlist(): void {
  state.installedFilterRequestEnforcesAllowlist = false
}

export function getInstalledFilterRequestEnforcesAllowlist(): boolean {
  return state.installedFilterRequestEnforcesAllowlist
}

/**
 * densable `ro(e)` — `Re.updateConfig(e), yN(e)`, then WeakMap bookkeeping.
 */
export function applySandboxRuntimeConfig(
  cfg: SandboxRuntimeConfig,
  updateConfig: (cfg: SandboxRuntimeConfig) => void,
): void {
  updateConfig(cfg)
  recordWrapWriteRoots(cfg)
  const n = state.builtConfigEnforcesAllowlist.get(cfg) ?? false
  if (state.initializationPromise === undefined) {
    state.installedFilterRequestEnforcesAllowlist = n
  } else {
    state.installsSinceInitializeStartedAllEnforce &&= n
  }
}

function errorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

function isGlobPattern(path: string): boolean {
  return /[*?[]/.test(path)
}

/** densable gN */
function isUnixLikeSandboxPlatform(): boolean {
  const plat = getPlatform()
  return plat === 'linux' || plat === 'wsl' || plat === 'macos'
}

/** Official or()&&so() names were not uniquely locked; IS_SANDBOX is the nest. */
function isAlreadyInsideSandbox(): boolean {
  return Boolean(process.env.IS_SANDBOX)
}

/** densable Xm */
function joinSymlinkTarget(
  base: string | undefined,
  target: string,
): string | null {
  const parts = target.split('/')
  const firstReal = parts.findIndex(
    part => part !== '..' && part !== '.' && part !== '',
  )
  const parentAfterReal =
    firstReal !== -1 && parts.indexOf('..', firstReal) !== -1
  if (isAbsolute(target)) {
    return parts.includes('..') ? null : resolve(target)
  }
  if (parentAfterReal || base === undefined) return null
  return resolve(base, target)
}

/** densable uN */
function realpathExistingPrefix(
  path: string,
): { path: string; exists: boolean } | null {
  const missing: string[] = []
  for (let cur = path; ; cur = dirname(cur)) {
    try {
      const real = realpathSync(cur)
      return missing.length === 0
        ? { path: real, exists: true }
        : { path: join(real, ...missing), exists: false }
    } catch (err) {
      const code = errorCode(err)
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || dirname(cur) === cur) {
        return null
      }
      missing.unshift(basename(cur))
    }
  }
}

/** densable yu */
function resolveDanglingSymlink(
  literal: string,
  linkTarget: string,
): string | null {
  let parentReal: string
  try {
    parentReal = realpathSync(dirname(literal))
  } catch {
    return null
  }
  let cur = joinSymlinkTarget(parentReal, linkTarget)
  for (let i = 0; i < 8 && cur !== null; i++) {
    let next: string
    try {
      next = readlinkSync(cur)
    } catch {
      return cur
    }
    try {
      parentReal = realpathSync(dirname(cur))
    } catch {
      return null
    }
    cur = joinSymlinkTarget(parentReal, next)
  }
  return null
}

/** densable RZ */
function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** densable bu */
export function collectHopDirectories(
  literal: string,
  resolved: string | null,
): string[] | null {
  if (getPlatform() === 'windows') return null
  const hops = new Set<string>()
  if (resolved !== null) {
    hops.add(resolved)
    hops.add(dirname(resolved))
  }
  const seen = new Set<string>()
  const queue = [literal]
  let budget = HOP_WALK_BUDGET
  for (let cur = queue.pop(); cur !== undefined; cur = queue.pop()) {
    if (seen.has(cur)) continue
    if (--budget < 0) return null
    seen.add(cur)
    for (
      let node = cur, parent = dirname(cur);
      node !== parent;
      node = parent, parent = dirname(parent)
    ) {
      let link: string | undefined
      try {
        link = readlinkSync(node)
      } catch (err) {
        const code = errorCode(err)
        if (code !== 'EINVAL' && code !== 'ENOENT' && code !== 'ENOTDIR') {
          return null
        }
      }
      let nextBase: string | undefined
      if (node === cur || link !== undefined) {
        hops.add(node)
        hops.add(parent)
        const existing = realpathExistingPrefix(parent)
        if (existing === null) return null
        hops.add(existing.path)
        hops.add(join(existing.path, basename(node)))
        if (existing.exists) nextBase = existing.path
      }
      if (link !== undefined) {
        const joined = joinSymlinkTarget(nextBase, link)
        if (joined === null) return null
        queue.push(joined)
      }
    }
  }
  return [...hops]
}

/** densable $Z */
export function hopSetsEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null || a.length !== b.length) return false
  const set = new Set(a)
  return b.every(item => set.has(item))
}

/** densable MZ */
function pathSegmentEqual(a: string, b: string): boolean {
  if (a === b) return true
  const left = a.normalize('NFD')
  const right = b.normalize('NFD')
  if (
    left.toLowerCase() === right.toLowerCase() ||
    left.toUpperCase() === right.toUpperCase()
  ) {
    return true
  }
  collator ??= new Intl.Collator('en', {
    usage: 'search',
    sensitivity: 'base',
  })
  return collator.compare(left, right) === 0
}

/** densable pv — null hops or null write-roots count as intersecting. */
export function hopsIntersectWriteRoots(
  hops: string[] | null,
  writeRoots: string[] | null,
): boolean {
  if (hops === null || writeRoots === null) return true
  const roots = writeRoots.map(root => root.split('/').filter(Boolean))
  return hops.some(hop => {
    const parts = hop.split('/').filter(Boolean)
    return roots.some(
      root =>
        root.length <= parts.length &&
        root.every((seg, i) => pathSegmentEqual(seg, parts[i]!)),
    )
  })
}

/** densable bN */
function expandAllowWriteAgainstCwds(
  allowWrite: string[],
  cwds: Iterable<string>,
): string[] | null {
  const out = new Set<string>()
  for (const raw of new Set(allowWrite)) {
    let pattern = raw
    if (isGlobPattern(pattern)) {
      const prefix = pattern.split(/[*?[\]]/)[0] ?? ''
      pattern = prefix.endsWith('/')
        ? prefix.replace(/\/+$/, '') || '/'
        : dirname(prefix)
    }
    for (const cwd of cwds) {
      const abs =
        pattern === '~'
          ? homedir()
          : pattern.startsWith('~/')
            ? join(homedir(), pattern.slice(2))
            : resolve(cwd, pattern)
      out.add(abs)
      const existing = realpathExistingPrefix(abs)
      if (existing === null) return null
      out.add(existing.path)
    }
  }
  return [...out]
}

/** densable UZ */
export function deriveScrubWriteRoots(
  cfg: RuntimeConfig | undefined | null,
): string[] | null {
  if (!isUnixLikeSandboxPlatform()) return null
  if (!cfg || cfg.filesystem.disabled || state.unconfinedWrapThisSession) {
    return null
  }
  if (isAlreadyInsideSandbox()) return null
  const cwds = new Set([
    ...state.wrapCwdsThisSession,
    getCwdState(),
    getOriginalCwd(),
  ])
  try {
    cwds.add(process.cwd())
  } catch {
    // official swallows
  }
  const expanded = expandAllowWriteAgainstCwds(
    ['.', getClaudeTempDir(), ...cfg.filesystem.allowWrite],
    cwds,
  )
  if (expanded === null) return null
  return uniquePaths([...state.wrapWriteRootsThisSession, ...expanded])
}

/** densable yN / FZ */
export function recordWrapWriteRoots(
  cfg: RuntimeConfig | undefined | null,
): void {
  if (!isUnixLikeSandboxPlatform()) return
  if (!cfg || cfg.filesystem.disabled || isAlreadyInsideSandbox()) {
    state.unconfinedWrapThisSession = true
    return
  }
  let cwd: string
  try {
    cwd = process.cwd()
  } catch {
    state.unconfinedWrapThisSession = true
    return
  }
  state.wrapCwdsThisSession.add(cwd)
  const expanded = expandAllowWriteAgainstCwds(
    ['.', getClaudeTempDir(), ...cfg.filesystem.allowWrite],
    new Set([cwd]),
  )
  if (expanded === null) {
    state.unconfinedWrapThisSession = true
    return
  }
  for (const root of expanded) state.wrapWriteRootsThisSession.add(root)
}

/**
 * densable VZ — before each wrap, re-resolve convert-time regular-file
 * deny literals. Still not a symlink → stay on the list. Now a symlink →
 * merge the target into denyWrite and splice the literal.
 * Official: WeakMap.set(r, installedFilter) then ro(r).
 */
export function promoteDenyLiteralSymlinkTargets(opts: {
  getConfig: () => RuntimeConfig | undefined
  updateConfig: (cfg: SandboxRuntimeConfig) => void
}): void {
  const cfg = opts.getConfig()
  if (!cfg) return
  const candidates = state.denyLiteralSymlinkCandidates
  const resolved = new Map<string, string>()
  for (const literal of candidates) {
    if (resolved.has(literal)) continue
    let link: string
    try {
      link = readlinkSync(literal)
    } catch {
      continue
    }
    let target: string
    try {
      target = realpathSync(literal)
    } catch {
      target =
        resolveDanglingSymlink(literal, link) ?? resolve(dirname(literal), link)
      for (let i = 0; i < 8; i++) {
        let next: string
        try {
          next = readlinkSync(target)
        } catch {
          break
        }
        target = resolve(dirname(target), next)
      }
    }
    resolved.set(literal, target)
  }
  if (resolved.size === 0) return
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (resolved.has(candidates[i]!)) candidates.splice(i, 1)
  }
  const next = {
    ...cfg,
    filesystem: {
      ...cfg.filesystem,
      denyWrite: uniquePaths([
        ...resolved.values(),
        ...cfg.filesystem.denyWrite,
      ]),
    },
  } as SandboxRuntimeConfig
  rememberBuiltConfigAllowlist(
    next,
    state.installedFilterRequestEnforcesAllowlist,
  )
  applySandboxRuntimeConfig(next, opts.updateConfig)
}

/** densable Zt */
export function recordSymlinkedDenyPath(literal: string): string {
  let link: string
  try {
    link = readlinkSync(literal)
  } catch {
    state.denyLiteralSymlinkCandidates.push(literal)
    return literal
  }
  try {
    const resolved = realpathSync(literal)
    state.symlinkedDenyScrubPaths.push({
      literal,
      resolved,
      hopDirectories: collectHopDirectories(literal, resolved),
      danglingBaseline: false,
    })
    return resolved
  } catch {
    let walked =
      resolveDanglingSymlink(literal, link) ?? resolve(dirname(literal), link)
    for (let i = 0; i < 8; i++) {
      let next: string
      try {
        next = readlinkSync(walked)
      } catch {
        break
      }
      walked = resolve(dirname(walked), next)
    }
    state.symlinkedDenyScrubPaths.push({
      literal,
      resolved: walked,
      hopDirectories: collectHopDirectories(literal, null),
      danglingBaseline: false,
    })
    return walked
  }
}

function applySparedUnreachable(
  spared: ScrubSpare[],
  getConfig: () => RuntimeConfig | undefined,
  updateConfig: (cfg: SandboxRuntimeConfig) => void,
): void {
  const nextTargets: string[] = []
  const nextLiterals: string[] = []
  for (let i = spared.length - 1; i >= 0; i--) {
    const {
      index,
      stillSymlink,
      currentHopDirectories,
      observedEnd,
      dangling,
    } = spared[i]!
    const entry = state.symlinkedDenyScrubPaths[index]!
    if (!stillSymlink || observedEnd === undefined) {
      state.symlinkedDenyScrubPaths.splice(index, 1)
      state.denyLiteralSymlinkCandidates.push(entry.literal)
      nextLiterals.push(entry.literal)
      logForDebugging(
        `[Sandbox] kept ${entry.literal}: replaced by a real file/directory outside every sandbox write root (a user change, not a sandboxed plant); now denied directly`,
      )
      logEvent('tengu_sandbox_scrub_spared_unreachable', {
        still_symlink: false,
      })
      continue
    }
    const same = observedEnd === entry.resolved
    entry.resolved = observedEnd
    entry.hopDirectories = currentHopDirectories
    entry.danglingBaseline = dangling
    if (same) continue
    nextTargets.push(observedEnd)
    nextLiterals.push(entry.literal)
    logForDebugging(
      `[Sandbox] kept user-retargeted ${entry.literal} -> ${observedEnd}: nothing it resolves through is inside a sandbox write root (not a sandboxed plant); new target denied for the next command`,
    )
    logEvent('tengu_sandbox_scrub_spared_unreachable', {
      still_symlink: true,
    })
  }
  const cfg = getConfig()
  if (!cfg || nextLiterals.length === 0) return
  const next = {
    ...cfg,
    filesystem: {
      ...cfg.filesystem,
      denyWrite: uniquePaths([
        ...nextTargets,
        ...cfg.filesystem.denyWrite,
        ...nextLiterals,
      ]),
    },
  } as SandboxRuntimeConfig
  rememberBuiltConfigAllowlist(
    next,
    state.installedFilterRequestEnforcesAllowlist,
  )
  applySandboxRuntimeConfig(next, updateConfig)
}

/**
 * densable LZ — after-command scrub. f stays uninitialized until the
 * realpath-fail catch so `f!==null` is true after a successful retarget.
 */
export function scrubSymlinkedDenyPaths(opts: {
  getConfig: () => RuntimeConfig | undefined
  updateConfig: (cfg: SandboxRuntimeConfig) => void
}): void {
  const entries = state.symlinkedDenyScrubPaths
  const spared: ScrubSpare[] = []
  let writeRoots: string[] | null | undefined
  for (let i = 0; i < entries.length; i++) {
    const { literal, resolved, hopDirectories, danglingBaseline } = entries[i]!
    let stillSymlink: boolean
    // official: let f  (undefined until catch)
    let danglingEnd: string | null | undefined
    let st: ReturnType<typeof lstatSync> | null = null
    try {
      const cur = lstatSync(literal)
      st = cur
      stillSymlink = cur.isSymbolicLink()
    } catch (err) {
      if (errorCode(err) === 'ENOENT') continue
      stillSymlink = false
    }
    let observedReal: string | undefined
    if (stillSymlink) {
      try {
        observedReal = realpathSync(literal)
        if (observedReal === resolved) continue
      } catch {
        danglingEnd = null
        try {
          const link = readlinkSync(literal)
          danglingEnd = resolveDanglingSymlink(literal, link)
        } catch {
          // official swallows
        }
        if (
          danglingBaseline &&
          danglingEnd !== null &&
          danglingEnd === resolved &&
          hopSetsEqual(collectHopDirectories(literal, null), hopDirectories)
        ) {
          continue
        }
      }
    }
    if (writeRoots === undefined) {
      try {
        writeRoots = deriveScrubWriteRoots(opts.getConfig())
      } catch (err) {
        logForDebugging(
          `[Sandbox] scrub write-root derivation failed: ${err}`,
          { level: 'warn' },
        )
        writeRoots = null
      }
    }
    if (!hopsIntersectWriteRoots(hopDirectories, writeRoots)) {
      if (!stillSymlink && st === null) continue
      if (danglingEnd !== null) {
        const currentHops = collectHopDirectories(
          literal,
          danglingEnd !== undefined
            ? null
            : (observedReal ?? realpathOrNull(literal)),
        )
        if (
          currentHops !== null &&
          !hopsIntersectWriteRoots(currentHops, writeRoots)
        ) {
          spared.push({
            index: i,
            stillSymlink,
            currentHopDirectories: currentHops,
            observedEnd: danglingEnd ?? observedReal,
            dangling: danglingEnd !== undefined,
          })
          continue
        }
      }
    }
    try {
      rmSync(literal, { recursive: true, force: true })
      logForDebugging(
        `[Sandbox] scrubbed replaced symlinked-deny path: ${literal}`,
      )
      if (!stillSymlink) {
        const kind =
          st === null
            ? 'unknown'
            : st.isDirectory()
              ? 'directory'
              : st.isFile()
                ? 'file'
                : 'other'
        // official Ks(..., {kind}); local logEvent forbids string metadata
        logForDebugging(
          `[Sandbox] tengu_sandbox_scrub_removed_non_symlink kind=${kind}`,
        )
        logEvent('tengu_sandbox_scrub_removed_non_symlink', {})
      }
    } catch {
      // official swallows
    }
  }
  if (spared.length > 0) {
    applySparedUnreachable(spared, opts.getConfig, opts.updateConfig)
  }
}
