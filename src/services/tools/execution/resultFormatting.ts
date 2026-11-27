/**
 * Tool result formatting, error classification, MCP/built-in unavailability hints,
 * deferred-tool schema hints, git commit telemetry resolution, and message block
 * inspection/reconstruction utilities.
 */

import type {
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { parseGitCommitId } from '@claude-code/builtin-tools/tools/shared/gitOperationTracking.js'
import { resolve as resolvePath } from 'path'
import type { Tool } from '../../../Tool.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../types/message.js'
import { GET_TASK_TOOL_NAME } from '../../../utils/bashTaskDeliveryOutcomes.js'
import {
  getErrnoCode,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../utils/errors.js'
import { getHeadForDir } from '../../../utils/git/gitFilesystem.js'
import { createUserMessage } from '../../../utils/messages.js'
import {
  extractDiscoveredToolNames,
  isSearchExtraToolsEnabledOptimistic,
  isSearchExtraToolsToolAvailable,
} from '../../../utils/searchExtraTools.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import { mcpInfoFromString } from '../../mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from '../../mcp/normalization.js'
import type { MCPServerConnection } from '../../mcp/types.js'
import { getLoggingSafeMcpBaseUrl } from '../../mcp/utils.js'
import type {
  McpServerType,
  MessageUpdateLazy,
  NotLoadedMcpToolFamily,
} from './types.js'

/**
 * Classify a tool execution error into a telemetry-safe string.
 *
 * In minified/external builds, `error.constructor.name` is mangled into
 * short identifiers like "nJT" or "Chq" — useless for diagnostics.
 * This function extracts structured, telemetry-safe information instead:
 * - TelemetrySafeError: use its telemetryMessage (already vetted)
 * - Node.js fs errors: log the error code (ENOENT, EACCES, etc.)
 * - Known error types: use their unminified name
 * - Fallback: "Error" (better than a mangled 3-char identifier)
 */
export function classifyToolError(error: unknown): string {
  if (
    error instanceof TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  ) {
    return error.telemetryMessage.slice(0, 200)
  }
  if (error instanceof Error) {
    // Node.js filesystem errors have a `code` property (ENOENT, EACCES, etc.)
    // These are safe to log and much more useful than the constructor name.
    const errnoCode = getErrnoCode(error)
    if (typeof errnoCode === 'string') {
      return `Error:${errnoCode}`
    }
    // ShellError, ImageSizeError, etc. have stable `.name` properties
    // that survive minification (they're set in the constructor).
    if (error.name && error.name !== 'Error' && error.name.length > 3) {
      return error.name.slice(0, 60)
    }
    return 'Error'
  }
  return 'UnknownError'
}

function findMcpServerConnection(
  toolName: string,
  mcpClients: MCPServerConnection[],
): MCPServerConnection | undefined {
  if (!toolName.startsWith('mcp__')) {
    return undefined
  }

  const mcpInfo = mcpInfoFromString(toolName)
  if (!mcpInfo) {
    return undefined
  }

  // mcpInfo.serverName is normalized (e.g., "claude_ai_Slack"), but client.name
  // is the original name (e.g., "claude.ai Slack"). Normalize both for comparison.
  return mcpClients.find(
    client => normalizeNameForMCP(client.name) === mcpInfo.serverName,
  )
}

/**
 * Extracts the MCP server transport type from a tool name.
 * Returns the server type (stdio, sse, http, ws, sdk, etc.) for MCP tools,
 * or undefined for built-in tools.
 */
export function getMcpServerType(
  toolName: string,
  mcpClients: MCPServerConnection[],
): McpServerType {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)

  if (serverConnection?.type === 'connected') {
    // Handle stdio configs where type field is optional (defaults to 'stdio')
    return serverConnection.config.type ?? 'stdio'
  }

  return undefined
}

/**
 * Extracts the MCP server base URL for a tool by looking up its server connection.
 * Returns undefined for stdio servers, built-in tools, or if the server is not connected.
 */
export function getMcpServerBaseUrlFromToolName(
  toolName: string,
  mcpClients: MCPServerConnection[],
): string | undefined {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)
  if (serverConnection?.type !== 'connected') {
    return undefined
  }
  return getLoggingSafeMcpBaseUrl(serverConnection.config)
}

/**
 * Official 2.1.331 `E_l` (@311340059) / toolExecution hint (@319751208):
 * GetTask is kept in the base pool for synthetic delivery rendering while
 * `GetTaskTool.isEnabled()` returns `false`; explain this when a model tries
 * to call `GetTask` directly.
 */
export const GET_TASK_UNAVAILABLE_HINT =
  ". GetTask is not a tool you can call. A background command's or task's result reaches you by itself when it finishes, unless the message that started it said otherwise, so you don't need to check on it."

export function formatUnavailableBuiltInToolHint(toolName: string): string {
  if (toolName === GET_TASK_TOOL_NAME) {
    return GET_TASK_UNAVAILABLE_HINT
  }
  return ''
}

const MCP_RESOURCE_TOOL_NAMES = new Set([
  'ListMcpResourcesTool',
  'ListMcpResources',
  'ReadMcpResourceTool',
  'ReadMcpResource',
  'ReadMcpResourceDirTool',
  'ReadMcpResourceDir',
])

/**
 * Official 2.1.326 #83 (`MYe`/`wdi` @299078597): Explain why an approved MCP
 * resource tool or MCP server tool is unavailable (for example after a cloud
 * session's worker was replaced).
 */
export function formatUnavailableMcpOrResourceToolHint(
  toolName: string,
  mcpClients: readonly MCPServerConnection[],
  agentId?: string,
): string {
  if (MCP_RESOURCE_TOOL_NAMES.has(toolName)) {
    const hasPending = mcpClients.some(c => c.type === 'pending')
    if (hasPending) {
      return agentId
        ? `. ${toolName} is not available in this context. Continue without this tool.`
        : `. ${toolName} is unavailable right now while MCP servers are still connecting; try again shortly.`
    }
    return `. ${toolName} is not among the tools available here. Continue with the tools you have.`
  }
  if (!toolName.startsWith('mcp__')) {
    return ''
  }
  const conn = findMcpServerConnection(
    toolName,
    mcpClients as MCPServerConnection[],
  )
  if (!conn) {
    return '. No MCP server in this session provides it; continue without this tool.'
  }
  switch (conn.type) {
    case 'pending':
      return agentId
        ? `. Its MCP server '${conn.name}' is not connected in this context. Continue without this tool.`
        : `. Its MCP server '${conn.name}' is still connecting; try again shortly.`
    case 'needs-auth':
      return agentId
        ? `. Its MCP server '${conn.name}' is not available in this context. Continue without this tool.`
        : `. Its MCP server '${conn.name}' needs the user to re-authorize it before its tools work again. Continue without this tool and tell the user if the task depends on it.`
    case 'disabled':
      return `. Its MCP server '${conn.name}' was disabled by the user. Continue without this tool.`
    case 'failed':
      return agentId
        ? `. Its MCP server '${conn.name}' is not available in this context. Continue without this tool.`
        : `. Its MCP server '${conn.name}' has disconnected. Continue without this tool; it becomes callable again only if the server reconnects.`
    case 'connected':
      return `. Its MCP server '${conn.name}' is connected but does not offer this tool here. Continue without it.`
    default:
      return '. No MCP server in this session provides it; continue without this tool.'
  }
}

export function findToolResultBlockInUpdate(
  update: MessageUpdateLazy,
  toolUseID: string,
): ToolResultBlockParam | undefined {
  const msg = update.message
  if (msg.type !== 'user') {
    return undefined
  }
  const userMsg = msg as UserMessage
  const content = userMsg.message.content
  if (typeof content === 'string' || !Array.isArray(content)) {
    return undefined
  }
  for (const block of content) {
    if (block.type === 'tool_result' && block.tool_use_id === toolUseID) {
      return block
    }
  }
  return undefined
}

export function formatToolResultBlockText(
  content: ToolResultBlockParam['content'],
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(part =>
      typeof part === 'object' && part !== null && part.type === 'text'
        ? [String(part.text ?? '')]
        : [],
    )
    .join('\n')
}

export function extractToolResultSummary(
  updates: readonly MessageUpdateLazy[],
  toolUseID: string,
): { text: string; isError?: true } {
  for (const update of updates) {
    const block = findToolResultBlockInUpdate(update, toolUseID)
    if (block) {
      return {
        text: formatToolResultBlockText(block.content),
        ...(block.is_error === true && { isError: true as const }),
      }
    }
  }
  return { text: '' }
}

export function extractToolUseResultFromMessages(
  updates: readonly MessageUpdateLazy[],
): unknown {
  for (const { message } of updates) {
    if (message.type === 'user' && message.toolUseResult !== undefined) {
      return message.toolUseResult
    }
  }
  return undefined
}

/** Skip is_error tool_result so permission deny `Error:` is not kce'd (gold DVt). */
export function extractSuccessfulToolUseResult(
  updates: readonly MessageUpdateLazy[],
): unknown {
  for (const { message } of updates) {
    if (message.type !== 'user') continue
    const content = message.message?.content
    if (
      Array.isArray(content) &&
      content.some(
        block => block.type === 'tool_result' && block.is_error === true,
      )
    ) {
      continue
    }
    if (message.toolUseResult !== undefined) {
      return message.toolUseResult
    }
  }
  return undefined
}

export function buildToolCallDenyMessages(
  toolUseID: string,
  reason: string,
  assistantUUID: AssistantMessage['uuid'],
): MessageUpdateLazy[] {
  return [
    {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${reason}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUseID,
          },
        ],
        toolUseResult: `Error: ${reason}`,
        sourceToolAssistantUUID: assistantUUID,
      }),
    },
  ]
}

export function rebuildMessagesWithReplacedToolResult(
  priorRun: { messages: MessageUpdateLazy[] } | undefined,
  toolUseID: string,
  newBlock: ToolResultBlockParam,
  toolUseResult: unknown,
  assistantUUID: AssistantMessage['uuid'],
): MessageUpdateLazy[] {
  if (!priorRun) {
    return [
      {
        message: createUserMessage({
          content: [newBlock],
          toolUseResult,
          sourceToolAssistantUUID: assistantUUID,
        }),
      },
    ]
  }
  const existingIdx = priorRun.messages.findIndex(
    update => findToolResultBlockInUpdate(update, toolUseID) !== undefined,
  )
  const rawExistingMsg =
    existingIdx !== -1 ? priorRun.messages[existingIdx]?.message : undefined
  const existingUserMsg =
    rawExistingMsg?.type === 'user'
      ? (rawExistingMsg as UserMessage)
      : undefined
  const existingContextModifier =
    existingIdx !== -1
      ? priorRun.messages[existingIdx]?.contextModifier
      : undefined
  const existingContextLayers =
    existingIdx !== -1
      ? priorRun.messages[existingIdx]?.contextLayers
      : undefined
  const contentBlocks: ContentBlockParam[] =
    existingUserMsg !== undefined &&
    Array.isArray(existingUserMsg.message.content)
      ? existingUserMsg.message.content.map(block =>
          block.type === 'tool_result' && block.tool_use_id === toolUseID
            ? newBlock
            : block,
        )
      : [newBlock]
  const replacedEntry: MessageUpdateLazy = {
    message: createUserMessage({
      content: contentBlocks,
      imagePasteIds: existingUserMsg?.imagePasteIds,
      mcpMeta: existingUserMsg?.mcpMeta,
      toolEndsTurn: existingUserMsg?.toolEndsTurn,
      toolUseResult,
      sourceToolAssistantUUID: assistantUUID,
    }),
    ...(existingContextModifier !== undefined && {
      contextModifier: existingContextModifier,
    }),
    ...(existingContextLayers !== undefined && {
      contextLayers: existingContextLayers,
    }),
  }
  const remaining = priorRun.messages.filter((_, idx) => idx !== existingIdx)
  return [replacedEntry, ...remaining]
}

/**
 * Appended to Zod errors when a deferred tool wasn't in the discovered-tool
 * set — re-runs the claude.ts schema-filter scan dispatch-time to detect the
 * mismatch. The raw Zod error ("expected array, got string") doesn't tell the
 * model to re-load the tool; this hint does. Null if the schema was sent.
 */
export function buildSchemaNotSentHint(
  tool: Tool,
  messages: Message[],
  tools: readonly { name: string }[],
): string | null {
  // densable Nzy optimistic gating — prevent pointing at ToolSearch that
  // isn't callable; occasional misfires (Haiku, tst-auto below threshold)
  // cost one extra round-trip on an already-failing path.
  if (!isSearchExtraToolsEnabledOptimistic()) return null
  if (!isSearchExtraToolsToolAvailable(tools)) return null
  if (!isDeferredTool(tool)) return null
  const discovered = extractDiscoveredToolNames(messages)
  if (discovered.has(tool.name)) return null

  // densable: load via ToolSearch select, then call the tool directly.
  return (
    ` This tool's schema was not sent to the API — it was not in the discovered-tool set derived from message history. ` +
    `Without the schema in your prompt, typed parameters (arrays, numbers, booleans) get emitted as strings and the client-side parser rejects them. ` +
    `Load the tool first: call ${SEARCH_EXTRA_TOOLS_TOOL_NAME} with query "select:${tool.name}", then retry this call.`
  )
}

const MAX_NOT_LOADED_SCHEMA_CHARS = 8000

const BROWSER_MCP_TOOL_PREFIXES = [
  'mcp__claude-in-chrome__',
  'mcp__Claude_in_Chrome__',
  'mcp__remote-devices__claude-in-chrome__',
  'mcp__remote-devices__Claude_in_Chrome__',
  'mcp__claude-device__chrome_',
  'mcp__Claude_Preview__',
  'mcp__Claude_Browser__',
  'mcp__remote-devices__Claude_Browser__',
  'mcp__remote-devices__Claude_Preview__',
  'mcp__claude-for-chrome__',
  'mcp__remote-devices__claude-for-chrome__',
] as const

const SIMULATOR_MCP_TOOL_PREFIXES = [
  'mcp__Claude_Code_iOS_Simulator__',
  'mcp__remote-devices__Claude_Code_iOS_Simulator__',
  'mcp__Claude_Code_Android_Emulator__',
  'mcp__remote-devices__Claude_Code_Android_Emulator__',
] as const

const LINKED_COMPUTER_MCP_TOOL_NAMES = new Set([
  'mcp__remote-devices__device_commit_files',
  'mcp__remote-devices__device_bash',
  'mcp__remote-devices__create_artifact',
  'mcp__remote-devices__list_artifacts',
  'mcp__remote-devices__list_legacy_live_artifacts',
  'mcp__remote-devices__update_artifact',
])

const REMOTE_DEVICES_PREFIX = 'mcp__remote-devices__'
const REMOTE_DEVICES_PLUGIN_PREFIX = 'mcp__remote-devices__plugin_'

function isBrowserMcpToolName(name: string): boolean {
  return BROWSER_MCP_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
}

function isComputerUseMcpToolName(name: string): boolean {
  if (name.startsWith('mcp__computer-use__')) return true
  if (!name.startsWith(REMOTE_DEVICES_PREFIX)) return false
  const rest = name.slice(REMOTE_DEVICES_PREFIX.length)
  return (
    rest.startsWith('computer_') &&
    !rest.startsWith('computer__') &&
    !rest.includes('__')
  )
}

function isSimulatorMcpToolName(name: string): boolean {
  return SIMULATOR_MCP_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
}

function isLinkedComputerMcpTool(tool: Tool): boolean {
  if (tool.isMcp !== true) return false
  const serverName = tool.mcpInfo?.serverName
  if (serverName !== 'remote-devices') return false
  return (
    LINKED_COMPUTER_MCP_TOOL_NAMES.has(tool.name) ||
    tool.name.startsWith(REMOTE_DEVICES_PLUGIN_PREFIX)
  )
}

function isPluginMcpToolSurfacedInMessages(
  toolName: string,
  messages: Message[],
): boolean {
  return messages.some(msg => {
    if (msg.type !== 'attachment') return false
    const attachment = (msg as { attachment?: Record<string, unknown> })
      .attachment
    if (
      !attachment ||
      attachment.type !== 'deferred_tools_delta' ||
      attachment.toolSearchAbsent === true
    ) {
      return false
    }
    const surfaced = attachment.surfacedNames
    return Array.isArray(surfaced) && surfaced.includes(toolName)
  })
}

/**
 * Official 2.1.328 `EWe` + `rri` (`chunk@294254613.js @2828693, @4846960`):
 * Classify an MCP tool into one of the 5 families subject to `TOOL_NOT_LOADED`
 * enforcement (`browser`, `computer_use`, `simulator`, `linked_computer`,
 * `plugin`). Ordinary third-party MCP tools return `undefined`.
 */
export function classifyNotLoadedMcpToolFamily(
  tool: Tool,
  messages: Message[] = [],
): NotLoadedMcpToolFamily | undefined {
  if (tool.isMcp !== true) return undefined
  const name = tool.name
  if (isBrowserMcpToolName(name)) return 'browser'
  if (isComputerUseMcpToolName(name)) return 'computer_use'
  if (isSimulatorMcpToolName(name)) return 'simulator'
  if (isLinkedComputerMcpTool(tool)) return 'linked_computer'
  const source = (tool.mcpInfo as { source?: string } | undefined)?.source
  if (
    source === 'plugin' &&
    (tool.alwaysLoad === true ||
      tool.shouldDefer === true ||
      isPluginMcpToolSurfacedInMessages(name, messages))
  ) {
    return 'plugin'
  }
  return undefined
}

/**
 * Official 2.1.328 `W3s` / `EWe` (`chunk@294254613.js @2828693, @4846960`):
 * intercept unloaded MCP tool calls strictly for the 5 official `EWe` families
 * (`browser`, `computer_use`, `simulator`, `linked_computer`, `plugin`),
 * returning `TOOL_NOT_LOADED` guidance instead of blocking arbitrary user MCP
 * servers.
 */
export function checkMcpToolNotLoaded(
  tool: Tool,
  messages: Message[],
  tools: readonly { name: string }[],
): { enforced: true; family: NotLoadedMcpToolFamily; message: string } | null {
  const family = classifyNotLoadedMcpToolFamily(tool, messages)
  if (family === undefined) return null
  if (!isSearchExtraToolsEnabledOptimistic()) return null
  if (!isSearchExtraToolsToolAvailable(tools)) return null
  if (!isDeferredTool(tool)) return null
  const discovered = extractDiscoveredToolNames(messages)
  if (discovered.has(tool.name)) return null

  let schemaHint = ''
  if (tool.inputJSONSchema !== undefined) {
    try {
      const serialized = jsonStringify(tool.inputJSONSchema)
      if (serialized.length <= MAX_NOT_LOADED_SCHEMA_CHARS) {
        schemaHint = `\n\nThe input schema is: ${serialized}`
      }
    } catch {
      // ignore unserializable schema
    }
  }
  return {
    enforced: true,
    family,
    message: `Tool "${tool.name}" has not been loaded yet. Call ${SEARCH_EXTRA_TOOLS_TOOL_NAME} with query "select:${tool.name}" to load the tool, then call it again.${schemaHint}`,
  }
}

const GIT_COMMIT_COMMAND_RE =
  /\bgit(?:\s+-[cC]\s+\S+|\s+--[^\s=]+=\S+)*\s+commit\b/
const GIT_DASH_C_RE = /\bgit\s+(?:-\S+\s+)*-C\s+("([^"]+)"|'([^']+)'|(\S+))/

/** Official `hZi` (2.1.296 #529) — matches `git commit` and `git -C <dir> commit`. */
export function isGitCommitCommand(command: string): boolean {
  return GIT_COMMIT_COMMAND_RE.test(command)
}

/** Resolve target git working directory when `-C <dir>` is passed. */
export function resolveGitCommitCwd(
  command: string,
  baseCwd: string | null,
): string | null {
  const m = command.match(GIT_DASH_C_RE)
  const dir = m?.[2] ?? m?.[3] ?? m?.[4]
  if (!dir) return baseCwd
  return baseCwd ? resolvePath(baseCwd, dir) : dir
}

/**
 * Official `gZi` + `WEn` (2.1.296 #529) — parse `git_commit_id` from stdout,
 * falling back to `getHeadForDir(targetCwd)` when `git commit -q` emits no stdout,
 * and expanding short SHAs to full HEAD SHA when they prefix-match.
 */
export async function resolveGitCommitIdForTelemetry(
  command: string,
  stdout: string,
  baseCwd: string | null,
  isBackgroundOrInterrupted = false,
  getHeadFn: (cwd: string) => Promise<string | null> = getHeadForDir,
): Promise<string | undefined> {
  const targetCwd = resolveGitCommitCwd(command, baseCwd)
  const parsedSha = parseGitCommitId(stdout)
  if (!parsedSha) {
    if (isBackgroundOrInterrupted || !targetCwd) return undefined
    const head = await getHeadFn(targetCwd).catch(() => null)
    return head ?? undefined
  }
  if (!targetCwd) return parsedSha
  const head = await getHeadFn(targetCwd).catch(() => null)
  return head?.startsWith(parsedSha) ? head : parsedSha
}

function boundedEditDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const val = Math.min(
        (prev[j] ?? maxDist + 1) + 1,
        (curr[j - 1] ?? maxDist + 1) + 1,
        (prev[j - 1] ?? maxDist + 1) + cost,
      )
      curr[j] = val
      if (val < rowMin) rowMin = val
    }
    if (rowMin > maxDist) return maxDist + 1
    prev = curr
  }
  return prev[b.length] ?? maxDist + 1
}

const UUID_LIKE_CONNECTOR_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseMcpServerAndTool(
  name: string,
): { serverName: string; toolName: string } | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  return { serverName: rest.slice(0, sep), toolName: rest.slice(sep + 2) }
}

function inputFitsSchemaProperties(
  tool: {
    inputJSONSchema?: {
      properties?: Record<string, unknown>
      required?: string[]
    }
  },
  input: unknown,
): boolean {
  const props = tool.inputJSONSchema?.properties
  if (props === undefined) return true
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return false
  }
  const keys = Object.keys(input as Record<string, unknown>)
  return keys.every(k => Object.hasOwn(props, k))
}

/**
 * 2.1.323 #2153 (official `Ijs` tail): when an MCP tool call's connector ID is
 * mistyped by 1–2 characters for a host-registered (`sdk`) MCP server, return
 * a suggestion naming the exact tool to call.
 */
export function suggestMistypedHostConnectorTool(
  requestedName: string,
  tools: readonly Tool[],
  mcpClients: ReadonlyArray<{ name: string; config?: { type?: string } }>,
  input?: unknown,
): string {
  const parsedReq = parseMcpServerAndTool(requestedName)
  if (!parsedReq || !parsedReq.toolName) return ''

  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (mcpClients.some(c => normalize(c.name) === parsedReq.serverName)) {
    return ''
  }

  const sdkServerNames = new Set(
    mcpClients
      .filter(c => c.config?.type === 'sdk')
      .map(c => normalize(c.name)),
  )

  const candidates = tools.filter(t => {
    const parsed = parseMcpServerAndTool(t.name)
    if (!parsed || parsed.toolName !== parsedReq.toolName) return false
    const isHostSdk =
      (t.mcpInfo as { source?: string } | undefined)?.source === 'sdk' ||
      sdkServerNames.has(parsed.serverName)
    if (!isHostSdk) return false
    if (!UUID_LIKE_CONNECTOR_RE.test(parsed.serverName)) return false
    return boundedEditDistance(parsedReq.serverName, parsed.serverName, 2) <= 2
  })

  if (candidates.length !== 1) return ''
  const [match] = candidates
  if (!match || !inputFitsSchemaProperties(match, input)) return ''
  return `. Did you mean ${match.name}? Call ${match.name} instead.`
}

/**
 * Official 2.1.328 (#493): attach `coerceInput().resultNote` (e.g. ignored
 * Artifact `prompt`/`limit`/`label` fields) to the mapped `tool_result` block
 * so Claude sees what was dropped without rejecting the call.
 */
export function appendCoerceResultNoteToToolResultBlock(
  block: ToolResultBlockParam,
  resultNote?: string,
): ToolResultBlockParam {
  if (!resultNote) return block
  const content = block.content
  if (typeof content === 'string') {
    return {
      ...block,
      content: content.length > 0 ? `${content}\n\n${resultNote}` : resultNote,
    }
  }
  if (Array.isArray(content)) {
    return {
      ...block,
      content: [...content, { type: 'text', text: resultNote }],
    }
  }
  return {
    ...block,
    content: resultNote,
  }
}
