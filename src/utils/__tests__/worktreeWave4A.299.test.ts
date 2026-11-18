import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import {
  formatWorktreeBaseResolveError,
  isBareRepositoryLayoutRoot,
} from '../worktree.js'

describe('worktree Wave 4A (#710, #711, #783)', () => {
  test('#710 formatWorktreeBaseResolveError explains lookup outcome and likely causes', () => {
    expect(
      formatWorktreeBaseResolveError({
        baseBranch: 'HEAD',
        source: 'head',
        code: 1,
        stdout: '',
        stderr: 'fatal: bad revision HEAD',
      }),
    ).toContain('It may be that HEAD does not point to a commit')

    expect(
      formatWorktreeBaseResolveError({
        baseBranch: 'origin/main',
        source: 'origin_default',
        code: 1,
        stdout: '',
        stderr: '',
      }),
    ).toContain(
      'the fetch from origin succeeded, but git rev-parse found no such ref afterwards',
    )

    expect(
      formatWorktreeBaseResolveError({
        baseBranch: 'FETCH_HEAD',
        source: 'fetch_head',
        code: 1,
        stdout: '',
        stderr: '',
      }),
    ).toContain('the fetch of the PR/MR succeeded')
  })

  test('#711 isBareRepositoryLayoutRoot detects bare-layout .git pointer without commondir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-bare-711-'))
    try {
      const bareDir = join(root, '.bare')
      mkdirSync(bareDir, { recursive: true })
      await execFileNoThrowWithCwd('git', ['init', '--bare', bareDir], {
        cwd: root,
      })
      writeFileSync(join(root, '.git'), 'gitdir: ./.bare\n', 'utf8')
      expect(await isBareRepositoryLayoutRoot(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('#783 createWorktreeForSession uses ^{commit} to disambiguate baseBranch', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/utils/worktree.ts'),
      'utf8',
    )
    expect(src).toContain('`${baseBranch}^{commit}`')
  })
})
