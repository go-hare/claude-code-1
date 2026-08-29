/**
 * densable B4w / KHl / YHl / fqi — /auto-mode-setup gates.
 * Gold: gold-function_KHl_-0.txt · gold-auto-mode-setup-callgraph.md
 *
 * D7r: not present as a closed text dump; mapped to TRANSCRIPT_CLASSIFIER
 * (auto-mode product surface). Re-peel if SEA shows a different predicate.
 */
import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { resolveTenguAutoModeConfig } from '../../utils/permissions/autoModeFlags.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { resolveAutoModeSetupClassifierModel } from './classifierModel.js'

/** densable B4w: `!V.CLAUDE_CODE_REMOTE && D7r()` — any non-empty string disables. */
export function isAutoModeSetupBaseGate(): boolean {
  if (process.env.CLAUDE_CODE_REMOTE) return false
  // densable D7r — tip: auto-mode product compile gate
  if (feature('TRANSCRIPT_CLASSIFIER')) return true
  return false
}

/** densable KHl — base + classifier model available */
export function isAutoModeSetupEnabled(): boolean {
  return (
    isAutoModeSetupBaseGate() && resolveAutoModeSetupClassifierModel() !== ''
  )
}

/** densable YHl — interactive needs envOnboarding GB flag */
export function isAutoModeSetupInteractiveEnabled(): boolean {
  if (!isAutoModeSetupEnabled()) return false
  const config = resolveTenguAutoModeConfig() as { envOnboarding?: unknown }
  return config.envOnboarding === true
}

/** densable fqi — skillOverrides off kills listing (slash still gated by YHl) */
export function isAutoModeSetupSkillAllowed(): boolean {
  if (!isAutoModeSetupInteractiveEnabled()) return false
  const overrides = getSettings_DEPRECATED()?.skillOverrides
  return overrides?.['auto-mode-setup'] !== 'off'
}

export function isAutoModeSetupLocalJsxEnabled(): boolean {
  return isAutoModeSetupInteractiveEnabled() && !getIsNonInteractiveSession()
}

export function isAutoModeSetupLocalEnabled(): boolean {
  return isAutoModeSetupEnabled() && getIsNonInteractiveSession()
}
