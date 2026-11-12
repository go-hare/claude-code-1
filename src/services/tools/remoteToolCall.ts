/**
 * densable `W` @200597042, hung off `Uus().call`.
 * No announced machine → unreachable. Offline, stale, or silent for 60s
 * probes first. A send carries toolUseId, issuedAt, and deadlineMs.
 */

export const REMOTE_TOOL_HEARD_MS = 60_000
export const REMOTE_TOOL_DEADLINE_MS = 58_000

export const REMOTE_TOOL_NOT_ANNOUNCING =
  'the machine is not announcing on this session'
export const REMOTE_TOOL_STREAM_NOT_ACCEPTING =
  "this session's event stream is not accepting requests; nothing was sent"
export const REMOTE_TOOL_STREAM_LOST =
  'this session could not complete the liveness check for a reason on its own side (its event stream closed, the service refused the write that carried it, or that write had not completed in time); the machine was not reached and nothing was sent'

/** densable `OZt.maxRequestBytes`. */
export const REMOTE_TOOL_MAX_REQUEST_BYTES = 4_128_768
export const REMOTE_TOOL_WITHDREW =
  'the machine withdrew from this session while it was being asked whether it is still there; nothing was sent'
export const REMOTE_TOOL_STREAM_CLOSED =
  "this session's event stream is closed; nothing was sent"
export const REMOTE_TOOL_PROBE_MISSED =
  'the machine did not answer a liveness check on this session; nothing was sent'

/** densable `K` unconfirmed — the write had not finished by the deadline. */
export const REMOTE_TOOL_WRITE_UNRESOLVED =
  'the write carrying the request to the session service had not completed, or ended without an answer, by its deadline; whether the machine received it is unknown'

/** densable `K` undelivered — the session service refused the request. */
export function remoteToolRefusedDetail(status?: number): string {
  const http = status !== undefined ? ` (HTTP ${status})` : ''
  return `the session service refused the request${http}; nothing was delivered`
}

/** densable `K` delivery_unknown — an upload ended, a later one was refused. */
export function remoteToolDeliveryUnknownDetail(status?: number): string {
  const http = status !== undefined ? ` (HTTP ${status})` : ''
  return `an upload of the request ended without an answer and a later attempt was refused${http}; whether the machine received it is unknown`
}

/** densable `pJe` — an answer that arrived under the call's own floor. */
export const REMOTE_TOOL_BELOW_FLOOR = 'sender_below_floor'

export type RemoteToolLive = {
  status: 'online' | 'offline'
  lastHeardAt: number
}

export type RemoteToolHost = {
  instanceId: string
  hostName: string
  live: RemoteToolLive | null
  stale: boolean
}

export type RemoteToolProbe =
  | 'answered'
  | 'cancelled'
  | 'unsent'
  | 'stalled'
  | 'taken_back'
  | 'stream_lost'
  | 'gone'
  | 'missed'

export const REMOTE_TOOL_PROBE_CAP_MS = 10_000

export type RemoteToolCallResult = {
  kind:
    | 'cancelled'
    | 'unreachable'
    | 'stalled'
    | 'timed_out'
    | 'dropped'
    | 'host_gone'
    | 'needs_approval'
    | 'result'
    | 'transport_error'
    | 'too_large'
    | 'host_unresponsive'
  detail?: string
  capMs?: number
  request?: 'probe' | 'call'
  takenBack?: boolean
  /** densable `sentUnderEpoch` — the epoch this send left under. */
  sentUnderEpoch?: string
  /** The standing request, when the first deadline left it up. */
  requestId?: string
  /** densable `host_gone` — withdrawn, restarted, or gone. */
  why?: string
  /** densable `host_gone` — true when the call had not left yet. */
  unsent?: boolean
  /**
   * densable `dropped`. `write_unresolved` uses `M`. `unverified_refusal`
   * uses `R`. Anything else uses `x`.
   */
  whyDropped?: 'write_unresolved' | 'unverified_refusal'
  /**
   * densable `z`. True when the machine itself was not reached (not
   * announcing, or a probe it did not answer). False when this session's
   * own stream or the session service refused the send.
   */
  machineNotAnswering?: boolean
  /** densable `aOn` — the bytes that were over the cap. */
  requestBytes?: number
  /** densable `lOn` `left` — the standing request was left with the machine. */
  left?: boolean
  /** densable `$n` misses for `host_unresponsive`. */
  misses?: number
  /** densable `$n` whileRunning. */
  whileRunning?: boolean
  /** densable `unreadableResult` — the answer's envelope could not be read. */
  unreadableResult?: boolean
  response?: Record<string, unknown>
}

/** densable `NT`. */
export const REMOTE_TOOL_ENVELOPE_KEY = 'anthropic/remoteToolExecution'

const REMOTE_ENVELOPE_OUTCOMES = new Set([
  'completed',
  'refused',
  'failed',
  'in_progress',
  'needs_approval',
  'acknowledged',
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * densable `IF` / `Qi`. The envelope lives on the answer, or under
 * `anthropic/remoteToolExecution` on structuredContent / `_meta`.
 */
export function parseRemoteToolAnswer(payload: Record<string, unknown>): {
  content: unknown
  isError: boolean
  envelope:
    | { status: 'present'; envelope: Record<string, unknown> }
    | { status: 'absent' }
    | { status: 'malformed' }
} {
  const result = asRecord(payload.result) ?? payload
  const content = result.content
  const isError = result.isError === true
  const nested =
    asRecord(result.envelope) ??
    asRecord(asRecord(result.structuredContent)?.[REMOTE_TOOL_ENVELOPE_KEY]) ??
    asRecord(asRecord(result._meta)?.[REMOTE_TOOL_ENVELOPE_KEY])
  if (!nested) return { content, isError, envelope: { status: 'absent' } }
  if (!isRemoteEnvelopeWellFormed(nested)) {
    return { content, isError, envelope: { status: 'malformed' } }
  }
  return {
    content,
    isError,
    envelope: { status: 'present', envelope: nested },
  }
}

function isRemoteEnvelopeWellFormed(
  envelope: Record<string, unknown>,
): boolean {
  const outcome = envelope.outcome
  if (typeof outcome !== 'string' || !REMOTE_ENVELOPE_OUTCOMES.has(outcome)) {
    return false
  }
  const target = asRecord(envelope.target)
  if (
    !target ||
    typeof target.name !== 'string' ||
    typeof target.working_dir !== 'string'
  ) {
    return false
  }
  if (
    (outcome === 'refused' || outcome === 'failed') &&
    typeof envelope.message !== 'string'
  ) {
    return false
  }
  return true
}

/**
 * densable `onHeldAtDeadline`. The call has already returned timed_out.
 * `late` classifies a body that arrives on the standing request and does
 * not replace that result. `withdraw` / `takeBack` cancel it.
 */
export type RemoteToolHeld = {
  late: Promise<RemoteToolCallResult>
  withdraw: () => void
  takeBack: () => boolean
  accepted: () => boolean
}

let announced: RemoteToolHost | null = null

/** densable `e.host()` / `live()`. Announce is the only writer. */
export function noteRemoteToolHost(host: RemoteToolHost | null): void {
  announced = host
}

export function currentRemoteToolHost(): RemoteToolHost | null {
  return announced
}

export async function callRemoteTool(opts: {
  host?: RemoteToolHost
  name: string
  input: Record<string, unknown>
  envelope: Record<string, unknown>
  toolUseId: string
  signal: AbortSignal
  deadlineMs?: number
  now?: () => number
  probe?: () => Promise<RemoteToolProbe>
  rebind?: () => RemoteToolHost | undefined
  /** densable `markAway('probe_missed')` — only a miss with no later hear. */
  onProbeMissed?: () => void
  sentUnderEpoch?: string
  send?: (request: {
    instanceId: string
    host: string
    name: string
    input: Record<string, unknown>
    envelope: Record<string, unknown>
    toolUseId: string
    issuedAt: number
    deadlineMs: number
  }) => Promise<Record<string, unknown> | undefined>
}): Promise<RemoteToolCallResult> {
  const now = opts.now ?? Date.now
  if (opts.signal.aborted) return { kind: 'cancelled' }
  const host = opts.host ?? announced
  if (!host?.live) {
    return {
      kind: 'unreachable',
      detail: REMOTE_TOOL_NOT_ANNOUNCING,
      machineNotAnswering: true,
    }
  }
  const outcome = opts.envelope.op === 'outcome_of'
  if (
    !outcome &&
    (host.live.status === 'offline' ||
      host.stale ||
      now() - host.live.lastHeardAt > REMOTE_TOOL_HEARD_MS)
  ) {
    const probedAt = now()
    const probe = (await opts.probe?.()) ?? 'unsent'
    if (probe === 'cancelled') return { kind: 'cancelled' }
    if (probe === 'unsent') {
      return { kind: 'unreachable', detail: REMOTE_TOOL_STREAM_NOT_ACCEPTING }
    }
    if (probe === 'stalled' || probe === 'taken_back') {
      return {
        kind: 'stalled',
        detail: probe,
        capMs: REMOTE_TOOL_PROBE_CAP_MS,
        request: 'probe',
        takenBack: probe === 'taken_back',
      }
    }
    if (probe === 'stream_lost') {
      return { kind: 'unreachable', detail: REMOTE_TOOL_STREAM_LOST }
    }
    if (probe === 'gone') {
      return {
        kind: 'unreachable',
        detail: REMOTE_TOOL_WITHDREW,
        machineNotAnswering: true,
      }
    }
    // densable `W`: a missed probe that heard the machine after it started
    // is still here. Continue the call instead of reporting it unanswered.
    const heardDuring =
      probe === 'missed' && (host.live?.lastHeardAt ?? -Infinity) > probedAt
    if (probe !== 'answered' && !heardDuring) {
      if (probe === 'missed') opts.onProbeMissed?.()
      const rebound = opts.rebind?.()
      if (
        !rebound?.live ||
        rebound.instanceId === host.instanceId ||
        rebound.live.status === 'offline'
      ) {
        return {
          kind: 'unreachable',
          detail: REMOTE_TOOL_PROBE_MISSED,
          machineNotAnswering: true,
        }
      }
      host.instanceId = rebound.instanceId
      host.hostName = rebound.hostName
      host.live = rebound.live
    }
    // densable: a probe that heard a different instance rebinds the call.
    const rebound = opts.rebind?.()
    if (rebound?.live) {
      host.instanceId = rebound.instanceId
      host.hostName = rebound.hostName
      host.live = rebound.live
    }
    if (host.live) host.stale = false
  }
  const issuedAt = now()
  const deadlineMs = opts.deadlineMs ?? REMOTE_TOOL_DEADLINE_MS
  // densable `mqo` drops the internal host field before the wire input.
  const wireInput = { ...opts.input }
  delete wireInput._host
  const requestBytes = Buffer.byteLength(
    JSON.stringify({
      subtype: 'remote_tool_call',
      instance_id: host.instanceId,
      host: host.hostName,
      name: opts.name,
      input: wireInput,
      envelope: opts.envelope,
    }),
    'utf8',
  )
  if (requestBytes > REMOTE_TOOL_MAX_REQUEST_BYTES) {
    // densable `aOn`. Refused before it is sent. Not a cancellation.
    return { kind: 'too_large', requestBytes }
  }
  let response: Record<string, unknown> | undefined
  try {
    response = await opts.send?.({
      instanceId: host.instanceId,
      host: host.hostName,
      name: opts.name,
      input: wireInput,
      envelope: opts.envelope,
      toolUseId: opts.toolUseId,
      issuedAt,
      deadlineMs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'transport_error', detail: `send failed: ${message}` }
  }
  if (!response) return { kind: 'transport_error', detail: 'send failed' }
  return classifyRemoteToolAnswer(response, {
    deadlineMs,
    sentUnderEpoch: opts.sentUnderEpoch,
    host,
    now,
  })
}

function classifyRemoteToolAnswer(
  response: Record<string, unknown>,
  opts: {
    deadlineMs: number
    sentUnderEpoch?: string
    host?: RemoteToolHost
    now: () => number
  },
): RemoteToolCallResult {
  const { deadlineMs, host, now } = opts
  const kind = response.kind
  if (kind === 'stalled') {
    // densable `L`: still in the outbound queue at the deadline. Taken
    // back when this call may be withdrawn; otherwise just cancelled.
    return {
      kind: 'stalled',
      detail: response.takenBack === true ? 'taken_back' : 'stalled',
      capMs: deadlineMs,
      request: 'call',
      takenBack: response.takenBack === true,
    }
  }
  if (kind === 'deadline') {
    // densable `L`: first deadline returns timed_out and leaves the same
    // request standing. No second remote_tool_call. The caller classifies
    // a late body through `requestId`; it does not replace this result.
    const requestId =
      typeof response.requestId === 'string' ? response.requestId : undefined
    return {
      kind: 'timed_out',
      detail: 'timed_out',
      capMs: deadlineMs,
      ...(requestId !== undefined && { requestId }),
      ...(opts.sentUnderEpoch !== undefined && {
        sentUnderEpoch: opts.sentUnderEpoch,
      }),
    }
  }
  if (kind === 'unreachable') {
    const detail =
      typeof response.detail === 'string' ? response.detail : 'unreachable'
    return {
      kind: 'unreachable',
      detail,
      ...(response.machineNotAnswering === true && {
        machineNotAnswering: true,
      }),
    }
  }
  if (kind === 'dropped') {
    return {
      kind: 'dropped',
      detail: "this session's event stream closed after the call was sent",
    }
  }
  if (kind === 'unconfirmed') {
    return {
      kind: 'dropped',
      detail: REMOTE_TOOL_WRITE_UNRESOLVED,
      whyDropped: 'write_unresolved',
    }
  }
  if (kind === 'undelivered') {
    const status =
      typeof response.status === 'number' ? response.status : undefined
    return { kind: 'unreachable', detail: remoteToolRefusedDetail(status) }
  }
  if (kind === 'delivery_unknown') {
    const status =
      typeof response.status === 'number' ? response.status : undefined
    return {
      kind: 'dropped',
      detail: remoteToolDeliveryUnknownDetail(status),
      whyDropped: 'write_unresolved',
    }
  }
  if (kind === 'host_gone') {
    const why = typeof response.why === 'string' ? response.why : 'gone'
    return {
      kind: 'host_gone',
      detail: why,
      why,
      unsent: response.unsent === true,
    }
  }
  if (kind === 'failed') {
    const detail =
      typeof response.detail === 'string' ? response.detail : 'send failed'
    return { kind: 'transport_error', detail: `send failed: ${detail}` }
  }
  if (kind === 'cancelled') return { kind: 'cancelled' }
  const parsed = parseRemoteToolAnswer(response)
  if (parsed.envelope.status === 'malformed') {
    return {
      kind: 'transport_error',
      detail: 'malformed result envelope',
      unreadableResult: true,
    }
  }
  if (parsed.envelope.status === 'absent') {
    return { kind: 'transport_error', detail: 'answer without an envelope' }
  }
  const envelope = parsed.envelope.envelope
  // densable `P`: a below-floor refusal is not a result. The machine is
  // asked what became of it; until then the outcome is unverified.
  if (response.sender_below_floor === true && envelope.outcome === 'refused') {
    return {
      kind: 'dropped',
      detail:
        'a sender this session could not verify reported the call refused; the machine itself is asked what became of it',
      whyDropped: 'unverified_refusal',
    }
  }
  if (envelope.outcome === 'needs_approval') {
    return {
      kind: 'needs_approval',
      response: {
        ...response,
        envelope,
        content: parsed.content,
        is_error: parsed.isError,
      },
    }
  }
  if (host?.live) host.live.lastHeardAt = now()
  return {
    kind: 'result',
    response: {
      ...response,
      envelope,
      content: parsed.content,
      is_error: parsed.isError,
    },
    ...(opts.sentUnderEpoch !== undefined && {
      sentUnderEpoch: opts.sentUnderEpoch,
    }),
  }
}

/**
 * densable `K` on the standing request. A second deadline stays timed_out.
 * A real body is a side result and never replaces the first return.
 */
export async function classifyHeldBody(
  late: Promise<Record<string, unknown>>,
  ctx: { capMs: number; sentUnderEpoch?: string },
): Promise<RemoteToolCallResult> {
  const body = await late
  const epoch =
    ctx.sentUnderEpoch !== undefined
      ? { sentUnderEpoch: ctx.sentUnderEpoch }
      : {}
  if (body.kind === 'deadline') {
    return {
      kind: 'timed_out',
      detail: 'timed_out',
      capMs: ctx.capMs,
      ...epoch,
    }
  }
  if (body.kind === 'cancelled') return { kind: 'cancelled', ...epoch }
  if (body.kind === 'taken_back') {
    return {
      kind: 'stalled',
      detail: 'taken_back',
      capMs: ctx.capMs,
      request: 'call',
      takenBack: true,
      ...epoch,
    }
  }
  if (body.kind === 'dropped') {
    return {
      kind: 'dropped',
      detail: "this session's event stream closed after the call was sent",
      ...epoch,
    }
  }
  if (body.kind === 'unconfirmed') {
    return {
      kind: 'dropped',
      detail: REMOTE_TOOL_WRITE_UNRESOLVED,
      ...epoch,
    }
  }
  return {
    ...classifyRemoteToolAnswer(body, {
      deadlineMs: ctx.capMs,
      sentUnderEpoch: ctx.sentUnderEpoch,
      now: Date.now,
    }),
    ...epoch,
  }
}

/** densable `q` — classify a `remote_tools_probe` answer. */
export function classifyRemoteToolsProbe(
  response: Record<string, unknown> | undefined,
): RemoteToolProbe {
  if (!response) return 'unsent'
  const kind = response.kind
  if (kind === 'deadline') return 'missed'
  if (kind === 'unconfirmed') return 'stream_lost'
  if (kind === 'unsent' || kind === 'failed') return 'unsent'
  if (kind === 'cancelled') return 'cancelled'
  if (kind === 'gone') return 'gone'
  if (kind === 'stalled') return 'stalled'
  if (kind === 'taken_back') return 'taken_back'
  if (kind === 'stream_lost' || kind === 'dropped') return 'stream_lost'
  const result = response.result
  if (
    result !== null &&
    typeof result === 'object' &&
    'epoch' in (result as Record<string, unknown>)
  ) {
    return 'answered'
  }
  return 'missed'
}

/** densable `Hle`. */
export const REMOTE_PLUMBING_TOOLS = new Set(['sync_files'])

export const REMOTE_PLUMBING_NOT_A_TOOL = 'callPlumbing: not a plumbing tool'
export const REMOTE_PLUMBING_NOT_A_RESULT = 'the answer was not a tool result'
export const REMOTE_PLUMBING_NO_MACHINE =
  'the machine is no longer announced on this session'

/**
 * densable `E`. Hold is off. `sync_files` only.
 */
export async function callRemotePlumbing(opts: {
  host?: RemoteToolHost
  name: string
  args: Record<string, unknown>
  signal: AbortSignal
  deadlineMs?: number
  send?: (request: {
    instanceId: string
    host: string
    name: string
    args: Record<string, unknown>
    issuedAt: number
    deadlineMs: number
  }) => Promise<Record<string, unknown> | undefined>
}): Promise<RemoteToolCallResult> {
  if (!REMOTE_PLUMBING_TOOLS.has(opts.name)) {
    throw new Error(REMOTE_PLUMBING_NOT_A_TOOL)
  }
  if (opts.signal.aborted) return { kind: 'cancelled' }
  const host = opts.host ?? announced
  if (!host?.live) {
    return { kind: 'unreachable', detail: REMOTE_PLUMBING_NO_MACHINE }
  }
  const deadlineMs = opts.deadlineMs ?? REMOTE_TOOL_DEADLINE_MS
  let response: Record<string, unknown> | undefined
  try {
    response = await opts.send?.({
      instanceId: host.instanceId,
      host: host.hostName,
      name: opts.name,
      args: opts.args,
      issuedAt: Date.now(),
      deadlineMs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'transport_error', detail: `send failed: ${message}` }
  }
  if (!response) {
    return { kind: 'unreachable', detail: REMOTE_TOOL_STREAM_CLOSED }
  }
  if (response.kind === 'timed_out' || response.kind === 'deadline') {
    return { kind: 'timed_out', capMs: deadlineMs }
  }
  if (response.kind === 'cancelled') return { kind: 'cancelled' }
  if (response.kind === 'dropped') {
    return {
      kind: 'dropped',
      detail: 'the session stream closed after the request left',
    }
  }
  if (response.kind === 'unreachable') {
    return {
      kind: 'unreachable',
      detail:
        typeof response.detail === 'string'
          ? response.detail
          : REMOTE_TOOL_STREAM_CLOSED,
    }
  }
  if (response.kind === 'transport_error' || response.kind === 'failed') {
    return {
      kind: 'transport_error',
      detail:
        typeof response.detail === 'string'
          ? response.detail
          : REMOTE_PLUMBING_NOT_A_RESULT,
    }
  }
  if (host.live) host.live.lastHeardAt = Date.now()
  if (response.text === undefined && response.content === undefined) {
    return { kind: 'transport_error', detail: REMOTE_PLUMBING_NOT_A_RESULT }
  }
  return { kind: 'result', response }
}

/**
 * densable `$n`. After the first timed_out, poll with `outcome_of` until
 * a late body arrives, the machine is gone, or misses run out. A late
 * `in_progress` keeps the request standing.
 */
export async function checkStandingRemoteTool(opts: {
  held: RemoteToolHeld
  name: string
  callId: string
  signal: AbortSignal
  intervalMs?: number
  misses?: number
  unreachableBudgetMs?: number
  poll: (envelope: Record<string, unknown>) => Promise<RemoteToolCallResult>
}): Promise<RemoteToolCallResult> {
  const intervalMs = opts.intervalMs ?? 10_000
  const missCap = opts.misses ?? 3
  const budgetMs = opts.unreachableBudgetMs ?? REMOTE_TOOL_DEADLINE_MS
  let late: RemoteToolCallResult | undefined
  let watchLate = true
  const lateWait = opts.held.late.then(result => {
    late = result
  })
  let misses = 0
  let unreachableSince: number | undefined
  let whileRunning = false
  const started = Date.now()
  while (!opts.signal.aborted) {
    if (late !== undefined) {
      if (
        late.kind === 'result' &&
        (late.response?.envelope as { outcome?: unknown } | undefined)
          ?.outcome === 'in_progress'
      ) {
        const state = (
          late.response?.envelope as { state?: unknown } | undefined
        )?.state
        if (state === 'running') whileRunning = true
        late = undefined
        watchLate = false
      } else {
        return late
      }
    }
    if (Date.now() - started >= budgetMs) break
    const poll = opts.poll({ op: 'outcome_of', call_id: opts.callId })
    const polled = watchLate
      ? await Promise.race([poll, lateWait.then(() => undefined)])
      : await poll
    if (late !== undefined) continue
    if (!polled) continue
    if (polled.kind === 'cancelled') return polled
    if (polled.kind === 'result') {
      const outcome = (polled.response?.envelope as { outcome?: unknown })
        ?.outcome
      if (outcome === 'in_progress') {
        const state = (
          polled.response?.envelope as { state?: unknown } | undefined
        )?.state
        if (state === 'running') whileRunning = true
        misses = 0
        unreachableSince = undefined
        continue
      }
      return polled
    }
    if (polled.kind === 'host_gone') return polled
    misses += 1
    unreachableSince ??= Date.now()
    if (misses >= missCap) break
    if (Date.now() - unreachableSince >= budgetMs) break
    const pause = new Promise<void>(resolve => setTimeout(resolve, intervalMs))
    if (watchLate) await Promise.race([pause, lateWait])
    else await pause
  }
  if (opts.held.takeBack()) {
    return {
      kind: 'stalled',
      request: 'call',
      takenBack: true,
      capMs: REMOTE_TOOL_DEADLINE_MS,
    }
  }
  if (misses >= missCap) {
    return {
      kind: 'host_unresponsive',
      capMs: intervalMs,
      request: 'call',
      misses,
      whileRunning,
    }
  }
  return {
    kind: 'timed_out',
    detail: 'timed_out',
    capMs: REMOTE_TOOL_DEADLINE_MS,
    left: true,
  }
}
