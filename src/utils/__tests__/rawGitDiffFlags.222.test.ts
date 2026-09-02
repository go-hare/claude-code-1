/**
 * densable 2.1.222 #19 — RAW_GIT_DIFF_FLAGS (gnr) for raw git blob diffs.
 * Source-level: preserveGitState / gitDiff / reviewRemote must spread gnr.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { RAW_GIT_DIFF_FLAGS } from '../git.js'

const ROOT = join(import.meta.dir, '../../..')

describe('densable gnr RAW_GIT_DIFF_FLAGS', () => {
  test('equals densable gnr=["--no-ext-diff","--no-textconv"]', () => {
    expect([...RAW_GIT_DIFF_FLAGS]).toEqual(['--no-ext-diff', '--no-textconv'])
  })

  test('preserveGitStateForIssue uses RAW_GIT_DIFF_FLAGS on diff + format-patch', () => {
    const src = readFileSync(join(ROOT, 'src/utils/git.ts'), 'utf8')
    // densable rqi / preserve path
    expect(src).toContain("['diff', ...RAW_GIT_DIFF_FLAGS, 'HEAD']")
    expect(src).toContain('...RAW_GIT_DIFF_FLAGS,')
    expect(src).toMatch(/format-patch',\s*\n\s*\.\.\.RAW_GIT_DIFF_FLAGS,/)
    // no bare diff HEAD without flags in preserveGitStateForIssue region
    const preserve = src.slice(src.indexOf('preserveGitStateForIssue'))
    expect(preserve).not.toMatch(/\['diff', 'HEAD'\]/)
    expect(preserve).not.toMatch(
      /format-patch',\s*\n\s*`\$\{remoteBaseSha\}\.\.HEAD`/,
    )
  })

  test('gitDiff URo/jRo paths spread RAW_GIT_DIFF_FLAGS', () => {
    const src = readFileSync(join(ROOT, 'src/utils/gitDiff.ts'), 'utf8')
    // densable 239 PPi URo content: numstat / hunks spread gnr; shortstat does not
    expect(src).toContain('...RAW_GIT_DIFF_FLAGS,')
    expect(src).toContain("'--numstat'")
    expect(src).toContain('diffRef,')
    const numstatIdx = src.indexOf("'--numstat'")
    expect(src.slice(Math.max(0, numstatIdx - 180), numstatIdx)).toContain(
      '...RAW_GIT_DIFF_FLAGS,',
    )
    const shortstatIdx = src.indexOf("'--shortstat'")
    expect(
      src.slice(Math.max(0, shortstatIdx - 180), shortstatIdx),
    ).not.toContain('...RAW_GIT_DIFF_FLAGS,')
  })

  test('reviewRemote ultrareview probes reuse RAW_GIT_DIFF_FLAGS', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/review/reviewRemote.ts'),
      'utf8',
    )
    expect(src).toContain('RAW_GIT_DIFF_FLAGS')
    expect(src).toContain('...RAW_GIT_DIFF_FLAGS')
    // no leftover inline pair outside the constant definition
    expect(src).not.toMatch(/'--no-ext-diff',\s*\n\s*'--no-textconv'/)
  })
})
