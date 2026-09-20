/**
 * densable 2.1.247 — `_583` `to`/`X4n` private seed-admin.
 * TCt `b=h&&s` only when hardenForDeviceSessions===true.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { execFileNoThrowWithCwd } from '../../execFileNoThrow.js'
import { gitExe } from '../../git.js'
import { formatSeedAdminFail, makeSeedAdminDir } from '../seedGitAdmin.js'
import { probeSeedGitLayout } from '../seedGitLayout.js'

const prevConfigDir = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
  getClaudeConfigHomeDir.cache.clear?.()
})

describe('densable to/X4n seed-admin', () => {
  test('yCt=300 placement / setup copy', () => {
    expect(formatSeedAdminFail('inside the tree', 'placement')).toContain(
      'would stand where a cloud session can write',
    )
    expect(formatSeedAdminFail('no HEAD', 'setup')).toContain(
      '~/.claude/seed-admin from this checkout',
    )
    const washed = formatSeedAdminFail('first line\nENOENT secret', 'setup')
    expect(washed).toContain('first line')
    expect(washed).not.toContain('ENOENT secret')
  })

  test('gold + source lock Bc Pzd before $l/bp', async () => {
    const gold = await Bun.file(
      new URL(
        '../../../../docs/upstream-extraction/v2.1.247/snippets/gold-forged-Bc.txt',
        import.meta.url,
      ),
    ).text()
    expect(gold).toContain('Pzd as Bc')
    expect(gold).toContain('bp($l(Bc(T.detail)),yCt)')
    const src = await Bun.file(
      new URL('../seedGitAdmin.ts', import.meta.url),
    ).text()
    expect(src).toContain('sanitizeSeedDisplay(washSeedStderr(detail))')
    expect(src).toContain("from './seedGitBundleUxo.js'")
  })

  test('copies HEAD/index and junctions objects+info', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-x4n-'))
    const repo = join(root, 'repo')
    const home = join(root, 'claude-home')
    await mkdir(repo)
    await mkdir(home)
    process.env.CLAUDE_CONFIG_DIR = home
    getClaudeConfigHomeDir.cache.clear?.()
    const git = async (args: string[]) => {
      const r = await execFileNoThrowWithCwd(gitExe(), args, {
        cwd: repo,
        stripFinalNewline: false,
      })
      return { ...r, exitCode: r.code }
    }
    expect((await git(['init'])).code).toBe(0)
    await Bun.write(join(repo, 'a.txt'), 'a\n')
    expect((await git(['add', 'a.txt'])).code).toBe(0)
    expect(
      (
        await git([
          '-c',
          'user.email=t@t',
          '-c',
          'user.name=t',
          'commit',
          '-m',
          't',
        ])
      ).code,
    ).toBe(0)
    const probed = await probeSeedGitLayout(repo)
    expect(probed.kind).toBe('read')
    if (probed.kind !== 'read') return
    const admin = await makeSeedAdminDir(repo, probed.layout, probed.layout.run)
    try {
      expect(admin.kind).toBe('made')
      if (admin.kind !== 'made') return
      expect(admin.path.includes(`${sep}seed-admin${sep}`)).toBe(true)
      expect(admin.path.includes('claude-seed-admin-')).toBe(true)
      expect((await lstat(join(admin.path, 'HEAD'))).isFile()).toBe(true)
      expect((await lstat(join(admin.path, 'index'))).isFile()).toBe(true)
      const objects = await lstat(join(admin.path, 'objects'))
      expect(objects.isSymbolicLink() || objects.isDirectory()).toBe(true)
      const info = await lstat(join(admin.path, 'info'))
      expect(info.isSymbolicLink() || info.isDirectory()).toBe(true)
    } finally {
      if (admin.kind === 'made') await admin.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('gitBundle host: X4n only when hardenForDeviceSessions===true', async () => {
    const src = await Bun.file(
      new URL('../gitBundle.ts', import.meta.url),
    ).text()
    expect(src).toContain('makeSeedAdminDir')
    expect(src).toContain('hardenForDeviceSessions === true')
    expect(src).toContain('admin_dir_failed')
    expect(src).toContain('bindSeedAdminDir')
  })

  test('Jn sanitizes YBc process-start identity', async () => {
    const src = await Bun.file(
      new URL('../seedGitAdmin.ts', import.meta.url),
    ).text()
    expect(src).toContain('getProcessLstartString')
    expect(src).toContain(".replace(/[^0-9a-z]/gi, '')")
    expect(src).toContain('.slice(0, 24)')
  })
})
