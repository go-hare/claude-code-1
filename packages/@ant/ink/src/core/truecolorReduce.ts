/**
 * densable Gsu / Igg — when chalk level < 3, rewrite truecolor SGR
 * (`\x1b[[34]8;2;r;g;bm`) with nearest ansi256 (`\x1b[[34]8;5;Nm`) before
 * StylePool intern. Preserves endCode; other codes pass through.
 *
 * densable W8i cube steps + kgg truecolor regex.
 */

/** densable W8i — 6×6×6 cube channel steps. */
export const ANSI256_CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const

/**
 * densable kgg — match truecolor SGR open codes only.
 * Groups: (38|48), r, g, b.
 */
export const TRUECOLOR_SGR_RE =
  /^\x1b\[([34]8);2;(\d+);(\d+);(\d+)m$/

/** densable cube channel quantizer used by Igg. */
export function ansi256CubeChannel(v: number): number {
  if (v < 48) return 0
  if (v < 115) return 1
  if (v < 155) return 2
  if (v < 195) return 3
  if (v < 235) return 4
  return 5
}

/**
 * densable Igg(e,t,r) — nearest ansi256 index for an RGB triple.
 * Prefers grayscale ramp vs cube by squared distance.
 */
export function rgbToNearestAnsi256(r: number, g: number, b: number): number {
  const o = ansi256CubeChannel(r)
  const i = ansi256CubeChannel(g)
  const s = ansi256CubeChannel(b)
  const cube = 16 + 36 * o + 6 * i + s
  const avg = Math.round((r + g + b) / 3)
  if (avg < 5) return 16
  if (avg > 244 && o === i && i === s) return cube
  const grayIdx = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)))
  const gray = 232 + grayIdx
  const grayLevel = 8 + grayIdx * 10
  const pr = ANSI256_CUBE_STEPS[o]!
  const pg = ANSI256_CUBE_STEPS[i]!
  const pb = ANSI256_CUBE_STEPS[s]!
  const cubeDist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
  const grayDist =
    (r - grayLevel) ** 2 + (g - grayLevel) ** 2 + (b - grayLevel) ** 2
  return grayDist < cubeDist ? gray : cube
}

export type AnsiStyleLike = {
  type: string
  code: string
  endCode: string
}

/**
 * densable Gsu(e) — reduce truecolor style codes when chalk level < 3.
 * Returns the same array reference when no rewrite is needed.
 */
export function reduceTruecolorAnsiCodes<T extends AnsiStyleLike>(
  styles: T[],
  chalkLevel: number,
): T[] {
  if (chalkLevel >= 3 || styles.length === 0) return styles
  let out: T[] | undefined
  for (let i = 0; i < styles.length; i++) {
    const n = styles[i]!
    const m = TRUECOLOR_SGR_RE.exec(n.code)
    if (m) {
      out ??= styles.slice(0, i)
      const plane = m[1]!
      const r = Number(m[2])
      const g = Number(m[3])
      const b = Number(m[4])
      const idx = rgbToNearestAnsi256(r, g, b)
      out.push({
        ...n,
        type: 'ansi',
        code: `\x1b[${plane};5;${idx}m`,
        endCode: n.endCode,
      })
    } else if (out) {
      out.push(n)
    }
  }
  return out ?? styles
}
