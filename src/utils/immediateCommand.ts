import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isFullscreenFeatureGateEnabled } from './fullscreen.js'

/**
 * densable X3e — whether inference-config commands (/model, /fast, /effort)
 * should execute immediately (during a running query) rather than waiting for
 * the current turn to finish.
 *
 * Always enabled for ants; gated by experiment for external users.
 */
export function shouldInferenceConfigCommandBeImmediate(): boolean {
  return (
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_immediate_model_command', false)
  )
}

/**
 * densable Ns — fullscreen *feature* gate (tengu_pewter_brook / settings.tui),
 * used by /help /theme /add-dir (dialog) mid-turn immediacy.
 */
export function shouldFullscreenCommandBeImmediate(): boolean {
  return isFullscreenFeatureGateEnabled()
}

/**
 * densable RVr — Ns() && X3e(). Used by /config and /advisor when opening the
 * dialog with empty args (mid-turn only when fullscreen + model-command gate).
 */
export function shouldFullscreenInferenceCommandBeImmediate(): boolean {
  return (
    shouldFullscreenCommandBeImmediate() &&
    shouldInferenceConfigCommandBeImmediate()
  )
}

/**
 * densable ARt(cmd, args) — resolve Command.immediate which may be boolean or
 * `(args: string) => boolean`. Only `true` / function returning true is immediate.
 */
export function isCommandImmediate(
  command:
    | { immediate?: boolean | ((args: string) => boolean) }
    | null
    | undefined,
  args: string,
): boolean {
  const immediate = command?.immediate
  return typeof immediate === 'function' ? immediate(args) : immediate === true
}
