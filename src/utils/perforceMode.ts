/**
 * Official CLAUDE_CODE_PERFORCE_MODE portable gate + prompt addendum.
 */

import { isEnvTruthy } from './envUtils.js'

export function isPerforceModeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PERFORCE_MODE)
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
