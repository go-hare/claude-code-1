import { describe, expect, test } from 'bun:test'
import {
  computeFastStructuredPatch,
  getFastPatchFromContents,
} from '../utils.js'

describe('FileEdit/Write fast Myers diff (#1228)', () => {
  test('diffs thousands of changed lines quickly without timing out or returning empty', () => {
    const lineCount = 5000
    const oldLines = Array.from(
      { length: lineCount },
      (_, i) => `const item_${i} = ${i};`,
    )
    const newLines = oldLines.map((line, i) =>
      i % 2 === 0 ? `const item_${i} = ${i * 10 + 1};` : line,
    )
    const oldContent = oldLines.join('\n') + '\n'
    const newContent = newLines.join('\n') + '\n'

    const start = performance.now()
    const hunks = getFastPatchFromContents({
      oldContent,
      newContent,
      convertTabs: true,
    })
    const elapsedMs = performance.now() - start

    expect(elapsedMs).toBeLessThan(1000)
    expect(hunks.length).toBeGreaterThan(0)
    const added = hunks.reduce(
      (sum, h) => sum + h.lines.filter(l => l.startsWith('+')).length,
      0,
    )
    const removed = hunks.reduce(
      (sum, h) => sum + h.lines.filter(l => l.startsWith('-')).length,
      0,
    )
    expect(added).toBe(2500)
    expect(removed).toBe(2500)
  })

  test('disjoint replacement handles thousands of lines via disjoint-block shortcut', () => {
    const oldContent = Array.from({ length: 3000 }, (_, i) => `old_${i}`).join(
      '\n',
    )
    const newContent = Array.from({ length: 3000 }, (_, i) => `new_${i}`).join(
      '\n',
    )

    const hunks = computeFastStructuredPatch(oldContent, newContent)
    expect(hunks).toBeDefined()
    expect(hunks!.length).toBe(1)
    expect(hunks![0]!.oldLines).toBe(3000)
    expect(hunks![0]!.newLines).toBe(3000)
  })
})
