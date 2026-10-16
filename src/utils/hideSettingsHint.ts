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

/**
 * densable Ilr / snt — remote host entrypoints that skip the
 * refusal-fallback preference ask (Ba). Broader than cfm.
 */
export const REMOTE_PREFERENCE_PROMPT_ENTRYPOINTS = new Set([
  'remote',
  'remote_baku',
  'remote_cowork',
  'remote_trigger',
  'remote_cowork_trigger',
  'remote_desktop',
  'remote_mobile',
  'remote_projects',
  'claude_in_slack',
  'claude-in-slack',
  'claude-in-teams',
])

/** densable snt — CLAUDE_CODE_ENTRYPOINT is in Ilr. */
export function isRemotePreferencePromptEntrypoint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  return entry !== undefined && REMOTE_PREFERENCE_PROMPT_ENTRYPOINTS.has(entry)
}

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
