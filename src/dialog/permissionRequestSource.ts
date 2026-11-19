/**
 * densable xSl / Fhs — permission-dialog requestSource.
 *
 * Official 2.1.323 (#2090): `formatPermissionSourceName` sanitizes terminal
 * escapes, control characters, and invisible Unicode formatting characters
 * while preserving the full agent/workflow name without truncating or hiding
 * valid names.
 */
import { partiallySanitizeUnicode } from '../utils/sanitization.js'

const ANSI_ESCAPE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escape sequences
  /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-B]|[@-Z\\-_])/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ASCII control characters
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/g

export type PermissionRequestSource =
  | { type: 'remote-agent' }
  | {
      type: 'workflow-agent'
      workflowName?: string
      stoppableByKillAgents?: boolean
    }
  | {
      type: 'subagent'
      agentName?: string
      stoppableByKillAgents?: boolean
    }

/** Fields gold xSl reads off toolUseContext (not on the tip ToolUseContext type). */
export type PermissionRequestSourceContext = {
  forRemoteExecution?: boolean
  spawnedByWorkflowRunId?: string
  taskRegistry?: { all: () => Record<string, unknown> }
  agentContext?: {
    agentType?: string
    agentName?: string
    displayName?: string
    subagentName?: string
    isMainSession?: boolean
    isAsync?: boolean
  }
}

/**
 * Official 2.1.323 (#2090, `Fhs`/`LUf`): sanitize a subagent or workflow
 * source name for permission/plan dialog titles without truncating or hiding
 * legitimate agent names.
 */
export function formatPermissionSourceName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  let cleaned = name.replace(ANSI_ESCAPE_RE, '').replace(CONTROL_CHARS_RE, ' ')
  try {
    cleaned = partiallySanitizeUnicode(cleaned)
  } catch {
    // Keep ANSI/control-stripped text if Unicode normalization hits iteration cap
  }
  const normalized = cleaned.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : undefined
}

/**
 * densable xSl(e) — derive requestSource from toolUseContext.
 * Reads optional fields via the same cast style as permissionQueueBehind.
 * Does not fold ALS getAgentContext() into this path.
 */
export function resolvePermissionRequestSource(
  ctx: PermissionRequestSourceContext | undefined,
): PermissionRequestSource | undefined {
  if (!ctx) return undefined
  if (ctx.forRemoteExecution === true) {
    return { type: 'remote-agent' }
  }
  const stoppable =
    ctx.agentContext?.agentType === 'subagent' &&
    ctx.agentContext.isAsync === true
      ? { stoppableByKillAgents: true as const }
      : {}
  const workflowRunId = ctx.spawnedByWorkflowRunId
  if (workflowRunId !== undefined) {
    const all = ctx.taskRegistry?.all?.()
    let workflowName: string | undefined
    if (all && typeof all === 'object') {
      const match = Object.values(all).find(task => {
        if (typeof task !== 'object' || task === null) return false
        const row = task as {
          type?: unknown
          workflowRunId?: unknown
          workflowName?: unknown
        }
        return (
          row.type === 'local_workflow' && row.workflowRunId === workflowRunId
        )
      }) as { workflowName?: unknown } | undefined
      if (typeof match?.workflowName === 'string') {
        workflowName = match.workflowName
      }
    }
    return { type: 'workflow-agent', workflowName, ...stoppable }
  }
  const agent = ctx.agentContext
  if (!agent) return undefined
  if (agent.agentType === 'teammate') {
    return { type: 'subagent', agentName: agent.agentName }
  }
  // densable dQ(r)&&MZe(r): agentType==="subagent" && !isMainSession
  if (agent.agentType === 'subagent' && agent.isMainSession !== true) {
    return {
      type: 'subagent',
      agentName: agent.displayName ?? agent.subagentName,
      ...stoppable,
    }
  }
  return undefined
}

/**
 * densable G2e switch(Nmn?.type) copy. Named arms go through Fhs; unsanitized
 * names fall back to the generic phrase.
 */
export function formatRequestSourceLabel(
  source: PermissionRequestSource | undefined,
): string | undefined {
  switch (source?.type) {
    case 'workflow-agent': {
      const name = formatPermissionSourceName(source.workflowName)
      return name !== undefined
        ? `from the "${name}" workflow`
        : 'from a workflow'
    }
    case 'subagent': {
      const name = formatPermissionSourceName(source.agentName)
      return name !== undefined ? `from the ${name} agent` : 'from a subagent'
    }
    case 'remote-agent':
      return 'from a remote cloud agent'
    default:
      return undefined
  }
}
