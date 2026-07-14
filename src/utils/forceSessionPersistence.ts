/**
 * Official CLAUDE_CODE_FORCE_SESSION_PERSISTENCE — force session transcript
 * writes even when other paths would disable persistence.
 */

import { isEnvTruthy } from './envUtils.js'

export function isForceSessionPersistenceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE)
}
