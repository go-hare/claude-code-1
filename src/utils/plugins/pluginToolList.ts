/**
 * Official 2.1.323 #2188 (`QPe` / `_bt` / `rLs` / `tLs` / `eRo` / `ZAo` / `Lsr`):
 * Session-wide `tool.list` plugin hook state & filtering so tools added or
 * removed by `tool.list` hooks apply uniformly to the model and every agent.
 */

export type PluginToolListAnswer = {
  added: readonly string[]
  removed: ReadonlySet<string>
}

export type PluginToolListState = {
  answer: PluginToolListAnswer | null
  everAdded: Set<string>
  revision: number
  isInvalidated: boolean
  hookFailures: number
  pass: Promise<void> | undefined
}

const state: PluginToolListState = {
  answer: null,
  everAdded: new Set(),
  revision: 0,
  isInvalidated: false,
  hookFailures: 0,
  pass: undefined,
}

export function getPluginToolListState(): Readonly<PluginToolListState> {
  return state
}

export function resetPluginToolListState(): void {
  state.answer = null
  state.everAdded.clear()
  state.revision = 0
  state.isInvalidated = false
  state.hookFailures = 0
  state.pass = undefined
}

/** Mark `tool.list` state invalidated (called by `$.ui.invalidate("tool.list")`). */
export function invalidatePluginToolList(): void {
  state.isInvalidated = true
}

/** Record the diff produced by a `tool.list` hook pass. */
export function recordPluginToolListAnswer(
  baseToolNames: readonly string[],
  resultingToolNames: readonly string[],
): PluginToolListAnswer {
  const baseSet = new Set(baseToolNames)
  const resultSet = new Set(resultingToolNames)
  const added = resultingToolNames.filter(name => !baseSet.has(name))
  const removed = new Set(baseToolNames.filter(name => !resultSet.has(name)))
  for (const name of added) {
    state.everAdded.add(name)
  }
  state.answer = { added, removed }
  state.isInvalidated = false
  state.revision += 1
  return state.answer
}

export type ToolLike = {
  name: string
  underlyingV1ToolName?: string
  familyParentToolName?: string
  mcpInfo?: { serverName: string; toolName: string }
  isPluginTool?: boolean
}

/**
 * Official `QPe`: true when a `tool.list` plugin hook removed this tool from
 * the current session.
 */
export function isToolRemovedByPlugin(tool: ToolLike): boolean {
  const removed = state.answer?.removed
  if (removed === undefined || removed.size === 0) return false
  if (removed.has(tool.name)) return true
  if (
    tool.underlyingV1ToolName !== undefined &&
    removed.has(tool.underlyingV1ToolName)
  ) {
    return true
  }
  if (
    tool.familyParentToolName !== undefined &&
    removed.has(tool.familyParentToolName)
  ) {
    return true
  }
  if (tool.mcpInfo !== undefined) {
    const qualified = `mcp__${tool.mcpInfo.serverName}__${tool.mcpInfo.toolName}`
    if (removed.has(qualified) || removed.has(tool.mcpInfo.toolName)) {
      return true
    }
  }
  return false
}

/**
 * Official `_bt`: filter any tool list (model pool or subagent tool pool) so
 * tools removed by `tool.list` hooks are excluded everywhere.
 */
export function applyPluginToolListFilter<T extends ToolLike>(
  tools: readonly T[],
): T[] {
  const removed = state.answer?.removed
  if (
    (removed === undefined || removed.size === 0) &&
    state.everAdded.size === 0
  ) {
    return tools as T[]
  }
  const filtered = tools.filter(tool => !isToolRemovedByPlugin(tool))
  return filtered.length === tools.length ? (tools as T[]) : filtered
}

/**
 * Official `eRo`: append plugin-removed tool names into `alwaysDenyRules.session`
 * so permission checks and subagents enforce the removal consistently.
 */
export function applyPluginToolListDenyRules<
  T extends { alwaysDenyRules?: { session?: readonly string[] } },
>(permissionContext: T): T {
  const removed = state.answer?.removed
  if (removed === undefined || removed.size === 0) {
    return permissionContext
  }
  const existing = permissionContext.alwaysDenyRules?.session ?? []
  const merged = [...existing]
  for (const name of removed) {
    if (!merged.includes(name)) merged.push(name)
  }
  return {
    ...permissionContext,
    alwaysDenyRules: {
      ...permissionContext.alwaysDenyRules,
      session: merged,
    },
  }
}

/**
 * Official `tLs`: check whether an MCP tool was removed by a `tool.list` hook
 * before invoking it.
 */
export function checkMcpToolRemovedByPlugin(
  serverName: string,
  toolName: string,
  opts?: { sdkNoPrefix?: boolean },
): string | undefined {
  const qualified = `mcp__${serverName}__${toolName}`
  const removed =
    isToolRemovedByPlugin({ name: qualified }) ||
    (opts?.sdkNoPrefix === true &&
      isToolRemovedByPlugin({
        name: toolName,
        mcpInfo: { serverName, toolName },
      }))
  if (!removed) return undefined
  return `A plugin removed ${qualified} from this session, so it can't be called.`
}

/**
 * Run a `tool.list` settlement pass via the supplied hook runner and update the
 * session toolList state.
 */
export async function settlePluginToolList(
  baseToolNames: readonly string[],
  runHook: (base: readonly string[]) => Promise<readonly string[] | undefined>,
): Promise<PluginToolListAnswer> {
  const work = (async () => {
    try {
      const nextNames = await runHook(baseToolNames)
      recordPluginToolListAnswer(baseToolNames, nextNames ?? baseToolNames)
    } catch {
      state.hookFailures += 1
    } finally {
      state.pass = undefined
    }
  })()
  state.pass = work
  await work
  return state.answer ?? { added: [], removed: new Set() }
}
