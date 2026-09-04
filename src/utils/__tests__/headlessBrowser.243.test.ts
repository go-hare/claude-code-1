import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isHeadlessBrowserEnvironment } from '../browser.js'

describe('densable D / XCb isHeadlessBrowserEnvironment', () => {
  const prev = {
    BROWSER: process.env.BROWSER,
    SSH_CONNECTION: process.env.SSH_CONNECTION,
    DISPLAY: process.env.DISPLAY,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test('no TTY → headless', () => {
    expect(isHeadlessBrowserEnvironment({}, { isTTY: false })).toBe(true)
  })

  test('concrete BROWSER command forces not-headless (before SSH)', () => {
    expect(
      isHeadlessBrowserEnvironment(
        { BROWSER: 'firefox', SSH_CONNECTION: '1 2 3 4' },
        { isTTY: true },
      ),
    ).toBe(false)
  })

  test('BROWSER=true does not force not-headless', () => {
    expect(
      isHeadlessBrowserEnvironment(
        { BROWSER: 'true', SSH_CONNECTION: '1 2 3 4' },
        { isTTY: true },
      ),
    ).toBe(true)
  })

  test('SSH_CONNECTION on a TTY → headless', () => {
    expect(
      isHeadlessBrowserEnvironment(
        { SSH_CONNECTION: '1 2 3 4' },
        { isTTY: true },
      ),
    ).toBe(true)
  })

  test('source-locks densable D body', () => {
    const src = readFileSync(join(import.meta.dir, '../browser.ts'), 'utf8')
    expect(src).toContain('if (!stdout.isTTY) return true')
    expect(src).toContain("env.BROWSER !== 'true'")
    expect(src).toContain('if (env.SSH_CONNECTION) return true')
    expect(src).toContain(
      "getPlatform() === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY",
    )
  })
})
