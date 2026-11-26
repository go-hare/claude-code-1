/**
 * densable 2.1.246 `Hte` / `YB` / `qB` / `XB` / `Kte`.
 * Whether `.claude/settings.local.json` is git-tracked (gates local grants).
 */
import { spawnSync } from 'child_process'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { checkHasTrustDialogAccepted } from '../config.js'
import { getCwd } from '../cwd.js'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { findGitRootUncached } from '../git.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { internalToolSubprocessEnv } from '../subprocessEnv.js'
import { whichSync } from '../which.js'

export type LocalSettingsGitTrackedValue =
  | 'tracked'
  | 'untracked'
  | 'indeterminate'

type HostLocalSettingsGitTrackedState = {
  cache: { cwd: string; value: LocalSettingsGitTrackedValue } | undefined
}

const hostLocalSettingsGitTrackedSlot =
  new HostSlot<HostLocalSettingsGitTrackedState>(() => ({
    cache: undefined,
  }))

function getHostLocalSettingsGitTrackedState(): HostLocalSettingsGitTrackedState {
  return hostLocalSettingsGitTrackedSlot.of(getBootstrapSessionHost())
}

function isEnoent(error: unknown): boolean {
  return getErrnoCode(error) === 'ENOENT'
}

/** densable `YB` — cwd is $HOME, or originalCwd is cwd/.claude. */
export function isHomeOrDotClaudeWorkspace(
  cwd: string = getCwd(),
  originalCwd: string = getOriginalCwd(),
): boolean {
  const fs = getFsImplementation()
  try {
    if (fs.realpathSync(resolve(cwd)) === fs.realpathSync(resolve(homedir()))) {
      return true
    }
  } catch {
    // fall through
  }
  return resolve(originalCwd) === resolve(join(cwd, '.claude'))
}

/** densable `XB` — probe one directory. */
export function probeLocalSettingsGitTrackedAt(
  dir: string,
): LocalSettingsGitTrackedValue {
  const fs = getFsImplementation()
  try {
    if (fs.realpathSync(resolve(dir)) === fs.realpathSync(resolve(homedir()))) {
      return 'untracked'
    }
  } catch {
    // fall through
  }
  if (resolve(getOriginalCwd()) === resolve(join(dir, '.claude'))) {
    return 'untracked'
  }
  for (const p of [
    join(dir, '.claude'),
    join(dir, '.claude', 'settings.local.json'),
  ]) {
    try {
      if (fs.lstatSync(p).isSymbolicLink()) {
        return 'tracked'
      }
    } catch (error) {
      if (!isEnoent(error)) {
        return 'tracked'
      }
    }
  }
  try {
    fs.lstatSync(join(dir, '.claude', '.git'))
    return 'tracked'
  } catch (error) {
    if (!isEnoent(error)) {
      return 'tracked'
    }
  }
  try {
    const git = whichSync('git')
    if (git === null) {
      // Unknown, not negative: without git we cannot tell whether a committed
      // settings.local.json is tracked. Every other uncertain branch here fails
      // closed ('tracked'); report indeterminate so the caller's policy decides
      // instead of silently resolving to the permissive answer.
      return 'indeterminate'
    }
    const result = spawnSync(
      git,
      [
        '--no-optional-locks',
        '-C',
        dir,
        'ls-files',
        '--error-unmatch',
        '--',
        ':(icase).claude/settings.local.json',
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: 2000,
        windowsHide: true,
        // Official 2.1.325 #2372: strip auth secrets & mTLS client key
        // passphrase from local git subprocesses.
        env: internalToolSubprocessEnv({
          GIT_LITERAL_PATHSPECS: '',
          LC_ALL: 'C',
          GIT_TRACE2: '',
          GIT_TRACE2_PERF: '',
          GIT_TRACE2_EVENT: '',
        }),
      },
    )
    if (result.error && isEnoent(result.error)) {
      // git vanished between whichSync and spawn — same unknown as above.
      return 'indeterminate'
    }
    if (result.signal !== null || result.error) {
      return 'tracked'
    }
    if (result.status === 128) {
      // Official 2.1.325 #2380: tighten to `(or any` so a broken worktree or
      // submodule `.git` pointer mounted into a container (`fatal: not a git
      // repository: /host/path/...`) fails closed as `'tracked'` instead of
      // `'indeterminate'`.
      return /^fatal: not a git repository \(or any/.test(result.stderr ?? '')
        ? 'indeterminate'
        : 'tracked'
    }
    if (result.status === 0) {
      return 'tracked'
    }
    if (result.status === 1) {
      return 'untracked'
    }
    return 'tracked'
  } catch {
    return 'indeterminate'
  }
}

/**
 * densable `qB` + Official 2.1.325 #2324 (`uL`):
 * Walk from `cwd` (and `originalCwd` if inside the repo) up through every
 * parent directory to `gitRoot` (inclusive, normalized with `realpathSync`
 * fallback so macOS `/var` vs `/private/var` or repo subfolders never miss a
 * committed `.claude/settings.local.json` at the repo root or an intermediate
 * folder).
 */
export function scanLocalSettingsGitTracked(
  cwd: string = getCwd(),
): LocalSettingsGitTrackedValue {
  const fs = getFsImplementation()
  const canonical = (p: string): string => {
    const abs = resolve(p)
    try {
      return fs.realpathSync(abs)
    } catch {
      return abs
    }
  }
  const seen = new Set<string>()
  const dirs: string[] = []
  const addDir = (dir: string) => {
    const key = canonical(dir)
    if (seen.has(key)) return
    seen.add(key)
    dirs.push(dir)
  }

  const resolvedCwd = resolve(cwd)
  const gitRoot = findGitRootUncached(resolvedCwd)
  const resolvedGitRoot = gitRoot !== null ? resolve(gitRoot) : null
  const canonicalGitRoot =
    resolvedGitRoot !== null ? canonical(resolvedGitRoot) : null

  addDir(resolvedCwd)
  if (resolvedGitRoot !== null && canonicalGitRoot !== null) {
    // Walk every ancestor from cwd up to gitRoot (inclusive) so a committed
    // `.claude/settings.local.json` in an intermediate folder or repo root is
    // always caught when Claude Code is started inside a subfolder.
    let current = resolvedCwd
    while (canonical(current) !== canonicalGitRoot) {
      const parent = resolve(current, '..')
      if (parent === current) break
      addDir(parent)
      current = parent
    }
    addDir(resolvedGitRoot)
  }

  const origCwd = resolve(getOriginalCwd())
  if (origCwd !== resolvedCwd) {
    const canonicalOrig = canonical(origCwd)
    if (
      canonicalGitRoot === null ||
      canonicalOrig === canonicalGitRoot ||
      canonicalOrig.startsWith(
        canonicalGitRoot.endsWith('/')
          ? canonicalGitRoot
          : `${canonicalGitRoot}/`,
      )
    ) {
      addDir(origCwd)
    }
  }

  let indeterminate = false
  for (const dir of dirs) {
    const value = probeLocalSettingsGitTrackedAt(dir)
    if (value === 'tracked') {
      return 'tracked'
    }
    if (value === 'indeterminate') {
      indeterminate = true
    }
  }
  return indeterminate ? 'indeterminate' : 'untracked'
}

/** densable `Kte`. */
export function resetLocalSettingsGitTrackedCache(): void {
  getHostLocalSettingsGitTrackedState().cache = undefined
}

/**
 * densable `Hte({onIndeterminate})`.
 * Untrusted session: true except home / cwd===git-root home-like.
 * Else cached git probe; indeterminate follows the caller's policy.
 */
export function isLocalSettingsGitTracked({
  onIndeterminate,
}: {
  onIndeterminate: 'tracked' | 'untracked'
}): boolean {
  if (!checkHasTrustDialogAccepted()) {
    const cwd = getCwd()
    const gitRoot = findGitRootUncached(cwd)
    if (
      isHomeOrDotClaudeWorkspace(cwd) &&
      gitRoot !== null &&
      resolve(gitRoot) === resolve(cwd)
    ) {
      return false
    }
    return true
  }
  const state = getHostLocalSettingsGitTrackedState()
  const cwd = getCwd()
  let value = state.cache?.cwd === cwd ? state.cache.value : undefined
  if (value === undefined) {
    value = scanLocalSettingsGitTracked(cwd)
    state.cache = { cwd, value }
  }
  if (value === 'indeterminate') {
    return onIndeterminate === 'tracked'
  }
  return value === 'tracked'
}
