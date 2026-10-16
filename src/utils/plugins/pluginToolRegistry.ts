/**
 * densable 2.1.289 Xj bag for `$.tool.register`.
 *
 * Semantic exports only — never export minify Xj|KLo|te.
 */
import { isDeepStrictEqual } from 'util'

export type PluginRegisteredToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type PluginBag = {
  tools: Map<string, PluginRegisteredToolSpec>
  serverKey?: string
}

const bags = new Map<string, PluginBag>()
const mintedServerKeys = new Set<string>()
/**
 * densable: after Xj.forget + removeMcpServer, host.mcpServers() may still
 * list the old name briefly (async print remove, or REPL mcp.clients lag).
 * Keys here skip densable r_o so the same plugin can remount / replace.
 */
const pendingPluginToolServerRemovals = new Set<string>()

function bagOf(plugin: string): PluginBag {
  let bag = bags.get(plugin)
  if (!bag) {
    bag = { tools: new Map() }
    bags.set(plugin, bag)
  }
  return bag
}

function markPendingPluginToolServerRemoval(key: string): void {
  pendingPluginToolServerRemovals.add(key)
}

/** densable — r_o ignore while host still lists a just-forgotten Xj key. */
export function isPendingPluginToolServerRemoval(key: string): boolean {
  return pendingPluginToolServerRemovals.has(key)
}

/** densable Xj.list / KLo */
export function listPluginRegisteredTools(
  plugin: string,
): PluginRegisteredToolSpec[] {
  return [...(bags.get(plugin)?.tools.values() ?? [])]
}

/** densable Xj.own — mutable map of tool specs for a plugin. */
export function ownPluginRegisteredTools(
  plugin: string,
): Map<string, PluginRegisteredToolSpec> {
  return bagOf(plugin).tools
}

export function getPluginRegisteredTool(
  plugin: string,
  name: string,
): PluginRegisteredToolSpec | undefined {
  return bags.get(plugin)?.tools.get(name)
}

export function setPluginRegisteredTool(
  plugin: string,
  spec: PluginRegisteredToolSpec,
): void {
  bagOf(plugin).tools.set(spec.name, { ...spec })
}

export function pluginToolSpecsEqual(
  a: PluginRegisteredToolSpec | undefined,
  b: PluginRegisteredToolSpec | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  return isDeepStrictEqual(a, b)
}

/** densable Xj.serverKey */
export function getPluginToolServerKey(plugin: string): string | undefined {
  return bags.get(plugin)?.serverKey
}

/** densable Xj.keyed */
export function setPluginToolServerKey(plugin: string, key: string): void {
  const bag = bagOf(plugin)
  bag.serverKey = key
  mintedServerKeys.add(key)
  pendingPluginToolServerRemovals.delete(key)
}

/** densable Xj.minted */
export function isPluginToolServerKeyMinted(key: string): boolean {
  return mintedServerKeys.has(key)
}

/** densable Xj.ownerOfKey */
export function ownerOfPluginToolServerKey(key: string): string | undefined {
  for (const [plugin, bag] of bags.entries()) {
    if (bag.serverKey === key) return plugin
  }
  return undefined
}

/**
 * densable Xj.forget — drop bag; caller removes MCP server when key was set.
 * Returns previous serverKey if any.
 *
 * Also drops the key from mintedServerKeys when no other bag still owns it,
 * so a later re-register re-runs densable r_o MCP-name conflict detection.
 */
export function forgetPluginRegisteredTools(
  plugin: string,
): string | undefined {
  const bag = bags.get(plugin)
  bags.delete(plugin)
  const key = bag?.serverKey
  if (key !== undefined && ownerOfPluginToolServerKey(key) === undefined) {
    mintedServerKeys.delete(key)
    markPendingPluginToolServerRemoval(key)
  }
  return key
}

/**
 * densable Xj full forget — drop every bag + minted set.
 * Returns distinct serverKeys so the host can removeMcpServer each.
 * Prefer per-plugin forgetPluginRegisteredTools on retire; use this for
 * nuclear setLoaded / SAME_THREAD teardown (not the test-only clearer alone).
 */
export function forgetAllPluginRegisteredTools(): string[] {
  const keys: string[] = []
  for (const bag of bags.values()) {
    if (bag.serverKey !== undefined) keys.push(bag.serverKey)
  }
  bags.clear()
  mintedServerKeys.clear()
  const distinct = [...new Set(keys)]
  for (const key of distinct) markPendingPluginToolServerRemoval(key)
  return distinct
}

export function clearPluginToolRegistryForTests(): void {
  bags.clear()
  mintedServerKeys.clear()
  pendingPluginToolServerRemovals.clear()
}
