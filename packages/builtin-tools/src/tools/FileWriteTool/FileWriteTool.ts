import { basename, dirname, isAbsolute, sep } from 'path'
import { validateCoordinatorWriteAccess } from 'src/coordinator/writeGuard.js'
import { logEvent } from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { z } from 'zod/v4'
import { diagnosticTracker } from 'src/services/diagnosticTracking.js'
import { clearDeliveredDiagnosticsForFile } from 'src/services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from 'src/services/lsp/manager.js'
import { notifyVscodeFileUpdated } from 'src/services/mcp/vscodeSdkMcp.js'
import { checkTeamMemSecrets } from 'src/services/teamMemorySync/teamMemSecretGuard.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from 'src/skills/loadSkillsDir.js'
import type { ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import { countLinesChanged, getPatchForDisplay } from 'src/utils/diff.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isPerforceModeEnabled } from 'src/utils/perforceMode.js'
import { isENOENT } from 'src/utils/errors.js'
import { getFileModificationTime, writeTextContent } from 'src/utils/file.js'
import {
  fileStateContentMatches,
  isFullEnoughFileRead,
} from 'src/utils/fileStateCache.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from 'src/utils/fileHistory.js'
import { logFileOperation } from 'src/utils/fileOperationAnalytics.js'
import { readFileSyncWithMetadata } from 'src/utils/fileRead.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { fetchSingleFileGitDiff, type ToolUseDiff } from 'src/utils/gitDiff.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { stampNewMemoryContent } from 'src/memdir/stampNewMemoryContent.js'
import { expandPath } from 'src/utils/path.js'
import { checkBgIsolationWriteBlock } from 'src/utils/bgIsolationContainment.js'
import {
  checkWritePermissionForTool,
  matchingRuleForInput,
  matchesPathRule,
} from 'src/utils/permissions/filesystem.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../FileEditTool/constants.js'
import { gitDiffSchema, hunkSchema } from '../FileEditTool/types.js'
import {
  FILE_READ_DENY_CANNOT_WRITE,
  isPathCoveredByReadDenyRule,
  shouldAllowCallDespiteMissingOrPartialRead,
  shouldSkipWriteUnreadGate,
} from '../shared/fileEditReadGate.js'
import { FILE_WRITE_TOOL_NAME, getWriteToolDescription } from './prompt.js'
import {
  getToolUseSummary,
  isResultTruncated,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe(
        'The absolute path to the file to write (must be absolute, not relative)',
      ),
    content: z.string().describe('The content to write to the file'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    type: z
      .enum(['create', 'update'])
      .describe(
        'Whether a new file was created or an existing file was updated',
      ),
    filePath: z.string().describe('The path to the file that was written'),
    content: z.string().describe('The content that was written to the file'),
    structuredPatch: z
      .array(hunkSchema())
      .describe('Diff patch showing the changes'),
    originalFile: z
      .string()
      .nullable()
      .describe(
        'The original file content before the write (null for new files)',
      ),
    gitDiff: gitDiffSchema().optional(),
    userModified: z
      .boolean()
      .optional()
      .describe('Whether the user modified the proposed content'),
    memdirStamped: z
      .boolean()
      .optional()
      .describe('Whether auto-memory stamping rewrote the content'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

/** densable 2.1.239 — subagent REPORT/SUMMARY/FINDINGS/ANALYSIS.md gate. */
const SUBAGENT_REPORT_NAME = /^(REPORT|SUMMARY|FINDINGS|ANALYSIS).*\.md$/i
const SUBAGENT_REPORT_BLOCKED =
  'Subagents should return findings as text, not write report files. Include this content in your final response instead.'

const USER_MODIFIED_NOTE =
  ' The user modified your proposed content before accepting it.'

/** densable mNr — Perforce unopened read-only copy. */
const PERFORCE_UNOPENED_READONLY =
  'File is read-only — it has not been opened for edit in Perforce. Run `p4 edit <file>` to check it out, then retry. Do not chmod the file writable; that bypasses Perforce tracking.'

/** densable hNr(mode) — CLAUDE_CODE_PERFORCE_MODE && (mode & 128) === 0 */
function isPerforceUnopenedReadOnly(mode: number): boolean {
  return isPerforceModeEnabled() && (mode & 128) === 0
}

/**
 * Local safety (not densable): directory / FIFO must not reach call().
 * Raw EISDIR after shouldSkipWriteUnreadGate lets the model try to delete
 * the directory. errorCode 10 matches FileRead/FileEdit directory rejects;
 * do not reuse 5 (subagent report) or 6 (Perforce). FIFO is detected via
 * mode bits so the densable 239 source lock stays intact.
 */
const STAT_FILE_TYPE_MASK = 0o170000
const STAT_FIFO_TYPE = 0o010000

function isExistingDirectoryOrFifo(fileStat: {
  mode: number
  isDirectory: () => boolean
}): boolean {
  return (
    fileStat.isDirectory() ||
    (fileStat.mode & STAT_FILE_TYPE_MASK) === STAT_FIFO_TYPE
  )
}

export type Output = z.infer<OutputSchema>
export type FileWriteToolInput = InputSchema

export const FileWriteTool = buildTool({
  name: FILE_WRITE_TOOL_NAME,
  searchHint: 'create or overwrite files',
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return 'Write a file to the local filesystem.'
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Writing ${summary}` : 'Writing file'
  },
  async prompt() {
    return getWriteToolDescription()
  },
  renderToolUseMessage,
  isResultTruncated,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.content}`
  },
  getPath(input): string {
    return input.file_path
  },
  inputsEquivalent(a, b) {
    if (a.file_path !== b.file_path) return false
    if (a.content === b.content) return true
    return a.content.replace(/\n+$/, '') === b.content.replace(/\n+$/, '')
  },
  stripForStorage(output) {
    if (typeof output !== 'object' || output === null) return output
    if (output.type !== 'update') return output
    if (output.content === '' && (output.originalFile ?? '') === '') {
      return output
    }
    return { ...output, content: '', originalFile: null }
  },
  backfillObservableInput(input) {
    // hooks.mdx documents file_path as absolute; expand so hook allowlists
    // can't be bypassed via ~ or relative paths.
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },
  async preparePermissionMatcher({ file_path }) {
    // densable hqe: allow-style single-segment dir/** is cwd-only (#44)
    return pattern => matchesPathRule(pattern, file_path)
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      FileWriteTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  extractSearchText() {
    // Transcript render shows either content (create, via HighlightedCode)
    // or a structured diff (update). The heuristic's 'content' allowlist key
    // would index the raw content string even in update mode where it's NOT
    // shown — phantom. Under-count: tool_use already indexes file_path.
    return ''
  },
  async validateInput({ file_path, content }, toolUseContext: ToolUseContext) {
    const fullFilePath = expandPath(file_path)

    // densable 2.1.217 #5 hsr — bg / worktree isolation containment (errorCode 7)
    const isolationBlock = checkBgIsolationWriteBlock(fullFilePath, {
      agentId: toolUseContext.agentId,
      agentWorktree: toolUseContext.agentWorktree,
    })
    if (isolationBlock) {
      return { result: false, message: isolationBlock, errorCode: 7 }
    }

    // densable 2.1.239: subagent must return findings as text, not report.md
    if (
      toolUseContext.agentId &&
      SUBAGENT_REPORT_NAME.test(basename(fullFilePath))
    ) {
      logEvent('tengu_subagent_md_report_blocked', {
        contentBytes: Buffer.byteLength(content),
      })
      return {
        result: false,
        message: SUBAGENT_REPORT_BLOCKED,
        errorCode: 5,
      }
    }

    // Reject writes to team memory files that contain secrets
    const secretError = checkTeamMemSecrets(fullFilePath, content)
    if (secretError) {
      return { result: false, message: secretError, errorCode: 0 }
    }

    // Check if path should be ignored based on permission settings
    const appState = toolUseContext.getAppState()
    const denyRule = matchingRuleForInput(
      fullFilePath,
      appState.toolPermissionContext,
      'edit',
      'deny',
    )
    if (denyRule !== null) {
      return {
        result: false,
        message:
          'File is in a directory that is denied by your permission settings.',
        errorCode: 1,
      }
    }

    // densable l8t — Read deny covers this path/tool → dedicated write copy
    // (errorCode 13), not the generic "has not been read yet" unread message.
    if (
      isPathCoveredByReadDenyRule(fullFilePath, appState.toolPermissionContext)
    ) {
      return {
        result: false,
        message: FILE_READ_DENY_CANNOT_WRITE,
        errorCode: 13,
      }
    }

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    // On Windows, fs.existsSync() on UNC paths triggers SMB authentication which could
    // leak credentials to malicious servers. Let the permission check handle UNC paths.
    if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
      return { result: true }
    }

    const fs = getFsImplementation()
    let fileMtimeMs: number
    try {
      const fileStat = await fs.stat(fullFilePath)
      // densable hNr(d.mode) → errorCode 6 + mNr.
      if (isPerforceUnopenedReadOnly(fileStat.mode)) {
        return {
          result: false,
          message: PERFORCE_UNOPENED_READONLY,
          errorCode: 6,
        }
      }
      // Local: refuse directory/FIFO with a filename hint (errorCode 10).
      if (isExistingDirectoryOrFifo(fileStat)) {
        const kind = fileStat.isDirectory()
          ? 'an existing directory'
          : 'a FIFO or pipe, not a regular file'
        return {
          result: false,
          message: `Cannot write '${file_path}': the specified path is ${kind}. Specify a path that includes a filename.`,
          errorCode: 10,
        }
      }
      fileMtimeMs = fileStat.mtimeMs
    } catch (e) {
      if (isENOENT(e)) {
        return validateCoordinatorWriteAccess({
          filePath: fullFilePath,
          sourceTool: 'FileWriteTool',
        })
      }
      throw e
    }

    // densable 2.1.228 #17 Write: existing file requires prior non-partial read
    // (errorCode 2) unless guardSkipped (non-legacy model + Read auto-allow).
    // stale mtime uses HOe+xOe content equality bypass (errorCode 3).
    const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
    if (!readTimestamp || readTimestamp.isPartialView) {
      // densable:
      //   f=!c&&!ZYd(n)&&!J4t(d)&&MCt(nu,n,r,yn(r))
      //   if(!f) return not-read errorCode 2; return ok
      const guardSkipped = shouldSkipWriteUnreadGate(
        fullFilePath,
        toolUseContext,
        Boolean(readTimestamp),
        readTimestamp?.isPartialView === true,
      )
      logEvent('tengu_write_tool_not_read_hypothetical', {
        isPartialView: readTimestamp?.isPartialView === true,
        isFilePathAbsolute: isAbsolute(fullFilePath),
        guardSkipped,
      })
      if (!guardSkipped) {
        return {
          result: false,
          message:
            'File has not been read yet. Read it first before writing to it.',
          errorCode: 2,
        }
      }
      return validateCoordinatorWriteAccess({
        filePath: fullFilePath,
        sourceTool: 'FileWriteTool',
      })
    }

    // Reuse mtime from the stat above — avoids a redundant statSync via
    // getFileModificationTime.
    const lastWriteTime = Math.floor(fileMtimeMs)
    if (lastWriteTime > readTimestamp.timestamp) {
      let contentUnchanged = false
      if (isFullEnoughFileRead(readTimestamp)) {
        try {
          const fileBuffer = await fs.readFileBytes(fullFilePath)
          const diskContent = fileBuffer
            .toString('utf8')
            .replaceAll('\r\n', '\n')
          contentUnchanged = fileStateContentMatches(readTimestamp, diskContent)
        } catch {
          contentUnchanged = false
        }
      }
      if (!contentUnchanged) {
        return {
          result: false,
          message:
            'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
          errorCode: 3,
        }
      }
    }

    return validateCoordinatorWriteAccess({
      filePath: fullFilePath,
      sourceTool: 'FileWriteTool',
    })
  },
  async call(
    { file_path, content },
    toolUseContext: ToolUseContext,
    _,
    parentMessage,
  ) {
    const {
      readFileState,
      updateFileHistoryState,
      dynamicSkillDirTriggers,
      userModified,
    } = toolUseContext
    const fullFilePath = expandPath(file_path)
    const dir = dirname(fullFilePath)

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    const cwd = getCwd()
    const newSkillDirs = await discoverSkillDirsForPaths([fullFilePath], cwd)
    if (newSkillDirs.length > 0) {
      // Store discovered dirs for attachment display
      for (const dir of newSkillDirs) {
        dynamicSkillDirTriggers?.add(dir)
      }
      // Don't await - let skill loading happen in the background
      addSkillDirectories(newSkillDirs).catch(() => {})
    }

    // Activate conditional skills whose path patterns match this file
    activateConditionalSkillsForPaths([fullFilePath], cwd)

    await diagnosticTracker.beforeFileEdited(fullFilePath)

    // Ensure parent directory exists before the atomic read-modify-write section.
    // Must stay OUTSIDE the critical section below (a yield between the staleness
    // check and writeTextContent lets concurrent edits interleave), and BEFORE the
    // write (lazy-mkdir-on-ENOENT would fire a spurious tengu_atomic_write_error
    // inside writeFileSyncAndFlush_DEPRECATED before ENOENT propagates back).
    await getFsImplementation().mkdir(dir)
    if (fileHistoryEnabled()) {
      // Backup captures pre-edit content — safe to call before the staleness
      // check (idempotent v1 backup keyed on content hash; if staleness fails
      // later we just have an unused backup, not corrupt state).
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        fullFilePath,
        parentMessage.uuid,
      )
    }

    // Load current state and confirm no changes since last read.
    // Please avoid async operations between here and writing to disk to preserve atomicity.
    let meta: ReturnType<typeof readFileSyncWithMetadata> | null
    try {
      meta = readFileSyncWithMetadata(fullFilePath)
    } catch (e) {
      if (isENOENT(e)) {
        meta = null
      } else {
        throw e
      }
    }

    if (meta !== null) {
      const lastWriteTime = getFileModificationTime(fullFilePath)
      const lastRead = readFileState.get(fullFilePath)
      // densable 2.1.228 #17 call-path: missing/partial may pass when the same
      // guardSkipped as validateInput would; true staleness still throws.
      if (!lastRead || lastRead.isPartialView) {
        if (
          !shouldAllowCallDespiteMissingOrPartialRead(
            'write',
            fullFilePath,
            toolUseContext,
            lastRead,
          )
        ) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      } else if (
        lastWriteTime > lastRead.timestamp &&
        !(
          isFullEnoughFileRead(lastRead) &&
          fileStateContentMatches(lastRead, meta.content)
        )
      ) {
        throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
      }
    }

    const enc = meta?.encoding ?? 'utf8'
    const oldContent = meta?.content ?? null

    // densable Zto: stamp auto-memory .md with originSessionId + ISO modified
    // before disk (preserves inline # via quoteLossyValues / hRg).
    const contentToWrite = stampNewMemoryContent(fullFilePath, content)
    const memdirStamped = contentToWrite !== content

    // Write is a full content replacement — the model sent explicit line endings
    // in `content` and meant them. Do not rewrite them. Previously we preserved
    // the old file's line endings (or sampled the repo via ripgrep for new
    // files), which silently corrupted e.g. bash scripts with \r on Linux when
    // overwriting a CRLF file or when binaries in cwd poisoned the repo sample.
    writeTextContent(fullFilePath, contentToWrite, enc, 'LF')

    // Notify LSP servers about file modification (didChange) and save (didSave)
    const lspManager = getLspServerManager()
    if (lspManager) {
      // Clear previously delivered diagnostics so new ones will be shown
      clearDeliveredDiagnosticsForFile(`file://${fullFilePath}`)
      // didChange: Content has been modified
      lspManager
        .changeFile(fullFilePath, contentToWrite)
        .catch((err: Error) => {
          logForDebugging(
            `LSP: Failed to notify server of file change for ${fullFilePath}: ${err.message}`,
          )
          logError(err)
        })
      // didSave: File has been saved to disk (triggers diagnostics in TypeScript server)
      lspManager.saveFile(fullFilePath).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file save for ${fullFilePath}: ${err.message}`,
        )
        logError(err)
      })
    }

    // Notify VSCode about the file change for diff view
    notifyVscodeFileUpdated(fullFilePath, oldContent, contentToWrite)

    // Update read timestamp, to invalidate stale writes
    readFileState.set(fullFilePath, {
      content: contentToWrite,
      timestamp: getFileModificationTime(fullFilePath),
      offset: undefined,
      limit: undefined,
    })

    // Log when writing to CLAUDE.md
    if (fullFilePath.endsWith(`${sep}CLAUDE.md`)) {
      logEvent('tengu_write_claudemd', {})
    }

    let gitDiff: ToolUseDiff | undefined
    // Official REMOTE densable for remote git-diff side channel.
    let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
    try {
      const { isRemoteEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
      isRemote = isRemoteEnvEnabled()
    } catch {
      // keep raw env fallback
    }
    if (
      isRemote &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_quartz_lantern', false)
    ) {
      const startTime = Date.now()
      const diff = await fetchSingleFileGitDiff(fullFilePath)
      if (diff) gitDiff = diff
      logEvent('tengu_tool_use_diff_computed', {
        isWriteTool: true,
        durationMs: Date.now() - startTime,
        hasDiff: !!diff,
      })
    }

    if (oldContent) {
      const patch = getPatchForDisplay({
        filePath: file_path,
        fileContents: oldContent,
        edits: [
          {
            old_string: oldContent,
            new_string: contentToWrite,
            replace_all: false,
          },
        ],
      })

      const data = {
        type: 'update' as const,
        filePath: file_path,
        content: contentToWrite,
        structuredPatch: patch,
        originalFile: oldContent,
        userModified: userModified ?? false,
        memdirStamped,
        ...(gitDiff && { gitDiff }),
      }
      // Track lines added and removed for file updates, right before yielding result
      countLinesChanged(patch)

      logFileOperation({
        operation: 'write',
        tool: 'FileWriteTool',
        filePath: fullFilePath,
        type: 'update',
      })

      return {
        data,
      }
    }

    const data = {
      type: 'create' as const,
      filePath: file_path,
      content: contentToWrite,
      structuredPatch: [],
      originalFile: null,
      userModified: userModified ?? false,
      memdirStamped,
      ...(gitDiff && { gitDiff }),
    }

    // For creation of new files, count all lines as additions, right before yielding the result
    countLinesChanged([], contentToWrite)

    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: fullFilePath,
      type: 'create',
    })

    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam(
    { filePath, type, userModified },
    toolUseID,
  ) {
    const modifiedNote = userModified ? USER_MODIFIED_NOTE : ''
    switch (type) {
      case 'create':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `File created successfully at: ${filePath}${modifiedNote}`,
        }
      case 'update':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `The file ${filePath} has been updated successfully.${modifiedNote}`,
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
