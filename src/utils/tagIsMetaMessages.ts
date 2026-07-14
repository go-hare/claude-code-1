/**
 * Official CLAUDE_CODE_TAG_ISMETA_MESSAGES portable gate.
 *
 * When enabled, certain synthetic/system-generated user messages are tagged
 * `isMeta: true` so they are excluded from user-facing history surfaces.
 * Full call-site densification is progressive; helpers centralize the gate.
 */

import { isEnvTruthy } from './envUtils.js'

export function shouldTagIsMetaMessages(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_TAG_ISMETA_MESSAGES)
}

/**
 * Apply isMeta when the gate is on. Existing true is preserved; when gate is
 * off, returns the input value unchanged.
 */
export function withTagIsMeta(
  isMeta: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  if (!shouldTagIsMetaMessages(env)) return isMeta
  return true
}
