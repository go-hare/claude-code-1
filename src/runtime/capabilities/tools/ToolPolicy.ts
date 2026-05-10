import {
  dedupeToolsByName,
  type Tool,
  toolMatchesName,
  type ToolPermissionContext,
  type Tools,
} from '../../../Tool.js'
import { ListMcpResourcesTool } from '@claude-code-best/builtin-tools/tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from '@claude-code-best/builtin-tools/tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import {
  REPL_ONLY_TOOLS,
  REPL_TOOL_NAME,
  isReplModeEnabled,
} from '@claude-code-best/builtin-tools/tools/REPLTool/constants.js'
import { getDenyRuleForTool } from '../../../utils/permissions/permissions.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { getAllBaseTools } from './ToolCatalog.js'

export { getAllBaseTools } from './ToolCatalog.js'

export const TOOL_PRESETS = ['default'] as const

export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function parseToolPreset(preset: string): ToolPreset | null {
  const presetString = preset.toLowerCase()
  if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {
    return null
  }
  return presetString as ToolPreset
}

export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map(tool => tool.name)
}

export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools: readonly T[], permissionContext: ToolPermissionContext): T[] {
  return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
}

export function getTools(
  permissionContext: ToolPermissionContext,
  simpleModeTools: Tools,
): Tools {
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return filterToolsByDenyRules(simpleModeTools, permissionContext)
  }

  const specialTools = new Set([
    ListMcpResourcesTool.name,
    ReadMcpResourceTool.name,
    SYNTHETIC_OUTPUT_TOOL_NAME,
  ])
  const tools = getAllBaseTools().filter(tool => !specialTools.has(tool.name))

  let allowedTools = filterToolsByDenyRules(tools, permissionContext)

  if (isReplModeEnabled()) {
    const replEnabled = allowedTools.some(tool =>
      toolMatchesName(tool, REPL_TOOL_NAME),
    )
    if (replEnabled) {
      allowedTools = allowedTools.filter(
        tool => !REPL_ONLY_TOOLS.has(tool.name),
      )
    }
  }

  const isEnabled = allowedTools.map(tool => tool.isEnabled())
  return allowedTools.filter((_, i) => isEnabled[i])
}

export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
  simpleModeTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext, simpleModeTools)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return dedupeToolsByName(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
  )
}

export function getMergedTools(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
  simpleModeTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext, simpleModeTools)
  return [...builtInTools, ...mcpTools]
}
