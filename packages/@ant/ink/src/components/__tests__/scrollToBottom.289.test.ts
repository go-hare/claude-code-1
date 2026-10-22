/**
 * densable 2.1.289 ScrollBox.scrollToBottom — gold SEA @197492324.
 *
 * pendingScrollDelta=void 0; stickyScroll prop false → pin sh-vh via x();
 * else stickyScroll=!0, jR(i), _(), be(Se). No alreadySticky, no sh-vh pin
 * on the sticky path.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../ScrollBox.tsx'), 'utf8')

describe('densable 2.1.289 ScrollBox.scrollToBottom', () => {
  test('gold sticky path is markDirty + notify + forceRender', () => {
    const idx = src.indexOf('scrollToBottom()')
    expect(idx).toBeGreaterThan(0)
    const end = src.indexOf('getScrollTop()', idx)
    expect(end).toBeGreaterThan(idx)
    const slice = src.slice(idx, end)
    expect(slice).not.toMatch(/\balreadySticky\b/)
    expect(slice).toContain('pendingScrollDelta = undefined')
    expect(slice).toContain('stickyScroll === false')
    expect(slice).toContain('scrollMutated(el)')
    const stickyAssign = slice.indexOf('el.stickyScroll = true')
    expect(stickyAssign).toBeGreaterThan(0)
    const stickyPath = slice.slice(stickyAssign)
    expect(stickyPath).toContain('markDirty(el)')
    expect(stickyPath).toContain('notify()')
    expect(stickyPath).toContain('forceRender(')
    expect(stickyPath).not.toContain('scrollTop')
    expect(stickyPath).not.toContain('scheduleRenderFrom')
  })
})
