/**
 * densable 2.1.289 WKe / qOt / sjn / Flt — engine confirmWithUser.
 *
 * Gold: `confirm_` + uuid toolUseID, stamp `forcedByCaller`, canUseTool 6th
 * arg is the forced ask. Descriptor `_o` sets `isEngineConfirm` when
 * forcedByCaller && requestSource===undefined && startsWith("confirm_").
 */
import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import { AskUserQuestionTool } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import {
  getAllowedChannels,
  getIsNonInteractiveSession,
} from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  PermissionAskDecision,
  PermissionDecision,
} from '../../types/permissions.js'
import { errorMessage } from '../errors.js'
import { logForDebugging } from '../debug.js'
import { createAssistantMessage } from '../messages.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'
import { isNoOneToAskDenyReason } from './permissionDecisionReasons.js'

/** densable Flt */
export const CONFIRM_TOOL_USE_ID_PREFIX = 'confirm_'

/** densable ko — `typeof e==="string"&&e.startsWith(Flt)` */
export function isEngineConfirmToolUseId(toolUseID: unknown): boolean {
  return (
    typeof toolUseID === 'string' &&
    toolUseID.startsWith(CONFIRM_TOOL_USE_ID_PREFIX)
  )
}

/**
 * densable `_o` P — isEngineConfirm on the AskUserQuestion payload.
 * `forcedByCaller===!0 && requestSource===void 0 && ko(toolUseID)`
 */
export function isEngineConfirmAsk(input: {
  forcedByCaller?: boolean
  requestSource?: unknown
  toolUseID?: unknown
}): boolean {
  return (
    input.forcedByCaller === true &&
    input.requestSource === undefined &&
    isEngineConfirmToolUseId(input.toolUseID)
  )
}

/**
 * densable qOt — someone can answer an engine confirm.
 * Gold: cJ() && shouldAvoidPermissionPrompts!==!0 && mode!=="dontAsk".
 * cJ: channels+interactive → false. Local also refuses headless.
 */
export function canConfirmWithUser(toolUseContext: ToolUseContext): boolean {
  if (getAllowedChannels().length > 0 && !getIsNonInteractiveSession()) {
    return false
  }
  if (getIsNonInteractiveSession()) return false
  const perms = toolUseContext.getAppState().toolPermissionContext
  return perms.shouldAvoidPermissionPrompts !== true && perms.mode !== 'dontAsk'
}

/** densable sjn — canUseTool echoed the forced ask / never answered. */
export function isForcedAskStillPending(
  result: PermissionDecision,
  forced: PermissionAskDecision,
): boolean {
  return (
    result === forced ||
    (result.behavior === 'ask' && result.forcedByCaller === true)
  )
}

export type ConfirmWithUserChoice<T> = {
  label: string
  description?: string
  value: T
}

export type ConfirmWithUserResult<T> =
  | { kind: 'chose'; value: T }
  | { kind: 'declined'; typedAnswer?: string }
  | { kind: 'aborted' }
  | {
      kind: 'unanswered'
      reason: 'no_one_to_ask' | 'error' | 'no_selection'
    }

const confirmAnswersSchema = z.object({
  answers: z.record(z.string(), z.string()).optional(),
  followUp: z.boolean().optional(),
})

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function answerText(raw: unknown): string {
  if (typeof raw === 'string') return collapseWs(raw)
  if (Array.isArray(raw)) {
    return collapseWs(
      raw.filter((item): item is string => typeof item === 'string').join(', '),
    )
  }
  return ''
}

function mapConfirmDecision<T>(
  result: PermissionDecision,
  forced: PermissionAskDecision,
  aborted: boolean,
  question: string,
  choices: ConfirmWithUserChoice<T>[],
): ConfirmWithUserResult<T> {
  if (isForcedAskStillPending(result, forced)) {
    return { kind: 'unanswered', reason: 'no_one_to_ask' }
  }
  if (aborted) return { kind: 'aborted' }
  switch (result.behavior) {
    case 'allow': {
      const parsed = confirmAnswersSchema.safeParse(result.updatedInput)
      if (!parsed.success) {
        return { kind: 'unanswered', reason: 'no_selection' }
      }
      if (parsed.data.followUp === true) return { kind: 'declined' }
      const selected = answerText(parsed.data.answers?.[question])
      if (selected === '') {
        return { kind: 'unanswered', reason: 'no_selection' }
      }
      const hit = choices.find(c => collapseWs(c.label) === selected)
      return hit !== undefined
        ? { kind: 'chose', value: hit.value }
        : { kind: 'declined', typedAnswer: selected }
    }
    case 'deny': {
      const reason = result.decisionReason
      if (
        reason?.type === 'asyncAgent' ||
        (reason?.type === 'other' && isNoOneToAskDenyReason(reason.reason))
      ) {
        return { kind: 'unanswered', reason: 'no_one_to_ask' }
      }
      return { kind: 'declined' }
    }
    case 'ask':
      return { kind: 'declined' }
  }
}

/**
 * densable WKe — ask the user a single multiple-choice question via
 * AskUserQuestion.checkPermissions + canUseTool(forced ask).
 */
export async function confirmWithUser<T>(input: {
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  source: string
  header: string
  question: string
  choices: ConfirmWithUserChoice<T>[]
  personOnly?: boolean
}): Promise<ConfirmWithUserResult<T>> {
  const { toolUseContext, source } = input
  if (!canConfirmWithUser(toolUseContext)) {
    return { kind: 'unanswered', reason: 'no_one_to_ask' }
  }

  let answered: ConfirmWithUserResult<T>
  try {
    answered = await askConfirmWithUser(input)
  } catch (error) {
    if (toolUseContext.abortController.signal.aborted) {
      logForDebugging(
        `confirmWithUser(${source}): ask aborted with the turn: ${errorMessage(error)}`,
      )
      answered = { kind: 'aborted' }
    } else {
      logForDebugging(`confirmWithUser(${source}): ${errorMessage(error)}`)
      answered = { kind: 'unanswered', reason: 'error' }
    }
  }

  const meta = {
    source_hash:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  }
  switch (answered.kind) {
    case 'chose':
    case 'declined':
    case 'aborted':
      logEvent('permission_confirm_with_user', {
        ...meta,
        answer:
          answered.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      break
    case 'unanswered':
      logEvent('permission_confirm_with_user', {
        ...meta,
        answer:
          answered.reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      break
  }
  return answered
}

async function askConfirmWithUser<T>(input: {
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  source: string
  header: string
  question: string
  choices: ConfirmWithUserChoice<T>[]
  personOnly?: boolean
}): Promise<ConfirmWithUserResult<T>> {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        question: input.question,
        header: input.header,
        options: input.choices.map(choice => ({
          label: choice.label,
          description: choice.description ?? '',
        })),
        multiSelect: false,
      },
    ],
    metadata: { source: input.source },
  })
  if (!parsed.success) {
    throw new Error(
      `confirmWithUser(${input.source}): the question does not satisfy the AskUserQuestion schema: ${parsed.error.message}`,
    )
  }

  const permission = await AskUserQuestionTool.checkPermissions(
    parsed.data,
    input.toolUseContext,
  )
  if (permission.behavior !== 'ask') {
    throw new Error(
      `confirmWithUser(${input.source}): AskUserQuestion.checkPermissions answered ${permission.behavior}, not ask`,
    )
  }

  const forced: PermissionAskDecision = {
    ...permission,
    forcedByCaller: true,
    ...(input.personOnly === true ? { personOnly: true as const } : {}),
  }
  const toolUseID = `${CONFIRM_TOOL_USE_ID_PREFIX}${randomUUID()}`
  const result = await input.canUseTool(
    AskUserQuestionTool,
    parsed.data,
    input.toolUseContext,
    createAssistantMessage({ content: [] }),
    toolUseID,
    forced,
  )
  return mapConfirmDecision(
    result,
    forced,
    input.toolUseContext.abortController.signal.aborted,
    input.question,
    input.choices,
  )
}
