/**
 * densable 2.1.243 dt — linux native only after Xws probe stored a tool.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  _resetLinuxCopyCache,
  _setLinuxCopyToolForTesting,
  getClipboardPath,
} from '../termio/osc.js'

describe('densable dt getClipboardPath 243', () => {
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

  test('linux probed tool → native', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    _setLinuxCopyToolForTesting('wl-copy')
    expect(getClipboardPath()).toBe('native')
  })

  test('linux probed none → osc52', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    _setLinuxCopyToolForTesting(null)
    expect(getClipboardPath()).toBe('osc52')
  })

  test('linux probed none under tmux → tmux-buffer', () => {
    process.env.__CLAUDE_INK_PLATFORM_TEST__ = 'linux'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    _setLinuxCopyToolForTesting(null)
    expect(getClipboardPath()).toBe('tmux-buffer')
  })
})
