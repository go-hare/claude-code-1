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
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { Tool as ToolType, ToolUseContext } from '../../Tool.js'
import type {
  PermissionDecisionReason,
  PermissionMode,
} from '../../types/permissions.js'
import { getLanguageName } from '../../utils/cliHighlight.js'
import { toExternalPermissionMode } from '../../utils/permissions/PermissionMode.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { logOTelEvent } from '../../utils/telemetry/events.js'
import {
  isSdkHostBuiltinMcp,
  toolSourceAttributes,
} from '../../utils/telemetry/toolSource.js'
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

/**
 * Official 325 `Q3r(e, n, r)` — extracts sanitized tool parameters for OTel
 * `tool_decision` events (#907).
 */
export function extractToolParametersForOTel(
  toolName: string,
  input: unknown,
  mcpInfo?: {
    serverName?: string
    toolName?: string
    serverType?: string
  } | null,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {}
  if (!isToolDetailsLoggingEnabled()) {
    if (mcpInfo && isSdkHostBuiltinMcp(mcpInfo)) {
      if (mcpInfo.serverName) params.mcp_server_name = mcpInfo.serverName
      if (mcpInfo.toolName) params.mcp_tool_name = mcpInfo.toolName
    }
    return params
  }
  const hasCommand =
    (toolName === 'Bash' || toolName === 'PowerShell') &&
    input !== null &&
    typeof input === 'object' &&
    'command' in input &&
    typeof (input as { command?: unknown }).command === 'string'
  if (hasCommand) {
    const cmdInput = input as {
      command: string
      timeout?: number
      description?: string
      dangerouslyDisableSandbox?: boolean
    }
    const parts = cmdInput.command.trim().split(/\s+/)
    params.bash_command = parts[0] || ''
    params.full_command = cmdInput.command
    if (cmdInput.timeout !== undefined) params.timeout = cmdInput.timeout
    if (cmdInput.description !== undefined) {
      params.description = cmdInput.description
    }
    if (cmdInput.dangerouslyDisableSandbox !== undefined) {
      params.dangerouslyDisableSandbox = cmdInput.dangerouslyDisableSandbox
    }
  }
  if (mcpInfo) {
    if (mcpInfo.serverName) params.mcp_server_name = mcpInfo.serverName
    if (mcpInfo.toolName) params.mcp_tool_name = mcpInfo.toolName
  }
  return params
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

  const toolParams = extractToolParametersForOTel(
    tool.name,
    input,
    tool.mcpInfo,
  )

  const mcpInfoForSource: { serverType?: string } | undefined = tool.mcpInfo
    ? {
        serverType:
          'serverType' in tool.mcpInfo &&
          typeof tool.mcpInfo.serverType === 'string'
            ? tool.mcpInfo.serverType
            : undefined,
      }
    : undefined

  void logOTelEvent('tool_decision', {
    decision,
    source: sourceString,
    tool_name: sanitizeToolNameForAnalytics(tool.name),
    tool_use_id: toolUseID,
    ...toolSourceAttributes(mcpInfoForSource),
    ...(Object.keys(toolParams).length > 0 && {
      tool_parameters: jsonStringify(toolParams),
    }),
    ...classifierAttrs,
    ...(effectiveMode !== undefined && {
      permission_mode: toExternalPermissionMode(effectiveMode),
    }),
  })
}

export { isCodeEditingTool, buildCodeEditToolAttributes, logPermissionDecision }
export type { PermissionLogContext, PermissionDecisionArgs }

const SAFETY_EVENT_FLAG = 'tengu_snoopy_creek'

export type SafetyCategory =
  | 'safety_check'
  | 'managed_policy'
  | 'permission_rule'
  | 'static_analysis'
  | 'hook'
  | 'auto_mode_block'
  | 'auto_mode_no_verdict'
  | 'permission_mode'
  | 'sandbox_override'
  | 'user_rejected'
  | 'sandbox_network'
  | 'sandbox_other'
  | 'hook_review'
  | 'other'

const BASH_MISS_SAFETY_CATEGORY = new Map<string, SafetyCategory | undefined>([
  ['too-complex', 'static_analysis'],
  ['semantics', 'static_analysis'],
  ['multi-cd', 'static_analysis'],
  ['cd-git-compound', 'static_analysis'],
  ['cd-compound-write', 'static_analysis'],
  ['cd-compound-read', 'static_analysis'],
  ['cd-compound-redirect', 'static_analysis'],
  ['dangerous-path', 'static_analysis'],
  ['flag-validation', 'static_analysis'],
  ['cd-multi-positional', 'static_analysis'],
  ['process-substitution', 'static_analysis'],
  ['shell-expansion', 'static_analysis'],
  ['net-redirect', 'static_analysis'],
  ['shell-operators', 'static_analysis'],
  ['sed-dangerous', 'static_analysis'],
  ['assigned-variable', 'static_analysis'],
  ['loop-later-pass', 'static_analysis'],
  ['git-untrusted-checkout', 'safety_check'],
  ['working-dir', 'safety_check'],
  ['safety-check', 'safety_check'],
  ['ask-rule', 'permission_rule'],
  ['no-rule-match', undefined],
  ['other-untagged', undefined],
])

const SUBCOMMAND_CATEGORY_PRIORITY: readonly SafetyCategory[] = [
  'safety_check',
  'managed_policy',
  'permission_rule',
  'static_analysis',
  'hook',
  'auto_mode_block',
  'auto_mode_no_verdict',
  'permission_mode',
  'sandbox_override',
]

const REASON_CODE_REGEX = /^[A-Za-z][A-Za-z+:-]{0,199}$/

export function isSafetyEventEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(SAFETY_EVENT_FLAG, false) === true
}

/**
 * densable `Zoo` (#1075): map a permission decision `reasonCode` to its
 * safety-event category.
 */
export function mapReasonCodeToSafetyCategory(
  reasonCode: string,
): SafetyCategory | undefined {
  const colonIdx = reasonCode.indexOf(':')
  const prefix = colonIdx === -1 ? reasonCode : reasonCode.slice(0, colonIdx)
  const rest = colonIdx === -1 ? '' : reasonCode.slice(colonIdx + 1)
  switch (prefix) {
    case 'bashMiss':
      return BASH_MISS_SAFETY_CATEGORY.get(rest)
    case 'subcommands': {
      if (rest === '') return undefined
      const parts = reasonCode.startsWith('subcommands:')
        ? reasonCode.slice('subcommands:'.length).split('+')
        : [reasonCode]
      const mapped = new Set(parts.map(mapReasonCodeToSafetyCategory))
      return SUBCOMMAND_CATEGORY_PRIORITY.find(c => mapped.has(c))
    }
    case 'rule':
      return rest === 'policySettings' ? 'managed_policy' : 'permission_rule'
    case 'mode':
      return 'permission_mode'
    case 'hook':
      return 'hook'
    case 'classifier':
      return rest.endsWith(':unavailable') || rest.endsWith(':no-verdict')
        ? 'auto_mode_no_verdict'
        : 'auto_mode_block'
    case 'classifierTranscriptTooLong':
      return 'auto_mode_no_verdict'
    case 'safetyCheck':
    case 'workingDir':
    case 'outsideReadsBlocked':
    case 'restrictedMode':
    case 'noProjectDirectory':
      return 'safety_check'
    case 'sandboxOverride':
      return 'sandbox_override'
    default:
      return undefined
  }
}

export type SafetyDecisionRecord = {
  decision: string
  source?: string
  reasonType?: string
  reasonCode?: string
  ruleSource?: string
  grantScope?: string
  circuitBreaker?: string
  classifierCategory?: string
}

export type SafetySandboxViolation = {
  kind?: string
}

/**
 * densable `c$s` (#1075): determine safety category from a decision record and
 * any sandbox violations.
 */
export function resolveSafetyEventCategory(
  record: SafetyDecisionRecord,
  sandboxViolations: readonly SafetySandboxViolation[] = [],
): SafetyCategory | undefined {
  if (record.reasonCode !== undefined) {
    const mapped =
      record.circuitBreaker !== undefined
        ? 'safety_check'
        : mapReasonCodeToSafetyCategory(record.reasonCode)
    if (
      mapped === 'permission_rule' &&
      record.ruleSource === 'policySettings'
    ) {
      return 'managed_policy'
    }
    if (mapped !== undefined) return mapped
    if (record.reasonType === 'asyncAgent') return 'permission_mode'
    if (record.decision === 'reject') {
      if (record.source === 'user_reject' || record.source === 'user_abort') {
        return 'user_rejected'
      }
      if (record.reasonType !== undefined) return 'other'
    }
  }
  if (sandboxViolations.length === 0) return undefined
  return sandboxViolations.some(v => v.kind === 'network')
    ? 'sandbox_network'
    : 'sandbox_other'
}

/**
 * densable `Joo` (#1075): emit `tengu_safety_event` analytics and
 * `claude_code.safety_event` OTel event.
 */
export function emitSafetyEvent(
  fields: {
    category: SafetyCategory
    decision: string
    decision_source: string
    reason_type?: string
    reason_code?: string
    rule_source?: string
    grant_scope?: string
    circuit_breaker?: string
    classifier_category?: string
    hook_event?: string
    tool_class?: string
    tool_name?: string
    permission_mode?: string
  },
  opts: {
    toolUseId?: string
    sandboxViolationCount?: number
  },
): void {
  const sandboxEnabled = SandboxManager.isSandboxingEnabled()
  logEvent('tengu_safety_event', {
    ...fields,
    tool_use_id:
      opts.toolUseId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    sandbox_violation_count: opts.sandboxViolationCount,
    sandbox_enabled: sandboxEnabled,
  })
  void logOTelEvent('safety_event', {
    category: fields.category,
    decision: fields.decision,
    decision_source: fields.decision_source,
    ...(fields.reason_type !== undefined && {
      reason_type: fields.reason_type,
    }),
    ...(fields.reason_code !== undefined && {
      reason_code: fields.reason_code,
    }),
    ...(fields.rule_source !== undefined && {
      rule_source: fields.rule_source,
    }),
    ...(fields.grant_scope !== undefined && {
      grant_scope: fields.grant_scope,
    }),
    ...(fields.circuit_breaker !== undefined && {
      circuit_breaker: fields.circuit_breaker,
    }),
    ...(fields.classifier_category !== undefined && {
      classifier_category: fields.classifier_category,
    }),
    ...(fields.hook_event !== undefined && { hook_event: fields.hook_event }),
    ...(fields.tool_class !== undefined && { tool_class: fields.tool_class }),
    ...(fields.tool_name !== undefined && { tool_name: fields.tool_name }),
    ...(fields.permission_mode !== undefined && {
      permission_mode: fields.permission_mode,
    }),
    ...(opts.toolUseId !== undefined && { tool_use_id: opts.toolUseId }),
    ...(opts.sandboxViolationCount !== undefined && {
      sandbox_violation_count: String(opts.sandboxViolationCount),
    }),
    sandbox_enabled: String(sandboxEnabled),
  })
}

const KNOWN_DECISION_SOURCES = new Set([
  'config',
  'classifier',
  'hook',
  'user_temporary',
  'user_permanent',
  'user_reject',
  'user_abort',
])

/**
 * densable `hbo` (#1075): evaluate and emit a safety event for a tool
 * permission decision / sandbox violation when `tengu_snoopy_creek` is on.
 */
export function logToolSafetyEvent({
  toolName,
  toolUseId,
  record,
  sandboxViolations = [],
  permissionMode,
}: {
  toolName: string
  toolUseId?: string
  record: SafetyDecisionRecord
  sandboxViolations?: readonly SafetySandboxViolation[]
  permissionMode?: PermissionMode
}): boolean {
  const category = resolveSafetyEventCategory(record, sandboxViolations)
  if (category === undefined || !isSafetyEventEnabled()) return false
  const reasonCode =
    record.reasonCode !== undefined && REASON_CODE_REGEX.test(record.reasonCode)
      ? record.reasonCode
      : undefined
  emitSafetyEvent(
    {
      category,
      decision: record.decision,
      decision_source:
        record.source && KNOWN_DECISION_SOURCES.has(record.source)
          ? record.source
          : 'other',
      reason_type: record.reasonType,
      reason_code: reasonCode,
      rule_source: record.ruleSource,
      grant_scope: record.grantScope,
      circuit_breaker: record.circuitBreaker,
      classifier_category: record.classifierCategory,
      hook_event:
        category === 'hook' &&
        record.reasonCode !== undefined &&
        record.reasonCode.includes('hook:PreToolUse')
          ? 'pre_tool_use'
          : undefined,
      tool_name: sanitizeToolNameForAnalytics(toolName),
      permission_mode:
        permissionMode !== undefined
          ? toExternalPermissionMode(permissionMode)
          : undefined,
    },
    {
      toolUseId,
      sandboxViolationCount: sandboxViolations.length,
    },
  )
  return true
}
