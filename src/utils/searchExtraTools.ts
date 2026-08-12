/**
 * Tool Search utilities for dynamically discovering deferred tools.
 *
 * When enabled, deferred tools (densable TX opt-in: shouldDefer / MCP / special
 * cases) are sent with defer_loading: true and discovered via ToolSearch
 * (SearchExtraToolsTool) rather than being loaded upfront.
 */

import memoize from 'lodash-es/memoize.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { Tool } from '../Tool.js'
import {
  type ToolPermissionContext,
  type Tools,
  toolMatchesName,
} from '../Tool.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  formatDeferredToolLine,
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import type { Message } from '../types/message.js'
import {
  countToolDefinitionTokens,
  TOOL_TOKEN_COUNT_OVERHEAD,
} from './analyzeContext.js'
import { asStringArray } from './stringUtils.js'
import { count } from './array.js'
import { getMergedBetas } from './betas.js'
import { getContextWindowForModel } from './context.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { isFoundryCapabilitySupported } from './foundryCapabilities.js'
import { getCanonicalName } from './model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './model/providers.js'
import { jsonStringify } from './slowOperations.js'
import { zodToJsonSchema } from './zodToJsonSchema.js'

/**
 * densable `bL_` — default model substrings that lack tool_reference support.
 * Overridable via GrowthBook `tengu_tool_search_unsupported_models`.
 */
const DEFAULT_TOOL_SEARCH_UNSUPPORTED_MODELS = [
  'claude-3-5-haiku',
  'claude-3-haiku',
] as const

/**
 * densable `SL_` — Vertex serving stack only accepts tool-search beta on
 * Claude 4.5-generation and newer (changelog 2.1.221 #22).
 */
export const VERTEX_TOOL_SEARCH_MIN_VERSION = [
  ['opus', [4, 5]],
  ['sonnet', [4, 5]],
  ['haiku', [4, 5]],
] as const satisfies ReadonlyArray<readonly [string, readonly number[]]>

/**
 * densable `aEo` — whether model id meets min family version.
 * Model shape: `claude-{family}-{major}[-minor…]` (date suffixes already stripped).
 */
export function meetsMinClaudeVersion(
  modelId: string,
  minByFamily: ReadonlyArray<readonly [string, readonly number[]]>,
): boolean {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(modelId)
  const family = match?.[1]
  const versionPart = match?.[2]
  if (!family || !versionPart) return false
  const min = minByFamily.find(([name]) => name === family)?.[1]
  if (!min) return false
  const parts = versionPart.split('-').map(Number)
  for (let i = 0; i < Math.max(parts.length, min.length); i++) {
    const delta = (parts[i] ?? 0) - (min[i] ?? 0)
    if (delta !== 0) return delta > 0
  }
  return true
}

/**
 * densable `TL_` — unsupported-model denylist (GB override or `bL_`).
 */
export function getToolSearchUnsupportedModels(): string[] {
  try {
    const fromGb = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_tool_search_unsupported_models',
      null as string[] | null,
    )
    if (Array.isArray(fromGb)) {
      return fromGb.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    // fall through to default
  }
  return [...DEFAULT_TOOL_SEARCH_UNSUPPORTED_MODELS]
}

/**
 * densable `Xve` — model allows tool search (not on unsupported denylist).
 * SEA reason when false: `model_unsupported`.
 */
export function modelSupportsToolSearch(model: string): boolean {
  const lower = model.toLowerCase()
  for (const needle of getToolSearchUnsupportedModels()) {
    if (lower.includes(needle.toLowerCase())) return false
  }
  return true
}

/**
 * densable `Jve` — Vertex pre-4.5 generation rejects the tool-search beta header.
 * SEA reason when true: `vertex_model_unsupported`.
 *
 * ```
 * if (provider !== "vertex") return false
 * t = canonical(model).replace(/[@-]\d{8}$/, "")
 * if (/^claude-3(-|$)/.test(t)) return true
 * return /^claude-(opus|sonnet|haiku)-\d/.test(t) && !aEo(t, SL_)
 * ```
 */
export function isVertexToolSearchRejected(model: string): boolean {
  if (getAPIProvider() !== 'vertex') return false
  const t = getCanonicalName(model).replace(/[@-]\d{8}$/, '')
  if (/^claude-3(-|$)/.test(t)) return true
  return (
    /^claude-(opus|sonnet|haiku)-\d/.test(t) &&
    !meetsMinClaudeVersion(t, VERTEX_TOOL_SEARCH_MIN_VERSION)
  )
}

/**
 * densable `Y4() && Xve(model) && !Jve(model)` — optimistic + model gates used
 * by plugin activate/reload cache-impact (`swn`) and deferred-tool paths.
 */
export function isToolSearchEnabledForModel(model: string): boolean {
  return (
    isSearchExtraToolsEnabledOptimistic() &&
    modelSupportsToolSearch(model) &&
    !isVertexToolSearchRejected(model)
  )
}

/**
 * Default percentage of context window at which to auto-enable tool search.
 * When MCP tool descriptions exceed this percentage (in tokens), tool search is enabled.
 * Can be overridden via ENABLE_SEARCH_EXTRA_TOOLS / ENABLE_TOOL_SEARCH=auto:N (0-100).
 */
const DEFAULT_AUTO_SEARCH_EXTRA_TOOLS_PERCENTAGE = 10 // 10%

/**
 * densable Ion/Y4 read `ENABLE_TOOL_SEARCH`; local rename is
 * `ENABLE_SEARCH_EXTRA_TOOLS`. Prefer local name when defined (including empty);
 * else fall back to official densable name so managed env / changelog docs work.
 */
export function resolveToolSearchEnvValue(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.ENABLE_SEARCH_EXTRA_TOOLS !== undefined) {
    return env.ENABLE_SEARCH_EXTRA_TOOLS
  }
  return env.ENABLE_TOOL_SEARCH
}

/**
 * Parse auto:N syntax from tool-search env var.
 * Returns the percentage clamped to 0-100, or null if not auto:N format or not a number.
 */
function parseAutoPercentage(value: string): number | null {
  if (!value.startsWith('auto:')) return null

  const percentStr = value.slice(5)
  const percent = parseInt(percentStr, 10)

  if (isNaN(percent)) {
    logForDebugging(
      `Invalid tool-search env value "${value}": expected auto:N where N is a number.`,
    )
    return null
  }

  // Clamp to valid range
  return Math.max(0, Math.min(100, percent))
}

/**
 * Check if tool-search env is set to auto mode (auto or auto:N).
 */
function isAutoSearchExtraToolsMode(value: string | undefined): boolean {
  if (!value) return false
  return value === 'auto' || value.startsWith('auto:')
}

/**
 * Get the auto-enable percentage from env var or default.
 */
function getAutoSearchExtraToolsPercentage(): number {
  const value = resolveToolSearchEnvValue()
  if (!value) return DEFAULT_AUTO_SEARCH_EXTRA_TOOLS_PERCENTAGE

  if (value === 'auto') return DEFAULT_AUTO_SEARCH_EXTRA_TOOLS_PERCENTAGE

  const parsed = parseAutoPercentage(value)
  if (parsed !== null) return parsed

  return DEFAULT_AUTO_SEARCH_EXTRA_TOOLS_PERCENTAGE
}

/**
 * Approximate chars per token for MCP tool definitions (name + description + input schema).
 * Used as fallback when the token counting API is unavailable.
 */
const CHARS_PER_TOKEN = 2.5

/**
 * Get the token threshold for auto-enabling tool search for a given model.
 */
function getAutoSearchExtraToolsTokenThreshold(model: string): number {
  const betas = getMergedBetas(model)
  const contextWindow = getContextWindowForModel(model, betas)
  const percentage = getAutoSearchExtraToolsPercentage() / 100
  return Math.floor(contextWindow * percentage)
}

/**
 * Get the character threshold for auto-enabling tool search for a given model.
 * Used as fallback when the token counting API is unavailable.
 */
export function getAutoSearchExtraToolsCharThreshold(model: string): number {
  return Math.floor(
    getAutoSearchExtraToolsTokenThreshold(model) * CHARS_PER_TOKEN,
  )
}

/**
 * Get the total token count for all deferred tools using the token counting API.
 * Memoized by deferred tool names — cache is invalidated when MCP servers connect/disconnect.
 * Returns null if the API is unavailable (caller should fall back to char heuristic).
 */
const getDeferredToolTokenCount = memoize(
  async (
    tools: Tools,
    getToolPermissionContext: () => Promise<ToolPermissionContext>,
    agents: AgentDefinition[],
    model: string,
  ): Promise<number | null> => {
    const deferredTools = tools.filter(t => isDeferredTool(t))
    if (deferredTools.length === 0) return 0

    try {
      const total = await countToolDefinitionTokens(
        deferredTools,
        getToolPermissionContext,
        { activeAgents: agents, allAgents: agents },
        model,
      )
      if (total === 0) return null // API unavailable
      return Math.max(0, total - TOOL_TOKEN_COUNT_OVERHEAD)
    } catch {
      return null // Fall back to char heuristic
    }
  },
  (tools: Tools) =>
    tools
      .filter(t => isDeferredTool(t))
      .map(t => t.name)
      .join(','),
)

/**
 * Tool search mode. Determines how densable-TX deferred tools are surfaced:
 *   - 'tst': Tool Search Tool — deferred tools discovered via ToolSearch (always on when gates pass)
 *   - 'tst-auto': auto — tools deferred only when they exceed threshold
 *   - 'standard': tool search disabled — all tools exposed inline
 */
export type SearchExtraToolsMode = 'tst' | 'tst-auto' | 'standard'

/**
 * Determines the tool search mode from ENABLE_SEARCH_EXTRA_TOOLS or
 * densable ENABLE_TOOL_SEARCH (alias).
 *
 *   ENABLE_*_SEARCH    Mode
 *   auto / auto:1-99      tst-auto
 *   true / auto:0         tst
 *   false / auto:100      standard
 *   (unset)               tst (default: enable ToolSearch when other gates pass)
 */
export function getSearchExtraToolsMode(): SearchExtraToolsMode {
  // Official DISABLE_EXPERIMENTAL_BETAS densable still acts as a kill switch
  // for tool search, even though we no longer send beta headers.
  // Users who set this flag explicitly opt out of tool search.
  let experimentalBetasDisabled = isEnvTruthy(
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS,
  )
  try {
    const { isExperimentalBetasDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    experimentalBetasDisabled = isExperimentalBetasDisabled()
  } catch {
    // keep raw env fallback
  }
  if (experimentalBetasDisabled) {
    return 'standard'
  }

  // densable Ion: process.env.ENABLE_TOOL_SEARCH; local + alias via resolve
  const value = resolveToolSearchEnvValue()

  // Handle auto:N syntax - check edge cases first
  const autoPercent = value ? parseAutoPercentage(value) : null
  if (autoPercent === 0) return 'tst' // auto:0 = always enabled
  if (autoPercent === 100) return 'standard'
  if (isAutoSearchExtraToolsMode(value)) {
    return 'tst-auto' // auto or auto:1-99
  }

  if (isEnvTruthy(value)) return 'tst'
  if (isEnvDefinedFalsy(value)) return 'standard'
  return 'tst' // default: enable ToolSearch when other gates pass
}

/**
 * Check if tool search *might* be enabled (optimistic check).
 *
 * Returns true if tool search could potentially be enabled, without checking
 * dynamic factors like threshold. Use this for:
 * - Including SearchExtraToolsTool in base tools (so it's available if needed)
 * - Checking if SearchExtraToolsTool should report itself as enabled
 *
 * Returns false only when tool search is definitively disabled (standard mode).
 *
 * For the definitive check that includes threshold, use isSearchExtraToolsEnabled().
 */
let loggedOptimistic = false

export function isSearchExtraToolsEnabledOptimistic(): boolean {
  const mode = getSearchExtraToolsMode()
  const envValue = resolveToolSearchEnvValue()
  if (mode === 'standard') {
    if (!loggedOptimistic) {
      loggedOptimistic = true
      logForDebugging(
        `[SearchExtraTools:optimistic] mode=${mode}, toolSearchEnv=${envValue}, result=false`,
      )
    }
    return false
  }

  // densable Y4: default-on only on real first-party Anthropic hosts. Custom
  // ANTHROPIC_BASE_URL proxies must opt in via ENABLE_TOOL_SEARCH /
  // ENABLE_SEARCH_EXTRA_TOOLS=true (or auto / auto:N) — they may not forward
  // tool_reference / tool-search.
  if (
    !envValue &&
    getAPIProvider() === 'firstParty' &&
    !isFirstPartyAnthropicBaseUrl()
  ) {
    if (!loggedOptimistic) {
      loggedOptimistic = true
      logForDebugging(
        `[SearchExtraTools:optimistic] disabled: ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL} is not a first-party Anthropic host. Set ENABLE_TOOL_SEARCH=true or ENABLE_SEARCH_EXTRA_TOOLS=true (or auto / auto:N) if your proxy forwards tool_reference blocks.`,
      )
    }
    return false
  }

  if (!loggedOptimistic) {
    loggedOptimistic = true
    logForDebugging(
      `[SearchExtraTools:optimistic] mode=${mode}, toolSearchEnv=${envValue}, result=true`,
    )
  }
  return true
}

/**
 * Check if SearchExtraToolsTool is available in the provided tools list.
 * If SearchExtraToolsTool is not available (e.g., disallowed via disallowedTools),
 * tool search cannot function and should be disabled.
 *
 * @param tools Array of tools with a 'name' property
 * @returns true if SearchExtraToolsTool is in the tools list, false otherwise
 */
export function isSearchExtraToolsToolAvailable(
  tools: readonly { name: string }[],
): boolean {
  return tools.some(tool => toolMatchesName(tool, SEARCH_EXTRA_TOOLS_TOOL_NAME))
}

/**
 * Calculate total deferred tool description size in characters.
 * Includes name, description text, and input schema to match what's actually sent to the API.
 */
async function calculateDeferredToolDescriptionChars(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agents: AgentDefinition[],
): Promise<number> {
  const deferredTools = tools.filter(t => isDeferredTool(t))
  if (deferredTools.length === 0) return 0

  const sizes = await Promise.all(
    deferredTools.map(async tool => {
      const description = await tool.prompt({
        getToolPermissionContext,
        tools,
        agents,
      })
      const inputSchema = tool.inputJSONSchema
        ? jsonStringify(tool.inputJSONSchema)
        : tool.inputSchema
          ? jsonStringify(zodToJsonSchema(tool.inputSchema))
          : ''
      return tool.name.length + description.length + inputSchema.length
    }),
  )

  return sizes.reduce((total, size) => total + size, 0)
}

/**
 * Check if tool search (MCP tool deferral with tool_reference) is enabled for a specific request.
 *
 * This is the definitive check that includes:
 * - MCP mode (Tst, TstAuto, McpCli, Standard)
 * - Model compatibility (haiku doesn't support tool_reference)
 * - SearchExtraToolsTool availability (must be in tools list)
 * - Threshold check for TstAuto mode
 *
 * Use this when making actual API calls where all context is available.
 *
 * @param model The model being used (kept for API compatibility)
 * @param tools Array of available tools (including MCP tools)
 * @param getToolPermissionContext Function to get tool permission context
 * @param agents Array of agent definitions
 * @param source Optional identifier for the caller (for debugging)
 * @returns true if tool search should be enabled for this request
 */
export async function isSearchExtraToolsEnabled(
  model: string,
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agents: AgentDefinition[],
  source?: string,
): Promise<boolean> {
  const mcpToolCount = count(tools, t => t.isMcp)

  // Helper to log the mode decision event
  function logModeDecision(
    enabled: boolean,
    mode: SearchExtraToolsMode,
    reason: string,
    extraProps?: Record<string, number>,
  ): void {
    logEvent('tengu_search_extra_tools_mode_decision', {
      enabled,
      mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      // Log the actual model being checked, not the session's main model.
      // This is important for debugging subagent tool search decisions where
      // the subagent model (e.g., haiku) differs from the session model (e.g., opus).
      checkedModel:
        model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      mcpToolCount,
      userType: (process.env.USER_TYPE ??
        'external') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...extraProps,
    })
  }

  // densable Y4 first: optimistic/mode + first-party base-URL opt-in must hold
  // before DSn model/Vertex/Foundry gates. Otherwise proxy hosts without
  // ENABLE_SEARCH_EXTRA_TOOLS still enable tool_reference on the real path.
  if (!isSearchExtraToolsEnabledOptimistic()) {
    logForDebugging(
      `Tool search disabled${source ? ` (${source})` : ''}: optimistic/Y4 gate (mode=standard or non-first-party base URL without opt-in).`,
    )
    logModeDecision(false, getSearchExtraToolsMode(), 'optimistic_y4')
    return false
  }

  // densable DSn order: Xve → Jve → $Fe(tool_search_server|tool_search) →
  // Zbt(ToolSearch) → Ion mode.

  // densable Xve — model denylist (default claude-3-haiku family substrings).
  if (!modelSupportsToolSearch(model)) {
    logForDebugging(
      `Tool search disabled for model '${model}': model does not support tool_reference blocks. This feature is available on Claude Sonnet 4+, Opus 4+, Haiku 4.5+, and newer models.`,
    )
    logModeDecision(false, 'standard', 'model_unsupported')
    return false
  }

  // densable Jve — Vertex pre-4.5 serving stack rejects tool-search beta header.
  if (isVertexToolSearchRejected(model)) {
    logForDebugging(
      `Tool search disabled for model '${model}' on Vertex: this model's Vertex serving stack rejects the tool-search beta header (pre-4.5 generation).`,
    )
    logModeDecision(false, 'standard', 'vertex_model_unsupported')
    return false
  }

  // densable $Fe — Foundry deployment must support tool_search_server AND tool_search.
  // Empty capability map → default allow (no 400s learned yet).
  if (
    !isFoundryCapabilitySupported(model, 'tool_search_server') ||
    !isFoundryCapabilitySupported(model, 'tool_search')
  ) {
    logForDebugging(
      `Tool search disabled: Foundry deployment for '${model}' does not support tool search.`,
    )
    logModeDecision(false, 'standard', 'foundry_deployment_unsupported')
    return false
  }

  // Check if SearchExtraToolsTool is available (respects disallowedTools)
  if (!isSearchExtraToolsToolAvailable(tools)) {
    logForDebugging(
      `Tool search disabled: SearchExtraToolsTool is not available (may have been disallowed via disallowedTools).`,
    )
    logModeDecision(false, 'standard', 'mcp_search_unavailable')
    return false
  }

  const mode = getSearchExtraToolsMode()

  switch (mode) {
    case 'tst':
      logModeDecision(true, mode, 'tst_enabled')
      return true

    case 'tst-auto': {
      const { enabled, debugDescription, metrics } = await checkAutoThreshold(
        tools,
        getToolPermissionContext,
        agents,
        model,
      )

      if (enabled) {
        logForDebugging(
          `Auto tool search enabled: ${debugDescription}` +
            (source ? ` [source: ${source}]` : ''),
        )
        logModeDecision(true, mode, 'auto_above_threshold', metrics)
        return true
      }

      logForDebugging(
        `Auto tool search disabled: ${debugDescription}` +
          (source ? ` [source: ${source}]` : ''),
      )
      logModeDecision(false, mode, 'auto_below_threshold', metrics)
      return false
    }

    case 'standard':
      logModeDecision(false, mode, 'standard_mode')
      return false
  }
}

/**
 * densable `Osr` / `kco` — reserved stub so the API keeps deferred-tool
 * loading active when tool search is on. Never meant to be called by the model.
 */
export const DEFERRED_TOOL_PLACEHOLDER_NAME = 'DeferredToolPlaceholder'
const DEFERRED_TOOL_PLACEHOLDER_DESCRIPTION =
  'Reserved placeholder that keeps deferred tool loading active; never call this tool.'

/**
 * densable `dBp` — inject into tools array when tool search is enabled.
 * Gated by GrowthBook `tengu_deferred_stub_tool` (default true) and the
 * experimental-betas kill switch.
 */
export function getDeferredToolPlaceholderSchema(): {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, never> }
  defer_loading: true
} | null {
  try {
    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)) {
      return null
    }
    try {
      const { isExperimentalBetasDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      if (isExperimentalBetasDisabled()) return null
    } catch {
      // residual helpers optional
    }
    const fromGb = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_deferred_stub_tool',
      true,
    )
    if (!fromGb) return null
    return {
      name: DEFERRED_TOOL_PLACEHOLDER_NAME,
      description: DEFERRED_TOOL_PLACEHOLDER_DESCRIPTION,
      input_schema: { type: 'object', properties: {} },
      defer_loading: true,
    }
  } catch {
    return null
  }
}

/**
 * Check if an object is a tool_reference block.
 * tool_reference is a beta feature not in the SDK types, so we need runtime checks.
 */
export function isToolReferenceBlock(obj: unknown): boolean {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'tool_reference'
  )
}

/**
 * Type guard for tool_reference block with tool_name.
 */
function isToolReferenceWithName(
  obj: unknown,
): obj is { type: 'tool_reference'; tool_name: string } {
  return (
    isToolReferenceBlock(obj) &&
    'tool_name' in (obj as object) &&
    typeof (obj as { tool_name: unknown }).tool_name === 'string'
  )
}

/**
 * Type representing a tool_result block with array content.
 * Used for extracting tool_reference blocks from SearchExtraToolsTool results.
 */
type ToolResultBlock = {
  type: 'tool_result'
  content: unknown[]
}

/**
 * Type representing a tool_result block with string content.
 * Used for extracting tool names from SearchExtraToolsTool text output.
 */
type ToolResultBlockWithStringContent = {
  type: 'tool_result'
  content: string
}

/**
 * Type guard for tool_result blocks with array content.
 */
function isToolResultBlockWithContent(obj: unknown): obj is ToolResultBlock {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'tool_result' &&
    'content' in obj &&
    Array.isArray((obj as { content: unknown }).content)
  )
}

/**
 * Type guard for tool_result blocks with string content.
 */
function isToolResultBlockWithStringContent(
  obj: unknown,
): obj is ToolResultBlockWithStringContent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'tool_result' &&
    'content' in obj &&
    typeof (obj as { content: unknown }).content === 'string'
  )
}

/**
 * Regex to extract tool names from SearchExtraToolsTool text output.
 * Matches: "Found N deferred tool(s): ToolA, mcp.server.ToolB."
 * Uses multiline + end-of-line anchor so dots inside tool names (e.g. mcp__s__t) don't break parsing.
 */
const DISCOVERED_TOOLS_PATTERN = /^Found \d+ deferred tool\(s\): (.+)\.$/m

/**
 * Extract tool names from SearchExtraToolsTool text output.
 * Format: "Found N deferred tool(s): ToolA, ToolB.\n..."
 */
function extractToolNamesFromText(text: string): string[] {
  const match = DISCOVERED_TOOLS_PATTERN.exec(text)
  if (!match?.[1]) return []
  return match[1]
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
}

/**
 * densable `Lwe` — extract discovered deferred tool names from history.
 *
 * Primary (native): tool_reference blocks in tool_result content.
 * Also: compact boundary preCompactDiscoveredTools, and legacy text
 * "Found N deferred tool(s): …" for pre-native sessions.
 * Not: deferred_tools_delta (names announced ≠ schemas loaded).
 *
 * Discovered names are re-included in the API tools array (with defer_loading)
 * so the model can call them directly after ToolSearch.
 */
export function extractDiscoveredToolNames(messages: Message[]): Set<string> {
  const discoveredTools = new Set<string>()
  let carriedFromBoundary = 0

  for (const msg of messages) {
    // Compact boundary carries the pre-compact discovered set. Inline type
    // check rather than isCompactBoundaryMessage — utils/messages.ts imports
    // from this file, so importing back would be circular.
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      const carried = (msg as any).compactMetadata?.preCompactDiscoveredTools as
        | string[]
        | undefined
      if (carried) {
        for (const name of carried) discoveredTools.add(name)
        carriedFromBoundary += carried.length
      }
      continue
    }

    // densable Lwe does NOT treat deferred_tools_delta as discovered —
    // announcement ≠ schema loaded. Only tool_reference / compact carry
    // actually-fetched tools into the API tools array.

    // Only user messages contain tool_result blocks (responses to tool_use)
    if (msg.type !== 'user') continue

    const content = msg.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      // densable Lwe primary: tool_reference blocks
      if (isToolResultBlockWithContent(block)) {
        for (const item of block.content) {
          if (isToolReferenceWithName(item)) {
            discoveredTools.add(item.tool_name)
          }
        }
      }

      // Legacy self-built text path (pre-native sessions)
      if (isToolResultBlockWithStringContent(block)) {
        const names = extractToolNamesFromText(block.content)
        for (const name of names) {
          discoveredTools.add(name)
        }
      }
    }
  }

  if (discoveredTools.size > 0) {
    logForDebugging(
      `Dynamic tool loading: found ${discoveredTools.size} discovered tools in message history` +
        (carriedFromBoundary > 0
          ? ` (${carriedFromBoundary} carried from compact boundary)`
          : ''),
    )
  }

  return discoveredTools
}

/**
 * densable `CM` / `DEFERRED_DELTA_LIST_CAP` — long removed / MCP status lists
 * collapse past this many names in model-facing copy.
 */
export const DEFERRED_DELTA_LIST_CAP = 30

/**
 * densable `mln` — tool names that must never enter the announced/listed sets
 * when reconstructing prior deferred_tools_delta attachments (product-internal).
 */
const DEFERRED_DELTA_ANNOUNCE_BLACKLIST = new Set([
  'Frame',
  'FrameRead',
  'TeamCreate',
  'TeamDelete',
  'SuggestBackgroundPR',
  'AutofixPr',
])

export type DeferredFailedMcpServer = {
  name: string
  errorCode?: string
  error?: string
}

export type DeferredToolsDelta = {
  addedNames: string[]
  /**
   * Full description lines only for tools never listed before (densable `b`).
   * Re-announced tools after reconnect use readdedNames instead.
   */
  addedLines: string[]
  removedNames: string[]
  /** densable readdedNames — previously listed, removed, now deferred again. */
  readdedNames?: string[]
  /** densable pendingMcpServers — still-connecting server names (sorted). */
  pendingMcpServers?: string[]
  /** densable needsAuthMcpServers — needs-auth names (non-interactive only). */
  needsAuthMcpServers?: string[]
  /** densable failedMcpServers — failed connections for model surface. */
  failedMcpServers?: DeferredFailedMcpServer[]
}

/**
 * Call-site discriminator for the tengu_deferred_tools_pool_change event.
 * The scan runs from several sites with different expected-prior semantics
 * (inc-4747):
 *   - attachments_main: main-thread getAttachments → prior=0 is a BUG on fire-2+
 *   - attachments_subagent: subagent getAttachments → prior=0 is EXPECTED
 *     (fresh conversation, initialMessages has no DTD)
 *   - compact_full: compact.ts passes [] → prior=0 is EXPECTED
 *   - compact_partial: compact.ts passes messagesToKeep → depends on what survived
 *   - reactive_compact: reactiveCompact.ts passes preservedMessages → same
 * Without this the 96%-prior=0 stat is dominated by EXPECTED buckets and
 * the real main-thread cross-turn bug (if any) is invisible in BQ.
 */
export type DeferredToolsDeltaScanContext = {
  callSite:
    | 'attachments_main'
    | 'attachments_subagent'
    | 'compact_full'
    | 'compact_partial'
    | 'reactive_compact'
  querySource?: string
}

/**
 * True → announce deferred tools via persisted delta attachments.
 * False → claude.ts keeps its per-call <available-deferred-tools>
 * header prepend (the attachment does not fire).
 */
export function isDeferredToolsDeltaEnabled(): boolean {
  return true
}

/**
 * densable `L3o` / `summarizeByServerPrefix` — group mcp__server__* names for
 * long readded/removed lists: `mcp__foo__* (3), otherTool`.
 */
export function summarizeByServerPrefix(names: string[]): string {
  const counts = new Map<string, number>()
  for (const name of names) {
    const key = name.startsWith('mcp__')
      ? `${name.split('__', 2).join('__')}__*`
      : name
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, n]) => (n > 1 ? `${key} (${n})` : key))
    .join(', ')
}

/**
 * densable `NVs` — diff deferred-tool pool + MCP status vs prior DTD attachments.
 *
 * Tracks two sets from history:
 * - announced (`s`): currently announced names (added − removed)
 * - listed (`a`): names that received a full addedLines listing (not readded-only)
 *
 * Mid-turn MCP reconnect: tool reappears in deferred pool after remove →
 * `readdedNames` (no full schema lines). First-time mid-turn connect →
 * `addedNames` + `addedLines`. Pending / needs-auth / failed MCP lists are
 * optional args; only compared when the caller passes them (densable iCr).
 *
 * A name that was announced but has since stopped being deferred — yet is
 * still in the base pool — is NOT reported as removed (undefer silent).
 */
export function getDeferredToolsDelta(
  tools: Tools,
  messages: Message[],
  scanContext?: DeferredToolsDeltaScanContext,
  pendingMcpServers?: string[],
  needsAuthMcpServers?: string[],
  failedMcpServers?: DeferredFailedMcpServer[],
): DeferredToolsDelta | null {
  // densable s / a
  const announced = new Set<string>()
  const listed = new Set<string>()
  // last MCP status snapshots from most recent DTD that carried each field
  let lastPending: string[] = []
  let lastNeedsAuth: string[] = []
  let lastFailed: DeferredFailedMcpServer[] = []
  let attachmentCount = 0
  let dtdCount = 0
  const attachmentTypesSeen = new Set<string>()

  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    attachmentCount++
    attachmentTypesSeen.add(msg.attachment!.type)
    if (msg.attachment!.type !== 'deferred_tools_delta') continue
    dtdCount++
    const att = msg.attachment! as {
      addedLines?: unknown
      addedNames?: unknown
      removedNames?: unknown
      readdedNames?: unknown
      pendingMcpServers?: unknown
      needsAuthMcpServers?: unknown
      failedMcpServers?: unknown
    }
    // densable: readdedNames of this attachment — those names were announced
    // without a full listing, so they must not enter `listed` (a).
    const readdedInAtt = new Set(asStringArray(att.readdedNames))
    // densable A1s: pair addedNames only when addedLines is Array
    const addedNames = Array.isArray(att.addedLines)
      ? asStringArray(att.addedNames)
      : []
    for (const n of addedNames) {
      if (DEFERRED_DELTA_ANNOUNCE_BLACKLIST.has(n)) continue
      announced.add(n)
      if (!readdedInAtt.has(n)) listed.add(n)
    }
    for (const n of asStringArray(att.removedNames)) announced.delete(n)
    // densable does not drop from `listed` on remove — listed is permanent
    // for readded detection after reconnect.
    if (Array.isArray(att.pendingMcpServers)) {
      lastPending = asStringArray(att.pendingMcpServers)
    }
    if (Array.isArray(att.needsAuthMcpServers)) {
      lastNeedsAuth = asStringArray(att.needsAuthMcpServers)
    }
    if (Array.isArray(att.failedMcpServers)) {
      lastFailed = normalizeFailedMcpServers(att.failedMcpServers)
    }
  }

  const deferred: Tool[] = tools.filter(isDeferredTool)
  const deferredNames = new Set(deferred.map(t => t.name))
  const poolNames = new Set(tools.map(t => t.name))

  // densable _: deferred tools not currently announced
  const newlyAnnounced = deferred.filter(t => !announced.has(t.name))
  // densable b: deferred tools never fully listed (need addedLines)
  const unlisted = deferred.filter(t => !listed.has(t.name))
  // densable S: re-announced after prior full listing (in newlyAnnounced ∩ listed)
  const readdedNames = newlyAnnounced
    .filter(t => listed.has(t.name))
    .map(t => t.name)
  const removed: string[] = []
  for (const n of announced) {
    if (deferredNames.has(n)) continue
    if (!poolNames.has(n)) removed.push(n)
    // else: undeferred — silent
  }

  const pendingSorted =
    pendingMcpServers !== undefined ? [...pendingMcpServers].sort() : undefined
  const pendingChanged =
    pendingSorted !== undefined &&
    (pendingSorted.length !== lastPending.length ||
      pendingSorted.some((n, i) => n !== lastPending[i]))

  const needsAuthSorted =
    needsAuthMcpServers !== undefined
      ? [...needsAuthMcpServers].sort()
      : undefined
  const needsAuthChanged =
    needsAuthSorted !== undefined &&
    (needsAuthSorted.length !== lastNeedsAuth.length ||
      needsAuthSorted.some((n, i) => n !== lastNeedsAuth[i]))

  const failedSorted =
    failedMcpServers !== undefined
      ? [...failedMcpServers].sort((a, b) => a.name.localeCompare(b.name))
      : undefined
  const failedChanged =
    failedSorted !== undefined &&
    (failedSorted.length !== lastFailed.length ||
      failedSorted.some(
        (f, i) =>
          f.name !== lastFailed[i]?.name ||
          f.errorCode !== lastFailed[i]?.errorCode ||
          f.error !== lastFailed[i]?.error,
      ))

  if (
    newlyAnnounced.length === 0 &&
    removed.length === 0 &&
    unlisted.length === 0 &&
    !pendingChanged &&
    !needsAuthChanged &&
    !failedChanged
  ) {
    return null
  }

  // densable So([..._, ...b].map name) — unique addedNames for announce
  const addedNameSet = new Set<string>()
  for (const t of newlyAnnounced) addedNameSet.add(t.name)
  for (const t of unlisted) addedNameSet.add(t.name)
  const addedNames = [...addedNameSet].sort()

  logEvent('tengu_deferred_tools_pool_change', {
    addedCount: newlyAnnounced.length,
    readdedCount: readdedNames.length,
    unlistedCount: unlisted.length,
    removedCount: removed.length,
    pendingChanged: pendingChanged,
    pendingCount: pendingSorted?.length ?? 0,
    lastPendingCount: lastPending.length,
    needsAuthChanged: needsAuthChanged,
    needsAuthCount: needsAuthSorted?.length ?? 0,
    lastNeedsAuthCount: lastNeedsAuth.length,
    failedChanged: failedChanged,
    failedCount: failedSorted?.length ?? 0,
    lastFailedCount: lastFailed.length,
    priorAnnouncedCount: announced.size,
    messagesLength: messages.length,
    attachmentCount,
    dtdCount,
    callSite: (scanContext?.callSite ??
      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource: (scanContext?.querySource ??
      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    attachmentTypesSeen: [...attachmentTypesSeen]
      .sort()
      .join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return {
    addedNames,
    // densable: only unlisted (b) get full lines — readded skip schemas
    addedLines: unlisted.map(formatDeferredToolLine).sort(),
    removedNames: removed.sort(),
    readdedNames: readdedNames.sort(),
    ...(pendingSorted !== undefined && { pendingMcpServers: pendingSorted }),
    ...(needsAuthSorted !== undefined && {
      needsAuthMcpServers: needsAuthSorted,
    }),
    ...(failedSorted !== undefined && { failedMcpServers: failedSorted }),
  }
}

function normalizeFailedMcpServers(raw: unknown): DeferredFailedMcpServer[] {
  if (!Array.isArray(raw)) return []
  const out: DeferredFailedMcpServer[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    if (typeof rec.name !== 'string') continue
    const entry: DeferredFailedMcpServer = { name: rec.name }
    if (typeof rec.errorCode === 'string') entry.errorCode = rec.errorCode
    if (typeof rec.error === 'string') entry.error = rec.error
    out.push(entry)
  }
  return out
}

/**
 * densable `wdn` — map failed MCP clients to model-facing failedMcpServers,
 * dropping UNCONFIGURED and sanitizing name/error text.
 */
export function mapFailedMcpServersForDelta(
  mcpClients: ReadonlyArray<{
    type: string
    name: string
    error?: string
    errorCode?: string
    displayDetail?: string
  }>,
): DeferredFailedMcpServer[] {
  return mcpClients
    .filter(c => c.type === 'failed')
    .filter(c => c.errorCode !== 'UNCONFIGURED')
    .map(c => {
      const errorParts = [c.error, c.displayDetail].filter(
        (x): x is string => typeof x === 'string' && Boolean(x),
      )
      const entry: DeferredFailedMcpServer = {
        name: sanitizeDeferredMcpText(c.name),
      }
      if (c.errorCode !== undefined) {
        entry.errorCode = sanitizeDeferredMcpText(c.errorCode)
      }
      if (errorParts.length > 0) {
        entry.error = sanitizeDeferredMcpText(errorParts.join(' '))
      }
      return entry
    })
}

/** densable `d6` subset — strip quote/bracket chars, collapse space, cap. */
function sanitizeDeferredMcpText(raw: string): string {
  let t = raw
    .normalize('NFKC')
    .replaceAll(/[<>";‘’‚“”„«»‹›〈〉⟨⟩⟪⟫〈〉《》]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (t.length > 200) t = `${t.slice(0, 200)}…`
  return t
}

/**
 * densable policy-block errors (`zoy` / `Abr`) — failed MCP rows whose error
 * text is an admin block rather than a transport failure.
 */
export const MCP_POLICY_BLOCK_ERRORS = new Set([
  'Blocked by enterprise managed policy',
  'Disabled by disableClaudeAiConnectors setting',
])

export function isMcpPolicyBlockError(error: string | undefined): boolean {
  return error !== undefined && MCP_POLICY_BLOCK_ERRORS.has(error)
}

/** densable `LPo` — `name (code): "error"` for failed MCP list lines. */
export function formatFailedMcpServerLine(
  server: DeferredFailedMcpServer,
): string {
  const code = server.errorCode ? ` (${server.errorCode})` : ''
  const err = server.error ? `: "${server.error}"` : ''
  return `${server.name}${code}${err}`
}

/**
 * Check whether deferred tools exceed the auto-threshold for enabling TST.
 * Tries exact token count first; falls back to character-based heuristic.
 */
async function checkAutoThreshold(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agents: AgentDefinition[],
  model: string,
): Promise<{
  enabled: boolean
  debugDescription: string
  metrics: Record<string, number>
}> {
  // Try exact token count first (cached, one API call per toolset change)
  const deferredToolTokens = await getDeferredToolTokenCount(
    tools,
    getToolPermissionContext,
    agents,
    model,
  )

  if (deferredToolTokens !== null) {
    const threshold = getAutoSearchExtraToolsTokenThreshold(model)
    return {
      enabled: deferredToolTokens >= threshold,
      debugDescription:
        `${deferredToolTokens} tokens (threshold: ${threshold}, ` +
        `${getAutoSearchExtraToolsPercentage()}% of context)`,
      metrics: { deferredToolTokens, threshold },
    }
  }

  // Fallback: character-based heuristic when token API is unavailable
  const deferredToolDescriptionChars =
    await calculateDeferredToolDescriptionChars(
      tools,
      getToolPermissionContext,
      agents,
    )
  const charThreshold = getAutoSearchExtraToolsCharThreshold(model)
  return {
    enabled: deferredToolDescriptionChars >= charThreshold,
    debugDescription:
      `${deferredToolDescriptionChars} chars (threshold: ${charThreshold}, ` +
      `${getAutoSearchExtraToolsPercentage()}% of context) (char fallback)`,
    metrics: { deferredToolDescriptionChars, charThreshold },
  }
}
