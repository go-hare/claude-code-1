import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PANES = readFileSync(
  join(import.meta.dir, '../PluginRasterPanes.tsx'),
  'utf8',
)

/**
 * densable 2.1.289 t7t: the UserMessage site box takes `ref:u` (stable).
 * React 19 hands `ref` to commitUpdate as a plain prop, so an inline arrow
 * re-dirties the row every commit. Scrolled above the viewport it is never
 * repainted, stays dirty+uncached, and its full height leaks into the
 * ScrollBox cumHeightShift — a sibling collapse then nets to 0 and the last
 * row (`✻ … · done`) is culled with a stale cached top.
 */
describe('PluginUserMessageSite card ref', () => {
  const start = PANES.indexOf('export function PluginUserMessageSite(')
  const body = PANES.slice(start, PANES.indexOf('\nexport ', start + 1))

  test('card Box ref is a memoized callback, not an inline arrow', () => {
    expect(start).toBeGreaterThan(0)
    expect(body).toMatch(/const setCardRef = useCallback\(/)
    expect(body).toMatch(/ref=\{setCardRef\}/)
    expect(body).not.toMatch(/ref=\{\(?node\)? =>/)
  })
})
