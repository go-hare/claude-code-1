import { afterEach, describe, expect, mock, test } from 'bun:test'

import {
  applyTerminalTitle,
  clearTerminalTitle,
  resetWin32TitleIconFamilyForTests,
} from '../use-terminal-title.js'

describe('applyTerminalTitle (densable)', () => {
  const originalTitle = process.title
  const originalPlatform = process.platform
  const originalTitleDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'title',
  )

  afterEach(() => {
    if (originalTitleDescriptor) {
      Object.defineProperty(process, 'title', originalTitleDescriptor)
    } else {
      process.title = originalTitle
    }
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
    resetWin32TitleIconFamilyForTests()
  })

  test('win32 sets process.title only (no OSC)', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    const writeRaw = mock(() => {})
    applyTerminalTitle('◐ Claude Code', writeRaw)
    expect(process.title).toBe('◐ Claude Code')
    expect(writeRaw).not.toHaveBeenCalled()
  })

  test('win32 idle→busy delayed plain-poke then full title (unstick ✳)', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    const titles: string[] = []
    Object.defineProperty(process, 'title', {
      configurable: true,
      get: () => titles.at(-1) ?? '',
      set: (value: string) => {
        titles.push(value)
      },
    })

    applyTerminalTitle('✳ Claude Code', null)
    titles.length = 0
    applyTerminalTitle('◐ Claude Code', null)
    expect(titles).toEqual(['Claude Code'])
    await Bun.sleep(50)
    expect(titles).toEqual(['Claude Code', '◐ Claude Code'])
  })

  test('win32 ◐→◑ does not plain-poke (same busy family)', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    const titles: string[] = []
    Object.defineProperty(process, 'title', {
      configurable: true,
      get: () => titles.at(-1) ?? '',
      set: (value: string) => {
        titles.push(value)
      },
    })

    applyTerminalTitle('◐ Claude Code', null)
    titles.length = 0
    applyTerminalTitle('◑ Claude Code', null)

    expect(titles).toEqual(['◑ Claude Code'])
  })

  test('win32 busy→idle delayed plain-poke then ✳', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    const titles: string[] = []
    Object.defineProperty(process, 'title', {
      configurable: true,
      get: () => titles.at(-1) ?? '',
      set: (value: string) => {
        titles.push(value)
      },
    })

    applyTerminalTitle('◐ Claude Code', null)
    titles.length = 0
    applyTerminalTitle('✳ Claude Code', null)
    expect(titles).toEqual(['Claude Code'])
    await Bun.sleep(50)
    expect(titles).toEqual(['Claude Code', '✳ Claude Code'])
  })

  test('posix emits OSC 0 without requiring process.title', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    const before = process.title
    const writeRaw = mock(() => {})
    applyTerminalTitle('✳ Claude Code', writeRaw)
    expect(process.title).toBe(before)
    expect(writeRaw).toHaveBeenCalledTimes(1)
    expect(writeRaw.mock.calls[0]?.[0]).toBe('\x1b]0;✳ Claude Code\x07')
  })

  test('win32 still sets process.title when writeRaw is null', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    applyTerminalTitle('claude', null)
    expect(process.title).toBe('claude')
  })
})

describe('clearTerminalTitle (densable)', () => {
  const originalTitle = process.title
  const originalPlatform = process.platform

  afterEach(() => {
    process.title = originalTitle
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
    resetWin32TitleIconFamilyForTests()
  })

  test('win32 clears process.title only (no OSC)', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    process.title = 'Claude Code'
    const writeRaw = mock(() => {})
    clearTerminalTitle(writeRaw)
    expect(process.title === '' || process.title === 'bun').toBe(true)
    expect(writeRaw).not.toHaveBeenCalled()
  })

  test('posix emits CLEAR_TERMINAL_TITLE (OSC 0 empty + BEL)', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    const writeRaw = mock(() => {})
    clearTerminalTitle(writeRaw)
    expect(writeRaw).toHaveBeenCalledTimes(1)
    expect(writeRaw.mock.calls[0]?.[0]).toBe('\x1b]0;\x07')
  })
})
