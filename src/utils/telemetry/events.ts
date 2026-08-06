import {
  type Attributes,
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
let eventSequence = 0

// Track whether we've already warned about a null event logger to avoid spamming
let hasWarnedNoEventLogger = false

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

function isUserPromptLoggingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.OTEL_LOG_USER_PROMPTS)
}

export function redactIfDisabled(content: string): string {
  return isUserPromptLoggingEnabled() ? content : '<REDACTED>'
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

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  const eventLogger = getEventLogger()
  if (!eventLogger) {
    if (!hasWarnedNoEventLogger) {
      hasWarnedNoEventLogger = true
      logForDebugging(
        `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
        { level: 'warn' },
      )
    }
    return
  }

  // Skip logging in test environment
  if (process.env.NODE_ENV === 'test') {
    return
  }

  const attributes: Attributes = {
    ...getTelemetryAttributes(),
    'event.name': eventName,
    'event.timestamp': new Date().toISOString(),
    'event.sequence': eventSequence++,
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

  // densable gu: ...a&&{context:a} so exporters stamp trace_id/span_id
  const parentContext = getOTelEventParentContext()
  eventLogger.emit({
    body: `claude_code.${eventName}`,
    attributes,
    timestamp: new Date(),
    observedTimestamp: new Date(),
    ...(parentContext && { context: parentContext }),
  })
}
