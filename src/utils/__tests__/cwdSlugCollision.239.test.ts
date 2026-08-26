// densable 2.1.239 #17 / #18 — QZs / cNr / lNr / Llh.
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isUnsafeCwdForSlugCollision,
  lastMessageAtMsFromTail,
  recordedCwdCollidesWithProject,
  recordedCwdCollidesWithProjectResolved,
  recordedCwdIsWithinOwnWorktrees,
  slugCollisionGuardFoldsCase,
} from '../sessionStoragePortable.js'

const neverCollapsed = async (): Promise<boolean> => false

describe('densable 2.1.239 recordedCwdCollidesWithProject', () => {
  test('underscore vs hyphen is a slug collision', () => {
    expect(
      recordedCwdCollidesWithProject(
        '/Users/me/proj_foo',
        '/Users/me/proj-foo',
        true,
      ),
    ).toBe(true)
  })

  test('identical paths are not a collision', () => {
    expect(
      recordedCwdCollidesWithProject(
        '/Users/me/proj-foo',
        '/Users/me/proj-foo',
        true,
      ),
    ).toBe(false)
  })

  test('different slugs are not a collision', () => {
    expect(
      recordedCwdCollidesWithProject('/Users/me/alpha', '/Users/me/beta', true),
    ).toBe(false)
  })

  test('tmt always folds case', () => {
    expect(slugCollisionGuardFoldsCase()).toBe(true)
  })
})

describe('densable 2.1.239 recordedCwdIsWithinOwnWorktrees', () => {
  test('undefined list is not within', () => {
    expect(recordedCwdIsWithinOwnWorktrees('/repo/wt', undefined, true)).toBe(
      false,
    )
  })

  test('equals a listed worktree', () => {
    expect(
      recordedCwdIsWithinOwnWorktrees('/repo/wt', ['/repo', '/repo/wt'], true),
    ).toBe(true)
  })

  test('nested under a listed worktree', () => {
    expect(
      recordedCwdIsWithinOwnWorktrees('/repo/wt/pkg', ['/repo/wt'], true),
    ).toBe(true)
  })
})

describe('densable 2.1.239 isUnsafeCwdForSlugCollision', () => {
  test('UNC is unsafe; WSL UNC is not hg', () => {
    expect(isUnsafeCwdForSlugCollision('\\\\server\\share\\p')).toBe(true)
    expect(isUnsafeCwdForSlugCollision('\\\\wsl$\\Ubuntu\\home')).toBe(false)
  })

  test('posix /net automount is unsafe', () => {
    expect(isUnsafeCwdForSlugCollision('/net/host/proj_foo')).toBe(true)
  })
})

describe('densable 2.1.239 recordedCwdCollidesWithProjectResolved', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true })))
  })

  test('two real punct-only dirs collide', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slug-coll-'))
    roots.push(root)
    const a = join(root, 'proj_foo')
    const b = join(root, 'proj-foo')
    await mkdir(a)
    await mkdir(b)
    expect(
      await recordedCwdCollidesWithProjectResolved(a, b, true, neverCollapsed),
    ).toBe(true)
  })

  test('missing recorded cwd is not a collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slug-miss-'))
    roots.push(root)
    const existing = join(root, 'proj-foo')
    await mkdir(existing)
    expect(
      await recordedCwdCollidesWithProjectResolved(
        join(root, 'proj_foo'),
        existing,
        true,
        neverCollapsed,
      ),
    ).toBe(false)
  })

  test('UNC pair is skipped even when slugs collide', async () => {
    expect(
      await recordedCwdCollidesWithProjectResolved(
        '\\\\server\\share\\proj_foo',
        '\\\\server\\share\\proj-foo',
        true,
        neverCollapsed,
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.239 lastMessageAtMsFromTail', () => {
  test('walks backward past progress to the last user/assistant', () => {
    const user = '2020-01-01T00:00:00.000Z'
    const progress = '2020-02-01T00:00:00.000Z'
    const tail = [
      JSON.stringify({ type: 'user', timestamp: user }),
      JSON.stringify({ type: 'progress', timestamp: progress }),
      '',
    ].join('\n')
    expect(lastMessageAtMsFromTail(tail)).toBe(Date.parse(user))
  })

  test('assistant counts', () => {
    const ts = '2021-03-04T05:06:07.000Z'
    expect(
      lastMessageAtMsFromTail(
        JSON.stringify({ type: 'assistant', timestamp: ts }),
      ),
    ).toBe(Date.parse(ts))
  })

  test('empty tail is undefined', () => {
    expect(lastMessageAtMsFromTail('')).toBeUndefined()
  })
})
