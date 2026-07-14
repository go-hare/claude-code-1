/**
 * Official zNy — CLAUDE_CODE_COLD_COMPACT.
 *
 * When truthy, autocompact may run a "cold" path (aggressive eviction /
 * document+image awareness). Image/document strip already runs on compact;
 * this densable lowers the autocompact threshold earlier via buffer scale.
 */

import { isEnvTruthy } from './envUtils.js'

/** Scale applied to autocompact buffer when cold compact is on (earlier fire). */
export const COLD_COMPACT_BUFFER_SCALE = 1.5

export function isColdCompactEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_COLD_COMPACT)
}

/**
 * Official zNy densable — buffer multiplier for getAutoCompactThreshold.
 * cold on → 1.5 (larger buffer = lower threshold = more aggressive).
 */
export function resolveColdCompactBufferScale(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return isColdCompactEnabled(env) ? COLD_COMPACT_BUFFER_SCALE : 1
}

/**
 * Official zNy densable pure — scale an autocompact buffer token count.
 */
export function scaleAutocompactBufferForColdCompact(
  bufferTokens: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const scale = resolveColdCompactBufferScale(env)
  if (scale === 1) return bufferTokens
  return Math.floor(bufferTokens * scale)
}
