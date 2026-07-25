import type { EffortLevel, EffortValue } from '../../utils/effort.js'
import {
  getSupportedEffortLevels,
  isUltracodeOfferable,
} from '../../utils/effort.js'

/**
 * 光标在面板上的位置。仅面板内部使用，不进入 AppState / settings / API。
 * 'ultracode' 不是 EffortLevel；它在本面板里仅作视觉占位与文案引导。
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

/**
 * densable-aligned panel ladder for a model: supported effort levels +
 * trailing ultracode visual slot when isUltracodeOfferable(model).
 * Unsupported max/xhigh are omitted so sonnet-4-6 never offers xhigh
 * (API still clamps if forced). Ultracode slot requires workflows + a
 * catalog wire tier (densable gY).
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
  // If model supports no effort, still show a basic ladder so the panel
  // isn't empty; resolveAppliedEffort will no-op on API send. Ultracode
  // only if offerable (usually false when no effort support).
  if (levels.length === 0) {
    return ultracodeOfferable
      ? ['low', 'medium', 'high', 'ultracode']
      : ['low', 'medium', 'high']
  }
  return levels
}

/**
 * 判断一个值是否可作为面板光标位置（不含 ultracode，因 ultracode 仅由面板内部产生）。
 */
function isNonUltracodePosition(
  value: unknown,
): value is Exclude<PanelPosition, 'ultracode'> {
  return (
    typeof value === 'string' &&
    value !== 'ultracode' &&
    (PANEL_POSITIONS as readonly string[]).includes(value)
  )
}

/**
 * 把 EffortValue 归一化为面板可用的光标位置。
 * - null / undefined / 数值（ant-only）/ ultracode → undefined（让上层用 displayed）
 * - 合法 string 档位 → 返回该档位
 */
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
  // Prefer lower neighbor in the full ladder, then first available.
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

/**
 * 决定面板挂载时的初始光标位置。
 * 优先级：env override（若是合法档位）> displayed level
 *
 * @param envOverride    getEffortEnvOverride() 的返回值：EffortValue | null | undefined
 * @param appStateEffort AppState.effortValue
 * @param displayed      getDisplayedEffortLevel(model, appStateEffort) —— 必传，避免此处再依赖 model
 */
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

// ---- 确认/取消决策（注入 ApplyFn 避免循环依赖 + 便于测试）----

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

/**
 * densable-aligned: panel ultracode confirms session wire effort + orchestration.
 * Production path uses executeEffort → `${wire} + dynamic workflow orchestration`;
 * this static hint mirrors that shape when wire is model-unknown (tests / fallback).
 */
export const ULTRACODE_HINT =
  'Set effort level to ultracode (this session only): catalog top effort + dynamic workflow orchestration'

export const CANCEL_MESSAGE = 'Effort unchanged.'

export function computeConfirmOutcome(
  cursor: PanelPosition,
  applyFn: ApplyFn,
): ConfirmOutcome {
  // densable: ultracode is a real confirm path (wire effort via applyFn), not a reject.
  const result = applyFn(cursor)
  return {
    kind: 'apply',
    message: result.message,
    effortUpdate: result.effortUpdate,
  }
}
