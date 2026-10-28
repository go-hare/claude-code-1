/**
 * densable 2.1.289 server-classifier parse + request bag
 * (`KOe` / `_po` / `YOe` / `TZe` / `Woe` / `CPt` / `MA` / `XOe` /
 * `xPt` / `kpo` / `Spo` / `QOe` / `j6e` / `W6e`).
 */
import { z } from 'zod'

import {
  areThreadsHeldForServerClassifier,
  markThirdPartyServerClassifierRefused,
  markThreadsHeldForServerClassifier,
} from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'
import { classifyClassifierProviderKind } from '../../utils/model/providers.js'
import {
  autoModeUnavailableRunKey,
  clearAutoModeUnavailableStreakIfAny,
} from '../../utils/permissions/autoModeUnavailable.js'
import { getBootstrapSessionHost } from '../../utils/sessionRoot.js'
import { isThirdPartyServerClassifierRefused } from '../../bootstrap/state.js'

/** densable `KOe` @188541650 */
export const DANGEROUS_TOOL_USE_SAFEGUARD_TYPE = 'dangerous_tool_use'

/** densable `hpo` */
const UNAVAILABLE_REASONS = ['disabled', 'error'] as const

/** densable `RPt` */
function narrowKnownReason(allowed: readonly string[], reason: string): string {
  return allowed.includes(reason) ? reason : 'other'
}

/** densable `ppo` */
const toolUseVerdictSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('evaluated'),
    outcome: z.enum(['flagged', 'not_flagged']),
    explanation: z
      .string()
      .nullish()
      .transform(value => value ?? undefined)
      .optional(),
  }),
  z.object({ type: z.literal('skipped') }),
  z.object({ type: z.literal('unavailable'), reason: z.string() }),
])

/** densable `mpo` */
const dangerousToolUseStatusSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('available'),
    tool_uses: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('unsupported') }),
  z.object({ type: z.literal('unavailable'), reason: z.string() }),
])

/** densable `gpo` — array of `{type}`-tagged loose objects. */
const safeguardResultsSchema = z.array(z.object({ type: z.string() }).loose())

export type ServerClassifierNoneWhy =
  | 'server_no_result'
  | 'server_unrecognized_result'
  | 'server_unsupported'
  | 'server_unavailable_disabled'
  | 'server_unavailable_error'
  | 'server_unavailable_other'
  | 'server_thread_unsupported'
  | 'server_stream_ended'

export type ServerClassifierCallStatus =
  | {
      type: 'evaluated'
      outcome: 'flagged' | 'not_flagged'
      explanation?: string
    }
  | { type: 'skipped' }
  | { type: 'unavailable'; reason: string }
  | { type: 'unrecognized' }

export type ServerClassifierParse =
  | { kind: 'none'; why: ServerClassifierNoneWhy }
  | {
      kind: 'per_call'
      statuses: Map<string, ServerClassifierCallStatus>
    }

/**
 * densable `_po` @188542195 — parse `safeguard_results` off a message delta.
 */
export function parseSafeguardResults(payload: unknown): ServerClassifierParse {
  const results =
    typeof payload === 'object' && payload !== null
      ? (payload as { safeguard_results?: unknown }).safeguard_results
      : undefined
  if (results === undefined || results === null) {
    return { kind: 'none', why: 'server_no_result' }
  }
  const parsed = safeguardResultsSchema.safeParse(results)
  if (!parsed.success) {
    return { kind: 'none', why: 'server_unrecognized_result' }
  }
  const dangerous = parsed.data.filter(
    entry => entry.type === DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
  )
  if (dangerous.length === 0) {
    return { kind: 'none', why: 'server_no_result' }
  }
  if (dangerous.length > 1) {
    return { kind: 'none', why: 'server_unrecognized_result' }
  }
  const status = dangerousToolUseStatusSchema.safeParse(dangerous[0]?.status)
  if (!status.success) {
    return { kind: 'none', why: 'server_unrecognized_result' }
  }
  switch (status.data.type) {
    case 'unsupported':
      return { kind: 'none', why: 'server_unsupported' }
    case 'unavailable': {
      const reason = narrowKnownReason(UNAVAILABLE_REASONS, status.data.reason)
      return {
        kind: 'none',
        why:
          reason === 'disabled'
            ? 'server_unavailable_disabled'
            : reason === 'error'
              ? 'server_unavailable_error'
              : 'server_unavailable_other',
      }
    }
    case 'available': {
      const statuses = new Map<string, ServerClassifierCallStatus>()
      for (const [id, verdict] of Object.entries(status.data.tool_uses)) {
        const call = toolUseVerdictSchema.safeParse(verdict)
        statuses.set(id, call.success ? call.data : { type: 'unrecognized' })
      }
      return { kind: 'per_call', statuses }
    }
  }
}

/**
 * densable `YOe` @188543062.
 */
export class ServerClassifierRequest {
  readonly key: string
  readonly sentArtifacts: unknown
  readonly sentThread: boolean
  readonly runKey: string
  #result: ServerClassifierParse | undefined
  #settledAt: number | undefined
  #rewritten = false
  #resolve: (value: ServerClassifierParse) => void = () => {}
  #pending: Promise<ServerClassifierParse>

  constructor(
    key: string,
    sentArtifacts: unknown,
    sentThread: boolean,
    runKey: string,
  ) {
    this.key = key
    this.sentArtifacts = sentArtifacts
    this.sentThread = sentThread
    this.runKey = runKey
    this.#pending = new Promise(resolve => {
      this.#resolve = resolve
    })
  }

  settle(result: ServerClassifierParse): boolean {
    if (this.#result !== undefined) return false
    this.#result = result
    this.#settledAt = Date.now()
    this.#resolve(result)
    return true
  }

  results(): Promise<ServerClassifierParse> {
    return this.#result !== undefined
      ? Promise.resolve(this.#result)
      : this.#pending
  }

  settledAt(): number | undefined {
    return this.#settledAt
  }

  noteRewrittenCall(): void {
    this.#rewritten = true
  }

  hasRewrittenCall(): boolean {
    return this.#rewritten
  }

  toJSON(): undefined {
    return undefined
  }
}

/** densable `CPt` */
export function createServerClassifierRequest(
  key: string,
  options: {
    artifacts?: unknown
    thread?: boolean
    agentId?: string
  } = {},
): ServerClassifierRequest {
  return new ServerClassifierRequest(
    key,
    options.artifacts,
    options.thread === true,
    autoModeUnavailableRunKey(options.agentId),
  )
}

/** densable `MA` */
export function asServerClassifierRequest(
  value: unknown,
): ServerClassifierRequest | undefined {
  return value instanceof ServerClassifierRequest ? value : undefined
}

/** densable `XOe` */
export function serverClassifierEnvelope(request: ServerClassifierRequest): {
  serverClassifierRequest: string
  serverClassifierResults: ServerClassifierRequest
} {
  return {
    serverClassifierRequest: request.key,
    serverClassifierResults: request,
  }
}

/**
 * densable `Woe` @186430467 — drop top-level `safeguards` if present.
 */
export function stripSafeguardsFromBlock<T extends object>(block: T): T {
  if (!('safeguards' in block)) return block
  const { safeguards: _dropped, ...rest } = block as T & {
    safeguards?: unknown
  }
  return rest as T
}

type JudgedEntry = {
  request: string
  context: unknown
}

/**
 * densable `TZe` @187354234 — in-flight request → judged tool-use ids.
 */
export class ServerClassifierHistory {
  inFlight = new Map<string, unknown>()
  judged = new Map<string, JudgedEntry>()

  recordRequest(key: string, context: unknown): void {
    this.inFlight.set(key, context)
  }

  settleRequest(key: string, toolUseIds: readonly string[]): void {
    const context = this.inFlight.get(key)
    if (context === undefined) return
    this.inFlight.delete(key)
    const entry: JudgedEntry = { request: key, context }
    for (const id of toolUseIds) this.judged.set(id, entry)
  }

  forgetRequest(key: string): void {
    this.inFlight.delete(key)
  }

  historyFor(toolUseId: string): JudgedEntry | undefined {
    return this.judged.get(toolUseId)
  }

  reset(): void {
    this.inFlight.clear()
    this.judged.clear()
  }
}

/** densable `z` — WeakMap host → TZe. Check `!== undefined`, not truthy. */
class WeakOwnerCache<T> {
  #create: () => T
  #bags = new WeakMap<object, T>()
  constructor(create: () => T) {
    this.#create = create
  }
  of(host: object): T {
    const existing = this.#bags.get(host)
    if (existing !== undefined) return existing
    const created = this.#create()
    this.#bags.set(host, created)
    return created
  }
}

/** densable `WRn` */
const hostHistories = new WeakOwnerCache(() => new ServerClassifierHistory())

/** densable `eX` */
export function getServerClassifierHistory(
  host: object = getBootstrapSessionHost(),
): ServerClassifierHistory {
  return hostHistories.of(host)
}

/** densable `EZe` */
export function recordServerClassifierRequest(
  key: string,
  context: unknown,
): void {
  getServerClassifierHistory().recordRequest(key, context)
}

/** densable `CZe` */
export function settleServerClassifierRequest(
  key: string,
  toolUseIds: readonly string[],
): void {
  getServerClassifierHistory().settleRequest(key, toolUseIds)
}

/** densable `xZe` */
export function forgetServerClassifierRequest(key: string): void {
  getServerClassifierHistory().forgetRequest(key)
}

/** densable `AZe` */
export function serverClassifierHistoryFor(
  toolUseId: string,
): JudgedEntry | undefined {
  return getServerClassifierHistory().historyFor(toolUseId)
}

export function resetServerClassifierHistoryForTests(): void {
  getServerClassifierHistory().reset()
}

/**
 * densable `kpo` — thread-unsupported rewrite.
 */
export function rewriteThreadUnsupported(
  request: ServerClassifierRequest,
  parsed: ServerClassifierParse,
): ServerClassifierParse {
  if (
    request.sentThread &&
    parsed.kind === 'none' &&
    parsed.why === 'server_unsupported'
  ) {
    if (!areThreadsHeldForServerClassifier()) {
      markThreadsHeldForServerClassifier()
      logForDebugging(
        '[server-classifier] the API answered unsupported to a request sent on a message thread; this session sends its later requests without a thread so the server can classify them',
        { level: 'warn' },
      )
    }
    return { kind: 'none', why: 'server_thread_unsupported' }
  }
  return parsed
}

/**
 * densable `Spo`.
 */
export function hasEvaluatedCall(
  statuses: Map<string, ServerClassifierCallStatus>,
  ids?: readonly string[],
): boolean {
  if (ids === undefined) {
    return [...statuses.values()].some(status => status.type === 'evaluated')
  }
  for (const id of ids) {
    if (statuses.get(id)?.type === 'evaluated') return true
  }
  return false
}

/**
 * densable `QOe`.
 */
export function isThirdPartyNoClassificationLatch(
  parsed: ServerClassifierParse,
): parsed is {
  kind: 'none'
  why: 'server_unsupported' | 'server_unavailable_disabled' | 'server_no_result'
} {
  return (
    parsed.kind === 'none' &&
    (parsed.why === 'server_unsupported' ||
      parsed.why === 'server_unavailable_disabled' ||
      parsed.why === 'server_no_result')
  )
}

/**
 * densable `j6e`.
 */
export function latchThirdPartyNoClassification(
  parsed: ServerClassifierParse | undefined,
): void {
  if (
    parsed !== undefined &&
    classifyClassifierProviderKind() === 'thirdParty' &&
    isThirdPartyNoClassificationLatch(parsed) &&
    !isThirdPartyServerClassifierRefused()
  ) {
    markThirdPartyServerClassifierRefused()
    logForDebugging(
      `[server-classifier] the platform gave no classification for this request (${parsed.why}); treating that as this deployment's answer: auto mode classifies locally for the rest of this session and stops sending the classifier context`,
    )
  }
}

/**
 * densable `xPt` — parse, judge evaluated ids, settle, clear streak.
 */
export function settleSafeguardOnRequest(
  request: unknown,
  payload: unknown,
  toolUseIds?: readonly string[],
): ServerClassifierParse | undefined {
  const req = asServerClassifierRequest(request)
  if (req === undefined) return
  const parsed = rewriteThreadUnsupported(req, parseSafeguardResults(payload))
  settleServerClassifierRequest(
    req.key,
    parsed.kind === 'per_call'
      ? [...parsed.statuses]
          .filter(([, status]) => status.type === 'evaluated')
          .map(([id]) => id)
      : [],
  )
  if (!req.settle(parsed)) return
  if (
    parsed.kind === 'per_call' &&
    hasEvaluatedCall(parsed.statuses, toolUseIds)
  ) {
    clearAutoModeUnavailableStreakIfAny(req.runKey)
  }
  return parsed
}

/**
 * densable `W6e` — settle parse onto the request from a complete message.
 */
export function settleSafeguardOnMessage(
  request: unknown,
  payload: unknown,
  content: readonly { type?: string; id?: unknown }[],
): void {
  const ids = content.flatMap(block =>
    block.type === 'tool_use' && typeof block.id === 'string' ? [block.id] : [],
  )
  latchThirdPartyNoClassification(
    settleSafeguardOnRequest(request, payload, ids),
  )
}

/**
 * densable `JOe`.
 */
export function settleServerClassifierStreamEnded(request: unknown): void {
  const req = asServerClassifierRequest(request)
  if (req === undefined) return
  forgetServerClassifierRequest(req.key)
  req.settle({ kind: 'none', why: 'server_stream_ended' })
}
