import { describe, expect, test } from 'bun:test'
import { TerminalImages } from '../terminalImages.js'

describe('densable 2.1.289 Jd kitty registry', () => {
  test('retransmitAll queues live resend; drain joins then clears', () => {
    let frames = 0
    const images = new TerminalImages(() => {
      frames++
    })
    const id = images.allocate(8)
    expect(id).toBe(1)
    expect(images.transmit(id!, () => 'SEQ-A', { resend: true })).toBe(true)
    expect(frames).toBe(1)
    expect(images.drain()).toBe('SEQ-A')
    expect(images.drain()).toBe('')
    images.retransmitAll()
    expect(images.drain()).toBe('SEQ-A')
  })

  test('free of a sent id drains APC delete a=d,d=I', () => {
    const images = new TerminalImages(() => {})
    const id = images.allocate(8)!
    images.transmit(id, () => 'SEQ-A', { resend: true })
    expect(images.drain()).toBe('SEQ-A')
    images.free(id)
    expect(images.drain()).toBe(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`)
    expect(images.size).toBe(0)
  })

  test('takeSmall recycles after free', () => {
    const images = new TerminalImages(() => {})
    const first = images.allocate(8)!
    images.free(first)
    expect(images.takeSmall()).toBe(first)
  })

  test('isBackedUp is true after 8 consumed pending transmits', () => {
    const images = new TerminalImages(() => {})
    const id = images.allocate(8)!
    for (let i = 0; i < 7; i++) {
      expect(images.transmit(id, () => `C${i}`, { resend: false })).toBe(true)
      expect(images.isBackedUp(id)).toBe(false)
    }
    expect(images.transmit(id, () => 'C7', { resend: false })).toBe(true)
    expect(images.isBackedUp(id)).toBe(true)
    expect(images.transmit(id, () => 'C8', { resend: false })).toBe(false)
  })

  test('refused skips OK; otherwise calls allocate onRefused', () => {
    const reasons: string[] = []
    const images = new TerminalImages(() => {})
    const id = images.allocate(8, reason => {
      reasons.push(reason)
    })!
    images.refused(id, 'OK')
    images.refused(id, 'ENOSPC')
    expect(reasons).toEqual(['ENOSPC'])
  })

  test('takeWide ids are >= 256', () => {
    const images = new TerminalImages(() => {})
    const id = images.allocate(24)!
    expect(id).toBeGreaterThanOrEqual(256)
    expect(id).toBeLessThan(16_777_216)
    expect(images.takeWide()).not.toBe(id)
  })

  test('drain splits when a later sequence would exceed 3145728', () => {
    let frames = 0
    const images = new TerminalImages(() => {
      frames++
    })
    const a = images.allocate(8)!
    const b = images.allocate(8)!
    images.transmit(a, () => 'X'.repeat(2_000_000), { resend: true })
    images.transmit(b, () => 'Y'.repeat(2_000_000), { resend: true })
    const first = images.drain()
    expect(first).toBe('X'.repeat(2_000_000))
    expect(frames).toBeGreaterThanOrEqual(3)
    expect(images.drain()).toBe('Y'.repeat(2_000_000))
  })

  test('does not export minify Jd', async () => {
    const src = await Bun.file(
      new URL('../terminalImages.ts', import.meta.url),
    ).text()
    expect(src).toContain('export class TerminalImages')
    expect(src).not.toContain('export class Jd')
    expect(src).not.toContain('export function Jd')
  })
})
