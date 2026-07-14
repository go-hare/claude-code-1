/**
 * Official session-role env gates (portable):
 * CLAUDE_CODE_SANDBOXED / SUPERVISED / CHILD_SESSION
 */

import { isEnvTruthy } from './envUtils.js'

export function isSandboxedSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SANDBOXED)
}

export function isSupervisedSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SUPERVISED)
}

export function isChildSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_CHILD_SESSION)
}
