/**
 * densable 2.1.289 `AH` / `sFn` / `hQ` / `qFe` / `r8` / `Gue` / `lFn` / `Nit` / `Tj`.
 * User-installed plugins cannot rewrite descriptions of an organization-
 * managed MCP server's sign-in tools (`provider.tier === "prepend"`).
 */

import { mcpInfoFromString } from '../../services/mcp/mcpStringUtils.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { IW } from '../toolSchemaCache.js'
import {
  checkToolDescribeArgument,
  pastUsers,
  restorePinnedKeys,
  USER_REACHABLE_TIERS,
  type FunctionHookNext,
} from './functionHooksHop.js'
import {
  getLoadedFunctionHooksModules,
  hasMatchingFunctionHook,
  runFunctionHookHop,
  type FunctionHookHandler,
  type LoadedFunctionHooksModule,
} from './functionHooksModules.js'
import { ownerOfPluginToolServerKey } from './pluginToolRegistry.js'

/** densable `V8`. */
export const TOOL_DESCRIBE_ENGINE = 'engine'
/** densable `$st`. */
export const MANAGED_MCP_SCOPES = Object.freeze(['enterprise', 'managed'])
/** densable `nXe`. */
export const SEC_DEFAULT_PLUGIN = 'cc-plugin-sec-default'
export { USER_REACHABLE_TIERS, pastUsers } from './functionHooksHop.js'

export type ToolDescribeTier =
  | 'core'
  | 'user'
  | 'prepend'
  | 'append'
  | 'builtin'

export type ToolDescribeProvider = {
  plugin: string
  tier: ToolDescribeTier
}

/** densable `u2e`. */
export const CORE_TOOL_PROVIDER: ToolDescribeProvider = Object.freeze({
  plugin: TOOL_DESCRIBE_ENGINE,
  tier: 'core',
})

export type ToolDescribeTool = {
  name: string
  isMcp?: boolean
  mcpInfo?: {
    serverName: string
    toolName?: string
    scope?: string
    source?: string
  }
}

export type ToolDescribeResult = {
  description: string
  isDeferred: boolean | undefined
}

type McpRecord = { pluginSource?: string }

type DescribeResolver = (
  tool: ToolDescribeTool,
  description: string,
  isDeferred: boolean | undefined,
) => Promise<ToolDescribeResult>

type DescribeBag = {
  resolver: DescribeResolver | null
  presence: ((tool: string | undefined) => boolean) | null
  buildPresence: ((tool: string | undefined) => boolean) | null
  invalidator: (() => void) | null
  deferrals: Map<string, boolean>
  described: Map<string, Promise<ToolDescribeResult>>
}

/** densable `R_` / `AH`. */
function createToolDescribeBag(): DescribeBag {
  return {
    resolver: null,
    presence: null,
    buildPresence: null,
    invalidator: null,
    deferrals: new Map(),
    described: new Map(),
  }
}

const bag = createToolDescribeBag()

export function setToolDescribeResolver(
  resolver: DescribeResolver | null,
): void {
  bag.resolver = resolver
}

export function setToolDescribePresence(
  presence: DescribeBag['presence'],
): void {
  bag.presence = presence
}

export function setToolDescribeBuildPresence(
  presence: DescribeBag['buildPresence'],
): void {
  bag.buildPresence = presence
}

export function setToolDescribeInvalidator(invalidator: () => void): void {
  bag.invalidator = invalidator
}

/** densable `$e.resolveToolDescription` / `nls`. */
export function resolveToolDescription(
  tool: ToolDescribeTool,
  description: string,
  isDeferred: boolean | undefined,
): Promise<ToolDescribeResult> {
  return (
    bag.resolver?.(tool, description, isDeferred) ??
    Promise.resolve({ description, isDeferred })
  )
}

export function isToolDescribeHooked(tool: string | undefined): boolean {
  return bag.presence?.(tool) ?? false
}

export function isToolDescribeHookedForBuild(
  tool: string | undefined,
): boolean {
  return (bag.buildPresence ?? bag.presence)?.(tool) ?? false
}

export function invalidateToolDescriptions(): void {
  bag.deferrals.clear()
  bag.described.clear()
  bag.invalidator?.()
}

export function recordDeferral(
  name: string,
  isDeferred: boolean | undefined,
): void {
  if (isDeferred === undefined) bag.deferrals.delete(name)
  else bag.deferrals.set(name, isDeferred)
}

export function deferralOf(name: string): boolean | undefined {
  return bag.deferrals.get(name)
}

export function forgetDeferrals(): void {
  bag.deferrals.clear()
  bag.described.clear()
}

export function describedOnce(
  name: string,
  factory: () => Promise<ToolDescribeResult>,
): Promise<ToolDescribeResult> {
  const existing = bag.described.get(name) ?? factory()
  bag.described.set(name, existing)
  return existing
}

/** densable `Gue`. */
export function hasUserInstalledLink(
  mod: Pick<LoadedFunctionHooksModule, 'link'>,
): boolean {
  return mod.link !== undefined
}

/** densable `r8`. */
export function modulesForToolDescribeCount(
  event: string,
): LoadedFunctionHooksModule[] {
  const gated =
    event.startsWith('classic.') ||
    event === 'tool.describe' ||
    event === 'tool.call' ||
    event === 'tool.check'
  return getLoadedFunctionHooksModules().filter(
    mod =>
      !(gated && mod.name === SEC_DEFAULT_PLUGIN && hasUserInstalledLink(mod)),
  )
}

/** densable `Tj`. */
export function mcpInfoSource(
  serverName: string,
  config: {
    type?: string
    scope?: string
    pluginSource?: string
  },
): string {
  if (config.type === 'sdk') return 'sdk'
  if (
    config.pluginSource !== undefined ||
    (config.scope === 'dynamic' &&
      ownerOfPluginToolServerKey(serverName) !== undefined)
  ) {
    return 'plugin'
  }
  return config.scope ?? 'dynamic'
}

/** densable `qFe` (ZEn lists not invented — plugin MCP stays user). */
export function pluginProvider(plugin: string): ToolDescribeProvider {
  return Object.freeze({
    plugin,
    tier: plugin.startsWith('builtin:') ? 'builtin' : 'user',
  })
}

/** densable `_k` / `gQ` — storage id when the loaded module remaps. */
function pluginStorageName(name: string): string {
  const mod = getLoadedFunctionHooksModules().find(m => m.name === name)
  if (mod?.pluginStorageId !== undefined && mod.pluginStorageId !== name) {
    return mod.pluginStorageId
  }
  return name
}

/** densable `hQ`. */
export function providerForMcpServer(input: {
  name: string
  scope?: string
  pluginSource?: string
}): ToolDescribeProvider {
  if (
    input.scope !== undefined &&
    (MANAGED_MCP_SCOPES as readonly string[]).includes(input.scope)
  ) {
    return Object.freeze({ plugin: `mcp:${input.name}`, tier: 'prepend' })
  }
  if (input.pluginSource !== undefined) {
    return pluginProvider(input.pluginSource)
  }
  const owner = ownerOfPluginToolServerKey(input.name)
  if (owner === undefined) {
    return Object.freeze({ plugin: `mcp:${input.name}`, tier: 'user' })
  }
  return pluginProvider(pluginStorageName(owner))
}

let mcpRecordLookup: ((server: string) => Promise<McpRecord | null>) | null =
  null

/** Test seam for gold `zLo` reject ("read as the organization's"). */
export function setMcpRecordLookup(
  lookup: ((server: string) => Promise<McpRecord | null>) | null,
): void {
  mcpRecordLookup = lookup
}

async function readMcpRecord(server: string): Promise<McpRecord | null> {
  if (mcpRecordLookup) return mcpRecordLookup(server)
  const { getMcpConfigByName } = await import('../../services/mcp/config.js')
  const cfg = getMcpConfigByName(server)
  if (cfg === null) return null
  return { pluginSource: cfg.pluginSource }
}

/** densable `sFn`. */
export async function providerForTool(
  tool: ToolDescribeTool,
): Promise<ToolDescribeProvider> {
  if (!(tool.isMcp === true || tool.mcpInfo !== undefined)) {
    return CORE_TOOL_PROVIDER
  }
  const server =
    tool.mcpInfo?.serverName ?? mcpInfoFromString(tool.name)?.serverName
  if (server === undefined) {
    return Object.freeze({ plugin: 'mcp', tier: 'user' })
  }
  const record = await readMcpRecord(server).then(
    found => ({ pluginSource: found?.pluginSource }),
    err => {
      logForDebugging(
        `provider (${server}): plugin record unread, read as the organization's: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      return undefined
    },
  )
  if (record === undefined) {
    return Object.freeze({ plugin: `mcp:${server}`, tier: 'prepend' })
  }
  return providerForMcpServer({
    name: server,
    scope: tool.mcpInfo?.scope ?? tool.mcpInfo?.source,
    pluginSource: record.pluginSource,
  })
}

/** densable `Nit`. */
export function isToolDescribeCounted(tool: string | undefined): boolean {
  return hasMatchingFunctionHook(
    'tool.describe',
    tool === undefined ? undefined : { tool },
    modulesForToolDescribeCount('tool.describe'),
  )
}

/** densable `Lit`. */
const secDefaultChanged = { isSent: false }

export function resetToolDescribeSecDefaultSent(): void {
  secDefaultChanged.isSent = false
}

/** densable `ua` / `Od["tool.describe"]`. */
const toolDescribeSite = {
  restoreArgument: (
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ) => restorePinnedKeys(['provider'], passed, original),
  checkArgument: checkToolDescribeArgument,
}

/** densable `rZ.core`. */
async function toolDescribeCore(
  event: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const description =
    typeof event.description === 'string' ? event.description : ''
  return event.isDeferred === true
    ? { description, isDeferred: true }
    : { description }
}

function hasSeatedSecDefault(): boolean {
  return getLoadedFunctionHooksModules().some(
    mod => mod.name === SEC_DEFAULT_PLUGIN && !hasUserInstalledLink(mod),
  )
}

/** densable seated `ue` `e("tool.describe", d)` — `isManaged` so `$e` is prepend. */
function secDefaultDescribeHandler(): {
  name: string
  tier: 'prepend'
  isManaged: true
  hook: FunctionHookHandler
} {
  return {
    name: SEC_DEFAULT_PLUGIN,
    tier: 'prepend',
    isManaged: true,
    hook: (_api, event, next) => pastUsers(event, next as FunctionHookNext),
  }
}

/**
 * densable `ya("tool.describe", {})`.
 * qP loads every matching module; seated `d` is prepended when the
 * builtin is not already live. No among-filter.
 */
export function ya(
  event: 'tool.describe',
  _options: Record<string, unknown> = {},
): (payload: Record<string, unknown>) => Promise<unknown> {
  return payload =>
    runFunctionHookHop(event, payload, toolDescribeCore, {
      prepend: hasSeatedSecDefault() ? [] : [secDefaultDescribeHandler()],
      site: toolDescribeSite,
    })
}

/** densable `lFn`. */
export async function resolveToolDescriptionImpl(
  tool: ToolDescribeTool,
  description: string,
  isDeferred: boolean | undefined,
): Promise<ToolDescribeResult> {
  if (!hasMatchingFunctionHook('tool.describe', { tool: tool.name })) {
    return { description, isDeferred }
  }
  const provider = await providerForTool(tool)
  const counted = isToolDescribeCounted(tool.name)
  const result = (await ya(
    'tool.describe',
    {},
  )({
    tool: tool.name,
    description,
    provider,
    ...(isDeferred && { isDeferred }),
  })) as Record<string, unknown>
  const nextDescription =
    typeof result.description === 'string' ? result.description : description
  const nextDeferred = result.isDeferred === true
  if (nextDeferred !== isDeferred) {
    logForDebugging(
      `tool.describe ${tool.name}: a hook set isDeferred ${String(isDeferred)} -> ${String(nextDeferred)}`,
    )
  }
  if (
    (nextDeferred !== isDeferred || nextDescription !== description) &&
    !counted
  ) {
    logForDebugging(
      `tool.describe ${tool.name}: the built-in sec-default plugin changed this tool, though its hook should only pass the event on`,
      { level: 'error' },
    )
    if (!secDefaultChanged.isSent) secDefaultChanged.isSent = true
  }
  return { description: nextDescription, isDeferred: nextDeferred }
}

/** densable `rls(lFn)` / `tls` / `els(Nit)` / `DH(IW)`. */
export function installToolDescribeResolver(): void {
  setToolDescribeResolver(resolveToolDescriptionImpl)
  setToolDescribePresence(tool =>
    hasMatchingFunctionHook(
      'tool.describe',
      tool === undefined ? undefined : { tool },
    ),
  )
  setToolDescribeBuildPresence(isToolDescribeCounted)
  setToolDescribeInvalidator(IW)
}

installToolDescribeResolver()
