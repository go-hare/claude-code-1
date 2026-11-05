import { logForDebugging } from '../../utils/debug.js'
import { getReplDiffHost } from '../../utils/sessionHost.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  getPluginSuggestionShownCount,
  getSessionsSinceLastShown,
  getTipLifetimeShownCount,
  recordTipShown,
} from './tipHistory.js'
import {
  advertisedCommandAllowed,
  getRelevantTips,
  spinnerTipHostFromContext,
  tipIsRelevant,
} from './tipRegistry.js'
import type { Tip, TipContext } from './types.js'

export type SeatedSpinnerTipSlot = {
  context: () => {
    session?: unknown
    theme?: TipContext['theme'] | string
    storageV5?: unknown
    [key: string]: unknown
  }
  storageV5: () => unknown
  show: (tip: { text: string; label?: string } | undefined) => void
}

export class SpinnerTipPluginSeat {
  private seated: SeatedSpinnerTipSlot | undefined
  private picker: ((slot: SeatedSpinnerTipSlot) => void) | undefined

  seat(slot: SeatedSpinnerTipSlot): void {
    this.seated = slot
  }

  vacate(slot: SeatedSpinnerTipSlot): void {
    if (this.seated === slot) this.seated = undefined
  }

  current(): SeatedSpinnerTipSlot | undefined {
    return this.seated
  }

  install(picker: (slot: SeatedSpinnerTipSlot) => void): void {
    this.picker = picker
  }

  pickDue(): boolean {
    if (this.picker === undefined || this.seated === undefined) return false
    this.picker(this.seated)
    return true
  }
}

const spinnerTipPluginSeats = new WeakMap<object, SpinnerTipPluginSeat>()

export function getSpinnerTipPluginSeat(
  host: object = getReplDiffHost(),
): SpinnerTipPluginSeat {
  const hit = spinnerTipPluginSeats.get(host)
  if (hit !== undefined) return hit
  const created = new SpinnerTipPluginSeat()
  spinnerTipPluginSeats.set(host, created)
  return created
}

/** densable `EV` — Qhe skips when max(Nhe, Ohe) >= 2. */
const MARKETPLACE_PLUGIN_TIP_COUNT_CAP = 2

/** densable `Khe` — host WeakMap telemetry latch, not the show-count store. */
class LegacyPluginTipCountProbe {
  fired = new Set<string>()
  fire(pluginCount: number, tipCount: number): void {
    if (pluginCount <= 0) return
    const changesMax = pluginCount > tipCount ? 'true' : 'false'
    const changesOutcome =
      pluginCount >= MARKETPLACE_PLUGIN_TIP_COUNT_CAP &&
      tipCount < MARKETPLACE_PLUGIN_TIP_COUNT_CAP
        ? 'true'
        : 'false'
    const key = `${changesMax}|${changesOutcome}`
    if (this.fired.has(key)) return
    this.fired.add(key)
    logEvent('tengu_dead_probe_legacy_plugin_tip_counts', {
      changes_max:
        changesMax as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      changes_outcome:
        changesOutcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

const legacyPluginTipCountProbes = new WeakMap<
  object,
  LegacyPluginTipCountProbe
>()

function legacyPluginTipCountProbeFor(host: object): LegacyPluginTipCountProbe {
  const hit = legacyPluginTipCountProbes.get(host)
  if (hit) return hit
  const created = new LegacyPluginTipCountProbe()
  legacyPluginTipCountProbes.set(host, created)
  return created
}

/**
 * densable `Qhe`. `Hhe()` is UNKNOWN — not invented.
 * Vhe stays Whe → qhe and does not read `pluginId`.
 */
export async function selectMarketplaceDeclaredPluginTip(
  context: TipContext,
): Promise<Tip | undefined> {
  if (getSettings_DEPRECATED().spinnerTipsEnabled === false) {
    return
  }
  const host = spinnerTipHostFromContext(context)
  const tips = await host.getMarketplacePluginTips(context.storageV5)
  if (tips.length === 0) {
    return
  }
  const picked: Tip[] = []
  for (const tip of tips) {
    if (!tip.pluginId) continue
    if (host.failedTipIds.has(tip.id)) continue
    const lifetime = getTipLifetimeShownCount(tip.id)
    const suggestions = getPluginSuggestionShownCount(tip.pluginId)
    legacyPluginTipCountProbeFor(context.session.host).fire(
      suggestions,
      lifetime,
    )
    if (Math.max(lifetime, suggestions) >= MARKETPLACE_PLUGIN_TIP_COUNT_CAP) {
      continue
    }
    if (getSessionsSinceLastShown(tip.id) < tip.cooldownSessions) {
      continue
    }
    if (
      tip.advertisedCommand !== undefined &&
      !(await advertisedCommandAllowed(tip.advertisedCommand))
    ) {
      continue
    }
    if (await tipIsRelevant(tip, context)) {
      picked.push(tip)
    }
  }
  return selectTipWithLongestTimeSinceShown(picked)
}

export function selectTipWithLongestTimeSinceShown(
  availableTips: Tip[],
): Tip | undefined {
  if (availableTips.length === 0) {
    return undefined
  }

  if (availableTips.length === 1) {
    return availableTips[0]
  }

  // densable 2.1.247 `qhe`: sessions desc, then priority desc.
  // Equal session counts (including never-shown = Infinity) use priority.
  const tipsWithSessions = availableTips.map(tip => ({
    tip,
    sessions: getSessionsSinceLastShown(tip.id),
  }))

  tipsWithSessions.sort((a, b) => {
    if (a.sessions !== b.sessions) {
      return b.sessions - a.sessions
    }
    return (b.tip.priority ?? 0) - (a.tip.priority ?? 0)
  })
  return tipsWithSessions[0]?.tip
}

/** densable `Ghe` — content throw → host `failedTipIds` + "". */
export async function evaluateTipContent(
  tip: Tip,
  context: TipContext,
): Promise<string> {
  try {
    return await tip.content(context)
  } catch (err) {
    spinnerTipHostFromContext(context).failedTipIds.add(tip.id)
    logForDebugging(`tip content threw: ${String(err)}`)
    return ''
  }
}

function sanitizedTipAnalyticsId(tip: Tip): string {
  if (tip.id.startsWith('marketplace-plugin:') && tip.id.includes('@')) {
    return 'marketplace-plugin:org-marketplace'
  }
  return tip.id
}

export async function getTipToShowOnSpinner(
  context: TipContext,
): Promise<Tip | undefined> {
  // Check if tips are disabled (default to true if not set)
  if (getSettings_DEPRECATED().spinnerTipsEnabled === false) {
    return undefined
  }

  // densable Vhe: Whe → qhe. Official picker has no force-id pin.
  const tips = await getRelevantTips(context)
  if (tips.length === 0) {
    return undefined
  }

  return selectTipWithLongestTimeSinceShown(tips)
}

export function recordShownTip(
  tip: Tip,
  surface: 'spinner' | 'startup' = 'spinner',
  _storageV5?: unknown,
): void {
  // Record in history
  recordTipShown(tip.id)

  // Log event for analytics
  logEvent('tengu_tip_shown', {
    tipIdLength: sanitizedTipAnalyticsId(
      tip,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    cooldownSessions: tip.cooldownSessions,
    surface:
      surface as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
