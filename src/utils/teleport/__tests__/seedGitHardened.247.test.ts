/**
 * densable 2.1.247 — `_583` `V` + `pe`/`qn`/`Zn`/`tr`/`Bn` + 127 `je`/`Tr`
 * + `$e`/`Qfd` + `Ie`/`cn` + `j`/`PYb`.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { delimiter, join, sep } from 'path'
import { probeSeedGitLayout } from '../seedGitLayout.js'
import {
  dropPreSettingsEnvSnapshot,
  filterSeedPath,
  getPreSettingsEnvSnapshot,
  jailSeedGitEnv,
  mergeHardenedGitEnv,
  peekPreSettingsEnvSnapshot,
  runSeedGit,
  runSeedGitHardened,
  SEED_GIT_FE,
  SEED_GIT_HARDENED_C,
  SEED_GIT_MR,
  SEED_GIT_NOT_FOUND,
  SEED_GIT_NOT_FOUND_BOUND,
  seedGitBe,
  seedGitCn,
  seedGitDollarE,
  seedGitEn,
  seedGitGt,
  seedGitIe,
  seedGitIr,
  seedGitJ,
  seedGitQo,
  seedGitRe,
  seedGitS,
  seedGitNe,
  seedGitOe,
  seedGitPn,
  seedGitQn,
  seedGitReach,
  seedGitV127,
  seedGitVArgv,
  seedGitVn,
  seedGitXt,
  seedGitZn,
  stripGitConfigAttrEnv,
} from '../seedGitHardened.js'

const prevPath = process.env.PATH
const prevTemp = process.env.TEMP
const prevTmp = process.env.TMP
const prevClaudeTmp = process.env.CLAUDE_CODE_TMPDIR

afterEach(() => {
  dropPreSettingsEnvSnapshot()
  if (prevPath === undefined) delete process.env.PATH
  else process.env.PATH = prevPath
  if (prevTemp === undefined) delete process.env.TEMP
  else process.env.TEMP = prevTemp
  if (prevTmp === undefined) delete process.env.TMP
  else process.env.TMP = prevTmp
  if (prevClaudeTmp === undefined) delete process.env.CLAUDE_CODE_TMPDIR
  else process.env.CLAUDE_CODE_TMPDIR = prevClaudeTmp
  delete process.env.SEED_GIT_J_PROBE
})

describe('densable V / pe / qn / tr / Bn', () => {
  test('tr wipes GIT_CONFIG / GIT_ATTR_SOURCE any case', () => {
    const env = stripGitConfigAttrEnv({
      PATH: '/usr/bin',
      GIT_CONFIG: '/tmp/evil',
      git_attr_source: 'info',
      GIT_ALLOW_PROTOCOL: 'file',
    })
    expect(env.GIT_CONFIG).toBeUndefined()
    expect(env.git_attr_source).toBeUndefined()
    expect(env.GIT_ATTR_SOURCE).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.GIT_ALLOW_PROTOCOL).toBe('file')
  })

  test('Bn wipes Gt / GIT_CONFIG_KEY_N then overlay wins', () => {
    const merged = mergeHardenedGitEnv(
      { GIT_DIR: '/safe/git', GIT_ALLOW_PROTOCOL: 'file' },
      {
        PATH: '/usr/bin',
        GIT_DIR: '/evil',
        GIT_CONFIG_KEY_0: 'filter.x.clean',
        OTHER: 'keep',
      },
    )
    expect(merged.GIT_DIR).toBe('/safe/git')
    expect(merged.GIT_CONFIG_KEY_0).toBeUndefined()
    expect(merged.OTHER).toBe('keep')
    expect(merged.GIT_ALLOW_PROTOCOL).toBe('file')
    expect(merged.PATH).toBe('/usr/bin')
  })

  test('pe(undefined) keeps caller env; pe(reach) drops PATH under reach', async () => {
    const jail = await mkdtemp(join(tmpdir(), 'seed-pe-'))
    const bin = join(jail, 'bin')
    await mkdir(bin)
    const kept = join(tmpdir(), 'kept-bin-not-under-jail')
    const env = {
      PATH: `${bin}${delimiter}${kept}${delimiter}/usr/bin`,
      HOME: process.env.HOME,
    }
    expect(jailSeedGitEnv(undefined, env)).toBe(env)
    const jailed = jailSeedGitEnv([jail], env)
    expect(jailed.PATH?.includes(bin)).toBe(false)
    expect(jailed.PATH?.includes(kept)).toBe(true)
  })

  test('Pr drops absolute PATH entries under reach', () => {
    const reach = [join(tmpdir(), 'bound-repo')]
    const inside = join(reach[0]!, 'tools')
    const outside = join(tmpdir(), 'ok-tools')
    const filtered = filterSeedPath(`${inside}${delimiter}${outside}`, reach)
    expect(filtered.includes(inside)).toBe(false)
    expect(filtered.includes(outside)).toBe(true)
  })

  test('qn/Be/Qn: bound reach includes workTree; Qn strips .git', () => {
    const workTree = process.cwd()
    const commonDir = join(workTree, '.git')
    expect(seedGitQn(commonDir)).toBe(workTree)
    const reach = seedGitReach(workTree, { workTree, commonDir })
    expect(reach).toContain(workTree)
    expect(seedGitBe({ bound: false, workTree, commonDir })).toBeUndefined()
    expect(seedGitBe({ bound: true, workTree, commonDir })).toEqual(reach)
  })

  test('V hardened Fe+$r + Mr + extendEnv false still runs git', async () => {
    const result = await runSeedGitHardened(process.cwd(), ['--version'], {
      stripFinalNewline: false,
    })
    expect(result.code).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('git version')
    expect(SEED_GIT_FE).toEqual([
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=',
    ])
    expect(SEED_GIT_HARDENED_C[1]).toBe('submodule.recurse=false')
    expect(SEED_GIT_MR.GIT_TERMINAL_PROMPT).toBe('0')
  })

  test('V 127 je vs Tr when spawn is null; Ir empty PATH is null', () => {
    expect(seedGitDollarE('git', '')).toBeNull()
    expect(seedGitIr({ PATH: '' })).toBeNull()
    const unbound = seedGitV127(undefined)
    expect(unbound).toEqual({
      stdout: '',
      stderr: SEED_GIT_NOT_FOUND,
      code: 127,
      exitCode: 127,
    })
    const bound = seedGitV127(['/bound'])
    expect(bound.stderr).toBe(SEED_GIT_NOT_FOUND_BOUND)
    expect(bound.code).toBe(127)
    expect(bound.exitCode).toBe(127)
    expect(bound.stdout).toBe('')
  })

  test('V !hardened argv is Fe only (no $r)', () => {
    expect(seedGitVArgv(['status'], false)).toEqual([...SEED_GIT_FE, 'status'])
    expect(seedGitVArgv(['status'], false)).not.toContain(
      'submodule.recurse=false',
    )
    expect(seedGitVArgv(['status'], true)).toEqual([
      ...SEED_GIT_FE,
      ...SEED_GIT_HARDENED_C,
      'status',
    ])
  })

  test('V !hardened runSeedGit does not pass $r and still runs git', async () => {
    const src = await Bun.file(
      new URL('../seedGitHardened.ts', import.meta.url),
    ).text()
    expect(src).toContain('seedGitVArgv(args, false)')
    expect(src).toContain('if (!opts.hardened)')
    expect(src).not.toMatch(/if \(!opts\.hardened\)[\s\S]*SEED_GIT_HARDENED_C/)
    const result = await runSeedGit(process.cwd(), ['--version'], {
      hardened: false,
    })
    expect(result.code).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('git version')
  })

  test('K4n probe uses hardened V and still reads this checkout', async () => {
    const src = await Bun.file(
      new URL('../seedGitLayout.ts', import.meta.url),
    ).text()
    expect(src).toContain('runSeedGitHardened')
    expect(src).toContain('layout.bound === true || hardened')
    expect(src).toContain('g=i?await K4n')
    const probed = await probeSeedGitLayout(process.cwd())
    expect(probed.kind).toBe('read')
    if (probed.kind === 'read') {
      expect(probed.layout.checkout).toBe('main')
      const ver = await probed.layout.run(['--version'])
      expect(ver.code).toBe(0)
    }
  })
})

describe('densable $e / Qfd / Ir', () => {
  test('$e empty or relative PATH is official null', () => {
    expect(seedGitDollarE('git', '')).toBeNull()
    expect(seedGitDollarE('git', 'relative-dir')).toBeNull()
    expect(seedGitDollarE('git', `/usr/bin${delimiter}/bin`)).toBeNull()
  })

  test('$e walks Windows-absolute PATH; Ir caches hits only', () => {
    const pathValue = process.env.PATH ?? ''
    const found = seedGitDollarE('git', pathValue)
    const viaIr = seedGitIr({ PATH: pathValue })
    expect(viaIr).toBe(found)
    expect(seedGitIr({ PATH: pathValue })).toBe(found)
    if (found !== null) {
      expect(found.toLowerCase()).toContain('git')
    }
  })
})

describe('densable j / PYb / Vn', () => {
  test('j() peeks; get freezes process-start env', () => {
    expect(seedGitJ()).toBeUndefined()
    expect(peekPreSettingsEnvSnapshot()).toBeUndefined()
    expect(seedGitVn()).toBe(process.env)
    process.env.SEED_GIT_J_PROBE = '1'
    const snap = getPreSettingsEnvSnapshot()
    expect(seedGitJ()).toBe(snap)
    expect(Object.isFrozen(snap)).toBe(true)
    expect(snap.SEED_GIT_J_PROBE).toBe('1')
    delete process.env.SEED_GIT_J_PROBE
    expect(seedGitJ()?.SEED_GIT_J_PROBE).toBe('1')
    expect(seedGitVn().SEED_GIT_J_PROBE).toBe('1')
    dropPreSettingsEnvSnapshot()
    expect(seedGitJ()).toBeUndefined()
  })

  test('V uses xe() when reach and j() are undefined', async () => {
    expect(seedGitJ()).toBeUndefined()
    const src = await Bun.file(
      new URL('../seedGitHardened.ts', import.meta.url),
    ).text()
    expect(src).toContain('reach === undefined && seedGitJ() === undefined')
    expect(src).toContain('seedGitIr(jailed)')
    expect(src).toContain('seedGitRe()')
    expect(src).toContain('getAppliedGlobalConfigEnv()')
    const result = await runSeedGitHardened(process.cwd(), ['--version'], {
      stripFinalNewline: false,
    })
    expect(result.code).toBe(0)
  })

  test('Vn overlays Re on the j() snapshot', () => {
    getPreSettingsEnvSnapshot()
    const overlay = seedGitRe()
    const vn = seedGitVn()
    for (const [key, value] of Object.entries(overlay)) {
      expect(vn[key]).toBe(value)
    }
  })
})

describe('densable Zn / Ie / cn', () => {
  test('ne/Kr list is official; pn includes oe twice then uniq', () => {
    const ne = seedGitNe()
    expect(ne).toContain('/dev/null')
    expect(ne).toContain('/tmp/claude')
    expect(ne).toContain(join(homedir(), '.claude/debug'))
    const pn = seedGitPn()
    expect(pn).toContain(seedGitOe())
    expect(pn.filter(path => path === seedGitOe())).toHaveLength(1)
    expect(pn).toContain('/dev/stdout')
  })

  test('Ie is pn when j() unset; snapshot TEMP joins basename(oe)', () => {
    expect(seedGitIe()).toEqual(seedGitPn())
    process.env.TEMP = 'D:\\seed-tmp-ie'
    delete process.env.CLAUDE_CODE_TMPDIR
    getPreSettingsEnvSnapshot()
    expect(seedGitXt(seedGitJ()!)).toBe('D:\\seed-tmp-ie')
    const ie = seedGitIe()
    expect(ie).toContain(join('D:\\seed-tmp-ie', 'claude'))
    expect(ie).toEqual(expect.arrayContaining(seedGitPn()))
  })

  test('Zn is [root,...extra,...Ie(),...cn(root)] plus realpath', async () => {
    const root = process.cwd()
    const zn = seedGitZn(root, [])
    expect(zn).toContain(root)
    for (const path of seedGitIe()) expect(zn).toContain(path)
    for (const path of seedGitCn(root)) expect(zn).toContain(path)
    const src = await Bun.file(
      new URL('../seedGitHardened.ts', import.meta.url),
    ).text()
    expect(src).toContain('...seedGitIe(), ...seedGitCn(root)')
    expect(src).toContain('SETTING_SOURCES.flatMap')
    expect(src).toContain('resolvePathPatternForSandbox')
    expect(src).toContain('resolveSandboxFilesystemPath')
    expect(src).toContain('detectWorktreeMainRepoPath')
    expect(src).toContain('getAdditionalDirectoriesForClaudeMd')
    expect(src).toContain('seedGitEn()')
  })

  test('Qo rejects windowsapps under homedir; S is mkdir 0700', () => {
    const apps = join(
      homedir(),
      'AppData',
      'Local',
      'Microsoft',
      'WindowsApps',
      'git.exe',
    )
    expect(
      seedGitQo(
        apps,
        join(homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps'),
      ),
    ).toBe(true)
    expect(seedGitS()).toBe(seedGitOe())
    expect(seedGitEn().endsWith(sep)).toBe(true)
    expect(seedGitGt('userSettings', process.cwd())).toEqual(expect.any(Array))
  })
})
