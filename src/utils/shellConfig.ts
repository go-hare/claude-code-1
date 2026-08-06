/**
 * Utilities for managing shell configuration files (like .bashrc, .zshrc)
 * Used for managing claude aliases and PATH entries
 */

import { open, readFile, stat } from 'fs/promises'
import { homedir as osHomedir } from 'os'
import { join } from 'path'
import { logForDebugging } from './debug.js'
import {
  errorMessage,
  isEISDIR,
  isFsInaccessible,
  isTransientShellConfigError,
} from './errors.js'
import { getLocalClaudePath } from './localInstaller.js'

export const CLAUDE_ALIAS_REGEX = /^\s*alias\s+claude\s*=/

type EnvLike = Record<string, string | undefined>

type ShellConfigOptions = {
  env?: EnvLike
  homedir?: string
}

/**
 * Get the paths to shell configuration files
 * Respects ZDOTDIR for zsh users
 * @param options Optional overrides for testing (env, homedir)
 */
export function getShellConfigPaths(
  options?: ShellConfigOptions,
): Record<string, string> {
  const home = options?.homedir ?? osHomedir()
  const env = options?.env ?? process.env
  const zshConfigDir = env.ZDOTDIR || home
  return {
    zsh: join(zshConfigDir, '.zshrc'),
    bash: join(home, '.bashrc'),
    fish: join(home, '.config/fish/config.fish'),
  }
}

/**
 * Filter out installer-created claude aliases from an array of lines
 * Only removes aliases pointing to $HOME/.claude/local/claude
 * Preserves custom user aliases that point to other locations
 * Returns the filtered lines and whether our default installer alias was found
 */
export function filterClaudeAliases(lines: string[]): {
  filtered: string[]
  hadAlias: boolean
} {
  let hadAlias = false
  const filtered = lines.filter(line => {
    // Check if this is a claude alias
    if (CLAUDE_ALIAS_REGEX.test(line)) {
      // Extract the alias target - handle spaces, quotes, and various formats
      // First try with quotes
      let match = line.match(/alias\s+claude\s*=\s*["']([^"']+)["']/)
      if (!match) {
        // Try without quotes (capturing until end of line or comment)
        match = line.match(/alias\s+claude\s*=\s*([^#\n]+)/)
      }

      if (match && match[1]) {
        const target = match[1].trim()
        // Only remove if it points to the installer location
        // The installer always creates aliases with the full expanded path
        if (target === getLocalClaudePath()) {
          hadAlias = true
          return false // Remove this line
        }
      }
      // Keep custom aliases that don't point to the installer location
    }
    return true
  })
  return { filtered, hadAlias }
}

/**
 * densable `mnn` — read a shell config and split into lines.
 * Returns null if file doesn't exist / is inaccessible.
 * densable 2.1.214 #36: EISDIR (path is a directory) is soft-skipped with a
 * warn so update/doctor/status do not hang or blank when a shell-config path
 * resolves to a directory.
 */
export async function readFileLines(
  filePath: string,
): Promise<string[] | null> {
  try {
    const content = await readFile(filePath, { encoding: 'utf8' })
    return content.split('\n')
  } catch (e: unknown) {
    // densable Ko → null
    if (isFsInaccessible(e)) return null
    // densable Tae → warn + null (directory named like .bashrc)
    if (isEISDIR(e)) {
      logForDebugging(`Skipping ${filePath}: path is a directory`, {
        level: 'warn',
      })
      return null
    }
    throw e
  }
}

/**
 * Write lines back to a file
 */
export async function writeFileLines(
  filePath: string,
  lines: string[],
): Promise<void> {
  const fh = await open(filePath, 'w')
  try {
    await fh.writeFile(lines.join('\n'), { encoding: 'utf8' })
    await fh.datasync()
  } finally {
    await fh.close()
  }
}

/**
 * densable `cMs` — scan shell configs for a claude alias.
 * densable 2.1.214 #36: unreadable configs (EISDIR already soft in mnn; plus
 * L4e/BEt/CXy transient FS errors) are skipped with a warn so alias scan
 * cannot hang update/doctor or blank /status.
 * @param options Optional overrides for testing (env, homedir)
 */
export async function findClaudeAlias(
  options?: ShellConfigOptions,
): Promise<string | null> {
  const configs = getShellConfigPaths(options)

  for (const configPath of Object.values(configs)) {
    // densable: mnn(r).catch(o => L4e||BEt||CXy → warn skip unreadable)
    let lines: string[] | null
    try {
      lines = await readFileLines(configPath)
    } catch (e: unknown) {
      if (
        isFsInaccessible(e) ||
        isEISDIR(e) ||
        isTransientShellConfigError(e)
      ) {
        logForDebugging(
          `Skipping unreadable shell config ${configPath} during alias scan: ${errorMessage(e)}`,
          { level: 'warn' },
        )
        continue
      }
      throw e
    }
    if (!lines) continue

    for (const line of lines) {
      if (CLAUDE_ALIAS_REGEX.test(line)) {
        // Extract the alias target
        const match = line.match(/alias\s+claude=["']?([^"'\s]+)/)
        if (match && match[1]) {
          return match[1]
        }
      }
    }
  }

  return null
}

/**
 * Check if a claude alias exists and points to a valid executable
 * Returns the alias target if valid, null otherwise
 * @param options Optional overrides for testing (env, homedir)
 */
export async function findValidClaudeAlias(
  options?: ShellConfigOptions,
): Promise<string | null> {
  const aliasTarget = await findClaudeAlias(options)
  if (!aliasTarget) return null

  const home = options?.homedir ?? osHomedir()

  // Expand ~ to home directory
  const expandedPath = aliasTarget.startsWith('~')
    ? aliasTarget.replace('~', home)
    : aliasTarget

  // Check if the target exists and is executable
  try {
    const stats = await stat(expandedPath)
    // Check if it's a file (could be executable or symlink)
    if (stats.isFile() || stats.isSymbolicLink()) {
      return aliasTarget
    }
  } catch {
    // Target doesn't exist or can't be accessed
  }

  return null
}
