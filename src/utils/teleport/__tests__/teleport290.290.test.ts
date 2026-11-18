import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SEED_LAUNCH_ENV_CONFIG_SENTINEL,
  formatSeedGitConfigRejection,
  formatSeedTamperedError,
} from '../seedGitLayout.js'

describe('#26: gitBundle stash create & deletedUnstaged', () => {
  test('gitBundle only treats exit code 1 with empty output as no uncommitted changes', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'gitBundle.ts'),
      'utf8',
    )
    expect(src).toContain('stashResult.code === 1 && noOutput')
    expect(src).toContain(
      'it was stopped, ran out of time or could not start, and left no message',
    )
    expect(src).toContain('and left no message')
  })

  test('seedWipWriteTree tracks deletedUnstaged from absent entries', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'seedWipWriteTree.ts'),
      'utf8',
    )
    expect(src).toContain('deletedUnstaged')
  })
})

describe('#134: shortened per-config-type git config rejection messages', () => {
  test('distinguishes launch-env config vs file config', () => {
    const envIncludes = formatSeedGitConfigRejection({
      kind: 'includes',
      file: SEED_LAUNCH_ENV_CONFIG_SENTINEL,
    })
    expect(envIncludes).toContain('launch environment’s git configuration')
    expect(envIncludes).toContain('drop that include from the environment')

    const fileIncludes = formatSeedGitConfigRejection({
      kind: 'includes',
      file: '/tmp/.gitconfig',
    })
    expect(fileIncludes).toContain('its git configuration (/tmp/.gitconfig)')
    expect(fileIncludes).not.toContain('launch environment')
  })

  test('formats user-level config_in_checkout and home_checkout', () => {
    const inCheckout = formatSeedGitConfigRejection(
      {
        kind: 'config_in_checkout',
        file: '/Users/me/.gitconfig',
        checkout: '/Users/me/repo',
      },
      'update git (2.31 or newer), or ',
      true,
    )
    expect(inCheckout).toContain(
      'the user-level git configuration file /Users/me/.gitconfig',
    )
    expect(inCheckout).toContain('update git (2.31 or newer), or ')
    expect(inCheckout).toContain('start from an ordinary clone, or ')

    const homeCheckout = formatSeedGitConfigRejection({
      kind: 'home_checkout',
      file: '/Users/me/.gitconfig',
      checkout: '/Users/me',
      relation: 'home',
    })
    expect(homeCheckout).toContain(
      'your home directory is itself a git checkout',
    )
  })
})

describe('#135: per-cause checkout rejection mapping', () => {
  test('maps placement, back_link, admin_dir, foreign_mount, git_file, reftable, borrowed_objects', () => {
    expect(
      formatSeedTamperedError({
        misplaced: 'linked_worktree',
        detail: 'placement',
      }),
    ).toContain('rename a bare repository’s directory to <name>.git')

    expect(
      formatSeedTamperedError({
        misplaced: 'linked_worktree',
        detail: 'back_link',
      }),
    ).toContain('does not point back at this tree')

    expect(
      formatSeedTamperedError({
        misplaced: 'linked_worktree',
        detail: 'admin_dir',
      }),
    ).toContain('names a worktree entry that does not exist')

    expect(
      formatSeedTamperedError({
        misplaced: 'linked_worktree',
        detail: 'foreign_mount',
      }),
    ).toContain('something is mounted over its administrative entry')

    expect(formatSeedTamperedError({ misplaced: 'git_file' })).toContain(
      'pointer file this upload could not follow',
    )

    expect(formatSeedTamperedError({ misplaced: 'reftable' })).toContain(
      'reftable storage',
    )

    expect(
      formatSeedTamperedError({ misplaced: 'borrowed_objects' }),
    ).toContain('alternates file')
  })
})

describe('#152: partial clone error omits raw (git: ...) stderr', () => {
  test('gitBundle partial clone error uses git fsck instructions without raw stderr', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'gitBundle.ts'),
      'utf8',
    )
    expect(src).toContain('git fsck --name-objects')
    expect(src).not.toContain(
      "Start the cloud session from the repository's GitHub source instead. (git:",
    )
  })
})
