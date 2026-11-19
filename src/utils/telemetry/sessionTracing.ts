/**
 * Session Tracing for Claude Code using OpenTelemetry (BETA)
 *
 * This module provides a high-level API for creating and managing spans
 * to trace Claude Code workflows. Each user interaction creates a root
 * interaction span, which contains operation spans (LLM requests, tool calls, etc.).
 *
 * Requirements:
 * - Enhanced telemetry is enabled via feature('ENHANCED_TELEMETRY_BETA')
 * - Configure OTEL_TRACES_EXPORTER (console, otlp, etc.)
 */

import { feature } from 'bun:bundle'
import {
  context as otelContext,
  defaultTextMapGetter,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Context,
  type Link,
  type Span,
  type SpanContext as OTelSpanContext,
  trace,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { AsyncLocalStorage } from 'async_hooks'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { getAPIProvider } from '../model/providers.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'
import { formatUserPromptForOTel, type OTelPromptOriginLike } from './events.js'
import {
  addBetaInteractionAttributes,
  addBetaLLMRequestAttributes,
  addBetaLLMResponseAttributes,
  addBetaToolInputAttributes,
  addBetaToolResultAttributes,
  isBetaTracingEnabled,
  type LLMRequestNewContext,
  truncateContent,
} from './betaSessionTracing.js'
import { setActiveInteractionOTelContext } from './interactionOtelContext.js'
import {
  endInteractionPerfettoSpan,
  endLLMRequestPerfettoSpan,
  endToolPerfettoSpan,
  endUserInputPerfettoSpan,
  isPerfettoTracingEnabled,
  startInteractionPerfettoSpan,
  startLLMRequestPerfettoSpan,
  startToolPerfettoSpan,
  startUserInputPerfettoSpan,
} from './perfettoTracing.js'

// Re-export for callers
export type { Span }
export { isBetaTracingEnabled, type LLMRequestNewContext }

// Message type for API calls (UserMessage or AssistantMessage)
type APIMessage =
  | UserMessage
  | AssistantMessage
  | { type: string; message?: { role?: string; content?: unknown } }

type SpanType =
  | 'interaction'
  | 'llm_request'
  | 'tool'
  | 'tool.blocked_on_user'
  | 'tool.execution'
  | 'hook'

interface SpanContext {
  span: Span
  startTime: number
  attributes: Record<string, string | number | boolean>
  ended?: boolean
  perfettoSpanId?: string
}

// ALS stores SpanContext directly so it holds a strong reference while a span
// is active. With that, activeSpans can use WeakRef — when ALS is cleared
// (enterWith(undefined)) and no other code holds the SpanContext, GC can collect
// it and the WeakRef goes stale.
const interactionContext = new AsyncLocalStorage<SpanContext | undefined>()
const toolContext = new AsyncLocalStorage<SpanContext | undefined>()

/**
 * densable 2.1.214 #41 — OTel Context from interaction ALS when the active
 * OTel async context has no span (timers / fire-and-forget after turn fork).
 * Used by getOTelEventParentContext so log records keep interaction trace_id.
 */
export function getInteractionOTelContext():
  | ReturnType<typeof otelContext.active>
  | undefined {
  const store = interactionContext.getStore()
  if (!store || store.ended) return undefined
  const sc = store.span.spanContext()
  if (!trace.isSpanContextValid(sc)) return undefined
  return trace.setSpan(otelContext.active(), store.span)
}

function syncInteractionOTelBridge(): void {
  setActiveInteractionOTelContext(getInteractionOTelContext())
}
const activeSpans = new Map<string, WeakRef<SpanContext>>()
// Spans not stored in ALS (LLM request, blocked-on-user, tool execution, hook)
// need a strong reference to prevent GC from collecting the SpanContext before
// the corresponding end* function retrieves it.
const strongSpans = new Map<string, SpanContext>()
let interactionSequence = 0
let _cleanupIntervalStarted = false

const SPAN_TTL_MS = 30 * 60 * 1000 // 30 minutes

function getSpanId(span: Span): string {
  return span.spanContext().spanId || ''
}

/**
 * Lazily start a background interval that evicts orphaned spans from activeSpans.
 *
 * Normal teardown calls endInteractionSpan / endToolSpan, which delete spans
 * immediately. This interval is a safety net for spans that were never ended
 * (e.g. aborted streams, uncaught exceptions mid-query) — without it they
 * accumulate in activeSpans indefinitely, holding references to Span objects
 * and the OpenTelemetry context chain.
 *
 * Initialized on the first startInteractionSpan call (not at module load) to
 * avoid triggering the no-top-level-side-effects lint rule and to keep the
 * interval from running in processes that never start a span.
 * unref() prevents the timer from keeping the process alive after all other
 * work is done.
 */
function ensureCleanupInterval(): void {
  if (_cleanupIntervalStarted) return
  _cleanupIntervalStarted = true
  const interval = setInterval(() => {
    const cutoff = Date.now() - SPAN_TTL_MS
    for (const [spanId, weakRef] of activeSpans) {
      const ctx = weakRef.deref()
      if (ctx === undefined) {
        activeSpans.delete(spanId)
        strongSpans.delete(spanId)
      } else if (ctx.startTime < cutoff) {
        if (!ctx.ended) ctx.span.end() // flush any recorded attributes to the exporter
        activeSpans.delete(spanId)
        strongSpans.delete(spanId)
      }
    }
  }, 60_000)
  if (typeof interval.unref === 'function') {
    interval.unref() // Node.js / Bun: don't block process exit
  }
}

/**
 * Check if enhanced telemetry is enabled.
 * Priority: env var override > ant build > GrowthBook gate
 */
export function isEnhancedTelemetryEnabled(): boolean {
  if (feature('ENHANCED_TELEMETRY_BETA')) {
    const env =
      process.env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA ??
      process.env.ENABLE_ENHANCED_TELEMETRY_BETA
    if (isEnvTruthy(env)) {
      return true
    }
    if (isEnvDefinedFalsy(env)) {
      return false
    }
    return (
      process.env.USER_TYPE === 'ant' ||
      getFeatureValue_CACHED_MAY_BE_STALE('enhanced_telemetry_beta', false)
    )
  }
  return false
}

/**
 * Check if any tracing is enabled (either standard enhanced telemetry OR beta tracing)
 */
function isAnyTracingEnabled(): boolean {
  return isEnhancedTelemetryEnabled() || isBetaTracingEnabled()
}

const w3cPropagator = new W3CTraceContextPropagator()

/** Official EAa — inject W3C traceparent from a span. */
function injectTraceparentFromSpan(span: Span): string | undefined {
  const spanContext = span.spanContext()
  if (
    !spanContext.traceId ||
    spanContext.traceId === '00000000000000000000000000000000'
  ) {
    return
  }
  const ctx = trace.setSpan(otelContext.active(), span)
  const carrier: Record<string, string> = {}
  w3cPropagator.inject(ctx, carrier, defaultTextMapSetter)
  return carrier.traceparent
}

/**
 * Official r1t — current OTel span → W3C traceparent (PreToolUse defer).
 */
export function injectCurrentTraceparent(): string | undefined {
  if (!isAnyTracingEnabled()) return
  const span = trace.getSpan(otelContext.active())
  if (!span) return
  return injectTraceparentFromSpan(span)
}

/**
 * Official Zrp — extract a context from a stored traceparent.
 * Returns undefined when extract is a no-op (same as current context).
 */
export function extractTraceparentContext(
  traceparent: string | undefined,
): Context | undefined {
  if (!traceparent || !isAnyTracingEnabled()) return
  const current = otelContext.active()
  const extracted = w3cPropagator.extract(
    current,
    { traceparent },
    defaultTextMapGetter,
  )
  return extracted === current ? undefined : extracted
}

/** Official Qrp — run fn under extracted context, or bare if none. */
export function withOtelContext<T>(ctx: Context | undefined, fn: () => T): T {
  return ctx === undefined ? fn() : otelContext.with(ctx, fn)
}

function getTracer() {
  return trace.getTracer('com.anthropic.claude_code.tracing', '1.0.0')
}

/**
 * Official 2.1.300 (#760) Ft() — map APIProvider to OpenTelemetry GenAI semantic-convention provider name.
 */
export function getGenAiProviderName(
  provider: string = getAPIProvider(),
): string {
  switch (provider) {
    case 'bedrock':
    case 'mantle':
      return 'aws.bedrock'
    case 'vertex':
      return 'gcp.vertex_ai'
    case 'firstParty':
    case 'anthropicAws':
    case 'anthropicGoogleCloud':
    case 'foundry':
    case 'gateway':
      return 'anthropic'
    default:
      return provider
  }
}

/**
 * Official 2.1.300 (#760) xTe() — split mcp__<server>__<tool> for gen_ai.tool.name / anthropic.mcp.server.name.
 */
function parseMcpToolNameForGenAi(
  toolName: string,
): { serverName: string; mcpToolName: string } | undefined {
  if (!toolName.startsWith('mcp__')) return undefined
  const parts = toolName.split('__')
  const serverName = parts[1]
  const mcpToolName = parts.slice(2).join('__')
  if (!serverName || !mcpToolName) return undefined
  return { serverName, mcpToolName }
}

function createSpanAttributes(
  spanType: SpanType,
  customAttributes: Record<string, string | number | boolean> = {},
): Record<string, string | number | boolean> {
  const baseAttributes = getTelemetryAttributes()

  const attributes: Record<string, string | number | boolean> = {
    ...baseAttributes,
    'gen_ai.provider.name': getGenAiProviderName(),
    'span.type': spanType,
    ...customAttributes,
  }

  return attributes
}

const ERROR_CLASS_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/

function formatErrorAttributes(
  error?: string,
  errorClass?: string,
): Record<string, string> {
  const sanitizedClass = errorClass?.replace(/[^A-Za-z0-9_]/g, '_')
  return {
    ...(error !== undefined ? { error } : {}),
    ...(sanitizedClass !== undefined && ERROR_CLASS_RE.test(sanitizedClass)
      ? { error_class: sanitizedClass }
      : {}),
  }
}

function buildErrorStatus(error?: string): {
  code: SpanStatusCode
  message?: string
} {
  return {
    code: SpanStatusCode.ERROR,
    ...(error ? { message: error } : {}),
  }
}

function parseTraceparentSpanContext(
  traceparent: string,
): OTelSpanContext | undefined {
  const ctx = new W3CTraceContextPropagator().extract(
    ROOT_CONTEXT,
    { traceparent },
    defaultTextMapGetter,
  )
  return trace.getSpanContext(ctx)
}

export type InteractionTraceContexts = {
  parent?: { traceparent: string }
  linked?: Array<{ traceparent: string }>
}

/**
 * Start an interaction span. This wraps a user request -> Claude response cycle.
 * This is now a root span that includes all session-level attributes.
 * Sets the interaction context for all subsequent operations.
 */
export function startInteractionSpan(
  userPrompt: string,
  traceContexts?: InteractionTraceContexts,
  origin?: OTelPromptOriginLike,
): Span {
  ensureCleanupInterval()

  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startInteractionPerfettoSpan(userPrompt)
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: {},
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      interactionContext.enterWith(spanContextObj)
      syncInteractionOTelBridge()
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  // Official 2.1.323 (#2124, `qwa` + `NKs`): redact background agent replies
  // on interaction spans when `OTEL_LOG_ASSISTANT_RESPONSES=0`.
  const promptToLog = formatUserPromptForOTel(userPrompt, origin).prompt

  interactionSequence++

  // densable: dn()&&Z.TRACEPARENT ? propagation.extract(...) : active
  // so headless/SDK interaction spans inherit parent trace_id/span_id.
  const activeCtx = otelContext.active()
  const propagator = new W3CTraceContextPropagator()
  const eventParentCtx = traceContexts?.parent
    ? propagator.extract(
        activeCtx,
        { traceparent: traceContexts.parent.traceparent },
        defaultTextMapGetter,
      )
    : activeCtx
  const envParentCtx =
    eventParentCtx === activeCtx &&
    getIsNonInteractiveSession() &&
    process.env.TRACEPARENT
      ? propagator.extract(
          activeCtx,
          {
            traceparent: process.env.TRACEPARENT,
            tracestate: process.env.TRACESTATE,
          },
          defaultTextMapGetter,
        )
      : activeCtx
  const parentCtx = eventParentCtx !== activeCtx ? eventParentCtx : envParentCtx
  const parentSource =
    eventParentCtx !== activeCtx
      ? 'event'
      : envParentCtx !== activeCtx
        ? 'env'
        : 'none'
  const links: Link[] = (traceContexts?.linked ?? []).flatMap(
    ({ traceparent }) => {
      const spanCtx = parseTraceparentSpanContext(traceparent)
      return spanCtx
        ? [{ context: spanCtx, attributes: { 'link.type': 'queued_send' } }]
        : []
    },
  )

  const attributes = createSpanAttributes('interaction', {
    'gen_ai.operation.name': 'invoke_agent',
    user_prompt: promptToLog,
    user_prompt_length: userPrompt.length,
    'interaction.sequence': interactionSequence,
    'gen_ai.conversation.id': getSessionId(),
    'parent.source': parentSource,
    queued_sends: links.length,
  })

  const span = tracer.startSpan(
    'claude_code.interaction',
    {
      attributes,
      links,
    },
    parentCtx,
  )

  // Add experimental attributes (new_context)
  addBetaInteractionAttributes(span, userPrompt)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))

  interactionContext.enterWith(spanContextObj)
  syncInteractionOTelBridge()

  return span
}

export function endInteractionSpan(): void {
  const spanContext = interactionContext.getStore()
  if (!spanContext) {
    return
  }

  if (spanContext.ended) {
    return
  }

  // End Perfetto span
  if (spanContext.perfettoSpanId) {
    endInteractionPerfettoSpan(spanContext.perfettoSpanId)
  }

  if (!isAnyTracingEnabled()) {
    spanContext.ended = true
    activeSpans.delete(getSpanId(spanContext.span))
    // Clear the store so async continuations created after this point (timers,
    // promise callbacks, I/O) do not inherit a reference to the ended span.
    // enterWith(undefined) is intentional: exit(() => {}) is a no-op because it
    // only suppresses the store inside the callback and returns immediately.
    interactionContext.enterWith(undefined)
    syncInteractionOTelBridge()
    return
  }

  const duration = Date.now() - spanContext.startTime
  spanContext.span.setAttributes({
    'interaction.duration_ms': duration,
  })

  spanContext.span.end()
  spanContext.ended = true
  activeSpans.delete(getSpanId(spanContext.span))
  interactionContext.enterWith(undefined)
  syncInteractionOTelBridge()
}

export function startLLMRequestSpan(
  model: string,
  newContext?: LLMRequestNewContext,
  messagesForAPI?: APIMessage[],
  fastMode?: boolean,
): Span {
  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startLLMRequestPerfettoSpan({
        model,
        querySource: newContext?.querySource,
        messageId: undefined, // Will be set in endLLMRequestSpan
      })
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: { model },
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      strongSpans.set(spanId, spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = interactionContext.getStore()

  const attributes = createSpanAttributes('llm_request', {
    model: model,
    'gen_ai.system': 'anthropic',
    'gen_ai.request.model': model,
    'gen_ai.conversation.id': getSessionId(),
    'llm_request.context': parentSpanCtx ? 'interaction' : 'standalone',
    speed: fastMode ? 'fast' : 'normal',
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan('claude_code.llm_request', { attributes }, ctx)

  // Add query_source (agent name) if provided
  if (newContext?.querySource) {
    span.setAttribute('query_source', newContext.querySource)
  }

  // Add experimental attributes (system prompt, new_context)
  addBetaLLMRequestAttributes(span, newContext, messagesForAPI)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

/**
 * End an LLM request span and attach response metadata.
 *
 * @param span - Optional. The exact span returned by startLLMRequestSpan().
 *   IMPORTANT: When multiple LLM requests run in parallel (e.g., warmup requests,
 *   topic classifier, file path extractor, main thread), you MUST pass the specific span
 *   to ensure responses are attached to the correct request. Without it, responses may be
 *   incorrectly attached to whichever span happens to be "last" in the activeSpans map.
 *
 *   If not provided, falls back to finding the most recent llm_request span (legacy behavior).
 */
export function addLLMRequestAttemptEvent(
  span: Span | undefined,
  { attempt, clientRequestId }: { attempt: number; clientRequestId?: string },
): void {
  const attrs: Record<string, string | number> = { attempt }
  if (clientRequestId !== undefined) attrs.client_request_id = clientRequestId
  if (span && isAnyTracingEnabled()) {
    span.addEvent('gen_ai.request.attempt', attrs)
  }
}

export function endLLMRequestSpan(
  span?: Span,
  metadata?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    success?: boolean
    statusCode?: number
    error?: string
    errorClass?: string
    attempt?: number
    modelResponse?: string
    /** Text output from the model (non-thinking content) */
    modelOutput?: string
    /** Thinking/reasoning output from the model */
    thinkingOutput?: string
    /** Whether the output included tool calls (look at tool spans for details) */
    hasToolCall?: boolean
    /** Time to first token in milliseconds */
    ttftMs?: number
    firstContentMs?: number
    effort?: string
    /** Time spent in pre-request setup before the successful attempt */
    requestSetupMs?: number
    /** Timestamps (Date.now()) of each attempt start — used to emit retry sub-spans */
    attemptStartTimes?: number[]
    requestId?: string
    clientRequestId?: string
    stopReason?: string
    traceresponse?: string
  },
): void {
  let llmSpanContext: SpanContext | undefined

  if (span) {
    // Use the provided span directly - this is the correct approach for parallel requests
    const spanId = getSpanId(span)
    llmSpanContext = activeSpans.get(spanId)?.deref()
  } else {
    // Legacy fallback: find the most recent llm_request span
    // WARNING: This can cause mismatched responses when multiple requests are in flight
    llmSpanContext = Array.from(activeSpans.values())
      .findLast(r => {
        const ctx = r.deref()
        return (
          ctx?.attributes['span.type'] === 'llm_request' ||
          ctx?.attributes['model']
        )
      })
      ?.deref()
  }

  if (!llmSpanContext) {
    // Span was already ended or never tracked
    return
  }

  const duration = Date.now() - llmSpanContext.startTime

  // End Perfetto span with full metadata
  if (llmSpanContext.perfettoSpanId) {
    endLLMRequestPerfettoSpan(llmSpanContext.perfettoSpanId, {
      ttftMs: metadata?.ttftMs,
      ttltMs: duration, // Time to last token is the total duration
      promptTokens: metadata?.inputTokens,
      outputTokens: metadata?.outputTokens,
      cacheReadTokens: metadata?.cacheReadTokens,
      cacheCreationTokens: metadata?.cacheCreationTokens,
      success: metadata?.success,
      error: metadata?.error,
      requestSetupMs: metadata?.requestSetupMs,
      attemptStartTimes: metadata?.attemptStartTimes,
    })
  }

  if (!isAnyTracingEnabled()) {
    const spanId = getSpanId(llmSpanContext.span)
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    return
  }

  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (metadata) {
    if (metadata.inputTokens !== undefined)
      endAttributes['input_tokens'] = metadata.inputTokens
    if (metadata.outputTokens !== undefined)
      endAttributes['output_tokens'] = metadata.outputTokens
    if (metadata.cacheReadTokens !== undefined)
      endAttributes['cache_read_tokens'] = metadata.cacheReadTokens
    if (metadata.cacheCreationTokens !== undefined)
      endAttributes['cache_creation_tokens'] = metadata.cacheCreationTokens
    if (metadata.success !== undefined)
      endAttributes['success'] = metadata.success
    if (metadata.statusCode !== undefined)
      endAttributes['status_code'] = metadata.statusCode
    Object.assign(
      endAttributes,
      formatErrorAttributes(metadata.error, metadata.errorClass),
    )
    if (metadata.attempt !== undefined)
      endAttributes['attempt'] = metadata.attempt
    if (metadata.hasToolCall !== undefined)
      endAttributes['response.has_tool_call'] = metadata.hasToolCall
    if (metadata.ttftMs !== undefined)
      endAttributes['ttft_ms'] = metadata.ttftMs
    if (metadata.firstContentMs !== undefined)
      endAttributes['first_content_ms'] = metadata.firstContentMs
    if (metadata.effort !== undefined) endAttributes['effort'] = metadata.effort
    if (metadata.requestId !== undefined) {
      endAttributes['request_id'] = metadata.requestId
      endAttributes['gen_ai.response.id'] = metadata.requestId
    }
    if (metadata.clientRequestId !== undefined) {
      endAttributes['client_request_id'] = metadata.clientRequestId
    }

    // Add experimental response attributes (model_output, thinking_output)
    addBetaLLMResponseAttributes(endAttributes, metadata)
  }

  llmSpanContext.span.setAttributes(endAttributes)
  if (metadata?.stopReason !== undefined) {
    llmSpanContext.span.setAttribute('stop_reason', metadata.stopReason)
    llmSpanContext.span.setAttribute('gen_ai.response.finish_reasons', [
      metadata.stopReason,
    ])
  }
  if (metadata?.success === false) {
    llmSpanContext.span.setStatus(buildErrorStatus(metadata.error))
  }
  if (metadata?.traceresponse) {
    const linkedCtx = parseTraceparentSpanContext(metadata.traceresponse)
    if (linkedCtx) {
      llmSpanContext.span.addLink({
        context: linkedCtx,
        attributes: { 'link.type': 'parent_of' },
      })
    }
  }
  llmSpanContext.span.end()

  const spanId = getSpanId(llmSpanContext.span)
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}

export function startToolSpan(
  toolName: string,
  toolAttributes?: Record<string, string | number | boolean>,
  toolInput?: string,
): Span {
  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startToolPerfettoSpan(toolName, toolAttributes)
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: { 'span.type': 'tool', tool_name: toolName },
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      toolContext.enterWith(spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = interactionContext.getStore()

  const mcpTool = parseMcpToolNameForGenAi(toolName)
  const toolCallId =
    typeof toolAttributes?.tool_use_id === 'string'
      ? toolAttributes.tool_use_id
      : undefined
  const attributes = createSpanAttributes('tool', {
    tool_name: toolName,
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': mcpTool?.mcpToolName ?? toolName,
    ...(mcpTool ? { 'anthropic.mcp.server.name': mcpTool.serverName } : {}),
    ...(toolCallId ? { 'gen_ai.tool.call.id': toolCallId } : {}),
    ...toolAttributes,
  })

  // Official startToolSpan parent is xne() (OTel ALS). Prefer an active
  // OTel span so Qrp(extracted traceparent) actually parents the resume
  // tool span; fall back to interaction ALS when OTel context is empty.
  const activeOtelSpan = trace.getSpan(otelContext.active())
  const activeOtelCtx = activeOtelSpan?.spanContext()
  const otelParentValid =
    !!activeOtelCtx?.traceId &&
    activeOtelCtx.traceId !== '00000000000000000000000000000000'
  const parentSpan =
    otelParentValid && activeOtelSpan ? activeOtelSpan : parentSpanCtx?.span
  const ctx = parentSpan
    ? trace.setSpan(otelContext.active(), parentSpan)
    : otelContext.active()
  const span = tracer.startSpan('claude_code.tool', { attributes }, ctx)

  // Add experimental tool input attributes
  if (toolInput) {
    addBetaToolInputAttributes(span, toolName, toolInput)
  }

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))

  toolContext.enterWith(spanContextObj)

  return span
}

export function startToolBlockedOnUserSpan(): Span {
  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startUserInputPerfettoSpan('tool_permission')
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: { 'span.type': 'tool.blocked_on_user' },
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      strongSpans.set(spanId, spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore()

  const attributes = createSpanAttributes('tool.blocked_on_user')

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan(
    'claude_code.tool.blocked_on_user',
    { attributes },
    ctx,
  )

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

export function endToolBlockedOnUserSpan(
  decision?: string,
  source?: string,
): void {
  const blockedSpanContext = Array.from(activeSpans.values())
    .findLast(
      r => r.deref()?.attributes['span.type'] === 'tool.blocked_on_user',
    )
    ?.deref()

  if (!blockedSpanContext) {
    return
  }

  // End Perfetto span
  if (blockedSpanContext.perfettoSpanId) {
    endUserInputPerfettoSpan(blockedSpanContext.perfettoSpanId, {
      decision,
      source,
    })
  }

  if (!isAnyTracingEnabled()) {
    const spanId = getSpanId(blockedSpanContext.span)
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    return
  }

  const duration = Date.now() - blockedSpanContext.startTime
  const attributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (decision) {
    attributes['decision'] = decision
  }
  if (source) {
    attributes['source'] = source
  }

  blockedSpanContext.span.setAttributes(attributes)
  blockedSpanContext.span.end()

  const spanId = getSpanId(blockedSpanContext.span)
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}

export function startToolExecutionSpan(): Span {
  if (!isAnyTracingEnabled()) {
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore()

  const attributes = createSpanAttributes('tool.execution')

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan(
    'claude_code.tool.execution',
    { attributes },
    ctx,
  )

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

export function endToolExecutionSpan(metadata?: {
  success?: boolean
  error?: string
  errorClass?: string
  interrupted?: boolean
}): void {
  if (!isAnyTracingEnabled()) {
    return
  }

  const executionSpanContext = Array.from(activeSpans.values())
    .findLast(r => r.deref()?.attributes['span.type'] === 'tool.execution')
    ?.deref()

  if (!executionSpanContext) {
    return
  }

  const duration = Date.now() - executionSpanContext.startTime
  const attributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (metadata) {
    if (metadata.success !== undefined) attributes['success'] = metadata.success
    if (metadata.success === false && !metadata.interrupted) {
      attributes['error.type'] = 'tool_error'
    }
    Object.assign(
      attributes,
      formatErrorAttributes(metadata.error, metadata.errorClass),
    )
  }

  executionSpanContext.span.setAttributes(attributes)
  if (metadata?.success === false) {
    executionSpanContext.span.setStatus(buildErrorStatus(metadata.error))
  }
  executionSpanContext.span.end()

  const spanId = getSpanId(executionSpanContext.span)
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}

export function endToolSpan(toolResult?: string, resultTokens?: number): void {
  const toolSpanContext = toolContext.getStore()

  if (!toolSpanContext) {
    return
  }

  // End Perfetto span
  if (toolSpanContext.perfettoSpanId) {
    endToolPerfettoSpan(toolSpanContext.perfettoSpanId, {
      success: true,
      resultTokens,
    })
  }

  if (!isAnyTracingEnabled()) {
    const spanId = getSpanId(toolSpanContext.span)
    activeSpans.delete(spanId)
    // Same reasoning as interactionContext above: clear so subsequent async
    // work doesn't hold a stale reference to the ended tool span.
    toolContext.enterWith(undefined)
    return
  }

  const duration = Date.now() - toolSpanContext.startTime
  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  // Add experimental tool result attributes (new_context)
  if (toolResult) {
    const toolName = toolSpanContext.attributes['tool_name'] || 'unknown'
    addBetaToolResultAttributes(endAttributes, toolName, toolResult)
  }

  if (resultTokens !== undefined) {
    endAttributes['result_tokens'] = resultTokens
  }

  toolSpanContext.span.setAttributes(endAttributes)
  toolSpanContext.span.end()

  const spanId = getSpanId(toolSpanContext.span)
  activeSpans.delete(spanId)
  toolContext.enterWith(undefined)
}

function isToolContentLoggingEnabled(): boolean {
  return isEnvTruthy(process.env.OTEL_LOG_TOOL_CONTENT)
}

/**
 * Add a span event with tool content/output data.
 * Only logs if OTEL_LOG_TOOL_CONTENT=1 is set.
 * Truncates content if it exceeds MAX_CONTENT_SIZE.
 */
export function addToolContentEvent(
  eventName: string,
  attributes: Record<string, string | number | boolean>,
): void {
  if (!isAnyTracingEnabled() || !isToolContentLoggingEnabled()) {
    return
  }

  const currentSpanCtx = toolContext.getStore()
  if (!currentSpanCtx) {
    return
  }

  // Truncate string attributes that might be large
  const processedAttributes: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string') {
      const { content, truncated } = truncateContent(value)
      processedAttributes[key] = content
      if (truncated) {
        processedAttributes[`${key}_truncated`] = true
        processedAttributes[`${key}_original_length`] = value.length
      }
    } else {
      processedAttributes[key] = value
    }
  }

  currentSpanCtx.span.addEvent(eventName, processedAttributes)
}

export function getCurrentSpan(): Span | null {
  if (!isAnyTracingEnabled()) {
    return null
  }

  return (
    toolContext.getStore()?.span ?? interactionContext.getStore()?.span ?? null
  )
}

export async function executeInSpan<T>(
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!isAnyTracingEnabled()) {
    return fn(trace.getActiveSpan() || getTracer().startSpan('dummy'))
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore() ?? interactionContext.getStore()

  const finalAttributes = createSpanAttributes('tool', {
    ...attributes,
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan(spanName, { attributes: finalAttributes }, ctx)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes: finalAttributes,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  try {
    const result = await fn(span)
    span.end()
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    return result
  } catch (error) {
    if (error instanceof Error) {
      span.recordException(error)
    }
    span.end()
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    throw error
  }
}

/**
 * Start a hook execution span.
 * Only creates a span when beta tracing is enabled.
 * @param hookEvent The hook event type (e.g., 'PreToolUse', 'PostToolUse')
 * @param hookName The full hook name (e.g., 'PreToolUse:Write')
 * @param numHooks The number of hooks being executed
 * @param hookDefinitions JSON string of hook definitions for tracing
 * @returns The span (or a dummy span if tracing is disabled)
 */
export function startHookSpan(
  hookEvent: string,
  hookName: string,
  numHooks: number,
  hookDefinitions: string,
): Span {
  if (!isBetaTracingEnabled()) {
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore() ?? interactionContext.getStore()

  const attributes = createSpanAttributes('hook', {
    hook_event: hookEvent,
    hook_name: hookName,
    num_hooks: numHooks,
    hook_definitions: hookDefinitions,
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan('claude_code.hook', { attributes }, ctx)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

/**
 * End a hook execution span with outcome metadata.
 * Only does work when beta tracing is enabled.
 * @param span The span to end (returned from startHookSpan)
 * @param metadata The outcome metadata for the hook execution
 */
export function endHookSpan(
  span: Span,
  metadata?: {
    numSuccess?: number
    numBlocking?: number
    numNonBlockingError?: number
    numCancelled?: number
  },
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const spanId = getSpanId(span)
  const spanContext = activeSpans.get(spanId)?.deref()

  if (!spanContext) {
    return
  }

  const duration = Date.now() - spanContext.startTime
  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (metadata) {
    if (metadata.numSuccess !== undefined)
      endAttributes['num_success'] = metadata.numSuccess
    if (metadata.numBlocking !== undefined)
      endAttributes['num_blocking'] = metadata.numBlocking
    if (metadata.numNonBlockingError !== undefined)
      endAttributes['num_non_blocking_error'] = metadata.numNonBlockingError
    if (metadata.numCancelled !== undefined)
      endAttributes['num_cancelled'] = metadata.numCancelled
  }

  spanContext.span.setAttributes(endAttributes)
  spanContext.span.end()
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}
