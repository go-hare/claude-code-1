import type { Attributes } from '@opentelemetry/api'
import { getEventLogger, getPromptId } from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'

// Monotonically increasing counter for ordering events within a session
let eventSequence = 0

// Track whether we've already warned about a null event logger to avoid spamming
let hasWarnedNoEventLogger = false

/** Official bLh — max chars kept when OTEL content logging is enabled. */
export const OTEL_CONTENT_TRUNCATE_LIMIT = 61440

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
 * Official WU densable — truncate OTEL content past 60KB with a marker.
 */
export function truncateOTelContent(
  content: string,
  limit: number = OTEL_CONTENT_TRUNCATE_LIMIT,
): { content: string; truncated: boolean } {
  if (content.length <= limit) {
    return { content, truncated: false }
  }
  return {
    content:
      content.slice(0, limit) + '\n\n[TRUNCATED - Content exceeds 60KB limit]',
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

  // Emit log record as an event
  eventLogger.emit({
    body: `claude_code.${eventName}`,
    attributes,
  })
}
