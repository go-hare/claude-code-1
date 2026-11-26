/**
 * Official 2.1.331 MCP Cache-First Discovery (`runCachedFirstDialArms` /
 * `persistLiveListing` / `persistRawDiscoveryIfComplete` / `applyCapabilityServeTimeMiss`).
 */
import type {
  Resource,
  ServerCapabilities,
  Tool as McpWireTool,
} from '@modelcontextprotocol/client'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { leftoverP, leftoverY } from '../../utils/leftoverOt.js'
import { logMCPDebug } from '../../utils/log.js'
import {
  HostSlot,
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  runWithSession,
} from '../../utils/sessionRoot.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { getServerCacheKey } from './connectionHelpers.js'
import type {
  CachedMCPServer,
  ConnectedMCPServer,
  FailedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResourceTemplate,
} from './types.js'

export const MCP_DISCOVERY_CACHE_FLAG = 'tengu_mcp_discovery_cache'
export const MCP_DISCOVERY_CACHE_VERSION = 1
export const MCP_DISCOVERY_CACHE_FRESH_TTL_MS = 5 * 60_000
export const MCP_DISCOVERY_CACHE_STALE_TTL_MS = 24 * 60 * 60_000
export const MCP_DISCOVERY_CACHE_STRIKE_LIMIT = 3

export type CachedMcpPromptEntry = {
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export type CachedDiscoveryListing = {
  v: number
  serverName: string
  cacheKey: string
  savedAt: number
  toolsSavedAt?: number
  consecutiveRefreshFailures: number
  serverInfo?: {
    name: string
    version: string
  }
  negotiatedEra?: string
  capabilities: ServerCapabilities
  tools: McpWireTool[]
  commands: CachedMcpPromptEntry[]
  resources: Resource[]
  templates: Array<Omit<ServerResourceTemplate, 'server'>>
}

export type DiscoveryCacheMissReason =
  | 'absent'
  | 'expired'
  | 'corrupt'
  | 'strike-threshold'
  | 'no-fingerprint'
  | 'unsealed'
  | 'disabled'
  | 'key-unavailable'
  | 'transport'
  | 'live-connection'
  | 'skills-capable'
  | 'channel-capable'

export type DiscoveryCacheReadOutcome =
  | { kind: 'fresh'; entry: CachedDiscoveryListing; ageMs: number }
  | { kind: 'stale'; entry: CachedDiscoveryListing; ageMs: number }
  | { kind: 'miss'; reason: DiscoveryCacheMissReason }

export type DiscoveryCacheWriteVerdict =
  | 'written'
  | 'superseded'
  | 'transient'
  | 'terminal'

type CachedAdoptListener = (name: string, config: ScopedMcpServerConfig) => void
type CachedDialFailedListener = (
  failure: FailedMCPServer,
  ownStrike: boolean,
) => void

export type SettledCachedDialFailure = {
  failure: FailedMCPServer
  ownStrike: boolean
}

type HostDiscoveryCacheState = {
  discoveryCacheStore: Map<string, CachedDiscoveryListing>
  settledCachedDialFailures: Map<string, SettledCachedDialFailure>
  cachedAdoptListeners: Set<CachedAdoptListener>
  cachedDialFailedListeners: Set<CachedDialFailedListener>
}

const hostDiscoveryCacheSlot = new HostSlot<HostDiscoveryCacheState>(() => ({
  discoveryCacheStore: new Map(),
  settledCachedDialFailures: new Map(),
  cachedAdoptListeners: new Set(),
  cachedDialFailedListeners: new Set(),
}))

function getHostDiscoveryCacheState(): HostDiscoveryCacheState {
  return hostDiscoveryCacheSlot.of(getBootstrapSessionHost())
}

const rawToolsByResult = new WeakMap<object, McpWireTool[]>()
const rawCommandsByResult = new WeakMap<object, CachedMcpPromptEntry[]>()
const rawResourcesByResult = new WeakMap<object, Resource[]>()
const rawFetchedAtByResult = new WeakMap<object, number>()
const persistedDiscoveryRounds = new WeakSet<object>()
const discoveryFetchErrors = new WeakMap<object, Error>()
const cachedFirstDialArmsRan = new WeakSet<object>()
const swrRefreshDialsInFlight = new WeakSet<Promise<MCPServerConnection>>()

/**
 * Check whether MCP discovery caching is enabled via env or GrowthBook.
 * Disabled by default when neither env nor GrowthBook enables it so existing
 * live-connect callers and tests preserve exact startup behavior.
 */
export function isMcpDiscoveryCacheEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.CLAUDE_CODE_MCP_DISCOVERY_CACHE !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_MCP_DISCOVERY_CACHE)
  }
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(MCP_DISCOVERY_CACHE_FLAG, false) ===
    true
  )
}

/** Official `Xnn` — transports eligible for discovery-cache persistence. */
export function isDiscoveryCacheEligibleConfig(
  config: ScopedMcpServerConfig,
): boolean {
  const type = config.type ?? 'stdio'
  return (
    type === 'stdio' ||
    type === 'http' ||
    type === 'sse' ||
    type === 'claudeai-proxy'
  )
}

function isSkillsCapable(capabilities: ServerCapabilities): boolean {
  const cap = capabilities as ServerCapabilities & {
    experimental?: Record<string, unknown>
    skills?: unknown
  }
  return Boolean(cap.skills || cap.experimental?.skills)
}

function isChannelCapable(capabilities: ServerCapabilities): boolean {
  const cap = capabilities as ServerCapabilities & {
    experimental?: Record<string, unknown>
  }
  return Boolean(cap.experimental?.['claude/channel'])
}

/**
 * Official 2.1.331 `Og` (`applyCapabilityServeTimeMiss`) — downgrade a cached
 * hit to a miss when the cached capabilities advertise skills or channels that
 * require a live transport session.
 */
export function applyCapabilityServeTimeMiss(
  outcome: DiscoveryCacheReadOutcome,
): DiscoveryCacheReadOutcome {
  if (outcome.kind !== 'fresh' && outcome.kind !== 'stale') {
    return outcome
  }
  const caps = outcome.entry.capabilities
  if (isSkillsCapable(caps)) {
    return { kind: 'miss', reason: 'skills-capable' }
  }
  if (isChannelCapable(caps)) {
    return { kind: 'miss', reason: 'channel-capable' }
  }
  return outcome
}

/** Official 2.1.331 `Lg` (`isCacheOutcomeMiss`) — whether a miss reason emits discovery-source telemetry. */
export function isCacheOutcomeMiss(
  outcome: DiscoveryCacheReadOutcome,
): boolean {
  if (outcome.kind !== 'miss') return false
  switch (outcome.reason) {
    case 'absent':
    case 'expired':
    case 'corrupt':
    case 'strike-threshold':
    case 'no-fingerprint':
    case 'unsealed':
      return true
    case 'disabled':
    case 'key-unavailable':
    case 'transport':
    case 'live-connection':
    case 'skills-capable':
    case 'channel-capable':
      return false
  }
}

/** Official 2.1.331 `Dg` (`discoverySourceForMiss`) — map miss reason to `tengu_mcp_discovery_source.source`. */
export function discoverySourceForMiss(
  outcome: DiscoveryCacheReadOutcome,
): string {
  if (outcome.kind !== 'miss') return 'live'
  switch (outcome.reason) {
    case 'disabled':
    case 'key-unavailable':
      return 'miss_disabled'
    case 'unsealed':
    case 'corrupt':
      return 'miss_corrupt'
    case 'expired':
      return 'miss_expired'
    case 'strike-threshold':
      return 'miss_strike'
    case 'no-fingerprint':
      return 'miss_no_fingerprint'
    case 'transport':
    case 'absent':
    case 'live-connection':
    case 'skills-capable':
    case 'channel-capable':
      return 'live'
  }
}

/** Official `ri` — record raw wire tools returned by `tools/list` for a result array. */
export function recordRawToolsForResult(
  result: object,
  rawTools: McpWireTool[],
  now: number = Date.now(),
): void {
  rawToolsByResult.set(result, rawTools)
  rawFetchedAtByResult.set(result, now)
}

/** Official `si` — record raw wire prompts returned by `prompts/list` for a result array. */
export function recordRawCommandsForResult(
  result: object,
  rawCommands: CachedMcpPromptEntry[],
  now: number = Date.now(),
): void {
  rawCommandsByResult.set(result, rawCommands)
  rawFetchedAtByResult.set(result, now)
}

/** Official `or` — record raw wire resources returned by `resources/list` for a result array. */
export function recordRawResourcesForResult(
  result: object,
  rawResources: Resource[],
  now: number = Date.now(),
): void {
  rawResourcesByResult.set(result, rawResources)
  rawFetchedAtByResult.set(result, now)
}

/** Official `ZR` — record a fetch error associated with a list result array. */
export function recordDiscoveryFetchErrorForResult(
  result: object,
  error: Error,
): void {
  discoveryFetchErrors.set(result, error)
}

/** Official `bi` — retrieve a fetch error recorded for a list result array. */
export function getDiscoveryFetchError(result: object): Error | undefined {
  return discoveryFetchErrors.get(result)
}

export function subscribeCachedAdopt(
  listener: CachedAdoptListener,
): () => void {
  const state = getHostDiscoveryCacheState()
  const capturedSession = getActiveSessionFromAls()
  const wrapped: CachedAdoptListener =
    capturedSession !== undefined
      ? (name, config) =>
          runWithSession(capturedSession, () => listener(name, config))
      : listener
  state.cachedAdoptListeners.add(wrapped)
  return () => {
    state.cachedAdoptListeners.delete(wrapped)
  }
}

export function subscribeCachedDialFailed(
  listener: CachedDialFailedListener,
): () => void {
  const state = getHostDiscoveryCacheState()
  const capturedSession = getActiveSessionFromAls()
  const wrapped: CachedDialFailedListener =
    capturedSession !== undefined
      ? (failure, ownStrike) =>
          runWithSession(capturedSession, () => listener(failure, ownStrike))
      : listener
  state.cachedDialFailedListeners.add(wrapped)
  return () => {
    state.cachedDialFailedListeners.delete(wrapped)
  }
}

function emitCachedAdopt(name: string, config: ScopedMcpServerConfig): void {
  for (const listener of getHostDiscoveryCacheState().cachedAdoptListeners) {
    try {
      listener(name, config)
    } catch {
      // keep other listeners running
    }
  }
}

function emitCachedDialFailed(
  failure: FailedMCPServer,
  ownStrike: boolean,
): void {
  const state = getHostDiscoveryCacheState()
  const key = getServerCacheKey(failure.name, failure.config)
  state.settledCachedDialFailures.set(key, { failure, ownStrike })
  for (const listener of state.cachedDialFailedListeners) {
    try {
      listener(failure, ownStrike)
    } catch {
      // keep other listeners running
    }
  }
}

/** Official `BR` (`takeSettledCachedDialFailure`) — consume and clear a settled cached dial failure. */
export function takeSettledCachedDialFailure(
  name: string,
  config: ScopedMcpServerConfig,
): SettledCachedDialFailure | undefined {
  const { settledCachedDialFailures } = getHostDiscoveryCacheState()
  const key = getServerCacheKey(name, config)
  const entry = settledCachedDialFailures.get(key)
  if (entry !== undefined) {
    settledCachedDialFailures.delete(key)
  }
  return entry
}

export function markSwrRefreshDialInFlight(
  dial: Promise<MCPServerConnection>,
): void {
  swrRefreshDialsInFlight.add(dial)
}

export function unmarkSwrRefreshDialInFlight(
  dial: Promise<MCPServerConnection>,
): void {
  swrRefreshDialsInFlight.delete(dial)
}

/**
 * Official 2.1.331 `I5a` — read a cached MCP server discovery entry and
 * classify it as `fresh`, `stale`, or a typed `miss`.
 */
export function readDiscoveryCacheEntry(
  name: string,
  config: ScopedMcpServerConfig,
  options?: {
    now?: number
    hasLiveConnection?: boolean
    freshTtlMs?: number
    staleTtlMs?: number
    enabled?: boolean
  },
): DiscoveryCacheReadOutcome {
  if (options?.hasLiveConnection) {
    return { kind: 'miss', reason: 'live-connection' }
  }
  const enabled = options?.enabled ?? isMcpDiscoveryCacheEnabled()
  if (!enabled) {
    return { kind: 'miss', reason: 'disabled' }
  }
  if (!isDiscoveryCacheEligibleConfig(config)) {
    return { kind: 'miss', reason: 'transport' }
  }
  const { discoveryCacheStore } = getHostDiscoveryCacheState()
  const key = getServerCacheKey(name, config)
  const entry = discoveryCacheStore.get(key)
  if (!entry) {
    return { kind: 'miss', reason: 'absent' }
  }
  if (entry.v !== MCP_DISCOVERY_CACHE_VERSION || entry.serverName !== name) {
    discoveryCacheStore.delete(key)
    return { kind: 'miss', reason: 'corrupt' }
  }
  if (entry.consecutiveRefreshFailures >= MCP_DISCOVERY_CACHE_STRIKE_LIMIT) {
    return { kind: 'miss', reason: 'strike-threshold' }
  }
  const now = options?.now ?? Date.now()
  const ageMs = Math.max(0, now - entry.savedAt)
  const freshTtl = options?.freshTtlMs ?? MCP_DISCOVERY_CACHE_FRESH_TTL_MS
  const staleTtl = options?.staleTtlMs ?? MCP_DISCOVERY_CACHE_STALE_TTL_MS
  if (ageMs > staleTtl) {
    discoveryCacheStore.delete(key)
    return { kind: 'miss', reason: 'expired' }
  }
  if (ageMs <= freshTtl) {
    return { kind: 'fresh', entry, ageMs }
  }
  return { kind: 'stale', entry, ageMs }
}

/** Official `M5a` — persist a discovery listing entry if fresher than what is stored. */
export function writeDiscoveryCacheEntry(
  name: string,
  config: ScopedMcpServerConfig,
  payload: {
    serverInfo?: { name: string; version: string }
    negotiatedEra?: string
    capabilities: ServerCapabilities
    tools: McpWireTool[]
    commands: CachedMcpPromptEntry[]
    resources: Resource[]
    templates: Array<Omit<ServerResourceTemplate, 'server'>>
  },
  context: {
    now?: number
  } = {},
): DiscoveryCacheWriteVerdict {
  if (!isDiscoveryCacheEligibleConfig(config)) {
    return 'superseded'
  }
  const { discoveryCacheStore } = getHostDiscoveryCacheState()
  const now = context.now ?? Date.now()
  const key = getServerCacheKey(name, config)
  const existing = discoveryCacheStore.get(key)
  const existingLatest =
    existing !== undefined
      ? Math.max(existing.savedAt, existing.toolsSavedAt ?? 0)
      : -1
  if (existingLatest > now) {
    return 'superseded'
  }
  discoveryCacheStore.set(key, {
    v: MCP_DISCOVERY_CACHE_VERSION,
    serverName: name,
    cacheKey: key,
    savedAt: now,
    consecutiveRefreshFailures: 0,
    ...(payload.serverInfo ? { serverInfo: payload.serverInfo } : {}),
    ...(payload.negotiatedEra !== undefined
      ? { negotiatedEra: payload.negotiatedEra }
      : {}),
    capabilities: payload.capabilities,
    tools: payload.tools,
    commands: payload.commands,
    resources: payload.resources,
    templates: payload.templates,
  })
  return 'written'
}

/** Official `Xmi` — increment consecutive refresh failure strike count for a stale entry. */
export function recordDiscoveryRefreshStrike(
  name: string,
  config: ScopedMcpServerConfig,
): number {
  const { discoveryCacheStore } = getHostDiscoveryCacheState()
  const key = getServerCacheKey(name, config)
  const existing = discoveryCacheStore.get(key)
  if (!existing) return 0
  const nextCount = existing.consecutiveRefreshFailures + 1
  discoveryCacheStore.set(key, {
    ...existing,
    consecutiveRefreshFailures: nextCount,
  })
  leftoverP('mcp_discovery_cache', 'strike')
  return nextCount
}

/** Official `zr` — remove a server's discovery cache entry. */
export function dropDiscoveryCacheEntry(
  name: string,
  config: ScopedMcpServerConfig,
): void {
  const state = getHostDiscoveryCacheState()
  const key = getServerCacheKey(name, config)
  state.discoveryCacheStore.delete(key)
  state.settledCachedDialFailures.delete(key)
}

/** Clear all discovery cache entries (for tests and identity boundary eviction). */
export function clearAllDiscoveryCacheEntries(): void {
  const state = getHostDiscoveryCacheState()
  state.discoveryCacheStore.clear()
  state.settledCachedDialFailures.clear()
}

export type RunCachedFirstDialArmsDeps = {
  isSuperseded: (dial: Promise<MCPServerConnection>) => boolean
  getCurrentDial: (key: string) => Promise<MCPServerConnection> | undefined
  deleteCurrentDial: (key: string) => void
  getIdentityEpoch: () => number
  detachAndClose: (client: ConnectedMCPServer) => void
}

/**
 * Official 2.1.331 `Rg` (`runCachedFirstDialArms`) — settle handler attached
 * to the first live dial of a cache-hydrated MCP server. Deduplicates per
 * settled client object via `cachedFirstDialArmsRan`:
 * - Ignores superseded/replaced dials (and closes orphaned epoch-changed
 *   connected clients).
 * - Emits `cachedAdopt` for `'connected'` / `'needs-auth'`.
 * - Evicts the connection cache entry and emits `cachedDialFailed` for
 *   `'failed'` (marking `ownStrike = !swrRefreshDialsInFlight.has(dial)`).
 */
export function runCachedFirstDialArms(
  client: MCPServerConnection,
  dialPromise: Promise<MCPServerConnection>,
  identityEpoch: number,
  deps: RunCachedFirstDialArmsDeps,
): void {
  if (cachedFirstDialArmsRan.has(client)) {
    return
  }
  cachedFirstDialArmsRan.add(client)

  const key = getServerCacheKey(client.name, client.config)
  const current = deps.getCurrentDial(key)
  const epochChanged = deps.getIdentityEpoch() !== identityEpoch
  const orphanedEpoch = current === undefined && epochChanged

  if (
    deps.isSuperseded(dialPromise) ||
    (current !== undefined && current !== dialPromise) ||
    orphanedEpoch
  ) {
    if (
      !deps.isSuperseded(dialPromise) &&
      epochChanged &&
      client.type === 'connected'
    ) {
      deps.detachAndClose(client)
    }
    return
  }

  if (client.type === 'connected' || client.type === 'needs-auth') {
    emitCachedAdopt(client.name, client.config)
    return
  }

  deps.deleteCurrentDial(key)
  if (client.type === 'failed') {
    emitCachedDialFailed(client, !swrRefreshDialsInFlight.has(dialPromise))
  }
}

export type PersistDiscoveryRound = {
  tools: object
  commands: object
  resources: object
  templates?: ServerResourceTemplate[]
  identityEpoch: number
  grantLeg?: string
}

/**
 * Official 2.1.331 `Mi` (`persistRawDiscoveryIfComplete`) — commit a complete
 * live discovery round (tools + commands + resources + templates) into the
 * discovery cache, restoring WeakMap entries on transient failures.
 */
export async function persistRawDiscoveryIfComplete(
  client: ConnectedMCPServer,
  round: PersistDiscoveryRound,
  options?: {
    getCurrentIdentityEpoch?: () => number
    writeEntry?: typeof writeDiscoveryCacheEntry
  },
): Promise<boolean> {
  if (persistedDiscoveryRounds.has(round.tools)) {
    return true
  }
  if (
    options?.getCurrentIdentityEpoch &&
    options.getCurrentIdentityEpoch() !== round.identityEpoch
  ) {
    return true
  }
  const rawTools = rawToolsByResult.get(round.tools)
  const rawCommands = rawCommandsByResult.get(round.commands)
  const rawResources = rawResourcesByResult.get(round.resources)
  if (
    rawTools === undefined ||
    rawCommands === undefined ||
    rawResources === undefined ||
    round.templates === undefined
  ) {
    return false
  }

  const fetchedAt = Math.min(
    rawFetchedAtByResult.get(round.tools) ?? Number.POSITIVE_INFINITY,
    rawFetchedAtByResult.get(round.commands) ?? Number.POSITIVE_INFINITY,
    rawFetchedAtByResult.get(round.resources) ?? Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(fetchedAt)) {
    return true
  }

  const savedTimestamps: Array<[object, number | undefined]> = [
    [round.tools, rawFetchedAtByResult.get(round.tools)],
    [round.commands, rawFetchedAtByResult.get(round.commands)],
    [round.resources, rawFetchedAtByResult.get(round.resources)],
  ]

  rawToolsByResult.delete(round.tools)
  rawCommandsByResult.delete(round.commands)
  rawResourcesByResult.delete(round.resources)
  rawFetchedAtByResult.delete(round.tools)
  rawFetchedAtByResult.delete(round.commands)
  rawFetchedAtByResult.delete(round.resources)
  persistedDiscoveryRounds.add(round.tools)

  const writer = options?.writeEntry ?? writeDiscoveryCacheEntry
  const verdict = writer(
    client.name,
    client.config,
    {
      ...(client.serverInfo
        ? {
            serverInfo: {
              name: client.serverInfo.name,
              version: client.serverInfo.version,
            },
          }
        : {}),
      ...(client.protocolEra !== undefined
        ? { negotiatedEra: client.protocolEra }
        : {}),
      capabilities: client.capabilities,
      tools: rawTools,
      commands: rawCommands,
      resources: rawResources,
      templates: round.templates.map(({ server: _server, ...rest }) => rest),
    },
    { now: fetchedAt },
  )

  if (verdict === 'terminal') {
    persistedDiscoveryRounds.delete(round.tools)
    return false
  }
  if (verdict === 'transient') {
    rawToolsByResult.set(round.tools, rawTools)
    rawCommandsByResult.set(round.commands, rawCommands)
    rawResourcesByResult.set(round.resources, rawResources)
    for (const [obj, ts] of savedTimestamps) {
      if (ts !== undefined) rawFetchedAtByResult.set(obj, ts)
    }
    persistedDiscoveryRounds.delete(round.tools)
  }
  return true
}

/**
 * Official 2.1.331 `Ig` (`persistLiveListing`) — write-through helper called
 * after a live MCP server connects and lists tools/commands/resources.
 */
export async function persistLiveListing(
  client: ConnectedMCPServer,
  round: Omit<PersistDiscoveryRound, 'templates'> & {
    templates?: ServerResourceTemplate[]
  },
  deps?: {
    enabled?: boolean
    isDisabled?: (name: string) => boolean
    isPolicyBlocked?: (name: string, config: ScopedMcpServerConfig) => boolean
    peekSettledConnection?: (
      name: string,
      config: ScopedMcpServerConfig,
    ) => Promise<MCPServerConnection | undefined>
    fetchResourceTemplates?: (
      client: ConnectedMCPServer,
    ) => Promise<ServerResourceTemplate[]>
    getCurrentIdentityEpoch?: () => number
  },
): Promise<boolean> {
  const enabled = deps?.enabled ?? isMcpDiscoveryCacheEnabled()
  if (
    !enabled ||
    !isDiscoveryCacheEligibleConfig(client.config) ||
    deps?.isDisabled?.(client.name) ||
    deps?.isPolicyBlocked?.(client.name, client.config)
  ) {
    return false
  }
  try {
    const hasResourcesCap = Boolean(client.capabilities?.resources)
    if (!hasResourcesCap) {
      recordRawResourcesForResult(round.resources, [])
    }
    const templates =
      round.templates !== undefined
        ? round.templates
        : hasResourcesCap && deps?.fetchResourceTemplates
          ? await deps.fetchResourceTemplates(client)
          : []
    if (deps?.peekSettledConnection) {
      const settled = await deps.peekSettledConnection(
        client.name,
        client.config,
      )
      if (settled !== client) return false
    }
    if (
      deps?.isDisabled?.(client.name) ||
      deps?.isPolicyBlocked?.(client.name, client.config)
    ) {
      return false
    }
    return await persistRawDiscoveryIfComplete(
      client,
      {
        ...round,
        templates:
          getDiscoveryFetchError(templates) === undefined
            ? templates
            : undefined,
      },
      { getCurrentIdentityEpoch: deps?.getCurrentIdentityEpoch },
    )
  } catch (err) {
    logMCPDebug(
      client.name,
      `Discovery cache write-through skipped: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

/** Create a `CachedMCPServer` connection placeholder from a discovery cache entry. */
export function createCachedMcpClient(
  name: string,
  config: ScopedMcpServerConfig,
  entry: CachedDiscoveryListing,
): CachedMCPServer {
  return {
    name,
    type: 'cached',
    config,
    capabilities: entry.capabilities,
    ...(entry.serverInfo ? { serverInfo: { ...entry.serverInfo } } : {}),
    cacheSavedAt: entry.savedAt,
  }
}

/** Emit official `tengu_mcp_discovery_source` telemetry + `mcp_discovery_cache` outcome. */
export function logMcpDiscoverySource(params: {
  source: string
  transportType: string
  entryAgeMs?: number
  cacheHit?: boolean
}): void {
  logEvent('tengu_mcp_discovery_source', {
    source:
      params.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    transportType:
      params.transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(params.entryAgeMs !== undefined
      ? { entryAgeMs: params.entryAgeMs }
      : {}),
  })
  if (params.cacheHit) {
    leftoverY('mcp_discovery_cache')
  }
}
