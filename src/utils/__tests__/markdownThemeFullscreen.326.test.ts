import { afterEach, describe, expect, test } from 'bun:test'
import { Jk, setXtversionName } from '@anthropic/ink'
import { promptModeMarked } from '../../components/Markdown.js'
import { computeTableColumnWidths } from '../../components/MarkdownTable.js'
import { normalizeTransparentDiffForeground } from '../../components/StructuredDiff.js'
import {
  numberDiffLines,
  processAdjacentLines,
  transformLinesToObjects,
} from '../../components/StructuredDiff/Fallback.js'
import { detectProbedNotificationChannel } from '../../services/notifier.js'
import {
  explainTuiKeptRenderer,
  formatRendererLabel,
  getEffectiveTuiSetting,
  getFullscreenGateReason,
  isFreshInstallFullscreen,
  latchSessionTuiSetting,
  maybeGetTmuxMouseHint,
  resetFullscreenGateCache,
  resolveTuiJustSwitchedBanner,
} from '../fullscreen.js'
import { applyMarkdown } from '../markdown.js'
import { getTheme } from '../theme.js'

const origEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in origEnv)) delete process.env[key]
  }
  Object.assign(process.env, origEnv)
}

afterEach(() => {
  restoreEnv()
  Jk().xtversionName = undefined
  Jk().tmuxPane = undefined
  resetFullscreenGateCache()
})

describe('Wave 326 Group 4A — Markdown, Theme, Diff, Notifier, Fullscreen', () => {
  test('#140 / #182 / #183 / #349: fullscreen session latch, /tui kept-renderer reason, fresh install, tmux notice removed', async () => {
    expect(await maybeGetTmuxMouseHint()).toBeNull()
    expect(formatRendererLabel('fullscreen')).toBe('fullscreen')
    expect(formatRendererLabel('default')).toBe('classic')

    // #182: explainTuiKeptRenderer reports env override source
    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    const reason = explainTuiKeptRenderer('env_on', 'default')
    expect(reason).toContain('CLAUDE_CODE_NO_FLICKER')
    delete process.env.CLAUDE_CODE_NO_FLICKER

    // #140: latchSessionTuiSetting latches active session setting idempotently
    latchSessionTuiSetting()
    const latched = getEffectiveTuiSetting()
    expect(
      latched === undefined ||
        latched === 'default' ||
        latched === 'fullscreen',
    ).toBe(true)
    expect(getEffectiveTuiSetting()).toBe(latched)

    // #183: fresh install fullscreen check returns boolean & caches cleanly
    expect(typeof isFreshInstallFullscreen()).toBe('boolean')

    // Switched banner
    process.env.CLAUDE_CODE_TUI_JUST_SWITCHED = 'fullscreen'
    const banner = resolveTuiJustSwitchedBanner()
    expect(banner === null || typeof banner === 'string').toBe(true)

    // #182 / #140: getFullscreenGateReason({ ignoreSessionLatch: true }) accepts option cleanly
    const liveReason = getFullscreenGateReason({ ignoreSessionLatch: true })
    expect(typeof liveReason).toBe('string')
  })

  test('#146 & #148: promptModeMarked suppresses diff/indented lists, preserves 4-space code, and keeps globs/math literal', () => {
    const plusDiff = promptModeMarked.lexer('+ added line\n+ another')
    expect(plusDiff.some(t => t.type === 'list')).toBe(false)

    const indentedCode = promptModeMarked.lexer(
      '    const x = 1;\n    return x;',
    )
    expect(indentedCode[0]?.type).toBe('code')
    if (indentedCode[0]?.type === 'code') {
      expect(indentedCode[0].text).toContain('    const x = 1;')
    }

    // #148: globs and multiplication expressions should not eat asterisks
    const globTokens = promptModeMarked.lexer(
      'Check src/**/*.ts and 2*3*4 please',
    )
    const rawRendered = JSON.stringify(globTokens)
    expect(rawRendered).toContain('src/**/*.ts')
    expect(rawRendered).toContain('2*3*4')
    expect(rawRendered).not.toContain('"type":"em"')
    expect(rawRendered).not.toContain('"type":"strong"')

    // Genuine bold/italic still work
    const realBold = promptModeMarked.lexer('Please **check** this')
    expect(JSON.stringify(realBold)).toContain('"type":"strong"')
  })

  test('#150 & #151: Windows paths keep backslashes and CJK bold with punctuation renders strong', () => {
    const winRendered = applyMarkdown(
      'Open C:\\Users\\alice\\project_name\\file.ts now',
      'dark',
    )
    expect(winRendered).toContain('C:\\Users\\alice\\project_name\\file.ts')

    const cjkRendered = applyMarkdown(
      '请看**中文（测试）**和**重点！**继续',
      'dark',
    )
    expect(cjkRendered).not.toContain('**中文')
    expect(cjkRendered).not.toContain('**重点')
    expect(cjkRendered).toContain('中文（测试）')
    expect(cjkRendered).toContain('重点！')
  })

  test('#176: notifier detects Ghostty/iTerm2/kitty over SSH and respects tmux passthrough=off', () => {
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    Jk().tmuxPane = {
      top: 0,
      left: 0,
      hasFocusEvents: true,
      isPlaced: true,
      passthrough: 'off',
    }
    setXtversionName('iTerm2 3.6.6')
    expect(detectProbedNotificationChannel()).toBeUndefined()

    Jk().tmuxPane = {
      top: 0,
      left: 0,
      hasFocusEvents: true,
      isPlaced: true,
      passthrough: 'on',
    }
    expect(detectProbedNotificationChannel()).toBe('iterm2')

    setXtversionName('ghostty 1.3.1')
    expect(detectProbedNotificationChannel()).toBe('ghostty')

    setXtversionName('kitty 0.40.0')
    expect(detectProbedNotificationChannel()).toBe('kitty')
  })

  test('#217: computeTableColumnWidths avoids splitting narrow words beside a wide description column', () => {
    const { columnWidths } = computeTableColumnWidths(
      [4, 6, 11],
      [4, 6, 85],
      60,
    )
    expect(columnWidths).toHaveLength(3)
    // Short columns ('Key', 'Status') keep enough width for their whole words
    expect(columnWidths[0]!).toBeGreaterThanOrEqual(4)
    expect(columnWidths[1]!).toBeGreaterThanOrEqual(6)
    expect(
      columnWidths[0]! + columnWidths[1]! + columnWidths[2]!,
    ).toBeLessThanOrEqual(60)
  })

  test('#218 / #219 / #220: theme rate_limit_empty contrast & transparent diff fg rewrite', () => {
    expect(getTheme('light').rate_limit_empty).toBe('rgb(213,218,253)')
    expect(getTheme('light-ansi').rate_limit_fill).toBe('ansi:blue')
    expect(getTheme('light-ansi').rate_limit_empty).toBe('ansi:white')
    expect(getTheme('dark-ansi').rate_limit_empty).toBe('ansi:blackBright')
    expect(getTheme('dark-ansi').briefLabelYou).toBe('ansi:whiteBright')
    expect(getTheme('light-daltonized').rate_limit_empty).toBe(
      'rgb(204,217,255)',
    )

    // #219: hardcoded Monokai/GitHub fg before default bg resets to default fg \x1b[39m
    expect(
      normalizeTransparentDiffForeground('\x1b[38;2;248;248;242m\x1b[49mhello'),
    ).toBe('\x1b[39m\x1b[49mhello')
    expect(
      normalizeTransparentDiffForeground('\x1b[38;2;51;51;51m\x1b[49mhello'),
    ).toBe('\x1b[39m\x1b[49mhello')
  })

  test('#225: StructuredDiffFallback parses \\ No newline at end of file as note without shifting line numbers', () => {
    const raw = [
      ' line1',
      '-old last',
      '\\ No newline at end of file',
      '+new last',
      '\\ No newline at end of file',
    ]
    const objs = transformLinesToObjects(raw)
    expect(objs.map(o => o.type)).toEqual([
      'nochange',
      'remove',
      'note',
      'add',
      'note',
    ])
    const processed = processAdjacentLines(objs)
    const numbered = numberDiffLines(processed, 10)
    const noteLines = numbered.filter(l => l.type === 'note')
    expect(noteLines).toHaveLength(2)
    expect(noteLines.every(l => l.i === 0)).toBe(true)
    const addLine = numbered.find(l => l.type === 'add')
    expect(addLine?.i).toBe(11)
  })
})
