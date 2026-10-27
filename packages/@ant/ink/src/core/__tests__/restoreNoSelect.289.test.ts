/**
 * densable 2.1.289 Output.get restoreNoSelect (pg after writes).
 * Gold skip-blit: blit(..., {restoreNoSelect: n.style.opaque})
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Output from '../output.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'

function makeOutput(width: number, height: number) {
  const stylePool = new StylePool()
  const screen = createScreen(
    width,
    height,
    stylePool,
    new CharPool(),
    new HyperlinkPool(),
  )
  return {
    out: new Output({ width, height, stylePool, screen }),
    screen,
    stylePool,
  }
}

describe('restoreNoSelect gold pg after writes', () => {
  test('opaque blit restores noSelect after a later write stomps the row', () => {
    const srcPack = makeOutput(4, 2)
    srcPack.screen.noSelect.fill(1)
    const { out, screen } = makeOutput(4, 2)
    out.blit(srcPack.screen, 0, 0, 4, 2, { restoreNoSelect: true })
    out.write(0, 0, 'xxxx')
    const got = out.get()
    expect(got).toBe(screen)
    expect([...got.noSelect.subarray(0, 4)]).toEqual([1, 1, 1, 1])
  })

  test('later blit zeros noSelect; opaque restore copies src fence back', () => {
    const fenced = makeOutput(4, 2)
    fenced.screen.noSelect.fill(1)
    const empty = makeOutput(4, 2)
    const { out } = makeOutput(4, 2)
    out.blit(fenced.screen, 0, 0, 4, 2, { restoreNoSelect: true })
    out.blit(empty.screen, 0, 0, 4, 2)
    const got = out.get()
    expect([...got.noSelect.subarray(0, 4)]).toEqual([1, 1, 1, 1])
  })

  test('later blit zeros noSelect; non-opaque blit does not restore', () => {
    const fenced = makeOutput(4, 2)
    fenced.screen.noSelect.fill(1)
    const later = makeOutput(4, 2)
    later.screen.cells64.fill(1n)
    later.screen.noSelect.fill(0)
    const { out } = makeOutput(4, 2)
    out.blit(fenced.screen, 0, 0, 4, 2)
    out.blit(later.screen, 0, 0, 4, 2)
    const got = out.get()
    expect([...got.noSelect.subarray(0, 4)]).toEqual([0, 0, 0, 0])
  })

  test('skip-blit and escaping abs pass restoreNoSelect: opaque', () => {
    const render = readFileSync(
      join(import.meta.dir, '../render-node-to-output.ts'),
      'utf8',
    )
    expect(render).toContain('restoreNoSelect: node.style.opaque')
    expect(render).toContain('restoreNoSelect: cur.style.opaque')
    expect(render).toContain('function leftoverGsSkipBlitOverlay')
    expect(render).toContain('leftoverGsStampUnpainted')
    expect(render).toContain('leftoverGsDropCachedLayout')
    expect(render).toContain('leftoverGsAbsChildMoved')
    expect(render).toContain('leftoverGsEscapingDirtyPoisons')
    expect(render).toContain('leftoverGsFollowDelta')
    expect(render).toContain('node.scrollTopRendered = scrollTop')
    const output = readFileSync(join(import.meta.dir, '../output.ts'), 'utf8')
    expect(output).toContain('restoreNoSelectRegion')
    expect(output).toContain('operation.restoreNoSelect')
    expect(output).toContain('clearNoSelect')
    expect(output).toContain('opIndex: i')
    expect(output).toContain('c.opIndex > opIndex')
  })
})
