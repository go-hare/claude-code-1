/**
 * densable qcs — contextual suffix for unknown-tool errors.
 *
 * densable:
 * ```
 * function qcs(e,t,r,n,o){
 *   if(EL()&&mCt.has(e)&&Tc(t,rg)) return `. ${e} is only available inside ${rg}. ...`
 *   let i=Tc(I8(),e)
 *   if(r&&i&&M6e.has(i.name)) return `. ${e} is not available inside subagents. ...`
 *   if(i?.name===S2) return `. ${e} is not enabled in this session — write ...`
 *   if(i) return `. ${e} exists but is not enabled in this context. ...`
 *   if(VAt().has(e)) { // Glob/Grep stripped when embedded search tools on
 *     ... suggest Bash find/grep ...
 *   }
 *   if(!r) return lZg(e,n,o) // MCP still connecting
 *   return ""
 * }
 * ```
 */
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { BRIEF_TOOL_NAME } from '@claude-code/builtin-tools/tools/BriefTool/prompt.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from '@claude-code/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import {
  isReplModeEnabled,
  REPL_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { ALL_AGENT_DISALLOWED_TOOLS } from '../../constants/tools.js'
import type { Tools } from '../../Tool.js'
import { findToolByName } from '../../Tool.js'
import { normalizeNameForMCP } from '../mcp/normalization.js'
import { hasEmbeddedSearchTools } from '../../utils/embeddedTools.js'
import { getAllBaseTools } from '../../tools.js'

/** densable mCt — tools only reachable via REPL when REPL mode is on. */
export const REPL_PRIMITIVE_TOOL_NAMES = new Set<string>([
  FILE_READ_TOOL_NAME, // densable Ci=Read
  GLOB_TOOL_NAME, // kd
  GREP_TOOL_NAME, // dd
  BASH_TOOL_NAME, // $o
  POWERSHELL_TOOL_NAME, // Si
  NOTEBOOK_EDIT_TOOL_NAME, // VS
])

/** densable art — wait tool name in MCP-pending hint. */
export const WAIT_FOR_MCP_SERVERS_TOOL_NAME = 'WaitForMcpServers'

export type McpClientLike = {
  name: string
  type?: string
}

export type ToolNotFoundHintArgs = {
  toolName: string
  /** Tools available in this turn (what the model can call). */
  availableTools: Tools
  /** densable r — subagent id present ⇒ agent context. */
  agentId?: string | null
  /** densable o / Nxt — MCP clients including pending connections. */
  mcpClients?: readonly McpClientLike[] | null
  /**
   * densable I8() — full base tool list for "exists but not enabled" detection.
   * Defaults to getAllBaseTools(); tests inject a fixture list.
   */
  baseTools?: Tools
  /** densable EL — REPL mode gate. Defaults to isReplModeEnabled(). */
  replModeEnabled?: boolean
  /**
   * densable VAt — when embedded search tools strip Glob/Grep from the registry.
   * Defaults to hasEmbeddedSearchTools().
   */
  embeddedSearchTools?: boolean
  /**
   * densable M6e — tools forbidden inside subagents.
   * Defaults to ALL_AGENT_DISALLOWED_TOOLS.
   */
  agentDisallowedTools?: ReadonlySet<string>
}

/**
 * densable qcs — return a leading-dot hint string, or "" when no special case.
 * Caller appends to `No such tool available: ${name}${hint}`.
 */
export function formatToolNotFoundHint(args: ToolNotFoundHintArgs): string {
  const {
    toolName,
    availableTools,
    agentId,
    mcpClients,
    baseTools = getAllBaseTools(),
    replModeEnabled = isReplModeEnabled(),
    embeddedSearchTools = hasEmbeddedSearchTools(),
    agentDisallowedTools = ALL_AGENT_DISALLOWED_TOOLS,
  } = args

  // densable: EL()&&mCt.has(e)&&Tc(t,rg)
  if (
    replModeEnabled &&
    REPL_PRIMITIVE_TOOL_NAMES.has(toolName) &&
    findToolByName(availableTools, REPL_TOOL_NAME)
  ) {
    return `. ${toolName} is only available inside ${REPL_TOOL_NAME}. Use ${REPL_TOOL_NAME} with code: await ${toolName}({...}).`
  }

  // densable: i=Tc(I8(),e)
  const baseTool = findToolByName(baseTools, toolName)

  // densable: r&&i&&M6e.has(i.name)
  if (agentId && baseTool && agentDisallowedTools.has(baseTool.name)) {
    return `. ${toolName} is not available inside subagents. Complete the task with the tools provided and return findings to the orchestrator.`
  }

  // densable: i?.name===S2 (SendUserMessage / Brief)
  if (baseTool?.name === BRIEF_TOOL_NAME) {
    return `. ${toolName} is not enabled in this session \u2014 write your message as normal assistant text instead.`
  }

  // densable: if(i) exists-but-not-enabled
  if (baseTool) {
    return `. ${toolName} exists but is not enabled in this context. Use one of the available tools instead.`
  }

  // densable VAt(): Glob/Grep stripped when embedded search tools are on
  if (embeddedSearchTools && (toolName === GLOB_TOOL_NAME || toolName === GREP_TOOL_NAME)) {
    const label = toolName === GLOB_TOOL_NAME ? GLOB_TOOL_NAME : GREP_TOOL_NAME
    if (!findToolByName(availableTools, BASH_TOOL_NAME)) {
      return `. ${label} is not available in this context. Use one of the available tools instead.`
    }
    if (label === GLOB_TOOL_NAME) {
      return `. ${GLOB_TOOL_NAME} is not available in this session \u2014 find files with \`find\` via the ${BASH_TOOL_NAME} tool instead.`
    }
    return `. ${GREP_TOOL_NAME} is not available in this session \u2014 search file contents with \`grep\` via the ${BASH_TOOL_NAME} tool instead.`
  }

  // densable: s=r?"":lZg(...) — skip MCP pending hint inside subagents
  if (!agentId) {
    const mcpHint = formatPendingMcpServerHint(toolName, mcpClients)
    if (mcpHint) return mcpHint
  }

  return ''
}

/**
 * densable lZg — MCP server still connecting for mcp__server__tool names.
 */
export function formatPendingMcpServerHint(
  toolName: string,
  mcpClients?: readonly McpClientLike[] | null,
): string {
  const match = /^mcp__(.+?)__/.exec(toolName)
  if (!match) return ''
  const rawServer = match[1]
  if (!rawServer || !mcpClients || mcpClients.length === 0) return ''
  // densable Ots: only when some clients are pending
  const hasPending = mcpClients.some(c => c.type === 'pending')
  if (!hasPending) return ''

  const normalized = normalizeNameForMCP(rawServer)
  const pending = mcpClients.find(
    c =>
      c.type === 'pending' &&
      (c.name === rawServer || normalizeNameForMCP(c.name) === normalized),
  )
  if (!pending) return ''
  return `. The MCP server '${pending.name}' is still connecting. Call ${WAIT_FOR_MCP_SERVERS_TOOL_NAME} to wait for it, then try again.`
}
