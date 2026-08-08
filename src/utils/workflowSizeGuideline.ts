/**
 * Official workflowSizeGuideline config + attachment portable helpers.
 *
 * /config "Dynamic workflow size" stores a guideline (unrestricted | number).
 * When the guideline changes mid-session, emit workflow_size_guideline_change.
 * Caps feed evaluateWorkflowSizeWarning via guidelineAgents.
 *
 * densable 2.1.219 #5: settings file `workflowSizeGuideline` takes precedence
 * over /config and hides the /config row (YNt).
 */

import { getInitialSettings } from './settings/settings.js'

export type WorkflowSizeGuideline =
  | 'unrestricted'
  | 'small'
  | 'medium'
  | 'large'
  | number

/** densable `cLs` — /config enum options only (not free-form numbers). */
export const WORKFLOW_SIZE_GUIDELINE_ENUM_OPTIONS = [
  'unrestricted',
  'small',
  'medium',
  'large',
] as const

export type WorkflowSizeGuidelineEnum =
  (typeof WORKFLOW_SIZE_GUIDELINE_ENUM_OPTIONS)[number]

/** densable `nEd` / DEFAULT medium enum (settings enum set). */
export const DEFAULT_WORKFLOW_SIZE_GUIDELINE_ENUM: WorkflowSizeGuidelineEnum =
  'medium'

/** densable `Vsn` — accept only enum tokens for /config. */
export function parseWorkflowSizeGuidelineEnum(
  value: unknown,
): WorkflowSizeGuidelineEnum | undefined {
  return WORKFLOW_SIZE_GUIDELINE_ENUM_OPTIONS.find(t => t === value)
}

/**
 * densable `YNt` — true when a settings file (merged settings, not
 * globalConfig /config choice) provides `workflowSizeGuideline`.
 * When true, /config row is hidden.
 */
export function isWorkflowSizeGuidelineProvidedBySettings(): boolean {
  return getInitialSettings()?.workflowSizeGuideline !== undefined
}

/**
 * densable `Mft` — settings file wins over /config globalConfig value;
 * unset → medium default with isDefault.
 */
export function resolveSessionWorkflowSizeGuideline(
  globalConfigValue: WorkflowSizeGuideline | undefined | null,
): { size: WorkflowSizeGuidelineEnum; isDefault: boolean } {
  const fromSettings = parseWorkflowSizeGuidelineEnum(
    getInitialSettings()?.workflowSizeGuideline,
  )
  const fromConfig = parseWorkflowSizeGuidelineEnum(globalConfigValue)
  const resolved = fromSettings ?? fromConfig
  if (resolved === undefined) {
    return { size: DEFAULT_WORKFLOW_SIZE_GUIDELINE_ENUM, isDefault: true }
  }
  return { size: resolved, isDefault: false }
}

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
      // densable 2.1.219: "medium" (the default) fewer than 15
      return 15
    case 'large':
      // densable 2.1.219: "large" fewer than 50 (was 25 locally)
      return 50
    default:
      return undefined
  }
}

/**
 * densable 2.1.219 #18 — dynamic workflows default to medium (&lt;15 agents)
 * when neither settings nor /config has set a guideline.
 */
export const DEFAULT_WORKFLOW_SIZE_GUIDELINE: WorkflowSizeGuideline =
  DEFAULT_WORKFLOW_SIZE_GUIDELINE_ENUM

export function resolveWorkflowSizeGuideline(
  guideline: WorkflowSizeGuideline | undefined | null,
): WorkflowSizeGuideline {
  return guideline ?? DEFAULT_WORKFLOW_SIZE_GUIDELINE
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

/**
 * densable `iEd` — "medium — keep workflows under 15 agents".
 */
export function formatWorkflowSizeGuidelineKeepUnder(
  guideline: WorkflowSizeGuidelineEnum,
): string {
  const cap = workflowSizeGuidelineToAgentCap(guideline)
  if (cap === undefined) return guideline
  return `${guideline} — keep workflows under ${cap} agents`
}

/**
 * densable `sEd` — shared guideline disclaimer.
 */
export function workflowSizeGuidelineDisclaimer(): string {
  return "This is a guideline, not a hard limit — follow it unless the user's prompt calls for a different scale."
}

/**
 * densable `aEd` — full status sentence for default vs configured guideline.
 * Used on running-workflow tool prompt/description (#21).
 */
export function buildWorkflowSizeGuidelineStatusMessage(
  guideline: WorkflowSizeGuidelineEnum,
  isDefault: boolean,
): string {
  const head = isDefault
    ? 'This session has the default workflow size guideline:'
    : 'A workflow size guideline is configured for this session:'
  const configPointer = isDefault
    ? ' The user can raise or remove it with "Dynamic workflow size" in /config.'
    : ''
  return `${head} ${formatWorkflowSizeGuidelineKeepUnder(guideline)}. ${workflowSizeGuidelineDisclaimer()}${configPointer}`
}

/**
 * densable `dLs` — prefix space + aEd, empty when unrestricted.
 * Appended to Workflow tool prompt/description (densable lLs+dLs).
 */
export function formatWorkflowSizeGuidelineToolSuffix(
  globalConfigValue: WorkflowSizeGuideline | undefined | null = undefined,
): string {
  const { size, isDefault } =
    resolveSessionWorkflowSizeGuideline(globalConfigValue)
  if (size === 'unrestricted') return ''
  return ` ${buildWorkflowSizeGuidelineStatusMessage(size, isDefault)}`
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
