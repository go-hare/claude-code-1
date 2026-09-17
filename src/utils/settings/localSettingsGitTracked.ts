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
import { whichSync } from '../which.js'

export type LocalSettingsGitTrackedValue =
  | 'tracked'
  | 'untracked'
  | 'indeterminate'

let localSettingsGitTracked:
  | { cwd: string; value: LocalSettingsGitTrackedValue }
  | undefined

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
        env: {
          ...process.env,
          GIT_LITERAL_PATHSPECS: '',
          LC_ALL: 'C',
          GIT_TRACE2: '',
          GIT_TRACE2_PERF: '',
          GIT_TRACE2_EVENT: '',
        },
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
      return /^fatal: not a git repository/.test(result.stderr ?? '')
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

/** densable `qB` — cwd plus distinct git root. */
export function scanLocalSettingsGitTracked(
  cwd: string = getCwd(),
): LocalSettingsGitTrackedValue {
  const dirs = [cwd]
  const gitRoot = findGitRootUncached(cwd)
  if (gitRoot !== null && resolve(gitRoot) !== resolve(cwd)) {
    dirs.push(gitRoot)
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
  localSettingsGitTracked = undefined
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
  const cwd = getCwd()
  let value =
    localSettingsGitTracked?.cwd === cwd
      ? localSettingsGitTracked.value
      : undefined
  if (value === undefined) {
    value = scanLocalSettingsGitTracked(cwd)
    localSettingsGitTracked = { cwd, value }
  }
  if (value === 'indeterminate') {
    return onIndeterminate === 'tracked'
  }
  return value === 'tracked'
}
