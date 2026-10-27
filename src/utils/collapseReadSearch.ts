import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { isAbsolute, normalize, resolve, sep } from 'path'
import { wrapText } from '@anthropic/ink'
import { logEvent } from '../services/analytics/index.js'
import { getCwdState } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { findToolByName, type Tool, type Tools } from '../Tool.js'
import { getPlansDirectory } from './plans.js'
import { isPluginToolServerKeyMinted } from './plugins/pluginToolRegistry.js'
import { getScratchpadDir, isScratchpadFile } from './permissions/filesystem.js'
import { DENSABLE_EHL_CATALOG } from './model/densableEhlCatalog.219.js'
import { extractBashCommentLabel } from '@claude-code/builtin-tools/tools/BashTool/commentLabel.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { getReplPrimitiveTools } from '@claude-code/builtin-tools/tools/REPLTool/primitiveTools.js'
import {
  type BranchAction,
  type CommitKind,
  detectGitOperation,
  type PrAction,
} from '@claude-code/builtin-tools/tools/shared/gitOperationTracking.js'
import { SEARCH_EXTRA_TOOLS_TOOL_NAME } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { TASK_CREATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TodoWriteTool/constants.js'
import type {
  CollapsedReadSearchGroup,
  CollapsibleMessage,
  ContentItem,
  MessageContent,
  RenderableMessage,
  StopHookInfo,
  SystemStopHookSummaryMessage,
} from '../types/message.js'
import { isHumanLikeOrigin, NO_RESPONSE_REQUESTED } from './messages.js'
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'

/**
 * densable Qoi — TodoWrite + Task* absorbed into collapse groups without
 * contributing counts, so interleaved todo/task updates don't split
 * fullscreen "Ran N bash commands" rows (changelog #17).
 * popsOutOnError: error tool_results eject the absorb from the group.
 */
const QOI_SILENT_ABSORB_TOOLS: readonly string[] = [
  TODO_WRITE_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
]

type WorkshopEditMarker = {
  count: number
  added: number
  removed: number
  spent: boolean
}

/**
 * Safely get the first content item from a MessageContent value.
 * Returns undefined for string content or empty arrays.
 */
function getFirstContentItem(
  content: MessageContent | undefined,
): ContentItem | undefined {
  if (!content || typeof content === 'string') return undefined
  return content[0]
}

/**
 * Iterate over content items that are objects (not strings).
 * Returns an empty array for string content.
 */
function getContentItems(content: MessageContent | undefined): ContentItem[] {
  if (!content || typeof content === 'string') return []
  return content
}
import { getDisplayPath } from './file.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import {
  isAutoManagedMemoryFile,
  isAutoManagedMemoryPattern,
  isMemoryDirectory,
  isShellCommandTargetingMemory,
} from './memoryFileDetection.js'
import {
  extractSafeToolInputFields,
  getSafeToolFilePath,
} from './safeToolInput.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemOps = feature('TEAMMEM')
  ? (require('./teamMemoryOps.js') as typeof import('./teamMemoryOps.js'))
  : null
const SNIP_TOOL_NAME = feature('HISTORY_SNIP')
  ? (
      require('@claude-code/builtin-tools/tools/SnipTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/SnipTool/prompt.js')
    ).SNIP_TOOL_NAME
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Result of checking if a tool use is a search or read operation.
 */
export type SearchOrReadResult = {
  isCollapsible: boolean
  isSearch: boolean
  isRead: boolean
  isList: boolean
  isREPL: boolean
  /** True if this is a Write/Edit targeting a memory file */
  isMemoryWrite: boolean
  /** densable `rwr` — Write/Edit under the session scratchpad display path. */
  isScratchpadWrite?: boolean
  /** densable `swr` — absolute Write/Edit of a workshop file outside plans. */
  isWorkshopWrite?: boolean
  /** densable `Pe.accountMemory` — read paths or search count. */
  accountMemory?: 'read' | 'search'
  /**
   * True for meta-operations that should be absorbed into a collapse group
   * without incrementing any count (Snip, SearchExtraTools, densable Qoi
   * TodoWrite/Task*). They remain visible in verbose mode via the
   * groupMessages iteration.
   */
  isAbsorbedSilently: boolean
  /**
   * densable popsOutOnError — Qoi tools register a zero-count workshop marker
   * so an error tool_result can eject the absorb from the group (edv).
   */
  popsOutOnError?: boolean
  /** MCP server name when this is an MCP tool */
  mcpServerName?: string
  /** Bash command that is NOT a search/read (under fullscreen mode) */
  isBash?: boolean
}

/**
 * Extract the primary file/directory path from a tool_use input.
 * Handles both `file_path` (Read/Write/Edit) and `path` (Grep/Glob).
 * densable 2.1.229 #7: route through nst/CIr so non-string resume values don't crash.
 */
function getFilePathFromToolInput(toolInput: unknown): string | undefined {
  return getSafeToolFilePath(extractSafeToolInputFields(toolInput))
}

/**
 * Check if a search tool use targets memory files by examining its path, pattern, and glob.
 * densable yab(e) after nst(t) — only string path/glob/command are considered.
 */
function isMemorySearch(toolInput: unknown): boolean {
  // densable: nst before path/glob/command string ops
  const input = extractSafeToolInputFields(toolInput)
  // Check if the search path targets a memory file or directory (Grep/Glob tools)
  if (input.path) {
    if (isAutoManagedMemoryFile(input.path) || isMemoryDirectory(input.path)) {
      return true
    }
  }
  // Check glob patterns that indicate memory file access
  if (input.glob && isAutoManagedMemoryPattern(input.glob)) {
    return true
  }
  // For shell commands (bash grep/rg, PowerShell Select-String, etc.),
  // check if the command targets memory paths
  if (input.command && isShellCommandTargetingMemory(input.command)) {
    return true
  }
  return false
}

/**
 * Check if a Write or Edit tool use targets a memory file and should be collapsed.
 */
function isMemoryWriteOrEdit(toolName: string, toolInput: unknown): boolean {
  if (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) {
    return false
  }
  const filePath = getFilePathFromToolInput(toolInput)
  return filePath !== undefined && isAutoManagedMemoryFile(filePath)
}

/** densable `yXr` — path segments that keep a write out of the collapse group. */
const LEFTOVER_PATH_DENY_SEGMENTS = new Set([
  '.git',
  'hooks',
  '.husky',
  '.githooks',
  'node_modules',
  '.vscode',
  '.idea',
  'head',
  'config',
  'objects',
  'refs',
  '.claude',
  'skills',
  'commands',
  'agents',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
])

/** densable `OU` — last-segment filenames (`zWt` lowercased). */
const LEFTOVER_PATH_DENY_FILES = new Set([
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.zshenv',
  '.zlogin',
  '.zlogout',
  '.bash_login',
  '.bash_aliases',
  '.bash_logout',
  '.envrc',
  '.ripgreprc',
  '.mcp.json',
  '.claude.json',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pnp.cjs',
  '.pnp.loader.mjs',
  '.pnpmfile.cjs',
  'bunfig.toml',
  '.bunfig.toml',
  '.bazelrc',
  '.bazelversion',
  '.bazeliskrc',
  '.pre-commit-config.yaml',
  'lefthook.yml',
  '.lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yaml',
  'gradle-wrapper.properties',
  'maven-wrapper.properties',
  '.devcontainer.json',
  'pyrightconfig.json',
])

const LEFTOVER_BIDI = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g

/** densable `Nc` — lowercase, strip bidi, drop `:suffix`, strip trailing dots. */
function leftoverNormalizeSegment(segment: string): string {
  const lower = segment
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u017f/g, 's')
  const stripped = lower.replace(LEFTOVER_BIDI, '')
  return stripped.replace(/:.*$/, '').replace(/[. ]+$/, '') || lower
}

/** densable `t4` — a denied segment after `prefix`, or a denied final filename. */
function leftoverDeniedPath(filePath: string, prefix: string): boolean {
  const rest = filePath.slice(prefix.length).split(sep)
  const last = rest.length - 1
  for (let i = 0; i < rest.length; i++) {
    const segment = leftoverNormalizeSegment(rest[i] ?? '')
    if (LEFTOVER_PATH_DENY_SEGMENTS.has(segment)) return true
    if (i === last && LEFTOVER_PATH_DENY_FILES.has(segment)) return true
  }
  return false
}

/** densable `Dwn` — `.workshop.html` or `.workshop.md`. */
function leftoverWorkshopSuffix(filePath: string): boolean {
  return (
    filePath.endsWith('.workshop.html') || filePath.endsWith('.workshop.md')
  )
}

/** densable `kyt` / `isWorkshopDisplayPath`. */
function leftoverWorkshopDisplayPath(filePath: string): boolean {
  if (!leftoverWorkshopSuffix(filePath)) return false
  const resolved = isAbsolute(filePath)
    ? normalize(filePath)
    : normalize(resolve(getCwdState(), filePath))
  return !leftoverDeniedPath(resolved, '')
}

/** densable `swr` — absolute Write/Edit, not under plans, workshop display path. */
function leftoverWorkshopWrite(toolName: string, toolInput: unknown): boolean {
  if (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) {
    return false
  }
  const filePath = getFilePathFromToolInput(toolInput)
  if (filePath === undefined || !isAbsolute(filePath)) return false
  const plans = normalize(getPlansDirectory())
  const plansPrefix = plans.endsWith(sep) ? plans : plans + sep
  if (normalize(filePath).startsWith(plansPrefix)) return false
  return leftoverWorkshopDisplayPath(filePath)
}

/** densable `Ayt` / `isScratchpadDisplayPath`. */
function leftoverScratchpadDisplayPath(filePath: string): boolean {
  const absolute = isAbsolute(filePath)
    ? filePath
    : resolve(getCwdState(), filePath)
  if (!isScratchpadFile(absolute)) return false
  const prefix = normalize(getScratchpadDir()) + sep
  return !leftoverDeniedPath(normalize(absolute), prefix)
}

/** densable `rwr`. */
function leftoverScratchpadWrite(
  toolName: string,
  toolInput: unknown,
): boolean {
  if (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) {
    return false
  }
  const filePath = getFilePathFromToolInput(toolInput)
  return filePath !== undefined && leftoverScratchpadDisplayPath(filePath)
}

/**
 * densable `Yf` next to `a9e` — `k("tengu_violin_wood", false)`.
 * The fuller `es()` pegbox check is a different call site.
 */
function leftoverViolinWood(): boolean {
  try {
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_violin_wood', false)
  } catch {
    return false
  }
}

/**
 * densable `a9e` — remote-capable tool plus a non-empty `_host` and the
 * violin-wood gate means this call is not collapsible.
 */
function leftoverA9eBlocks(tool: Tool, toolInput: unknown): boolean {
  if (!leftoverViolinWood()) return false
  if (tool.remoteExecution?.supported !== true) return false
  if (toolInput === null || typeof toolInput !== 'object') return false
  if (!('_host' in toolInput)) return false
  const host = (toolInput as { _host?: unknown })._host
  return typeof host === 'string' && host.trim() !== ''
}

// ~5 lines × ~60 cols. Generous static cap — the renderer lets Ink wrap.
const MAX_HINT_CHARS = 300

/**
 * Format a bash command for the ⎿ hint. Drops blank lines, collapses runs of
 * inline whitespace, then caps total length. Newlines are preserved so the
 * renderer can indent continuation lines under ⎿.
 */
function commandAsHint(command: string): string {
  const cleaned =
    '$ ' +
    command
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(l => l !== '')
      .join('\n')
  return cleaned.length > MAX_HINT_CHARS
    ? cleaned.slice(0, MAX_HINT_CHARS - 1) + '…'
    : cleaned
}

/**
 * Checks if a tool is a search/read operation using the tool's isSearchOrReadCommand method.
 * Also treats Write/Edit of memory files as collapsible.
 * Returns detailed information about whether it's a search or read operation.
 */
export function getSearchExtraToolsOrReadInfo(
  toolName: string,
  toolInput: unknown,
  tools: Tools,
): SearchOrReadResult {
  // densable 2.1.289 ULt: tool name `uc` is always absorbed.
  if (toolName === REPL_TOOL_NAME) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: true,
      isMemoryWrite: false,
      isAbsorbedSilently: true,
    }
  }

  // Memory file writes/edits are collapsible. densable `owr` then `swr` then `rwr`.
  if (isMemoryWriteOrEdit(toolName, toolInput)) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: true,
      isAbsorbedSilently: false,
    }
  }
  if (leftoverWorkshopWrite(toolName, toolInput)) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isWorkshopWrite: true,
      isAbsorbedSilently: false,
    }
  }
  if (leftoverScratchpadWrite(toolName, toolInput)) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isScratchpadWrite: true,
      isAbsorbedSilently: false,
    }
  }

  // densable Yrr: Qoi (TodoWrite/Task*) always absorbed silently with
  // popsOutOnError; SearchExtraTools absorbed under fullscreen (Ns&&e===s0).
  // Snip stays absorbed when HISTORY_SNIP is on (local residual).
  const popsOutOnError = QOI_SILENT_ABSORB_TOOLS.includes(toolName)
  if (
    popsOutOnError ||
    (feature('HISTORY_SNIP') && toolName === SNIP_TOOL_NAME) ||
    (isFullscreenEnvEnabled() && toolName === SEARCH_EXTRA_TOOLS_TOOL_NAME)
  ) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isAbsorbedSilently: true,
      popsOutOnError,
    }
  }

  // Fallback to REPL primitives: in REPL mode, Bash/Read/Grep/etc. are
  // stripped from the execution tools list, but REPL emits them as virtual
  // messages. Without the fallback they'd return isCollapsible: false and
  // vanish from the summary line.
  const tool =
    findToolByName(tools, toolName) ??
    findToolByName(getReplPrimitiveTools(), toolName)
  // densable ULt: non-minted MCP is collapsible before the search/read check.
  const minted =
    tool?.mcpInfo !== undefined &&
    isPluginToolServerKeyMinted(tool.mcpInfo.serverName)
  if (tool?.isMcp && !minted) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isAbsorbedSilently: false,
      mcpServerName: tool.mcpInfo?.serverName,
    }
  }
  if (!tool?.isSearchOrReadCommand) {
    return {
      isCollapsible: false,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isAbsorbedSilently: false,
    }
  }
  if (leftoverA9eBlocks(tool, toolInput)) {
    return {
      isCollapsible: false,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isAbsorbedSilently: false,
    }
  }
  // The tool's isSearchOrReadCommand method handles its own input validation via safeParse,
  // so passing the raw input is safe. The type assertion is necessary because Tool[] uses
  // the default generic which expects { [x: string]: any }, but we receive unknown at runtime.
  const result = tool.isSearchOrReadCommand(
    toolInput as { [x: string]: unknown },
  )
  const isList = result.isList ?? false
  const isCollapsible = result.isSearch || result.isRead || isList
  // Under fullscreen mode, non-search/read Bash commands are also collapsible
  // as their own category — "Ran N bash commands" instead of breaking the group.
  return {
    isCollapsible:
      isCollapsible ||
      (isFullscreenEnvEnabled() ? toolName === BASH_TOOL_NAME : false),
    isSearch: result.isSearch,
    isRead: result.isRead,
    isList,
    isREPL: false,
    isMemoryWrite: false,
    isAbsorbedSilently: false,
    ...(tool.isMcp && { mcpServerName: tool.mcpInfo?.serverName }),
    isBash: isFullscreenEnvEnabled()
      ? !isCollapsible && toolName === BASH_TOOL_NAME
      : undefined,
  }
}

export function getToolSearchOrReadInfo(
  toolName: string,
  toolInput: unknown,
  tools: Tools,
): SearchOrReadResult {
  return getSearchExtraToolsOrReadInfo(toolName, toolInput, tools)
}

/**
 * Check if a tool_use content block is a search/read operation.
 * Returns { isSearch, isRead, isREPL } if it's a collapsible search/read, null otherwise.
 */
export function getSearchOrReadFromContent(
  content: { type: string; name?: string; input?: unknown } | undefined,
  tools: Tools,
): {
  isSearch: boolean
  isRead: boolean
  isList: boolean
  isREPL: boolean
  isMemoryWrite: boolean
  isWorkshopWrite?: boolean
  isScratchpadWrite?: boolean
  accountMemory?: 'read' | 'search'
  isAbsorbedSilently: boolean
  popsOutOnError?: boolean
  mcpServerName?: string
  isBash?: boolean
} | null {
  if (content?.type === 'tool_use' && content.name) {
    const info = getSearchExtraToolsOrReadInfo(
      content.name,
      content.input,
      tools,
    )
    if (info.isCollapsible || info.isREPL) {
      return {
        isSearch: info.isSearch,
        isRead: info.isRead,
        isList: info.isList,
        isREPL: info.isREPL,
        isMemoryWrite: info.isMemoryWrite,
        isWorkshopWrite: info.isWorkshopWrite,
        isScratchpadWrite: info.isScratchpadWrite,
        accountMemory: info.accountMemory,
        isAbsorbedSilently: info.isAbsorbedSilently,
        popsOutOnError: info.popsOutOnError,
        mcpServerName: info.mcpServerName,
        isBash: info.isBash,
      }
    }
  }
  return null
}

/**
 * Checks if a tool is a search/read operation (for backwards compatibility).
 */
function isSearchExtraToolsOrRead(
  toolName: string,
  toolInput: unknown,
  tools: Tools,
): boolean {
  return getSearchExtraToolsOrReadInfo(toolName, toolInput, tools).isCollapsible
}

/**
 * Get the tool name, input, and search/read info from a message if it's a collapsible tool use.
 * Returns null if the message is not a collapsible tool use.
 */
function getCollapsibleToolInfo(
  msg: RenderableMessage,
  tools: Tools,
): {
  name: string
  input: unknown
  isSearch: boolean
  isRead: boolean
  isList: boolean
  isREPL: boolean
  isMemoryWrite: boolean
  isWorkshopWrite?: boolean
  isScratchpadWrite?: boolean
  accountMemory?: 'read' | 'search'
  isAbsorbedSilently: boolean
  popsOutOnError?: boolean
  mcpServerName?: string
  isBash?: boolean
} | null {
  if (msg.type === 'assistant') {
    const content = getFirstContentItem(msg.message?.content)
    if (!content) return null
    const info = getSearchOrReadFromContent(
      content as { type: string; name?: string; input?: unknown },
      tools,
    )
    if (info && content.type === 'tool_use') {
      const toolUse = content as {
        type: 'tool_use'
        name: string
        input: unknown
      }
      return { name: toolUse.name, input: toolUse.input, ...info }
    }
  }
  if (msg.type === 'grouped_tool_use') {
    // For grouped tool uses, check the first message's input
    const firstContent = getFirstContentItem(msg.messages[0]?.message?.content)
    const firstToolUse = firstContent as
      | { type: string; input?: unknown }
      | undefined
    const info = getSearchOrReadFromContent(
      firstToolUse
        ? { type: 'tool_use', name: msg.toolName, input: firstToolUse.input }
        : undefined,
      tools,
    )
    if (info && firstContent && firstContent.type === 'tool_use') {
      return { name: msg.toolName, input: firstToolUse?.input, ...info }
    }
  }
  return null
}

function isPreToolHookSummary(
  msg: RenderableMessage,
): msg is SystemStopHookSummaryMessage {
  return (
    msg.type === 'system' &&
    msg.subtype === 'stop_hook_summary' &&
    msg.hookLabel === 'PreToolUse'
  )
}

/** densable `U1t` / `gMr`. */
const LEFTOVER_NARRATION_KIND = 'narration'
const LEFTOVER_PB_FIELD_OUTER = 2
const LEFTOVER_PB_FIELD_MID = 1
const LEFTOVER_PB_FIELD_KIND = 8
const leftoverSignatureUtf8 = new TextDecoder('utf-8', { ignoreBOM: true })
const leftoverJleCache = new WeakMap<object, string | undefined>()

function leftoverProtobufVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | undefined {
  let value = 0
  let scale = 1
  for (let i = 0; i < 10; i++) {
    const at = offset + i
    if (at >= bytes.length) return
    const b = bytes[at]!
    value += (b & 127) * scale
    if ((b & 128) === 0) return { value, next: at + 1 }
    scale *= 128
  }
}

function leftoverProtobufBytes(
  bytes: Uint8Array,
  field: number,
): Uint8Array | undefined {
  let offset = 0
  while (offset < bytes.length) {
    const tag = leftoverProtobufVarint(bytes, offset)
    if (tag === undefined) return
    const wire = tag.value & 7
    const number = Math.floor(tag.value / 8)
    offset = tag.next
    switch (wire) {
      case 0: {
        const skip = leftoverProtobufVarint(bytes, offset)
        if (skip === undefined) return
        offset = skip.next
        break
      }
      case 1:
        if (offset + 8 > bytes.length) return
        offset += 8
        break
      case 2: {
        const len = leftoverProtobufVarint(bytes, offset)
        if (len === undefined || len.value > bytes.length - len.next) return
        offset = len.next
        const end = offset + len.value
        const payload = bytes.subarray(offset, end)
        offset = end
        if (number === field) return payload
        break
      }
      case 5:
        if (offset + 4 > bytes.length) return
        offset += 4
        break
      default:
        return
    }
  }
}

function leftoverClassifyThinkingSignature(
  signature: string,
): string | undefined {
  let decoded: string
  try {
    decoded = atob(signature)
  } catch {
    return
  }
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  const outer = leftoverProtobufBytes(bytes, LEFTOVER_PB_FIELD_OUTER)
  if (outer === undefined) return
  const mid = leftoverProtobufBytes(outer, LEFTOVER_PB_FIELD_MID)
  if (mid === undefined) return
  const kind = leftoverProtobufBytes(mid, LEFTOVER_PB_FIELD_KIND)
  if (kind === undefined) return
  return leftoverSignatureUtf8.decode(kind)
}

/**
 * densable `jle` — thinking signature classifies as narration.
 * Gold `H1t` / `sjo=2` `ijo=1` `ajo=8` `U1t="narration"`.
 */
export function leftoverJle(block: object): boolean {
  try {
    const typed = block as { type?: unknown; signature?: unknown }
    if (typed.type !== 'thinking' || typeof typed.signature !== 'string') {
      return false
    }
    let kind: string | undefined
    if (leftoverJleCache.has(block)) kind = leftoverJleCache.get(block)
    else {
      kind = leftoverClassifyThinkingSignature(typed.signature)
      leftoverJleCache.set(block, kind)
    }
    return kind === LEFTOVER_NARRATION_KIND
  } catch {
    return false
  }
}

/** densable `Tut` — non-blank thinking + leftoverJle. */
export function leftoverTut(block: {
  thinking?: string
  type?: string
  signature?: string
}): boolean {
  return !!block.thinking?.trim() && leftoverJle(block)
}

/** densable `xut` / `jLt` — assistant content[0] is leftoverTut. */
export function leftoverXut(msg: RenderableMessage): boolean {
  if (msg.type !== 'assistant') return false
  const n = getFirstContentItem(msg.message?.content)
  if (
    n?.type !== 'thinking' ||
    typeof (n as { thinking?: unknown }).thinking !== 'string' ||
    typeof (n as { signature?: unknown }).signature !== 'string'
  ) {
    return false
  }
  return leftoverTut(n as { thinking: string; type: string; signature: string })
}

/**
 * densable `Spn` — only non-blank thinking becomes `$e`.
 * Gold: `n?.type!=="thinking"||!n.thinking` then `s.blank` (`trim()===""`) return.
 * Empty / whitespace thinking is leftoverDve skippable, not Thought-for.
 */
type LeftoverSpnMemo = {
  thinking: string
  blank: boolean
  summary: string | undefined
}

const leftoverSpnMemo = new WeakMap<object, LeftoverSpnMemo>()

function leftoverSpn(
  msg: RenderableMessage,
): { message: RenderableMessage; memo: LeftoverSpnMemo } | undefined {
  if (msg.type !== 'assistant') return
  const n = getFirstContentItem(msg.message?.content)
  if (n?.type !== 'thinking') return
  const thinking =
    typeof (n as { thinking?: unknown }).thinking === 'string'
      ? (n as { thinking: string }).thinking
      : ''
  if (!thinking) return
  let s = leftoverSpnMemo.get(msg)
  if (s === undefined || s.thinking !== thinking) {
    s = { thinking, blank: thinking.trim() === '', summary: undefined }
    leftoverSpnMemo.set(msg, s)
  }
  if (s.blank) return
  return { message: msg, memo: s }
}

/**
 * densable `DVe` — skippable thinking/redacted that is not leftoverXut.
 * Gold: `thinking||redacted_thinking` then `!xut(e)`.
 */
function leftoverDve(msg: RenderableMessage): boolean {
  if (msg.type !== 'assistant') return false
  const n = getFirstContentItem(msg.message?.content)
  if (n?.type === 'thinking' || n?.type === 'redacted_thinking') {
    return !leftoverXut(msg)
  }
  return false
}

/** densable jVn — cap absorbed thinking delta at 10 minutes. */
export const THOUGHT_FOR_MS_CAP = 600_000

/** densable Io `Mb` — `pc` hold-then-clear after `$s` drops the summary. */
export const LEFTOVER_SS_HOLD_MS = 3000

/** densable `tn` — `Bun.stripANSI`. */
export function leftoverTn(s: string): string {
  return Bun.stripANSI(s)
}

/**
 * densable `Tr` — `t.replace(qee,"").replace(/\s+/g," ").trim()`.
 * Gold absorb: `memo.summary??=Tr(tn(memo.thinking))`.
 */
export function leftoverTr(s: string): string {
  let out = leftoverTn(s)
  let cleaned = ''
  for (const ch of out) {
    const code = ch.charCodeAt(0)
    if (
      code <= 8 ||
      (code >= 14 && code <= 31) ||
      (code >= 127 && code <= 159)
    ) {
      continue
    }
    cleaned += ch
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

/**
 * densable `Jg` — strip cc-memory tags. Gold hx first step is `h=Jg(m)`, not Tr.
 * Gold `Zs` / `Js` / `Qs` / `Rn`.
 */
const LEFTOVER_CC_MEMORY_NAMES = [
  'cc-memory',
  'cc_memory',
  'ccmemory',
  'CC-MEMORY',
  'CC_MEMORY',
  'CCMEMORY',
]
const LEFTOVER_JG_TAG = new RegExp(
  `</?(?:${LEFTOVER_CC_MEMORY_NAMES.join('|')})(?=[\\s/>])[^>]{0,1024}>`,
  'g',
)

export function leftoverJg(s: string): string {
  return s.replace(LEFTOVER_JG_TAG, '')
}

/** densable Io `yb=5` `bb=10` — hx wrap cap. */
export const LEFTOVER_HX_GUTTER = 5
export const LEFTOVER_HX_MAX_LINES = 10

/**
 * densable Io `hx(m,l,p)` — first `h=Jg(m)`, then `cm(h,l,"wrap")`.
 * Grapheme peel is gold `codePointAt(y.length-2)>65535?-2:-1`.
 */
export function leftoverHx(
  text: string,
  width: number,
  maxLines: number,
): string {
  const h = leftoverJg(text)
  if (width < 1) return h
  const lines = wrapText(h, width, 'wrap').split('\n')
  if (lines.length <= maxLines) return h
  let y = lines.slice(0, maxLines).join('').replace(/\s+/g, ' ').trim()
  while (y.length > 0) {
    const probeLines = wrapText(`${y}…`, width, 'wrap').split('\n').length
    if (probeLines <= maxLines) break
    const cp = y.length > 1 ? y.codePointAt(y.length - 2) : undefined
    y = y.slice(0, cp !== undefined && cp > 65535 ? -2 : -1)
  }
  return `${y.trimEnd()}…`
}

/**
 * densable `Ihr` `y` slice. Gold freeze:
 * mode responding, override/colors/compact/retry null, thinkingStartedAt null.
 */
export type LeftoverIhrSlice = {
  /** Empty until setMode. The freeze default 'responding' must not paint. */
  mode: string
  overrideMessage: string | null
  overrideColor: string | null
  overrideShimmerColor: string | null
  isCompacting: boolean
  compactingHintText: string | null
  compactingStartTime: number | null
  turnEffort: unknown
  turnModel: unknown
  retryStatus: unknown
  thinkingStartedAt: number | null
  outputLimitRecovery: unknown
  defaultVerb: string
}

/** densable `hN(DTt())` — random spinner verb. */
function leftoverIhrPickVerb(): string {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getSpinnerVerbs } =
      require('../constants/spinnerVerbs.js') as typeof import('../constants/spinnerVerbs.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    const verbs = getSpinnerVerbs()
    if (verbs.length === 0) return ''
    return verbs[Math.floor(Math.random() * verbs.length)] ?? ''
  } catch {
    return ''
  }
}

/** densable `y` freeze — `hN(DTt())` at module init, not `''`. */
const leftoverIhrDefault: LeftoverIhrSlice = Object.freeze({
  mode: 'responding',
  overrideMessage: null,
  overrideColor: null,
  overrideShimmerColor: null,
  isCompacting: false,
  compactingHintText: null,
  compactingStartTime: null,
  turnEffort: null,
  turnModel: null,
  retryStatus: null,
  thinkingStartedAt: null,
  outputLimitRecovery: null,
  defaultVerb: leftoverIhrPickVerb(),
})

/** densable `Ihr` `n=Ds({})` — subscribeable session map, not a silent Map. */
let leftoverIhrState: Record<string, LeftoverIhrSlice> = {}
const leftoverIhrListeners = new Set<() => void>()

function leftoverIhrNotify(): void {
  for (const listener of leftoverIhrListeners) listener()
}

export function leftoverIhrSubscribe(listener: () => void): () => void {
  leftoverIhrListeners.add(listener)
  return () => {
    leftoverIhrListeners.delete(listener)
  }
}

export function leftoverIhrGetSnapshot(): Record<string, LeftoverIhrSlice> {
  return leftoverIhrState
}

function leftoverIhrFreshSlice(): LeftoverIhrSlice {
  return {
    ...leftoverIhrDefault,
    mode: '',
    defaultVerb: leftoverIhrPickVerb(),
  }
}

function leftoverIhrPatch(
  sessionId: string,
  update: (prev: LeftoverIhrSlice) => LeftoverIhrSlice,
  materialize = true,
): void {
  const has = Object.hasOwn(leftoverIhrState, sessionId)
  if (!has && !materialize) return
  const prev = leftoverIhrState[sessionId] ?? leftoverIhrFreshSlice()
  const next = update(prev)
  if (next === prev && has) return
  leftoverIhrState = { ...leftoverIhrState, [sessionId]: next }
  leftoverIhrNotify()
}

/** densable `Phn` / `$xe` / `Uxe` — teammate spinner bus. */
export type LeftoverXeEvent = LeftoverIhrEvent

const leftoverXeListeners = new Set<(event: LeftoverXeEvent) => void>()
let leftoverXeStarted = false

export function leftoverIhrXeSubscribe(
  listener: (event: LeftoverXeEvent) => void,
): () => void {
  leftoverXeListeners.add(listener)
  return () => {
    leftoverXeListeners.delete(listener)
  }
}

export function leftoverIhrXeEmit(event: LeftoverXeEvent): void {
  leftoverIhrStartXe()
  for (const listener of leftoverXeListeners) listener(event)
}

/** densable `$xe.subscribe(this._spinnerStore.applyEvent)`. */
export function leftoverIhrStartXe(): void {
  if (leftoverXeStarted) return
  leftoverXeStarted = true
  leftoverIhrXeSubscribe(event => {
    let main = 'main'
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { getSessionId } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      main = getSessionId()
    } catch {
      // isolation — tests
    }
    leftoverIhrApplyEvent(event, main)
  })
}

export function leftoverIhrPhn(agentId: string): {
  setMode: (mode: string, outputLimitRecovery?: unknown) => void
  setRetryStatus: (status: unknown) => void
  setTurnEffort: (effort: unknown, model?: unknown) => void
} {
  leftoverIhrStartXe()
  return {
    setMode(mode, outputLimitRecovery) {
      leftoverIhrXeEmit({
        kind: 'agent-mode',
        agentId,
        mode,
        outputLimitRecovery,
      })
    },
    setRetryStatus(status) {
      leftoverIhrXeEmit({
        kind: 'agent-retry-status',
        agentId,
        retryStatus: status,
      })
    },
    setTurnEffort(effort, model = null) {
      leftoverIhrXeEmit({
        kind: 'agent-turn-effort',
        agentId,
        turnEffort: effort,
        turnModel: model,
      })
    },
  }
}

/**
 * Stamp turn effort without materializing a spinner slice.
 * setTurnEffort creates the slice at default mode 'responding'. A viewed
 * agent then ignores live props.mode until a later setMode. Write the
 * effort fields only when the slice already exists.
 */
export function leftoverIhrStampTurnEffort(
  agentId: string | undefined,
  effort: unknown,
  model: unknown,
): void {
  if (agentId === undefined) return
  if (!Object.hasOwn(leftoverIhrState, agentId)) return
  leftoverIhrPhn(agentId).setTurnEffort(effort, model)
}

/** densable `Uxe`. */
export const leftoverIhrUxe = {
  setSpinnerMessage(message: string | null): void {
    leftoverIhrXeEmit({ kind: 'main-message', message })
  },
  setSpinnerColors(color: string | null, shimmerColor: string | null): void {
    leftoverIhrXeEmit({ kind: 'main-colors', color, shimmerColor })
  },
}

const LEFTOVER_IHR_RETRY_KINDS: Record<string, boolean> = {
  retrying: true,
  stalled: false,
  auto_mode_unavailable: false,
  low_priority_waiting: false,
}

const LEFTOVER_IHR_RETRY_ERROR_STUB = {
  message: 'API error',
  status: undefined as number | undefined,
  requestId: undefined as string | undefined,
  formatted: 'API error',
  connection: null,
  isNetworkDown: false,
  rateLimits: null,
  noResponse: null,
}

export class LeftoverMalformedRetryStatusError extends Error {
  override name = 'MalformedRetryStatusError'
}

const leftoverIhrMalformedSeen = new Set<string>()
let leftoverIhrOnMalformed: (kind: string) => void = kind => {
  throw new LeftoverMalformedRetryStatusError(
    `Spinner ignored an API retry status it could not draw (session unaffected): ${kind}`,
  )
}

export function leftoverIhrSetOnMalformed(
  handler: ((kind: string) => void) | null,
): void {
  leftoverIhrOnMalformed =
    handler ??
    (kind => {
      throw new LeftoverMalformedRetryStatusError(
        `Spinner ignored an API retry status it could not draw (session unaffected): ${kind}`,
      )
    })
}

/** densable `Y` then `w` — sanitize retry status. */
export function leftoverIhrSanitizeRetry(status: unknown): {
  status: unknown
  malformed: string | null
} {
  try {
    const malformed = leftoverIhrRetryMalformedKind(status)
    if (
      malformed === null ||
      malformed === 'not_a_retry_status' ||
      status === null ||
      typeof status !== 'object' ||
      (status as { kind?: unknown }).kind !== 'retrying'
    ) {
      return {
        status: malformed === null ? status : null,
        malformed,
      }
    }
    const row = status as {
      attempt?: unknown
      maxRetries?: unknown
      deadline?: unknown
      error?: unknown
      kind: string
    }
    if (
      ![row.attempt, row.maxRetries, row.deadline].every(n =>
        Number.isFinite(n),
      )
    ) {
      return { status: null, malformed: 'counters_are_not_numbers' }
    }
    const err = row.error
    const httpStatus =
      typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status?: unknown }).status
        : undefined
    return {
      status: {
        ...row,
        error: {
          ...LEFTOVER_IHR_RETRY_ERROR_STUB,
          status:
            typeof httpStatus === 'number' && Number.isFinite(httpStatus)
              ? httpStatus
              : undefined,
        },
      },
      malformed,
    }
  } catch {
    return { status: null, malformed: 'unreadable' }
  }
}

function leftoverIhrRetryMalformedKind(status: unknown): string | null {
  if (status === null) return null
  const kind =
    typeof status === 'object' && status !== null && 'kind' in status
      ? (status as { kind?: unknown }).kind
      : undefined
  if (
    typeof kind !== 'string' ||
    !Object.hasOwn(LEFTOVER_IHR_RETRY_KINDS, kind)
  ) {
    return 'not_a_retry_status'
  }
  if (!LEFTOVER_IHR_RETRY_KINDS[kind]) return null
  const error =
    typeof status === 'object' && status !== null && 'error' in status
      ? (status as { error?: unknown }).error
      : undefined
  if (error === undefined || error === null) return 'error_is_nullish'
  if (typeof error === 'string') return 'error_is_a_string'
  if (typeof error !== 'object') return 'error_is_not_an_object'
  const formatted = 'formatted' in error ? error.formatted : undefined
  if (typeof formatted === 'string') {
    const rateLimits =
      'rateLimits' in error
        ? (error as { rateLimits?: unknown }).rateLimits
        : undefined
    const rateLimitType =
      (typeof rateLimits === 'object' || typeof rateLimits === 'function') &&
      rateLimits !== null &&
      'rateLimitType' in rateLimits
        ? (rateLimits as { rateLimitType?: unknown }).rateLimitType
        : undefined
    return rateLimitType === undefined ||
      rateLimitType === null ||
      typeof rateLimitType === 'string'
      ? null
      : 'rate_limit_type_is_not_a_string'
  }
  if (formatted !== undefined) return 'formatted_is_not_a_string'
  if (error instanceof Error) return 'error_is_an_error_instance'
  if (Object.keys(error).length === 0) return 'error_has_no_keys'
  if ('headers' in error || 'requestID' in error)
    return 'error_has_api_error_keys'
  if ('connection' in error || 'isNetworkDown' in error) {
    return 'error_has_snapshot_keys'
  }
  return 'error_is_another_object'
}

// Several AppStateProviders can be mounted at once (exportRenderer renders a
// throwaway tree while the REPL is live), so mounted-ness is a count.
let leftoverIhrStoreMounts = 0

/** densable `GMn` — Xae throws outside AppStateProvider. */
export function leftoverIhrRetainStore(): void {
  leftoverIhrStoreMounts++
}

export function leftoverIhrReleaseStore(): void {
  leftoverIhrStoreMounts = Math.max(0, leftoverIhrStoreMounts - 1)
}

/** Test hook: force the mounted state regardless of provider count. */
export function leftoverIhrMarkStoreMounted(on: boolean): void {
  leftoverIhrStoreMounts = on ? 1 : 0
}

export function leftoverIhrRequireStore(): void {
  if (leftoverIhrStoreMounts === 0) {
    throw new ReferenceError(
      'useSpinnerStore cannot be called outside of a SpinnerStoreContext provider (mounted by <AppStateProvider />)',
    )
  }
}

export type LeftoverIhrCompactProgress =
  | { type: 'hooks_start'; hookType?: string }
  | { type: 'compact_start'; hintText?: string | null }
  | { type: 'compact_end' }

/** densable `Ihr` `bind(a)` — per-session setters. */
export function leftoverIhrBind(sessionId: string): {
  setMode: (mode: string, outputLimitRecovery?: unknown) => void
  setMessage: (message: string | null) => void
  setColors: (color: string | null, shimmer: string | null) => void
  setTurnEffort: (effort: unknown, model?: unknown) => void
  setRetryStatus: (status: unknown) => void
  setCompacting: (on: boolean, hint?: string | null) => void
  resetOverrides: () => void
  applyCompactProgress: (event: LeftoverIhrCompactProgress) => void
} {
  return {
    setMode(mode, outputLimitRecovery = null) {
      leftoverIhrPatch(sessionId, prev => {
        if (
          prev.mode === mode &&
          prev.outputLimitRecovery === outputLimitRecovery
        ) {
          return prev
        }
        return {
          ...prev,
          mode,
          thinkingStartedAt: mode === 'thinking' ? Date.now() : null,
          outputLimitRecovery,
        }
      })
    },
    setMessage(message) {
      leftoverIhrPatch(sessionId, prev =>
        prev.overrideMessage === message
          ? prev
          : { ...prev, overrideMessage: message },
      )
    },
    setColors(color, shimmer) {
      leftoverIhrPatch(sessionId, prev =>
        prev.overrideColor === color && prev.overrideShimmerColor === shimmer
          ? prev
          : { ...prev, overrideColor: color, overrideShimmerColor: shimmer },
      )
    },
    setTurnEffort(effort, model = null) {
      leftoverIhrPatch(
        sessionId,
        prev =>
          prev.turnEffort === effort && prev.turnModel === model
            ? prev
            : { ...prev, turnEffort: effort, turnModel: model },
        effort !== null || model !== null,
      )
    },
    setRetryStatus(status) {
      const { status: next, malformed } = leftoverIhrSanitizeRetry(status)
      if (malformed !== null && !leftoverIhrMalformedSeen.has(malformed)) {
        leftoverIhrMalformedSeen.add(malformed)
        try {
          leftoverIhrOnMalformed(malformed)
        } catch {
          // gold: session unaffected
        }
      }
      leftoverIhrPatch(sessionId, prev =>
        prev.retryStatus === next ? prev : { ...prev, retryStatus: next },
      )
    },
    setCompacting(on, hint = null) {
      leftoverIhrPatch(sessionId, prev => {
        if (prev.isCompacting === on && prev.compactingHintText === hint) {
          return prev
        }
        return {
          ...prev,
          isCompacting: on,
          compactingHintText: hint,
          compactingStartTime: on
            ? (prev.compactingStartTime ?? Date.now())
            : null,
        }
      })
    },
    resetOverrides() {
      leftoverIhrPatch(sessionId, prev => ({
        ...prev,
        overrideMessage: null,
        overrideColor: null,
        overrideShimmerColor: null,
        isCompacting: false,
        compactingHintText: null,
        compactingStartTime: null,
        turnEffort: null,
        turnModel: null,
        retryStatus: null,
        outputLimitRecovery: null,
        defaultVerb: leftoverIhrPickVerb(),
      }))
    },
    applyCompactProgress(event) {
      leftoverIhrApplyCompactProgress(sessionId, event)
    },
  }
}

export const LEFTOVER_IHR_SESSION_START = 'Running SessionStart hooks…'

/** densable `Ihr` `I(r)` applyCompactProgress. */
export function leftoverIhrApplyCompactProgress(
  sessionId: string,
  event: LeftoverIhrCompactProgress,
): void {
  const bind = leftoverIhrBind(sessionId)
  switch (event.type) {
    case 'hooks_start':
      bind.setColors(
        'claudeBlue_FOR_SYSTEM_SPINNER',
        'claudeBlueShimmer_FOR_SYSTEM_SPINNER',
      )
      bind.setMessage(
        event.hookType === 'pre_compact'
          ? 'Running PreCompact hooks…'
          : event.hookType === 'post_compact'
            ? 'Running PostCompact hooks…'
            : LEFTOVER_IHR_SESSION_START,
      )
      return
    case 'compact_start':
      bind.setMessage('Compacting conversation')
      bind.setCompacting(true, event.hintText ?? null)
      return
    case 'compact_end':
      leftoverIhrPatch(sessionId, prev => {
        if (
          prev.overrideMessage === null &&
          prev.overrideColor === null &&
          prev.overrideShimmerColor === null &&
          !prev.isCompacting &&
          prev.compactingHintText === null &&
          prev.compactingStartTime === null
        ) {
          return prev
        }
        return {
          ...prev,
          overrideMessage: null,
          overrideColor: null,
          overrideShimmerColor: null,
          isCompacting: false,
          compactingHintText: null,
          compactingStartTime: null,
        }
      })
  }
}

/** densable `Ihr` `d` / `Ve()` main-session bind. */
export function leftoverIhrMain(mainSessionId: string) {
  const bind = leftoverIhrBind(mainSessionId)
  return {
    setMode: bind.setMode,
    setMessage: bind.setMessage,
    setColors: bind.setColors,
    setTurnEffort: bind.setTurnEffort,
    setRetryStatus: bind.setRetryStatus,
    setCompacting: bind.setCompacting,
    resetOverrides: bind.resetOverrides,
    applyCompactProgress: bind.applyCompactProgress,
  }
}

export function leftoverIhrSetMode(
  sessionId: string,
  mode: string,
  outputLimitRecovery: unknown = null,
): void {
  leftoverIhrBind(sessionId).setMode(mode, outputLimitRecovery)
}

/** densable `Ihr` `setMode` on the session — Spinner `mode` effect. */
export function leftoverHhrSetMode(
  sessionId: string,
  mode: string,
  outputLimitRecovery?: unknown,
): void {
  leftoverIhrBind(sessionId).setMode(mode, outputLimitRecovery ?? null)
}

/** densable `Hhr(e)` — `xe(Xae(), …)` throws outside GMn. */
export function leftoverHhr(sessionId: string): number | null {
  leftoverIhrRequireStore()
  return leftoverIhrGet(sessionId).thinkingStartedAt
}

/** densable `Ohr` — `xe(Xae(), …)` throws outside GMn. */
export function leftoverIhrGet(sessionId: string): LeftoverIhrSlice {
  leftoverIhrRequireStore()
  return leftoverIhrState[sessionId] ?? leftoverIhrDefault
}

/** True when Ihr has materialized this session (not freeze `y`). */
export function leftoverIhrHas(sessionId: string): boolean {
  leftoverIhrRequireStore()
  return Object.hasOwn(leftoverIhrState, sessionId)
}

/** densable `Ihr` `evict(t)`. */
export function leftoverIhrEvict(sessionId: string): void {
  if (!Object.hasOwn(leftoverIhrState, sessionId)) return
  const { [sessionId]: _dropped, ...rest } = leftoverIhrState
  leftoverIhrState = rest
  leftoverIhrNotify()
}

/** densable `Ihr` `applyEvent(t)`. */
export type LeftoverIhrEvent =
  | {
      kind: 'agent-mode'
      agentId: string
      mode: string
      outputLimitRecovery?: unknown
    }
  | {
      kind: 'agent-retry-status'
      agentId: string
      retryStatus: unknown
    }
  | {
      kind: 'agent-turn-effort'
      agentId: string
      turnEffort: unknown
      turnModel?: unknown
    }
  | { kind: 'main-message'; message: string | null }
  | {
      kind: 'main-colors'
      color: string | null
      shimmerColor: string | null
    }

export function leftoverIhrApplyEvent(
  event: LeftoverIhrEvent,
  mainSessionId: string,
): void {
  switch (event.kind) {
    case 'agent-mode':
      leftoverIhrBind(event.agentId).setMode(
        event.mode,
        event.outputLimitRecovery,
      )
      return
    case 'agent-retry-status':
      leftoverIhrBind(event.agentId).setRetryStatus(event.retryStatus)
      return
    case 'agent-turn-effort':
      leftoverIhrBind(event.agentId).setTurnEffort(
        event.turnEffort,
        event.turnModel,
      )
      return
    case 'main-message':
      leftoverIhrMain(mainSessionId).setMessage(event.message)
      return
    case 'main-colors':
      leftoverIhrMain(mainSessionId).setColors(event.color, event.shimmerColor)
  }
}

/**
 * densable D2 `Fr` — silent_turn_reminder / quizzical_shore default-on when
 * family has `opus_5_5_prompt_bundle`.
 */
const LEFTOVER_D2_FAMILY_DEFAULT_ON = new Set([
  'silent_turn_reminder',
  'quizzical_shore',
])

type LeftoverCatalogRow = {
  id: string
  capabilities: readonly string[]
  provider_ids: Readonly<Record<string, string | null | undefined>>
}

function leftoverCatalogCap(
  model: string,
  capability: string,
): true | undefined {
  const stripped = model
    .replace(/\[1m\]/gi, '')
    .trim()
    .toLowerCase()
  const models = DENSABLE_EHL_CATALOG.models as readonly LeftoverCatalogRow[]
  const entry = models.find(m => {
    if (m.id.toLowerCase() === stripped) return true
    return Object.values(m.provider_ids).some(
      pid => typeof pid === 'string' && pid.toLowerCase() === stripped,
    )
  })
  if (entry === undefined) return undefined
  return entry.capabilities.includes(capability) ? true : undefined
}

/**
 * densable `Be` analog — catalog id from exact id or provider id.
 */
export function leftoverBe(model: string): string {
  const stripped = model.replace(/\[1m\]/gi, '').trim()
  const lower = stripped.toLowerCase()
  const models = DENSABLE_EHL_CATALOG.models as readonly LeftoverCatalogRow[]
  for (const m of models) {
    if (m.id.toLowerCase() === lower) return m.id
    for (const pid of Object.values(m.provider_ids)) {
      if (typeof pid === 'string' && pid.toLowerCase() === lower) return m.id
    }
  }
  return stripped
}

/**
 * densable `Qrr` / `Sw` client_data.
 * Gold: ReadGate → CacheKey → slots[key] → windowSeed → clientDataCache,
 * then clientDataOverride(data, model).
 */
type LeftoverQrrSlot = {
  data: Record<string, unknown> | null
  model?: string
}

let leftoverD2ClientData: Record<string, unknown> | null = null
let leftoverD2ClientModel: string | undefined
let leftoverQrrSlots: Record<string, LeftoverQrrSlot> | null = null
let leftoverQrrWindowSeed: {
  key: string
  data: Record<string, unknown>
} | null = null
let leftoverQrrReadGate: (() => boolean) | null = null
let leftoverQrrCacheKey: ((model?: string) => string) | null = null
let leftoverQrrOverride:
  | ((
      data: Record<string, unknown> | null,
      model?: string,
    ) => Record<string, unknown> | null)
  | null = null
const leftoverD2Logged = new Set<string>()

export function leftoverD2SetClientData(
  data: Record<string, unknown> | null,
  model?: string,
): void {
  leftoverD2DiskHydrated = true
  leftoverD2ClientData = data
  leftoverD2ClientModel = model
  leftoverQrrInstallCacheKey()
  leftoverQrrSeedWindow(data)
  const key = leftoverQrrCacheKey?.(model) ?? 'default'
  leftoverQrrSlots = { default: { data, model }, [key]: { data, model } }
}

export function leftoverQrrSetSlots(
  slots: Record<string, LeftoverQrrSlot> | null,
): void {
  leftoverQrrSlots = slots
}

export function leftoverQrrSetWindowSeed(
  seed: { key: string; data: Record<string, unknown> } | null,
): void {
  leftoverQrrWindowSeed = seed
}

export function leftoverQrrSetReadGate(gate: (() => boolean) | null): void {
  leftoverQrrReadGate = gate
}

export function leftoverQrrSetCacheKey(
  getter: ((model?: string) => string) | null,
): void {
  leftoverQrrCacheKey = getter
}

const LEFTOVER_QRR_KEY_PREFIX = 'bi1-'
const LEFTOVER_QRR_KEY_UNAVAILABLE = `${LEFTOVER_QRR_KEY_PREFIX}key-unavailable`

/** densable `Grr` — sha256 slot key `bi1-` + 16 hex. */
export function leftoverGrr(input: {
  entrypoint?: string | null
  model?: string
  ccVersion?: string
  organizationUuid?: string | null
}): string {
  const n = JSON.stringify([
    input.entrypoint ?? null,
    input.model,
    input.ccVersion,
    input.organizationUuid,
  ])
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createHash } = require('crypto') as typeof import('crypto')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return (
    LEFTOVER_QRR_KEY_PREFIX +
    createHash('sha256').update(n).digest('hex').slice(0, 16)
  )
}

/** densable `et()` / `bYr(Grr)` — install cache key getter. */
export function leftoverQrrInstallCacheKey(): void {
  if (leftoverQrrCacheKey !== null) return
  leftoverQrrSetCacheKey(model => {
    try {
      return leftoverGrr({
        model,
        ccVersion: MACRO.VERSION,
      })
    } catch {
      return LEFTOVER_QRR_KEY_UNAVAILABLE
    }
  })
}

/** densable `wYr` — seed window from current cache key. */
export function leftoverQrrSeedWindow(
  data: Record<string, unknown> | null,
): void {
  leftoverQrrInstallCacheKey()
  const key = leftoverQrrCacheKey?.()
  leftoverQrrSetWindowSeed(
    key === undefined || data === null ? null : { key, data },
  )
}

/** densable `R()` / `EYr` — firstParty or unscoped anthropicAws. */
function leftoverQrrDefaultReadGate(): boolean {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getAPIProvider } =
      require('./model/providers.js') as typeof import('./model/providers.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    const provider = getAPIProvider()
    if (provider === 'firstParty') return true
    if (
      provider === 'anthropicAws' &&
      process.env.ANTHROPIC_AWS_BASE_URL === undefined
    ) {
      return true
    }
    return false
  } catch {
    return true
  }
}

/** densable `et()` companion `EYr`. */
export function leftoverQrrInstallReadGate(): void {
  if (leftoverQrrReadGate !== null) return
  leftoverQrrSetReadGate(() => leftoverQrrDefaultReadGate())
}

export function leftoverQrrSetOverride(
  override: typeof leftoverQrrOverride,
): void {
  leftoverQrrOverride = override
}

function leftoverQrrSlotLooksValid(slot: LeftoverQrrSlot | undefined): boolean {
  return slot !== undefined && typeof slot === 'object'
}

/** densable `Sw` then optional override. */
export function leftoverQrr(model?: string): LeftoverQrrSlot | null {
  leftoverD2HydrateFromDiskOnce()
  if (leftoverQrrReadGate && !leftoverQrrReadGate()) return null
  const key = leftoverQrrCacheKey?.(model) ?? 'default'
  let resolved: LeftoverQrrSlot | null = null
  if (leftoverQrrSlots != null && Object.hasOwn(leftoverQrrSlots, key)) {
    const slot = leftoverQrrSlots[key]
    resolved = leftoverQrrSlotLooksValid(slot)
      ? { data: slot.data ?? null, model: slot.model }
      : null
  } else if (
    leftoverQrrWindowSeed !== null &&
    leftoverQrrWindowSeed.key === key
  ) {
    resolved = { data: leftoverQrrWindowSeed.data }
  } else if (
    leftoverD2ClientData !== null &&
    typeof leftoverD2ClientData === 'object'
  ) {
    resolved = { data: leftoverD2ClientData, model: leftoverD2ClientModel }
  }
  if (!leftoverQrrOverride) return resolved
  const data = resolved?.data ?? null
  const next = leftoverQrrOverride(data, model)
  if (next === data) return resolved
  return { data: next, model: resolved?.model ?? model }
}

let leftoverD2DiskHydrated = false

function leftoverD2HydrateFromDiskOnce(): void {
  if (leftoverQrrCacheKey === null) leftoverQrrInstallCacheKey()
  if (leftoverD2DiskHydrated) return
  leftoverD2DiskHydrated = true
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    leftoverD2HydrateFromDisk(getGlobalConfig().clientDataCache)
  } catch {
    // isolation — optional
  }
}

/** densable disk `clientDataCache` cold start. */
export function leftoverD2HydrateFromDisk(
  cache: unknown,
  model?: string,
): void {
  leftoverD2DiskHydrated = true
  if (cache !== null && typeof cache === 'object' && !Array.isArray(cache)) {
    leftoverD2SetClientData(cache as Record<string, unknown>, model)
  }
}

/**
 * densable `cQr` — `CLAUDE_CODE_MODEL_CAPABILITIES` `family=cap,-cap;...`
 */
function leftoverCqr(family: string): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const raw = process.env.CLAUDE_CODE_MODEL_CAPABILITIES
  if (raw === undefined) return map
  const r = family.replace(/\[1m\]/gi, '')
  for (const s of raw.split(';')) {
    const eq = s.indexOf('=')
    let list = s
    if (eq !== -1) {
      const l = s.slice(0, eq).trim()
      if (l === '') continue
      const match = l.endsWith('*') ? r.startsWith(l.slice(0, -1)) : r === l
      if (!match) continue
      list = s.slice(eq + 1)
    }
    for (const token of list.split(',')) {
      const c = token.trim()
      if (!c) continue
      const on = !c.startsWith('-')
      map.set(on ? c : c.slice(1), on)
    }
  }
  return map
}

/** densable `go` — one-shot tengu_model_capability(_off)_from_client_data. */
function leftoverGo(off: boolean, capability: string, model: string): void {
  const key = `${off ? '-' : ''}${capability}:${model}`
  if (leftoverD2Logged.has(key)) return
  leftoverD2Logged.add(key)
  if (leftoverD2Logged.size > 64) {
    const first = leftoverD2Logged.values().next().value
    if (first !== undefined) leftoverD2Logged.delete(first)
  }
  logEvent(
    off
      ? 'tengu_model_capability_off_from_client_data'
      : 'tengu_model_capability_from_client_data',
    { capability, model },
  )
}

/**
 * densable `D2(e,n,s,r)` — override, env fy, catalog, then Fr/Qrr client_data.
 */
export function leftoverD2(
  capability: string,
  family: string,
  model: string,
  override?: boolean,
): boolean {
  if (override !== undefined) return override
  const env = leftoverCqr(family).get(capability)
  if (env !== undefined) return env
  const fromFamily = leftoverCatalogCap(family, capability)
  if (fromFamily !== undefined) return fromFamily
  const fromModel = leftoverCatalogCap(model, capability)
  if (fromModel !== undefined) return fromModel
  const defaultOn =
    LEFTOVER_D2_FAMILY_DEFAULT_ON.has(capability) &&
    leftoverCatalogCap(family, 'opus_5_5_prompt_bundle') === true
  const qrr = leftoverQrr(model)
  const slot = qrr?.data
  const loggedModel = qrr?.model ?? leftoverD2ClientModel ?? model
  if (defaultOn) {
    if (slot?.[capability] !== false) return true
    leftoverGo(true, capability, loggedModel)
    return false
  }
  if (slot?.[capability] !== true) return false
  leftoverGo(false, capability, loggedModel)
  return true
}

/**
 * densable Za `L$n(p)` — `typeof e==="string"&&D2("quizzical_shore",Be(e),e)`.
 * True hides Markdown hint `"summary"`.
 */
export function leftoverQuizzicalShore(model?: string): boolean {
  if (typeof model !== 'string') return false
  return leftoverD2('quizzical_shore', leftoverBe(model), model)
}

/** densable `Itn` / `Dtn`. */
const LEFTOVER_SILENT_TURN_ITN =
  "The user hasn't heard from you in a while. As you continue, keep them updated when there's something to tell — a finding, a change of plan."
const LEFTOVER_SILENT_TURN_TURNS = 5
const LEFTOVER_SILENT_TURN_STRETCH = 3

function leftoverEnvOverride(name: string): boolean | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (v === '' || v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false
  }
  return true
}

/** densable `Ltn(e)` — `D2("silent_turn_reminder", Be(e), e, env)`. */
export function leftoverSilentTurnReminder(model?: string): boolean {
  if (typeof model !== 'string') return false
  return leftoverD2(
    'silent_turn_reminder',
    leftoverBe(model),
    model,
    leftoverEnvOverride('CLAUDE_CODE_SILENT_TURN_REMINDER'),
  )
}

/** densable `syt()` — focus view skips silent-turn inject. */
export function leftoverSilentTurnFocusOff(): boolean {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getIsNonInteractiveSession } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    const { resolveFocusViewActiveFromSession } =
      require('./focusView.js') as typeof import('./focusView.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return resolveFocusViewActiveFromSession({
      nonInteractive: getIsNonInteractiveSession(),
    })
  } catch {
    return false
  }
}

/** densable `Dtn()`. */
export function leftoverSilentTurnReminderText(): string {
  const env = process.env.CLAUDE_CODE_SILENT_TURN_REMINDER_TEXT
  if (typeof env === 'string' && env.trim() !== '') return env
  return LEFTOVER_SILENT_TURN_ITN
}

/** densable `Ntn()` / `fpr()`. */
export function leftoverSilentTurnReminderTurns(): number {
  const env = process.env.CLAUDE_CODE_SILENT_TURN_REMINDER_TURNS
  if (env !== undefined) {
    const n = Number(env)
    if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  }
  return LEFTOVER_SILENT_TURN_TURNS
}

type LeftoverSilentTurnMsg = {
  type?: string
  isVirtual?: boolean
  isMeta?: boolean
  message?: { id?: string; content?: unknown }
  attachment?: { type?: string }
}

function leftoverSilentTurnSpoke(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (!block || typeof block !== 'object') return false
    const row = block as { type?: string; text?: string; name?: string }
    if (row.type === 'tool_use' && typeof row.name === 'string') return true
    if (row.type === 'text' && typeof row.text === 'string') {
      return row.text.trim() !== ''
    }
    return false
  })
}

function leftoverSilentTurnHasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      block =>
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'tool_result',
    )
  )
}

/** densable `Fpr` — turns since last spoke vs reminder stretch. */
export function leftoverSilentTurnCounts(messages: readonly unknown[]): {
  turnsSinceLastReminder: number
  remindersInStretch: number
} {
  let turns = 0
  let reminders = 0
  let currentId: string | undefined
  let spoke = false
  const flush = (): boolean => {
    if (currentId === undefined) return false
    if (spoke) return true
    if (reminders === 0) turns++
    currentId = undefined
    spoke = false
    return false
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as LeftoverSilentTurnMsg | undefined
    if (msg === undefined) continue
    if (
      (msg.type === 'user' || msg.type === 'assistant') &&
      msg.isVirtual === true
    ) {
      continue
    }
    if (msg.type === 'assistant') {
      const id = msg.message?.id
      if (id !== currentId) {
        if (flush()) {
          return {
            turnsSinceLastReminder: turns,
            remindersInStretch: reminders,
          }
        }
        currentId = id
      }
      if (leftoverSilentTurnSpoke(msg.message?.content)) spoke = true
      continue
    }
    if (flush()) {
      return { turnsSinceLastReminder: turns, remindersInStretch: reminders }
    }
    if (
      msg.type === 'attachment' &&
      msg.attachment?.type === 'silent_turn_reminder'
    ) {
      reminders++
      continue
    }
    if (
      msg.type === 'user' &&
      msg.isMeta !== true &&
      !leftoverSilentTurnHasToolResult(msg.message?.content)
    ) {
      break
    }
  }
  flush()
  return { turnsSinceLastReminder: turns, remindersInStretch: reminders }
}

/** densable `$pr(g)`. */
export function leftoverSilentTurnReminderAttachments(
  messages: readonly unknown[],
): Array<{ type: 'silent_turn_reminder'; text: string }> {
  const { turnsSinceLastReminder, remindersInStretch } =
    leftoverSilentTurnCounts(messages)
  if (
    remindersInStretch >= LEFTOVER_SILENT_TURN_STRETCH ||
    turnsSinceLastReminder < leftoverSilentTurnReminderTurns()
  ) {
    return []
  }
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { logEvent } =
      require('../services/analytics/index.js') as typeof import('../services/analytics/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    logEvent('silent_turn_reminder', { turns: turnsSinceLastReminder })
  } catch {
    // isolation — optional
  }
  return [
    { type: 'silent_turn_reminder', text: leftoverSilentTurnReminderText() },
  ]
}

/**
 * densable Io `Zc` — live Thought clock.
 * `C=R!==null?l+min(jVn,max(0,now-max(R,p))):l` then `max(1000,C)`.
 * `startedAt` is gold `Hhr` thinkingStartedAt; null → folded `max(1000,baseMs)`.
 */
export function leftoverZcMs(
  baseMs: number,
  lastThinkingAtMs: number,
  now: number,
  startedAt: number | null,
): number {
  const live =
    startedAt !== null
      ? baseMs +
        Math.min(
          THOUGHT_FOR_MS_CAP,
          Math.max(0, now - Math.max(startedAt, lastThinkingAtMs)),
        )
      : baseMs
  return Math.max(1000, live)
}

/**
 * densable Io last thinking stamp — walk group messages from the end.
 * Gold: `Nf.message.content[0]?.type==="thinking"` then `Date.parse(Nf.timestamp)`.
 */
export function leftoverLastThinkingAtMs(
  messages: Array<{
    type?: string
    timestamp?: string
    message?: { content?: unknown }
  }>,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type !== 'assistant') continue
    const content = getFirstContentItem(
      msg.message?.content as MessageContent | undefined,
    )
    if (content?.type !== 'thinking') continue
    const at = Date.parse(
      typeof msg.timestamp === 'string' ? msg.timestamp : '',
    )
    if (Number.isFinite(at)) return at
  }
  return 0
}

/** densable Spn absorb — stamp summary unconditionally when non-blank. */
function absorbThinking(
  msg: RenderableMessage,
  group: GroupAccumulator,
  lastTimestamp: string | undefined,
  memo: LeftoverSpnMemo,
): void {
  const summary = (memo.summary ??= leftoverTr(memo.thinking))
  if (summary) group.latestThinkingSummary = summary
  const ts = typeof msg.timestamp === 'string' ? msg.timestamp : undefined
  if (lastTimestamp !== undefined && ts !== undefined) {
    const delta = Date.parse(ts) - Date.parse(lastTimestamp)
    if (Number.isFinite(delta) && delta > 0) {
      group.thoughtForMs =
        (group.thoughtForMs ?? 0) + Math.min(delta, THOUGHT_FOR_MS_CAP)
    }
  }
  group.messages.push(msg as CollapsibleMessage)
}

/** densable J1p `Y1p` — thinking/redacted, attachment, or system. */
function leftoverY1p(msg: RenderableMessage): boolean {
  if (leftoverDve(msg)) return true
  if (msg.type === 'attachment') return true
  if (msg.type === 'system') return true
  return false
}

/**
 * densable 2.1.289 `Bhe` — queued prompt that flushes the open group.
 * `!isMeta && jy(origin)` then channel / peer / slack-ping.
 */
function leftoverUka(msg: RenderableMessage): boolean {
  if (msg.type !== 'attachment') return false
  const att = msg.attachment
  if (att.type !== 'queued_command' || att.commandMode !== 'prompt') {
    return false
  }
  const origin =
    att.origin !== null && typeof att.origin === 'object'
      ? (att.origin as { kind?: string })
      : undefined
  if (att.isMeta !== true && isHumanLikeOrigin(origin)) return true
  const kind = origin?.kind
  return kind === 'channel' || kind === 'peer' || kind === 'slack-ping'
}

type QueueOrigin = { kind?: string; senderTaskId?: string }

function leftoverQueueOrigin(msg: RenderableMessage): QueueOrigin | undefined {
  if (msg.type !== 'attachment' || msg.attachment.type !== 'queued_command') {
    return undefined
  }
  const origin = msg.attachment.origin
  if (origin === null || typeof origin !== 'object') return undefined
  return origin as QueueOrigin
}

/** densable 2.1.289 `uM` — peer with a sender, or an observer. */
function leftoverUm(origin: QueueOrigin | undefined): boolean {
  return (
    (origin?.kind === 'peer' && origin.senderTaskId !== undefined) ||
    origin?.kind === 'observer'
  )
}

/** densable 2.1.289 `ywr` — task-notification queued commands flush. */
function leftoverYwr(msg: RenderableMessage): boolean {
  return (
    msg.type === 'attachment' &&
    msg.attachment.type === 'queued_command' &&
    msg.attachment.commandMode === 'task-notification'
  )
}

/** densable 2.1.289 `_wr` — observer / coordinator queued commands flush. */
function leftoverWr(msg: RenderableMessage): boolean {
  if (msg.type !== 'attachment' || msg.attachment.type !== 'queued_command') {
    return false
  }
  const origin = leftoverQueueOrigin(msg)
  return leftoverUm(origin) || origin?.kind === 'coordinator'
}

const LEFTOVER_SHUTDOWN_KEYS = new Set([
  'type',
  'requestId',
  'from',
  'timestamp',
  'paneId',
  'backendType',
])

function leftoverMailboxRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** densable `kT(Lgt(), text)` — strict shutdown_approved JSON. */
function leftoverShutdownApproved(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!leftoverMailboxRecord(parsed) || Array.isArray(parsed)) return false
    for (const key of Object.keys(parsed)) {
      if (!LEFTOVER_SHUTDOWN_KEYS.has(key)) return false
    }
    if (parsed.type !== 'shutdown_approved') return false
    if (typeof parsed.requestId !== 'string') return false
    if (typeof parsed.from !== 'string') return false
    if (typeof parsed.timestamp !== 'string') return false
    if (parsed.paneId !== undefined && typeof parsed.paneId !== 'string') {
      return false
    }
    if (
      parsed.backendType !== undefined &&
      typeof parsed.backendType !== 'string'
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** densable `Fgt` — mailbox rows that are not a bare shutdown_approved frame. */
function leftoverFgt(messages: unknown[]): unknown[] {
  return messages.filter(row => {
    if (!leftoverMailboxRecord(row)) return false
    if (row.provenance === 'forged') return true
    if (row.summary !== undefined && typeof row.summary !== 'string') {
      return true
    }
    if (typeof row.summary === 'string' && row.summary.trim() !== '') {
      return true
    }
    if (typeof row.text !== 'string') return true
    return !leftoverShutdownApproved(row.text)
  })
}

/** densable `kwr` — teammate_mailbox with a visible message flushes. */
function leftoverKwr(msg: RenderableMessage): boolean {
  if (msg.type !== 'attachment' || msg.attachment.type !== 'teammate_mailbox') {
    return false
  }
  const mailbox = msg.attachment.messages
  return Array.isArray(mailbox) && leftoverFgt(mailbox).length > 0
}

/** densable 2.1.289 `_Mr` — Bhe || ywr || _wr || kwr. */
function leftoverMr(msg: RenderableMessage): boolean {
  return (
    leftoverUka(msg) || leftoverYwr(msg) || leftoverWr(msg) || leftoverKwr(msg)
  )
}

/** densable `hj` — non-empty string line count. */
function leftoverLineCount(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0
  let lines = 1
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) lines++
  }
  return lines
}

/** densable `Bcn` — added/removed lines for Write/Edit. */
function leftoverEditLines(
  toolName: string,
  msg: RenderableMessage,
): { added: number; removed: number } {
  const blocks =
    msg.type === 'grouped_tool_use'
      ? msg.messages.map(row => getFirstContentItem(row.message?.content))
      : msg.type === 'assistant'
        ? [getFirstContentItem(msg.message?.content)]
        : []
  let added = 0
  let removed = 0
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue
    const input = (block as { input?: unknown }).input
    if (input === null || typeof input !== 'object') continue
    const row = input as {
      edits?: unknown
      new_string?: unknown
      old_string?: unknown
      content?: unknown
    }
    if (toolName === FILE_EDIT_TOOL_NAME) {
      if (Array.isArray(row.edits)) {
        for (const edit of row.edits) {
          if (edit === null || typeof edit !== 'object') continue
          const pair = edit as { new_string?: unknown; old_string?: unknown }
          added += leftoverLineCount(pair.new_string)
          removed += leftoverLineCount(pair.old_string)
        }
      } else {
        added += leftoverLineCount(row.new_string)
        removed += leftoverLineCount(row.old_string)
      }
    } else if (toolName === FILE_WRITE_TOOL_NAME) {
      added += leftoverLineCount(row.content)
    }
  }
  return { added, removed }
}

/** densable `QRe`. */
function leftoverQre(filePath: string): string {
  return ('/' + filePath).replace(/\/{2,}/g, '/')
}

/** densable `awr` — own `path` string or string array, cap 20. */
function leftoverAwr(input: unknown): string[] {
  if (input === null || typeof input !== 'object') return []
  const desc = Object.getOwnPropertyDescriptor(input, 'path')
  if (!desc || !('value' in desc)) return []
  const value = desc.value
  if (typeof value === 'string') return [leftoverQre(value)]
  if (value === null || typeof value !== 'object' || !Array.isArray(value)) {
    return []
  }
  if (!Number.isSafeInteger(value.length)) return []
  const out: string[] = []
  for (let i = 0; i < value.length && i < 20; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i)
    if (item && 'value' in item && typeof item.value === 'string') {
      out.push(leftoverQre(item.value))
    }
  }
  return out
}

function leftoverAccountMemoryPaths(msg: RenderableMessage): string[] {
  const blocks =
    msg.type === 'grouped_tool_use'
      ? msg.messages.map(row => getFirstContentItem(row.message?.content))
      : msg.type === 'assistant'
        ? [getFirstContentItem(msg.message?.content)]
        : []
  const paths: string[] = []
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue
    paths.push(...leftoverAwr((block as { input?: unknown }).input))
  }
  return paths
}

/** densable `gwr` — bashEditDiff result that should eject the tool use. */
function leftoverGwr(msg: RenderableMessage): boolean {
  if (msg.type !== 'user') return false
  const raw = msg.toolUseResult
  if (raw === null || typeof raw !== 'object' || !('bashEditDiff' in raw)) {
    return false
  }
  const diff = (raw as { bashEditDiff?: unknown }).bashEditDiff
  if (diff === null || typeof diff !== 'object') return false
  const row = diff as Record<string, unknown>
  const skipped = 'skipped' in row && Boolean(row.skipped)
  const unavailableEmpty =
    'unavailable' in row &&
    Boolean(row.unavailable) &&
    'files' in row &&
    Array.isArray(row.files) &&
    row.files.length === 0 &&
    'moreFiles' in row &&
    row.moreFiles === 0
  return !(skipped || unavailableEmpty)
}

/** densable `bwr` — cowork context until an account_memory_recall. */
function leftoverBwr(messages: RenderableMessage[], index: number): boolean {
  for (let i = index + 1; i < messages.length; i++) {
    const next = messages[i]
    if (next?.type !== 'attachment') return false
    if (next.attachment.type === 'account_memory_recall') return true
    if (next.attachment.type !== 'cowork_memory_context') return false
  }
  return false
}

/** densable `Swr` — checkpoint skips these attachments. */
function leftoverSwr(msg: RenderableMessage | undefined): boolean {
  return (
    msg?.type === 'attachment' &&
    (msg.attachment.type === 'relevant_memories' ||
      msg.attachment.type === 'cowork_memory_context')
  )
}

/** densable `Lka` / `K1p` — sentinel assistant text is skippable, not a breaker. */
function leftoverLka(msg: RenderableMessage): boolean {
  if (msg.type !== 'assistant') return false
  const content = getFirstContentItem(msg.message?.content)
  if (content?.type !== 'text') return false
  const text = (content as { text?: unknown }).text
  if (typeof text !== 'string') return false
  return text.trim() === NO_CONTENT_MESSAGE || text === NO_RESPONSE_REQUESTED
}

/**
 * Type predicate: Check if a message is a collapsible tool use.
 */
function isCollapsibleToolUse(
  msg: RenderableMessage,
  tools: Tools,
): msg is CollapsibleMessage {
  if (msg.type === 'assistant') {
    const content = getFirstContentItem(msg.message?.content)
    return (
      content !== undefined &&
      content.type === 'tool_use' &&
      isSearchExtraToolsOrRead(
        (content as { name: string }).name,
        (content as { input: unknown }).input,
        tools,
      )
    )
  }
  if (msg.type === 'grouped_tool_use') {
    const firstContent = getFirstContentItem(msg.messages[0]?.message?.content)
    return (
      firstContent !== undefined &&
      firstContent.type === 'tool_use' &&
      isSearchExtraToolsOrRead(
        msg.toolName,
        (firstContent as { input: unknown }).input,
        tools,
      )
    )
  }
  return false
}

/**
 * Type predicate: Check if a message is a tool result for collapsible tools.
 * Returns true if ALL tool results in the message are for tracked collapsible tools.
 */
function isCollapsibleToolResult(
  msg: RenderableMessage,
  collapsibleToolUseIds: Set<string>,
): msg is CollapsibleMessage {
  if (msg.type === 'user') {
    const contentItems = getContentItems(msg.message?.content)
    const toolResults = contentItems.filter(
      (c): c is ContentItem & { type: 'tool_result'; tool_use_id: string } =>
        c.type === 'tool_result',
    )
    // Only return true if there are tool results AND all of them are for collapsible tools
    return (
      toolResults.length > 0 &&
      toolResults.every(r => collapsibleToolUseIds.has(r.tool_use_id))
    )
  }
  return false
}

/**
 * Get all tool use IDs from a single message (handles grouped tool uses).
 */
function getToolUseIdsFromMessage(msg: RenderableMessage): string[] {
  if (msg.type === 'assistant') {
    const content = getFirstContentItem(msg.message?.content)
    if (content && content.type === 'tool_use') {
      return [(content as { id: string }).id]
    }
  }
  if (msg.type === 'grouped_tool_use') {
    return msg.messages
      .map(m => {
        const content = getFirstContentItem(m.message?.content)
        if (!content) return ''
        return content.type === 'tool_use' ? (content as { id: string }).id : ''
      })
      .filter(Boolean)
  }
  return []
}

/**
 * Get all tool use IDs from a collapsed read/search group.
 */
export function getToolUseIdsFromCollapsedGroup(
  message: CollapsedReadSearchGroup,
): string[] {
  const ids: string[] = []
  for (const msg of message.messages) {
    ids.push(...getToolUseIdsFromMessage(msg))
  }
  return ids
}

/**
 * Check if any tool in a collapsed group is in progress.
 */
export function hasAnyToolInProgress(
  message: CollapsedReadSearchGroup,
  inProgressToolUseIDs: Set<string>,
): boolean {
  return getToolUseIdsFromCollapsedGroup(message).some(id =>
    inProgressToolUseIDs.has(id),
  )
}

/**
 * Get the underlying NormalizedMessage for display (timestamp/model).
 * Handles nested GroupedToolUseMessage within collapsed groups.
 * Returns a NormalizedAssistantMessage or NormalizedUserMessage (never GroupedToolUseMessage).
 */
export function getDisplayMessageFromCollapsed(
  message: CollapsedReadSearchGroup,
): Exclude<CollapsibleMessage, { type: 'grouped_tool_use' }> {
  const firstMsg = message.displayMessage
  if (firstMsg.type === 'grouped_tool_use') {
    return firstMsg.displayMessage
  }
  return firstMsg
}

/**
 * Count the number of tool uses in a message (handles grouped tool uses).
 */
function countToolUses(msg: RenderableMessage): number {
  if (msg.type === 'grouped_tool_use') {
    return msg.messages.length
  }
  return 1
}

/**
 * Extract file paths from read tool inputs in a message.
 * Returns an array of file paths (may have duplicates if same file is read multiple times in one grouped message).
 */
function getFilePathsFromReadMessage(msg: RenderableMessage): string[] {
  const paths: string[] = []

  if (msg.type === 'assistant') {
    const content = getFirstContentItem(msg.message?.content)
    if (content && content.type === 'tool_use') {
      // densable Rab: nst(r.input) then file_path only when CIr-safe
      const { file_path: filePath } = extractSafeToolInputFields(
        (content as { input: unknown }).input,
      )
      if (filePath) {
        paths.push(filePath)
      }
    }
  } else if (msg.type === 'grouped_tool_use') {
    for (const m of msg.messages) {
      const content = getFirstContentItem(m.message?.content)
      if (content && content.type === 'tool_use') {
        const { file_path: filePath } = extractSafeToolInputFields(
          (content as { input: unknown }).input,
        )
        if (filePath) {
          paths.push(filePath)
        }
      }
    }
  }

  return paths
}

/**
 * Scan a bash tool result for commit SHAs and PR URLs and push them into the
 * group accumulator. Called only for results whose tool_use_id was recorded
 * in bashCommands (non-search/read bash).
 */
function scanBashResultForGitOps(
  msg: CollapsibleMessage,
  group: GroupAccumulator,
): void {
  if (msg.type !== 'user') return
  const out = msg.toolUseResult as
    | { stdout?: string; stderr?: string }
    | undefined
  if (!out?.stdout && !out?.stderr) return
  // git push writes the ref update to stderr — scan both streams.
  const combined = (out.stdout ?? '') + '\n' + (out.stderr ?? '')
  for (const c of getContentItems(msg.message?.content)) {
    if (c.type !== 'tool_result') continue
    const toolResult = c as { type: 'tool_result'; tool_use_id: string }
    const command = group.bashCommands?.get(toolResult.tool_use_id)
    if (!command) continue
    const { commit, push, branch, pr } = detectGitOperation(command, combined)
    if (commit) group.commits?.push(commit)
    if (push) group.pushes?.push(push)
    if (branch) group.branches?.push(branch)
    if (pr) group.prs?.push(pr)
    if (commit || push || branch || pr) {
      group.gitOpBashCount = (group.gitOpBashCount ?? 0) + 1
    }
  }
}

/**
 * densable edv — on error tool_result, spend workshopEditsByToolUseId markers
 * (real workshop writes reverse their counts; Qoi zero-count markers just mark
 * spent so the caller can eject the absorb from the collapse group).
 */
function applyWorkshopEditsOnError(
  msg: RenderableMessage,
  group: GroupAccumulator,
): boolean {
  if (msg.type !== 'user' || !group.workshopEditsByToolUseId) return false
  let spent = false
  for (const c of getContentItems(msg.message?.content)) {
    if (c.type !== 'tool_result') continue
    const toolResult = c as {
      type: 'tool_result'
      tool_use_id: string
      is_error?: boolean
    }
    if (!toolResult.is_error) continue
    const marker = group.workshopEditsByToolUseId.get(toolResult.tool_use_id)
    if (!marker || marker.spent) continue
    marker.spent = true
    group.workshopWriteCount = Math.max(
      0,
      (group.workshopWriteCount ?? 0) - marker.count,
    )
    group.workshopLinesAdded = Math.max(
      0,
      (group.workshopLinesAdded ?? 0) - marker.added,
    )
    group.workshopLinesRemoved = Math.max(
      0,
      (group.workshopLinesRemoved ?? 0) - marker.removed,
    )
    spent = true
  }
  return spent
}

type GroupAccumulator = {
  messages: CollapsibleMessage[]
  searchCount: number
  readFilePaths: Set<string>
  // Count of read operations that don't have file paths (e.g., Bash cat commands)
  readOperationCount: number
  // Count of directory-listing operations (ls, tree, du)
  listCount: number
  toolUseIds: Set<string>
  // Memory file operation counts (tracked separately from regular counts)
  memorySearchCount: number
  memoryReadFilePaths: Set<string>
  memoryWriteCount: number
  // Team memory file operation counts (tracked separately)
  teamMemorySearchCount?: number
  teamMemoryReadFilePaths?: Set<string>
  teamMemoryWriteCount?: number
  // Non-memory search patterns for display beneath the collapsed summary
  nonMemSearchArgs: string[]
  /** Most recently added non-memory operation, pre-formatted for display */
  latestDisplayHint: string | undefined
  // MCP tool calls (tracked separately so display says "Queried slack" not "Read N files")
  mcpCallCount?: number
  mcpServerNames?: Set<string>
  // Bash commands that aren't search/read (tracked separately for "Ran N bash commands")
  bashCount?: number
  // Bash tool_use_id → command string, so tool results can be scanned for
  // commit SHAs / PR URLs (surfaced as "committed abc123, created PR #42")
  bashCommands?: Map<string, string>
  commits?: { sha: string; kind: CommitKind }[]
  pushes?: { branch: string }[]
  branches?: { ref: string; action: BranchAction }[]
  prs?: { number: number; url?: string; action: PrAction }[]
  gitOpBashCount?: number
  // PreToolUse hook timing absorbed from hook summary messages
  hookTotalMs: number
  hookCount: number
  hookInfos: StopHookInfo[]
  // relevant_memories attachments absorbed into this group (auto-injected
  // memories, not explicit Read calls). Paths mirrored into readFilePaths +
  // memoryReadFilePaths so the inline "recalled N memories" text is accurate.
  relevantMemories?: { path: string; content: string; mtimeMs: number }[]
  /**
   * densable workshopEditsByToolUseId — workshop writes stash real line deltas;
   * Qoi popsOutOnError tools stash zero-count markers so edv can eject on error.
   */
  workshopEditsByToolUseId?: Map<string, WorkshopEditMarker>
  workshopWriteCount?: number
  workshopLinesAdded?: number
  workshopLinesRemoved?: number
  scratchpadWriteCount?: number
  scratchpadLinesAdded?: number
  scratchpadLinesRemoved?: number
  accountMemoryReadKeys?: Set<string>
  accountMemorySearchCount?: number
  accountMemoryRecalls?: { paths: string[]; content: unknown }[]
  /** densable thoughtForMs — absorbed thinking duration (cap 600_000). */
  thoughtForMs?: number
  latestThinkingSummary?: string
}

function createEmptyGroup(): GroupAccumulator {
  const group: GroupAccumulator = {
    messages: [],
    searchCount: 0,
    readFilePaths: new Set(),
    readOperationCount: 0,
    listCount: 0,
    toolUseIds: new Set(),
    memorySearchCount: 0,
    memoryReadFilePaths: new Set(),
    memoryWriteCount: 0,
    nonMemSearchArgs: [],
    latestDisplayHint: undefined,
    hookTotalMs: 0,
    hookCount: 0,
    hookInfos: [],
    thoughtForMs: 0,
    latestThinkingSummary: undefined,
  }
  if (feature('TEAMMEM')) {
    group.teamMemorySearchCount = 0
    group.teamMemoryReadFilePaths = new Set()
    group.teamMemoryWriteCount = 0
  }
  group.mcpCallCount = 0
  group.mcpServerNames = new Set()
  if (isFullscreenEnvEnabled()) {
    group.bashCount = 0
    group.bashCommands = new Map()
    group.commits = []
    group.pushes = []
    group.branches = []
    group.prs = []
    group.gitOpBashCount = 0
  }
  return group
}

function createCollapsedGroup(
  group: GroupAccumulator,
): CollapsedReadSearchGroup {
  const firstMsg = group.messages[0]!
  // When file-path-based reads exist, use unique file count (Set.size) only.
  // Adding bash operation count on top would double-count — e.g. Read(README.md)
  // followed by Bash(wc -l README.md) should still show as 1 file, not 2.
  // Fall back to operation count only when there are no file-path reads (bash-only).
  const totalReadCount =
    group.readFilePaths.size > 0
      ? group.readFilePaths.size
      : group.readOperationCount
  // memoryReadFilePaths ⊆ readFilePaths (both populated from Read tool calls),
  // so this count is safe to subtract from totalReadCount at readCount below.
  // Absorbed relevant_memories attachments are NOT in readFilePaths — added
  // separately after the subtraction so readCount stays correct.
  const toolMemoryReadCount = group.memoryReadFilePaths.size
  const memoryReadCount =
    toolMemoryReadCount + (group.relevantMemories?.length ?? 0)
  // Non-memory read file paths: exclude memory and team memory paths
  const teamMemReadPaths = feature('TEAMMEM')
    ? group.teamMemoryReadFilePaths
    : undefined
  const nonMemReadFilePaths = [...group.readFilePaths].filter(
    p =>
      !group.memoryReadFilePaths.has(p) && !(teamMemReadPaths?.has(p) ?? false),
  )
  const teamMemSearchCount = feature('TEAMMEM')
    ? (group.teamMemorySearchCount ?? 0)
    : 0
  const teamMemReadCount = feature('TEAMMEM')
    ? (group.teamMemoryReadFilePaths?.size ?? 0)
    : 0
  const teamMemWriteCount = feature('TEAMMEM')
    ? (group.teamMemoryWriteCount ?? 0)
    : 0
  const result: CollapsedReadSearchGroup = {
    type: 'collapsed_read_search',
    // Subtract memory + team memory counts so regular counts only reflect non-memory operations
    searchCount: Math.max(
      0,
      group.searchCount - group.memorySearchCount - teamMemSearchCount,
    ),
    readCount: Math.max(
      0,
      totalReadCount - toolMemoryReadCount - teamMemReadCount,
    ),
    listCount: group.listCount,
    // REPL operations are intentionally not collapsed (see isCollapsible: false at line 32),
    // so replCount in collapsed groups is always 0. The replCount field is kept for
    // sub-agent progress display in AgentTool/UI.tsx which has a separate code path.
    replCount: 0,
    memorySearchCount: group.memorySearchCount,
    memoryReadCount,
    memoryWriteCount: group.memoryWriteCount,
    readFilePaths: nonMemReadFilePaths,
    searchArgs: group.nonMemSearchArgs,
    latestDisplayHint: group.latestDisplayHint,
    messages: group.messages,
    displayMessage: firstMsg,
    uuid: `collapsed-${firstMsg.uuid}` as UUID,
    timestamp: firstMsg.timestamp,
  }
  if (feature('TEAMMEM')) {
    result.teamMemorySearchCount = teamMemSearchCount
    result.teamMemoryReadCount = teamMemReadCount
    result.teamMemoryWriteCount = teamMemWriteCount
  }
  if ((group.mcpCallCount ?? 0) > 0) {
    result.mcpCallCount = group.mcpCallCount
    result.mcpServerNames = [...(group.mcpServerNames ?? [])]
  }
  if (isFullscreenEnvEnabled()) {
    if ((group.bashCount ?? 0) > 0) {
      result.bashCount = group.bashCount
      result.gitOpBashCount = group.gitOpBashCount
    }
    if ((group.commits?.length ?? 0) > 0) result.commits = group.commits
    if ((group.pushes?.length ?? 0) > 0) result.pushes = group.pushes
    if ((group.branches?.length ?? 0) > 0) result.branches = group.branches
    if ((group.prs?.length ?? 0) > 0) result.prs = group.prs
  }
  if (group.hookCount > 0) {
    result.hookTotalMs = group.hookTotalMs
    result.hookCount = group.hookCount
    result.hookInfos = group.hookInfos
  }
  if (group.relevantMemories && group.relevantMemories.length > 0) {
    result.relevantMemories = group.relevantMemories
  }
  if ((group.thoughtForMs ?? 0) > 0) {
    result.thoughtForMs = group.thoughtForMs
  }
  if (group.latestThinkingSummary !== undefined) {
    result.latestThinkingSummary = group.latestThinkingSummary
  }
  if ((group.accountMemoryReadKeys?.size ?? 0) > 0) {
    result.accountMemoryReadKeys = [...(group.accountMemoryReadKeys ?? [])]
  }
  if ((group.accountMemorySearchCount ?? 0) > 0) {
    result.accountMemorySearchCount = group.accountMemorySearchCount
  }
  if ((group.accountMemoryRecalls?.length ?? 0) > 0) {
    result.accountMemoryRecalls = group.accountMemoryRecalls
  }
  if ((group.scratchpadWriteCount ?? 0) > 0) {
    result.scratchpadWriteCount = group.scratchpadWriteCount
    result.scratchpadLinesAdded = group.scratchpadLinesAdded
    result.scratchpadLinesRemoved = group.scratchpadLinesRemoved
  }
  if ((group.workshopWriteCount ?? 0) > 0) {
    result.workshopWriteCount = group.workshopWriteCount
    result.workshopLinesAdded = group.workshopLinesAdded
    result.workshopLinesRemoved = group.workshopLinesRemoved
  }
  return result
}

const LEFTOVER_COLLAPSE_CHECKPOINT = 32

type LeftoverCollapseCheckpoint = {
  inputIndex: number
  resultLength: number
  prevTimestamp: string | undefined
}

type LeftoverCollapseCacheKey = {
  tools: Tools
  replVerbose: boolean
  fullscreenEnv: boolean
  cwd: string
}

/** densable `Wcn` — resume a collapse when the message prefix is unchanged. */
export class LeftoverCollapseCache {
  #messages: RenderableMessage[] = []
  #results: RenderableMessage[] = []
  #key: LeftoverCollapseCacheKey | undefined
  #checkpoints: LeftoverCollapseCheckpoint[] = []

  resume(
    messages: RenderableMessage[],
    key: LeftoverCollapseCacheKey,
  ): {
    start: number
    result: RenderableMessage[]
    prevTimestamp: string | undefined
  } {
    let hit = -1
    const prev = this.#key
    if (
      prev !== undefined &&
      prev.tools === key.tools &&
      prev.replVerbose === key.replVerbose &&
      prev.fullscreenEnv === key.fullscreenEnv &&
      prev.cwd === key.cwd
    ) {
      const stored = this.#messages
      const limit = Math.min(stored.length, messages.length)
      let prefix = 0
      while (prefix < limit && stored[prefix] === messages[prefix]) prefix++
      for (let i = this.#checkpoints.length - 1; i >= 0; i--) {
        if ((this.#checkpoints[i]?.inputIndex ?? 0) <= prefix) {
          hit = i
          break
        }
      }
    } else {
      this.#key = key
    }
    this.#checkpoints.length = hit + 1
    this.#messages = messages
    const point = hit >= 0 ? this.#checkpoints[hit] : undefined
    const start = point?.inputIndex ?? 0
    const result =
      point === undefined ? [] : this.#results.slice(0, point.resultLength)
    this.#results = result
    return { start, result, prevTimestamp: point?.prevTimestamp }
  }

  checkpoint(
    inputIndex: number,
    resultLength: number,
    prevTimestamp: string | undefined,
  ): void {
    const last = this.#checkpoints.at(-1)
    if (
      last === undefined ||
      inputIndex - last.inputIndex >= LEFTOVER_COLLAPSE_CHECKPOINT
    ) {
      this.#checkpoints.push({ inputIndex, resultLength, prevTimestamp })
    }
  }

  reset(): void {
    this.#messages = []
    this.#results = []
    this.#key = undefined
    this.#checkpoints = []
  }
}

export type LeftoverCollapseOptions = {
  /** densable `yMr` `transcriptV2` — return the messages unchanged. */
  transcriptV2?: boolean
  /** densable `yMr` `expandRows` — keep rows, dedupe hook decisions. */
  expandRows?: boolean
  /** Stable `Wcn`. Omitted calls use a fresh cache, same as gold's default. */
  cache?: LeftoverCollapseCache
}

function leftoverOve(rows: RenderableMessage[]): RenderableMessage[] {
  const seen = new Set<string>()
  const out: RenderableMessage[] = []
  for (const row of rows) {
    if (
      row.type === 'attachment' &&
      row.attachment.type === 'hook_permission_decision'
    ) {
      const decision = String(row.attachment.decision)
      const hookEvent = String(row.attachment.hookEvent)
      const key = `${decision}:${hookEvent}`
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(row)
  }
  return out
}

function leftoverTpn(msg: RenderableMessage): boolean {
  if (msg.type === 'assistant') {
    return getFirstContentItem(msg.message?.content)?.type === 'tool_use'
  }
  if (msg.type === 'grouped_tool_use') {
    return (
      getFirstContentItem(msg.messages[0]?.message?.content)?.type ===
      'tool_use'
    )
  }
  return false
}

/** densable `yMr` expandRows pass. */
function leftoverExpandRows(
  messages: RenderableMessage[],
  tools: Tools,
): RenderableMessage[] {
  if (
    !messages.some(
      msg =>
        msg.type === 'attachment' &&
        msg.attachment.type === 'hook_permission_decision',
    )
  ) {
    return messages
  }
  const out: RenderableMessage[] = []
  let bucket: RenderableMessage[] = []
  let ids = new Set<string>()
  for (const msg of messages) {
    const info = leftoverTpn(msg) ? getCollapsibleToolInfo(msg, tools) : null
    if (info) {
      for (const id of getToolUseIdsFromMessage(msg)) ids.add(id)
      bucket.push(msg)
    } else if (leftoverSpn(msg) !== undefined && !leftoverXut(msg)) {
      bucket.push(msg)
    } else if (
      bucket.length > 0 &&
      !leftoverUka(msg) &&
      (isCollapsibleToolResult(msg, ids) ||
        leftoverY1p(msg) ||
        leftoverLka(msg))
    ) {
      bucket.push(msg)
    } else {
      out.push(...leftoverOve(bucket), msg)
      bucket = []
      ids = new Set()
    }
  }
  out.push(...leftoverOve(bucket))
  return out
}

/**
 * Collapse consecutive Read/Search operations into summary groups.
 *
 * Rules:
 * - Groups consecutive search/read tool uses (Grep, Glob, Read, and Bash search/read commands)
 * - Includes their corresponding tool results in the group
 * - Breaks groups when assistant text appears
 */
export function collapseReadSearchGroups(
  messages: RenderableMessage[],
  tools: Tools,
  options: LeftoverCollapseOptions = {},
): RenderableMessage[] {
  const cache = options.cache ?? new LeftoverCollapseCache()
  if (options.transcriptV2) {
    cache.reset()
    return messages
  }
  if (options.expandRows) {
    cache.reset()
    return leftoverExpandRows(messages, tools)
  }
  const resumed = cache.resume(messages, {
    tools,
    replVerbose: false,
    fullscreenEnv: isFullscreenEnvEnabled(),
    cwd: getCwdState(),
  })
  const result = resumed.result
  let currentGroup = createEmptyGroup()
  let deferredSkippable: RenderableMessage[] = []
  let lastTimestamp = resumed.prevTimestamp
  let stashedMemories:
    | { path: string; content: string; mtimeMs: number }[]
    | undefined

  // densable J1p `a()`: drain deferred skippable rows, dropping duplicate
  // hook_permission_decision keys (`decision:hookEvent`).
  function leftoverEmitDeferred(): void {
    result.push(...leftoverOve(deferredSkippable))
    deferredSkippable = []
  }

  // densable J1p `l()` / `ve()`: open group always emits, then `a()`.
  function flushGroup(): void {
    if (currentGroup.messages.length === 0) return
    result.push(createCollapsedGroup(currentGroup))
    leftoverEmitDeferred()
    currentGroup = createEmptyGroup()
  }

  // densable 2.1.289 yMr — virtual rows stay in the chain. ULt absorbs REPL.
  for (let index = resumed.start; index < messages.length; index++) {
    const msg = messages[index]!
    if (
      currentGroup.messages.length === 0 &&
      deferredSkippable.length === 0 &&
      stashedMemories === undefined &&
      !leftoverSwr(messages[index - 1]) &&
      index >= resumed.start
    ) {
      cache.checkpoint(index, result.length, lastTimestamp)
    }
    if (isCollapsibleToolUse(msg, tools)) {
      // densable: tool use clears latestThinkingSummary on the open group.
      currentGroup.latestThinkingSummary = undefined
      const toolInfo = getCollapsibleToolInfo(msg, tools)!

      if (toolInfo.isMemoryWrite) {
        // Memory file write/edit — check if it's team memory
        const count = countToolUses(msg)
        if (
          feature('TEAMMEM') &&
          teamMemOps?.isTeamMemoryWriteOrEdit(toolInfo.name, toolInfo.input)
        ) {
          currentGroup.teamMemoryWriteCount =
            (currentGroup.teamMemoryWriteCount ?? 0) + count
        } else {
          currentGroup.memoryWriteCount += count
        }
      } else if (toolInfo.isWorkshopWrite) {
        const count = countToolUses(msg)
        const lines = leftoverEditLines(toolInfo.name, msg)
        currentGroup.workshopWriteCount =
          (currentGroup.workshopWriteCount ?? 0) + count
        currentGroup.workshopLinesAdded =
          (currentGroup.workshopLinesAdded ?? 0) + lines.added
        currentGroup.workshopLinesRemoved =
          (currentGroup.workshopLinesRemoved ?? 0) + lines.removed
        const marker: WorkshopEditMarker = {
          count,
          added: lines.added,
          removed: lines.removed,
          spent: false,
        }
        currentGroup.workshopEditsByToolUseId ??= new Map()
        for (const id of getToolUseIdsFromMessage(msg)) {
          currentGroup.workshopEditsByToolUseId.set(id, marker)
        }
        const filePath = getFilePathFromToolInput(toolInfo.input)
        if (filePath) {
          const hint = getDisplayPath(filePath)
          if (hint) currentGroup.latestDisplayHint = hint
        }
      } else if (toolInfo.isScratchpadWrite) {
        const count = countToolUses(msg)
        const lines = leftoverEditLines(toolInfo.name, msg)
        currentGroup.scratchpadWriteCount =
          (currentGroup.scratchpadWriteCount ?? 0) + count
        currentGroup.scratchpadLinesAdded =
          (currentGroup.scratchpadLinesAdded ?? 0) + lines.added
        currentGroup.scratchpadLinesRemoved =
          (currentGroup.scratchpadLinesRemoved ?? 0) + lines.removed
        const filePath = getFilePathFromToolInput(toolInfo.input)
        if (filePath) {
          const hint = getDisplayPath(filePath)
          if (hint) currentGroup.latestDisplayHint = hint
        }
      } else if (toolInfo.isAbsorbedSilently) {
        // Snip/SearchExtraTools/Qoi absorbed silently — no count, no summary text.
        // Hidden from the default view but still shown in verbose mode
        // (Ctrl+O) via the groupMessages iteration in CollapsedReadSearchContent.
        // densable: popsOutOnError Qoi tools register zero-count workshop markers
        // so an error tool_result can eject them from the group (edv).
        if (toolInfo.popsOutOnError) {
          const marker: WorkshopEditMarker = {
            count: 0,
            added: 0,
            removed: 0,
            spent: false,
          }
          currentGroup.workshopEditsByToolUseId ??= new Map()
          for (const id of getToolUseIdsFromMessage(msg)) {
            currentGroup.workshopEditsByToolUseId.set(id, marker)
          }
        }
      } else if (toolInfo.accountMemory === 'read') {
        currentGroup.accountMemoryReadKeys ??= new Set()
        const paths = leftoverAccountMemoryPaths(msg)
        const keys = paths.length > 0 ? paths : getToolUseIdsFromMessage(msg)
        for (const key of keys) currentGroup.accountMemoryReadKeys.add(key)
      } else if (toolInfo.accountMemory === 'search') {
        const count = countToolUses(msg)
        currentGroup.accountMemorySearchCount =
          (currentGroup.accountMemorySearchCount ?? 0) + count
      } else if (toolInfo.mcpServerName) {
        // MCP search/read — counted separately so the summary says
        // "Queried slack N times" instead of "Read N files".
        const count = countToolUses(msg)
        currentGroup.mcpCallCount = (currentGroup.mcpCallCount ?? 0) + count
        currentGroup.mcpServerNames?.add(toolInfo.mcpServerName)
        // densable nst: only string query becomes display hint
        const { query } = extractSafeToolInputFields(toolInfo.input)
        if (query) {
          currentGroup.latestDisplayHint = `"${query}"`
        }
      } else if (isFullscreenEnvEnabled() && toolInfo.isBash) {
        // Non-search/read Bash command — counted separately so the summary
        // says "Ran N bash commands" instead of breaking the group.
        const count = countToolUses(msg)
        currentGroup.bashCount = (currentGroup.bashCount ?? 0) + count
        const { command } = extractSafeToolInputFields(toolInfo.input)
        if (command) {
          // Prefer the stripped `# comment` if present (it's what Claude wrote
          // for the human — same trigger as the comment-as-label tool-use render).
          currentGroup.latestDisplayHint =
            extractBashCommentLabel(command) ?? commandAsHint(command)
          // Remember tool_use_id → command so the result (arriving next) can
          // be scanned for commit SHA / PR URL.
          for (const id of getToolUseIdsFromMessage(msg)) {
            currentGroup.bashCommands?.set(id, command)
          }
        }
      } else if (toolInfo.isList) {
        // Directory-listing bash commands (ls, tree, du) — counted separately
        // so the summary says "Listed N directories" instead of "Read N files".
        currentGroup.listCount += countToolUses(msg)
        const { command } = extractSafeToolInputFields(toolInfo.input)
        if (command) {
          currentGroup.latestDisplayHint = commandAsHint(command)
        }
      } else if (toolInfo.isSearch) {
        // Use the isSearch flag from the tool to properly categorize bash search commands
        const count = countToolUses(msg)
        currentGroup.searchCount += count
        // Check if the search targets memory files (via path or glob pattern)
        if (
          feature('TEAMMEM') &&
          teamMemOps?.isTeamMemorySearch(toolInfo.input)
        ) {
          currentGroup.teamMemorySearchCount =
            (currentGroup.teamMemorySearchCount ?? 0) + count
        } else if (isMemorySearch(toolInfo.input)) {
          currentGroup.memorySearchCount += count
        } else {
          // Regular (non-memory) search — collect pattern for display
          const { pattern } = extractSafeToolInputFields(toolInfo.input)
          if (pattern) {
            currentGroup.nonMemSearchArgs.push(pattern)
            currentGroup.latestDisplayHint = `"${pattern}"`
          }
        }
      } else {
        // For reads, track unique file paths instead of counting operations
        const filePaths = getFilePathsFromReadMessage(msg)
        for (const filePath of filePaths) {
          currentGroup.readFilePaths.add(filePath)
          if (feature('TEAMMEM') && teamMemOps?.isTeamMemFile(filePath)) {
            currentGroup.teamMemoryReadFilePaths?.add(filePath)
          } else if (isAutoManagedMemoryFile(filePath)) {
            currentGroup.memoryReadFilePaths.add(filePath)
          } else {
            // Non-memory file read — update display hint
            currentGroup.latestDisplayHint = getDisplayPath(filePath)
          }
        }
        // If no file paths found (e.g., Bash read commands like ls, cat), count the operations
        if (filePaths.length === 0) {
          currentGroup.readOperationCount += countToolUses(msg)
          // Use the Bash command as the display hint (truncated for readability)
          const { command } = extractSafeToolInputFields(toolInfo.input)
          if (command) {
            currentGroup.latestDisplayHint = commandAsHint(command)
          }
        }
      }

      // Track tool use IDs for matching results
      for (const id of getToolUseIdsFromMessage(msg)) {
        currentGroup.toolUseIds.add(id)
      }

      currentGroup.messages.push(msg)
    } else if (
      isCollapsibleToolResult(msg, currentGroup.toolUseIds) &&
      applyWorkshopEditsOnError(msg, currentGroup)
    ) {
      // densable: error tool_result for popsOutOnError absorb (or workshop write)
      // — if the last group message's tool_use_ids are all errored and the group
      // has no hooks/memories yet, eject that absorb out of the collapsed group.
      const last = currentGroup.messages.at(-1)
      const lastIds = last ? getToolUseIdsFromMessage(last) : []
      // CollapsibleMessage predicate excludes `user` at the type level even though
      // isCollapsibleToolResult only returns true for user tool_results — read via
      // RenderableMessage to keep densable edv eject logic typed.
      const resultMsg = msg as RenderableMessage
      const erroredIds = new Set(
        resultMsg.type === 'user'
          ? getContentItems(resultMsg.message?.content).flatMap(c =>
              c.type === 'tool_result' && (c as { is_error?: boolean }).is_error
                ? [(c as { tool_use_id: string }).tool_use_id]
                : [],
            )
          : [],
      )
      if (
        !(
          currentGroup.hookCount > 0 ||
          (currentGroup.relevantMemories?.length ?? 0) > 0 ||
          (currentGroup.accountMemoryRecalls?.length ?? 0) > 0 ||
          (currentGroup.accountMemoryReadKeys?.size ?? 0) > 0 ||
          (currentGroup.accountMemorySearchCount ?? 0) > 0 ||
          (currentGroup.workshopWriteCount ?? 0) > 0 ||
          (currentGroup.scratchpadWriteCount ?? 0) > 0
        ) &&
        lastIds.length > 0 &&
        lastIds.every(id => erroredIds.has(id))
      ) {
        currentGroup.messages.pop()
        for (const id of lastIds) currentGroup.toolUseIds.delete(id)
        if (currentGroup.messages.length > 0) {
          flushGroup()
          if (last) result.push(last)
        } else {
          if (last) result.push(last)
          leftoverEmitDeferred()
          currentGroup = createEmptyGroup()
        }
      } else {
        flushGroup()
      }
      result.push(msg)
    } else if (
      isCollapsibleToolResult(msg, currentGroup.toolUseIds) &&
      leftoverGwr(msg)
    ) {
      const last = currentGroup.messages.at(-1)
      const lastIds = last ? getToolUseIdsFromMessage(last) : []
      // Same predicate overlap as the popsOutOnError arm: both tool-use and
      // tool-result guards narrow to CollapsibleMessage, so the second true
      // branch is `never` unless we read through RenderableMessage.
      const diffMsg = msg as RenderableMessage
      const resultIds = new Set(
        diffMsg.type === 'user'
          ? getContentItems(diffMsg.message?.content).flatMap(block =>
              block.type === 'tool_result'
                ? [(block as { tool_use_id: string }).tool_use_id]
                : [],
            )
          : [],
      )
      const blocked =
        currentGroup.messages.length === 1 &&
        (currentGroup.hookCount > 0 ||
          (currentGroup.relevantMemories?.length ?? 0) > 0 ||
          (currentGroup.accountMemoryRecalls?.length ?? 0) > 0 ||
          (currentGroup.accountMemoryReadKeys?.size ?? 0) > 0 ||
          (currentGroup.accountMemorySearchCount ?? 0) > 0 ||
          (currentGroup.workshopWriteCount ?? 0) > 0 ||
          (currentGroup.scratchpadWriteCount ?? 0) > 0)
      if (
        last &&
        !blocked &&
        lastIds.length > 0 &&
        lastIds.every(id => resultIds.has(id))
      ) {
        currentGroup.messages.pop()
        const info = getCollapsibleToolInfo(last, tools)
        const count = countToolUses(last)
        const readPaths = getFilePathsFromReadMessage(last)
        if (isFullscreenEnvEnabled() && info?.isBash) {
          currentGroup.bashCount = Math.max(
            0,
            (currentGroup.bashCount ?? 0) - count,
          )
        } else if (info?.isList) {
          currentGroup.listCount = Math.max(0, currentGroup.listCount - count)
        } else if (info?.isSearch) {
          currentGroup.searchCount = Math.max(
            0,
            currentGroup.searchCount - count,
          )
        } else if (readPaths.length === 0) {
          currentGroup.readOperationCount = Math.max(
            0,
            currentGroup.readOperationCount - count,
          )
        }
        for (const id of lastIds) {
          currentGroup.toolUseIds.delete(id)
          currentGroup.bashCommands?.delete(id)
        }
        if (currentGroup.messages.length > 0) {
          flushGroup()
          result.push(last)
        } else {
          result.push(last)
          leftoverEmitDeferred()
          currentGroup = createEmptyGroup()
        }
      } else {
        flushGroup()
      }
      result.push(msg)
    } else if (isCollapsibleToolResult(msg, currentGroup.toolUseIds)) {
      currentGroup.messages.push(msg)
      // Scan bash results for commit SHAs / PR URLs to surface in the summary
      if (isFullscreenEnvEnabled() && currentGroup.bashCommands?.size) {
        scanBashResultForGitOps(msg, currentGroup)
      }
    } else if (currentGroup.messages.length > 0 && isPreToolHookSummary(msg)) {
      // Absorb PreToolUse hook summaries into the group instead of deferring
      currentGroup.hookCount += msg.hookCount
      currentGroup.hookTotalMs +=
        msg.totalDurationMs ??
        msg.hookInfos.reduce((sum, h) => sum + (h.durationMs ?? 0), 0)
      currentGroup.hookInfos.push(...msg.hookInfos)
    } else if (
      currentGroup.messages.length > 0 &&
      msg.type === 'attachment' &&
      msg.attachment.type === 'relevant_memories'
    ) {
      // Absorb auto-injected memory attachments so "recalled N memories"
      // renders inline with "ran N bash commands" instead of as a separate
      // ⏺ block. Do NOT add paths to readFilePaths/memoryReadFilePaths —
      // that would poison the readOperationCount fallback (bash-only reads
      // have no paths; adding memory paths makes readFilePaths.size > 0 and
      // suppresses the fallback). createCollapsedGroup adds .length to
      // memoryReadCount after the readCount subtraction instead.
      currentGroup.relevantMemories ??= []
      currentGroup.relevantMemories.push(...(msg.attachment.memories ?? []))
    } else if (
      currentGroup.messages.length > 0 &&
      msg.type === 'attachment' &&
      msg.attachment.type === 'account_memory_recall'
    ) {
      currentGroup.accountMemoryReadKeys ??= new Set()
      const files = msg.attachment.files
      if (Array.isArray(files)) {
        for (const file of files) {
          if (
            file !== null &&
            typeof file === 'object' &&
            typeof (file as { path?: unknown }).path === 'string'
          ) {
            currentGroup.accountMemoryReadKeys.add(
              leftoverQre((file as { path: string }).path),
            )
          }
        }
      }
      const paths = Array.isArray(files)
        ? files.flatMap(file =>
            file !== null &&
            typeof file === 'object' &&
            typeof (file as { path?: unknown }).path === 'string'
              ? [(file as { path: string }).path]
              : [],
          )
        : []
      currentGroup.accountMemoryRecalls ??= []
      currentGroup.accountMemoryRecalls.push({
        paths,
        content: msg.attachment.content,
      })
    } else if (
      msg.type === 'attachment' &&
      msg.attachment.type === 'relevant_memories' &&
      leftoverBwr(messages, index)
    ) {
      stashedMemories = msg.attachment.memories
    } else if (
      stashedMemories !== undefined &&
      msg.type === 'attachment' &&
      msg.attachment.type === 'account_memory_recall'
    ) {
      result.push({
        ...msg,
        attachment: { ...msg.attachment, localRecall: stashedMemories },
      })
      stashedMemories = undefined
    } else {
      // densable 2.1.289 yMr: `_Mr(xe) || ($e && xut)` flushes, then absorb.
      const leftoverSpnHit = leftoverSpn(msg)
      if (
        leftoverMr(msg) ||
        (leftoverSpnHit !== undefined && leftoverXut(leftoverSpnHit.message))
      ) {
        flushGroup()
        result.push(msg)
      } else if (leftoverSpnHit) {
        absorbThinking(
          leftoverSpnHit.message,
          currentGroup,
          lastTimestamp,
          leftoverSpnHit.memo,
        )
      } else if (leftoverY1p(msg) || leftoverLka(msg)) {
        if (currentGroup.messages.length > 0) deferredSkippable.push(msg)
        else result.push(msg)
      } else {
        flushGroup()
        result.push(msg)
      }
    }
    if (typeof msg.timestamp === 'string') lastTimestamp = msg.timestamp
  }

  flushGroup()
  return result
}

/**
 * Generate a summary text for search/read/REPL counts.
 * @param searchCount Number of search operations
 * @param readCount Number of read operations
 * @param isActive Whether the group is still in progress (use present tense) or completed (use past tense)
 * @param replCount Number of REPL executions (optional)
 * @param memoryCounts Optional memory file operation counts
 * @returns Summary text like "Searching for 3 patterns, reading 2 files, REPL'd 5 times…"
 */
export function getSearchReadSummaryText(
  searchCount: number,
  readCount: number,
  isActive: boolean,
  replCount: number = 0,
  memoryCounts?: {
    memorySearchCount: number
    memoryReadCount: number
    memoryWriteCount: number
    teamMemorySearchCount?: number
    teamMemoryReadCount?: number
    teamMemoryWriteCount?: number
  },
  listCount: number = 0,
): string {
  const parts: string[] = []

  // Memory operations first
  if (memoryCounts) {
    const { memorySearchCount, memoryReadCount, memoryWriteCount } =
      memoryCounts
    if (memoryReadCount > 0) {
      const verb = isActive
        ? parts.length === 0
          ? 'Recalling'
          : 'recalling'
        : parts.length === 0
          ? 'Recalled'
          : 'recalled'
      parts.push(
        `${verb} ${memoryReadCount} ${memoryReadCount === 1 ? 'memory' : 'memories'}`,
      )
    }
    if (memorySearchCount > 0) {
      const verb = isActive
        ? parts.length === 0
          ? 'Searching'
          : 'searching'
        : parts.length === 0
          ? 'Searched'
          : 'searched'
      parts.push(`${verb} memories`)
    }
    if (memoryWriteCount > 0) {
      const verb = isActive
        ? parts.length === 0
          ? 'Writing'
          : 'writing'
        : parts.length === 0
          ? 'Wrote'
          : 'wrote'
      parts.push(
        `${verb} ${memoryWriteCount} ${memoryWriteCount === 1 ? 'memory' : 'memories'}`,
      )
    }
    // Team memory operations
    if (feature('TEAMMEM') && teamMemOps) {
      teamMemOps.appendTeamMemorySummaryParts(memoryCounts, isActive, parts)
    }
  }

  if (searchCount > 0) {
    const searchVerb = isActive
      ? parts.length === 0
        ? 'Searching for'
        : 'searching for'
      : parts.length === 0
        ? 'Searched for'
        : 'searched for'
    parts.push(
      `${searchVerb} ${searchCount} ${searchCount === 1 ? 'pattern' : 'patterns'}`,
    )
  }

  if (readCount > 0) {
    const readVerb = isActive
      ? parts.length === 0
        ? 'Reading'
        : 'reading'
      : parts.length === 0
        ? 'Read'
        : 'read'
    parts.push(`${readVerb} ${readCount} ${readCount === 1 ? 'file' : 'files'}`)
  }

  if (listCount > 0) {
    const listVerb = isActive
      ? parts.length === 0
        ? 'Listing'
        : 'listing'
      : parts.length === 0
        ? 'Listed'
        : 'listed'
    parts.push(
      `${listVerb} ${listCount} ${listCount === 1 ? 'directory' : 'directories'}`,
    )
  }

  if (replCount > 0) {
    const replVerb = isActive ? "REPL'ing" : "REPL'd"
    parts.push(`${replVerb} ${replCount} ${replCount === 1 ? 'time' : 'times'}`)
  }

  const text = parts.join(', ')
  return isActive ? `${text}…` : text
}

/**
 * Summarize a list of recent tool activities into a compact description.
 * Rolls up trailing consecutive search/read operations using pre-computed
 * isSearch/isRead classifications from recording time. Falls back to the
 * last activity's description for non-collapsible tool uses.
 */
export function summarizeRecentActivities(
  activities: readonly {
    activityDescription?: string
    isSearch?: boolean
    isRead?: boolean
  }[],
): string | undefined {
  if (activities.length === 0) {
    return undefined
  }
  // Count trailing search/read activities from the end of the list
  let searchCount = 0
  let readCount = 0
  for (let i = activities.length - 1; i >= 0; i--) {
    const activity = activities[i]!
    if (activity.isSearch) {
      searchCount++
    } else if (activity.isRead) {
      readCount++
    } else {
      break
    }
  }
  const collapsibleCount = searchCount + readCount
  if (collapsibleCount >= 2) {
    return getSearchReadSummaryText(searchCount, readCount, true)
  }
  // Fall back to most recent activity with a description (some tools like
  // SendMessage don't implement getActivityDescription, so search backward)
  for (let i = activities.length - 1; i >= 0; i--) {
    if (activities[i]?.activityDescription) {
      return activities[i]!.activityDescription
    }
  }
  return undefined
}
