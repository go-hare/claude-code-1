/**
 * Official dPu — attach git status porcelain to auto-mode classifier context
 * for Bash/PowerShell when the command is destructive (gitStatusType) or
 * upload-related (gitStatusUploads). Portable subset of 2.1.207.
 */

import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getCwd } from '../cwd.js'
import {
  countGitStatusPorcelain,
  isGitStatusEnrichmentEnabled,
  resolveGitStatusTruncationLimit,
  resolveGitStatusType,
  resolveGitStatusUploads,
  truncateGitStatusLines,
} from './autoModeFlags.js'

/** Official ADg — git add/stage/commit/push (upload-related). */
const GIT_UPLOAD_RE = /\bgit\s+(?:add|stage|commit|push)\b/i

/**
 * Official wDg destructive categories (portable regex subset of qtt tags).
 * When gitStatusType is on, these commands get staged/modified/untracked counts.
 */
const DESTRUCTIVE_GIT_OR_RM_RE =
  /\b(?:git\s+(?:reset\s+--hard|checkout\s+\.|restore\s+\.|clean\s+-[a-zA-Z]*f)|rm\s+-[a-zA-Z]*[rf]|Remove-Item\s+.*-Recurse|Clear-Content\b)/i

export type AutoModeGitStatusPayload =
  | { clean: true }
  | { staged: number; modified: number; untracked: number }
  | { porcelain: string }

export function isGitUploadCommand(command: string): boolean {
  const sample = command.length > 10_000 ? command.slice(0, 10_000) : command
  return GIT_UPLOAD_RE.test(sample)
}

export function isDestructiveGitOrRmCommand(command: string): boolean {
  return DESTRUCTIVE_GIT_OR_RM_RE.test(command)
}

/**
 * Official dPu(toolName, input, abortSignal) — returns null when disabled or
 * inapplicable. Only Bash / PowerShell with a string `command` are considered.
 */
export async function fetchAutoModeGitStatus(
  toolName: string,
  toolInput: unknown,
  signal?: AbortSignal,
): Promise<AutoModeGitStatusPayload | null> {
  try {
    if (!isGitStatusEnrichmentEnabled()) return null
    if (toolName !== 'Bash' && toolName !== 'PowerShell') return null
    if (
      toolInput === null ||
      typeof toolInput !== 'object' ||
      !('command' in toolInput) ||
      typeof (toolInput as { command: unknown }).command !== 'string'
    ) {
      return null
    }
    const command = (toolInput as { command: string }).command
    const typeOn = resolveGitStatusType().value
    const uploadsOn = resolveGitStatusUploads().value
    const wantType = typeOn && isDestructiveGitOrRmCommand(command)
    const wantUploads = uploadsOn && isGitUploadCommand(command)
    if (!wantType && !wantUploads) return null

    const cwd = getCwd()
    const args = [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'safe.bareRepository=explicit',
      '-c',
      'protocol.file.allow=never',
      '--no-optional-locks',
      'status',
      '--porcelain',
      ...(wantUploads ? ['--untracked-files=all'] : []),
    ]
    const result = await execFileNoThrowWithCwd('git', args, {
      cwd,
      timeout: 2000,
      maxBuffer: 1_000_000,
      abortSignal: signal,
      preserveOutputOnError: false,
    })
    if (result.code !== 0) return null
    const stdout = result.stdout ?? ''

    if (wantUploads) {
      if (stdout.trim() === '') {
        return wantType ? { clean: true } : null
      }
      const lines = stdout.split('\n').filter(l => l.length > 0)
      // Official: untracked first, then the rest.
      const ordered = [
        ...lines.filter(l => l.startsWith('??')),
        ...lines.filter(l => !l.startsWith('??')),
      ].join('\n')
      const limit = resolveGitStatusTruncationLimit().value
      return { porcelain: truncateGitStatusLines(ordered, limit) }
    }

    const counts = countGitStatusPorcelain(stdout)
    if (
      counts.staged === 0 &&
      counts.modified === 0 &&
      counts.untracked === 0
    ) {
      return { clean: true }
    }
    return counts
  } catch {
    return null
  }
}
