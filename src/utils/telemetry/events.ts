import { AsyncLocalStorage } from 'async_hooks'
import {
  type Attributes,
  type AttributeValue,
  type Context,
  context as otelContext,
  defaultTextMapGetter,
  trace,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import {
  getEventLogger,
  getIsNonInteractiveSession,
  getPromptId,
} from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { HostSlot, RootSessionSlot } from '../hostSlot.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  getBootstrapSessionHost,
  ofDefaultHost,
  runWithSession,
} from '../sessionRoot.js'
import { withDeadline } from '../sleep.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'
import { getActiveInteractionOTelContext } from './interactionOtelContext.js'

/** densable DKh — shared propagator for TRACEPARENT extract. */
const w3cTraceContextPropagator = new W3CTraceContextPropagator()

/**
 * densable PKh / 2.1.214 #41 — parent context for log records.
 *
 * Order:
 * 1. active OTel context with a valid span
 * 2. interaction bridge (sessionTracing enterWith) — covers emit **outside**
 *    turn async context while interaction is still open
 * 3. non-interactive + TRACEPARENT → W3C extract (SDK/headless 212 #32)
 */
export function getOTelEventParentContext(): Context | undefined {
  const active = otelContext.active()
  // Prefer spanContext on the active context (covers setSpanContext without a Span)
  const spanCtx =
    trace.getSpanContext(active) ?? trace.getSpan(active)?.spanContext()
  if (spanCtx && trace.isSpanContextValid(spanCtx)) {
    return active
  }
  // densable 214 #41: interaction bridge when active OTel ctx has no span
  const interactionCtx = getActiveInteractionOTelContext()
  if (interactionCtx) {
    return interactionCtx
  }
  // densable: dn() && Z.TRACEPARENT — dn = !isInteractive
  if (getIsNonInteractiveSession() && process.env.TRACEPARENT) {
    return w3cTraceContextPropagator.extract(
      active,
      {
        traceparent: process.env.TRACEPARENT,
        tracestate: process.env.TRACESTATE,
      },
      defaultTextMapGetter,
    )
  }
  return undefined
}

// Monotonically increasing counter for ordering events within a session
const eventSequenceSessionSlot = new RootSessionSlot<{
  eventSequence: number
}>(() => ({
  eventSequence: 0,
}))

// Track whether we've already warned about a null event logger per host to avoid spamming
type EventsHostState = {
  hasWarnedNoEventLogger: boolean
  collectorRoad: InternalCollectorTelemetryRoad
}

const eventsHostSlot: HostSlot<EventsHostState> = new HostSlot<EventsHostState>(
  (): EventsHostState => ({
    hasWarnedNoEventLogger: false,
    collectorRoad: createInternalCollectorTelemetryRoad(
      (): InternalCollectorTelemetryRoad =>
        ofDefaultHost(eventsHostSlot).collectorRoad,
    ),
  }),
)

function getEventsHostState(): EventsHostState {
  return eventsHostSlot.of(getBootstrapSessionHost())
}

/** densable Dtg / official bLh — default max chars for OTEL content. */
export const OTEL_CONTENT_TRUNCATE_LIMIT = 61440

/**
 * densable Ptg() — effective OTel content max length.
 * min(CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH ?? 61440,
 *     OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT ?? ∞,
 *     OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT ?? ∞,
 *     OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT ?? ∞)
 */
export function getOTelContentMaxLength(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parseLimit = (raw: string | undefined): number => {
    if (raw === undefined || raw === '') return Number.POSITIVE_INFINITY
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY
  }
  const claude =
    env.CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH !== undefined &&
    env.CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH !== ''
      ? parseLimit(env.CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH)
      : OTEL_CONTENT_TRUNCATE_LIMIT
  return Math.min(
    claude,
    parseLimit(env.OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT),
    parseLimit(env.OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT),
    parseLimit(env.OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT),
  )
}

export type OTelPromptOriginLike = {
  kind?: string
  producer?: string
  senderTaskId?: string
}

/**
 * Official 2.1.323 (#2124, `i3r` = `VW || T0` @282091146):
 * True when a turn's prompt carries a background agent's reply rather than
 * direct user text:
 * - `kind === 'task-notification'` produced by a session task (or legacy unset producer)
 * - `kind === 'peer'` with a `senderTaskId`
 * - `kind === 'observer'`
 */
export function isBackgroundAgentReplyOrigin(
  origin: OTelPromptOriginLike | undefined,
): boolean {
  if (!origin) return false
  if (
    origin.kind === 'task-notification' &&
    (origin.producer === 'session-task' || origin.producer === undefined)
  ) {
    return true
  }
  if (origin.kind === 'peer' && origin.senderTaskId !== undefined) {
    return true
  }
  return origin.kind === 'observer'
}

function isUserPromptLoggingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.OTEL_LOG_USER_PROMPTS)
}

export function redactIfDisabled(
  content: string,
  origin?: OTelPromptOriginLike,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isUserPromptLoggingEnabled(env)) {
    return '<REDACTED>'
  }
  if (
    isBackgroundAgentReplyOrigin(origin) &&
    !isAssistantResponseLoggingEnabled(env)
  ) {
    return '<REDACTED>'
  }
  return content
}

/**
 * Official 2.1.323 (#2124, `qwa` + `NKs` @283995138):
 * Format `prompt` / `prompt_text` for `user_prompt` OTel events and
 * interaction spans. When the prompt carries a background agent's reply and
 * `OTEL_LOG_ASSISTANT_RESPONSES=0`, redact to `<REDACTED>` even when
 * `OTEL_LOG_USER_PROMPTS=1`.
 */
export function formatUserPromptForOTel(
  content: string | undefined,
  origin?: OTelPromptOriginLike,
  env: NodeJS.ProcessEnv = process.env,
): { prompt: string; prompt_text: string } {
  if (content === undefined) {
    return { prompt: '<REDACTED>', prompt_text: '<REDACTED>' }
  }
  if (!isUserPromptLoggingEnabled(env)) {
    return { prompt: '<REDACTED>', prompt_text: '<REDACTED>' }
  }
  if (
    isBackgroundAgentReplyOrigin(origin) &&
    !isAssistantResponseLoggingEnabled(env)
  ) {
    return { prompt: '<REDACTED>', prompt_text: '<REDACTED>' }
  }
  const formatted = truncateOTelContent(
    content,
    getOTelContentMaxLength(env),
  ).content
  return { prompt: formatted, prompt_text: formatted }
}

/**
 * Official xkc densable — log assistant response body when
 * OTEL_LOG_ASSISTANT_RESPONSES is set, else fall back to OTEL_LOG_USER_PROMPTS.
 * Uses nullish semantics: an explicit falsy ASSISTANT value does NOT fall through.
 */
export function isAssistantResponseLoggingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.OTEL_LOG_ASSISTANT_RESPONSES !== undefined) {
    return isEnvTruthy(env.OTEL_LOG_ASSISTANT_RESPONSES)
  }
  return isUserPromptLoggingEnabled(env)
}

/**
 * densable W1 — truncate OTEL content past effective max with dynamic marker.
 * Marker: `\n\n[TRUNCATED - Content exceeds ${NKB|N character} limit]`
 * If marker alone ≥ limit, return raw slice(0, limit) without marker.
 */
export function truncateOTelContent(
  content: string,
  limit: number = getOTelContentMaxLength(),
): { content: string; truncated: boolean } {
  if (content.length <= limit) {
    return { content, truncated: false }
  }
  const unit =
    limit >= 1024 ? `${Math.floor(limit / 1024)}KB` : `${limit} character`
  const marker = `\n\n[TRUNCATED - Content exceeds ${unit} limit]`
  if (marker.length >= limit) {
    return { content: content.slice(0, limit), truncated: true }
  }
  return {
    content: content.slice(0, limit - marker.length) + marker,
    truncated: true,
  }
}

/**
 * Official assistant_response body field: full (truncated) content when enabled,
 * else redacted sentinel.
 */
export function formatAssistantResponseForOTel(
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isAssistantResponseLoggingEnabled(env)) {
    return '<REDACTED>'
  }
  return truncateOTelContent(content).content
}

export type OTelCollectorAttributeValue = string | number | boolean | string[]

export type OTelCollectorSpan = {
  traceId: string
  spanId: string
  traceFlags: number
}

export type OTelCollectorLogEntry = {
  to: 'collector'
  event: string
  attributes: Record<string, OTelCollectorAttributeValue>
  loggedAt: string
  span?: OTelCollectorSpan
}

export type OTelCollectorLogRecord = {
  timestamp: Date
  observedTimestamp: Date
  body: string
  attributes: Attributes
  context?: Context
}

export type CollectorTelemetryRoadEndpoint = {
  send: (entry: OTelCollectorLogEntry, signal: AbortSignal) => Promise<unknown>
  /**
   * Optional predicate for the default function-hooks road:
   * returns true when at least one loaded function hook matches
   * `telemetry.log` `{ to: 'collector' }` and we are not already
   * inside a collector `telemetry.log` dispatch.
   */
  isCollectorHooked?: () => boolean
}

export type CollectorTelemetryRoad = {
  setRoad: (road: CollectorTelemetryRoadEndpoint | null) => void
  getRoad: () => CollectorTelemetryRoadEndpoint | null
  isWaitingForRoad: () => boolean
  route: (
    buildEntry: () => OTelCollectorLogEntry,
    parentContext?: Context,
  ) => Promise<void>
  settled: () => Promise<void>
  settledWithin: (ms: number) => Promise<void>
}

type ActiveCollectorCallContext = {
  parentContext: Context | undefined
  initialSpan: OTelCollectorSpan | undefined
}

const collectorParentContextAls =
  new AsyncLocalStorage<ActiveCollectorCallContext>()

const MAX_WAITING_COLLECTOR_RECORDS = 100

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

/** densable Q — deliver one collector entry on the road unless aborted. */
function sendCollectorEntryOnRoad(
  road: CollectorTelemetryRoadEndpoint,
  item: {
    entry: OTelCollectorLogEntry
    signal: AbortSignal
    parentContext?: Context
    initialSpan?: OTelCollectorSpan
  },
): Promise<void> | void {
  const logDropped = () =>
    logForDebugging(
      `[3P telemetry] Event record dropped (${item.entry.event}): still on the collector road when a flush stopped waiting`,
    )
  const logLost = (err: unknown) =>
    logForDebugging(
      `[3P telemetry] Event record lost (${item.entry.event}): its raise failed: ${errorMessage(err)}`,
      { level: 'warn' },
    )
  if (item.signal.aborted) {
    logDropped()
    return
  }
  return collectorParentContextAls
    .run(
      {
        parentContext: item.parentContext,
        initialSpan: item.initialSpan,
      },
      () => road.send(item.entry, item.signal),
    )
    .then(
      () => {
        return
      },
      (err: unknown) => {
        if (item.signal.aborted) logDropped()
        else logLost(err)
      },
    )
}

type InternalCollectorTelemetryRoad = CollectorTelemetryRoad & {
  waitForRoad: () => Promise<CollectorTelemetryRoadEndpoint>
}

function createInternalCollectorTelemetryRoad(
  getDefaultRoad?: () => InternalCollectorTelemetryRoad,
): InternalCollectorTelemetryRoad {
  let currentRoad: CollectorTelemetryRoadEndpoint | null = null
  let ownRoadSet = false
  let waitingForRoad = false
  let pendingRoad = createDeferred<CollectorTelemetryRoadEndpoint>()
  let inFlight: Promise<void> | null = null
  let abortController = new AbortController()
  let waitingCount = 0

  function resolveFallbackRoad(): InternalCollectorTelemetryRoad | null {
    if (ownRoadSet || !getDefaultRoad) return null
    const defaultRoad = getDefaultRoad()
    return defaultRoad === self ? null : defaultRoad
  }

  function getEffectiveRoad(): CollectorTelemetryRoadEndpoint | null {
    const fallback = resolveFallbackRoad()
    return fallback !== null ? fallback.getRoad() : currentRoad
  }

  async function settled(): Promise<void> {
    while (inFlight !== null) {
      await inFlight
    }
  }

  function stopWaitingOnFlush(): void {
    if (inFlight === null) return
    logForDebugging(
      '[3P telemetry] A flush stopped waiting for the collector road; records still on it are dropped',
    )
    abortController.abort()
    abortController = new AbortController()
    inFlight = null
  }

  const self: InternalCollectorTelemetryRoad = {
    setRoad: (road: CollectorTelemetryRoadEndpoint | null) => {
      ownRoadSet = true
      currentRoad = road
      if (road === null) {
        waitingForRoad = true
        pendingRoad = createDeferred<CollectorTelemetryRoadEndpoint>()
      } else {
        waitingForRoad = false
        waitingCount = 0
        pendingRoad.resolve(road)
      }
    },
    getRoad: () => getEffectiveRoad(),
    isWaitingForRoad: () => {
      const fallback = resolveFallbackRoad()
      return fallback !== null ? fallback.isWaitingForRoad() : waitingForRoad
    },
    waitForRoad: () =>
      currentRoad !== null ? Promise.resolve(currentRoad) : pendingRoad.promise,
    route: (
      buildEntry: () => OTelCollectorLogEntry,
      parentContext?: Context,
    ) => {
      const roadMissing = getEffectiveRoad() === null
      if (!roadMissing) {
        waitingCount = 0
      } else if (waitingCount >= MAX_WAITING_COLLECTOR_RECORDS) {
        logForDebugging(
          '[3P telemetry] Event record dropped: no road installed and too many already waiting for one',
          { level: 'warn' },
        )
        return Promise.resolve()
      }
      waitingCount += roadMissing ? 1 : 0
      const entry = buildEntry()
      const initialSpan = entry.span ? { ...entry.span } : undefined
      const item = {
        entry,
        signal: abortController.signal,
        parentContext,
        initialSpan,
      }
      const captured = getActiveSessionFromAls()
      const next = (inFlight ?? Promise.resolve())
        .then(() => {
          const effective = getEffectiveRoad()
          if (effective !== null) return effective
          const fallback = resolveFallbackRoad()
          if (fallback !== null) {
            return Promise.race([pendingRoad.promise, fallback.waitForRoad()])
          }
          return pendingRoad.promise
        })
        .then(road =>
          captured !== undefined && getActiveSessionFromAls() !== captured
            ? runWithSession(captured, () =>
                sendCollectorEntryOnRoad(road, item),
              )
            : sendCollectorEntryOnRoad(road, item),
        )
        .catch((err: unknown) => {
          const logErr = () =>
            logForDebugging(
              `[3P telemetry] Event record dropped: ${errorMessage(err)}`,
              { level: 'warn' },
            )
          if (
            captured !== undefined &&
            getActiveSessionFromAls() !== captured
          ) {
            runWithSession(captured, logErr)
          } else {
            logErr()
          }
        })
      inFlight = next
      void next.then(() => {
        if (inFlight === next) inFlight = null
      })
      return next
    },
    settled,
    settledWithin: (ms: number) =>
      withDeadline(settled(), ms).then(stopWaitingOnFlush),
  }

  return self
}

/**
 * densable Z / Xue — serialized 3P collector road (`telemetry.log` `{ to: "collector" }`).
 */
export function createCollectorTelemetryRoad(): CollectorTelemetryRoad {
  return createInternalCollectorTelemetryRoad()
}

export const collectorTelemetryRoad: CollectorTelemetryRoad = {
  setRoad: road => getEventsHostState().collectorRoad.setRoad(road),
  getRoad: () => getEventsHostState().collectorRoad.getRoad(),
  isWaitingForRoad: () => getEventsHostState().collectorRoad.isWaitingForRoad(),
  route: (buildEntry, parentContext) =>
    getEventsHostState().collectorRoad.route(buildEntry, parentContext),
  settled: () => getEventsHostState().collectorRoad.settled(),
  settledWithin: ms => getEventsHostState().collectorRoad.settledWithin(ms),
}

function isCollectorAttributeValue(
  value: unknown,
): value is OTelCollectorAttributeValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every(item => typeof item === 'string'))
  )
}

/** densable Me — build `{ to: "collector", event, attributes, loggedAt, span? }`. */
export function buildOTelCollectorEntry(params: {
  event: string
  attributes: Attributes
  loggedAt: Date
  eventContext?: Context
}): OTelCollectorLogEntry {
  const ctx = params.eventContext ?? otelContext.active()
  const spanCtx = trace.getSpanContext(ctx) ?? trace.getSpan(ctx)?.spanContext()
  const validSpan = spanCtx !== undefined && trace.isSpanContextValid(spanCtx)
  const picked: Record<string, OTelCollectorAttributeValue> = {}
  for (const [key, value] of Object.entries(params.attributes)) {
    if (isCollectorAttributeValue(value)) {
      picked[key] = value
    }
  }
  return {
    to: 'collector',
    event: params.event,
    attributes: picked,
    loggedAt: params.loggedAt.toISOString(),
    ...(validSpan && {
      span: {
        traceId: spanCtx.traceId,
        spanId: spanCtx.spanId,
        traceFlags: spanCtx.traceFlags,
      },
    }),
  }
}

/** densable h2o — build OTEL LogRecord payload. */
export function buildOTelCollectorLogRecord(
  eventName: string,
  attributes: Attributes,
  timestamp: Date,
  eventContext?: Context,
): OTelCollectorLogRecord {
  return {
    timestamp,
    observedTimestamp: timestamp,
    body: `claude_code.${eventName}`,
    attributes,
    ...(eventContext && { context: eventContext }),
  }
}

/** densable y2o — emit OTEL LogRecord to eventLogger, or warn once if absent. */
export function emitOTelCollectorLogRecord(
  record: OTelCollectorLogRecord,
  eventName: string,
): void {
  const eventLogger = getEventLogger()
  if (eventLogger) {
    eventLogger.emit(record)
    return
  }
  const hostState = getEventsHostState()
  if (!hostState.hasWarnedNoEventLogger) {
    hostState.hasWarnedNoEventLogger = true
    logForDebugging(
      `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
      {
        level: isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_TELEMETRY)
          ? 'warn'
          : 'debug',
      },
    )
  }
}

function coerceCollectorAttributeValue(
  value: unknown,
): AttributeValue | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const arr = Array.from(Object(value) as ArrayLike<unknown>)
    if (arr.every(item => typeof item === 'string')) {
      return arr as string[]
    }
    if (arr.every(item => typeof item === 'number')) {
      return arr as number[]
    }
    if (arr.every(item => typeof item === 'boolean')) {
      return arr as boolean[]
    }
  }
  return undefined
}

function parseCollectorLoggedAt(raw: unknown): Date {
  const date =
    typeof raw === 'string' || typeof raw === 'number' || raw instanceof Date
      ? new Date(raw)
      : new Date(Number.NaN)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function isCollectorSpanRecord(value: unknown): value is OTelCollectorSpan {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  return (
    typeof rec.traceId === 'string' &&
    typeof rec.spanId === 'string' &&
    typeof rec.traceFlags === 'number'
  )
}

/** densable M$n + y2o — core tail sink for `telemetry.log` when `to === "collector"`. */
export function emitCollectorTelemetryEntry(
  entry: Record<string, unknown>,
): void {
  const eventName = typeof entry.event === 'string' ? entry.event : ''
  const attributes: Attributes = {}
  if (
    typeof entry.attributes === 'object' &&
    entry.attributes !== null &&
    !Array.isArray(entry.attributes)
  ) {
    for (const [key, rawValue] of Object.entries(
      entry.attributes as Record<string, unknown>,
    )) {
      const coerced = coerceCollectorAttributeValue(rawValue)
      if (coerced !== undefined) {
        attributes[key] = coerced
      }
    }
  }
  const carried = collectorParentContextAls.getStore()
  const span = entry.span
  let eventContext: Context | undefined
  if (isCollectorSpanRecord(span)) {
    const unchanged =
      carried?.initialSpan !== undefined &&
      carried.initialSpan.traceId === span.traceId &&
      carried.initialSpan.spanId === span.spanId &&
      carried.initialSpan.traceFlags === span.traceFlags
    eventContext = unchanged
      ? (carried?.parentContext ??
        trace.setSpanContext(otelContext.active(), {
          traceId: span.traceId,
          spanId: span.spanId,
          traceFlags: span.traceFlags,
          isRemote: false,
        }))
      : trace.setSpanContext(carried?.parentContext ?? otelContext.active(), {
          traceId: span.traceId,
          spanId: span.spanId,
          traceFlags: span.traceFlags,
          isRemote: false,
        })
  } else if (carried !== undefined && carried.initialSpan === undefined) {
    eventContext = carried.parentContext
  }
  emitOTelCollectorLogRecord(
    buildOTelCollectorLogRecord(
      eventName,
      attributes,
      parseCollectorLoggedAt(entry.loggedAt),
      eventContext,
    ),
    eventName,
  )
}

function safeGetTelemetryAttributes(): Attributes {
  try {
    return getTelemetryAttributes()
  } catch {
    return {}
  }
}

function hasExplicitCollectorTelemetryHook(): boolean {
  try {
    const { getLoadedFunctionHooksModules, hasMatchingFunctionHook } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../plugins/functionHooksModules.js') as typeof import('../plugins/functionHooksModules.js')
    const customMods = getLoadedFunctionHooksModules().filter(
      mod =>
        mod.name !== 'builtin:cc-plugin-telemetry' &&
        mod.name !== 'cc-plugin-telemetry' &&
        mod.status !== 'unloaded',
    )
    if (customMods.length === 0) return false
    return hasMatchingFunctionHook(
      'telemetry.log',
      { to: 'collector' },
      customMods,
    )
  } catch {
    return false
  }
}

function buildHostOTelAttributes(
  eventName: string,
  metadata: { [key: string]: string | undefined },
): Attributes {
  const seqState = eventSequenceSessionSlot.of(getBootstrapSession())
  const attributes: Attributes = {
    ...safeGetTelemetryAttributes(),
    'event.name': eventName,
    'event.timestamp': new Date().toISOString(),
    'event.sequence': seqState.eventSequence++,
  }

  // Add prompt ID to events (but not metrics, where it would cause unbounded cardinality)
  const promptId = getPromptId()
  if (promptId) {
    attributes['prompt.id'] = promptId
  }

  // Workspace directory from the desktop app (host path). Events only —
  // filesystem paths are too high-cardinality for metric dimensions, and
  // the BQ metrics pipeline must never see them.
  const workspaceDir = process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS
  if (workspaceDir) {
    attributes['workspace.host_paths'] = workspaceDir.split('|')
  }

  // Add metadata as attributes - all values are already strings
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      attributes[key] = value
    }
  }

  return attributes
}

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  const road = collectorTelemetryRoad.getRoad()
  const useCollectorRoad =
    road !== null
      ? road.isCollectorHooked === undefined ||
        (road.isCollectorHooked() && hasExplicitCollectorTelemetryHook())
      : collectorTelemetryRoad.isWaitingForRoad()

  if (!useCollectorRoad) {
    const eventLogger = getEventLogger()
    if (!eventLogger) {
      const hostState = getEventsHostState()
      if (!hostState.hasWarnedNoEventLogger) {
        hostState.hasWarnedNoEventLogger = true
        logForDebugging(
          `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
          {
            level: isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_TELEMETRY)
              ? 'warn'
              : 'debug',
          },
        )
      }
      return
    }
    const attributes = buildHostOTelAttributes(eventName, metadata)
    const loggedAt = new Date()
    const parentContext = getOTelEventParentContext()
    eventLogger.emit(
      buildOTelCollectorLogRecord(
        eventName,
        attributes,
        loggedAt,
        parentContext,
      ),
    )
    return
  }

  const attributes = buildHostOTelAttributes(eventName, metadata)
  const loggedAt = new Date()
  const parentContext = getOTelEventParentContext()
  await collectorTelemetryRoad.route(
    () =>
      buildOTelCollectorEntry({
        event: eventName,
        attributes,
        loggedAt,
        eventContext: parentContext,
      }),
    parentContext,
  )
}
