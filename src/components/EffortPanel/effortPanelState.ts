import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { EffortLevel, EffortValue } from '../../utils/effort.js'
import {
  EFFORT_LEVELS,
  convertEffortValueToLevel,
  getCapabilitySupportedEffortLevels,
  getDefaultEffortForModel,
  getSupportedEffortLevels,
  isUltracodeOfferable,
  modelSupportsEffort,
  modelSupportsMaxEffort,
} from '../../utils/effort.js'
import { getCombinedMaxEffortLevel } from '../../utils/model/effortCatalog.js'
import {
  getCanonicalName,
  parseUserSpecifiedModel,
} from '../../utils/model/model.js'

/**
 * 光标在面板上的位置。仅面板内部使用，不进入 AppState / settings / API。
 * 'ultracode' 不是 EffortLevel；保留于 PanelPosition 供旧辅助函数及测试兼容。
 */
export type PanelPosition =
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultracode'

export const PANEL_POSITIONS: readonly PanelPosition[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
] as const

export const HOME_POSITION: PanelPosition = 'low'
export const END_POSITION: PanelPosition = 'ultracode'

export const MAX_EFFORT_WARNING =
  'May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.'

export const ULTRACODE_BLURB = 'dynamic workflows on every task'

const ORG_CAPPED_NOTE =
  'Higher effort levels are capped by your settings or organization.'

const FULL_TRACK_WIDTH = 42
const MIN_TRACK_WIDTH = 14
const DEFAULT_SPACERS = [5, 5, 5, 6] as const

export type SliderLevelColor =
  | 'warning'
  | 'success'
  | 'permission'
  | 'autoAccept-shimmer'
  | 'rainbow-animated'

export type SliderLevelSpec = {
  value: EffortLevel
  label: string
  color: SliderLevelColor
}

const SLIDER_LEVEL_SPECS: readonly SliderLevelSpec[] = [
  { value: 'low', label: 'low', color: 'warning' },
  { value: 'medium', label: 'medium', color: 'success' },
  { value: 'high', label: 'high', color: 'permission' },
  { value: 'xhigh', label: 'xhigh', color: 'autoAccept-shimmer' },
  { value: 'max', label: 'max', color: 'rainbow-animated' },
]

export type SliderGeometry = {
  levels: SliderLevelSpec[]
  width: number
  trianglePositions: number[]
  labelStarts: number[]
  spacers: number[]
  trackChars: string
  orgNote: string | undefined
}

function computeLabelStarts(
  levels: readonly SliderLevelSpec[],
  spacers: readonly number[],
): number[] {
  return levels.map((_level, idx) =>
    levels
      .slice(0, idx)
      .reduce(
        (acc, prev, prevIdx) =>
          acc + prev.label.length + (spacers[prevIdx] ?? 5),
        0,
      ),
  )
}

function isCappedBySettingsOrOrg(model: string): boolean {
  const cap = getCombinedMaxEffortLevel(model)
  if (cap === null) return false
  const capIdx = EFFORT_LEVELS.indexOf(cap)
  const capabilityLevels = getCapabilitySupportedEffortLevels(model)
  return capabilityLevels.some(lvl => EFFORT_LEVELS.indexOf(lvl) > capIdx)
}

export function getSliderGeometry(model?: string): SliderGeometry {
  const supported = model ? getSupportedEffortLevels(model) : [...EFFORT_LEVELS]
  const supportedSet = new Set<EffortLevel>(
    supported.length > 0 ? supported : ['low', 'medium', 'high'],
  )
  const levels = SLIDER_LEVEL_SPECS.filter(spec => supportedSet.has(spec.value))
  const finalLevels =
    levels.length > 0 ? levels : SLIDER_LEVEL_SPECS.slice(0, 3)
  const count = finalLevels.length
  const spacers = DEFAULT_SPACERS.slice(0, Math.max(0, count - 1))
  const labelStarts = computeLabelStarts(finalLevels, spacers)
  const trianglePositions = finalLevels.map(
    (lvl, idx) => labelStarts[idx]! + Math.floor((lvl.label.length - 1) / 2),
  )
  const lastEnd = labelStarts[count - 1]! + finalLevels[count - 1]!.label.length
  const width =
    count === SLIDER_LEVEL_SPECS.length
      ? FULL_TRACK_WIDTH
      : Math.max(lastEnd, MIN_TRACK_WIDTH)
  const orgNote =
    model && isCappedBySettingsOrOrg(model) ? ORG_CAPPED_NOTE : undefined

  return {
    levels: finalLevels,
    width,
    trianglePositions,
    labelStarts,
    spacers,
    trackChars: '─'.repeat(width),
    orgNote,
  }
}

const EFFORT_COST_INDEX_BY_MODEL: Readonly<
  Record<string, Partial<Record<EffortLevel, number>>>
> = {
  'claude-sonnet-5': {
    low: 0.47,
    medium: 0.74,
    high: 1,
    xhigh: 2.41,
    max: 5.59,
  },
  'claude-opus-4-8': {
    low: 0.72,
    medium: 0.9,
    high: 1,
    xhigh: 1.65,
    max: 1.88,
  },
  'claude-opus-5': {
    low: 0.67,
    medium: 0.76,
    high: 1,
    xhigh: 1.6,
    max: 1.7,
  },
  'claude-fable-5': {
    low: 0.6,
    medium: 0.77,
    high: 1,
    xhigh: 1.74,
    max: 1.91,
  },
  'claude-fable-5-1': {
    low: 0.75,
    medium: 0.86,
    high: 1,
    xhigh: 1.38,
    max: 1.74,
  },
  'claude-mythos-5': {
    low: 0.75,
    medium: 0.86,
    high: 1,
    xhigh: 1.38,
    max: 1.74,
  },
}

function resolveDefaultEffortLevel(model: string): EffortLevel {
  const def = getDefaultEffortForModel(model)
  return def !== undefined ? convertEffortValueToLevel(def) : 'high'
}

function getEffortCostRatio(model: string, level: EffortLevel): number | null {
  if (!modelSupportsEffort(model)) return null
  const canonical = getCanonicalName(
    parseUserSpecifiedModel(model),
  ).toLowerCase()
  const table = EFFORT_COST_INDEX_BY_MODEL[canonical]
  if (!table) return null
  const target = table[level]
  const baseline = table[resolveDefaultEffortLevel(model)]
  if (target === undefined || !baseline) return null
  return target / baseline
}

function formatEffortCostMultiplier(ratio: number): string {
  if (ratio < 0.1) {
    return `~${Math.max(0.01, Math.round(ratio * 100) / 100).toFixed(2)}x`
  }
  const rounded = Math.round(ratio * 10) / 10
  return Number.isInteger(rounded)
    ? `~${rounded.toFixed(0)}x`
    : `~${rounded.toFixed(1)}x`
}

export function isEffortCostNoteEnabled(model: string | undefined): boolean {
  if (!model) return false
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_marbled_teal', false)) {
    return false
  }
  return getEffortCostRatio(model, resolveDefaultEffortLevel(model)) !== null
}

export function getEffortLevelDescription(
  model: string,
  level: EffortLevel,
): string {
  const defaultLevel = resolveDefaultEffortLevel(model)
  if (level === 'max' && modelSupportsMaxEffort(model)) {
    const ratio = getEffortCostRatio(model, 'max')
    return ratio === null
      ? MAX_EFFORT_WARNING
      : `${MAX_EFFORT_WARNING} (${formatEffortCostMultiplier(ratio)})`
  }
  if (level === defaultLevel) {
    return 'The default effort for this model'
  }
  const ratio = getEffortCostRatio(model, level)
  return ratio === null
    ? ''
    : `${formatEffortCostMultiplier(ratio)} the estimated cost of ${defaultLevel} (the default)`
}

/**
 * densable-aligned panel ladder for a model: supported effort levels +
 * trailing ultracode visual slot when isUltracodeOfferable(model).
 *
 * `opts.ultracodeOfferable` is test-injectable so full-suite mock.module
 * pollution of workflowDisableGate/growthbook cannot hide the slot in
 * ladder unit tests. Production callers omit opts.
 */
export function getPanelPositionsForModel(
  model: string,
  opts?: { ultracodeOfferable?: boolean },
): PanelPosition[] {
  const ultracodeOfferable =
    opts?.ultracodeOfferable ?? isUltracodeOfferable(model)
  const supported = new Set<EffortLevel>(getSupportedEffortLevels(model))
  const levels = (PANEL_POSITIONS as readonly PanelPosition[]).filter(p => {
    if (p === 'ultracode') return ultracodeOfferable
    return supported.has(p as EffortLevel)
  })
  if (levels.length === 0) {
    return ultracodeOfferable
      ? ['low', 'medium', 'high', 'ultracode']
      : ['low', 'medium', 'high']
  }
  return levels
}

function isNonUltracodePosition(
  value: unknown,
): value is Exclude<PanelPosition, 'ultracode'> {
  return (
    typeof value === 'string' &&
    value !== 'ultracode' &&
    (PANEL_POSITIONS as readonly string[]).includes(value)
  )
}

function normalizeToPanelPosition(
  value: EffortValue | null | undefined,
): PanelPosition | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return undefined
  if (isNonUltracodePosition(value)) {
    return value
  }
  return undefined
}

export function moveLeft(
  cursor: PanelPosition,
  positions: readonly PanelPosition[] = PANEL_POSITIONS,
): PanelPosition {
  const idx = positions.indexOf(cursor)
  if (idx <= 0) return positions[0]!
  return positions[idx - 1]!
}

export function moveRight(
  cursor: PanelPosition,
  positions: readonly PanelPosition[] = PANEL_POSITIONS,
): PanelPosition {
  const idx = positions.indexOf(cursor)
  if (idx === -1 || idx >= positions.length - 1) {
    return positions[positions.length - 1]!
  }
  return positions[idx + 1]!
}

/** Snap a desired cursor onto the nearest available position for this ladder. */
export function clampCursorToPositions(
  cursor: PanelPosition,
  positions: readonly PanelPosition[],
): PanelPosition {
  if (positions.includes(cursor)) return cursor
  const fullIdx = PANEL_POSITIONS.indexOf(cursor)
  for (let i = fullIdx - 1; i >= 0; i--) {
    const candidate = PANEL_POSITIONS[i]!
    if (positions.includes(candidate)) return candidate
  }
  for (let i = fullIdx + 1; i < PANEL_POSITIONS.length; i++) {
    const candidate = PANEL_POSITIONS[i]!
    if (positions.includes(candidate)) return candidate
  }
  return positions[0]!
}

export function isUltracode(cursor: PanelPosition): boolean {
  return cursor === 'ultracode'
}

export function getInitialCursor(args: {
  envOverride: EffortValue | null | undefined
  appStateEffort: EffortValue | undefined
  displayed: PanelPosition
  /** When provided, cursor is clamped to model-supported ladder. */
  positions?: readonly PanelPosition[]
}): PanelPosition {
  const fromEnv = normalizeToPanelPosition(args.envOverride)
  const raw = fromEnv !== undefined ? fromEnv : args.displayed
  if (args.positions) {
    return clampCursorToPositions(raw, args.positions)
  }
  return raw
}

export type EffortUpdate = {
  value: EffortValue | undefined
  ultracode?: boolean
}

export type ConfirmOutcome = {
  kind: 'apply'
  message: string
  effortUpdate?: EffortUpdate
}

export type ApplyFn = (cursor: PanelPosition) => {
  message: string
  effortUpdate?: EffortUpdate
}

export const ULTRACODE_HINT =
  'Ultracode on (this session only): effort stays at the current level'

/** densable 2.1.289 EffortSlider Esc: onDone("Cancelled") → ⎿ Cancelled */
export const CANCEL_MESSAGE = 'Cancelled'

export function computeConfirmOutcome(
  cursor: PanelPosition,
  applyFn: ApplyFn,
): ConfirmOutcome {
  const result = applyFn(cursor)
  return {
    kind: 'apply',
    message: result.message,
    effortUpdate: result.effortUpdate,
  }
}
