/**
 * densable 2.1.247 — `_583` Or chain + `_577` J4n home-root + `pn` temp roots.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join, parse, sep } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import {
  classifyGitFile,
  isSeedTempRoot,
  resolveCommondir,
  tempRootPaths,
} from '../seedGitLinked.js'
import { refuseSeedHomeRoot } from '../seedGitHomeRoot.js'
import { probeSeedGitLayout } from '../seedGitLayout.js'

describe('densable Or / J4n', () => {
  test('J4n: home / fs-root / config-home', () => {
    expect(refuseSeedHomeRoot(homedir())).toBe('folder_is_home')
    expect(refuseSeedHomeRoot(parse(process.cwd()).root)).toBe('folder_is_root')
    expect(refuseSeedHomeRoot(getClaudeConfigHomeDir())).toBe(
      'folder_holds_config',
    )
    expect(refuseSeedHomeRoot(process.cwd())).toBeNull()
  })

  test('Ue resolves commondir . and ../..', () => {
    const admin = join(sep, 'repo', '.git', 'worktrees', 'wt')
    expect(resolveCommondir('.', admin)).toBe(admin)
    expect(resolveCommondir('../..', admin)).toBe(join(sep, 'repo', '.git'))
    expect(resolveCommondir(undefined, admin)).toBeUndefined()
  })

  test('Or: directory .git is not_file; junk file is git_file', async () => {
    expect((await classifyGitFile(process.cwd())).kind).toBe('not_file')
    const dir = await mkdtemp(join(tmpdir(), 'seed-or-'))
    await writeFile(join(dir, '.git'), 'not-a-pointer\n')
    expect(await classifyGitFile(dir)).toEqual({
      kind: 'refuse',
      why: 'git_file',
    })
  })

  test('Or: gitdir pointer that does not resolve is admin_dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seed-or2-'))
    await writeFile(join(dir, '.git'), 'gitdir: missing/worktree\n')
    expect(await classifyGitFile(dir)).toEqual({
      kind: 'refuse',
      why: 'admin_dir',
    })
  })

  test('K4n still reads this checkout after Or/An', async () => {
    const probed = await probeSeedGitLayout(process.cwd())
    expect(probed.kind).toBe('read')
    if (probed.kind === 'read') {
      expect(probed.layout.checkout).toBe('main')
      expect(probed.layout.adminDir).toBeUndefined()
    }
  })

  test('gitBundle host wires J4n and tXo', async () => {
    const src = await Bun.file(
      new URL('../gitBundle.ts', import.meta.url),
    ).text()
    expect(src).toContain('refuseSeedHomeRoot')
    expect(src).toContain('AbortSignal.timeout(180000)')
    expect(src).toContain('refused_home_root')
  })
})

describe('densable pn / nt temp roots', () => {
  const claudeTmp = join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), 'claude')
  const kr = [
    '/dev/stdout',
    '/dev/stderr',
    '/dev/null',
    '/dev/tty',
    '/dev/dtracehelper',
    '/dev/autofs_nowait',
    '/tmp/claude',
    '/private/tmp/claude',
    join(homedir(), '.npm/_logs'),
    join(homedir(), '.claude/debug'),
  ]

  test('pn is y([oe(),un(),...ne]) with T/mn aliases', () => {
    expect(tempRootPaths()).toEqual([...new Set([claudeTmp, claudeTmp, ...kr])])
    expect(tempRootPaths()[0]).toBe(claudeTmp)
    expect(tempRootPaths().filter(root => root === claudeTmp)).toHaveLength(1)
    expect(tempRootPaths()).not.toContain(tmpdir())
    expect(tempRootPaths()).not.toContain(process.env.TEMP)
    expect(tempRootPaths()).not.toContain(process.env.TMP)
  })

  test('nt/isSeedTempRoot fires for pn roots', async () => {
    expect(await isSeedTempRoot(join(claudeTmp, 'wt'), process.cwd())).toBe(
      true,
    )
    expect(await isSeedTempRoot('/tmp/claude/wt', process.cwd())).toBe(true)
    expect(await isSeedTempRoot('/dev/null', process.cwd())).toBe(true)
    expect(
      await isSeedTempRoot(process.cwd(), join(homedir(), '.claude/debug')),
    ).toBe(true)
    expect(await isSeedTempRoot(process.cwd(), process.cwd())).toBe(false)
  })

  test('source locks oe/un/ne via T/mn/G; gold is pn-temp-roots', async () => {
    const src = await Bun.file(
      new URL('../seedGitLinked.ts', import.meta.url),
    ).text()
    expect(src).toContain('tmpdir as T')
    expect(src).toContain('homedir as mn')
    expect(src).toContain('join as G')
    expect(src).toContain("G(N(), 'claude')")
    expect(src).toContain("G(e, '.npm/_logs')")
    expect(src).toContain("G(e, '.claude/debug')")
    expect(src).toContain("e === '~' || e.startsWith('~/')")
    expect(src).toContain('gold-forged-pn-temp-roots.txt')
    expect(src).not.toContain('process.env.TEMP')
    expect(src).not.toContain('process.env.TMP')
    const gold = await Bun.file(
      new URL(
        '../../../../docs/upstream-extraction/v2.1.247/snippets/gold-forged-pn-temp-roots.txt',
        import.meta.url,
      ),
    ).text()
    expect(gold).toContain('function pn(){return y([oe(),un()')
    expect(gold).toContain('@210534261')
    expect(gold).toContain('wZb as oe')
    expect(gold).toContain('yZb as un')
    expect(gold).toContain('yKb as ne')
    expect(gold).toContain('function Kr(){let e=qa();return["/dev/stdout"')
    expect(gold).not.toContain('gold-forged-ie.txt')
    expect(gold).not.toContain('gold-forged-ne.txt')
  })
})
