/**
 * densable tot `$l` / `useMeasured` — gold `$l(o)` is
 * `Pt(subscribeLayout, o)` then `Xt(() => { if (!Object.is(o(), l)) u() })`.
 * tot `$l(qe)` is `$e` height. ozs hide also `$l`s ScrollBox yoga height so
 * peek → remainder schedules the second commit gold `$l` uses when `$e`
 * height actually changes.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LAYOUT = join(import.meta.dir, '../FullscreenLayout.tsx')

describe('densable tot $l / useMeasured (289)', () => {
  test('source: $l BODY + tot $e + ScrollBox yoga snapshot', () => {
    const src = readFileSync(LAYOUT, 'utf8')
    expect(src).toContain('function useMeasured(read: () => number): number')
    expect(src).toContain('useSyncExternalStore(subscribeLayout, read, read)')
    expect(src).toContain('if (!Object.is(read(), snapshot)) bump()')
    expect(src).toContain('function useYogaHeight')
    expect(src).toContain('return useMeasured(read)')
    expect(src).toContain(
      'const abovePromptHeight = useYogaHeight(abovePromptRef)',
    )
    expect(src).toContain('readScrollBoxYogaHeight')
    expect(src).toContain(
      'scrollRef?.current?.getDomElement()?.yogaNode?.getComputedHeight() ?? 0',
    )
    expect(src).toContain('void useMeasured(readScrollBoxYogaHeight)')
    expect(src).not.toContain('export function $l')
    expect(src).not.toContain('needsViewportWake')
  })
})
