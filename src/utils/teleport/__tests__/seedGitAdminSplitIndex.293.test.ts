import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatSeedAdminFail, makeSeedAdminDir } from '../seedGitAdmin.js'

describe('v2.1.293 #301 — split-index refusal advice in seedGitAdmin', () => {
  test('formatSeedAdminFail appends safe split-index advice without suggesting manual deletion', () => {
    const msg = formatSeedAdminFail(
      'more than 64 split-index files (sharedindex.*) stand in the git dir',
      'shared_index',
    )
    expect(msg).toContain('Look at the split-index files (sharedindex.*) first')
    expect(msg).toContain('do not delete any of these files by hand')
    expect(msg).toContain('a fresh clone from the remote')
  })

  test('formatSeedAdminFail for shared_index_too_large warns not to delete by hand', () => {
    const msg = formatSeedAdminFail(
      'larger than an index or refs file gets',
      'shared_index_too_large',
    )
    expect(msg).toContain(
      'Do not delete that split-index file by hand: the index may need it.',
    )
    expect(msg).toContain('a fresh clone from the remote')
  })

  test('makeSeedAdminDir returns shared_index reason when > 64 sharedindex files exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-split-idx-'))
    const origConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      const workTree = join(root, 'repo')
      const gitDir = join(workTree, '.git')
      const configDir = join(root, 'claude-config')
      await mkdir(join(gitDir, 'objects'), { recursive: true })
      await mkdir(join(gitDir, 'info'), { recursive: true })
      await mkdir(configDir, { recursive: true })
      await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
      await writeFile(join(gitDir, 'index'), '')
      await writeFile(
        join(gitDir, 'config'),
        '[core]\n\trepositoryformatversion = 0\n',
      )
      for (let i = 0; i < 65; i++) {
        const hex = i.toString(16).padStart(40, '0')
        await writeFile(join(gitDir, `sharedindex.${hex}`), '')
      }
      process.env.CLAUDE_CONFIG_DIR = configDir

      const res = await makeSeedAdminDir(
        workTree,
        {
          workTree,
          gitDir,
          commonDir: gitDir,
          checkout: 'main',
          bound: false,
        },
        async argv => {
          if (argv[0] === 'rev-parse')
            return { code: 0, stdout: 'sha1\n', stderr: '' }
          return { code: 0, stdout: '', stderr: '' }
        },
      )
      expect(res.kind).toBe('failed')
      if (res.kind === 'failed') {
        expect(res.reason).toBe('shared_index')
        expect(res.detail).toContain('more than 64 split-index files')
      }
    } finally {
      if (origConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = origConfigDir
      await rm(root, { recursive: true, force: true })
    }
  })

  test('makeSeedAdminDir returns shared_index reason when a sharedindex file is a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-split-link-'))
    const origConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      const workTree = join(root, 'repo')
      const gitDir = join(workTree, '.git')
      const configDir = join(root, 'claude-config')
      await mkdir(join(gitDir, 'objects'), { recursive: true })
      await mkdir(join(gitDir, 'info'), { recursive: true })
      await mkdir(configDir, { recursive: true })
      await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
      await writeFile(join(gitDir, 'index'), '')
      await writeFile(
        join(gitDir, 'config'),
        '[core]\n\trepositoryformatversion = 0\n',
      )
      const target = join(root, 'external-index')
      await writeFile(target, 'data')
      const hex = 'a'.repeat(40)
      await symlink(target, join(gitDir, `sharedindex.${hex}`))
      process.env.CLAUDE_CONFIG_DIR = configDir

      const res = await makeSeedAdminDir(
        workTree,
        {
          workTree,
          gitDir,
          commonDir: gitDir,
          checkout: 'main',
          bound: false,
        },
        async argv => {
          if (argv[0] === 'rev-parse')
            return { code: 0, stdout: 'sha1\n', stderr: '' }
          return { code: 0, stdout: '', stderr: '' }
        },
      )
      expect(res.kind).toBe('failed')
      if (res.kind === 'failed') {
        expect(res.reason).toBe('shared_index')
      }
    } finally {
      if (origConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = origConfigDir
      await rm(root, { recursive: true, force: true })
    }
  })
})
