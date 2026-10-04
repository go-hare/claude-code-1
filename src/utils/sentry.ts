/**
 * Sentry integration module
 *
 * Initializes Sentry SDK when SENTRY_DSN environment variable is set.
 * When DSN is not configured, all exports are no-ops.
 */

import * as Sentry from '@sentry/node'
import { logForDebugging } from './debug.js'

declare const BUILD_ENV: string | undefined

let initialized = false

/**
 * Initialize Sentry SDK. Safe to call multiple times — subsequent calls are no-ops.
 * Only activates when SENTRY_DSN environment variable is set.
 */
export function initSentry(): void {
  // Product-cut: never initialize Anthropic/Sentry error reporting.
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) {
    return
  }

  try {
    Sentry.withScope(scope => {
      if (context) {
        scope.setExtras(context)
      }
      Sentry.captureException(error)
    })
  } catch {
    // Sentry itself failed — don't let it crash the app
  }
}

/**
 * Set a tag on the current scope for grouping/filtering in Sentry.
 * No-op if Sentry has not been initialized.
 */
export function setTag(key: string, value: string): void {
  if (!initialized) {
    return
  }

  try {
    Sentry.setTag(key, value)
  } catch {
    // Ignore
  }
}

/**
 * Set user context in Sentry for error attribution.
 * No-op if Sentry has not been initialized.
 */
export function setUser(user: {
  id?: string
  email?: string
  username?: string
}): void {
  if (!initialized) {
    return
  }

  try {
    Sentry.setUser(user)
  } catch {
    // Ignore
  }
}

/**
 * Flush pending Sentry events and close the client.
 * Call during graceful shutdown to ensure events are sent.
 */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) {
    return
  }

  try {
    await Sentry.close(timeoutMs)
    logForDebugging('[sentry] Closed successfully')
  } catch {
    // Ignore — we're shutting down anyway
  }
}

/**
 * Check if Sentry is initialized. Useful for conditional UI rendering.
 */
export function isSentryInitialized(): boolean {
  return initialized
}
