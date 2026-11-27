import {
  getMainThreadAgentHooks,
  getRegisteredHooks,
} from '../../bootstrap/state.js'
import { isToolServerDaemonMode } from '../../services/mcp/sessionTunnel.js'
import type { AppState } from '../../state/AppState.js'
import { findToolByName, type Tool, type Tools } from '../../Tool.js'
import type { HookCallback, HookCallbackMatcher } from '../../types/hooks.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  getLegacyToolNames,
  normalizeLegacyToolName,
  permissionRuleValueFromString,
} from '../permissions/permissionRuleParser.js'
import { hasMatchingFunctionHook } from '../plugins/functionHooksModules.js'
import { ALLOWED_OFFICIAL_MARKETPLACE_NAMES } from '../plugins/schemas.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { getSettingsForSource } from '../settings/settings.js'
import type {
  HookCommand,
  HookMatcher,
  PluginHookMatcher,
  SkillHookMatcher,
} from '../settings/types.js'
import { DEFAULT_HOOK_SHELL } from '../shell/shellProvider.js'
import {
  areHookObjectsEqual,
  type FunctionHookMatcher,
  type IfConditionMatcher,
  isManagedEnabledPlugin,
  isManagedSettingsHook,
  type MatchedHook,
} from './hookCore.js'
import { shouldFailClosedHookInput } from './hookInputHelpers.js'
import {
  getHooksConfigFromSnapshot,
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooksConfigSnapshot.js'
import type { HookResult } from './hookTypes.js'
import { LOe } from './modelSwitchHooks.js'
import { getPluginHookRunner } from './pluginHookRunner.js'
import {
  type FunctionHook,
  getSessionFunctionHooks,
  getSessionHooks,
  type SessionDerivedHookMatcher,
} from './sessionHooks.js'
import { basename } from 'path'
import type { HookEvent, HookInput } from 'src/entrypoints/agentSdkTypes.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { getConnectorAliasesForMcpTool } from 'src/services/mcp/utils.js'

/**
 * Execute a command-based hook using bash or PowerShell.
 *
 * Shell resolution: hook.shell → 'bash'. PowerShell hooks spawn pwsh
 * with -NoProfile -NonInteractive -Command and skip bash-specific prep
 * (POSIX path conversion, .sh auto-prepend, CLAUDE_CODE_SHELL_PREFIX).
 * See docs/design/ps-shell-selection.md §5.1.
 */

const HOOK_EXACT_LIST_MATCHER_RE = /^[a-zA-Z0-9_|, -]+$/

/** Official GFy list separators when exact-list mode is active. */
const HOOK_EXACT_LIST_SPLIT_RE = /[|, ]+/

/**
 * Check if a match query matches a hook matcher pattern
 * @param matchQuery The query to match (e.g., 'Write', 'Edit', 'Bash')
 * @param matcher The matcher pattern - can be:
 *   - Simple string for exact match (e.g., 'Write')
 *   - Pipe/comma/space-separated list (e.g., 'Write|Edit', 'Write, Edit')
 *   - Regex pattern (e.g., '^Write.*', '.*', '^(Write|Edit)$')
 * @returns true if the query matches the pattern
 */
/** densable u0e — Pre/PostModelSwitch matcher strips trailing [1m]/[2m]. */
function stripModelSwitchMatcherSuffix(
  event: HookEvent,
  matcher: string,
): string {
  if (event !== 'PreModelSwitch' && event !== 'PostModelSwitch') {
    return matcher
  }
  const stripped = matcher.replace(/\[[12]m\](?=\s*(?:[|,]|$))/gi, '')
  return stripped.trim() === '' ? matcher : stripped
}

function matchesPattern(matchQuery: string, matcher: string): boolean {
  if (!matcher || matcher === '*') {
    return true
  }
  // Official 2.1.207: exact-list mode for tool-name matchers (expanded charset).
  // Hyphen is included so `mcp__server__tool-name` and `Edit, Write` stay exact.
  if (HOOK_EXACT_LIST_MATCHER_RE.test(matcher)) {
    const patterns = matcher
      .split(HOOK_EXACT_LIST_SPLIT_RE)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => normalizeLegacyToolName(p))
    if (patterns.includes(matchQuery)) {
      return true
    }
    return getLegacyToolNames(matchQuery).some(
      alias =>
        patterns.includes(alias) ||
        patterns.includes(normalizeLegacyToolName(alias)),
    )
  }

  // Otherwise treat as regex
  try {
    const regex = new RegExp(matcher)
    if (regex.test(matchQuery)) {
      return true
    }
    // Also test against legacy names so patterns like "^Task$" still match
    for (const legacyName of getLegacyToolNames(matchQuery)) {
      if (regex.test(legacyName)) {
        return true
      }
    }
    return false
  } catch {
    // If the regex is invalid, log error and return false
    logForDebugging(`Invalid regex pattern in hook matcher: ${matcher}`)
    return false
  }
}

/**
 * Official WFy/t2d (2.1.195): warn once when a tool-event matcher is an exact
 * server-only `mcp__server` token (no `__tool`). Exact matchers never match
 * real tools; users need `mcp__server__.*` (regex) for all tools from a server.
 */
const TOOL_HOOK_EVENTS_FOR_MCP_MATCHER_WARN = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
])

const warnedMcpServerOnlyMatchersByHost = new HostSlot<Set<string>>(
  () => new Set(),
)

function isMcpServerOnlyExactMatcherToken(token: string): boolean {
  return token.startsWith('mcp__') && !token.slice(5).includes('__')
}

function warnIfMcpServerOnlyExactMatcher(
  hookEvent: string,
  matcher: string | undefined,
): void {
  if (!matcher || !TOOL_HOOK_EVENTS_FOR_MCP_MATCHER_WARN.has(hookEvent)) {
    return
  }
  const warnedMcpServerOnlyMatchers = warnedMcpServerOnlyMatchersByHost.of(
    getBootstrapSessionHost(),
  )
  if (warnedMcpServerOnlyMatchers.has(matcher)) return
  if (!HOOK_EXACT_LIST_MATCHER_RE.test(matcher)) return
  const tokens = matcher
    .split(HOOK_EXACT_LIST_SPLIT_RE)
    .map(t => t.trim())
    .filter(Boolean)
  if (!tokens.some(isMcpServerOnlyExactMatcherToken)) return
  warnedMcpServerOnlyMatchers.add(matcher)
  const example = tokens.find(isMcpServerOnlyExactMatcherToken) ?? matcher
  logForDebugging(
    `Hook matcher \`${example}\` matches no tool (it is compared as an exact string). To match all tools from this server, use \`${example}__.*\`. See CHANGELOG v2.1.195.`,
    { level: 'warn' },
  )
}

/**
 * Official qho / qZt / rG / kBe / MJn / PI (#1386) — Monitor -> Bash PreToolUse
 * hook stand-in helpers.
 */
export function getMonitorCommand(toolInput: unknown): string | undefined {
  return typeof toolInput === 'object' &&
    toolInput !== null &&
    'command' in toolInput &&
    typeof (toolInput as { command?: unknown }).command === 'string' &&
    (toolInput as { command: string }).command !== ''
    ? (toolInput as { command: string }).command
    : undefined
}

export function extractBashLikeInputFromMonitor(
  toolInput: unknown,
): { command: string; description?: string } | undefined {
  const command = getMonitorCommand(toolInput)
  if (command === undefined) return undefined
  if (
    typeof toolInput === 'object' &&
    toolInput !== null &&
    'description' in toolInput &&
    typeof (toolInput as { description?: unknown }).description === 'string'
  ) {
    return {
      command,
      description: (toolInput as { description: string }).description,
    }
  }
  return { command }
}

export function getMonitorBashStandIn(
  toolName: string,
  toolInput: unknown,
): 'Bash' | undefined {
  return toolName === 'Monitor' && getMonitorCommand(toolInput) !== undefined
    ? 'Bash'
    : undefined
}

function getToolInputForHook(hookInput: HookInput): unknown {
  return (hookInput.hook_event_name === 'PreToolUse' ||
    hookInput.hook_event_name === 'PermissionRequest') &&
    'tool_input' in hookInput
    ? hookInput.tool_input
    : undefined
}

function isBuiltInArtifactStandInForHook(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): boolean {
  try {
    // Lazy require avoids a top-level circular dependency between hooks.ts and
    // permissions/permissions.ts (which imports executePermissionRequestHooks).
    const { standsInForBuiltInArtifactTool } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../permissions/permissions.js') as typeof import('../permissions/permissions.js')
    return standsInForBuiltInArtifactTool(tool)
  } catch {
    return false
  }
}

export function getHookFamilyNames(
  toolName: string,
  toolInput: unknown,
  mcpClients?: readonly MCPServerConnection[],
  tool?: Pick<Tool, 'name' | 'mcpInfo'>,
): string[] {
  const standIn = getMonitorBashStandIn(toolName, toolInput)
  const legacy = getLegacyToolNames(toolName)
  // Official 325 #1779: expand Desktop / terminal claude.ai connector aliases
  // for hook matchers (matched via throughFamilyOnly: deny/ask only, never allow).
  const connectorAliases = getConnectorAliasesForMcpTool(toolName, mcpClients)
  const out = [...legacy, ...connectorAliases]
  if (standIn !== undefined) out.push(standIn)
  // Official 2.1.325 #2313: cloud MCP Artifact stand-in tools also match
  // `Artifact` hooks (via throughFamilyOnly so deny/ask hooks apply).
  if (
    toolName !== 'Artifact' &&
    !out.includes('Artifact') &&
    isBuiltInArtifactStandInForHook(tool ?? { name: toolName })
  ) {
    out.push('Artifact')
  }
  return out
}

export function remapHookInputForMonitorAsBash(
  hookInput: HookInput,
): HookInput | undefined {
  if (!('tool_name' in hookInput) || !('tool_input' in hookInput)) {
    return undefined
  }
  const mappedName = getMonitorBashStandIn(
    String(hookInput.tool_name),
    getToolInputForHook(hookInput),
  )
  const mappedInput = extractBashLikeInputFromMonitor(hookInput.tool_input)
  if (mappedName === undefined || mappedInput === undefined) {
    return undefined
  }
  return {
    ...hookInput,
    tool_name: mappedName,
    tool_input: mappedInput,
  } as HookInput
}

export function enforceThroughFamilyOnlyHookResult(
  result: HookResult,
  matched: Pick<MatchedHook, 'throughFamilyOnly'> | undefined,
  hookEvent: HookEvent,
  hookLabel: string,
): void {
  if (matched?.throughFamilyOnly !== true) return
  result.classifierContext = undefined
  result.updatedInput = undefined
  if (result.permissionBehavior === 'allow') {
    logForDebugging(
      `Hook ${hookEvent} (${hookLabel}) permissionDecision=allow ignored: it matched this tool only through another of its names, which can deny or ask but not allow`,
    )
    result.permissionBehavior = undefined
  }
  if (result.permissionRequestResult?.behavior === 'allow') {
    logForDebugging(
      `Hook ${hookEvent} (${hookLabel}) PermissionRequest allow ignored: it matched this tool only through another of its names, which can deny or ask but not allow`,
    )
    result.permissionRequestResult = undefined
  }
}

export function remapHookInputForMatchedHook(
  matched: Pick<
    MatchedHook,
    'throughFamilyOnly' | 'matcherMetThroughOtherName'
  >,
  hookInput: HookInput,
): HookInput | undefined {
  const other =
    matched.throughFamilyOnly === true
      ? matched.matcherMetThroughOtherName
      : undefined
  if (other === undefined || !('tool_name' in hookInput)) return undefined
  if (
    other ===
    getMonitorBashStandIn(
      String(hookInput.tool_name),
      getToolInputForHook(hookInput),
    )
  ) {
    return remapHookInputForMonitorAsBash(hookInput)
  }
  return { ...hookInput, tool_name: other } as HookInput
}

/**
 * Prepare a matcher for hook `if` conditions. Expensive work (tool lookup,
 * Zod validation, tree-sitter parsing for Bash) happens once here; the
 * returned closure is called per hook. Returns undefined for non-tool events.
 */
async function prepareIfConditionMatcher(
  hookInput: HookInput,
  tools: Tools | undefined,
): Promise<IfConditionMatcher | undefined> {
  if (
    hookInput.hook_event_name !== 'PreToolUse' &&
    hookInput.hook_event_name !== 'PostToolUse' &&
    hookInput.hook_event_name !== 'PostToolUseFailure' &&
    hookInput.hook_event_name !== 'PermissionRequest' &&
    hookInput.hook_event_name !== 'PermissionDenied'
  ) {
    return undefined
  }

  const toolName = normalizeLegacyToolName(hookInput.tool_name as string)
  const tool = tools && findToolByName(tools, hookInput.tool_name as string)
  const input = tool?.inputSchema.safeParse(hookInput.tool_input)
  const patternMatcher =
    input?.success && tool?.preparePermissionMatcher
      ? await tool.preparePermissionMatcher(input.data)
      : undefined

  const hookToolInput = getToolInputForHook(hookInput)
  const familyNames = getHookFamilyNames(
    toolName,
    hookToolInput,
    undefined,
    tool,
  )
  let bashStandInPatternMatcher: ((ruleContent: string) => boolean) | undefined
  if (getMonitorBashStandIn(toolName, hookToolInput) === 'Bash' && tools) {
    const bashTool = findToolByName(tools, 'Bash')
    const bashLike = extractBashLikeInputFromMonitor(hookInput.tool_input)
    const bashParsed = bashLike
      ? bashTool?.inputSchema.safeParse(bashLike)
      : undefined
    if (bashParsed?.success && bashTool?.preparePermissionMatcher) {
      bashStandInPatternMatcher = await bashTool.preparePermissionMatcher(
        bashParsed.data,
      )
    }
  }

  return ifCondition => {
    const parsed = permissionRuleValueFromString(ifCondition)
    const parsedToolName = normalizeLegacyToolName(parsed.toolName)
    const isDirect = parsedToolName === toolName
    const isFamily = !isDirect && familyNames.includes(parsedToolName)
    if (!isDirect && !isFamily) {
      return false
    }
    if (!parsed.ruleContent) {
      return true
    }
    const activeMatcher =
      isFamily && parsedToolName === 'Bash' && bashStandInPatternMatcher
        ? bashStandInPatternMatcher
        : patternMatcher
    return activeMatcher ? activeMatcher(parsed.ruleContent) : false
  }
}

export function isSdkHostOwnAskCallback(
  hook: HookCommand | HookCallback | FunctionHook,
  matched: MatchedHook | undefined,
): boolean {
  return (
    hook.type === 'callback' &&
    matched?.sdkHost === true &&
    matched.hostOwnsStdin === true &&
    matched.deviceForwarded !== true &&
    matched.pluginId === undefined &&
    matched.pluginRoot === undefined &&
    matched.skillRoot === undefined
  )
}

/**
 * densable TVt — remap hook input tool_name via Jve()?.ownTool.
 * No runner → undefined (no-op). PostToolBatch remaps each tool_calls[].
 */
export function remapHookInputForOwnTool(
  hookInput: HookInput,
): { hookInput: HookInput; tools: Tools } | undefined {
  const ownTool = getPluginHookRunner()?.ownTool
  if (ownTool === undefined) return undefined
  if (hookInput.hook_event_name === 'PostToolBatch') {
    return {
      hookInput: {
        ...hookInput,
        tool_calls: hookInput.tool_calls.map(call => ({
          ...call,
          tool_name: ownTool(call.tool_name)?.name ?? call.tool_name,
        })),
      },
      tools: [],
    }
  }
  if (!('tool_name' in hookInput)) return undefined
  const mapped = ownTool(hookInput.tool_name)
  if (mapped === undefined) return undefined
  return {
    hookInput: {
      ...hookInput,
      tool_name: mapped.name,
      mcp_server: undefined,
    } as unknown as HookInput,
    tools: [mapped],
  }
}

function getHookMatchQuery(hookInput: HookInput): string | undefined {
  switch (hookInput.hook_event_name) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
    case 'PermissionDenied':
      return hookInput.tool_name as string
    case 'PostToolBatch':
      return undefined
    case 'UserPromptExpansion':
      return hookInput.command_name
    case 'SessionStart':
      return hookInput.source as string
    case 'Setup':
      return hookInput.trigger as string
    case 'PreCompact':
    case 'PostCompact':
      return hookInput.trigger as string
    case 'PreModelSwitch':
    case 'PostModelSwitch':
      return LOe(hookInput.to_model) ? hookInput.to_model : undefined
    case 'Notification':
      return hookInput.notification_type as string
    case 'SessionEnd':
      return hookInput.reason as string
    case 'StopFailure':
      return hookInput.error as string
    case 'SubagentStart':
      return hookInput.agent_type as string
    case 'SubagentStop':
      return hookInput.agent_type as string
    case 'TeammateIdle':
    case 'TaskCreated':
    case 'TaskCompleted':
      return undefined
    case 'Elicitation':
      return hookInput.mcp_server_name as string
    case 'ElicitationResult':
      return hookInput.mcp_server_name as string
    case 'ConfigChange':
      return hookInput.source as string
    case 'InstructionsLoaded':
      return hookInput.load_reason as string
    case 'FileChanged':
      return basename(hookInput.file_path as string)
    case 'DirectoryAdded':
      return (hookInput as { source?: string }).source
    default:
      return undefined
  }
}

export function isInternalHook(matched: MatchedHook): boolean {
  return matched.hook.type === 'callback' && matched.hook.internal === true
}

/**
 * Build a dedup key for a matched hook, namespaced by source context.
 *
 * Settings-file hooks (no pluginRoot/skillRoot) share the '' prefix so the
 * same command defined in user/project/local still collapses to one — the
 * original intent of the dedup. Plugin/skill hooks get their root as the
 * prefix, so two plugins sharing an unexpanded `${CLAUDE_PLUGIN_ROOT}/hook.sh`
 * template don't collapse: after expansion they point to different files.
 */
function hookDedupKey(m: MatchedHook, payload: string): string {
  return `${m.pluginRoot ?? m.skillRoot ?? ''}\0${payload}`
}

/**
 * Build a map of {sanitizedPluginName: hookCount} from matched hooks.
 * Only logs actual names for official marketplace plugins; others become 'third-party'.
 */
export function getPluginHookCounts(
  hooks: MatchedHook[],
): Record<string, number> | undefined {
  const pluginHooks = hooks.filter(h => h.pluginId)
  if (pluginHooks.length === 0) {
    return undefined
  }
  const counts: Record<string, number> = {}
  for (const h of pluginHooks) {
    const atIndex = h.pluginId!.lastIndexOf('@')
    const isOfficial =
      atIndex > 0 &&
      ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(h.pluginId!.slice(atIndex + 1))
    const key = isOfficial ? h.pluginId! : 'third-party'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/**
 * Build a map of {hookType: count} from matched hooks.
 */
export function getHookTypeCounts(
  hooks: MatchedHook[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const h of hooks) {
    counts[h.hook.type] = (counts[h.hook.type] || 0) + 1
  }
  return counts
}

function getHooksConfig(
  appState: AppState | undefined,
  sessionId: string,
  hookEvent: HookEvent,
  tiers?: { managedHooksOnly?: boolean; managedHooksExcluded?: boolean },
): Array<
  | HookMatcher
  | HookCallbackMatcher
  | FunctionHookMatcher
  | PluginHookMatcher
  | SkillHookMatcher
  | SessionDerivedHookMatcher
> {
  const isManagedPluginMatcher = (
    matcher:
      | HookMatcher
      | HookCallbackMatcher
      | FunctionHookMatcher
      | PluginHookMatcher
      | SkillHookMatcher
      | SessionDerivedHookMatcher,
  ): boolean =>
    'pluginRoot' in matcher &&
    isManagedEnabledPlugin(
      'pluginId' in matcher ? matcher.pluginId : undefined,
      'pluginName' in matcher ? matcher.pluginName : undefined,
    )

  const disableAllIncludingManaged = shouldDisableAllHooksIncludingManaged()
  const policyMatchers =
    getSettingsForSource('policySettings')?.hooks?.[hookEvent] ?? []
  const registeredHooks = getRegisteredHooks()?.[hookEvent]
  // Official 2.1.331 chunks #764 & #775: suppress settings/plugin hooks under
  // `claude mcp serve --transport http`.
  if (isToolServerDaemonMode()) {
    logForDebugging(
      `Skipping settings/plugin hooks for ${hookEvent}: claude mcp serve --transport http never runs them (intended)`,
    )
    if (tiers?.managedHooksOnly) {
      return []
    }
    return registeredHooks
      ? registeredHooks.filter(matcher => !('pluginRoot' in matcher))
      : []
  }
  if (tiers?.managedHooksOnly) {
    if (disableAllIncludingManaged) {
      return []
    }
    const managedPluginMatchers = registeredHooks
      ? registeredHooks.filter(isManagedPluginMatcher)
      : []
    return [...policyMatchers, ...managedPluginMatchers]
  }
  // Settings merging can clone source objects and reorder keys; compare
  // matcher/hook pairs with key-order-independent structural equality.
  const isPolicyHook = (
    matcherPattern: string | undefined,
    hook: HookCommand | HookCallback | FunctionHook,
  ): boolean =>
    policyMatchers.some(
      pm =>
        pm.matcher === matcherPattern &&
        pm.hooks.some(ph => areHookObjectsEqual(ph, hook)),
    )
  const hooks: Array<
    | HookMatcher
    | HookCallbackMatcher
    | FunctionHookMatcher
    | PluginHookMatcher
    | SkillHookMatcher
    | SessionDerivedHookMatcher
  > = disableAllIncludingManaged
    ? []
    : (getHooksConfigFromSnapshot()?.[hookEvent] ?? []).map(matcher => ({
        ...matcher,
        hooks: tiers?.managedHooksExcluded
          ? matcher.hooks.filter(hook => !isPolicyHook(matcher.matcher, hook))
          : matcher.hooks,
      }))

  // Policy filters configured sources; SDK callbacks remain host-controlled.
  const managedOnly =
    shouldAllowManagedHooksOnly() || disableAllIncludingManaged

  // Process registered hooks (SDK callbacks and plugin native hooks)
  if (registeredHooks) {
    for (const matcher of registeredHooks) {
      // Plugin hooks have pluginRoot set, SDK callbacks do not.
      if ('pluginRoot' in matcher) {
        const isManagedPlugin = isManagedPluginMatcher(matcher)
        // Managed-enabled plugin hooks run in the managedHooksOnly pass, so
        // exclude them from the managedHooksExcluded core pass.
        if (tiers?.managedHooksExcluded && isManagedPlugin) {
          continue
        }
        // When disableAllHooksIncludingManaged is set, skip all plugin hooks.
        // When allowManagedHooksOnly is set, keep managed-enabled plugin hooks
        // and skip non-managed plugin hooks.
        if (disableAllIncludingManaged || (managedOnly && !isManagedPlugin)) {
          continue
        }
      }
      hooks.push(matcher)
    }
  }

  // densable fne(): main-thread agent frontmatter hooks (QEt already trust-gated).
  // Only on main session path — subagents register via sessionHooks instead.
  if (!managedOnly) {
    const mainThreadHooks = getMainThreadAgentHooks()?.[hookEvent]
    if (mainThreadHooks) {
      for (const matcher of mainThreadHooks) {
        hooks.push(matcher)
      }
    }
  }

  // Merge session hooks for the current session only
  // Function hooks (like structured output enforcement) must be scoped to their session
  // to prevent hooks from one agent leaking to another (e.g., verification agent to main agent)
  // Skip session hooks entirely when allowManagedHooksOnly is set —
  // this prevents frontmatter hooks from agents/skills from bypassing the policy.
  // strictPluginOnlyCustomization does NOT block here — it gates at the
  // REGISTRATION sites (runAgent.ts:526 for agent frontmatter hooks) where
  // agentDefinition.source is known. A blanket block here would also kill
  // plugin-provided agents' frontmatter hooks, which is too broad.
  // Also skip if appState not provided (for backwards compatibility)
  if (!managedOnly && appState !== undefined) {
    const sessionHooks = getSessionHooks(appState, sessionId, hookEvent).get(
      hookEvent,
    )
    if (sessionHooks) {
      // SessionDerivedHookMatcher already includes optional skillRoot
      for (const matcher of sessionHooks) {
        hooks.push(matcher)
      }
    }

    // Merge session function hooks separately (can't be persisted to HookMatcher format)
    const sessionFunctionHooks = getSessionFunctionHooks(
      appState,
      sessionId,
      hookEvent,
    ).get(hookEvent)
    if (sessionFunctionHooks) {
      for (const matcher of sessionFunctionHooks) {
        hooks.push(matcher)
      }
    }
  }

  return hooks
}

/**
 * Lightweight existence check for hooks on a given event. Mirrors the sources
 * assembled by getHooksConfig() but stops at the first hit without building
 * the full merged config.
 *
 * Intentionally over-approximates: returns true if any matcher exists for the
 * event, even if managed-only filtering or pattern matching would later
 * discard it. A false positive just means we proceed to the full matching
 * path; a false negative would skip a hook, so we err on the side of true.
 *
 * Used to skip createBaseHookInput (getTranscriptPathForSession path joins)
 * and getMatchingHooks on hot paths where hooks are typically unconfigured.
 * See hasInstructionsLoadedHook / hasWorktreeCreateHook for the same pattern.
 */
/**
 * densable s3 — cheap presence check before hot-path createBaseHookInput.
 * Exported for MessageDisplay transform (wth) begin() gate.
 */
export function hasHookForEvent(
  hookEvent: HookEvent,
  appState: AppState | undefined,
  sessionId: string,
): boolean {
  if (isToolServerDaemonMode()) {
    const reg = getRegisteredHooks()?.[hookEvent]
    return Boolean(reg?.some(matcher => !('pluginRoot' in matcher)))
  }
  const snap = getHooksConfigFromSnapshot()?.[hookEvent]
  if (snap && snap.length > 0) return true
  const reg = getRegisteredHooks()?.[hookEvent]
  if (reg && reg.length > 0) return true
  // densable fne — main-thread agent hooks
  const mt = getMainThreadAgentHooks()?.[hookEvent]
  if (mt && mt.length > 0) return true
  if (appState?.sessionHooks.get(sessionId)?.hooks[hookEvent]) return true
  if (
    !shouldDisableAllHooksIncludingManaged() &&
    hasMatchingFunctionHook(hookEvent)
  ) {
    return true
  }
  return false
}

/**
 * Get hook commands that match the given query
 * @param appState The current app state (optional for backwards compatibility)
 * @param sessionId The current session ID (main session or agent ID)
 * @param hookEvent The hook event
 * @param hookInput The hook input for matching
 * @returns Array of matched hooks with optional plugin context
 */
export async function getMatchingHooks(
  appState: AppState | undefined,
  sessionId: string,
  hookEvent: HookEvent,
  hookInput: HookInput,
  tools?: Tools,
  tiers?: {
    managedHooksOnly?: boolean
    managedHooksExcluded?: boolean
    suppressTelemetry?: boolean
  },
): Promise<MatchedHook[]> {
  let loadedMatcherCount = 0
  try {
    const hookMatchers = getHooksConfig(appState, sessionId, hookEvent, tiers)
    loadedMatcherCount = hookMatchers.length

    // If you change the criteria below, then you must change
    // src/utils/hooks/hooksConfigManager.ts as well.
    // densable d0e: PostToolBatch has no single matchQuery — undefined
    // so every matcher fires (TKo `n===void 0` → true).
    const matchQuery = getHookMatchQuery(hookInput)
    const remapped = remapHookInputForOwnTool(hookInput)
    const runner = getPluginHookRunner()
    const remappedQuery = remapped
      ? getHookMatchQuery(remapped.hookInput)
      : undefined
    const matcherHits = (
      matcher: { matcher?: string },
      query: string | undefined,
    ): boolean =>
      !matcher.matcher ||
      query === undefined ||
      matchesPattern(
        query,
        stripModelSwitchMatcherSuffix(hookEvent, matcher.matcher),
      )
    const ownToolMatchers = new Set(
      remapped === undefined
        ? []
        : hookMatchers.filter(
            matcher =>
              'pluginId' in matcher &&
              runner?.holds?.((matcher as { pluginId: string }).pluginId) ===
                true &&
              matcherHits(matcher, remappedQuery),
          ),
    )

    logForDebugging(
      `Getting matching hook commands for ${hookEvent} with query: ${matchQuery}`,
      { level: 'verbose' },
    )
    logForDebugging(`Found ${hookMatchers.length} hook matchers in settings`, {
      level: 'verbose',
    })

    // Official 2.1.195: warn once on server-only exact mcp__ matchers for tool events.
    for (const matcher of hookMatchers) {
      warnIfMcpServerOnlyExactMatcher(hookEvent, matcher.matcher)
    }

    // Extract hooks with their plugin context (if any)
    const hookToolInput = getToolInputForHook(hookInput)
    const matchedTool =
      matchQuery !== undefined && tools
        ? findToolByName(tools, matchQuery)
        : undefined
    const familyNames =
      matchQuery !== undefined
        ? getHookFamilyNames(
            matchQuery,
            hookToolInput,
            appState?.mcp?.clients,
            matchedTool,
          )
        : []
    const matchedHooks: MatchedHook[] = hookMatchers.flatMap(matcher => {
      const asOwnTool = ownToolMatchers.has(matcher)
      const directHit = matcherHits(matcher, matchQuery)
      const familyHit =
        !directHit && matchQuery !== undefined
          ? familyNames.find(name => matcherHits(matcher, name))
          : undefined
      if (!asOwnTool && !directHit && familyHit === undefined) {
        return []
      }
      // Check if this is a PluginHookMatcher (has pluginRoot) or SkillHookMatcher (has skillRoot)
      const pluginRoot =
        'pluginRoot' in matcher ? matcher.pluginRoot : undefined
      const pluginId = 'pluginId' in matcher ? matcher.pluginId : undefined
      const pluginName =
        'pluginName' in matcher ? matcher.pluginName : undefined
      const skillRoot = 'skillRoot' in matcher ? matcher.skillRoot : undefined
      const hookSource = pluginRoot
        ? pluginName
          ? `plugin:${pluginName}`
          : 'plugin'
        : skillRoot
          ? 'skillName' in matcher
            ? `skill:${matcher.skillName}`
            : 'skill'
          : 'settings'
      return matcher.hooks.map(hook => {
        const isManagedHook =
          tiers?.managedHooksExcluded === true
            ? false
            : tiers?.managedHooksOnly === true ||
              isManagedSettingsHook(
                hook,
                hookEvent,
                pluginRoot,
                pluginId,
                skillRoot,
                pluginName,
              )
        return {
          hook,
          pluginRoot,
          pluginId,
          skillRoot,
          hookSource,
          isManagedHook,
          matcherIsMatchAll:
            !matcher.matcher ||
            matcher.matcher === '*' ||
            matcher.matcher === '.*',
          ...('projectRoot' in matcher &&
          typeof matcher.projectRoot === 'string' &&
          !('pluginRoot' in matcher) &&
          !('skillRoot' in matcher) &&
          !('deviceOwner' in matcher) &&
          !('origin' in matcher)
            ? { projectRoot: matcher.projectRoot }
            : {}),
          ...(asOwnTool && {
            asOwnTool: true,
            asStandIn: directHit,
          }),
          ...(familyHit !== undefined && {
            matcherMetThroughOtherName: familyHit,
            throughFamilyOnly: true,
          }),
          ...('sdkHost' in matcher &&
          (matcher as { sdkHost?: boolean }).sdkHost === true
            ? { sdkHost: true }
            : {}),
          ...('hostOwnsStdin' in matcher &&
          (matcher as { hostOwnsStdin?: boolean }).hostOwnsStdin === true
            ? { hostOwnsStdin: true }
            : {}),
          ...('deviceForwarded' in matcher &&
          (matcher as { deviceForwarded?: boolean }).deviceForwarded === true
            ? { deviceForwarded: true }
            : {}),
          ...('sessionServer' in matcher &&
          (matcher as { sessionServer?: boolean }).sessionServer === true
            ? { sessionServer: true }
            : {}),
        }
      })
    })

    // Deduplicate hooks by command/prompt/url within the same source context.
    // Key is namespaced by pluginRoot/skillRoot (see hookDedupKey above) so
    // cross-plugin template collisions don't drop hooks (gh-29724).
    //
    // Note: new Map(entries) keeps the LAST entry on key collision, not first.
    // For settings hooks this means the last-merged scope wins; for
    // same-plugin duplicates the pluginRoot is identical so it doesn't matter.
    // Fast-path: callback/function hooks don't need dedup (each is unique).
    // Skip the 6-pass filter + 4×Map + 4×Array.from below when all hooks are
    // callback/function — the common case for internal hooks like
    // sessionFileAccessHooks (44x faster in microbench).
    if (
      matchedHooks.every(
        m => m.hook.type === 'callback' || m.hook.type === 'function',
      )
    ) {
      return matchedHooks
    }

    // Helper to extract the `if` condition from a hook for dedup keys.
    // Hooks with different `if` conditions are distinct even if otherwise identical.
    const getIfCondition = (hook: { if?: string }): string => hook.if ?? ''

    const uniqueCommandHooks = Array.from(
      new Map(
        matchedHooks
          .filter(
            (
              m,
            ): m is MatchedHook & { hook: HookCommand & { type: 'command' } } =>
              m.hook.type === 'command',
          )
          // shell is part of identity: {command:'echo x', shell:'bash'}
          // and {command:'echo x', shell:'powershell'} are distinct hooks,
          // not duplicates. Default to 'bash' so legacy configs (no shell
          // field) still dedup against explicit shell:'bash'.
          .map(m => [
            hookDedupKey(
              m,
              `${m.hook.shell ?? DEFAULT_HOOK_SHELL}\0${m.hook.command}\0${JSON.stringify(m.hook.args ?? null)}\0${getIfCondition(m.hook)}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniquePromptHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'prompt')
          .map(m => [
            hookDedupKey(
              m,
              `${(m.hook as { prompt: string }).prompt}\0${getIfCondition(m.hook as { if?: string })}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniqueAgentHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'agent')
          .map(m => [
            hookDedupKey(
              m,
              `${(m.hook as { prompt: string }).prompt}\0${getIfCondition(m.hook as { if?: string })}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniqueHttpHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'http')
          .map(m => [
            hookDedupKey(
              m,
              `${(m.hook as { url: string }).url}\0${getIfCondition(m.hook as { if?: string })}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniqueMcpToolHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'mcp_tool')
          .map(m => {
            const hook = m.hook as HookCommand & {
              type: 'mcp_tool'
              server: string
              tool: string
              input?: unknown
              if?: string
            }
            return [
              hookDedupKey(
                m,
                `mcp_tool\0${hook.server}\0${hook.tool}\0${JSON.stringify(hook.input ?? {})}\0${getIfCondition(hook)}`,
              ),
              m,
            ] as const
          }),
      ).values(),
    )
    const callbackHooks = matchedHooks.filter(m => m.hook.type === 'callback')
    // Function hooks don't need deduplication - each callback is unique
    const functionHooks = matchedHooks.filter(m => m.hook.type === 'function')
    const uniqueHooks = [
      ...uniqueCommandHooks,
      ...uniquePromptHooks,
      ...uniqueAgentHooks,
      ...uniqueHttpHooks,
      ...uniqueMcpToolHooks,
      ...callbackHooks,
      ...functionHooks,
    ]

    // Filter hooks based on their `if` condition. This allows hooks to specify
    // conditions like "Bash(git *)" to only run for git commands, avoiding
    // process spawning overhead for non-matching commands.
    const hasIfCondition = uniqueHooks.some(
      h =>
        (h.hook.type === 'command' ||
          h.hook.type === 'prompt' ||
          h.hook.type === 'agent' ||
          h.hook.type === 'http' ||
          h.hook.type === 'mcp_tool') &&
        (h.hook as { if?: string }).if,
    )
    const ifMatcher = hasIfCondition
      ? await prepareIfConditionMatcher(hookInput, tools)
      : undefined
    const ifFilteredHooks = uniqueHooks.flatMap(h => {
      if (
        h.hook.type !== 'command' &&
        h.hook.type !== 'prompt' &&
        h.hook.type !== 'agent' &&
        h.hook.type !== 'http' &&
        h.hook.type !== 'mcp_tool'
      ) {
        return [h]
      }
      const ifCondition = (h.hook as { if?: string }).if
      if (!ifCondition) {
        return [h]
      }
      if (!ifMatcher) {
        logForDebugging(
          `Hook if condition "${ifCondition}" cannot be evaluated for non-tool event ${hookInput.hook_event_name}`,
        )
        return []
      }
      if (ifMatcher(ifCondition)) {
        const parsedToolName = normalizeLegacyToolName(
          permissionRuleValueFromString(ifCondition).toolName,
        )
        if (
          h.matcherMetThroughOtherName !== undefined &&
          matchQuery !== undefined &&
          parsedToolName === normalizeLegacyToolName(matchQuery) &&
          getMonitorBashStandIn(matchQuery, hookToolInput) !== undefined
        ) {
          logForDebugging(
            `Skipping hook: its if condition "${ifCondition}" names Monitor, and its matcher met the call only through Bash`,
          )
          return []
        }
        if (h.matcherMetThroughOtherName !== undefined) {
          return [h]
        }
        if (
          matchQuery !== undefined &&
          parsedToolName !== normalizeLegacyToolName(matchQuery) &&
          familyNames.includes(parsedToolName)
        ) {
          return [
            {
              ...h,
              throughFamilyOnly: true,
              matcherMetThroughOtherName: parsedToolName,
            },
          ]
        }
        return [h]
      }
      logForDebugging(
        `Skipping hook due to if condition "${ifCondition}" not matching`,
      )
      return []
    })

    // HTTP hooks are not supported for SessionStart/Setup events. In headless
    // mode the sandbox ask callback deadlocks because the structuredInput
    // consumer hasn't started yet when these hooks fire.
    const filteredHooks =
      hookEvent === 'SessionStart' || hookEvent === 'Setup'
        ? ifFilteredHooks.filter(h => {
            if (h.hook.type === 'http') {
              logForDebugging(
                `Skipping HTTP hook ${(h.hook as { url: string }).url} — HTTP hooks are not supported for ${hookEvent}`,
              )
              return false
            }
            return true
          })
        : ifFilteredHooks

    logForDebugging(
      `Matched ${filteredHooks.length} unique hooks for query "${matchQuery || 'no match query'}" (${matchedHooks.length} before deduplication)`,
      { level: 'verbose' },
    )
    return filteredHooks
  } catch (err) {
    // densable EVt + cK: matchers already loaded OR fail-closed event → rethrow
    // so executeHooks / executeHooksOutsideREPL enforce fail-closed denial.
    if (loadedMatcherCount > 0) {
      throw err
    }
    logForDebugging(
      `Failed to resolve matching hooks for ${hookEvent}: ${errorMessage(err)}`,
      { level: 'error' },
    )
    if (!tiers?.suppressTelemetry) {
      logEvent('tengu_feature_bad', {
        feature_name: hookTelemetryFeatureName(
          hookEvent,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'hook_match_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    if (shouldFailClosedHookInput(hookEvent)) {
      throw err
    }
    return []
  }
}

/** densable Lee — `hook_${snakeCase(event)}`. */
export function hookTelemetryFeatureName(event: string): string {
  return `hook_${event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`
}

export function getHookDefinitionsForTelemetry(
  matchedHooks: MatchedHook[],
): Array<{ type: string; command?: string; prompt?: string; name?: string }> {
  return matchedHooks.map(({ hook }) => {
    if (hook.type === 'command') {
      return { type: 'command', command: hook.command }
    } else if (hook.type === 'prompt') {
      return { type: 'prompt', prompt: hook.prompt }
    } else if (hook.type === 'http') {
      return { type: 'http', command: hook.url }
    } else if (hook.type === 'function') {
      return { type: 'function', name: 'function' }
    } else if (hook.type === 'callback') {
      return { type: 'callback', name: 'callback' }
    }
    return { type: 'unknown' }
  })
}
