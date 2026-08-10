import { parsePositiveEnvInt } from './envUtils.js'

// Constants for timeout values
const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
const MAX_TIMEOUT_MS = 600_000 // 10 minutes

type EnvLike = Record<string, string | undefined>

/**
 * Get the default timeout for bash operations in milliseconds
 * Checks BASH_DEFAULT_TIMEOUT_MS environment variable or returns 2 minutes default
 * densable 2.1.211: accepts scientific / underscore spellings (`1e6`, `64_000`).
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getDefaultBashTimeoutMs(env: EnvLike = process.env): number {
  const parsed = parsePositiveEnvInt(env.BASH_DEFAULT_TIMEOUT_MS)
  return parsed ?? DEFAULT_TIMEOUT_MS
}

/**
 * Get the maximum timeout for bash operations in milliseconds
 * Checks BASH_MAX_TIMEOUT_MS environment variable or returns 10 minutes default
 * densable 2.1.211: accepts scientific / underscore spellings.
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getMaxBashTimeoutMs(env: EnvLike = process.env): number {
  const parsed = parsePositiveEnvInt(env.BASH_MAX_TIMEOUT_MS)
  if (parsed !== undefined) {
    // Ensure max is at least as large as default
    return Math.max(parsed, getDefaultBashTimeoutMs(env))
  }
  // Always ensure max is at least as large as default
  return Math.max(MAX_TIMEOUT_MS, getDefaultBashTimeoutMs(env))
}
