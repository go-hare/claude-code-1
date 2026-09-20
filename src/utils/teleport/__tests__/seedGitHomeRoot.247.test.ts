/**
 * densable 2.1.247 — `_577` `fe`/`J4n` + `_580` `ho`/`w` whole-drive.
 * `h`/`J3c` = `_752` `Wn` via `findCanonicalGitRoot` (`canonicalRootByRoot`).
 */
import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { parse } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { getPlatform } from '../../platform.js'
import { seedTempRefFail } from '../gitBundle.js'
import { refuseSeedHomeRoot } from '../seedGitHomeRoot.js'

describe('densable fe/J4n + ho/w', () => {
  test('J4n: home / fs-root / config-home', () => {
    expect(refuseSeedHomeRoot(homedir())).toBe('folder_is_home')
    expect(refuseSeedHomeRoot(parse(process.cwd()).root)).toBe('folder_is_root')
    expect(refuseSeedHomeRoot(getClaudeConfigHomeDir())).toBe(
      'folder_holds_config',
    )
    expect(refuseSeedHomeRoot(process.cwd())).toBeNull()
  })

  test('w/ho: WSL /mnt and /mnt/c are folder_is_root', () => {
    if (getPlatform() !== 'wsl') return
    expect(refuseSeedHomeRoot('/mnt')).toBe('folder_is_root')
    expect(refuseSeedHomeRoot('/mnt/c')).toBe('folder_is_root')
    expect(refuseSeedHomeRoot('/mnt/c/')).toBe('folder_is_root')
    expect(refuseSeedHomeRoot('/mnt/c/Users') === 'folder_is_root').toBe(false)
  })

  test('J3c/h: third arg h(e)??e dual-folder', () => {
    expect(refuseSeedHomeRoot(process.cwd(), {}, homedir())).toBe(
      'folder_is_home',
    )
    expect(
      refuseSeedHomeRoot(process.cwd(), {}, parse(process.cwd()).root),
    ).toBe('folder_is_root')
    expect(
      refuseSeedHomeRoot(process.cwd(), {}, getClaudeConfigHomeDir()),
    ).toBe('folder_holds_config')
    expect(refuseSeedHomeRoot(process.cwd(), {}, process.cwd())).toBeNull()
  })

  test('source locks ho lr + J3c h', async () => {
    const src = await Bun.file(
      new URL('../seedGitHomeRoot.ts', import.meta.url),
    ).text()
    expect(src).toContain("getPlatform() === 'wsl'")
    expect(src).toContain('/^\\/mnt(?:\\/[a-z])?\\/?$/i')
    expect(src).toContain('isWslWholeDrive(path)')
    expect(src).toContain('canonicalRootByRoot')
    expect(src).toContain('findCanonicalGitRoot')
    expect(src).toContain('h(gitRoot) ?? gitRoot')
    expect(src).toContain('canonicalRoot === gitRoot')
    expect(src).toContain('function h(e: string)')
  })

  test('gitBundle host: A4n + bHe --no-deref sweep', async () => {
    const src = await Bun.file(
      new URL('../gitBundle.ts', import.meta.url),
    ).text()
    expect(src).toContain('for-each-ref')
    expect(src).toContain('--format=%(refname)')
    expect(src).toContain('refs/seed/')
    expect(src).toContain(
      '/^refs\\/seed\\/(\\d+)-[0-9a-f]{16}\\/(?:stash|root)$/',
    )
    expect(src).toContain('7200000')
    expect(src).toContain("'update-ref', '--no-deref'")
    expect(src).toContain('could not sweep a stale seed ref')
    expect(src).toContain('runSeedGit')
    expect(src).toContain('shouldRunSeedListingGate')
    expect(src.lastIndexOf('bindSeedAdminDir')).toBeLessThan(
      src.indexOf('await sweepStaleSeedRefs('),
    )
    expect(src.indexOf('await sweepStaleSeedRefs(')).toBe(
      src.lastIndexOf('await sweepStaleSeedRefs('),
    )
    expect(src.indexOf("'--format=%(refname)'")).toBe(
      src.lastIndexOf("'--format=%(refname)'"),
    )
    expect(src).toContain('makeSeedNamedRefs')
    expect(src).toContain('randomBytes(8)')
    expect(src).toContain('refs/heads/')
    expect(src).toContain('refs/tags/')
    expect(src).toContain(
      'Repository has no local branch, tag, or checkout to seed from yet',
    )
    expect(src).toContain("'bundle', 'create'")
    expect(src).toContain("'stash', 'create'")
    expect(src.lastIndexOf('await sweepStaleSeedRefs(')).toBeLessThan(
      src.indexOf("'rev-parse', '--verify', '--quiet', 'HEAD'"),
    )
    expect(src).toContain('could not update a temporary seed ref')
    expect(src).toContain(
      'Could not write the temporary ref this upload uses under .git/refs/seed',
    )
    expect(src).toContain('seed_ref_held')
    expect(src).not.toContain(
      'Could not capture uncommitted changes (git update-ref:',
    )
  })

  test('cYn: Bc first line + yCt=300 + git_error', async () => {
    const gold = await Bun.file(
      new URL(
        '../../../../docs/upstream-extraction/v2.1.247/snippets/gold-forged-TCt-cYn.txt',
        import.meta.url,
      ),
    ).text()
    expect(gold).toContain('function TXo(e,t)')
    expect(gold).toContain('function cYn(e)')
    expect(gold).toContain('outcome:de("seed_ref_held")')
    expect(gold).toContain('bp($l(Bc(e.trim())),yCt)')
    expect(gold).toContain('failReason:"git_error"')
    const washed = seedTempRefFail('fatal: lock\nwarning: leftover\n')
    expect(washed.failReason).toBe('git_error')
    expect(washed.error).toContain('fatal: lock')
    expect(washed.error).not.toContain('warning: leftover')
    expect(washed.error).toContain('.git/refs/seed')
    const long = seedTempRefFail(`${'x'.repeat(400)}\nmore`)
    expect(long.error).toContain('… [+')
  })
})
