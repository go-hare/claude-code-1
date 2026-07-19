/**
 * Official workflowSizeGuideline config + attachment portable helpers.
 *
 * densable Qit/H5u/D5u/I5u/hss/gss/Uao:
 * - /config stores unrestricted|small|medium|large (or numeric fork extension)
 * - When the guideline changes mid-session, emit workflow_size_guideline_change
 * - Caps feed evaluateWorkflowSizeWarning via guidelineAgents
 */

export type WorkflowSizeGuideline =
  | 'unrestricted'
  | 'small'
  | 'medium'
  | 'large'
  | number

/** densable named size used on attachment.size (Qit output). */
export type WorkflowSizeGuidelineNamed =
  | 'unrestricted'
  | 'small'
  | 'medium'
  | 'large'

/**
 * densable Uao — agent caps for named guidelines.
 * Official 2.1.211: small=5, medium=15, large=50.
 */
export const WORKFLOW_SIZE_GUIDELINE_CAPS = {
  small: 5,
  medium: 15,
  large: 50,
} as const

/** densable session baseline (yss) — first Qit(config) this process. */
let sessionBaselineNamed: WorkflowSizeGuidelineNamed | undefined

/** Test-only: reset densable H5u session baseline. */
export function _resetWorkflowSizeGuidelineSessionBaselineForTests(): void {
  sessionBaselineNamed = undefined
}

/**
 * densable Qit — normalize config value to named size for attachment compare.
 * Non-named (numbers, unknown) → unrestricted.
 */
export function normalizeWorkflowSizeGuidelineNamed(
  guideline: WorkflowSizeGuideline | undefined,
): WorkflowSizeGuidelineNamed {
  if (
    guideline === 'small' ||
    guideline === 'medium' ||
    guideline === 'large'
  ) {
    return guideline
  }
  return 'unrestricted'
}

/**
 * densable H5u — session baseline size (first seen config this process).
 * Subsequent D5u compares live config against last attachment size ?? baseline.
 */
export function getWorkflowSizeGuidelineSessionBaseline(
  guideline: WorkflowSizeGuideline | undefined,
): WorkflowSizeGuidelineNamed {
  if (sessionBaselineNamed === undefined) {
    sessionBaselineNamed = normalizeWorkflowSizeGuidelineNamed(guideline)
  }
  return sessionBaselineNamed
}

/** densable hss — human label with agent cap for named sizes. */
export function formatWorkflowSizeGuidelineNamedLabel(
  size: WorkflowSizeGuidelineNamed | string | number,
): string {
  if (size === 'small' || size === 'medium' || size === 'large') {
    return `${size} — keep workflows under ${WORKFLOW_SIZE_GUIDELINE_CAPS[size]} agents`
  }
  return String(size)
}

/** densable gss */
export function workflowSizeGuidelineSoftNote(): string {
  return "This is a guideline, not a hard limit — follow it unless the user's prompt calls for a different scale."
}

/**
 * densable I5u — meta body for workflow_size_guideline_change attachment.
 */
export function buildWorkflowSizeGuidelineUserChangeMessage(
  size: WorkflowSizeGuidelineNamed,
): string {
  if (size === 'unrestricted') {
    return 'The user removed their workflow size guideline in /config — workflow size is unrestricted again.'
  }
  return `The user changed their workflow size guideline in /config: ${formatWorkflowSizeGuidelineNamedLabel(size)}. ${workflowSizeGuidelineSoftNote()}`
}

/**
 * densable D5u — emit change attachment when live config differs from last
 * attachment size (or session baseline if none yet).
 *
 * `messages` are prior conversation messages; scan newest→oldest for the last
 * workflow_size_guideline_change attachment.
 */
export function getWorkflowSizeGuidelineChangeAttachments(
  messages: ReadonlyArray<{
    type?: string
    attachment?: { type?: string; size?: string }
  }>,
  guideline: WorkflowSizeGuideline | undefined,
): Array<{
  type: 'workflow_size_guideline_change'
  size: WorkflowSizeGuidelineNamed
}> {
  const current = normalizeWorkflowSizeGuidelineNamed(guideline)
  let last: WorkflowSizeGuidelineNamed | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m?.type === 'attachment' &&
      m.attachment?.type === 'workflow_size_guideline_change' &&
      typeof m.attachment.size === 'string'
    ) {
      last = normalizeWorkflowSizeGuidelineNamed(
        m.attachment.size as WorkflowSizeGuideline,
      )
      break
    }
  }
  const previous = last ?? getWorkflowSizeGuidelineSessionBaseline(guideline)
  if (current !== previous) {
    return [{ type: 'workflow_size_guideline_change', size: current }]
  }
  return []
}

/** Map named guidelines to agent caps (densable Uao + numeric fork). */
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
      return WORKFLOW_SIZE_GUIDELINE_CAPS.small
    case 'medium':
      return WORKFLOW_SIZE_GUIDELINE_CAPS.medium
    case 'large':
      return WORKFLOW_SIZE_GUIDELINE_CAPS.large
    default:
      return undefined
  }
}

export function formatWorkflowSizeGuidelineLabel(
  guideline: WorkflowSizeGuideline,
): string {
  if (typeof guideline === 'number') return `${guideline} agents max`
  if (
    guideline === 'small' ||
    guideline === 'medium' ||
    guideline === 'large'
  ) {
    return formatWorkflowSizeGuidelineNamedLabel(guideline)
  }
  return guideline
}

/** densable _ss — initial Workflow tool prompt appendix when baseline is restricted. */
export function buildWorkflowSizeGuidelineConfigAppendix(
  guideline: WorkflowSizeGuideline | undefined,
): string {
  const size = getWorkflowSizeGuidelineSessionBaseline(guideline)
  if (size !== 'unrestricted') {
    return `\n\nThe user has configured a workflow size guideline in /config: ${formatWorkflowSizeGuidelineNamedLabel(size)}. ${workflowSizeGuidelineSoftNote()}`
  }
  return ''
}

/** @deprecated prefer buildWorkflowSizeGuidelineUserChangeMessage / ConfigAppendix */
export function buildWorkflowSizeGuidelineChangeMessage(
  guideline: WorkflowSizeGuideline,
): string {
  return `The user has configured a workflow size guideline in /config: ${formatWorkflowSizeGuidelineLabel(guideline)}`
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
