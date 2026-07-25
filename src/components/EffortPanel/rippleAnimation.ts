/**
 * EffortPanel ultracode 背景波纹 — densable 2.1.211 对齐（Phr / DZs / HZs）。
 *
 * densable 要点：
 * - 固定紫阶 8 档：rgb(62,22,118) → rgb(140,80,240)，**无色相旋转**
 * - 波前从 ultracode 三角 origin 向外扩张：travel = elapsedMs * 0.03
 * - dist > travel → transparent（波前外不染色）
 * - 波前内 cos 相位 → ramp 索引
 * - 文字压在波上：白字 + 紫底；波外：淡紫字无底
 */

/** densable Cwp → b2_ linear ramp (8 stops), as hex for Ink. */
export const RIPPLE_COLOR_STOPS = (() => {
  const from = [62, 22, 118] as const
  const to = [140, 80, 240] as const
  return Array.from({ length: 8 }, (_, t) => {
    const r = t / 7
    const ch = (i: number) =>
      Math.round(from[i]! + (to[i]! - from[i]!) * r)
        .toString(16)
        .padStart(2, '0')
    return `#${ch(0)}${ch(1)}${ch(2)}`
  }) as readonly string[]
})()

/** densable BMo / jln — peak purple (ultracode label accent). */
export const RIPPLE_PEAK = RIPPLE_COLOR_STOPS[RIPPLE_COLOR_STOPS.length - 1]!

/** densable kZs — lavender for dim text on / near ripple. */
export const RIPPLE_LAVENDER = '#d0b4ff'

/** densable Wln — text on purple background. */
export const RIPPLE_TEXT_ON_BG = '#ffffff'

/** densable FMo — wavelength in cell units. */
const WAVELENGTH = 20

/** densable p2_ — travel expansion speed (cells per ms). */
const TRAVEL_PER_MS = 0.03

export const TRANSPARENT = 'transparent'

export type Cell = {
  char: string
  color: string
}

export type Segment = {
  text: string
  color: string
}

export type Overlay = {
  text: string
  /** 起始列；可为负（前缀被截断） */
  x: number
  /** overlay 字符颜色；undefined = 保留底层波纹颜色 */
  color?: string
}

const RIPPLE_BG_CHAR = ' '

/**
 * densable DZs(dist, {travel}) → ramp index or null (outside wavefront).
 * Exported for tests.
 */
export function densableRippleLevel(
  dist: number,
  travel: number,
): number | null {
  if (dist > travel) return null
  const r = (((dist - travel) % WAVELENGTH) + WAVELENGTH) % WAVELENGTH
  const n = (1 + Math.cos((2 * Math.PI * r) / WAVELENGTH)) / 2
  return Math.min(
    RIPPLE_COLOR_STOPS.length - 1,
    Math.round(n * (RIPPLE_COLOR_STOPS.length - 1)),
  )
}

/**
 * densable HZs — distance from origin; y scaled ×2 (row taller than cell).
 */
export function densableRippleDistance(
  x: number,
  y: number,
  originX: number,
  originY: number,
): number {
  const dx = x - originX
  const dy = (y - originY) * 2
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * intensity 0..1 → densable purple ramp color (no hue rotation).
 * Outside intensity semantics kept for tests/helpers; production uses
 * densableRippleLevel via computeRippleCells.
 */
export function intensityToColor(intensity: number, _hueShift = 0): string {
  const v = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity
  const idx = Math.min(
    RIPPLE_COLOR_STOPS.length - 1,
    Math.floor(v * RIPPLE_COLOR_STOPS.length),
  )
  return RIPPLE_COLOR_STOPS[idx]!
}

/**
 * densable has no hue rotation. Kept as no-op identity for any leftover
 * call sites / tests that still pass hueShift.
 */
export function rotateHue(hex: string, _hueShift: number): string {
  return hex
}

/** densable: fixed purple — always 0. */
export function getHueShiftAtTime(_time: number): number {
  return 0
}

/**
 * densable expanding-wavefront cells.
 * `time` = ms elapsed while ultracode is selected (same as useAnimationFrame).
 */
export function computeRippleCells(args: {
  y: number
  width: number
  time: number
  sourceX: number
  sourceY: number
}): Cell[] {
  const { y, width, time, sourceX, sourceY } = args
  if (width <= 0) return []

  const travel = Math.max(0, time) * TRAVEL_PER_MS
  const cells: Cell[] = new Array(width)
  for (let x = 0; x < width; x++) {
    const dist = densableRippleDistance(x, y, sourceX, sourceY)
    const level = densableRippleLevel(dist, travel)
    cells[x] = {
      char: RIPPLE_BG_CHAR,
      color: level === null ? TRANSPARENT : RIPPLE_COLOR_STOPS[level]!,
    }
  }
  return cells
}

/**
 * Apply text overlays onto cells (last-write-wins for overlapping ranges).
 * When color is set, char+color are replaced; when undefined, only char.
 */
export function applyOverlaysToCells(
  cells: Cell[],
  overlays: Overlay[],
): Cell[] {
  if (cells.length === 0 || overlays.length === 0) return cells
  const out = cells.map(c => ({ ...c }))
  for (const ov of overlays) {
    for (let i = 0; i < ov.text.length; i++) {
      const col = ov.x + i
      if (col < 0 || col >= out.length) continue
      const ch = ov.text[i]!
      if (ov.color !== undefined) {
        out[col] = { char: ch, color: ov.color }
      } else {
        out[col] = { char: ch, color: out[col]!.color }
      }
    }
  }
  return out
}

/** Merge adjacent same-color cells into segments. */
export function cellsToSegments(cells: Cell[]): Segment[] {
  if (cells.length === 0) return []
  const segs: Segment[] = []
  let text = cells[0]!.char
  let color = cells[0]!.color
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i]!
    if (c.color === color) {
      text += c.char
    } else {
      segs.push({ text, color })
      text = c.char
      color = c.color
    }
  }
  segs.push({ text, color })
  return segs
}

/**
 * Fade cell colors toward transparent for enter/exit animation.
 * densable doesn't fade the ramp the same way; we keep a simple alpha mix
 * by swapping to TRANSPARENT below threshold so exit still works.
 */
export function fadeCells(cells: Cell[], fade: number): Cell[] {
  if (fade >= 0.999) return cells
  if (fade <= 0.001) {
    return cells.map(c =>
      c.char === RIPPLE_BG_CHAR && c.color !== TRANSPARENT
        ? { ...c, color: TRANSPARENT }
        : c,
    )
  }
  // Partial fade: outside wave stays transparent; on-wave colors stay
  // (full densable purple) once fade is past half — avoids muddy pinks.
  if (fade < 0.5) {
    return cells.map(c =>
      c.char === RIPPLE_BG_CHAR ? { ...c, color: TRANSPARENT } : c,
    )
  }
  return cells
}

/** Mix a hex color toward black by (1-fade). Used by older tests. */
export function fadeColor(hex: string, fade: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const f = fade < 0 ? 0 : fade > 1 ? 1 : fade
  if (f >= 0.999) return hex
  if (f <= 0.001) return TRANSPARENT
  const mix = (pair: string) =>
    Math.round(parseInt(pair, 16) * f)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(hex.slice(1, 3))}${mix(hex.slice(3, 5))}${mix(hex.slice(5, 7))}`
}
