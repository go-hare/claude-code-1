import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'fs'
import memoize from 'lodash-es/memoize.js'
import * as path from 'path'
import * as pathWin32 from 'path/win32'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { execSync_DEPRECATED } from './execSyncWrapper.js'
import { memoizeWithLRU } from './memoize.js'
import { getPlatform } from './platform.js'
import { isTestNoGitBash } from './residualFinalEnvGates.js'
import { getInitialSettings } from './settings/settings.js'

/**
 * If Windows, set the SHELL environment variable to git-bash path.
 * This is used by BashTool and Shell.ts for user shell commands.
 * COMSPEC is left unchanged for system process execution.
 */
export function setShellIfWindows(): void {
  if (getPlatform() === 'windows') {
    // densable: missing Git Bash must not process.exit when PowerShell tool is
    // available — resolveDefaultShell already prefers powershell on Windows.
    const gitBashPath = findGitBashPathOrNull()
    if (gitBashPath) {
      process.env.SHELL = gitBashPath
      // Propagate to child processes so they skip filesystem probing
      process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
      logForDebugging(`Using bash path: "${gitBashPath}"`)
      return
    }
    // No Git Bash: leave SHELL unset / prior value; PowerShell tool remains default.
    logForDebugging(
      'Git Bash not found on Windows; PowerShell tool remains available (Bash tool will fail if invoked)',
    )
  }
}

/**
 * Dependencies for git-bash discovery. Exposed as a parameter so the
 * discovery logic can be unit-tested without `mock.module` polluting
 * other tests in the same process (see CLAUDE.md "跨文件 mock 污染").
 */
export type GitBashDiscoveryDeps = {
  /** Returns true iff the path exists on disk. */
  checkExists: (filePath: string) => boolean
  /** Executes a shell command and returns its trimmed stdout. May throw. */
  execCommand: (cmd: string) => string
  /** Returns the current working directory (used to filter PATH-based lookups). */
  cwdFn: () => string
  /**
   * `USERPROFILE` used to derive Scoop Git install paths. When provided,
   * this is used instead of `process.env.USERPROFILE` — keeps the pure
   * helper hermetic so the Scoop fallback can be tested without
   * depending on the live environment.
   */
  userProfile?: string | undefined
  /**
   * Optional override for `process.env.CLAUDE_CODE_GIT_BASH_PATH`. When
   * provided, this is used instead of the live environment — useful for tests.
   */
  envOverride?: string | undefined
}

const DEFAULT_DEPS: GitBashDiscoveryDeps = {
  checkExists: existsSync,
  execCommand: cmd =>
    execSync_DEPRECATED(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim(),
  cwdFn: getCwd,
  userProfile: process.env.USERPROFILE,
  envOverride: undefined,
}

/**
 * Search common install locations for bash.exe directly. Returns the first
 * existing candidate or null if none match. Used as a last-resort fallback
 * when `where.exe` cannot locate bash via PATH and git is also unknown.
 */
function searchDefaultBashLocations(
  checkExists: (p: string) => boolean,
  userProfile?: string,
): string | null {
  const candidates = [
    // Standard Git for Windows install locations (both layouts).
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ]
  // Scoop install: %USERPROFILE%\scoop\apps\git\current\usr\bin\bash.exe
  if (userProfile) {
    candidates.push(
      `${userProfile}\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe`,
    )
  }
  for (const candidate of candidates) {
    if (checkExists(candidate)) {
      return candidate
    }
  }
  return null
}

function isWindowsBashLauncher(filePath: string): boolean {
  const parentDir = pathWin32
    .basename(pathWin32.dirname(pathWin32.normalize(filePath)))
    .toLowerCase()
  return ['system32', 'sysnative', 'syswow64', 'windowsapps'].includes(
    parentDir,
  )
}

/**
 * densable `xmg` — virtualenv / package-manager dir names that make a
 * candidate under cwd look like a project-local shadow of a real tool.
 */
const CWD_SHADOW_DIR_NAMES = new Set([
  'node_modules',
  '.venv',
  'venv',
  'env',
  '.env',
  'virtualenv',
  '.tox',
  '.nox',
  '.direnv',
  '__pypackages__',
])

function stripTrailingSepWin(p: string): string {
  return p.endsWith(pathWin32.sep) ? p.slice(0, -1) : p
}

/**
 * densable `Lmc` — true when `candidateDir` is under `cwd` AND some path
 * segment is a known project-local shadow dir (node_modules / venv / …).
 * Pure lexical (lowercased win32 paths).
 */
function isUnderCwdViaShadowDir(candidateDir: string, cwd: string): boolean {
  const prefix = stripTrailingSepWin(cwd) + pathWin32.sep
  if (!candidateDir.startsWith(prefix)) return false
  return candidateDir
    .split(pathWin32.sep)
    .some(seg => CWD_SHADOW_DIR_NAMES.has(seg))
}

/**
 * densable `Fmc` + `mVi` — WindowsApps alias dirs under USERPROFILE / LOCALAPPDATA.
 * Reject candidates that live under those alias roots when cwd is also there
 * (store-app shim shadowing).
 */
function isUnderSharedWindowsAppsAlias(
  candidateDir: string,
  cwd: string,
): boolean {
  const home = (process.env.USERPROFILE ?? '').trim()
  const localAppData = (process.env.LOCALAPPDATA ?? '').trim()
  const aliasDirs: string[] = []
  if (home) {
    aliasDirs.push(
      stripTrailingSepWin(pathWin32.resolve(home).toLowerCase()) +
        pathWin32.sep +
        ['appdata', 'local', 'microsoft', 'windowsapps'].join(pathWin32.sep),
    )
  }
  if (localAppData) {
    const o =
      stripTrailingSepWin(pathWin32.resolve(localAppData).toLowerCase()) +
      pathWin32.sep +
      ['microsoft', 'windowsapps'].join(pathWin32.sep)
    if (!aliasDirs.includes(o)) aliasDirs.push(o)
  }
  const cwdNorm = stripTrailingSepWin(cwd)
  for (const alias of aliasDirs) {
    const aliasNorm = stripTrailingSepWin(alias)
    if (
      !(cwdNorm === aliasNorm || cwdNorm.startsWith(aliasNorm + pathWin32.sep))
    ) {
      continue
    }
    if (
      candidateDir === aliasNorm ||
      candidateDir.startsWith(aliasNorm + pathWin32.sep)
    ) {
      return true
    }
  }
  return false
}

/**
 * densable `uio(candidate, cwd)` — reject `where.exe` hits that are
 * cwd-shadowed malicious copies, while **allowing** genuine installs whose
 * parent is an ancestor of cwd (e.g. launched from parent of Git install:
 * cwd=`C:\\Program Files\\Git`, exe=`C:\\Program Files\\Git\\cmd\\git.exe`).
 *
 * densable returns true → skip candidate.
 *
 * Exported for unit tests.
 */
export function shouldSkipWhereCandidateAsCwdShadow(
  candidatePath: string,
  cwd: string,
): boolean {
  const cwdResolved = pathWin32.resolve(cwd).toLowerCase()
  const candidateDir = pathWin32
    .dirname(pathWin32.resolve(candidatePath))
    .toLowerCase()

  // densable: if(n===r||Lmc(n,r)||Nmc(n,r,"lexical")) return true
  if (candidateDir === cwdResolved) return true
  if (isUnderCwdViaShadowDir(candidateDir, cwdResolved)) return true
  if (isUnderSharedWindowsAppsAlias(candidateDir, cwdResolved)) return true

  // #1596: compare directory identity via statSync(..., { bigint: true }) `${dev}:${ino}`
  // to catch cwd-shadowed executables reached through a junction, subst drive,
  // symlink, or 8.3 short path alias whose lexical spelling differs from cwd.
  const rawCandidateDir = pathWin32.dirname(candidatePath)
  if (
    isSameWindowsFolderIdentity(rawCandidateDir, cwd) ||
    isSameWindowsFolderIdentity(candidateDir, cwdResolved)
  ) {
    return true
  }

  return false
}

/**
 * Look up an executable on Windows. Tries common install locations first
 * (for `git`), then falls back to `where.exe`. Filters out entries that are
 * cwd-shadowed (densable `uio`) while allowing parent-of-install layouts.
 *
 * Pure variant — takes its dependencies as parameters so it can be unit-tested
 * without process-global mocks.
 */
const GIT_FOR_WINDOWS_ARCHS = ['mingw64', 'ucrt64'] as const

/**
 * Resolve a Git for Windows `cmd\git.exe` launcher to its underlying
 * `<arch>\bin\git.exe` (for git >= 2.26) when `MSYSTEM` is unset, avoiding
 * the `cmd` wrapper process on every git invocation. Falls back to
 * `launcherPath` if probing fails, is shadowed by cwd, or version < 2.26.
 */
export function resolveGitForWindowsDirectExe(
  launcherPath: string,
  deps: GitBashDiscoveryDeps,
): string {
  if (process.env.MSYSTEM !== undefined) {
    return launcherPath
  }
  const normalizedLauncher = pathWin32.normalize(launcherPath)
  if (!normalizedLauncher.toLowerCase().endsWith('\\cmd\\git.exe')) {
    return launcherPath
  }
  const gitRoot = pathWin32.join(normalizedLauncher, '..', '..')
  try {
    const execPathOut = deps.execCommand(`"${normalizedLauncher}" --exec-path`)
    const execPathNorm = pathWin32
      .normalize(execPathOut.trim())
      .replace(/[\\/]+$/, '')
      .toLowerCase()
    const arch = GIT_FOR_WINDOWS_ARCHS.find(
      a =>
        pathWin32.join(gitRoot, a, 'libexec', 'git-core').toLowerCase() ===
        execPathNorm,
    )
    if (!arch) {
      return launcherPath
    }
    const directExe = pathWin32.join(gitRoot, arch, 'bin', 'git.exe')
    if (shouldSkipWhereCandidateAsCwdShadow(directExe, deps.cwdFn())) {
      return launcherPath
    }
    if (!deps.checkExists(directExe)) {
      return launcherPath
    }
    const versionOut = deps.execCommand(`"${directExe}" version`)
    const m = /^git version (\d+)\.(\d+)\.\d+\S*\.windows\.\d+/.exec(
      versionOut.trim(),
    )
    const major = Number(m?.[1])
    const minor = Number(m?.[2])
    if (major > 2 || (major === 2 && minor >= 26)) {
      return directExe
    }
  } catch {
    // Fall back to launcher if probe fails
  }
  return launcherPath
}

/**
 * Official 2.1.321 #1925 & #1944:
 * In-process Windows PATH + PATHEXT lookup cache (avoids spawning `where.exe`
 * on startup and first command), skipping relative PATH entries, UNC / network
 * share PATH entries, and symlinks resolving onto a network share, while
 * picking up PATH changes from settings (`settings.env.PATH`).
 */
const WINDOWS_DRIVE_ABS_RE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_OR_NET_RE = /^(?:\\\\|\/\/|\\\?\\UNC\\|\/\/\?\/UNC\/)/i

export function isUnsafeWindowsPathEntry(entry: string): boolean {
  const trimmed = entry.trim().replace(/^"|"$/g, '')
  if (!trimmed) return true
  if (WINDOWS_UNC_OR_NET_RE.test(trimmed)) return true
  if (!WINDOWS_DRIVE_ABS_RE.test(trimmed)) return true
  return false
}

export type WindowsPathLookupOptions = {
  pathEnv?: string
  pathExtEnv?: string
  settingsPathEnv?: string
  cwd?: string
  readdirFn?: (dir: string) => string[]
  lstatFn?: (p: string) => {
    isSymbolicLink: () => boolean
    isDirectory: () => boolean
  }
  realpathFn?: (p: string) => string
}

const UNREADABLE_ANCESTOR_CODES = new Set([
  'EACCES',
  'EPERM',
  'ENOTDIR',
  'ELOOP',
  'ENAMETOOLONG',
  'EINVAL',
])

const WINDOWS_PATH_PROBE_STALL_MS = 250

type WindowsPathCache = {
  key: string
  /** lowercased dir -> lowercased file name -> actual file name */
  dirEntries: Map<string, Map<string, string>>
  /** Official 2.1.325 #2337: cached unreadable/denied/stalled ancestor folders */
  blockedAncestors: Set<string>
  /** Official 2.1.325 #2337 (`yQa`): executables whose lookup could not exhaustively scan PATH */
  namesMaybeMissed: Set<string>
  dirs: string[]
  exts: string[]
}

let windowsPathCache: WindowsPathCache | null = null

export function clearWindowsPathCacheForTesting(): void {
  windowsPathCache = null
}

/**
 * Official 2.1.325 #2337: return ancestor directories from drive root down to
 * `dir` (inclusive) so an unreadable ancestor (e.g. `EACCES`/`EPERM`) short-
 * circuits every deeper PATH entry under it without repeatedly stalling.
 */
function getWindowsDirAncestors(dir: string): string[] {
  const norm = pathWin32.normalize(dir).replace(/[\\/]+$/, '')
  const parsed = pathWin32.parse(norm)
  const root = parsed.root.replace(/[\\/]+$/, '')
  if (!root || norm.toLowerCase() === root.toLowerCase()) {
    return [norm]
  }
  const rest = norm.slice(root.length).replace(/^[\\/]+/, '')
  if (!rest) return [norm]
  const segments = rest.split(/[\\/]+/).filter(Boolean)
  const ancestors: string[] = []
  let acc = `${root}\\`
  for (const seg of segments) {
    acc = pathWin32.join(acc, seg)
    ancestors.push(acc)
  }
  return ancestors
}

function getErrCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/**
 * Official 2.1.325 #2337 (`X` + `GX`): walk ancestor directories of a Windows
 * PATH entry before listing it. Returns:
 * - `'ok'` if every ancestor is traversable (or missing — handled cleanly)
 * - `'blocked'` if an ancestor cannot be opened (`EACCES`, `EPERM`, etc.) or
 *   stalled beyond threshold; caches the failing ancestor so sibling/child
 *   PATH entries short-circuit immediately in O(1).
 */
function checkWindowsPathAncestors(
  dir: string,
  cache: WindowsPathCache,
  lstatImpl: (p: string) => {
    isSymbolicLink: () => boolean
    isDirectory: () => boolean
  },
  realpathImpl: (p: string) => string,
): 'ok' | 'missing' | 'blocked' {
  const ancestors = getWindowsDirAncestors(dir)
  for (const anc of ancestors) {
    const ancKey = anc.toLowerCase()
    if (cache.blockedAncestors.has(ancKey)) {
      return 'blocked'
    }
    const startNs = process.hrtime.bigint()
    try {
      const st = lstatImpl(anc)
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6
      if (elapsedMs > WINDOWS_PATH_PROBE_STALL_MS) {
        cache.blockedAncestors.add(ancKey)
        return 'blocked'
      }
      if (st.isSymbolicLink()) {
        const resolved = realpathImpl(anc)
        if (WINDOWS_UNC_OR_NET_RE.test(resolved)) {
          cache.blockedAncestors.add(ancKey)
          return 'blocked'
        }
      } else if (!st.isDirectory()) {
        cache.blockedAncestors.add(ancKey)
        return 'blocked'
      }
    } catch (err) {
      const code = getErrCode(err)
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6
      if (code === 'ENOENT') {
        if (elapsedMs > WINDOWS_PATH_PROBE_STALL_MS) {
          cache.blockedAncestors.add(ancKey)
          return 'blocked'
        }
        return 'missing'
      }
      if (
        (code !== undefined && UNREADABLE_ANCESTOR_CODES.has(code)) ||
        elapsedMs > WINDOWS_PATH_PROBE_STALL_MS
      ) {
        cache.blockedAncestors.add(ancKey)
        return 'blocked'
      }
      return 'blocked'
    }
  }
  return 'ok'
}

/**
 * Official 2.1.325 #2337 (`yQa`): whether `where.exe` fallback is still needed
 * after in-process PATH resolution returned `null`. Returning `false` avoids
 * spawning blocking `where.exe` (~1s stall when PATH has unreadable folders).
 */
export function shouldFallbackToWhereExe(
  executable: string,
  rawPath: string | undefined = process.env.PATH ?? process.env.Path,
): boolean {
  if (!rawPath) return true
  if (windowsPathCache?.namesMaybeMissed.has(executable.toLowerCase())) {
    return true
  }
  const dirs = parseWindowsPathDirs(rawPath)
  if (dirs.length === 0) return true
  // Quoted semicolons or relative/UNC entries skipped by parseWindowsPathDirs
  let inQuotes = false
  for (const ch of rawPath) {
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ';' && inQuotes) return true
  }
  return false
}

function getEffectiveWindowsPathAndExt(opts?: WindowsPathLookupOptions): {
  rawPath: string
  rawPathExt: string
} {
  let settingsPath = opts?.settingsPathEnv
  if (settingsPath === undefined) {
    try {
      const env = getInitialSettings()?.env
      settingsPath = env?.PATH ?? env?.Path
    } catch {
      settingsPath = undefined
    }
  }
  const procPath = opts?.pathEnv ?? process.env.PATH ?? process.env.Path ?? ''
  const rawPath =
    settingsPath && settingsPath !== procPath
      ? `${settingsPath};${procPath}`
      : procPath
  const rawPathExt =
    opts?.pathExtEnv ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  return { rawPath, rawPathExt }
}

function parseWindowsPathDirs(rawPath: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of rawPath.split(';')) {
    const cleaned = part.trim().replace(/^"|"$/g, '')
    if (isUnsafeWindowsPathEntry(cleaned)) continue
    const norm = pathWin32.normalize(cleaned).replace(/[\\/]+$/, '')
    const key = norm.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(norm)
    }
  }
  return out
}

const WINDOWS_DEFAULT_PATHEXT = ['.com', '.exe', '.bat', '.cmd'] as const

function parseWindowsPathExts(rawPathExt: string): string[] {
  const seen = new Set<string>()
  const exts: string[] = []
  for (const part of rawPathExt.split(';')) {
    const normalized = part.trim().toLowerCase()
    if (normalized.startsWith('.') && !seen.has(normalized)) {
      seen.add(normalized)
      exts.push(normalized)
    }
  }
  return exts.length > 0 ? exts : [...WINDOWS_DEFAULT_PATHEXT]
}

/**
 * 2.1.323 #2136 (SEA `Dqo` / `z` @278312493 & `xn` @286291662):
 * On Windows, `where.exe` returns matching files in directory listing order
 * (so `git.bat` / `git.cmd` can appear before `git.exe` in the same PATH
 * folder). Reorder contiguous same-directory candidates by `PATHEXT` priority
 * (preferring `.com` / `.exe` over `.bat` / `.cmd` in the same folder, matching
 * `cmd.exe`), while preserving PATH directory search order across folders.
 */
export function orderWindowsSameDirCandidatesByPathExt(
  candidates: readonly string[],
  rawPathExt: string = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
): string[] {
  if (candidates.length <= 1) return [...candidates]
  const exts = parseWindowsPathExts(rawPathExt)
  const extRank = (filePath: string): number => {
    const ext = pathWin32.extname(filePath).toLowerCase()
    const idx = exts.indexOf(ext)
    if (idx !== -1) return idx
    // Fallback if PATHEXT was customized: still prefer .com/.exe over .bat/.cmd
    const defaultIdx = WINDOWS_DEFAULT_PATHEXT.indexOf(
      ext as (typeof WINDOWS_DEFAULT_PATHEXT)[number],
    )
    return defaultIdx !== -1 ? exts.length + defaultIdx : exts.length + 100
  }

  // Group candidates by directory (preserving first-seen directory order)
  const dirOrder: string[] = []
  const byDir = new Map<string, string[]>()
  for (const c of candidates) {
    const dirKey = pathWin32.dirname(c).toLowerCase()
    let group = byDir.get(dirKey)
    if (!group) {
      group = []
      byDir.set(dirKey, group)
      dirOrder.push(dirKey)
    }
    group.push(c)
  }

  const ordered: string[] = []
  for (const dirKey of dirOrder) {
    const group = byDir.get(dirKey)!
    group.sort((a, b) => extRank(a) - extRank(b))
    ordered.push(...group)
  }
  return ordered
}

export function resolveWindowsExecutableOnPath(
  command: string,
  opts?: WindowsPathLookupOptions,
): string | null {
  const trimmedCmd = command.trim()
  if (!trimmedCmd || /[\\/]/.test(trimmedCmd)) return null

  const { rawPath, rawPathExt } = getEffectiveWindowsPathAndExt(opts)
  const cacheKey = `${rawPath}\0${rawPathExt}`
  const isCustomFs =
    opts?.readdirFn !== undefined ||
    opts?.lstatFn !== undefined ||
    opts?.realpathFn !== undefined

  let cache: WindowsPathCache
  if (!isCustomFs && windowsPathCache?.key === cacheKey) {
    cache = windowsPathCache
  } else {
    cache = {
      key: cacheKey,
      dirEntries: new Map(),
      blockedAncestors: new Set(),
      namesMaybeMissed: new Set(),
      dirs: parseWindowsPathDirs(rawPath),
      exts: parseWindowsPathExts(rawPathExt),
    }
    if (!isCustomFs) {
      windowsPathCache = cache
    }
  }

  const readdirImpl = opts?.readdirFn ?? ((d: string) => readdirSync(d))
  const lstatImpl = opts?.lstatFn ?? ((p: string) => lstatSync(p))
  const realpathImpl = opts?.realpathFn ?? ((p: string) => realpathSync(p))
  const cwd = opts?.cwd ?? getCwd()

  const lowerCmd = trimmedCmd.toLowerCase()
  const hasKnownExt = cache.exts.some(ext => lowerCmd.endsWith(ext))
  const candidateNames = hasKnownExt
    ? [lowerCmd]
    : cache.exts.map(ext => `${lowerCmd}${ext}`)

  for (const dir of cache.dirs) {
    const dirKey = dir.toLowerCase()
    let entries = cache.dirEntries.get(dirKey)
    if (entries === undefined) {
      // Official 2.1.325 #2337: short-circuit PATH entries sitting under an
      // unreadable/inaccessible ancestor folder before calling readdirSync.
      const ancVerdict = checkWindowsPathAncestors(
        dir,
        cache,
        lstatImpl,
        realpathImpl,
      )
      entries = new Map()
      if (ancVerdict === 'ok') {
        try {
          for (const name of readdirImpl(dir)) {
            const lower = name.toLowerCase()
            if (!entries.has(lower)) {
              entries.set(lower, name)
            }
          }
        } catch (err) {
          const code = getErrCode(err)
          if (code !== undefined && UNREADABLE_ANCESTOR_CODES.has(code)) {
            cache.blockedAncestors.add(dirKey)
          }
        }
      }
      cache.dirEntries.set(dirKey, entries)
    }

    for (const candidateLower of candidateNames) {
      const actualName = entries.get(candidateLower)
      if (!actualName) continue
      const fullCandidate = pathWin32.join(dir, actualName)
      if (shouldSkipWhereCandidateAsCwdShadow(fullCandidate, cwd)) {
        continue
      }
      try {
        const st = lstatImpl(fullCandidate)
        if (st.isDirectory()) continue
        if (st.isSymbolicLink()) {
          const resolved = realpathImpl(fullCandidate)
          if (WINDOWS_UNC_OR_NET_RE.test(resolved)) {
            logForDebugging(
              `Skipping Windows PATH link pointing to network share: ${fullCandidate} -> ${resolved}`,
            )
            continue
          }
        }
      } catch {
        continue
      }
      return fullCandidate
    }
  }

  return null
}

function findExecutableWithDeps(
  executable: string,
  deps: GitBashDiscoveryDeps,
): string | null {
  // For git, check common installation locations first
  if (executable === 'git') {
    const defaultLocations = [
      // check 64 bit before 32 bit
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    ]

    for (const location of defaultLocations) {
      if (deps.checkExists(location)) {
        return resolveGitForWindowsDirectExe(location, deps)
      }
    }
  }

  // Official #1925, #1944 & 2.1.325 #2337: try in-process PATH+PATHEXT lookup
  // when using default deps. When the in-process scan covered PATH cleanly
  // (no `shouldFallbackToWhereExe`), return null directly without spawning
  // blocking `where.exe`, avoiding ~1s startup stalls on unreadable PATH dirs.
  if (deps === DEFAULT_DEPS) {
    const fastHit = resolveWindowsExecutableOnPath(executable, {
      cwd: deps.cwdFn(),
    })
    if (fastHit) {
      return executable === 'git'
        ? resolveGitForWindowsDirectExe(fastHit, deps)
        : fastHit
    }
    if (!shouldFallbackToWhereExe(executable)) {
      return null
    }
  }

  // Fall back to where.exe
  try {
    const result = deps.execCommand(`where.exe ${executable}`)
    // SECURITY: densable `uio` — skip cwd-shadowed copies (exact cwd dir,
    // under cwd via node_modules/venv, WindowsApps alias collision) but do
    // NOT reject genuine installs merely because cwd is a parent of the
    // install (parent-of-Git layout, densable 2.1.228 #2).
    //
    // Use path.win32.* so `where.exe` backslash paths keep Windows semantics
    // on any host OS.
    // 2.1.323 #2136: `where.exe` lists directory entries alphabetically, which
    // puts `git.bat`/`git.cmd` before `git.exe` in the same folder. Order
    // same-folder hits by PATHEXT so `.exe` beats `.cmd`/`.bat` just as cmd.exe does.
    const paths = orderWindowsSameDirCandidatesByPathExt(
      result
        .split(/\r?\n/)
        .map(p => p.trim())
        .filter(Boolean),
    )
    const cwd = deps.cwdFn()

    for (const candidatePath of paths) {
      if (shouldSkipWhereCandidateAsCwdShadow(candidatePath, cwd)) {
        logForDebugging(
          `Skipping potentially malicious executable in current directory: ${candidatePath}`,
        )
        continue
      }

      // Return the first valid path that's not a cwd shadow
      return executable === 'git'
        ? resolveGitForWindowsDirectExe(candidatePath, deps)
        : candidatePath
    }

    return null
  } catch {
    return null
  }
}

/**
 * Pure discovery helper for git-bash.exe. Returns `null` if not found.
 * See `findGitBashPathOrNull` for production invocation.
 *
 * Exported for testing — tests can pass mock `checkExists`, `execCommand`,
 * and `cwdFn` to exercise each branch in isolation without polluting the
 * module registry (which would affect other tests via `mock.module`).
 */
export function findGitBashPathOrNullWithDeps(
  deps: GitBashDiscoveryDeps = DEFAULT_DEPS,
): string | null {
  // Official CLAUDE_CODE_TEST_NO_GIT_BASH — force "not found" for tests.
  if (isTestNoGitBash()) {
    return null
  }

  // Official GIT_BASH_PATH densable.
  let gitBashPathEnv: string | null | undefined = deps.envOverride
  if (gitBashPathEnv === undefined) {
    try {
      const { resolveGitBashPath } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      gitBashPathEnv = resolveGitBashPath()
    } catch {
      gitBashPathEnv = process.env.CLAUDE_CODE_GIT_BASH_PATH || null
    }
  }
  const envOverride = gitBashPathEnv

  // 1. densable 2.1.219 #13 NQ: honor CLAUDE_CODE_GIT_BASH_PATH only when
  // basename is bash/sh (+ .exe). Otherwise warn and fall through to auto-detect.
  if (envOverride) {
    const base = pathWin32.basename(envOverride).toLowerCase()
    const isBashSh = ['bash.exe', 'sh.exe', 'bash', 'sh'].includes(base)
    if (isBashSh && deps.checkExists(envOverride)) {
      return envOverride
    }
    logForDebugging(
      `CLAUDE_CODE_GIT_BASH_PATH "${envOverride}" ${
        isBashSh ? 'not found' : 'is not a bash/sh binary'
      }; falling back to auto-detection`,
      { level: 'warn' },
    )
  }

  // 1b. Official 2.1.321 #1934: prioritize standard Git for Windows install
  //     (`C:\Program Files\Git\bin\bash.exe`) directly before probing PATH or
  //     spawning `where.exe` / `git.exe`, improving startup time.
  const standardGitBashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]
  for (const candidate of standardGitBashCandidates) {
    if (deps.checkExists(candidate)) {
      return candidate
    }
  }

  // 2. Look up bash.exe directly via PATH. Ignore Windows' WSL launchers;
  //    they are not Git Bash and can open a console window for every command.
  const fromPath = findExecutableWithDeps('bash', deps)
  if (
    fromPath &&
    deps.checkExists(fromPath) &&
    !isWindowsBashLauncher(fromPath)
  ) {
    return fromPath
  }

  // 3. Derive bash from git's location, trying multiple layouts since
  //    non-standard Git installs (scoop, chocolatey, manual / portable)
  //    place bash differently relative to git.exe.
  const gitPath = findExecutableWithDeps('git', deps)
  if (gitPath) {
    const candidates = [
      // Standard Git for Windows: git at <root>/cmd/git.exe, bash at <root>/bin/bash.exe
      pathWin32.join(gitPath, '..', '..', 'bin', 'bash.exe'),
      // PortableGit / custom installs: git at <root>/cmd/git.exe, bash at <root>/usr/bin/bash.exe
      pathWin32.join(gitPath, '..', '..', 'usr', 'bin', 'bash.exe'),
      // Some installs: git at <root>/bin/git.exe, bash at <root>/bin/bash.exe
      pathWin32.join(gitPath, '..', 'bash.exe'),
    ]
    for (const candidate of candidates) {
      if (deps.checkExists(candidate)) {
        return candidate
      }
    }
  }

  // 4. Last resort: scan common install locations for bash.exe directly
  return searchDefaultBashLocations(deps.checkExists, deps.userProfile)
}

/**
 * Find the path where `bash.exe` included with git-bash exists. Returns
 * `null` if no suitable bash.exe can be located.
 *
 * Discovery order (each step is skipped if the previous one resolves):
 *   1. `CLAUDE_CODE_GIT_BASH_PATH` env var, if set and the file exists
 *   2. `where.exe bash` lookup (works whenever Git Bash's bin dir is in PATH,
 *      e.g. portable installs at `D:\software\Git\` where bash is at
 *      `<root>/usr/bin/bash.exe` rather than the conventional `<root>/bin/bash.exe`)
 *   3. Derive from `where.exe git`, trying multiple relative layouts
 *      (standard Git for Windows, PortableGit, sibling install)
 *   4. Check common default install locations directly
 *
 * Memoized so repeated calls within the same process only search once.
 * Test-friendly variant: does NOT call `process.exit`, unlike `findGitBashPath`.
 */
export const findGitBashPathOrNull = memoize(() =>
  findGitBashPathOrNullWithDeps(),
)

/**
 * Find the path where `bash.exe` included with git-bash exists, exiting
 * the process if not found.
 *
 * Thin wrapper over `findGitBashPathOrNull` that handles the
 * `process.exit(1)` failure path. Exported separately so the discovery
 * logic in `findGitBashPathOrNullWithDeps` can be unit-tested without
 * invoking `process.exit`.
 */
export function findGitBashPath(): string {
  const result = findGitBashPathOrNull()
  if (result !== null) {
    return result
  }
  // Official GIT_BASH_PATH densable (error path).
  let envOverride: string | null = process.env.CLAUDE_CODE_GIT_BASH_PATH || null
  try {
    const { resolveGitBashPath } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    envOverride = resolveGitBashPath()
  } catch {
    // keep raw env fallback
  }
  if (envOverride) {
    console.error(
      `Claude Code was unable to find CLAUDE_CODE_GIT_BASH_PATH path "${envOverride}"`,
    )
  } else {
    console.error(
      'Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win). If installed but not in PATH, set environment variable pointing to your bash.exe, similar to: CLAUDE_CODE_GIT_BASH_PATH=C:\\Program Files\\Git\\bin\\bash.exe',
    )
  }
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

/** Convert a Windows path to a POSIX path using pure JS. */
export const windowsPathToPosixPath = memoizeWithLRU(
  (windowsPath: string): string => {
    // Handle UNC paths: \\server\share -> //server/share
    if (windowsPath.startsWith('\\\\')) {
      return windowsPath.replace(/\\/g, '/')
    }
    // Handle drive letter paths: C:\Users\foo -> /c/Users/foo
    const match = windowsPath.match(/^([A-Za-z]):[/\\]/)
    if (match) {
      const driveLetter = match[1]!.toLowerCase()
      return '/' + driveLetter + windowsPath.slice(2).replace(/\\/g, '/')
    }
    // Already POSIX or relative — just flip slashes
    return windowsPath.replace(/\\/g, '/')
  },
  (p: string) => p,
  500,
)

/** Convert a POSIX path to a Windows path using pure JS. */
export const posixPathToWindowsPath = memoizeWithLRU(
  (posixPath: string): string => {
    // Handle UNC paths: //server/share -> \\server\share
    if (posixPath.startsWith('//')) {
      return posixPath.replace(/\//g, '\\')
    }
    // Handle /cygdrive/c/... format
    const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/)
    if (cygdriveMatch) {
      const driveLetter = cygdriveMatch[1]!.toUpperCase()
      const rest = posixPath.slice(('/cygdrive/' + cygdriveMatch[1]).length)
      return driveLetter + ':' + (rest || '\\').replace(/\//g, '\\')
    }
    // Handle /c/... format (MSYS2/Git Bash)
    const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/)
    if (driveMatch) {
      const driveLetter = driveMatch[1]!.toUpperCase()
      const rest = posixPath.slice(2)
      return driveLetter + ':' + (rest || '\\').replace(/\//g, '\\')
    }
    // Already Windows or relative — just flip slashes
    return posixPath.replace(/\//g, '\\')
  },
  (p: string) => p,
  500,
)

/**
 * #1596: Compare two folder paths by `${dev}:${ino}` via statSync(..., { bigint: true }).
 */
export function isSameWindowsFolderIdentity(a: string, b: string): boolean {
  try {
    const stA = statSync(a, { bigint: true, throwIfNoEntry: false })
    if (!stA || !stA.isDirectory() || stA.ino === 0n) return false
    const stB = statSync(b, { bigint: true, throwIfNoEntry: false })
    if (!stB || !stB.isDirectory() || stB.ino === 0n) return false
    return `${stA.dev}:${stA.ino}` === `${stB.dev}:${stB.ino}`
  } catch {
    return false
  }
}
