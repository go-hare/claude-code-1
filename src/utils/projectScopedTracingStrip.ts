/**
 * densable 2.1.251 `N` — project and local settings cannot set
 * tracing keys or path-redirect env from `vyr`.
 */

import { logForDebugging } from './debug.js'

const PROJECT_SCOPED_SOURCES = new Set(['projectSettings', 'localSettings'])

/**
 * densable `vyr` — tracing keys (#8) plus path-redirect keys (#68).
 * Not SAFE_ENV_VARS; #67 owns managedEnvConstants.ts.
 */
const PROJECT_SCOPED_BLOCKED_KEYS = new Set([
  'ENABLE_BETA_TRACING_DETAILED',
  'BETA_TRACING_ENDPOINT',
  'OTEL_LOG_RAW_API_BODIES',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'CLAUDE_CODE_TMPDIR',
  'CLAUDE_TMPDIR',
  'TMPDIR',
  'TMP',
  'TEMP',
])

const warnedKeys = new Set<string>()

export function clearProjectScopedTracingWarnsForTests(): void {
  warnedKeys.clear()
}

/**
 * densable `N` — delete tracing keys from a project/local settings env object.
 * Other sources are returned unchanged.
 */
export function stripProjectScopedTracingEnv(
  env: Record<string, string> | undefined,
  source: string,
): Record<string, string> | undefined {
  if (!env || !PROJECT_SCOPED_SOURCES.has(source)) return env
  let copy: Record<string, string> | undefined
  for (const key of Object.keys(env)) {
    if (!PROJECT_SCOPED_BLOCKED_KEYS.has(key.toUpperCase())) continue
    if (!copy) copy = { ...env }
    delete copy[key]
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key)
      const file =
        source === 'localSettings'
          ? '.claude/settings.local.json'
          : '.claude/settings.json'
      logForDebugging(
        `${key} in ${file} is ignored \u2014 project-scoped settings can't set this key. Set it in ~/.claude/settings.json or managed settings instead.`,
        { level: 'warn' },
      )
    }
  }
  return copy ?? env
}

export function stripProjectScopedTracingSettings<
  T extends { env?: Record<string, string> },
>(settings: T, source: string): T {
  if (!settings.env) return settings
  const env = stripProjectScopedTracingEnv(settings.env, source)
  if (env === settings.env) return settings
  return { ...settings, env }
}
