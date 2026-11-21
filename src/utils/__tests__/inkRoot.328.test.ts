import { describe, expect, test } from 'bun:test'
import {
  isNewRendererEnabled,
  resolveNewRendererTerminalCaps,
} from '../inkRoot.js'

describe('Wave 3A P1-#9: inkRoot resolveNewRendererTerminalCaps & isNewRendererEnabled', () => {
  test('marks tested terminals in official NS allowlist as isTested=true', () => {
    expect(
      resolveNewRendererTerminalCaps(
        { TERM: 'xterm-ghostty' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'ghostty', isTested: true })

    expect(
      resolveNewRendererTerminalCaps(
        { TERM_PROGRAM: 'vscode', TERM: 'xterm-256color' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'vscode', isTested: true })

    expect(
      resolveNewRendererTerminalCaps(
        { TERM: 'xterm-kitty' },
        { platform: 'linux' },
      ),
    ).toEqual({ name: 'kitty', isTested: true })

    expect(
      resolveNewRendererTerminalCaps(
        {
          TERM_PROGRAM: 'Apple_Terminal',
          TERM: 'xterm-256color',
          __CFBundleIdentifier: 'com.apple.Terminal',
        },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'apple_terminal', isTested: true })

    expect(
      resolveNewRendererTerminalCaps(
        { TERM: 'alacritty' },
        { platform: 'linux' },
      ),
    ).toEqual({ name: 'alacritty', isTested: true })

    expect(
      resolveNewRendererTerminalCaps(
        { TMUX: '/tmp/tmux-501/default,100,0', TERM: 'tmux-256color' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'tmux', isTested: true })
  })

  test('marks untested terminals and excluded hosts as isTested=false', () => {
    expect(
      resolveNewRendererTerminalCaps(
        { TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'iterm.app', isTested: false })

    expect(
      resolveNewRendererTerminalCaps(
        { CURSOR_TRACE_ID: '1', TERM_PROGRAM: 'vscode' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'cursor', isTested: false })

    expect(
      resolveNewRendererTerminalCaps(
        { WT_SESSION: 'guid-123', TERM: 'xterm-256color' },
        { platform: 'windows' },
      ),
    ).toEqual({ name: 'windows', isTested: false })

    expect(
      resolveNewRendererTerminalCaps(
        { TERM: 'xterm-ghostty' },
        { platform: 'wsl' },
      ),
    ).toEqual({ name: 'windows', isTested: false })

    expect(
      resolveNewRendererTerminalCaps(
        { TERMINAL_EMULATOR: 'JetBrains-JediTerm', TERM: 'xterm-256color' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'jetbrains', isTested: false })

    expect(
      resolveNewRendererTerminalCaps(
        { CLAUDE_BG_BACKEND: 'daemon', TERM: 'xterm-ghostty' },
        { platform: 'linux' },
      ),
    ).toEqual({ name: 'background', isTested: false })

    // Apple Terminal without matching macOS bundle ID fails macApp guard
    expect(
      resolveNewRendererTerminalCaps(
        { TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' },
        { platform: 'macos' },
      ),
    ).toEqual({ name: 'apple_terminal', isTested: false })

    // Alacritty requires TERM starting with 'alacritty'
    expect(
      resolveNewRendererTerminalCaps(
        { TERM_PROGRAM: 'alacritty', TERM: 'xterm-256color' },
        { platform: 'linux' },
      ),
    ).toEqual({ name: 'alacritty', isTested: false })
  })

  test('isNewRendererEnabled honors (!isTmuxCc && caps.isTested), add, remove, and tmux-cc', () => {
    // Empty pebble object `{}` enables tested terminals and rejects untested ones
    expect(
      isNewRendererEnabled({ TERM: 'xterm-ghostty' }, undefined, {
        flagValue: {},
        platform: 'macos',
      }),
    ).toBe(true)

    expect(
      isNewRendererEnabled(
        { TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' },
        undefined,
        { flagValue: {}, platform: 'macos' },
      ),
    ).toBe(false)

    // `remove` blocks even tested terminals
    expect(
      isNewRendererEnabled({ TERM: 'xterm-ghostty' }, undefined, {
        flagValue: { remove: ['ghostty'] },
        platform: 'macos',
      }),
    ).toBe(false)

    // `add` enables untested terminals
    expect(
      isNewRendererEnabled(
        { TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' },
        undefined,
        { flagValue: { add: ['iterm.app'] }, platform: 'macos' },
      ),
    ).toBe(true)

    // tmux -CC (iTerm2 integration): blocked by !isTmuxCc even though tmux is tested
    const tmuxCcEnv = {
      TMUX: '/tmp/tmux-501/default,1,0',
      TERM_PROGRAM: 'iTerm.app',
      TERM: 'xterm-256color',
    }
    expect(
      isNewRendererEnabled(tmuxCcEnv, undefined, {
        flagValue: {},
        platform: 'macos',
      }),
    ).toBe(false)
    expect(
      isNewRendererEnabled(tmuxCcEnv, undefined, {
        flagValue: { add: ['tmux-cc'] },
        platform: 'macos',
      }),
    ).toBe(true)
    expect(
      isNewRendererEnabled(tmuxCcEnv, undefined, {
        flagValue: { add: ['tmux-cc'], remove: ['tmux-cc'] },
        platform: 'macos',
      }),
    ).toBe(false)

    // Malformed flag values return false
    expect(
      isNewRendererEnabled({ TERM: 'xterm-ghostty' }, undefined, {
        flagValue: false,
        platform: 'macos',
      }),
    ).toBe(false)
    expect(
      isNewRendererEnabled({ TERM: 'xterm-ghostty' }, undefined, {
        flagValue: { add: [123] },
        platform: 'macos',
      }),
    ).toBe(false)
  })

  test('CLAUDE_CODE_NEW_RENDERER env override takes precedence over flag', () => {
    expect(
      isNewRendererEnabled(
        { CLAUDE_CODE_NEW_RENDERER: '1', TERM_PROGRAM: 'iTerm.app' },
        undefined,
        { flagValue: false, platform: 'macos' },
      ),
    ).toBe(true)
    expect(
      isNewRendererEnabled(
        { CLAUDE_CODE_NEW_RENDERER: '0', TERM: 'xterm-ghostty' },
        undefined,
        { flagValue: {}, platform: 'macos' },
      ),
    ).toBe(false)
  })
})
