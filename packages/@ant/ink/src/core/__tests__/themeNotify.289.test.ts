/**
 * densable 2.1.289 watchSystemTheme — DEC 2031 notify + OSC 11 luminance.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INITIAL_STATE, parseMultipleKeypresses } from '../parse-keypress.js'
import { TerminalQuerier } from '../terminal-querier.js'
import {
  getOsc11Responsive,
  resetTerminalProbeForTests,
  setOsc11Responsive,
} from '../terminal.js'
import { watchSystemTheme } from '../../../utils/systemThemeWatcher.js'
import {
  getSystemThemeName,
  resetSystemThemeForTests,
  setCachedSystemTheme,
  subscribeSystemTheme,
  themeFromOscColor,
} from '../../theme/systemTheme.js'

const savedEnv = {
  TMUX: process.env.TMUX,
  STY: process.env.STY,
  TERM: process.env.TERM,
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  CLAUDE_BG_BACKEND: process.env.CLAUDE_BG_BACKEND,
  COLORFGBG: process.env.COLORFGBG,
}

function restoreEnv(): void {
  for (const key of [
    'TMUX',
    'STY',
    'TERM',
    'TERM_PROGRAM',
    'CLAUDE_BG_BACKEND',
    'COLORFGBG',
  ] as const) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  restoreEnv()
  resetTerminalProbeForTests()
  resetSystemThemeForTests()
})

function fakeStdout(): NodeJS.WriteStream {
  return {
    write() {
      return true
    },
  } as unknown as NodeJS.WriteStream
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('themeNotify 289', () => {
  test('CSI ?997;1n / ;2n parse as themeNotify', () => {
    const [dark] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[?997;1n')
    expect(dark[0]).toMatchObject({
      kind: 'response',
      response: { type: 'themeNotify', dark: true },
    })
    const [light] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[?997;2n')
    expect(light[0]).toMatchObject({
      kind: 'response',
      response: { type: 'themeNotify', dark: false },
    })
  })

  test('OSC rgb luminance splits at 0.5', () => {
    expect(themeFromOscColor('rgb:0000/0000/0000')).toBe('dark')
    expect(themeFromOscColor('rgb:ffff/ffff/ffff')).toBe('light')
    expect(themeFromOscColor('#ffffff')).toBe('light')
    expect(themeFromOscColor('nope')).toBeUndefined()
  })

  test('y0t skips emit when the cached system theme is unchanged', () => {
    resetSystemThemeForTests()
    process.env.COLORFGBG = '15;8'
    expect(getSystemThemeName()).toBe('dark')
    let n = 0
    const stop = subscribeSystemTheme(() => {
      n += 1
    })
    setCachedSystemTheme('dark')
    expect(n).toBe(0)
    setCachedSystemTheme('light')
    expect(n).toBe(1)
    setCachedSystemTheme('light')
    expect(n).toBe(1)
    stop()
  })

  test('C7t Re/jat: ThemeProvider seeds Zle and subscribes before OSC poll', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../theme/ThemeProvider.tsx'),
      'utf8',
    )
    expect(src).toContain('useLayoutEffect')
    expect(src).toContain('subscribeSystemTheme(setSystemTheme)')
    expect(src).toContain(
      "(initialState ?? themeSetting) === 'auto' ? getSystemThemeName() : 'dark'",
    )
    expect(src).toContain("if (activeSetting !== 'auto') return")
    expect(src).toContain('return subscribeSystemTheme(setSystemTheme)')
  })

  test('COLORFGBG 8 is dark and unset defaults to dark', () => {
    resetSystemThemeForTests()
    process.env.COLORFGBG = '15;8'
    expect(getSystemThemeName()).toBe('dark')
    resetSystemThemeForTests()
    process.env.COLORFGBG = '0;15'
    expect(getSystemThemeName()).toBe('light')
    resetSystemThemeForTests()
    delete process.env.COLORFGBG
    expect(getSystemThemeName()).toBe('dark')
  })

  test('OSC 11 reply updates the theme setter', async () => {
    delete process.env.TMUX
    delete process.env.STY
    delete process.env.CLAUDE_BG_BACKEND
    resetTerminalProbeForTests()
    const querier = new TerminalQuerier(fakeStdout())
    querier.setInputAttached(true)
    const seen: Array<'dark' | 'light'> = []
    const stop = watchSystemTheme(querier, theme => {
      if (theme === 'dark' || theme === 'light') seen.push(theme)
    })
    querier.onResponse({
      type: 'osc',
      code: 11,
      data: 'rgb:ffff/ffff/ffff',
    })
    querier.onResponse({ type: 'da1', params: [1] })
    await flush()
    expect(seen).toEqual(['light'])
    expect(getOsc11Responsive()).toBe(true)
    expect(getSystemThemeName()).toBe('light')

    querier.onResponse({ type: 'themeNotify', dark: true })
    querier.onResponse({ type: 'osc', code: 11, data: 'rgb:0000/0000/0000' })
    querier.onResponse({ type: 'da1', params: [1] })
    await flush()
    expect(seen.at(-1)).toBe('dark')
    stop()
  })

  test('no OSC reply marks osc11Responsive false and skips the next initial poll', async () => {
    delete process.env.TMUX
    delete process.env.STY
    delete process.env.CLAUDE_BG_BACKEND
    resetTerminalProbeForTests()
    const first = new TerminalQuerier(fakeStdout())
    first.setInputAttached(true)
    const stop1 = watchSystemTheme(first, () => {})
    first.onResponse({ type: 'da1', params: [] })
    await flush()
    expect(getOsc11Responsive()).toBe(false)
    stop1()

    const second = new TerminalQuerier(fakeStdout())
    second.setInputAttached(true)
    let polls = 0
    const orig = second.send.bind(second)
    second.send = query => {
      polls++
      return orig(query)
    }
    const stop2 = watchSystemTheme(second, () => {})
    await flush()
    expect(polls).toBe(0)
    second.onResponse({ type: 'themeNotify', dark: false })
    expect(polls).toBe(1)
    stop2()
    setOsc11Responsive(true)
  })

  test('tmux timeout falls back to a bare OSC 11 query', async () => {
    process.env.TMUX = '/tmp/tmux,1,0'
    process.env.TERM = 'tmux-256color'
    delete process.env.TERM_PROGRAM
    delete process.env.STY
    delete process.env.CLAUDE_BG_BACKEND
    resetTerminalProbeForTests()
    const writes: string[] = []
    const querier = new TerminalQuerier({
      write(chunk: string) {
        writes.push(chunk)
        return true
      },
    } as unknown as NodeJS.WriteStream)
    querier.setInputAttached(true)
    const seen: Array<'dark' | 'light'> = []
    const stop = watchSystemTheme(
      querier,
      theme => {
        if (theme === 'dark' || theme === 'light') seen.push(theme)
      },
      { muxTimeoutMs: 0 },
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    // Wrapped DCS query is cancelled; bare OSC 11 + DA1 complete the fallback.
    querier.onResponse({ type: 'osc', code: 11, data: 'rgb:0000/0000/0000' })
    querier.onResponse({ type: 'da1', params: [] })
    await flush()
    expect(writes.some(chunk => chunk.includes('Ptmux;'))).toBe(true)
    expect(seen).toEqual(['dark'])
    stop()
  })
})
