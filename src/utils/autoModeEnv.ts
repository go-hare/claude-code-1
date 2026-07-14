/**
 * Official CLAUDE_CODE_ENABLE_AUTO_MODE portable gate.
 */

import { isEnvTruthy } from './envUtils.js'

export function isAutoModeEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_AUTO_MODE)
}
