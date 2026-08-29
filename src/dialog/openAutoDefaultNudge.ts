/**
 * densable Gm(qSn, {currentMode}, {queueBehind:true}) + resolve latch.
 * Shown is Veu useEffect (not this opener). Accept/decline resolved event
 * mirrors IDE handleVscodeAutoDefaultNudgeEvent (surface: repl).
 * Esc/cancelled → no hasSeen latch (Qg default cancelled).
 */
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { logEvent } from '../services/analytics/index.js'
import type { ToolPermissionContext } from '../Tool.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import type { RequestDialog } from './requestDialog.js'
import { autoDefaultNudgeSpec } from './specs/jsuKinds.js'
import { shouldShowAutoDefaultNudge } from './shouldShowAutoDefaultNudge.js'

export async function maybeRequestAutoDefaultNudge(
  requestDialog: RequestDialog,
  ctx: ToolPermissionContext,
): Promise<'opened' | 'skipped'> {
  const currentMode = shouldShowAutoDefaultNudge(ctx)
  if (!currentMode) return 'skipped'

  // densable REPL: Gm(qSn,{currentMode},{queueBehind:!0}) — shown is Veu
  // useEffect, not the opener (gold-kdy / gold-repl-sXg).
  const result = await requestDialog(
    autoDefaultNudgeSpec,
    { currentMode },
    { queueBehind: true },
  )

  if (result === 'cancelled') return 'opened'
  if (getGlobalConfig().hasSeenAutoDefaultNudge) return 'opened'

  if (result === 'accepted') {
    updateSettingsForSource('userSettings', {
      permissions: { defaultMode: 'auto' },
    })
  }

  saveGlobalConfig(current =>
    current.hasSeenAutoDefaultNudge
      ? current
      : { ...current, hasSeenAutoDefaultNudge: true },
  )

  const choice = result === 'accepted' ? 'accept' : 'decline'
  logEvent('tengu_auto_default_nudge_resolved', {
    choice:
      choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome: (choice === 'accept'
      ? 'switched'
      : 'declined') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    current_mode:
      currentMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    surface:
      'repl' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return 'opened'
}
