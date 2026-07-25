import { describe, expect, test } from 'bun:test'
import {
  type Cell,
  type Overlay,
  TRANSPARENT,
  RIPPLE_COLOR_STOPS,
  RIPPLE_PEAK,
  RIPPLE_LAVENDER,
  RIPPLE_TEXT_ON_BG,
  applyOverlaysToCells,
  cellsToSegments,
  computeRippleCells,
  densableRippleDistance,
  densableRippleLevel,
  fadeCells,
  fadeColor,
  getHueShiftAtTime,
  intensityToColor,
  rotateHue,
} from '../rippleAnimation.js'

/** densable Cwp→b2_ 8-stop purple ramp (no hue rotation). */
const EXPECTED_STOPS = [
  '#3e1676',
  '#491e87',
  '#542799',
  '#5f2faa',
  '#6b37bc',
  '#763fcd',
  '#8148df',
  '#8c50f0',
] as const

describe('RIPPLE_COLOR_STOPS (densable Phr)', () => {
  test('8 fixed purple stops', () => {
    expect([...RIPPLE_COLOR_STOPS]).toEqual([...EXPECTED_STOPS])
  })

  test('RIPPLE_PEAK is brightest stop', () => {
    expect(RIPPLE_PEAK).toBe('#8c50f0')
  })

  test('lavender + white text constants', () => {
    expect(RIPPLE_LAVENDER).toBe('#d0b4ff')
    expect(RIPPLE_TEXT_ON_BG).toBe('#ffffff')
  })
})

describe('intensityToColor', () => {
  test('intensity=0 → darkest purple stop', () => {
    expect(intensityToColor(0)).toBe(EXPECTED_STOPS[0])
  })

  test('intensity < 0 钳到 0', () => {
    expect(intensityToColor(-0.5)).toBe(EXPECTED_STOPS[0])
  })

  test('intensity > 0 → 合法 hex（不返回 transparent）', () => {
    for (const v of [0.05, 0.1, 0.2, 0.5, 0.8]) {
      const c = intensityToColor(v)
      expect(c).not.toBe(TRANSPARENT)
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  test('intensity > 1 钳到 1 → 最高档', () => {
    expect(intensityToColor(1.5)).toBe(intensityToColor(1))
    expect(intensityToColor(1)).toBe(EXPECTED_STOPS[7])
  })

  test('intensity 单调递增 → 颜色档位递增（至少 3 档）', () => {
    const samples = [0.2, 0.4, 0.6, 0.8, 1.0]
    const colors = samples.map(intensityToColor)
    const unique = new Set(colors)
    expect(unique.size).toBeGreaterThanOrEqual(3)
  })

  test('hueShift ignored (densable no hue rotation)', () => {
    for (const v of [0, 0.2, 0.5, 0.8, 1]) {
      expect(intensityToColor(v, 30)).toBe(intensityToColor(v))
      expect(intensityToColor(v, 180)).toBe(intensityToColor(v))
    }
  })
})

describe('rotateHue / getHueShiftAtTime (densable no-ops)', () => {
  test('rotateHue is identity', () => {
    expect(rotateHue('#8c50f0', 90)).toBe('#8c50f0')
    expect(rotateHue('#5769F7', 180)).toBe('#5769F7')
    expect(rotateHue('not-a-color', 45)).toBe('not-a-color')
  })

  test('getHueShiftAtTime always 0', () => {
    for (const t of [0, 100, 3000, 6000, 12000, 50000]) {
      expect(getHueShiftAtTime(t)).toBe(0)
    }
  })
})

describe('densableRippleLevel / densableRippleDistance', () => {
  test('dist > travel → null (outside wavefront)', () => {
    expect(densableRippleLevel(10, 5)).toBeNull()
    expect(densableRippleLevel(0.1, 0)).toBeNull()
  })

  test('dist <= travel → ramp index in 0..7', () => {
    const level = densableRippleLevel(0, 100)
    expect(level).not.toBeNull()
    expect(level!).toBeGreaterThanOrEqual(0)
    expect(level!).toBeLessThanOrEqual(7)
  })

  test('distance y scaled ×2', () => {
    // dx=0, dy=1 → sqrt(0 + 4) = 2
    expect(densableRippleDistance(0, 1, 0, 0)).toBe(2)
    // dx=3, dy=0 → 3
    expect(densableRippleDistance(3, 0, 0, 0)).toBe(3)
  })
})

describe('computeRippleCells (densable expanding wavefront)', () => {
  test('返回数组长度等于 width', () => {
    const cells = computeRippleCells({
      y: 2,
      width: 30,
      time: 100,
      sourceX: 25,
      sourceY: 2,
    })
    expect(cells.length).toBe(30)
  })

  test('每个 cell 的 char 是空格', () => {
    const cells = computeRippleCells({
      y: 0,
      width: 10,
      time: 0,
      sourceX: 5,
      sourceY: 0,
    })
    for (const cell of cells) {
      expect(cell.char).toBe(' ')
    }
  })

  test('每个 cell 的 color 是 transparent 或紫阶 hex', () => {
    const cells = computeRippleCells({
      y: 0,
      width: 10,
      time: 500,
      sourceX: 5,
      sourceY: 0,
    })
    for (const cell of cells) {
      expect(
        cell.color === TRANSPARENT ||
          (RIPPLE_COLOR_STOPS as readonly string[]).includes(cell.color),
      ).toBe(true)
    }
  })

  test('width=0 / width<0 → 空数组', () => {
    expect(
      computeRippleCells({ y: 0, width: 0, time: 0, sourceX: 0, sourceY: 0 }),
    ).toEqual([])
    expect(
      computeRippleCells({ y: 0, width: -5, time: 0, sourceX: 0, sourceY: 0 }),
    ).toEqual([])
  })

  test('time=0 → travel=0：仅 dist=0 的震源可能染色，远端 transparent', () => {
    const cells = computeRippleCells({
      y: 0,
      width: 11,
      time: 0,
      sourceX: 5,
      sourceY: 0,
    })
    // origin x=5, dist=0 ≤ travel=0 → on wave
    expect(cells[5]!.color).not.toBe(TRANSPARENT)
    expect(
      (RIPPLE_COLOR_STOPS as readonly string[]).includes(cells[5]!.color),
    ).toBe(true)
    // far cells dist > 0 → transparent
    expect(cells[0]!.color).toBe(TRANSPARENT)
    expect(cells[10]!.color).toBe(TRANSPARENT)
  })

  test('travel 扩张：time 增大后远端从 transparent 变为紫阶', () => {
    // travel = time * 0.03；time=2000 → travel=60
    const early = computeRippleCells({
      y: 0,
      width: 40,
      time: 100,
      sourceX: 0,
      sourceY: 0,
    })
    // travel=3；x=20 dist=20 > 3 → transparent
    expect(early[20]!.color).toBe(TRANSPARENT)

    const later = computeRippleCells({
      y: 0,
      width: 40,
      time: 2000,
      sourceX: 0,
      sourceY: 0,
    })
    // travel=60；x=20 dist=20 ≤ 60 → purple
    expect(later[20]!.color).not.toBe(TRANSPARENT)
    expect(
      (RIPPLE_COLOR_STOPS as readonly string[]).includes(later[20]!.color),
    ).toBe(true)
  })

  test('time 推进时颜色分布变化（波前/相位）', () => {
    const t0 = computeRippleCells({
      y: 0,
      width: 30,
      time: 500,
      sourceX: 15,
      sourceY: 0,
    })
    const t1 = computeRippleCells({
      y: 0,
      width: 30,
      time: 1500,
      sourceX: 15,
      sourceY: 0,
    })
    const diffs = t0.filter((c, i) => c.color !== t1[i]!.color)
    expect(diffs.length).toBeGreaterThan(0)
  })
})

describe('applyOverlaysToCells', () => {
  function makeCells(colors: string[]): Cell[] {
    return colors.map(c => ({ char: ' ', color: c }))
  }

  test('无 overlay 时原样返回（同引用 early-return）', () => {
    const cells = makeCells(['#111', '#222', '#333'])
    const out = applyOverlaysToCells(cells, [])
    expect(out).toBe(cells)
  })

  test('overlay 替换 char 但保留底层 color（color 未指定时）', () => {
    const cells = makeCells([
      TRANSPARENT,
      TRANSPARENT,
      TRANSPARENT,
      TRANSPARENT,
    ])
    const overlays: Overlay[] = [{ text: 'hi', x: 1 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[1]!.char).toBe('h')
    expect(out[2]!.char).toBe('i')
    expect(out[1]!.color).toBe(TRANSPARENT)
    expect(out[0]!.char).toBe(' ')
  })

  test('overlay 指定 color 时同时覆盖 char + color', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'AB', x: 0, color: '#8c50f0' }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0]).toEqual({ char: 'A', color: '#8c50f0' })
    expect(out[1]).toEqual({ char: 'B', color: '#8c50f0' })
    expect(out[2]).toEqual({ char: ' ', color: TRANSPARENT })
  })

  test('overlay 超出右边界被截断', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'abcdef', x: 1 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0]!.char).toBe(' ')
    expect(out[1]!.char).toBe('a')
    expect(out[2]!.char).toBe('b')
  })

  test('overlay x 为负数 → 从开头截断', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'abc', x: -1 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0]!.char).toBe('b')
    expect(out[1]!.char).toBe('c')
    expect(out[2]!.char).toBe(' ')
  })

  test('多个 overlay 后者覆盖前者', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [
      { text: 'AAA', x: 0, color: '#111111' },
      { text: 'B', x: 1, color: '#222222' },
    ]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0]).toEqual({ char: 'A', color: '#111111' })
    expect(out[1]).toEqual({ char: 'B', color: '#222222' })
    expect(out[2]).toEqual({ char: 'A', color: '#111111' })
  })

  test('不修改原数组', () => {
    const cells = makeCells([TRANSPARENT])
    const snapshot = cells.map(c => ({ ...c }))
    applyOverlaysToCells(cells, [{ text: 'X', x: 0 }])
    expect(cells).toEqual(snapshot)
  })
})

describe('cellsToSegments', () => {
  test('空数组 → 空数组', () => {
    expect(cellsToSegments([])).toEqual([])
  })

  test('全部同色 → 合并为一段', () => {
    const cells: Cell[] = [
      { char: 'a', color: '#111111' },
      { char: 'b', color: '#111111' },
      { char: 'c', color: '#111111' },
    ]
    expect(cellsToSegments(cells)).toEqual([{ text: 'abc', color: '#111111' }])
  })

  test('颜色交替 → 独立段', () => {
    const cells: Cell[] = [
      { char: 'a', color: '#111111' },
      { char: 'b', color: '#222222' },
      { char: 'c', color: '#111111' },
    ]
    expect(cellsToSegments(cells)).toEqual([
      { text: 'a', color: '#111111' },
      { text: 'b', color: '#222222' },
      { text: 'c', color: '#111111' },
    ])
  })

  test('相邻同色合并', () => {
    const cells: Cell[] = [
      { char: 'a', color: TRANSPARENT },
      { char: 'b', color: TRANSPARENT },
      { char: 'X', color: '#8c50f0' },
      { char: 'Y', color: '#8c50f0' },
      { char: 'c', color: TRANSPARENT },
    ]
    expect(cellsToSegments(cells)).toEqual([
      { text: 'ab', color: TRANSPARENT },
      { text: 'XY', color: '#8c50f0' },
      { text: 'c', color: TRANSPARENT },
    ])
  })
})

describe('fadeColor', () => {
  test('fade≈1 → 原色', () => {
    expect(fadeColor('#8c50f0', 1)).toBe('#8c50f0')
  })

  test('fade≈0 → TRANSPARENT', () => {
    expect(fadeColor('#8c50f0', 0)).toBe(TRANSPARENT)
    expect(fadeColor('#8c50f0', 0.001)).toBe(TRANSPARENT)
  })

  test('fade=0.5 → RGB 减半', () => {
    // #8c50f0 = (140, 80, 240) → (70, 40, 120) = #462878
    expect(fadeColor('#8c50f0', 0.5)).toBe('#462878')
  })

  test('非法 hex → 原样返回', () => {
    expect(fadeColor(TRANSPARENT, 0.5)).toBe(TRANSPARENT)
    expect(fadeColor('#123', 0.5)).toBe('#123')
  })
})

describe('fadeCells (densable-style threshold fade)', () => {
  test('fade≈1 → 原样返回', () => {
    const cells: Cell[] = [{ char: ' ', color: '#8c50f0' }]
    expect(fadeCells(cells, 1)).toBe(cells)
  })

  test('fade≈0 → 空格波纹变 transparent，文字保留', () => {
    const cells: Cell[] = [
      { char: ' ', color: '#8c50f0' },
      { char: 'A', color: '#8c50f0' },
    ]
    const out = fadeCells(cells, 0)
    expect(out[0]!.color).toBe(TRANSPARENT)
    expect(out[1]!.color).toBe('#8c50f0')
  })

  test('fade < 0.5 → 空格波纹 transparent（避免 muddy）', () => {
    const cells: Cell[] = [
      { char: ' ', color: '#8c50f0' },
      { char: 'X', color: '#8c50f0' },
    ]
    const out = fadeCells(cells, 0.4)
    expect(out[0]!.color).toBe(TRANSPARENT)
    expect(out[1]!.color).toBe('#8c50f0')
  })

  test('fade >= 0.5 → 保持 densable 紫阶（不混黑）', () => {
    const cells: Cell[] = [
      { char: ' ', color: '#8c50f0' },
      { char: 'A', color: '#ffffff' },
    ]
    const out = fadeCells(cells, 0.5)
    expect(out[0]!.color).toBe('#8c50f0')
    expect(out[1]!.color).toBe('#ffffff')
  })

  test('不修改原数组（partial fade 路径）', () => {
    const cells: Cell[] = [{ char: ' ', color: '#8c50f0' }]
    const snapshot = cells.map(c => ({ ...c }))
    fadeCells(cells, 0.3)
    expect(cells).toEqual(snapshot)
  })
})
