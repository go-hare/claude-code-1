/**
 * densable Gm(qSn, {currentMode}, {queueBehind:true}) + Veu SDs / lHr.
 * Shown is Veu useEffect (not this opener). Accept: FKe → xge("auto", …,
 * "auto_default_nudge") then ga defaultMode; else Idy Fyr + gate_off (no
 * latch). Decline latches. Esc/cancelled is gold lHr("decline") — same
 * latch + resolved event. IDE path is handleVscodeAutoDefaultNudgeEvent
 * (no xge).
 */
import type { Notification } from '../context/notifications.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { logEvent } from '../services/analytics/index.js'
import type { AppState } from '../state/AppStateStore.js'
import type { ToolPermissionContext } from '../Tool.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { setPermissionModeWithGuards } from '../utils/permissions/permissionSetup.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import {
  canCycleToAutoMode,
  workflowAutoModeUnavailableText,
} from './permissionAutoMode.js'
import type { RequestDialog } from './requestDialog.js'
import { autoDefaultNudgeSpec } from './specs/jsuKinds.js'
import { shouldShowAutoDefaultNudge } from './shouldShowAutoDefaultNudge.js'

/** densable Veu SDs xge 4th arg / qLe trigger */
export const AUTO_DEFAULT_NUDGE_TRIGGER = 'auto_default_nudge'

/** densable Idy key */
export const AUTO_DEFAULT_NUDGE_UNAVAILABLE_KEY =
  'auto-default-nudge-unavailable'

export type AutoDefaultNudgeOutcome = 'switched' | 'gate_off' | 'declined'

/** densable lHr: latch hasSeen unless gate_off */
export function shouldLatchAutoDefaultNudge(
  outcome: AutoDefaultNudgeOutcome,
): boolean {
  return outcome !== 'gate_off'
}

/** densable lHr: Qg cancelled → decline */
export function autoDefaultNudgeChoice(
  result: 'accepted' | 'declined' | 'cancelled',
): 'accept' | 'decline' {
  return result === 'accepted' ? 'accept' : 'decline'
}

type SetAppState = (updater: (prev: AppState) => AppState) => void
type AddNotification = (notif: Notification) => void

/** densable Idy({key, kind:"warning", text:Fyr(), color:"warning", priority:"high"}) */
function notifyAutoDefaultNudgeUnavailable(
  addNotification: AddNotification,
): void {
  addNotification({
    key: AUTO_DEFAULT_NUDGE_UNAVAILABLE_KEY,
    kind: 'warning',
    text: workflowAutoModeUnavailableText(),
    color: 'warning',
    priority: 'high',
  })
}

/** densable SDs — xge("auto") + settings only on ok; else Idy + gate_off */
export function applyAutoDefaultNudgeAccept(
  ctx: ToolPermissionContext,
  setAppState: SetAppState,
  addNotification: AddNotification,
): 'switched' | 'gate_off' {
  if (canCycleToAutoMode(ctx)) {
    const result = setPermissionModeWithGuards(
      'auto',
      ctx,
      updater => {
        setAppState(prev => {
          const next = updater(prev.toolPermissionContext)
          if (next === prev.toolPermissionContext) return prev
          return { ...prev, toolPermissionContext: next }
        })
      },
      AUTO_DEFAULT_NUDGE_TRIGGER,
    )
    if (result.ok) return 'switched'
  }
  notifyAutoDefaultNudgeUnavailable(addNotification)
  return 'gate_off'
}

export async function maybeRequestAutoDefaultNudge(
  requestDialog: RequestDialog,
  getContext: () => ToolPermissionContext,
  setAppState: SetAppState,
  addNotification: AddNotification,
): Promise<'opened' | 'skipped'> {
  const currentMode = shouldShowAutoDefaultNudge(getContext())
  if (!currentMode) return 'skipped'

  // densable REPL: Gm(qSn,{currentMode},{queueBehind:!0}) — shown is Veu
  // useEffect, not the opener (gold-kdy / gold-repl-sXg).
  const result = await requestDialog(
    autoDefaultNudgeSpec,
    { currentMode },
    { queueBehind: true },
  )

  if (getGlobalConfig().hasSeenAutoDefaultNudge) return 'opened'

  const choice = autoDefaultNudgeChoice(
    result === 'accepted' || result === 'declined' || result === 'cancelled'
      ? result
      : 'cancelled',
  )
  let outcome: AutoDefaultNudgeOutcome
  if (choice === 'accept') {
    outcome = applyAutoDefaultNudgeAccept(
      getContext(),
      setAppState,
      addNotification,
    )
    if (outcome === 'switched') {
      updateSettingsForSource('userSettings', {
        permissions: { defaultMode: 'auto' },
      })
    }
  } else {
    outcome = 'declined'
  }

  if (shouldLatchAutoDefaultNudge(outcome)) {
    saveGlobalConfig(current =>
      current.hasSeenAutoDefaultNudge
        ? current
        : { ...current, hasSeenAutoDefaultNudge: true },
    )
  }

  logEvent('tengu_auto_default_nudge_resolved', {
    choice:
      choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome:
      outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    current_mode:
      currentMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    surface:
      'repl' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return 'opened'
}
