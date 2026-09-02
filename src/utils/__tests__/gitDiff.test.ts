import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  foldEmptyRepoWorkingTreeStats,
  hunkRefForDiff,
  isPreSessionStat,
  nextHunksOnVFf,
  parseGitDiff,
  parseGitNumstat,
  parseShortstat,
  type PerFileStats,
} from '../gitDiff'

describe('parseGitNumstat', () => {
  test('parses single file', () => {
    const result = parseGitNumstat('5\t3\tsrc/foo.ts')
    expect(result.stats).toEqual({
      filesCount: 1,
      linesAdded: 5,
      linesRemoved: 3,
    })
    expect(result.perFileStats.get('src/foo.ts')).toEqual({
      added: 5,
      removed: 3,
      isBinary: false,
    })
  })

  test('parses multiple files', () => {
    const input = '10\t2\ta.ts\n3\t0\tb.ts\n0\t7\tc.ts'
    const result = parseGitNumstat(input)
    expect(result.stats).toEqual({
      filesCount: 3,
      linesAdded: 13,
      linesRemoved: 9,
    })
    expect(result.perFileStats.size).toBe(3)
  })

  test('handles binary file with dash counts', () => {
    const result = parseGitNumstat('-\t-\timage.png')
    expect(result.perFileStats.get('image.png')).toEqual({
      added: 0,
      removed: 0,
      isBinary: true,
    })
  })

  test('handles rename format', () => {
    const result = parseGitNumstat('1\t0\told.txt => new.txt')
    const entry = result.perFileStats.get('old.txt => new.txt')
    expect(entry).not.toBeUndefined()
    expect(entry!.added).toBe(1)
    expect(entry!.isBinary).toBe(false)
  })

  test('handles filename with tabs', () => {
    const result = parseGitNumstat('1\t0\t"tab\tfile.txt"')
    // parts.slice(2).join('\t') preserves the rest
    expect(result.stats.filesCount).toBe(1)
  })

  test('returns empty for empty string', () => {
    const result = parseGitNumstat('')
    expect(result.stats).toEqual({
      filesCount: 0,
      linesAdded: 0,
      linesRemoved: 0,
    })
    expect(result.perFileStats.size).toBe(0)
  })

  test('skips lines with fewer than 3 tab-separated parts', () => {
    const result = parseGitNumstat('invalid-line\n5\t3\tsrc/foo.ts')
    expect(result.stats.filesCount).toBe(1)
  })

  test('handles zero additions and zero deletions', () => {
    const result = parseGitNumstat('0\t0\tempty-change.ts')
    expect(result.perFileStats.get('empty-change.ts')).toEqual({
      added: 0,
      removed: 0,
      isBinary: false,
    })
  })
})

describe('parseGitDiff', () => {
  test('parses single file with one hunk', () => {
    const input = [
      'diff --git a/foo.ts b/foo.ts',
      'index abc..def 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '+added',
      ' line2',
      ' line3',
    ].join('\n')

    const result = parseGitDiff(input)
    expect(result.hunks.size).toBe(1)
    expect(result.skippedLarge.size).toBe(0)
    const hunks = result.hunks.get('foo.ts')!
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldLines).toBe(3)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(4)
    expect(hunks[0].lines).toEqual([' line1', '+added', ' line2', ' line3'])
  })

  test('parses multiple hunks in one file', () => {
    const input = [
      'diff --git a/bar.ts b/bar.ts',
      'index abc..def 100644',
      '--- a/bar.ts',
      '+++ b/bar.ts',
      '@@ -1,2 +1,3 @@',
      ' a',
      '+b',
      ' c',
      '@@ -10,2 +11,2 @@',
      ' d',
      '-e',
      '+f',
    ].join('\n')

    const result = parseGitDiff(input)
    const hunks = result.hunks.get('bar.ts')!
    expect(hunks).toHaveLength(2)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[1].oldStart).toBe(10)
  })

  test('skips binary files marker', () => {
    const input = [
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
    ].join('\n')

    const result = parseGitDiff(input)
    // Binary file has no hunks, so it's not in the result
    expect(result.hunks.size).toBe(0)
    expect(result.skippedLarge.size).toBe(0)
  })

  test('parses new file mode', () => {
    const input = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+line1',
      '+line2',
    ].join('\n')

    const result = parseGitDiff(input)
    const hunks = result.hunks.get('new.ts')!
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines).toEqual(['+line1', '+line2'])
  })

  test('parses deleted file', () => {
    const input = [
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line1',
      '-line2',
    ].join('\n')

    const result = parseGitDiff(input)
    const hunks = result.hunks.get('old.ts')!
    expect(hunks).toHaveLength(1)
  })

  test('returns empty hunks and skippedLarge for empty input', () => {
    const result = parseGitDiff('')
    expect(result.hunks.size).toBe(0)
    expect(result.skippedLarge.size).toBe(0)
  })

  test('handles multiple files', () => {
    const input = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n')

    const result = parseGitDiff(input)
    expect(result.hunks.size).toBe(2)
    expect(result.hunks.has('a.ts')).toBe(true)
    expect(result.hunks.has('b.ts')).toBe(true)
  })

  test('skips hunk without comma (single line)', () => {
    const input = [
      'diff --git a/solo.ts b/solo.ts',
      '--- a/solo.ts',
      '+++ b/solo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const result = parseGitDiff(input)
    const hunks = result.hunks.get('solo.ts')!
    expect(hunks[0].oldLines).toBe(1) // default when no comma
    expect(hunks[0].newLines).toBe(1)
  })
})

describe('parseShortstat', () => {
  test('parses full shortstat with insertions and deletions', () => {
    const result = parseShortstat(
      ' 3 files changed, 10 insertions(+), 5 deletions(-)',
    )
    expect(result).toEqual({
      filesCount: 3,
      linesAdded: 10,
      linesRemoved: 5,
    })
  })

  test('parses single file', () => {
    const result = parseShortstat(
      ' 1 file changed, 2 insertions(+), 1 deletion(-)',
    )
    expect(result).toEqual({
      filesCount: 1,
      linesAdded: 2,
      linesRemoved: 1,
    })
  })

  test('parses insertions only', () => {
    const result = parseShortstat(' 2 files changed, 5 insertions(+)')
    expect(result).toEqual({
      filesCount: 2,
      linesAdded: 5,
      linesRemoved: 0,
    })
  })

  test('parses deletions only', () => {
    const result = parseShortstat(' 1 file changed, 3 deletions(-)')
    expect(result).toEqual({
      filesCount: 1,
      linesAdded: 0,
      linesRemoved: 3,
    })
  })

  test('parses files changed only (no insertions or deletions)', () => {
    const result = parseShortstat(' 2 files changed')
    expect(result).toEqual({
      filesCount: 2,
      linesAdded: 0,
      linesRemoved: 0,
    })
  })

  test('returns null for empty string', () => {
    expect(parseShortstat('')).toBeNull()
  })

  test('returns null for non-matching string', () => {
    expect(parseShortstat('nothing to see here')).toBeNull()
  })

  test('handles large numbers', () => {
    const result = parseShortstat(
      ' 100 files changed, 50000 insertions(+), 30000 deletions(-)',
    )
    expect(result).toEqual({
      filesCount: 100,
      linesAdded: 50000,
      linesRemoved: 30000,
    })
  })

  test('handles zero insertions and deletions explicitly', () => {
    // git can output "0 insertions(+), 0 deletions(-)"
    const result = parseShortstat(
      ' 1 file changed, 0 insertions(+), 0 deletions(-)',
    )
    expect(result).toEqual({
      filesCount: 1,
      linesAdded: 0,
      linesRemoved: 0,
    })
  })
})

describe('densable PPi CJn hunk ref', () => {
  test('working-tree uses HEAD; noCommits uses --cached; branch uses baseRef', () => {
    const empty = {
      stats: { filesCount: 0, linesAdded: 0, linesRemoved: 0 },
      perFileStats: new Map(),
      hunks: new Map(),
    }
    expect(hunkRefForDiff({ ...empty, source: { kind: 'working-tree' } })).toBe(
      'HEAD',
    )
    expect(
      hunkRefForDiff({
        ...empty,
        source: { kind: 'working-tree' },
        noCommits: true,
      }),
    ).toBe('--cached')
    expect(
      hunkRefForDiff({
        ...empty,
        source: { kind: 'branch', baseBranch: 'main', baseRef: 'abc123' },
      }),
    ).toBe('abc123')
  })

  test('VFf null keeps hunks when CJn matches, else empty', () => {
    const result = {
      stats: { filesCount: 0, linesAdded: 0, linesRemoved: 0 },
      perFileStats: new Map(),
      hunks: new Map(),
      source: { kind: 'working-tree' as const },
    }
    const kept = {
      hunks: new Map([['a.ts', []]]),
      skippedLarge: new Set<string>(),
    }
    expect(nextHunksOnVFf(null, { result, hunks: kept }, 'HEAD')).toBe(kept)
    expect(
      nextHunksOnVFf(null, { result, hunks: kept }, '--cached').hunks.size,
    ).toBe(0)
    const fresh = {
      hunks: new Map([['b.ts', []]]),
      skippedLarge: new Set<string>(),
    }
    expect(nextHunksOnVFf(fresh, { result, hunks: kept }, 'HEAD')).toBe(fresh)
  })
})

describe('densable _zS / AzS preSession', () => {
  test('isPreSessionStat is max(mtime,ctime) < GZt', () => {
    expect(isPreSessionStat(10, 20, 30)).toBe(true)
    expect(isPreSessionStat(40, 10, 30)).toBe(false)
    expect(isPreSessionStat(30, 30, 30)).toBe(false)
  })

  test('bzS folds unstaged numstat into Sil cached rows', () => {
    const staged: {
      stats: { filesCount: number; linesAdded: number; linesRemoved: number }
      perFileStats: Map<string, PerFileStats>
    } = {
      stats: { filesCount: 2, linesAdded: 4, linesRemoved: 1 },
      perFileStats: new Map([
        ['a.ts', { added: 4, removed: 1, isBinary: false }],
        ['b.ts', { added: 0, removed: 0, isBinary: false }],
      ]),
    }
    foldEmptyRepoWorkingTreeStats(staged, {
      perFileStats: new Map([
        ['a.ts', { added: 3, removed: 2, isBinary: false }],
        ['c.ts', { added: 9, removed: 0, isBinary: false }],
      ]),
    })
    expect(staged.stats).toEqual({
      filesCount: 2,
      linesAdded: 5,
      linesRemoved: 1,
    })
    expect(staged.perFileStats.get('a.ts')).toEqual({
      added: 5,
      removed: 0,
      isBinary: false,
      isUntracked: false,
    })
    expect(staged.perFileStats.get('b.ts')).toEqual({
      added: 0,
      removed: 0,
      isBinary: false,
    })
    expect(staged.perFileStats.has('c.ts')).toBe(false)
  })

  test('bzS binary either side zeros added', () => {
    const staged: {
      stats: { filesCount: number; linesAdded: number; linesRemoved: number }
      perFileStats: Map<string, PerFileStats>
    } = {
      stats: { filesCount: 1, linesAdded: 2, linesRemoved: 0 },
      perFileStats: new Map([
        ['a.bin', { added: 2, removed: 0, isBinary: false }],
      ]),
    }
    foldEmptyRepoWorkingTreeStats(staged, {
      perFileStats: new Map([
        ['a.bin', { added: 4, removed: 1, isBinary: true }],
      ]),
    })
    expect(staged.perFileStats.get('a.bin')).toEqual({
      added: 0,
      removed: 0,
      isBinary: true,
      isUntracked: false,
    })
    expect(staged.stats.linesAdded).toBe(0)
  })

  test('PPi session runs _zS + AzS includePreSession', () => {
    const src = readFileSync(join(import.meta.dir, '../gitDiff.ts'), 'utf8')
    expect(src).toContain('markPreSessionFiles')
    expect(src).toContain('getSessionStartTime')
    expect(src).toContain("if (mode === 'session')")
    expect(src).toContain('fetchUntrackedFiles(remaining, abort, true)')
    expect(src).toContain('fetchUntrackedFiles(remaining, abort, false)')
    expect(src).toContain('foldEmptyRepoWorkingTreeStats')
    expect(src).toContain("diff', '--numstat'")
  })

  test('VFf / vzS source lock: skippedLarge, --cached GFf, kJn shortstat', () => {
    const src = readFileSync(join(import.meta.dir, '../gitDiff.ts'), 'utf8')
    expect(src).toContain('skippedLarge.add')
    expect(src).toContain("if (ref === '--cached' && parsed.hunks.size > 0)")
    expect(src).toContain('fetchWorkingTreeNumstat')
    expect(src).toContain('quick && quick.filesCount > MAX_FILES_FOR_DETAILS')
    expect(src).toContain('hunks.size + skippedLarge.size >= MAX_FILES')
    expect(src).toContain('...RAW_GIT_DIFF_FLAGS')
  })
})
