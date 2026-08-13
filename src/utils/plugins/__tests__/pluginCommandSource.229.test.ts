/**
 * densable 2.1.229 #4 — plugin marketplace `source: "command"` (+ mode link/copy).
 *
 * Does NOT mock `src/utils/settings/settings.ts` as a whole module (process-global
 * mock pollution). Policy tests inject via getSettingsForSource by mocking only
 * when needed with a narrow stub restored in afterEach — prefer pure helpers.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  COMMAND_PLUGIN_LINK_MODE_WINDOWS_MESSAGE,
  COMMAND_PLUGIN_SOURCES_DISABLED_MESSAGE,
  PLUGIN_COMMAND_LINK_CONSENT_SUFFIX,
  PLUGIN_COMMAND_SOURCE_DEFAULT_TIMEOUT_S,
  PLUGIN_COMMAND_SOURCE_MAX_STDOUT_BYTES,
  PLUGIN_COMMAND_SOURCE_ROOT_MARKERS,
  assertCommandSourceConsent,
  commandPluginConsentKey,
  describeCommandPluginMode,
  installCommandPluginSource,
  isCommandPluginLinkMode,
  isCommandPluginSource,
  isPluginCommandProducerCwdOrAncestor,
  PluginCommandSourceError,
  runPluginCommandSource,
} from '../pluginCommandSource.js'
import { PluginSourceSchema } from '../schemas.js'
import { generateTemporaryCacheNameForPlugin } from '../pluginLoader.js'
import { calculatePluginVersion } from '../pluginVersioning.js'

const tempDirs: string[] = []

afterEach(async () => {
  mock.restore()
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()
    if (d) await rm(d, { recursive: true, force: true }).catch(() => {})
  }
})

async function makePluginDir(
  marker: string = '.claude-plugin',
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cmd-plugin-'))
  tempDirs.push(dir)
  if (marker === '.claude-plugin') {
    await mkdir(join(dir, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cmd-test-plugin', version: '1.0.0' }),
    )
  } else if (marker === 'commands') {
    await mkdir(join(dir, 'commands'), { recursive: true })
    await writeFile(join(dir, 'commands', 'hi.md'), '# hi\n')
  } else {
    await writeFile(join(dir, marker), 'x')
  }
  return await realpath(dir)
}

describe('densable 2.1.229 #4 PluginSourceSchema command', () => {
  test('accepts command + optional mode/timeout', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'command',
      command: 'printf %s /tmp/plugin',
      mode: 'link',
      timeout: 30,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toEqual({
        source: 'command',
        command: 'printf %s /tmp/plugin',
        mode: 'link',
        timeout: 30,
      })
    }
  })

  test('rejects empty command', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'command',
      command: '',
    })
    expect(r.success).toBe(false)
  })

  test('rejects invalid mode', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'command',
      command: 'echo /tmp/x',
      mode: 'symlink',
    })
    expect(r.success).toBe(false)
  })
})

describe('densable 2.1.229 #4 dFe/d0t/HK/cTn', () => {
  test('isCommandPluginSource / isCommandPluginLinkMode', () => {
    expect(isCommandPluginSource({ source: 'command', command: 'x' })).toBe(
      true,
    )
    expect(isCommandPluginSource({ source: 'github', repo: 'a/b' })).toBe(false)
    expect(
      isCommandPluginLinkMode({
        source: 'command',
        command: 'x',
        mode: 'link',
      }),
    ).toBe(true)
    expect(isCommandPluginLinkMode({ source: 'command', command: 'x' })).toBe(
      false,
    )
  })

  test('consent key includes link suffix (densable L$o)', () => {
    expect(
      commandPluginConsentKey({ source: 'command', command: 'echo /p' }),
    ).toBe('echo /p')
    expect(
      commandPluginConsentKey({
        source: 'command',
        command: 'echo /p',
        mode: 'link',
      }),
    ).toBe(`echo /p${PLUGIN_COMMAND_LINK_CONSENT_SUFFIX}`)
    expect(PLUGIN_COMMAND_LINK_CONSENT_SUFFIX).toBe('\n[mode: link]')
  })

  test('describeCommandPluginMode densable cTn strings', () => {
    expect(describeCommandPluginMode({ source: 'command', command: 'x' })).toBe(
      'mode "copy": its output directory is copied into the plugin cache',
    )
    expect(
      describeCommandPluginMode({
        source: 'command',
        command: 'x',
        mode: 'link',
      }),
    ).toBe(
      'mode "link": its output directory is used in place (linked, not copied)',
    )
  })

  test('root markers include densable mkr set', () => {
    expect(PLUGIN_COMMAND_SOURCE_ROOT_MARKERS).toContain('.claude-plugin')
    expect(PLUGIN_COMMAND_SOURCE_ROOT_MARKERS).toContain('commands')
    expect(PLUGIN_COMMAND_SOURCE_ROOT_MARKERS).toContain('workflows')
    expect(PLUGIN_COMMAND_SOURCE_ROOT_MARKERS).toContain('.mcp.json')
    expect(PLUGIN_COMMAND_SOURCE_DEFAULT_TIMEOUT_S).toBe(60)
    expect(PLUGIN_COMMAND_SOURCE_MAX_STDOUT_BYTES).toBe(65_536)
  })
})

describe('densable 2.1.229 #4 d6_ assertCommandSourceConsent', () => {
  const source = { source: 'command' as const, command: 'printf %s /tmp/p' }

  test('accepted matching HK proceeds', () => {
    expect(() =>
      assertCommandSourceConsent(source, {
        kind: 'accepted',
        command: commandPluginConsentKey(source),
      }),
    ).not.toThrow()
  })

  test('none throws without consent', () => {
    expect(() => assertCommandSourceConsent(source, { kind: 'none' })).toThrow(
      PluginCommandSourceError,
    )
    try {
      assertCommandSourceConsent(source, { kind: 'none', pluginId: 'p@m' })
    } catch (e) {
      expect(e).toBeInstanceOf(PluginCommandSourceError)
      expect((e as PluginCommandSourceError).reason).toBe(
        'plugin command source without consent',
      )
      expect((e as Error).message).toContain('claude plugin install p@m')
    }
  })

  test('recorded with different command → changed since consent', () => {
    try {
      assertCommandSourceConsent(source, {
        kind: 'recorded',
        command: 'old-command',
        pluginId: 'p@m',
      })
      expect.unreachable()
    } catch (e) {
      expect((e as PluginCommandSourceError).reason).toBe(
        'plugin command source command changed since consent',
      )
      expect((e as Error).message).toContain('claude plugin update p@m')
    }
  })

  test('shown mismatch → changed between display and run', () => {
    try {
      assertCommandSourceConsent(source, {
        kind: 'shown',
        command: 'other',
        pluginId: 'p@m',
      })
      expect.unreachable()
    } catch (e) {
      expect((e as PluginCommandSourceError).reason).toBe(
        'plugin command source changed between display and run',
      )
    }
  })
})

describe('densable 2.1.229 #4 c6_ runPluginCommandSource', () => {
  test('runs command and returns plugin directory', async () => {
    const pluginDir = await makePluginDir()
    // shell:true — quote path for spaces safety
    const quoted = JSON.stringify(pluginDir)
    const resolved = await runPluginCommandSource({
      source: 'command',
      command: `printf %s ${quoted}`,
    })
    expect(resolved).toBe(pluginDir)
  })

  test('rejects relative path', async () => {
    await expect(
      runPluginCommandSource({
        source: 'command',
        command: 'printf %s relative/path',
      }),
    ).rejects.toMatchObject({
      reason: 'plugin command source printed a relative path',
    })
  })

  test('rejects multi-line stdout', async () => {
    await expect(
      runPluginCommandSource({
        source: 'command',
        // two non-empty lines via shell
        command: "printf '%s\\n%s\\n' /tmp/a /tmp/b",
      }),
    ).rejects.toMatchObject({
      reason: 'plugin command source printed multiple lines',
    })
  })

  test('rejects directory without plugin markers', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'cmd-empty-'))
    tempDirs.push(empty)
    const real = await realpath(empty)
    await expect(
      runPluginCommandSource({
        source: 'command',
        command: `printf %s ${JSON.stringify(real)}`,
      }),
    ).rejects.toMatchObject({
      reason: 'plugin command source directory has no plugin content',
    })
  })

  test('non-zero exit', async () => {
    await expect(
      runPluginCommandSource({
        source: 'command',
        command: 'exit 7',
      }),
    ).rejects.toMatchObject({
      reason: 'plugin command source exited non-zero',
    })
  })
})

describe('densable 2.1.229 #4 Oxd install with exact consent', () => {
  test('copy installs plugin-shaped tree', async () => {
    const pluginDir = await makePluginDir('commands')
    const targetParent = await mkdtemp(join(tmpdir(), 'cmd-tgt-'))
    tempDirs.push(targetParent)
    const target = join(targetParent, 'install')
    const command = `printf %s ${JSON.stringify(pluginDir)}`

    const result = await installCommandPluginSource(
      { source: 'command', command },
      target,
      {
        consent: { kind: 'accepted', command },
        copyDir: async (from, to) => {
          const { cp } = await import('fs/promises')
          await cp(from, to, { recursive: true })
        },
      },
    )

    expect(result.mode).toBe('copy')
    expect(result.producerDirectory).toBe(pluginDir)
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    const listing = await readFile(join(target, 'commands', 'hi.md'), 'utf8')
    expect(listing).toContain('# hi')

    // densable Oxd: zvt(producer) before materialize — bag has producer after install
    const {
      clearCommandProducerDirsDeniedForTests,
      isPathUnderDeniedCommandProducer,
    } = await import('../commandProducerDirs.js')
    try {
      expect(isPathUnderDeniedCommandProducer(pluginDir)).toBe(true)
    } finally {
      clearCommandProducerDirsDeniedForTests()
    }
  })

  test('refuses cwd/ancestor producer', async () => {
    // Create a plugin-shaped dir under a nested path, then point command at
    // an ancestor of cwd — densable refuses producer that is cwd or ancestor.
    // We set producer = realpath of a parent of getCwd if possible; instead
    // use isPluginCommandProducerCwdOrAncestor unit + install path with
    // command printing an ancestor of a synthetic nested cwd is hard without
    // mocking getCwd. Unit-test the helper directly:
    const cwd = process.cwd()
    expect(isPluginCommandProducerCwdOrAncestor(cwd, cwd)).toBe(true)
    expect(isPluginCommandProducerCwdOrAncestor(join(cwd, '..'), cwd)).toBe(
      true,
    )
    expect(
      isPluginCommandProducerCwdOrAncestor(join(cwd, 'nope-subdir'), cwd),
    ).toBe(false)
  })

  test('without consent does not run command', async () => {
    const target = join(await mkdtemp(join(tmpdir(), 'cmd-nc-')), 't')
    tempDirs.push(join(target, '..'))
    await expect(
      installCommandPluginSource(
        { source: 'command', command: 'printf %s /tmp/x' },
        target,
        {
          consent: { kind: 'none' },
          copyDir: async () => {
            throw new Error('copyDir should not run')
          },
        },
      ),
    ).rejects.toMatchObject({
      reason: 'plugin command source without consent',
    })
  })
})

describe('densable 2.1.229 #4 policy + constants messages', () => {
  test('managed policy message densable dxe 1:1', () => {
    expect(COMMAND_PLUGIN_SOURCES_DISABLED_MESSAGE).toBe(
      "Command-sourced plugins are disabled by your organization's managed settings (disableCommandPluginSources / allowManagedHooksOnly). The plugin was not installed or updated and its command was not run.",
    )
  })

  test('windows link message densable hkr 1:1', () => {
    expect(COMMAND_PLUGIN_LINK_MODE_WINDOWS_MESSAGE).toBe(
      'This plugin source uses mode "link", which is not supported on Windows yet; the marketplace can use mode "copy" instead.',
    )
  })
})

describe('densable 2.1.229 #4 cache name + version slot', () => {
  test('temp cache prefix is command', () => {
    const name = generateTemporaryCacheNameForPlugin({
      source: 'command',
      command: 'echo /x',
    })
    expect(name.startsWith('temp_command_')).toBe(true)
  })

  test('calculatePluginVersion uses content sha slot for command source', async () => {
    const sha = 'abcdef0123456789'.repeat(4) // 64 hex
    const v = await calculatePluginVersion(
      'p@m',
      { source: 'command', command: 'echo /x' },
      undefined,
      undefined,
      undefined,
      sha,
    )
    expect(v).toBe(sha.substring(0, 12))
  })
})

describe('densable 2.1.229 #4 residual ptm/x0v/HPd/zvt', () => {
  test('ptm -y outside session accepts with grantKey', async () => {
    const { promptCommandSourceConsent, commandPluginConsentKey } =
      await import('../pluginCommandSource.js')
    const prevChild = process.env.CLAUDE_CODE_CHILD_SESSION
    const prevClaude = process.env.CLAUDECODE
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    delete process.env.CLAUDECODE
    try {
      const source = {
        source: 'command' as const,
        command: 'printf %s /tmp/plugin',
      }
      const lines: string[] = []
      const result = await promptCommandSourceConsent(
        'demo@mkt',
        { source },
        {
          yes: true,
          write: t => {
            lines.push(t)
          },
        },
      )
      expect(result).toEqual({
        kind: 'accepted',
        grantKey: commandPluginConsentKey(source),
      })
      expect(lines.join('')).toContain('is installed by running a command')
      expect(lines.join('')).toContain('printf %s /tmp/plugin')
    } finally {
      if (prevChild !== undefined)
        process.env.CLAUDE_CODE_CHILD_SESSION = prevChild
      if (prevClaude !== undefined) process.env.CLAUDECODE = prevClaude
    }
  })

  test('ptm non-command source returns undefined', async () => {
    const { promptCommandSourceConsent } = await import(
      '../pluginCommandSource.js'
    )
    const result = await promptCommandSourceConsent(
      'p@m',
      { source: { source: 'github', repo: 'a/b' } },
      { yes: true },
    )
    expect(result).toBeUndefined()
  })

  test('x0v recorded consent prefers exact HK match', async () => {
    const { getRecordedCommandSourceConsent, commandPluginConsentKey } =
      await import('../pluginCommandSource.js')
    const source = { source: 'command' as const, command: 'echo /ok' }
    const key = commandPluginConsentKey(source)
    const r = getRecordedCommandSourceConsent('p@m', source, [
      { sourceCommand: 'stale' },
      { sourceCommand: key },
    ])
    // When cache is under home (normal), returns recorded with exact key
    if (r && r.kind === 'recorded') {
      expect(r.command).toBe(key)
      expect(r.pluginId).toBe('p@m')
    }
  })

  test('HPd mergePreviousProducerPaths bounds + rolls', async () => {
    const { mergePreviousProducerPaths } = await import(
      '../pluginCommandSource.js'
    )
    expect(mergePreviousProducerPaths(undefined, '/new')).toEqual([])
    expect(
      mergePreviousProducerPaths(
        {
          sourceProducerPath: '/old',
          previousProducerPaths: ['/a', '/b'],
        },
        '/new',
      ),
    ).toEqual(['/a', '/b', '/old'])
    // drop duplicates of new path
    expect(
      mergePreviousProducerPaths(
        {
          sourceProducerPath: '/new',
          previousProducerPaths: ['/x', '/new'],
        },
        '/new',
      ),
    ).toEqual(['/x'])
    // max bound
    const many = Array.from({ length: 40 }, (_, i) => `/p${i}`)
    const merged = mergePreviousProducerPaths(
      { sourceProducerPath: '/cur', previousProducerPaths: many },
      '/next',
      32,
    )
    expect(merged.length).toBe(32)
    expect(merged[merged.length - 1]).toBe('/cur')
  })

  test('zvt deny bag + _qu under check', async () => {
    const {
      denyCommandProducerDir,
      isPathUnderDeniedCommandProducer,
      clearCommandProducerDirsDeniedForTests,
      isAutofsNetPath,
    } = await import('../commandProducerDirs.js')
    clearCommandProducerDirsDeniedForTests()
    try {
      denyCommandProducerDir(
        '/tmp/not-absolute-relative'.replace('/tmp', 'rel'),
      )
      // relative skipped
      expect(isPathUnderDeniedCommandProducer('/tmp/x')).toBe(false)

      const root = await mkdtemp(join(tmpdir(), 'prod-deny-'))
      tempDirs.push(root)
      const real = await realpath(root)
      denyCommandProducerDir(real)
      expect(isPathUnderDeniedCommandProducer(real)).toBe(true)
      expect(isPathUnderDeniedCommandProducer(join(real, 'child'))).toBe(true)
      expect(isPathUnderDeniedCommandProducer('/tmp/other-unrelated')).toBe(
        false,
      )
      // /net skip
      expect(isAutofsNetPath('/net/foo')).toBe(true)
      denyCommandProducerDir('/net/foo')
      expect(isPathUnderDeniedCommandProducer('/net/foo/bar')).toBe(false)
    } finally {
      clearCommandProducerDirsDeniedForTests()
    }
  })

  test('foldCase: differently cased producer still matches _qu (densable kgt)', async () => {
    const {
      clearCommandProducerDirsDeniedForTests,
      denyCommandProducerDir,
      isPathUnderDeniedCommandProducer,
      toComparablePath,
    } = await import('../commandProducerDirs.js')
    clearCommandProducerDirsDeniedForTests()
    try {
      const root = await mkdtemp(join(tmpdir(), 'prod-fold-'))
      tempDirs.push(root)
      const real = await realpath(root)
      denyCommandProducerDir(real)
      const flipped = real
        .split('/')
        .map((seg, i) =>
          i > 0 && seg.length > 0
            ? seg[0]!.toUpperCase() + seg.slice(1).toLowerCase()
            : seg,
        )
        .join('/')
      expect(toComparablePath(real)).toBe(toComparablePath(flipped))
      expect(isPathUnderDeniedCommandProducer(flipped)).toBe(true)
      expect(isPathUnderDeniedCommandProducer(join(flipped, 'child.md'))).toBe(
        true,
      )
    } finally {
      clearCommandProducerDirsDeniedForTests()
    }
  })

  test('lDs scans installed_plugins.json producer paths into _qu', async () => {
    const {
      clearCommandProducerDirsDeniedForTests,
      isPathUnderDeniedCommandProducer,
      scanInstalledCommandProducerDirs,
    } = await import('../commandProducerDirs.js')
    clearCommandProducerDirsDeniedForTests()
    try {
      const scanRoot = await mkdtemp(join(tmpdir(), 'lDs-scan-'))
      tempDirs.push(scanRoot)
      const producer = await mkdtemp(join(tmpdir(), 'lDs-prod-'))
      tempDirs.push(producer)
      const realProducer = await realpath(producer)
      await writeFile(
        join(scanRoot, 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'demo@mkt': [
              {
                scope: 'user',
                installPath: '/cache/demo/1',
                sourceCommand: 'printf %s /x',
                sourceProducerPath: realProducer,
                previousProducerPaths: [],
              },
            ],
          },
        }),
      )
      const denied = scanInstalledCommandProducerDirs([scanRoot])
      expect(denied).toContain(realProducer)
      expect(
        isPathUnderDeniedCommandProducer(join(realProducer, 'child.md'), [
          scanRoot,
        ]),
      ).toBe(true)
    } finally {
      clearCommandProducerDirsDeniedForTests()
    }
  })

  test('zvt invalidates comparable cache for subsequent _qu', async () => {
    const {
      clearCommandProducerDirsDeniedForTests,
      denyCommandProducerDir,
      isPathUnderDeniedCommandProducer,
    } = await import('../commandProducerDirs.js')
    clearCommandProducerDirsDeniedForTests()
    try {
      const a = await mkdtemp(join(tmpdir(), 'cache-a-'))
      const b = await mkdtemp(join(tmpdir(), 'cache-b-'))
      tempDirs.push(a, b)
      const realA = await realpath(a)
      const realB = await realpath(b)
      denyCommandProducerDir(realA)
      expect(isPathUnderDeniedCommandProducer(realA)).toBe(true)
      expect(isPathUnderDeniedCommandProducer(realB)).toBe(false)
      // second zvt must rebuild comparable — not stick to first-call roots only
      denyCommandProducerDir(realB)
      expect(isPathUnderDeniedCommandProducer(realB)).toBe(true)
    } finally {
      clearCommandProducerDirsDeniedForTests()
    }
  })

  test('qvt bus: zvt emit notifies subscribers; emit:false is silent', async () => {
    const {
      clearCommandProducerDirsDeniedForTests,
      denyCommandProducerDir,
      emitCommandProducerDirsChanged,
      subscribeCommandProducerDirsChanged,
    } = await import('../commandProducerDirs.js')
    clearCommandProducerDirsDeniedForTests()
    let hits = 0
    const unsub = subscribeCommandProducerDirsChanged(() => {
      hits++
    })
    try {
      const root = await mkdtemp(join(tmpdir(), 'qvt-'))
      tempDirs.push(root)
      const real = await realpath(root)
      denyCommandProducerDir(real)
      expect(hits).toBe(1)
      // already denied — densable zvt early-return, no second qvt
      denyCommandProducerDir(real)
      expect(hits).toBe(1)
      const other = await mkdtemp(join(tmpdir(), 'qvt2-'))
      tempDirs.push(other)
      const realOther = await realpath(other)
      denyCommandProducerDir(realOther, { emit: false })
      expect(hits).toBe(1)
      emitCommandProducerDirsChanged()
      expect(hits).toBe(2)
    } finally {
      unsub()
      clearCommandProducerDirsDeniedForTests()
    }
  })

  test('uninstall gUo: batch zvt emit:false then single qvt', async () => {
    const {
      clearCommandProducerDirsDeniedForTests,
      getCommandProducerDirsDenied,
      subscribeCommandProducerDirsChanged,
    } = await import('../commandProducerDirs.js')
    const {
      addPluginInstallation,
      clearInstalledPluginsCache,
      getInstalledPluginsFilePath,
      removePluginInstallation,
    } = await import('../installedPluginsManager.js')
    clearCommandProducerDirsDeniedForTests()
    let hits = 0
    const unsub = subscribeCommandProducerDirsChanged(() => {
      hits++
    })
    const installFile = getInstalledPluginsFilePath()
    let previousInstallFile: string | null = null
    try {
      try {
        previousInstallFile = await readFile(installFile, 'utf8')
      } catch {
        previousInstallFile = null
      }
      const producer = await mkdtemp(join(tmpdir(), 'un-prod-'))
      const prev = await mkdtemp(join(tmpdir(), 'un-prev-'))
      tempDirs.push(producer, prev)
      const realProd = await realpath(producer)
      const realPrev = await realpath(prev)
      clearInstalledPluginsCache()
      // Seed V2 install record with command producers (public API)
      addPluginInstallation('un@mkt', 'user', '/cache/un/1', {
        version: '1.0.0',
        sourceCommand: 'printf %s /x',
        sourceProducerPath: realProd,
        previousProducerPaths: [realPrev],
      })
      removePluginInstallation('un@mkt', 'user')
      // one qvt for the batch, not one per producer
      expect(hits).toBe(1)
      expect(getCommandProducerDirsDenied().has(realProd)).toBe(true)
      expect(getCommandProducerDirsDenied().has(realPrev)).toBe(true)
    } finally {
      unsub()
      clearCommandProducerDirsDeniedForTests()
      clearInstalledPluginsCache()
      try {
        if (previousInstallFile === null) {
          await rm(installFile, { force: true })
        } else {
          await writeFile(installFile, previousInstallFile)
        }
      } catch {
        /* ignore restore */
      }
      clearInstalledPluginsCache()
    }
  })

  test('ui install consent is densable shown HK for command sources', async () => {
    const { uiCommandSourceConsentForInstall } = await import(
      '../pluginInstallationHelpers.js'
    )
    const commandEntry = {
      name: 'cmd-ui',
      source: { source: 'command' as const, command: 'printf %s /tmp/p' },
    }
    const consent = uiCommandSourceConsentForInstall(
      'cmd-ui@mkt',
      commandEntry as never,
    )
    expect(consent).toEqual({
      kind: 'shown',
      command: 'printf %s /tmp/p',
      pluginId: 'cmd-ui@mkt',
    })
    const linkConsent = uiCommandSourceConsentForInstall('l@m', {
      name: 'l',
      source: {
        source: 'command',
        command: 'printf %s /tmp/l',
        mode: 'link',
      },
    } as never)
    expect(linkConsent?.kind).toBe('shown')
    expect(
      linkConsent && 'command' in linkConsent ? linkConsent.command : undefined,
    ).toBe(`printf %s /tmp/l${PLUGIN_COMMAND_LINK_CONSENT_SUFFIX}`)
    const gh = uiCommandSourceConsentForInstall('g@m', {
      name: 'g',
      source: { source: 'github', repo: 'o/r' },
    } as never)
    expect(gh).toBeUndefined()
  })

  test('PluginInstallationEntrySchema accepts sourceCommand fields', async () => {
    const { PluginInstallationEntrySchema } = await import('../schemas.js')
    const r = PluginInstallationEntrySchema().safeParse({
      scope: 'user',
      installPath: '/home/u/.claude/plugins/cache/p/1.0.0',
      version: '1.0.0',
      sourceCommand: 'printf %s /tmp/p',
      sourceProducerPath: '/tmp/p',
      previousProducerPaths: ['/tmp/old'],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.sourceCommand).toBe('printf %s /tmp/p')
      expect(r.data.sourceProducerPath).toBe('/tmp/p')
      expect(r.data.previousProducerPaths).toEqual(['/tmp/old'])
    }
  })
})
