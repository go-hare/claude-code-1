import { validateBoundedIntEnvVar } from '../envValidation.js'
import { getInitialSettings } from '../settings/settings.js'

export const BASH_MAX_OUTPUT_UPPER_LIMIT = 150_000
export const BASH_MAX_OUTPUT_DEFAULT = 30_000
/** densable wLo — settings clamp floor */
export const BASH_OUTPUT_MAX_CHARS_MIN = 4_000
/** densable n9e — settings clamp ceiling */
export const BASH_OUTPUT_MAX_CHARS_MAX = 128_000

/**
 * densable A — clamp bashOutputMaxChars to 4000–128000.
 */
export function clampBashOutputMaxChars(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined
  return Math.min(
    Math.max(value, BASH_OUTPUT_MAX_CHARS_MIN),
    BASH_OUTPUT_MAX_CHARS_MAX,
  )
}

/**
 * densable Uqe — settings-only (preview / default 30k when unset).
 */
export function getBashOutputMaxCharsSetting(
  settingsValue: number | undefined = getInitialSettings().bashOutputMaxChars,
): number {
  return clampBashOutputMaxChars(settingsValue) ?? BASH_MAX_OUTPUT_DEFAULT
}

/**
 * densable zae — inline Bash/PowerShell output cap.
 * Settings bashOutputMaxChars wins over BASH_MAX_OUTPUT_LENGTH.
 */
export function resolveMaxOutputLength(
  settingsValue: number | undefined,
  envValue: string | undefined,
): number {
  const fromSettings = clampBashOutputMaxChars(settingsValue)
  if (fromSettings !== undefined) return fromSettings
  return validateBoundedIntEnvVar(
    'BASH_MAX_OUTPUT_LENGTH',
    envValue,
    BASH_MAX_OUTPUT_DEFAULT,
    BASH_MAX_OUTPUT_UPPER_LIMIT,
  ).effective
}

export function getMaxOutputLength(): number {
  return resolveMaxOutputLength(
    getInitialSettings().bashOutputMaxChars,
    process.env.BASH_MAX_OUTPUT_LENGTH,
  )
}
