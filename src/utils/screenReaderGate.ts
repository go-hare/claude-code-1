/**
 * Official wbc / zBn densable — screen-reader mode activation.
 *
 * Priority (official isEnabled):
 *   1. CLI flag `--ax-screen-reader` → on, source "flag"
 *   2. env CLAUDE_AX_SCREEN_READER defined → truthy/falsy of env, source "env"
 *   3. settings.axScreenReader === true → on, source "settings"
 *   else off
 * Then AND with GB tengu_ax_screen_reader (default true). When GB off, mode
 * is disabled and activationSource is undefined.
 *
 * Ink onRenderScreenReader / computeScreenReaderPark live in
 * packages/@ant/ink/src/core/screenReaderPark.ts (densified there).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'
import { getSettingsForSource } from './settings/settings.js'

export const SCREEN_READER_GB_FEATURE = 'tengu_ax_screen_reader'
export const AX_SCREEN_READER_ENV_KEY = 'CLAUDE_AX_SCREEN_READER'
export const AX_SCREEN_READER_FLAG = '--ax-screen-reader'

export type ScreenReaderActivationSource = 'flag' | 'env' | 'settings'

export type ScreenReaderGateInput = {
  env?: NodeJS.ProcessEnv
  argv?: readonly string[]
  /** settings.axScreenReader. When unset, reads userSettings. */
  axScreenReaderSetting?: boolean
  /** GB tengu_ax_screen_reader. When unset, reads cached GB (default true). */
  gbValue?: boolean
}

type Resolved = {
  enabled: boolean
  source: ScreenReaderActivationSource | undefined
}

let cached: Resolved | undefined

function hasAxScreenReaderFlag(argv: readonly string[]): boolean {
  return argv.includes(AX_SCREEN_READER_FLAG)
}

function readAxScreenReaderSetting(injected: boolean | undefined): boolean {
  if (injected !== undefined) return injected
  try {
    const settings = getSettingsForSource('userSettings') as
      | { axScreenReader?: boolean }
      | undefined
    return settings?.axScreenReader === true
  } catch {
    return false
  }
}

/**
 * Pure resolve without process cache — for tests and pure consumers.
 */
export function resolveScreenReaderMode(
  input?: ScreenReaderGateInput,
): Resolved {
  const env = input?.env ?? process.env
  const argv = input?.argv ?? process.argv

  let enabled = false
  let source: ScreenReaderActivationSource | undefined

  if (hasAxScreenReaderFlag(argv)) {
    enabled = true
    source = 'flag'
  } else if (env[AX_SCREEN_READER_ENV_KEY] !== undefined) {
    enabled = isEnvTruthy(env[AX_SCREEN_READER_ENV_KEY])
    source = 'env'
  } else if (readAxScreenReaderSetting(input?.axScreenReaderSetting)) {
    enabled = true
    source = 'settings'
  }

  if (!enabled) {
    return { enabled: false, source: undefined }
  }

  const gb =
    input?.gbValue !== undefined
      ? input.gbValue
      : Boolean(
          getFeatureValue_CACHED_MAY_BE_STALE(SCREEN_READER_GB_FEATURE, true),
        )
  if (!gb) {
    return { enabled: false, source: undefined }
  }
  return { enabled: true, source }
}

function getCached(input?: ScreenReaderGateInput): Resolved {
  // Skip process-level cache when any injection is provided (tests / pure).
  if (
    input?.env !== undefined ||
    input?.argv !== undefined ||
    input?.axScreenReaderSetting !== undefined ||
    input?.gbValue !== undefined
  ) {
    return resolveScreenReaderMode(input)
  }
  if (cached !== undefined) return cached
  cached = resolveScreenReaderMode()
  return cached
}

/** Official uU() — screen-reader mode enabled. */
export function isScreenReaderModeEnabled(
  input?: ScreenReaderGateInput,
): boolean {
  return getCached(input).enabled
}

/** Official activationSource — only when enabled. */
export function getScreenReaderActivationSource(
  input?: ScreenReaderGateInput,
): ScreenReaderActivationSource | undefined {
  return getCached(input).source
}

/** Official Abc — banner string or null. */
export function formatScreenReaderModeBanner(
  input?: ScreenReaderGateInput,
): string | null {
  if (!isScreenReaderModeEnabled(input)) return null
  const source = getScreenReaderActivationSource(input)
  return source
    ? `[Screen Reader Mode: on via ${source}]`
    : '[Screen Reader Mode: on]'
}

/**
 * Official FXe — child process env overlay when screen-reader mode is on.
 * Propagates CLAUDE_AX_SCREEN_READER=1 so subprocesses inherit mode.
 */
export function getScreenReaderChildEnv(
  input?: ScreenReaderGateInput,
): Record<string, string> {
  if (!isScreenReaderModeEnabled(input)) return {}
  return { [AX_SCREEN_READER_ENV_KEY]: '1' }
}

/** Official zBn.reset — clear process-level cache. */
export function resetScreenReaderModeCache(): void {
  cached = undefined
}

/**
 * Official: hide native cursor unless accessibility or screen-reader mode.
 * CLAUDE_CODE_ACCESSIBILITY is separate (magnifier) from ax screen-reader.
 */
export function shouldHideNativeCursor(input?: {
  env?: NodeJS.ProcessEnv
  screenReaderEnabled?: boolean
}): boolean {
  const env = input?.env ?? process.env
  // Official ACCESSIBILITY densable (magnifier) — separate from ax screen-reader.
  let accessibility = isEnvTruthy(env.CLAUDE_CODE_ACCESSIBILITY)
  try {
    const { isAccessibilityEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    accessibility = isAccessibilityEnvEnabled(env)
  } catch {
    // keep raw env fallback
  }
  if (accessibility) return false
  const sr = input?.screenReaderEnabled ?? isScreenReaderModeEnabled({ env })
  if (sr) return false
  return true
}
