import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, isAbsolute, join } from 'path'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { dirIsInGitRepo } from '../git.js'
import { logError } from '../log.js'

/**
 * Checks if a path is ignored by git (via `git check-ignore`).
 *
 * This consults all applicable gitignore sources: repo `.gitignore` files
 * (nested), `.git/info/exclude`, and the global gitignore — with correct
 * precedence, because git itself resolves it.
 *
 * Exit codes: 0 = ignored, 1 = not ignored, 128 = not in a git repo.
 * Returns `false` for 128, so callers outside a git repo fail open.
 *
 * @param filePath The path to check (absolute or relative to cwd)
 * @param cwd The working directory to run git from
 */
export async function isPathGitignored(
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await execFileNoThrowWithCwd(
    'git',
    ['check-ignore', '--', filePath],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )

  return code === 0
}

/** densable `wt` — path is already in the index. */
async function isPathGitTracked(
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await execFileNoThrowWithCwd(
    'git',
    ['ls-files', '--error-unmatch', '--', filePath],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )
  return code === 0
}

function gitignoreIneffectiveReason(
  reason: 'already_tracked' | 'excludesfile_not_read',
  testPath: string,
): string {
  return reason === 'already_tracked'
    ? `'${testPath}' is tracked in the index; gitignore rules do not apply to tracked files`
    : `core.excludesfile is set but git is not reading it for '${testPath}'`
}

/**
 * densable `Ei` — `git config --global --get core.excludesfile`, else
 * `$XDG_CONFIG_HOME/git/ignore` when absolute, else `~/.config/git/ignore`.
 */
export async function resolveGlobalGitignorePath(cwd: string): Promise<string> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    'git',
    ['config', '--global', '--get', 'core.excludesfile'],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )
  const configured = code === 0 ? stdout.trim() : ''
  if (configured) {
    if (configured === '~' || configured.startsWith('~/')) {
      return join(homedir(), configured.slice(2))
    }
    if (isAbsolute(configured)) return configured
  }
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && isAbsolute(xdg)) return join(xdg, 'git', 'ignore')
  return getGlobalGitignorePath()
}

/**
 * Gets the path to the global gitignore file (.config/git/ignore)
 * @returns The path to the global gitignore file
 */
export function getGlobalGitignorePath(): string {
  return join(homedir(), '.config', 'git', 'ignore')
}

/** densable `Rt` return. */
export type GitignoreGlobalRuleResult = {
  written: boolean
  effective: boolean
  reason?: string
}

const GLOBAL_IGNORE_PREFIX = '**/'

/**
 * densable `Rt` / `kv` — add GLOBAL_IGNORE_PREFIX + filename to the
 * global excludesfile. Concat (not a template) so Biome does not eat
 * slash-star-star as a regex character class.
 */
export async function addFileGlobRuleToGitignore(
  filename: string,
  cwd: string = getCwd(),
): Promise<GitignoreGlobalRuleResult> {
  try {
    if (!(await dirIsInGitRepo(cwd))) {
      return { written: false, effective: false }
    }

    const normalized = filename.replaceAll('\\', '/')
    const gitignoreEntry = GLOBAL_IGNORE_PREFIX + normalized
    const testPath = normalized.endsWith('/')
      ? `${normalized}sample-file.txt`
      : normalized
    if (await isPathGitignored(testPath, cwd)) {
      return { written: false, effective: true }
    }

    const globalGitignorePath = await resolveGlobalGitignorePath(cwd)
    await mkdir(dirname(globalGitignorePath), { recursive: true })

    try {
      const content = await readFile(globalGitignorePath, { encoding: 'utf-8' })
      if (content.includes(gitignoreEntry)) {
        const reason = (await isPathGitTracked(testPath, cwd))
          ? 'already_tracked'
          : 'excludesfile_not_read'
        logForDebugging(
          `[gitignore] '${gitignoreEntry}' already present in ${globalGitignorePath} but git check-ignore reports not-ignored — ${gitignoreIneffectiveReason(reason, testPath)}`,
          { level: 'warn' },
        )
        return { written: false, effective: false, reason }
      }
      await appendFile(globalGitignorePath, `\n${gitignoreEntry}\n`)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        await writeFile(globalGitignorePath, `${gitignoreEntry}\n`, 'utf-8')
      } else {
        throw e
      }
    }

    if (!(await isPathGitignored(testPath, cwd))) {
      const reason = (await isPathGitTracked(testPath, cwd))
        ? 'already_tracked'
        : 'excludesfile_not_read'
      logForDebugging(
        `[gitignore] wrote '${gitignoreEntry}' to ${globalGitignorePath} but git check-ignore still reports not-ignored — ${gitignoreIneffectiveReason(reason, testPath)}`,
        { level: 'warn' },
      )
      return { written: true, effective: false, reason }
    }
    return { written: true, effective: true }
  } catch (error) {
    logForDebugging(
      `Failed to add gitignore entry to global gitignore: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'error' },
    )
    logError(error)
    return { written: false, effective: false }
  }
}
