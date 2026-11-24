import { feature } from 'bun:bundle'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import { isSandboxAutoAllowSuspendedInLayers } from '../../engine/hostPermissionLayers.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { shouldHoldConnectorApprovalWhilePluginsLoading } from '../../services/mcp/config.js'
import {
  buildMcpToolName,
  getToolNameForPermissionCheck,
  mcpInfoFromString,
} from '../../services/mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  expandConnectorToolAliases,
  toolMatchesWithConnectorAliases,
} from '../../services/mcp/utils.js'
import {
  isChromeMcpReadOnlyTool,
  isChromeMcpSafeForAutoMode,
} from '../claudeInChrome/chromeMcpReadOnly.js'
import {
  chromeCommandBypassesDontAsk,
  getEffectivePermissionMode,
  isChromeFamilyClassifierEligible,
} from './mcpPermissionMode.js'
import {
  autoModeHasDenyRules,
  buildUnfinishedCheckAsk,
  CIRCUIT_BREAKER_POLICY,
  type CircuitBreakerName,
  formatNonInteractiveAskCauseMessage,
  hasBypassImmuneNonClassifierAlsoBreaker,
  hasBypassImmuneSafetyCheck,
  hasClassifierRoutedSafetyCheck,
  hasUnwaivableBypassImmuneSafetyCheck,
  isBypassImmuneSafetyCheck,
  isClassifierRoutedSafetyCheck,
  isDesktopForwardSkipClassifier,
  isServerHeldClassifierAsk,
  isUnwaivableBypassImmuneSafetyCheck,
  pluginOriginCaller,
  shouldHoldConsecutiveDenials,
} from './nhoGates.js'
import { workflowNeedsUsageConsentPrompt } from './workflowUsageConsent.js'
import { isSessionBypassClass } from './planBypass.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/builtin-tools/tools/SendMessageTool/constants.js'
import {
  recordSandboxStateAtHookRewrite,
  shouldUseSandbox,
} from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebSearchTool/prompt.js'
import type { AssistantMessage } from '../../types/message.js'
import { extractOutputRedirections } from '../bash/commands.js'
import { logForDebugging } from '../debug.js'
import { AbortError, isAbortError, toError } from '../errors.js'
import { logError } from '../log.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import {
  getEnabledSettingSources,
  getSettingSourceDisplayNameLowercase,
  SETTING_SOURCES,
} from '../settings/constants.js'
import { plural } from '../stringUtils.js'
import { type PermissionMode, permissionModeTitle } from './PermissionMode.js'
import type {
  PermissionAllowDecision,
  PermissionAskDecision,
  PermissionDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
  PermissionResult,
} from './PermissionResult.js'
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from './PermissionRule.js'
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  persistPermissionUpdates,
} from './PermissionUpdate.js'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from './PermissionUpdateSchema.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'
import { isBroadRule, isAutoModeFilteringActive } from './broadRuleFilter.js'
import {
  contextBlocksOutsideReads,
  getOutsideReadPrompt,
  isAutoModeOrPlanActingAsAuto,
  settingsHaveBlockFileToolReadsOutsideWorkingDirectories,
  shouldOfferBlockOutsideReads,
} from './outsideReads.js'
import { isEvalConfined } from './evalConfined.js'
import type { FunctionHookHopSite } from '../plugins/functionHooksModules.js'
import { pinValue, restorePinnedKeys } from '../plugins/functionHooksHop.js'
import { applyPluginToolListDenyRules } from '../plugins/pluginToolList.js'
import {
  deletePermissionRuleFromSettings,
  type PermissionRuleFromEditableSettings,
  shouldAllowManagedPermissionRulesOnly,
} from './permissionsLoader.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const classifierDecisionModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('./classifierDecision.js') as typeof import('./classifierDecision.js'))
  : null
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('./autoModeState.js') as typeof import('./autoModeState.js'))
  : null

import {
  addToTurnClassifierDuration,
  getTotalCacheCreationInputTokens,
  getTotalCacheReadInputTokens,
  getTotalInputTokens,
  getTotalOutputTokens,
  isThirdPartyServerClassifierRefused,
} from '../../bootstrap/state.js'
import { promptAutoModeServerFallbackNotice } from '../../services/api/autoModeServerFallbackNotice.js'
import { isAutoModeServerEnabled } from '../../services/api/autoModeClassifierTransport.js'
import {
  denyAutoModeUnavailableStop,
  formatAutoModeNoServerCheckNotice,
  formatServerUnavailableInputTooLongDetail,
  holdOnAutoModeUnavailable,
  isConsecutiveUnavailableErrorKind,
  SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
} from './autoModeUnavailable.js'
import { checkAccountEmailUserAgent } from './accountEmailUserAgentCheck.js'
import { getSettingsForSource } from '../settings/settings.js'
import type { SettingSource } from '../settings/constants.js'
import { getToolPermissionContextFromLayers } from '../../engine/permissionLayerReaders.js'
import { getAgentContext } from '../agentContext.js'
import {
  applyBlockWritesOutsideWorkingDirectories,
  clearCommandScopedAllowRules,
} from './permissionSetup.js'
import { settingsHaveBlockWritesOutsideWorkingDirectories } from './filesystem.js'
import {
  accountMemoryHookRewriteDenied,
  didAccountMemoryHookRewriteInput,
} from '../hooks/toolCallManagedPass.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import {
  clearClassifierChecking,
  setClassifierChecking,
} from '../classifierApprovals.js'
import { HEARTHBOT_MCP_SERVER_NAME } from '../../bridge/hearthbotMcp.js'
import {
  isHearthbotBareElicitationPinned,
  isHearthbotCcrProxyUrl,
} from '../../services/mcp/ccrInjectedMcp.js'
import { isCliOwnedConfig } from '../../services/mcp/cliOwnedConfigs.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValueWithSource,
} from '../../services/analytics/growthbook.js'
import {
  getCommandsByMaxPriority,
  isMidTurnFoldSuspended,
} from '../messageQueueManager.js'
import { getBootstrapSession } from '../sessionRoot.js'
import { isEnvTruthy, isInProtectedNamespace } from '../envUtils.js'
import { executePermissionRequestHooks } from '../hooks.js'
import { detachedToolCallWasLetGo } from '../detachedToolCallStore.js'
import {
  AUTO_REJECT_MESSAGE,
  buildClassifierUnavailableMessage,
  buildYoloRejectionMessage,
  DONT_ASK_REJECT_MESSAGE,
  REJECT_MESSAGE,
} from '../messages.js'
import { calculateCostFromTokens } from '../modelCost.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { jsonStringify } from '../slowOperations.js'
import {
  createDenialTrackingState,
  DENIAL_LIMITS,
  type DenialTrackingState,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
} from './denialTracking.js'
import {
  resolveSameTurnSiblingContext,
  shouldGateEditClassification,
} from './autoModeFlags.js'
import {
  classifyYoloAction,
  formatActionForClassifier,
} from './yoloClassifier.js'
import {
  resolveHandbackClassifierFlagResult,
  stashHandbackClassifierResult,
} from '../handbackClassifierResult.js'

/** densable Qet — transcript overflow manual-approval reason (Xr stays false). */
const TRANSCRIPT_TOO_LONG_REASON =
  'Auto mode classifier transcript exceeded context window — falling back to manual approval (try /compact to reduce conversation size)'

const PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session',
  // densable Ryl — dynamic MCP tools[].permission_policy buckets
  'mcpServerPolicy',
  // densable 2.1.248 #1 rrn toolsNarrowing
  'toolsNarrowing',
  // densable hostCredential — cloud-session credential guard
  'hostCredential',
] as const satisfies readonly PermissionRuleSource[]

export function permissionRuleSourceDisplayString(
  source: PermissionRuleSource,
): string {
  return getSettingSourceDisplayNameLowercase(source)
}

export { isEvalConfined } from './evalConfined.js'

/**
 * densable `pNo` @177781217 / `t6n` @179623476 — CCR hearthbot MCP leaves
 * whose whole-tool allow is dropped while xa auto-filter is on (`fa(Pc,e)`
 * with `Pc="hearthbot"`). Wrap `buildMcpToolName`; do not invent chrome FQNs.
 */
const HEARTHBOT_AUTO_DROPPED_ALLOW_TOOLS = new Set(
  [
    'update_memory',
    'update_message',
    'set_thread_resolved',
    'switch_model',
    'pin_artifact',
    'unpin_artifact',
    'report_issue',
    'set_time_zone',
    'cookie_sign_in_request',
    'post_widget',
    'suggest_connectors',
  ].map(leaf => buildMcpToolName('hearthbot', leaf)),
)

/** densable `t6n` — hearthbot FQN whole-tool allow skip under xa. */
export function isAutoModeDroppedHearthbotAllow(toolName: string): boolean {
  return HEARTHBOT_AUTO_DROPPED_ALLOW_TOOLS.has(toolName)
}

/**
 * Official 2.1.327 (#441, SEA `J` / `Se` WeakMap):
 * Cache parsed permission rules and a per-tool index (`withContentByToolName`)
 * per rule-string array so sessions with tens of thousands of connector tool
 * permissions do not re-parse every rule string on every tool call / turn.
 */
type ParsedRuleBucket = {
  readonly rules: readonly PermissionRule[]
  readonly withContentByToolName: ReadonlyMap<string, readonly PermissionRule[]>
}

type CachedRuleBucketEntry = {
  readonly source: PermissionRuleSource
  readonly ruleBehavior: PermissionBehavior
  readonly ruleStrings: readonly string[]
  readonly parsed: ParsedRuleBucket
}

const parsedRuleBucketCache = new WeakMap<
  readonly string[],
  CachedRuleBucketEntry
>()

function clonePermissionRule(rule: PermissionRule): PermissionRule {
  return {
    source: rule.source,
    ruleBehavior: rule.ruleBehavior,
    ruleValue: { ...rule.ruleValue },
  }
}

function getParsedRuleBucket(
  rawRules: readonly string[],
  source: PermissionRuleSource,
  ruleBehavior: PermissionBehavior,
): ParsedRuleBucket {
  const cached = parsedRuleBucketCache.get(rawRules)
  if (
    cached !== undefined &&
    cached.source === source &&
    cached.ruleBehavior === ruleBehavior &&
    cached.ruleStrings.length === rawRules.length
  ) {
    let same = true
    for (let i = 0; i < rawRules.length; i++) {
      if (cached.ruleStrings[i] !== rawRules[i]) {
        same = false
        break
      }
    }
    if (same) {
      return cached.parsed
    }
  }

  const snapshot = rawRules.slice()
  const rules: PermissionRule[] = []
  const withContentByToolName = new Map<string, PermissionRule[]>()
  for (const ruleString of snapshot) {
    const ruleValue = Object.freeze(permissionRuleValueFromString(ruleString))
    const rule: PermissionRule = Object.freeze({
      source,
      ruleBehavior,
      ruleValue,
    })
    rules.push(rule)
    if (ruleValue.ruleContent !== undefined) {
      const bucket = withContentByToolName.get(ruleValue.toolName)
      if (bucket === undefined) {
        withContentByToolName.set(ruleValue.toolName, [rule])
      } else {
        bucket.push(rule)
      }
    }
  }
  const parsed: ParsedRuleBucket = { rules, withContentByToolName }
  parsedRuleBucketCache.set(rawRules, {
    source,
    ruleBehavior,
    ruleStrings: snapshot,
    parsed,
  })
  return parsed
}

function collectRulesForBehavior(
  rulesBySource: Partial<Record<PermissionRuleSource, readonly string[]>>,
  sources: readonly PermissionRuleSource[],
  behavior: PermissionBehavior,
  onlyWithContentForTool?: string,
): PermissionRule[] {
  const out: PermissionRule[] = []
  for (const source of sources) {
    const rawRules = rulesBySource[source]
    if (!rawRules || rawRules.length === 0) continue
    const bucket = getParsedRuleBucket(rawRules, source, behavior)
    const slice =
      onlyWithContentForTool !== undefined
        ? (bucket.withContentByToolName.get(onlyWithContentForTool) ?? [])
        : bucket.rules
    for (const rule of slice) {
      out.push(rule)
    }
  }
  return out
}

export function getAllowRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  // Auto-mode broad-rule filter (official `PL4` + `ERH`).
  // When active, broad Bash/PowerShell/Agent allow rules are dropped so the
  // classifier can evaluate each invocation individually.
  const filterBroadRules = isAutoModeFilteringActive(
    context.mode,
    autoModeStateModule?.isAutoModeActive() ?? false,
    context.servedCall === true,
  )
  const sources = isEvalConfined()
    ? (['cliArg'] as const satisfies readonly PermissionRuleSource[])
    : PERMISSION_RULE_SOURCES
  const rules = collectRulesForBehavior(
    context.alwaysAllowRules,
    sources,
    'allow',
  )
  const out: PermissionRule[] = []
  for (const rule of rules) {
    if (
      filterBroadRules &&
      (isBroadRule(rule.ruleValue.toolName, rule.ruleValue.ruleContent) ||
        isAutoModeDroppedHearthbotAllow(rule.ruleValue.toolName))
    ) {
      continue
    }
    out.push(clonePermissionRule(rule))
  }
  return out
}

type SafetyCheckDecisionReason = Extract<
  PermissionDecisionReason,
  { type: 'safetyCheck' }
>

/**
 * densable W9 — walk decisionReason (including nested subcommandResults) for a
 * safetyCheck matching the optional predicate.
 */
export function findSafetyCheckDecision(
  decisionReason: PermissionDecisionReason | undefined,
  predicate: (check: SafetyCheckDecisionReason) => boolean = () => true,
): SafetyCheckDecisionReason | undefined {
  if (!decisionReason) return undefined
  if (decisionReason.type === 'safetyCheck') {
    return predicate(decisionReason) ? decisionReason : undefined
  }
  if (decisionReason.type === 'subcommandResults') {
    for (const sub of decisionReason.reasons.values()) {
      const nested = findSafetyCheckDecision(sub.decisionReason, predicate)
      if (nested) return nested
    }
  }
  return undefined
}

/**
 * densable BTe @177386524 — auto, or plan acting as auto:
 * `plan && servedCall!==true && Jf() && !isBypassPermissionsModeAvailable`.
 * Do not substitute prePlanMode inherit (that's plan+bypass class, not BTe).
 */
/**
 * Official 2.1.319 #1703 (`Ave` / `u$r` / `sI`):
 * `permissions.denyInsteadOfPrompting` is read from trusted settings sources
 * (`userSettings`, `flagSettings`, `policySettings`; project/local settings are
 * ignored, and `true` in any trusted source wins).
 */
export type ToolPermissionContextWithDenyInsteadOfPrompting =
  ToolPermissionContext

const TRUSTED_DENY_INSTEAD_OF_PROMPTING_SOURCES: readonly SettingSource[] = [
  'userSettings',
  'flagSettings',
  'policySettings',
]

export function isDenyInsteadOfPromptingEnabled(): boolean {
  if (isEvalConfined()) return false
  return TRUSTED_DENY_INSTEAD_OF_PROMPTING_SOURCES.some(source => {
    const perms = getSettingsForSource(source)?.permissions as
      | { denyInsteadOfPrompting?: boolean }
      | undefined
    return perms?.denyInsteadOfPrompting === true
  })
}

export function applyDenyInsteadOfPrompting(
  context: ToolPermissionContext,
): ToolPermissionContext {
  const enabled = isDenyInsteadOfPromptingEnabled()
  if (enabled === (context.denyInsteadOfPrompting === true)) {
    return context
  }
  const avoidsByNature =
    context.avoidsPromptsByNature === true ||
    (context.shouldAvoidPermissionPrompts === true &&
      context.denyInsteadOfPrompting !== true)
  return {
    ...context,
    denyInsteadOfPrompting: enabled,
    ...(avoidsByNature ? { avoidsPromptsByNature: true } : {}),
    shouldAvoidPermissionPrompts: enabled || avoidsByNature,
  }
}

/**
 * Official `sI(e)`: returns true when prompts are avoided by nature (headless /
 * background / subagent), rather than solely because `permissions.denyInsteadOfPrompting`
 * is set in an interactive session.
 */
export function avoidsPromptsByNature(context: ToolPermissionContext): boolean {
  return (
    context.shouldAvoidPermissionPrompts === true &&
    (context.denyInsteadOfPrompting !== true ||
      context.avoidsPromptsByNature === true)
  )
}

function getEffectiveToolPermissionContext(
  context: ToolUseContext,
): ToolPermissionContext {
  return applyPluginToolListDenyRules(
    applyDenyInsteadOfPrompting(
      stripCommandAllowedToolsForBackgroundAgent(
        getToolPermissionContextFromLayers(context),
        context,
      ),
    ),
  )
}

/**
 * Official 2.1.319 #1807 (`t1t` + `ev`):
 * Returns true when a permission result carries an explicit `ask` rule,
 * either directly in `decisionReason`, nested inside `subcommandResults`,
 * or via `matchedAskRule` (e.g. Monitor `ws` under a Bash ask rule).
 */
export function hasAskRuleInDecisionReason(
  reason: PermissionDecisionReason | undefined,
): boolean {
  if (reason?.type === 'rule' && reason.rule.ruleBehavior === 'ask') {
    return true
  }
  if (reason?.type === 'subcommandResults') {
    for (const sub of reason.reasons.values()) {
      if (
        sub.behavior === 'ask' &&
        hasAskRuleInDecisionReason(sub.decisionReason)
      ) {
        return true
      }
    }
  }
  return false
}

export function hasMatchedAskRule(
  result: PermissionResult | undefined,
): boolean {
  if (!result || result.behavior !== 'ask') return false
  return (
    hasAskRuleInDecisionReason(result.decisionReason) ||
    result.matchedAskRule?.ruleBehavior === 'ask'
  )
}

export function isPermissionContextAutoMode(
  context: ToolPermissionContext,
): boolean {
  if (context.mode === 'auto') return true
  if (
    context.mode === 'plan' &&
    context.servedCall !== true &&
    (autoModeStateModule?.isAutoModeActive() ?? false) &&
    context.isBypassPermissionsModeAvailable !== true
  ) {
    return true
  }
  return false
}

/**
 * Creates a permission request message that explain the permission request
 */
export function createPermissionRequestMessage(
  toolName: string,
  decisionReason?: PermissionDecisionReason,
): string {
  // Handle different decision reason types
  if (decisionReason) {
    if (
      (feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) &&
      decisionReason.type === 'classifier'
    ) {
      return `Classifier '${decisionReason.classifier}' requires approval for this ${toolName} command: ${decisionReason.reason}`
    }
    switch (decisionReason.type) {
      case 'hook': {
        const hookMessage = decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' requires approval for this ${toolName} command`
        return hookMessage
      }
      case 'rule': {
        const ruleString = permissionRuleValueToString(
          decisionReason.rule.ruleValue,
        )
        const sourceString = permissionRuleSourceDisplayString(
          decisionReason.rule.source,
        )
        return `Permission rule '${ruleString}' from ${sourceString} requires approval for this ${toolName} command`
      }
      case 'subcommandResults': {
        const needsApproval: string[] = []
        for (const [cmd, result] of decisionReason.reasons) {
          if (result.behavior === 'ask' || result.behavior === 'passthrough') {
            // Strip output redirections for display to avoid showing filenames as commands
            // Only do this for Bash tool to avoid affecting other tools
            if (toolName === 'Bash') {
              const { commandWithoutRedirections, redirections } =
                extractOutputRedirections(cmd)
              // Only use stripped version if there were actual redirections
              const displayCmd =
                redirections.length > 0 ? commandWithoutRedirections : cmd
              needsApproval.push(displayCmd)
            } else {
              needsApproval.push(cmd)
            }
          }
        }
        if (needsApproval.length > 0) {
          const n = needsApproval.length
          return `This ${toolName} command contains multiple operations. The following ${plural(n, 'part')} ${plural(n, 'requires', 'require')} approval: ${needsApproval.join(', ')}`
        }
        return `This ${toolName} command contains multiple operations that require approval`
      }
      case 'permissionPromptTool':
        return `Tool '${decisionReason.permissionPromptToolName}' requires approval for this ${toolName} command`
      case 'sandboxOverride':
        return 'Run outside of the sandbox'
      case 'workingDir':
        return decisionReason.reason
      case 'safetyCheck':
      case 'other':
        return decisionReason.reason
      case 'mode': {
        const modeTitle = permissionModeTitle(decisionReason.mode)
        return `Current permission mode (${modeTitle}) requires approval for this ${toolName} command`
      }
      case 'asyncAgent':
        return decisionReason.reason
    }
  }

  // Default message without listing allowed commands
  const message = `Claude requested permissions to use ${toolName}, but you haven't granted it yet.`

  return message
}

export function getDenyRules(context: ToolPermissionContext): PermissionRule[] {
  return collectRulesForBehavior(
    context.alwaysDenyRules,
    PERMISSION_RULE_SOURCES,
    'deny',
  ).map(clonePermissionRule)
}

export function getAskRules(context: ToolPermissionContext): PermissionRule[] {
  return collectRulesForBehavior(
    context.alwaysAskRules,
    PERMISSION_RULE_SOURCES,
    'ask',
  ).map(clonePermissionRule)
}

const MCP_PREFIX = 'mcp__'

function compileWildcardMatcher(pattern: string): (value: string) => boolean {
  const parts = pattern.split('*')
  const head = parts[0] ?? ''
  if (parts.length === 1) {
    return value => head === value
  }
  const tail = parts.at(-1) ?? ''
  const middle = parts.slice(1, -1).filter(p => p !== '')
  return value => {
    const endLimit = value.length - tail.length
    if (
      endLimit < head.length ||
      !value.startsWith(head) ||
      !value.endsWith(tail)
    ) {
      return false
    }
    let cursor = head.length
    for (const part of middle) {
      const idx = value.indexOf(part, cursor)
      if (idx === -1 || idx + part.length > endLimit) {
        return false
      }
      cursor = idx + part.length
    }
    return true
  }
}

/**
 * Official qee(e): returns all possible `mcp__<server>` rule names for a tool.
 * When `mcpInfo` is present, uses the normalized serverName; otherwise collects
 * every `__` boundary prefix so deny/ask rules like `mcp__my__server` match
 * `mcp__my__server__tool` even when the server name contains `__`.
 */
export function getMcpServerRuleNames(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): string[] {
  if (tool.mcpInfo) {
    const norm = normalizeNameForMCP(tool.mcpInfo.serverName)
    const parsedServer =
      mcpInfoFromString(`${MCP_PREFIX}${norm}__x`)?.serverName ?? norm
    return parsedServer === norm
      ? [`${MCP_PREFIX}${norm}`]
      : [`${MCP_PREFIX}${norm}`, `${MCP_PREFIX}${parsedServer}`]
  }
  const names: string[] = []
  if (!tool.name.startsWith(MCP_PREFIX)) {
    return names
  }
  for (
    let idx = tool.name.indexOf('__', MCP_PREFIX.length);
    idx !== -1;
    idx = tool.name.indexOf('__', idx + 1)
  ) {
    names.push(tool.name.slice(0, idx))
  }
  return names
}

/**
 * Official zii(e, n): ensures an MCP allow rule only reaches the exact server
 * it names (e.g. `mcp__a` does not allow `a__b` or `a_`).
 */
function mcpAllowRuleMatchesServerExactly(
  ruleToolName: string,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): boolean {
  const prefixes = tool.mcpInfo
    ? [`${MCP_PREFIX}${normalizeNameForMCP(tool.mcpInfo.serverName)}`]
    : getMcpServerRuleNames(tool)
  return prefixes.every(
    prefix => ruleToolName === prefix || ruleToolName.startsWith(`${prefix}__`),
  )
}

/**
 * Official oEn(e): checks whether an MCP rule name covers the parsed toolInfo,
 * supporting `*` globs in the toolName position (e.g. `mcp__a__b__*`).
 */
function coversMcpTool(
  ruleToolName: string,
  toolInfo: ReturnType<typeof mcpInfoFromString>,
): boolean {
  const ruleInfo = mcpInfoFromString(ruleToolName)
  if (ruleInfo === null || toolInfo === null) {
    return false
  }
  if (ruleInfo.serverName !== toolInfo.serverName) {
    return false
  }
  if (ruleInfo.toolName === undefined || ruleInfo.toolName === '*') {
    return true
  }
  if (!ruleInfo.toolName.includes('*') || toolInfo.toolName === undefined) {
    return false
  }
  return compileWildcardMatcher(ruleInfo.toolName)(toolInfo.toolName)
}

/**
 * #1779: Match claude.ai connector terminal/Desktop alias spellings for deny,
 * ask, and `disallowedTools` rules ONLY. Callers MUST NEVER invoke this for
 * `allow` rules.
 */
function matchesConnectorAliasForDenyOrAsk(
  toolName: string,
  ruleToolName: string,
  mcpClients?: readonly MCPServerConnection[],
): boolean {
  if (
    !toolName.startsWith(MCP_PREFIX) ||
    !ruleToolName.startsWith(MCP_PREFIX)
  ) {
    return false
  }
  if (toolMatchesWithConnectorAliases(toolName, ruleToolName, mcpClients)) {
    return true
  }
  const toolInfo = mcpInfoFromString(toolName)
  const ruleInfo = mcpInfoFromString(ruleToolName)
  if (!toolInfo || !ruleInfo) {
    return false
  }
  const ruleAliases = expandConnectorToolAliases(ruleToolName)
  const ruleIsServerOnly = ruleInfo.toolName === undefined
  for (const alias of ruleAliases) {
    const aliasInfo = mcpInfoFromString(alias)
    if (!aliasInfo) continue
    if (ruleIsServerOnly) {
      // Server-level rule (e.g. `mcp__claude_ai_Slack`): only match server-level
      // aliases (e.g. `mcp__Slack`), ignoring synthetic `mcp__Slack__undefined`.
      if (aliasInfo.toolName !== undefined) continue
      if (coversMcpTool(alias, toolInfo)) return true
    } else {
      // Tool-level or wildcard rule (e.g. `mcp__claude_ai_Slack__post` or
      // `mcp__claude_ai_Slack__*`): require tool-level alias so a single-tool
      // deny rule never widens to the whole server.
      if (aliasInfo.toolName === undefined) continue
      if (alias === toolName || coversMcpTool(alias, toolInfo)) return true
    }
  }
  return false
}

/**
 * Official 2.1.325 #2313 (SEA `mYa` / `Lbt` / `Vho` @289722180, @292689088,
 * @306535905): True when a tool (including a cloud session's MCP Artifacts
 * stand-in tool or Artifact family sub-tool) stands in for the built-in
 * `Artifact` tool so `Artifact` deny/ask permission rules apply to it.
 */
const ARTIFACT_FAMILY_TOOLS = new Set([
  'ArtifactComments',
  'ArtifactData',
  'ArtifactCheck',
])

const ARTIFACT_STANDIN_MCP_SERVERS = new Set([
  'artifacts',
  'claude_ai_artifacts',
  'claude_ai_artifact',
])

export function standsInForBuiltInArtifactTool(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): boolean {
  if (ARTIFACT_FAMILY_TOOLS.has(tool.name)) {
    return true
  }
  const mcpInfo = tool.mcpInfo as
    | (NonNullable<Tool['mcpInfo']> & { standsInForBuiltIn?: boolean })
    | undefined
  if (mcpInfo?.standsInForBuiltIn === true) {
    return true
  }
  if (mcpInfo?.serverName) {
    const normServer = normalizeNameForMCP(mcpInfo.serverName).toLowerCase()
    if (ARTIFACT_STANDIN_MCP_SERVERS.has(normServer)) {
      return true
    }
  }
  const parsed = mcpInfoFromString(tool.name)
  if (
    parsed !== null &&
    ARTIFACT_STANDIN_MCP_SERVERS.has(parsed.serverName.toLowerCase())
  ) {
    return true
  }
  return false
}

export function standsInForBuiltInArtifactToolName(toolName: string): boolean {
  if (ARTIFACT_FAMILY_TOOLS.has(toolName)) {
    return true
  }
  const parsed = mcpInfoFromString(toolName)
  return (
    parsed !== null &&
    ARTIFACT_STANDIN_MCP_SERVERS.has(parsed.serverName.toLowerCase())
  )
}

/**
 * Official 2.1.325 #2319 (SEA `a5e` / `fzt` / `IWr` @283106674):
 * A slash command's `allowed-tools` grants (`alwaysAllowRules.command`) must
 * NEVER leak to background/async subagents woken during or after its turn.
 */
export function stripCommandAllowedToolsForBackgroundAgent(
  permissionContext: ToolPermissionContext,
  context?: Pick<ToolUseContext, 'agentId'>,
): ToolPermissionContext {
  const agentCtx = getAgentContext()
  const isBackgroundAgent =
    agentCtx !== undefined &&
    (agentCtx.isBackgroundAgent === true ||
      (agentCtx.agentType === 'subagent' && agentCtx.isAsync === true))
  const isPollGuarded =
    (
      permissionContext as ToolPermissionContext & {
        pollEventDeliveryGuard?: boolean
      }
    ).pollEventDeliveryGuard === true
  if (
    !isBackgroundAgent &&
    !isPollGuarded &&
    !(context?.agentId !== undefined && agentCtx?.isBackgroundAgent === true)
  ) {
    return permissionContext
  }
  return clearCommandScopedAllowRules(permissionContext)
}

/**
 * Check if the entire tool matches a rule
 * For example, this matches "Bash" but not "Bash(prefix:*)" for BashTool
 * This also matches MCP tools with a server name, e.g. the rule "mcp__server1"
 */
export function toolMatchesRule(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
  rule: PermissionRule,
  mcpClients?: readonly MCPServerConnection[],
): boolean {
  // Rule must not have content to match the entire tool
  if (rule.ruleValue.ruleContent !== undefined) {
    return false
  }

  // MCP tools are matched by their fully qualified mcp__server__tool name. In
  // skip-prefix mode (CLAUDE_AGENT_SDK_MCP_NO_PREFIX), MCP tools have unprefixed
  // display names (e.g., "Write") that collide with builtin names; rules targeting
  // builtins should not match their MCP replacements.
  const nameForRuleMatch = getToolNameForPermissionCheck(tool)

  // Direct tool name match
  if (rule.ruleValue.toolName === nameForRuleMatch) {
    return true
  }

  // Official 2.1.325 #2313: Deny and ask rules for `Artifact` also apply to
  // cloud-session MCP Artifact stand-in tools and Artifact family tools.
  // Never widen `allow` rules here.
  if (
    rule.ruleBehavior !== 'allow' &&
    rule.ruleValue.toolName === 'Artifact' &&
    standsInForBuiltInArtifactTool(tool)
  ) {
    return true
  }

  // Glob match on tool name (e.g. mcp__a__b__*)
  // Official 2.1.325 #2322 (SEA `x` @283306800): deny and ask rules starting
  // with `mcp__plugin_*_` match plugin MCP server/tool names case-insensitively.
  if (rule.ruleValue.toolName.includes('*')) {
    const caseInsensitivePluginRule =
      rule.ruleBehavior !== 'allow' &&
      rule.ruleValue.toolName.startsWith('mcp__plugin_*_')
    const rulePattern = caseInsensitivePluginRule
      ? rule.ruleValue.toolName.toLowerCase()
      : rule.ruleValue.toolName
    const targetName = caseInsensitivePluginRule
      ? nameForRuleMatch.toLowerCase()
      : nameForRuleMatch
    if (compileWildcardMatcher(rulePattern)(targetName)) {
      return true
    }
  }

  // MCP server-level permission:
  // - For allow rules (#722): require exact server prefix match (zii) so
  //   `mcp__a` does not allow `a__b` or `a_`; callers must use `mcp__<server>__*`
  //   when the server name contains `__`.
  //   STRICT (#1779): Never expand claude.ai connector aliases for `allow`.
  // - For deny/ask rules (#629, #1779): also match any `mcp__<server>` prefix in
  //   getMcpServerRuleNames(tool) and claude.ai connector terminal/Desktop aliases.
  const toolInfo = mcpInfoFromString(nameForRuleMatch)
  const coversMcp = coversMcpTool(rule.ruleValue.toolName, toolInfo)
  if (rule.ruleBehavior === 'allow') {
    if (!coversMcp) {
      return false
    }
    return mcpAllowRuleMatchesServerExactly(rule.ruleValue.toolName, tool)
  }

  return (
    coversMcp ||
    (rule.source !== 'mcpServerPolicy' &&
      rule.ruleValue.toolName.startsWith(MCP_PREFIX) &&
      getMcpServerRuleNames(tool).includes(rule.ruleValue.toolName)) ||
    (rule.source !== 'mcpServerPolicy' &&
      matchesConnectorAliasForDenyOrAsk(
        nameForRuleMatch,
        rule.ruleValue.toolName,
        mcpClients,
      ))
  )
}

/**
 * Check if the entire tool is listed in the always allow rules
 * For example, this finds "Bash" but not "Bash(prefix:*)" for BashTool
 */
export function toolAlwaysAllowedRule(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): PermissionRule | null {
  return (
    getAllowRules(context).find(rule => toolMatchesRule(tool, rule)) || null
  )
}

/**
 * #22 SEA `$Fe`: true when the decisionReason is a server-pushed ask rule
 * (`mcpServerPolicy`).
 */
export function isMcpServerPolicyAskReason(
  reason: PermissionDecisionReason | undefined,
): boolean {
  return (
    reason?.type === 'rule' &&
    reason.rule.ruleBehavior === 'ask' &&
    reason.rule.source === 'mcpServerPolicy'
  )
}

/**
 * #22 SEA `Ern` / `ekt`: in plan mode, non-read-only MCP connector tools
 * carrying a server-pushed `mcpServerPolicy` ask rule must hit `plan_mode_floor`
 * instead of being sent to the auto mode classifier.
 */
export function isPlanModeNonReadOnlyWrite(
  tool: Pick<
    Tool,
    | 'name'
    | 'mcpInfo'
    | 'inputSchema'
    | 'isReadOnly'
    | 'requiresUserInteraction'
  >,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): boolean {
  const permissionContext = getToolPermissionContextFromLayers(context)
  if (permissionContext.mode !== 'plan') return false
  try {
    const parsedInput = tool.inputSchema.parse(input)
    return (
      !tool.isReadOnly(parsedInput) &&
      !isChromeMcpReadOnlyTool(getToolNameForPermissionCheck(tool), parsedInput)
    )
  } catch {
    return true
  }
}

function isBypassedByPrePlanMode(
  permissionContext: Pick<
    ToolPermissionContext,
    'prePlanMode' | 'isBypassPermissionsModeAvailable'
  >,
): boolean {
  return (
    permissionContext.prePlanMode === 'bypassPermissions' &&
    Boolean(permissionContext.isBypassPermissionsModeAvailable)
  )
}

export function isPlanModeWriteFloorForMcpServerPolicy(
  reason: PermissionDecisionReason | undefined,
  tool: Pick<Tool, 'name' | 'mcpInfo' | 'inputSchema' | 'isReadOnly'>,
  input: { [key: string]: unknown },
  permissionContext: Pick<ToolPermissionContext, 'mode'>,
): boolean {
  if (!isMcpServerPolicyAskReason(reason)) return false
  if (permissionContext.mode !== 'plan') return false
  if (!tool.mcpInfo) return false
  try {
    const parsedInput = tool.inputSchema.parse(input)
    return (
      !tool.isReadOnly(parsedInput) &&
      !isChromeMcpReadOnlyTool(getToolNameForPermissionCheck(tool), parsedInput)
    )
  } catch {
    return true
  }
}

/**
 * #64 SEA `yis` + `e1n` + `wBr`: return the tool name to suggest for an
 * allow rule in an auto-mode denial message, or `undefined` if suggesting a
 * whole-tool rule would skip the classifier or be ignored by Claude Code.
 */
export function getAutoModeDenialAllowRuleToolName(
  tool: Pick<
    Tool,
    'name' | 'mcpInfo' | 'requiresUserInteraction' | 'suppressesAlwaysAllowRule'
  > & {
    suppressesAllPermissionUpdates?: (input: Record<string, unknown>) => boolean
    ignoresWholeToolAllowRule?: (input: Record<string, unknown>) => boolean
  },
  input: Record<string, unknown>,
  permissionResult: PermissionDecision | undefined,
  context: Pick<ToolUseContext, 'forRemoteExecution'>,
): string | undefined {
  if (permissionResult === undefined) return undefined
  if (
    isMcpServerPolicyAskReason(permissionResult.decisionReason) ||
    (permissionResult.behavior === 'ask' &&
      permissionResult.matchedAskRule?.source === 'mcpServerPolicy')
  ) {
    return undefined
  }
  if (
    permissionResult.decisionReason?.type === 'hook' ||
    permissionResult.decisionReason?.type === 'sandboxOverride' ||
    findSafetyCheckDecision(permissionResult.decisionReason) !== undefined
  ) {
    return undefined
  }
  if (
    (permissionResult.behavior === 'ask' &&
      permissionResult.suppressAlwaysAllowRule === true) ||
    context.forRemoteExecution === true
  ) {
    return undefined
  }
  if (
    tool.requiresUserInteraction?.() === true ||
    tool.suppressesAlwaysAllowRule?.(input) === true ||
    tool.suppressesAllPermissionUpdates?.(input) === true ||
    tool.ignoresWholeToolAllowRule?.(input) === true
  ) {
    return undefined
  }
  const toolName = getToolNameForPermissionCheck(tool)
  if (toolName === BASH_TOOL_NAME || toolName === POWERSHELL_TOOL_NAME) {
    // SEA `wBr` / `ece`: omit Bash/PowerShell when sandbox auto-allow or
    // classifier-skip would be bypassed by a whole-tool rule.
    if (
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled()
    ) {
      return undefined
    }
    return toolName
  }
  return toolName
}

/**
 * Official 2.1.328 (`Z` / `e$t`): returns true when sandbox auto-allow is
 * suspended either directly on `toolPermissionContext` or via an active
 * `sandbox_auto_allow_suspended` entry in `context.permissionLayers`.
 */
export function isSandboxAutoAllowSuspended(
  toolPermissionContext: ToolPermissionContext,
  context?: Pick<ToolUseContext, 'permissionLayers'>,
  opts?: { ignoreAllowOnly?: boolean },
): boolean {
  if (
    (toolPermissionContext as { sandboxAutoAllowSuspended?: boolean })
      .sandboxAutoAllowSuspended === true
  ) {
    return true
  }
  return isSandboxAutoAllowSuspendedInLayers(context?.permissionLayers, opts)
}

/**
 * densable 2.1.235 #12 `jze` / stripWholeToolGrantsForAsk.
 *
 * When an ask sets suppressAlwaysAllowRule (or the tool's
 * suppressesAlwaysAllowRule(input) is true), accepting with permanent updates
 * must not mint a bare whole-tool allow broader than the ask verb. Strip
 * addRules(allow) entries whose ruleContent is absent and match this tool.
 */
export function stripWholeToolGrantsForAsk(
  updates: PermissionUpdate[],
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
  _context?: ToolPermissionContext,
): PermissionUpdate[] {
  const out: PermissionUpdate[] = []
  for (const update of updates) {
    if (update.type !== 'addRules' || update.behavior !== 'allow') {
      out.push(update)
      continue
    }
    const rules = update.rules.filter(rule => {
      // Keep scoped rules (have content) and rules that do not whole-match tool.
      if (rule.ruleContent !== undefined) return true
      return !toolMatchesRule(tool, {
        source: 'session',
        ruleBehavior: 'allow',
        ruleValue: rule,
      })
    })
    if (rules.length === 0) continue
    if (rules.length === update.rules.length) {
      out.push(update)
      continue
    }
    out.push({ ...update, rules })
  }
  return out
}

/**
 * Check if the tool is listed in the always deny rules
 */
export function getDenyRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'> & {
    enablesCodeExecution?: boolean
    underlyingV1ToolName?: string
  },
  mcpClients?: readonly MCPServerConnection[],
): PermissionRule | null {
  const rules = getDenyRules(context)
  const direct = rules.find(rule => toolMatchesRule(tool, rule, mcpClients))
  if (direct) return direct
  if (tool.underlyingV1ToolName) {
    const v1Rule = rules.find(rule =>
      toolMatchesRule({ name: tool.underlyingV1ToolName! }, rule, mcpClients),
    )
    if (v1Rule) return v1Rule
  }
  if (
    context.restricted &&
    context.toolsKeptByLaunchList === undefined &&
    tool.enablesCodeExecution
  ) {
    return {
      source: 'toolsNarrowing',
      ruleBehavior: 'deny',
      ruleValue: { toolName: tool.name },
    }
  }
  return null
}

/**
 * Check if the tool is listed in the always ask rules
 */
export function getAskRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
  mcpClients?: readonly MCPServerConnection[],
): PermissionRule | null {
  return (
    getAskRules(context).find(rule =>
      toolMatchesRule(tool, rule, mcpClients),
    ) || null
  )
}

/**
 * Check if a specific agent is denied via Agent(agentType) syntax.
 * For example, Agent(Explore) would deny the Explore agent.
 *
 * Official 2.1.207 `_5e` has no CLAUDE_CODE_AGENT_RULE_DISABLED gate —
 * that env only appears near unrelated Bun schema noise.
 */
export function getDenyRuleForAgent(
  context: ToolPermissionContext,
  agentToolName: string,
  agentType: string,
): PermissionRule | null {
  return (
    getDenyRules(context).find(
      rule =>
        rule.ruleValue.toolName === agentToolName &&
        rule.ruleValue.ruleContent === agentType,
    ) || null
  )
}

/**
 * Filter agents to exclude those that are denied via Agent(agentType) syntax.
 * Official 2.1.207 `_nt` — no AGENT_RULE_DISABLED short-circuit.
 */
export function filterDeniedAgents<T extends { agentType: string }>(
  agents: T[],
  context: ToolPermissionContext,
  agentToolName: string,
): T[] {
  // Parse deny rules once and collect Agent(x) contents into a Set.
  // Previously this called getDenyRuleForAgent per agent, which re-parsed
  // every deny rule for every agent (O(agents×rules) parse calls).
  const deniedAgentTypes = new Set<string>()
  for (const rule of getDenyRules(context)) {
    if (
      rule.ruleValue.toolName === agentToolName &&
      rule.ruleValue.ruleContent !== undefined
    ) {
      deniedAgentTypes.add(rule.ruleValue.ruleContent)
    }
  }
  return agents.filter(agent => !deniedAgentTypes.has(agent.agentType))
}

/**
 * Map of rule contents to the associated rule for a given tool.
 * e.g. the string key is "prefix:*" from "Bash(prefix:*)" for BashTool
 */
export function getRuleByContentsForTool(
  context: ToolPermissionContext,
  tool: Tool,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  return getRuleByContentsForToolName(
    context,
    getToolNameForPermissionCheck(tool),
    behavior,
  )
}

// Used to break circular dependency where a Tool calls this function
export function getRuleByContentsForToolName(
  context: ToolPermissionContext,
  toolName: string,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  const ruleByContents = new Map<string, PermissionRule>()
  const sources =
    behavior === 'allow' && isEvalConfined()
      ? (['cliArg'] as const satisfies readonly PermissionRuleSource[])
      : PERMISSION_RULE_SOURCES
  const filterBroadRules =
    behavior === 'allow' &&
    isAutoModeFilteringActive(
      context.mode,
      autoModeStateModule?.isAutoModeActive() ?? false,
      context.servedCall === true,
    )
  const rulesBySource =
    behavior === 'allow'
      ? context.alwaysAllowRules
      : behavior === 'deny'
        ? context.alwaysDenyRules
        : context.alwaysAskRules

  // Official 2.1.327 (#441, SEA `ROe`/`Pe`): O(1) per-tool bucket lookup for
  // exact tool names so tens of thousands of connector tool permissions never
  // slow down Bash/Read/Edit/etc. lookups on every turn.
  const isMcpOrArtifactTool =
    toolName.startsWith(MCP_PREFIX) ||
    standsInForBuiltInArtifactToolName(toolName)

  if (behavior === 'allow' || !isMcpOrArtifactTool) {
    const matchingRules = collectRulesForBehavior(
      rulesBySource,
      sources,
      behavior,
      toolName,
    )
    for (const rule of matchingRules) {
      if (rule.ruleValue.ruleContent === undefined) continue
      if (
        filterBroadRules &&
        (isBroadRule(rule.ruleValue.toolName, rule.ruleValue.ruleContent) ||
          isAutoModeDroppedHearthbotAllow(rule.ruleValue.toolName))
      ) {
        continue
      }
      ruleByContents.set(rule.ruleValue.ruleContent, clonePermissionRule(rule))
    }
    return ruleByContents
  }

  // For MCP/Artifact deny/ask queries, also check aliased tool names using
  // the cached parsed buckets (still avoids re-parsing all strings).
  const candidateRules = collectRulesForBehavior(
    rulesBySource,
    sources,
    behavior,
  )
  for (const rule of candidateRules) {
    if (
      rule.ruleValue.ruleContent !== undefined &&
      (rule.ruleValue.toolName === toolName ||
        matchesConnectorAliasForDenyOrAsk(toolName, rule.ruleValue.toolName) ||
        (rule.ruleValue.toolName === 'Artifact' &&
          standsInForBuiltInArtifactToolName(toolName)))
    ) {
      ruleByContents.set(rule.ruleValue.ruleContent, clonePermissionRule(rule))
    }
  }
  return ruleByContents
}

/**
 * Official 325 `Ivt` / `fpn` (#727) — in Cowork cloud sessions (`remote_cowork`)
 * under auto mode, a `PermissionRequest` hook cannot approve shell commands or
 * subagents; those prompts must wait or be denied.
 */
export function isCoworkCloudAutoHookAllowBlocked(
  toolName: string,
  permissionMode: string | undefined,
): boolean {
  if (process.env.CLAUDE_CODE_ENTRYPOINT !== 'remote_cowork') return false
  if (permissionMode !== 'auto') return false
  return (
    toolName.startsWith('mcp__') ||
    toolName === BASH_TOOL_NAME ||
    toolName === POWERSHELL_TOOL_NAME ||
    toolName === AGENT_TOOL_NAME
  )
}

/**
 * Runs PermissionRequest hooks for headless/async agents that cannot show
 * permission prompts. This gives hooks an opportunity to allow or deny
 * tool use before the fallback auto-deny kicks in.
 *
 * Returns a PermissionDecision if a hook made a decision, or null if no
 * hook provided a decision (caller should proceed to auto-deny).
 */
async function runPermissionRequestHooksForHeadlessAgent(
  tool: Tool,
  input: { [key: string]: unknown },
  toolUseID: string,
  context: ToolUseContext,
  permissionMode: string | undefined,
  suggestions: PermissionUpdate[] | undefined,
): Promise<PermissionDecision | null> {
  try {
    for await (const hookResult of executePermissionRequestHooks(
      tool.name,
      toolUseID,
      input,
      context,
      permissionMode,
      suggestions as any,
      context.abortController.signal,
    )) {
      if (!hookResult.permissionRequestResult) {
        continue
      }
      const decision = hookResult.permissionRequestResult
      // densable QLn — confined child ignores PermissionRequest allow
      if (isEvalConfined() && decision.behavior === 'allow') {
        continue
      }
      // 2.1.299 #727 — Cowork cloud auto mode blocks PermissionRequest allow for shell & subagents
      if (
        decision.behavior === 'allow' &&
        isCoworkCloudAutoHookAllowBlocked(tool.name, permissionMode)
      ) {
        logEvent('tengu_auto_mode_permission_request_allow_ignored', {})
        continue
      }
      if (decision.behavior === 'allow') {
        const nonEmptyUpdatedInput =
          decision.updatedInput !== undefined &&
          Object.keys(decision.updatedInput).length > 0
            ? decision.updatedInput
            : undefined
        const finalInput = nonEmptyUpdatedInput ?? input
        if (
          decision.updatedInput !== undefined &&
          didAccountMemoryHookRewriteInput(
            tool,
            input,
            decision.updatedInput,
            true,
          )
        ) {
          const denial = accountMemoryHookRewriteDenied(
            tool,
            'PermissionRequest',
          )
          return {
            behavior: 'deny',
            message: denial.message,
            decisionReason: {
              type: 'hook',
              hookName: 'PermissionRequest',
              reason: denial.message,
            },
          }
        }
        // Official 2.1.328 `iSn`/`Zlt`: reject `__artifact*` reserved keys,
        // strip unrecognized keys, validate schema, and re-run `tool.validateInput()`.
        let validatedUpdatedInput = nonEmptyUpdatedInput
        if (nonEmptyUpdatedInput !== undefined) {
          const { validatePermissionRequestUpdatedInput } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../services/tools/toolHooks.js') as typeof import('../../services/tools/toolHooks.js')
          const hookCheck = await validatePermissionRequestUpdatedInput(
            tool,
            nonEmptyUpdatedInput,
            input,
            tool.validateInput
              ? parsedInput =>
                  tool.validateInput!(parsedInput as never, context)
              : undefined,
          )
          if (hookCheck.deny !== undefined) {
            return hookCheck.deny
          }
          validatedUpdatedInput = hookCheck.input
        }
        const checkedFinalInput = validatedUpdatedInput ?? input
        if (validatedUpdatedInput !== undefined) {
          const objection = await checkRuleBasedPermissions(
            tool,
            checkedFinalInput,
            context,
            { crashIsObjection: true },
          )
          if (objection !== null) {
            return objection.behavior === 'ask'
              ? {
                  behavior: 'deny',
                  message: objection.message,
                  decisionReason: objection.decisionReason ?? {
                    type: 'hook',
                    hookName: 'PermissionRequest',
                    reason: objection.message,
                  },
                }
              : objection
          }
        }
        // Official 2.1.328 #671: if a PermissionRequest hook rewrites a shell
        // command to a sandbox-excluded command, record the rewritten sandbox
        // state so the command runs outside the sandbox.
        if (
          validatedUpdatedInput !== undefined &&
          (tool.name === BASH_TOOL_NAME || tool.name === POWERSHELL_TOOL_NAME)
        ) {
          const shellType =
            tool.name === POWERSHELL_TOOL_NAME ? 'powershell' : 'bash'
          const rewrittenSandboxInput = {
            ...(checkedFinalInput as {
              command?: string
              dangerouslyDisableSandbox?: boolean
            }),
            shellType: shellType as 'bash' | 'powershell',
          }
          recordSandboxStateAtHookRewrite(
            toolUseID,
            rewrittenSandboxInput,
            shouldUseSandbox(rewrittenSandboxInput),
          )
        }
        // Persist permission updates if provided
        if (decision.updatedPermissions?.length) {
          persistPermissionUpdates(decision.updatedPermissions as any)
          context.setAppState(prev => ({
            ...prev,
            toolPermissionContext: applyPermissionUpdates(
              prev.toolPermissionContext,
              decision.updatedPermissions as any,
            ),
          }))
        }
        return {
          behavior: 'allow',
          updatedInput: checkedFinalInput,
          decisionReason: {
            type: 'hook',
            hookName: 'PermissionRequest',
          },
        }
      }
      if (decision.behavior === 'deny') {
        if (decision.interrupt) {
          logForDebugging(
            `Hook interrupt: tool=${tool.name} hookMessage=${decision.message}`,
          )
          context.abortController.abort()
        }
        return {
          behavior: 'deny',
          message: decision.message || 'Permission denied by hook',
          decisionReason: {
            type: 'hook',
            hookName: 'PermissionRequest',
            reason: decision.message,
          },
        }
      }
    }
  } catch (error) {
    // If hooks fail, fall through to auto-deny rather than crashing
    logError(
      new Error('PermissionRequest hook failed for headless agent', {
        cause: toError(error),
      }),
    )
  }
  return null
}

type EvaluatedToolCheckEntry = {
  override?: { decision: 'allow' | 'ask' | 'deny'; reason?: string }
}

const evaluatedToolChecks = new WeakMap<
  object,
  Map<string, EvaluatedToolCheckEntry>
>()

function canonicalizeForInputFingerprint(
  value: unknown,
  seen: Set<object>,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => canonicalizeForInputFingerprint(item, seen))
  }
  const sorted: Record<string, unknown> = {}
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalizeForInputFingerprint(record[key], seen)
  }
  return sorted
}

function stableInputFingerprint(input: unknown): string {
  try {
    return (
      JSON.stringify(canonicalizeForInputFingerprint(input, new Set())) ?? ''
    )
  } catch {
    return pinValue(input)
  }
}

function toolCheckCallKey(
  toolUseID: string,
  input: Record<string, unknown>,
): string {
  return `${toolUseID}\0${stableInputFingerprint(input)}`
}

let functionHooksModCache:
  | typeof import('../plugins/functionHooksModules.js')
  | undefined

function getFunctionHooksMod(): typeof import('../plugins/functionHooksModules.js') {
  if (!functionHooksModCache) {
    // Lazy require avoids pulling the 13k-line functionHooksModules graph
    // (telemetry/ink/plugins) at permissions.ts module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    functionHooksModCache =
      require('../plugins/functionHooksModules.js') as typeof import('../plugins/functionHooksModules.js')
  }
  return functionHooksModCache
}

export function hasEvaluatedToolCheckForCall(
  context: ToolUseContext,
  toolUseID: string | undefined,
  input?: Record<string, unknown>,
): boolean {
  if (!toolUseID || !context.abortController) return false
  const seen = evaluatedToolChecks.get(context.abortController)
  if (!seen) return false
  if (input !== undefined) {
    return seen.has(toolCheckCallKey(toolUseID, input))
  }
  const prefix = `${toolUseID}\0`
  for (const key of seen.keys()) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

function getEvaluatedToolCheckEntry(
  context: ToolUseContext,
  toolUseID: string | undefined,
  input: Record<string, unknown>,
): EvaluatedToolCheckEntry | undefined {
  if (!toolUseID || !context.abortController) return undefined
  return evaluatedToolChecks
    .get(context.abortController)
    ?.get(toolCheckCallKey(toolUseID, input))
}

function markToolCheckEvaluatedForCall(
  context: ToolUseContext,
  toolUseID: string | undefined,
  input: Record<string, unknown>,
  entry: EvaluatedToolCheckEntry = {},
): void {
  if (!toolUseID || !context.abortController) return
  let seen = evaluatedToolChecks.get(context.abortController)
  if (!seen) {
    seen = new Map<string, EvaluatedToolCheckEntry>()
    evaluatedToolChecks.set(context.abortController, seen)
  }
  seen.set(toolCheckCallKey(toolUseID, input), entry)
}

const toolCheckSite: FunctionHookHopSite = {
  restoreArgument: (passed, original) =>
    restorePinnedKeys(
      ['tool_use_id', 'agentId', 'ceiling', 'approver', 'isReadOnly'],
      passed,
      original,
    ),
  checkArgument: (passed, original) => {
    if (
      passed.tool !== original.tool ||
      pinValue(passed.input) !== pinValue(original.input) ||
      passed.tool_use_id !== original.tool_use_id ||
      passed.agentId !== original.agentId ||
      passed.ceiling !== original.ceiling ||
      passed.approver !== original.approver ||
      passed.isReadOnly !== original.isReadOnly
    ) {
      return 'the tool, its input and the call are the question and are pinned; a hook answers { decision }, it does not ask about another call'
    }
    return undefined
  },
  restoreResult: (returned, priorResults, original) => {
    const { ceiling: _dropped, ...rest } = returned
    const ceiling =
      original.ceiling ??
      priorResults.find(entry => entry.ceiling !== undefined)?.ceiling
    return ceiling === undefined ? rest : { ...rest, ceiling }
  },
}

function findMatchedRuleInReason(
  reason: PermissionDecisionReason | undefined,
  behavior: PermissionDecision['behavior'],
): PermissionRule | undefined {
  if (!reason) return undefined
  if (reason.type === 'rule') return reason.rule
  if (reason.type !== 'subcommandResults') return undefined
  for (const subResult of reason.reasons.values()) {
    if (subResult.behavior !== behavior) continue
    const subReason = subResult.decisionReason
    const found =
      subReason?.type === 'rule'
        ? subReason.rule
        : findMatchedRuleInReason(subReason, behavior)
    if (found !== undefined) return found
  }
  return undefined
}

function permissionDecisionToToolCheckRecord(
  decided: PermissionDecision,
  hookFloor: string | undefined,
): Record<string, unknown> {
  const decisionReason = decided.decisionReason
  const reason =
    decided.behavior === 'allow'
      ? decisionReason && 'reason' in decisionReason
        ? decisionReason.reason
        : undefined
      : decided.message
  const matchedRule =
    findMatchedRuleInReason(decisionReason, decided.behavior) ??
    (decided.behavior === 'ask' ? decided.matchedAskRule : undefined)
  const hook =
    (decisionReason?.type === 'hook' && decisionReason.hookName !== 'tool.check'
      ? decisionReason.hookName.split(':').at(0)
      : undefined) || hookFloor
  return {
    decision: decided.behavior,
    ...(reason ? { reason } : {}),
    ...(matchedRule
      ? { rule: permissionRuleValueToString(matchedRule.ruleValue) }
      : {}),
    ...(hook ? { hook } : {}),
  }
}

function isToolCheckDecisionValue(
  value: unknown,
): value is 'allow' | 'ask' | 'deny' {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

/**
 * densable `gzt` — connected hearthbot MCP that is dynamic, not CLI-owned,
 * and a CCR hearthbot URL (`Jkn`).
 */
function isHearthbotProjectsMcpClient(client: unknown): boolean {
  if (client === null || typeof client !== 'object') return false
  const rec = client as { name?: unknown; config?: unknown }
  if (rec.name !== HEARTHBOT_MCP_SERVER_NAME) return false
  const config = rec.config
  if (config === null || typeof config !== 'object') return false
  const scoped = config as { scope?: unknown; url?: unknown }
  if (scoped.scope !== 'dynamic' || isCliOwnedConfig(config)) return false
  return typeof scoped.url === 'string' && isHearthbotCcrProxyUrl(scoped.url)
}

/** densable `Sbt(SS())` — any hearthbot Projects MCP on the session accessor. */
function hasHearthbotProjectsMcpSession(): boolean {
  const clients = getBootstrapSession().mcpSessionWiring.clientsFromAccessor()
  if (!Array.isArray(clients)) return false
  return clients.some(isHearthbotProjectsMcpClient)
}

/**
 * densable `Uoe` @187630400 — plugin `tool.check` may only tighten WebFetch /
 * WebSearch in a Projects session (env, hearthbot pin, or hearthbot MCP).
 * Payload `bot_protected_tengu_atomic_magpie` kills the gate (local has no
 * `hasUsedNonDefaultHost`; treat as default host).
 */
function pluginToolCheckCanOnlyTightenInProjects(toolName: string): boolean {
  if (toolName !== WEB_FETCH_TOOL_NAME && toolName !== WEB_SEARCH_TOOL_NAME) {
    return false
  }
  if (
    !(
      isHearthbotBareElicitationPinned() ||
      isEnvTruthy(process.env.CLAUDE_CODE_PROJECTS_SESSION) ||
      hasHearthbotProjectsMcpSession()
    )
  ) {
    return false
  }
  const magpie = getFeatureValueWithSource(
    'bot_protected_tengu_atomic_magpie',
    false,
  )
  return !(magpie.value === true && magpie.source === 'payload')
}

const TRANSCRIPT_TOO_LONG_COMPACT_REASON =
  'Auto mode classifier transcript exceeded context window; will try to compact the conversation before the next request'

type ClassifierOverflowCompactEntry = {
  canCompact: boolean
  spentEpoch?: string
  pending?: {
    epoch: string
    mode: PermissionMode
    toolName: string
    deniedToolNames: string[]
  }
}

const classifierOverflowCompactByAgent = new Map<
  string,
  ClassifierOverflowCompactEntry
>()

export function consumeClassifierOverflowCompact(
  agentId: string | undefined,
  messages: readonly { uuid?: string }[],
  canCompactNext: boolean,
  currentMode?: PermissionMode,
): {
  pending?: ClassifierOverflowCompactEntry['pending']
  stale?: 'epoch' | 'mode'
} {
  const key = agentId ?? 'main'
  const prev = classifierOverflowCompactByAgent.get(key)
  classifierOverflowCompactByAgent.set(key, {
    canCompact: canCompactNext,
    spentEpoch: prev?.spentEpoch,
  })
  const pending = prev?.pending
  if (pending === undefined) return {}
  if (pending.epoch !== messages[0]?.uuid) {
    return { pending, stale: 'epoch' }
  }
  if (currentMode !== undefined && pending.mode !== currentMode) {
    return { pending, stale: 'mode' }
  }
  return { pending }
}

/**
 * Official 325 `Fhn` — marks the classifier overflow compact epoch as spent
 * once compaction completes (or fails non-aborted), leaving `pending` cleared.
 */
export function markClassifierOverflowCompactSpent(
  agentId: string | undefined,
  epoch: string,
): void {
  const key = agentId ?? 'main'
  const prev = classifierOverflowCompactByAgent.get(key)
  classifierOverflowCompactByAgent.set(key, {
    canCompact: prev?.canCompact ?? false,
    ...prev,
    pending: undefined,
    spentEpoch: epoch,
  })
}

export function requestClassifierOverflowCompact(
  agentId: string | undefined,
  messages: readonly { uuid?: string }[],
  opts: { toolName: string; denied: boolean; mode: PermissionMode },
): 'requested' | 'joined' | undefined {
  if (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_merry_popcorn', true) !== true
  ) {
    return undefined
  }
  const epoch = messages[0]?.uuid
  if (epoch === undefined) return undefined
  const key = agentId ?? 'main'
  const entry = classifierOverflowCompactByAgent.get(key)
  if (entry?.canCompact !== true || entry.spentEpoch === epoch) {
    return undefined
  }
  const existing = entry.pending?.epoch === epoch ? entry.pending : undefined
  const base = existing ?? {
    epoch,
    mode: opts.mode,
    toolName: opts.toolName,
    deniedToolNames: [],
  }
  classifierOverflowCompactByAgent.set(key, {
    ...entry,
    pending: opts.denied
      ? { ...base, deniedToolNames: [...base.deniedToolNames, opts.toolName] }
      : base,
  })
  return existing ? 'joined' : 'requested'
}

function hasAsksNoHost(context: ToolUseContext): boolean {
  return (
    'asksNoHost' in context &&
    (context as { asksNoHost?: unknown }).asksNoHost === true
  )
}

function getToolCheckApprover(context: ToolUseContext): {
  approver?: 'host' | 'person'
} {
  const permCtx = getToolPermissionContextFromLayers(context)
  if (
    hasAsksNoHost(context) ||
    permCtx.mode === 'dontAsk' ||
    permCtx.shouldAvoidPermissionPrompts === true
  ) {
    return {}
  }
  return { approver: 'person' }
}

function safeCheckIsReadOnly(
  tool: Tool,
  input: unknown,
  _context: ToolUseContext,
): { isReadOnly: true } | Record<string, never> {
  if (typeof tool.isReadOnly !== 'function') return {}
  try {
    const parsed = tool.inputSchema?.safeParse?.(input)
    if (parsed !== undefined && !parsed.success) return {}
    return tool.isReadOnly((parsed ? parsed.data : input) as never)
      ? { isReadOnly: true }
      : {}
  } catch (err) {
    if (!isAbortError(err)) {
      logForDebugging(
        `tool.check ${tool.name}: isReadOnly threw (${toError(err).message})`,
      )
    }
    return {}
  }
}

function markAskPersonOnly<Input extends Record<string, unknown>>(
  decision: PermissionDecision<Input>,
): PermissionDecision<Input> {
  if (decision.behavior !== 'ask') return decision
  return {
    ...decision,
    suggestions: undefined,
    personOnly: true as const,
    suppressAlwaysAllowRule: true,
  }
}

const TOOL_CHECK_RESULT_IDENTITY_KEYS = [
  'decision',
  'reason',
  'rule',
  'hook',
  'setting',
] as const

/**
 * Official 2.1.323 `sc` (#2026) — attributes a `tool.check` `ask` result to
 * the specific plugin that asked rather than every plugin hooked on the tool.
 * Preserves an inner plugin's `plugin` stamp when an outer handler passes the
 * same ask result through unchanged.
 */
export function stripToolCheckHookResult(
  returned: Record<string, unknown>,
  priorResults: readonly Record<string, unknown>[],
  handler: { name: string; isHop?: boolean; plugins?: readonly string[] },
): Record<string, unknown> {
  const { plugin: stamped, ...rest } = returned
  if (rest.decision !== 'ask') return rest
  const matchingPrior = priorResults.filter(prior =>
    TOOL_CHECK_RESULT_IDENTITY_KEYS.every(key => prior[key] === rest[key]),
  )
  const inherited =
    matchingPrior.find(prior => prior.plugin === stamped) ?? matchingPrior[0]
  const attributedName =
    handler.isHop !== true
      ? handler.name
      : typeof stamped === 'string' &&
          handler.plugins?.includes(stamped) === true
        ? stamped
        : undefined
  const hopIntroducedNew =
    handler.isHop === true &&
    attributedName !== undefined &&
    matchingPrior.every(prior => prior.plugin !== stamped)
  const chosenPlugin =
    inherited !== undefined &&
    typeof inherited.plugin === 'string' &&
    !hopIntroducedNew
      ? inherited.plugin
      : attributedName
  return chosenPlugin === undefined ? rest : { ...rest, plugin: chosenPlugin }
}

function applyToolCheckHookResult<Input extends Record<string, unknown>>(
  rawResult: {
    decision: 'allow' | 'ask' | 'deny'
    reason?: string
    decider?: string
    plugin?: string
  },
  decided: PermissionDecision<Input> | undefined,
  toolName: string,
  input: Input,
  toolUseID: string | undefined,
): PermissionDecision<Input> {
  // Official 2.1.323 `sEs` (#2026): attribute to the specific asking plugin
  // (`rawResult.plugin`) when stamped, instead of naming every hooked plugin.
  const personAsked =
    rawResult.decision === 'ask' &&
    (rawResult.decider === 'person' || rawResult.plugin !== undefined)
  if (decided?.behavior === rawResult.decision) {
    if (decided.behavior === 'allow') return decided
    const withMsg = rawResult.reason
      ? { ...decided, message: rawResult.reason }
      : decided
    return personAsked ? markAskPersonOnly(withMsg) : withMsg
  }
  let hooked: string[]
  if (rawResult.plugin !== undefined) {
    hooked = [rawResult.plugin]
  } else {
    const { getLoadedFunctionHooksModules, hasMatchingFunctionHook } =
      getFunctionHooksMod()
    const hookedModules = getLoadedFunctionHooksModules()
      .filter(
        mod =>
          mod.status !== 'unloaded' &&
          hasMatchingFunctionHook('tool.check', { tool: toolName }, [mod]),
      )
      .map(mod => mod.name)
    hooked = hookedModules.length > 0 ? hookedModules : ['plugin']
  }
  const who = `${hooked.length === 1 ? 'plugin' : 'plugins'} ${hooked.join(', ')}`
  const reasonSuffix =
    rawResult.reason === undefined ? '' : `: ${rawResult.reason}`
  const message =
    rawResult.decision === 'deny'
      ? `Permission to use ${toolName} denied by ${who}${reasonSuffix}`
      : `${toolName} needs approval (asked by ${who}${reasonSuffix})`
  const decisionReason: PermissionDecisionReason = {
    type: 'hook',
    hookName: 'tool.check',
    hookSource: `plugin:${hooked.join('+')}`,
    reason: rawResult.reason,
  }
  const updatedInput: Input =
    decided?.behavior === 'deny'
      ? input
      : decided?.updatedInput !== undefined
        ? decided.updatedInput
        : input
  logForDebugging(
    `tool.check ${toolName} ${toolUseID ?? ''}: ${decided?.behavior ?? 'unevaluated'} -> ${rawResult.decision} by ${who}${reasonSuffix}`,
  )
  switch (rawResult.decision) {
    case 'allow':
      return { behavior: 'allow', updatedInput, decisionReason }
    case 'deny':
      return { behavior: 'deny', message, decisionReason }
    case 'ask': {
      const askDecision: PermissionDecision<Input> = {
        behavior: 'ask',
        message,
        updatedInput,
        decisionReason,
      }
      return personAsked ? markAskPersonOnly(askDecision) : askDecision
    }
  }
}

export async function evaluatePermissionWithToolCheck<
  Input extends Record<string, unknown> = Record<string, unknown>,
>({
  tool,
  input,
  context,
  toolUseID,
  evaluate,
}: {
  tool: Tool
  input: Input
  context: ToolUseContext
  toolUseID?: string
  evaluate: () => Promise<PermissionDecision<Input>>
}): Promise<PermissionDecision<Input>> {
  const { hasMatchingFunctionHook, runFunctionHookChain } =
    getFunctionHooksMod()
  if (!hasMatchingFunctionHook('tool.check', { tool: tool.name })) {
    return evaluate()
  }
  if (hasEvaluatedToolCheckForCall(context, toolUseID, input)) {
    const prior = getEvaluatedToolCheckEntry(context, toolUseID, input)
    const baseDecision = await evaluate()
    if (prior?.override?.decision === 'deny') {
      return applyToolCheckHookResult(
        prior.override,
        baseDecision,
        tool.name,
        input,
        toolUseID,
      )
    }
    return baseDecision
  }
  markToolCheckEvaluatedForCall(context, toolUseID, input)
  let decided: PermissionDecision<Input> | undefined
  const hookFloor = context.hookAskFloor === true ? 'PreToolUse' : undefined
  const approverInfo = getToolCheckApprover(context)
  const payload: Record<string, unknown> = {
    tool: tool.name,
    input,
    ...(toolUseID !== undefined && { tool_use_id: toolUseID }),
    ...(context.agentId !== undefined && { agentId: context.agentId }),
    ...(tool.requiresUserInteraction?.() && { ceiling: 'ask' }),
    ...safeCheckIsReadOnly(tool, input, context),
    ...approverInfo,
  }
  let rawOut: unknown
  try {
    rawOut = await runFunctionHookChain(
      'tool.check',
      payload,
      async () => {
        decided = await evaluate()
        return permissionDecisionToToolCheckRecord(decided, hookFloor)
      },
      undefined,
      undefined,
      {
        signal: context.abortController.signal,
        site: toolCheckSite,
      },
    )
  } catch (err) {
    if (
      err instanceof AbortError ||
      err instanceof APIUserAbortError ||
      context.abortController.signal.aborted
    ) {
      throw err
    }
    logForDebugging(
      `tool.check ${tool.name}: hook dispatch threw (${toError(err).message}); keeping permission check`,
    )
    return decided ?? evaluate()
  }
  if (
    rawOut !== null &&
    typeof rawOut === 'object' &&
    'decision' in rawOut &&
    isToolCheckDecisionValue((rawOut as Record<string, unknown>).decision)
  ) {
    const rec = rawOut as {
      decision: 'allow' | 'ask' | 'deny'
      reason?: unknown
      decider?: unknown
      plugin?: unknown
    }
    const decider = typeof rec.decider === 'string' ? rec.decider : undefined
    const plugin =
      typeof rec.plugin === 'string' && rec.plugin.length > 0
        ? rec.plugin
        : undefined
    const effectiveDecision =
      rec.decision === 'ask' &&
      (decider === 'person' || plugin !== undefined) &&
      approverInfo.approver === undefined
        ? ('deny' as const)
        : rec.decision
    const normalizedResult = {
      decision: effectiveDecision,
      reason: typeof rec.reason === 'string' ? rec.reason : undefined,
      ...(decider !== undefined && { decider }),
      ...(plugin !== undefined && { plugin }),
    }
    if (normalizedResult.decision === 'deny') {
      markToolCheckEvaluatedForCall(context, toolUseID, input, {
        override: normalizedResult,
      })
    }
    if (
      normalizedResult.decision !== 'deny' &&
      pluginToolCheckCanOnlyTightenInProjects(tool.name)
    ) {
      decided ??= await evaluate()
      if (
        normalizedResult.decision === 'allow' ||
        decided.behavior === 'deny'
      ) {
        logForDebugging(
          `tool.check ${tool.name} ${toolUseID}: ignored a plugin's ${normalizedResult.decision} and kept the permission check's ${decided.behavior}; plugins can only tighten ${tool.name}'s permission in a Projects session`,
        )
        return decided
      }
    }
    if (
      normalizedResult.decision === 'allow' &&
      !tool.requiresUserInteraction?.()
    ) {
      const permissionContext = getToolPermissionContextFromLayers(context)
      if (
        !isBypassedByPrePlanMode(permissionContext) &&
        isPlanModeNonReadOnlyWrite(tool, input, context)
      ) {
        decided ??= await evaluate()
        return decided.behavior === 'ask'
          ? decided
          : {
              behavior: 'ask',
              message: createPermissionRequestMessage(tool.name),
              decisionReason: { type: 'mode', mode: 'plan' },
            }
      }
    }
    return applyToolCheckHookResult(
      normalizedResult,
      decided,
      tool.name,
      input,
      toolUseID,
    )
  }
  return decided ?? evaluate()
}

/** densable UPt.wasLetGo — send-now took the call; later Allow must refuse. */
export function detachedLetGoPermissionDeny(
  toolUseID: string,
): PermissionDenyDecision | null {
  if (!detachedToolCallWasLetGo(toolUseID)) return null
  return {
    behavior: 'deny',
    message: REJECT_MESSAGE,
    decisionReason: {
      type: 'other',
      reason: 'detached tool call was let go',
    },
  }
}

export const HELD_FOR_QUEUED_MESSAGE_TOOL_RESULT =
  '[Tool call not run: a message from the user arrived first, so the user was not asked about this call. The call had no effects.]'

export const HELD_FOR_QUEUED_MESSAGE_DECISION_REASON = {
  type: 'other' as const,
  reason: 'tool permission request held back for a queued message',
}

class HeldAskResponseState {
  responseOf = new WeakMap<object, string>()
}

const fallbackHeldAskResponseMap = new WeakMap<object, string>()

/**
 * Official 325 `cn()` / `askIsHeldForQueuedMessage` (#861) — when a user
 * message is already queued in the same turn, hold back the permission prompt
 * and report a non-rejection tool result instead of user-rejected.
 */
export function askIsHeldForQueuedMessage(
  {
    tool,
    toolUseContext,
    forceDecision,
  }: {
    tool: Tool
    toolUseContext: ToolUseContext
    forceDecision?: PermissionDecision
  },
  toolUseID: string,
  assistantMessage: AssistantMessage,
): boolean {
  try {
    if (
      toolUseContext.agentId !== undefined ||
      (assistantMessage as { isVirtual?: boolean }).isVirtual === true ||
      forceDecision !== undefined ||
      !Array.isArray(assistantMessage.message.content) ||
      !assistantMessage.message.content.some(
        (b: { type?: string; id?: string }) =>
          b.type === 'tool_use' && b.id === toolUseID,
      ) ||
      tool.requiresUserInteraction?.() === true ||
      isMidTurnFoldSuspended()
    ) {
      return false
    }
    const msgId = assistantMessage.message.id ?? ''
    const responseOf =
      toolUseContext.toolState?.get(HeldAskResponseState).responseOf ??
      fallbackHeldAskResponseMap
    const ready: object[] = []
    for (const cmd of getCommandsByMaxPriority('next')) {
      const c = cmd as unknown as Record<string, unknown>
      if (c.drainOnly === true || c.screeningPending === true) break
      if (
        typeof c.value === 'string' &&
        c.mode === 'prompt' &&
        (c.bearsNoUntypedMark === true || c.typedByPerson === true) &&
        (responseOf.get(cmd) ?? msgId) === msgId
      ) {
        ready.push(cmd)
      }
    }
    if (
      ready.length === 0 ||
      !getFeatureValue_CACHED_MAY_BE_STALE('tengu_wild_forest', false)
    ) {
      return false
    }
    for (const cmd of ready) {
      responseOf.set(cmd, msgId)
    }
    return true
  } catch {
    logError(
      new Error(
        "askIsHeldForQueuedMessage: the check threw, so this ask was not held back for a queued message. The error text is left out because it may hold a person's words or tool input.",
      ),
    )
    return false
  }
}

const MAX_RECORDED_PIPELINE_RESULTS = 256
const permissionPipelineResultsByToolUseId = new Map<
  string,
  PermissionDecision
>()

/**
 * Record the post-pipeline `hasPermissionsToUseTool` result for a tool use so
 * `toolExecution.ts` can surface the real pipeline outcome (e.g. `ask` with
 * `personOnly: true` vs a rule/mode/classifier `allow`) to `tool.call`
 * (official 2.1.328 `permissionPhase.pipeline.result`).
 */
export function recordPermissionPipelineResult(
  toolUseID: string | undefined,
  decision: PermissionDecision,
): void {
  if (!toolUseID) return
  permissionPipelineResultsByToolUseId.set(toolUseID, decision)
  if (
    permissionPipelineResultsByToolUseId.size > MAX_RECORDED_PIPELINE_RESULTS
  ) {
    const oldest = permissionPipelineResultsByToolUseId.keys().next().value
    if (oldest !== undefined) {
      permissionPipelineResultsByToolUseId.delete(oldest)
    }
  }
}

export function consumePermissionPipelineResult(
  toolUseID: string | undefined,
): PermissionDecision | undefined {
  if (!toolUseID) return undefined
  const result = permissionPipelineResultsByToolUseId.get(toolUseID)
  permissionPipelineResultsByToolUseId.delete(toolUseID)
  return result
}

export const hasPermissionsToUseTool: CanUseToolFn = async (...args) => {
  const toolUseID = args[4]
  const before = detachedLetGoPermissionDeny(toolUseID)
  if (before) {
    recordPermissionPipelineResult(toolUseID, before)
    return before
  }
  const result = await evaluateToolPermission(...args)
  const finalResult = detachedLetGoPermissionDeny(toolUseID) ?? result
  recordPermissionPipelineResult(toolUseID, finalResult)
  return finalResult
}

/**
 * Official 2.1.328 `FYn` (`chunk@294254613.js @1687570`):
 * True when a hook asked for a prompt (`hookAskFloor`) or the ask result
 * itself requires a person (`personOnly === true`).
 */
export function mustAskPersonForPermission(
  hookAskFloor: boolean,
  result: PermissionResult,
): boolean {
  return (
    hookAskFloor || (result.behavior === 'ask' && result.personOnly === true)
  )
}

/**
 * Official 2.1.328 `cNn` (`chunk@294254613.js @1709417`):
 * Detect `\uXXXX` unicode escape sequences in Code Mode scripts.
 */
export function containsCodeModeUnicodeEscape(code: string): boolean {
  return /\\u[0-9a-fA-F]{4}/.test(code)
}

const REPL_SCRIPT_ESCAPE_REFUSED_MESSAGE =
  'This code was NOT run. Auto mode could not check it, because it contains a \\uXXXX escape. This is not a judgment that the code is unsafe. Write each such character another way, for example \\x1b or \\u{1b} in place of \\u001b, and send the code again.'

const REPL_SCRIPT_REWRITE_REFUSED_MESSAGE =
  "This code was NOT run. In Code Mode, auto mode doesn't run code after a hook changed its call from what you wrote. This also applies when a hook changed an earlier tool call in the same response. This is not a judgment that the code is unsafe. If this response had other tool calls, you may send this code once more, in a response with no other tool calls. Otherwise, don't send it again. Go on with work that doesn't need it, and tell the user that a hook (a PreToolUse hook, or a mod's) changes your code. They can turn that hook off (or ask their administrator, if their organization set it), or leave auto mode with Shift+Tab (for example for Manual mode), where they are asked about each of the code's tool calls that needs approval."

function formatReplScriptSendMessageRefused(isInner: boolean): string {
  return `This ${SEND_MESSAGE_TOOL_NAME} call was NOT run. Auto mode checks each piece of code as a whole before it starts, and that check does not cover this call. Your code can't send a message to an agent outside that check, because auto mode can't read the text that the code sends. This is not a judgment that the message is unsafe. ${isInner ? 'Tell the user that they can leave auto mode with Shift+Tab, for example for Manual mode, and then ask you to try again.' : 'You can send this step again in a new piece of code, which gets a check of its own.'}`
}

function formatReplScriptAgentRefused(isInner: boolean): string {
  return `This ${AGENT_TOOL_NAME} call was NOT run. Auto mode checks each piece of code as a whole before it starts, and that check does not cover this call. Your code can't start a sub-agent outside that check, because auto mode can't read the task that the code gives the sub-agent. This is not a judgment that the task is unsafe. ${isInner ? 'Do the work yourself: one piece of code can make several calls at once with Promise.all. If the task really needs a sub-agent, tell the user that they can leave auto mode with Shift+Tab, for example for Manual mode, and then ask you to try again.' : 'You can send this step again in a new piece of code, which gets a check of its own.'}`
}

const evaluateToolPermission: CanUseToolFn = async (
  tool,
  input,
  context,
  assistantMessage,
  toolUseID,
  forceDecision,
): Promise<PermissionDecision> => {
  const letGoDeny = detachedLetGoPermissionDeny(toolUseID)
  if (letGoDeny) return letGoDeny

  const evalContext =
    toolUseID && context.toolUseId !== toolUseID
      ? { ...context, toolUseId: toolUseID }
      : context

  const result =
    forceDecision !== undefined
      ? forceDecision
      : await evaluatePermissionWithToolCheck({
          tool,
          input,
          context: evalContext,
          toolUseID,
          evaluate: () =>
            hasPermissionsToUseToolInner(tool, input, evalContext),
        })

  // Reset consecutive denials on any allowed tool use in auto mode.
  // This ensures that a successful tool use (even one auto-allowed by rules)
  // breaks the consecutive denial streak.
  if (result.behavior === 'allow') {
    const appState = context.getAppState()
    // densable bn: sticky permission_mode layers affect auto-mode bookkeeping
    const layeredPermissionContext = getToolPermissionContextFromLayers(context)
    // gold NHo @185578200: XH(e, me(D))==="auto" — consecutive-denial reset
    // uses effective mode, not session mode (MCP override default must not
    // clear the streak).
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const currentDenialState =
        context.localDenialTracking ?? appState.denialTracking
      if (
        getEffectivePermissionMode(tool, layeredPermissionContext) === 'auto' &&
        currentDenialState &&
        currentDenialState.consecutiveDenials > 0 &&
        !shouldHoldConsecutiveDenials(context)
      ) {
        const newDenialState = recordSuccess(currentDenialState)
        persistDenialState(context, newDenialState)
      }
    }
    return result
  }

  // Apply dontAsk mode transformation: convert 'ask' to 'deny'
  // This is done at the end so it can't be bypassed by early returns
  if (result.behavior === 'ask') {
    const appState = context.getAppState()
    // densable bn + #1703 u$r: sticky permission layers + denyInsteadOfPrompting
    const layeredPermissionContext = getEffectiveToolPermissionContext(context)

    // gold NHo @185579131: xe=XH(e,Ee) once; dontAsk uses xe not session mode.
    // Official snt(): chrome classifier floor / per-server overrides demote
    // elevated modes. Only the *effective* mode may enter auto / dontAsk paths.
    const effectiveModeForAuto = getEffectivePermissionMode(
      tool,
      layeredPermissionContext,
    )
    // gold NHo Fe @185578925: xHo && (chrome-metadata OR Ale).
    // Metadata host: Preview/Browser s8t `hostHandlesOriginConsent` /
    // chrome `domainAllowed`. Ale = toolAlwaysAllowedRule.
    const chromeAlwaysAllowAuto = feature('TRANSCRIPT_CLASSIFIER')
      ? isChromeFamilyClassifierEligible(tool, layeredPermissionContext) &&
        (chromeCommandBypassesDontAsk(result) ||
          toolAlwaysAllowedRule(layeredPermissionContext, tool) !== null)
      : false
    if (effectiveModeForAuto === 'dontAsk' && !chromeAlwaysAllowAuto) {
      return {
        behavior: 'deny',
        decisionReason: {
          type: 'mode',
          mode: 'dontAsk',
        },
        message: DONT_ASK_REJECT_MESSAGE(tool.name),
      }
    }
    // Apply auto mode: use AI classifier instead of prompting user
    // Check this BEFORE shouldAvoidPermissionPrompts so classifiers work in headless mode.
    // gold NHo @185579131: xa(xe, Ee.servedCall===true)||Fe where xe is XH
    // effective mode. auto still enters when served; plan+Jf does not.
    if (
      feature('TRANSCRIPT_CLASSIFIER') &&
      (isAutoModeOrPlanActingAsAuto(
        effectiveModeForAuto,
        layeredPermissionContext.servedCall === true,
      ) ||
        chromeAlwaysAllowAuto)
    ) {
      // Official 2.1.328 `FYn` (`chunk@294254613.js @1687570, @3655850..3657200`):
      // `mustAskPerson` is true whenever a hook raised `hookAskFloor` or the
      // ask carries `personOnly: true`. Gate ALL auto-allow fast paths on
      // `!mustAskPerson`, denying when `dontAsk`/non-interactive and returning
      // `ask` otherwise.
      const isFlagOnlyTool = tool.classifierOnly?.()?.onBlock === 'flag'
      const mustAskPerson = mustAskPersonForPermission(
        context.hookAskFloor === true,
        result,
      )
      if (
        mustAskPerson &&
        !isFlagOnlyTool &&
        (effectiveModeForAuto === 'dontAsk' ||
          avoidsPromptsByNature(layeredPermissionContext))
      ) {
        if (effectiveModeForAuto === 'dontAsk') {
          return {
            behavior: 'deny',
            decisionReason: { type: 'mode', mode: 'dontAsk' },
            message: DONT_ASK_REJECT_MESSAGE(tool.name),
          }
        }
        return {
          behavior: 'deny',
          message: formatNonInteractiveAskCauseMessage(result),
          decisionReason: {
            type: 'asyncAgent',
            reason:
              'Action requires interactive approval and permission prompts are not available in this context',
          },
        }
      }
      // Official `po`: convert any auto-allow fast-path or classifier verdict
      // back to `ask` (or `deny` in `dontAsk`/non-interactive) when `mustAskPerson`.
      const finalizeAutoAllow = (
        allowDecision: PermissionAllowDecision,
      ): PermissionDecision => {
        if (isFlagOnlyTool) {
          return allowDecision
        }
        if (mustAskPerson) {
          if (effectiveModeForAuto === 'dontAsk') {
            return {
              behavior: 'deny',
              decisionReason: { type: 'mode', mode: 'dontAsk' },
              message: DONT_ASK_REJECT_MESSAGE(tool.name),
            }
          }
          if (avoidsPromptsByNature(layeredPermissionContext)) {
            return {
              behavior: 'deny',
              message: formatNonInteractiveAskCauseMessage(result),
              decisionReason: {
                type: 'asyncAgent',
                reason:
                  'Action requires interactive approval and permission prompts are not available in this context',
              },
            }
          }
          return {
            ...result,
            ...(allowDecision.updatedInput !== undefined
              ? { updatedInput: allowDecision.updatedInput }
              : {}),
          }
        }
        return allowDecision
      }

      // densable 2.1.218 W9 + ctn:
      //   v = W9(decisionReason, V => !V.classifierApprovable &&
      //         !(V.circuitBreaker !== undefined && ctn(context)))
      // Non-classifier-approvable safetyChecks force a dialog UNLESS they carry
      // a circuitBreaker tag (dangerousRemoval / backgroundOperator /
      // suspiciousWindowsPath) while auto mode is active — those go to the
      // classifier instead of opening a permission dialog (#26).
      const autoContext = isPermissionContextAutoMode(layeredPermissionContext)
      const isSandboxOverride =
        result.decisionReason?.type === 'sandboxOverride'
      const forcedSafetyCheck = findSafetyCheckDecision(
        result.decisionReason,
        check =>
          !check.classifierApprovable &&
          !(
            isClassifierRoutedSafetyCheck(check) &&
            !hasBypassImmuneNonClassifierAlsoBreaker(check) &&
            autoContext
          ),
      )
      if (forcedSafetyCheck) {
        if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: formatNonInteractiveAskCauseMessage(result),
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'Safety check requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        logEvent('tengu_auto_mode_fallback_to_ask', {
          reason:
            'safety_check' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        return result
      }
      // Official `Eo` (`chunk@294254613.js @3658539`): sandboxOverride in
      // non-interactive auto mode denies immediately (cannot auto-allow).
      if (
        isSandboxOverride &&
        avoidsPromptsByNature(layeredPermissionContext)
      ) {
        return {
          behavior: 'deny',
          message: formatNonInteractiveAskCauseMessage(result),
          decisionReason: {
            type: 'asyncAgent',
            reason:
              'Action requires interactive approval and permission prompts are not available in this context',
          },
        }
      }
      // densable 2.1.218 fXd plan_mode_floor + #22 2.1.290 Ern/ekt:
      //   x = decisionReason?.type === 'mode' && mode === 'plan' && !OFo(tool, input)
      //     || !hookAskFloor && Ern(decisionReason, tool, input, context)
      // Non-read-only MCP connector tools with a server-pushed mcpServerPolicy
      // ask rule must also hit plan_mode_floor in plan+auto mode (#22).
      const planModeFloorHit =
        (result.decisionReason?.type === 'mode' &&
          result.decisionReason.mode === 'plan' &&
          !isChromeMcpReadOnlyTool(
            getToolNameForPermissionCheck(tool),
            input,
          )) ||
        (!context.hookAskFloor &&
          isPlanModeWriteFloorForMcpServerPolicy(
            result.decisionReason,
            tool,
            input,
            layeredPermissionContext,
          ))
      if (planModeFloorHit) {
        if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: result.message,
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'Action requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        logEvent('tengu_auto_mode_fallback_to_ask', {
          reason:
            'plan_mode_floor' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        return result
      }
      // Official 2.1.319 #1807 (`Pn = ev(xe)`, `To`): explicit ask rules
      // (including `matchedAskRule`, e.g. Monitor `ws` under a Bash ask rule)
      // must fall back to interactive prompt even in auto mode (except
      // non-destructive mcpServerPolicy asks).
      const isMcpPolicyAsk =
        isMcpServerPolicyAskReason(result.decisionReason) ||
        result.matchedAskRule?.source === 'mcpServerPolicy'
      const askRuleFallback =
        hasMatchedAskRule(result) &&
        !(isMcpPolicyAsk && !(tool.isDestructive?.(input as never) ?? false))
      if (askRuleFallback) {
        if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: result.message,
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'Ask rule requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        logEvent('tengu_auto_mode_fallback_to_ask', {
          reason:
            'ask_rule' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        return result
      }
      // Official org_ask_ceiling: MCP tools capped to ask by org policy cannot
      // be auto-approved by the classifier (mirrors plan_mode_floor handling).
      if (tool.mcpInfo?.effectiveMaxPermission === 'ask') {
        if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: result.message,
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'Action requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        logEvent('tengu_auto_mode_fallback_to_ask', {
          reason:
            'org_ask_ceiling' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        return result
      }
      // Official 2.1.325 #2328: in cloud sessions while plugins are still
      // loading, do not let auto mode automatically answer a connector MCP
      // tool approval prompt — hold/ask until plugin loading completes.
      if (
        shouldHoldConnectorApprovalWhilePluginsLoading({
          isConnectorTool:
            tool.mcpInfo !== undefined || tool.name.startsWith('mcp__'),
        })
      ) {
        return result
      }
      if (tool.requiresUserInteraction?.() && result.behavior === 'ask') {
        return result
      }

      // gold pHo?.workflowNeedsUsageConsentPrompt — Workflow first-run ask.
      if (workflowNeedsUsageConsentPrompt(tool.name, context)) {
        logEvent('tengu_auto_mode_fallback_to_ask', {
          reason:
            'workflow_usage_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        return result
      }

      // gold NHo yBt @185448964 is inside xa(xe)||Fe, after
      // requiresUserInteraction and workflow usage consent. DualInk first-ask
      // must not stamp when XH demotes the session out of auto.
      if (
        shouldOfferBlockOutsideReads({
          toolName: tool.name,
          hasPath:
            typeof tool.getPath === 'function' &&
            Boolean(tool.getPath(input as { [key: string]: unknown })),
          behavior: result.behavior,
          decisionReasonType: result.decisionReason?.type,
          context: layeredPermissionContext,
          isNonInteractiveSession: context.options?.isNonInteractiveSession,
          toolUseId: toolUseID,
          forRemoteExecution: context.forRemoteExecution === true,
        })
      ) {
        if (layeredPermissionContext.denyInsteadOfPrompting === true) {
          return result
        }
        getOutsideReadPrompt().open(toolUseID)
        logEvent('tengu_auto_mode_fallback_to_ask', {
          reason:
            'outside_read_first_prompt' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        return {
          ...result,
          offersBlockOutsideReads: true,
        }
      }

      // Use local denial tracking for async subagents (whose setAppState
      // is a no-op), otherwise read from appState as before.
      const denialState =
        context.localDenialTracking ??
        appState.denialTracking ??
        createDenialTrackingState()

      // PowerShell requires explicit user permission in auto mode unless
      // POWERSHELL_AUTO_MODE (ant-only build flag) is on. When disabled, this
      // guard keeps PS out of the classifier and skips the acceptEdits
      // fast-path below. When enabled, PS flows through to the classifier like
      // Bash — the classifier prompt gets POWERSHELL_DENY_GUIDANCE appended so
      // it recognizes `iex (iwr ...)` as download-and-execute, etc.
      // Note: this runs inside the behavior === 'ask' branch, so allow rules
      // that fire earlier (step 2b toolAlwaysAllowedRule, PS prefix allow)
      // return before reaching here. Allow-rule protection is handled by
      // permissionSetup.ts: isOverlyBroadPowerShellAllowRule strips PowerShell(*)
      // and isDangerousPowerShellPermission strips iex/pwsh/Start-Process
      // prefix rules for ant users and auto mode entry.
      if (
        tool.name === POWERSHELL_TOOL_NAME &&
        !feature('POWERSHELL_AUTO_MODE')
      ) {
        if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: 'PowerShell tool requires interactive approval',
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'PowerShell tool requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: tool requires explicit user permission`,
        )
        return result
      }

      // Official 2.1.328 Code Mode auto-mode refusal guards
      // (`chunk@294254613.js @3674600-3675200`): must run BEFORE acceptEdits,
      // pluginOrigin, allowlist (SendMessage is allowlisted!), and replScriptInner.
      const isReplOrEvalTool =
        tool.name === REPL_TOOL_NAME || tool.name === 'Eval'
      const isReplScriptCall =
        context.replScriptInner === true ||
        (context as { replScriptCall?: boolean }).replScriptCall === true
      if (
        isReplScriptCall &&
        (tool.name === AGENT_TOOL_NAME ||
          tool.name === SEND_MESSAGE_TOOL_NAME) &&
        !tool.mcpInfo
      ) {
        const isSendMessage = tool.name === SEND_MESSAGE_TOOL_NAME
        logEvent('tengu_repl_script_spawn_refused', {
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isSubagent: context.agentId !== undefined,
        })
        return {
          behavior: 'deny',
          message: isSendMessage
            ? formatReplScriptSendMessageRefused(
                context.replScriptInner === true,
              )
            : formatReplScriptAgentRefused(context.replScriptInner === true),
          decisionReason: {
            type: 'other',
            reason: isSendMessage
              ? "Refused: auto mode's check of Claude's code doesn't cover this message to an agent"
              : "Refused: auto mode's check of Claude's code doesn't cover this sub-agent",
          },
        }
      }

      if (isReplOrEvalTool && !tool.mcpInfo) {
        const inputChangedByHook =
          (context as { inputChangedByHook?: boolean }).inputChangedByHook ===
            true ||
          (assistantMessage as { serverClassifierInputRewritten?: boolean })
            .serverClassifierInputRewritten === true
        if (inputChangedByHook) {
          logEvent('tengu_repl_script_rewrite_refused', {
            replToolUseID:
              toolUseID as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            isSubagent: context.agentId !== undefined,
          })
          return {
            behavior: 'deny',
            message: REPL_SCRIPT_REWRITE_REFUSED_MESSAGE,
            decisionReason: {
              type: 'other',
              reason:
                "Auto mode does not run code after a hook changed it, or changed an earlier tool call in the same response. Turn the hook off, or leave auto mode, where you are asked about each of the code's tool calls that needs approval.",
            },
          }
        }
        const rawCodeCandidates = [
          (input as { code?: unknown }).code,
          (result.updatedInput as { code?: unknown } | undefined)?.code,
        ]
        if (
          rawCodeCandidates.some(
            code =>
              typeof code === 'string' && containsCodeModeUnicodeEscape(code),
          )
        ) {
          logEvent('tengu_repl_script_escape_refused', {
            replToolUseID:
              toolUseID as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            isSubagent: context.agentId !== undefined,
          })
          return {
            behavior: 'deny',
            message: REPL_SCRIPT_ESCAPE_REFUSED_MESSAGE,
            decisionReason: {
              type: 'other',
              reason:
                'Auto mode cannot check code that contains a \\uXXXX escape',
            },
          }
        }
      }

      // Before running the auto mode classifier, check if acceptEdits mode would
      // allow this action. This avoids expensive classifier API calls for safe
      // operations like file edits in the working directory.
      // Official isAutoModeFastPathExcludedTool + REPL: these must not skip the
      // classifier via acceptEdits (Agent/cron/remote can spawn work; REPL can
      // hide VM escapes between inner tool calls).
      // Official I = KDu(name) && VDu(mainModel): when classify-edits is on for
      // the main-loop model, Edit/Write/NotebookEdit skip acceptEdits and hit
      // the classifier (editClassificationGated telemetry flag).
      const editClassificationGated = shouldGateEditClassification(
        tool.name,
        context.options.mainLoopModel,
      )
      // gold NHo br=xe==="plan"&&!hn — skip acceptEdits when effective plan
      // OR hn (E1t server-held classifier ask).
      const skipAcceptEditsFastPathForPlan =
        effectiveModeForAuto === 'plan' || isServerHeldClassifierAsk(result)
      if (
        result.behavior === 'ask' &&
        !isReplOrEvalTool &&
        !isSandboxOverride &&
        !classifierDecisionModule!.isAutoModeFastPathExcludedTool(tool.name) &&
        !editClassificationGated &&
        !skipAcceptEditsFastPathForPlan
      ) {
        try {
          const parsedInput = tool.inputSchema.parse(input)
          const acceptEditsResult = await tool.checkPermissions(parsedInput, {
            ...context,
            getAppState: () => {
              const state = context.getAppState()
              return {
                ...state,
                toolPermissionContext: {
                  ...state.toolPermissionContext,
                  mode: 'acceptEdits' as const,
                },
              }
            },
          })
          if (acceptEditsResult.behavior === 'allow') {
            persistDenialStateUnlessHeld(context, denialState)
            logForDebugging(
              `Skipping auto mode classifier for ${tool.name}: would be allowed in acceptEdits mode`,
            )
            logEvent('tengu_auto_mode_decision', {
              decision:
                'allowed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              toolName: sanitizeToolNameForAnalytics(tool.name),
              inProtectedNamespace: isInProtectedNamespace(),
              // msg_id of the agent completion that produced this tool_use —
              // the action at the bottom of the classifier transcript. Joins
              // the decision back to the main agent's API response.
              agentMsgId: assistantMessage.message
                .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              confidence:
                'high' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fastPath:
                'acceptEdits' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              hookAllowVouch: context.hookAllowVouched === true,
            })
            return finalizeAutoAllow({
              behavior: 'allow',
              updatedInput: acceptEditsResult.updatedInput ?? input,
              decisionReason: {
                type: 'mode',
                mode: 'auto',
              },
            })
          }
        } catch (e) {
          if (e instanceof AbortError || e instanceof APIUserAbortError) {
            throw e
          }
          // If the acceptEdits check fails, fall through to the classifier
        }
      }

      // gold tqn pluginOrigin: skip classifier, allow with plugin-origin reason.
      // gold also requires !prt() and `_p(reason, e3)===void 0` — classifier-routed
      // circuitBreaker (dangerousRemoval / backgroundOperator /
      // suspiciousWindowsPath) must hit the classifier, not plugin-origin allow.
      const pluginOrigin = pluginOriginCaller(context)
      if (
        pluginOrigin !== undefined &&
        !mustAskPerson &&
        !isServerHeldClassifierAsk(result) &&
        !autoModeHasDenyRules() &&
        !hasClassifierRoutedSafetyCheck(result.decisionReason) &&
        // gold xa(Ee.mode)&&xa(xe): session auto AND XH effective auto.
        // MCP override default/dontAsk must not plugin-origin-allow.
        isAutoModeOrPlanActingAsAuto(layeredPermissionContext.mode) &&
        isAutoModeOrPlanActingAsAuto(effectiveModeForAuto)
      ) {
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: called by plugin ${pluginOrigin}`,
        )
        const newDenialState = recordSuccess(denialState)
        persistDenialState(context, newDenialState)
        return finalizeAutoAllow({
          behavior: 'allow',
          updatedInput: input,
          decisionReason: {
            type: 'other',
            reason: `plugin-origin: ${pluginOrigin}`,
          },
        })
      }

      // Allowlisted tools are safe and don't need YOLO classification.
      // Official: static safe builtins OR chrome MCP safe-for-auto (NDu).
      // Fast-path-excluded tools never auto-allow via this path.
      if (
        !classifierDecisionModule!.isAutoModeFastPathExcludedTool(tool.name) &&
        (classifierDecisionModule!.isAutoModeAllowlistedTool(tool.name) ||
          isChromeMcpSafeForAutoMode(
            getToolNameForPermissionCheck(tool),
            input,
          ))
      ) {
        persistDenialStateUnlessHeld(context, denialState)
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: tool is on the safe allowlist`,
        )
        logEvent('tengu_auto_mode_decision', {
          decision:
            'allowed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          inProtectedNamespace: isInProtectedNamespace(),
          agentMsgId: assistantMessage.message
            .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          confidence:
            'high' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fastPath:
            'allowlist' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          hookAllowVouch: context.hookAllowVouched === true,
        })
        return finalizeAutoAllow({
          behavior: 'allow',
          updatedInput: input,
          decisionReason: {
            type: 'mode',
            mode: 'auto',
          },
        })
      }

      // gold NHo desktop_forward: Qe producer is not invented; consume stamp only.
      if (isDesktopForwardSkipClassifier(context, toolUseID, result, tool)) {
        const nowMode = getEffectivePermissionMode(
          tool,
          getToolPermissionContextFromLayers(context),
        )
        if (nowMode !== effectiveModeForAuto) {
          logEvent('tengu_auto_mode_fallback_to_ask', {
            reason:
              'mode_changed_while_queued' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            toolName: sanitizeToolNameForAnalytics(tool.name),
          })
          if (nowMode === 'dontAsk') {
            return {
              behavior: 'deny',
              decisionReason: { type: 'mode', mode: 'dontAsk' },
              message: DONT_ASK_REJECT_MESSAGE(tool.name),
            }
          }
          if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
            return {
              behavior: 'deny',
              decisionReason: {
                type: 'asyncAgent',
                reason: 'Permission prompts are not available in this context',
              },
              message: AUTO_REJECT_MESSAGE(tool.name),
            }
          }
          return result
        }
        if (!shouldHoldConsecutiveDenials(context)) {
          persistDenialState(context, recordSuccess(denialState))
        }
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: this is SendMessage's forward to Claude Desktop, and the classifier already allowed that SendMessage`,
        )
        logEvent('tengu_auto_mode_decision', {
          decision:
            'allowed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          inProtectedNamespace: isInProtectedNamespace(),
          agentMsgId: assistantMessage.message
            .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          confidence:
            'high' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fastPath:
            'desktop_forward' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          hookAllowVouch: context.hookAllowVouched === true,
        })
        return finalizeAutoAllow({
          behavior: 'allow',
          updatedInput: result.updatedInput ?? input,
          decisionReason: { type: 'mode', mode: 'auto' },
        })
      }

      // Official 2.1.328 Code Mode auto-mode inner-call & deferred-script handling:
      // 1) replScriptAtLimit: script hit the auto-mode denial limit — do NOT ride
      //    the outer verdict; fall back to normal ask (or dontAsk deny).
      if (context.replScriptAtLimit === true) {
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: outer REPL script is at denial limit (replScriptAtLimit), falling back to prompt`,
        )
        if (effectiveModeForAuto === 'dontAsk') {
          return {
            behavior: 'deny',
            decisionReason: { type: 'mode', mode: 'dontAsk' },
            message: DONT_ASK_REJECT_MESSAGE(tool.name),
          }
        }
        return result
      }

      // 2) replScriptInner: inner tool call from a classified/allowed Code Mode
      //    script in auto mode rides the outer script verdict without re-invoking
      //    the classifier, while refusing sandboxOverride & personOnly and
      //    respecting explicit deny/ask rules, hookAskFloor, and safety circuit breakers.
      if (context.replScriptInner === true && isSandboxOverride) {
        logForDebugging(
          `Refusing replScriptInner auto-allow for ${tool.name}: sandboxOverride cannot ride outer REPL script verdict`,
        )
        return {
          behavior: 'deny',
          message: `This ${tool.name} call was NOT run. Auto mode's check of Claude's code does not allow disabling the sandbox inside a script.`,
          decisionReason: {
            type: 'other',
            reason:
              "Refused: auto mode's check of Claude's code does not cover sandbox overrides",
          },
        }
      }
      if (
        context.replScriptInner === true &&
        result.behavior === 'ask' &&
        result.personOnly === true
      ) {
        logForDebugging(
          `Refusing replScriptInner auto-allow for ${tool.name}: personOnly ask requires explicit human approval`,
        )
        if (effectiveModeForAuto === 'dontAsk') {
          return {
            behavior: 'deny',
            decisionReason: { type: 'mode', mode: 'dontAsk' },
            message: DONT_ASK_REJECT_MESSAGE(tool.name),
          }
        }
        if (avoidsPromptsByNature(layeredPermissionContext)) {
          return {
            behavior: 'deny',
            message: formatNonInteractiveAskCauseMessage(result),
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'Action requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        return result
      }
      if (
        context.replScriptInner === true &&
        result.behavior === 'ask' &&
        isAutoModeOrPlanActingAsAuto(layeredPermissionContext.mode) &&
        isAutoModeOrPlanActingAsAuto(effectiveModeForAuto) &&
        !mustAskPerson &&
        !isSandboxOverride &&
        !tool.requiresUserInteraction?.() &&
        result.checkIncomplete !== true &&
        !isServerHeldClassifierAsk(result) &&
        !hasClassifierRoutedSafetyCheck(result.decisionReason)
      ) {
        if (!shouldHoldConsecutiveDenials(context)) {
          persistDenialState(context, recordSuccess(denialState))
        }
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: riding outer REPL script verdict (replScriptInner)`,
        )
        return finalizeAutoAllow({
          behavior: 'allow',
          updatedInput: result.updatedInput ?? input,
          decisionReason: { type: 'mode', mode: 'auto' },
        })
      }

      // 3) Outer REPL/Eval in auto mode: when replScriptCheckNow !== true,
      //    defer script classification until the first inner tool call (executor
      //    registers a deferred check and flushes with replScriptCheckNow: true).
      if (
        isReplOrEvalTool &&
        context.replScriptCheckNow !== true &&
        result.behavior === 'ask' &&
        effectiveModeForAuto === 'auto' &&
        !mustAskPerson &&
        !isSandboxOverride &&
        !isServerHeldClassifierAsk(result) &&
        !hasClassifierRoutedSafetyCheck(result.decisionReason)
      ) {
        logForDebugging(
          `Deferring auto mode classifier check for outer ${tool.name} script`,
        )
        return {
          behavior: 'allow',
          updatedInput: result.updatedInput ?? input,
          decisionReason: {
            type: 'other',
            reason: 'deferred_repl_script_check',
          },
        }
      }

      // densable O7o — billed-classifier notice when 3P latch is on
      if (isThirdPartyServerClassifierRefused()) {
        const notice = await promptAutoModeServerFallbackNotice(context)
        if (notice === 'interrupt') {
          if (!context.abortController.signal.aborted) {
            context.abortController.abort()
          }
          return {
            behavior: 'deny',
            decisionReason: {
              type: 'classifier',
              classifier: 'auto-mode',
              reason: 'Cancelled at the classifier billing notice',
            },
            message: 'Cancelled at the classifier billing notice',
          }
        }
      }

      // Run the auto mode classifier
      // Official hOg / sameTurnSiblingContext: prepend same-turn prior tool_use
      // messages so the classifier sees concurrent siblings in this assistant turn.
      const sameTurnSiblings = resolveSameTurnSiblingContext().value
        ? (context.sameTurnToolUses ?? [])
        : []
      const classifierMessages =
        sameTurnSiblings.length > 0
          ? [...context.messages, ...sameTurnSiblings]
          : context.messages
      const action = formatActionForClassifier(tool.name, input)
      setClassifierChecking(toolUseID)
      let classifierResult
      try {
        logForDebugging(
          `[auto-mode] classifyYoloAction called with langfuseTrace=${context.langfuseTrace ? `id=${(context.langfuseTrace as unknown as Record<string, unknown>).id ?? 'present'}` : 'null/undefined'}`,
        )
        classifierResult = await classifyYoloAction(
          classifierMessages,
          action,
          context.options.tools,
          layeredPermissionContext,
          context.abortController.signal,
          context.langfuseRootTrace ?? context.langfuseTrace,
          {
            handoffReview: tool.classifierOnly?.()?.onBlock === 'flag',
            outsideAutoMode: layeredPermissionContext.mode !== 'auto',
          },
        )
      } finally {
        clearClassifierChecking(toolUseID)
      }

      // Notify ants when classifier error dumped prompts (will be in /share)
      if (
        process.env.USER_TYPE === 'ant' &&
        classifierResult.errorDumpPath &&
        context.addNotification
      ) {
        context.addNotification({
          key: 'auto-mode-error-dump',
          text: `Auto mode classifier error — prompts dumped to ${classifierResult.errorDumpPath} (included in /share)`,
          priority: 'immediate',
          color: 'error',
        })
      }

      // Log classifier decision for metrics (including overhead telemetry)
      // densable 2.1.225: refusedBySafeguard is distinct from blocked (no denial counter).
      const yoloDecision = classifierResult.unavailable
        ? 'unavailable'
        : classifierResult.refusedBySafeguard
          ? 'refused'
          : classifierResult.shouldBlock
            ? 'blocked'
            : 'allowed'
      // densable: only real blocks (not unavailable / transcriptTooLong / refused) count.
      const countsAsDenial =
        classifierResult.shouldBlock &&
        !classifierResult.unavailable &&
        !classifierResult.transcriptTooLong &&
        !classifierResult.refusedBySafeguard

      // Compute classifier cost in USD for overhead analysis
      const classifierCostUSD =
        classifierResult.usage && classifierResult.model
          ? calculateCostFromTokens(
              classifierResult.model,
              classifierResult.usage,
            )
          : undefined
      logEvent('tengu_auto_mode_decision', {
        decision:
          yoloDecision as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
        inProtectedNamespace: isInProtectedNamespace(),
        // msg_id of the agent completion that produced this tool_use —
        // the action at the bottom of the classifier transcript.
        agentMsgId: assistantMessage.message
          .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        // Official editClassificationGated + sameTurnSiblings telemetry.
        editClassificationGated,
        sameTurnSiblings: sameTurnSiblings.length,
        classifierModel:
          classifierResult.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        consecutiveDenials: countsAsDenial
          ? denialState.consecutiveDenials + 1
          : 0,
        totalDenials: countsAsDenial
          ? denialState.totalDenials + 1
          : denialState.totalDenials,
        // Overhead telemetry: token usage and latency for the classifier API call
        classifierInputTokens: classifierResult.usage?.inputTokens,
        classifierOutputTokens: classifierResult.usage?.outputTokens,
        classifierCacheReadInputTokens:
          classifierResult.usage?.cacheReadInputTokens,
        classifierCacheCreationInputTokens:
          classifierResult.usage?.cacheCreationInputTokens,
        classifierDurationMs: classifierResult.durationMs,
        // Character lengths of the prompt components sent to the classifier
        classifierSystemPromptLength:
          classifierResult.promptLengths?.systemPrompt,
        classifierToolCallsLength: classifierResult.promptLengths?.toolCalls,
        classifierUserPromptsLength:
          classifierResult.promptLengths?.userPrompts,
        // Session totals at time of classifier call (for computing overhead %).
        // These are main-transcript-only — sideQuery (used by the classifier)
        // does NOT call addToTotalSessionCost, so classifier tokens are excluded.
        sessionInputTokens: getTotalInputTokens(),
        sessionOutputTokens: getTotalOutputTokens(),
        sessionCacheReadInputTokens: getTotalCacheReadInputTokens(),
        sessionCacheCreationInputTokens: getTotalCacheCreationInputTokens(),
        classifierCostUSD,
        hookAllowVouch: context.hookAllowVouched === true,
        classifierStage:
          classifierResult.stage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage1InputTokens: classifierResult.stage1Usage?.inputTokens,
        classifierStage1OutputTokens:
          classifierResult.stage1Usage?.outputTokens,
        classifierStage1CacheReadInputTokens:
          classifierResult.stage1Usage?.cacheReadInputTokens,
        classifierStage1CacheCreationInputTokens:
          classifierResult.stage1Usage?.cacheCreationInputTokens,
        classifierStage1DurationMs: classifierResult.stage1DurationMs,
        classifierStage1RequestId:
          classifierResult.stage1RequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage1MsgId:
          classifierResult.stage1MsgId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage1CostUSD:
          classifierResult.stage1Usage && classifierResult.model
            ? calculateCostFromTokens(
                classifierResult.model,
                classifierResult.stage1Usage,
              )
            : undefined,
        classifierStage2InputTokens: classifierResult.stage2Usage?.inputTokens,
        classifierStage2OutputTokens:
          classifierResult.stage2Usage?.outputTokens,
        classifierStage2CacheReadInputTokens:
          classifierResult.stage2Usage?.cacheReadInputTokens,
        classifierStage2CacheCreationInputTokens:
          classifierResult.stage2Usage?.cacheCreationInputTokens,
        classifierStage2DurationMs: classifierResult.stage2DurationMs,
        classifierStage2RequestId:
          classifierResult.stage2RequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage2MsgId:
          classifierResult.stage2MsgId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage2CostUSD:
          classifierResult.stage2Usage && classifierResult.model
            ? calculateCostFromTokens(
                classifierResult.model,
                classifierResult.stage2Usage,
              )
            : undefined,
      })

      if (classifierResult.durationMs !== undefined) {
        addToTurnClassifierDuration(classifierResult.durationMs)
      }

      // densable fR / Xe / Fr / jDe — classifierOnly onBlock:"flag" stashes a
      // one-shot handback note (EOo) and allows the tool through.
      const classifierOnly = tool.classifierOnly?.()
      // Gold: Xe!==void 0&&ir.classifierRan===!1 — empty toAutoClassifierInput
      // is a tool bug, not a judgment. Deny before Fr allow.
      if (
        classifierOnly !== undefined &&
        classifierResult.classifierRan === false
      ) {
        logForDebugging(
          `${tool.name} declares classifierOnly() but serialized to an empty classifier action; denying`,
          { level: 'error' },
        )
        return {
          behavior: 'deny',
          decisionReason: {
            type: 'classifier',
            classifier: 'auto-mode',
            reason: classifierResult.reason,
            noVerdict: true,
          },
          message: `${tool.name} was not reviewed: it gave the auto mode classifier nothing to judge (its toAutoClassifierInput is empty), and only the classifier can allow it. This is a tool bug, not a judgment on the action.`,
        }
      }
      const flagNoVerdict =
        classifierOnly?.onBlock === 'flag'
          ? resolveHandbackClassifierFlagResult(classifierResult)
          : undefined
      if (flagNoVerdict !== undefined) {
        stashHandbackClassifierResult(toolUseID, flagNoVerdict)
        logForDebugging(
          `Auto mode classifier gave no verdict for ${tool.name} (${flagNoVerdict.kind}); delivering flagged`,
          { level: 'warn' },
        )
        return {
          behavior: 'allow',
          updatedInput: result.updatedInput ?? input,
          decisionReason: {
            type: 'classifier',
            classifier: 'auto-mode',
            reason:
              flagNoVerdict.kind === 'refused'
                ? 'Delivered with a warning: the classifier request was refused by the safety safeguard'
                : 'Delivered with a note: the classifier could not review it',
            noVerdict: true,
          },
        }
      }

      if (classifierResult.shouldBlock) {
        // densable transcriptTooLong + #1730 (`s1s` server_call_unavailable_input_too_long).
        if (classifierResult.transcriptTooLong) {
          const isServerInputTooLong =
            classifierResult.errorKind ===
            SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG
          const classifierOnlyInteractive =
            classifierOnly !== undefined &&
            !layeredPermissionContext.shouldAvoidPermissionPrompts
          const willCompact =
            requestClassifierOverflowCompact(
              context.agentId,
              context.messages,
              {
                toolName: tool.name,
                denied:
                  classifierOnlyInteractive || tool.name !== AGENT_TOOL_NAME,
                mode: layeredPermissionContext.mode,
              },
            ) !== undefined
          if (!isServerInputTooLong || willCompact) {
            if (classifierOnlyInteractive) {
              logForDebugging(
                `Auto mode classifier transcript too long for ${tool.name}, denying (classifierOnly: no prompt fallback)`,
                { level: 'warn' },
              )
              return {
                behavior: 'deny',
                decisionReason: {
                  type: 'classifier',
                  classifier: 'auto-mode',
                  reason: TRANSCRIPT_TOO_LONG_REASON,
                  noVerdict: true,
                },
                message: willCompact
                  ? `${tool.name} was not reviewed and did not run: the conversation is too long for auto mode's classifier, and no permission prompt is raised for this tool. This is not a judgment that the action is unsafe. Claude Code will try to compact the conversation before the next request; if this action is still needed after that, issue it again.`
                  : `${tool.name} was not reviewed: the auto mode classifier transcript exceeded its context window, and no permission prompt is raised for this tool. This is not a judgment that the action is unsafe; the same call will hit the same limit until the conversation is shorter.`,
              }
            }
            if (!isServerInputTooLong) {
              if (tool.name === AGENT_TOOL_NAME) {
                return {
                  behavior: 'allow',
                  updatedInput: result.updatedInput ?? input,
                  decisionReason: { type: 'mode', mode: 'auto' },
                }
              }
            }
            if (willCompact) {
              logForDebugging(
                `Auto mode classifier transcript too long for ${tool.name}, denying and compacting before the next request`,
                { level: 'warn' },
              )
              return {
                behavior: 'deny',
                decisionReason: {
                  type: 'classifier',
                  classifier: 'auto-mode',
                  reason: TRANSCRIPT_TOO_LONG_COMPACT_REASON,
                  noVerdict: true,
                },
                message: `${tool.name} was not reviewed and did not run: the conversation is too long for auto mode's classifier. Claude Code will try to compact the conversation before the next request; if this action is still needed after that, issue it again and it will be reviewed normally.`,
              }
            }
            if (avoidsPromptsByNature(layeredPermissionContext)) {
              throw new AbortError(
                'Agent aborted: auto mode classifier transcript exceeded context window in headless mode',
              )
            }
            logForDebugging(
              'Auto mode classifier transcript too long, falling back to normal permission handling',
              { level: 'warn' },
            )
            if (effectiveModeForAuto === 'dontAsk') {
              return {
                behavior: 'deny',
                decisionReason: { type: 'mode', mode: 'dontAsk' },
                message: DONT_ASK_REJECT_MESSAGE(tool.name),
              }
            }
            if (layeredPermissionContext.shouldAvoidPermissionPrompts) {
              return {
                behavior: 'deny',
                decisionReason: {
                  type: 'asyncAgent',
                  reason:
                    'Permission prompts are not available in this context',
                },
                message: AUTO_REJECT_MESSAGE(tool.name),
              }
            }
            return {
              ...result,
              decisionReason: {
                type: 'other',
                reason: TRANSCRIPT_TOO_LONG_REASON,
              },
            }
          }
        }
        // densable: unavailable always denies — except #1730 (`server_call_unavailable_input_too_long`
        // / `context_too_large`) when no `autoMode` deny rules exist and an interactive terminal can ask.
        if (classifierResult.unavailable) {
          const isInputTooLong =
            classifierResult.errorKind ===
              SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG ||
            classifierResult.errorKind === 'context_too_large'
          if (isInputTooLong) {
            const heldByDenyRules = autoModeHasDenyRules()
            const canAskInTerminal =
              !heldByDenyRules &&
              effectiveModeForAuto !== 'dontAsk' &&
              classifierOnly === undefined &&
              !layeredPermissionContext.shouldAvoidPermissionPrompts &&
              !context.options?.isNonInteractiveSession
            if (canAskInTerminal) {
              const reason = formatAutoModeNoServerCheckNotice({
                why: 'context_too_large',
                asks: true,
              })
              logEvent('tengu_auto_mode_fallback_to_ask', {
                reason:
                  'no_classifier_for_call' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                toolName: sanitizeToolNameForAnalytics(tool.name),
              })
              return {
                ...result,
                suggestions: undefined,
                decisionReason: {
                  type: 'other',
                  reason,
                },
              }
            }
            if (heldByDenyRules) {
              const notice = formatAutoModeNoServerCheckNotice({
                why: 'context_too_large',
                asks: false,
                heldByDenyRules: true,
              })
              return {
                behavior: 'deny',
                decisionReason: {
                  type: 'classifier',
                  classifier: 'auto-mode',
                  reason: 'Classifier unavailable',
                },
                message: `${tool.name} was not run: ${notice}`,
              }
            }
          }
          const serverClassifierRequest = (
            assistantMessage as { serverClassifierRequest?: unknown }
          ).serverClassifierRequest
          if (
            isAutoModeServerEnabled(layeredPermissionContext.mode) &&
            typeof serverClassifierRequest === 'string' &&
            isConsecutiveUnavailableErrorKind(classifierResult.errorKind, false)
          ) {
            const hold = await holdOnAutoModeUnavailable(
              serverClassifierRequest,
              context,
              toolUseID,
            )
            if (hold.kind === 'stop') {
              return denyAutoModeUnavailableStop(tool, context, hold.recorded)
            }
            if (hold.interrupted) {
              throw new AbortError()
            }
          }
          logForDebugging(
            classifierResult.retryAfterMs === undefined
              ? 'Auto mode classifier unavailable, denying with retry guidance (fail closed)'
              : 'Auto mode classifier told to wait by the API, denying (fail closed)',
            { level: 'warn' },
          )
          let unavailableMessage = buildClassifierUnavailableMessage(
            tool.name,
            classifierResult.model,
            classifierResult.httpStatus,
            classifierResult.errorKind,
            classifierResult.retryAfterMs,
          )
          const inputTooLongDetail = formatServerUnavailableInputTooLongDetail(
            classifierResult.errorKind,
          )
          if (
            inputTooLongDetail !== undefined &&
            !unavailableMessage.includes(inputTooLongDetail)
          ) {
            unavailableMessage = `${unavailableMessage} ${inputTooLongDetail.trim()}`
          }
          return {
            behavior: 'deny',
            decisionReason: {
              type: 'classifier',
              classifier: 'auto-mode',
              reason: 'Classifier unavailable',
            },
            message: unavailableMessage,
          }
        }

        // densable 2.1.225: stop_reason==="refusal" → refuse without denial counter.
        if (classifierResult.refusedBySafeguard) {
          if (avoidsPromptsByNature(layeredPermissionContext)) {
            throw new AbortError(
              'Agent aborted: auto mode classifier request refused by the safety safeguard in headless mode',
            )
          }
          logForDebugging(
            'Auto mode classifier request refused by the safety safeguard, denying (exempt from the denial counter)',
            { level: 'warn' },
          )
          return {
            behavior: 'deny',
            decisionReason: {
              type: 'classifier',
              classifier: 'auto-mode',
              reason: classifierResult.reason,
              noVerdict: true,
            },
            message: buildYoloRejectionMessage(classifierResult.reason, {
              refused: true,
            }),
          }
        }

        logForDebugging(
          `Auto mode classifier blocked action: ${classifierResult.reason}`,
          { level: 'warn' },
        )

        // densable AL then Xe onBlock flag allow.
        const newDenialState = recordDenial(denialState)
        persistDenialState(context, newDenialState)

        if (classifierOnly?.onBlock === 'flag') {
          stashHandbackClassifierResult(toolUseID, {
            kind: 'blocked',
            reason: classifierResult.reason,
          })
          return {
            behavior: 'allow',
            updatedInput: result.updatedInput ?? input,
            decisionReason: {
              type: 'classifier',
              classifier: 'auto-mode',
              reason: `Flagged by the classifier, delivered with its warning: ${classifierResult.reason}`,
            },
          }
        }

        // If denial limit hit, fall back to prompting so the user
        // can review. We check after the classifier so we can include
        // its reason in the prompt.
        const denialLimitResult = handleDenialLimitExceeded(
          newDenialState,
          appState,
          classifierResult.reason,
          assistantMessage,
          tool,
          result,
          context,
        )
        if (denialLimitResult) {
          return denialLimitResult
        }

        return {
          behavior: 'deny',
          decisionReason: {
            type: 'classifier',
            classifier: 'auto-mode',
            reason: classifierResult.reason,
          },
          message: buildYoloRejectionMessage(classifierResult.reason, {
            allowRuleToolName: getAutoModeDenialAllowRuleToolName(
              tool,
              input,
              result,
              context,
            ),
          }),
        }
      }

      // Reset consecutive denials on success
      const newDenialState = recordSuccess(denialState)
      persistDenialState(context, newDenialState)

      // Official `FYn` / `po`: gate classifier allow on `!mustAskPerson`
      // (`hookAskFloor` or `personOnly: true`) — deny in `dontAsk`/non-interactive,
      // re-surface original `ask` otherwise.
      return finalizeAutoAllow({
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: classifierResult.reason,
        },
      })
    }

    // When permission prompts should be avoided (e.g., background/headless agents,
    // or remote_cowork_trigger scheduled sessions #973), run PermissionRequest
    // hooks first (unless remote_cowork_trigger fast-deny) and auto-deny if no
    // hook provides a decision.
    if (
      layeredPermissionContext.shouldAvoidPermissionPrompts ||
      hasAsksNoHost(context) ||
      process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork_trigger'
    ) {
      if (process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork_trigger') {
        return {
          behavior: 'deny',
          decisionReason: {
            type: 'asyncAgent',
            reason:
              'Permission prompts are not available in scheduled Cowork sessions',
          },
          message: AUTO_REJECT_MESSAGE(tool.name),
        }
      }
      const hookDecision = await runPermissionRequestHooksForHeadlessAgent(
        tool,
        input,
        toolUseID,
        context,
        layeredPermissionContext.mode,
        result.suggestions,
      )
      if (hookDecision) {
        return hookDecision
      }
      const hasExplicitCause =
        result.decisionReason !== undefined &&
        (result.decisionReason.type === 'safetyCheck' ||
          (result.decisionReason.type === 'other' &&
            result.decisionReason.reason.length > 0))
      return {
        behavior: 'deny',
        decisionReason: {
          type: 'asyncAgent',
          reason: 'Permission prompts are not available in this context',
        },
        message: hasExplicitCause
          ? formatNonInteractiveAskCauseMessage(result)
          : AUTO_REJECT_MESSAGE(tool.name),
      }
    }
  }

  if (
    result.behavior === 'ask' &&
    askIsHeldForQueuedMessage(
      { tool, toolUseContext: context, forceDecision },
      toolUseID,
      assistantMessage,
    )
  ) {
    return {
      behavior: 'deny',
      message: HELD_FOR_QUEUED_MESSAGE_TOOL_RESULT,
      decisionReason: HELD_FOR_QUEUED_MESSAGE_DECISION_REASON,
    }
  }

  return result
}

/**
 * Persist denial tracking state. For async subagents with localDenialTracking,
 * mutate the local state in place (since setAppState is a no-op). Otherwise,
 * write to appState as usual.
 */
/** densable NHo `if(!k0(requestDialog)) bM` on acceptEdits / allowlist. */
function persistDenialStateUnlessHeld(
  context: ToolUseContext,
  denialState: DenialTrackingState,
): void {
  if (shouldHoldConsecutiveDenials(context)) return
  persistDenialState(context, recordSuccess(denialState))
}

function persistDenialState(
  context: ToolUseContext,
  newState: DenialTrackingState,
): void {
  if (context.localDenialTracking) {
    Object.assign(context.localDenialTracking, newState)
  } else {
    context.setAppState(prev => {
      // recordSuccess returns the same reference when state is
      // unchanged. Returning prev here lets store.setState's Object.is check
      // skip the listener loop entirely.
      if (prev.denialTracking === newState) return prev
      return { ...prev, denialTracking: newState }
    })
  }
}

/**
 * Check if a denial limit was exceeded and return an 'ask' result
 * so the user can review. Returns null if no limit was hit.
 */
function handleDenialLimitExceeded(
  denialState: DenialTrackingState,
  appState: {
    toolPermissionContext: { shouldAvoidPermissionPrompts?: boolean }
  },
  classifierReason: string,
  assistantMessage: AssistantMessage,
  tool: Tool,
  result: PermissionDecision,
  context: ToolUseContext,
): PermissionDecision | null {
  if (!shouldFallbackToPrompting(denialState)) {
    return null
  }

  const hitTotalLimit = denialState.totalDenials >= DENIAL_LIMITS.maxTotal
  const effectivePermCtx = getEffectiveToolPermissionContext(context)
  const isHeadless =
    appState.toolPermissionContext.shouldAvoidPermissionPrompts ||
    effectivePermCtx.shouldAvoidPermissionPrompts
  // Capture counts before persistDenialState, which may mutate denialState
  // in-place via Object.assign for subagents with localDenialTracking.
  const totalCount = denialState.totalDenials
  const consecutiveCount = denialState.consecutiveDenials
  const warning = hitTotalLimit
    ? `${totalCount} actions were blocked this session. Please review the transcript before continuing.`
    : `${consecutiveCount} consecutive actions were blocked. Please review the transcript before continuing.`

  logEvent('tengu_auto_mode_denial_limit_exceeded', {
    limit: (hitTotalLimit
      ? 'total'
      : 'consecutive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    mode: (isHeadless
      ? 'headless'
      : 'cli') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    messageID: assistantMessage.message
      .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    consecutiveDenials: consecutiveCount,
    totalDenials: totalCount,
    toolName: sanitizeToolNameForAnalytics(tool.name),
  })

  if (avoidsPromptsByNature(effectivePermCtx)) {
    throw new AbortError(
      'Agent aborted: too many classifier denials in headless mode',
    )
  }

  logForDebugging(
    `Classifier denial limit exceeded, falling back to prompting: ${warning}`,
    { level: 'warn' },
  )

  if (hitTotalLimit) {
    persistDenialState(context, {
      ...denialState,
      totalDenials: 0,
      consecutiveDenials: 0,
    })
  }

  // Preserve the original classifier value (e.g. 'dangerous-agent-action')
  // so downstream analytics in interactiveHandler can log the correct
  // user override event.
  const originalClassifier =
    result.decisionReason?.type === 'classifier'
      ? result.decisionReason.classifier
      : 'auto-mode'

  return {
    ...result,
    decisionReason: {
      type: 'classifier',
      classifier: originalClassifier,
      reason: `${warning}\n\nLatest blocked action: ${classifierReason}`,
    },
  }
}

/**
 * Check only the rule-based steps of the permission pipeline — the subset
 * that bypassPermissions mode respects (everything that fires before step 2a).
 *
 * Returns a deny/ask decision if a rule blocks the tool, or null if no rule
 * objects. Unlike hasPermissionsToUseTool, this does NOT run the auto mode classifier,
 * mode-based transformations (dontAsk/auto/asyncAgent), PermissionRequest hooks,
 * or bypassPermissions / always-allowed checks.
 *
 * Caller must pre-check tool.requiresUserInteraction() — step 1e is not replicated.
 */
function resolvePermissionCheckFailureDecision(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): PermissionDecision | undefined {
  const fn = (
    tool as {
      permissionCheckFailureDecision?: (
        input: unknown,
        context: ToolUseContext,
      ) => PermissionResult | undefined
    }
  ).permissionCheckFailureDecision
  const failureDecision = fn?.(input, context)
  if (
    failureDecision?.behavior === 'deny' ||
    failureDecision?.behavior === 'ask'
  ) {
    return failureDecision
  }
  return undefined
}

export async function checkRuleBasedPermissions(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
  options?: { crashIsObjection?: boolean; planModeWriteFloor?: boolean },
): Promise<PermissionAskDecision | PermissionDenyDecision | null> {
  // densable bn: sticky layers overlay + plugin tool.list deny rules for rule-based checks
  const toolPermissionContext = applyPluginToolListDenyRules(
    getEffectiveToolPermissionContext(context),
  )

  // 1a. Entire tool is denied by rule
  const denyRule = getDenyRuleForTool(
    toolPermissionContext,
    tool,
    context.options?.mcpClients,
  )
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  // 1b. Entire tool has an ask rule
  const askRule = getAskRuleForTool(
    toolPermissionContext,
    tool,
    context.options?.mcpClients,
  )
  if (askRule) {
    const canSandboxAutoAllow =
      tool.name === BASH_TOOL_NAME &&
      !isSandboxAutoAllowSuspended(toolPermissionContext, context) &&
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      shouldUseSandbox(input)

    if (!canSandboxAutoAllow) {
      return {
        behavior: 'ask',
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
      }
    }
    // Fall through to let tool.checkPermissions handle command-specific rules
  }

  // 1c. Tool-specific permission check (e.g. bash subcommand rules)
  let toolPermissionResult: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolPermissionResult = await tool.checkPermissions(parsedInput, context)
  } catch (e) {
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
    const failureDecision = resolvePermissionCheckFailureDecision(
      tool,
      input,
      context,
    )
    if (failureDecision && failureDecision.behavior !== 'allow') {
      return failureDecision
    }
    // Official 2.1.326 #311 / #253 (`LIn` / `bts` / `unfinishedCheck`):
    // when tool.checkPermissions throws a non-abort error, do NOT fall through
    // to bypassPermissions or generic passthrough — emit a bypass-immune
    // `unfinishedCheck` safetyCheck naming the error cause.
    const errDetail =
      e instanceof Error && e.message.trim().length > 0
        ? ` (${e.message.trim()})`
        : ''
    const unfinishedReason = `The permission check for ${tool.name} did not finish${errDetail}, so its safety checks did not run.`
    const unfinishedAsk = buildUnfinishedCheckAsk(unfinishedReason, {
      blockReadsOutsideWorkingDirectories:
        toolPermissionContext.blockReadsOutsideWorkingDirectories,
    }) as unknown as PermissionAskDecision
    toolPermissionResult = unfinishedAsk
    if (options?.crashIsObjection) {
      return unfinishedAsk
    }
  }

  // 1d. Tool implementation denied (catches bash subcommand denies wrapped
  // in subcommandResults — no need to inspect decisionReason.type)
  if (toolPermissionResult?.behavior === 'deny') {
    return toolPermissionResult
  }

  // 1d2. Official 2.1.321 #1958 (`tengu_wise_newt`): refuse calls that hold
  // the signed-in account's email address beside a User-Agent / client identity.
  const wiseNewtDeny = await checkAccountEmailUserAgent(tool.name, input)
  if (wiseNewtDeny) {
    return wiseNewtDeny
  }

  // 1f. Content-specific ask rules from tool.checkPermissions
  // (e.g. Bash(npm publish:*) → {ask, type:'rule', ruleBehavior:'ask'},
  // or Monitor ws under a Bash ask rule → matchedAskRule)
  if (
    toolPermissionResult?.behavior === 'ask' &&
    hasMatchedAskRule(toolPermissionResult)
  ) {
    return toolPermissionResult
  }

  // 1g. Non-classifier-approvable safety checks stay immune even when a
  // PreToolUse hook returned allow (including nested subcommandResults safety
  // checks and unwaivable bypass-immune breakers like unfinishedCheck).
  // classifierApprovable safetyChecks (sensitive-file paths under .claude/,
  // .git/, etc.) are not hard-blocks here — callers that apply mode
  // (bypassPermissions) may still allow them.
  if (
    toolPermissionResult?.behavior === 'ask' &&
    (findSafetyCheckDecision(
      toolPermissionResult.decisionReason,
      check => !check.classifierApprovable,
    ) !== undefined ||
      hasUnwaivableBypassImmuneSafetyCheck(toolPermissionResult.decisionReason))
  ) {
    return toolPermissionResult
  }

  // 1h. Plan-mode write floor (#686): PreToolUse allow must not let a
  // non-read-only write (file, shell, or MCP) execute unprompted in plan mode.
  if (
    options?.planModeWriteFloor === true &&
    !tool.requiresUserInteraction?.() &&
    !isBypassedByPrePlanMode(toolPermissionContext) &&
    isPlanModeNonReadOnlyWrite(tool, input, context)
  ) {
    return toolPermissionResult?.behavior === 'ask'
      ? toolPermissionResult
      : {
          behavior: 'ask',
          decisionReason: {
            type: 'mode',
            mode: 'plan',
          },
          message: createPermissionRequestMessage(tool.name),
        }
  }

  // No rule-based objection
  return null
}

async function hasPermissionsToUseToolInner(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<PermissionDecision> {
  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  // Official CLAUDE_CODE_TEST_FORCE_DENY densable — deny every tool (test harness).
  try {
    const { isTestForceDenyEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    if (isTestForceDenyEnabled()) {
      return {
        behavior: 'deny',
        decisionReason: {
          type: 'other',
          reason: 'CLAUDE_CODE_TEST_FORCE_DENY',
        },
        message: `Permission to use ${tool.name} has been denied (TEST_FORCE_DENY).`,
      }
    }
  } catch {
    // densable optional
  }

  let appState = context.getAppState()
  // densable bn / getToolPermissionContext — sticky layers last-wins overlay
  // for mode / allow-deny rules / avoid_prompts / working_directory.
  // Official 2.1.323 #2188: append plugin-removed tools to alwaysDenyRules.session.
  // Official 2.1.325 #2319: strip slash-command allowed-tools for background agents.
  let toolPermissionContext = applyPluginToolListDenyRules(
    getEffectiveToolPermissionContext(context),
  )

  // 1. Check if the tool is denied
  // 1a. Entire tool is denied
  const denyRule = getDenyRuleForTool(
    toolPermissionContext,
    tool,
    context.options?.mcpClients,
  )
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  // 1b. Check if the entire tool should always ask for permission
  const askRule = getAskRuleForTool(
    toolPermissionContext,
    tool,
    context.options?.mcpClients,
  )
  if (askRule) {
    // When autoAllowBashIfSandboxed is on, sandboxed commands skip the ask rule and
    // auto-allow via Bash's checkPermissions. Commands that won't be sandboxed (excluded
    // commands, dangerouslyDisableSandbox) still need to respect the ask rule.
    const canSandboxAutoAllow =
      tool.name === BASH_TOOL_NAME &&
      !isSandboxAutoAllowSuspended(toolPermissionContext, context) &&
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      shouldUseSandbox(input)

    if (!canSandboxAutoAllow) {
      return {
        behavior: 'ask',
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
      }
    }
    // Fall through to let Bash's checkPermissions handle command-specific rules
  }

  // 1c. Ask the tool implementation for a permission result
  // Overridden unless tool input schema is not valid
  let toolPermissionResult: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolPermissionResult = await tool.checkPermissions(parsedInput, context)
    // Official 2.1.198/199/207: plan mode auto-allows read-only MCP tools;
    // state-changing MCP (incl. browser) must prompt — except Chrome MCP tools
    // classified read-only by heo(cie(tool), input) (browser_batch nested RO, etc.).
    if (
      tool.mcpInfo &&
      !tool.isReadOnly(parsedInput) &&
      toolPermissionResult.behavior === 'passthrough' &&
      toolPermissionContext.mode === 'plan' &&
      !isChromeMcpReadOnlyTool(getToolNameForPermissionCheck(tool), parsedInput)
    ) {
      toolPermissionResult = {
        behavior: 'ask',
        message: `Cannot call ${tool.name} while in plan mode.`,
        decisionReason: {
          type: 'mode',
          mode: 'plan',
        },
      }
    }
  } catch (e) {
    // Rethrow abort errors so they propagate properly
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
    const failureDecision = resolvePermissionCheckFailureDecision(
      tool,
      input,
      context,
    )
    if (failureDecision && failureDecision.behavior !== 'allow') {
      return failureDecision
    }
    // Official 2.1.326 #311 / #253 (`LIn` / `bts` / `unfinishedCheck`):
    // when tool.checkPermissions throws a non-abort error, do NOT fall through
    // to bypassPermissions or generic passthrough — emit a bypass-immune
    // `unfinishedCheck` safetyCheck naming the error cause.
    const errDetail =
      e instanceof Error && e.message.trim().length > 0
        ? ` (${e.message.trim()})`
        : ''
    const unfinishedReason = `The permission check for ${tool.name} did not finish${errDetail}, so its safety checks did not run.`
    toolPermissionResult = buildUnfinishedCheckAsk(unfinishedReason, {
      blockReadsOutsideWorkingDirectories:
        toolPermissionContext.blockReadsOutsideWorkingDirectories,
    }) as unknown as PermissionResult
  }

  // 1d. Tool implementation denied permission
  if (toolPermissionResult?.behavior === 'deny') {
    return toolPermissionResult
  }

  // 1d2. Official 2.1.321 #1958 (`tengu_wise_newt`): directly refuse calls
  // that hold the signed-in account's email address beside a User-Agent.
  const wiseNewtDeny = await checkAccountEmailUserAgent(tool.name, input)
  if (wiseNewtDeny) {
    return wiseNewtDeny
  }

  // 1e. Tool requires user interaction even in bypass mode
  if (
    tool.requiresUserInteraction?.() &&
    toolPermissionResult?.behavior === 'ask'
  ) {
    return toolPermissionResult
  }

  // 1f. Content-specific ask rules from tool.checkPermissions take precedence
  // over bypassPermissions mode and whole-tool allow rules (including
  // matchedAskRule on Monitor ws calls, #1807).
  if (
    toolPermissionResult?.behavior === 'ask' &&
    hasMatchedAskRule(toolPermissionResult)
  ) {
    return toolPermissionResult
  }

  // 1f2. Official org_ask_ceiling: MCP toolPermissions effectiveMaxPermission
  // of "ask" forces interactive approval (cannot be auto-approved / bypassed).
  if (tool.mcpInfo?.effectiveMaxPermission === 'ask') {
    const decisionReason: PermissionDecisionReason = {
      type: 'other',
      reason: 'Your organization requires approval for this tool',
    }
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(tool.name, decisionReason),
      decisionReason,
    }
  }

  // 1f3. Official 2.1.325 #2328: in cloud sessions while plugins are still
  // loading, hold connector MCP tool approvals instead of auto-approving via
  // bypassPermissions / alwaysAllow rules.
  if (
    shouldHoldConnectorApprovalWhilePluginsLoading({
      isConnectorTool:
        tool.mcpInfo !== undefined || tool.name.startsWith('mcp__'),
    })
  ) {
    const decisionReason: PermissionDecisionReason = {
      type: 'other',
      reason: 'Holding connector tool approval while cloud plugins are loading',
    }
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(tool.name, decisionReason),
      decisionReason,
    }
  }

  // 1g / 2a / 2b. Official 2.1.328 `ZMt` (`chunk@294254613.js @3737750`):
  // Refresh latest context and compute effective mode / bypass eligibility
  // BEFORE checking guarded asks so whole-tool `alwaysAllowRules` can NEVER
  // bypass `personOnly`, `safetyCheck` (including `classifierApprovable: true`
  // like `.git/`, `.claude/`, `.bashrc`), `sandboxOverride`, or `mode === 'plan'`.
  appState = context.getAppState()
  // densable bn: re-materialize sticky layers after refresh
  toolPermissionContext = applyPluginToolListDenyRules(
    getEffectiveToolPermissionContext(context),
  )
  // Official snt(): effective mode for this MCP tool may demote bypass/auto
  // via per-server overrides or chrome classifier floor.
  const effectiveMode = getEffectivePermissionMode(tool, toolPermissionContext)
  // Check if permissions should be bypassed:
  // - Direct bypassPermissions mode (after MCP effective-mode resolution)
  // - Plan mode when the user originally started with bypass mode
  const shouldBypassPermissions = isSessionBypassClass({
    mode: effectiveMode,
    prePlanMode: toolPermissionContext.prePlanMode,
  })

  // Official 2.1.328 `ZMt` (`chunk@294254613.js@3738150..3738700`):
  // Update monotonic `removalWaiverRulesClear` latch before evaluating
  // bypass-immune safety checks.
  checkAndLatchRemovalWaiverRulesClear(toolPermissionContext, context)

  const canWaiveBypassRemovalPrompt =
    shouldBypassPermissions &&
    toolPermissionResult?.behavior === 'ask' &&
    effectiveMode === 'bypassPermissions' &&
    context.hookAskFloor !== true &&
    isRemovalWaiverAllowed(toolPermissionContext, context)

  if (toolPermissionResult?.behavior === 'ask') {
    // `personOnly: true` asks (e.g. org new-artifact approval) MUST return
    // before both bypassPermissions and whole-tool alwaysAllowRules.
    if (toolPermissionResult.personOnly === true) {
      return toolPermissionResult
    }

    // Bypass-immune safety checks (non-classifierApprovable or bypassImmune
    // circuit breakers) must prompt (or splendid-horizon / non-interactive deny)
    // even in bypassPermissions mode — EXCEPT `waivableInBypass: true` checks
    // (`dangerousRemoval`) when `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS`
    // is truthy, no `PermissionRequest` hook is active, and `removalWaiverRulesClear`
    // has never been invalidated.
    const hasBlockingBypassImmuneSafetyCheck = canWaiveBypassRemovalPrompt
      ? findSafetyCheckDecision(
          toolPermissionResult.decisionReason,
          check =>
            isUnwaivableBypassImmuneSafetyCheck(check) ||
            (!check.classifierApprovable &&
              !isWaivableBypassSafetyCheck(check)),
        ) !== undefined ||
        hasUnwaivableBypassImmuneSafetyCheck(
          toolPermissionResult.decisionReason,
        )
      : findSafetyCheckDecision(
          toolPermissionResult.decisionReason,
          check =>
            !check.classifierApprovable || isBypassImmuneSafetyCheck(check),
        ) !== undefined ||
        hasUnwaivableBypassImmuneSafetyCheck(
          toolPermissionResult.decisionReason,
        )
    if (hasBlockingBypassImmuneSafetyCheck) {
      const layeredNow = getToolPermissionContextFromLayers(context)
      const modeNow = getEffectivePermissionMode(tool, layeredNow)
      const splendid = applySplendidHorizonBypassDeny(
        toolPermissionResult,
        modeNow,
      )
      // Official 2.1.326 #311 / #253: unwaivable bypass-immune checks
      // (`waivableInBypass: false`, e.g. `unfinishedCheck`, `outsideReadsBlocked`,
      // `isolatePeerMachines`, `restrictedMode`, `connectorFileSend`) ask in
      // bypassPermissions mode, and are denied with cause where no one can answer.
      if (
        splendid.behavior === 'ask' &&
        modeNow === 'bypassPermissions' &&
        (layeredNow.shouldAvoidPermissionPrompts ||
          context.options?.isNonInteractiveSession) &&
        hasUnwaivableBypassImmuneSafetyCheck(splendid.decisionReason)
      ) {
        return {
          behavior: 'deny',
          message: formatNonInteractiveAskCauseMessage(splendid),
          decisionReason: {
            type: 'asyncAgent',
            reason:
              'Safety check requires approval even in bypassPermissions mode and no approval surface is available',
          },
        }
      }
      return splendid
    }

    // Official `Je = I$t(decisionReason, y)` + `tt` (`hookAskFloor` + `sandboxOverride`):
    // `sandboxOverride` under `blockReadsOutsideWorkingDirectories` or `hookAskFloor`
    // must prompt even in bypassPermissions mode.
    const isSandboxOverrideUnderReadBlockOrHookAsk =
      toolPermissionResult.decisionReason?.type === 'sandboxOverride' &&
      (toolPermissionContext.blockReadsOutsideWorkingDirectories === true ||
        (shouldBypassPermissions && context.hookAskFloor === true))
    if (isSandboxOverrideUnderReadBlockOrHookAsk) {
      return toolPermissionResult
    }

    // Official `ZMt`: when NOT bypassing permissions, return `ask` BEFORE
    // whole-tool `alwaysAllowRules` whenever the ask came from ANY `safetyCheck`
    // (including `classifierApprovable: true` like `.git/`, `.claude/`, `.bashrc`),
    // `sandboxOverride`, or `mode === 'plan'` (`VGe`).
    if (
      !shouldBypassPermissions &&
      (findSafetyCheckDecision(toolPermissionResult.decisionReason) !==
        undefined ||
        toolPermissionResult.decisionReason?.type === 'sandboxOverride' ||
        (toolPermissionResult.decisionReason?.type === 'mode' &&
          toolPermissionResult.decisionReason.mode === 'plan'))
    ) {
      return toolPermissionResult
    }
  }

  // 2a. Check if mode allows the tool to run
  if (shouldBypassPermissions) {
    if (
      canWaiveBypassRemovalPrompt &&
      toolPermissionResult?.behavior === 'ask' &&
      hasBypassImmuneSafetyCheck(toolPermissionResult.decisionReason)
    ) {
      logForDebugging('permission_bypass_removal_prompt_waived')
      logEvent('tengu_permission_bypass_removal_prompt_waived', {})
    }
    return {
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: 'mode',
        mode: effectiveMode,
      },
    }
  }

  // 2b. Entire tool is allowed (unless tool ignores whole-tool allow rules for
  // this input, #2173, or the ask marks `wholeToolRuleDoesNotCover`)
  const wholeToolRuleDoesNotCover =
    toolPermissionResult.behavior === 'ask' &&
    (toolPermissionResult as { wholeToolRuleDoesNotCover?: boolean })
      .wholeToolRuleDoesNotCover === true
  const alwaysAllowedRule = wholeToolRuleDoesNotCover
    ? null
    : toolAlwaysAllowedRule(toolPermissionContext, tool)
  if (alwaysAllowedRule && tool.ignoresWholeToolAllowRule?.(input) !== true) {
    return {
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: 'rule',
        rule: alwaysAllowedRule,
      },
    }
  }

  // 3. Convert "passthrough" to "ask"
  const result: PermissionDecision =
    toolPermissionResult.behavior === 'passthrough'
      ? {
          ...toolPermissionResult,
          behavior: 'ask' as const,
          message: createPermissionRequestMessage(
            tool.name,
            toolPermissionResult.decisionReason,
          ),
        }
      : toolPermissionResult

  if (result.behavior === 'ask' && result.suggestions) {
    logForDebugging(
      `Permission suggestions for ${tool.name}: ${jsonStringify(result.suggestions, null, 2)}`,
    )
  }

  return result
}

type EditPermissionRuleArgs = {
  initialContext: ToolPermissionContext
  setToolPermissionContext: (updatedContext: ToolPermissionContext) => void
}

/**
 * Delete a permission rule from the appropriate destination
 */
export async function deletePermissionRule({
  rule,
  initialContext,
  setToolPermissionContext,
}: EditPermissionRuleArgs & { rule: PermissionRule }): Promise<void> {
  if (
    rule.source === 'policySettings' ||
    rule.source === 'flagSettings' ||
    rule.source === 'command'
  ) {
    throw new Error('Cannot delete permission rules from read-only settings')
  }

  const updatedContext = applyPermissionUpdate(initialContext, {
    type: 'removeRules',
    rules: [rule.ruleValue],
    behavior: rule.ruleBehavior,
    destination: rule.source as PermissionUpdateDestination,
  })

  // Per-destination logic to delete the rule from settings
  const destination = rule.source
  switch (destination) {
    case 'localSettings':
    case 'userSettings':
    case 'projectSettings': {
      // Note: Typescript doesn't know that rule conforms to `PermissionRuleFromEditableSettings` even when we switch on `rule.source`
      deletePermissionRuleFromSettings(
        rule as PermissionRuleFromEditableSettings,
      )
      break
    }
    case 'cliArg':
    case 'session':
    case 'toolsNarrowing':
    case 'hostCredential': {
      // No action needed for in-memory sources - not persisted to disk
      break
    }
  }

  // Update React state with updated context
  setToolPermissionContext(updatedContext)
}

/**
 * Helper to convert PermissionRule array to PermissionUpdate array
 */
function convertRulesToUpdates(
  rules: PermissionRule[],
  updateType: 'addRules' | 'replaceRules',
): PermissionUpdate[] {
  // Group rules by source and behavior
  const grouped = new Map<string, PermissionRuleValue[]>()

  for (const rule of rules) {
    const key = `${rule.source}:${rule.ruleBehavior}`
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(rule.ruleValue)
  }

  // Convert to PermissionUpdate array
  const updates: PermissionUpdate[] = []
  for (const [key, ruleValues] of grouped) {
    const [source, behavior] = key.split(':')
    updates.push({
      type: updateType,
      rules: ruleValues,
      behavior: behavior as PermissionBehavior,
      destination: source as PermissionUpdateDestination,
    })
  }

  return updates
}

/**
 * Apply permission rules to context (additive - for initial setup)
 */
export function applyPermissionRulesToPermissionContext(
  toolPermissionContext: ToolPermissionContext,
  rules: PermissionRule[],
): ToolPermissionContext {
  const updates = convertRulesToUpdates(rules, 'addRules')
  return applyPermissionUpdates(toolPermissionContext, updates)
}

/**
 * Sync permission rules from disk (replacement - for settings changes)
 */
export function syncPermissionRulesFromDisk(
  toolPermissionContext: ToolPermissionContext,
  rules: PermissionRule[],
): ToolPermissionContext {
  // Official 2.1.328 (`chunk@294254613.js@3740800`): check BEFORE clearing so
  // removing prior deny/ask rules mid-session cannot retroactively unlock
  // `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` removal waivers.
  checkAndLatchRemovalWaiverRulesClear(toolPermissionContext)

  let context = toolPermissionContext

  // Official 2.1.328 `jYn` (`chunk@294254613.js @3740296`):
  // When allowManagedPermissionRulesOnly is enabled, clear user/project/local
  // rules for all behaviors, and clear ONLY `'allow'` for `'cliArg'`/`'session'`
  // (preserving `'deny'`/`'ask'` so `--disallowedTools` is never wiped).
  if (shouldAllowManagedPermissionRulesOnly()) {
    const sourcesToClear: PermissionUpdateDestination[] = [
      'userSettings',
      'projectSettings',
      'localSettings',
      'cliArg',
      'session',
    ]
    const behaviors: PermissionBehavior[] = ['allow', 'deny', 'ask']

    for (const source of sourcesToClear) {
      for (const behavior of behaviors) {
        if (
          (source === 'cliArg' || source === 'session') &&
          behavior !== 'allow'
        ) {
          continue
        }
        context = applyPermissionUpdate(context, {
          type: 'replaceRules',
          rules: [],
          behavior,
          destination: source,
        })
      }
    }
  }

  // Clear all 5 SettingSource destinations (`Gs`: userSettings, projectSettings,
  // localSettings, flagSettings, policySettings) across all behaviors before
  // replaying updates so removed rules from any settings tier never persist.
  for (const settingSource of SETTING_SOURCES) {
    for (const behavior of ['allow', 'deny', 'ask'] as PermissionBehavior[]) {
      context = applyPermissionUpdate(context, {
        type: 'replaceRules',
        rules: [],
        behavior,
        destination: settingSource as unknown as PermissionUpdateDestination,
      })
    }
  }

  const updates = convertRulesToUpdates(rules, 'replaceRules')
  let next = applyPermissionUpdates(context, updates)
  if (settingsHaveBlockWritesOutsideWorkingDirectories()) {
    next = applyBlockWritesOutsideWorkingDirectories(next)
  }
  if (settingsHaveBlockFileToolReadsOutsideWorkingDirectories()) {
    next = {
      ...next,
      blockFileToolReadsOutsideWorkingDirectories: true,
    } as ToolPermissionContext
  }
  // Official `jYn` end (`Tlr(h); Czr(void 0)`): latch after replacing rules too.
  checkAndLatchRemovalWaiverRulesClear(next)
  return next
}

/**
 * Official 2.1.328 (`chunk@284607801.js@93742`, `chunk@283886268.js@6708`):
 * True when file-tool reads outside working directories are fenced via either
 * `permissions.blockReadsOutsideWorkingDirectories` or launch `--settings`
 * `permissions.blockFileToolReadsOutsideWorkingDirectories`.
 */
export function isFileToolOutsideReadFenceActive(
  toolPermissionContext: ToolPermissionContext,
): boolean {
  return contextBlocksOutsideReads(
    toolPermissionContext as ToolPermissionContext & {
      blockFileToolReadsOutsideWorkingDirectories?: boolean
    },
  )
}

const REMOVAL_WAIVER_DISQUALIFYING_TOOLS = new Set([
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  'Edit',
  'Write',
  'Read',
  'MultiEdit',
  'NotebookEdit',
  '*',
])

const REMOVAL_WAIVER_EPHEMERAL_SOURCES = new Set(['cliArg', 'session'])

/**
 * Official 2.1.328 `Ir().removalWaiverRulesClear` (`chunk@289034284.js@211038`,
 * `chunk@294254613.js@3741033`): monotonic one-way latch. Once set to `false`
 * (due to disqualifying deny/ask rules, `blockReadsOutsideWorkingDirectories`,
 * or an active `PermissionRequest` hook), it stays `false` for the rest of the
 * session so clearing rules mid-session cannot unlock dangerous-removal waivers.
 */
let removalWaiverRulesClear: boolean | undefined

function isWaivableBypassSafetyCheck(check: {
  circuitBreaker?: string
  also?: readonly string[]
}): boolean {
  if (!check.circuitBreaker) return false
  if (!Object.hasOwn(CIRCUIT_BREAKER_POLICY, check.circuitBreaker)) return false
  const policy =
    CIRCUIT_BREAKER_POLICY[check.circuitBreaker as CircuitBreakerName]
  if (!policy.bypassImmune || !policy.waivableInBypass) return false
  // Any secondary unwaivable breaker in `also` prevents waiver.
  return !isUnwaivableBypassImmuneSafetyCheck(check)
}

/** Official 2.1.328 `Fl(e)` (`chunk@289034284.js`): disqualifying rules/blocks check. */
export function hasRemovalWaiverDisqualifyingRules(
  toolPermissionContext: ToolPermissionContext,
): boolean {
  if (toolPermissionContext.blockReadsOutsideWorkingDirectories === true) {
    return true
  }
  const ruleMaps = [
    toolPermissionContext.alwaysDenyRules,
    toolPermissionContext.alwaysAskRules,
  ]
  for (const bySource of ruleMaps) {
    if (!bySource) continue
    for (const [source, rawRules] of Object.entries(bySource)) {
      if (!rawRules) continue
      for (const rawRule of rawRules) {
        const parsed = permissionRuleValueFromString(rawRule)
        if (
          REMOVAL_WAIVER_EPHEMERAL_SOURCES.has(source) &&
          parsed.ruleContent === undefined
        ) {
          continue
        }
        if (REMOVAL_WAIVER_DISQUALIFYING_TOOLS.has(parsed.toolName)) {
          return true
        }
      }
    }
  }
  return false
}

/** Official 2.1.328 `Czr` / `pG('PermissionRequest')`: true when any PermissionRequest hook is active. */
export function hasActivePermissionRequestHook(
  context?: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  for (const source of getEnabledSettingSources()) {
    const hooks = getSettingsForSource(source)?.hooks?.PermissionRequest
    if (Array.isArray(hooks) && hooks.length > 0) {
      return true
    }
  }
  const policyHooks =
    getSettingsForSource('policySettings')?.hooks?.PermissionRequest
  if (Array.isArray(policyHooks) && policyHooks.length > 0) {
    return true
  }
  try {
    const sessionHooks = context?.getAppState?.()?.sessionHooks
    if (sessionHooks instanceof Map) {
      for (const store of sessionHooks.values()) {
        const matchers = store?.hooks?.PermissionRequest
        if (Array.isArray(matchers) && matchers.length > 0) {
          return true
        }
      }
    }
  } catch {
    // If app state is unavailable, fall through to settings-only check
  }
  return false
}

/** Official `Tlr(e)` + `Czr(context)`: monotonically latch `removalWaiverRulesClear`. */
export function checkAndLatchRemovalWaiverRulesClear(
  toolPermissionContext: ToolPermissionContext,
  context?: Pick<ToolUseContext, 'getAppState'>,
): void {
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS)
  ) {
    return
  }
  if (
    hasRemovalWaiverDisqualifyingRules(toolPermissionContext) ||
    hasActivePermissionRequestHook(context)
  ) {
    removalWaiverRulesClear = false
  } else if (removalWaiverRulesClear === undefined) {
    removalWaiverRulesClear = true
  }
}

/**
 * Official 2.1.328 `tes(e) && pG('PermissionRequest') === 'none'`:
 * Waive `waivableInBypass` dangerous-removal prompts ONLY when
 * `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` is truthy (and not in a
 * child session), no `PermissionRequest` hook is active, and
 * `removalWaiverRulesClear` has never been invalidated.
 */
export function isRemovalWaiverAllowed(
  toolPermissionContext: ToolPermissionContext,
  context?: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  if (
    !isEnvTruthy(
      process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS,
    ) ||
    isEnvTruthy(process.env.CLAUDE_CODE_CHILD_SESSION)
  ) {
    return false
  }
  checkAndLatchRemovalWaiverRulesClear(toolPermissionContext, context)
  return (
    removalWaiverRulesClear === true && !hasActivePermissionRequestHook(context)
  )
}

export function getRemovalWaiverRulesClearForTesting(): boolean | undefined {
  return removalWaiverRulesClear
}

export function resetRemovalWaiverRulesClearForTesting(): void {
  removalWaiverRulesClear = undefined
}

/**
 * Extract updatedInput from a permission result, falling back to the original input.
 * Handles the case where some PermissionResult variants don't have updatedInput.
 */
function getUpdatedInputOrFallback(
  permissionResult: PermissionResult,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return (
    ('updatedInput' in permissionResult
      ? permissionResult.updatedInput
      : undefined) ?? fallback
  )
}

export type SplendidHorizonConfig = {
  enabled: boolean
  showDialog: boolean
  denyOnHostCard: boolean
  timeoutMs: number
  maxDialogTimeouts: number
}

const SPLENDID_HORIZON_DEFAULTS: SplendidHorizonConfig = {
  enabled: true,
  showDialog: true,
  denyOnHostCard: true,
  timeoutMs: 120_000,
  maxDialogTimeouts: 3,
}

/**
 * densable `wP()` (#1171): GrowthBook config for `tengu_splendid_horizon`
 * controlling dangerous `rm`/`rmdir` deny in bypassPermissions mode on host cards.
 */
export function getSplendidHorizonConfig(): SplendidHorizonConfig {
  const { value: raw, source } = getFeatureValueWithSource<
    Partial<SplendidHorizonConfig>
  >('tengu_splendid_horizon', {})
  return {
    enabled: process.env.CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT
      ? false
      : typeof raw?.enabled === 'boolean' && source === 'payload'
        ? raw.enabled
        : SPLENDID_HORIZON_DEFAULTS.enabled,
    showDialog:
      typeof raw?.showDialog === 'boolean'
        ? raw.showDialog
        : SPLENDID_HORIZON_DEFAULTS.showDialog,
    denyOnHostCard:
      typeof raw?.denyOnHostCard === 'boolean'
        ? raw.denyOnHostCard
        : SPLENDID_HORIZON_DEFAULTS.denyOnHostCard,
    timeoutMs:
      typeof raw?.timeoutMs === 'number' &&
      Number.isFinite(raw.timeoutMs) &&
      raw.timeoutMs >= 5000 &&
      raw.timeoutMs <= 3_600_000
        ? raw.timeoutMs
        : SPLENDID_HORIZON_DEFAULTS.timeoutMs,
    maxDialogTimeouts:
      typeof raw?.maxDialogTimeouts === 'number' &&
      Number.isInteger(raw.maxDialogTimeouts) &&
      raw.maxDialogTimeouts >= 0 &&
      raw.maxDialogTimeouts <= 100
        ? raw.maxDialogTimeouts
        : SPLENDID_HORIZON_DEFAULTS.maxDialogTimeouts,
  }
}

/**
 * densable `Ra` (#1171): locate a `dangerousRemoval` safetyCheck reason
 * directly or inside `subcommandResults`.
 */
export function findDangerousRemovalReason(
  decisionReason: PermissionDecisionReason | undefined,
): PermissionDecisionReason | undefined {
  if (!decisionReason) return undefined
  if (
    decisionReason.type === 'safetyCheck' &&
    decisionReason.circuitBreaker === 'dangerousRemoval'
  ) {
    return decisionReason
  }
  if (decisionReason.type === 'subcommandResults') {
    for (const sub of decisionReason.reasons.values()) {
      if (sub.behavior === 'ask') {
        const found = findDangerousRemovalReason(sub.decisionReason)
        if (found) return found
      }
    }
  }
  return undefined
}

const HOST_CARD_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'claude-vscode',
])

export function isHostCardEntrypoint(): boolean {
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT
  return ep !== undefined && HOST_CARD_ENTRYPOINTS.has(ep)
}

export function formatDangerousRmBypassDenyMessage(
  innerMessage: string,
  timeoutCount?: number,
): string {
  const countNote =
    timeoutCount !== undefined
      ? `The prompt for such removals has already gone unanswered ${timeoutCount} times in this session, so it was not shown again. `
      : ''
  return `Dangerous removal blocked in bypassPermissions mode, not by the user. The check stops removals that can delete far more than intended: a system, home or workspace directory, or a target it cannot resolve, such as a shell variable that, if unset or empty, turns this into \`rm -rf /\` or \`rm -rf /*\`. Only a person may approve such a removal, and no person did (the permission prompt timed out, or none was shown). ${countNote}The command was NOT run; do not claim it succeeded. Do not work around the check by splitting, scripting, or re-issuing the removal through another tool or shell: the check exists because a removal like this can destroy the user's data, and getting past it would not make it safe. If the text below suggests a safe rewrite, run that instead; it goes through the same check.\n\n${innerMessage}`
}

/**
 * Official 325 `Wyo(e, n)` — extract the nested safetyCheck message when the
 * outer result is a `subcommandResults` wrapper.
 */
function extractSafetyCheckMessage(
  result: PermissionDecision & { behavior: 'ask' },
  reason: PermissionDecisionReason,
): string {
  if (result.decisionReason?.type === 'subcommandResults') {
    for (const sub of result.decisionReason.reasons.values()) {
      if (sub.behavior === 'ask' && sub.decisionReason === reason) {
        return sub.message
      }
    }
  }
  return result.message
}

/**
 * densable `uVn` (#1171): in bypassPermissions mode on host-card surfaces
 * (Desktop, VS Code), deny dangerous `rm`/`rmdir` at once with a rewrite hint.
 */
export function applySplendidHorizonBypassDeny(
  result: PermissionDecision,
  effectiveMode: PermissionMode,
  isHostCard = isHostCardEntrypoint(),
  config: SplendidHorizonConfig = getSplendidHorizonConfig(),
): PermissionDecision {
  if (effectiveMode !== 'bypassPermissions' || result.behavior !== 'ask') {
    return result
  }
  const dangerousReason = findDangerousRemovalReason(result.decisionReason)
  if (!dangerousReason || !config.enabled) return result
  if (!isHostCard || !config.denyOnHostCard) return result
  return {
    behavior: 'deny',
    message: formatDangerousRmBypassDenyMessage(
      extractSafetyCheckMessage(result, dangerousReason),
    ),
    decisionReason: dangerousReason,
  }
}
