import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  setCachedClaudeMdContent,
} from './bootstrap/state.js'
import { getLocalISODate } from './constants/common.js'
import {
  filterInjectedMemoryFiles,
  getClaudeMds,
  getMemoryFiles,
  type MemoryFileInfo,
} from './utils/claudemd.js'
import { instructionFileOf, memoryFileOf } from './utils/instructionFiles.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from './utils/plugins/functionHooksModules.js'
import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
import { isBareMode, isEnvTruthy } from './utils/envUtils.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { getOauthAccountInfo } from './utils/auth.js'
import { logError } from './utils/log.js'
import {
  getPerforceModePromptAddendum,
  isPerforceModeEnabled,
} from './utils/perforceMode.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { isPowerShellToolEnabled } from './utils/shell/shellToolUtils.js'

export const MAX_STATUS_CHARS = 2000

// System prompt injection for cache breaking (ant-only, ephemeral debugging state)
let systemPromptInjection: string | null = null

export function getSystemPromptInjection(): string | null {
  return systemPromptInjection
}

export function setSystemPromptInjection(value: string | null): void {
  systemPromptInjection = value
  // Clear context caches immediately when injection changes
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
}

export const getGitStatus = memoize(async (): Promise<string | null> => {
  if (process.env.NODE_ENV === 'test') {
    // Avoid cycles in tests
    return null
  }

  const startTime = Date.now()
  logForDiagnosticsNoPII('info', 'git_status_started')

  const isGitStart = Date.now()
  const isGit = await getIsGit()
  logForDiagnosticsNoPII('info', 'git_is_git_check_completed', {
    duration_ms: Date.now() - isGitStart,
    is_git: isGit,
  })

  if (!isGit) {
    logForDiagnosticsNoPII('info', 'git_status_skipped_not_git', {
      duration_ms: Date.now() - startTime,
    })
    return null
  }

  try {
    const gitCmdsStart = Date.now()
    const [branch, mainBranch, status, log, userName] = await Promise.all([
      getBranch(),
      getDefaultBranch(),
      execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        gitExe(),
        ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
        {
          preserveOutputOnError: false,
        },
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(gitExe(), ['config', 'user.name'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
    ])

    logForDiagnosticsNoPII('info', 'git_commands_completed', {
      duration_ms: Date.now() - gitCmdsStart,
      status_length: status.length,
    })

    // Check if status exceeds character limit
    const shellTool = isPowerShellToolEnabled()
      ? POWERSHELL_TOOL_NAME
      : BASH_TOOL_NAME
    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          `\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using ${shellTool})`
        : status

    logForDiagnosticsNoPII('info', 'git_status_completed', {
      duration_ms: Date.now() - startTime,
      truncated: status.length > MAX_STATUS_CHARS,
    })

    return [
      `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
      `Current branch: ${branch}`,
      `Main branch (you will usually use this for PRs): ${mainBranch}`,
      ...(userName ? [`Git user: ${userName}`] : []),
      `Status:\n${truncatedStatus || '(clean)'}`,
      `Recent commits:\n${log}`,
    ].join('\n\n')
  } catch (error) {
    logForDiagnosticsNoPII('error', 'git_status_failed', {
      duration_ms: Date.now() - startTime,
    })
    logError(error)
    return null
  }
})

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getSystemContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'system_context_started')

    // Skip git status in CCR (unnecessary overhead on resume), when git instructions
    // are disabled, or when --exclude-dynamic-system-prompt-sections is set.
    // Official EXCLUDE_DYNAMIC_CONTEXT densable.
    let excludeDynamicContext = isEnvTruthy(
      process.env.CLAUDE_CODE_EXCLUDE_DYNAMIC_CONTEXT,
    )
    try {
      const { isExcludeDynamicContextEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./utils/residualFinalEnvGates.js') as typeof import('./utils/residualFinalEnvGates.js')
      excludeDynamicContext = isExcludeDynamicContextEnabled()
    } catch {
      // keep raw env fallback
    }
    // Official REMOTE densable — skip git status in CCR.
    let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
    try {
      const { isRemoteEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./utils/residualFinalEnvGates.js') as typeof import('./utils/residualFinalEnvGates.js')
      isRemote = isRemoteEnvEnabled()
    } catch {
      // keep raw env fallback
    }
    const gitStatus =
      isRemote || excludeDynamicContext || !shouldIncludeGitInstructions()
        ? null
        : await getGitStatus()

    // Include system prompt injection if set (for cache breaking, ant-only)
    const injection = feature('BREAK_CACHE_COMMAND')
      ? getSystemPromptInjection()
      : null

    logForDiagnosticsNoPII('info', 'system_context_completed', {
      duration_ms: Date.now() - startTime,
      has_git_status: gitStatus !== null,
      has_injection: injection !== null,
    })

    return {
      ...(gitStatus && { gitStatus }),
      // Official CLAUDE_CODE_PERFORCE_MODE — system-context checkout hint.
      ...(isPerforceModeEnabled()
        ? {
            perforceMode: getPerforceModePromptAddendum(
              isPowerShellToolEnabled() ? POWERSHELL_TOOL_NAME : BASH_TOOL_NAME,
            ),
          }
        : {}),
      ...(feature('BREAK_CACHE_COMMAND') && injection
        ? {
            cacheBreaker: `[CACHE_BREAKER: ${injection}]`,
          }
        : {}),
    }
  },
)

export type PromptContextBlock = {
  name: string
  text: string
}

/**
 * densable rgn / J3 / f2n — `prompt.context` may rewrite instructionFiles (agents-md)
 * and/or context blocks. A failed dispatch keeps the GEn CLAUDE.md walk.
 */
export async function applyPromptContextInstructionFiles(
  files: MemoryFileInfo[],
  blocks?: PromptContextBlock[] | Record<string, string>,
): Promise<MemoryFileInfo[]> {
  if (!hasMatchingFunctionHook('prompt.context')) return files
  const instructionFiles = files.map(instructionFileOf)
  const initialBlocks: PromptContextBlock[] = Array.isArray(blocks)
    ? blocks.map(b => ({ name: b.name, text: b.text }))
    : blocks !== undefined
      ? Object.entries(blocks).map(([name, text]) => ({ name, text }))
      : []
  try {
    const returned = (await runFunctionHookChain(
      'prompt.context',
      { blocks: initialBlocks, instructionFiles },
      async event => ({
        blocks: event.blocks,
        instructionFiles: event.instructionFiles,
      }),
    )) as { blocks?: unknown; instructionFiles?: unknown }
    if (Array.isArray(returned?.blocks)) {
      const nextBlocks = (returned.blocks as Array<Record<string, unknown>>)
        .filter(
          (b): b is PromptContextBlock =>
            b !== null &&
            typeof b === 'object' &&
            typeof b.name === 'string' &&
            typeof b.text === 'string',
        )
        .map(b => ({ name: b.name, text: b.text }))
      if (Array.isArray(blocks)) {
        blocks.splice(0, blocks.length, ...nextBlocks)
      } else if (blocks !== undefined) {
        for (const k of Object.keys(blocks)) {
          delete blocks[k]
        }
        for (const { name, text } of nextBlocks) {
          blocks[name] = text
        }
      }
    }
    const next = returned?.instructionFiles
    if (!Array.isArray(next)) return files
    const unchanged =
      next.length === instructionFiles.length &&
      next.every((item, idx) => {
        const prev = instructionFiles[idx]
        if (!prev || typeof item !== 'object' || item === null) return false
        const cand = item as Record<string, unknown>
        return (
          cand.path === prev.path &&
          cand.kind === prev.kind &&
          cand.content === prev.content &&
          cand.parent === prev.parent
        )
      })
    if (unchanged) return files
    return next.map(file => memoryFileOf(file, files))
  } catch {
    return files
  }
}

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'user_context_started')

    // CLAUDE_CODE_DISABLE_CLAUDE_MDS: hard off, always.
    // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
    // --bare means "skip what I didn't ask for", not "ignore what I asked for".
    let claudeMdsEnvDisabled = isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS,
    )
    try {
      const { isClaudeMdsDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./utils/residualFinalEnvGates.js') as typeof import('./utils/residualFinalEnvGates.js')
      claudeMdsEnvDisabled = isClaudeMdsDisabled()
    } catch {
      // residual helpers optional
    }
    const shouldDisableClaudeMd =
      claudeMdsEnvDisabled ||
      (isBareMode() && getAdditionalDirectoriesForClaudeMd().length === 0)
    // Await the async I/O (readFile/readdir directory walk) so the event
    // loop yields naturally at the first fs.readFile.
    const rawMemoryFiles = shouldDisableClaudeMd
      ? []
      : filterInjectedMemoryFiles(await getMemoryFiles())
    const initialClaudeMd = shouldDisableClaudeMd
      ? null
      : getClaudeMds(rawMemoryFiles)

    // densable 2.1.234 #5 / SEA UPb: account email only when not on
    // ANTHROPIC_UNIX_SOCKET; instruct model to identify-only, never exfiltrate.
    const userEmail = process.env.ANTHROPIC_UNIX_SOCKET
      ? undefined
      : getOauthAccountInfo()?.emailAddress

    const blockEntries: PromptContextBlock[] = [
      { name: 'claudeMd', text: initialClaudeMd ?? '' },
      ...(userEmail
        ? [
            {
              name: 'userEmail',
              text: `The user's email address is ${userEmail}. Use it only to identify the user, such as for authorship, attribution, or filtering their own work. Never send it to an unrelated service, such as in a request header, URL, or payload, unless the user explicitly asks.`,
            },
          ]
        : []),
      { name: 'currentDate', text: `Today's date is ${getLocalISODate()}.` },
    ]

    const hookedMemoryFiles = await applyPromptContextInstructionFiles(
      rawMemoryFiles,
      blockEntries,
    )
    const filesChanged = hookedMemoryFiles !== rawMemoryFiles
    const recomputedClaudeMd = shouldDisableClaudeMd
      ? null
      : filesChanged
        ? getClaudeMds(hookedMemoryFiles)
        : initialClaudeMd

    const resultBlocks: Record<string, string> = {}
    for (const { name, text } of blockEntries) {
      const effectiveText =
        name === 'claudeMd' && filesChanged && recomputedClaudeMd !== null
          ? recomputedClaudeMd
          : text
      if (name === 'claudeMd' && !effectiveText) continue
      resultBlocks[name] = effectiveText
    }
    const claudeMd = resultBlocks.claudeMd || null

    // Cache for the auto-mode classifier (yoloClassifier.ts reads this
    // instead of importing claudemd.ts directly, which would create a
    // cycle through permissions/filesystem → permissions → yoloClassifier).
    setCachedClaudeMdContent(claudeMd)

    logForDiagnosticsNoPII('info', 'user_context_completed', {
      duration_ms: Date.now() - startTime,
      claudemd_length: claudeMd?.length ?? 0,
      claudemd_disabled: Boolean(shouldDisableClaudeMd),
      has_user_email: Boolean(userEmail),
    })

    return resultBlocks
  },
)
