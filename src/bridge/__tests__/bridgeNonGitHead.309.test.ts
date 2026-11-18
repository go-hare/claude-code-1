import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('#1137 non-git HEAD filter in bridge', () => {
  test('bridgeMain filters branch to empty string when not in a git repo', () => {
    const src = readFileSync(join(import.meta.dir, '../bridgeMain.ts'), 'utf-8')
    expect(src).toContain('const isGitRepo = findGitRoot(dir) !== null')
    expect(src).toContain(
      "logger.setRepoInfo(repoName, isGitRepo ? branch : '')",
    )
  })

  test('createSession normalizes HEAD branch to empty string', () => {
    const src = readFileSync(
      join(import.meta.dir, '../createSession.ts'),
      'utf-8',
    )
    expect(src).toContain(
      "const branch = params.branch === 'HEAD' ? '' : params.branch",
    )
  })
})
