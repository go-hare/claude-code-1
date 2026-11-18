import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { REFTABLE_HEAD_REF } from '../git/gitFilesystem.js'
import {
  fetchUntrackedFiles,
  probeTransientRefsInReftable,
} from '../gitDiff.js'

const tempDirs: string[] = []
const originalCwd = process.cwd()

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  process.chdir(originalCwd)
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('gitDiff & gitBundle alignment (#667, #734, #774, #873)', () => {
  test('#667: fetchUntrackedFiles preserves leading and trailing spaces in filenames', async () => {
    const repo = makeTempDir('diff-space-')
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repo,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: repo,
      stdio: 'ignore',
    })
    writeFileSync(join(repo, 'base.txt'), 'base\n')
    execFileSync('git', ['add', 'base.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], {
      cwd: repo,
      stdio: 'ignore',
    })

    writeFileSync(join(repo, ' leading.txt'), 'a\n')
    writeFileSync(join(repo, 'trailing.txt '), 'b\n')

    process.chdir(repo)
    const untracked = await fetchUntrackedFiles(50, undefined, true)
    expect(untracked).not.toBeNull()
    expect(untracked!.has(' leading.txt')).toBe(true)
    expect(untracked!.has('trailing.txt ')).toBe(true)
  })

  test('#774 & #873: probeTransientRefsInReftable detects CHERRY_PICK_HEAD / REVERT_HEAD even if another probe times out', async () => {
    const gitDir = makeTempDir('reftable-transient-')
    writeFileSync(join(gitDir, 'HEAD'), `ref: ${REFTABLE_HEAD_REF}\n`)

    // One ref returns 0 (exists), the other times out (undefined)
    const found = await probeTransientRefsInReftable(
      gitDir,
      ['CHERRY_PICK_HEAD', 'REVERT_HEAD'],
      async args => {
        const ref = args.at(-1)
        if (ref === 'CHERRY_PICK_HEAD') return 0
        return undefined
      },
    )
    expect(found).not.toBeNull()
    expect(found!.has('CHERRY_PICK_HEAD')).toBe(true)

    // Both missing (exit code 2) -> empty Set
    const empty = await probeTransientRefsInReftable(
      gitDir,
      ['CHERRY_PICK_HEAD', 'REVERT_HEAD'],
      async () => 2,
    )
    expect(empty).toEqual(new Set())

    // None found and one errored -> null
    const failed = await probeTransientRefsInReftable(
      gitDir,
      ['CHERRY_PICK_HEAD', 'REVERT_HEAD'],
      async args => (args.at(-1) === 'CHERRY_PICK_HEAD' ? 2 : undefined),
    )
    expect(failed).toBeNull()
  })

  test('#734: gitBundle.ts no longer suggests `git add .` on upload failure', () => {
    const src = readFileSync(
      join(import.meta.dir, '../teleport/gitBundle.ts'),
      'utf-8',
    )
    expect(src).not.toContain('git add .')
  })
})
