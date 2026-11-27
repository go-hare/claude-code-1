import { isAbsolute, join } from 'path'
import { z } from 'zod/v4'
import {
  buildTool,
  isNativeToolDisabledInThisProcess,
  type ToolDef,
  type ToolDeps,
  type ToolResult,
  type ValidationResult,
} from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { isENOENT } from 'src/utils/errors.js'
import { FILE_NOT_FOUND_CWD_NOTE, suggestPathUnderCwd } from 'src/utils/file.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { expandPath, toRelativePath } from 'src/utils/path.js'
import { remoteHostForwardRefusal } from 'src/services/tools/remoteToolHost.js'
import { checkReadPermissionForTool } from 'src/utils/permissions/filesystem.js'
import {
  noteApprovedFileToolPath,
  takeApprovedFileToolPath,
} from 'src/utils/fileToolApprovedOpen.js'
import {
  compileReadDenyRgGlobs,
  openSearchRoot,
  type SearchRoot,
} from 'src/utils/searchRootGuard.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from 'src/utils/permissions/shellRuleMatching.js'
import { getGlobExclusionsForPluginCache } from 'src/utils/plugins/orphanedPluginFilter.js'
import { ripGrep, RipgrepTimeoutError } from 'src/utils/ripgrep.js'
import { semanticBoolean } from 'src/utils/semanticBoolean.js'
import { semanticNumber } from 'src/utils/semanticNumber.js'
import { plural } from 'src/utils/stringUtils.js'
import { isSafeGlobPattern } from 'src/utils/settings/validation.js'
import {
  bindTaskOutputForRead,
  isTaskOutputFilePath,
  taskOutputDirExclusions,
} from 'src/utils/task/diskOutput.js'
import { GREP_TOOL_NAME, getDescription } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z
      .string()
      .describe(
        'The regular expression pattern to search for in file contents',
      ),
    path: z
      .string()
      .optional()
      .describe(
        'File or directory to search in (rg PATH). Defaults to current working directory.',
      ),
    glob: z
      .string()
      .optional()
      .describe(
        'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
      ),
    output_mode: z
      .enum(['content', 'files_with_matches', 'count'])
      .optional()
      .describe(
        'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
      ),
    '-B': semanticNumber(z.number().optional()).describe(
      'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
    ),
    '-A': semanticNumber(z.number().optional()).describe(
      'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
    ),
    '-C': semanticNumber(z.number().optional()).describe('Alias for context.'),
    context: semanticNumber(z.number().optional()).describe(
      'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
    ),
    '-n': semanticBoolean(z.boolean().optional()).describe(
      'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
    ),
    '-i': semanticBoolean(z.boolean().optional()).describe(
      'Case insensitive search (rg -i)',
    ),
    type: z
      .string()
      .optional()
      .describe(
        'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
      ),
    head_limit: semanticNumber(z.number().optional()).describe(
      'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly — large result sets waste context).',
    ),
    offset: semanticNumber(z.number().optional()).describe(
      'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.',
    ),
    multiline: semanticBoolean(z.boolean().optional()).describe(
      'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
    ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Version control system directories to exclude from searches
// These are excluded automatically because they create noise in search results
const VCS_DIRECTORIES_TO_EXCLUDE = [
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
] as const

// Default cap on grep results when head_limit is unspecified. Unbounded content-mode
// greps can fill up to the 20KB persist threshold (~6-24K tokens/grep-heavy session).
// 250 is generous enough for exploratory searches while preventing context bloat.
// Pass head_limit=0 explicitly for unlimited.
const DEFAULT_HEAD_LIMIT = 250

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset: number = 0,
): { items: T[]; appliedLimit: number | undefined } {
  // Explicit 0 = unlimited escape hatch
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: undefined }
  }
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effectiveLimit)
  // Only report appliedLimit when truncation actually occurred, so the model
  // knows there may be more results and can paginate with offset.
  const wasTruncated = items.length - offset > effectiveLimit
  return {
    items: sliced,
    appliedLimit: wasTruncated ? effectiveLimit : undefined,
  }
}

// Format limit/offset information for display in tool results.
// appliedLimit is only set when truncation actually occurred (see applyHeadLimit),
// so it may be undefined even when appliedOffset is set — build parts conditionally
// to avoid "limit: undefined" appearing in user-visible output.
function formatLimitInfo(
  appliedLimit: number | undefined,
  appliedOffset: number | undefined,
): string {
  const parts: string[] = []
  if (appliedLimit !== undefined) parts.push(`limit: ${appliedLimit}`)
  if (appliedOffset) parts.push(`offset: ${appliedOffset}`)
  return parts.join(', ')
}

const outputSchema = lazySchema(() =>
  z.object({
    mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
    numFiles: z.number(),
    filenames: z.array(z.string()),
    content: z.string().optional(),
    numLines: z.number().optional(), // For content mode
    numMatches: z.number().optional(), // For count mode
    appliedLimit: z.number().optional(), // The limit that was applied (if any)
    appliedOffset: z.number().optional(), // The offset that was applied
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Output = z.infer<OutputSchema>

const GREP_FLAG_MODE_MAP: ReadonlyArray<
  readonly [string, string, 'files_with_matches' | 'count']
> = [
  ['-l', 'flag_l', 'files_with_matches'],
  ['-c', 'flag_c', 'count'],
]

function normalizeBoolFlag(val: unknown): unknown {
  return val === 'true' ? true : val === 'false' ? false : val
}

/**
 * Official 2.1.325 `YSn` (`coerceInput` for GrepTool):
 * - `file_path` -> `path` (when `path` absent or identical)
 * - `-l` -> `output_mode: "files_with_matches"`
 * - `-c` -> `output_mode: "count"`
 * - `-r` -> dropped (Grep always searches recursively)
 */
export function coerceGrepInput(raw: unknown): {
  input: z.infer<InputSchema>
  shapeClass: string
  resultNote: string
} | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  const shapes: string[] = []
  const notes: string[] = []
  const filePath = next.file_path
  if (typeof filePath === 'string' && filePath !== '') {
    const noPath = !Object.hasOwn(next, 'path')
    if (noPath || next.path === filePath) {
      delete next.file_path
      next.path = filePath
      shapes.push(noPath ? 'file_path' : 'repeated_file_path')
      notes.push(
        `${GREP_TOOL_NAME}'s parameter for where to search is named \`path\`. ${noPath ? '`file_path` was read as `path`.' : '`file_path` repeated `path` and was ignored.'}`,
      )
    }
  }
  for (const [flag, shapeName, mode] of GREP_FLAG_MODE_MAP) {
    if (normalizeBoolFlag(next[flag]) !== true) continue
    const noMode = !Object.hasOwn(next, 'output_mode')
    if (noMode || next.output_mode === mode) {
      delete next[flag]
      next.output_mode = mode
      shapes.push(noMode ? shapeName : `repeated_${shapeName}`)
      notes.push(
        noMode
          ? `\`${flag}\` is not a ${GREP_TOOL_NAME} parameter and was read as \`output_mode: "${mode}"\`.`
          : `\`${flag}\` repeated \`output_mode\` and was ignored.`,
      )
    }
  }
  if (normalizeBoolFlag(next['-r']) === true) {
    delete next['-r']
    shapes.push('flag_r')
    notes.push(
      `\`-r\` was ignored: ${GREP_TOOL_NAME} always searches a directory recursively.`,
    )
  }
  return shapes.length > 0
    ? {
        input: next as z.infer<InputSchema>,
        shapeClass: shapes.join(','),
        resultNote: `Note: ${notes.join(' ')}`,
      }
    : null
}

export const GrepTool = buildTool({
  name: GREP_TOOL_NAME,
  searchHint: 'search file contents with regex (ripgrep)',
  // densable ix remoteExecution + backgrounding never
  remoteExecution: { supported: true },
  backgrounding: 'never',
  // 20K chars - tool result persistence threshold
  maxResultSizeChars: 20_000,
  strict: true,
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Search'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Searching for ${summary}` : 'Searching'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  coerceInput: coerceGrepInput,
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.path ? `${input.pattern} in ${input.path}` : input.pattern
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: false }
  },
  getPath({ path }): string {
    if (isNativeToolDisabledInThisProcess(GREP_TOOL_NAME)) {
      return path ?? ''
    }
    return path || getCwd()
  },
  async preparePermissionMatcher({ pattern }) {
    return rulePattern => matchWildcardPattern(rulePattern, pattern)
  },
  async prompt() {
    return getDescription()
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  // SearchResultSummary shows content (mode=content) or filenames.join.
  // numFiles/numLines/numMatches are chrome ("Found 3 files") — fine to
  // skip (under-count, not phantom). Glob reuses this via UI.tsx:65.
  extractSearchText({ mode, content, filenames }) {
    if (mode === 'content' && content) return content
    return filenames.join('\n')
  },
  mapToolResultToToolResultBlockParam(
    {
      mode = 'files_with_matches',
      numFiles,
      filenames,
      content,
      numLines: _numLines,
      numMatches,
      appliedLimit,
      appliedOffset,
    },
    toolUseID,
  ) {
    if (mode === 'content') {
      const limitInfo = formatLimitInfo(appliedLimit, appliedOffset)
      const resultContent = content || 'No matches found'
      const finalContent = limitInfo
        ? `${resultContent}\n\n[Showing results with pagination = ${limitInfo}]`
        : resultContent
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: finalContent,
      }
    }

    if (mode === 'count') {
      const limitInfo = formatLimitInfo(appliedLimit, appliedOffset)
      const rawContent = content || 'No matches found'
      const matches = numMatches ?? 0
      const files = numFiles ?? 0
      const summary = `\n\nFound ${matches} total ${matches === 1 ? 'occurrence' : 'occurrences'} across ${files} ${files === 1 ? 'file' : 'files'}.${limitInfo ? ` with pagination = ${limitInfo}` : ''}`
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: rawContent + summary,
      }
    }

    // files_with_matches mode
    const limitInfo = formatLimitInfo(appliedLimit, appliedOffset)
    if (numFiles === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No files found',
      }
    }
    // head_limit has already been applied in call() method, so just show all filenames
    const result = `Found ${numFiles} ${plural(numFiles, 'file')}${limitInfo ? ` ${limitInfo}` : ''}\n${filenames.join('\n')}`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
  create(deps: ToolDeps) {
    return {
      async validateInput(input): Promise<ValidationResult> {
        // densable BT() && xd(n) — named host is not forwarded (errorCode 3)
        const hostRefusal = remoteHostForwardRefusal(input, GREP_TOOL_NAME)
        if (hostRefusal) return { ...hostRefusal, errorCode: 3 }
        // Official 2.1.326 (#122): reject malformed/pathological glob patterns
        // upfront so Grep never hangs on catastrophic backtracking or unbalanced braces.
        if (input.glob) {
          const globCheck = isSafeGlobPattern(input.glob)
          if (!globCheck.safe) {
            return {
              result: false,
              message: `Invalid glob pattern: ${globCheck.reason}`,
              errorCode: 2,
            }
          }
        }
        const { path } = input
        // If path is provided, validate that it exists
        if (path) {
          const fs = getFsImplementation()
          const absolutePath = expandPath(path)

          // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
          if (
            absolutePath.startsWith('\\\\') ||
            absolutePath.startsWith('//')
          ) {
            return { result: true }
          }

          try {
            await fs.stat(absolutePath)
          } catch (e: unknown) {
            if (isENOENT(e)) {
              const cwdSuggestion = await suggestPathUnderCwd(absolutePath)
              let message = `Path does not exist: ${path}. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
              if (cwdSuggestion) {
                message += ` Did you mean ${cwdSuggestion}?`
              }
              return {
                result: false,
                message,
                errorCode: 1,
              }
            }
            throw e
          }
        }

        return { result: true }
      },
      async checkPermissions(input): Promise<PermissionDecision> {
        noteApprovedFileToolPath(input.path ? expandPath(input.path) : getCwd())
        return checkReadPermissionForTool(GrepTool, input, deps.permissions())
      },
      async call(
        {
          pattern,
          path,
          glob,
          type,
          output_mode = 'files_with_matches',
          '-B': context_before,
          '-A': context_after,
          '-C': context_c,
          context,
          '-n': show_line_numbers = true,
          '-i': case_insensitive = false,
          head_limit,
          offset = 0,
          multiline = false,
        },
        callCtx,
      ) {
        const absolutePath = path ? expandPath(path) : getCwd()
        const args = ['--hidden']

        // Exclude VCS directories to avoid noise from version control metadata
        for (const dir of VCS_DIRECTORIES_TO_EXCLUDE) {
          args.push('--glob', `!${dir}`)
        }

        // Limit line length to prevent base64/minified content from cluttering output
        args.push('--max-columns', '500')

        // Only apply multiline flags when explicitly requested
        if (multiline) {
          args.push('-U', '--multiline-dotall')
        }

        // Add optional flags
        if (case_insensitive) {
          args.push('-i')
        }

        // Add output mode flags
        if (output_mode === 'files_with_matches') {
          args.push('-l')
        } else if (output_mode === 'count') {
          args.push('-c')
        }

        // In content mode, always pass `--null` and `-n` to ripgrep so file paths
        // end unambiguously at `\0` (avoiding `:`/`-` filename ambiguity when
        // sorting/relativizing) and line-number prefixes can be stripped when
        // `show_line_numbers` is false (matching official 2.1.328).
        if (output_mode === 'content') {
          args.push('--null', '-n')
        }

        // Add context flags (-C/context takes precedence over context_before/context_after)
        if (output_mode === 'content') {
          if (context !== undefined) {
            args.push('-C', context.toString())
          } else if (context_c !== undefined) {
            args.push('-C', context_c.toString())
          } else {
            if (context_before !== undefined) {
              args.push('-B', context_before.toString())
            }
            if (context_after !== undefined) {
              args.push('-A', context_after.toString())
            }
          }
        }

        // If pattern starts with dash, use -e flag to specify it as a pattern
        // This prevents ripgrep from interpreting it as a command-line option
        if (pattern.startsWith('-')) {
          args.push('-e', pattern)
        } else {
          args.push(pattern)
        }

        // Add type filter if specified
        if (type) {
          args.push('--type', type)
        }

        if (glob) {
          // Split on commas and spaces, but preserve patterns with braces
          const globPatterns: string[] = []
          const rawPatterns = glob.split(/\s+/)

          for (const rawPattern of rawPatterns) {
            // If pattern contains braces, don't split further
            if (rawPattern.includes('{') && rawPattern.includes('}')) {
              globPatterns.push(rawPattern)
            } else {
              // Split on commas for patterns without braces
              globPatterns.push(...rawPattern.split(',').filter(Boolean))
            }
          }

          for (const globPattern of globPatterns.filter(Boolean)) {
            args.push('--glob', globPattern)
          }
        }

        const permissionContext = deps.permissions()
        const approved = takeApprovedFileToolPath(absolutePath)
        const root = await openSearchRoot(absolutePath, approved)
        let results: string[] = []
        if (root) {
          let boundTaskOutput:
            | Awaited<ReturnType<typeof bindTaskOutputForRead>>
            | undefined
          try {
            await root.recheckBeforeSpawn()
            for (const denyGlob of compileReadDenyRgGlobs(
              permissionContext,
              root,
            )) {
              args.push('--glob', denyGlob)
            }

            for (const exclusion of await getGlobExclusionsForPluginCache(
              absolutePath,
            )) {
              args.push('--glob', exclusion)
            }

            const taskOutputCandidate = isTaskOutputFilePath(absolutePath)
              ? absolutePath
              : isTaskOutputFilePath(root.canonical)
                ? root.canonical
                : undefined
            if (taskOutputCandidate !== undefined) {
              boundTaskOutput = await bindTaskOutputForRead(taskOutputCandidate)
            } else {
              const taskExclusions = taskOutputDirExclusions(root.canonical)
              if (taskExclusions.includes('!**')) {
                throw new Error(
                  "Task output files are read individually: Grep (or Read) a specific task's output path rather than the tasks directory.",
                )
              }
              for (const taskExcl of taskExclusions) {
                args.push('--glob', taskExcl)
              }
            }

            results = await ripGrep(args, root.target, callCtx.signal, {
              rejectOnInputError: true,
              rejectOnPartial: true,
              cwd: root.spawnCwd,
            }).catch(err => {
              if (
                err instanceof RipgrepTimeoutError &&
                err.partialResults.length > 0
              ) {
                return err.partialResults
              }
              throw err
            })
            if (root.relativeOutput) {
              results = results.map(line =>
                absolutizeRipgrepLine(line, root, output_mode),
              )
            }
          } finally {
            await boundTaskOutput?.close()
            await root.close()
          }
        }

        if (output_mode === 'content') {
          // Official 2.1.327 (#414, SEA `zns`/`mHn`): sort content results by file
          // path before paging with head_limit & offset so pages never repeat or
          // skip matches when ripgrep returns files in non-deterministic worker order.
          const hasContextBreaks = [
            context,
            context_c,
            context_before,
            context_after,
          ].some(v => typeof v === 'number' && v > 0)
          // Single-file rg output omits the filename prefix (lines start with `lineno:text`),
          // so skip file-path sorting to preserve line order.
          const sortedResults =
            root?.isDirectory === false
              ? results
              : sortGrepContentLines(results, hasContextBreaks)

          // Apply head_limit first — relativize is per-line work, so
          // avoid processing lines that will be discarded (broad patterns can
          // return 10k+ lines with head_limit keeping only ~30-100).
          const { items: limitedResults, appliedLimit } = applyHeadLimit(
            sortedResults,
            head_limit,
            offset,
          )

          const finalLines = limitedResults.map(line => {
            if (line === '--') return line
            const nulIdx = line.indexOf('\0')
            if (nulIdx < 0) {
              // Single-file rg output omits the filename prefix (`lineno:text` or `lineno-text`).
              return show_line_numbers ? line : line.replace(/^\d+[:-]/, '')
            }
            const filePath = line.substring(0, nulIdx)
            const rest = line.substring(nulIdx + 1)
            const lineNoMatch = /^(\d+)([:-])/.exec(rest)
            const sep = lineNoMatch?.[2] ?? ':'
            const formattedRest =
              show_line_numbers || lineNoMatch === null
                ? rest
                : rest.substring(lineNoMatch[0].length)
            return toRelativePath(filePath) + sep + formattedRest
          })
          const output = {
            mode: 'content' as const,
            numFiles: 0, // Not applicable for content mode
            filenames: [],
            content: finalLines.join('\n'),
            numLines: finalLines.length,
            ...(appliedLimit !== undefined && { appliedLimit }),
            ...(offset > 0 && { appliedOffset: offset }),
          }
          return { data: output }
        }

        if (output_mode === 'count') {
          // Official 2.1.327 (#414, SEA `mHn`): sort count results by file path
          // before paging with head_limit & offset so pages are deterministic.
          const sortedCountResults = sortGrepCountLines(results)
          // Apply head_limit first to avoid relativizing entries that will be discarded.
          const { items: limitedResults, appliedLimit } = applyHeadLimit(
            sortedCountResults,
            head_limit,
            offset,
          )

          // Convert absolute paths to relative paths to save tokens
          const finalCountLines = limitedResults.map(line => {
            // Lines have format: /absolute/path:count
            const colonIndex = line.lastIndexOf(':')
            if (colonIndex > 0) {
              const filePath = line.substring(0, colonIndex)
              const count = line.substring(colonIndex)
              return toRelativePath(filePath) + count
            }
            return line
          })

          // Parse count output to extract total matches and file count
          let totalMatches = 0
          let fileCount = 0
          for (const line of finalCountLines) {
            const colonIndex = line.lastIndexOf(':')
            if (colonIndex > 0) {
              const countStr = line.substring(colonIndex + 1)
              const count = parseInt(countStr, 10)
              if (!isNaN(count)) {
                totalMatches += count
                fileCount += 1
              }
            }
          }

          const output = {
            mode: 'count' as const,
            numFiles: fileCount,
            filenames: [],
            content: finalCountLines.join('\n'),
            numMatches: totalMatches,
            ...(appliedLimit !== undefined && { appliedLimit }),
            ...(offset > 0 && { appliedOffset: offset }),
          }
          return { data: output }
        }

        // For files_with_matches mode (default)
        // Use allSettled so a single ENOENT (file deleted between ripgrep's scan
        // and this stat) does not reject the whole batch. Failed stats sort as mtime 0.
        const stats = await Promise.allSettled(
          results.map(_ => getFsImplementation().stat(_)),
        )
        const sortedMatches = results
          // Sort by modification time
          .map((_, i) => {
            const r = stats[i]!
            return [
              _,
              r.status === 'fulfilled' ? (r.value.mtimeMs ?? 0) : 0,
            ] as const
          })
          .sort((a, b) => {
            if (process.env.NODE_ENV === 'test') {
              // In tests, we always want to sort by filename, so that results are deterministic
              return a[0].localeCompare(b[0])
            }
            const timeComparison = b[1] - a[1]
            if (timeComparison === 0) {
              // Sort by filename as a tiebreaker
              return a[0].localeCompare(b[0])
            }
            return timeComparison
          })
          .map(_ => _[0])

        // Apply head_limit to sorted file list (like "| head -N")
        const { items: finalMatches, appliedLimit } = applyHeadLimit(
          sortedMatches,
          head_limit,
          offset,
        )

        // Convert absolute paths to relative paths to save tokens
        const relativeMatches = finalMatches.map(toRelativePath)

        const output = {
          mode: 'files_with_matches' as const,
          filenames: relativeMatches,
          numFiles: relativeMatches.length,
          ...(appliedLimit !== undefined && { appliedLimit }),
          ...(offset > 0 && { appliedOffset: offset }),
        }

        return {
          data: output,
        }
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function absolutizeRipgrepLine(
  line: string,
  root: SearchRoot,
  outputMode: string,
): string {
  if (outputMode === 'content' && line === '--') {
    return line
  }
  if (outputMode !== 'content' && outputMode !== 'count') {
    return isAbsolute(line) ? line : join(root.canonical, line)
  }
  if (outputMode === 'content') {
    const nulIdx = line.indexOf('\0')
    if (nulIdx > 0) {
      const filePath = line.slice(0, nulIdx)
      const rest = line.slice(nulIdx)
      const absolute = isAbsolute(filePath)
        ? filePath
        : join(root.canonical, filePath)
      return absolute + rest
    }
  }
  const sepIdx =
    outputMode === 'count' ? line.lastIndexOf(':') : line.indexOf(':')
  if (sepIdx <= 0) {
    return isAbsolute(line) ? line : join(root.canonical, line)
  }
  const filePath = line.slice(0, sepIdx)
  const rest = line.slice(sepIdx)
  const absolute = isAbsolute(filePath)
    ? filePath
    : join(root.canonical, filePath)
  return absolute + rest
}

/**
 * Official 2.1.327 (#414, SEA `mHn`): deterministic comparator for grouped grep
 * entries by file path (UTF-16 code-unit order, tie-breaking on joined lines).
 */
function compareGrepFileGroups(
  a: { path: string; lines: string[] },
  b: { path: string; lines: string[] },
): number {
  if (a.path < b.path) return -1
  if (a.path > b.path) return 1
  const aJoined = a.lines.join('\n')
  const bJoined = b.lines.join('\n')
  return aJoined < bJoined ? -1 : aJoined > bJoined ? 1 : 0
}

/**
 * Official 2.1.327 (#414, SEA `zns`/`mHn`): group ripgrep content lines by
 * file path (handling `\0`-delimited `--null` output, `--` context separators,
 * `path:line:text`, `path-line-text`, and `-n: false` `path:text`/`path-text`
 * context lines), sort file groups by path, and re-join.
 */
export function sortGrepContentLines(
  lines: readonly string[],
  hasContextBreaks = false,
): string[] {
  if (lines.length <= 1) return [...lines]
  const groups: Array<{ path: string; lines: string[] }> = []
  const byPath = new Map<string, { path: string; lines: string[] }>()
  let currentGroup: { path: string; lines: string[] } | null = null
  let sawSeparator = false
  const ungrouped: string[] = []

  // Split into hunks separated by `--` so before-context lines (including
  // `-n: false` `path-text` and context text containing `:digits:` like
  // `b.ts-1-time=12:34:56`) can resolve against match-line paths in the same
  // hunk without mis-grouping filenames containing `-<digits>-`.
  const hunks: string[][] = [[]]
  for (const line of lines) {
    if (line === '--') {
      hunks.push([])
    } else {
      hunks[hunks.length - 1]!.push(line)
    }
  }

  const analyzeHunk = (
    hunkLines: readonly string[],
  ): { matchPaths: string[]; hasLineNumbers: boolean } => {
    const withLineNo = new Set<string>()
    const withoutLineNo = new Set<string>()
    for (const l of hunkLines) {
      if (l.includes('\0')) continue
      const mLineNo = /^((?:[A-Za-z]:)?[^:\r\n]+):\d+:/.exec(l)
      if (mLineNo?.[1]) {
        withLineNo.add(mLineNo[1])
      } else {
        const mColon = /^((?:[A-Za-z]:)?[^:\r\n]+):/.exec(l)
        if (mColon?.[1]) {
          withoutLineNo.add(mColon[1])
        }
      }
    }
    const hasLineNumbers = withLineNo.size > 0
    const pathSet = hasLineNumbers ? withLineNo : withoutLineNo
    const matchPaths = Array.from(pathSet).sort((a, b) => b.length - a.length)
    return { matchPaths, hasLineNumbers }
  }

  const extractPath = (
    line: string,
    hunkMatchPaths: readonly string[],
    hunkHasLineNumbers: boolean,
  ): string | null => {
    const nulIdx = line.indexOf('\0')
    if (nulIdx > 0) {
      return line.slice(0, nulIdx)
    }
    if (hasContextBreaks && currentGroup !== null) {
      if (line.startsWith(currentGroup.path)) {
        const suffix = line.slice(currentGroup.path.length)
        if (
          /^-\d+-/.test(suffix) ||
          (!hunkHasLineNumbers && suffix.startsWith('-'))
        ) {
          return currentGroup.path
        }
      }
    }
    if (hasContextBreaks && hunkMatchPaths.length > 0) {
      for (const candidatePath of hunkMatchPaths) {
        if (!line.startsWith(candidatePath)) continue
        const suffix = line.slice(candidatePath.length)
        if (
          /^-\d+-/.test(suffix) ||
          (!hunkHasLineNumbers && suffix.startsWith('-'))
        ) {
          return candidatePath
        }
      }
    }
    const matchWithLineNo = /^((?:[A-Za-z]:)?[^:\r\n]+):\d+:/.exec(line)
    if (matchWithLineNo?.[1]) return matchWithLineNo[1]
    if (hasContextBreaks) {
      const dashMatch = /^((?:[A-Za-z]:)?[^:\r\n]+?)-\d+-/.exec(line)
      if (dashMatch?.[1]) return dashMatch[1]
    }
    // Fallback for `-n: false` (`path:text` without line numbers).
    const colonMatch = /^((?:[A-Za-z]:)?[^:\r\n]+):/.exec(line)
    if (colonMatch?.[1]) return colonMatch[1]
    return null
  }

  for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    if (hunkIdx > 0) {
      currentGroup = null
      sawSeparator = true
    }
    const hunkLines = hunks[hunkIdx]!
    if (hunkLines.length === 0) continue
    const { matchPaths, hasLineNumbers } = analyzeHunk(hunkLines)
    for (const line of hunkLines) {
      const path = extractPath(line, matchPaths, hasLineNumbers)
      if (path === null) {
        if (currentGroup) {
          currentGroup.lines.push(line)
        } else {
          ungrouped.push(line)
        }
        sawSeparator = false
        continue
      }
      let group = byPath.get(path)
      if (!group) {
        group = { path, lines: [] }
        byPath.set(path, group)
        groups.push(group)
      } else if (
        hasContextBreaks &&
        group.lines.length > 0 &&
        group.lines[group.lines.length - 1] !== '--' &&
        (sawSeparator || (currentGroup !== null && currentGroup !== group))
      ) {
        group.lines.push('--')
      }
      group.lines.push(line)
      currentGroup = group
      sawSeparator = false
    }
  }

  if (groups.length === 0) {
    return [...lines]
  }

  // Strip trailing `--` separators that belonged to a file transition
  for (const group of groups) {
    while (
      group.lines.length > 0 &&
      group.lines[group.lines.length - 1] === '--'
    ) {
      group.lines.pop()
    }
  }

  groups.sort(compareGrepFileGroups)

  const sorted: string[] = []
  for (const group of groups) {
    if (group.lines.length === 0) continue
    if (hasContextBreaks && sorted.length > 0) {
      sorted.push('--')
    }
    for (const l of group.lines) {
      sorted.push(l)
    }
  }
  for (const l of ungrouped) {
    sorted.push(l)
  }
  return sorted
}

/**
 * Official 2.1.327 (#414, SEA `mHn`): sort ripgrep count lines (`path:count`)
 * by file path before pagination.
 */
export function sortGrepCountLines(lines: readonly string[]): string[] {
  if (lines.length <= 1) return [...lines]
  return lines
    .map(line => {
      const colonIdx = line.lastIndexOf(':')
      const path = colonIdx > 0 ? line.slice(0, colonIdx) : line
      return { path, lines: [line] }
    })
    .sort(compareGrepFileGroups)
    .flatMap(entry => entry.lines)
}
