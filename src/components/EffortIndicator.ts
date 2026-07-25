import {
  EFFORT_HIGH,
  EFFORT_LOW,
  EFFORT_MAX,
  EFFORT_MEDIUM,
  EFFORT_XHIGH,
} from '../constants/figures.js'
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  getUltracodeEffortForModel,
  isUltracodeModeActive,
  modelSupportsEffort,
} from '../utils/effort.js'

/**
 * densable Z_p — effort-changed notification.
 * Normal: "◐ medium · /effort"
 * Ultracode: "⦿ ultracode · {wire} effort + dynamic workflows for maximum thoroughness"
 * Wire tier is catalog-driven (Grok → high, Claude 4.7 → xhigh).
 */
export function getEffortNotificationText(
  effortValue: EffortValue | undefined,
  model: string,
  ultracodeFlag?: boolean,
): string | undefined {
  if (!modelSupportsEffort(model)) return undefined
  const level = getDisplayedEffortLevel(model, effortValue)
  if (isUltracodeModeActive(model, effortValue, ultracodeFlag)) {
    const wire = getUltracodeEffortForModel(model) ?? level
    // densable uses the effort symbol for the wire tier (vHr), not a separate ultra glyph.
    return `${effortLevelToSymbol(wire)} ultracode · ${wire} effort + dynamic workflows for maximum thoroughness`
  }
  return `${effortLevelToSymbol(level)} ${level} · /effort`
}

export function effortLevelToSymbol(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return EFFORT_LOW
    case 'medium':
      return EFFORT_MEDIUM
    case 'high':
      return EFFORT_HIGH
    case 'xhigh':
      return EFFORT_XHIGH
    case 'max':
      return EFFORT_MAX
    default:
      // Defensive: level can originate from remote config. If an unknown
      // value slips through, render the high symbol rather than undefined.
      return EFFORT_HIGH
  }
}
