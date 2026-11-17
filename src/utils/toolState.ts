import { isDeepStrictEqual } from 'util'

/**
 * densable `wN`. Session slot map: `get(Ctor)` returns the instance already
 * stored for that constructor, or constructs one and keeps it.
 */
export class ToolStateSlots {
  #slots = new Map<unknown, unknown>()

  get<T>(ctor: new () => T): T {
    const existing = this.#slots.get(ctor)
    if (existing instanceof ctor) return existing
    const created = new ctor()
    this.#slots.set(ctor, created)
    return created
  }
}

/** densable permission-prompt counter slot — blocks detach while > 0. */
export class ToolPermissionPromptsUp {
  count = 0
}

/** densable `KLe` — remote background-shell index (last 16 per host). */
export type RemoteBackgroundShell = {
  hostName: string
  callId: string
  agentId?: string
}

/** densable `O` — last-N per host (error copy still says 16). */
const REMOTE_BACKGROUND_SHELL_CAP = 64

/**
 * densable `C` — device-bridge listing slot (`He` / `Fe` in-flight).
 */
export class RemoteBridgeListing {
  inFlight: Promise<void> | undefined
  reportedUnmatched = false
}

export class RemoteBackgroundShells {
  #t = new Map<string, RemoteBackgroundShell>()

  started(taskId: string, rec: RemoteBackgroundShell): void {
    this.#t.set(taskId, this.#t.get(taskId) ?? rec)
    const sameHost = [...this.#t].filter(([, r]) => r.hostName === rec.hostName)
    if (sameHost.length > REMOTE_BACKGROUND_SHELL_CAP) {
      this.#t.delete(sameHost[0]?.[0] ?? taskId)
    }
  }

  find(taskId: string, agentId?: string): RemoteBackgroundShell | undefined {
    const e = this.#t.get(taskId)
    if (!e) return undefined
    if (agentId !== undefined && e.agentId !== agentId) return undefined
    return e
  }
}

/**
 * densable `rF` — resolve a recorded hostName to local / remote / unknown.
 * `tE` reserved names (`container`, `this-machine`) are local-kind: Jbo
 * does not call, then throws no-status.
 */
export type RemoteToolTransportCall = {
  kind:
    | 'result'
    | 'unreachable'
    | 'timed_out'
    | 'transport_error'
    | 'dropped'
    | 'cancelled'
    | 'approval_unverified'
  envelope?: {
    outcome?: string
    output?: unknown
    content?: unknown
  }
  detail?: string
  unreadableResult?: boolean
  /** densable `Re` — wall time of the MCP round trip. */
  elapsedMs?: number
  /** densable `Re` / `Yv` — utf8 byte length of the raw MCP result. */
  responseBytes?: number
  /** densable `X` `not_connected`. */
  machineNotAnswering?: boolean
  /** densable `X`/`J` `timed_out`. */
  capMs?: number
  content?: unknown
  isError?: boolean
  metaCopy?: 'omitted' | 'attached'
  structuredContent?: unknown
  text?: string
}

const REMOTE_HOST_SOURCES = ['session', 'bridge', 'loopback'] as const
export type RemoteHostSource = (typeof REMOTE_HOST_SOURCES)[number]

export type RemoteToolHostProtocol =
  | { kind: 'compatible'; version?: number }
  | { kind: 'incompatible'; announced: number[] }

export type RemoteToolRoutedHost = {
  kind?: 'remote'
  source?: RemoteHostSource
  name: string
  hostName: string
  instanceId: string
  /** densable host `status` — Noe empty keep stamps `offline`. */
  status?: 'online' | 'offline'
  enforcement?: 'self' | 'host'
  servedTools?: Set<string>
  passthroughTools?: Map<string, { localName: string }>
  plumbingTools?: Set<string>
  rejectedPassthroughTools?: Set<string>
  description?: { name: string; kind?: string; platform?: string }
  protocol?: RemoteToolHostProtocol
  transport: {
    /** densable `W` — structural extra on the device-bridge transport. */
    kind?: 'bridge'
    limits?: {
      maxRequestBytes: number
      defaultDeadlineMs: number
    }
    call: (
      toolName: string,
      input: Record<string, unknown>,
      envelope: Record<string, unknown>,
      opts: {
        signal: AbortSignal
        deadlineMs: number
        toolUseId: string
      },
    ) => Promise<RemoteToolTransportCall | undefined>
    callPlumbing?: (
      toolName: string,
      input: Record<string, unknown>,
      opts: {
        signal: AbortSignal
        deadlineMs: number
        idempotent?: boolean
      },
    ) => Promise<RemoteToolTransportCall | undefined>
  }
}

/** densable `replaceRemoteHosts` row — gold stores the ToolHost as-is. */
export type RemoteToolReplaceHost = {
  source: RemoteHostSource
  name: string
  instanceId: string
  status?: 'online' | 'offline'
  enforcement?: 'self' | 'host'
  servedTools?: Set<string>
  passthroughTools?: Map<string, { localName: string }>
  plumbingTools?: Set<string>
  rejectedPassthroughTools?: Set<string>
  description?: { name: string; kind?: string; platform?: string }
  protocol?: RemoteToolHostProtocol
  /** gold stores the ToolHost as-is, including native `transport`. */
  transport?: RemoteToolRoutedHost['transport']
}

export type ResolvedRemoteToolHost =
  | {
      kind: 'local'
      host: { kind: 'local'; name: string; enforcement: 'host' }
    }
  | { kind: 'remote'; host: RemoteToolRoutedHost }
  | { kind: 'unknown' }

/** densable `wz`. */
function defaultLocalHostName(): string {
  return process.env.CLAUDE_CODE_REMOTE ? 'container' : 'this-machine'
}

function hostsSnapshotEqual(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b)
}

export class RemoteToolHosts {
  #e = new Map<RemoteHostSource, Map<string, RemoteToolRoutedHost>>()

  get defaultHost(): { kind: 'local'; name: string; enforcement: 'host' } {
    return { kind: 'local', name: defaultLocalHostName(), enforcement: 'host' }
  }

  sourceHosts(source: RemoteHostSource): RemoteToolRoutedHost[] {
    return [...(this.#e.get(source)?.values() ?? [])]
  }

  /** densable `passthroughHost` — first online/offline host adopting `toolName`. */
  passthroughHost(toolName: string): RemoteToolRoutedHost | undefined {
    return this.#n().find(host => host.passthroughTools?.has(toolName) === true)
  }

  /**
   * densable `hosts` — local default plus `#t()` remotes (online first,
   * then merge same name filling passthroughTools).
   */
  hosts(): Array<
    { kind: 'local'; name: string; enforcement: 'host' } | RemoteToolRoutedHost
  > {
    return [this.defaultHost, ...this.#t()]
  }

  /** densable `#n` — online rows before offline, source order inside each. */
  #n(): RemoteToolRoutedHost[] {
    const rows = REMOTE_HOST_SOURCES.flatMap(src => [
      ...(this.#e.get(src)?.values() ?? []),
    ])
    return [
      ...rows.filter(host => host.status === 'online'),
      ...rows.filter(host => host.status !== 'online'),
    ]
  }

  /** densable `#t` — unique names, passthrough filled from a later source. */
  #t(): RemoteToolRoutedHost[] {
    const merged = this.#n().reduce((bag, row) => {
      const existing = bag.get(row.name)
      if (existing === undefined) {
        bag.set(row.name, row)
        return bag
      }
      const next =
        existing.passthroughTools === undefined &&
        row.passthroughTools !== undefined
          ? {
              ...existing,
              passthroughTools: row.passthroughTools,
              ...(row.rejectedPassthroughTools !== undefined && {
                rejectedPassthroughTools: row.rejectedPassthroughTools,
              }),
            }
          : existing
      if (next !== existing) bag.set(row.name, next)
      return bag
    }, new Map<string, RemoteToolRoutedHost>())
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * densable `replaceRemoteHosts`. Hosts must all carry this source.
   * Invalid/duplicate names are dropped (gold `nZ`).
   */
  replaceRemoteHosts(
    source: RemoteHostSource,
    hosts: RemoteToolReplaceHost[],
  ): { changed: boolean; dropped: string[] } {
    if (hosts.find(h => h.source !== source)) {
      throw new Error(
        'replaceRemoteHosts was handed a ToolHost registered by another source',
      )
    }
    const { isReservedRemoteHostName } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/tools/remoteToolHost.js') as typeof import('../services/tools/remoteToolHost.js')
    const bag = new Map<string, RemoteToolRoutedHost>()
    const dropped: string[] = []
    for (const h of hosts) {
      // densable `nZ`: reserved tE names and invalid/duplicate ids are dropped.
      if (
        isReservedRemoteHostName(h.name) ||
        !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(h.name) ||
        bag.has(h.name)
      ) {
        dropped.push(h.name)
        continue
      }
      const bound = h.transport
        ? undefined
        : this.#bind({
            instanceId: h.instanceId,
            hostName: h.name,
            live: null,
            stale: false,
          })
      bag.set(h.name, {
        ...(bound ?? {
          name: h.name,
          hostName: h.name,
          instanceId: h.instanceId,
          transport: h.transport!,
        }),
        kind: 'remote',
        source,
        status: h.status ?? bound?.status ?? 'online',
        enforcement: h.enforcement ?? 'self',
        servedTools: h.servedTools ?? new Set(),
        ...(h.passthroughTools !== undefined && {
          passthroughTools: h.passthroughTools,
        }),
        ...(h.plumbingTools !== undefined && {
          plumbingTools: h.plumbingTools,
        }),
        ...(h.rejectedPassthroughTools !== undefined && {
          rejectedPassthroughTools: h.rejectedPassthroughTools,
        }),
        ...(h.description !== undefined && { description: h.description }),
        ...(h.protocol !== undefined && { protocol: h.protocol }),
      })
    }
    // densable `Noe`: empty replace on bridge/loopback keeps prior hosts offline.
    const keepEmptyOffline = source !== 'session'
    const prev = this.#e.get(source) ?? new Map()
    const before = this.#snapshot()
    const offlineKeep: Array<[string, RemoteToolRoutedHost]> =
      bag.size > 0 || !keepEmptyOffline
        ? []
        : [...prev].map(([name, rec]) => [
            name,
            { ...rec, status: 'offline' as const },
          ])
    const next = new Map(this.#e)
    next.set(source, new Map([...offlineKeep, ...bag]))
    this.#e = next
    return {
      changed: !hostsSnapshotEqual(before, this.#snapshot()),
      dropped,
    }
  }

  #snapshot(): Array<{
    source: RemoteHostSource | undefined
    name: string
    instanceId: string
    status: 'online' | 'offline'
    enforcement: 'self' | 'host' | undefined
    description: { name: string; kind?: string; platform?: string } | undefined
    servedTools: string[]
    passthroughTools: Array<[string, string]>
    rejectedPassthroughTools: string[]
    protocol: RemoteToolHostProtocol | undefined
    transport: 'bridge' | undefined
  }> {
    return this.#t().map(h => ({
      source: h.source,
      name: h.name,
      instanceId: h.instanceId,
      status: h.status ?? 'online',
      enforcement: h.enforcement,
      description: h.description,
      servedTools: [...(h.servedTools ?? [])].sort(),
      passthroughTools: [...(h.passthroughTools?.entries() ?? [])]
        .map(([k, v]): [string, string] => [k, v.localName])
        .sort(([a], [b]) => a.localeCompare(b)),
      rejectedPassthroughTools: [...(h.rejectedPassthroughTools ?? [])].sort(),
      protocol: h.protocol,
      transport: h.transport.kind,
    }))
  }

  resolve(name: string): ResolvedRemoteToolHost {
    const { isReservedRemoteHostName } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/tools/remoteToolHost.js') as typeof import('../services/tools/remoteToolHost.js')
    if (isReservedRemoteHostName(name)) {
      return { kind: 'local', host: this.defaultHost }
    }
    const routed = this.#t().find(host => host.name === name)
    return routed ? { kind: 'remote', host: routed } : { kind: 'unknown' }
  }

  #bind(
    announced: import('../services/tools/remoteToolCall.js').RemoteToolHost,
  ): RemoteToolRoutedHost {
    return {
      name: announced.hostName,
      hostName: announced.hostName,
      instanceId: announced.instanceId,
      status: announced.live?.status ?? 'offline',
      transport: createSessionRemoteToolTransport(() => announced),
    }
  }
}

/** Session rows retain a transport reading the announce registry's live state. */
export function createSessionRemoteToolTransport(
  host: () => import('../services/tools/remoteToolCall.js').RemoteToolHost,
  lifecycle?: {
    heard: (epoch?: string) => void
    missed: () => void
    rebind: () =>
      | import('../services/tools/remoteToolCall.js').RemoteToolHost
      | undefined
  },
): RemoteToolRoutedHost['transport'] {
  const {
    callRemoteTool,
    classifyRemoteToolsProbe,
    parseRemoteToolAnswer,
    REMOTE_TOOL_PROBE_CAP_MS,
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/tools/remoteToolCall.js') as typeof import('../services/tools/remoteToolCall.js')
  return {
    async call(toolName, input, envelope, opts) {
      const sent = await callRemoteTool({
        host: host(),
        name: toolName,
        input,
        envelope,
        toolUseId: opts.toolUseId,
        signal: opts.signal,
        deadlineMs: opts.deadlineMs,
        probe: async () => {
          if (opts.signal.aborted) return 'cancelled'
          const { getCurrentStructuredIO } =
            require('../cli/structuredIO.js') as typeof import('../cli/structuredIO.js')
          const io = getCurrentStructuredIO()
          if (!io?.requestRemoteToolsProbe) return 'unsent'
          const answer = await io.requestRemoteToolsProbe({
            instanceId: host().instanceId,
            issuedAt: Date.now(),
            deadlineMs: REMOTE_TOOL_PROBE_CAP_MS,
          })
          const probe = classifyRemoteToolsProbe(answer)
          if (probe === 'answered') {
            const result = answer?.result
            const epoch =
              result !== null &&
              typeof result === 'object' &&
              typeof (result as { epoch?: unknown }).epoch === 'string'
                ? (result as { epoch: string }).epoch
                : undefined
            lifecycle?.heard(epoch)
            const current = host()
            if (current.live) {
              current.live.status = 'online'
              current.live.lastHeardAt = Date.now()
            }
          }
          return probe
        },
        onProbeMissed: () => lifecycle?.missed(),
        rebind: () => lifecycle?.rebind(),
        send: request => {
          const { getCurrentStructuredIO } =
            require('../cli/structuredIO.js') as typeof import('../cli/structuredIO.js')
          return (
            getCurrentStructuredIO()?.requestRemoteToolCall(request) ??
            Promise.resolve(undefined)
          )
        },
      })
      switch (sent.kind) {
        case 'cancelled':
        case 'unreachable':
        case 'timed_out':
        case 'transport_error':
        case 'dropped':
          return { ...sent, kind: sent.kind }
        case 'needs_approval':
          return { kind: 'approval_unverified', detail: sent.detail }
        case 'result':
          break
        default:
          return {
            kind: 'transport_error',
            detail: sent.detail ?? `unexpected: ${sent.kind}`,
          }
      }
      if (sent.response === undefined) {
        return {
          kind: 'transport_error',
          detail: 'answer without an envelope',
          unreadableResult: true,
        }
      }
      const parsed = parseRemoteToolAnswer(sent.response)
      if (parsed.envelope.status !== 'present') {
        return {
          kind: 'transport_error',
          detail: `${parsed.envelope.status} result envelope`,
          unreadableResult: true,
        }
      }
      return {
        kind: 'result' as const,
        envelope: {
          outcome:
            typeof parsed.envelope.envelope.outcome === 'string'
              ? parsed.envelope.envelope.outcome
              : undefined,
          output: parsed.envelope.envelope.output,
          content: parsed.content,
        },
        content: parsed.content,
        isError: parsed.isError,
      }
    },
  }
}
