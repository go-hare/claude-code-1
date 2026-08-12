/**
 * densable 2.1.224 residual — getClipboardPath must match L3u multi-host native.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { _resetLinuxCopyCache, getClipboardPath } from '../termio/osc.js'

describe('densable getClipboardPath ↔ L3u host', () => {
  const prevSsh = process.env.SSH_CONNECTION
  const prevTmux = process.env.TMUX

  beforeEach(() => {
    _resetLinuxCopyCache()
    delete process.env.SSH_CONNECTION
    delete process.env.TMUX
  })

  afterEach(() => {
    _resetLinuxCopyCache()
    delete process.env.__CLAUDE_INK_PLATFORM_TEST__
    if (prevSsh === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = prevSsh
    if (prevTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = prevTmux
  })

  test('macos/windows/wsl/linux local → native (not darwin-only)', () => {
    for (const host of ['macos', 'windows', 'wsl', 'linux'] as const) {
      process.env.__CLAUDE_INK_PLATFORM_TEST__ = host
      expect(getClipboardPath()).toBe('native')
    }
  })

  test('unknown host local without tmux → osc52', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'unknown'
    expect(getClipboardPath()).toBe('osc52')
  })

  test('unknown host local with tmux → tmux-buffer', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'unknown'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    expect(getClipboardPath()).toBe('tmux-buffer')
  })

  test('SSH skips native even on linux; tmux → tmux-buffer', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    process.env.SSH_CONNECTION = '1 2 3 4'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    expect(getClipboardPath()).toBe('tmux-buffer')
  })

  test('SSH without tmux → osc52', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'windows'
    process.env.SSH_CONNECTION = '1 2 3 4'
    expect(getClipboardPath()).toBe('osc52')
  })

  test('local linux under tmux still native (L3u fires first)', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    expect(getClipboardPath()).toBe('native')
  })
})
