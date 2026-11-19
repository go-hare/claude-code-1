/**
 * Official CLAUDE_CODE_PERFORCE_MODE portable gate + prompt addendum + startup notice.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { isEnvTruthy } from './envUtils.js'

export function isPerforceModeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PERFORCE_MODE)
}

/**
 * Official 2.1.323 `Xxt` (#1975): detect whether Perforce workspace settings
 * are present (P4CONFIG / P4PORT / P4CLIENT env vars or `.p4config` / `.p4ignore`
 * in the workspace) while `CLAUDE_CODE_PERFORCE_MODE` is off.
 */
export function hasPerforceWorkspaceSettings(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    Boolean(env.P4CONFIG?.trim()) ||
    Boolean(env.P4PORT?.trim()) ||
    Boolean(env.P4CLIENT?.trim())
  ) {
    return true
  }
  try {
    return (
      existsSync(join(cwd, '.p4config')) || existsSync(join(cwd, '.p4ignore'))
    )
  } catch {
    return false
  }
}

export const PERFORCE_MODE_OFF_NOTICE_KEY = 'perforce-mode-off'

export type PerforceStartupNotice = {
  key: string
  text: string
  priority: 'high'
  timeoutMs: number
}

/**
 * Official 2.1.323 `Xxt` (#1975): build the one-time startup notice naming
 * `CLAUDE_CODE_PERFORCE_MODE` when Perforce settings are found and the mode is off.
 */
export function buildPerforceModeOffNotice(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): PerforceStartupNotice | null {
  if (isPerforceModeEnabled(env) || !hasPerforceWorkspaceSettings(cwd, env)) {
    return null
  }
  return {
    key: PERFORCE_MODE_OFF_NOTICE_KEY,
    text: 'Perforce workspace? · set CLAUDE_CODE_PERFORCE_MODE=1 to protect read-only files',
    priority: 'high',
    timeoutMs: 15_000,
  }
}

/**
 * Official perforceMode system-prompt fragment.
 * @param shellToolName e.g. Bash or PowerShell tool name for checkout hint.
 */
export function getPerforceModePromptAddendum(shellToolName: string): string {
  return (
    `This is a Perforce workspace. Files not yet opened for edit are read-only; ` +
    `if a file is read-only, run \`p4 edit <file>\` via ${shellToolName} ` +
    `to check it out before modifying. Files that are already writable have ` +
    `been opened and can be edited directly.`
  )
}
