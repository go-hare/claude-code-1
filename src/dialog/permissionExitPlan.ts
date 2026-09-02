/**
 * densable teu Yes/No analog + Lcy keep-context.
 *
 * Gold 2.1.239: jsu `vM(EQr,teu)`. mLo modal KEEP. Esc/onCancel → deny.
 * Host teu reuses DualInk ExitPlanModePermissionRequest. Lcy keep-context
 * is PYe / DPo minted applies. Do not invent storageV5 / gold tn / remote
 * publish. Host answer is store.answer; do not dequeue.
 */
import type { ReactNode } from 'react'
import type { PermissionMode, PermissionUpdate } from '../types/permissions.js'
import {
  ConsentRow,
  EXIT_PLAN_RESUME_LABEL,
  mintExitPlanResumeRow,
  mintSetModeRow,
} from './consentRow.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

export { EXIT_PLAN_RESUME_LABEL }

export const EXIT_PLAN_EMPTY_FALLBACK =
  'No plan found. Please write your plan to the plan file first.'

export type ExitPlanModePermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  input?: unknown
  plan?: string
  planFilePath?: string
  usage?: unknown
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
}

export type ExitPlanModeChoice = 'yes' | 'no'

/** densable teu `kRt`. */
export function isExitPlanEmpty(
  payload: ExitPlanModePermissionPayload,
): boolean {
  return !payload.plan || payload.plan.trim() === ''
}

/** densable teu display: plan if non-empty else gold empty-file copy. */
export function exitPlanDisplayText(
  payload: ExitPlanModePermissionPayload,
): string {
  if (payload.plan && payload.plan.length > 0) return payload.plan
  return EXIT_PLAN_EMPTY_FALLBACK
}

/**
 * DualInk empty-plan Yes: onAllow({}, [setMode default session]).
 * Non-empty DualInk has a large Lcy option set — Host Yes/No only
 * without storageV5; Yes still setMode default session.
 */
export function resolveExitPlanModeAnswer(
  choice: ExitPlanModeChoice,
  payload: ExitPlanModePermissionPayload,
): PermissionPromptResult {
  if (choice === 'yes') {
    return {
      behavior: 'allow',
      updatedInput: payload.input ?? {},
      permissionUpdates: [
        { type: 'setMode', mode: 'default', destination: 'session' },
      ],
    }
  }
  return { behavior: 'deny' }
}

export type ExitPlanKeepContextValue =
  | 'yes-accept-edits-keep-context'
  | 'yes-default-keep-context'
  | 'yes-resume-auto-mode'

export type ExitPlanKeepContext = {
  options: Array<{ label: ReactNode; value: ExitPlanKeepContextValue }>
  keepContextRows: Partial<Record<ExitPlanKeepContextValue, ConsentRow>>
  keepContextModes: Partial<Record<ExitPlanKeepContextValue, PermissionMode>>
}

/**
 * densable Lcy `p` analog — auto ∧ gate. Wee() invent-ban; DualInk
 * passes `isAutoModeGateEnabled()`. Caller still ANDs
 * TRANSCRIPT_CLASSIFIER.
 */
export function offerExitPlanResumeAuto(
  isAutoModeAvailable?: boolean,
  gateEnabled?: boolean,
): boolean {
  return Boolean(isAutoModeAvailable) && gateEnabled === true
}

/**
 * densable Lcy keep-context slot. Clear-context / ultraplan / No stay
 * DualInk. offerResumeAuto is gold `p` (auto ∧ gate).
 */
export function buildExitPlanKeepContext(input: {
  isBypassPermissionsModeAvailable?: boolean
  offerResumeAuto?: boolean
}): ExitPlanKeepContext {
  const options: ExitPlanKeepContext['options'] = []
  const keepContextRows: ExitPlanKeepContext['keepContextRows'] = {}
  const keepContextModes: ExitPlanKeepContext['keepContextModes'] = {}

  if (input.isBypassPermissionsModeAvailable) {
    const row = mintSetModeRow('bypassPermissions', {
      isBypassPermissionsModeAvailable: true,
    })
    if (row !== null) {
      keepContextRows['yes-accept-edits-keep-context'] = row
      keepContextModes['yes-accept-edits-keep-context'] = 'bypassPermissions'
      options.push({
        label: row.node,
        value: 'yes-accept-edits-keep-context',
      })
    }
  } else if (input.offerResumeAuto) {
    const row = mintExitPlanResumeRow()
    keepContextRows['yes-resume-auto-mode'] = row
    keepContextModes['yes-resume-auto-mode'] = 'auto'
    options.push({ label: row.node, value: 'yes-resume-auto-mode' })
  } else {
    const row = mintSetModeRow('acceptEdits', {
      labelVariant: 'plan-keep-context',
    })
    if (row !== null) {
      keepContextRows['yes-accept-edits-keep-context'] = row
      keepContextModes['yes-accept-edits-keep-context'] = 'acceptEdits'
      options.push({
        label: row.node,
        value: 'yes-accept-edits-keep-context',
      })
    }
  }

  const defaultRow = mintSetModeRow('default', {
    labelVariant: 'plan-keep-context',
  })
  if (defaultRow !== null) {
    keepContextRows['yes-default-keep-context'] = defaultRow
    keepContextModes['yes-default-keep-context'] = 'default'
    options.push({
      label: defaultRow.node,
      value: 'yes-default-keep-context',
    })
  }

  return { options, keepContextRows, keepContextModes }
}

export type ExitPlanKeepContextResult =
  | { behavior: 'deny' }
  | {
      behavior: 'allow'
      updatedInput: unknown
      permissionUpdates: PermissionUpdate[]
      feedback?: string
    }

/** densable $cy keep-context — null/invalid row → deny. */
export function resolveExitPlanKeepContextAnswer(
  value: ExitPlanKeepContextValue,
  keep: ExitPlanKeepContext,
  updatedInput: unknown,
  feedback?: string,
): ExitPlanKeepContextResult {
  const row = keep.keepContextRows[value]
  if (row === undefined || !ConsentRow.is(row)) {
    return { behavior: 'deny' }
  }
  return {
    behavior: 'allow',
    updatedInput,
    permissionUpdates: [...row.applies],
    ...(feedback ? { feedback } : {}),
  }
}
