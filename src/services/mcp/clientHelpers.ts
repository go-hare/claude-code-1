import type {
  Base64ImageSource,
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  MAX_LOADED_MCP_DESCRIPTION_LENGTH as PKG_MAX_LOADED_MCP_DESCRIPTION_LENGTH,
  MAX_MCP_DESCRIPTION_LENGTH as PKG_MAX_MCP_DESCRIPTION_LENGTH,
} from '@claude-code/mcp-client'
import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import { join } from 'path'
import { UnauthorizedError } from '@modelcontextprotocol/client'
import type { AssistantMessage } from 'src/types/message.js'
import type { Command } from '../../commands.js'
import type { Tool } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'
import {
  AbortError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import {
  type ImageLimits,
  maybeResizeAndDownsampleImageBuffer,
} from '../../utils/imageResizer.js'
import { logMCPError } from '../../utils/log.js'
import { isFirstPartyAnthropicMcpUrl } from './mcpFirstPartyAutoAuth.js'
import {
  getBinaryBlobSavedMessage,
  getFormatDescription,
  getLargeOutputInstructions,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import {
  getContentSizeEstimate,
  type MCPToolResult,
  mcpContentNeedsTruncation,
  truncateMcpContentIfNeeded,
} from '../../utils/mcpValidation.js'
import { resolveMcpToolIdleTimeoutMs } from '../../utils/residualMsEnvGates.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  isPersistError,
  persistToolResult,
} from '../../utils/toolResultStorage.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { isClaudeAiBearerRejectedError } from './connectionHelpers.js'
import { normalizeNameForMCP } from './normalization.js'
import type {
  MCPServerConnection,
  PromptMessage,
  ResourceLink,
  ScopedMcpServerConfig,
} from './types.js'

/**
 * Default timeout for MCP tool calls (effectively infinite - ~27.8 hours).
 * Hard wall-clock cap for the entire tool call (MCP_TOOL_TIMEOUT).
 */
export const DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000

/**
 * Cap on MCP tool descriptions and server instructions sent up front (4096).
 */
export const MAX_MCP_DESCRIPTION_LENGTH = PKG_MAX_MCP_DESCRIPTION_LENGTH

/**
 * Cap on MCP tool descriptions loaded through tool search (16384).
 */
export const MAX_LOADED_MCP_DESCRIPTION_LENGTH =
  PKG_MAX_LOADED_MCP_DESCRIPTION_LENGTH

/**
 * SEA 325 `Pne(isLoaded = false)` — resolve description cap with env override.
 */
export function getMaxMcpDescriptionLength(isLoaded = false): number {
  const raw = process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH
  if (raw !== undefined) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return isLoaded
    ? MAX_LOADED_MCP_DESCRIPTION_LENGTH
    : MAX_MCP_DESCRIPTION_LENGTH
}

/**
 * SEA 325 `URe(config, isLoaded)` (#726) — exempts first-party
 * `api.anthropic.com` HTTP/SSE MCP servers from the 4,096-char description/
 * instructions cap.
 */
export function getMaxMcpDescriptionLengthForConfig(
  config: { type?: string; url?: string },
  isLoaded = false,
): number {
  if (
    (config.type === 'http' || config.type === 'sse') &&
    isFirstPartyAnthropicMcpUrl(config.url)
  ) {
    return Infinity
  }
  return getMaxMcpDescriptionLength(isLoaded)
}

/**
 * Max cache size for fetch* caches. Keyed by server name (stable across
 * reconnects), bounded to prevent unbounded growth with many MCP servers.
 */
export const MCP_FETCH_CACHE_SIZE = 20

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

/**
 * Gets the hard wall-clock timeout for MCP tool calls in milliseconds.
 * Uses MCP_TOOL_TIMEOUT environment variable if set, otherwise defaults to ~27.8 hours.
 */
export function getMcpToolTimeoutMs(): number {
  return (
    parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10) ||
    DEFAULT_MCP_TOOL_TIMEOUT_MS
  )
}

/**
 * Official 2.1.187 idle watchdog for remote MCP tools.
 * Returns null when disabled (0 / unset-after-disable).
 * Precedence: per-server `timeout` > CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT > 5 min.
 * Env densable via resolveMcpToolIdleTimeoutMs.
 */
export function getMcpToolIdleTimeoutMs(
  serverConfig: { timeout?: number } | undefined,
): number | null {
  if (
    serverConfig &&
    typeof serverConfig.timeout === 'number' &&
    Number.isFinite(serverConfig.timeout)
  ) {
    if (serverConfig.timeout <= 0) return null
    return serverConfig.timeout
  }
  return resolveMcpToolIdleTimeoutMs()
}

/**
 * Encode MCP tool input for the auto-mode security classifier.
 * Exported so the auto-mode eval scripts can mirror production encoding
 * for `mcp__*` tool stubs without duplicating this logic.
 */
export function mcpToolInputToAutoClassifierInput(
  input: Record<string, unknown>,
  toolName: string,
): string {
  const keys = Object.keys(input)
  return keys.length > 0
    ? keys.map(k => `${k}=${String(input[k])}`).join(' ')
    : toolName
}

export function isClaudeAiProxyListAuthError(error: unknown): boolean {
  if (isClaudeAiBearerRejectedError(error)) return false
  if (error instanceof UnauthorizedError) return true
  if (error instanceof Error) {
    const status =
      'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 'code' in error &&
            typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : undefined
    if (status === 401 || status === 403) return true
    // StreamableHTTPError / message-embedded status
    if (/\b40[13]\b/.test(error.message)) return true
  }
  return false
}

/** Official `i2t` — reconnect aborted because account identity moved. */
export function inertReconnectShape(
  name: string,
  config: ScopedMcpServerConfig,
): {
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
} {
  logEvent('mcp_reconnect', {
    result:
      'mcp_reconnect_identity_changed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return {
    client: {
      name,
      type: 'failed',
      config,
      error:
        'Reconnect cancelled: the account changed while connecting. Choose Reconnect again.',
      errorCode: 'IDENTITY_CHANGED',
    },
    tools: [],
    commands: [],
  }
}

/**
 * Transform result content from an MCP tool or MCP prompt into message blocks
 */
export async function transformResultContent(
  resultContent: PromptMessage['content'],
  serverName: string,
  limits?: ImageLimits,
  includeMeta = false,
): Promise<Array<ContentBlockParam>> {
  switch (resultContent.type) {
    case 'text': {
      const block: ContentBlockParam = {
        type: 'text',
        text: resultContent.text,
      }
      if (includeMeta) {
        const meta = resultContent._meta
        if (meta) {
          ;(block as { _meta?: unknown })._meta = meta
        }
      }
      return [block]
    }
    case 'audio': {
      const audioData = resultContent as {
        type: 'audio'
        data: string
        mimeType?: string
      }
      return await persistBlobToTextBlock(
        Buffer.from(audioData.data, 'base64'),
        audioData.mimeType,
        serverName,
        `[Audio from ${serverName}] `,
      )
    }
    case 'image': {
      // Resize and compress image data, enforcing API dimension limits
      const imageBuffer = Buffer.from(String(resultContent.data), 'base64')
      const ext = resultContent.mimeType?.split('/')[1] || 'png'
      const resized = await maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        ext,
        limits,
      )
      return [
        {
          type: 'image',
          source: {
            data: resized.buffer.toString('base64'),
            media_type:
              `image/${resized.mediaType}` as Base64ImageSource['media_type'],
            type: 'base64',
          },
        },
      ]
    }
    case 'resource': {
      const resource = resultContent.resource
      const prefix = `[Resource from ${serverName} at ${resource.uri}] `

      if ('text' in resource) {
        return [
          {
            type: 'text',
            text: `${prefix}${resource.text}`,
          },
        ]
      } else if ('blob' in resource) {
        const isImage = IMAGE_MIME_TYPES.has(resource.mimeType ?? '')

        if (isImage) {
          // Resize and compress image blob, enforcing API dimension limits
          const imageBuffer = Buffer.from(resource.blob, 'base64')
          const ext = resource.mimeType?.split('/')[1] || 'png'
          const resized = await maybeResizeAndDownsampleImageBuffer(
            imageBuffer,
            imageBuffer.length,
            ext,
            limits,
          )
          const content: MessageParam['content'] = []
          if (prefix) {
            content.push({
              type: 'text',
              text: prefix,
            })
          }
          content.push({
            type: 'image',
            source: {
              data: resized.buffer.toString('base64'),
              media_type:
                `image/${resized.mediaType}` as Base64ImageSource['media_type'],
              type: 'base64',
            },
          })
          return content
        } else {
          return await persistBlobToTextBlock(
            Buffer.from(resource.blob, 'base64'),
            resource.mimeType,
            serverName,
            prefix,
          )
        }
      }
      return []
    }
    case 'resource_link': {
      const resourceLink = resultContent as ResourceLink
      let text = `[Resource link: ${resourceLink.name}] ${resourceLink.uri}`
      if (resourceLink.description) {
        text += ` (${resourceLink.description})`
      }
      return [
        {
          type: 'text',
          text,
        },
      ]
    }
    default:
      return []
  }
}

/**
 * Decode base64 binary content, write it to disk with the proper extension,
 * and return a small text block with the file path. Replaces the old behavior
 * of dumping raw base64 into the context.
 */
async function persistBlobToTextBlock(
  bytes: Buffer,
  mimeType: string | undefined,
  serverName: string,
  sourceDescription: string,
): Promise<Array<ContentBlockParam>> {
  const persistId = `mcp-${normalizeNameForMCP(serverName)}-blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const result = await persistBinaryContent(bytes, mimeType, persistId)

  if ('error' in result) {
    return [
      {
        type: 'text',
        text: `${sourceDescription}Binary content (${mimeType || 'unknown type'}, ${bytes.length} bytes) could not be saved to disk: ${result.error}`,
      },
    ]
  }

  return [
    {
      type: 'text',
      text: getBinaryBlobSavedMessage(
        result.filepath,
        mimeType,
        result.size,
        sourceDescription,
      ),
    },
  ]
}

/**
 * Processes MCP tool result into a normalized format.
 */
export type MCPResultType = 'toolResult' | 'structuredContent' | 'contentArray'

export type TransformedMCPResult = {
  content: MCPToolResult
  type: MCPResultType
  schema?: string
}

/**
 * Generates a compact, jq-friendly type signature for a value.
 * e.g. "{title: string, items: [{id: number, name: string}]}"
 */
export function inferCompactSchema(value: unknown, depth = 2): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${inferCompactSchema(value[0], depth - 1)}]`
  }
  if (typeof value === 'object') {
    if (depth <= 0) return '{...}'
    const entries = Object.entries(value).slice(0, 10)
    const props = entries.map(
      ([k, v]) => `${k}: ${inferCompactSchema(v, depth - 1)}`,
    )
    const suffix = Object.keys(value).length > 10 ? ', ...' : ''
    return `{${props.join(', ')}${suffix}}`
  }
  return typeof value
}

export async function transformMCPResult(
  result: unknown,
  tool: string, // Tool name for validation (e.g., "search")
  name: string, // Server name for transformation (e.g., "slack")
  limits?: ImageLimits, // Image processing limits, plumbed to transformResultContent
): Promise<TransformedMCPResult> {
  if (result && typeof result === 'object') {
    if ('toolResult' in result) {
      return {
        content: String(result.toolResult),
        type: 'toolResult',
      }
    }

    if (
      'structuredContent' in result &&
      result.structuredContent !== undefined
    ) {
      return {
        content: jsonStringify(result.structuredContent),
        type: 'structuredContent',
        schema: inferCompactSchema(result.structuredContent),
      }
    }

    if ('content' in result && Array.isArray(result.content)) {
      const transformedContent = (
        await Promise.all(
          result.content.map(item =>
            transformResultContent(item, name, limits, true),
          ),
        )
      ).flat()
      return {
        content: transformedContent,
        type: 'contentArray',
        schema: inferCompactSchema(transformedContent),
      }
    }
  }

  const errorMessage = `MCP server "${name}" tool "${tool}": unexpected response format`
  logMCPError(name, errorMessage)
  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    errorMessage,
    'MCP tool unexpected response format',
  )
}

/**
 * Check if MCP content contains any image blocks.
 * Used to decide whether to persist to file (images should use truncation instead
 * to preserve image compression and viewability).
 */
function contentContainsImages(content: MCPToolResult): boolean {
  if (!content || typeof content === 'string') {
    return false
  }
  return content.some(block => block.type === 'image')
}

export async function processMCPResult(
  result: unknown,
  tool: string, // Tool name for validation (e.g., "search")
  name: string, // Server name for IDE check and transformation (e.g., "slack")
  limits?: ImageLimits, // Image processing limits, plumbed to transformMCPResult
  skipLargeOutput = false, // If true, skip large-output handling for non-image content
): Promise<MCPToolResult> {
  const { content, type, schema } = await transformMCPResult(
    result,
    tool,
    name,
    limits,
  )

  // IDE tools are not going to the model directly, so we don't need to
  // handle large output.
  if (name === 'ide') {
    return content
  }

  // Caller opted out of large-output handling (e.g., result already truncated
  // upstream); only continue if the content has images that may need handling.
  if (skipLargeOutput && !contentContainsImages(content)) {
    return content
  }

  // Check if content needs truncation (i.e., is too large)
  if (!(await mcpContentNeedsTruncation(content))) {
    return content
  }

  const sizeEstimateTokens = getContentSizeEstimate(content)

  // If large output files feature is disabled, fall back to old truncation behavior
  if (isEnvDefinedFalsy(process.env.ENABLE_MCP_LARGE_OUTPUT_FILES)) {
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'env_disabled',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return await truncateMcpContentIfNeeded(content)
  }

  // Save large output to file and return instructions for reading it
  // Content is guaranteed to exist at this point (we checked mcpContentNeedsTruncation)
  if (!content) {
    return content
  }

  // If content contains images, fall back to truncation - persisting images as JSON
  // defeats the image compression logic and makes them non-viewable
  if (contentContainsImages(content)) {
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'contains_images',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return await truncateMcpContentIfNeeded(content)
  }

  // Generate a unique ID for the persisted file (server__tool-timestamp)
  const timestamp = Date.now()
  const persistId = `mcp-${normalizeNameForMCP(name)}-${normalizeNameForMCP(tool)}-${timestamp}`
  // When the large-string format gate is on, unwrap a single bare text block
  // (no annotations, no _meta) into raw text so the model gets plain text in
  // the persisted file instead of a JSON-wrapped block. The `_meta` check is
  // why transformResultContent preserves _meta on text blocks.
  const unwrappedText = unwrapSingleTextBlock(content)
  const contentStr =
    typeof content === 'string'
      ? content
      : (unwrappedText ?? jsonStringify(content, null, 2))
  const persistResult = await persistToolResult(contentStr, persistId)

  if (isPersistError(persistResult)) {
    // If file save failed, fall back to returning truncated content info
    const contentLength = contentStr.length
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'persist_failed',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return `Error: result (${contentLength.toLocaleString()} characters) exceeds maximum allowed tokens. Failed to save output to file: ${persistResult.error}. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data.`
  }

  logEvent('tengu_mcp_large_result_handled', {
    outcome: 'persisted',
    reason: 'file_saved',
    sizeEstimateTokens,
    persistedSizeChars: persistResult.originalSize,
  } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

  const formatDescription =
    unwrappedText !== undefined
      ? getFormatDescription('toolResult')
      : getFormatDescription(type, schema)
  return getLargeOutputInstructions(
    persistResult.filepath,
    persistResult.originalSize,
    formatDescription,
  )
}

/**
 * Returns true when the large-string output format is enabled (matches
 * binary's `sf8()`). When enabled, processMCPResult unwraps a single bare
 * text block to raw text for persistence instead of JSON-wrapping it.
 *
 * Gating sources, in order:
 *   1. MCP_TRUNCATION_PROMPT_OVERRIDE env var (anything except "legacy" enables)
 *   2. Statsig gate `tengu_mcp_subagent_prompt`
 */
function isLargeStringFormatEnabled(): boolean {
  const override = process.env.MCP_TRUNCATION_PROMPT_OVERRIDE
  if (override) return override !== 'legacy'
  return checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
    'tengu_mcp_subagent_prompt',
  )
}

/**
 * Unwraps a single bare text content block to its raw text when the
 * large-string format gate is on. Returns undefined when the gate is off,
 * the content is not an array, the array doesn't contain exactly one text
 * block, or the block carries annotations or _meta. Matches binary mg5's
 * `M=...` computation.
 */
function unwrapSingleTextBlock(content: MCPToolResult): string | undefined {
  if (!isLargeStringFormatEnabled()) return undefined
  if (!Array.isArray(content) || content.length !== 1) return undefined
  const block = content[0]
  if (!block || block.type !== 'text') return undefined
  if ('annotations' in block || '_meta' in block) return undefined
  return block.text
}

/**
 * Call an MCP tool, handling UrlElicitationRequiredError (-32042) by
 * displaying the URL elicitation to the user, waiting for the completion
 * notification, and retrying the tool call.
 */
export type MCPToolCallResult = {
  content: MCPToolResult
  interrupted?: boolean
  isError?: boolean
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}

/**
 * densable `Q6` — explicit interrupt text for an aborted MCP `tools/call`.
 * Official: abort used to return empty content → Dyo filled
 * `(${name} completed with no output)`.
 */
export const MCP_TOOL_CALL_INTERRUPTED =
  'The tool call was interrupted before a result was received. It may or may not have completed on the server — verify before assuming it succeeded, and retry if needed.'

/**
 * densable MCP `call`: `if(Ae.interrupted)throw new Rn(Q6)`.
 * `Rn` in that module is the interrupt Error (`instanceof` → OLr "interrupted").
 */
export function throwIfMcpToolCallInterrupted(
  result: { interrupted?: boolean } | object,
): void {
  if (
    result &&
    typeof result === 'object' &&
    'interrupted' in result &&
    result.interrupted
  ) {
    throw new AbortError(MCP_TOOL_CALL_INTERRUPTED)
  }
}

export function extractToolUseId(
  message: AssistantMessage,
): string | undefined {
  const firstBlock = (
    message.message.content as ContentBlockParam[] | undefined
  )?.[0]
  if (
    !firstBlock ||
    typeof firstBlock === 'string' ||
    firstBlock.type !== 'tool_use'
  ) {
    return undefined
  }
  return firstBlock.id
}

/**
 * SEA 325 `_We = 128` (`C3e`) — API max tool name length.
 * Tools with names > 128 chars are omitted and reported once per tool name.
 */
export const MAX_MCP_TOOL_NAME_LENGTH = 128
const MAX_REPORTED_LONG_TOOL_NAMES = 256
const reportedLongToolNames = new Set<string>()

export function resetReportedLongToolNamesForTest(): void {
  reportedLongToolNames.clear()
}

export function filterMcpToolsByNameLength<
  T extends { name: string; mcpInfo?: { serverName: string } },
>(tools: readonly T[], fallbackServerName?: string): T[] {
  const skippedByServer = new Map<string, number>()
  const kept = tools.filter(tool => {
    if (tool.name.length <= MAX_MCP_TOOL_NAME_LENGTH) {
      return true
    }
    const serverName =
      tool.mcpInfo?.serverName ?? fallbackServerName ?? 'unknown'
    if (
      reportedLongToolNames.size < MAX_REPORTED_LONG_TOOL_NAMES &&
      !reportedLongToolNames.has(tool.name)
    ) {
      reportedLongToolNames.add(tool.name)
      skippedByServer.set(
        serverName,
        (skippedByServer.get(serverName) ?? 0) + 1,
      )
      logMCPError(
        serverName,
        `Tool "${tool.name}" is not sent to Claude: its name has ${tool.name.length} characters and the API accepts at most ${MAX_MCP_TOOL_NAME_LENGTH}`,
      )
    }
    return false
  })
  for (const [_serverName, skippedCount] of skippedByServer) {
    logEvent('tengu_mcp_degraded', {
      reason:
        'tool_name_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skippedCount,
    })
  }
  return kept
}

const TERMINAL_ERROR_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ECONNREFUSED',
]
const TERMINAL_CODE_SET = new Set([
  ...TERMINAL_ERROR_CODES,
  'ConnectionRefused',
  'ConnectionClosed',
])
const HTTP_POST_STATUS_RE = /^Error POSTing to endpoint \(HTTP (\d+)\)/

function isHttpStatusCode(v: unknown): boolean {
  return typeof v === 'number' && v >= 100 && v <= 599
}

/**
 * SEA 325 `tu(e)` (`isTerminalConnectionError`) — distinguish transport-level
 * network errors from server/HTTP/JSON-RPC error replies that happen to mention
 * a network error name in their message text.
 */
export function isTerminalConnectionError(error: Error): boolean {
  if (error.name === 'AbortError') return true
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined
  const status =
    'status' in error ? (error as { status?: unknown }).status : undefined
  const httpStatusMatch = HTTP_POST_STATUS_RE.exec(error.message)?.[1]
  if (
    isHttpStatusCode(status) ||
    isHttpStatusCode(code) ||
    (typeof code === 'number' && code < 0) ||
    (httpStatusMatch !== undefined && isHttpStatusCode(Number(httpStatusMatch)))
  ) {
    return false
  }
  if (typeof code === 'string' && TERMINAL_CODE_SET.has(code)) {
    return true
  }
  const msg = error.message
  return (
    TERMINAL_ERROR_CODES.some(c => msg.includes(c)) ||
    msg.includes('Body Timeout Error') ||
    /\bterminated\b/.test(msg) ||
    msg.includes('SSE stream disconnected') ||
    msg.includes('Failed to reconnect SSE stream')
  )
}

export const WINDOWS_STDIO_STDIN_CLOSE_GRACE_MS = 300
export const WINDOWS_STDIO_KILL_WAIT_MS = 600

function isProcessExited(
  proc: Pick<ChildProcess, 'exitCode' | 'signalCode'>,
): boolean {
  return proc.exitCode !== null || proc.signalCode !== null
}

function raceExitWithTimeout(
  exitPromise: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, timeoutMs)
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref()
    }
    void exitPromise.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function killWindowsProcessTree(pid: number): void {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const taskkillExe = join(systemRoot, 'System32', 'taskkill.exe')
  try {
    const child = spawn(taskkillExe, ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    })
    child.on('error', () => {
      try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          shell: false,
        }).on('error', () => {})
      } catch {
        // ignore
      }
    })
  } catch {
    // ignore
  }
}

/**
 * SEA 325 `yr(e)` — Windows stdio MCP shutdown: close stdin first, wait 300 ms,
 * and only kill the process tree if the server is still running.
 */
export async function gracefulShutdownWindowsStdio(
  proc: Pick<
    ChildProcess,
    'pid' | 'exitCode' | 'signalCode' | 'stdin' | 'once'
  >,
  options: {
    graceMs?: number
    killWaitMs?: number
    killTree?: (pid: number) => void
  } = {},
): Promise<void> {
  const pid = proc.pid
  if (pid === undefined || isProcessExited(proc)) return
  const graceMs = options.graceMs ?? WINDOWS_STDIO_STDIN_CLOSE_GRACE_MS
  const killWaitMs = options.killWaitMs ?? WINDOWS_STDIO_KILL_WAIT_MS
  const killTree = options.killTree ?? killWindowsProcessTree

  const exited = new Promise<void>(resolve => {
    proc.once('exit', () => resolve())
  })
  proc.stdin?.end()
  await raceExitWithTimeout(exited, graceMs)
  if (isProcessExited(proc)) return

  logForDebugging(
    `[MCP] stdio server process ${pid} is still running ${graceMs}ms after stdin closed; terminating its process tree`,
  )
  killTree(pid)
  await raceExitWithTimeout(exited, killWaitMs)
}
