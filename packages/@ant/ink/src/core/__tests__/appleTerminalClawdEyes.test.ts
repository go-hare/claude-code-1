/**
 * Apple Terminal Clawd eyes: keep truecolor Claude orange body, use
 * basic ansi black (SGR 30) for pupils. Do NOT clamp global chalk.level
 * to 2 — that cubes rgb(215,119,87) → ansi256 174 washed salmon.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { applyTextStyles } from '../colorize.js'

const colorizeSrc = readFileSync(
  join(import.meta.dir, '../colorize.ts'),
  'utf8',
)
const clawdSrc = readFileSync(
  join(import.meta.dir, '../../../../../../src/components/LogoV2/Clawd.tsx'),
  'utf8',
)

/** Strip block/line comments so source-string assertions only see real code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function jsxish(src: string): string {
  return stripComments(src)
    .split('\n')
    .filter(line => line.includes('<') || line.includes('>'))
    .join('\n')
}

const ESC = String.fromCharCode(27)
const clawdJsx = jsxish(clawdSrc)

describe('Apple Terminal Clawd eyes (truecolor body + ansi black pupils)', () => {
  test('colorize.ts has no global Apple chalk.level clamp', () => {
    expect(colorizeSrc).not.toContain('clampChalkLevelForAppleTerminal')
    expect(colorizeSrc).not.toContain('CHALK_CLAMPED_FOR_APPLE_TERMINAL')
    expect(colorizeSrc).toContain('boostChalkLevelForXtermJs')
    expect(colorizeSrc).toContain('clampChalkLevelForTmux')
  })

  test('AppleTerminalClawd uses ansi:black eye FG on clawd_body bg (densable _ta + local pupil fix)', () => {
    expect(clawdJsx).toContain('color="ansi:black"')
    expect(clawdJsx).toContain('backgroundColor="clawd_body"')
    expect(clawdJsx).toContain('color="clawd_body"')
    expect(clawdJsx).not.toMatch(
      /color="clawd_background"\s+backgroundColor="clawd_body"/,
    )
    // no fixed width on Clawd (clips half-blocks into solid bar) or wrap truncate
    expect(clawdJsx).not.toMatch(/width=\{CLAWD_WIDTH\}/)
    expect(clawdJsx).not.toMatch(/wrap=\{?["']truncate["']\}?/)
    // standard KB + Apple host both keep flexShrink:0 (Apple densable _ta
    // omits it, but Fleet header row pressure requires it to avoid solid bars)
    expect(clawdJsx).toContain('flexShrink={0}')
    expect(clawdJsx).toMatch(
      /flexDirection="column"\s+alignItems="center"\s+flexShrink=\{0\}/,
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

      expect(eyes).toContain(`${ESC}[30m`)
      expect(eyes).not.toContain(`${ESC}[38;2;0;0;0m`)
      expect(eyes).toContain(`${ESC}[48;2;215;119;87m`)
      expect(body).toContain(`${ESC}[48;2;215;119;87m`)
      expect(washed).toContain(`${ESC}[38;2;215;119;87m`)
      expect(washed).not.toContain(`${ESC}[38;5;174m`)
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
      expect(styled).toContain(`${ESC}[38;5;174m`)
      expect(styled).not.toContain(`${ESC}[38;2;215;119;87m`)
    } finally {
      chalk.level = prev
    }
  })
})
