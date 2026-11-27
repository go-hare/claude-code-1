import { feature } from 'bun:bundle'
import { AsyncLocalStorage } from 'async_hooks'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import uniqBy from 'lodash-es/uniqBy.js'
import { dirname } from 'path'
import { getProjectRoot } from 'src/bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getCwd } from 'src/utils/cwd.js'
import {
  builtInCommandNames,
  findCommand,
  getCommandName,
  getCommands,
  type PromptCommand,
} from 'src/commands.js'
import {
  buildTool,
  createDefaultCanUseTool,
  resolveToolUseContext,
  type Tool,
  type ToolCallContext,
  type ToolCallProgress,
  type ToolDef,
  type ToolDeps,
  type ToolResult,
  type ToolUseContext,
  type ValidationResult,
} from 'src/Tool.js'
import type { Command } from 'src/types/command.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getBootstrapSession, RootSessionSlot } from 'src/utils/sessionHost.js'
import {
  formatSyncSkillNotMaterializedMessage,
  waitForSyncSkillMaterialization,
} from 'src/utils/syncSkillsMaterialization.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from 'src/utils/permissions/permissions.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from 'src/utils/plugins/pluginIdentifier.js'
import { buildPluginCommandTelemetryFields } from 'src/utils/telemetry/pluginTelemetry.js'
import { z } from 'zod/v4'
import {
  formatSubagentSafeguardsGuidance,
  isSubagentSafeguardsRefusal,
} from '../AgentTool/agentToolUtils.js'
import {
  addInvokedSkill,
  clearInvokedSkillsForAgent,
  getInvokedSkillsForAgent,
  getSessionId,
} from 'src/bootstrap/state.js'
import { COMMAND_MESSAGE_TAG } from 'src/constants/xml.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from 'src/services/analytics/index.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import {
  resolveSkillEffort,
  resolveSkillExecutionContext,
} from 'src/utils/skills/skillExecutionContext.js'
import { elideByteIdenticalSkillReinvocation } from 'src/utils/skills/skillReinvocation.js'
import { errorMessage } from 'src/utils/errors.js'
import { levelSessionEffort } from 'src/utils/effort.js'
import type { HostPermissionLayer } from 'src/engine/hostPermissionLayers.js'
import { applyContextLayers } from 'src/engine/permissionLayerReaders.js'
import {
  extractResultText,
  prepareForkedCommandContext,
} from 'src/utils/forkedAgent.js'
import {
  launchBackgroundForkedSkill,
  shouldBackgroundForkedSkill,
} from 'src/utils/forkedSkillBackground.js'
import { parseFrontmatter } from 'src/utils/frontmatterParser.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { createUserMessage, normalizeMessages } from 'src/utils/messages.js'
import type { ModelAlias } from 'src/utils/model/aliases.js'
import { resolveSkillModelOverride } from 'src/utils/model/model.js'
import { recordSkillUsage } from 'src/utils/suggestions/skillUsageTracking.js'
import { createAgentId } from 'src/utils/uuid.js'
import { isRunAgentSpinnerMode, runAgent } from '../AgentTool/runAgent.js'
import {
  getToolUseIDFromParentMessage,
  tagMessagesWithToolUseID,
} from '../utils.js'
import {
  isCoordinatorMainThread,
  isCoordinatorMode,
} from 'src/coordinator/coordinatorMode.js'
import { SKILL_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'

/**
 * densable 2.1.222 #18 — koa + mvn disable_model_invocation message.
 * Tell Claude to ask the user to run /skill (or report to coordinator), and
 * never replicate the skill workflow by other means.
 */
export function formatDisableModelInvocationMessage(skillName: string): string {
  // densable koa(e)
  const askOrCoordinator = isCoordinatorMode()
    ? `It cannot be invoked via the ${SKILL_TOOL_NAME} tool. Report to the coordinator that this command is not available to workers.`
    : `Ask the user to run /${skillName} themselves — it cannot be invoked via the ${SKILL_TOOL_NAME} tool.`
  return `Skill ${skillName} cannot be used with ${SKILL_TOOL_NAME} tool due to disable-model-invocation. ${askOrCoordinator} Do not replicate this skill's workflow by other means — it is reserved for explicit user invocation.`
}
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

/**
 * Gets all commands including MCP skills/prompts from AppState.
 * SkillTool needs this because getCommands() only returns local/bundled skills.
 */
async function getAllCommands(
  deps: Pick<ToolDeps, 'getAppState'>,
): Promise<Command[]> {
  // Only include MCP skills (loadedFrom === 'mcp'), not plain MCP prompts.
  // Before this filter, the model could invoke MCP prompts via SkillTool
  // if it guessed the mcp__server__prompt name — they weren't discoverable
  // but were technically reachable.
  const mcpSkills = (deps.getAppState()?.mcp?.commands ?? []).filter(
    cmd => cmd.type === 'prompt' && cmd.loadedFrom === 'mcp',
  )
  if (mcpSkills.length === 0) return getCommands(getProjectRoot())
  const localCommands = await getCommands(getProjectRoot())
  return uniqBy([...localCommands, ...mcpSkills], 'name')
}

// Re-export Progress from centralized types to break import cycles
export type { SkillToolProgress as Progress } from 'src/types/tools.js'

import type { SkillToolProgress as Progress } from 'src/types/tools.js'

// Conditional require for remote skill modules — static imports here would
// pull in akiBackend.ts (via remoteSkillLoader → akiBackend), which has
// module-level memoize()/lazySchema() consts that survive tree-shaking as
// side-effecting initializers. All usages are inside
// feature('EXPERIMENTAL_SKILL_SEARCH') guards, so remoteSkillModules is
// non-null at every call site.
/* eslint-disable @typescript-eslint/no-require-imports */
const remoteSkillModules = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? {
      ...(require('src/services/skillSearch/remoteSkillState.js') as typeof import('src/services/skillSearch/remoteSkillState.js')),
      ...(require('src/services/skillSearch/remoteSkillLoader.js') as typeof import('src/services/skillSearch/remoteSkillLoader.js')),
      ...(require('src/services/skillSearch/telemetry.js') as typeof import('src/services/skillSearch/telemetry.js')),
      ...(require('src/services/skillSearch/featureCheck.js') as typeof import('src/services/skillSearch/featureCheck.js')),
    }
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const forkedSkillStackStorage = new AsyncLocalStorage<ReadonlySet<string>>()
const activeForkedSkillByAgentIdBySession = new RootSessionSlot<
  Map<string, ReadonlySet<string>>
>(() => new Map<string, ReadonlySet<string>>())

/**
 * Official 2.1.328 `H6(e)` (`chunk@294254613.js@1279876`) — canonical skill name
 * used for forked-skill recursion tracking.
 */
function getCanonicalSkillName(command: Command): string {
  return command.type === 'prompt' && command.unqualifiedName != null
    ? command.unqualifiedName
    : command.name
}

type ForkedSkillToolUseContext = ToolUseContext & {
  spawnedBySkill?: string
  spawnedByForkedSkill?: boolean
  options: ToolUseContext['options'] & {
    spawnedBySkill?: string
    spawnedByForkedSkill?: boolean
  }
}

/**
 * Returns the active stack of forked skill names executing in the current
 * async/subagent execution context (AsyncLocalStorage stack, active agentId map,
 * and explicit `spawnedBySkill` context fields).
 */
export function getActiveForkedSkillNames(
  context?: Partial<ToolUseContext>,
): Set<string> {
  const active = new Set<string>()
  const stored = forkedSkillStackStorage.getStore()
  if (stored) {
    for (const name of stored) active.add(name)
  }
  const agentIds = [context?.agentId, getAgentContext()?.agentId]
  const activeByAgent = activeForkedSkillByAgentIdBySession.peek(
    getBootstrapSession(),
  )
  for (const id of agentIds) {
    if (!id) continue
    const forAgent = activeByAgent?.get(id)
    if (forAgent) {
      for (const name of forAgent) active.add(name)
    }
  }
  const forkCtx = context as Partial<ForkedSkillToolUseContext> | undefined
  if (typeof forkCtx?.spawnedBySkill === 'string' && forkCtx.spawnedBySkill) {
    active.add(forkCtx.spawnedBySkill)
  }
  if (
    typeof forkCtx?.options?.spawnedBySkill === 'string' &&
    forkCtx.options.spawnedBySkill
  ) {
    active.add(forkCtx.options.spawnedBySkill)
  }
  return active
}

/**
 * Runs `fn` with `skillName` pushed onto the active forked-skill recursion
 * guard stack (propagates across async calls and nested subagents).
 */
export function runWithActiveForkedSkill<T>(skillName: string, fn: () => T): T {
  const next = new Set<string>(forkedSkillStackStorage.getStore())
  next.add(skillName)
  return forkedSkillStackStorage.run(next, fn)
}

/**
 * Official 2.1.328 `we(C, o)` (`chunk@303609827.js@13460`) + ancestor stack:
 * returns true when a forked skill subagent attempts to re-invoke itself (or an
 * active ancestor forked skill) via SkillTool.
 */
export function isForkedSkillRecursiveInvocation(
  command: Command,
  context: ToolUseContext,
): boolean {
  if (command.type !== 'prompt') return false
  const activeStack = getActiveForkedSkillNames(context)
  if (activeStack.size === 0) return false
  const forkCtx = context as ForkedSkillToolUseContext
  const inForkedSkill =
    forkCtx.spawnedByForkedSkill === true ||
    forkCtx.options?.spawnedByForkedSkill === true ||
    (forkedSkillStackStorage.getStore()?.size ?? 0) > 0 ||
    (activeForkedSkillByAgentIdBySession
      .peek(getBootstrapSession())
      ?.has(context.agentId ?? getAgentContext()?.agentId ?? '') ??
      false)
  const isForkSkill =
    command.context === 'fork' ||
    (command.getContext !== undefined && inForkedSkill)
  if (!isForkSkill) return false
  const canonical = getCanonicalSkillName(command)
  return activeStack.has(canonical) || activeStack.has(command.name)
}

/**
 * Official 2.1.328 reserved synced-skill namespace boundary helpers
 * (`xbt`, `Pbt`, `EQ`, `Epe`, `ERe`, `y_n`, `aZe`, `nVe`, `TSe`, `sgo`, `DVr`, `DCa`
 * in `chunk@284022131.js@6074`, `chunk@294252098.js@267`,
 * `chunk@294254613.js@1283413, @4037500-4040000`, `chunk@303609827.js@24200-25800`).
 */
export const RESERVED_SYNCED_SKILL_NAMESPACES = ['anthropic-skills'] as const
const SHA256_PINNED_SKILL_RULE_RE = /@sha256:[0-9a-f]{64}$/
const RESERVED_NS_INVISIBLE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g
const PLAID_HARBOR_FLAG = 'tengu_plaid_harbor'

/** Official 2.1.328 `nHr`: ESC, C1 controls (U+0080..U+009F), LF/VT/FF/CR/LS/PS. */
function hasReservedNsControlOrNewline(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      code === 0x1b ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x0a ||
      code === 0x0b ||
      code === 0x0c ||
      code === 0x0d ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return true
    }
  }
  return false
}

export function isSha256PinnedSkillRule(rule: string): boolean {
  return SHA256_PINNED_SKILL_RULE_RE.test(rule)
}

function isReservedNamespacePrefixed(lowerName: string): boolean {
  return RESERVED_SYNCED_SKILL_NAMESPACES.some(ns =>
    lowerName.startsWith(`${ns}:`),
  )
}

function normalizeForNamespacePrefix(name: string): string {
  return name
    .normalize('NFKC')
    .replace(RESERVED_NS_INVISIBLE_RE, '')
    .toLowerCase()
}

export function matchReservedSyncedSkillNamespace(
  name: string,
): string | undefined {
  const trimmed = name.trimEnd()
  const lower = trimmed.toLowerCase()
  for (const ns of RESERVED_SYNCED_SKILL_NAMESPACES) {
    if (lower === ns || lower.startsWith(`${ns}:`)) {
      return ns
    }
    const normalized = normalizeForNamespacePrefix(trimmed)
    if (normalized === ns || normalized.startsWith(`${ns}:`)) {
      return ns
    }
    if (hasReservedNsControlOrNewline(trimmed)) {
      let pos = 0
      let matched = true
      for (const ch of ns) {
        const nextIdx = normalized.indexOf(ch, pos)
        if (nextIdx === -1) {
          matched = false
          break
        }
        pos = nextIdx + 1
      }
      if (matched) return ns
    }
  }
  return undefined
}

export function isReservedSyncedSkillName(name: string): boolean {
  return matchReservedSyncedSkillNamespace(name) !== undefined
}

export function isAccountSyncedSkillCommand(
  command: Command | undefined,
): boolean {
  if (!command) return false
  if (command.loadedFrom === 'syncedSkills') return true
  if (
    command.type === 'prompt' &&
    command.source === 'plugin' &&
    command.pluginInfo !== undefined
  ) {
    const info = command.pluginInfo as { accountSkillsWrapper?: boolean }
    return info.accountSkillsWrapper === true
  }
  return false
}

function isReservedNamespaceGuardEnabled(): boolean {
  try {
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(PLAID_HARBOR_FLAG, true) !== false
    )
  } catch {
    return true
  }
}

function parseSkillRuleContent(ruleContent: string): {
  name: string
  prefix?: string
} {
  const normalized = ruleContent.startsWith('/')
    ? ruleContent.substring(1)
    : ruleContent
  if (normalized.endsWith(':*') || normalized.endsWith(' *')) {
    return { name: normalized, prefix: normalized.slice(0, -2) }
  }
  return { name: normalized }
}

function rawSkillRuleMatchesCandidate(
  ruleContent: string,
  candidate: string,
): boolean {
  const { name, prefix } = parseSkillRuleContent(ruleContent)
  return (
    name === candidate || (prefix !== undefined && candidate.startsWith(prefix))
  )
}

function boundarySafeSkillRuleMatchesCandidate(
  ruleContent: string,
  candidate: string,
): boolean {
  const { prefix } = parseSkillRuleContent(ruleContent)
  if (prefix === undefined) {
    return rawSkillRuleMatchesCandidate(ruleContent, candidate)
  }
  const lowerPrefix = prefix.toLowerCase()
  const isNsExact = (
    RESERVED_SYNCED_SKILL_NAMESPACES as readonly string[]
  ).includes(lowerPrefix)
  const isNsPrefixed = isReservedNamespacePrefixed(lowerPrefix)
  if (!isNsExact && !isNsPrefixed) {
    return (
      !isReservedNamespacePrefixed(candidate.toLowerCase()) &&
      rawSkillRuleMatchesCandidate(ruleContent, candidate)
    )
  }
  return (
    (!isNsExact && candidate === prefix) || candidate.startsWith(`${prefix}:`)
  )
}

export type SkillAllowRuleVerdict =
  | 'allow'
  | 'no-match'
  | 'held-back-nonholder'
  | 'held-back-boundary'

/**
 * Official 2.1.328 `DVr(rule, requestedName, commandObj)`
 * (`chunk@294254613.js@4038900`): evaluates an allow rule against a skill,
 * distinguishing normal allow/no-match from reserved-namespace holds
 * (`held-back-nonholder` and `held-back-boundary`).
 */
export function evaluateSkillAllowRule(
  ruleContent: string,
  commandName: string,
  commandObj: Command | undefined,
): SkillAllowRuleVerdict {
  const syncedAlias =
    commandObj?.type === 'prompt' &&
    commandObj.loadedFrom === 'syncedSkills' &&
    commandObj.unqualifiedName != null &&
    (commandObj.aliases?.includes(commandObj.unqualifiedName) ?? false)
      ? commandObj.unqualifiedName
      : undefined
  const candidates = [
    commandName,
    ...(commandObj !== undefined ? [commandObj.name] : []),
    ...(syncedAlias !== undefined ? [syncedAlias] : []),
  ]
  const rawMatched = candidates.some(c =>
    rawSkillRuleMatchesCandidate(ruleContent, c),
  )
  if (!isReservedNamespaceGuardEnabled()) {
    return rawMatched ? 'allow' : 'no-match'
  }
  const isHolder = isAccountSyncedSkillCommand(commandObj)
  const boundaryMatched = candidates.some(c =>
    boundarySafeSkillRuleMatchesCandidate(ruleContent, c),
  )
  if (
    candidates.some(
      c =>
        boundarySafeSkillRuleMatchesCandidate(ruleContent, c) &&
        (isHolder || !isReservedSyncedSkillName(c)),
    )
  ) {
    return 'allow'
  }
  if (!rawMatched) return 'no-match'
  return boundaryMatched ? 'held-back-nonholder' : 'held-back-boundary'
}

/**
 * Official 2.1.328 `DCa(rule, skillName, info)` (`chunk@294254613.js@4039200`):
 * formats the user-facing explanation when an allow rule is held back at a
 * reserved namespace boundary or for a nonholder skill.
 */
export function formatSkillAllowRuleHeldBackReason(
  ruleContent: string,
  skillName: string,
  info: { kind: 'nonholder'; pluginName?: string } | { kind: 'boundary' },
): string {
  const { prefix } = parseSkillRuleContent(ruleContent)
  const lowerPrefix = prefix?.toLowerCase()
  const ruleTargetsReserved =
    lowerPrefix !== undefined
      ? (RESERVED_SYNCED_SKILL_NAMESPACES as readonly string[]).includes(
          lowerPrefix,
        ) || isReservedNamespacePrefixed(lowerPrefix)
      : isReservedNamespacePrefixed(ruleContent.toLowerCase())
  const reservedNs = matchReservedSyncedSkillNamespace(skillName) ?? skillName
  const lead = ruleTargetsReserved
    ? `Skill(${ruleContent}) only covers skills synced from your claude.ai account.`
    : `Skill(${ruleContent}) does not cover "${reservedNs}:" names, which are reserved for skills synced from your claude.ai account.`
  if (info.kind === 'nonholder') {
    const origin =
      info.pluginName !== undefined
        ? `comes from the plugin "${info.pluginName}"`
        : 'is not synced'
    return `${lead} ${skillName} ${origin}, so no rule for that name can pre-approve it; it needs approval each time.`
  }
  if (
    lowerPrefix !== undefined &&
    (RESERVED_SYNCED_SKILL_NAMESPACES as readonly string[]).includes(
      lowerPrefix,
    )
  ) {
    return `Skill(${ruleContent}) only covers names starting with "${prefix}:". Add Skill(${skillName}) to allow ${skillName} without asking.`
  }
  if (ruleTargetsReserved) {
    return `Skill(${ruleContent}) only covers ${prefix} and names starting with "${prefix}:". Add Skill(${skillName}) to allow ${skillName} without asking.`
  }
  return `${lead} Add Skill(${skillName}) to allow ${skillName} without asking.`
}

/**
 * Executes a skill in a forked sub-agent context.
 * This runs the skill prompt in an isolated agent with its own token budget.
 */
async function executeForkedSkill(
  command: Command & { type: 'prompt' },
  commandName: string,
  args: string | undefined,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  parentMessage: AssistantMessage | undefined,
  onProgress?: ToolCallProgress<Progress>,
): Promise<ToolResult<Output>> {
  const startTime = Date.now()
  const agentId = createAgentId()
  const isBuiltIn = builtInCommandNames().has(commandName)
  const isOfficialSkill = isOfficialMarketplaceSkill(command)
  const isBundled = command.source === 'bundled'
  const forkedSanitizedName =
    isBuiltIn || isBundled || isOfficialSkill ? commandName : 'custom'

  const wasDiscoveredField =
    feature('EXPERIMENTAL_SKILL_SEARCH') &&
    remoteSkillModules!.isSkillSearchEnabled()
      ? {
          was_discovered:
            context.discoveredSkillNames?.has(commandName) ?? false,
        }
      : {}
  const pluginMarketplace = command.pluginInfo
    ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
    : undefined
  const queryDepth = context.queryTracking?.depth ?? 0
  const parentAgentId = getAgentContext()?.agentId
  logEvent('tengu_skill_tool_invocation', {
    command_name:
      forkedSanitizedName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    // _PROTO_skill_name routes to the privileged skill_name BQ column
    // (unredacted, all users); command_name stays in additional_metadata as
    // the redacted variant for general-access dashboards.
    _PROTO_skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    execution_context:
      'fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: (queryDepth > 0
      ? 'nested-skill'
      : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    query_depth: queryDepth,
    ...(parentAgentId && {
      parent_agent_id:
        parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...wasDiscoveredField,
    skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    skill_source:
      command.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(command.loadedFrom && {
      skill_loaded_from:
        command.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(command.kind && {
      skill_kind:
        command.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(command.pluginInfo && {
      // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns
      // (unredacted, all users); plugin_name/plugin_repository stay in
      // additional_metadata as redacted variants.
      _PROTO_plugin_name: command.pluginInfo.pluginManifest
        .name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(pluginMarketplace && {
        _PROTO_marketplace_name:
          pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      plugin_name: (isOfficialSkill
        ? command.pluginInfo.pluginManifest.name
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      plugin_repository: (isOfficialSkill
        ? command.pluginInfo.repository
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginCommandTelemetryFields(command.pluginInfo),
    }),
  })

  // #387 SEA Pgr: When invoked from a Workflow subagent
  // (spawnedByWorkflowRunId !== undefined), run synchronously so the result
  // delivers to the invoking agent rather than the main conversation.
  const spawnedByWorkflowRunId = (
    context as { spawnedByWorkflowRunId?: string }
  ).spawnedByWorkflowRunId
  const background =
    spawnedByWorkflowRunId === undefined && shouldBackgroundForkedSkill(command)
  const deferRules = background || spawnedByWorkflowRunId !== undefined
  const {
    modifiedGetAppState,
    baseAgent,
    promptMessages,
    skillContent,
    availableTools,
    webFetchReadmissionAllowed,
    contextLayers,
    recordInvocation,
    forkReadFileState,
  } = await prepareForkedCommandContext(command, args || '', context, {
    replaceCommandRules: deferRules,
    freezeCommandDenies: deferRules,
    deferInvocationRecording: deferRules,
  })
  const permissionLayers =
    contextLayers.length > 0
      ? [...(context.permissionLayers ?? []), ...contextLayers]
      : context.permissionLayers

  // Gold `J=e.getEffort?.(s||"",r)??e.getDefaultEffort?.(s||"",r)?.value??e.effort`
  const resolvedEffort = resolveSkillEffort(command, args || '', context)
  const agentDefinition =
    resolvedEffort !== undefined
      ? { ...baseAgent, effort: resolvedEffort }
      : baseAgent

  logForDebugging(
    `SkillTool executing forked skill ${commandName} with agent ${agentDefinition.agentType}`,
  )

  const canonicalSkillName = getCanonicalSkillName(command)
  const nextForkStack = new Set<string>(getActiveForkedSkillNames(context))
  nextForkStack.add(canonicalSkillName)
  const forkedChildContext: ForkedSkillToolUseContext = {
    ...context,
    getAppState: modifiedGetAppState,
    permissionLayers,
    spawnedBySkill: canonicalSkillName,
    spawnedByForkedSkill: true,
    options: {
      ...context.options,
      spawnedBySkill: canonicalSkillName,
      spawnedByForkedSkill: true,
    },
  }

  // densable 2.1.218: context:fork skills default to background (Cvo/wvo).
  // Opt out with frontmatter `background: false`. Returns immediately with
  // "Running in the background as @name"; findings arrive via task-notification.
  if (background) {
    const setAppState = context.setAppStateForTasks ?? context.setAppState
    try {
      const launched = await forkedSkillStackStorage.run(nextForkStack, () =>
        launchBackgroundForkedSkill({
          agentId,
          agentDefinition,
          command,
          description: `/${getCommandName(command)} ${args ?? ''}`.trim(),
          prompt: skillContent,
          promptMessages,
          context: forkedChildContext,
          canUseTool,
          getAppState: modifiedGetAppState,
          setAppState,
          availableTools,
          webFetchReadmissionAllowed,
          readFileState: forkReadFileState,
          recordInvocationOnSuccess: recordInvocation,
        }),
      )
      if (launched) {
        return {
          data: {
            success: true,
            commandName,
            status: 'forked',
            background: true,
            agentId,
            result: `Running in the background as @${launched.name}`,
          },
        }
      }
      // Official: live-duplicate → T() then fall through to sync
      recordInvocation()
    } catch (err) {
      recordInvocation()
      logError(err)
      // fall through to sync on unexpected launch failure
    }
  }

  // Collect messages from the forked agent
  const agentMessages: Message[] = []
  const activeForkedSkillByAgentId = activeForkedSkillByAgentIdBySession.of(
    getBootstrapSession(),
  )
  activeForkedSkillByAgentId.set(agentId, nextForkStack)

  try {
    // Run the sub-agent inside the active forked-skill recursion guard stack
    await forkedSkillStackStorage.run(nextForkStack, async () => {
      for await (const message of runAgent({
        agentDefinition,
        promptMessages,
        toolUseContext: forkedChildContext,
        canUseTool,
        isAsync: false,
        querySource: 'agent:custom',
        model: command.model as ModelAlias | undefined,
        availableTools,
        webFetchReadmissionAllowed,
        override: { agentId, readFileState: forkReadFileState },
      })) {
        if (isRunAgentSpinnerMode(message)) continue
        agentMessages.push(message)

        // Report progress for tool uses (like AgentTool does)
        if (
          (message.type === 'assistant' || message.type === 'user') &&
          onProgress
        ) {
          const normalizedNew = normalizeMessages([message])
          for (const m of normalizedNew) {
            const contentArray = m.message?.content
            const hasToolContent =
              Array.isArray(contentArray) &&
              contentArray.some(
                (c: { type: string }) =>
                  c.type === 'tool_use' || c.type === 'tool_result',
              )
            if (hasToolContent) {
              onProgress({
                toolUseID: `skill_${parentMessage?.message?.id ?? context.toolUseId ?? 'fork'}`,
                data: {
                  message: m,
                  type: 'skill_progress',
                  prompt: skillContent,
                  agentId,
                },
              })
            }
          }
        }
      }
    })

    const lastAssistant = [...agentMessages]
      .reverse()
      .find(m => m.type === 'assistant')
    let resultText = extractResultText(
      agentMessages,
      'Skill execution completed',
    )
    // 2.1.323 #2197: when safeguards stop a forked skill, instruct Claude to
    // retry with a narrower prompt or tell the user instead of doing the work itself.
    if (lastAssistant && isSubagentSafeguardsRefusal(lastAssistant)) {
      const guidance = formatSubagentSafeguardsGuidance(lastAssistant, true)
      resultText = resultText ? `${resultText}\n\n${guidance}` : guidance
    }
    if (spawnedByWorkflowRunId !== undefined) {
      recordInvocation()
    }
    // Release message memory after extracting result
    agentMessages.length = 0

    const durationMs = Date.now() - startTime
    logForDebugging(
      `SkillTool forked skill ${commandName} completed in ${durationMs}ms`,
    )

    return {
      data: {
        success: true,
        commandName,
        status: 'forked',
        agentId,
        result: resultText,
      },
    }
  } finally {
    activeForkedSkillByAgentId.delete(agentId)
    // Release skill content from invokedSkills state
    clearInvokedSkillsForAgent(agentId)
  }
}

export const inputSchema = lazySchema(() =>
  z.object({
    skill: z
      .string()
      .describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
    args: z.string().optional().describe('Optional arguments for the skill'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() => {
  // Output schema for inline skills (default)
  const inlineOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill is valid'),
    commandName: z.string().describe('The name of the skill'),
    allowedTools: z
      .array(z.string())
      .optional()
      .describe('Tools allowed by this skill'),
    model: z.string().optional().describe('Model override if specified'),
    status: z.literal('inline').optional().describe('Execution status'),
    readOnly: z
      .boolean()
      .optional()
      .describe('Coordinator main-thread read-only skill load'),
  })

  // Output schema for forked skills
  const forkedOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill completed successfully'),
    commandName: z.string().describe('The name of the skill'),
    status: z.literal('forked').describe('Execution status'),
    // densable 2.1.218: true when skill was launched as a background agent
    background: z
      .boolean()
      .optional()
      .describe('Whether the forked skill is running in the background'),
    agentId: z
      .string()
      .describe('The ID of the sub-agent that executed the skill'),
    result: z.string().describe('The result from the forked skill execution'),
  })

  return z.union([inlineOutputSchema, forkedOutputSchema])
})
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.input<OutputSchema>

async function executeSkillCall(
  { skill, args }: z.infer<InputSchema>,
  deps: ToolDeps,
  callCtx: ToolCallContext<Progress>,
): Promise<ToolResult<Output>> {
  // At this point, validateInput has already confirmed:
  // - Skill format is valid
  // - Skill exists
  // - Skill can be loaded
  // - Skill doesn't have disableModelInvocation
  // - Skill is a prompt-based skill
  const context = resolveToolUseContext(deps, callCtx)
  const canUseTool = callCtx.canUseTool ?? createDefaultCanUseTool()
  const parentMessage = callCtx.parentMessage
  const onProgress = callCtx.onProgress

  // Skills are just names, with optional arguments
  const trimmed = skill.trim()

  // Remove leading slash if present (for compatibility)
  const commandName = trimmed.startsWith('/') ? trimmed.substring(1) : trimmed

  // Remote canonical skill execution (ant-only experimental). Intercepts
  // `_canonical_<slug>` before local command lookup — loads SKILL.md from
  // AKI/GCS (with local cache), injects content directly as a user message.
  // Remote skills are declarative markdown so no slash-command expansion
  // (no !command substitution, no $ARGUMENTS interpolation) is needed.
  if (feature('EXPERIMENTAL_SKILL_SEARCH') && process.env.USER_TYPE === 'ant') {
    const slug = remoteSkillModules!.stripCanonicalPrefix(commandName)
    if (slug !== null) {
      return executeRemoteSkill(slug, commandName, parentMessage, context)
    }
  }

  // densable Skill call: save → set activeSkill → IQ → fork only when !IQ.
  const previousActiveSkill = context.options.activeSkill
  context.options.activeSkill = commandName
  const coordinatorMain = isCoordinatorMainThread(context.agentId)
  let dispatched = false
  try {
    const commands = await getAllCommands(deps)
    const command = findCommand(commandName, commands)
    if (command) {
      context.options.activeSkill =
        command.type === 'prompt' && command.unqualifiedName != null
          ? command.unqualifiedName
          : command.name
    }

    // Track skill usage for ranking (gold skips this on coordinator main)
    if (!coordinatorMain) {
      recordSkillUsage(commandName)
    }

    // Official 2.1.309 #1145 (`m0n`): before running `/verify` or `/code-review`,
    // discover nested package skills for shell-modified files in git status.
    if (command?.type === 'prompt' && command.unqualifiedName == null) {
      const { discoverNestedSkillsForChangedFiles, isVerifyOrReviewSkillName } =
        await import('src/skills/loadSkillsDir.js')
      if (isVerifyOrReviewSkillName(command.name)) {
        await discoverNestedSkillsForChangedFiles(getCwd()).catch(err => {
          logForDebugging(
            `[skills] Changed files not searched for nested skills: ${err}`,
          )
        })
      }
    }

    // densable `k_n(g,n||"",s)==="fork"&&!k`
    if (
      command?.type === 'prompt' &&
      resolveSkillExecutionContext(command, args || '', context) === 'fork' &&
      !coordinatorMain
    ) {
      try {
        return await executeForkedSkill(
          command,
          commandName,
          args,
          context,
          canUseTool,
          parentMessage,
          onProgress,
        )
      } finally {
        context.options.activeSkill = previousActiveSkill
      }
    }

    // Snapshot prior invoke content before processPromptSlashCommand records.
    const skillAgentId = getAgentContext()?.agentId ?? null
    const priorContent = getInvokedSkillsForAgent(skillAgentId).get(
      `${skillAgentId ?? ''}:${commandName}`,
    )?.content

    // Process the skill with optional args
    const { processPromptSlashCommand } = await import(
      'src/utils/processUserInput/processSlashCommand.js'
    )
    const processedCommand = await processPromptSlashCommand(
      commandName,
      args || '', // Pass args if provided
      commands,
      context,
      [],
      coordinatorMain,
    )

    if (!processedCommand.shouldQuery) {
      throw new Error('Command processing failed')
    }

    // Extract metadata from the command
    const allowedTools = coordinatorMain
      ? []
      : processedCommand.allowedTools || []
    const model = coordinatorMain ? undefined : processedCommand.model
    const effort = coordinatorMain ? undefined : processedCommand.effort

    const isBuiltIn = builtInCommandNames().has(commandName)
    const isBundled = command?.type === 'prompt' && command.source === 'bundled'
    const isOfficialSkill =
      command?.type === 'prompt' && isOfficialMarketplaceSkill(command)
    const sanitizedCommandName =
      isBuiltIn || isBundled || isOfficialSkill ? commandName : 'custom'

    const wasDiscoveredField =
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      remoteSkillModules!.isSkillSearchEnabled()
        ? {
            was_discovered:
              deps.discoveredSkillNames?.has(commandName) ?? false,
          }
        : {}
    const pluginMarketplace =
      command?.type === 'prompt' && command.pluginInfo
        ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
        : undefined
    const queryDepth = deps.queryTracking?.depth ?? 0
    const parentAgentId = getAgentContext()?.agentId
    logEvent('tengu_skill_tool_invocation', {
      command_name:
        sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      // _PROTO_skill_name routes to the privileged skill_name BQ column
      // (unredacted, all users); command_name stays in additional_metadata as
      // the redacted variant for general-access dashboards.
      _PROTO_skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      execution_context: (coordinatorMain
        ? 'read-only'
        : 'inline') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      invocation_trigger: (queryDepth > 0
        ? 'nested-skill'
        : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      query_depth: queryDepth,
      ...(parentAgentId && {
        parent_agent_id:
          parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...wasDiscoveredField,
      skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(command?.type === 'prompt' && {
        skill_source:
          command.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(command?.loadedFrom && {
        skill_loaded_from:
          command.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(command?.kind && {
        skill_kind:
          command.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(command?.type === 'prompt' &&
        command.pluginInfo && {
          _PROTO_plugin_name: command.pluginInfo.pluginManifest
            .name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          ...(pluginMarketplace && {
            _PROTO_marketplace_name:
              pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          }),
          plugin_name: (isOfficialSkill
            ? command.pluginInfo.pluginManifest.name
            : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          plugin_repository: (isOfficialSkill
            ? command.pluginInfo.repository
            : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...buildPluginCommandTelemetryFields(command.pluginInfo),
        }),
    })

    // Get the tool use ID from the parent message for linking newMessages
    const toolUseID =
      parentMessage !== undefined
        ? getToolUseIDFromParentMessage(parentMessage, SKILL_TOOL_NAME)
        : callCtx.toolUseId

    // Tag user messages with sourceToolUseID so they stay transient until this tool resolves
    const filteredMessages = processedCommand.messages.filter(
      (m): m is UserMessage | AttachmentMessage | SystemMessage => {
        if (m.type === 'progress') {
          return false
        }
        // Filter out command-message since SkillTool handles display
        if (m.type === 'user' && 'message' in m) {
          const content = m.message.content
          if (
            typeof content === 'string' &&
            content.includes(`<${COMMAND_MESSAGE_TAG}>`)
          ) {
            return false
          }
        }
        return true
      },
    )
    const renderedContent = getInvokedSkillsForAgent(skillAgentId).get(
      `${skillAgentId ?? ''}:${commandName}`,
    )?.content
    const newMessages = tagMessagesWithToolUseID(
      elideByteIdenticalSkillReinvocation({
        messages: filteredMessages,
        contextMessages: context.messages,
        commandName,
        args,
        priorContent,
        renderedContent,
      }),
      toolUseID,
    )

    logForDebugging(
      `SkillTool returning ${newMessages.length} newMessages for skill ${commandName}`,
    )

    // Note: addInvokedSkill and registerSkillHooks are called inside
    // processPromptSlashCommand (via getMessagesForPromptSlashCommand), so
    // calling them again here would double-register hooks and rebuild
    // skillContent redundantly.

    // Return success with newMessages and contextModifier
    dispatched = true
    return {
      data: {
        success: true,
        commandName,
        allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        model,
        ...(coordinatorMain && { readOnly: true }),
      },
      newMessages,
      contextModifier(ctx) {
        let modifiedContext = ctx
        const inlineLayers: HostPermissionLayer[] = []

        // Update allowed tools if specified
        if (allowedTools.length > 0) {
          inlineLayers.push({ kind: 'allowed_tools', allowedTools })
          // Capture the current getAppState to chain modifications properly
          const previousGetAppState = modifiedContext.getAppState
          modifiedContext = {
            ...modifiedContext,
            getAppState() {
              // Use the previous getAppState, not the closure's context.getAppState,
              // to properly chain context modifications
              const appState = previousGetAppState()
              return {
                ...appState,
                toolPermissionContext: {
                  ...appState.toolPermissionContext,
                  alwaysAllowRules: {
                    ...appState.toolPermissionContext.alwaysAllowRules,
                    command: [
                      ...new Set([
                        ...(appState.toolPermissionContext.alwaysAllowRules
                          .command || []),
                        ...allowedTools,
                      ]),
                    ],
                  },
                },
              }
            },
          }
        }

        // Carry [1m] suffix over — otherwise a skill with `model: opus` on an
        // opus[1m] session drops the effective window to 200K and trips autocompact.
        if (model) {
          const resolvedModel = resolveSkillModelOverride(
            model,
            ctx.options.mainLoopModel,
          )
          inlineLayers.push({ kind: 'model', mainLoopModel: resolvedModel })
          modifiedContext = {
            ...modifiedContext,
            options: {
              ...modifiedContext.options,
              mainLoopModel: resolvedModel,
            },
          }
        }

        // Override effort level if skill specifies one (densable 289: contextLayers + sessionEffort)
        if (effort !== undefined) {
          inlineLayers.push({ kind: 'effort', effort })
          const previousGetAppState = modifiedContext.getAppState
          modifiedContext = {
            ...modifiedContext,
            getAppState() {
              const appState = previousGetAppState()
              return {
                ...appState,
                sessionEffort: levelSessionEffort(effort),
              }
            },
          }
        }

        if (inlineLayers.length > 0) {
          modifiedContext = applyContextLayers(modifiedContext, inlineLayers)
        }

        return modifiedContext
      },
    }
  } finally {
    if (coordinatorMain || !dispatched) {
      context.options.activeSkill = previousActiveSkill
    }
  }
}

export const SkillTool = buildTool({
  name: SKILL_TOOL_NAME,
  searchHint: 'invoke a slash-command skill',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  description: async ({ skill }) => `Execute skill: ${skill}`,

  prompt: async (_options?: Parameters<Tool['prompt']>[0]) =>
    getPrompt(getProjectRoot()),

  // Only one skill/command should run at a time, since the tool expands the
  // command into a full prompt that Claude must process before continuing.
  // Skill-coach needs the skill name to avoid false-positive "you could have
  // used skill X" suggestions when X was actually invoked. Backseat classifies
  // downstream tool calls from the expanded prompt, not this wrapper, so the
  // name alone is sufficient — it just records that the skill fired.
  toAutoClassifierInput: ({ skill }) => skill ?? '',

  create(deps) {
    return {
      async validateInput({ skill }, callCtx): Promise<ValidationResult> {
        // Skills are just skill names, no arguments
        const trimmed = skill.trim()
        if (!trimmed) {
          return {
            result: false,
            message: `Invalid skill format: ${skill}`,
            errorCode: 1,
          }
        }

        // Remove leading slash if present (for compatibility)
        const hasLeadingSlash = trimmed.startsWith('/')
        if (hasLeadingSlash) {
          logEvent('tengu_skill_tool_slash_prefix', {})
        }
        const normalizedCommandName = hasLeadingSlash
          ? trimmed.substring(1)
          : trimmed

        // Remote canonical skill handling (ant-only experimental). Intercept
        // `_canonical_<slug>` names before local command lookup since remote
        // skills are not in the local command registry.
        // Official Dsd producer: when SYNC_SKILLS is on, start materialization
        // before the wait so concurrent SkillTool waits can race the load.
        if (
          feature('EXPERIMENTAL_SKILL_SEARCH') &&
          process.env.USER_TYPE === 'ant'
        ) {
          const slug = remoteSkillModules!.stripCanonicalPrefix(
            normalizedCommandName,
          )
          if (slug !== null) {
            const meta = remoteSkillModules!.getDiscoveredRemoteSkill(slug)
            if (!meta) {
              return {
                result: false,
                message: `Remote skill ${slug} was not discovered in this session. Use DiscoverSkills to find remote skills first.`,
                errorCode: 6,
              }
            }
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { isSyncSkillsEnabled } =
                require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { runSyncSkillMaterialization } =
                require('src/utils/syncSkillsMaterialization.js') as typeof import('src/utils/syncSkillsMaterialization.js')
              if (isSyncSkillsEnabled()) {
                void runSyncSkillMaterialization(
                  normalizedCommandName,
                  async () => {
                    try {
                      await remoteSkillModules!.loadRemoteSkill(slug, meta.url)
                      return { ok: true as const }
                    } catch (e) {
                      return {
                        ok: false as const,
                        reason: errorMessage(e),
                      }
                    }
                  },
                )
              }
            } catch {
              // densable optional
            }
            // Official Nit/gpo: wait for denser/producer materialization of this skill.
            const materialization = await waitForSyncSkillMaterialization(
              normalizedCommandName,
            )
            if (!materialization.ok) {
              logEvent('skill_invoke_not_materialized', {})
              return {
                result: false,
                message: formatSyncSkillNotMaterializedMessage(
                  normalizedCommandName,
                  materialization.reason,
                ),
                errorCode: 7,
              }
            }
            // Discovered remote skill — valid. Loading happens in call().
            return { result: true }
          }
        }

        // Official Nit/gpo: when SYNC_SKILLS is on, wait for denser materialization
        // of this skill name (if a producer registered a pending promise).
        const materialization = await waitForSyncSkillMaterialization(
          normalizedCommandName,
        )
        const materializationFailReason = materialization.ok
          ? undefined
          : materialization.reason

        // Get available commands (including MCP skills)
        const commands = await getAllCommands(deps)

        // Check if command exists
        const foundCommand = findCommand(normalizedCommandName, commands)
        // Official: materialization fail + (missing | incomplete) → not_materialized.
        if (materializationFailReason !== undefined && !foundCommand) {
          logEvent('skill_invoke_not_materialized', {})
          return {
            result: false,
            message: formatSyncSkillNotMaterializedMessage(
              normalizedCommandName,
              materializationFailReason,
            ),
            errorCode: 7,
          }
        }
        if (!foundCommand) {
          // densable Mv: strip spurious `anthropic-skills:` prefix and suggest listed name
          const stripped = normalizedCommandName.startsWith('anthropic-skills:')
            ? normalizedCommandName.slice('anthropic-skills:'.length)
            : normalizedCommandName
          const unprefixed =
            stripped !== normalizedCommandName
              ? findCommand(stripped, commands)
              : undefined
          if (
            unprefixed &&
            unprefixed.name === stripped &&
            unprefixed.type === 'prompt' &&
            !unprefixed.disableModelInvocation &&
            unprefixed.loadedFrom !== 'mcp'
          ) {
            logEvent('tengu_skill_tool_unprefixed_match', {})
            return {
              result: false,
              message: `Unknown skill: ${normalizedCommandName}. Did you mean ${unprefixed.name}?`,
              errorCode: 2,
            }
          }
          return {
            result: false,
            message: `Unknown skill: ${normalizedCommandName}`,
            errorCode: 2,
          }
        }

        const context = resolveToolUseContext(deps, callCtx)

        // Official 2.1.328 `we(C, o)` (`chunk@303609827.js@21600`):
        // prevent a forked skill subagent from recursively re-invoking itself or an
        // active ancestor forked skill via SkillTool.
        if (isForkedSkillRecursiveInvocation(foundCommand, context)) {
          logEvent('tengu_skill_tool_fork_recursion_blocked', {})
          return {
            result: false,
            message: `Skill ${normalizedCommandName} is already executing in this forked context — you are the subagent running it. Execute the instructions in the skill body directly instead of re-invoking the ${SKILL_TOOL_NAME} tool.`,
            errorCode: 9,
          }
        }

        // densable mvn: disableModelInvocation && !userTypedThisTurn
        // Skill tool validateInput is model-invoked (userTypedThisTurn=false).
        if (foundCommand.disableModelInvocation) {
          return {
            result: false,
            message: formatDisableModelInvocationMessage(normalizedCommandName),
            errorCode: 4,
          }
        }

        // Check if command is a prompt-based command
        if (foundCommand.type !== 'prompt') {
          return {
            result: false,
            message: `Skill ${normalizedCommandName} is not a prompt-based skill`,
            errorCode: 5,
          }
        }

        return { result: true }
      },

      async checkPermissions(
        { skill, args },
        callCtx,
      ): Promise<PermissionDecision> {
        // Skills are just skill names, no arguments
        const trimmed = skill.trim()

        // Remove leading slash if present (for compatibility)
        const commandName = trimmed.startsWith('/')
          ? trimmed.substring(1)
          : trimmed

        const permissionContext = deps.permissions()

        // Look up the command object to pass as metadata
        const commands = await getAllCommands(deps)
        const commandObj = findCommand(commandName, commands)

        // Helper function to check if a deny/ask rule matches the skill
        // Normalizes both inputs by stripping leading slashes for consistent matching
        const ruleMatches = (ruleContent: string): boolean => {
          if (rawSkillRuleMatchesCandidate(ruleContent, commandName)) {
            return true
          }
          if (
            commandObj &&
            rawSkillRuleMatchesCandidate(ruleContent, commandObj.name)
          ) {
            return true
          }
          return false
        }

        const isNonholderReservedName = (): boolean =>
          isReservedNamespaceGuardEnabled() &&
          isReservedSyncedSkillName(commandName) &&
          !isAccountSyncedSkillCommand(commandObj)

        // Check for deny rules
        const denyRules = getRuleByContentsForTool(
          permissionContext,
          SkillTool as Tool,
          'deny',
        )
        for (const [ruleContent, rule] of denyRules.entries()) {
          if (ruleMatches(ruleContent)) {
            return {
              behavior: 'deny',
              message: `Skill execution blocked by permission rules`,
              decisionReason: {
                type: 'rule',
                rule,
              },
            }
          }
        }

        // Remote canonical skills are ant-only experimental — auto-grant.
        // Placed AFTER the deny loop so a user-configured Skill(_canonical_:*)
        // deny rule is honored (same pattern as safe-properties auto-allow below).
        // The skill content itself is canonical/curated, not user-authored.
        if (
          feature('EXPERIMENTAL_SKILL_SEARCH') &&
          process.env.USER_TYPE === 'ant'
        ) {
          const slug = remoteSkillModules!.stripCanonicalPrefix(commandName)
          if (slug !== null) {
            return {
              behavior: 'allow',
              updatedInput: { skill, args },
              decisionReason: undefined,
            }
          }
        }

        // Check for explicit ask rules (official `chunk@303609827.js@25150`)
        const askRules = getRuleByContentsForTool(
          permissionContext,
          SkillTool as Tool,
          'ask',
        )
        for (const [ruleContent, rule] of askRules.entries()) {
          if (ruleMatches(ruleContent)) {
            const suppressAlwaysAllow =
              isNonholderReservedName() || isSha256PinnedSkillRule(commandName)
            return {
              behavior: 'ask',
              message: `Execute skill: ${commandName}`,
              decisionReason: {
                type: 'rule',
                rule,
              },
              ...(suppressAlwaysAllow ? { suppressAlwaysAllowRule: true } : {}),
              updatedInput: { skill, args },
              metadata: commandObj ? { command: commandObj } : undefined,
            }
          }
        }

        // Check for allow rules with official 2.1.328 reserved-namespace boundary
        // enforcement (`DVr` / `held-back-nonholder` / `held-back-boundary`).
        const allowRules = getRuleByContentsForTool(
          permissionContext,
          SkillTool as Tool,
          'allow',
        )
        let heldBack:
          | { rule: string; kind: 'nonholder' | 'boundary' }
          | undefined
        for (const [ruleContent, rule] of allowRules.entries()) {
          if (isSha256PinnedSkillRule(ruleContent)) continue
          const verdict = evaluateSkillAllowRule(
            ruleContent,
            commandName,
            commandObj,
          )
          if (verdict === 'allow') {
            return {
              behavior: 'allow',
              updatedInput: { skill, args },
              decisionReason: {
                type: 'rule',
                rule,
              },
            }
          }
          if (verdict === 'held-back-nonholder') {
            heldBack = { rule: ruleContent, kind: 'nonholder' }
          } else if (verdict === 'held-back-boundary') {
            heldBack ??= { rule: ruleContent, kind: 'boundary' }
          }
        }

        // Official 2.1.325 #2356: scheduled tasks and `/loop` MUST ask before
        // running a skill that declares `allowed-tools` or `hooks` unless an
        // explicit `Skill(name)` rule in `permissions.allow` matched above.
        const context = resolveToolUseContext(deps, callCtx)
        if (
          commandObj?.type === 'prompt' &&
          isScheduledOrLoopSkillExecution(context) &&
          skillDeclaresAllowedToolsOrHooks(commandObj)
        ) {
          return {
            behavior: 'ask',
            message: `Scheduled task or /loop wants to run skill "${commandName}", which declares allowed-tools or hooks. Add Skill(${commandName}) to permissions.allow to run it unattended.`,
            decisionReason: undefined,
            suggestions: [
              {
                type: 'addRules' as const,
                rules: [
                  {
                    toolName: SKILL_TOOL_NAME,
                    ruleContent: commandName,
                  },
                ],
                behavior: 'allow' as const,
                destination: 'localSettings' as const,
              },
            ],
            updatedInput: { skill, args },
            metadata: { command: commandObj },
          }
        }

        // Auto-allow skills that only use safe properties.
        // This is an allowlist: if a skill has any property NOT in this set with a
        // meaningful value, it requires permission. This ensures new properties added
        // in the future default to requiring permission.
        if (
          commandObj?.type === 'prompt' &&
          skillHasOnlySafeProperties(commandObj)
        ) {
          return {
            behavior: 'allow',
            updatedInput: { skill, args },
            decisionReason: undefined,
          }
        }

        const pluginName =
          commandObj?.type === 'prompt' && commandObj.source === 'plugin'
            ? commandObj.pluginInfo?.pluginManifest.name
            : undefined
        const isNonholder = isNonholderReservedName()
        const effectiveHeldBackKind =
          heldBack === undefined
            ? undefined
            : isNonholder
              ? 'nonholder'
              : heldBack.kind
        const heldBackMessage =
          heldBack === undefined || effectiveHeldBackKind === undefined
            ? undefined
            : formatSkillAllowRuleHeldBackReason(
                heldBack.rule,
                commandObj?.name ?? commandName,
                effectiveHeldBackKind === 'nonholder'
                  ? { kind: 'nonholder', pluginName }
                  : { kind: 'boundary' },
              )
        const decisionReason =
          heldBackMessage === undefined
            ? undefined
            : ({ type: 'other', reason: heldBackMessage } as const)

        // Official 2.1.328 `chunk@303609827.js@25680`: nonholder reserved-namespace
        // skills and `@sha256:` pinned skill invocations must ask every time with
        // `suppressAlwaysAllowRule: true` and no persistent allow-rule suggestions.
        if (isNonholder || isSha256PinnedSkillRule(commandName)) {
          return {
            behavior: 'ask',
            message: `Execute skill: ${commandName}${heldBackMessage ? ` — ${heldBackMessage}` : ''}`,
            decisionReason,
            suppressAlwaysAllowRule: true,
            updatedInput: { skill, args },
            metadata: commandObj ? { command: commandObj } : undefined,
          }
        }

        // Prepare suggestions for exact skill and prefix
        // Use normalized commandName (without leading slash) for consistent rules
        const suggestions = [
          // Exact skill suggestion
          {
            type: 'addRules' as const,
            rules: [
              {
                toolName: SKILL_TOOL_NAME,
                ruleContent: commandName,
              },
            ],
            behavior: 'allow' as const,
            destination: 'localSettings' as const,
          },
          // Prefix suggestion to allow any args
          {
            type: 'addRules' as const,
            rules: [
              {
                toolName: SKILL_TOOL_NAME,
                ruleContent: `${commandName}:*`,
              },
            ],
            behavior: 'allow' as const,
            destination: 'localSettings' as const,
          },
        ]

        // Default behavior: ask user for permission
        return {
          behavior: 'ask',
          message: `Execute skill: ${commandName}${heldBackMessage ? ` — ${heldBackMessage}` : ''}`,
          decisionReason,
          suggestions,
          updatedInput: { skill, args },
          metadata: commandObj ? { command: commandObj } : undefined,
        }
      },

      async call(input, callCtx): Promise<ToolResult<Output>> {
        return executeSkillCall(input, deps, callCtx)
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    result: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    // Handle forked skill result
    if ('status' in result && result.status === 'forked') {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content:
          'background' in result && result.background
            ? `Skill "${result.commandName}" launched (forked execution, running in the background).\n\n${result.result}`
            : `Skill "${result.commandName}" completed (forked execution).\n\nResult:\n${result.result}`,
      }
    }

    if ('readOnly' in result && result.readOnly) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `Loaded skill instructions (read-only): ${result.commandName}. Nothing was executed; delegate execution to a worker.`,
      }
    }

    // Inline skill result (default)
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: `Launching skill: ${result.commandName}`,
    }
  },

  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
} satisfies ToolDef<InputSchema, Output, Progress>)

// Allowlist of PromptCommand property keys that are safe and don't require permission.
// If a skill has any property NOT in this set with a meaningful value, it requires
// permission. This ensures new properties added to PromptCommand in the future
// default to requiring permission until explicitly reviewed and added here.
const SAFE_SKILL_PROPERTIES = new Set([
  // PromptCommand properties
  'type',
  'progressMessage',
  'contentLength',
  'contentHash',
  'skillFile',
  'argNames',
  'model',
  'effort',
  'source',
  'pluginInfo',
  'disableNonInteractive',
  'skillRoot',
  'context',
  'agent',
  'background',
  'getPromptForCommand',
  'getContext',
  'getEffort',
  'getDefaultEffort',
  'onUserTypedArgs',
  'formatForegroundForkResult',
  'frontmatterKeys',
  'declaredFields',
  'metadata',
  'createdBy',
  'fallback',
  'displayName',
  'unqualifiedName',
  'fromHostCatalog',
  // CommandBase properties
  'name',
  'description',
  'menuDescription',
  'listingDescription',
  'hasUserSpecifiedDescription',
  'isEnabled',
  'isHidden',
  'aliases',
  'subcommands',
  'subcommandsBareOnly',
  'isMcp',
  'argumentHint',
  'whenToUse',
  'paths',
  'version',
  'disableModelInvocation',
  'userInvocable',
  'loadedFrom',
  'immediate',
  'userFacingName',
  'getArgumentCompletions',
])

function skillHasOnlySafeProperties(command: Command): boolean {
  for (const key of Object.keys(command)) {
    if (SAFE_SKILL_PROPERTIES.has(key)) {
      continue
    }
    // Property not in safe allowlist - check if it has a meaningful value
    const value = (command as Record<string, unknown>)[key]
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value) && value.length === 0) {
      continue
    }
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue
    }
    return false
  }
  return true
}

/**
 * Official 2.1.325 #2356: returns true when a prompt skill declares non-empty
 * `allowed-tools` (`allowedTools`) or `hooks`.
 */
export function skillDeclaresAllowedToolsOrHooks(
  command: Partial<PromptCommand> | undefined,
): boolean {
  if (!command) return false
  if (Array.isArray(command.allowedTools) && command.allowedTools.length > 0) {
    return true
  }
  if (
    command.hooks &&
    typeof command.hooks === 'object' &&
    Object.keys(command.hooks).length > 0
  ) {
    return true
  }
  return false
}

/**
 * Official 2.1.325 #2356: detect whether the current turn is running inside a
 * scheduled task (cron) or `/loop` invocation.
 */
export function isScheduledOrLoopSkillExecution(
  context: Partial<ToolUseContext> | undefined,
): boolean {
  if (!context) return false
  const opts = context.options as
    | {
        isCron?: boolean
        isScheduledTask?: boolean
        isLoop?: boolean
        querySource?: string
      }
    | undefined
  if (
    opts?.isCron === true ||
    opts?.isScheduledTask === true ||
    opts?.isLoop === true
  ) {
    return true
  }
  if (
    typeof opts?.querySource === 'string' &&
    /(?:^|_)(?:cron|schedule|scheduled|loop)(?:$|_)/i.test(opts.querySource)
  ) {
    return true
  }
  try {
    const state = context.getAppState?.() as
      | {
          activeCronTaskId?: string
          isScheduledTurn?: boolean
          isLoopTurn?: boolean
        }
      | undefined
    if (
      state?.activeCronTaskId !== undefined ||
      state?.isScheduledTurn === true ||
      state?.isLoopTurn === true
    ) {
      return true
    }
  } catch {
    // ignore missing state
  }
  return false
}

function isOfficialMarketplaceSkill(command: PromptCommand): boolean {
  if (command.source !== 'plugin' || !command.pluginInfo?.repository) {
    return false
  }
  return isOfficialMarketplaceName(
    parsePluginIdentifier(command.pluginInfo.repository).marketplace,
  )
}

/**
 * Extract URL scheme for telemetry. Defaults to 'gs' for unrecognized schemes
 * since the AKI backend is the only production path and the loader throws on
 * unknown schemes before we reach telemetry anyway.
 */
function extractUrlScheme(url: string): 'gs' | 'http' | 'https' | 's3' {
  if (url.startsWith('gs://')) return 'gs'
  if (url.startsWith('https://')) return 'https'
  if (url.startsWith('http://')) return 'http'
  if (url.startsWith('s3://')) return 's3'
  return 'gs'
}

/**
 * Load a remote canonical skill and inject its SKILL.md content into the
 * conversation. Unlike local skills (which go through processPromptSlashCommand
 * for !command / $ARGUMENTS expansion), remote skills are declarative markdown
 * — we wrap the content directly in a user message.
 *
 * The skill is also registered with addInvokedSkill so it survives compaction
 * (same as local skills).
 *
 * Only called from within a feature('EXPERIMENTAL_SKILL_SEARCH') guard in
 * call() — remoteSkillModules is non-null here.
 */
async function executeRemoteSkill(
  slug: string,
  commandName: string,
  parentMessage: AssistantMessage | undefined,
  context: ToolUseContext,
): Promise<ToolResult<Output>> {
  const { getDiscoveredRemoteSkill, loadRemoteSkill, logRemoteSkillLoaded } =
    remoteSkillModules!

  // validateInput already confirmed this slug is in session state, but we
  // re-fetch here to get the URL. If it's somehow gone (e.g., state cleared
  // mid-session), fail with a clear error rather than crashing.
  const meta = getDiscoveredRemoteSkill(slug)
  if (!meta) {
    throw new Error(
      `Remote skill ${slug} was not discovered in this session. Use DiscoverSkills to find remote skills first.`,
    )
  }

  const urlScheme = extractUrlScheme(meta.url)
  let loadResult: Awaited<ReturnType<typeof loadRemoteSkill>> | undefined
  try {
    // Official Dsd producer shell — register waiter while loading so concurrent
    // SkillTool validate waits can race this materialization.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runSyncSkillMaterialization } =
      require('src/utils/syncSkillsMaterialization.js') as typeof import('src/utils/syncSkillsMaterialization.js')
    const mat = await runSyncSkillMaterialization(commandName, async () => {
      try {
        loadResult = await loadRemoteSkill(slug, meta.url)
        return { ok: true as const }
      } catch (e) {
        return {
          ok: false as const,
          reason: errorMessage(e),
        }
      }
    })
    if (!mat.ok || !loadResult) {
      throw new Error(
        mat.ok === false ? mat.reason : `Failed to load remote skill ${slug}`,
      )
    }
  } catch (e) {
    const msg = errorMessage(e)
    logRemoteSkillLoaded({
      slug,
      cacheHit: false,
      latencyMs: 0,
      urlScheme,
      error: msg,
    })
    throw new Error(`Failed to load remote skill ${slug}: ${msg}`)
  }

  const {
    cacheHit,
    latencyMs,
    skillPath,
    content,
    fileCount,
    totalBytes,
    fetchMethod,
  } = loadResult

  logRemoteSkillLoaded({
    slug,
    cacheHit,
    latencyMs,
    urlScheme,
    fileCount,
    totalBytes,
    fetchMethod,
  })

  // Remote skills are always model-discovered (never in static skill_listing),
  // so was_discovered is always true. is_remote lets BQ queries separate
  // remote from local invocations without joining on skill name prefixes.
  const queryDepth = context.queryTracking?.depth ?? 0
  const parentAgentId = getAgentContext()?.agentId
  logEvent('tengu_skill_tool_invocation', {
    command_name:
      'remote_skill' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    // _PROTO_skill_name routes to the privileged skill_name BQ column
    // (unredacted, all users); command_name stays in additional_metadata as
    // the redacted variant.
    _PROTO_skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    execution_context:
      'remote' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: (queryDepth > 0
      ? 'nested-skill'
      : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    query_depth: queryDepth,
    ...(parentAgentId && {
      parent_agent_id:
        parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    was_discovered: true,
    is_remote: true,
    remote_cache_hit: cacheHit,
    remote_load_latency_ms: latencyMs,
    skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    remote_slug:
      slug as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  recordSkillUsage(commandName)

  logForDebugging(
    `SkillTool loaded remote skill ${slug} (cacheHit=${cacheHit}, ${latencyMs}ms, ${content.length} chars)`,
  )

  // Strip YAML frontmatter (---\nname: x\n---) before prepending the header
  // (matches loadSkillsDir.ts:333). parseFrontmatter returns the original
  // content unchanged if no frontmatter is present.
  const { content: bodyContent } = parseFrontmatter(content, skillPath)

  // Inject base directory header + ${CLAUDE_SKILL_DIR}/${CLAUDE_SESSION_ID}
  // substitution (matches loadSkillsDir.ts) so the model can resolve relative
  // refs like ./schemas/foo.json against the cache dir.
  const skillDir = dirname(skillPath)
  const normalizedDir =
    process.platform === 'win32' ? skillDir.replace(/\\/g, '/') : skillDir
  let finalContent = `Base directory for this skill: ${normalizedDir}\n\n${bodyContent}`
  finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, normalizedDir)
  finalContent = finalContent.replace(
    /\$\{CLAUDE_SESSION_ID\}/g,
    getSessionId(),
  )

  // Register with compaction-preservation state. Use the cached file path so
  // post-compact restoration knows where the content came from. Must use
  // finalContent (not raw content) so the base directory header and
  // ${CLAUDE_SKILL_DIR} substitutions survive compaction — matches how local
  // skills store their already-transformed content via processSlashCommand.
  addInvokedSkill(
    commandName,
    skillPath,
    finalContent,
    getAgentContext()?.agentId ?? null,
  )

  // Direct injection — wrap SKILL.md content in a meta user message. Matches
  // the shape of what processPromptSlashCommand produces for simple skills.
  const toolUseID =
    parentMessage !== undefined
      ? getToolUseIDFromParentMessage(parentMessage, SKILL_TOOL_NAME)
      : context.toolUseId
  return {
    data: { success: true, commandName, status: 'inline' },
    newMessages: tagMessagesWithToolUseID(
      [createUserMessage({ content: finalContent, isMeta: true })],
      toolUseID,
    ),
  }
}
