/**
 * Official terminal feature env/GB gates (portable):
 * CLAUDE_CODE_DECSTBM / NATIVE_CURSOR
 *
 * Official DECSTBM also hard-disables when screen-reader mode is on (uU()).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'
import { isScreenReaderModeEnabled } from './screenReaderGate.js'

export function isDecstbmEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
  /** Official uU() — screen-reader mode disables DECSTBM. */
  isScreenReader?: boolean
}): boolean {
  const env = input?.env ?? process.env
  const screenReader =
    input?.isScreenReader ?? isScreenReaderModeEnabled({ env })
  if (screenReader) return false
  if (env.CLAUDE_CODE_DECSTBM !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_DECSTBM)
  }
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_marlin_porch', false)
}

export function isNativeCursorEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (env.CLAUDE_CODE_NATIVE_CURSOR !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_NATIVE_CURSOR)
  }
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_native_cursor', false)
}
