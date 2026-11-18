import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { SEND_USER_FILE_TOOL_NAME } from './prompt.js'
import { isBridgeEnabled } from 'src/bridge/bridgeEnabled.js'
import { expandPath, isDeviceOrNtNamespacePath } from 'src/utils/path.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe('Absolute path to the file to send to the user.'),
    description: z
      .string()
      .optional()
      .describe('Optional description of the file being sent.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type SendUserFileInput = z.infer<InputSchema>

type SendUserFileOutput = {
  sent: boolean
  file_path: string
  error?: string
  size?: number
  file_uuid?: string
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
    return 'Send a file to the user (KAIROS assistant mode)'
  },
  async prompt() {
    return `Send a file to the user's device. Use this in assistant mode when the user requests a file or when a file is relevant to the conversation.

Guidelines:
- Use absolute paths
- The file must exist and be readable
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
    return `Send file: ${input.file_path ?? '...'}`
  },

  mapToolResultToToolResultBlockParam(
    content: SendUserFileOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
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
    const { file_path } = input
    const { stat } = await import('fs/promises')

    // densable publish: Yhe(y)||Jw(y) before filesystem access
    const expanded = expandPath(file_path)
    if (
      isDeviceOrNtNamespacePath(expanded) ||
      isDeviceOrNtNamespacePath(file_path)
    ) {
      return {
        data: {
          sent: false,
          file_path,
          error:
            'file_path: device- or NT-namespace paths cannot be published — spell the path plainly',
        },
      }
    }

    // Verify file exists and is readable
    let fileSize: number
    try {
      const fileStat = await stat(file_path)
      if (!fileStat.isFile()) {
        return {
          data: { sent: false, file_path, error: 'Path is not a file.' },
        }
      }
      fileSize = fileStat.size
    } catch {
      return {
        data: {
          sent: false,
          file_path,
          error: 'File does not exist or is not readable.',
        },
      }
    }

    // Attempt bridge upload if available (so web viewers can download)
    const appState = context.getAppState()
    let fileUuid: string | undefined
    let uploadError: string | undefined
    if (appState.replBridgeEnabled) {
      try {
        const {
          formatLargeFileUploadFailure,
          SUSPECTED_UPLOAD_LIMIT_BYTES,
          uploadBriefAttachmentWithStatus,
        } = await import('@claude-code/builtin-tools/tools/BriefTool/upload.js')
        const outcome = await uploadBriefAttachmentWithStatus(
          file_path,
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
    return {
      data: {
        sent: delivered,
        file_path,
        size: fileSize,
        ...(fileUuid ? { file_uuid: fileUuid } : {}),
        ...(!delivered
          ? {
              error:
                uploadError ??
                'Bridge upload failed. File available at local path.',
            }
          : {}),
      },
    }
  },
})
