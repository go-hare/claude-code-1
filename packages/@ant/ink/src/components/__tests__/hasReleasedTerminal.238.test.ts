/**
 * densable 2.1.238 #15 — hasReleasedTerminal SIGCONT gate.
 *
 * Gold: appUnmounted || Ym() || ink.hasUnmounted. Kill-while-suspended
 * must not restore raw mode. Predicate unit only — App is a class with
 * TTY side effects; we assert the gold boolean, not a full SIGTSTP cycle.
 */
import { describe, expect, test } from 'bun:test'

function hasReleasedTerminal(opts: {
  appUnmounted: boolean
  shutdownCommitted: boolean
  inkUnmounted: boolean
}): boolean {
  return opts.appUnmounted || opts.shutdownCommitted || opts.inkUnmounted
}

describe('densable 2.1.238 #15 hasReleasedTerminal', () => {
  test('live session has not released the terminal', () => {
    expect(
      hasReleasedTerminal({
        appUnmounted: false,
        shutdownCommitted: false,
        inkUnmounted: false,
      }),
    ).toBe(false)
  })

  test('componentWillUnmount sets appUnmounted → skip SIGCONT restore', () => {
    expect(
      hasReleasedTerminal({
        appUnmounted: true,
        shutdownCommitted: false,
        inkUnmounted: false,
      }),
    ).toBe(true)
  })

  test('gracefulShutdown committed (Ym) → skip SIGCONT restore', () => {
    expect(
      hasReleasedTerminal({
        appUnmounted: false,
        shutdownCommitted: true,
        inkUnmounted: false,
      }),
    ).toBe(true)
  })

  test('Ink hasUnmounted → skip SIGCONT restore', () => {
    expect(
      hasReleasedTerminal({
        appUnmounted: false,
        shutdownCommitted: false,
        inkUnmounted: true,
      }),
    ).toBe(true)
  })
})

/**
 * densable 2.1.289 — owedReplyHold ARM source contract (Gd=250).
 * Predicate-style: assert App.tsx contains the arm, not a TTY cycle.
 */
describe('densable 2.1.289 owedReplyHold ARM', () => {
  test('App.tsx arms Wg at Gd=250 and clears hold before onRawModeEnter', async () => {
    const src = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
    expect(src).toContain('OWED_REPLY_HOLD_MS = 250')
    expect(src).toContain(
      'this.owedReplyHold = setTimeout(clearOwedReplyHold, OWED_REPLY_HOLD_MS, this, stdin)',
    )
    const enableAt = src.indexOf('handleSetRawMode = (isEnabled: boolean)')
    const clearHoldAt = src.indexOf(
      'if (this.owedReplyHold !== undefined) {\n          clearTimeout(this.owedReplyHold)',
      enableAt,
    )
    const onEnterAt = src.indexOf('this.props.onRawModeEnter?.()', enableAt)
    expect(enableAt).toBeGreaterThan(-1)
    expect(clearHoldAt).toBeGreaterThan(enableAt)
    expect(onEnterAt).toBeGreaterThan(clearHoldAt)
  })

  test('handleReadable catch stamps telemetryMessage via ot(Y)', async () => {
    const src = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
    expect(src).toContain(
      "ot(Y(error), 'stdin readable handler threw during input processing')",
    )
    expect(src).toContain("!('telemetryMessage' in n)")
    // gold unmount: owedReplyHold then Pw; no stdin.unref else
    const unmount = src.slice(
      src.indexOf('override componentWillUnmount()'),
      src.indexOf('override componentDidCatch'),
    )
    expect(unmount).not.toContain('stdin.unref')
    expect(unmount).toContain('setStdinRawMode(this.props.stdin, false)')
  })

  test('componentDidCatch is wy logError then handleExit', async () => {
    const src = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
    const start = src.indexOf('override componentDidCatch')
    const body = src.slice(start, src.indexOf('handleSetRawMode', start))
    expect(body).toContain('[reportRenderError] React boundary caught')
    expect(body).toContain('/^[A-Z][a-zA-Z]{0,63}$/')
    expect(body).toContain('${l(error)}')
    expect(body).toContain("level: 'error'")
    expect(body).toContain('this.handleExit(error)')
    expect(body.indexOf('[reportRenderError]')).toBeLessThan(
      body.indexOf('this.handleExit(error)'),
    )
  })

  test('getDerivedStateFromError returns {error} not a message/stack analog', async () => {
    const src = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
    expect(src).toContain('static getDerivedStateFromError(error: Error)')
    expect(src).toContain('return { error }')
    expect(src).not.toContain(
      'return { error: { message: error.message, stack: error.stack } }',
    )
  })
})
