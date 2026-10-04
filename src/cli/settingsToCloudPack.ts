/**
 * densable 2.1.283 leftover unique wrap — settings-to-cloud pack.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `Mo` @202411165
 * - `Se` @202411280
 * - `un` @202411365
 * - `Ao` @202411620
 * - `To` @202411780
 * - `pQt` / `H0e` @185879805 (read-only stored consent)
 *
 * `_g` settings.read only — no settings writes. Semantic exports.
 */

import { getBootstrapSessionHost } from '../utils/sessionHost.js'

export type SettingsToCloudConsent = 'forward' | 'keep_local'

export type SettingsToCloudSource = 'stored' | 'host' | 'default'

export type SettingsUploadOutcome =
  | 'sent'
  | 'unchanged'
  | 'conflict_resolved'
  | 'raced'
  | 'not_forwarded_at_create'
  | 'no_standing_pack'
  | 'lane_full'
  | 'unavailable'
  | 'unauthorized'
  | 'deadline'
  | 'failed'
  | 'aborted'

export type SettingsHomeSeedOutcome =
  | {
      kind: 'uploaded'
      outcome: SettingsUploadOutcome
      settingsRefused?: string
    }
  | { kind: 'not_uploaded'; reason: string }

export type SettingsHomeSeed = {
  status: unknown
  outcome: () => SettingsHomeSeedOutcome | undefined
  completion: Promise<unknown>
}

export type SettingsFeatureOff = {
  feature: 'settings'
  report: () => {
    state: 'off'
    reason: string
    source?: string
  }
}

export type SettingsFeatureForwarded = {
  feature: 'settings'
  status: unknown
  homeSeed: SettingsHomeSeed
  report: () => SettingsFeatureReport
  onSettled: (cb: () => void) => void
}

export type SettingsFeatureReport =
  | { state: 'forwarded'; source: string; pending?: true }
  | { state: 'off'; source: string; reason: string }

export type SettingsToCloudContext = {
  homeSeed?: SettingsHomeSeed
  settingsToCloud?: boolean
  bound?: boolean
  trigger?: string
}

/**
 * gold `pQt` / `H0e` @185879805 — stored consent, read-only.
 * LaunchOptions host is `'forward' | null`; keep_local only via seam.
 */
export function storedHomeSettingsConsentMode(
  mode: unknown = getBootstrapSessionHost().launchOptions.homeSettingsHostConsent(),
): SettingsToCloudConsent | undefined {
  return mode === 'forward' || mode === 'keep_local' ? mode : undefined
}

/**
 * gold `Ao` @202411620 — uploaded outcome is a successful forward.
 */
export function isSuccessfulSettingsUpload(
  outcome: SettingsUploadOutcome,
): boolean {
  switch (outcome) {
    case 'sent':
    case 'unchanged':
    case 'conflict_resolved':
      return true
    case 'raced':
    case 'not_forwarded_at_create':
    case 'no_standing_pack':
    case 'lane_full':
    case 'unavailable':
    case 'unauthorized':
    case 'deadline':
    case 'failed':
    case 'aborted':
      return false
  }
}

/**
 * gold `To` @202411780 — report from home-seed outcome.
 */
export function settingsToCloudReport(
  outcome: SettingsHomeSeedOutcome | undefined,
  source: string,
): SettingsFeatureReport {
  const forwarded: SettingsFeatureReport = { state: 'forwarded', source }
  if (outcome === undefined) return { ...forwarded, pending: true }
  if (outcome.kind === 'uploaded') {
    if (!isSuccessfulSettingsUpload(outcome.outcome)) {
      return { state: 'off', source, reason: outcome.outcome }
    }
    if (outcome.settingsRefused !== undefined) {
      return { state: 'off', source, reason: outcome.settingsRefused }
    }
    return forwarded
  }
  switch (outcome.reason) {
    case 'nothing_to_send':
      return { state: 'off', source, reason: 'nothing_to_forward' }
    case 'failed':
      return { state: 'off', source, reason: 'plan_failed' }
    default:
      return { state: 'off', source, reason: outcome.reason }
  }
}

/** gold `Se` @202411280 */
export function settingsToCloudOff(
  reason: string,
  source?: string,
): SettingsFeatureOff {
  return {
    feature: 'settings',
    report: () => ({
      state: 'off',
      reason,
      ...(source && { source }),
    }),
  }
}

/** gold `Mo` @202411165 */
export function settingsToCloudHomeSeed(
  homeSeed: SettingsHomeSeed,
  source: string,
): SettingsFeatureForwarded {
  return {
    feature: 'settings',
    status: homeSeed.status,
    homeSeed,
    report: () => settingsToCloudReport(homeSeed.outcome(), source),
    onSettled: cb => {
      void homeSeed.completion.then(() => cb())
    },
  }
}

/**
 * gold `un` @202411365 — factory. No settings writes. Default pQt is stored
 * launch-option consent (read-only).
 */
export function createSettingsToCloudPack(opts: {
  forwardHomeSettings: boolean
  consentMode?: SettingsToCloudConsent
  storedConsent?: () => SettingsToCloudConsent | undefined
}): (
  ctx: SettingsToCloudContext,
) => Promise<SettingsFeatureOff | SettingsFeatureForwarded> {
  return async ctx => {
    if (ctx.homeSeed !== undefined) {
      return settingsToCloudHomeSeed(
        ctx.homeSeed,
        opts.consentMode === undefined ? 'stored' : 'host',
      )
    }
    if (!opts.forwardHomeSettings) return settingsToCloudOff('launch_flag')
    if (ctx.settingsToCloud !== true) return settingsToCloudOff('flag_off')
    const stored = opts.storedConsent ?? storedHomeSettingsConsentMode
    const r = opts.consentMode ?? stored()
    const source: SettingsToCloudSource =
      opts.consentMode !== undefined
        ? 'host'
        : r === undefined
          ? 'default'
          : 'stored'
    if (r !== 'forward') {
      return settingsToCloudOff(
        r === 'keep_local' ? 'declined' : 'no_consent',
        source,
      )
    }
    if (!ctx.bound) return settingsToCloudOff('unbound', source)
    if (ctx.trigger === 'create')
      return settingsToCloudOff('not_seeded', source)
    return settingsToCloudOff('flag_off', source)
  }
}
