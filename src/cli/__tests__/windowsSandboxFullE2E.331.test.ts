import { afterEach, describe, expect, test } from 'bun:test'
import { X509Certificate } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  BashTool,
  getWindowsBashSandboxRefusal,
} from '../../../packages/builtin-tools/src/tools/BashTool/BashTool.js'
import {
  getMonitorCommandSandboxRefusal,
  isMonitorPlatformEnabled,
} from '../../../packages/builtin-tools/src/tools/MonitorTool/MonitorTool.js'
import { createSrtWinNativeProvider } from '../../../packages/win-sandbox-native/src/index.js'
import { call as callSandboxToggle } from '../../commands/sandbox-toggle/sandbox-toggle.js'
import { getAllBaseTools } from '../../tools.js'
import { getPlatform } from '../../utils/platform.js'
import {
  adaptSrtWinNativeProvider,
  ensureDefaultWindowsSandboxNativeProvider,
  getWindowsSandboxNativeProvider,
  isWindowsBackendUnset,
  registerWindowsSandboxNativeProvider,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
  WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE,
  WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
  type WindowsSandboxNativeProvider,
  windowsSandboxStartStore,
} from '../../utils/sandbox/windowsSandbox.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { runWithNewHostSession } from '../../utils/sessionRoot.js'
import {
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  getSandboxStatusPayload,
  getSandboxStatusPayloadAsync,
  runSandboxInstallAsync,
  runSandboxUninstallAsync,
} from '../handlers/sandbox.js'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const SRT_WIN_BIN_NAME =
  process.platform === 'win32' ? 'srt-win.exe' : 'srt-win'
const SRT_WIN_DEBUG_BIN_PATH = resolve(
  REPO_ROOT,
  'packages/win-sandbox-native/target/debug',
  SRT_WIN_BIN_NAME,
)
const SRT_WIN_RELEASE_BIN_PATH = resolve(
  REPO_ROOT,
  'packages/win-sandbox-native/target/release',
  SRT_WIN_BIN_NAME,
)
const SRT_WIN_BIN_PATH = existsSync(SRT_WIN_DEBUG_BIN_PATH)
  ? SRT_WIN_DEBUG_BIN_PATH
  : SRT_WIN_RELEASE_BIN_PATH

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function seedHostSettings(sources: {
  policySettings?: SettingsJson | null
  flagSettings?: SettingsJson | null
  userSettings?: SettingsJson | null
  projectSettings?: SettingsJson | null
  localSettings?: SettingsJson | null
  merged?: SettingsJson
}): void {
  setCachedSettingsForSource('policySettings', sources.policySettings ?? null)
  setCachedSettingsForSource('flagSettings', sources.flagSettings ?? null)
  setCachedSettingsForSource('userSettings', sources.userSettings ?? null)
  setCachedSettingsForSource('projectSettings', sources.projectSettings ?? null)
  setCachedSettingsForSource('localSettings', sources.localSettings ?? null)
  setSessionSettingsCache({
    settings: sources.merged ?? {},
    errors: [],
  })
}

afterEach(() => {
  registerWindowsSandboxNativeProvider(undefined)
  windowsSandboxStartStore.reset()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Official 2.1.331 Windows Sandbox Full E2E (Real Rust srt-win + CLI + Tools + /sandbox)', () => {
  test('1. Full real Rust srt-win lifecycle: status -> install (with WFP verify + X.509 CA) -> status -> spawnSandboxed -> /sandbox install -> uninstall -> status', async () => {
    expect(existsSync(SRT_WIN_BIN_PATH)).toBe(true)

    const stateDir = makeTempDir('win-sandbox-e2e-state-')
    const caDir = makeTempDir('win-sandbox-e2e-ca-')

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      seedHostSettings({
        userSettings: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
            network: { tlsTerminate: {} },
          },
        },
        merged: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
            network: { tlsTerminate: {} },
          },
        },
      })

      const srtProvider = createSrtWinNativeProvider({
        srtWin: { exe: SRT_WIN_BIN_PATH, prependArgs: [] },
        env: { SRT_WIN_TEST_STATE_DIR: stateDir },
      })
      const adapted = adaptSrtWinNativeProvider(srtProvider)
      registerWindowsSandboxNativeProvider(adapted)

      // 1a. Status before install -> installed: false
      const beforeStatus = await getSandboxStatusPayloadAsync()
      expect(beforeStatus.statusVersion).toBe(3)
      expect(beforeStatus.available).toBe(true)
      expect(beforeStatus.installed).toBe(false)
      expect(beforeStatus.windowsBackend).toBe('sandboxuser')
      expect(beforeStatus.windowsBackendUnset).toBe(false)
      expect(beforeStatus.windowsStatus?.user.provisioned).toBe(false)
      expect(beforeStatus.windowsStatus?.wfp.state).toBe('absent')
      expect(beforeStatus.reasons.length).toBeGreaterThan(0)

      // 1b. Install executes real Rust `srt-win install` + `srt-win wfp verify` + real X.509 v3 CA
      const progress: string[] = []
      const installRes = await runSandboxInstallAsync({
        caDir,
        willTlsTerminate: true,
        onProgress: msg => progress.push(msg),
      })
      expect(installRes.status).toBe('ok')
      expect(installRes.wfpVerified).toBe(true)
      expect(installRes.caFingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(progress.length).toBeGreaterThanOrEqual(2)

      const certPath = join(caDir, 'cert.pem')
      expect(existsSync(certPath)).toBe(true)
      const parsedCert = new X509Certificate(readFileSync(certPath, 'utf8'))
      expect(parsedCert.ca).toBe(true)
      expect(parsedCert.verify(parsedCert.publicKey)).toBe(true)

      // 1c. Status after install -> installed: true
      const afterInstallStatus = await getSandboxStatusPayloadAsync()
      expect(afterInstallStatus.statusVersion).toBe(3)
      expect(afterInstallStatus.available).toBe(true)
      expect(afterInstallStatus.installed).toBe(true)
      expect(afterInstallStatus.windowsBackend).toBe('sandboxuser')
      expect(afterInstallStatus.windowsStatus?.user.provisioned).toBe(true)
      expect(afterInstallStatus.windowsStatus?.user.credPresent).toBe(true)
      expect(afterInstallStatus.windowsStatus?.wfp.state).toBe('installed')
      expect(afterInstallStatus.reasons).toEqual([])

      // 1d. Spawn real process through SandboxManager.spawnSandboxedOnWindows -> Rust `srt-win run`
      const spawnRes = await SandboxManager.spawnSandboxedOnWindows('/bin/sh', {
        args: [
          '-c',
          'printf "%s|%s|%s" "$HTTP_PROXY" "$SRT_WIN_SANDBOXED" "$SRT_WIN_BLOCK_CLIPBOARD_READ"',
        ],
        proxyPort: 60082,
        blockClipboardRead: true,
      })
      expect(spawnRes.exitCode).toBe(0)
      expect(spawnRes.stdout).toBe('http://127.0.0.1:60082|1|1')

      // 1e. `/sandbox install` slash command on Windows invokes runSandboxInstallAsync
      const prevProgramData = process.env.ProgramData
      process.env.ProgramData = caDir
      let toggleOutput: string | undefined
      let rendered: Awaited<ReturnType<typeof callSandboxToggle>>
      try {
        rendered = await callSandboxToggle(
          msg => {
            toggleOutput = msg
          },
          {},
          'install',
        )
      } finally {
        if (prevProgramData === undefined) {
          delete process.env.ProgramData
        } else {
          process.env.ProgramData = prevProgramData
        }
      }
      expect(rendered).toBeNull()
      expect(toggleOutput).toContain('Windows sandbox installed successfully.')

      // Unknown subcommand on Windows lists both exclude and install
      let unknownOutput: string | undefined
      await callSandboxToggle(
        msg => {
          unknownOutput = msg
        },
        {},
        'bogus',
      )
      expect(unknownOutput).toContain('Available subcommands: exclude, install')

      // 1f. Uninstall executes real Rust `srt-win uninstall`
      const uninstallRes = await runSandboxUninstallAsync()
      expect(uninstallRes.status).toBe('ok')
      expect(uninstallRes.leftBehind).toEqual([])
      expect(uninstallRes.filtersChecked).toBe(true)

      // 1g. Status after uninstall -> installed: false
      const afterUninstallStatus = await getSandboxStatusPayloadAsync()
      expect(afterUninstallStatus.installed).toBe(false)
      expect(afterUninstallStatus.windowsStatus?.user.provisioned).toBe(false)
      expect(afterUninstallStatus.windowsStatus?.wfp.state).toBe('absent')

      // 1h. Second uninstall reports not_installed
      const secondUninstall = await runSandboxUninstallAsync()
      expect(secondUninstall.status).toBe('not_installed')
      expect(secondUninstall.leftBehind).toEqual([])
    })
  })

  test('1b. ensureDefaultWindowsSandboxNativeProvider auto-discovers and registers compiled srt-win binary', async () => {
    const stateDir = makeTempDir('win-sandbox-autodiscover-')
    await runWithNewHostSession({}, async () => {
      expect(getWindowsSandboxNativeProvider()).toBeUndefined()
      const discovered = ensureDefaultWindowsSandboxNativeProvider({
        env: {
          CLAUDE_CODE_SRT_WIN_PATH: SRT_WIN_BIN_PATH,
          SRT_WIN_TEST_STATE_DIR: stateDir,
        },
      })
      expect(discovered).toBeDefined()
      expect(discovered?.kind).toBe('srt-win')
      expect(getWindowsSandboxNativeProvider()).toBe(discovered)

      const status = await discovered!.checkStatus()
      expect(status.user.provisioned).toBe(false)
      expect(status.wfp.state).toBe('absent')
    })
  })

  test('2. MXC mode E2E: install no-op, Bash refused & withheld in SandboxManager / BashTool / MonitorTool / src/tools.ts', async () => {
    expect(existsSync(SRT_WIN_BIN_PATH)).toBe(true)
    const stateDir = makeTempDir('win-sandbox-mxc-e2e-')

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      const srtProvider = createSrtWinNativeProvider({
        srtWin: { exe: SRT_WIN_BIN_PATH, prependArgs: [] },
        env: { SRT_WIN_TEST_STATE_DIR: stateDir },
      })
      registerWindowsSandboxNativeProvider(
        adaptSrtWinNativeProvider(srtProvider, { hasMxcSdk: true }),
      )
      seedHostSettings({
        userSettings: {
          sandbox: {
            enabled: true,
            windows: { backend: 'mxc' },
          },
        },
        merged: {
          sandbox: {
            enabled: true,
            windows: { backend: 'mxc' },
          },
        },
      })

      // 2a. `claude sandbox install` reports MXC nothing-to-install message
      const installRes = await runSandboxInstallAsync()
      expect(installRes.status).toBe('ok')
      expect(installRes.message).toBe(WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE)

      // 2b. `claude sandbox status` reports mxc backend & installed posture
      const status = await getSandboxStatusPayloadAsync()
      expect(status.statusVersion).toBe(3)
      expect(status.windowsBackend).toBe('mxc')
      expect(status.windowsBackendUnset).toBe(false)
      expect(status.mxcLastStart).toEqual({ state: 'none' })
      expect(status.available).toBe(true)
      expect(status.installed).toBe(true)

      // 2c. SandboxManager MXC refusal + latch
      expect(SandboxManager.isBashRefusedByMxcBackend()).toBe(true)
      expect(SandboxManager.isBashToolWithheldForMxcBackend()).toBe(true)

      // 2d. MonitorTool disables platform & refuses Bash with official MXC message
      expect(
        isMonitorPlatformEnabled(
          'windows',
          'C:\\Program Files\\Git\\bin\\bash.exe',
        ),
      ).toBe(false)
      expect(getMonitorCommandSandboxRefusal(true, 'echo hi')).toBe(
        WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
      )

      // 2e. BashTool refuses with WINDOWS_MXC_BASH_REFUSAL_MESSAGE
      expect(getWindowsBashSandboxRefusal()).toBe(
        WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
      )
      const bashInstance = BashTool.create({
        tools: [],
        tasks: () => ({}),
        permissions: () => ({
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        }),
        getAppState: () => {
          throw new Error('unexpected getAppState')
        },
        setAppState: () => {},
        setToolJSX: () => {},
        addNotification: () => {},
        readFileState: new Map(),
      } as unknown as Parameters<typeof BashTool.create>[0])

      const validateInput = bashInstance.validateInput
      expect(validateInput).toBeDefined()
      const validation = await validateInput!({ command: 'echo hi' }, {
        toolUseId: 'tu-mxc-1',
        abortController: new AbortController(),
        onProgress: () => {},
      } as unknown as Parameters<
        NonNullable<typeof bashInstance.validateInput>
      >[1])
      expect(validation).toEqual({
        result: false,
        message: WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
        errorCode: 14,
      })

      // 2f. src/tools.ts omits BashTool when MXC withholds Bash
      const baseTools = getAllBaseTools()
      expect(baseTools.some(t => t.name === 'Bash')).toBe(false)
    })
  })

  test('3. Unset backend on Windows surfaces WINDOWS_BACKEND_UNSET_MESSAGE in install, status, and strict BashTool/MonitorTool refusal', async () => {
    expect(existsSync(SRT_WIN_BIN_PATH)).toBe(true)
    const stateDir = makeTempDir('win-sandbox-unset-e2e-')

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      const srtProvider = createSrtWinNativeProvider({
        srtWin: { exe: SRT_WIN_BIN_PATH, prependArgs: [] },
        env: { SRT_WIN_TEST_STATE_DIR: stateDir },
      })
      registerWindowsSandboxNativeProvider(
        adaptSrtWinNativeProvider(srtProvider),
      )

      // Only untrusted projectSettings sets backend -> still unset!
      seedHostSettings({
        userSettings: {
          sandbox: {
            enabled: true,
            allowUnsandboxedCommands: false,
          },
        },
        projectSettings: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
          },
        },
        merged: {
          sandbox: {
            enabled: true,
            allowUnsandboxedCommands: false,
          },
        },
      })

      expect(isWindowsBackendUnset()).toBe(true)

      const installRes = await runSandboxInstallAsync()
      expect(installRes.status).toBe('unavailable')
      expect(installRes.message).toBe(WINDOWS_BACKEND_UNSET_MESSAGE)

      const status = await getSandboxStatusPayloadAsync()
      expect(status.windowsBackendUnset).toBe(true)
      expect(status.reasons).toContain(WINDOWS_BACKEND_UNSET_MESSAGE)

      expect(getWindowsBashSandboxRefusal()).toBe(WINDOWS_BACKEND_UNSET_MESSAGE)
      // P0-7: MonitorTool must also enforce WINDOWS_BACKEND_UNSET_MESSAGE in strict mode
      expect(getMonitorCommandSandboxRefusal(false, 'echo hi')).toBe(
        WINDOWS_BACKEND_UNSET_MESSAGE,
      )
      expect(getMonitorCommandSandboxRefusal(true, 'echo hi')).toBe(
        WINDOWS_BACKEND_UNSET_MESSAGE,
      )
    })
  })

  test('4. Non-Windows platform guard remains 100% intact across CLI, tools, BashTool, and /sandbox', async () => {
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'macos')
      seedHostSettings({
        userSettings: {
          sandbox: { enabled: true },
        },
        merged: {
          sandbox: { enabled: true },
        },
      })

      const installRes = await runSandboxInstallAsync()
      expect(installRes.status).toBe('unavailable')
      expect(installRes.message).toBe(
        'Windows sandbox install is only available on native Windows.',
      )

      const uninstallRes = await runSandboxUninstallAsync()
      expect(uninstallRes).toEqual({
        status: 'unavailable',
        message:
          'This command applies to native Windows only. On macOS, Linux and WSL the sandbox adds no account or network filters, so there is nothing to remove.',
        leftBehind: [],
        filtersChecked: false,
      })

      const status = await getSandboxStatusPayloadAsync()
      expect(status.statusVersion).toBe(3)
      expect(status.available).toBe(false)
      expect(status.installed).toBe(false)
      expect(status.windowsBackend).toBeUndefined()
      expect(status.windowsBackendUnset).toBeUndefined()

      expect(SandboxManager.isBashRefusedByMxcBackend()).toBe(false)
      expect(SandboxManager.isBashToolWithheldForMxcBackend()).toBe(false)
      expect(getWindowsBashSandboxRefusal()).toBeNull()
      expect(getAllBaseTools().some(t => t.name === 'Bash')).toBe(true)

      let unknownOutput: string | undefined
      await callSandboxToggle(
        msg => {
          unknownOutput = msg
        },
        {},
        'install',
      )
      expect(unknownOutput).toContain('Available subcommand: exclude')
      expect(unknownOutput).not.toContain('Available subcommands:')
    })
  })

  test('5. P1-2: runSandboxInstallAsync requires egress_probe==="blocked" & write_restricted_token!==false', async () => {
    const makeVerifyProvider = (
      verifyStdout: string,
    ): WindowsSandboxNativeProvider => ({
      kind: 'custom',
      hasMxcSdk: false,
      checkStatus: async () => ({
        user: {
          provisioned: true,
          credPresent: true,
          realUserSid: 'S-1-5-21-1-2-3-1001',
          sandboxUser: 'ClaudeSandbox_p12',
          seclogonState: 'running',
        },
        wfp: {
          state: 'installed',
          allowLoopback: false,
          sublayerGuid: '{11111111-2222-3333-4444-555555555555}',
          proxyPortRange: WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
        },
      }),
      install: async () => ({ status: 0, stdout: 'installed', stderr: '' }),
      uninstall: async () => ({ status: 0, stdout: 'uninstalled', stderr: '' }),
      verifyWfp: async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: verifyStdout,
        stderr: '',
      }),
    })

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      seedHostSettings({
        userSettings: {
          sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
        },
        merged: {
          sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
        },
      })

      // egress_probe: "allowed" -> partial, wfpVerified: false
      const allowedRes = await runSandboxInstallAsync({
        provider: makeVerifyProvider(
          JSON.stringify({
            egress_probe: 'allowed',
            target: '1.1.1.1:443',
            write_restricted_token: true,
          }),
        ),
        willTlsTerminate: false,
      })
      expect(allowedRes.status).toBe('partial')
      expect(allowedRes.wfpVerified).toBe(false)
      expect(allowedRes.message).toContain('"allowed"')

      // egress_probe: "not-run" -> partial, wfpVerified: false
      const notRunRes = await runSandboxInstallAsync({
        provider: makeVerifyProvider(
          JSON.stringify({
            egress_probe: 'not-run',
            target: '1.1.1.1:443',
            write_restricted_token: true,
          }),
        ),
        willTlsTerminate: false,
      })
      expect(notRunRes.status).toBe('partial')
      expect(notRunRes.wfpVerified).toBe(false)

      // write_restricted_token: false -> partial, wfpVerified: false
      const tokenFailRes = await runSandboxInstallAsync({
        provider: makeVerifyProvider(
          JSON.stringify({
            egress_probe: 'blocked',
            target: '1.1.1.1:443',
            write_restricted_token: false,
          }),
        ),
        willTlsTerminate: false,
      })
      expect(tokenFailRes.status).toBe('partial')
      expect(tokenFailRes.wfpVerified).toBe(false)
      expect(tokenFailRes.message).toContain('write_restricted_token=false')

      // unparseable stdout -> partial, wfpVerified: false
      const badJsonRes = await runSandboxInstallAsync({
        provider: makeVerifyProvider('not json'),
        willTlsTerminate: false,
      })
      expect(badJsonRes.status).toBe('partial')
      expect(badJsonRes.wfpVerified).toBe(false)

      // egress_probe: "blocked" & write_restricted_token: true -> ok, wfpVerified: true
      const okRes = await runSandboxInstallAsync({
        provider: makeVerifyProvider(
          JSON.stringify({
            egress_probe: 'blocked',
            target: '1.1.1.1:443',
            write_restricted_token: true,
          }),
        ),
        willTlsTerminate: false,
      })
      expect(okRes.status).toBe('ok')
      expect(okRes.wfpVerified).toBe(true)
    })
  })

  test('6. P1-3 & P1-13: opts.provider threads hasMxcSdk & supported:true; sync getSandboxStatusPayload works on Windows with provider', async () => {
    const mxcProvider: WindowsSandboxNativeProvider = {
      kind: 'custom',
      hasMxcSdk: true,
      checkStatus: async () => ({
        user: {
          provisioned: true,
          credPresent: true,
          realUserSid: 'S-1-5-21-1-2-3-1001',
          sandboxUser: 'ClaudeSandbox_p13',
          seclogonState: 'running',
        },
        wfp: {
          state: 'installed',
          allowLoopback: false,
          sublayerGuid: undefined,
          proxyPortRange: WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
        },
      }),
      install: async () => {
        throw new Error('MXC install should not invoke provider.install')
      },
      uninstall: async () => ({ status: 0, stdout: '', stderr: '' }),
    }

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      // Explicitly disable global provider so only opts.provider is in play
      registerWindowsSandboxNativeProvider(null)
      seedHostSettings({
        userSettings: {
          sandbox: { enabled: true, windows: { backend: 'mxc' } },
        },
        merged: {
          sandbox: { enabled: true, windows: { backend: 'mxc' } },
        },
      })

      // P1-3: runSandboxInstallAsync({ provider: mxcProvider }) sees MXC SDK from opts.provider
      const installRes = await runSandboxInstallAsync({ provider: mxcProvider })
      expect(installRes.status).toBe('ok')
      expect(installRes.message).toBe(WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE)

      // P1-3: getSandboxStatusPayloadAsync({ provider: mxcProvider }) reports supported:true & windowsBackend:'mxc'
      const asyncStatus = await getSandboxStatusPayloadAsync({
        provider: mxcProvider,
      })
      expect(asyncStatus.available).toBe(true)
      expect(asyncStatus.installed).toBe(true)
      expect(asyncStatus.supported).toBe(true)
      expect(asyncStatus.windowsBackend).toBe('mxc')
      expect(asyncStatus.mxcSetAside).toBeUndefined()

      // P1-13: sync getSandboxStatusPayload() reflects unavailable when no provider,
      // and available:true + supported:true once a provider is registered
      const syncWithoutProvider = getSandboxStatusPayload()
      expect(syncWithoutProvider.available).toBe(false)
      expect(syncWithoutProvider.supported).toBe(false)

      registerWindowsSandboxNativeProvider(mxcProvider)
      const syncWithProvider = getSandboxStatusPayload()
      expect(syncWithProvider.available).toBe(true)
      expect(syncWithProvider.supported).toBe(true)
      expect(syncWithProvider.installed).toBe(true)
    })
  })

  test('7. P1-14 & P2-4: isBashToolWithheldForMxcBackend auto-discovers provider before latching; /sandbox shows accurate Windows error when unavailable', async () => {
    const prevPath = process.env.CLAUDE_CODE_SRT_WIN_PATH
    process.env.CLAUDE_CODE_SRT_WIN_PATH = SRT_WIN_BIN_PATH
    try {
      await runWithNewHostSession({}, async () => {
        getPlatform.cache.set(undefined, 'windows')
        seedHostSettings({
          userSettings: {
            sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
          },
          merged: {
            sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
          },
        })

        // Before calling isBashToolWithheldForMxcBackend, no provider is registered yet
        expect(getWindowsSandboxNativeProvider()).toBeUndefined()
        // Calling isBashToolWithheldForMxcBackend triggers default provider discovery
        expect(SandboxManager.isBashToolWithheldForMxcBackend()).toBe(false)
        expect(getWindowsSandboxNativeProvider()).toBeDefined()
      })
    } finally {
      if (prevPath === undefined) {
        delete process.env.CLAUDE_CODE_SRT_WIN_PATH
      } else {
        process.env.CLAUDE_CODE_SRT_WIN_PATH = prevPath
      }
    }

    // P2-4: /sandbox on Windows without provider/MXC SDK gives accurate Windows message
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(null)
      seedHostSettings({
        userSettings: { sandbox: { enabled: true } },
        merged: { sandbox: { enabled: true } },
      })

      let output: string | undefined
      const rendered = await callSandboxToggle(msg => {
        output = msg
      }, {})
      expect(rendered).toBeNull()
      expect(output).toContain(
        'The Windows sandbox is not enabled on this build (install srt-win.exe or use WSL2).',
      )
      expect(output).not.toContain('only supported on macOS, Linux, and WSL2')
    })
  })

  test('8. R3-P1-2, R3-P1-3, R3-P1-6, R3-P2-3, R3-P1-1, R3-P0-6: sync status accuracy, MonitorTool non-Windows fast path, cannot-read uninstall handling, and PE packaging', async () => {
    // R3-P1-3: isMonitorPlatformEnabled on non-Windows returns true WITHOUT calling isBashToolWithheldForMxcBackend
    const origWithheld = SandboxManager.isBashToolWithheldForMxcBackend
    let withheldCalls = 0
    ;(
      SandboxManager as {
        isBashToolWithheldForMxcBackend: () => boolean
      }
    ).isBashToolWithheldForMxcBackend = () => {
      withheldCalls++
      return origWithheld()
    }
    try {
      expect(isMonitorPlatformEnabled('macos')).toBe(true)
      expect(isMonitorPlatformEnabled('linux')).toBe(true)
      expect(withheldCalls).toBe(0)
    } finally {
      ;(
        SandboxManager as {
          isBashToolWithheldForMxcBackend: () => boolean
        }
      ).isBashToolWithheldForMxcBackend = origWithheld
    }

    // R3-P1-2 & R3-P2-3: sync getSandboxStatusPayload does NOT assume installed:true for sandboxuser before verification
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      let provisioned = false
      const mockProvider: WindowsSandboxNativeProvider = {
        kind: 'custom',
        hasMxcSdk: false,
        checkStatus: async () => ({
          user: {
            provisioned,
            credPresent: provisioned,
            realUserSid: 'S-1-5-21-1-2-3-1001',
            sandboxUser: provisioned ? 'claude_srt' : undefined,
            seclogonState: 'running',
          },
          wfp: {
            state: provisioned ? 'installed' : 'absent',
            allowLoopback: provisioned,
            sublayerGuid: undefined,
            proxyPortRange: WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
          },
        }),
        install: async () => {
          provisioned = true
          return { status: 0, stdout: 'ok', stderr: '' }
        },
        uninstall: async () => ({ status: 0, stdout: 'ok', stderr: '' }),
      }
      registerWindowsSandboxNativeProvider(mockProvider)
      seedHostSettings({
        userSettings: {
          sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
        },
        merged: {
          sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
        },
      })

      // Before any async check: installed MUST be false (never equated to deps.errors.length === 0!)
      const syncBeforeCheck = getSandboxStatusPayload()
      expect(syncBeforeCheck.available).toBe(true)
      expect(syncBeforeCheck.installed).toBe(false)
      expect(syncBeforeCheck.filesystemPolicy).toBeDefined()

      // After install + async status check: cached status makes sync status report installed: true
      provisioned = true
      await getSandboxStatusPayloadAsync()
      const syncAfterCheck = getSandboxStatusPayload()
      expect(syncAfterCheck.installed).toBe(true)
    })

    // R3-P1-6: runSandboxUninstallAsync proceeds when before.wfp.state === 'cannot-read'
    // and returns 'partial' when after.wfp.state === 'cannot-read'
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      let uninstallInvoked = false
      let afterWfpState: 'absent' | 'cannot-read' = 'cannot-read'
      const cannotReadProvider: WindowsSandboxNativeProvider = {
        kind: 'custom',
        hasMxcSdk: false,
        checkStatus: async () => ({
          user: {
            provisioned: false,
            credPresent: false,
            seclogonState: 'running',
          },
          wfp: {
            state: uninstallInvoked ? afterWfpState : 'cannot-read',
          },
        }),
        install: async () => ({ status: 0, stdout: '', stderr: '' }),
        uninstall: async () => {
          uninstallInvoked = true
          return { status: 0, stdout: '', stderr: '' }
        },
      }
      registerWindowsSandboxNativeProvider(cannotReadProvider)

      const partialUninstall = await runSandboxUninstallAsync()
      expect(uninstallInvoked).toBe(true)
      expect(partialUninstall.status).toBe('partial')
      expect(partialUninstall.filtersChecked).toBe(false)
      expect(
        partialUninstall.leftBehind.some(item => item.includes('cannot-read')),
      ).toBe(true)

      // When after.wfp.state === 'absent', uninstall completes cleanly with 'ok'
      uninstallInvoked = false
      afterWfpState = 'absent'
      const cleanUninstall = await runSandboxUninstallAsync()
      expect(uninstallInvoked).toBe(true)
      expect(cleanUninstall.status).toBe('ok')
      expect(cleanUninstall.leftBehind).toEqual([])
      expect(cleanUninstall.filtersChecked).toBe(true)
    })

    // R3-P0-6 & R3-P1-1: win32 package.json manifests include srt-win.exe; build.ts checks MZ; publish.ts checks COFF Machine
    const winX64Pkg = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'packages/@go-hare/claude-code-win32-x64/package.json'),
        'utf8',
      ),
    ) as { files: string[] }
    const winArm64Pkg = JSON.parse(
      readFileSync(
        join(
          REPO_ROOT,
          'packages/@go-hare/claude-code-win32-arm64/package.json',
        ),
        'utf8',
      ),
    ) as { files: string[] }
    expect(winX64Pkg.files).toContain('vendor/win-sandbox/srt-win.exe')
    expect(winArm64Pkg.files).toContain('vendor/win-sandbox/srt-win.exe')

    const buildSrc = readFileSync(join(REPO_ROOT, 'build.ts'), 'utf8')
    expect(buildSrc).toContain('0x4d')
    expect(buildSrc).toContain('0x5a')

    const publishSrc = readFileSync(
      join(REPO_ROOT, 'scripts/publish.ts'),
      'utf8',
    )
    expect(publishSrc).toContain('0x8664')
    expect(publishSrc).toContain('0xaa64')
    expect(publishSrc).toContain('x86_64-pc-windows-msvc')
    expect(publishSrc).toContain('aarch64-pc-windows-msvc')
  })
})
