/**
 * densable `nfe` / `tE` / `i` / `xd` / `sOn` / `HF`.
 * A named `_host` is a machine. `container` and `this-machine` are not.
 * Forwarding off, the call stays here. Forwarding on with a named host and
 * an empty machine list is `sOn` (`unknown_host`, attached: []).
 */

import { createHash } from 'crypto'
import { isViolinWoodEnabledSync } from '../../cli/violinWood.js'
import { checkGate_CACHED_OR_BLOCKING } from '../analytics/growthbook.js'
import {
  getCapturedCcrIngressBase,
  isMcpCcrProxyUrl,
} from '../mcp/mcpConnectTimeout.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ToolStateSlots } from '../../utils/toolState.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../analytics/index.js'

export const REMOTE_TOOL_HOST_FIELD = '_host'

/** densable `d` — display cap after control characters are stripped. */
export const REMOTE_HOST_NAME_CAP = 40

const RESERVED_HOSTS = ['container', 'this-machine']

const HOST_FIELD_DESCRIPTION =
  "Optional. Name of an attached machine to run this tool call on; omit it to run in this session's own environment (the default). Use only a name this session listed as attached; the result says where it ran. Choose per call by which machine the command or file path concerns; the attached-machines note says what lives where and which are reachable now."

export function isRemoteToolsForwardEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD)
}

/** densable `tE` — reserved names are this session, not a machine. */
export function isReservedRemoteHostName(name: string): boolean {
  return RESERVED_HOSTS.some(reserved => reserved === name)
}

/**
 * densable `i` — trimmed non-empty `_host` that is not reserved.
 * Missing, blank, or reserved → undefined (run here).
 */
export function requestedRemoteHost(input: unknown): string | undefined {
  if (input === null || typeof input !== 'object') return undefined
  if (!(REMOTE_TOOL_HOST_FIELD in input)) return undefined
  const raw = (input as { _host?: unknown })._host
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || isReservedRemoteHostName(trimmed)) return undefined
  return trimmed
}

/** densable `xd`. */
export function namesRemoteHost(input: unknown): boolean {
  return requestedRemoteHost(input) !== undefined
}

/**
 * densable `tv` — strip Cc/Cf, then cap at 40. Used in the unknown-host
 * message. Matching still uses the trimmed name (`i`), not this display form.
 */
export function displayRemoteHostName(name: string): string {
  const stripped = name.replace(/[\p{Cc}\p{Cf}]/gu, '')
  return stripped.length <= REMOTE_HOST_NAME_CAP
    ? stripped
    : stripped.slice(0, REMOTE_HOST_NAME_CAP)
}

/**
 * densable `$2` — the optional `_host` property, only while forwarding is on.
 * `bwt` then strips it (`_Pe`) when `yPe` is true (a remote-capable tool and
 * `KJ()`). No machine is announced here, so `yPe` stays false and the field
 * stays on the schema.
 */
export function remoteHostSchemaProperty():
  | { _host: { type: 'string'; description: string } }
  | undefined {
  if (!isRemoteToolsForwardEnabled()) return undefined
  // densable `bwt` strips `_host` when `yPe` (`KJ`, violin wood) is on.
  if (isViolinWoodEnabledSync()) return undefined
  return {
    _host: { type: 'string', description: HOST_FIELD_DESCRIPTION },
  }
}

/** densable `HF`. */
export function remoteHostNotForwardedMessage(): string {
  return `This call named a machine ("${REMOTE_TOOL_HOST_FIELD}") but was not forwarded to it; omit the field to run here.`
}

const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export type AnnouncedRemoteTool = {
  name: string
  refusedInputFields: string[]
  protocolVersions?: number[]
}

/** densable `Cje` — protocol versions this session reads. */
export const REMOTE_TOOL_PROTOCOL_VERSIONS = [1] as const

/** densable `Gbo` slice. The whole wait is the call deadline, 58s. */
export const REMOTE_ANNOUNCE_WAIT_SLICE_MS = 5_000
export const REMOTE_ANNOUNCE_WAIT_MS = 58_000

/** densable `Yo` host, kept only as far as routing needs. */
export type AnnouncedRemoteMachine = {
  instanceId: string
  name: string
  /** densable sourceHosts: session announce vs a bridge-adopted tool. */
  source: 'session' | 'bridge'
  status: 'online' | 'offline'
  lastHeardAt: number
  stale: boolean
  /** Empty means the announce named no version. */
  protocolVersions: number[]
  tools: AnnouncedRemoteTool[]
  /** MCP tool names this machine adopted. Count is the announce reply. */
  passthroughTools: string[]
  /** Names the machine announced in a form this session cannot read. */
  rejectedPassthrough: string[]
  plumbing: string[]
  epoch?: string
  /** densable `home_dir` from the announce, used to fold `working_dir` to `~`. */
  homeDir?: string
}

/**
 * densable `ZO` — session announce registry. `toolState.get(RemoteSessionRegistry)`
 * is the per-session slot; `defaultSessionRegistry` is the process fallback.
 */
export class RemoteSessionRegistry {
  readonly machines: AnnouncedRemoteMachine[] = []
  readonly withdrawn = new Set<string>()
  #announcedThisLife = false
  #announceWaitExpiredMs: number | undefined
  #announceWaiters = new Set<() => void>()

  onNextAnnounce(callback: () => void): () => void {
    this.#announceWaiters.add(callback)
    return () => {
      this.#announceWaiters.delete(callback)
    }
  }

  announceWaitExpired(): number | undefined {
    return this.#announceWaitExpiredMs
  }

  markAnnounceWaitExpired(waitedMs: number): void {
    this.#announceWaitExpiredMs = waitedMs
  }

  #notifyAnnounceWaiters(): void {
    const waiting = [...this.#announceWaiters]
    this.#announceWaiters.clear()
    for (const callback of waiting) {
      try {
        callback()
      } catch {}
    }
  }

  hasAnnouncedThisLife(): boolean {
    return this.#announcedThisLife
  }

  entries(): AnnouncedRemoteMachine[] {
    return [...this.machines]
  }

  withdrawnThisLife(name: string): boolean {
    return this.withdrawn.has(name)
  }

  clear(): void {
    this.machines.length = 0
  }

  hostsForTable(): Array<{
    kind: 'remote'
    source: 'session'
    name: string
    instanceId: string
    status: 'online' | 'offline'
    enforcement: 'self'
    servedTools: Set<string>
    transport: import('../../utils/toolState.js').RemoteToolRoutedHost['transport']
    passthroughTools?: Map<string, { localName: string }>
    protocol:
      | { kind: 'compatible'; version?: number }
      | { kind: 'incompatible'; announced: number[] }
  }> {
    const { createSessionRemoteToolTransport } =
      require('../../utils/toolState.js') as typeof import('../../utils/toolState.js')
    return this.machines
      .filter(machine => machine.source === 'session')
      .map(machine => ({
        kind: 'remote' as const,
        source: 'session' as const,
        name: machine.name,
        instanceId: machine.instanceId,
        status: machine.status,
        enforcement: 'self' as const,
        servedTools: new Set(machine.tools.map(tool => tool.name)),
        transport: createSessionRemoteToolTransport(
          () => {
            const current = this.machines.find(
              entry =>
                entry.name === machine.name &&
                entry.instanceId === machine.instanceId,
            )
            return {
              hostName: machine.name,
              instanceId: machine.instanceId,
              live: current ?? null,
              stale: current?.stale ?? true,
            }
          },
          {
            heard: epoch => {
              const current = this.machines.find(
                entry => entry.instanceId === machine.instanceId,
              )
              if (!current) return
              current.status = 'online'
              current.lastHeardAt = Date.now()
              if (epoch) current.epoch = epoch
            },
            missed: () => {
              const current = this.machines.find(
                entry => entry.instanceId === machine.instanceId,
              )
              if (!current) return
              current.status = 'offline'
              current.stale = true
            },
            rebind: () => {
              const current = this.machines.find(
                entry => entry.name === machine.name,
              )
              if (!current) return undefined
              return {
                hostName: current.name,
                instanceId: current.instanceId,
                live: current,
                stale: current.stale,
              }
            },
          },
        ),
        ...(machine.passthroughTools.length > 0 && {
          passthroughTools: new Map(
            machine.passthroughTools.map(name => [name, { localName: name }]),
          ),
        }),
        protocol: remoteToolProtocol(
          machine.protocolVersions.length > 0
            ? machine.protocolVersions
            : undefined,
        ),
      }))
  }

  accept(
    input: Parameters<typeof acceptIntoRegistry>[1],
  ): RemoteAnnounceAccept {
    const result = acceptIntoRegistry(this, input)
    if (result.status !== 'invalid') {
      this.#announcedThisLife = true
      this.#notifyAnnounceWaiters()
    }
    return result
  }
}

export const defaultSessionRegistry = new RemoteSessionRegistry()

/** densable ZO: per-session slot when present, else the process fallback. */
function sessionRegistry(toolState?: ToolStateSlots): RemoteSessionRegistry {
  return toolState?.get(RemoteSessionRegistry) ?? defaultSessionRegistry
}

/** densable `rU` — session channel explicitly off. */
export function isRemoteToolsSessionChannelOff(): boolean {
  return (
    process.env.CLAUDE_CODE_REMOTE_TOOLS_SESSION_CHANNEL === '0' ||
    process.env.CLAUDE_CODE_REMOTE_TOOLS_SESSION_CHANNEL === 'false'
  )
}

/**
 * densable `switches()`: channel off, else the forward switch, else switch off.
 * Account-flag pending/off is not consulted: this build has no flag fetch,
 * and a missing flag must not invent `not_ready`.
 */
export function remoteToolsAnnounceSwitch():
  | 'channel_off'
  | 'switch_off'
  | 'on' {
  if (isRemoteToolsSessionChannelOff()) return 'channel_off'
  if (!isRemoteToolsForwardEnabled()) return 'switch_off'
  return 'on'
}

/** densable `markAway` — a missed or gone probe takes the machine offline. */
/** densable `heard` — a probe answer carries the epoch it was heard under. */
export function noteRemoteMachineHeard(
  name: string,
  epoch?: string,
  toolState?: ToolStateSlots,
  instanceId?: string,
): void {
  const machine = sessionRegistry(toolState).machines.find(item =>
    instanceId === undefined
      ? item.name === name
      : item.instanceId === instanceId,
  )
  if (!machine) return
  machine.lastHeardAt = Date.now()
  machine.status = 'online'
  if (epoch !== undefined && epoch !== '') machine.epoch = epoch
}

export function markRemoteMachineAway(
  name: string,
  why?: 'probe_missed',
  toolState?: ToolStateSlots,
  instanceId?: string,
): void {
  const machine = sessionRegistry(toolState).machines.find(item =>
    instanceId === undefined
      ? item.name === name
      : item.instanceId === instanceId,
  )
  if (!machine) return
  machine.status = 'offline'
  if (why === 'probe_missed') machine.stale = true
}

export function announcedRemoteMachines(
  toolState?: ToolStateSlots,
): readonly AnnouncedRemoteMachine[] {
  return sessionRegistry(toolState).machines
}

/** densable `Hbn` — missing versions are protocol v1. */
export function remoteToolProtocol(
  versions: readonly number[] | undefined,
):
  | { kind: 'compatible'; version?: number }
  | { kind: 'incompatible'; announced: number[] } {
  if (versions === undefined) {
    return { kind: 'compatible', version: 1 }
  }
  const compatible = versions.filter(version =>
    (REMOTE_TOOL_PROTOCOL_VERSIONS as readonly number[]).includes(version),
  )
  if (compatible.length > 0) {
    return { kind: 'compatible', version: Math.max(...compatible) }
  }
  return { kind: 'incompatible', announced: [...versions] }
}

/**
 * densable `ZO.hostsForTable` — session-source machines as rF replace rows.
 */
export function hostsForTable(toolState?: ToolStateSlots) {
  return sessionRegistry(toolState).hostsForTable()
}

/** densable `A` — session-source identity for QFn skip. */
function sourceHostsIdentity(
  hosts: Array<{
    name: string
    status?: 'online' | 'offline'
    servedTools?: Set<string>
    passthroughTools?: Map<string, { localName: string }>
  }>,
): string {
  return hosts
    .map(
      host =>
        `${host.name}\0${host.status ?? 'online'}\0${host.servedTools?.size ?? 0}\0${host.passthroughTools?.size ?? 0}`,
    )
    .sort()
    .join('\n')
}

/** densable `ie`. */
function sourceHostsEvent(
  before: Array<{ status?: 'online' | 'offline' }>,
  after: Array<{ status?: 'online' | 'offline' }>,
): 'discovered' | 'went_offline' | 'came_online' | 'changed' {
  const hadOnline = before.some(host => host.status === 'online')
  const hasOnline = after.some(host => host.status === 'online')
  if (before.length === 0) return after.length === 0 ? 'changed' : 'discovered'
  if (hadOnline && !hasOnline) return 'went_offline'
  if (!hadOnline && hasOnline) return 'came_online'
  return 'changed'
}

/**
 * densable `QFn` — copy ZO.hostsForTable into rF session source and stamp
 * `tengu_remote_tool_targets` when the session identity changes.
 */
export function syncSessionRemoteHosts(
  toolState: ToolStateSlots,
  trigger: string,
): void {
  const { RemoteToolHosts } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/toolState.js') as typeof import('../../utils/toolState.js')
  const hosts = toolState.get(RemoteToolHosts)
  const zo = toolState.get(RemoteSessionRegistry)
  const before = hosts.sourceHosts('session')
  hosts.replaceRemoteHosts('session', zo.hostsForTable())
  const after = hosts.sourceHosts('session')
  if (sourceHostsIdentity(before) === sourceHostsIdentity(after)) return
  const event =
    zo.entries().filter(machine => machine.source === 'session').length === 0
      ? 'withdrawn'
      : sourceHostsEvent(before, after)
  logEvent('tengu_remote_tool_targets', {
    event: event as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      'session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    trigger:
      trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    target_count: after.length,
    served_tool_count: after.reduce(
      (count, host) => count + (host.servedTools?.size ?? 0),
      0,
    ),
    passthrough_tool_count: after.reduce(
      (count, host) => count + (host.passthroughTools?.size ?? 0),
      0,
    ),
    incompatible_count: after.filter(
      host => host.protocol?.kind === 'incompatible',
    ).length,
  })
}

/** densable `T5`. */
export const DEVICE_BRIDGE_MCP_NAME = 'remote-devices'

function telemetryPayload(
  after: Array<{
    servedTools?: Set<string>
    passthroughTools?: Map<string, { localName: string }>
    protocol?: { kind: string; version?: number }
  }>,
  trigger: string,
  event: string,
): Record<string, boolean | number | string | undefined> {
  return {
    event: event as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    trigger:
      trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    target_count: after.length,
    served_tool_count: after.reduce(
      (count, host) => count + (host.servedTools?.size ?? 0),
      0,
    ),
    passthrough_tool_count: after.reduce(
      (count, host) => count + (host.passthroughTools?.size ?? 0),
      0,
    ),
    incompatible_count: after.filter(
      host => host.protocol?.kind === 'incompatible',
    ).length,
    protocol_version:
      after[0]?.protocol?.kind === 'compatible'
        ? after[0].protocol.version
        : undefined,
  }
}

/**
 * densable `ne` — replace rF bridge source and stamp tengu_remote_tool_targets.
 */
export function applyBridgeRemoteHosts(
  toolState: ToolStateSlots,
  hosts: import('../../utils/toolState.js').RemoteToolReplaceHost[],
  meta: {
    trigger: string
    invalid?: string
    unreadable?: number
    unreadableMarkers?: number
  },
): void {
  const { RemoteToolHosts } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/toolState.js') as typeof import('../../utils/toolState.js')
  const table = toolState.get(RemoteToolHosts)
  const before = table.sourceHosts('bridge')
  const { dropped } = table.replaceRemoteHosts('bridge', hosts)
  if (dropped.length > 0) {
    logForDebugging(
      `[remote-tools] the bridge announced ${dropped.length} machine(s) under a name this session cannot adopt; not adopted: ${dropped.join(', ')}`,
      { level: 'warn' },
    )
  }
  const after = table.sourceHosts('bridge')
  if (meta.invalid !== undefined) {
    logEvent('tengu_remote_tool_targets', {
      event:
        'listing_invalid' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reason:
        meta.invalid as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger:
        meta.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  if (sourceHostsIdentity(before) !== sourceHostsIdentity(after)) {
    logEvent(
      'tengu_remote_tool_targets',
      telemetryPayload(after, meta.trigger, sourceHostsEvent(before, after)),
    )
  }
  const unreadable = meta.unreadable ?? 0
  const unreadableMarkers = meta.unreadableMarkers ?? 0
  if (unreadable > 0 || unreadableMarkers > 0) {
    logEvent('tengu_remote_tool_targets', {
      event:
        'unreadable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger:
        meta.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      unreadable_count: unreadable,
      unreadable_marker_count: unreadableMarkers,
    })
  }
}

export type DeviceBridgeMcpClient = {
  name: string
  type: string
  config?: {
    type?: string
    scope?: string
    pluginSource?: unknown
    agentSource?: unknown
    url?: unknown
  }
  client?: {
    callTool: (
      params: {
        name: string
        arguments?: Record<string, unknown>
        _meta?: Record<string, unknown>
      },
      options?: { signal?: AbortSignal; timeout?: number },
    ) => Promise<{
      content?: unknown
      isError?: boolean
      structuredContent?: unknown
      _meta?: Record<string, unknown>
    }>
  }
  listTools?: (opts?: { timeout?: number }) => Promise<{
    tools?: Array<{ name?: unknown; _meta?: Record<string, unknown> }>
    nextCursor?: unknown
    _meta?: Record<string, unknown>
  }>
  callTool?: (args: {
    name: string
    arguments: Record<string, unknown>
    timeout?: number
    _meta?: Record<string, unknown>
  }) => Promise<{
    content?: unknown
    isError?: boolean
    structuredContent?: unknown
    _meta?: Record<string, unknown>
  }>
  ensureConnectedClient?: (opts: {
    signal?: AbortSignal
    timeoutMs?: number
  }) => Promise<unknown>
  reinitialize?: () => Promise<void>
}

/** densable `R5` — tools the attached machine serves over the bridge. */
const BRIDGE_SERVED_TOOLS = new Set([
  'Bash',
  'PowerShell',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
])
const BRIDGE_PLUMBING_TOOLS = new Set(['sync_files'])
const BRIDGE_DEFAULT_HOST = 'attached-machine'
const OFFICE_BRIDGE_LISTING = 'office_bridge.listing'
/** densable `NT`. */
export const REMOTE_TOOL_EXECUTION_META = 'anthropic/remoteToolExecution'
/** densable `Ile`. */
export const DEVICE_PASSTHROUGH_META = 'anthropic/devicePassthrough'

function hostNameFromTarget(target: unknown): string | undefined {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return undefined
  }
  const name = (target as { name?: unknown }).name
  if (typeof name !== 'string') return undefined
  if (!HOST_NAME.test(name) || isReservedRemoteHostName(name)) return undefined
  return name
}

function servedToolMarker(tool: {
  name: string
  _meta?: Record<string, unknown>
}):
  | {
      name: string
      protocol_versions?: number[]
      description: { name: string; kind?: string; platform?: string }
    }
  | undefined {
  const raw = tool._meta?.[REMOTE_TOOL_EXECUTION_META]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const rec = raw as Record<string, unknown>
  if (typeof rec.tool === 'string' && rec.tool !== tool.name) return undefined
  const name = hostNameFromTarget(rec.target)
  if (name === undefined) return undefined
  const target = rec.target as { kind?: unknown; platform?: unknown }
  const versions = Array.isArray(rec.protocol_versions)
    ? rec.protocol_versions.filter(
        (version): version is number =>
          typeof version === 'number' &&
          Number.isInteger(version) &&
          version > 0,
      )
    : undefined
  return {
    name,
    protocol_versions: versions,
    description: {
      name,
      ...(typeof target.kind === 'string' && { kind: target.kind }),
      ...(typeof target.platform === 'string' && { platform: target.platform }),
    },
  }
}

function passthroughToolMarker(tool: {
  name: string
  _meta?: Record<string, unknown>
}): { bridgeName: string; localName: string; name: string } | undefined {
  const raw = tool._meta?.[DEVICE_PASSTHROUGH_META]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const first = tool.name.indexOf('__')
  const last = tool.name.lastIndexOf('__')
  const afterFirst = first < 0 ? tool.name : tool.name.slice(first + 2)
  const afterLast = last < 0 ? tool.name : tool.name.slice(last + 2)
  if (
    typeof rec.tool === 'string' &&
    rec.tool !== tool.name &&
    rec.tool !== afterFirst &&
    rec.tool !== afterLast
  ) {
    return undefined
  }
  const localName = afterLast
  const name = hostNameFromTarget(rec.target)
  if (name === undefined) return undefined
  return {
    bridgeName: tool.name,
    localName: typeof rec.tool === 'string' ? rec.tool : localName,
    name,
  }
}

/** densable `ue` — W transport limits. */
const BRIDGE_TRANSPORT_LIMITS = {
  maxRequestBytes: 4_128_768,
  defaultDeadlineMs: 58_000,
} as const

const BRIDGE_MCP_TIMEOUT_CODE = -32001
const BRIDGE_APPROVAL_UNVERIFIED_CODE = -32003
const BRIDGE_DOWNSTREAM_UNREACHABLE_ERRNOS = new Set([
  'ECONNREFUSED',
  'ConnectionRefused',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'FailedToOpenSocket',
])

/**
 * densable `W` — MCP device-bridge transport. `call` is Ce.
 */
export function createBridgeTransport(
  client: DeviceBridgeMcpClient,
):
  | import('../../utils/toolState.js').RemoteToolRoutedHost['transport']
  | undefined {
  // densable W / _F requires n.client.callTool.
  if (typeof client.client?.callTool !== 'function') {
    return undefined
  }
  const OFFICE_BRIDGE_KIND = 'office_bridge.kind'
  const OFFICE_BRIDGE_BOUND_MISS = 'office_bridge.bound_miss'
  const TIMED_OUT_KINDS = new Set(['timeout'])
  const DROPPED_KINDS = new Set(['disconnected', 'cancelled'])
  const UNREACHABLE_KINDS = new Set([
    'not_connected',
    'send_failed',
    'contested',
    'unsupported_on_bound',
  ])
  type TransportCall =
    import('../../utils/toolState.js').RemoteToolTransportCall
  /** densable `Q`. */
  function contentText(content: unknown): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .flatMap(block =>
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
          ? [(block as { text: string }).text]
          : [],
      )
      .join('\n')
  }
  /** densable `Yv`. */
  function responseBytesOf(payload: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(payload) ?? 'null', 'utf8')
    } catch {
      return 0
    }
  }
  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
  function numericErrorCode(err: unknown): number | undefined {
    return err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code?: unknown }).code === 'number'
      ? (err as { code: number }).code
      : undefined
  }
  function stringErrorCode(err: unknown): string | undefined {
    return err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined
  }
  function sanitizeDetail(err: unknown): string {
    return remoteHostSanitizeText(errorMessage(err), 8192)
  }
  /** densable `we`. */
  function isUnverifiedApproval(err: unknown, toolUseId?: string): boolean {
    const data =
      err !== null && typeof err === 'object' && 'data' in err
        ? (err as { data?: unknown }).data
        : undefined
    if (typeof data !== 'object' || data === null) return false
    const rec = data as Record<string, unknown>
    return (
      typeof rec.args_sha256 === 'string' &&
      typeof rec.tool_name === 'string' &&
      typeof rec.tool_use_id === 'string' &&
      toolUseId !== undefined &&
      rec.tool_use_id === toolUseId
    )
  }
  /** densable `YK` slice used by J. */
  function mcpErrorSourceOf(err: unknown): string {
    if (
      err !== null &&
      typeof err === 'object' &&
      'mcpErrorSource' in err &&
      typeof (err as { mcpErrorSource?: unknown }).mcpErrorSource === 'string'
    ) {
      return (err as { mcpErrorSource: string }).mcpErrorSource
    }
    if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
      return err.name === 'TimeoutError' ? 'downstream_unreachable' : 'other'
    }
    const numeric = numericErrorCode(err)
    if (numeric === BRIDGE_MCP_TIMEOUT_CODE || numeric === -32000) {
      return 'downstream_unreachable'
    }
    const code = stringErrorCode(err)
    if (code !== undefined && BRIDGE_DOWNSTREAM_UNREACHABLE_ERRNOS.has(code)) {
      return 'downstream_unreachable'
    }
    return 'other'
  }
  function officeBridgeKind(
    payload: Record<string, unknown>,
  ): string | undefined {
    const meta = payload._meta
    if (meta === null || typeof meta !== 'object') return undefined
    const rec = meta as Record<string, unknown>
    if (typeof rec[OFFICE_BRIDGE_KIND] === 'string')
      return rec[OFFICE_BRIDGE_KIND]
    if (rec[OFFICE_BRIDGE_BOUND_MISS] !== undefined) return 'not_connected'
    return undefined
  }
  /** densable `X` / `ke`. */
  function classifyBridgeError(
    payload: Record<string, unknown>,
    content: unknown,
    capMs: number,
  ): TransportCall | undefined {
    const kind = officeBridgeKind(payload)
    if (kind !== undefined && TIMED_OUT_KINDS.has(kind)) {
      return { kind: 'timed_out', capMs }
    }
    if (kind !== undefined && DROPPED_KINDS.has(kind)) {
      return { kind: 'dropped', detail: `bridge: ${kind}` }
    }
    if (kind !== undefined && UNREACHABLE_KINDS.has(kind)) {
      return {
        kind: 'unreachable',
        detail: `bridge: ${kind}`,
        ...(kind === 'not_connected' && { machineNotAnswering: true }),
      }
    }
    if (kind === 'malformed_result') {
      return {
        kind: 'transport_error',
        detail: 'bridge: malformed result',
        unreadableResult: true,
      }
    }
    const text = contentText(content)
    if (text.length > 200) return undefined
    if (/did not respond within/i.test(text))
      return { kind: 'timed_out', capMs }
    if (
      /disconnected before responding|connection may be closing/i.test(text)
    ) {
      return { kind: 'dropped', detail: 'bridge: disconnected' }
    }
    if (/not connected|not reachable|offline/i.test(text)) {
      return {
        kind: 'unreachable',
        detail: 'bridge: not connected',
        machineNotAnswering: true,
      }
    }
    return undefined
  }
  /** densable `J`. */
  function classifyFailed(
    err: unknown,
    capMs: number,
    toolUseId?: string,
  ): TransportCall {
    if (
      numericErrorCode(err) === BRIDGE_MCP_TIMEOUT_CODE ||
      stringErrorCode(err) === 'REQUEST_TIMEOUT'
    ) {
      return { kind: 'timed_out', capMs }
    }
    const detail = sanitizeDetail(err)
    if (
      numericErrorCode(err) === BRIDGE_APPROVAL_UNVERIFIED_CODE &&
      isUnverifiedApproval(err, toolUseId)
    ) {
      return { kind: 'approval_unverified' }
    }
    if (mcpErrorSourceOf(err) !== 'downstream_unreachable') {
      return { kind: 'transport_error', detail }
    }
    return BRIDGE_DOWNSTREAM_UNREACHABLE_ERRNOS.has(stringErrorCode(err) ?? '')
      ? { kind: 'unreachable', detail }
      : { kind: 'dropped', detail }
  }
  /** densable `K`. */
  function asPlumbingCall(call: TransportCall): TransportCall {
    switch (call.kind) {
      case 'timed_out':
      case 'unreachable':
      case 'dropped':
      case 'transport_error':
      case 'cancelled':
        return call
      default:
        return { kind: 'transport_error', detail: `unexpected: ${call.kind}` }
    }
  }
  /** densable `Re`. */
  function interpret(
    sent: {
      content?: unknown
      isError?: boolean
      structuredContent?: unknown
    } & Record<string, unknown>,
    elapsedMs: number,
    capMs: number,
  ): TransportCall {
    const { parseRemoteToolAnswer } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./remoteToolCall.js') as typeof import('./remoteToolCall.js')
    const parsed = parseRemoteToolAnswer(sent)
    if (parsed.envelope.status === 'malformed') {
      return {
        kind: 'transport_error',
        detail: 'malformed result envelope',
        unreadableResult: true,
      }
    }
    if (parsed.envelope.status === 'present') {
      const env = parsed.envelope.envelope
      return {
        kind: 'result',
        content: parsed.content,
        isError: parsed.isError,
        envelope: {
          outcome: typeof env.outcome === 'string' ? env.outcome : undefined,
          output: env.output,
          content: parsed.content,
        },
        elapsedMs,
        responseBytes: responseBytesOf(sent),
      }
    }
    if (parsed.isError === true) {
      const classified = classifyBridgeError(
        sent,
        parsed.content ?? sent.content,
        capMs,
      )
      if (classified) return classified
    }
    return {
      kind: 'result',
      content: parsed.content,
      isError: parsed.isError,
      envelope: undefined,
      elapsedMs,
      responseBytes: responseBytesOf(sent),
    }
  }
  function isSessionExpired(err: unknown, idempotent = false): boolean {
    try {
      const { isMcpSessionExpiredError } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../mcp/client.js') as typeof import('../mcp/client.js')
      if (err instanceof Error && isMcpSessionExpiredError(err)) return true
    } catch {
      /* client module unavailable in some tests */
    }
    if (!idempotent) return false
    const msg = err instanceof Error ? err.message : String(err)
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined
    const closed =
      (code === -32000 && msg.includes('Connection closed')) ||
      msg === 'CONNECTION_CLOSED'
    if (!closed) return false
    const configType = (client.config as { type?: string } | undefined)?.type
    return configType === 'http' || configType === 'claudeai-proxy'
  }
  /** densable `T()` — Fl / mcpClientModule. */
  function T(): ReturnType<typeof import('../mcp/client.js').mcpClientModule> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (
      require('../mcp/client.js') as typeof import('../mcp/client.js')
    ).mcpClientModule()
  }
  /** densable `RU` — floor 1, cap int32. */
  function capDeadlineMs(ms: number): number {
    if (Number.isNaN(ms) || ms < 1) return 1
    return Math.min(Math.floor(ms), 2_147_483_647)
  }
  /** densable `x` — WeakMap session recovery via clearServerCache. */
  class BridgeSessionRecovery {
    #e = new WeakMap<object, Promise<void>>()
    reinitialize(connection: DeviceBridgeMcpClient): Promise<void> {
      const existing = this.#e.get(connection)
      if (existing) return existing
      const config = connection.config
      const work =
        config && typeof config.type === 'string'
          ? T()
              .clearServerCache(
                connection.name,
                config as Parameters<
                  ReturnType<typeof T>['clearServerCache']
                >[1],
              )
              .catch(() => {})
          : (connection.reinitialize?.() ?? Promise.resolve())
      this.#e.set(connection, work)
      return work
    }
  }
  const recovery = new BridgeSessionRecovery()
  type DialKind =
    | { kind: 'ok'; value: unknown }
    | { kind: 'connect_failed'; error: unknown }
    | { kind: 'session_expired'; connection: DeviceBridgeMcpClient }
    | { kind: 'failed'; error: unknown }
    | { kind: 'expired_twice' }
  /** densable `_F`. */
  function _F(
    conn: DeviceBridgeMcpClient,
    params: {
      name: string
      arguments?: Record<string, unknown>
      _meta?: Record<string, unknown>
    },
    options: { signal?: AbortSignal; timeout?: number },
  ) {
    return T().invokeToolRaw(conn.client!, params, options)
  }
  /** densable `j`. */
  async function j(n: DeviceBridgeMcpClient, e: DialKind): Promise<DialKind> {
    if (e.kind === 'connect_failed') {
      await T()
        .evictStaleFailedConnectMemoForServe(
          n.name,
          n.config as Parameters<
            ReturnType<typeof T>['evictStaleFailedConnectMemoForServe']
          >[1],
        )
        .catch(() => {})
    }
    return e
  }
  /** densable `V`. */
  async function V(
    n: DeviceBridgeMcpClient,
    opts: {
      deadlineAt: number
      signal?: AbortSignal
      idempotent?: boolean
    },
    send: (conn: DeviceBridgeMcpClient, remaining: number) => Promise<unknown>,
  ): Promise<DialKind> {
    const u = T()
    let p: DeviceBridgeMcpClient
    try {
      p = (await u.ensureConnectedClient(
        n as unknown as Parameters<typeof u.ensureConnectedClient>[0],
        {
          signal: opts.signal,
          timeoutMs: Math.max(1, opts.deadlineAt - Date.now()),
          context: 'remote tool execution',
        },
      )) as DeviceBridgeMcpClient
    } catch (f) {
      return { kind: 'connect_failed', error: f }
    }
    const remaining = opts.deadlineAt - Date.now()
    if (remaining <= 0) {
      return {
        kind: 'connect_failed',
        error: new Error('deadline reached before the request could be sent'),
      }
    }
    try {
      return { kind: 'ok', value: await send(p, remaining) }
    } catch (f) {
      return f instanceof Error && isSessionExpired(f, opts.idempotent === true)
        ? { kind: 'session_expired', connection: p }
        : { kind: 'failed', error: f }
    }
  }
  /** densable `M`. */
  async function M(
    n: DeviceBridgeMcpClient,
    opts: {
      deadlineAt: number
      signal?: AbortSignal
      idempotent?: boolean
    },
    send: (conn: DeviceBridgeMcpClient, remaining: number) => Promise<unknown>,
  ): Promise<DialKind> {
    const first = await V(n, opts, send)
    if (first.kind !== 'session_expired') return j(n, first)
    await recovery.reinitialize(first.connection)
    const second = await V(n, opts, send)
    return second.kind === 'session_expired'
      ? { kind: 'expired_twice' }
      : j(n, second)
  }
  /** densable `lqo` — approval meta only when it stays small enough. */
  function attachedCallMeta(
    envelope: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const copy = { ...envelope }
    try {
      const bytes = Buffer.byteLength(JSON.stringify(copy) ?? '{}', 'utf8')
      return bytes <= 8192 ? copy : undefined
    } catch {
      return undefined
    }
  }
  /** densable `Ce`. */
  async function Ce(
    toolName: string,
    input: Record<string, unknown>,
    envelope: Record<string, unknown>,
    opts: { signal: AbortSignal; deadlineMs: number; toolUseId: string },
  ): Promise<TransportCall> {
    const startedAt = Date.now()
    const capMs = capDeadlineMs(opts.deadlineMs)
    const metaCopy = attachedCallMeta(envelope)
    const wireInput = { ...input }
    delete wireInput._host
    const dialed = await M(
      client,
      { deadlineAt: startedAt + capMs, signal: opts.signal },
      (conn, remaining) =>
        _F(
          conn,
          {
            name: toolName,
            arguments: { ...wireInput, __remote_tool_call: envelope },
            _meta: {
              'claudecode/toolUseId': opts.toolUseId,
              ...(metaCopy !== undefined && {
                'claudecode/remoteToolCall': metaCopy,
              }),
            },
          },
          { signal: opts.signal, timeout: remaining },
        ),
    )
    if (dialed.kind === 'ok') {
      const mapped = interpret(
        dialed.value as {
          content?: unknown
          isError?: boolean
          structuredContent?: unknown
        } & Record<string, unknown>,
        Date.now() - startedAt,
        capMs,
      )
      return mapped.kind === 'result'
        ? {
            ...mapped,
            metaCopy: metaCopy === undefined ? 'omitted' : 'attached',
          }
        : mapped
    }
    if (opts.signal.aborted) return { kind: 'cancelled' }
    switch (dialed.kind) {
      case 'connect_failed':
        return { kind: 'unreachable', detail: sanitizeDetail(dialed.error) }
      case 'expired_twice':
        return {
          kind: 'unreachable',
          detail:
            'the device bridge rejected the session again right after re-initializing it; nothing ran',
        }
      case 'failed':
        return classifyFailed(dialed.error, capMs, opts.toolUseId)
      default:
        return {
          kind: 'unreachable',
          detail:
            'the device bridge rejected the session again right after re-initializing it; nothing ran',
        }
    }
  }
  /** densable `Te`. */
  async function Te(
    toolName: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; deadlineMs: number; idempotent?: boolean },
  ): Promise<TransportCall> {
    if (!BRIDGE_PLUMBING_TOOLS.has(toolName)) {
      throw new Error('callPlumbing: not a bridge plumbing tool')
    }
    const startedAt = Date.now()
    const capMs = capDeadlineMs(opts.deadlineMs)
    const dialed = await M(
      client,
      {
        deadlineAt: startedAt + capMs,
        signal: opts.signal,
        idempotent: opts.idempotent,
      },
      (conn, remaining) =>
        _F(
          conn,
          { name: toolName, arguments: { ...input } },
          { signal: opts.signal, timeout: remaining },
        ),
    )
    if (dialed.kind === 'ok') {
      const payload = dialed.value as {
        content?: unknown
        isError?: boolean
        structuredContent?: unknown
      } & Record<string, unknown>
      const { parseRemoteToolAnswer } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./remoteToolCall.js') as typeof import('./remoteToolCall.js')
      const parsed = parseRemoteToolAnswer(payload)
      const text = contentText(parsed.content)
      const classified =
        parsed.isError && parsed.envelope.status === 'absent'
          ? classifyBridgeError(
              payload,
              parsed.content ?? payload.content,
              capMs,
            )
          : undefined
      if (classified !== undefined) return asPlumbingCall(classified)
      return {
        kind: 'result',
        structuredContent: payload.structuredContent,
        text,
        isError: parsed.isError,
      }
    }
    if (opts.signal.aborted) return { kind: 'cancelled' }
    switch (dialed.kind) {
      case 'connect_failed':
        return { kind: 'unreachable', detail: sanitizeDetail(dialed.error) }
      case 'expired_twice':
        return {
          kind: 'unreachable',
          detail:
            'the device bridge rejected the session again right after re-initializing it; nothing ran',
        }
      case 'failed':
        return asPlumbingCall(classifyFailed(dialed.error, capMs, undefined))
      default:
        return {
          kind: 'unreachable',
          detail:
            'the device bridge rejected the session again right after re-initializing it; nothing ran',
        }
    }
  }
  return {
    kind: 'bridge',
    limits: { ...BRIDGE_TRANSPORT_LIMITS },
    call: (toolName, input, envelope, opts) =>
      Ce(toolName, input, envelope, opts),
    callPlumbing: (toolName, input, opts) => Te(toolName, input, opts),
  }
}

/** densable `Z` result. */
export type BridgeListingParse = {
  hosts: import('../../utils/toolState.js').RemoteToolReplaceHost[]
  invalid?: 'two_names' | 'duplicate_tool'
  unreadable: number
  unreadableMarkers: number
}

/** densable `Z` — tools/list → one bridge ToolHost. */
export function parseBridgeToolList(
  tools: Array<{ name: string; _meta?: Record<string, unknown> }>,
  transport?: import('../../utils/toolState.js').RemoteToolRoutedHost['transport'],
): BridgeListingParse {
  const served = tools.filter(tool => BRIDGE_SERVED_TOOLS.has(tool.name))
  const servedMarkers = served.flatMap(tool => {
    const marker = servedToolMarker(tool)
    return marker ? [marker] : []
  })
  const unreadable = served.length - servedMarkers.length
  const passTools = tools.filter(
    tool =>
      !BRIDGE_SERVED_TOOLS.has(tool.name) &&
      !BRIDGE_PLUMBING_TOOLS.has(tool.name) &&
      tool._meta?.[DEVICE_PASSTHROUGH_META] !== undefined,
  )
  const passMarkers = passTools.flatMap(tool => {
    const marker = passthroughToolMarker(tool)
    return marker ? [marker] : []
  })
  const unreadableMarkers = passTools.length - passMarkers.length
  const servedNames = new Set(served.map(tool => tool.name))
  const names = new Set([
    ...servedMarkers.map(marker => marker.name),
    ...passMarkers.map(marker => marker.name),
  ])
  const invalid =
    names.size > 1
      ? 'two_names'
      : servedNames.size < served.length
        ? 'duplicate_tool'
        : undefined
  if (
    served.length === 0 &&
    passMarkers.length === 0 &&
    unreadableMarkers === 0
  ) {
    return { hosts: [], invalid, unreadable, unreadableMarkers }
  }
  const hostName =
    servedMarkers[0]?.name ?? passMarkers[0]?.name ?? BRIDGE_DEFAULT_HOST
  const plumbing = new Set(
    tools
      .filter(tool => BRIDGE_PLUMBING_TOOLS.has(tool.name))
      .map(tool => tool.name),
  )
  const rejected = new Set(
    passTools
      .filter(
        tool => !passMarkers.some(marker => marker.bridgeName === tool.name),
      )
      .map(tool => tool.name),
  )
  return {
    hosts: [
      {
        source: 'bridge',
        name: hostName,
        instanceId: 'bridge',
        status: invalid === undefined ? 'online' : 'offline',
        enforcement: 'self',
        servedTools: servedNames,
        ...(passMarkers.length > 0 && {
          passthroughTools: new Map(
            passMarkers.map(marker => [
              marker.bridgeName,
              { localName: marker.localName },
            ]),
          ),
        }),
        ...(plumbing.size > 0 && { plumbingTools: plumbing }),
        ...(rejected.size > 0 && { rejectedPassthroughTools: rejected }),
        ...(servedMarkers[0]?.description !== undefined && {
          description: servedMarkers[0].description,
        }),
        protocol: remoteToolProtocol(servedMarkers[0]?.protocol_versions),
        ...(transport !== undefined && { transport }),
      },
    ],
    invalid,
    unreadable,
    unreadableMarkers,
  }
}

export function bridgeHostsFromToolList(
  tools: Array<{ name: string; _meta?: Record<string, unknown> }>,
  transport?: import('../../utils/toolState.js').RemoteToolRoutedHost['transport'],
): import('../../utils/toolState.js').RemoteToolReplaceHost[] {
  return parseBridgeToolList(tools, transport).hosts
}

function isScopedDeviceBridgeEntry(client: DeviceBridgeMcpClient): boolean {
  const config = client.config
  if (!config) return false
  return (
    config.scope === 'project' ||
    config.scope === 'local' ||
    config.scope === 'agent' ||
    config.pluginSource !== undefined ||
    config.agentSource !== undefined
  )
}

const BRIDGE_UPSTREAM_HOSTS = new Set([
  'bridge.claudeusercontent.com',
  'bridge-staging.claudeusercontent.com',
])
const BRIDGE_DEVICES_MCP_PATH = '/devices/mcp'
const NIL_UUID_HEX = '00000000000000000000000000000000'

function uuidV5Hex(name: string, namespaceHex32: string): string {
  const digest = createHash('sha1')
    .update(Buffer.from(namespaceHex32, 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest()
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  return digest.subarray(0, 16).toString('hex')
}

function deriveDeviceBridgeToolboxId(sessionSegment: string): string {
  const segHex = uuidV5Hex(sessionSegment, NIL_UUID_HEX)
  const hex = uuidV5Hex(DEVICE_BRIDGE_MCP_NAME, segHex)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** densable `wme` — CCR proxy URL carrying `mcp_url` pointing at `/devices/mcp`. */
export function isDevicesUpstreamUrl(url: string): boolean {
  if (!isMcpCcrProxyUrl(url)) return false
  try {
    const outer = new URL(url)
    const upstreamRaw = outer.searchParams.get('mcp_url')
    if (!upstreamRaw) return false
    const upstream = new URL(upstreamRaw)
    return (
      BRIDGE_UPSTREAM_HOSTS.has(upstream.hostname) &&
      upstream.pathname === BRIDGE_DEVICES_MCP_PATH
    )
  } catch {
    return false
  }
}

/** densable `re` — single `mcp_url` and valid optional `toolbox_mcp_server_id`. */
export function hasValidBridgeRoutingShape(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.getAll('mcp_url').length !== 1) return false
    const toolboxIds = parsed.searchParams.getAll('toolbox_mcp_server_id')
    if (toolboxIds.length === 0) return true
    if (toolboxIds.length !== 1) return false
    const id = toolboxIds[0]!
    if (id === DEVICE_BRIDGE_MCP_NAME) return true
    const sessionSegment = /\/v2\/ccr-sessions\/([^/]+)\/mcp$/.exec(
      parsed.pathname,
    )?.[1]
    return (
      sessionSegment !== undefined &&
      id === deriveDeviceBridgeToolboxId(sessionSegment)
    )
  } catch {
    return false
  }
}

function classifyUnadoptedBridgeEntry(client: DeviceBridgeMcpClient): string {
  if (isScopedDeviceBridgeEntry(client)) return 'scoped_entry'
  const url = client.config?.url
  if (typeof url !== 'string' || url.length === 0) return 'no_url'
  if (!isMcpCcrProxyUrl(url)) return 'not_ccr_proxy_url'
  if (!isDevicesUpstreamUrl(url)) return 'not_devices_upstream'
  if (!hasValidBridgeRoutingShape(url)) return 'routing_shape'
  switch (client.type) {
    case 'connected':
      return 'none'
    case 'disabled':
      return 'disabled'
    case 'needs-auth':
      return 'needs_auth'
    default:
      return 'connecting'
  }
}

/** densable `ze` / `te` — connected unscoped `remote-devices` with validated CCR bridge URL. */
export function findDeviceBridgeClient(
  clients: DeviceBridgeMcpClient[],
): DeviceBridgeMcpClient | undefined {
  return clients.find(
    client =>
      client.type === 'connected' &&
      client.name === DEVICE_BRIDGE_MCP_NAME &&
      !isScopedDeviceBridgeEntry(client) &&
      typeof client.config?.url === 'string' &&
      isDevicesUpstreamUrl(client.config.url) &&
      hasValidBridgeRoutingShape(client.config.url),
  )
}

/** densable `KJ` — nfe() && violin_wood. */
async function remoteToolsListingGate(): Promise<boolean> {
  if (!isRemoteToolsForwardEnabled()) return false
  try {
    return await checkGate_CACHED_OR_BLOCKING('tengu_violin_wood')
  } catch {
    return false
  }
}

/** densable `WK` — subagent that is not the main session skips Fe. */
function skipBridgeListingForAgent(): boolean {
  const { getAgentContext } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/agentContext.js') as typeof import('../../utils/agentContext.js')
  const ctx = getAgentContext()
  return ctx?.agentType === 'subagent' && ctx.isMainSession !== true
}

/** densable `Ue`. */
async function listDeviceBridgeTools(client: DeviceBridgeMcpClient): Promise<
  | {
      tools: Array<{ name: string; _meta?: Record<string, unknown> }>
      truncated: boolean
      stub: boolean
    }
  | undefined
> {
  if (typeof client.listTools !== 'function') return undefined
  const listed = await client.listTools({ timeout: 5000 })
  const tools = (listed.tools ?? []).flatMap(tool =>
    typeof tool.name === 'string' && tool.name !== ''
      ? [{ name: tool.name, _meta: tool._meta }]
      : [],
  )
  const meta = listed._meta
  return {
    tools,
    truncated: Boolean(listed.nextCursor),
    stub:
      typeof meta === 'object' &&
      meta !== null &&
      meta[OFFICE_BRIDGE_LISTING] === 'stub',
  }
}

/**
 * densable `Fe`: no ze → Ye + ne([]); connected → Ue + Z + ne.
 */
async function listDeviceBridgeHosts(
  toolState: ToolStateSlots,
  trigger: string,
  clients: DeviceBridgeMcpClient[],
): Promise<void> {
  if (skipBridgeListingForAgent()) return
  const { RemoteBridgeListing } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/toolState.js') as typeof import('../../utils/toolState.js')
  const slot = toolState.get(RemoteBridgeListing)
  const connected = findDeviceBridgeClient(clients)
  if (connected !== undefined) {
    try {
      const listed = await listDeviceBridgeTools(connected)
      if (listed === undefined) return
      if (listed.truncated) {
        logForDebugging(
          '[remote-tools] device-bridge tools/list is paginated; only the first page is read for machine discovery',
          { level: 'warn' },
        )
      }
      const parsed = parseBridgeToolList(
        listed.tools,
        createBridgeTransport(connected),
      )
      if (parsed.hosts.length === 0) {
        logEvent('tengu_remote_tool_targets', {
          event:
            'listed_empty' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          trigger:
            trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          tool_count: listed.tools.length,
          truncated: listed.truncated,
          stub: listed.stub,
        })
      }
      applyBridgeRemoteHosts(toolState, parsed.hosts, {
        invalid: parsed.invalid,
        unreadable: parsed.unreadable,
        unreadableMarkers: parsed.unreadableMarkers,
        trigger,
      })
    } catch (err) {
      logForDebugging(
        `[remote-tools] device-bridge tools/list failed; keeping last known machines${err instanceof Error ? `: ${err.message}` : ''}`,
        { level: 'warn' },
      )
      logEvent('tengu_remote_tool_targets', {
        event:
          'list_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        trigger:
          trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    return
  }
  const named = clients.filter(client => client.name === DEVICE_BRIDGE_MCP_NAME)
  if (named.length > 0 && !slot.reportedUnmatched) {
    slot.reportedUnmatched = true
    const reasons = named.map(classifyUnadoptedBridgeEntry)
    logForDebugging(
      `[remote-tools] a '${DEVICE_BRIDGE_MCP_NAME}' MCP entry exists but was not adopted as the device bridge`,
      { level: 'warn' },
    )
    logEvent('tengu_remote_tool_targets', {
      event:
        'no_bridge_connection' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger:
        trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      servers_seen: named.length,
      reason: (reasons[0] ??
        'none') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ingress_base_unset: getCapturedCcrIngressBase() === undefined,
    })
  }
  applyBridgeRemoteHosts(toolState, [], {
    invalid: undefined,
    unreadable: 0,
    unreadableMarkers: 0,
    trigger,
  })
}

/** densable `He`. */
export async function syncBridgeRemoteHosts(
  toolState: ToolStateSlots,
  trigger: string,
  clients: DeviceBridgeMcpClient[] = [],
): Promise<void> {
  if (!(await remoteToolsListingGate())) return
  const { RemoteBridgeListing } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/toolState.js') as typeof import('../../utils/toolState.js')
  const slot = toolState.get(RemoteBridgeListing)
  slot.inFlight ??= listDeviceBridgeHosts(toolState, trigger, clients)
    .catch(() => {})
    .finally(() => {
      slot.inFlight = undefined
    })
  return slot.inFlight
}

/**
 * densable `Wit` — QFn, await He, QFn.
 */
export async function refreshRemoteToolHosts(
  toolState: ToolStateSlots,
  trigger: string,
  clients: DeviceBridgeMcpClient[] = [],
): Promise<void> {
  syncSessionRemoteHosts(toolState, trigger)
  await syncBridgeRemoteHosts(toolState, trigger, clients)
  syncSessionRemoteHosts(toolState, trigger)
}

export function clearAnnouncedRemoteMachines(toolState?: ToolStateSlots): void {
  sessionRegistry(toolState).clear()
}

/** densable `ZO.announceWaitExpired` — later unknown names in this session skip waiting. */
export function announceWaitAlreadyExpired(
  toolState?: ToolStateSlots,
): number | undefined {
  return sessionRegistry(toolState).announceWaitExpired()
}

export type RemoteAnnounceAccept = {
  status: 'announced' | 'withdrawn' | 'invalid'
  ignoredTools: string[]
  passthrough: number
  plumbing: number
  displaced: boolean
  protocolVersion: number | null
}

/**
 * densable `registry.accept`. Same instance announcing again with no tools
 * is withdrawn. A different instance of the same name displaces the old
 * one. A version outside `Cje` is stored incompatible (`Q8t`).
 */
function acceptIntoRegistry(
  registry: RemoteSessionRegistry,
  input: {
    instanceId: string
    name: string
    tools: AnnouncedRemoteTool[]
    ignoredTools?: string[]
    passthrough?: string[]
    rejectedPassthrough?: string[]
    plumbing?: string[]
    epoch?: string
    protocolVersions?: number[]
    source?: 'session' | 'bridge'
    homeDir?: string
    now?: number
  },
): RemoteAnnounceAccept {
  const empty: RemoteAnnounceAccept = {
    status: 'invalid',
    ignoredTools: [],
    passthrough: 0,
    plumbing: 0,
    displaced: false,
    protocolVersion: null,
  }
  if (!HOST_NAME.test(input.name) || isReservedRemoteHostName(input.name)) {
    return empty
  }
  const previous = registry.machines.find(
    machine => machine.name === input.name,
  )
  const aliases = registry.machines
    .filter(machine => machine.instanceId === input.instanceId)
    .map(machine => machine.name)
  const withdrawing =
    input.tools.length === 0 &&
    (input.passthrough?.length ?? 0) === 0 &&
    (input.plumbing?.length ?? 0) === 0 &&
    (input.ignoredTools?.length ?? 0) === 0
  // densable ZO: each instance owns one current name; withdraw removes its
  // prior aliases without removing a replacement instance holding this name.
  for (let index = registry.machines.length - 1; index >= 0; index--) {
    if (registry.machines[index]?.instanceId === input.instanceId) {
      registry.machines.splice(index, 1)
    }
  }
  if (withdrawing) {
    const heldByAnother =
      previous !== undefined && previous.instanceId !== input.instanceId
    for (const name of heldByAnother ? aliases : [...aliases, input.name]) {
      if (registry.withdrawn.size < 256) registry.withdrawn.add(name)
    }
    return { ...empty, status: 'withdrawn' }
  }
  registry.withdrawn.delete(input.name)
  const versions = input.protocolVersions ?? []
  const compatible = versions.some(version =>
    (REMOTE_TOOL_PROTOCOL_VERSIONS as readonly number[]).includes(version),
  )
  const machine: AnnouncedRemoteMachine = {
    instanceId: input.instanceId,
    name: input.name,
    source: input.source ?? 'session',
    status: 'online',
    lastHeardAt: input.now ?? Date.now(),
    stale: false,
    protocolVersions: versions,
    tools: compatible || versions.length === 0 ? input.tools : [],
    passthroughTools: input.passthrough ?? [],
    rejectedPassthrough: input.rejectedPassthrough ?? [],
    plumbing: input.plumbing ?? [],
    epoch: input.epoch,
    homeDir: input.homeDir,
  }
  const index = registry.machines.findIndex(entry => entry.name === input.name)
  if (index >= 0) registry.machines[index] = machine
  else registry.machines.push(machine)
  return {
    status: 'announced',
    ignoredTools: input.ignoredTools ?? [],
    passthrough: machine.passthroughTools.length,
    plumbing: machine.plumbing.length,
    displaced:
      previous !== undefined && previous.instanceId !== input.instanceId,
    protocolVersion: compatible
      ? Math.max(
          ...versions.filter(version =>
            (REMOTE_TOOL_PROTOCOL_VERSIONS as readonly number[]).includes(
              version,
            ),
          ),
        )
      : null,
  }
}

export function acceptRemoteMachineAnnounce(
  input: Parameters<RemoteSessionRegistry['accept']>[0],
  toolState?: ToolStateSlots,
): RemoteAnnounceAccept {
  // densable QFn reads `toolState.get(ZO)` only. Write that slot when
  // present; otherwise the process fallback registry.
  return sessionRegistry(toolState).accept(input)
}

/** densable `Q8t` when the announced versions share nothing with `Cje`. */
export function remoteHostIncompatibleMessage(
  name: string,
  announced: readonly number[],
  toolName?: string,
  runsOnlyThere = false,
  toolState?: ToolStateSlots,
): string {
  const ours = REMOTE_TOOL_PROTOCOL_VERSIONS.map(version => `v${version}`).join(
    '/',
  )
  const announcedText =
    announced.length > 0
      ? `its remote-tool protocol ${announced.map(version => `v${version}`).join('/')}, ours ${ours}`
      : `it names no remote-tool protocol version this session reads; ours is ${ours}`
  const oursMax = Math.max(...REMOTE_TOOL_PROTOCOL_VERSIONS)
  const who =
    announced.length === 0
      ? 'whichever of the two is older needs updating'
      : Math.max(...announced) < oursMax
        ? `Claude Code on ${name} is the older of the two and needs updating`
        : "this session's Claude Code is the older of the two: a newer cloud environment is needed, not a change on the machine"
  const here = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
    ? 'in the container'
    : 'on this machine'
  let tail = `Omit "${REMOTE_TOOL_HOST_FIELD}" to run it ${here} instead.`
  if (toolName !== undefined) {
    const elsewhere = sessionRegistry(toolState).machines.find(
      machine =>
        machine.name !== name &&
        machine.status === 'online' &&
        machine.tools.some(tool => tool.name === toolName),
    )
    if (elsewhere) {
      tail = `${toolName} has no home ${here}; ${elsewhere.name} serves it — set "${REMOTE_TOOL_HOST_FIELD}" to "${elsewhere.name}".`
    } else if (runsOnlyThere) {
      tail = `${toolName} exists only on ${name}, so it cannot run from this session until then.`
    }
  }
  return `${name} is attached but the two Claude Code builds share no remote-tool protocol version (${announcedText}); the call did not run; ${who}. ${tail}`
}

/**
 * densable `h.resolve` for an exact name. Case differs → the canonical
 * name, so `sOn` can say names are lower-case.
 */
export function resolveAnnouncedMachine(
  requested: string,
  toolState?: ToolStateSlots,
):
  | { kind: 'remote'; machine: AnnouncedRemoteMachine }
  | { kind: 'case'; canonical: string; offline: boolean }
  | { kind: 'unknown' } {
  const machines = sessionRegistry(toolState).machines
  const exact = machines.find(machine => machine.name === requested)
  if (exact) return { kind: 'remote', machine: exact }
  const folded = machines.find(
    machine => machine.name === requested.toLowerCase(),
  )
  if (folded) {
    return {
      kind: 'case',
      canonical: folded.name,
      offline: folded.status === 'offline',
    }
  }
  return { kind: 'unknown' }
}

/** densable `Kbn`. */
export function remoteHostNotEnabledMessage(): string {
  return `Running tool calls on an attached machine is not enabled in this session; omit "${REMOTE_TOOL_HOST_FIELD}" to run here.`
}

function attachedMachineLabels(toolState?: ToolStateSlots): string[] {
  return sessionRegistry(toolState).machines.map(machine =>
    machine.status === 'offline' ? `${machine.name} (offline)` : machine.name,
  )
}

/**
 * densable `sOn`. Exact miss, case-only miss, or an empty list.
 * The invisible-character note needs the displayed name to already be
 * attached; an empty list never adds it.
 */
export function remoteHostUnknownMessage(
  requested: string,
  toolState?: ToolStateSlots,
): string {
  const shown = displayRemoteHostName(requested)
  const bare = requested.trim().replace(/\s+\(offline\)$/i, '')
  if (
    isReservedRemoteHostName(bare.toLowerCase()) &&
    !isReservedRemoteHostName(requested)
  ) {
    return `No machine named "${shown}" is attached to this session — to run this in the session's own environment, omit "${REMOTE_TOOL_HOST_FIELD}".`
  }
  const labels = attachedMachineLabels(toolState)
  const folded = labels.find(
    label => label.replace(/ \(offline\)$/, '') === bare.toLowerCase(),
  )
  const canonical = folded?.replace(/ \(offline\)$/, '')
  if (canonical !== undefined && canonical !== requested) {
    const hadOfflineNote = bare !== requested.trim()
    const offlineTail =
      folded !== canonical
        ? ' — though it did not answer when last asked: do not call it again in this turn, tell the user instead'
        : ''
    const note = hadOfflineNote ? ' without the "(offline)" note' : ''
    return `No machine named "${shown}" is attached to this session — machine names are exact and lower-case: use "${canonical}"${note}${offlineTail}.`
  }
  const attached =
    labels.length > 0
      ? `Attached: ${labels.join(', ')}.`
      : "No machine is attached to this session: only this session's own environment is available — it is not the user's machine, so do not describe it as one."
  const invisible =
    shown !== requested.trim() &&
    labels.some(label => label === shown || label === `${shown} (offline)`)
      ? ' (the name as written contains extra or invisible characters)'
      : ''
  return `No machine named "${shown}"${invisible} is attached to this session. ${attached}`
}

const GAVE_UP_BECAUSE =
  'the computer may be asleep or offline, Claude may not be running on it, running tools for cloud sessions may be switched off on it, or this session could not verify it'

/** densable `Zdo` — first wait ran out. Reconnect wording: no worker restart here. */
export function remoteHostGaveUpMessage(
  name: string,
  waitedMs: number,
): string {
  const shown = displayRemoteHostName(name)
  const seconds = Math.round(waitedMs / 1000)
  return `This call waited ${seconds} s for "${shown}" to connect (this session could not reach it either); it did not — ${GAVE_UP_BECAUSE}. Nothing was sent. Ask the user to check that Claude is running on that computer rather than retrying immediately.`
}

/** densable `euo` — a later call after the wait already expired. */
export function remoteHostGaveUpEarlierMessage(
  name: string,
  waitedMs: number,
): string {
  const shown = displayRemoteHostName(name)
  const seconds = Math.round(waitedMs / 1000)
  return `This session already waited ${seconds} s earlier for "${shown}" to connect (this session could not reach it either), and it still has not — ${GAVE_UP_BECAUSE}. Nothing was sent. Ask the user to check that Claude is running on that computer.`
}

/**
 * densable `zAt`, side `machine`. `lr` uses it only when the machine is
 * offline and its source is not session. A session-source machine is not
 * refused here.
 */
export function remoteHostOfflineMessage(name: string): string {
  const shared = `${name} is not answering right now — most often because Claude on it is not connected (the computer may be offline or asleep, or reconnecting after another session used it); the call did not run.`
  return `${shared} Do not call ${name} again in this turn: do the rest of the task without ${name}, and tell the user what is blocked and to check that Claude is running on ${name}. Check once more only when the user says it is back or asks you to try again.`
}

/**
 * densable `Tv.host_unresponsive`. `$n` ran out of checks.
 * `stillConnected` is unknown here, so the disconnected wording is used.
 */
export function remoteHostUnresponsiveMessage(
  name: string,
  checks: number,
  intervalMs: number,
  whileRunning: boolean,
): string {
  const seconds = Math.round(intervalMs / 1000)
  const when = whileRunning
    ? 'while this command was running'
    : 'after this command was sent to it'
  const maybe = whileRunning
    ? 'or still be running'
    : 'never started, or still be running'
  return `${name} stopped answering ${when} (${checks} checks about ${seconds} s apart went unanswered). Its state is unknown — it may have completed, failed, ${maybe}. Do not retry non-idempotent commands on ${name} until ${name} reconnects, and do not call it again in this turn: do the rest of the task without ${name}, and tell the user what is blocked and what you could not verify. Check once more only when the user says it is back or asks you to try again.`
}

/** densable `lOn`. `left` is the request still standing after the deadline. */
export function remoteHostTimedOutMessage(
  name: string,
  capMs: number,
  left = false,
): string {
  const seconds = Math.round(capMs / 1000)
  const shared = `${name} did not answer within ${seconds}s, and what became of the call could not be learned from it afterwards`
  if (left) {
    return `${shared}; the request was left with ${name}, so the command may have run or may still be running there. Check its effect on ${name} before repeating it.`
  }
  return `${shared}, so it was withdrawn there; it may have partially run. Check its effect on ${name} before repeating it.`
}

/** densable `D`. Taken back before it left this session. */
export function remoteHostTakenBackMessage(
  name: string,
  capMs: number,
): string {
  const seconds = Math.round(capMs / 1000)
  return `Nothing ran on ${name}: the call could not be sent within ${seconds}s — this session's connection to the service was backed up — and it was taken back before it left this session, so ${name} never received it. This is not a problem with ${name}; try the call again.`
}

/** densable `L`. Withdrawn while still queued here. */
export function remoteHostQueuedWithdrawnMessage(
  name: string,
  capMs: number,
): string {
  const seconds = Math.round(capMs / 1000)
  return `The call to ${name} could not be sent within ${seconds}s — this session's connection to the service was backed up — so it was withdrawn while still queued here. Most likely nothing ran on ${name}: if the call reaches it late, its withdrawal arrives with it (for a command with side effects, check before repeating it). This is not a problem with ${name}; try the call again.`
}

/** densable `H`. The liveness check itself never left. */
export function remoteHostProbeStalledMessage(
  name: string,
  capMs: number,
): string {
  const seconds = Math.round(capMs / 1000)
  return `A liveness check to ${name} could not be sent within ${seconds}s — this session's connection to the service was backed up; the call was not sent and nothing ran. This is not a problem with ${name}; try the call again.`
}

/** densable `x`. The stream closed after the call was sent. */
export function remoteHostDisconnectedMessage(name: string): string {
  return `${name} disconnected during the call. If the command had started, it has most likely continued to run there, but its result could not be delivered. Do not simply re-run it — first check whether it took effect (e.g. whether the file, commit or process now exists) or ask the user.`
}

/** densable `M`. The upload could not be confirmed. */
export function remoteHostWriteUnresolvedMessage(name: string): string {
  return `This call may or may not have reached ${name}: this session's connection to the service was backed up and the upload carrying it could not be confirmed in time, and what became of it could not be learned from ${name} afterwards. This is not a problem with ${name}. Check whether the command took effect before re-running it.`
}

/** densable `I`. Withdrawn or restarted, before or during the call. */
export function remoteHostGoneMessage(
  name: string,
  why: string,
  unsent: boolean,
): string {
  const reason =
    why === 'withdrawn'
      ? `Claude Code on ${name} withdrew from this session (it exited or stopped serving)`
      : `Claude Code on ${name} restarted`
  if (unsent) {
    return `${reason} before this call reached it; nothing ran there, and no result will arrive for it.`
  }
  return `The call was interrupted: ${reason} while the call was with it, so no result will arrive for it. It may have partially run — check its effects on ${name} before repeating it.`
}

/** densable `pOn`. */
export function remoteHostTransitFailedMessage(
  name: string,
  detail: string,
): string {
  return `The call to ${name} failed in transit (${remoteHostSanitizeText(detail, 8192)}); it may not have run.`
}

/**
 * densable `Dge` unreachable, side from `z`. `machine` is the machine not
 * answering (not announcing, or a probe it missed). `this_side` is this
 * session's stream or the session service. Session source uses `iOn`;
 * any other source uses `zAt` and drops the detail.
 */
export function remoteHostUnreachableOutcome(
  name: string,
  detail: string,
  source: 'session' | 'bridge',
  machineNotAnswering: boolean,
): string {
  if (source === 'session') {
    return remoteHostUnreachedMessage(name, detail, machineNotAnswering)
  }
  return machineNotAnswering
    ? remoteHostOfflineMessage(name)
    : remoteHostOfflineRetryMessage(name)
}

/** densable `zAt`, side `this_side`. */
export function remoteHostOfflineRetryMessage(name: string): string {
  const shared = `${name} is not answering right now — most often because Claude on it is not connected (the computer may be offline or asleep, or reconnecting after another session used it); the call did not run.`
  return `${shared} Try again shortly, or ask the user to check that Claude is running on ${name}.`
}

/** densable `N`. Session source: the call was not cleared. */
export function remoteHostApprovalNotClearedMessage(name: string): string {
  return `The approval for this call could not be verified as the user's own answer, so the call was not cleared to run on ${name} and nothing ran. Ask again and have the user approve from the terminal or desktop prompt, unedited.`
}

/** densable `k`. Any source other than session. */
export function remoteHostApprovalUnverifiedMessage(name: string): string {
  return `The approval for this call could not be verified as the user's own answer, so ${name} did not run it and nothing ran (its earlier permission request for this call may stay open there; that is harmless). To proceed, send the call again and have the user approve from the terminal or desktop prompt, unedited.`
}

/** densable `VAt`. Session source. */
export function remoteHostRefusedByMessage(
  name: string,
  message: string,
): string {
  return `[refused by ${displayRemoteHostName(name)}] ${message}`
}

/** densable `A`. Any source other than session. */
export function remoteHostRefusedUnrunMessage(
  name: string,
  message: string,
): string {
  return `[refused — did not run on ${displayRemoteHostName(name)}] ${message}`
}

/** densable `F`. */
export function remoteHostFailedOnMessage(
  name: string,
  message: string,
): string {
  return `[failed on ${displayRemoteHostName(name)}] ${message}`
}

/**
 * densable `cOn` with cause `unasked`, which is what this tool_result uses.
 * A later check uses the STILL RUNNING wording; this one does not.
 */
export function remoteHostStillUnderWayMessage(
  name: string,
  state: string,
): string {
  const lead = `${name} answered that this call is still under way there`
  if (state === 'admitting') {
    return `${lead} — it had received the call but nothing had started yet; whether it then ran is not known. Check on its effect before repeating it, or ask the user.`
  }
  if (state === 'awaiting_approval') {
    return `${lead} — it was waiting for a permission decision and nothing had run, but it no longer accepts an answer to that question, so check on its effect before retrying it, or ask the user.`
  }
  return `${lead}; its outcome is not known yet. Do not re-run it — check on its effect later, or ask the user.`
}

/** densable `ae` acknowledged. */
export function remoteHostAcknowledgedMessage(name: string): string {
  return `[refused by ${displayRemoteHostName(name)}] the machine acknowledged a decision for a call this session did not ask about`
}

/** densable `DO` / `re`. Cap, keep newline/tab, fold paired brackets. */
export function remoteHostSanitizeText(text: string, cap: number): string {
  const cleaned = text.replace(/[\p{Cc}\p{Cf}]/gu, char =>
    char === '\n' || char === '\t' ? char : '',
  )
  const capped = cleaned.length <= cap ? cleaned : cleaned.slice(0, cap)
  return capped
    .replace(/[\p{Ps}⌈⌊⌜⌞⎡-⎣˹˻]/gu, '(')
    .replace(/[\p{Pe}⌉⌋⌝⌟⎤-⎦˺˼˽]/gu, ')')
}

/** densable `ffr`. Fold the machine's home to `~`. */
export function remoteHostRelativeDir(
  workingDir: string,
  homeDir?: string,
): string {
  const home = homeDir?.replace(/[/\\]$/, '')
  if (!home) return workingDir
  if (workingDir === home) return '~'
  const rest = workingDir.slice(home.length)
  return workingDir.startsWith(home) && /^[/\\]/.test(rest)
    ? `~${rest}`
    : workingDir
}

/** densable `pfr`. Completed answers name where they ran. */
export function remoteHostRanOnMessage(
  name: string,
  workingDir: string,
  homeDir?: string,
): string {
  const folded = remoteHostRelativeDir(workingDir.trim(), homeDir)
  const stripped = folded.replace(/[\p{Cc}\p{Cf}]/gu, '')
  const dir =
    stripped === ''
      ? 'unknown directory'
      : stripped.length <= 256
        ? stripped
        : stripped.slice(0, 256)
  return `[ran on ${displayRemoteHostName(name)} · ${dir}]`
}

/** densable `B` on a string. 262144 code units. */
const REMOTE_RESULT_TEXT_CAP = 262144
const REMOTE_RESULT_BLOCK_CAP = 100
const REMOTE_RESULT_IMAGE_CAP = 8_388_608

type RemoteResultBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }
  | {
      type: 'document'
      source: { type: 'base64'; media_type: string; data: string }
    }

/** densable `oa` then `B`. */
function remoteHostCompletedBlocks(
  content: unknown,
  documents?: unknown,
): RemoteResultBlock[] {
  const mapped = mapRemoteContent(content)
  const withDocs = placeRemoteDocuments(mapped, documents)
  return capRemoteBlocks(withDocs)
}

function mapRemoteContent(content: unknown): RemoteResultBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  const blocks: RemoteResultBlock[] = []
  for (const item of content) {
    if (item === null || typeof item !== 'object') {
      blocks.push({ type: 'text', text: '[unknown content omitted]' })
      continue
    }
    const block = item as {
      type?: unknown
      text?: unknown
      source?: unknown
      mimeType?: unknown
      data?: unknown
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text })
      continue
    }
    const source = asRecord(block.source)
    const data =
      typeof source?.data === 'string'
        ? source.data
        : typeof block.data === 'string'
          ? block.data
          : undefined
    const media =
      typeof source?.media_type === 'string'
        ? source.media_type
        : typeof block.mimeType === 'string'
          ? block.mimeType
          : 'image/png'
    if (block.type === 'image' && data !== undefined) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: media, data },
      })
      continue
    }
    const kind = typeof block.type === 'string' ? block.type : 'unknown'
    blocks.push({ type: 'text', text: `[${kind} content omitted]` })
  }
  return blocks
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** densable `ee` — drop documents onto text placeholders. */
function placeRemoteDocuments(
  blocks: RemoteResultBlock[],
  documents: unknown,
): RemoteResultBlock[] {
  if (!Array.isArray(documents) || documents.length === 0) return blocks
  let remaining = REMOTE_RESULT_IMAGE_CAP
  const placed = new Map<number, RemoteResultBlock>()
  for (const doc of documents) {
    const record = asRecord(doc)
    if (!record) continue
    const at = typeof record.at === 'number' ? record.at : undefined
    const data = typeof record.data === 'string' ? record.data : undefined
    const media =
      typeof record.media_type === 'string' ? record.media_type : undefined
    if (at === undefined || data === undefined || media === undefined) continue
    const slot = blocks[at]
    if (
      slot?.type !== 'text' ||
      !slot.text.startsWith('(a PDF read on ') ||
      placed.has(at) ||
      data.length > remaining ||
      data.length < 8 ||
      !Buffer.from(data.slice(0, 8), 'base64')
        .subarray(0, 5)
        .equals(Buffer.from('%PDF-'))
    ) {
      continue
    }
    remaining -= data.length
    placed.set(at, {
      type: 'document',
      source: { type: 'base64', media_type: media, data },
    })
  }
  if (placed.size === 0) return blocks
  return blocks.map((block, index) => placed.get(index) ?? block)
}

function capRemoteBlocks(blocks: RemoteResultBlock[]): RemoteResultBlock[] {
  const sliced = blocks.slice(0, REMOTE_RESULT_BLOCK_CAP)
  let textLeft = REMOTE_RESULT_TEXT_CAP
  const out: RemoteResultBlock[] = []
  for (const block of sliced) {
    if (block.type === 'text') {
      const slice = block.text.slice(0, Math.max(0, textLeft))
      if (slice.trim() !== '') out.push({ type: 'text', text: slice })
      textLeft -= slice.length
      continue
    }
    if (block.type === 'image') {
      if (block.source.data.length <= REMOTE_RESULT_IMAGE_CAP) {
        out.push(block)
      } else {
        out.push({
          type: 'text',
          text: '(an image in the answer was dropped: too large, or not sent inline)',
        })
      }
      continue
    }
    out.push(block)
  }
  return out
}

const BASH_OUTPUT_FIELDS = new Set([
  'backgroundTaskId',
  'stdout',
  'stderr',
  'interrupted',
  'timedOutAfterMs',
  'noOutputExpected',
])

/** densable `de` / `Ibn`. Keep only the fields this tool may return. */
function remoteHostAllowedOutput(
  output: unknown,
): Record<string, unknown> | undefined {
  const record = asRecord(output)
  if (!record) return undefined
  const kept: Record<string, unknown> = {}
  for (const key of BASH_OUTPUT_FIELDS) {
    if (key in record) kept[key] = record[key]
  }
  return Object.keys(kept).length > 0 ? kept : undefined
}

/** densable `oe`. */
export function remoteHostUnreadableEnvelopeMessage(name: string): string {
  return `${name} answered in a result format this session cannot read (Claude Code version mismatch?); the command probably ran there — check its effect before repeating it.`
}

/** densable `aOn`. Both sizes are MiB to two decimals. */
export function remoteHostTooLargeMessage(
  name: string,
  requestBytes: number,
  capBytes: number,
): string {
  const mib = (bytes: number) => (bytes / 1_048_576).toFixed(2)
  return `This call's input is ${mib(requestBytes)} MiB, over the ${mib(capBytes)} MiB limit for calls to ${name}; it was not sent.`
}

/** densable `hfr` — at most 8 notes, each capped at 2000. */
function remoteHostNotes(name: string, notes: unknown): string[] {
  if (!Array.isArray(notes) || notes.length === 0) return []
  const shown = notes.slice(0, 8).map(note => {
    const text = typeof note === 'string' ? note : ''
    return `[note from ${name}] ${remoteHostSanitizeText(text, 2000)}`
  })
  if (notes.length > 8) shown.push(`(${notes.length - 8} more notes omitted)`)
  return shown
}

export type RemoteEnvelopeRender = {
  content: string | RemoteResultBlock[]
  isError: boolean
  output?: Record<string, unknown>
}

/** densable `dOn` / `uOn`. */
function envelopeReplayNote(
  envelope: Record<string, unknown>,
): string | undefined {
  const outcome =
    envelope.outcome === 'completed' ||
    envelope.outcome === 'refused' ||
    envelope.outcome === 'failed'
      ? envelope.outcome
      : 'completed'
  if (envelope.afterReconnect === true) {
    if (outcome === 'refused') {
      return '(delivered after reconnect — the first reply was lost; this is the refusal recorded then, nothing ran)'
    }
    if (outcome === 'failed') {
      return '(delivered after reconnect — the first reply was lost; this is how the call ended, it was not run again)'
    }
    return '(delivered after reconnect — the first reply was lost; this is the recorded result, the command was not run again)'
  }
  if (envelope.replayed === true) {
    const servedAt = envelope.served_at
    const when =
      typeof servedAt === 'number' &&
      Number.isFinite(servedAt) &&
      Math.abs(servedAt) <= 8640000000000000
        ? `at ${utcClock(servedAt)} UTC`
        : 'earlier'
    if (outcome === 'refused') {
      return `(replayed — this is the refusal recorded ${when}; nothing ran then or now)`
    }
    if (outcome === 'failed') {
      return `(replayed — this is how the call ended ${when}; it was not run again)`
    }
    return `(replayed — this call already ran ${when}; it was not run again)`
  }
  return undefined
}

function utcClock(ms: number): string {
  const date = new Date(ms)
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map(part => String(part).padStart(2, '0'))
    .join(':')
}

function envelopeHasTarget(envelope: Record<string, unknown>): boolean {
  const target = asRecord(envelope.target)
  return (
    target !== undefined &&
    typeof target.name === 'string' &&
    typeof target.working_dir === 'string'
  )
}

/**
 * densable `ae`. Undefined when the envelope is not one of these outcomes,
 * so the caller keeps the answer text.
 */
export function remoteHostEnvelopeMessage(
  name: string,
  source: 'session' | 'bridge',
  envelope: Record<string, unknown>,
  content: unknown,
  homeDir?: string,
): RemoteEnvelopeRender | undefined {
  const outcome = envelope.outcome
  if (typeof outcome !== 'string') return undefined
  if (
    (outcome === 'completed' ||
      outcome === 'refused' ||
      outcome === 'failed' ||
      outcome === 'needs_approval' ||
      outcome === 'in_progress' ||
      outcome === 'acknowledged') &&
    !envelopeHasTarget(envelope)
  ) {
    return {
      content: remoteHostUnreadableEnvelopeMessage(name),
      isError: true,
    }
  }
  const message =
    typeof envelope.message === 'string'
      ? remoteHostSanitizeText(envelope.message, 2000)
      : ''
  if (outcome === 'completed') {
    const target = asRecord(envelope.target)
    const workingDir =
      typeof target?.working_dir === 'string' ? target.working_dir : ''
    const blocks = remoteHostCompletedBlocks(
      envelope.content !== undefined ? envelope.content : content,
      envelope.documents,
    )
    const prefix: RemoteResultBlock = {
      type: 'text',
      text: remoteHostRanOnMessage(name, workingDir, homeDir),
    }
    const replayed = envelopeReplayNote(envelope)
    const withReplay =
      replayed === undefined
        ? [prefix, ...blocks]
        : [prefix, ...blocks, { type: 'text' as const, text: replayed }]
    return {
      content: withReplay,
      isError: envelope.is_error === true,
      output: remoteHostAllowedOutput(envelope.output),
    }
  }
  const withNotes = (text: string) => {
    const notes = remoteHostNotes(name, envelope.notes)
    const replayed = envelopeReplayNote(envelope)
    const parts = [text, ...notes]
    if (replayed !== undefined) parts.push(replayed)
    return parts.length === 1 ? text : parts.join('\n')
  }
  if (outcome === 'refused') {
    if (envelope.code === 'no_approval') {
      const text =
        source === 'session'
          ? remoteHostApprovalNotClearedMessage(name)
          : remoteHostApprovalUnverifiedMessage(name)
      return { content: withNotes(text), isError: true }
    }
    const text =
      source === 'session'
        ? remoteHostRefusedByMessage(name, message)
        : remoteHostRefusedUnrunMessage(name, message)
    return { content: withNotes(text), isError: true }
  }
  if (outcome === 'failed') {
    return {
      content: withNotes(remoteHostFailedOnMessage(name, message)),
      isError: true,
    }
  }
  if (outcome === 'in_progress') {
    const state =
      typeof envelope.state === 'string' ? envelope.state : 'running'
    return {
      content: remoteHostStillUnderWayMessage(name, state),
      isError: true,
    }
  }
  if (outcome === 'acknowledged') {
    return { content: remoteHostAcknowledgedMessage(name), isError: true }
  }
  return undefined
}

/** densable `se`. The remote side answered, and the answer was an error. */
export function remoteHostAnsweredErrorMessage(
  name: string,
  detail: string,
): string {
  return `The connection to ${name} answered with an error: ${detail} — ${name}'s Claude Code did not report running the call; whether it ran there is not known, so check its effect before repeating it.`
}

/** densable `R`. A below-floor sender reported the call refused. */
export function remoteHostUnverifiedRefusalMessage(name: string): string {
  return `A sender this session could not verify reported this call refused, and ${name} could not be asked what became of it; whether it ran there is not confirmed. Check its effect before re-running it.`
}

/** densable `Eu` — the turn interrupted the tool call. */
export const REMOTE_HOST_INTERRUPTED =
  '[Request interrupted by user for tool use]'

/**
 * densable `iOn`. A session-source machine that failed its liveness check.
 * `this_side` stops before the "do not call again" tail.
 */
export function remoteHostUnreachedMessage(
  name: string,
  detail: string,
  machineNotAnswering = false,
): string {
  const shared = `${name} could not be reached from this session (${detail}); the call did not run. If Claude is not running on ${name}, or is no longer connected to this session, ask the user to check it; a call that was too large to deliver will not succeed on a retry.`
  if (!machineNotAnswering) return shared
  return `${shared} Do not call ${name} again in this turn: do the rest of the task without ${name}, and tell the user what is blocked. Check once more only when the user says it is back or asks you to try again.`
}

const NOT_CONNECTED =
  'the computer may be asleep or offline, Claude may not be running on it, running tools for cloud sessions may be switched off on it, or this session could not verify it'

/** densable `afr` — no channel and no machine, so nothing can be reached. */
export function remoteHostUnreachableMessage(): string {
  return "The user's computer could not be reached right now; the call did not run. Do not call it again in this turn: do the rest of the task without it, and tell the user what is blocked. Check once more only when the user says it is back or asks you to try again."
}

/** densable `Qdo` — a channel exists but no machine has announced yet. */
export function remoteHostConnectingMessage(name: string): string {
  const shown = displayRemoteHostName(name)
  return `The user's computer is not ready yet — it may still be connecting (or running tools for cloud sessions is switched off on it, or this session could not verify it), so this session cannot tell yet whether "${shown}" is its name; the call did not run. Try once more in a few seconds; if it is still not ready, tell the user.`
}

/** densable `tuo` — a machine is linked, but none of them are online. */
export function remoteHostNotConnectedMessage(): string {
  return `The user's computer is linked to this session, but Claude on it has not connected — ${NOT_CONNECTED}; the call did not run. Ask the user to check that Claude is running on that computer.`
}

/** densable `suo` — the named machine withdrew and this session cannot run the tool. */
export function remoteHostWithdrawnMessage(
  name: string,
  toolName: string,
): string {
  return `${name} is no longer attached to this session, and this session's own environment has no ${toolName}: there is nowhere to run it until a computer that serves ${toolName} attaches again. Nothing ran; do not retry it here with another tool.`
}

/** densable `luo` — this machine dropped the tool and this session has none. */
export function remoteHostLostToolMessage(
  name: string,
  toolName: string,
): string {
  return `${name} does not serve ${toolName} right now (its Claude Code there may have restarted without it, or be an older version), and this session's own environment has no ${toolName}; nothing ran.`
}

/** densable `nuo` — announced, but the name or version cannot be read. */
export function remoteHostUnreadableToolMessage(
  name: string,
  toolName: string,
): string {
  return `${name} announced ${toolName} in a form this session cannot read (a version or naming mismatch between the two Claude Code builds — update whichever is older); nothing ran.`
}

/** densable `auo` — forwarding is not available and this session has no such tool. */
export function remoteHostNotAvailableMessage(
  name: string,
  toolName: string,
): string {
  return `Running ${toolName} on ${name} is not available in this session right now, and this session's own environment has no ${toolName}; it did not run.`
}

/** densable `lfr` — announced, but it serves no tool. */
export function remoteHostServesNothingMessage(name: string): string {
  const shown = displayRemoteHostName(name)
  return `"${shown}" cannot run anything for this session right now: Claude on that computer stopped offering its tools here (the Claude app there may have closed or lost its connection, or running tools for cloud sessions was switched off on it). Nothing was sent. Ask the user to check that Claude is running on that computer, and to open the Claude app there if it was closed; if this session got the computer by asking to use one of its folders, look the folders up and ask to use that folder again afterwards.`
}

/** densable `iuo` — this machine does not serve it; another one does. */
export function remoteHostServedElsewhereMessage(
  name: string,
  toolName: string,
  servedBy: string,
): string {
  return `${name} does not serve ${toolName}, and this session's own environment has none; ${servedBy} serves it — set "${REMOTE_TOOL_HOST_FIELD}" to "${servedBy}" or omit it. Nothing ran.`
}

/** densable `cuo` — the machine is up but does not serve this tool. */
export function remoteHostToolNotServedMessage(
  name: string,
  toolName: string,
  served: readonly string[],
): string {
  const elsewhere =
    served.length === 0
      ? ''
      : ` — or do it on ${name} through a tool it does serve there (${served.join(', ')})`
  return `${name} does not serve ${toolName} right now (its Claude Code may be an older version); omit "${REMOTE_TOOL_HOST_FIELD}" to run it in this session's own environment${elsewhere}.`
}

/**
 * densable `Gbo` — hold until this name is announced, the signal aborts,
 * or the deadline passes. Already announced returns immediately.
 */
export async function waitForAnnouncedMachine(
  name: string,
  signal: AbortSignal,
  deadlineMs = REMOTE_ANNOUNCE_WAIT_MS,
  toolState?: ToolStateSlots,
): Promise<'announced' | 'aborted' | 'gave_up'> {
  const registry = sessionRegistry(toolState)
  const machines = () => registry.machines
  if (machines().some(machine => machine.name === name)) {
    return 'announced'
  }
  const started = Date.now()
  while (!signal.aborted) {
    const left = deadlineMs - (Date.now() - started)
    if (left <= 0) {
      registry.markAnnounceWaitExpired(Date.now() - started)
      return 'gave_up'
    }
    const slice = Math.min(REMOTE_ANNOUNCE_WAIT_SLICE_MS, left)
    const kind = await new Promise<'announced' | 'aborted' | 'slice'>(
      resolve => {
        const finish = (kind: 'announced' | 'aborted' | 'slice') => {
          clearTimeout(timer)
          unsubscribe()
          signal.removeEventListener('abort', abort)
          resolve(kind)
        }
        const abort = () => finish('aborted')
        const unsubscribe = registry.onNextAnnounce(() => finish('announced'))
        const timer = setTimeout(() => finish('slice'), slice)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      },
    )
    if (kind === 'aborted') return 'aborted'
    if (machines().some(machine => machine.name === name)) {
      return 'announced'
    }
  }
  return 'aborted'
}

/** A machine that lists this tool, MCP passthrough or served. */
export function machineServingTool(
  toolName: string,
  toolState?: ToolStateSlots,
): AnnouncedRemoteMachine | undefined {
  return sessionRegistry(toolState).machines.find(
    machine =>
      machine.status === 'online' &&
      (machine.tools.some(tool => tool.name === toolName) ||
        machine.passthroughTools.includes(toolName)),
  )
}

export function machineAdoptingMcpTool(
  toolName: string,
  toolState?: ToolStateSlots,
): AnnouncedRemoteMachine | undefined {
  const machines = sessionRegistry(toolState).machines
  const matches = (source: AnnouncedRemoteMachine['source']) =>
    machines.find(
      machine =>
        machine.source === source &&
        machine.status === 'online' &&
        machine.passthroughTools.includes(toolName),
    )
  return matches('session') ?? matches('bridge')
}

/** densable worker epoch: unset or not a positive integer is 1. */
export function remoteToolsWorkerEpoch(): number {
  const raw = process.env.CLAUDE_CODE_WORKER_EPOCH
  if (raw === undefined || raw.trim() === '') return 1
  const value = Number(raw.trim())
  if (!Number.isInteger(value) || value < 1) return 1
  return value
}

/** densable `Git` — one reannounce request per session slot. */
export class RemoteToolsReannounce {
  #asked = false

  askOnce(send: () => void): boolean {
    if (this.#asked) return false
    this.#asked = true
    send()
    return true
  }
}

const defaultReannounce = new RemoteToolsReannounce()

export function askRemoteToolsReannounce(
  send: (request: {
    subtype: 'remote_tools_reannounce'
    workerEpoch: number
    deadlineMs: number
  }) => void,
  deadlineMs: number,
  toolState?: ToolStateSlots,
): boolean {
  const epoch = remoteToolsWorkerEpoch()
  if (
    epoch <= 1 ||
    isRemoteToolsSessionChannelOff() ||
    !isViolinWoodEnabledSync() ||
    sessionRegistry(toolState).machines.length > 0
  ) {
    return false
  }
  const slot = toolState?.get(RemoteToolsReannounce) ?? defaultReannounce
  return slot.askOnce(() => {
    send({ subtype: 'remote_tools_reannounce', workerEpoch: epoch, deadlineMs })
  })
}

/**
 * densable `lr`: unknown → `sOn`, offline → `zAt`, not served → `cuo`,
 * a version outside `Cje` → `Q8t`.
 */
export function remoteHostRoute(
  input: unknown,
  toolName: string,
  channelOpen = false,
  toolState?: ToolStateSlots,
):
  | { kind: 'local' }
  | { kind: 'error'; message: string }
  | { kind: 'remote'; machine: AnnouncedRemoteMachine } {
  const requested = requestedRemoteHost(input)
  if (!isRemoteToolsForwardEnabled() || requested === undefined) {
    return { kind: 'local' }
  }
  const zo = sessionRegistry(toolState)
  const machines = zo.machines
  const resolved = resolveAnnouncedMachine(requested, toolState)
  if (resolved.kind === 'unknown' || resolved.kind === 'case') {
    if (zo.withdrawn.has(requested)) {
      return {
        kind: 'error',
        message: remoteHostWithdrawnMessage(requested, toolName),
      }
    }
    if (machines.length === 0) {
      return {
        kind: 'error',
        message: channelOpen
          ? remoteHostConnectingMessage(requested)
          : remoteHostUnreachableMessage(),
      }
    }
    if (machines.every(machine => machine.status === 'offline')) {
      return { kind: 'error', message: remoteHostNotConnectedMessage() }
    }
    return {
      kind: 'error',
      message: remoteHostUnknownMessage(requested, toolState),
    }
  }
  const toolVersions = resolved.machine.tools.find(
    tool => tool.name === toolName,
  )?.protocolVersions
  const versions =
    toolVersions && toolVersions.length > 0
      ? toolVersions
      : resolved.machine.protocolVersions
  if (
    versions.length > 0 &&
    !versions.some(version =>
      (REMOTE_TOOL_PROTOCOL_VERSIONS as readonly number[]).includes(version),
    )
  ) {
    return {
      kind: 'error',
      message: remoteHostIncompatibleMessage(
        resolved.machine.name,
        versions,
        toolName,
        false,
        toolState,
      ),
    }
  }
  // densable `lr`: only a non-session offline machine is refused here.
  // A session-source machine stays remote; `W` probes it.
  if (
    resolved.machine.status === 'offline' &&
    resolved.machine.source !== 'session'
  ) {
    return {
      kind: 'error',
      message: remoteHostOfflineMessage(resolved.machine.name),
    }
  }
  if (resolved.machine.rejectedPassthrough.includes(toolName)) {
    return {
      kind: 'error',
      message: remoteHostUnreadableToolMessage(resolved.machine.name, toolName),
    }
  }
  if (!resolved.machine.tools.some(tool => tool.name === toolName)) {
    if (resolved.machine.tools.length === 0) {
      return {
        kind: 'error',
        message: remoteHostServesNothingMessage(resolved.machine.name),
      }
    }
    const elsewhere = machines.find(
      machine =>
        machine.name !== resolved.machine.name &&
        machine.status === 'online' &&
        machine.tools.some(tool => tool.name === toolName),
    )
    return {
      kind: 'error',
      message: elsewhere
        ? remoteHostServedElsewhereMessage(
            resolved.machine.name,
            toolName,
            elsewhere.name,
          )
        : remoteHostLostToolMessage(resolved.machine.name, toolName),
    }
  }
  return { kind: 'remote', machine: resolved.machine }
}

/**
 * densable `lr` error, or undefined when the call stays here or can be sent.
 */
export function remoteHostRefusalMessage(
  input: unknown,
  toolName = '',
  toolState?: ToolStateSlots,
): string {
  const route = remoteHostRoute(input, toolName, false, toolState)
  return route.kind === 'error'
    ? route.message
    : remoteHostUnknownMessage('', toolState)
}

/**
 * densable `BT() && xd(input)` — Bash uses `dK().requested`, same shape.
 * Forwarding off, or no machine named, returns undefined (run here).
 */
export function remoteHostForwardRefusal(
  input: unknown,
  toolName = '',
  toolState?: ToolStateSlots,
): { result: false; message: string } | undefined {
  const requested = requestedRemoteHost(input)
  if (!isRemoteToolsForwardEnabled() || requested === undefined) {
    return undefined
  }
  const resolved = resolveAnnouncedMachine(requested, toolState)
  if (resolved.kind === 'remote' && resolved.machine.status === 'online') {
    const toolVersions = resolved.machine.tools.find(
      tool => tool.name === toolName,
    )?.protocolVersions
    const versions =
      toolVersions && toolVersions.length > 0
        ? toolVersions
        : resolved.machine.protocolVersions
    if (
      versions.length > 0 &&
      !versions.some(version =>
        (REMOTE_TOOL_PROTOCOL_VERSIONS as readonly number[]).includes(version),
      )
    ) {
      return {
        result: false,
        message: remoteHostIncompatibleMessage(
          resolved.machine.name,
          versions,
          toolName,
          true,
          toolState,
        ),
      }
    }
    return undefined
  }
  const route = remoteHostRoute(input, toolName, false, toolState)
  if (route.kind !== 'error') return undefined
  return { result: false, message: route.message }
}
