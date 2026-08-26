/**
 * densable 2.1.239 leftover — WebFetch readmission (GIe / Cgr / snt / kgr /
 * dpw / _tm). Injects WebFetch into a child tool pool when the session is
 * in web-fetch-agent mode and the child still needs the tool.
 *
 * storageV5 is not used.
 */

import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import {
  hasBuiltInWebFetchAgent,
  isBuiltInWebFetchAgent,
  isWebFetchAgentEnabled,
  shouldSkipTeammateSpawnForWebFetch,
  WEB_FETCH_AGENT_TYPE,
} from '@claude-code/builtin-tools/tools/AgentTool/built-in/webFetchAgent.js'
import { WebFetchTool } from '@claude-code/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import {
  toolMatchesName,
  type ToolPermissionContext,
  type Tools,
} from '../Tool.js'
import { getMainThreadAgentType } from '../bootstrap/state.js'
import { getAgentContext } from './agentContext.js'
import { permissionRuleValueFromString } from './permissions/permissionRuleParser.js'
import {
  getDenyRuleForAgent,
  getDenyRuleForTool,
} from './permissions/permissions.js'
import { resolveMaxSubagentSpawnDepth } from './sessionSpawnCaps.js'

/** Official `L$t`. */
export const SKILL_TOOL_NAME_PREFIX = 'skill__'

export type WebFetchToolSpec = {
  tools?: string[]
  disallowedTools?: string[]
}

export type WebFetchAdmissionOpts = {
  depth?: number
  allowedAgentTypes?: string[]
  activeAgents?: Array<{ agentType: string; source?: string }>
}

/** Official `snt`. */
export function parseAgentToolsWildcard(
  tools: string[] | undefined,
): { allowedAgentTypes?: string[] } | null {
  if (tools === undefined) return {}
  if (!tools.includes('*')) return null
  let allowed: string[] | undefined
  for (const entry of tools) {
    if (entry === '*') continue
    const { toolName, ruleContent } = permissionRuleValueFromString(entry)
    if (toolName !== AGENT_TOOL_NAME || !ruleContent) return null
    allowed ??= []
    allowed.push(
      ...ruleContent
        .split(',')
        .map(part => part.trim())
        .filter(Boolean),
    )
  }
  return allowed ? { allowedAgentTypes: allowed } : {}
}

/** Official `kgr`. */
export function toolsListMentions(
  tools: string[] | undefined,
  toolName: string,
): boolean {
  return (
    tools?.some(
      entry => permissionRuleValueFromString(entry).toolName === toolName,
    ) ?? false
  )
}

/** Official `WC` — main/undefined is depth 0. */
export function agentContextSpawnDepth(
  context:
    | {
        agentType?: string
        depth?: number
      }
    | undefined,
): number {
  if (!context || context.agentType === 'main') return 0
  return context.depth ?? 0
}

/** Official `Cgr`. */
export function canAdmitWebFetchViaAgent(
  tools: Tools,
  permissionContext: ToolPermissionContext,
  { depth = 0, allowedAgentTypes, activeAgents }: WebFetchAdmissionOpts = {},
): boolean {
  return (
    isWebFetchAgentEnabled() &&
    (activeAgents === undefined || hasBuiltInWebFetchAgent(activeAgents)) &&
    tools.some(tool => toolMatchesName(tool, AGENT_TOOL_NAME)) &&
    !getDenyRuleForTool(permissionContext, { name: AGENT_TOOL_NAME }) &&
    !getDenyRuleForAgent(
      permissionContext,
      AGENT_TOOL_NAME,
      WEB_FETCH_AGENT_TYPE,
    ) &&
    depth < resolveMaxSubagentSpawnDepth() &&
    (allowedAgentTypes === undefined ||
      allowedAgentTypes.includes(WEB_FETCH_AGENT_TYPE))
  )
}

/** Official `GIe` — splice WebFetch in before MCP / skill__ / later-sorted tools. */
export function admitWebFetchTool(
  spec: WebFetchToolSpec | undefined,
  tools: Tools,
  permissionContext: ToolPermissionContext,
  opts: WebFetchAdmissionOpts = {},
): Tools {
  const listed = spec?.tools
  const disallowed = spec?.disallowedTools
  const wildcard = parseAgentToolsWildcard(listed)
  const needsReadmission =
    toolsListMentions(listed, WEB_FETCH_TOOL_NAME) ||
    (wildcard !== null &&
      !toolsListMentions(disallowed, WEB_FETCH_TOOL_NAME) &&
      (toolsListMentions(disallowed, AGENT_TOOL_NAME) ||
        (wildcard.allowedAgentTypes !== undefined &&
          !wildcard.allowedAgentTypes.includes(WEB_FETCH_AGENT_TYPE)) ||
        (opts.depth ?? 0) >= resolveMaxSubagentSpawnDepth()))
  if (
    !needsReadmission ||
    tools.some(tool => tool.name === WEB_FETCH_TOOL_NAME) ||
    !canAdmitWebFetchViaAgent(tools, permissionContext, {
      activeAgents: opts.activeAgents,
    }) ||
    getDenyRuleForTool(permissionContext, WebFetchTool) ||
    !WebFetchTool.isEnabled()
  ) {
    return tools
  }
  let insertAt = tools.findIndex(
    tool =>
      tool.isMcp ||
      tool.name.startsWith(SKILL_TOOL_NAME_PREFIX) ||
      tool.name.localeCompare(WEB_FETCH_TOOL_NAME) > 0,
  )
  if (insertAt === -1) insertAt = tools.length
  return tools.toSpliced(insertAt, 0, WebFetchTool)
}

/**
 * Official `dpw` — true means "do not readmit" (S = !dpw).
 * Missing ALS is `{agentType:"main"}`. Official `OB()` is
 * `getMainThreadAgentType()`.
 */
export function isWebFetchReadmissionDenied(context: {
  options: {
    agentDefinitions: {
      activeAgents: Array<{
        agentType: string
        tools?: string[]
        disallowedTools?: string[]
      }>
    }
  }
}): boolean {
  const agentContext = getAgentContext() ?? { agentType: 'main' as const }
  let agentTypeName: string | undefined
  if (agentContext.agentType === 'subagent') {
    agentTypeName = agentContext.subagentName
  } else if (agentContext.agentType === 'main') {
    agentTypeName = getMainThreadAgentType()
    if (agentTypeName === undefined) return false
  } else {
    return true
  }
  const definition = context.options.agentDefinitions.activeAgents.find(
    agent => agent.agentType === agentTypeName,
  )
  if (definition === undefined) return true
  const listed = definition.tools
  return (
    toolsListMentions(definition.disallowedTools, WEB_FETCH_TOOL_NAME) ||
    (parseAgentToolsWildcard(listed) === null &&
      !toolsListMentions(listed, WEB_FETCH_TOOL_NAME))
  )
}

/** Official `_tm`. */
export function webFetchHookBlockedHint(
  toolName: string,
  input: unknown,
  tools: Tools,
  permissionContext: ToolPermissionContext,
  opts: WebFetchAdmissionOpts,
): string {
  const subagentType =
    typeof input === 'object' && input !== null && 'subagent_type' in input
      ? (input as { subagent_type?: unknown }).subagent_type
      : undefined
  if (
    toolName !== AGENT_TOOL_NAME ||
    (subagentType !== WEB_FETCH_AGENT_TYPE &&
      !shouldSkipTeammateSpawnForWebFetch(
        typeof subagentType === 'string' ? subagentType : undefined,
        opts.activeAgents,
      )) ||
    tools.some(tool => toolMatchesName(tool, WEB_FETCH_TOOL_NAME)) ||
    !canAdmitWebFetchViaAgent(tools, permissionContext, opts)
  ) {
    return ''
  }
  return `

Web pages can only be fetched through the ${WEB_FETCH_AGENT_TYPE} agent in this session (there is no direct ${WEB_FETCH_TOOL_NAME} tool), so while this hook blocks it there is no other way to fetch them. If the page is required, tell the user; a hook that means to allow web fetching can exempt tool_input.subagent_type == "${WEB_FETCH_AGENT_TYPE}" — a name match, which a project, user, or plugin agent defined under that same name would also pass with whatever tools it declares, so it fits only where no such agent is defined.`
}

export function filterWebFetchFromForkBase<
  T extends { agentType: string; source?: string },
>(agents: T[]): T[] {
  return agents.filter(agent => !isBuiltInWebFetchAgent(agent))
}
