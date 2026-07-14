/**
 * Official workflow size warning (z9p / r$o portable).
 *
 * When a workflow schedules too many agents or projects too many tokens,
 * emit a size-guideline warning. Caps resolve:
 *   env > workflowSizeGuideline config > GB tengu_workflow_size_gantry > defaults.
 */

export const WORKFLOW_SIZE_WARNING_AGENTS_DEFAULT = 25
export const WORKFLOW_SIZE_WARNING_TOKENS_DEFAULT = 1_500_000
/** Official reb — tokens-per-started-agent projection factor. */
export const WORKFLOW_SIZE_TOKENS_PER_STARTED_DEFAULT = 70_000

export type WorkflowSizeWarningAxis = 'agents' | 'tokens' | 'both'

export type WorkflowSizeWarning = {
  axis: WorkflowSizeWarningAxis
  scheduledAgents: number
  totalTokens: number
  projectedTokens: number
  agentCap: number
  tokenCap: number
  /** True when agent cap came from guideline (not env override). */
  capFromGuideline: boolean
}

/** Official r$o — positive finite number or undefined. */
export function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

export function parsePositiveEnvNumber(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return positiveFiniteNumber(n)
}

/**
 * Official z9p pure body.
 * @param startedAgents used for projection ratio (totalTokens/startedAgents).
 * @param gbConfig optional `tengu_workflow_size_gantry` subset `{enabled?, agents?, tokens?}`.
 * @param guidelineAgents optional agents cap from globalConfig.workflowSizeGuideline.
 */
export function evaluateWorkflowSizeWarning(input: {
  scheduledAgents: number
  startedAgents: number
  totalTokens: number
  env?: NodeJS.ProcessEnv
  gbConfig?: { enabled?: boolean; agents?: number; tokens?: number } | null
  guidelineAgents?: number
  tokensPerStartedDefault?: number
}): WorkflowSizeWarning | null {
  const gb = input.gbConfig
  if (gb?.enabled === false) return null

  const env = input.env ?? process.env
  const envAgents = parsePositiveEnvNumber(
    env.CLAUDE_CODE_WORKFLOW_SIZE_WARNING_AGENTS,
  )
  const envTokens = parsePositiveEnvNumber(
    env.CLAUDE_CODE_WORKFLOW_SIZE_WARNING_TOKENS,
  )
  const agentCap =
    envAgents ??
    positiveFiniteNumber(input.guidelineAgents) ??
    positiveFiniteNumber(gb?.agents) ??
    WORKFLOW_SIZE_WARNING_AGENTS_DEFAULT
  const tokenCap =
    envTokens ??
    positiveFiniteNumber(gb?.tokens) ??
    WORKFLOW_SIZE_WARNING_TOKENS_DEFAULT

  const ratio =
    input.startedAgents > 0
      ? input.totalTokens / input.startedAgents
      : (input.tokensPerStartedDefault ??
        WORKFLOW_SIZE_TOKENS_PER_STARTED_DEFAULT)
  const projectedTokens = Math.max(
    input.totalTokens,
    Math.round(ratio * input.scheduledAgents),
  )

  const agentsOver = input.scheduledAgents > agentCap
  const tokensOver = input.totalTokens > tokenCap || projectedTokens > tokenCap
  if (!agentsOver && !tokensOver) return null

  return {
    axis: agentsOver && tokensOver ? 'both' : agentsOver ? 'agents' : 'tokens',
    scheduledAgents: input.scheduledAgents,
    totalTokens: input.totalTokens,
    projectedTokens,
    agentCap,
    tokenCap,
    capFromGuideline:
      agentsOver &&
      envAgents === undefined &&
      input.guidelineAgents !== undefined,
  }
}

export function formatWorkflowSizeWarningMessage(
  w: WorkflowSizeWarning,
): string {
  const parts: string[] = []
  if (w.axis === 'agents' || w.axis === 'both') {
    parts.push(`${w.scheduledAgents} scheduled agents (cap ${w.agentCap})`)
  }
  if (w.axis === 'tokens' || w.axis === 'both') {
    parts.push(
      `${w.totalTokens} tokens / projected ${w.projectedTokens} (cap ${w.tokenCap})`,
    )
  }
  return `Workflow size warning: ${parts.join('; ')}.`
}
