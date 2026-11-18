import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  FetchRefNotFoundError,
  fetchAndCheckout,
  fetchWithRetry,
  sanitizePermanentRefWording,
  type GitRepoCtx,
} from '../gitPrepare.js'
import {
  buildDoctorSystemPrompt,
  buildSetupSystemPrompt,
} from '../setupDoctor.js'

const rootRunnerSrc = readFileSync(
  join(import.meta.dir, '../rootRunner.ts'),
  'utf8',
)
const sessionHandlerSrc = readFileSync(
  join(import.meta.dir, '../sessionHandler.ts'),
  'utf8',
)

describe('2.1.299-301 self-hosted runner alignments', () => {
  test('#678: fetchAndCheckout runs read-tree HEAD when empty & sanitized', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shr-678-'))
    try {
      await Bun.spawn(['git', 'init'], { cwd: dir }).exited
      await Bun.write(join(dir, 'README.md'), 'hello\n')
      await Bun.spawn(['git', 'add', 'README.md'], { cwd: dir }).exited
      await Bun.spawn(
        [
          'git',
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t',
          'commit',
          '-m',
          'init',
        ],
        { cwd: dir },
      ).exited
      // Empty bare remote
      const remoteDir = join(dir, 'empty-remote.git')
      await Bun.spawn(['git', 'init', '--bare', remoteDir]).exited
      const remoteUrl = `file://${remoteDir}`
      await Bun.spawn(['git', 'remote', 'add', 'origin', remoteUrl], {
        cwd: dir,
      }).exited

      let indexed = false
      const ctx: GitRepoCtx = {
        repoPath: dir,
        gitURL: remoteUrl,
        authURL: remoteUrl,
        sanitized: {
          onIndexFromHead: () => {
            indexed = true
          },
        },
        onDebug: () => {},
      }
      await fetchAndCheckout(ctx, undefined, false, false)
      expect(indexed).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#879: fetchWithRetry throws FetchRefNotFoundError on permanent ref error and unrelated errors sanitize wording', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shr-879-'))
    try {
      await Bun.spawn(['git', 'init'], { cwd: dir }).exited
      const remoteDir = join(dir, 'remote.git')
      await Bun.spawn(['git', 'init', '--bare', remoteDir]).exited
      // Seed one commit so remote is non-empty
      const seedDir = join(dir, 'seed')
      await Bun.spawn(['git', 'clone', remoteDir, seedDir]).exited
      await Bun.write(join(seedDir, 'a.txt'), 'a\n')
      await Bun.spawn(['git', 'add', 'a.txt'], { cwd: seedDir }).exited
      await Bun.spawn(
        [
          'git',
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t',
          'commit',
          '-m',
          'init',
        ],
        { cwd: seedDir },
      ).exited
      await Bun.spawn(['git', 'push', 'origin', 'HEAD:main'], {
        cwd: seedDir,
      }).exited

      const remoteUrl = `file://${remoteDir}`
      const ctx: GitRepoCtx = {
        repoPath: dir,
        gitURL: remoteUrl,
        authURL: remoteUrl,
        onDebug: () => {},
      }
      await expect(
        fetchWithRetry(ctx, ['fetch', remoteUrl, 'refs/heads/no-such-branch']),
      ).rejects.toBeInstanceOf(FetchRefNotFoundError)

      expect(
        sanitizePermanentRefWording(
          "unrelated error quoting: fatal: couldn't find remote ref foo",
        ),
      ).toBe('unrelated error quoting: fatal: could not find remote ref foo')
      expect(sessionHandlerSrc).toContain(
        'err instanceof FetchRefNotFoundError',
      )
      expect(sessionHandlerSrc).toContain(
        'sanitizePermanentRefWording(childResult.stderrTail)',
      )
      expect(rootRunnerSrc).toContain(
        "setupFailureKind === 'SETUP_FAILURE_KIND_SOURCE_REF_NOT_FOUND'",
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#700: setup & doctor prompts include HTTPS git-credentials and Git sign-in guidance', () => {
    const setup = buildSetupSystemPrompt('https://claude.ai')
    expect(setup).toContain(
      'It uses the git credentials this machine already has for HTTPS',
    )
    expect(setup).toContain("If it fails with git's `could not read Username`")

    const doctor = buildDoctorSystemPrompt('https://claude.ai')
    expect(doctor).toContain(
      '`could not read Username for` (or `Password for`)',
    )
    expect(doctor).toContain(
      '**Git sign-in** (the `could not read Username for` row):',
    )
  })

  test('#701 & #880: rootRunner guards childAlive startup restart and logs ending/failure streak on release', () => {
    expect(rootRunnerSrc).toContain("kind === 'startup' &&")
    expect(rootRunnerSrc).toContain('snap?.childAlive === true')
    expect(rootRunnerSrc).toContain(
      'not retried, the session is ending on this runner',
    )
    expect(rootRunnerSrc).toContain('failures in a row')
  })
})
