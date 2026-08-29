/**
 * densable xSl / Fhs — permission-dialog requestSource.
 *
 * Gold 2.1.236 `xSl(toolUseContext)` (gold-iK.txt) + 2.1.239 G2e/Fhs
 * (gold-wide-nlg.txt). Fhs wraps LUf; LUf needs WPi/zPi/oge whose bodies
 * are not dumped — return undefined (G2e fallback copy) rather than
 * interpolating unsanitized names.
 */
export type PermissionRequestSource =
  | { type: 'remote-agent' }
  | { type: 'workflow-agent'; workflowName?: string }
  | { type: 'subagent'; agentName?: string }

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
  }
}

/**
 * densable Fhs(e){let t=LUf(e);return t===null?void 0:String(t)}
 * LUf sanitizer chain is not dumped — treat as null.
 */
export function formatPermissionSourceName(_name: unknown): string | undefined {
  return undefined
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
    return { type: 'workflow-agent', workflowName }
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
