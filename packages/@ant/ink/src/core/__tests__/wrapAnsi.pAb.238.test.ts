/**
 * densable 2.1.238 #14 — DH/pAb: wrap then reattach 256/truecolor SGR across
 * wrap-inserted newlines (close 39/49, reopen opener).
 *
 * Ink wrap-text always passes `{hard: true}` (CMn wrap / wrap-stream / wrap-trim).
 * Bun.wrapAnsi hard-wraps without 39/49; pAb supplies the reopen.
 */
import { describe, expect, test } from 'bun:test'
import { wrapAnsi } from '../wrapAnsi.js'

const HARD = { hard: true as const, trim: false as const }

describe('densable 2.1.238 #14 wrapAnsi DH/pAb', () => {
  test('columns ≤ 0 returns the original string', () => {
    const input = '\x1b[38;2;255;0;0mhello\x1b[0m'
    expect(wrapAnsi(input, 0, HARD)).toBe(input)
    expect(wrapAnsi(input, -1, HARD)).toBe(input)
  })

  test('truecolor wrap that inserts a newline reopens after 39m', () => {
    const input = `\x1b[38;2;255;0;0m${'A'.repeat(20)}\x1b[0m`
    const out = wrapAnsi(input, 8, HARD)
    expect(out.includes('\n')).toBe(true)
    expect(out).toContain('\x1b[39m')
    expect(out).toContain('\x1b[38;2;255;0;0m')
    // densable SId: close then reopen around the wrap newline
    expect(out).toContain('\x1b[39m\n\x1b[38;2;255;0;0m')
  })

  test('256-color wrap that inserts a newline reopens after 39m', () => {
    const input = `\x1b[38;5;196m${'B'.repeat(20)}\x1b[0m`
    const out = wrapAnsi(input, 8, HARD)
    expect(out.includes('\n')).toBe(true)
    expect(out).toContain('\x1b[39m\n\x1b[38;5;196m')
  })

  test('truecolor with no wrap newline is left unchanged by pAb', () => {
    const input = '\x1b[38;2;1;2;3mhi\x1b[0m'
    const out = wrapAnsi(input, 80, HARD)
    expect(out.includes('\n')).toBe(false)
    expect(out).not.toContain('\x1b[39m')
  })

  test('standard 31m FG wrap still hard-wraps (pAb gated on 38/48)', () => {
    const input = `\x1b[31m${'C'.repeat(20)}\x1b[0m`
    const out = wrapAnsi(input, 8, HARD)
    expect(out.includes('\n')).toBe(true)
    expect(out).toContain('\x1b[31m')
  })
})
