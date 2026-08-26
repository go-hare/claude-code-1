/**
 * densable 2.1.239 #38 — OLp/b4v already in tip (realpath prefix on
 * absolute claudeMdExcludes). Changelog restatement; lock the gold.
 */
import { describe, expect, test } from 'bun:test'

describe('densable 2.1.239 #38 claudeMdExcludes symlink (OLp/b4v)', () => {
  test('claudemd.ts has official OLp type gate + b4v realpath expand', async () => {
    const src = await Bun.file(
      new URL('../claudemd.ts', import.meta.url),
    ).text()
    expect(src).toContain(
      "type !== 'User' && type !== 'Project' && type !== 'Local'",
    )
    expect(src).toContain('picomatch.isMatch(normalizedPath, expandedPatterns')
    expect(src).toContain('fs.realpathSync(dirToResolve)')
    expect(src).toContain('normalized.search(/[*?{[]/)')
  })
})
