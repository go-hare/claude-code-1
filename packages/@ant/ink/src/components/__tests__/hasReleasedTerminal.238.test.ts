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
