// Centralized analytics/telemetry logging for tool permission decisions.
// All permission approve/reject events flow through logPermissionDecision(),
// which fans out to Statsig analytics, OTel telemetry, and code-edit metrics.
import { feature } from 'bun:bundle'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  isToolDetailsLoggingEnabled,
  sanitizeToolNameForAnalytics,
} from 'src/services/analytics/metadata.js'
import { getCodeEditToolDecisionCounter } from '../../bootstrap/state.js'
import type { Tool as ToolType, ToolUseContext } from '../../Tool.js'
import type {
  PermissionDecisionReason,
  PermissionMode,
} from '../../types/permissions.js'
import { getLanguageName } from '../../utils/cliHighlight.js'
import { toExternalPermissionMode } from '../../utils/permissions/PermissionMode.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { logOTelEvent } from '../../utils/telemetry/events.js'
import type {
  PermissionApprovalSource,
  PermissionRejectionSource,
} from './PermissionContext.js'

type PermissionLogContext = {
  tool: ToolType
  input: unknown
  toolUseContext: ToolUseContext
  messageId: string
  toolUseID: string
  permissionMode?: PermissionMode
}

type ClassifierDecisionReason = PermissionDecisionReason & {
  classifierAllowed?: boolean
  category?: string
}

// Discriminated union: 'accept' pairs with approval sources, 'reject' with rejection sources
type PermissionDecisionArgs =
  | {
      decision: 'accept'
      source: PermissionApprovalSource | 'config'
      decisionReason?: ClassifierDecisionReason
      modeAtRecheck?: PermissionMode
    }
  | {
      decision: 'reject'
      source: PermissionRejectionSource | 'config'
      decisionReason?: ClassifierDecisionReason
    }

const CODE_EDITING_TOOLS = ['Edit', 'Write', 'NotebookEdit']

function isCodeEditingTool(toolName: string): boolean {
  return CODE_EDITING_TOOLS.includes(toolName)
}

// Builds OTel counter attributes for code editing tools, enriching with
// language when the tool's target file path can be extracted from input
async function buildCodeEditToolAttributes(
  tool: ToolType,
  input: unknown,
  decision: 'accept' | 'reject',
  source: string,
): Promise<Record<string, string>> {
  // Derive language from file path if the tool exposes one (e.g., Edit, Write)
  let language: string | undefined
  if (tool.getPath && input) {
    const parseResult = tool.inputSchema.safeParse(input)
    if (parseResult.success) {
      const filePath = tool.getPath(parseResult.data)
      if (filePath) {
        language = await getLanguageName(filePath)
      }
    }
  }

  return {
    decision,
    source,
    tool_name: tool.name,
    ...(language && { language }),
  }
}

// Flattens structured source into a string label for analytics/OTel events
function sourceToString(
  source: PermissionApprovalSource | PermissionRejectionSource,
): string {
  if (
    (feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) &&
    source.type === 'classifier'
  ) {
    return 'classifier'
  }
  switch (source.type) {
    case 'hook':
      return 'hook'
    case 'user':
      return source.permanent ? 'user_permanent' : 'user_temporary'
    case 'user_abort':
      return 'user_abort'
    case 'user_reject':
      return 'user_reject'
    default:
      return 'unknown'
  }
}

function baseMetadata(
  messageId: string,
  toolName: string,
  waitMs: number | undefined,
): { [key: string]: boolean | number | undefined } {
  return {
    messageID:
      messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    toolName: sanitizeToolNameForAnalytics(toolName),
    sandboxEnabled: SandboxManager.isSandboxingEnabled(),
    // Only include wait time when the user was actually prompted (not auto-approved)
    ...(waitMs !== undefined && { waiting_for_user_permission_ms: waitMs }),
  }
}

// Emits a distinct analytics event name per approval source for funnel analysis
function logApprovalEvent(
  tool: ToolType,
  messageId: string,
  source: PermissionApprovalSource | 'config',
  waitMs: number | undefined,
): void {
  if (source === 'config') {
    // Auto-approved by allowlist in settings -- no user wait time
    logEvent(
      'tengu_tool_use_granted_in_config',
      baseMetadata(messageId, tool.name, undefined),
    )
    return
  }
  if (
    (feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) &&
    source.type === 'classifier'
  ) {
    logEvent(
      'tengu_tool_use_granted_by_classifier',
      baseMetadata(messageId, tool.name, waitMs),
    )
    return
  }
  switch (source.type) {
    case 'user':
      logEvent(
        source.permanent
          ? 'tengu_tool_use_granted_in_prompt_permanent'
          : 'tengu_tool_use_granted_in_prompt_temporary',
        baseMetadata(messageId, tool.name, waitMs),
      )
      break
    case 'hook':
      logEvent('tengu_tool_use_granted_by_permission_hook', {
        ...baseMetadata(messageId, tool.name, waitMs),
        permanent: source.permanent ?? false,
      })
      break
    default:
      break
  }
}

// Rejections share a single event name, differentiated by metadata fields
function logRejectionEvent(
  tool: ToolType,
  messageId: string,
  source: PermissionRejectionSource | 'config',
  waitMs: number | undefined,
): void {
  if (source === 'config') {
    // Denied by denylist in settings
    logEvent(
      'tengu_tool_use_denied_in_config',
      baseMetadata(messageId, tool.name, undefined),
    )
    return
  }
  logEvent('tengu_tool_use_rejected_in_prompt', {
    ...baseMetadata(messageId, tool.name, waitMs),
    // Distinguish hook rejections from user rejections via separate fields
    ...(source.type === 'hook'
      ? { isHook: true }
      : {
          hasFeedback:
            source.type === 'user_reject' ? source.hasFeedback : false,
        }),
  })
}

/**
 * Official 325 `BEt(e, n)` — derives `classifier_verdict` and (when
 * `OTEL_LOG_TOOL_DETAILS=1`) `classifier_category` for OTel `tool_decision`
 * events on auto-mode classifier decisions (#847, #848).
 */
export function buildAutoClassifierOTelAttributes(
  decision: 'accept' | 'reject',
  decisionReason?: ClassifierDecisionReason,
): { classifier_verdict: string; classifier_category?: string } | undefined {
  if (
    decisionReason?.type !== 'classifier' ||
    decisionReason.classifier !== 'auto-mode'
  ) {
    return undefined
  }
  if (decision === 'accept') {
    return decisionReason.classifierAllowed === true
      ? { classifier_verdict: 'allow' }
      : undefined
  }
  const verdict = decisionReason.noVerdict ? 'no_verdict' : 'block'
  if (verdict !== 'block') {
    return { classifier_verdict: verdict }
  }
  const category = decisionReason.category
  return {
    classifier_verdict: 'block',
    ...(category !== undefined &&
      isToolDetailsLoggingEnabled() && { classifier_category: category }),
  }
}

// Single entry point for all permission decision logging. Called by permission
// handlers after every approve/reject. Fans out to: analytics events, OTel
// telemetry, code-edit OTel counters, and toolUseContext decision storage.
function logPermissionDecision(
  ctx: PermissionLogContext,
  args: PermissionDecisionArgs,
  permissionPromptStartTimeMs?: number,
): void {
  const { tool, input, toolUseContext, messageId, toolUseID, permissionMode } =
    ctx
  const { decision, source } = args

  const waiting_for_user_permission_ms =
    permissionPromptStartTimeMs !== undefined
      ? Date.now() - permissionPromptStartTimeMs
      : undefined

  // Log the analytics event
  if (args.decision === 'accept') {
    logApprovalEvent(
      tool,
      messageId,
      args.source,
      waiting_for_user_permission_ms,
    )
  } else {
    logRejectionEvent(
      tool,
      messageId,
      args.source,
      waiting_for_user_permission_ms,
    )
  }

  const sourceString = source === 'config' ? 'config' : sourceToString(source)

  // Track code editing tool metrics
  if (isCodeEditingTool(tool.name)) {
    void buildCodeEditToolAttributes(tool, input, decision, sourceString).then(
      attributes => getCodeEditToolDecisionCounter()?.add(1, attributes),
    )
  }

  // Persist decision on the context so downstream code can inspect what happened
  if (!toolUseContext.toolDecisions) {
    toolUseContext.toolDecisions = new Map()
  }
  toolUseContext.toolDecisions.set(toolUseID, {
    source: sourceString,
    decision,
    timestamp: Date.now(),
  })

  const classifierAttrs =
    source === 'config'
      ? buildAutoClassifierOTelAttributes(decision, args.decisionReason)
      : undefined
  const effectiveMode =
    (args.decision === 'accept' ? args.modeAtRecheck : undefined) ??
    permissionMode ??
    toolUseContext.getAppState?.()?.toolPermissionContext?.mode

  void logOTelEvent('tool_decision', {
    decision,
    source: sourceString,
    tool_name: sanitizeToolNameForAnalytics(tool.name),
    ...classifierAttrs,
    ...(effectiveMode !== undefined && {
      permission_mode: toExternalPermissionMode(effectiveMode),
    }),
  })
}

export { isCodeEditingTool, buildCodeEditToolAttributes, logPermissionDecision }
export type { PermissionLogContext, PermissionDecisionArgs }
