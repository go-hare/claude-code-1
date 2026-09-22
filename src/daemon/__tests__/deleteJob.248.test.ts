/**
 * densable 2.1.248 #20 — deleteJob unpushed gate uses b1t/P0n
 * primaryCheckoutVouches so a worktree merged into the checked-out
 * local default (e.g. main) is not kept as unpushed.
 *
 * GOLD: gold-248-20-b1t.txt
 *   b1t @186369395 sha=a6321b76b8763900
 *   P0n @186369915 sha=87c14d737c9dcf6e
 *   oG @189690878: !await b1t(k, await mGe(N), {primaryCheckoutVouches:!0})
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isJobWorktreeFullyUpstream,
  resolveOriginHeadRef,
} from '../../utils/worktree.js'

const ROOT = join(import.meta.dir, '..')
const UTILS = join(import.meta.dir, '../../utils')
const deleteJobSrc = readFileSync(join(ROOT, 'deleteJob.ts'), 'utf8')
const worktreeSrc = readFileSync(join(UTILS, 'worktree.ts'), 'utf8')

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', env })
}

function gitOut(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim()
}

function makeMergedUnpushedWorktree(): {
  primary: string
  worktree: string
  env: NodeJS.ProcessEnv
} {
  const tmp = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'dj-248-unpushed-')),
  )
  temps.push(tmp)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t.t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t.t',
  }
  const bare = join(tmp, 'origin.git')
  const primary = join(tmp, 'primary')
  const worktree = join(tmp, 'agent-wt')
  mkdirSync(primary, { recursive: true })
  git(primary, ['init'], env)
  git(primary, ['checkout', '-B', 'main'], env)
  git(primary, ['config', 'user.email', 't@t.t'], env)
  git(primary, ['config', 'user.name', 't'], env)
  git(primary, ['commit', '--allow-empty', '-m', 'init'], env)
  git(tmp, ['init', '--bare', bare], env)
  git(primary, ['remote', 'add', 'origin', bare], env)
  git(primary, ['push', '-u', 'origin', 'main'], env)
  git(primary, ['remote', 'set-head', 'origin', 'main'], env)
  git(primary, ['worktree', 'add', '-b', 'agent', worktree], env)
  git(worktree, ['commit', '--allow-empty', '-m', 'agent work'], env)
  git(primary, ['merge', '--no-ff', 'agent', '-m', 'merge agent'], env)
  return { primary, worktree, env }
}

describe('densable 2.1.248 #20 deleteJob local-default unpushed exemption', () => {
  test('oG call site is b1t + primaryCheckoutVouches, not remotes-only --all', () => {
    expect(deleteJobSrc).toContain('isJobWorktreeFullyUpstream(')
    expect(deleteJobSrc).toContain('resolveOriginHeadRef(gitRoot)')
    expect(deleteJobSrc).toContain('primaryCheckoutVouches: true')
    expect(deleteJobSrc).toContain("keptReason = 'unpushed'")
    expect(deleteJobSrc).toContain('has commits that are not pushed anywhere')
    expect(deleteJobSrc).not.toContain('worktreeHasUnpushedCommits')
    expect(deleteJobSrc).not.toContain("'--all', '--not', '--remotes'")
    expect(deleteJobSrc).not.toContain('"--all","--not","--remotes"')
  })

  test('b1t/P0n body next to UMs; Ljr still vouches:false', () => {
    expect(worktreeSrc).toContain('densable P0n')
    expect(worktreeSrc).toContain('densable UMs / b1t')
    expect(worktreeSrc).toContain('primaryCheckoutVouches')
    expect(worktreeSrc).toContain('main-worktree/HEAD')
    expect(worktreeSrc).toContain("'--git-common-dir'")
    expect(worktreeSrc).toContain("'--symbolic-full-name'")
    expect(worktreeSrc).toContain('refs/heads/${originHeadRef.slice')
    expect(worktreeSrc).toContain("startsWith('origin/')")
    expect(worktreeSrc).toContain("'core.bare'")
    const ums = worktreeSrc.slice(
      worktreeSrc.indexOf('export async function isJobWorktreeFullyUpstream('),
      worktreeSrc.indexOf('async function isJobWorktreeSafeToReap('),
    )
    expect(ums).toContain('opts.primaryCheckoutVouches')
    expect(ums).toContain('[...remotesOnly, vouch,')
    const ljr = worktreeSrc.slice(
      worktreeSrc.indexOf('async function isJobWorktreeSafeToReap('),
      worktreeSrc.indexOf(
        'export async function resetResumedWorktreeIfFullyUpstream(',
      ),
    )
    expect(ljr).toContain('primaryCheckoutVouches: false')
  })
})

describe('densable 248 P0n / b1t runtime', () => {
  test('merged into local main but not pushed is fully upstream only with vouches', async () => {
    const { primary, worktree } = makeMergedUnpushedWorktree()
    const origin = await resolveOriginHeadRef(primary)
    expect(origin).toBe('origin/main')

    const remotesOnly = await isJobWorktreeFullyUpstream(worktree, origin, {
      primaryCheckoutVouches: false,
    })
    expect(remotesOnly).toBe(false)

    const vouched = await isJobWorktreeFullyUpstream(worktree, origin, {
      primaryCheckoutVouches: true,
    })
    expect(vouched).toBe(true)
  })

  test('unmerged unique commits stay unpushed even with vouches', async () => {
    const { primary, worktree, env } = makeMergedUnpushedWorktree()
    git(worktree, ['commit', '--allow-empty', '-m', 'not merged'], env)
    const origin = await resolveOriginHeadRef(primary)
    expect(
      await isJobWorktreeFullyUpstream(worktree, origin, {
        primaryCheckoutVouches: true,
      }),
    ).toBe(false)
  })
})
