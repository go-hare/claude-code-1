import { describe, expect, test } from 'bun:test'
import { FileIndex } from '../index.js'

describe('FileIndex 2.1.289 alignment (buildGen + basename index)', () => {
  test('concurrent loadFromFileListAsync cancels superseded build and returns false', async () => {
    const idx = new FileIndex()
    // Build a list large enough to yield across CHUNK_MS (4ms)
    const firstList = Array.from(
      { length: 60_000 },
      (_, i) => `old/dir-${i % 100}/legacy-item-${i}.ts`,
    )
    const secondList = ['new/target/activeFile.ts', 'new/target/other.ts']

    const first = idx.loadFromFileListAsync(firstList)
    const second = idx.loadFromFileListAsync(secondList)

    const [firstDone, secondDone] = await Promise.all([first.done, second.done])
    await Promise.all([first.queryable, second.queryable])

    expect(firstDone).toBe(false)
    expect(secondDone).toBe(true)

    const results = idx.search('activeFile', 5)
    expect(results.map(r => r.path)).toEqual(['new/target/activeFile.ts'])
    expect(idx.search('legacy-item', 5)).toEqual([])
  })

  test('basename index boosts exact filename matches over scattered path matches', () => {
    const idx = new FileIndex()
    idx.loadFromFileList([
      'app/foo/bar/baz/unrelated.ts',
      'src/deep/nested/folder/foo.ts',
    ])

    const results = idx.search('foo', 5)
    expect(results.length).toBe(2)
    expect(results[0]!.path).toBe('src/deep/nested/folder/foo.ts')
  })
})
