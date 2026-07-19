/**
 * Apple Terminal Clawd eyes: keep truecolor Claude orange body, use
 * basic ansi black (SGR 30) for pupils. Do NOT clamp global chalk.level
 * to 2 — that cubes rgb(215,119,87) → ansi256 174 washed salmon.
 *
 * densable Ypg uses a separate level-2 Chalk only for chart/themeColorToAnsi;
 * Clawd rendering stays on global chalk.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { applyTextStyles } from '../colorize.js'

const colorizeSrc = readFileSync(join(import.meta.dir, '../colorize.ts'), 'utf8')
const clawdSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../../../../src/components/LogoV2/Clawd.tsx',
  ),
  'utf8',
)

describe('Apple Terminal Clawd eyes (truecolor body + ansi black pupils)', () => {
  test('colorize.ts has no global Apple chalk.level clamp', () => {
    expect(colorizeSrc).not.toContain('clampChalkLevelForAppleTerminal')
    expect(colorizeSrc).not.toContain('CHALK_CLAMPED_FOR_APPLE_TERMINAL')
    // keep densable-aligned order: boost then tmux only
    expect(colorizeSrc).toContain('boostChalkLevelForXtermJs')
    expect(colorizeSrc).toContain('clampChalkLevelForTmux')
  })

  test('AppleTerminalClawd uses ansi:black eye FG on clawd_body bg', () => {
    expect(clawdSrc).toContain('color="ansi:black"')
    expect(clawdSrc).toContain('backgroundColor="clawd_body"')
    // must not force truecolor black pupils on Apple path
    expect(clawdSrc).not.toMatch(
      /color="clawd_background"\s+backgroundColor="clawd_body"/,
    )
  })

  test('at chalk level 3, orange body stays truecolor and ansi black is SGR 30', () => {
    const prev = chalk.level
    chalk.level = 3
    try {
      const orange = 'rgb(215,119,87)'
      const eyes = applyTextStyles(' ▗   ▖ ', {
        color: 'ansi:black',
        backgroundColor: orange,
      })
      const body = applyTextStyles('       ', {
        backgroundColor: orange,
      })
      const washed = applyTextStyles('X', { color: orange })

      // pupils: basic black, not truecolor 38;2;0;0;0
      expect(eyes).toMatch(/\x1b\[30m/)
      expect(eyes).not.toMatch(/\x1b\[38;2;0;0;0m/)
      // body / eye bg: true Claude orange, not 256-cube salmon
      expect(eyes).toMatch(/\x1b\[48;2;215;119;87m/)
      expect(body).toMatch(/\x1b\[48;2;215;119;87m/)
      expect(washed).toMatch(/\x1b\[38;2;215;119;87m/)
      expect(washed).not.toMatch(/\x1b\[38;5;174m/)
    } finally {
      chalk.level = prev
    }
  })

  test('level-2 cube still washes orange (why we refuse global Apple clamp)', () => {
    const prev = chalk.level
    chalk.level = 2
    try {
      const styled = applyTextStyles('X', {
        color: 'rgb(215,119,87)',
      })
      expect(styled).toMatch(/\x1b\[38;5;174m/)
      expect(styled).not.toMatch(/\x1b\[38;2;215;119;87m/)
    } finally {
      chalk.level = prev
    }
  })
})
