import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { AppState } from '../../state/AppStateStore.js'
import { getFastIconString } from '../../components/FastIcon.js'
import {
  clearFastModeCooldown,
  FAST_MODE_MODEL_DISPLAY,
  getFastModeModel,
  getFastModeUnavailableReason,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import { formatModelPricing, getOpus46CostTier } from '../../utils/modelCost.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

/**
 * densable dsr + jTo — apply fast mode toggle.
 * persistDefault=true writes userSettings (interactive); false = session only
 * (non-interactive densable path).
 */
export function applyFastModeToggle(
  enable: boolean,
  getAppState: () => Pick<AppState, 'mainLoopModel' | 'fastMode'>,
  setAppState: (f: (prev: AppState) => AppState) => void,
  options: {
    persistDefault: boolean
    source: string
  },
): string {
  const unavailable = getFastModeUnavailableReason()
  if (unavailable) {
    return `Fast mode unavailable: ${unavailable}`
  }

  const { mainLoopModel } = getAppState()
  clearFastModeCooldown()

  if (options.persistDefault) {
    updateSettingsForSource('userSettings', {
      fastMode: enable ? true : undefined,
    })
  }

  if (enable) {
    setAppState(prev => {
      const needsModelSwitch = !isFastModeSupportedByModel(prev.mainLoopModel)
      return {
        ...prev,
        ...(needsModelSwitch
          ? {
              mainLoopModel: getFastModeModel(),
              mainLoopModelForSession: null,
            }
          : {}),
        fastMode: true,
      }
    })
  } else {
    setAppState(prev => ({ ...prev, fastMode: false }))
  }

  logEvent('tengu_fast_mode_toggled', {
    enabled: enable,
    source:
      options.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const sessionOnly = options.persistDefault ? '' : ' (this session only)'
  if (enable) {
    const fastIcon = getFastIconString(true)
    const modelUpdated = !isFastModeSupportedByModel(mainLoopModel)
      ? ` · model set to ${FAST_MODE_MODEL_DISPLAY}`
      : ''
    const pricing = formatModelPricing(getOpus46CostTier(true))
    return `${fastIcon} Fast mode ON${modelUpdated} · ${pricing}${sessionOnly}`
  }
  return `Fast mode OFF${sessionOnly}`
}
