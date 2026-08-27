/**
 * densable permission_* DialogKindSpec set (bEt/Byr/S4t/Fno/$no/Uno/v4t).
 * Payload: structural required keys per densable Qg; extras via passthrough.
 * Result: shared {behavior} (+ tip optional fields).
 */
import { z } from 'zod/v4'
import { defineDialogSpec } from '../requestDialog.js'

export const PERMISSION_PROMPT_KIND = 'permission_prompt' as const
export const PERMISSION_BASH_KIND = 'permission_bash' as const
export const PERMISSION_FILE_KIND = 'permission_file' as const
export const PERMISSION_SKILL_KIND = 'permission_skill' as const
export const PERMISSION_POWERSHELL_KIND = 'permission_powershell' as const
export const PERMISSION_WEBFETCH_KIND = 'permission_webfetch' as const
export const PERMISSION_ASK_USER_QUESTION_KIND =
  'permission_ask_user_question' as const
export const PERMISSION_ENTER_PLAN_MODE_KIND =
  'permission_enter_plan_mode' as const
export const PERMISSION_EXIT_PLAN_MODE_V2_KIND =
  'permission_exit_plan_mode_v2' as const
export const PERMISSION_BROWSER_KIND = 'permission_browser' as const
export const PERMISSION_MONITOR_KIND = 'permission_monitor' as const
export const PERMISSION_WORKFLOW_KIND = 'permission_workflow' as const

export const PERMISSION_DIALOG_KINDS = [
  PERMISSION_PROMPT_KIND,
  PERMISSION_BASH_KIND,
  PERMISSION_FILE_KIND,
  PERMISSION_SKILL_KIND,
  PERMISSION_POWERSHELL_KIND,
  PERMISSION_WEBFETCH_KIND,
  PERMISSION_ASK_USER_QUESTION_KIND,
  PERMISSION_ENTER_PLAN_MODE_KIND,
  PERMISSION_EXIT_PLAN_MODE_V2_KIND,
  PERMISSION_BROWSER_KIND,
  PERMISSION_MONITOR_KIND,
  PERMISSION_WORKFLOW_KIND,
] as const

export type PermissionDialogKind = (typeof PERMISSION_DIALOG_KINDS)[number]

export type PermissionPromptResult = {
  behavior: 'allow' | 'deny' | 'cancelled'
  updatedInput?: unknown
  permissionUpdates?: unknown[]
  feedback?: string
  contentBlocks?: unknown[]
}

const permissionResultSchema = () =>
  z.object({
    behavior: z.enum(['allow', 'deny', 'cancelled']),
    updatedInput: z.unknown().optional(),
    permissionUpdates: z.array(z.unknown()).optional(),
    feedback: z.string().optional(),
    contentBlocks: z.array(z.unknown()).optional(),
  })

const permissionResultDefault = {
  behavior: 'cancelled' as const,
}

function objectWithKeys(...keys: string[]) {
  return z.custom<Record<string, unknown>>(
    (v): v is Record<string, unknown> =>
      typeof v === 'object' &&
      v !== null &&
      keys.every(k => k in (v as object)),
  )
}

/** densable bEt */
export const permissionPromptSpec = defineDialogSpec({
  kind: PERMISSION_PROMPT_KIND,
  payload: () => objectWithKeys('requestId', 'toolName', 'permissionResult'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable Byr */
export const permissionBashSpec = defineDialogSpec({
  kind: PERMISSION_BASH_KIND,
  payload: () =>
    objectWithKeys(
      'requestId',
      'toolName',
      'permissionResult',
      'command',
      'classifierState',
    ),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable S4t */
export const permissionFileSpec = defineDialogSpec({
  kind: PERMISSION_FILE_KIND,
  payload: () =>
    objectWithKeys(
      'requestId',
      'toolName',
      'permissionResult',
      'filePath',
      'operationType',
    ),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable Fno */
export const permissionSkillSpec = defineDialogSpec({
  kind: PERMISSION_SKILL_KIND,
  payload: () =>
    objectWithKeys('requestId', 'toolName', 'permissionResult', 'skill'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable $no */
export const permissionPowerShellSpec = defineDialogSpec({
  kind: PERMISSION_POWERSHELL_KIND,
  payload: () =>
    objectWithKeys('requestId', 'toolName', 'permissionResult', 'command'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable Uno */
export const permissionWebFetchSpec = defineDialogSpec({
  kind: PERMISSION_WEBFETCH_KIND,
  payload: () =>
    objectWithKeys('requestId', 'toolName', 'permissionResult', 'hostname'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable v4t */
export const permissionAskUserQuestionSpec = defineDialogSpec({
  kind: PERMISSION_ASK_USER_QUESTION_KIND,
  payload: () =>
    objectWithKeys('requestId', 'toolName', 'permissionResult', 'questions'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable xno */
export const permissionEnterPlanModeSpec = defineDialogSpec({
  kind: PERMISSION_ENTER_PLAN_MODE_KIND,
  payload: () => objectWithKeys('requestId', 'toolName', 'permissionResult'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable EQr */
export const permissionExitPlanModeV2Spec = defineDialogSpec({
  kind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
  payload: () => objectWithKeys('requestId', 'toolName', 'permissionResult'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable Cno */
export const permissionBrowserSpec = defineDialogSpec({
  kind: PERMISSION_BROWSER_KIND,
  payload: () => objectWithKeys('requestId', 'toolName', 'permissionResult'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable Nno */
export const permissionMonitorSpec = defineDialogSpec({
  kind: PERMISSION_MONITOR_KIND,
  payload: () =>
    objectWithKeys('requestId', 'toolName', 'permissionResult', 'intervalMs'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

/** densable Yvw / PMs */
export const permissionWorkflowSpec = defineDialogSpec({
  kind: PERMISSION_WORKFLOW_KIND,
  payload: () => objectWithKeys('requestId', 'toolName', 'permissionResult'),
  result: permissionResultSchema,
  default: permissionResultDefault,
})

export function isPermissionDialogKind(
  kind: string | undefined,
): kind is PermissionDialogKind {
  return (
    kind !== undefined &&
    (PERMISSION_DIALOG_KINDS as readonly string[]).includes(kind)
  )
}

/** Stable tip mirror id (doo uses mailbox ids; mirror/dequeue uses this). */
export function permissionPromptDialogId(toolUseID: string): string {
  return `permission_prompt:${toolUseID}`
}
