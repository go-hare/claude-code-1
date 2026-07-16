import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetJediTermInputForTesting,
  createArrowBurstWindow,
  createJediTermInputState,
  isJediTermArrowFloodActive,
  rewriteJediTermInput,
  trackArrowBurst,
} from '../jediTermInput.js'
import type { ParsedInput } from '../parse-keypress.js'

function key(name: string): ParsedInput {
  return {
    kind: 'key',
    name,
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: name,
    raw: name,
    isPasted: false,
  }
}

afterEach(() => {
  _resetJediTermInputForTesting()
  delete process.env.TERMINAL_EMULATOR
  delete process.env.INTELLIJ_TERMINAL_COMMAND_BLOCKS
})

describe('rewriteJediTermInput', () => {
  test('noop without JediTerm', () => {
    const s = createJediTermInputState()
    const items = [key('wheelup')]
    expect(rewriteJediTermInput(s, items, 1, undefined, {})).toBe(items)
  })

  test('rewrites wheelup after recent wheeldown when bug confirmed', () => {
    const env = {
      TERMINAL_EMULATOR: 'JetBrains-JediTerm',
      INTELLIJ_TERMINAL_COMMAND_BLOCKS: '1',
    }
    const s = createJediTermInputState()
    rewriteJediTermInput(s, [key('wheeldown')], 1000, undefined, env)
    const out = rewriteJediTermInput(s, [key('wheelup')], 1100, undefined, env)
    expect((out[0] as { name?: string }).name).toBe('wheeldown')
  })

  test('drops bare arrows near wheel', () => {
    const env = { TERMINAL_EMULATOR: 'JetBrains-JediTerm' }
    const s = createJediTermInputState()
    rewriteJediTermInput(s, [key('wheeldown')], 1000, undefined, env)
    const out = rewriteJediTermInput(s, [key('up')], 1030, undefined, env)
    expect(out).toEqual([])
    expect(isJediTermArrowFloodActive()).toBe(true)
  })
})

describe('trackArrowBurst', () => {
  test('fires at threshold 8', () => {
    const w = createArrowBurstWindow()
    const items = Array.from({ length: 8 }, () => key('down'))
    expect(trackArrowBurst(w, items, 50)).toEqual({
      direction: 'down',
      count: 8,
    })
  })
})
