import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { SEND_USER_FILE_TOOL_NAME } from './prompt.js'
import { isBridgeEnabled } from 'src/bridge/bridgeEnabled.js'
import { expandPath, isDeviceOrNtNamespacePath } from 'src/utils/path.js'
import { pathInOutsideReadFenceWorkingPath } from 'src/utils/permissions/filesystem.js'
import { isRestrictedSession } from 'src/utils/restricted.js'
import {
  formatUnsaveableSkillRefusal,
  isSkillAttachmentPath,
  validateSkillAttachmentForUpload,
} from 'src/utils/plugins/skillUploadValidation.js'
import {
  hasUnsafeFilenameCharacters,
  unsafeFilenameRefusalMessage,
} from '../BriefTool/attachments.js'

/**
 * Official 2.1.319 #1768: accept `files` as either a single string or an array
 * of strings (and remain backward-compatible with legacy `file_path`), always
 * normalizing to a non-empty array so single-file sends render a file card
 * consistently on iOS/web/desktop.
 */
const inputSchema = lazySchema(() =>
  z.strictObject({
    files: z
      .union([z.string(), z.array(z.string()).min(1)])
      .optional()
      .describe(
        'Path or list of paths to files to send to the user (absolute or relative to cwd).',
      ),
    file_path: z
      .string()
      .optional()
      .describe(
        'Legacy single-file path alias for `files`. Prefer `files: [path]`.',
      ),
    caption: z
      .string()
      .optional()
      .describe('Optional caption shown alongside the sent file(s).'),
    description: z
      .string()
      .optional()
      .describe('Optional description of the file being sent.'),
    status: z
      .enum(['normal', 'proactive'])
      .optional()
      .describe('Whether this send is normal or proactive.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type SendUserFileInput = z.infer<InputSchema>

export type SentFileEntry = {
  file_path: string
  sent: boolean
  size?: number
  file_uuid?: string
  error?: string
}

/**
 * 2.1.323 #2077 (SEA `te` / `fHr` @286955700):
 * Distinguish turn interruption / AbortError from file-size or network errors
 * so Claude gives the right reason when a new user message interrupts a file
 * send.
 */
export const UPLOAD_ABORTED_ERROR = 'upload aborted'

export function isUploadAbortError(
  err: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) return true
  if (typeof err === 'string') {
    return (
      err === UPLOAD_ABORTED_ERROR ||
      err.toLowerCase().includes('abort') ||
      err.toLowerCase().includes('canceled') ||
      err.toLowerCase().includes('cancelled')
    )
  }
  if (err && typeof err === 'object') {
    const rec = err as { name?: unknown; code?: unknown; message?: unknown }
    if (rec.name === 'AbortError' || rec.code === 'ERR_CANCELED') return true
    if (typeof rec.message === 'string') {
      const m = rec.message.toLowerCase()
      if (
        m === UPLOAD_ABORTED_ERROR ||
        m.includes('aborted') ||
        m.includes('canceled') ||
        m.includes('cancelled')
      ) {
        return true
      }
    }
  }
  return false
}

export function formatSendUserFileUploadError(
  uploadError: string,
  opts?: {
    signal?: AbortSignal
    fallbackFormatter?: (err: string) => string
  },
): string {
  if (
    uploadError === UPLOAD_ABORTED_ERROR ||
    isUploadAbortError(uploadError, opts?.signal)
  ) {
    return `${UPLOAD_ABORTED_ERROR} — the turn was stopped before the upload finished, which says nothing about the file or the network. Send the file again if the user still wants it`
  }
  return opts?.fallbackFormatter
    ? opts.fallbackFormatter(uploadError)
    : uploadError
}

type SendUserFileOutput = {
  sent: boolean
  file_path: string
  files?: SentFileEntry[]
  error?: string
  size?: number
  file_uuid?: string
}

/**
 * Official 2.1.331 `Lvo.arguments_changed` (`05_send_file_toctou.js`):
 * Refusal returned when SendUserFile arguments/file paths changed between
 * permission display (`checkPermissions`) and execution (`call`).
 */
export const SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR =
  'No file was sent: the arguments of this call changed after Claude Code had listed its files for the user. Make the call again.'

type ListedSendUserFileSnapshot = {
  rawKey: string
  expandedKey: string
}

const MAX_LISTED_SEND_FILE_ENTRIES = 256
const listedSendUserFileArgsByToolUseId = new Map<
  string,
  ListedSendUserFileSnapshot
>()

/**
 * Official 2.1.331 `O(files)`: canonical sorted deduplicated file-list key.
 */
export function canonicalizeSendUserFilePaths(
  paths: readonly string[],
): string {
  return Array.from(new Set(paths)).sort().join('\n')
}

function buildListedSendUserFileSnapshot(
  paths: readonly string[],
): ListedSendUserFileSnapshot {
  return {
    rawKey: canonicalizeSendUserFilePaths(paths),
    expandedKey: canonicalizeSendUserFilePaths(paths.map(p => expandPath(p))),
  }
}

/**
 * Record the exact file list displayed/checked for `toolUseId` so `call()` can
 * verify no TOCTOU argument mutation occurred before reading or uploading.
 */
export function recordListedSendUserFileArgs(
  toolUseId: string,
  paths: readonly string[],
): void {
  listedSendUserFileArgsByToolUseId.set(
    toolUseId,
    buildListedSendUserFileSnapshot(paths),
  )
  if (listedSendUserFileArgsByToolUseId.size > MAX_LISTED_SEND_FILE_ENTRIES) {
    const oldest = listedSendUserFileArgsByToolUseId.keys().next().value
    if (oldest !== undefined) {
      listedSendUserFileArgsByToolUseId.delete(oldest)
    }
  }
}

/**
 * Consume and verify that the file arguments passed to `call()` match what was
 * recorded when Claude Code listed/checked files for `toolUseId`.
 */
export function verifySendUserFileArgsUnchanged(
  toolUseId: string | undefined,
  paths: readonly string[],
): { ok: true } | { ok: false; error: string } {
  if (!toolUseId) {
    return { ok: true }
  }
  const stashed = listedSendUserFileArgsByToolUseId.get(toolUseId)
  if (stashed === undefined) {
    return { ok: true }
  }
  listedSendUserFileArgsByToolUseId.delete(toolUseId)
  const current = buildListedSendUserFileSnapshot(paths)
  if (
    current.rawKey !== stashed.rawKey ||
    current.expandedKey !== stashed.expandedKey
  ) {
    return { ok: false, error: SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR }
  }
  return { ok: true }
}

export function clearSendUserFileArgsStashForTesting(): void {
  listedSendUserFileArgsByToolUseId.clear()
}

export function normalizeSendUserFilePaths(
  input: Partial<SendUserFileInput>,
): string[] {
  if (typeof input.files === 'string') {
    return input.files.trim() ? [input.files] : []
  }
  if (Array.isArray(input.files)) {
    return input.files.filter(f => typeof f === 'string' && f.trim().length > 0)
  }
  if (
    typeof input.file_path === 'string' &&
    input.file_path.trim().length > 0
  ) {
    return [input.file_path]
  }
  return []
}

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'send file to user mobile device upload share',
  // densable ySu: keep last SendUserFile per turn in focus transcript
  briefStandalone: true,
  maxResultSizeChars: 5_000,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  async description() {
    return 'Send one or more files to the user'
  },
  async prompt() {
    return `Send files to the user's device. Use this when the user requests a file or when a file is relevant to the conversation.

Guidelines:
- Pass \`files: ["path/to/file"]\` (or \`file_path\` for a single file)
- The file(s) must exist and be readable
- Filenames must not contain control or bidirectional-formatting characters
- Large files may take time to transfer`
  },

  isEnabled() {
    return isBridgeEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },

  userFacingName() {
    return 'SendFile'
  },

  renderToolUseMessage(input: Partial<SendUserFileInput>) {
    const paths = normalizeSendUserFilePaths(input)
    if (paths.length === 0) return 'Send file: ...'
    return paths.length === 1
      ? `Send file: ${paths[0]}`
      : `Send ${paths.length} files: ${paths.join(', ')}`
  },

  mapToolResultToToolResultBlockParam(
    content: SendUserFileOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const entries = content.files
    if (entries && entries.length > 1) {
      const okCount = entries.filter(e => e.sent).length
      const failed = entries.filter(e => !e.sent)
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content:
          failed.length === 0
            ? `Sent ${okCount} files: ${entries.map(e => e.file_path).join(', ')}`
            : `Sent ${okCount}/${entries.length} files. Failed: ${failed.map(e => `${e.file_path} (${e.error ?? 'error'})`).join('; ')}`,
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.sent
        ? `File sent: ${content.file_path}`
        : content.error
          ? `Failed to send file ${content.file_path}: ${content.error}`
          : `Failed to send file: ${content.file_path}`,
    }
  },

  async checkPermissions(input: SendUserFileInput, context) {
    const requestedPaths = normalizeSendUserFilePaths(input)
    if (context.toolUseId) {
      recordListedSendUserFileArgs(context.toolUseId, requestedPaths)
    }
    return {
      behavior: 'allow' as const,
      updatedInput: input,
    }
  },

  async call(
    input: SendUserFileInput,
    context,
  ): Promise<{ data: SendUserFileOutput }> {
    const requestedPaths = normalizeSendUserFilePaths(input)
    // Official 2.1.331 TOCTOU argument check (`05_send_file_toctou.js` + `SendUserFileTool`):
    // refuse sending any file if arguments/paths changed after permission check/display.
    const argCheck = verifySendUserFileArgsUnchanged(
      context.toolUseId,
      requestedPaths,
    )
    if (!argCheck.ok) {
      return {
        data: {
          sent: false,
          file_path: requestedPaths[0] ?? '',
          files: requestedPaths.map(file_path => ({
            file_path,
            sent: false,
            error: argCheck.error,
          })),
          error: argCheck.error,
        },
      }
    }
    if (requestedPaths.length === 0) {
      return {
        data: {
          sent: false,
          file_path: '',
          files: [],
          error:
            'At least one file path must be provided in `files` or `file_path`.',
        },
      }
    }

    const { readFile, stat } = await import('fs/promises')
    const appState = context.getAppState()
    const entries: SentFileEntry[] = []

    for (const file_path of requestedPaths) {
      // Official 2.1.321 #1898: refuse bidi / control characters in filename
      if (hasUnsafeFilenameCharacters(file_path)) {
        entries.push({
          file_path,
          sent: false,
          error: unsafeFilenameRefusalMessage(file_path),
        })
        continue
      }

      // densable publish: Yhe(y)||Jw(y) before filesystem access
      const expanded = expandPath(file_path)
      if (
        isDeviceOrNtNamespacePath(expanded) ||
        isDeviceOrNtNamespacePath(file_path)
      ) {
        entries.push({
          file_path,
          sent: false,
          error:
            'file_path: device- or NT-namespace paths cannot be published — spell the path plainly',
        })
        continue
      }

      // #1488: In restricted sessions, disallow sending files outside working directories.
      if (isRestrictedSession()) {
        const inside = pathInOutsideReadFenceWorkingPath(
          expanded,
          appState.toolPermissionContext,
        )
        if (!inside) {
          entries.push({
            file_path,
            sent: false,
            error:
              'Cannot send files outside the working directory in a restricted session.',
          })
          continue
        }
      }

      // Verify file exists and is readable (use validated `expanded` path — #1768)
      let fileSize: number
      try {
        const fileStat = await stat(expanded)
        if (!fileStat.isFile()) {
          entries.push({
            file_path,
            sent: false,
            error: 'Path is not a file.',
          })
          continue
        }
        fileSize = fileStat.size
      } catch {
        entries.push({
          file_path,
          sent: false,
          error: 'File does not exist or is not readable.',
        })
        continue
      }

      // Official 2.1.323 #2146: validate SKILL.md and .skill archives before
      // cloud/Cowork upload so unsaveable skill files are refused locally.
      if (isSkillAttachmentPath(expanded)) {
        try {
          const bytes = await readFile(expanded)
          const failure = validateSkillAttachmentForUpload(expanded, bytes)
          if (failure) {
            const refusal = formatUnsaveableSkillRefusal(expanded, bytes)
            entries.push({
              file_path,
              sent: false,
              size: fileSize,
              error:
                refusal?.message ??
                `not sent: claude.ai would refuse to save it as a skill, because ${failure.why}.`,
            })
            continue
          }
        } catch {
          // If reading fails here, fall through to upload error handling below.
        }
      }

      // Attempt bridge upload if available (so web/iOS viewers can download)
      let fileUuid: string | undefined
      let uploadError: string | undefined
      if (appState.replBridgeEnabled) {
        try {
          const {
            formatLargeFileUploadFailure,
            SUSPECTED_UPLOAD_LIMIT_BYTES,
            uploadBriefAttachmentWithStatus,
          } = await import(
            '@claude-code/builtin-tools/tools/BriefTool/upload.js'
          )
          const outcome = await uploadBriefAttachmentWithStatus(
            expanded,
            fileSize,
            {
              replBridgeEnabled: true,
              signal: context.abortController.signal,
            },
          )
          if ('fileUuid' in outcome) {
            fileUuid = outcome.fileUuid
          } else {
            uploadError = formatSendUserFileUploadError(outcome.error, {
              signal: context.abortController.signal,
              fallbackFormatter: err =>
                formatLargeFileUploadFailure({
                  size: fileSize,
                  uploadError: err,
                  suspectedLimitBytes:
                    outcome.suspectedLimitBytes ??
                    (fileSize > SUSPECTED_UPLOAD_LIMIT_BYTES
                      ? SUSPECTED_UPLOAD_LIMIT_BYTES
                      : undefined),
                }),
            })
          }
        } catch (e) {
          const rawMsg = isUploadAbortError(e, context.abortController.signal)
            ? UPLOAD_ABORTED_ERROR
            : e instanceof Error
              ? e.message
              : String(e)
          uploadError = formatSendUserFileUploadError(rawMsg, {
            signal: context.abortController.signal,
          })
        }
      }

      const delivered = !appState.replBridgeEnabled || Boolean(fileUuid)
      entries.push({
        file_path,
        sent: delivered,
        size: fileSize,
        ...(fileUuid ? { file_uuid: fileUuid } : {}),
        ...(!delivered
          ? {
              error:
                uploadError ??
                'Bridge upload failed. File available at local path.',
            }
          : {}),
      })
    }

    const first = entries[0]!
    const allSent = entries.every(e => e.sent)
    const firstError = entries.find(e => !e.sent)?.error
    return {
      data: {
        sent: allSent,
        file_path: first.file_path,
        files: entries,
        ...(first.size !== undefined ? { size: first.size } : {}),
        ...(first.file_uuid !== undefined
          ? { file_uuid: first.file_uuid }
          : {}),
        ...(firstError !== undefined ? { error: firstError } : {}),
      },
    }
  },
})
