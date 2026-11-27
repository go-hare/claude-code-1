/**
 * Tool permission-gate helpers:
 * - Denial kind / human-words / error-denial classification
 * - Permission `updatedInput` schema validation, `ExitPlanMode` key stripping,
 *   and hook `updatedInput` sanitization
 * - Pre-permission input validation, coercion, observable backfill, and
 *   speculative Bash classifier startup
 */

import type { BashToolInput } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { startSpeculativeClassifierCheck } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
} from 'src/services/analytics/metadata.js'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import { getAbortReasonMessage } from '../../../utils/abortController.js'
import { validateBrowserToolInput } from '../../../utils/claudeInChrome/chromeCallPermission.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  AbortError,
  isAbortError,
  ShellError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../utils/errors.js'
import { logError } from '../../../utils/log.js'
import {
  CANCEL_MESSAGE,
  createUserMessage,
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
} from '../../../utils/messages.js'
import { AUTO_MODE_UNAVAILABLE_STOP_REASON } from '../../../utils/permissions/autoModeUnavailable.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import { isDisklessLaunch } from '../../../utils/sessionHost.js'
import { formatZodValidationError } from '../../../utils/toolErrors.js'
import type { getLoggingSafeMcpBaseUrl } from '../../mcp/utils.js'
import {
  REMOTE_TOOL_HOST_FIELD,
  requestedRemoteHost,
} from '../remoteToolHost.js'
import {
  buildSchemaNotSentHint,
  checkMcpToolNotLoaded,
} from './resultFormatting.js'
import type {
  McpServerType,
  MessageUpdateLazy,
  ToolDenialKind,
} from './types.js'

/** Official 2.1.328 `o_o` / `s_o` / `obr` / `M$t` decision reason literals. */
const AUTO_MODE_BILLING_CANCEL_REASON =
  'Cancelled at the classifier billing notice'
const AUTO_MODE_LEAVE_OFFER_STOP_REASON =
  'Stopped at the offer to leave auto mode'
const HELD_BACK_FOR_QUEUED_MESSAGE_REASON =
  'tool permission request held back for a queued message'
const PERMISSION_STREAM_CLOSED_REASON =
  'tool permission stream closed before response received'

function isCannedRejectionMessage(raw: string): boolean {
  return (
    raw === 'User denied permission' ||
    raw === 'User aborted' ||
    raw === CANCEL_MESSAGE ||
    raw === REJECT_MESSAGE ||
    raw === SUBAGENT_REJECT_MESSAGE
  )
}

const PERMISSION_RULE_ERROR_TELEMETRY_MESSAGES = new Set([
  'ccr_proxy_needs_approval_denied',
  'ccr_proxy_needs_approval_chrome_site_denied',
])

/**
 * Official 2.1.328 `Vbe` (chunk@294254613.js:3520059) — classify a denied/ask
 * `PermissionDecision` into a transcript-persisted `toolDenialKind`.
 */
export function deriveToolDenialKind(
  decision: PermissionDecision,
): ToolDenialKind {
  if (decision.behavior === 'ask') return 'user-rejected'
  const reason = decision.decisionReason
  if (!reason) return 'permission-rule'
  if (reason.type === 'classifier' && reason.classifier === 'auto-mode') {
    if (
      reason.reason === 'Classifier unavailable' ||
      reason.reason === AUTO_MODE_UNAVAILABLE_STOP_REASON
    ) {
      return 'automode-unavailable'
    }
    return reason.noVerdict ? 'automode-parsing-error' : 'automode-blocked'
  }
  if (
    reason.type === 'other' &&
    (reason.reason === AUTO_MODE_BILLING_CANCEL_REASON ||
      reason.reason === AUTO_MODE_LEAVE_OFFER_STOP_REASON)
  ) {
    return 'user-rejected'
  }
  if (
    reason.type === 'other' &&
    reason.reason === HELD_BACK_FOR_QUEUED_MESSAGE_REASON
  ) {
    return 'cancelled'
  }
  return 'permission-rule'
}

/**
 * Official 2.1.328 `Gio` (chunk@294254613.js:3520350) — tag unanswered denials
 * whose permission control stream closed before a response arrived.
 */
export function deriveToolDenialUnanswered(
  decision: PermissionDecision,
): 'stream-closed' | undefined {
  if (decision.behavior !== 'deny') return undefined
  const reason = decision.decisionReason
  return reason?.type === 'other' &&
    reason.reason === PERMISSION_STREAM_CLOSED_REASON
    ? 'stream-closed'
    : undefined
}

/**
 * Official 2.1.328 `qJn` / `jwn` — true when a non-allow permission decision
 * carries a human's own words (userFeedback or non-canned rejection reason).
 */
export function decisionHoldsPersonsWords(
  decision: PermissionDecision,
): boolean {
  if (decision.behavior === 'allow') return false
  if (decision.behavior === 'ask' && decision.userFeedback !== undefined) {
    return true
  }
  const raw = decision.message?.trim() ?? ''
  for (const prefix of [
    REJECT_MESSAGE_WITH_REASON_PREFIX,
    SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  ]) {
    const trimmedPrefix = prefix.trim()
    if (raw.startsWith(trimmedPrefix)) {
      return raw.slice(trimmedPrefix.length).trim().length > 0
    }
  }
  if (
    decision.decisionReason?.type === 'permissionPromptTool' &&
    raw.length > 0 &&
    !isCannedRejectionMessage(raw)
  ) {
    return true
  }
  return false
}

/**
 * Official 2.1.328 `X6r` (chunk@294254613.js:4663000) — derive `toolDenialKind`
 * for an error thrown during `tool.call()`.
 */
export function deriveToolErrorDenialKind(
  error: unknown,
  signal: AbortSignal,
): ToolDenialKind | undefined {
  const shellInterrupted = error instanceof ShellError && error.interrupted
  if (
    !(
      error instanceof AbortError ||
      shellInterrupted ||
      (isAbortError(error) && signal.aborted)
    )
  ) {
    if (
      error instanceof
        TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS &&
      PERMISSION_RULE_ERROR_TELEMETRY_MESSAGES.has(error.telemetryMessage)
    ) {
      return 'permission-rule'
    }
    return undefined
  }
  return signal.aborted && getAbortReasonMessage(signal.reason) === 'background'
    ? 'cancelled'
    : 'interrupted'
}

export function extractRemoteRejectionFeedback(
  decision: PermissionDecision,
): string | undefined {
  if (decision.behavior === 'allow') return undefined
  const raw = decision.message?.trim() ?? ''
  for (const prefix of [
    REJECT_MESSAGE_WITH_REASON_PREFIX,
    SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  ]) {
    const trimmedPrefix = prefix.trim()
    if (raw.startsWith(trimmedPrefix)) {
      const rest = raw.slice(trimmedPrefix.length).trim()
      return rest === '' ? undefined : rest
    }
  }
  if (
    decision.behavior === 'deny' &&
    decision.decisionReason?.type === 'permissionPromptTool' &&
    raw !== '' &&
    raw !== 'User denied permission'
  ) {
    return raw
  }
  return undefined
}

export function deriveAllowGivenByApprover(
  decision: PermissionDecision,
): 'user' | 'classifier' | 'auto_mode' | 'hook' | undefined {
  const reason =
    decision.behavior === 'allow' ? decision.decisionReason : undefined
  switch (reason?.type) {
    case 'permissionPromptTool':
      return 'user'
    case 'classifier':
      return reason.classifier === 'auto-mode' &&
        (reason as { classifierAllowed?: boolean }).classifierAllowed === true
        ? 'classifier'
        : undefined
    case 'mode':
      return reason.mode === 'auto' &&
        (reason as { denialLimitRun?: boolean }).denialLimitRun !== true &&
        (reason as { scriptCheckDeferred?: boolean }).scriptCheckDeferred !==
          true
        ? 'auto_mode'
        : undefined
    case 'hook':
      return 'hook'
    default:
      return undefined
  }
}

/**
 * Official 2.1.328 `G3s` (`chunk@294254613.js @4849870`): validate
 * permission-handler `updatedInput` against `tool.inputSchema` while ignoring
 * `unrecognized_keys` — MUST NOT strip trusted internal keys such as
 * `_simulatedSedEdit` set by permission handlers.
 */
export function validateUpdatedInputAgainstSchema(
  tool: Tool,
  updatedInput: Record<string, unknown>,
): { ok: true } | { ok: false; formatted: string; issueCodes: string[] } {
  const parsed = tool.inputSchema.safeParse(updatedInput)
  if (parsed.success) {
    return { ok: true }
  }
  const remainingIssues = parsed.error.issues.filter(
    issue => issue.code !== 'unrecognized_keys',
  )
  if (remainingIssues.length === 0) {
    return { ok: true }
  }
  const issueCodes = Array.from(
    new Set(remainingIssues.map(issue => String(issue.code))),
  )
  return {
    ok: false,
    formatted: formatZodValidationError(
      tool.name,
      new z.ZodError(remainingIssues),
    ),
    issueCodes,
  }
}

const EXIT_PLAN_MODE_STRIP_KEYS = new Set(['plan', 'planFilePath'])

/**
 * Official 2.1.328 `XUo` (`chunk@294254613.js @1163532, @4868654`): preserve
 * trusted permission-handler `updatedInput` (including internal keys like
 * `_simulatedSedEdit`), only stripping unchanged `ExitPlanMode` `plan` /
 * `planFilePath` fields when present identically on `originalInput`.
 */
export function applyPermissionUpdatedInput(
  toolName: string,
  updatedInput: Record<string, unknown>,
  originalInput: Record<string, unknown>,
): Record<string, unknown> {
  if (
    toolName !== 'ExitPlanMode' ||
    (isDisklessLaunch() && !Object.hasOwn(originalInput, 'planFilePath'))
  ) {
    return updatedInput
  }
  let shouldStrip = false
  for (const key of Object.keys(updatedInput)) {
    if (
      EXIT_PLAN_MODE_STRIP_KEYS.has(key) &&
      key in originalInput &&
      updatedInput[key] === originalInput[key]
    ) {
      shouldStrip = true
      break
    }
  }
  if (!shouldStrip) return updatedInput
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(updatedInput)) {
    if (
      EXIT_PLAN_MODE_STRIP_KEYS.has(key) &&
      key in originalInput &&
      val === originalInput[key]
    ) {
      continue
    }
    out[key] = val
  }
  return out
}

export function sanitizeHookUpdatedInputSync(
  tool: Tool,
  updatedInput: Record<string, unknown>,
):
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; message: string } {
  const schemaCheck = validateUpdatedInputAgainstSchema(tool, updatedInput)
  if (!schemaCheck.ok) {
    return {
      ok: false,
      message: `PreToolUse hook for ${tool.name} returned updatedInput that failed schema validation: ${schemaCheck.formatted}`,
    }
  }
  if (
    Object.keys(updatedInput).some(k =>
      k.toLowerCase().startsWith('__artifact'),
    )
  ) {
    return {
      ok: false,
      message: `PreToolUse hook for ${tool.name} returned updatedInput with a key starting with "__artifact" (in any letter case). Only Claude Code sets such keys. Remove the key from updatedInput. The tool was not run.`,
    }
  }
  const parsed = tool.inputSchema.safeParse(updatedInput)
  if (parsed.success) {
    return {
      ok: true,
      input:
        parsed.data !== null &&
        typeof parsed.data === 'object' &&
        !Array.isArray(parsed.data)
          ? (parsed.data as Record<string, unknown>)
          : updatedInput,
    }
  }
  const cleaned: Record<string, unknown> = { ...updatedInput }
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys' && 'keys' in issue) {
      for (const key of issue.keys) {
        delete cleaned[key]
      }
    }
  }
  return { ok: true, input: cleaned }
}

export type PreparedToolInputResult =
  | { ok: false; messages: MessageUpdateLazy[] }
  | {
      ok: true
      processedInput: { [key: string]: unknown }
      callInput: { [key: string]: unknown }
      backfilledClone: { [key: string]: unknown } | null
      coerceMeta: { shapeClass: string; resultNote?: string } | null
    }

/**
 * Pre-permission tool input pipeline:
 * 1. Intercept unloaded EWe-family MCP tools (`checkMcpToolNotLoaded`)
 * 2. Validate browser MCP inputs (`validateBrowserToolInput`)
 * 3. Apply `tool.coerceInput` + Zod `tool.inputSchema.safeParse`
 * 4. Run `tool.validateInput`
 * 5. Start speculative Bash allow classifier check
 * 6. Strip internal `_simulatedSedEdit` and prepare observable backfill clone
 */
export async function validateAndPrepareToolInput(opts: {
  tool: Tool
  toolUseID: string
  input: { [key: string]: boolean | string | number }
  toolUseContext: ToolUseContext
  assistantMessage: AssistantMessage
  messageId: string
  requestId: string | undefined
  mcpServerType: McpServerType
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>
}): Promise<PreparedToolInputResult> {
  const {
    tool,
    toolUseID,
    input,
    toolUseContext,
    assistantMessage,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
  } = opts

  // Official 2.1.328 `W3s`/`EWe`: intercept unloaded EWe-family MCP tools before validation/execution
  const notLoaded = checkMcpToolNotLoaded(
    tool,
    toolUseContext.messages,
    toolUseContext.options.tools,
  )
  if (notLoaded?.enforced) {
    logEvent('tengu_tool_use_not_loaded', {
      enforced: true,
      family:
        notLoaded.family as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: true,
    })
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        'TOOL_NOT_LOADED' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: true,
    })
    return {
      ok: false,
      messages: [
        {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>${notLoaded.message}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUseID,
              },
            ],
            toolUseResult: notLoaded.message,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        },
      ],
    }
  }

  // 2.1.323 #2198: refuse escaped \uXXXX / JSON-text inputs on browser MCP tools
  const browserInputErr = validateBrowserToolInput(tool, input)
  if (browserInputErr !== null) {
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        browserInputErr.errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,
    })
    return {
      ok: false,
      messages: [
        {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>${browserInputErr.message}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUseID,
              },
            ],
            toolUseResult: browserInputErr.message,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        },
      ],
    }
  }

  // densable: coerceInput (legacy aliases / soft truncates) then safeParse.
  // SendMessage Cpr=200 summary truncate lands here via shapeClass truncate_summary.
  let parseTarget: unknown = input
  let coerceMeta: { shapeClass: string; resultNote?: string } | null = null
  if (tool.coerceInput) {
    const coerced = tool.coerceInput(input)
    if (coerced !== null) {
      parseTarget = coerced.input
      coerceMeta = {
        shapeClass: coerced.shapeClass,
        ...(coerced.resultNote !== undefined
          ? { resultNote: coerced.resultNote }
          : {}),
      }
    }
  }
  const parsedInput = tool.inputSchema.safeParse(parseTarget)
  if (coerceMeta) {
    logEvent('tengu_tool_input_coerced', {
      toolName: sanitizeToolNameForAnalytics(tool.name),
      shapeClass:
        coerceMeta.shapeClass as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      outcome: (parsedInput.success
        ? 'coerced_valid'
        : 'coerced_still_invalid') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  if (!parsedInput.success) {
    let errorContent = formatZodValidationError(tool.name, parsedInput.error)

    const schemaHint = buildSchemaNotSentHint(
      tool,
      toolUseContext.messages,
      toolUseContext.options.tools,
    )
    if (schemaHint) {
      logEvent('tengu_deferred_tool_schema_not_sent', {
        toolName: sanitizeToolNameForAnalytics(tool.name),
        isMcp: tool.isMcp ?? false,
      })
      errorContent += schemaHint
    }

    logForDebugging(
      `${tool.name} tool input error: ${errorContent.slice(0, 200)}`,
    )
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorDetails: errorContent.slice(
        0,
        2000,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })
    return {
      ok: false,
      messages: [
        {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUseID,
              },
            ],
            toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        },
      ],
    }
  }

  // densable `xd` reads `_host` before schema parse. strictObject strips
  // the field, so put a real machine name back for validateInput.
  const namedHost = requestedRemoteHost(input)
  const validateTarget =
    namedHost !== undefined &&
    parsedInput.data !== null &&
    typeof parsedInput.data === 'object'
      ? { ...parsedInput.data, [REMOTE_TOOL_HOST_FIELD]: namedHost }
      : parsedInput.data

  // Validate input values. Each tool has its own validation logic
  const isValidCall = await tool.validateInput?.(validateTarget, toolUseContext)
  if (isValidCall?.result === false) {
    logForDebugging(
      `${tool.name} tool validation error: ${isValidCall.message?.slice(0, 200)}`,
    )
    logEvent('tengu_tool_use_error', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      error:
        isValidCall.message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode: isValidCall.errorCode,
      isMcp: tool.isMcp ?? false,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })
    return {
      ok: false,
      messages: [
        {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>${isValidCall.message}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUseID,
              },
            ],
            toolUseResult: `Error: ${isValidCall.message}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        },
      ],
    }
  }

  // Speculatively start the bash allow classifier check early so it runs in
  // parallel with pre-tool hooks, deny/ask classifiers, and permission dialog
  // setup. The UI indicator (setClassifierChecking) is NOT set here — it's
  // set in interactiveHandler.ts only when the permission check returns `ask`
  // with a pendingClassifierCheck. This avoids flashing "classifier running"
  // for commands that auto-allow via prefix rules.
  if (
    tool.name === BASH_TOOL_NAME &&
    parsedInput.data &&
    'command' in parsedInput.data
  ) {
    // densable bn: sticky permission layers for speculative classifier mode
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getToolPermissionContextFromLayers } =
      require('../../../engine/permissionLayerReaders.js') as typeof import('../../../engine/permissionLayerReaders.js')
    startSpeculativeClassifierCheck(
      (parsedInput.data as BashToolInput).command,
      getToolPermissionContextFromLayers(toolUseContext),
      toolUseContext.abortController.signal,
      toolUseContext.options.isNonInteractiveSession,
    )
  }

  // Defense-in-depth: strip _simulatedSedEdit from model-provided Bash input.
  // This field is internal-only — it must only be injected by the permission
  // system (SedEditPermissionRequest) after user approval. If the model supplies
  // it, the schema's strictObject should already reject it, but we strip here
  // as a safeguard against future regressions.
  let processedInput = parsedInput.data as { [key: string]: unknown }
  if (
    tool.name === BASH_TOOL_NAME &&
    processedInput &&
    typeof processedInput === 'object' &&
    '_simulatedSedEdit' in processedInput
  ) {
    const { _simulatedSedEdit: _, ...rest } = processedInput
    processedInput = rest
  }

  // Backfill legacy/derived fields on a shallow clone so hooks/canUseTool see
  // them without affecting tool.call(). SendMessageTool adds fields; file
  // tools overwrite file_path with expandPath — that mutation must not reach
  // call() because tool results embed the input path verbatim (e.g. "File
  // created successfully at: {path}"), and changing it alters the serialized
  // transcript and VCR fixture hashes. If a hook/permission later returns a
  // fresh updatedInput, callInput converges on it below — that replacement
  // is intentional and should reach call().
  const callInput = processedInput
  const backfilledClone =
    tool.backfillObservableInput &&
    typeof processedInput === 'object' &&
    processedInput !== null
      ? { ...processedInput }
      : null
  if (backfilledClone) {
    tool.backfillObservableInput!(backfilledClone)
    processedInput = backfilledClone
  }
  if (
    tool.deriveObservableInput &&
    typeof processedInput === 'object' &&
    processedInput !== null
  ) {
    try {
      const derived = await tool.deriveObservableInput(
        processedInput,
        toolUseContext,
      )
      if (derived !== undefined) {
        processedInput = derived
      }
    } catch (deriveErr) {
      logError(deriveErr)
    }
  }

  return {
    ok: true,
    processedInput,
    callInput,
    backfilledClone,
    coerceMeta,
  }
}
