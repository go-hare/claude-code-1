import { z } from 'zod/v4'
import type { ToolDef, ToolDeps, ToolResultBlockParam } from 'src/Tool.js'
import { buildTool, sanitizeRemoteWireText } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { SEND_USER_FILE_TOOL_NAME } from './prompt.js'
import { isBridgeEnabled } from 'src/bridge/bridgeEnabled.js'
import { expandPath, isDeviceOrNtNamespacePath } from 'src/utils/path.js'
import { pathInOutsideReadFenceWorkingPath } from 'src/utils/permissions/filesystem.js'
import { isRestrictedSession } from 'src/utils/restricted.js'
import { getBootstrapSession, RootSessionSlot } from 'src/utils/sessionHost.js'
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
    display: z
      .enum(['render', 'attach'])
      .optional()
      .describe(
        "Optional display mode for the sent file(s): 'render' inline or 'attach' as a file attachment.",
      ),
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

const sentFileEntrySchema = lazySchema(() =>
  z.object({
    file_path: z.string(),
    sent: z.boolean(),
    size: z.number().optional(),
    file_uuid: z.string().optional(),
    error: z.string().optional(),
  }),
)

const sentUserFileAttachmentSchema = lazySchema(() =>
  z.object({
    path: z.string(),
    size: z.number().optional(),
    isImage: z.boolean().optional(),
    file_uuid: z.string().optional(),
    error: z.string().optional(),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    sent: z.boolean(),
    file_path: z.string(),
    files: z.array(sentFileEntrySchema()).optional(),
    attachments: z.array(sentUserFileAttachmentSchema()).optional(),
    error: z.string().optional(),
    size: z.number().optional(),
    file_uuid: z.string().optional(),
    caption: z.string().optional(),
    display: z.enum(['render', 'attach']).optional(),
    rendered_locally: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type SentUserFileAttachment = z.infer<
  ReturnType<typeof sentUserFileAttachmentSchema>
>
export type SendUserFileOutput = z.infer<OutputSchema>

const MAX_REMOTE_ATTACHMENT_STRING_CHARS = 2000

type PrivilegedRemoteFields = {
  pathValidated?: unknown
  opens_by_path?: unknown
  upload_error_code?: unknown
  upload_suspected_limit_bytes?: unknown
  scaled?: unknown
  thumbnail?: unknown
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
const listedSendUserFileArgsSlot = new RootSessionSlot<
  Map<string, ListedSendUserFileSnapshot>
>(() => new Map())

function getListedSendUserFileArgs(session?: {
  readonly root: object
}): Map<string, ListedSendUserFileSnapshot> {
  return listedSendUserFileArgsSlot.of(session ?? getBootstrapSession())
}

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
  session?: { readonly root: object },
): void {
  const listedSendUserFileArgsByToolUseId = getListedSendUserFileArgs(session)
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
  session?: { readonly root: object },
): { ok: true } | { ok: false; error: string } {
  if (!toolUseId) {
    return { ok: true }
  }
  const listedSendUserFileArgsByToolUseId = getListedSendUserFileArgs(session)
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
  getListedSendUserFileArgs().clear()
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
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  fromAnotherProcess(data: SendUserFileOutput, input: SendUserFileInput) {
    const trustedInputPaths = new Set<string>()
    if (typeof input.file_path === 'string' && input.file_path.length > 0) {
      trustedInputPaths.add(input.file_path)
    }
    if (typeof input.files === 'string' && input.files.length > 0) {
      trustedInputPaths.add(input.files)
    } else if (Array.isArray(input.files)) {
      for (const p of input.files) {
        if (typeof p === 'string' && p.length > 0) {
          trustedInputPaths.add(p)
        }
      }
    }
    const sanitizeRemotePath = (rawPath: string): string =>
      trustedInputPaths.has(rawPath)
        ? rawPath
        : sanitizeRemoteWireText(rawPath, MAX_REMOTE_ATTACHMENT_STRING_CHARS)

    const {
      rendered_locally: _untrustedRenderedLocally,
      caption: _untrustedCaption,
      display: _untrustedDisplay,
      pathValidated: _topPathValidated,
      opens_by_path: _topOpensByPath,
      upload_error_code: _topUploadErrorCode,
      upload_suspected_limit_bytes: _topUploadSuspectedLimitBytes,
      scaled: _topScaled,
      thumbnail: _topThumbnail,
      file_path,
      file_uuid,
      error,
      files,
      attachments,
      ...rest
    } = data as SendUserFileOutput & PrivilegedRemoteFields
    void _untrustedRenderedLocally
    void _untrustedCaption
    void _untrustedDisplay
    void _topPathValidated
    void _topOpensByPath
    void _topUploadErrorCode
    void _topUploadSuspectedLimitBytes
    void _topScaled
    void _topThumbnail

    const sanitizedFiles = files?.map(rawEntry => {
      const {
        pathValidated: _pathValidated,
        opens_by_path: _opensByPath,
        upload_error_code: _uploadErrorCode,
        upload_suspected_limit_bytes: _uploadSuspectedLimitBytes,
        scaled: _scaled,
        thumbnail: _thumbnail,
        file_path: entryPath,
        file_uuid: entryUuid,
        error: entryError,
        ...entryRest
      } = rawEntry as SentFileEntry & PrivilegedRemoteFields
      void _pathValidated
      void _opensByPath
      void _uploadErrorCode
      void _uploadSuspectedLimitBytes
      void _scaled
      void _thumbnail
      return {
        ...entryRest,
        file_path: sanitizeRemotePath(entryPath),
        ...(entryUuid !== undefined
          ? {
              file_uuid: sanitizeRemoteWireText(
                entryUuid,
                MAX_REMOTE_ATTACHMENT_STRING_CHARS,
              ),
            }
          : {}),
        ...(entryError !== undefined
          ? {
              error: sanitizeRemoteWireText(
                entryError,
                MAX_REMOTE_ATTACHMENT_STRING_CHARS,
              ),
            }
          : {}),
      }
    })

    const sanitizedAttachments = attachments?.map(rawAtt => {
      const {
        pathValidated: _pathValidated,
        opens_by_path: _opensByPath,
        upload_error_code: _uploadErrorCode,
        upload_suspected_limit_bytes: _uploadSuspectedLimitBytes,
        scaled: _scaled,
        thumbnail: _thumbnail,
        path: attPath,
        file_uuid: attUuid,
        error: attError,
        ...attRest
      } = rawAtt as SentUserFileAttachment & PrivilegedRemoteFields
      void _pathValidated
      void _opensByPath
      void _uploadErrorCode
      void _uploadSuspectedLimitBytes
      void _scaled
      void _thumbnail
      return {
        ...attRest,
        path: sanitizeRemotePath(attPath),
        ...(attUuid !== undefined
          ? {
              file_uuid: sanitizeRemoteWireText(
                attUuid,
                MAX_REMOTE_ATTACHMENT_STRING_CHARS,
              ),
            }
          : {}),
        ...(attError !== undefined
          ? {
              error: sanitizeRemoteWireText(
                attError,
                MAX_REMOTE_ATTACHMENT_STRING_CHARS,
              ),
            }
          : {}),
      }
    })

    const caption =
      typeof input.caption === 'string' ? input.caption : undefined
    const display =
      input.display === 'render' || input.display === 'attach'
        ? input.display
        : undefined

    return {
      data: {
        ...rest,
        file_path: sanitizeRemotePath(file_path),
        ...(file_uuid !== undefined
          ? {
              file_uuid: sanitizeRemoteWireText(
                file_uuid,
                MAX_REMOTE_ATTACHMENT_STRING_CHARS,
              ),
            }
          : {}),
        ...(error !== undefined
          ? {
              error: sanitizeRemoteWireText(
                error,
                MAX_REMOTE_ATTACHMENT_STRING_CHARS,
              ),
            }
          : {}),
        ...(sanitizedFiles !== undefined ? { files: sanitizedFiles } : {}),
        ...(sanitizedAttachments !== undefined
          ? { attachments: sanitizedAttachments }
          : {}),
        ...(caption !== undefined ? { caption } : {}),
        ...(display !== undefined ? { display } : {}),
      },
    }
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

  create(deps: ToolDeps) {
    return {
      async checkPermissions(input: SendUserFileInput, callCtx) {
        const requestedPaths = normalizeSendUserFilePaths(input)
        if (callCtx.toolUseId) {
          recordListedSendUserFileArgs(
            callCtx.toolUseId,
            requestedPaths,
            deps.session,
          )
        }
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        }
      },

      async call(
        input: SendUserFileInput,
        callCtx,
      ): Promise<{ data: SendUserFileOutput }> {
        const requestedPaths = normalizeSendUserFilePaths(input)
        // Official 2.1.331 TOCTOU argument check (`05_send_file_toctou.js` + `SendUserFileTool`):
        // refuse sending any file if arguments/paths changed after permission check/display.
        const argCheck = verifySendUserFileArgsUnchanged(
          callCtx.toolUseId,
          requestedPaths,
          deps.session,
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
        const appState = deps.getAppState()
        const permissionContext = deps.permissions()
        const signal = callCtx.signal
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
              permissionContext,
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
                  signal,
                },
              )
              if ('fileUuid' in outcome) {
                fileUuid = outcome.fileUuid
              } else {
                uploadError = formatSendUserFileUploadError(outcome.error, {
                  signal,
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
              const rawMsg = isUploadAbortError(e, signal)
                ? UPLOAD_ABORTED_ERROR
                : e instanceof Error
                  ? e.message
                  : String(e)
              uploadError = formatSendUserFileUploadError(rawMsg, {
                signal,
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
    }
  },
} satisfies ToolDef<InputSchema, SendUserFileOutput>)
