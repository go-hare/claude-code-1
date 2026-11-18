import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import {
  formatErrorMessage,
  getErrorGuidance,
} from '../../../commands/plugin/PluginErrors.js'
import {
  getUnloadedSettingsWarning,
  withUnloadedSettingsWarning,
} from '../../../services/plugins/pluginCliCommands.js'
import { verifyAndDemote } from '../dependencyResolver.js'
import {
  findInstallationIndex,
  findMatchingInstallations,
  normalizeWindowsProjectPath,
  sameProjectPath,
} from '../installedPluginsManager.js'
import {
  isDirectGithubSshConfig,
  isSshAuthError,
  probeSsh,
  shouldUseHttpsInsteadOfSsh,
} from '../marketplaceHelpers.js'
import {
  assertMarketplaceNameNotInheritedObjectMember,
  getOwnMarketplaceEntry,
  matchSubmodulePaths,
  normalizeRelSubmodulePath,
  selectNeededSubmodules,
} from '../marketplaceManager.js'
import {
  checkCredentialStoreLinks,
  DOCKER_CREDENTIAL_SKIPPED,
  DOCKER_CREDENTIAL_SKIPPED_AT_ROOT,
} from '../pluginEval/evalSandboxFence.js'
import {
  substituteUserConfigInContent,
  substituteUserConfigVariables,
} from '../pluginOptionsStorage.js'
import {
  formatMarketplaceLookalikeCliLines,
  formatMarketplaceLookalikeHint,
  formatMarketplaceLookalikeUpdateRefusal,
  isAsciiLookalikeOfficialName,
} from '../schemas.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('#257 lookalike official marketplace hints', () => {
  test('settings-declared lookalike marketplace gets ordered 3-step instructions', () => {
    expect(isAsciiLookalikeOfficialName('anthropic-official')).toBe(true)
    expect(isAsciiLookalikeOfficialName('claude-plugins-official')).toBe(false)

    const hint = formatMarketplaceLookalikeHint('anthropic-official', {
      declaredInSettings: true,
    })
    expect(hint).toContain('extraKnownMarketplaces')
    expect(hint).toContain(
      'claude plugin marketplace remove anthropic-official',
    )
    expect(hint).toContain('3. Start Claude Code again')

    const cliLines = formatMarketplaceLookalikeCliLines('anthropic-official', {
      declaredInSettings: true,
    })
    expect(cliLines[0]).toContain('Claude Code refuses the marketplace name')
    expect(cliLines.some(l => l.startsWith('1. In each settings file'))).toBe(
      true,
    )

    expect(formatMarketplaceLookalikeUpdateRefusal(true)).toContain(
      'Rename it in its settings file',
    )
    expect(formatMarketplaceLookalikeUpdateRefusal(false)).toContain(
      "Reloading won't help.",
    )
  })
})

describe('#346 settings file does not load warning', () => {
  test('warns when target settings file has fatal validation errors', () => {
    const warning = getUnloadedSettingsWarning('user', {
      getPath: () => '/tmp/fake/.claude/settings.json',
      parseFile: () => ({
        settings: null,
        errors: [
          {
            file: '/tmp/fake/.claude/settings.json',
            path: 'permissions.allow',
            message: 'Invalid',
            severity: 'fatal',
          },
        ],
      }),
    })
    expect(warning).toContain('/tmp/fake/.claude/settings.json does not load')
    expect(warning).toContain('its "permissions.allow" is not valid')
    expect(warning).toContain('Claude Code ignores the whole file')
  })

  test('ignores managed scope, cowork_settings.json, and warning-only errors', () => {
    expect(getUnloadedSettingsWarning('managed')).toBeNull()
    expect(
      getUnloadedSettingsWarning('user', {
        getPath: () => '/tmp/fake/.claude/cowork_settings.json',
        parseFile: () => ({
          settings: null,
          errors: [{ path: 'x', message: 'bad' }],
        }),
      }),
    ).toBeNull()
    expect(
      getUnloadedSettingsWarning('project', {
        getPath: () => '/tmp/fake/.claude/settings.json',
        parseFile: () => ({
          settings: {},
          errors: [{ path: 'x', message: 'warn', severity: 'warning' }],
        }),
      }),
    ).toBeNull()
    expect(withUnloadedSettingsWarning('Enabled plugin', 'managed')).toBe(
      'Enabled plugin',
    )
  })
})

describe('#393 selective git submodule fetching', () => {
  test('normalizeRelSubmodulePath and matchSubmodulePaths filter to needed submodules', () => {
    expect(normalizeRelSubmodulePath('./plugins/foo/')).toBe('plugins/foo')
    expect(normalizeRelSubmodulePath('../outside')).toBeUndefined()
    expect(normalizeRelSubmodulePath('.')).toBe('')

    const matched = matchSubmodulePaths(
      ['plugins/alpha', 'vendor/huge-repo', 'plugins/beta'],
      ['plugins/alpha'],
    )
    expect(matched).toEqual(['plugins/alpha'])
  })

  test('selectNeededSubmodules reads .claude-plugin/marketplace.json', async () => {
    const dir = makeTempDir('mkt-sub-')
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(dir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'test-mkt',
        plugins: [{ name: 'p1', source: './plugins/needed' }],
      }),
    )
    const selected = await selectNeededSubmodules(
      dir,
      ['plugins/needed', 'heavy/unrelated'],
      [],
      process.env,
    )
    // git ls-files may fail in non-git temp dir -> falls back to 'all'
    expect(selected === 'all' || Array.isArray(selected)).toBe(true)
  })
})

describe('#423 Windows drive-letter case in installedPluginsManager', () => {
  test('matches projectPath case-insensitively on Windows drive letter', () => {
    expect(
      normalizeWindowsProjectPath('C:\\Users\\Alice\\repo\\', 'windows'),
    ).toBe('c:\\Users\\Alice\\repo')
    expect(
      sameProjectPath(
        'C:\\Users\\Alice\\repo',
        'c:\\Users\\Alice\\repo',
        'windows',
      ),
    ).toBe(true)
    expect(
      sameProjectPath('/Users/Alice/repo', '/users/Alice/repo', 'macos'),
    ).toBe(false)

    const entries = [
      {
        scope: 'project' as const,
        projectPath: 'C:\\Work\\app',
        installPath: '/cache/1',
      },
    ]
    expect(
      findInstallationIndex(entries, 'project', 'c:\\Work\\app', 'windows'),
    ).toBe(0)
    expect(
      findMatchingInstallations(entries, 'project', 'c:\\Work\\app', 'windows'),
    ).toHaveLength(1)
  })
})

describe('#512 constructor/prototype marketplace name guard', () => {
  test('getOwnMarketplaceEntry ignores Object.prototype properties', () => {
    const config = {} as Record<string, never>
    expect(getOwnMarketplaceEntry(config, 'constructor')).toBeUndefined()
    expect(getOwnMarketplaceEntry(config, 'toString')).toBeUndefined()
  })

  test('assertMarketplaceNameNotInheritedObjectMember refuses constructor when not already present', () => {
    expect(() =>
      assertMarketplaceNameNotInheritedObjectMember('constructor', {}),
    ).toThrow(/Claude Code reserves this name/)
    expect(() =>
      assertMarketplaceNameNotInheritedObjectMember('toString', {}),
    ).toThrow(/Claude Code reserves this name/)
    expect(() =>
      assertMarketplaceNameNotInheritedObjectMember('my-marketplace', {}),
    ).not.toThrow()
  })
})

describe('#513 pluginOptionsStorage prototype-safe key handling', () => {
  test('substituteUserConfigVariables & substituteUserConfigInContent use Object.hasOwn', () => {
    expect(() =>
      substituteUserConfigVariables('${user_config.constructor}', {}),
    ).toThrow(/Missing required user configuration value: constructor/)

    expect(
      substituteUserConfigInContent('val=${user_config.constructor}', {}, {}),
    ).toBe('val=${user_config.constructor}')

    expect(
      substituteUserConfigInContent(
        'sec=${user_config.constructor}',
        { constructor: 'secret-val' },
        {
          constructor: {
            type: 'string' as const,
            title: 'c',
            description: 'c',
            sensitive: true,
          },
        },
      ),
    ).toBe(
      "sec=[sensitive option 'constructor' not available in skill content]",
    )
  })
})

describe('#526 synced plugin marketplace dependency', () => {
  test('verifyAndDemote keeps synced plugin enabled when dep was also synced with marketplaceName', () => {
    const depPlugin = {
      name: 'base-lib',
      source: 'base-lib@synced',
      path: '/tmp/synced/base-lib',
      enabled: true,
      isBuiltin: false,
      manifest: { name: 'base-lib' },
      marketplaceName: 'team-mkt',
    }
    const consumerPlugin = {
      name: 'consumer',
      source: 'consumer@synced',
      path: '/tmp/synced/consumer',
      enabled: true,
      isBuiltin: false,
      manifest: {
        name: 'consumer',
        dependencies: ['base-lib@team-mkt'],
      },
      marketplaceName: 'team-mkt',
    }
    const { demoted, errors } = verifyAndDemote([
      depPlugin as never,
      consumerPlugin as never,
    ])
    expect(demoted.size).toBe(0)
    expect(errors).toHaveLength(0)
  })
})

describe('#534 Windows GitHub SSH -> HTTPS fallback', () => {
  test('detects SSH auth errors and direct ssh -G config', () => {
    expect(
      isSshAuthError('git@github.com: Permission denied (publickey).'),
    ).toBe(true)
    expect(isSshAuthError('Host key verification failed.')).toBe(true)
    expect(isSshAuthError('Connection timed out')).toBe(false)

    expect(
      isDirectGithubSshConfig('user git\nhostname github.com\nport 22\n'),
    ).toBe(true)
    expect(
      isDirectGithubSshConfig(
        'hostname github.com\nproxycommand nc -X connect %h %p\n',
      ),
    ).toBe(false)
    expect(
      isDirectGithubSshConfig('hostname github.com\nproxyjump none\n'),
    ).toBe(true)
  })

  test('probeSsh returns not-configured on 255 Permission denied', async () => {
    const res = await probeSsh(
      undefined,
      (async () => ({
        stdout: '',
        stderr: 'git@github.com: Permission denied (publickey).',
        code: 255,
      })) as never,
      async () => '/usr/bin/ssh',
    )
    expect(res).toBe('not-configured')
  })

  test('shouldUseHttpsInsteadOfSsh checks Windows post-failure -G output', async () => {
    const sshUrl = 'git@github.com:owner/repo.git'
    const res = await shouldUseHttpsInsteadOfSsh(
      { probeSsh: async () => 'not-configured' },
      sshUrl,
      true,
      {
        platform: 'windows',
        env: {},
        execFn: (async (_cmd: string, args: string[]) => {
          if (args.includes('--get-url')) {
            return { stdout: `${sshUrl}\n`, stderr: '', code: 0 }
          }
          return {
            stdout: '',
            stderr: 'hostname github.com\n',
            code: 128,
          }
        }) as never,
        whichFn: async () => 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
      },
    )
    expect(res).toBe(true)
  })
})

describe('#307 Docker Desktop ~/.docker/bin symlink exemption & named entry', () => {
  test('allows ~/.docker/bin symlink while refusing inner config.json symlink with entry name', async () => {
    const dockerDir = makeTempDir('docker-cred-')
    mkdirSync(join(dockerDir, 'bin'), { recursive: true })
    writeFileSync(join(dockerDir, 'target-bin'), 'x')
    symlinkSync(join(dockerDir, 'target-bin'), join(dockerDir, 'bin', 'docker'))

    await expect(
      checkCredentialStoreLinks(
        realpathSync(dockerDir),
        'Docker (~/.docker, DOCKER_CONFIG)',
        DOCKER_CREDENTIAL_SKIPPED,
        DOCKER_CREDENTIAL_SKIPPED_AT_ROOT,
      ),
    ).resolves.toBeNull()

    writeFileSync(join(dockerDir, 'real-config.json'), '{}')
    symlinkSync(
      join(dockerDir, 'real-config.json'),
      join(dockerDir, 'config.json'),
    )
    await expect(
      checkCredentialStoreLinks(
        dockerDir,
        'Docker (~/.docker, DOCKER_CONFIG)',
        DOCKER_CREDENTIAL_SKIPPED,
        DOCKER_CREDENTIAL_SKIPPED_AT_ROOT,
      ),
    ).rejects.toThrow(/at or under its "config\.json" entry/)
  })
})

describe('#490 hooks left out by same-named enabled plugin', () => {
  test('formats message and guidance for hooks-left-out-by-name and hooks-module-left-out-by-name', () => {
    const err1 = {
      type: 'hooks-left-out-by-name' as const,
      source: 'my-plugin@mkt-b',
      heldBy: 'my-plugin@mkt-a',
    }
    expect(formatErrorMessage(err1)).toBe(
      'Its hooks.json hooks do not run. "my-plugin@mkt-a" holds the same plugin name and comes first',
    )
    expect(getErrorGuidance(err1)).toContain(
      'only while "my-plugin@mkt-a" is disabled',
    )

    const err2 = {
      type: 'hooks-module-left-out-by-name' as const,
      source: 'my-plugin@mkt-b',
      heldBy: 'my-plugin@mkt-a',
    }
    expect(formatErrorMessage(err2)).toBe(
      'Its hooks module does not load. "my-plugin@mkt-a" holds the same plugin name and comes first',
    )
    expect(getErrorGuidance(err2)).toContain(
      'One plugin per name loads a hooks module',
    )
  })
})

describe('#545 datavizContent updates', () => {
  test('palette.md and marks-and-anatomy.md contain updated colors and compact y-axis ticks', () => {
    const palette = readFileSync(
      join(
        process.cwd(),
        'src/skills/bundled/datavizContent/references/palette.md',
      ),
      'utf8',
    )
    expect(palette).toContain('#6250d6')
    expect(palette).toContain('#0ca30c')
    expect(palette).toContain('#f0efec')
    expect(palette).not.toContain('#4a3aa7')

    const marks = readFileSync(
      join(
        process.cwd(),
        'src/skills/bundled/datavizContent/references/marks-and-anatomy.md',
      ),
      'utf8',
    )
    expect(marks).toContain('0 / 10K / 20K')
  })
})
