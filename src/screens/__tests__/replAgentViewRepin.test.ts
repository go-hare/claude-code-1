import { describe, expect, test } from 'bun:test'

/**
 * Structural gate: enter/exit agent transcript must repin ScrollBox.
 * Shared ScrollBox keeps leftover scrollTop/HWM → blank spacer until scroll
 * unless viewingAgentTaskId change calls repinScroll (same as permission overlay).
 */
describe('REPL agent-view transcript swap repin', () => {
  test('source: viewingAgentTaskId change → repinScroll in useLayoutEffect', async () => {
    const src = await Bun.file(
      new URL('../REPL.tsx', import.meta.url).pathname,
    ).text()

    const idx = src.indexOf('Transcript swap (enter/exit agent view)')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 700)
    expect(slice).toMatch(/prevViewingAgentRef/)
    expect(slice).toMatch(/useLayoutEffect\s*\(/)
    expect(slice).toMatch(/viewingAgentTaskId/)
    expect(slice).toMatch(/repinScroll\s*\(\s*\)/)
    expect(slice).toMatch(/\[viewingAgentTaskId,\s*repinScroll\]/)
  })
})
