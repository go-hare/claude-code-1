/**
 * Official workflowSizeGuideline config + attachment portable helpers.
 *
 * /config "Dynamic workflow size" stores a guideline (unrestricted | number).
 * When the guideline changes mid-session, emit workflow_size_guideline_change.
 * Caps feed evaluateWorkflowSizeWarning via guidelineAgents.
 */

export type WorkflowSizeGuideline =
  | 'unrestricted'
  | 'small'
  | 'medium'
  | 'large'
  | number

/** Map named guidelines to agent caps (official defaults). */
export function workflowSizeGuidelineToAgentCap(
  guideline: WorkflowSizeGuideline | undefined,
): number | undefined {
  if (guideline === undefined || guideline === 'unrestricted') return undefined
  if (typeof guideline === 'number') {
    return Number.isFinite(guideline) && guideline > 0
      ? Math.floor(guideline)
      : undefined
  }
  switch (guideline) {
    case 'small':
      return 5
    case 'medium':
      return 15
    case 'large':
      return 25
    default:
      return undefined
  }
}

export function formatWorkflowSizeGuidelineLabel(
  guideline: WorkflowSizeGuideline,
): string {
  if (typeof guideline === 'number') return `${guideline} agents max`
  return guideline
}

export function buildWorkflowSizeGuidelineChangeMessage(
  guideline: WorkflowSizeGuideline,
): string {
  return `The user has configured a workflow size guideline in /config: ${formatWorkflowSizeGuidelineLabel(guideline)}`
}

export function buildWorkflowSizeGuidelineUserChangeMessage(
  guideline: WorkflowSizeGuideline,
): string {
  return `The user changed their workflow size guideline in /config: ${formatWorkflowSizeGuidelineLabel(guideline)}`
}

export function parseWorkflowSizeGuideline(
  value: unknown,
): WorkflowSizeGuideline | undefined {
  if (
    value === 'unrestricted' ||
    value === 'small' ||
    value === 'medium' ||
    value === 'large'
  ) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = parseInt(value, 10)
    if (n > 0) return n
  }
  return undefined
}
