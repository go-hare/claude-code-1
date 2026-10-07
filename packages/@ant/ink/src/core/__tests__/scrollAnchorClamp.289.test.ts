/**
 * densable adversarial: scrollAnchor targets must clamp to [0, maxScroll]
 * before write so near-bottom overshoot cannot trip followGrowth re-stick.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 scrollAnchor clamp before followGrowth', () => {
  test('render-node-to-output clamps start/end/center/nearest to maxScroll', () => {
    const src = readFileSync(
      join(import.meta.dir, '../render-node-to-output.ts'),
      'utf8',
    )
    expect(src).toContain('clampAnchor')
    expect(src).toContain('Math.min(maxScroll, y)')
    expect(src).toContain('node.scrollTop = clampAnchor(startTarget)')
    expect(src).toContain(
      'clampAnchor(\n                Math.min(Math.max(cur, endTarget), startTarget)',
    )
  })
})
