import { describe, expect, test } from 'bun:test'

/**
 * densable OJh: wheel-down / jump past max → scrollToBottom iff autoScrollEnabled,
 * else scrollTo(max). case 'bottom' stays scrollToBottom (SEA fJw).
 */
describe('ScrollKeybindingHandler OJh (autoScrollEnabled)', () => {
  test('source: scrollDown past max uses getAutoScrollEnabled / OJh', async () => {
    const src = await Bun.file(
      new URL('../ScrollKeybindingHandler.tsx', import.meta.url).pathname,
    ).text()
    const idx = src.indexOf('function scrollDown')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 900)
    expect(slice).toMatch(/getAutoScrollEnabled\(\)/)
    expect(slice).toMatch(/scrollToBottom\(\)/)
    expect(slice).toMatch(/scrollTo\(max\)/)
  })

  test('source: jumpBy max branch uses OJh; case bottom always scrollToBottom', async () => {
    const src = await Bun.file(
      new URL('../ScrollKeybindingHandler.tsx', import.meta.url).pathname,
    ).text()
    const jumpIdx = src.indexOf('export function jumpBy')
    expect(jumpIdx).toBeGreaterThan(0)
    const jumpSlice = src.slice(jumpIdx, jumpIdx + 900)
    expect(jumpSlice).toMatch(/getAutoScrollEnabled\(\)/)
    expect(jumpSlice).toMatch(/scrollToBottom\(\)/)

    const bottomIdx = src.indexOf("case 'bottom'")
    expect(bottomIdx).toBeGreaterThan(0)
    const bottomSlice = src.slice(bottomIdx, bottomIdx + 500)
    expect(bottomSlice).toMatch(/scrollToBottom\(\)/)
    expect(bottomSlice).not.toMatch(/getAutoScrollEnabled/)
  })
})
