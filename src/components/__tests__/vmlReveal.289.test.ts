/**
 * densable adversarial: VML transcript.reveal concurrency + height===0 +
 * paint tick must not thrash every React render.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 VML reveal host', () => {
  test('reveal releases prior pending; height===0 skips scrollToElement; rAF tick', () => {
    const src = readFileSync(
      join(import.meta.dir, '../VirtualMessageList.tsx'),
      'utf8',
    )
    expect(src).toContain('releaseReveal()')
    expect(src).toContain('setRevealEpoch')
    expect(src).toContain('requestAnimationFrame(loop)')
    expect(src).toContain('// height===0: wait for layout')
    expect(src).not.toMatch(/if \(height === 0\) \{\s*scroll\.scrollToElement/)
    // Must not keep bare useEffect(() => { tickReveal }) with no deps.
    expect(src).not.toMatch(
      /useEffect\(\(\) => \{\s*if \(revealPendingRef\.current\) tickReveal\(true\);\s*\}\);/,
    )
  })
})
