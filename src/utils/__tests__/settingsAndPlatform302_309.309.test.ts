import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SandboxSettingsSchema } from '../../entrypoints/sandboxTypes.js'
import {
  MACOS_GIT_NOT_INSTALLED_MESSAGE,
  execFileNoThrowWithCwd,
  isMacosMissingGitCommandLineTools,
} from '../execFileNoThrow.js'
import { SAFE_ENV_VARS } from '../managedEnvConstants.js'
import {
  drainSettingsWrites,
  runInSettingsWriteQueue,
} from '../settings/settings.js'
import { TempDirVolumeFullError, ensureClaudeTempDir } from '../tempDir.js'
import { resolveGitForWindowsDirectExe } from '../windowsPaths.js'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('v2.1.302–2.1.309 Settings, CLI Help & Platform Utils alignment', () => {
  test('#902: runInSettingsWriteQueue serializes per-key writes and drainSettingsWrites awaits them', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const p1 = runInSettingsWriteQueue('/tmp/a.json', async () => {
      order.push('p1:start')
      await firstGate
      order.push('p1:end')
      return 1
    })
    const p2 = runInSettingsWriteQueue('/tmp/a.json', async () => {
      order.push('p2:start')
      order.push('p2:end')
      return 2
    })

    await Promise.resolve()
    expect(order).toEqual(['p1:start'])

    let drained = false
    const drainPromise = drainSettingsWrites().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    releaseFirst()
    expect(await p1).toBe(1)
    expect(await p2).toBe(2)
    await drainPromise
    expect(drained).toBe(true)
    expect(order).toEqual(['p1:start', 'p1:end', 'p2:start', 'p2:end'])
  })

  test('#986: main.tsx --help descriptions match upstream', () => {
    const mainSrc = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    expect(mainSrc).toContain(
      "Enable debug mode with optional category filtering (e.g., --debug=hooks,mcp or --debug='!hooks,!mcp')",
    )
    expect(mainSrc).toContain(
      'JSON Schema for structured output validation (only works with --print).',
    )
    expect(mainSrc).toContain('"default" to use the default set')
    expect(mainSrc).toContain(
      'on (the default, except under --bare outside cloud and background sessions)',
    )
    expect(mainSrc).toContain(
      'Resume a conversation by session ID or name, or open interactive picker with optional search term',
    )
    expect(mainSrc).toContain('Disable all skills and commands')
    expect(mainSrc).toContain(".alias('upgrade')")
    expect(mainSrc).toContain(
      'Check for updates and install if available; package-manager installs update through the package manager',
    )
  })

  test('#1011: resolveGitForWindowsDirectExe resolves cmd\\git.exe to <arch>\\bin\\git.exe for git >= 2.26', () => {
    const prevMsystem = process.env.MSYSTEM
    delete process.env.MSYSTEM
    try {
      const resolved = resolveGitForWindowsDirectExe(
        'C:\\Program Files\\Git\\cmd\\git.exe',
        {
          checkExists: p =>
            p.toLowerCase() === 'c:\\program files\\git\\mingw64\\bin\\git.exe',
          execCommand: cmd => {
            if (cmd.includes('--exec-path')) {
              return 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core'
            }
            if (cmd.includes('version')) {
              return 'git version 2.47.1.windows.1'
            }
            return ''
          },
          cwdFn: () => 'C:\\Users\\dev\\repo',
        },
      )
      expect(resolved).toBe('C:\\Program Files\\Git\\mingw64\\bin\\git.exe')

      const oldVersion = resolveGitForWindowsDirectExe(
        'C:\\Program Files\\Git\\cmd\\git.exe',
        {
          checkExists: () => true,
          execCommand: cmd =>
            cmd.includes('--exec-path')
              ? 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core'
              : 'git version 2.25.0.windows.1',
          cwdFn: () => 'C:\\Users\\dev\\repo',
        },
      )
      expect(oldVersion).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
    } finally {
      if (prevMsystem !== undefined) process.env.MSYSTEM = prevMsystem
    }
  })

  test('#1034: SandboxSettingsSchema and settings.ts allow allowNestedUserNamespaces', () => {
    const parsed = SandboxSettingsSchema().parse({
      allowNestedUserNamespaces: true,
    })
    expect(parsed.allowNestedUserNamespaces).toBe(true)
    const settingsSrc = readFileSync(
      join(ROOT, 'src/utils/settings/settings.ts'),
      'utf8',
    )
    expect(settingsSrc).toContain("'allowNestedUserNamespaces'")
  })

  test('#1104: CLAUDE_AX_SCREEN_READER is removed from SAFE_ENV_VARS and screenReaderGate trusts policy/flag/user only', () => {
    expect(SAFE_ENV_VARS.has('CLAUDE_AX_SCREEN_READER')).toBe(false)
    const gateSrc = readFileSync(
      join(ROOT, 'src/utils/screenReaderGate.ts'),
      'utf8',
    )
    expect(gateSrc).toContain("'policySettings'")
    expect(gateSrc).toContain("'flagSettings'")
    expect(gateSrc).toContain("'userSettings'")
  })

  test('#1159: isMacosMissingGitCommandLineTools detects missing CLT for /usr/bin/git', () => {
    expect(
      isMacosMissingGitCommandLineTools(
        'git',
        { PATH: '/usr/bin:/bin' },
        {
          platform: 'darwin',
          existsSync: p => p === '/usr/bin/git',
          statSync: () => undefined,
          lstatSync: () => undefined,
          readdirSync: () => ['Safari.app'],
        },
      ),
    ).toBe(true)

    expect(
      isMacosMissingGitCommandLineTools(
        'git',
        { PATH: '/usr/bin:/bin' },
        {
          platform: 'darwin',
          existsSync: p => p === '/usr/bin/git',
          statSync: () => ({}),
          lstatSync: () => undefined,
          readdirSync: () => ['Safari.app'],
        },
      ),
    ).toBe(false)

    expect(
      isMacosMissingGitCommandLineTools(
        'git',
        { PATH: '/usr/bin:/bin', DEVELOPER_DIR: '/Applications/Xcode.app' },
        {
          platform: 'darwin',
          existsSync: p => p === '/usr/bin/git',
          statSync: () => undefined,
          lstatSync: () => undefined,
          readdirSync: () => [],
        },
      ),
    ).toBe(false)
    expect(MACOS_GIT_NOT_INSTALLED_MESSAGE).toContain('xcode-select --install')
    expect(typeof execFileNoThrowWithCwd).toBe('function')
  })

  test('#1163: ensureClaudeTempDir translates ENOSPC/EDQUOT into TempDirVolumeFullError', () => {
    const enospc = Object.assign(new Error('no space'), { code: 'ENOSPC' })
    expect(() =>
      ensureClaudeTempDir({
        env: { CLAUDE_CODE_TMPDIR: '/mnt/full-vol' },
        hasGetuid: true,
        mkdirSyncFn: () => {
          throw enospc
        },
      }),
    ).toThrow(TempDirVolumeFullError)

    try {
      ensureClaudeTempDir({
        env: { CLAUDE_CODE_TMPDIR: '/mnt/full-vol' },
        hasGetuid: true,
        mkdirSyncFn: () => {
          throw enospc
        },
      })
    } catch (e) {
      expect(e).toBeInstanceOf(TempDirVolumeFullError)
      expect((e as Error).message).toContain('/mnt/full-vol')
      expect((e as Error).message).toContain('CLAUDE_CODE_TMPDIR')
      expect((e as Error).message).toContain('ENOSPC')
    }
  })
})
