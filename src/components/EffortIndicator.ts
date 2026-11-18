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
  convertEffortValueToLevel,
  getUltracodeEffortForModel,
  isUltracodeModeActive,
  resolveAppliedEffort,
  shouldShowEffortUI,
} from '../utils/effort.js'

/**
 * densable Z_p — effort-changed notification.
 * Normal: "◐ medium · /effort"
 * Ultracode: "◉ ultracode · {wire} effort + dynamic workflows for maximum thoroughness"
 * Wire tier is catalog-driven (Grok → high, Claude 4.7 → xhigh).
 */
/**
 * densable 2.1.312 fA — format the prompt effort indicator, optionally showing
 * "may wait for your next message" when changed mid-task.
 */
export function formatEffortIndicatorText(
  level: EffortLevel | undefined,
  ultracode = false,
  showLabel = false,
  midTaskPending = false,
  requestedLevel: EffortLevel | undefined = level,
): string | undefined {
  if (!level) return undefined
  const prefix = showLabel ? 'effort:' : effortLevelToSymbol(level)
  const ultraSuffix = ultracode ? ' · ultracode' : ''
  const actionSuffix = midTaskPending
    ? 'may wait for your next message'
    : '/effort'
  const displayLevel =
    showLabel && requestedLevel !== undefined && requestedLevel !== level
      ? `${requestedLevel} (${level})`
      : (requestedLevel ?? level)
  return `${prefix} ${displayLevel}${ultraSuffix} · ${actionSuffix}`
}

export function getEffortNotificationText(
  effortValue: EffortValue | undefined,
  model: string,
  ultracodeFlag?: boolean,
  opts?: {
    midTaskPending?: boolean
    showLabel?: boolean
    requestedLevel?: EffortLevel
  },
): string | undefined {
  if (!shouldShowEffortUI(model, effortValue)) return undefined
  // Official 2.1.304 (#990): do not guess a level when CLAUDE_CODE_EFFORT_LEVEL=auto|unset
  // and no effort level is sent (resolveAppliedEffort returns undefined).
  const applied = resolveAppliedEffort(model, effortValue)
  if (applied === undefined) return undefined
  const level = convertEffortValueToLevel(applied)
  if (isUltracodeModeActive(model, effortValue, ultracodeFlag)) {
    const wire = getUltracodeEffortForModel(model) ?? level
    // densable uses the effort symbol for the wire tier (vHr), not a separate ultra glyph.
    if (opts?.midTaskPending) {
      return `${effortLevelToSymbol(wire)} ${wire} · ultracode · may wait for your next message`
    }
    return `${effortLevelToSymbol(wire)} ultracode · ${wire} effort + dynamic workflows for maximum thoroughness`
  }
  if (opts?.midTaskPending || opts?.showLabel || opts?.requestedLevel) {
    return formatEffortIndicatorText(
      level,
      false,
      opts?.showLabel ?? false,
      opts?.midTaskPending ?? false,
      opts?.requestedLevel ?? level,
    )
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
