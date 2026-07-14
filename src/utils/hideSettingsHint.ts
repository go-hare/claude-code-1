/**
 * Official CXa — whether to show the settings/config hint.
 *
 * Hidden when CLAUDE_CODE_HIDE_SETTINGS_HINT is truthy, or when ENTRYPOINT
 * is a remote/non-interactive host (slack/teams/remote_trigger/cowork/baku).
 */

import { isEnvTruthy } from './envUtils.js'

/** Official cfm — entrypoints that never show the settings hint. */
export const HIDE_SETTINGS_HINT_ENTRYPOINTS = new Set([
  'claude_in_slack',
  'claude-in-slack',
  'claude-in-teams',
  'remote_trigger',
  'remote_cowork',
  'remote_baku',
])

export function shouldShowSettingsHint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_HIDE_SETTINGS_HINT)) return false
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  if (entry === undefined) return true
  return !HIDE_SETTINGS_HINT_ENTRYPOINTS.has(entry)
}

/** Official zze — SDK entrypoints. */
export function isSdkEntrypoint(env: NodeJS.ProcessEnv = process.env): boolean {
  const e = env.CLAUDE_CODE_ENTRYPOINT
  return e === 'sdk-ts' || e === 'sdk-py' || e === 'sdk-cli'
}
