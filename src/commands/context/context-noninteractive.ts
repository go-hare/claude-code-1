import { feature } from 'bun:bundle'
import { microcompactMessages } from '../../services/compact/microCompact.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Tools, ToolUseContext } from '../../Tool.js'
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../../types/message.js'
import {
  analyzeContextUsage,
  type ContextData,
} from '../../utils/analyzeContext.js'
import { formatContextOverLimitWarning } from '../../utils/contextOverLimit.js'
import { formatTokens } from '../../utils/format.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getSourceDisplayName } from '../../utils/settings/constants.js'
import { plural } from '../../utils/stringUtils.js'

/**
 * Shared data-collection path for `/context` (slash command) and the SDK
 * `get_context_usage` control request. Mirrors query.ts's pre-API transforms
 * (compact boundary, projectView, microcompact) so the token count reflects
 * what the model actually sees.
 */
type CollectContextDataInput = {
  messages: Message[]
  getAppState: () => AppState
  options: {
    mainLoopModel: string
    tools: Tools
    agentDefinitions: AgentDefinitionsResult
    customSystemPrompt?: string
    appendSystemPrompt?: string
  }
}

export async function collectContextData(
  context: CollectContextDataInput,
): Promise<ContextData> {
  const {
    messages,
    getAppState,
    options: {
      mainLoopModel,
      tools,
      agentDefinitions,
      customSystemPrompt,
      appendSystemPrompt,
    },
  } = context

  let apiView = getMessagesAfterCompactBoundary(messages)
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { projectView } =
      require('../../services/contextCollapse/operations.js') as typeof import('../../services/contextCollapse/operations.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    apiView = projectView(apiView)
  }

  const { messages: compactedMessages } = await microcompactMessages(apiView)
  const appState = getAppState()

  return analyzeContextUsage(
    compactedMessages,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    agentDefinitions,
    undefined, // terminalWidth
    // analyzeContextUsage only reads options.{customSystemPrompt,appendSystemPrompt}
    // but its signature declares the full Pick<ToolUseContext, 'options'>.
    { options: { customSystemPrompt, appendSystemPrompt } } as Pick<
      ToolUseContext,
      'options'
    >,
    undefined, // mainThreadAgentDefinition
    apiView, // original messages for API usage extraction
  )
}

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<{ type: 'text'; value: string }> {
  const data = await collectContextData(context)
  return {
    type: 'text' as const,
    value: formatContextAsMarkdownTable(data),
  }
}

const CONTEXT_TABLE_ROW_CAP = 10

function boundContextRows<T extends { tokens: number }>(
  items: readonly T[],
  isBounded: boolean,
  format: (tokens: number) => string = formatTokens,
): { kept: readonly T[]; moreRow: string } {
  if (!isBounded || items.length <= CONTEXT_TABLE_ROW_CAP) {
    return { kept: items, moreRow: '' }
  }
  const sorted = [...items].sort((a, b) => b.tokens - a.tokens)
  const rest = sorted.slice(CONTEXT_TABLE_ROW_CAP)
  const restTokens = rest.reduce((sum, item) => sum + item.tokens, 0)
  return {
    kept: sorted.slice(0, CONTEXT_TABLE_ROW_CAP),
    moreRow: `| and ${rest.length} more |  | ${format(restTokens)} |\n`,
  }
}

function summarizeUnloadedMcpToolsByServer(
  mcpTools: ContextData['mcpTools'],
): Array<{ serverName: string; count: number; tokens: number }> {
  const byServer = new Map<string, { count: number; tokens: number }>()
  for (const tool of mcpTools) {
    if (tool.isLoaded === false) {
      const prev = byServer.get(tool.serverName)
      byServer.set(tool.serverName, {
        count: (prev?.count ?? 0) + 1,
        tokens: (prev?.tokens ?? 0) + tool.tokens,
      })
    }
  }
  return Array.from(byServer, ([serverName, info]) => ({
    serverName,
    count: info.count,
    tokens: info.tokens,
  }))
}

export function formatContextAsMarkdownTable(
  data: ContextData,
  options?: { isBounded?: boolean; isTotalEstimated?: boolean },
): string {
  const isBounded = options?.isBounded ?? false
  const isTotalEstimated = options?.isTotalEstimated ?? false
  const {
    categories,
    totalTokens,
    rawMaxTokens,
    percentage,
    model,
    memoryFiles,
    mcpTools,
    agents,
    skills,
    messageBreakdown,
    systemTools,
    systemPromptSections,
  } = data

  let output = `## Context Usage\n\n`
  output += `**Model:** ${model}  \n`
  output += `**Tokens:** ${formatTokens(totalTokens)} / ${formatTokens(rawMaxTokens)} (${percentage}%)\n`
  // densable Ftn / $tn — markdown path includes Over limit line
  const overLimit = formatContextOverLimitWarning({
    totalTokens,
    rawMaxTokens,
    autocompactSource: data.autocompactSource,
  })
  if (overLimit) {
    output += `**Over limit:** ${overLimit}\n`
  }

  // Context-collapse status. Always show when the runtime gate is on —
  // the user needs to know which strategy is managing their context
  // even before anything has fired.
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getStats, isContextCollapseEnabled } =
      require('../../services/contextCollapse/index.js') as typeof import('../../services/contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      const s = getStats()
      const { health: h } = s

      const parts = []
      if (s.collapsedSpans > 0) {
        parts.push(
          `${s.collapsedSpans} ${plural(s.collapsedSpans, 'span')} summarized (${s.collapsedMessages} messages)`,
        )
      }
      if (s.stagedSpans > 0) parts.push(`${s.stagedSpans} staged`)
      const summary =
        parts.length > 0
          ? parts.join(', ')
          : h.totalSpawns > 0
            ? `${h.totalSpawns} ${plural(h.totalSpawns, 'spawn')}, nothing staged yet`
            : 'waiting for first trigger'
      output += `**Context strategy:** collapse (${summary})\n`

      if (h.totalErrors > 0) {
        output += `**Collapse errors:** ${h.totalErrors}/${h.totalSpawns} spawns failed`
        if (h.lastError) {
          output += ` (last: ${h.lastError.slice(0, 80)})`
        }
        output += '\n'
      } else if (h.emptySpawnWarningEmitted) {
        output += `**Collapse idle:** ${h.totalEmptySpawns} consecutive empty runs\n`
      }
    }
  }
  output += '\n'
  if (isTotalEstimated) {
    output += 'This token count is an estimate.\n\n'
  }

  // Main categories table
  const visibleCategories = categories.filter(
    cat =>
      cat.tokens > 0 &&
      cat.name !== 'Free space' &&
      cat.name !== 'Autocompact buffer',
  )

  if (visibleCategories.length > 0) {
    output += `### Estimated usage by category\n\n`
    output += `| Category | Tokens | Percentage |\n`
    output += `|----------|--------|------------|\n`

    for (const cat of visibleCategories) {
      const percentDisplay = ((cat.tokens / rawMaxTokens) * 100).toFixed(1)
      output += `| ${cat.name} | ${formatTokens(cat.tokens)} | ${percentDisplay}% |\n`
    }

    const freeSpaceCategory = categories.find(c => c.name === 'Free space')
    if (freeSpaceCategory && freeSpaceCategory.tokens > 0) {
      const percentDisplay = (
        (freeSpaceCategory.tokens / rawMaxTokens) *
        100
      ).toFixed(1)
      output += `| Free space | ${formatTokens(freeSpaceCategory.tokens)} | ${percentDisplay}% |\n`
    }

    const autocompactCategory = categories.find(
      c => c.name === 'Autocompact buffer',
    )
    if (autocompactCategory && autocompactCategory.tokens > 0) {
      const percentDisplay = (
        (autocompactCategory.tokens / rawMaxTokens) *
        100
      ).toFixed(1)
      output += `| Autocompact buffer | ${formatTokens(autocompactCategory.tokens)} | ${percentDisplay}% |\n`
    }

    output += `\n`
  }

  // MCP tools (official Dyr #1802: top-10 bounded + unloaded grouped by server)
  const hasDeferredMcp =
    isBounded &&
    categories.some(cat => cat.isDeferred && cat.name.includes('MCP'))
  const loadedMcpTools = hasDeferredMcp
    ? mcpTools.filter(tool => tool.isLoaded !== false)
    : mcpTools
  if (loadedMcpTools.length > 0) {
    const { kept, moreRow } = boundContextRows(loadedMcpTools, isBounded)
    output += `### MCP Tools\n\n`
    output += `| Tool | Server | Tokens |\n`
    output += `|------|--------|--------|\n`
    for (const tool of kept) {
      output += `| ${tool.name} | ${tool.serverName} | ${formatTokens(tool.tokens)} |\n`
    }
    output += moreRow
    output += `\n`
  }

  if (hasDeferredMcp) {
    const byServer = summarizeUnloadedMcpToolsByServer(mcpTools)
    if (byServer.length > 0) {
      const { kept, moreRow } = boundContextRows(byServer, isBounded)
      output += `### Other MCP tools, by server\n\n`
      output += `| Server | Tools | Tokens if all were loaded |\n`
      output += `|--------|-------|---------------------------|\n`
      for (const row of kept) {
        output += `| ${row.serverName} | ${row.count} | ${formatTokens(row.tokens)} |\n`
      }
      output += moreRow
      output += `\n`
    }
  }

  // System tools (ant-only)
  if (
    systemTools &&
    systemTools.length > 0 &&
    process.env.USER_TYPE === 'ant'
  ) {
    output += `### [ANT-ONLY] System Tools\n\n`
    output += `| Tool | Tokens |\n`
    output += `|------|--------|\n`
    for (const tool of systemTools) {
      output += `| ${tool.name} | ${formatTokens(tool.tokens)} |\n`
    }
    output += `\n`
  }

  // System prompt sections (ant-only)
  if (
    systemPromptSections &&
    systemPromptSections.length > 0 &&
    process.env.USER_TYPE === 'ant'
  ) {
    output += `### [ANT-ONLY] System Prompt Sections\n\n`
    output += `| Section | Tokens |\n`
    output += `|---------|--------|\n`
    for (const section of systemPromptSections) {
      output += `| ${section.name} | ${formatTokens(section.tokens)} |\n`
    }
    output += `\n`
  }

  // Custom agents
  if (agents.length > 0) {
    const { kept, moreRow } = boundContextRows(agents, isBounded)
    output += `### Custom Agents\n\n`
    output += `| Agent Type | Source | Tokens |\n`
    output += `|------------|--------|--------|\n`
    for (const agent of kept) {
      let sourceDisplay: string
      switch (agent.source) {
        case 'projectSettings':
          sourceDisplay = 'Project'
          break
        case 'userSettings':
          sourceDisplay = 'User'
          break
        case 'localSettings':
          sourceDisplay = 'Local'
          break
        case 'flagSettings':
          sourceDisplay = 'Flag'
          break
        case 'policySettings':
          sourceDisplay = 'Policy'
          break
        case 'plugin':
          sourceDisplay = 'Plugin'
          break
        case 'built-in':
          sourceDisplay = 'Built-in'
          break
        default:
          sourceDisplay = String(agent.source)
      }
      output += `| ${agent.agentType} | ${sourceDisplay} | ${formatTokens(agent.tokens)} |\n`
    }
    output += moreRow
    output += `\n`
  }

  // Memory files
  if (memoryFiles.length > 0) {
    const { kept, moreRow } = boundContextRows(memoryFiles, isBounded)
    output += `### Memory Files\n\n`
    output += `| Type | Path | Tokens |\n`
    output += `|------|------|--------|\n`
    for (const file of kept) {
      output += `| ${file.type} | ${file.path} | ${formatTokens(file.tokens)} |\n`
    }
    output += moreRow
    output += `\n`
  }

  // Skills
  if (skills && skills.tokens > 0 && skills.skillFrontmatter.length > 0) {
    const { kept, moreRow } = boundContextRows(
      skills.skillFrontmatter,
      isBounded,
    )
    output += `### Skills\n\n`
    output += `| Skill | Source | Tokens |\n`
    output += `|-------|--------|--------|\n`
    for (const skill of kept) {
      output += `| ${skill.name} | ${getSourceDisplayName(skill.source)} | ${formatTokens(skill.tokens)} |\n`
    }
    output += moreRow
    output += `\n`
  }

  // Message breakdown (ant-only)
  if (messageBreakdown && process.env.USER_TYPE === 'ant') {
    output += `### [ANT-ONLY] Message Breakdown\n\n`
    output += `| Category | Tokens |\n`
    output += `|----------|--------|\n`
    output += `| Tool calls | ${formatTokens(messageBreakdown.toolCallTokens)} |\n`
    output += `| Tool results | ${formatTokens(messageBreakdown.toolResultTokens)} |\n`
    output += `| Attachments | ${formatTokens(messageBreakdown.attachmentTokens)} |\n`
    output += `| Assistant messages (non-tool) | ${formatTokens(messageBreakdown.assistantMessageTokens)} |\n`
    output += `| User messages (non-tool-result) | ${formatTokens(messageBreakdown.userMessageTokens)} |\n`
    output += `\n`

    if (messageBreakdown.toolCallsByType.length > 0) {
      output += `#### Top Tools\n\n`
      output += `| Tool | Call Tokens | Result Tokens |\n`
      output += `|------|-------------|---------------|\n`
      for (const tool of messageBreakdown.toolCallsByType) {
        output += `| ${tool.name} | ${formatTokens(tool.callTokens)} | ${formatTokens(tool.resultTokens)} |\n`
      }
      output += `\n`
    }

    if (messageBreakdown.attachmentsByType.length > 0) {
      output += `#### Top Attachments\n\n`
      output += `| Attachment | Tokens |\n`
      output += `|------------|--------|\n`
      for (const attachment of messageBreakdown.attachmentsByType) {
        output += `| ${attachment.name} | ${formatTokens(attachment.tokens)} |\n`
      }
      output += `\n`
    }
  }

  return output
}
