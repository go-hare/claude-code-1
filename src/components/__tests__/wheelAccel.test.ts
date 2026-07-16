import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetJediTermInputForTesting,
  noteJediTermArrowFlood,
  rewriteJediTermInput,
  createJediTermInputState,
  trackArrowBurst,
  createArrowBurstWindow,
  isJediTermArrowFloodActive,
  consumeJediTermArrowBurstCount,
} from '@anthropic/ink'
import type { ParsedInput } from '../../../packages/@ant/ink/src/core/parse-keypress.js'
import {
  computeWheelStep,
  initWheelAccel,
  resolveOfficialAutoScrollBase,
  resolveWheelProfile,
  isWheelFloodHost,
} from '../ScrollKeybindingHandler.js'

function key(
  name: string,
  opts: Partial<{
    ctrl: boolean
    meta: boolean
    shift: boolean
    isPasted: boolean
  }> = {},
): ParsedInput {
  return {
    kind: 'key',
    name,
    fn: false,
    ctrl: opts.ctrl ?? false,
    meta: opts.meta ?? false,
    shift: opts.shift ?? false,
    option: false,
    super: false,
    sequence: name,
    raw: name,
    isPasted: opts.isPasted ?? false,
  }
}

const ORIG = {
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION,
  WT_SESSION: process.env.WT_SESSION,
  CURSOR_TRACE_ID: process.env.CURSOR_TRACE_ID,
  VSCODE_GIT_ASKPASS_MAIN: process.env.VSCODE_GIT_ASKPASS_MAIN,
  TERMINAL_EMULATOR: process.env.TERMINAL_EMULATOR,
  CLAUDE_CODE_SCROLL_SPEED: process.env.CLAUDE_CODE_SCROLL_SPEED,
}

afterEach(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const [k, v] of Object.entries(ORIG)) restore(k, v)
  _resetJediTermInputForTesting()
})

describe('resolveOfficialAutoScrollBase / F3i', () => {
  test('non-flood → 3, flood → 1', () => {
    expect(resolveOfficialAutoScrollBase(false)).toBe(3)
    expect(resolveOfficialAutoScrollBase(true)).toBe(1)
  })
})

describe('isWheelFloodHost / $3i', () => {
  test('CURSOR_TRACE_ID forces flood', () => {
    expect(isWheelFloodHost({ CURSOR_TRACE_ID: 'x' }, undefined)).toBe(true)
  })
  test('vscode version range', () => {
    expect(
      isWheelFloodHost(
        { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.93.0' },
        undefined,
      ),
    ).toBe(true)
    expect(
      isWheelFloodHost(
        { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.106.0' },
        undefined,
      ),
    ).toBe(false)
  })
})

describe('resolveWheelProfile / J3', () => {
  test('win32 uses decay + base 3 when not flood', () => {
    delete process.env.TERM_PROGRAM
    delete process.env.WT_SESSION
    delete process.env.CURSOR_TRACE_ID
    delete process.env.VSCODE_GIT_ASKPASS_MAIN
    delete process.env.TERMINAL_EMULATOR
    delete process.env.CLAUDE_CODE_SCROLL_SPEED
    if (process.platform === 'win32') {
      const p = resolveWheelProfile(process.env)
      expect(p.useDecayCurve).toBe(true)
      expect(p.base).toBe(3)
    }
  })

  test('jediTerm base 2', () => {
    delete process.env.CLAUDE_CODE_SCROLL_SPEED
    delete process.env.CURSOR_TRACE_ID
    const p = resolveWheelProfile({
      ...process.env,
      TERMINAL_EMULATOR: 'JetBrains-JediTerm',
    })
    expect(p.jediTerm).toBe(true)
    expect(p.base).toBe(2)
  })

  test('SCROLL_SPEED overrides auto base', () => {
    const p = resolveWheelProfile({
      ...process.env,
      CLAUDE_CODE_SCROLL_SPEED: '5',
      TERMINAL_EMULATOR: undefined,
      CURSOR_TRACE_ID: undefined,
    })
    expect(p.base).toBe(5)
  })
})

describe('computeWheelStep / FSp', () => {
  test('decay idle kick uses max(2, base)', () => {
    const s = initWheelAccel(true, 3, false, true)
    expect(computeWheelStep(s, 1, 1000)).toBe(3)
  })

  test('decay sustained grows', () => {
    const s = initWheelAccel(true, 3, false, true)
    computeWheelStep(s, 1, 1000)
    const a = computeWheelStep(s, 1, 1025)
    const b = computeWheelStep(s, 1, 1050)
    expect(a).toBeGreaterThanOrEqual(3)
    expect(b).toBeGreaterThanOrEqual(a)
  })

  test('accel disabled returns base', () => {
    const s = initWheelAccel(true, 3, false, false)
    expect(computeWheelStep(s, 1, 1000)).toBe(3)
    expect(computeWheelStep(s, 1, 1020)).toBe(3)
  })

  test('window flood path', () => {
    const s = initWheelAccel(false, 1, true, true)
    // first event: gap huge → base * 3
    expect(computeWheelStep(s, 1, 1000)).toBe(3)
    // tight gap → base
    expect(computeWheelStep(s, 1, 1010)).toBe(1)
  })
})

describe('rewriteJediTermInput / RJc', () => {
  test('non-jedi leaves tokens alone', () => {
    delete process.env.TERMINAL_EMULATOR
    const state = createJediTermInputState()
    const items = [key('wheelup'), key('up')]
    expect(rewriteJediTermInput(state, items, 1000)).toEqual(items)
  })

  test('drops bare arrows near wheel and flips wheelup after wheeldown', () => {
    process.env.TERMINAL_EMULATOR = 'JetBrains-JediTerm'
    process.env.INTELLIJ_TERMINAL_COMMAND_BLOCKS = '1'
    const state = createJediTermInputState()
    const t0 = 1000
    let out = rewriteJediTermInput(state, [key('wheeldown')], t0)
    expect(out).toHaveLength(1)
    out = rewriteJediTermInput(state, [key('up'), key('wheelup')], t0 + 50)
    // up dropped; wheelup → wheeldown
    expect(out).toHaveLength(1)
    expect((out[0] as { name?: string }).name).toBe('wheeldown')
    expect(isJediTermArrowFloodActive()).toBe(true)
  })
})

describe('trackArrowBurst / eag', () => {
  test('emits when ≥8 same-dir bare arrows within 100ms', () => {
    const w = createArrowBurstWindow()
    const batch = Array.from({ length: 8 }, () => key('up'))
    const payload = trackArrowBurst(w, batch, 1000)
    expect(payload).toEqual({ direction: 'up', count: 8 })
  })

  test('does not emit for mixed directions', () => {
    const w = createArrowBurstWindow()
    expect(trackArrowBurst(w, [key('up'), key('down')], 1000)).toBeNull()
  })
})

describe('jbBypass / kJc path in computeWheelStep', () => {
  test('arrow flood uses fractional jb step and consumes burst', () => {
    noteJediTermArrowFlood()
    noteJediTermArrowFlood()
    // pending burst = 2 before compute
    expect(consumeJediTermArrowBurstCount()).toBe(2)
    // re-arm flood + burst for FSp
    noteJediTermArrowFlood()
    noteJediTermArrowFlood()
    noteJediTermArrowFlood()
    const s = initWheelAccel(true, 3, false, true)
    // frac step 0.35 * mult 1 → floor 0 first few events until frac accumulates
    const a = computeWheelStep(s, 1, 1000)
    expect(s.jbBypass).toBe(true)
    // mult grew from burst weight: 1 + 0.008 + 3*0.4 = 2.208
    expect(s.mult).toBeGreaterThan(1)
    // either 0 or positive rows depending on frac; call enough times to get rows
    let rows = a
    for (let i = 0; i < 20; i++) {
      rows += computeWheelStep(s, 1, 1000 + (i + 1) * 10)
    }
    expect(rows).toBeGreaterThan(0)
  })

  test('exiting flood clears jbBypass sticky', () => {
    noteJediTermArrowFlood()
    const s = initWheelAccel(true, 3, false, true)
    computeWheelStep(s, 1, 1000)
    expect(s.jbBypass).toBe(true)
    // clear flood module flag so next step takes non-jb path
    _resetJediTermInputForTesting()
    // still jbBypass sticky until head sees !kJc
    const step = computeWheelStep(s, 1, 1100)
    expect(s.jbBypass).toBe(false)
    // decay idle kick: max(2, base=3) = 3
    expect(step).toBe(3)
  })
})
