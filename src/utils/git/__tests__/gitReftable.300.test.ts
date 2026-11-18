import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isReftableRepo,
  readGitHead,
  readRawSymref,
  REFTABLE_HEAD_REF,
  resolveRef,
} from '../gitFilesystem.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function supportsReftable(): boolean {
  const probe = makeTempDir('reftable-probe-')
  try {
    execFileSync('git', ['init', '--ref-format=reftable'], {
      cwd: probe,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

const HAS_REFTABLE = supportsReftable()

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('gitFilesystem reftable support (#779, #784)', () => {
  test('isReftableRepo detects refs/heads/.invalid in HEAD', async () => {
    const dir = makeTempDir('reftable-head-')
    writeFileSync(join(dir, 'HEAD'), `ref: ${REFTABLE_HEAD_REF}\n`)
    expect(await isReftableRepo(dir)).toBe(true)

    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n')
    expect(await isReftableRepo(dir)).toBe(false)
  })

  test('readGitHead, resolveRef, and readRawSymref work in a real reftable repo', async () => {
    if (!HAS_REFTABLE) return
    const repo = makeTempDir('reftable-real-')
    execFileSync('git', ['init', '--ref-format=reftable', '-b', 'main'], {
      cwd: repo,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repo,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: repo,
      stdio: 'ignore',
    })
    writeFileSync(join(repo, 'a.txt'), 'hello\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'init'], {
      cwd: repo,
      stdio: 'ignore',
    })
    const expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf-8',
    }).trim()

    const gitDir = join(repo, '.git')
    expect(await isReftableRepo(gitDir)).toBe(true)
    expect(await readGitHead(gitDir)).toEqual({ type: 'branch', name: 'main' })
    expect(await resolveRef(gitDir, 'refs/heads/main')).toBe(expectedSha)
    expect(await resolveRef(gitDir, 'HEAD')).toBe(expectedSha)

    execFileSync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
      {
        cwd: repo,
        stdio: 'ignore',
      },
    )
    expect(
      await readRawSymref(
        gitDir,
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/',
      ),
    ).toBe('main')

    // Detached HEAD in reftable
    execFileSync('git', ['checkout', '--detach', 'HEAD'], {
      cwd: repo,
      stdio: 'ignore',
    })
    expect(await readGitHead(gitDir)).toEqual({
      type: 'detached',
      sha: expectedSha,
    })
  })

  test('isReftableRepo returns false when HEAD is missing', async () => {
    const empty = makeTempDir('reftable-empty-')
    mkdirSync(join(empty, 'nested'))
    expect(await isReftableRepo(join(empty, 'nested'))).toBe(false)
  })
})
