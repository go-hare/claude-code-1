/**
 * densable 2.1.238 #9 — isolation pin validator (`yXo` / `ODt`).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  evaluateIsolationWorktreePin,
  isHardIsolationPinRefuse,
  probeIsolationWorktreePin,
  sanitizePinMessage,
  type IsolationGitIds,
  type IsolationPinProbe,
} from '../isolationWorktreePin.js'

const temps: string[] = []

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  temps.push(d)
  return d
}

afterEach(() => {
  while (temps.length) {
    const d = temps.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

function ids(
  overrides: Partial<IsolationGitIds> &
    Pick<IsolationGitIds, 'gitDir' | 'topLevel' | 'commonDir'>,
): IsolationGitIds {
  return {
    backPointer: null,
    symlinkedRefStore: [],
    unexaminableRefStore: [],
    ...overrides,
  }
}

function probe(
  overrides: Partial<IsolationPinProbe> & { ids: IsolationPinProbe['ids'] },
): IsolationPinProbe {
  return {
    entry: 'present',
    ...overrides,
  }
}

describe('evaluateIsolationWorktreePin densable yXo (2.1.238)', () => {
  test('work-tree-elsewhere → exact SEA refuse', () => {
    const pin = '/tmp/iso-wt/pin'
    const topLevel = '/tmp/iso-wt/elsewhere'
    const result = evaluateIsolationWorktreePin(
      pin,
      probe({
        ids: ids({
          gitDir: join(pin, '.git'),
          topLevel,
          commonDir: join(pin, '.git'),
        }),
      }),
      false,
      [],
      new Set(),
      new Set(),
      [],
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('work-tree-elsewhere')
    expect(result.message).toBe(
      `Refusing to use ${pin} as an isolation worktree: git resolves its working tree to ${topLevel} (a core.worktree redirect, or a checkout discovered above it), so commands run there would write outside the worktree. Remove the redirect, restore the worktree's own .git, or recreate the worktree, then retry.`,
    )
  })

  test('symlink pin → unverifiable', () => {
    const pin = '/tmp/iso-wt/link'
    const result = evaluateIsolationWorktreePin(
      pin,
      probe({ ids: 'error' }),
      true,
      [],
      new Set(),
      new Set(),
      [],
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unverifiable')
    expect(result.message).toContain('it is a symbolic link')
    expect(result.message).toContain('recreate the worktree')
  })

  test('symlinked refs → invalid-linked-worktree', () => {
    const pin = '/tmp/iso-wt/pin'
    const result = evaluateIsolationWorktreePin(
      pin,
      probe({
        ids: ids({
          gitDir: join(pin, '.git'),
          topLevel: pin,
          commonDir: join(pin, '.git'),
          symlinkedRefStore: ['HEAD', 'refs/heads'],
        }),
      }),
      false,
      [],
      new Set(),
      new Set(),
      [],
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-linked-worktree')
    expect(result.message).toContain('HEAD, refs/heads')
    expect(result.message).toContain(
      'Recreate the worktree with git worktree add',
    )
  })

  test('no-repo + absent .git → not-a-git-worktree (ok)', () => {
    const result = evaluateIsolationWorktreePin(
      '/tmp/iso-wt/plain',
      { entry: 'absent', ids: 'no-repo' },
      false,
      [],
      new Set(),
      new Set(),
      [],
    )
    expect(result).toEqual({ ok: true, reason: 'not-a-git-worktree' })
  })

  test('JL strips C0/C1 from refuse messages', () => {
    expect(sanitizePinMessage('a\nbc')).toBe('a b c')
  })

  test('hard refuse excludes unverifiable and pin-is-own-launch-tree', () => {
    expect(isHardIsolationPinRefuse('work-tree-elsewhere')).toBe(true)
    expect(isHardIsolationPinRefuse('shared-git-dir')).toBe(true)
    expect(isHardIsolationPinRefuse('unverifiable')).toBe(false)
    expect(isHardIsolationPinRefuse('pin-is-own-launch-tree')).toBe(false)
  })
})

describe('probeIsolationWorktreePin densable ODt (2.1.238)', () => {
  test('core.worktree redirect → work-tree-elsewhere + Remove the redirect', async () => {
    const repo = tempDir('iso-pin-repo-')
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@t.t'], {
      cwd: repo,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 't'], {
      cwd: repo,
      stdio: 'ignore',
    })
    writeFileSync(join(repo, 'README'), 'x\n')
    execFileSync('git', ['add', 'README'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], {
      cwd: repo,
      stdio: 'ignore',
    })

    const pin = join(tempDir('iso-pin-wt-'), 'redirected')
    mkdirSync(pin, { recursive: true })
    writeFileSync(join(pin, '.git'), `gitdir: ${join(repo, '.git')}\n`)
    execFileSync('git', ['config', 'core.worktree', repo], {
      cwd: pin,
      stdio: 'ignore',
    })

    const result = await probeIsolationWorktreePin(pin, [], [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    const topLevel = execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=',
        'rev-parse',
        '--show-toplevel',
      ],
      { cwd: pin, encoding: 'utf8' },
    ).trim()
    expect(result.reason).toBe('work-tree-elsewhere')
    expect(result.message).toContain('Remove the redirect')
    expect(result.message).toContain(pin)
    expect(result.message).toContain(topLevel)
  })
})

describe('densable 2.1.238 ODt call-sites (PPl create vs wrappers)', () => {
  test('getOrCreate create path has no ODt; resume + CLI --worktree wrappers do', () => {
    const src = readFileSync(join(import.meta.dir, '../worktree.ts'), 'utf8')
    const getOrCreateStart = src.indexOf('async function getOrCreateWorktree')
    const getOrCreateEnd = src.indexOf(
      'export async function copyWorktreeIncludeFiles',
    )
    expect(getOrCreateStart).toBeGreaterThan(-1)
    expect(getOrCreateEnd).toBeGreaterThan(getOrCreateStart)
    const getOrCreate = src.slice(getOrCreateStart, getOrCreateEnd)
    const createMarker = 'await assertWorktreeCreatePathsNotSymlinked'
    const createAt = getOrCreate.indexOf(createMarker)
    expect(createAt).toBeGreaterThan(-1)
    const resumePath = getOrCreate.slice(0, createAt)
    const createPath = getOrCreate.slice(createAt)
    expect(resumePath).toContain('assertIsolationWorktreeAllowed')
    expect(createPath).not.toContain('assertIsolationWorktreeAllowed')

    const execStart = src.indexOf('export async function execIntoTmuxWorktree')
    expect(execStart).toBeGreaterThan(-1)
    const execInto = src.slice(execStart, execStart + 12_000)
    expect(execInto).toContain('executeWorktreeCreateHook')
    expect(execInto).toContain('await getOrCreateWorktree')
    expect(execInto).toContain('await performPostCreationSetup')
    const hookOdt = execInto.indexOf('await assertIsolationWorktreeAllowed')
    const gitOdt = execInto.lastIndexOf('await assertIsolationWorktreeAllowed')
    expect(hookOdt).toBeGreaterThan(-1)
    expect(gitOdt).toBeGreaterThan(hookOdt)
  })

  test('createWorktreeForSession assigns global session only after ODt (SEA EZn rwe)', () => {
    const src = readFileSync(join(import.meta.dir, '../worktree.ts'), 'utf8')
    const start = src.indexOf('export async function createWorktreeForSession')
    const end = src.indexOf('export async function keepWorktree')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const fn = src.slice(start, end)
    const odt = fn.indexOf('await assertIsolationWorktreeAllowed')
    expect(odt).toBeGreaterThan(-1)
    const before = fn.slice(0, odt)
    expect(before).toContain('let session: WorktreeSession')
    expect(before).not.toContain('currentWorktreeSession =')
    const after = fn.slice(odt)
    expect(after).toContain('currentWorktreeSession = session')
    // SEA leaves disk orphan on ODt fail — do not invent rm.
    expect(after).not.toContain('rmSync')
    expect(after).not.toContain('removeWorktree')
    expect(after).not.toContain('executeWorktreeRemoveHook')
  })
})
