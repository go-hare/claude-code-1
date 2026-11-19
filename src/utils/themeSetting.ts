import { getGlobalConfig } from './config.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from './settings/settings.js'
import {
  CUSTOM_THEME_PREFIX,
  THEME_SETTINGS,
  type ThemeSetting,
} from './theme.js'

const DEFAULT_THEME_SETTING: ThemeSetting = 'dark'

function asThemeSetting(value: unknown): ThemeSetting | undefined {
  if (typeof value !== 'string') return undefined
  if ((THEME_SETTINGS as readonly string[]).includes(value)) {
    return value as ThemeSetting
  }
  if (
    value.startsWith(CUSTOM_THEME_PREFIX) &&
    value.length > CUSTOM_THEME_PREFIX.length
  ) {
    return value as ThemeSetting
  }
  return undefined
}

/**
 * densable 2.1.289 `Yo("theme","dark")` + Official 2.1.326 #347 (`rPr`):
 * merged settings win; legacy GlobalConfig.theme is read only when it differs
 * from `'dark'`. First-run users who have not completed onboarding and have no
 * configured theme default to `'auto'` (match terminal); existing users keep
 * `'dark'`.
 */
export function getThemeSetting(): ThemeSetting {
  const fromSettings = asThemeSetting(getInitialSettings().theme)
  if (fromSettings !== undefined) return fromSettings
  const legacy = getGlobalConfig().theme
  if (legacy !== DEFAULT_THEME_SETTING) {
    const parsed = asThemeSetting(legacy)
    if (parsed !== undefined) return parsed
  }
  const { hasCompletedOnboarding, lastOnboardingVersion } = getGlobalConfig()
  if (!hasCompletedOnboarding && lastOnboardingVersion === undefined) {
    return 'auto'
  }
  return DEFAULT_THEME_SETTING
}

/** densable 2.1.289 `W2("theme", e)` — persist to userSettings. */
export function saveThemeSetting(setting: ThemeSetting): void {
  updateSettingsForSource('userSettings', { theme: setting })
}
