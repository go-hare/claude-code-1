import type { Base64ImageSource } from '@anthropic-ai/sdk/resources/index.mjs'
import { constants as fsConstants } from 'fs'
import {
  type FileHandle,
  lstat,
  open,
  readdir,
  readFile as readFileAsync,
} from 'fs/promises'
import * as path from 'path'
import { posix, win32 } from 'path'
import { z } from 'zod/v4'
import {
  PDF_AT_MENTION_INLINE_THRESHOLD,
  PDF_EXTRACT_SIZE_THRESHOLD,
  PDF_MAX_PAGES_PER_READ,
} from 'src/constants/apiLimits.js'
import { hasBinaryExtension } from 'src/constants/files.js'
import { memoryFreshnessNote } from 'src/memdir/memoryAge.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logEvent } from 'src/services/analytics/index.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  getFileExtensionForAnalytics,
} from 'src/services/analytics/metadata.js'
import {
  countTokensWithAPI,
  roughTokenCountEstimationForFileType,
} from 'src/services/tokenEstimation.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from 'src/skills/loadSkillsDir.js'
import type { ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import {
  checkUnchangedImageRereadLimit,
  UnchangedImageRereadLimitError,
} from 'src/utils/subagentCacheEvict.js'
import { getCwd } from 'src/utils/cwd.js'
import { remoteHostForwardRefusal } from 'src/services/tools/remoteToolHost.js'
import { getClaudeConfigHomeDir, isBareMode } from 'src/utils/envUtils.js'
import { getErrnoCode, isENOENT } from 'src/utils/errors.js'
import {
  addLineNumbers,
  FILE_NOT_FOUND_CWD_NOTE,
  findSimilarFile,
  getFileModificationTimeAsync,
  suggestPathUnderCwd,
} from 'src/utils/file.js'
import { logFileOperation } from 'src/utils/fileOperationAnalytics.js'
import { formatFileSize } from 'src/utils/format.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import {
  compressImageBufferWithTokenLimit,
  createImageMetadataText,
  detectImageFormatFromBuffer,
  type ImageDimensions,
  ImageResizeError,
  maybeResizeAndDownsampleImageBuffer,
} from 'src/utils/imageResizer.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { isAutoMemFile } from 'src/utils/memoryFileDetection.js'
import { createUserMessage } from 'src/utils/messages.js'
import {
  mapNotebookCellsToToolResult,
  readNotebook,
} from 'src/utils/notebook.js'
import {
  noteApprovedFileToolPath,
  openReadBoundToApproval,
  snapshotApprovedReadIdentity,
  takeApprovedFileToolPath,
} from 'src/utils/fileToolApprovedOpen.js'
import { getSdkBetas } from 'src/bootstrap/state.js'
import { getContextWindowForModel } from 'src/utils/context.js'
import { getModelFacts } from 'src/utils/model/modelFacts.js'
import { getPlatform } from 'src/utils/platform.js'
import { expandPath, isNtObjectNamespacePath } from 'src/utils/path.js'
import {
  extractPDFPages,
  getPDFPageCount,
  readPDF,
  readPDFFromHandle,
} from 'src/utils/pdf.js'
import {
  isPDFExtension,
  isPDFSupported,
  parsePDFPageRange,
} from 'src/utils/pdfUtils.js'
import {
  checkReadPermissionForTool,
  matchingRuleForInput,
  matchesPathRule,
} from 'src/utils/permissions/filesystem.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import {
  FileTooLargeError,
  readFileInRange,
} from 'src/utils/readFileInRange.js'
import { semanticNumber } from 'src/utils/semanticNumber.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'
import { getDefaultFileReadingLimits } from './limits.js'
import { GREP_TOOL_NAME } from '../GrepTool/prompt.js'
import {
  DESCRIPTION,
  FILE_READ_TOOL_NAME,
  FILE_UNCHANGED_STUB,
  LINE_FORMAT_INSTRUCTION,
  OFFSET_INSTRUCTION_DEFAULT,
  OFFSET_INSTRUCTION_TARGETED,
  renderPromptTemplate,
} from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseTag,
  userFacingName,
} from './UI.js'

// Device files that would hang the process: infinite output or blocking input.
// Checked by path only (no I/O). Safe devices like /dev/null are intentionally omitted.
const BLOCKED_DEVICE_PATHS = new Set([
  // Infinite output — never reach EOF
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  // Blocks waiting for input
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  // Nonsensical to read
  '/dev/stdout',
  '/dev/stderr',
  // fd aliases for stdin/stdout/stderr
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
])

function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true
  // /proc/self/fd/0-2 and /proc/<pid>/fd/0-2 are Linux aliases for stdio
  if (
    filePath.startsWith('/proc/') &&
    (filePath.endsWith('/fd/0') ||
      filePath.endsWith('/fd/1') ||
      filePath.endsWith('/fd/2'))
  )
    return true
  return false
}

// Narrow no-break space (U+202F) used by some macOS versions in screenshot filenames
const THIN_SPACE = String.fromCharCode(8239)

/**
 * Resolves macOS screenshot paths that may have different space characters.
 * macOS uses either regular space or thin space (U+202F) before AM/PM in screenshot
 * filenames depending on the macOS version. This function tries the alternate space
 * character if the file doesn't exist with the given path.
 *
 * @param filePath - The normalized file path to resolve
 * @returns The path to the actual file on disk (may differ in space character)
 */
/**
 * For macOS screenshot paths with AM/PM, the space before AM/PM may be a
 * regular space or a thin space depending on the macOS version.  Returns
 * the alternate path to try if the original doesn't exist, or undefined.
 */
function getAlternateScreenshotPath(filePath: string): string | undefined {
  const filename = path.basename(filePath)
  const amPmPattern = /^(.+)([ \u202F])(AM|PM)(\.png)$/
  const match = filename.match(amPmPattern)
  if (!match) return undefined

  const currentSpace = match[2]
  const alternateSpace = currentSpace === ' ' ? THIN_SPACE : ' '
  return filePath.replace(
    `${currentSpace}${match[3]}${match[4]}`,
    `${alternateSpace}${match[3]}${match[4]}`,
  )
}

// File read listeners - allows other services to be notified when files are read
type FileReadListener = (filePath: string, content: string) => void
const fileReadListeners: FileReadListener[] = []

export function registerFileReadListener(
  listener: FileReadListener,
): () => void {
  fileReadListeners.push(listener)
  return () => {
    const i = fileReadListeners.indexOf(listener)
    if (i >= 0) fileReadListeners.splice(i, 1)
  }
}

export class MaxFileReadTokenExceededError extends Error {
  constructor(
    public tokenCount: number,
    public maxTokens: number,
    suffix = '',
  ) {
    super(
      `File content (${tokenCount} tokens) exceeds maximum allowed tokens (${maxTokens}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.${suffix}`,
    )
    this.name = 'MaxFileReadTokenExceededError'
  }
}

const ALLOW_LARGE_ROOM_FRACTION = 0.7
const ALLOW_LARGE_BYTES_PER_TOKEN_MULTIPLIER = 3
const ALLOW_LARGE_RETRY_HINT = ` To read it anyway, up to what still fits in your context, call ${FILE_READ_TOOL_NAME} again with allow_large: true \u2014 only if you genuinely need all of it or the user asked for the whole file.`
const ALLOW_LARGE_OVERFLOW_HINT =
  ' Even with allow_large, this is more than fits in the context you have left this turn (other large reads in the same turn share that room).'
const ALLOW_LARGE_UNAVAILABLE_HINT =
  ' allow_large is not available where this read runs; read it in parts with offset and limit.'

type AllowLargeRoomResult = {
  roomTokens: number | undefined
  raised: { maxTokens: number; maxSizeBytes: number } | undefined
}

function parseOptionalInt(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && /^[-+]?\d+$/.test(val.trim())) {
    return Number(val)
  }
  return undefined
}

/**
 * Official 2.1.325 `Dbo` (`coerceInput` for FileReadTool):
 * - Unwrap 1-element array offset/limit
 * - Drop negative offset / non-positive limit
 * - Map `length` to `limit` if `limit` is absent and `length > 0`
 * - Drop stray `description`
 */
export function coerceFileReadInput(
  raw: unknown,
): { input: Input; shapeClass: string } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  const shapes: string[] = []
  if (Array.isArray(next.offset) && next.offset.length === 1) {
    next.offset = next.offset[0]
    shapes.push('offset_array')
  }
  if (Array.isArray(next.limit) && next.limit.length === 1) {
    next.limit = next.limit[0]
    shapes.push('limit_array')
  }
  const offsetNum = parseOptionalInt(next.offset)
  if (offsetNum !== undefined && offsetNum < 0) {
    delete next.offset
    shapes.push('offset_neg')
  }
  const limitNum = parseOptionalInt(next.limit)
  if (limitNum !== undefined && limitNum <= 0) {
    delete next.limit
    shapes.push('limit_dropped')
  }
  if ('length' in next) {
    const lenNum = parseOptionalInt(next.length)
    if (!('limit' in next) && lenNum !== undefined && lenNum > 0) {
      next.limit = lenNum
    }
    delete next.length
    shapes.push('length')
  }
  if (Object.hasOwn(next, 'description')) {
    delete next.description
    shapes.push('drop_description')
  }
  return shapes.length > 0
    ? { input: next as Input, shapeClass: shapes.join(',') }
    : null
}

function computeAllowLargeRoom(
  context: ToolUseContext,
  parentMessage:
    | Parameters<ToolDef<InputSchema, Output>['call']>[3]
    | undefined,
  limits: { maxSizeBytes: number; maxTokens: number },
): AllowLargeRoomResult {
  const model = context.options?.mainLoopModel
  if (!model) {
    return { roomTokens: undefined, raised: undefined }
  }
  const contextWindow = getContextWindowForModel(model, getSdkBetas())
  const usage = (
    parentMessage as
      | {
          message?: {
            usage?: {
              input_tokens?: number
              cache_creation_input_tokens?: number
              cache_read_input_tokens?: number
              output_tokens?: number
            }
          }
        }
      | undefined
  )?.message?.usage
  const usedTokens = usage
    ? (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.output_tokens ?? 0)
    : 0
  const roomTokens = Math.max(
    0,
    Math.floor((contextWindow - usedTokens) * ALLOW_LARGE_ROOM_FRACTION),
  )
  if (roomTokens <= limits.maxTokens) {
    return { roomTokens, raised: undefined }
  }
  const { bytesPerToken } = getModelFacts(model)
  return {
    roomTokens,
    raised: {
      maxTokens: roomTokens,
      maxSizeBytes: Math.max(
        limits.maxSizeBytes,
        roomTokens * bytesPerToken * ALLOW_LARGE_BYTES_PER_TOKEN_MULTIPLIER,
      ),
    },
  }
}

function formatAllowLargeHint(
  room: AllowLargeRoomResult,
  optedIn: boolean,
  measured: { bytes?: number; tokens?: number },
): string {
  if (room.roomTokens === undefined) {
    return optedIn ? ALLOW_LARGE_UNAVAILABLE_HINT : ''
  }
  if (optedIn || room.raised === undefined) {
    return ALLOW_LARGE_OVERFLOW_HINT
  }
  const fitsBytes =
    measured.bytes === undefined || measured.bytes <= room.raised.maxSizeBytes
  const fitsTokens =
    measured.tokens === undefined || measured.tokens <= room.raised.maxTokens
  return fitsBytes && fitsTokens
    ? ALLOW_LARGE_RETRY_HINT
    : ALLOW_LARGE_OVERFLOW_HINT
}

function wrapAllowLargeError(
  error: unknown,
  opts: {
    room: () => AllowLargeRoomResult
    optedIn: boolean
    readMaxSizeBytes: number
    ext: string
  },
): unknown {
  let wrapped: Error
  let extra: Record<string, number>
  let roomResult: AllowLargeRoomResult
  if (
    error instanceof FileTooLargeError &&
    error.maxSizeBytes === opts.readMaxSizeBytes
  ) {
    roomResult = opts.room()
    const hint = formatAllowLargeHint(roomResult, opts.optedIn, {
      bytes: error.sizeInBytes,
    })
    wrapped = new FileTooLargeError(error.sizeInBytes, error.maxSizeBytes)
    wrapped.message = `${error.message}${hint}`
    extra = { totalBytes: error.sizeInBytes }
  } else if (error instanceof MaxFileReadTokenExceededError) {
    roomResult = opts.room()
    const hint = formatAllowLargeHint(roomResult, opts.optedIn, {
      tokens: error.tokenCount,
    })
    wrapped = new MaxFileReadTokenExceededError(
      error.tokenCount,
      error.maxTokens,
      hint,
    )
    extra = { tokens: error.tokenCount }
  } else {
    return error
  }
  if (opts.optedIn) {
    const outcome =
      roomResult.roomTokens === undefined ? 'unavailable' : 'too_large'
    logEvent('tengu_file_read_allow_large', {
      outcome:
        outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      lifted: roomResult.raised !== undefined,
      ...(roomResult.roomTokens !== undefined && {
        roomTokens: roomResult.roomTokens,
      }),
      ...extra,
      ...(opts.ext !== undefined && {
        ext: opts.ext as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }
  return wrapped
}

/**
 * densable YAu/XAu/KAu — token-cap truncation banner keyed by Output object.
 * Survives toolExecution so a `read_truncation_notice` attachment can be
 * emitted without polluting file content (content stays pure page bytes).
 */
const tokenCapBannerByOutput = new WeakMap<object, string>()

/** densable YAu */
export function storeTokenCapBanner(data: object, banner: string): void {
  tokenCapBannerByOutput.set(data, banner)
}

/** densable XAu */
export function getTokenCapBanner(data: object): string | undefined {
  return tokenCapBannerByOutput.get(data)
}

/** densable P3e — banner prefix for token-cap auto-page */
const TOKEN_CAP_BANNER_PREFIX = '[Truncated: PARTIAL view — '

// Common image extensions
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/**
 * Detects if a file path is a session-related file for analytics logging.
 * Only matches files within the Claude config directory (e.g., ~/.claude).
 * Returns the type of session file or null if not a session file.
 */
function detectSessionFileType(
  filePath: string,
): 'session_memory' | 'session_transcript' | null {
  const configDir = getClaudeConfigHomeDir()

  // Only match files within the Claude config directory
  if (!filePath.startsWith(configDir)) {
    return null
  }

  // Normalize path to use forward slashes for consistent matching across platforms
  const normalizedPath = filePath.split(win32.sep).join(posix.sep)

  // Session memory files: ~/.claude/session-memory/*.md (including summary.md)
  if (
    normalizedPath.includes('/session-memory/') &&
    normalizedPath.endsWith('.md')
  ) {
    return 'session_memory'
  }

  // Session JSONL transcript files: ~/.claude/projects/*/*.jsonl
  if (
    normalizedPath.includes('/projects/') &&
    normalizedPath.endsWith('.jsonl')
  ) {
    return 'session_transcript'
  }

  return null
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to read'),
    offset: semanticNumber(z.number().int().nonnegative().optional()).describe(
      'The line number to start reading from. Only provide if the file is too large to read at once',
    ),
    limit: semanticNumber(z.number().int().positive().optional()).describe(
      'The number of lines to read. Only provide if the file is too large to read at once.',
    ),
    pages: z
      .preprocess(
        val => (typeof val === 'string' && val.trim() === '' ? undefined : val),
        z.string().optional(),
      )
      .describe(
        `Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum ${PDF_MAX_PAGES_PER_READ} pages per request.`,
      ),
    allow_large: z
      .boolean()
      .optional()
      .describe(
        'Set to true to read a text file, or a line range of one, that is over the usual size limits, up to what still fits in your context. Only use this when you genuinely need all of it or the user asked for the whole file; otherwise read it in parts with offset and limit, or search it.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() => {
  // Define the media types supported for images
  const imageMediaTypes = z.enum([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ])

  return z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      file: z.object({
        filePath: z.string().describe('The path to the file that was read'),
        content: z.string().describe('The content of the file'),
        numLines: z
          .number()
          .describe('Number of lines in the returned content'),
        startLine: z.number().describe('The starting line number'),
        totalLines: z.number().describe('Total number of lines in the file'),
        // densable 2.1.212: whole-file read auto-paginated under token cap.
        // Programmatic signal for internal consumers (Eio attachments);
        // survives output reconstruction (unlike the render-time banner).
        truncatedByTokenCap: z
          .boolean()
          .optional()
          .describe(
            'True when a whole-file read was auto-paginated because it exceeded the token cap (the content is a partial first page).',
          ),
      }),
    }),
    z.object({
      type: z.literal('image'),
      file: z.object({
        base64: z.string().describe('Base64-encoded image data'),
        type: imageMediaTypes.describe('The MIME type of the image'),
        originalSize: z.number().describe('Original file size in bytes'),
        dimensions: z
          .object({
            originalWidth: z
              .number()
              .optional()
              .describe('Original image width in pixels'),
            originalHeight: z
              .number()
              .optional()
              .describe('Original image height in pixels'),
            displayWidth: z
              .number()
              .optional()
              .describe('Displayed image width in pixels (after resizing)'),
            displayHeight: z
              .number()
              .optional()
              .describe('Displayed image height in pixels (after resizing)'),
          })
          .optional()
          .describe('Image dimension info for coordinate mapping'),
      }),
    }),
    z.object({
      type: z.literal('notebook'),
      file: z.object({
        filePath: z.string().describe('The path to the notebook file'),
        cells: z.array(z.any()).describe('Array of notebook cells'),
      }),
    }),
    z.object({
      type: z.literal('pdf'),
      file: z.object({
        filePath: z.string().describe('The path to the PDF file'),
        base64: z.string().describe('Base64-encoded PDF data'),
        originalSize: z.number().describe('Original file size in bytes'),
      }),
    }),
    z.object({
      type: z.literal('parts'),
      file: z.object({
        filePath: z.string().describe('The path to the PDF file'),
        originalSize: z.number().describe('Original file size in bytes'),
        count: z.number().describe('Number of pages extracted'),
        outputDir: z
          .string()
          .describe('Directory containing extracted page images'),
      }),
    }),
    z.object({
      type: z.literal('file_unchanged'),
      file: z.object({
        filePath: z.string().describe('The path to the file'),
      }),
    }),
  ])
})
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export {
  checkUnchangedImageRereadLimit,
  noteImageMediaStripped,
  resetImageRereadState,
  UNCHANGED_IMAGE_REREAD_LIMIT,
  UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE,
  UNCHANGED_IMAGE_REREAD_REFUSAL_REASON,
  UnchangedImageRereadLimitError,
} from 'src/utils/subagentCacheEvict.js'

export const FileReadTool = buildTool({
  name: FILE_READ_TOOL_NAME,
  searchHint: 'read files, images, PDFs, notebooks',
  // densable IS remoteExecution + backgrounding never
  remoteExecution: {
    supported: true,
    decidingInputFields: ['file_path', 'offset', 'limit', 'pages'],
  },
  backgrounding: 'never',
  // Output is bounded by maxTokens (validateContentTokens). Results exceeding
  // 100KB are persisted to disk (reducing memory pressure in long sessions)
  // rather than kept in the message array indefinitely.
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    const limits = getDefaultFileReadingLimits()
    const maxSizeInstruction = limits.includeMaxSizeInPrompt
      ? `. Files larger than ${formatFileSize(limits.maxSizeBytes)} will return an error; use offset and limit for larger files`
      : ''
    const offsetInstruction = limits.targetedRangeNudge
      ? OFFSET_INSTRUCTION_TARGETED
      : OFFSET_INSTRUCTION_DEFAULT
    return renderPromptTemplate(
      pickLineFormatInstruction(),
      maxSizeInstruction,
      offsetInstruction,
    )
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  coerceInput: coerceFileReadInput,
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Reading ${summary}` : 'Reading file'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.file_path
  },
  isSearchOrReadCommand() {
    return { isSearch: false, isRead: true }
  },
  getPath({ file_path }): string {
    return file_path || getCwd()
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
    // densable UWt — snapshot ancestors before the permission check.
    noteApprovedFileToolPath(input.file_path)
    const appState = context.getAppState()
    return checkReadPermissionForTool(
      FileReadTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseMessage,
  renderToolUseTag,
  renderToolResultMessage,
  // UI.tsx:140 — ALL types render summary chrome only: "Read N lines",
  // "Read image (42KB)". Never the content itself. The model-facing
  // serialization (below) sends content + line prefixes; UI shows none of it.
  extractSearchText() {
    return ''
  },
  renderToolUseErrorMessage,
  async validateInput(
    { file_path, pages, ...rest },
    toolUseContext: ToolUseContext,
  ) {
    // densable BT() && xd(n) — named host is not forwarded (errorCode 14)
    const hostRefusal = remoteHostForwardRefusal(
      { file_path, pages, ...rest },
      FILE_READ_TOOL_NAME,
    )
    if (hostRefusal) return { ...hostRefusal, errorCode: 14 }
    // Validate pages parameter (pure string parsing, no I/O)
    if (pages !== undefined) {
      const parsed = parsePDFPageRange(pages)
      if (!parsed) {
        return {
          result: false,
          message: `Invalid pages parameter: "${pages}". Give one page ("3") or one range ("1-5"), not a list. To read several pages or ranges, read each one separately. Pages are 1-indexed.`,
          errorCode: 7,
        }
      }
      const rangeSize =
        parsed.lastPage === Infinity
          ? PDF_MAX_PAGES_PER_READ + 1
          : parsed.lastPage - parsed.firstPage + 1
      if (rangeSize > PDF_MAX_PAGES_PER_READ) {
        return {
          result: false,
          message: `Page range "${pages}" exceeds maximum of ${PDF_MAX_PAGES_PER_READ} pages per request. Please use a smaller range.`,
          errorCode: 8,
        }
      }
    }

    // Path expansion + deny rule check (no I/O)
    const fullFilePath = expandPath(file_path)

    // densable gno/read_file: Jw(e)||Jw(_s(e)) — NT-namespace rejected before FS
    if (
      isNtObjectNamespacePath(file_path.trim()) ||
      isNtObjectNamespacePath(fullFilePath)
    ) {
      return {
        result: false,
        message: `read denied: ${file_path}`,
        errorCode: 11,
      }
    }

    const appState = toolUseContext.getAppState()
    const denyRule = matchingRuleForInput(
      fullFilePath,
      appState.toolPermissionContext,
      'read',
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

    // SECURITY: UNC path check (no I/O) — defer filesystem operations
    // until after user grants permission to prevent NTLM credential leaks
    const isUncPath =
      fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')
    if (isUncPath) {
      return { result: true }
    }

    // 预检：如果路径已是一个存在的目录，及时拒绝并给出指引
    // 避免 AI 模型用 Read 工具读取目录路径时抛出原始 EISDIR 错误，
    // 模型拿到错误后不知该用 ls 列目录，可能做出错误恢复决策。
    try {
      const fileStat = await getFsImplementation().stat(fullFilePath)
      if (fileStat.isDirectory()) {
        return {
          result: false,
          message: `Cannot read '${file_path}': the specified path is an existing directory. Use Bash ls to list files in this directory, or specify a filename path to read a specific file.`,
          errorCode: 10,
        }
      }
    } catch (e) {
      if (!isENOENT(e)) throw e
      // ENOENT = 文件还不存在，放行，call() 会通过 findSimilarFile 给出友好建议
    }

    // Binary extension check (string check on extension only, no I/O).
    // PDF, images, and SVG are excluded - this tool renders them natively.
    const ext = path.extname(fullFilePath).toLowerCase()
    if (
      hasBinaryExtension(fullFilePath) &&
      !isPDFExtension(ext) &&
      !IMAGE_EXTENSIONS.has(ext.slice(1))
    ) {
      return {
        result: false,
        message: `This tool cannot read binary files. The file appears to be a binary ${ext} file. Use a skill for this file type if one is available, or a shell command or script that can read the format.`,
        errorCode: 4,
      }
    }

    // Block specific device files that would hang (infinite output or blocking input).
    // This is a path-based check with no I/O — safe special files like /dev/null are allowed.
    if (isBlockedDevicePath(fullFilePath)) {
      return {
        result: false,
        message: `Cannot read '${file_path}': this device file would block or produce infinite output.`,
        errorCode: 9,
      }
    }

    return { result: true }
  },
  async call(
    { file_path, offset = 1, limit = undefined, pages, allow_large },
    context,
    _canUseTool?,
    parentMessage?,
  ) {
    const { readFileState, fileReadingLimits } = context

    const defaults = getDefaultFileReadingLimits()
    const maxSizeBytes =
      fileReadingLimits?.maxSizeBytes ?? defaults.maxSizeBytes
    const maxTokens = fileReadingLimits?.maxTokens ?? defaults.maxTokens
    const room = () =>
      computeAllowLargeRoom(context, parentMessage, {
        maxSizeBytes,
        maxTokens,
      })
    const allowLargeRoom = allow_large ? room() : undefined

    // Telemetry: track when callers override default read limits.
    // Only fires on override (low volume) — event count = override frequency.
    if (fileReadingLimits !== undefined) {
      logEvent('tengu_file_read_limits_override', {
        hasMaxTokens: fileReadingLimits.maxTokens !== undefined,
        hasMaxSizeBytes: fileReadingLimits.maxSizeBytes !== undefined,
      })
    }

    const ext = path.extname(file_path).toLowerCase().slice(1)
    // Use expandPath for consistent path normalization with FileEditTool/FileWriteTool
    // (especially handles whitespace trimming and Windows path separators)
    const fullFilePath = expandPath(file_path)
    const approvedReadPaths = takeApprovedFileToolPath(fullFilePath)

    // Dedup: if we've already read this exact range and the file hasn't
    // changed on disk, return a stub instead of re-sending the full content.
    // The earlier Read tool_result is still in context — two full copies
    // waste cache_creation tokens on every subsequent turn. BQ proxy shows
    // ~18% of Read calls are same-file collisions (up to 2.64% of fleet
    // cache_creation). Only applies to text/notebook reads — images/PDFs
    // aren't cached in readFileState so won't match here.
    //
    // Ant soak: 1,734 dedup hits in 2h, no Read error regression.
    // Killswitch pattern: GB can disable if the stub message confuses
    // the model externally.
    // 3P default: killswitch off = dedup enabled. Client-side only — no
    // server support needed, safe for Bedrock/Vertex/Foundry.
    const dedupKillswitch = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_read_dedup_killswitch',
      false,
    )
    const existingState = dedupKillswitch
      ? undefined
      : readFileState.get(fullFilePath)
    // Only dedup entries that came from a prior Read (offset is always set
    // by Read). Edit/Write store offset=undefined — their readFileState
    // entry reflects post-edit mtime, so deduping against it would wrongly
    // point the model at the pre-edit Read content.
    if (
      existingState &&
      !existingState.isPartialView &&
      existingState.offset !== undefined
    ) {
      const rangeMatch =
        existingState.offset === offset && existingState.limit === limit
      if (rangeMatch) {
        try {
          const mtimeMs = await getFileModificationTimeAsync(fullFilePath)
          if (mtimeMs === existingState.timestamp) {
            const analyticsExt = getFileExtensionForAnalytics(fullFilePath)
            logEvent('tengu_file_read_dedup', {
              ...(analyticsExt !== undefined && { ext: analyticsExt }),
            })
            return {
              data: {
                type: 'file_unchanged' as const,
                file: { filePath: file_path },
              },
            }
          }
        } catch {
          // stat failed — fall through to full read
        }
      }
    }

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    // Skip in simple mode - no skills available
    const cwd = getCwd()
    if (!isBareMode()) {
      const newSkillDirs = await discoverSkillDirsForPaths([fullFilePath], cwd)
      if (newSkillDirs.length > 0) {
        // Store discovered dirs for attachment display
        for (const dir of newSkillDirs) {
          context.dynamicSkillDirTriggers?.add(dir)
        }
        // Don't await - let skill loading happen in the background
        addSkillDirectories(newSkillDirs).catch(() => {})
      }

      // Activate conditional skills whose path patterns match this file
      activateConditionalSkillsForPaths([fullFilePath], cwd)
    }

    try {
      let opened: Awaited<ReturnType<typeof openReadBoundToApproval>> | null =
        null
      try {
        const pinnedInode =
          getPlatform() === 'macos'
            ? await snapshotApprovedReadIdentity(approvedReadPaths)
            : undefined
        opened = await openReadBoundToApproval(
          fullFilePath,
          approvedReadPaths,
          context.abortController.signal,
          pinnedInode,
        )
      } catch (error) {
        // ENOENT stays on the similar-file path; a swapped symlink does not.
        if (!isENOENT(error)) throw error
      }
      try {
        const readResult = await callInner(
          file_path,
          fullFilePath,
          opened?.ioPath ?? fullFilePath,
          ext,
          offset,
          limit,
          pages,
          maxSizeBytes,
          maxTokens,
          readFileState,
          context,
          parentMessage?.message.id,
          opened?.handle,
          room,
          allowLargeRoom,
        )
        // Official 2.1.321 #1929 (`O_o`): refuse unchanged image re-reads past limit
        if (
          readResult.data.type === 'image' &&
          parentMessage !== undefined &&
          !(parentMessage as { isVirtual?: boolean }).isVirtual
        ) {
          const limitMessage = checkUnchangedImageRereadLimit(
            context.agentId,
            fullFilePath,
            readResult.data.file.base64,
          )
          if (limitMessage !== undefined) {
            throw new UnchangedImageRereadLimitError(limitMessage)
          }
        }
        return readResult
      } finally {
        await opened?.close()
      }
    } catch (error) {
      // Handle file-not-found: suggest similar files
      const code = getErrnoCode(error)
      if (code === 'ENOENT') {
        // macOS screenshots may use a thin space or regular space before
        // AM/PM — try the alternate before giving up.
        const altPath = getAlternateScreenshotPath(fullFilePath)
        if (altPath) {
          try {
            return await callInner(
              file_path,
              fullFilePath,
              altPath,
              ext,
              offset,
              limit,
              pages,
              maxSizeBytes,
              maxTokens,
              readFileState,
              context,
              parentMessage?.message.id,
              undefined,
              room,
              allowLargeRoom,
            )
          } catch (altError) {
            if (!isENOENT(altError)) {
              throw altError
            }
            // Alt path also missing — fall through to friendly error
          }
        }

        const similarFilename = await findSimilarFile(fullFilePath)
        const cwdSuggestion = await suggestPathUnderCwd(fullFilePath)
        let message = `File does not exist. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
        if (cwdSuggestion) {
          message += ` Did you mean ${cwdSuggestion}?`
        } else if (similarFilename) {
          message += ` Did you mean ${similarFilename}?`
        }
        throw new Error(message)
      }
      throw error
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    switch (data.type) {
      case 'image': {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                data: data.file.base64,
                media_type: data.file.type,
              },
            },
          ],
        }
      }
      case 'notebook':
        return mapNotebookCellsToToolResult(data.file.cells, toolUseID)
      case 'pdf':
        // Return PDF metadata only - the actual content is sent as a supplemental DocumentBlockParam
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `PDF file read: ${data.file.filePath} (${formatFileSize(data.file.originalSize)})`,
        }
      case 'parts':
        // Extracted page images are read and sent as image blocks in mapToolResultToAPIMessage
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `PDF pages extracted: ${data.file.count} page(s) from ${data.file.filePath} (${formatFileSize(data.file.originalSize)})`,
        }
      case 'file_unchanged':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: FILE_UNCHANGED_STUB,
        }
      case 'text': {
        let content: string

        if (data.file.content) {
          content = memoryFileFreshnessPrefix(data) + formatFileLines(data.file)
        } else {
          // Determine the appropriate warning message
          content =
            data.file.totalLines === 0
              ? '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>'
              : `<system-reminder>Warning: the file exists but is shorter than the provided offset (${data.file.startLine}). The file has ${data.file.totalLines} lines.</system-reminder>`
        }

        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content,
        }
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function pickLineFormatInstruction(): string {
  return LINE_FORMAT_INSTRUCTION
}

/** Format file content with line numbers. */
function formatFileLines(file: { content: string; startLine: number }): string {
  return addLineNumbers(file)
}

/**
 * Side-channel from call() to mapToolResultToToolResultBlockParam: mtime
 * of auto-memory files, keyed by the `data` object identity. Avoids
 * adding a presentation-only field to the output schema (which flows
 * into SDK types) and avoids sync fs in the mapper. WeakMap auto-GCs
 * when the data object becomes unreachable after rendering.
 */
const memoryFileMtimes = new WeakMap<object, number>()

function memoryFileFreshnessPrefix(data: object): string {
  const mtimeMs = memoryFileMtimes.get(data)
  if (mtimeMs === undefined) return ''
  return memoryFreshnessNote(mtimeMs)
}

async function validateContentTokens(
  content: string,
  ext: string,
  maxTokens?: number,
): Promise<void> {
  const effectiveMaxTokens =
    maxTokens ?? getDefaultFileReadingLimits().maxTokens

  // Fast rejection: if raw byte count exceeds 4x the token limit,
  // no encoding can possibly fit (worst case is ~4 bytes/token).
  const byteLength = Buffer.byteLength(content)
  if (byteLength > effectiveMaxTokens * 4) {
    throw new MaxFileReadTokenExceededError(
      Math.ceil(byteLength / 4),
      effectiveMaxTokens,
    )
  }

  const tokenEstimate = roughTokenCountEstimationForFileType(content, ext)
  if (!tokenEstimate || tokenEstimate <= effectiveMaxTokens / 4) return

  const tokenCount = await countTokensWithAPI(content)
  const effectiveCount = tokenCount ?? tokenEstimate

  if (effectiveCount > effectiveMaxTokens) {
    throw new MaxFileReadTokenExceededError(effectiveCount, effectiveMaxTokens)
  }
}

type ImageResult = {
  type: 'image'
  file: {
    base64: string
    type: Base64ImageSource['media_type']
    originalSize: number
    dimensions?: ImageDimensions
  }
}

function createImageResponse(
  buffer: Buffer,
  mediaType: string,
  originalSize: number,
  dimensions?: ImageDimensions,
): ImageResult {
  return {
    type: 'image',
    file: {
      base64: buffer.toString('base64'),
      type: `image/${mediaType}` as Base64ImageSource['media_type'],
      originalSize,
      dimensions,
    },
  }
}

/**
 * Inner implementation of call, separated to allow ENOENT handling in the outer call.
 */
async function callInner(
  file_path: string,
  fullFilePath: string,
  resolvedFilePath: string,
  ext: string,
  offset: number,
  limit: number | undefined,
  pages: string | undefined,
  maxSizeBytes: number,
  maxTokens: number,
  readFileState: ToolUseContext['readFileState'],
  context: ToolUseContext,
  messageId: string | undefined,
  openedHandle?: FileHandle,
  room: () => AllowLargeRoomResult = () => ({
    roomTokens: undefined,
    raised: undefined,
  }),
  allowLargeRoom?: AllowLargeRoomResult,
): Promise<{
  data: Output
  newMessages?: ReturnType<typeof createUserMessage>[]
}> {
  // --- Notebook ---
  if (ext === 'ipynb') {
    const cells = await readNotebook(openedHandle ?? resolvedFilePath)
    const cellsJson = jsonStringify(cells)

    const cellsJsonBytes = Buffer.byteLength(cellsJson)
    if (cellsJsonBytes > maxSizeBytes) {
      throw new Error(
        `Notebook content (${formatFileSize(cellsJsonBytes)}) exceeds maximum allowed size (${formatFileSize(maxSizeBytes)}). ` +
          `Use ${BASH_TOOL_NAME} with jq to read specific portions:\n` +
          `  cat "${file_path}" | jq '.cells[:20]' # First 20 cells\n` +
          `  cat "${file_path}" | jq '.cells[100:120]' # Cells 100-120\n` +
          `  cat "${file_path}" | jq '.cells | length' # Count total cells\n` +
          `  cat "${file_path}" | jq '.cells[] | select(.cell_type=="code") | .source' # All code sources`,
      )
    }

    await validateContentTokens(cellsJson, ext, maxTokens)

    // Get mtime via bound handle when available (no symlink swap TOCTOU)
    const stats = openedHandle
      ? await openedHandle.stat()
      : await getFsImplementation().stat(resolvedFilePath)
    readFileState.set(fullFilePath, {
      content: cellsJson,
      timestamp: Math.floor(stats.mtimeMs),
      offset,
      limit,
    })
    context.nestedMemoryAttachmentTriggers?.add(fullFilePath)

    const data = {
      type: 'notebook' as const,
      file: { filePath: file_path, cells },
    }

    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: fullFilePath,
      content: cellsJson,
    })

    return { data }
  }

  // --- Image (single read, no double-read) ---
  if (IMAGE_EXTENSIONS.has(ext)) {
    // Images have their own size limits (token budget + compression + 128MB hard cap) —
    // don't apply the text maxSizeBytes cap.
    const data = await readImageWithTokenBudget(
      resolvedFilePath,
      maxTokens,
      undefined,
      context.abortController.signal,
    )
    context.nestedMemoryAttachmentTriggers?.add(fullFilePath)

    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: fullFilePath,
      content: data.file.base64,
    })

    const metadataText = data.file.dimensions
      ? createImageMetadataText(data.file.dimensions)
      : null

    return {
      data,
      ...(metadataText && {
        newMessages: [
          createUserMessage({
            content: metadataText,
            isMeta: true,
            turnCompanion: true,
          }),
        ],
      }),
    }
  }

  // --- PDF ---
  if (isPDFExtension(ext)) {
    if (pages) {
      const parsedRange = parsePDFPageRange(pages)
      const extractResult = await extractPDFPages(resolvedFilePath, {
        ...(parsedRange ?? {}),
        held: openedHandle,
        signal: context.abortController.signal,
      })
      if (!extractResult.success) {
        throw new Error((extractResult as any).error.message)
      }
      logEvent('tengu_pdf_page_extraction', {
        success: true,
        pageCount: (extractResult as any).data.file.count,
        fileSize: extractResult.data.file.originalSize,
        hasPageRange: true,
      })
      logFileOperation({
        operation: 'read',
        tool: 'FileReadTool',
        filePath: fullFilePath,
        content: `PDF pages ${pages}`,
      })
      const entries = await readdir(extractResult.data.file.outputDir)
      const imageFiles = entries.filter(f => f.endsWith('.jpg')).sort()
      const imageBlocks = await Promise.all(
        imageFiles.map(async f => {
          const imgPath = path.join(extractResult.data.file.outputDir, f)
          const imgBuffer = await readFileAsync(imgPath)
          const resized = await maybeResizeAndDownsampleImageBuffer(
            imgBuffer,
            imgBuffer.length,
            'jpeg',
          )
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type:
                `image/${resized.mediaType}` as Base64ImageSource['media_type'],
              data: resized.buffer.toString('base64'),
            },
          }
        }),
      )
      return {
        data: extractResult.data,
        ...(imageBlocks.length > 0 && {
          newMessages: [
            createUserMessage({
              content: imageBlocks,
              isMeta: true,
              turnCompanion: true,
            }),
          ],
        }),
      }
    }

    const stats = openedHandle
      ? await openedHandle.stat()
      : await getFsImplementation().stat(resolvedFilePath)

    const pageCount = await getPDFPageCount(
      resolvedFilePath,
      openedHandle
        ? {
            handle: openedHandle,
            size: stats.size,
            signal: context.abortController.signal,
          }
        : undefined,
    )
    if (pageCount !== null && pageCount > PDF_AT_MENTION_INLINE_THRESHOLD) {
      throw new Error(
        `This PDF has ${pageCount} pages, which is too many to read at once. ` +
          `Use the pages parameter to read specific page ranges (e.g., pages: "1-5"). ` +
          `Maximum ${PDF_MAX_PAGES_PER_READ} pages per request.`,
      )
    }

    const shouldExtractPages =
      !isPDFSupported() || stats.size > PDF_EXTRACT_SIZE_THRESHOLD

    if (shouldExtractPages) {
      const extractResult = await extractPDFPages(resolvedFilePath, {
        held: openedHandle,
        signal: context.abortController.signal,
      })
      if (extractResult.success) {
        logEvent('tengu_pdf_page_extraction', {
          success: true,
          pageCount: extractResult.data.file.count,
          fileSize: extractResult.data.file.originalSize,
        })
      } else {
        logEvent('tengu_pdf_page_extraction', {
          success: false,
          available: (extractResult as any).error.reason !== 'unavailable',
          fileSize: stats.size,
        })
      }
    }

    if (!isPDFSupported()) {
      throw new Error(
        'Reading full PDFs is not supported with this model. Use a newer model (Sonnet 3.5 v2 or later), ' +
          `or use the pages parameter to read specific page ranges (e.g., pages: "1-5", maximum ${PDF_MAX_PAGES_PER_READ} pages per request). ` +
          'Page extraction requires poppler-utils: install with `brew install poppler` on macOS or `apt-get install poppler-utils` on Debian/Ubuntu.',
      )
    }

    const readResult = openedHandle
      ? await readPDFFromHandle(
          openedHandle,
          resolvedFilePath,
          context.abortController.signal,
        )
      : await readPDF(
          resolvedFilePath,
          undefined,
          context.abortController.signal,
        )
    if (!readResult.success) {
      throw new Error((readResult as any).error.message)
    }
    const pdfData = readResult.data
    logFileOperation({
      operation: 'read',
      tool: 'FileReadTool',
      filePath: fullFilePath,
      content: pdfData.file.base64,
    })

    return {
      data: pdfData,
      newMessages: [
        createUserMessage({
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfData.file.base64,
              },
            },
          ],
          isMeta: true,
          turnCompanion: true,
        }),
      ],
    }
  }

  // --- Text file (single async read via readFileInRange) ---
  const effectiveMaxSizeBytes =
    allowLargeRoom?.raised?.maxSizeBytes ?? maxSizeBytes
  const effectiveMaxTokens =
    allowLargeRoom?.raised?.maxTokens ??
    maxTokens ??
    getDefaultFileReadingLimits().maxTokens
  const allowLargeOpts = {
    room,
    optedIn: allowLargeRoom !== undefined,
    readMaxSizeBytes: effectiveMaxSizeBytes,
    ext: getFileExtensionForAnalytics(fullFilePath) ?? ext,
  }
  const lineOffset = offset === 0 ? 0 : offset - 1
  const { content, lineCount, totalLines, totalBytes, readBytes, mtimeMs } =
    await readFileInRange(
      resolvedFilePath,
      lineOffset,
      limit,
      limit === undefined ? effectiveMaxSizeBytes : undefined,
      context.abortController.signal,
    ).catch(err => {
      throw wrapAllowLargeError(err, allowLargeOpts)
    })

  // densable token-cap auto-page: whole-file reads that exceed the cap return
  // the first page with truncatedByTokenCap + isPartialView instead of throw.
  // P = (offset??1)<=1 && limit===undefined && pages===undefined
  let outContent = content
  let outLineCount = lineCount
  let outLimit = limit
  // densable k: banner string when auto-paged; undefined when full read OK
  let tokenCapBanner: string | undefined
  const isWholeFileRead =
    (offset ?? 1) <= 1 && limit === undefined && pages === undefined

  try {
    await validateContentTokens(content, ext, effectiveMaxTokens)
  } catch (err) {
    if (!(err instanceof MaxFileReadTokenExceededError) || !isWholeFileRead) {
      throw wrapAllowLargeError(err, allowLargeOpts)
    }
    // densable: estimate bytes/token from full content vs measured tokenCount,
    // shrink line window until under cap (max 6 shrinks), else char-slice path.
    const lines = content.split('\n')
    const bytesPerToken = Math.max(
      0.5,
      content.length / Math.max(1, err.tokenCount),
    )
    const estimateTokens = (s: string) => s.length / bytesPerToken
    let take = Math.max(
      1,
      Math.min(
        lines.length,
        Math.floor(
          ((lines.length * effectiveMaxTokens) / Math.max(1, err.tokenCount)) *
            0.85,
        ),
      ),
    )
    let page = lines.slice(0, take).join('\n')
    for (let q = 0; q < 6; q++) {
      if (estimateTokens(page) <= effectiveMaxTokens || take <= 1) break
      take = Math.max(1, Math.floor(take * 0.7))
      page = lines.slice(0, take).join('\n')
    }
    let charTruncated = false
    if (estimateTokens(page) > effectiveMaxTokens || page.trim() === '') {
      let chars = Math.max(
        1,
        Math.floor(effectiveMaxTokens * bytesPerToken * 0.85),
      )
      for (let ne = 0; ne < 6; ne++) {
        page = content.slice(0, chars)
        if (estimateTokens(page) <= effectiveMaxTokens) break
        chars = Math.max(1, Math.floor(chars * 0.7))
      }
      // densable: drop trailing high-surrogate
      const last = page.charCodeAt(page.length - 1)
      if (last >= 0xd800 && last <= 0xdbff) {
        page = page.slice(0, -1)
      }
      charTruncated = true
    }
    outContent = page
    outLineCount = charTruncated ? countCharInStringLocal(page, '\n') + 1 : take
    outLimit = outLineCount
    // densable k = !J && I < v ? lineBanner : charBanner  (always set on auto-page)
    if (!charTruncated && outLineCount < totalLines) {
      tokenCapBanner = `${TOKEN_CAP_BANNER_PREFIX}${file_path}: showing lines 1-${outLineCount} of ${totalLines} total (${err.tokenCount} tokens, cap ${effectiveMaxTokens}). Call ${FILE_READ_TOOL_NAME} with offset=${outLineCount + 1} limit=${outLineCount} for the next page, or ${GREP_TOOL_NAME} to find a specific section. Do NOT answer from this page alone if the answer may be further in the file.]`
    } else {
      tokenCapBanner = `${TOKEN_CAP_BANNER_PREFIX}${file_path}: showing the first ${page.length} of ${content.length} characters (${err.tokenCount} tokens, cap ${effectiveMaxTokens}); this file has very long lines and cannot be paginated by line. Use ${GREP_TOOL_NAME} to find a specific section, or ${FILE_READ_TOOL_NAME} with offset/limit to page through it. Do NOT answer from this excerpt alone if the answer may be elsewhere in the file.]`
    }
  }

  readFileState.set(fullFilePath, {
    content: outContent,
    timestamp: Math.floor(mtimeMs),
    offset,
    limit: outLimit,
    ...(tokenCapBanner !== undefined && { isPartialView: true as const }),
  })
  context.nestedMemoryAttachmentTriggers?.add(fullFilePath)

  // Snapshot before iterating — a listener that unsubscribes mid-callback
  // would splice the live array and skip the next listener.
  for (const listener of fileReadListeners.slice()) {
    listener(resolvedFilePath, outContent)
  }

  const data = {
    type: 'text' as const,
    file: {
      filePath: file_path,
      content: outContent,
      numLines: outLineCount,
      // densable: startLine = k!==void0 ? Math.max(1,i) : i
      startLine: tokenCapBanner !== undefined ? Math.max(1, offset) : offset,
      totalLines,
      ...(tokenCapBanner !== undefined && {
        truncatedByTokenCap: true as const,
      }),
    },
  }
  // densable YAu(N, k)
  if (tokenCapBanner !== undefined) {
    storeTokenCapBanner(data, tokenCapBanner)
  }
  if (isAutoMemFile(fullFilePath)) {
    memoryFileMtimes.set(data, mtimeMs)
  }

  logFileOperation({
    operation: 'read',
    tool: 'FileReadTool',
    filePath: fullFilePath,
    content: outContent,
  })

  const sessionFileType = detectSessionFileType(fullFilePath)
  const analyticsExt = getFileExtensionForAnalytics(fullFilePath)
  logEvent('tengu_session_file_read', {
    totalLines,
    readLines: outLineCount,
    totalBytes,
    readBytes:
      tokenCapBanner !== undefined
        ? Buffer.byteLength(outContent, 'utf8')
        : readBytes,
    offset,
    ...(outLimit !== undefined && { limit: outLimit }),
    ...(analyticsExt !== undefined && { ext: analyticsExt }),
    ...(messageId !== undefined && {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    is_session_memory: sessionFileType === 'session_memory',
    is_session_transcript: sessionFileType === 'session_transcript',
  })

  return { data }
}

/** densable Tu — count char occurrences without importing stringUtils cycle. */
function countCharInStringLocal(s: string, ch: string): number {
  let n = 0
  const code = ch.charCodeAt(0)
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === code) n++
  }
  return n
}

/**
 * Reads an image file and applies token-based compression if needed.
 * Reads the file ONCE, then applies standard resize. If the result exceeds
 * the token limit, applies aggressive compression from the same buffer.
 *
 * @param filePath - Path to the image file
 * @param maxTokens - Maximum token budget for the image
 * @returns Image data with appropriate compression applied
 */
const IMAGE_MAX_BYTES = 134_217_728 // 128 MB (SEA O$s / Mq)
const IMAGE_STREAM_CHUNK_BYTES = 65536

/**
 * SEA `readFileBytes` / `readImageStream` (`xcs` / `Q3n`): open with
 * `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (and `lstat` on Windows) so a symlink
 * swapped in after path resolution cannot be followed on read, regular files
 * over 128 MB are refused, and non-regular files (pipes/devices) are bounded
 * to 128 MB instead of reading unboundedly into memory.
 */
/**
 * Official `ir(promise, signal, () => new AbortError())` (#989):
 * Race an async read against `signal` so an interrupt immediately ends a Read
 * waiting on an idle pipe or device.
 */
async function raceReadWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    throw new Error('Aborted')
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error('Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      val => {
        signal.removeEventListener('abort', onAbort)
        resolve(val)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

async function readImageBytesNoFollow(
  filePath: string,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (process.platform === 'win32' && maxBytes !== undefined) {
    if (!(await lstat(filePath)).isFile()) {
      return Buffer.alloc(0)
    }
  }
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
  const handle = await open(filePath, flags)
  try {
    const st = await handle.stat()
    if (maxBytes !== undefined) {
      if (!st.isFile()) {
        return Buffer.alloc(0)
      }
      const chunks: Buffer[] = []
      let total = 0
      const buf = Buffer.allocUnsafe(Math.min(65536, Math.max(1, maxBytes)))
      while (total < maxBytes) {
        if (signal?.aborted) {
          throw new Error('Aborted')
        }
        const toRead = Math.min(buf.length, maxBytes - total)
        const { bytesRead } = await handle.read(buf, 0, toRead, total)
        if (bytesRead === 0) break
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
        total += bytesRead
      }
      return Buffer.concat(chunks, total)
    }

    if (st.isFile()) {
      if (st.size > IMAGE_MAX_BYTES) {
        throw new Error(
          `File is too large to read as an image (the limit is ${formatFileSize(IMAGE_MAX_BYTES)}): ${filePath}. If it is an image, resize it or export a smaller copy, then read that.`,
        )
      }
      const chunks: Buffer[] = []
      let total = 0
      const cap = IMAGE_MAX_BYTES + 1
      const buf = Buffer.allocUnsafe(Math.min(IMAGE_STREAM_CHUNK_BYTES, cap))
      while (total < cap) {
        if (signal?.aborted) {
          throw new Error('Aborted')
        }
        const toRead = Math.min(buf.length, cap - total)
        const { bytesRead } = await handle.read(buf, 0, toRead, total)
        if (bytesRead === 0) break
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
        total += bytesRead
      }
      if (total > IMAGE_MAX_BYTES) {
        throw new Error(
          `File is too large to read as an image (the limit is ${formatFileSize(IMAGE_MAX_BYTES)}): ${filePath}. If it is an image, resize it or export a smaller copy, then read that.`,
        )
      }
      return Buffer.concat(chunks, total)
    }

    // Non-regular file (pipe / device): read bounded stream up to 128 MB
    const chunks: Buffer[] = []
    let total = 0
    while (total <= IMAGE_MAX_BYTES) {
      if (signal?.aborted) {
        throw new Error('Aborted')
      }
      const chunkSize = Math.min(
        Math.max(total, IMAGE_STREAM_CHUNK_BYTES),
        IMAGE_MAX_BYTES + 1 - total,
      )
      const chunk = Buffer.allocUnsafe(chunkSize)
      const { bytesRead } = await raceReadWithSignal(
        handle.read(chunk, 0, chunkSize, null),
        signal,
      )
      if (bytesRead === 0) break
      chunks.push(
        bytesRead === chunkSize ? chunk : chunk.subarray(0, bytesRead),
      )
      total += bytesRead
    }
    if (total > IMAGE_MAX_BYTES) {
      throw new Error(
        `Cannot read this as an image: ${filePath} is a pipe or a device, not a regular file, and it sent more than ${formatFileSize(IMAGE_MAX_BYTES)} without ending.`,
      )
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

export async function readImageWithTokenBudget(
  filePath: string,
  maxTokens: number = getDefaultFileReadingLimits().maxTokens,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<ImageResult> {
  // Read file ONCE with O_NOFOLLOW — capped to maxBytes (or 128 MB default) to avoid OOM
  const imageBuffer = await readImageBytesNoFollow(filePath, maxBytes, signal)
  const originalSize = imageBuffer.length

  if (originalSize === 0) {
    throw new Error(`Image file is empty: ${filePath}`)
  }

  const detectedMediaType = detectImageFormatFromBuffer(imageBuffer)
  const detectedFormat = detectedMediaType.split('/')[1] || 'png'

  // Try standard resize
  let result: ImageResult
  try {
    const resized = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      originalSize,
      detectedFormat,
    )
    result = createImageResponse(
      resized.buffer,
      resized.mediaType,
      originalSize,
      resized.dimensions,
    )
  } catch (e) {
    if (e instanceof ImageResizeError) throw e
    logError(e)
    result = createImageResponse(imageBuffer, detectedFormat, originalSize)
  }

  // Check if it fits in token budget
  const estimatedTokens = Math.ceil(result.file.base64.length * 0.125)
  if (estimatedTokens > maxTokens) {
    // Aggressive compression from the SAME buffer (no re-read)
    try {
      const compressed = await compressImageBufferWithTokenLimit(
        imageBuffer,
        maxTokens,
        detectedMediaType,
      )
      return {
        type: 'image',
        file: {
          base64: compressed.base64,
          type: compressed.mediaType,
          originalSize,
        },
      }
    } catch (e) {
      logError(e)
      // Fallback: heavily compressed version from the SAME buffer
      try {
        const sharpModule = await import('sharp')
        const sharp =
          (
            sharpModule as unknown as {
              default?: typeof sharpModule
            } & typeof sharpModule
          ).default || sharpModule

        const fallbackBuffer = await (sharp as any)(imageBuffer)
          .resize(400, 400, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 20 })
          .toBuffer()

        return createImageResponse(fallbackBuffer, 'jpeg', originalSize)
      } catch (error) {
        logError(error)
        return createImageResponse(imageBuffer, detectedFormat, originalSize)
      }
    }
  }

  return result
}
