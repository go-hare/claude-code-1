import { describe, expect, test } from 'bun:test'
import { backgroundSessionVerbIndex, hasBackgroundFlag } from '../bg.js'

describe('2.1.299 #674/#675 --bg / --background flag parsing', () => {
  test('#674 ignores --bg and --background after -- (e.g. claude mcp add ... -- cmd --background)', () => {
    expect(
      hasBackgroundFlag(['mcp', 'add', 'srv', '--', 'cmd', '--background']),
    ).toBe(false)
    expect(hasBackgroundFlag(['--', '--bg'])).toBe(false)
    expect(hasBackgroundFlag(['-p', '--', '--background'])).toBe(false)
  })

  test('#675 ignores --bg / --background when consumed as an option value', () => {
    expect(hasBackgroundFlag(['--name', '--bg', 'hello'])).toBe(false)
    expect(hasBackgroundFlag(['-n', '--background'])).toBe(false)
    expect(hasBackgroundFlag(['-m', '--bg'])).toBe(false)
  })

  test('detects --bg / --background when present as a root flag before --', () => {
    expect(hasBackgroundFlag(['--bg', 'fix tests'])).toBe(true)
    expect(
      hasBackgroundFlag(['--model', 'opus', '--background', '--', 'x']),
    ).toBe(true)
  })

  test('#675 backgroundSessionVerbIndex respects behindRootOptions=false in bg sessions', () => {
    expect(
      backgroundSessionVerbIndex(['--verbose', 'logs', 'abcdef12'], {
        behindRootOptions: true,
      }),
    ).toBe(1)
    expect(
      backgroundSessionVerbIndex(['--verbose', 'logs', 'abcdef12'], {
        behindRootOptions: false,
      }),
    ).toBe(-1)
    expect(
      backgroundSessionVerbIndex(['logs', 'abcdef12'], {
        behindRootOptions: false,
      }),
    ).toBe(0)
  })
})
