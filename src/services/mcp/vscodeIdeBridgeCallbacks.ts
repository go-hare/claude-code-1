/**
 * densable 2.1.235 CLI IDE bridge callbacks / option helpers for `uSm` call-site.
 *
 * Maps:
 * - `$re` / `UAi` → `isRefusalFallbackLaneEnabled`
 * - `HIn` → `isAutoDefaultLaunchEnabled` (harbor_willow || clientData.meadow_lantern)
 * - `vNh` → `getVscodeStartupAnnouncementGate` (tengu_startup_announcements top JSON | false)
 * - `VJg` / `U8E` → `handleVscodeFeedbackSurveyEvent`
 * - `Fjc` → `handleVscodeAutoDefaultNudgeEvent`
 * - `hUe` → `isClaudeVscodeHostSession`
 */

import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isModelAllowed } from 'src/utils/model/modelAllowlist.js'
import { isRefusalFallbackEnabled } from 'src/utils/refusalFallback.js'
import { updateSettingsForSource } from 'src/utils/settings/settings.js'
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isPolicyAllowed } from 'src/services/policyLimits/index.js'
import { isFeedbackSurveyEnvDisabled } from 'src/utils/residualFinalEnvGates.js'

/** densable B8E — 60s debounce for survey appeared → lastShownTime. */
const FEEDBACK_SURVEY_APPEARED_DEBOUNCE_MS = 60_000

/**
 * densable `$re` / `UAi`: refusal fallback lane for loggia carousel gates.
 * `$re = !CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK && !XUe()`;
 * `XUe = CLAUDE_CODE_NO_MODEL_FALLBACK === true`.
 */
export function isRefusalFallbackLaneEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isRefusalFallbackEnabled(env) &&
    !isEnvTruthy(env.CLAUDE_CODE_NO_MODEL_FALLBACK)
  )
}

/**
 * densable `sZs()?.meadow_lantern === true` data half of `HIn`.
 *
 * SEA `sZs` reads `clientDataCacheSlots[key]` under a strict gate. Local
 * bootstrap persists flat `clientDataCache` (same object shape; see
 * `coral_reef_sonnet` readers). Read meadow from that cache — boolean `true`
 * only (SEA `===!0`). Do not invent a GrowthBook `meadow_lantern` gate.
 */
function readClientDataMeadowLantern(): boolean {
  try {
    const cache = getGlobalConfig().clientDataCache
    if (!cache || typeof cache !== 'object') return false
    return cache.meadow_lantern === true
  } catch {
    return false
  }
}

/**
 * densable `HIn`: `et("tengu_harbor_willow", false) || sZs()?.meadow_lantern === true`.
 */
export function isAutoDefaultLaunchEnabled(): boolean {
  return (
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_harbor_willow') ||
    readClientDataMeadowLantern()
  )
}

/** densable H0w item fields needed by `vNh` (impressions UI fields unused here). */
type StartupAnnouncement = {
  id: string
  title?: string
  text: string
  footer?: string
  priority: number
  requiresModel?: string
}

/**
 * densable `bNh`: `CB("tengu_startup_announcements", [])` + zod-safe parse.
 * Invalid entries dropped; defaults: priority 0.
 */
function readStartupAnnouncementsBNh(): StartupAnnouncement[] {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_startup_announcements',
    [],
  )
  if (!Array.isArray(raw)) return []
  const out: StartupAnnouncement[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.text !== 'string') continue
    out.push({
      id: o.id,
      text: o.text,
      title: typeof o.title === 'string' ? o.title : undefined,
      footer: typeof o.footer === 'string' ? o.footer : undefined,
      priority: typeof o.priority === 'number' && Number.isFinite(o.priority)
        ? o.priority
        : 0,
      requiresModel:
        typeof o.requiresModel === 'string' ? o.requiresModel : undefined,
    })
  }
  return out
}

/** densable `SNh`: `requiresModel === undefined || ju(requiresModel)`. */
function announcementRequiresModelOk(a: StartupAnnouncement): boolean {
  return a.requiresModel === undefined || isModelAllowed(a.requiresModel)
}

/**
 * densable `vNh`: highest-priority announcement passing `SNh`, as JSON string,
 * or false. Does **not** apply impression caps (those are `N5t` UI path).
 * Payload keys: `{id,title,text,footer}` (undefined fields omitted by stringify).
 */
export function getVscodeStartupAnnouncementGate(): false | string {
  const top = readStartupAnnouncementsBNh()
    .filter(announcementRequiresModelOk)
    .sort((a, b) => b.priority - a.priority)[0]
  if (top === undefined) return false
  return JSON.stringify({
    id: top.id,
    title: top.title,
    text: top.text,
    footer: top.footer,
  })
}

/**
 * densable `hUe`: VS Code host session (not child / not CLAUDECODE wrapper).
 * Prefer CLAUDE_CODE_ENTRYPOINT (SEA Act/entrypoint) over clientType.
 */
export function isClaudeVscodeHostSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // densable Act() / ZVe.entrypoint — CLAUDE_CODE_ENTRYPOINT is authoritative
  if (env.CLAUDE_CODE_ENTRYPOINT !== 'claude-vscode') return false
  if (isEnvTruthy(env.CLAUDE_CODE_CHILD_SESSION)) return false
  if (isEnvTruthy(env.CLAUDECODE)) return false
  return true
}

function canAcceptProductFeedbackSurvey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isPolicyAllowed('allow_product_feedback')) return false
  if (isFeedbackSurveyDisabled()) return false
  if (isFeedbackSurveyEnvDisabled(env)) return false
  return true
}

/**
 * densable `VJg` → `U8E`: only `event_type === "appeared"` updates
 * `feedbackSurveyState.lastShownTime` with 60s debounce.
 */
export function handleVscodeFeedbackSurveyEvent(
  eventData: Record<string, unknown>,
): void {
  if (!canAcceptProductFeedbackSurvey()) return
  if (eventData.event_type !== 'appeared') return
  const last = getGlobalConfig().feedbackSurveyState?.lastShownTime
  if (
    last !== undefined &&
    Date.now() - last < FEEDBACK_SURVEY_APPEARED_DEBOUNCE_MS
  ) {
    return
  }
  saveGlobalConfig(current => ({
    ...current,
    feedbackSurveyState: { lastShownTime: Date.now() },
  }))
}

export type AutoDefaultNudgePhase = 'shown' | 'resolved'

/**
 * densable `Fjc(phase, eventData)`.
 * - shown → tengu_auto_default_nudge_shown (unless already seen)
 * - resolved accept → userSettings defaultMode auto + latch + resolved event
 * - resolved decline → latch + resolved event
 */
export function handleVscodeAutoDefaultNudgeEvent(
  phase: AutoDefaultNudgePhase,
  eventData: Record<string, unknown>,
): void {
  if (getGlobalConfig().hasSeenAutoDefaultNudge) return

  const currentModeRaw = eventData.current_mode
  const currentMode =
    typeof currentModeRaw === 'string' ? currentModeRaw : 'unknown'

  if (phase === 'shown') {
    logEvent('tengu_auto_default_nudge_shown', {
      current_mode:
        currentMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface:
        'ide' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }

  const choiceRaw = eventData.choice
  const choice = choiceRaw === 'accept' ? 'accept' : 'decline'
  if (choice === 'accept') {
    updateSettingsForSource('userSettings', {
      permissions: { defaultMode: 'auto' },
    })
  }
  saveGlobalConfig(current =>
    current.hasSeenAutoDefaultNudge
      ? current
      : { ...current, hasSeenAutoDefaultNudge: true },
  )
  logEvent('tengu_auto_default_nudge_resolved', {
    choice:
      choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome: (choice === 'accept'
      ? 'switched'
      : 'declined') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    current_mode:
      currentMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    surface:
      'ide' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
