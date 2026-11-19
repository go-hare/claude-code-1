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

type SendUserFileOutput = {
  sent: boolean
  file_path: string
  files?: SentFileEntry[]
  error?: string
  size?: number
  file_uuid?: string
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

  async call(input: SendUserFileInput, context) {
    const requestedPaths = normalizeSendUserFilePaths(input)
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

    const { stat } = await import('fs/promises')
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
            uploadError = formatLargeFileUploadFailure({
              size: fileSize,
              uploadError: outcome.error,
              suspectedLimitBytes:
                outcome.suspectedLimitBytes ??
                (fileSize > SUSPECTED_UPLOAD_LIMIT_BYTES
                  ? SUSPECTED_UPLOAD_LIMIT_BYTES
                  : undefined),
            })
          }
        } catch (e) {
          uploadError = e instanceof Error ? e.message : String(e)
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
