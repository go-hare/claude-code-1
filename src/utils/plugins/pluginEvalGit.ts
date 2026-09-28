/**
 * densable Li — git version probe for `claude plugin eval`.
 * GIT_CONFIG_COUNT (git 2.31+) is how the runner scopes git config for the
 * eval child; older git ignores it.
 */

import { execFileNoThrow } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'

export type PluginEvalGitVersionProbe = (
  file: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    timeout?: number
    useCwd?: boolean
  },
) => Promise<{ stdout: string; stderr: string; code: number; error?: string }>

/** densable `tn`. */
export const PLUGIN_EVAL_MIN_GIT: readonly [number, number] = [2, 31]

/** densable `sl`. */
export const PLUGIN_EVAL_GIT_VERSION_TIMEOUT_MS = 10_000

export class PluginEvalGitError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'PluginEvalGitError'
    this.code = code
  }
}

type GitVersion = readonly [number, number] | 'absent'

const versionByPath = new Map<string, GitVersion>()

export function clearPluginEvalGitVersionCache(): void {
  versionByPath.clear()
}

function timedOut(result: {
  code: number
  error?: string
  stdout: string
}): boolean {
  const err = result.error ?? ''
  return (
    /timed?\s*out/i.test(err) ||
    err.includes('ETIMEDOUT') ||
    (result.code !== 0 && result.stdout === '' && /timeout/i.test(err))
  )
}

/**
 * densable Li(e). `absent` (git missing) is allowed; too-old / unreadable /
 * timed-out throw PluginEvalGitError.
 */
export async function assertPluginEvalGitVersion(
  env: NodeJS.ProcessEnv = process.env,
  probe: PluginEvalGitVersionProbe = execFileNoThrow,
): Promise<void> {
  const pathKey = env.PATH ?? ''
  let cached = versionByPath.get(pathKey)
  if (cached === undefined) {
    const result = await probe(gitExe(), ['--version'], {
      env,
      timeout: PLUGIN_EVAL_GIT_VERSION_TIMEOUT_MS,
      useCwd: false,
    })

    const [maj, min] = PLUGIN_EVAL_MIN_GIT
    if (timedOut(result)) {
      throw new PluginEvalGitError(
        `git on this host did not report its version within ${PLUGIN_EVAL_GIT_VERSION_TIMEOUT_MS / 1000} seconds, so claude plugin eval cannot tell whether it is new enough (git ${maj}.${min} or newer) to switch off the repository's git hooks and helper programs for the run. Try again, or install git ${maj}.${min} or newer.`,
        'eval: git version probe timed out',
      )
    }
    const match = /git version (\d+)\.(\d+)/.exec(result.stdout)
    if (match === null) {
      if (result.code !== 0) {
        cached = 'absent'
      } else {
        throw new PluginEvalGitError(
          `git on this host did not print a version claude plugin eval can read, so it cannot tell whether git is new enough (git ${maj}.${min} or newer) to switch off the repository's git hooks and helper programs for the run. Run git --version to see what it prints, and install git ${maj}.${min} or newer.`,
          'eval: git version probe unreadable',
        )
      }
    } else {
      cached = [Number(match[1]), Number(match[2])]
    }
    versionByPath.set(pathKey, cached)
  }
  if (cached === 'absent') return
  const [major, minor] = cached
  const [needMaj, needMin] = PLUGIN_EVAL_MIN_GIT
  if (major > needMaj || (major === needMaj && minor >= needMin)) return
  throw new PluginEvalGitError(
    `git ${major}.${minor} is too old for claude plugin eval: it ignores the environment configuration (GIT_CONFIG_COUNT, added in git ${needMaj}.${needMin}) that switches off the repository's git hooks and helper programs for the run. Install git ${needMaj}.${needMin} or newer.`,
    'eval: git too old for env-scoped config',
  )
}
