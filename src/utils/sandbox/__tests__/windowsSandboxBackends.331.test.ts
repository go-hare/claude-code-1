import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WindowsSandboxNativeProvider as SrtWinNativeProvider } from '../../../../packages/win-sandbox-native/src/index.js'
import { getPlatform } from '../../platform.js'
import { getBootstrapSessionHost } from '../../sessionHost.js'
import { runWithNewHostSession } from '../../sessionRoot.js'
import {
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../../settings/settingsCache.js'
import type { SettingsJson } from '../../settings/types.js'
import {
  areWindowsLocalConnectionsOn,
  checkWindowsSandboxStatusAsync,
  classifyWindowsSandboxLaunchExit,
  ensurePersistentWindowsCa,
  estimateWindowsCommandLineUtf16Length,
  forgetWindowsProfileReadAsync,
  getWindowsMxcLastStart,
  getWindowsMxcSetAside,
  getWindowsSandboxNativeProvider,
  installWindowsSandboxAsync,
  isInstalledWindowsTlsCaCurrent,
  isWindowsBackendUnset,
  isWindowsCommandLineTooLong,
  registerWindowsSandboxNativeProvider,
  resolveWindowsBackendChoice,
  resolveWindowsTlsTerminateCaSource,
  runWindowsSandboxInstallFlow,
  SandboxManager,
  uninstallWindowsSandbox,
  validateMxcBaseContainerProbe,
  WINDOWS_ARGV_MAX_LENGTH,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
  WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE,
  WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
  type WindowsMxcProbeResult,
  WindowsSandboxError,
  type WindowsSandboxNativeProvider,
  type WindowsSandboxStatus,
  windowsArgvTooLongError,
  windowsSandboxStartStore,
} from '../sandbox-adapter.js'
import {
  adaptSrtWinNativeProvider,
  buildWindowsCaDirIcaclsArgs,
  buildWindowsKeyFileIcaclsArgs,
  ensureDefaultWindowsSandboxNativeProvider,
} from '../windowsSandbox.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeProvisionedStatus(
  overrides?: Partial<WindowsSandboxStatus>,
): WindowsSandboxStatus {
  return {
    user: {
      provisioned: true,
      credPresent: true,
      realUserSid: 'S-1-5-21-1000-2000-3000-1001',
      sandboxUser: 'ClaudeSandbox_abc123',
      seclogonState: 'running',
      profileReadGranted: false,
      warnings: [],
      ...overrides?.user,
    },
    wfp: {
      state: 'installed',
      allowLoopback: false,
      sublayerGuid: '{11111111-2222-3333-4444-555555555555}',
      proxyPortRange: WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
      ...overrides?.wfp,
    },
  }
}

function makeMockProvider(
  overrides?: Partial<WindowsSandboxNativeProvider>,
): WindowsSandboxNativeProvider {
  return {
    kind: 'custom',
    hasMxcSdk: false,
    checkStatus: async () => makeProvisionedStatus(),
    install: async () => ({ status: 0, stdout: 'installed', stderr: '' }),
    uninstall: async () => ({ status: 0, stdout: 'uninstalled', stderr: '' }),
    verifyWfp: async () => ({ exitCode: 0, stdout: 'wfp ok', stderr: '' }),
    forgetProfileRead: async () => ({ cleared: 2 }),
    spawnSandboxed: async command => ({
      exitCode: 0,
      stdout: `ran:${command}`,
      stderr: '',
    }),
    ...overrides,
  }
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

function makeFullMxcProbe(
  overrides?: Partial<WindowsMxcProbeResult>,
): WindowsMxcProbeResult {
  return {
    tier: 'base-container',
    needsDaclAugmentation: false,
    probes: {
      baseContainerSupportsDenyPaths: true,
      baseContainerSupportsIdentitylessLoopbackProxy: true,
      baseContainerSupportsIngressHostLoopbackAllow: true,
      uiCapabilities: {
        canBlockClipboardRead: true,
        canBlockClipboardWrite: true,
        canBlockInputInjection: true,
      },
    },
    ...overrides,
  }
}

afterEach(() => {
  registerWindowsSandboxNativeProvider(undefined)
  windowsSandboxStartStore.reset()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Official 2.1.331 Windows sandbox backend resolution (tT)', () => {
  test('constants match official 2.1.331 text and port range', () => {
    expect(WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE).toEqual([60080, 60089])
    expect(WINDOWS_BACKEND_UNSET_MESSAGE).toContain('sandbox.windows.backend')
    expect(WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE).toContain('MXC backend')
    expect(WINDOWS_MXC_BASH_REFUSAL_MESSAGE).toContain('PowerShell tool')
  })

  test('non-Windows platforms always resolve to sandboxuser without unset', () => {
    runWithNewHostSession({}, () => {
      seedHostSettings({})
      expect(resolveWindowsBackendChoice({ platform: 'macos' })).toEqual({
        backend: 'sandboxuser',
      })
      expect(resolveWindowsBackendChoice({ platform: 'linux' })).toEqual({
        backend: 'sandboxuser',
      })
    })
  })

  test('strict precedence: policySettings > flagSettings > userSettings; ignores projectSettings and localSettings', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')

      // Only project/local configured -> still unset!
      seedHostSettings({
        projectSettings: { sandbox: { windows: { backend: 'mxc' } } },
        localSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
      })
      expect(
        resolveWindowsBackendChoice({ platform: 'windows', hasMxcSdk: true }),
      ).toEqual({ backend: 'mxc', unset: true })
      expect(
        resolveWindowsBackendChoice({ platform: 'windows', hasMxcSdk: false }),
      ).toEqual({ backend: 'sandboxuser', unset: true })
      expect(
        isWindowsBackendUnset({ platform: 'windows', hasMxcSdk: false }),
      ).toBe(true)

      // userSettings wins over project/local
      seedHostSettings({
        userSettings: { sandbox: { windows: { backend: 'mxc' } } },
        projectSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
        localSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
      })
      expect(
        resolveWindowsBackendChoice({ platform: 'windows', hasMxcSdk: true }),
      ).toEqual({ backend: 'mxc' })

      // flagSettings wins over userSettings
      seedHostSettings({
        flagSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
        userSettings: { sandbox: { windows: { backend: 'mxc' } } },
      })
      expect(
        resolveWindowsBackendChoice({ platform: 'windows', hasMxcSdk: true }),
      ).toEqual({ backend: 'sandboxuser' })

      // policySettings wins over flagSettings and userSettings
      seedHostSettings({
        policySettings: { sandbox: { windows: { backend: 'mxc' } } },
        flagSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
        userSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
      })
      expect(
        resolveWindowsBackendChoice({ platform: 'windows', hasMxcSdk: true }),
      ).toEqual({ backend: 'mxc' })
    })
  })

  test('sets aside mxc to sandboxuser when build lacks MXC SDK', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      seedHostSettings({
        userSettings: { sandbox: { windows: { backend: 'mxc' } } },
      })
      const choice = resolveWindowsBackendChoice({
        platform: 'windows',
        hasMxcSdk: false,
      })
      expect(choice).toEqual({
        backend: 'sandboxuser',
        setAside: 'this build of Claude Code does not include the MXC SDK',
      })
      expect(
        getWindowsMxcSetAside({ platform: 'windows', hasMxcSdk: false }),
      ).toBe('this build of Claude Code does not include the MXC SDK')
    })
  })

  test('getWindowsMxcLastStart tracks none / started / refused states', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(
        makeMockProvider({ hasMxcSdk: true }),
      )
      seedHostSettings({
        userSettings: { sandbox: { windows: { backend: 'mxc' } } },
      })

      expect(getWindowsMxcLastStart({ platform: 'macos' })).toBeUndefined()
      expect(getWindowsMxcLastStart()).toEqual({ state: 'none' })

      windowsSandboxStartStore.markStarted('mxc')
      expect(getWindowsMxcLastStart()).toEqual({ state: 'started' })

      windowsSandboxStartStore.markInitFailed('BaseContainer unavailable')
      expect(getWindowsMxcLastStart()).toEqual({
        state: 'refused',
        reason: 'BaseContainer unavailable',
      })

      windowsSandboxStartStore.reset()
      windowsSandboxStartStore.markStarted('sandboxuser')
      expect(getWindowsMxcLastStart()).toBeUndefined()
    })
  })
})

describe('Official 2.1.331 validateMxcBaseContainerProbe (_W)', () => {
  const fullConfig = { hasDeniedPaths: true, hasNetworkProxy: true }

  test('returns empty array when full BaseContainer probe passes', () => {
    expect(
      validateMxcBaseContainerProbe(fullConfig, makeFullMxcProbe()),
    ).toEqual([])
  })

  test('short-circuits on probe.error', () => {
    expect(
      validateMxcBaseContainerProbe(fullConfig, {
        error: 'RPC_E_DISCONNECTED',
      }),
    ).toEqual(['the probe failed: RPC_E_DISCONNECTED'])
  })

  test('reports each of the 7 individual probe failure checks', () => {
    // 1. Non-base-container tier
    expect(
      validateMxcBaseContainerProbe(
        fullConfig,
        makeFullMxcProbe({ tier: 'app-container' }),
      ),
    ).toEqual([
      "this host offers MXC tier 'app-container'; BaseContainer is required",
    ])

    // 2. DACL augmentation required
    expect(
      validateMxcBaseContainerProbe(
        fullConfig,
        makeFullMxcProbe({ needsDaclAugmentation: true }),
      ),
    ).toEqual(['the tier needs host ACL changes (DACL augmentation)'])

    // 3. Deny paths unsupported
    const noDeny = makeFullMxcProbe()
    noDeny.probes!.baseContainerSupportsDenyPaths = false
    expect(validateMxcBaseContainerProbe(fullConfig, noDeny)).toEqual([
      'BaseContainer cannot enforce denied paths on this host',
    ])
    expect(
      validateMxcBaseContainerProbe(
        { hasDeniedPaths: false, hasNetworkProxy: true },
        noDeny,
      ),
    ).toEqual([])

    // 4. Identityless loopback proxy unsupported
    const noLoopbackProxy = makeFullMxcProbe()
    noLoopbackProxy.probes!.baseContainerSupportsIdentitylessLoopbackProxy = false
    expect(validateMxcBaseContainerProbe(fullConfig, noLoopbackProxy)).toEqual([
      'BaseContainer cannot confine egress to the host proxy',
    ])

    // 5. Ingress host loopback allow unsupported
    const noIngressLoopback = makeFullMxcProbe()
    noIngressLoopback.probes!.baseContainerSupportsIngressHostLoopbackAllow = false
    expect(
      validateMxcBaseContainerProbe(fullConfig, noIngressLoopback),
    ).toEqual(['BaseContainer cannot allow host loopback for the proxy'])
    expect(
      validateMxcBaseContainerProbe(
        { hasDeniedPaths: true, hasNetworkProxy: false },
        noIngressLoopback,
      ),
    ).toEqual([])

    // 6. Clipboard block unsupported
    const noClipboard = makeFullMxcProbe()
    noClipboard.probes!.uiCapabilities!.canBlockClipboardRead = false
    expect(validateMxcBaseContainerProbe(fullConfig, noClipboard)).toEqual([
      'this host cannot block clipboard access',
    ])

    // 7. Input injection block unsupported
    const noInputBlock = makeFullMxcProbe()
    noInputBlock.probes!.uiCapabilities!.canBlockInputInjection = false
    expect(validateMxcBaseContainerProbe(fullConfig, noInputBlock)).toEqual([
      'this host cannot block input injection',
    ])
  })
})

describe('All 7 SandboxManager Windows methods & per-SessionHost isolation', () => {
  test('getWindowsSandboxBackend, isBashRefusedByMxcBackend, isBashToolWithheldForMxcBackend', async () => {
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(
        makeMockProvider({ hasMxcSdk: true }),
      )

      // Unset -> Bash not refused by MXC (command blocked by unset check instead)
      seedHostSettings({
        merged: { sandbox: { enabled: true } },
      })
      expect(SandboxManager.getWindowsSandboxBackend()).toBe('mxc')
      expect(SandboxManager.isBashRefusedByMxcBackend()).toBe(false)

      // Explicitly configured to mxc with sandbox enabled -> Bash refused
      seedHostSettings({
        userSettings: {
          sandbox: { enabled: true, windows: { backend: 'mxc' } },
        },
        merged: { sandbox: { enabled: true, windows: { backend: 'mxc' } } },
      })
      expect(SandboxManager.isBashRefusedByMxcBackend()).toBe(true)
      expect(SandboxManager.isBashToolWithheldForMxcBackend()).toBe(true)

      // Even if settings later flip to sandboxuser, withheld stays latched until reset
      seedHostSettings({
        userSettings: {
          sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
        },
        merged: {
          sandbox: { enabled: true, windows: { backend: 'sandboxuser' } },
        },
      })
      expect(SandboxManager.isBashRefusedByMxcBackend()).toBe(false)
      expect(SandboxManager.isBashToolWithheldForMxcBackend()).toBe(true)

      await SandboxManager.reset()
      expect(SandboxManager.isBashToolWithheldForMxcBackend()).toBe(false)
    })
  })

  test('spawnSandboxedOnWindows enforces backend_unset, argv_too_long, spawn_unavailable, and delegates', async () => {
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')

      // Unset backend throws backend_unset
      seedHostSettings({})
      await expect(
        SandboxManager.spawnSandboxedOnWindows('echo hi'),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'backend_unset',
      })

      // Configured backend without provider throws spawn_unavailable
      seedHostSettings({
        userSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
      })
      await expect(
        SandboxManager.spawnSandboxedOnWindows('echo hi'),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'spawn_unavailable',
      })

      // Command exceeding 32,767 chars throws argv_too_long
      registerWindowsSandboxNativeProvider(makeMockProvider())
      const huge = 'a'.repeat(WINDOWS_ARGV_MAX_LENGTH + 1)
      await expect(
        SandboxManager.spawnSandboxedOnWindows(huge, { hasAddedDenies: true }),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'argv_too_long',
      })

      // Valid command delegates to provider
      const res = await SandboxManager.spawnSandboxedOnWindows('echo ok')
      expect(res).toEqual({ exitCode: 0, stdout: 'ran:echo ok', stderr: '' })
    })
  })

  test('needsRestartForTlsTerminate, needsRestartForLocalConnections, getProfileReadSecurityWarnings', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(makeMockProvider())
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: { allowLocalBinding: false },
          },
        },
        merged: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: { allowLocalBinding: false },
          },
        },
      })

      // Before start latched -> false
      expect(SandboxManager.needsRestartForTlsTerminate()).toBe(false)
      expect(SandboxManager.needsRestartForLocalConnections()).toBe(false)

      windowsSandboxStartStore.markStarted('sandboxuser', {
        tlsTerminate: false,
        localConnections: false,
      })
      expect(SandboxManager.needsRestartForTlsTerminate()).toBe(false)
      expect(SandboxManager.needsRestartForLocalConnections()).toBe(false)

      // Enable tlsTerminate and allowLocalBinding after start -> needs restart
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: {
              allowLocalBinding: true,
              tlsTerminate: {},
            },
          },
        },
        merged: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: {
              allowLocalBinding: true,
              tlsTerminate: {},
            },
          },
        },
      })
      expect(SandboxManager.needsRestartForTlsTerminate()).toBe(true)
      expect(SandboxManager.needsRestartForLocalConnections()).toBe(true)

      // Profile-read security warnings return a defensive copy
      windowsSandboxStartStore.get().profileReadWarnings.push('warning-1')
      const warnings = SandboxManager.getProfileReadSecurityWarnings()
      expect(warnings).toEqual(['warning-1'])
      warnings.push('mutated')
      expect(SandboxManager.getProfileReadSecurityWarnings()).toEqual([
        'warning-1',
      ])
    })
  })

  test('areWindowsLocalConnectionsOn respects policy lock and forces false on MXC', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(
        makeMockProvider({ hasMxcSdk: true }),
      )

      // Policy explicitly false overrides merged true
      seedHostSettings({
        policySettings: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
            network: { allowLocalBinding: false },
          },
        },
        merged: {
          sandbox: {
            enabled: true,
            network: { allowLocalBinding: true },
          },
        },
      })
      expect(areWindowsLocalConnectionsOn()).toBe(false)

      // On MXC backend, allowLocalBinding is forced false and warning is latched once
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'mxc' },
            network: { allowLocalBinding: true },
          },
        },
        merged: {
          sandbox: {
            windows: { backend: 'mxc' },
            network: { allowLocalBinding: true },
          },
        },
      })
      expect(areWindowsLocalConnectionsOn()).toBe(false)
      expect(windowsSandboxStartStore.get().mxcLocalConnectionsWarned).toBe(
        true,
      )
    })
  })

  test('per-SessionHost isolation keeps provider, backend latch, and warnings strictly isolated', () => {
    const providerA = makeMockProvider({ kind: 'srt-win', hasMxcSdk: true })
    const providerB = makeMockProvider({ kind: 'bun-ant', hasMxcSdk: false })

    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(providerA)
      windowsSandboxStartStore.markStarted('mxc')
      windowsSandboxStartStore.get().profileReadWarnings.push('host-a-warning')

      // Nested independent SessionHost must not see Host A's state
      runWithNewHostSession({}, () => {
        getPlatform.cache.set(undefined, 'windows')
        expect(getWindowsSandboxNativeProvider()).toBeUndefined()
        expect(SandboxManager.getProfileReadSecurityWarnings()).toEqual([])

        registerWindowsSandboxNativeProvider(providerB)
        windowsSandboxStartStore.markStarted('sandboxuser')
        windowsSandboxStartStore.get().profileReadWarnings.push('host-b-only')

        expect(getWindowsSandboxNativeProvider()?.kind).toBe('bun-ant')
        expect(SandboxManager.getWindowsSandboxBackend()).toBe('sandboxuser')
        expect(SandboxManager.getProfileReadSecurityWarnings()).toEqual([
          'host-b-only',
        ])
      })

      // Host A state remains intact
      expect(getWindowsSandboxNativeProvider()?.kind).toBe('srt-win')
      expect(SandboxManager.getWindowsSandboxBackend()).toBe('mxc')
      expect(SandboxManager.getProfileReadSecurityWarnings()).toEqual([
        'host-a-warning',
      ])
    })
  })
})

describe('Persistent Windows X.509 v3 CA generation & TLS CA verification', () => {
  test('throws sandbox_user_not_provisioned when user is unprovisioned or lacks credentials', async () => {
    const dir = makeTempDir('win-ca-unprov-')
    await expect(
      ensurePersistentWindowsCa({
        dir,
        status: makeProvisionedStatus({
          user: { provisioned: false, credPresent: true },
        }),
      }),
    ).rejects.toMatchObject({
      name: 'WindowsSandboxError',
      code: 'sandbox_user_not_provisioned',
    })

    await expect(
      ensurePersistentWindowsCa({
        dir,
        status: makeProvisionedStatus({
          user: { provisioned: true, credPresent: false },
        }),
      }),
    ).rejects.toMatchObject({
      name: 'WindowsSandboxError',
      code: 'sandbox_user_not_provisioned',
    })
  })

  test('generates real self-signed X.509 v3 CA cert, reuses idempotently, regenerates near expiry, and verifies SHA-256', async () => {
    const dir = makeTempDir('win-ca-real-')
    const status = makeProvisionedStatus()
    const baseNow = Date.UTC(2026, 10, 1, 0, 0, 0)

    const first = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow,
      validityDays: 365,
      regenerateWithinDays: 30,
    })

    expect(first.regenerated).toBe(true)
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(first.certPath)).toBe(true)
    expect(existsSync(first.keyPath)).toBe(true)
    expect(existsSync(join(dir, 'ca.json'))).toBe(true)

    // No leftover atomic temp files
    const files = readdirSync(dir)
    expect(files.some(f => f.includes('.tmp.'))).toBe(false)

    // Private key mode 0o600 on POSIX
    if (process.platform !== 'win32') {
      expect(statSync(first.keyPath).mode & 0o777).toBe(0o600)
    }

    // Genuine parseable X.509 v3 CA certificate verified with node:crypto
    const pem = readFileSync(first.certPath, 'utf8')
    const parsed = new X509Certificate(pem)
    expect(parsed.ca).toBe(true)
    expect(parsed.subject).toContain('Claude Code Windows Sandbox CA')
    expect(parsed.verify(parsed.publicKey)).toBe(true)

    // SHA-256 fingerprint verification
    expect(
      isInstalledWindowsTlsCaCurrent(first.fingerprint, {
        certPath: first.certPath,
      }),
    ).toBe(true)
    expect(
      isInstalledWindowsTlsCaCurrent('0'.repeat(64), {
        certPath: first.certPath,
      }),
    ).toBe(false)
    // Unreadable path returns true (official REs fail-open)
    expect(
      isInstalledWindowsTlsCaCurrent('0'.repeat(64), {
        certPath: join(dir, 'nonexistent.pem'),
      }),
    ).toBe(true)

    // Idempotent reuse when >30 days remaining
    const second = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow + 100 * 86_400_000,
      validityDays: 365,
      regenerateWithinDays: 30,
    })
    expect(second.regenerated).toBe(false)
    expect(second.fingerprint).toBe(first.fingerprint)

    // Regenerates when within 30 days of expiry
    const third = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow + 350 * 86_400_000,
      validityDays: 365,
      regenerateWithinDays: 30,
    })
    expect(third.regenerated).toBe(true)
    expect(third.fingerprint).not.toBe(first.fingerprint)
    expect(
      isInstalledWindowsTlsCaCurrent(third.fingerprint, {
        certPath: third.certPath,
      }),
    ).toBe(true)
  })

  test('resolveWindowsTlsTerminateCaSource handles MXC, trustedPair, managed, and unavailable', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')

      // MXC -> unavailable
      registerWindowsSandboxNativeProvider(
        makeMockProvider({ hasMxcSdk: true }),
      )
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'mxc' },
            network: { tlsTerminate: { caCertPath: 'C:\\ca.pem' } },
          },
        },
      })
      expect(resolveWindowsTlsTerminateCaSource()).toEqual({
        source: 'unavailable',
      })

      // sandboxuser + custom paths -> trustedPair
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: {
              tlsTerminate: {
                caCertPath: 'C:\\ca.pem',
                caKeyPath: 'C:\\ca.key',
              },
            },
          },
        },
      })
      expect(resolveWindowsTlsTerminateCaSource()).toEqual({
        source: 'trustedPair',
        caCertPath: 'C:\\ca.pem',
        caKeyPath: 'C:\\ca.key',
      })

      // sandboxuser + empty tlsTerminate + provider -> managed
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: { tlsTerminate: {} },
          },
        },
      })
      const caDir = makeTempDir('win-ca-src-')
      expect(resolveWindowsTlsTerminateCaSource({ caDir })).toEqual({
        source: 'managed',
        certPath: join(caDir, 'cert.pem'),
        keyPath: join(caDir, 'key.pem'),
      })

      // No provider -> unavailable
      registerWindowsSandboxNativeProvider(undefined)
      expect(resolveWindowsTlsTerminateCaSource()).toEqual({
        source: 'unavailable',
      })
    })
  })
})

describe('Provider lifecycle, error classifiers, and deduplicated install flow', () => {
  test('checkWindowsSandboxStatusAsync / installWindowsSandboxAsync / uninstallWindowsSandbox / forgetWindowsProfileReadAsync', async () => {
    await runWithNewHostSession({}, async () => {
      // Missing provider throws provider_unavailable
      await expect(checkWindowsSandboxStatusAsync()).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'provider_unavailable',
      })

      // Normal install
      const provider = makeMockProvider()
      registerWindowsSandboxNativeProvider(provider)
      const status = await checkWindowsSandboxStatusAsync()
      expect(status.user.provisioned).toBe(true)

      const installed = await installWindowsSandboxAsync()
      expect(installed.cancelled).toBeUndefined()
      expect(installed.wfp.state).toBe('installed')

      // UAC cancel exit code 10 on install
      const cancelInstallProvider = makeMockProvider({
        install: async () => ({ status: 10, stdout: '', stderr: 'cancelled' }),
      })
      const cancelledInstall = await installWindowsSandboxAsync({
        provider: cancelInstallProvider,
      })
      expect(cancelledInstall.cancelled).toBe(true)

      // Failed install throws install_failed
      const failInstallProvider = makeMockProvider({
        install: async () => ({
          status: 1,
          stdout: '',
          stderr: 'access denied',
        }),
      })
      await expect(
        installWindowsSandboxAsync({ provider: failInstallProvider }),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'install_failed',
      })

      // Uninstall success, UAC cancel 10, failure
      const uninstalled = await uninstallWindowsSandbox()
      expect(uninstalled.cancelled).toBeUndefined()

      const cancelledUninstall = await uninstallWindowsSandbox({
        provider: makeMockProvider({
          uninstall: async () => ({ status: 10, stdout: '', stderr: '' }),
        }),
      })
      expect(cancelledUninstall.cancelled).toBe(true)

      await expect(
        uninstallWindowsSandbox({
          provider: makeMockProvider({
            uninstall: async () => ({ status: 2, stdout: '', stderr: 'boom' }),
          }),
        }),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'uninstall_failed',
      })

      // forgetWindowsProfileReadAsync success and wrapped error
      expect(await forgetWindowsProfileReadAsync()).toEqual({ cleared: 2 })
      await expect(
        forgetWindowsProfileReadAsync({
          provider: makeMockProvider({
            forgetProfileRead: async () => {
              throw new Error('ACL busy')
            },
          }),
        }),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'profile_forget_failed',
        subcommand: 'profile',
      })
    })
  })

  test('classifyWindowsSandboxLaunchExit handles 0x80070005, 0x80070003, exit 19 WFP, seclogon, and unknown', () => {
    runWithNewHostSession({}, () => {
      windowsSandboxStartStore.get().selfExecGrantAttempt = 2
      const accessDenied = classifyWindowsSandboxLaunchExit(
        1,
        'CreateProcessWithLogonW failed: 0x80070005',
      )
      expect(accessDenied).toContain('0x80070005')
      expect(
        windowsSandboxStartStore.get().selfExecGrantAttempt,
      ).toBeUndefined()

      const brokenPath = classifyWindowsSandboxLaunchExit(
        1,
        'CreateProcessSecurityEnvironment failed with 0x80070003',
      )
      expect(brokenPath).toContain('0x80070003')

      const wfpFail = classifyWindowsSandboxLaunchExit(
        19,
        'WFP sublayer enforcement error',
      )
      expect(wfpFail).toContain('exit 19')

      const seclogonFail = classifyWindowsSandboxLaunchExit(
        1,
        'seclogon service is disabled (error 1058)',
      )
      expect(seclogonFail).toContain('Secondary Logon')

      expect(
        classifyWindowsSandboxLaunchExit(0, 'everything fine'),
      ).toBeUndefined()
    })
  })

  test('windowsArgvTooLongError returns official error with optional deny note', () => {
    const basic = windowsArgvTooLongError()
    expect(basic).toBeInstanceOf(WindowsSandboxError)
    expect(basic.code).toBe('argv_too_long')
    expect(basic.message).toContain('32,767')
    expect(basic.message).not.toContain('deny rules')

    const withDenies = windowsArgvTooLongError({ hasAddedDenies: true })
    expect(withDenies.code).toBe('argv_too_long')
    expect(withDenies.message).toContain('deny rules')
  })

  test('runWindowsSandboxInstallFlow deduplicates concurrent per-host calls and runs verifyWfp + persistent CA', async () => {
    const caDir = makeTempDir('win-install-flow-ca-')
    let installCalls = 0
    let verifyCalls = 0
    const progressEvents: string[] = []

    const slowProvider = makeMockProvider({
      install: async () => {
        installCalls++
        await new Promise(resolve => setTimeout(resolve, 25))
        return { status: 0, stdout: 'ok', stderr: '' }
      },
      verifyWfp: async () => {
        verifyCalls++
        return { exitCode: 0, stdout: 'verified', stderr: '' }
      },
    })

    await runWithNewHostSession({}, async () => {
      const host = getBootstrapSessionHost()
      const [res1, res2] = await Promise.all([
        runWindowsSandboxInstallFlow(
          host,
          msg => progressEvents.push(msg),
          5000,
          {
            provider: slowProvider,
            caDir,
            willTlsTerminate: true,
          },
        ),
        runWindowsSandboxInstallFlow(
          host,
          msg => progressEvents.push(msg),
          5000,
          {
            provider: slowProvider,
            caDir,
            willTlsTerminate: true,
          },
        ),
      ])

      expect(res1).toBe(res2)
      expect(installCalls).toBe(1)
      expect(verifyCalls).toBe(1)
      expect(res1.cancelled).toBe(false)
      expect(res1.wfpVerify?.exitCode).toBe(0)
      expect(res1.ca?.regenerated).toBe(true)
      expect(progressEvents.length).toBeGreaterThanOrEqual(3)

      // Subsequent call after completion starts a fresh flow and reuses existing CA
      const res3 = await runWindowsSandboxInstallFlow(host, undefined, 5000, {
        provider: slowProvider,
        caDir,
        willTlsTerminate: true,
      })
      expect(installCalls).toBe(2)
      expect(res3.ca?.regenerated).toBe(false)
      expect(res3.ca?.fingerprint).toBe(res1.ca?.fingerprint)
    })
  })
})

describe('Windows sandbox security hardening regressions (P0-2, P1-1, P1-4, P1-8, P1-14, P2-3, P2-4)', () => {
  test('P0-2: adaptSrtWinNativeProvider.applyDenies & forgetProfileRead reject realUserSid and never pass it', async () => {
    const realSid = 'S-1-5-21-1000-2000-3000-1001'
    const sandboxSid = 'S-1-5-21-1000-2000-3000-9999'
    const receivedDeniesSids: Array<string | undefined> = []
    const receivedForgetSids: Array<string | undefined> = []

    const fakeSrtProvider: SrtWinNativeProvider = {
      srtWinCommand: { exe: 'srt-win', prependArgs: [] },
      async checkStatus() {
        return {
          user: {
            provisioned: true,
            credPresent: true,
            realUserSid: realSid,
            sandboxUser: 'ClaudeSandbox_abc',
            seclogonState: 'running',
          },
          wfp: {
            state: 'installed',
            allowLoopback: false,
            sublayerGuid: null,
            proxyPortRange: [60080, 60089],
          },
        }
      },
      async install() {
        throw new Error('unused')
      },
      async uninstall() {
        throw new Error('unused')
      },
      async verifyWfp() {
        return {
          egress_probe: 'blocked',
          target: '1.1.1.1:443',
          write_restricted_token: true,
        }
      },
      async forgetProfileRead(opts) {
        receivedForgetSids.push(opts?.sid)
        return { cleared: true, deferred: false }
      },
      async applyDenies(req) {
        receivedDeniesSids.push(req.sid)
        return {
          inPlace: 1,
          planted: 0,
          laid: 0,
          pushedDown: 0,
          guarded: 0,
          extrasSkipped: 0,
          ms: 1,
          stands: 0,
          handedBack: 0,
        }
      },
      async probeMxc() {
        throw new Error('unused')
      },
      async spawnSandboxed() {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          outputLimitExceeded: false,
          signal: null,
        }
      },
    }

    const adapted = adaptSrtWinNativeProvider(fakeSrtProvider)

    // Passing realUserSid (exact or case-insensitive) must reject with invalid_sid
    await expect(
      adapted.applyDenies!({
        denyRead: ['C:\\secret'],
        denyWrite: [],
        allowWrite: [],
        sid: realSid,
      }),
    ).rejects.toMatchObject({
      name: 'WindowsSandboxError',
      code: 'invalid_sid',
      message: 'Refusing to apply sandbox denies to the current user SID',
    })

    await expect(
      adapted.applyDenies!({
        denyRead: ['C:\\secret'],
        denyWrite: [],
        allowWrite: [],
        sid: realSid.toLowerCase(),
      }),
    ).rejects.toMatchObject({
      name: 'WindowsSandboxError',
      code: 'invalid_sid',
    })

    // Omitting sid must NEVER forward realUserSid (leaves undefined for srt-win to resolve sandbox account SID)
    await adapted.applyDenies!({
      denyRead: ['C:\\secret'],
      denyWrite: [],
      allowWrite: [],
    })
    expect(receivedDeniesSids).toEqual([undefined])

    // Explicit distinct sandbox SID is forwarded
    await adapted.applyDenies!({
      denyRead: ['C:\\secret'],
      denyWrite: [],
      allowWrite: [],
      sid: sandboxSid,
    })
    expect(receivedDeniesSids).toEqual([undefined, sandboxSid])

    // forgetProfileRead rejects explicit realUserSid and omits sid by default
    await expect(
      adapted.forgetProfileRead!({ sid: realSid }),
    ).rejects.toMatchObject({
      name: 'WindowsSandboxError',
      code: 'invalid_sid',
    })
    await adapted.forgetProfileRead!({ timeoutMs: 2500 })
    expect(receivedForgetSids).toEqual([undefined])
  })

  test('P1-1: spawnSandboxedOnWindows checks full command + args UTF-16 length including NUL terminator', async () => {
    expect(WINDOWS_ARGV_MAX_LENGTH).toBe(32_766)
    expect(estimateWindowsCommandLineUtf16Length('a'.repeat(32_766))).toBe(
      32_766,
    )
    expect(isWindowsCommandLineTooLong('a'.repeat(32_766))).toBe(false)
    expect(isWindowsCommandLineTooLong('a'.repeat(32_767))).toBe(true)

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(makeMockProvider())
      seedHostSettings({
        userSettings: { sandbox: { windows: { backend: 'sandboxuser' } } },
      })

      // Long args combined with short command must throw argv_too_long
      await expect(
        SandboxManager.spawnSandboxedOnWindows('powershell.exe', {
          args: ['-Command', 'x'.repeat(33_000)],
        }),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'argv_too_long',
      })

      // Exact 32,767-char command (+1 NUL = 32,768 > 32,767) must throw argv_too_long
      await expect(
        SandboxManager.spawnSandboxedOnWindows('a'.repeat(32_767)),
      ).rejects.toMatchObject({
        name: 'WindowsSandboxError',
        code: 'argv_too_long',
      })

      // Exact 32,766-char command (+1 NUL = 32,767 <= 32,767) is accepted
      const exactMax = 'a'.repeat(32_766)
      const ok = await SandboxManager.spawnSandboxedOnWindows(exactMax)
      expect(ok.exitCode).toBe(0)
    })
  })

  test('P1-4: rejected runWindowsSandboxInstallFlow cleans up in-flight slot without UnhandledPromiseRejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await runWithNewHostSession({}, async () => {
        const host = getBootstrapSessionHost()
        let attempt = 0
        const flakyProvider = makeMockProvider({
          install: async () => {
            attempt++
            if (attempt === 1) {
              throw new Error('transient UAC failure')
            }
            return { status: 0, stdout: 'ok', stderr: '' }
          },
        })

        await expect(
          runWindowsSandboxInstallFlow(host, undefined, 5000, {
            provider: flakyProvider,
            willTlsTerminate: false,
          }),
        ).rejects.toThrow('transient UAC failure')

        // Flush microtasks/macrotask to catch any stray unhandledRejection
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(unhandled).toEqual([])

        // Subsequent call starts cleanly because in-flight slot was cleared
        const retry = await runWindowsSandboxInstallFlow(
          host,
          undefined,
          5000,
          {
            provider: flakyProvider,
            willTlsTerminate: false,
          },
        )
        expect(retry.cancelled).toBe(false)
        expect(attempt).toBe(2)
      })
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('P1-8 & P2-3: ensurePersistentWindowsCa enforces SubjectKeyIdentifier (2.5.29.14), key-pair match, validFrom, size cap, and 0o700 dir', async () => {
    const parent = makeTempDir('win-ca-hardening-')
    const dir = join(parent, 'nested-ca')
    const status = makeProvisionedStatus()
    const baseNow = Date.UTC(2026, 10, 1, 0, 0, 0)

    const first = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow,
      validityDays: 365,
      regenerateWithinDays: 30,
    })
    expect(first.regenerated).toBe(true)

    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700)
    }
    expect(readdirSync(dir).some(f => f.includes('.tmp.'))).toBe(false)

    // P2-3: Verify RFC 5280 §4.2.1.2 SubjectKeyIdentifier (OID 2.5.29.14 = 06 03 55 1d 0e)
    const certPem = readFileSync(first.certPath, 'utf8')
    const parsedCert = new X509Certificate(certPem)
    const certDer = Buffer.from(parsedCert.raw)
    const skiOidBytes = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x0e])
    expect(certDer.includes(skiOidBytes)).toBe(true)

    // Also verify the SKI 20-byte SHA-1 matches the public key SPKI BIT STRING contents
    const spkiDer = parsedCert.publicKey.export({
      type: 'spki',
      format: 'der',
    }) as Buffer
    // Locate BIT STRING (0x03) inside SPKI after outer SEQUENCE + AlgorithmIdentifier SEQUENCE
    const bitStringOffset = spkiDer.indexOf(Buffer.from([0x05, 0x00, 0x03]))
    expect(bitStringOffset).toBeGreaterThan(0)
    const bsLenPos = bitStringOffset + 3
    const bsLenByte = spkiDer[bsLenPos]!
    const bsHeaderLen = (bsLenByte & 0x80) !== 0 ? 1 + (bsLenByte & 0x7f) : 1
    // Skip unused-bits byte (0x00)
    const spkiKeyBits = spkiDer.subarray(bsLenPos + bsHeaderLen + 1)
    const expectedSki = createHash('sha1').update(spkiKeyBits).digest()
    expect(certDer.includes(expectedSki)).toBe(true)

    // P1-8: Mismatched key.pem must trigger clean regeneration
    const unrelatedKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey
    writeFileSync(first.keyPath, unrelatedKey, { mode: 0o600 })

    const regeneratedAfterKeyMismatch = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow + 10 * 86_400_000,
      validityDays: 365,
      regenerateWithinDays: 30,
    })
    expect(regeneratedAfterKeyMismatch.regenerated).toBe(true)
    expect(regeneratedAfterKeyMismatch.fingerprint).not.toBe(first.fingerprint)

    // P1-8: Not-yet-valid cert (nowMs earlier than validFrom) must trigger regeneration
    const regeneratedBeforeValidFrom = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow - 60 * 60_000,
      validityDays: 365,
      regenerateWithinDays: 30,
    })
    expect(regeneratedBeforeValidFrom.regenerated).toBe(true)
    expect(regeneratedBeforeValidFrom.fingerprint).not.toBe(
      regeneratedAfterKeyMismatch.fingerprint,
    )

    // P1-8: Oversized cert.pem (> 65,536 bytes) must be rejected and regenerated
    writeFileSync(first.certPath, `${'A'.repeat(70_000)}\n`)
    const regeneratedAfterOversized = await ensurePersistentWindowsCa({
      dir,
      status,
      nowMs: baseNow,
      validityDays: 365,
      regenerateWithinDays: 30,
    })
    expect(regeneratedAfterOversized.regenerated).toBe(true)
    expect(new X509Certificate(readFileSync(first.certPath, 'utf8')).ca).toBe(
      true,
    )
  })

  test('P2-4: SandboxManager.getSandboxUnavailableReason reports accurate Windows message when no provider is available', () => {
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(null)
      seedHostSettings({
        userSettings: { sandbox: { enabled: true } },
        merged: { sandbox: { enabled: true } },
      })

      const reason = SandboxManager.getSandboxUnavailableReason()
      expect(reason).toContain('Windows sandbox is not enabled on this build')
      expect(reason).toContain('srt-win.exe')
      expect(reason).not.toContain('requires macOS, Linux, or WSL2')
    })
  })

  test('Round-2 P1-4 & R3-P2-4: buildWindowsKeyFileIcaclsArgs and buildWindowsCaDirIcaclsArgs use sandbox-runtime and validate realUserSid', () => {
    const withRealUser = buildWindowsKeyFileIcaclsArgs(
      'C:\\ProgramData\\sandbox-runtime\\ca\\key.pem',
      'S-1-5-21-100-200-300-1001',
    )
    expect(withRealUser).toEqual([
      'C:\\ProgramData\\sandbox-runtime\\ca\\key.pem',
      '/inheritance:r',
      '/grant:r',
      '*S-1-5-18:F',
      '/grant:r',
      '*S-1-5-32-544:F',
      '/grant:r',
      '*S-1-5-21-100-200-300-1001:F',
    ])

    const withBadSid = buildWindowsKeyFileIcaclsArgs(
      'C:\\ProgramData\\sandbox-runtime\\ca\\key.pem',
      'Everyone:F /grant *S-1-1-0',
    )
    expect(withBadSid).toEqual([
      'C:\\ProgramData\\sandbox-runtime\\ca\\key.pem',
      '/inheritance:r',
      '/grant:r',
      '*S-1-5-18:F',
      '/grant:r',
      '*S-1-5-32-544:F',
    ])

    const dirArgs = buildWindowsCaDirIcaclsArgs(
      'C:\\ProgramData\\sandbox-runtime\\ca',
      'S-1-5-21-100-200-300-1001',
    )
    expect(dirArgs).toEqual([
      'C:\\ProgramData\\sandbox-runtime\\ca',
      '/inheritance:r',
      '/grant:r',
      '*S-1-5-18:(OI)(CI)F',
      '/grant:r',
      '*S-1-5-32-544:(OI)(CI)F',
      '/grant:r',
      '*S-1-5-21-100-200-300-1001:(OI)(CI)F',
    ])
  })

  test('R3-P0-4: ensurePersistentWindowsCa hardens ca/ dir BEFORE writing key.pem temp file and fails closed with temp cleanup on icacls error', async () => {
    const dir = join(makeTempDir('win-ca-r3-p0-4-'), 'ca')
    const status = makeProvisionedStatus()
    const icaclsCalls: Array<{ path: string; args: string[] }> = []

    // 1. Happy path: directory ACL hardening executes BEFORE any temp key.pem file exists
    const created = await ensurePersistentWindowsCa({
      dir,
      status,
      platform: 'win32',
      icaclsRunner: (_exe, args) => {
        const target = args[0]!
        if (target === dir) {
          // Directory must be empty (no key.pem or .tmp file written yet!)
          expect(readdirSync(dir)).toEqual([])
        }
        icaclsCalls.push({ path: target, args })
      },
    })
    expect(created.regenerated).toBe(true)
    expect(icaclsCalls.length).toBe(2)
    expect(icaclsCalls[0]!.path).toBe(dir)
    expect(icaclsCalls[0]!.args).toContain('*S-1-5-18:(OI)(CI)F')
    expect(icaclsCalls[1]!.path).toContain('key.pem.tmp.')
    expect(icaclsCalls[1]!.args).toContain('*S-1-5-18:F')

    // 2. Fail closed when icacls fails on key.pem temp file: throws ca_acl_failed and unlinks temp file
    const failDir = join(makeTempDir('win-ca-r3-p0-4-fail-'), 'ca')
    await expect(
      ensurePersistentWindowsCa({
        dir: failDir,
        status,
        platform: 'win32',
        icaclsRunner: (_exe, args) => {
          if (args[0]!.includes('key.pem.tmp.')) {
            throw new Error('icacls access denied')
          }
        },
      }),
    ).rejects.toMatchObject({
      name: 'WindowsSandboxError',
      code: 'ca_acl_failed',
    })
    expect(existsSync(join(failDir, 'key.pem'))).toBe(false)
    expect(readdirSync(failDir).some(f => f.includes('.tmp.'))).toBe(false)
  })

  test('R3-P0-6: wrapWithSandbox & wrapWithSandboxArgv work cleanly on Windows without throwing BaseSandboxManager error', async () => {
    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(
        makeMockProvider({
          kind: 'srt-win',
          srtWinCommand: {
            exe: 'C:\\Program Files\\Claude\\vendor\\win-sandbox\\srt-win.exe',
            prependArgs: [],
          },
        }),
      )
      seedHostSettings({
        userSettings: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
          },
        },
        merged: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
          },
        },
      })

      const argvRes = await SandboxManager.wrapWithSandboxArgv(
        'echo hello world',
        'powershell.exe',
      )
      expect(argvRes.argv[0]).toBe(
        'C:\\Program Files\\Claude\\vendor\\win-sandbox\\srt-win.exe',
      )
      expect(argvRes.argv).toContain('run')
      expect(argvRes.argv).toContain('powershell.exe')
      expect(argvRes.argv).toContain('echo hello world')

      const wrappedStr = await SandboxManager.wrapWithSandbox(
        'echo "hello world"',
        'cmd.exe',
      )
      expect(wrappedStr).toContain(
        '"C:\\Program Files\\Claude\\vendor\\win-sandbox\\srt-win.exe"',
      )
      expect(wrappedStr).toContain('cmd.exe')
      await SandboxManager.reset()
    })
  })

  test('E5-P1-2: Windows wrapWithSandboxArgv runs preflight & applyDenies (fail-closed) and encodes multi-line PowerShell/bash commands without CR/LF', async () => {
    const appliedDenies: Array<{
      denyRead: string[]
      denyWrite: string[]
      allowWrite: string[]
    }> = []
    let shouldFailDenies = false

    await runWithNewHostSession({}, async () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(
        makeMockProvider({
          kind: 'srt-win',
          srtWinCommand: {
            exe: 'C:\\Program Files\\Claude\\vendor\\win-sandbox\\srt-win.exe',
            prependArgs: [],
          },
          applyDenies: async req => {
            appliedDenies.push({
              denyRead: req.denyRead,
              denyWrite: req.denyWrite,
              allowWrite: req.allowWrite,
            })
            if (shouldFailDenies) {
              throw new Error('Unguarded deny target inside allowWrite')
            }
            return {
              inPlace: 0,
              planted: req.denyRead.length + req.denyWrite.length,
              laid: req.allowWrite.length,
              pushedDown: 0,
              guarded: req.denyRead.length + req.denyWrite.length,
              extrasSkipped: 0,
              ms: 1,
              stands: [],
              handedBack: [],
            }
          },
        }),
      )
      seedHostSettings({
        userSettings: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
          },
        },
        merged: {
          sandbox: {
            enabled: true,
            windows: { backend: 'sandboxuser' },
          },
        },
      })

      // 1. Multi-line PowerShell command encodes via -EncodedCommand (UTF-16LE base64), zero CR/LF
      const psScript = 'Write-Output "line1"\r\nWrite-Output "line2"'
      const psRes = await SandboxManager.wrapWithSandboxArgv(
        psScript,
        'powershell.exe',
        {
          filesystem: {
            denyRead: ['C:\\Users\\alice\\.ssh'],
            denyWrite: ['C:\\work\\.git\\config'],
            allowWrite: ['C:\\work'],
          },
        },
      )
      expect(appliedDenies).toHaveLength(1)
      expect(appliedDenies[0]!.denyRead).toContain('C:\\Users\\alice\\.ssh')
      expect(appliedDenies[0]!.denyWrite).toContain('C:\\work\\.git\\config')
      expect(appliedDenies[0]!.allowWrite).toContain('C:\\work')
      expect(psRes.argv.every(a => !/[\r\n]/.test(a))).toBe(true)
      const encIdx = psRes.argv.indexOf('-EncodedCommand')
      expect(encIdx).toBeGreaterThan(-1)
      const decodedPs = Buffer.from(psRes.argv[encIdx + 1]!, 'base64').toString(
        'utf16le',
      )
      expect(decodedPs).toBe(psScript)

      // 2. Multi-line bash command encodes via single-line base64 eval, zero CR/LF
      const bashScript = 'echo line1\necho line2'
      const bashRes = await SandboxManager.wrapWithSandboxArgv(
        bashScript,
        'C:\\Program Files\\Git\\bin\\bash.exe',
      )
      expect(bashRes.argv.every(a => !/[\r\n]/.test(a))).toBe(true)
      const cIdx = bashRes.argv.indexOf('-c')
      expect(cIdx).toBeGreaterThan(-1)
      const evalCmd = bashRes.argv[cIdx + 1]!
      const b64Match = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d/.exec(
        evalCmd,
      )
      expect(b64Match?.[1]).toBeTruthy()
      expect(Buffer.from(b64Match![1]!, 'base64').toString('utf8')).toBe(
        bashScript,
      )

      // 3. Fail closed when provider.applyDenies rejects
      shouldFailDenies = true
      await expect(
        SandboxManager.wrapWithSandboxArgv('echo should-fail', 'pwsh.exe'),
      ).rejects.toThrow(/Unguarded deny target/)

      await SandboxManager.reset()
    })
  })

  test('R3-P2-1 & R3-P2-3: adaptSrtWinNativeProvider forwards sublayerGuid & cannot-read; trustedPair requires both caCertPath & caKeyPath; installFlow auto-discovers provider', async () => {
    const receivedGuids: Array<string | undefined> = []
    const fakeSrt: SrtWinNativeProvider = {
      srtWinCommand: { exe: 'srt-win', prependArgs: [] },
      async checkStatus(opts) {
        receivedGuids.push(opts?.sublayerGuid)
        return {
          user: {
            provisioned: true,
            credPresent: true,
            realUserSid: 'S-1-5-21-1-2-3-1001',
            sandboxUser: 'claude_srt',
            seclogonState: 'running',
          },
          wfp: {
            state: 'cannot-read',
            allowLoopback: false,
            sublayerGuid: null,
            proxyPortRange: null,
          },
        }
      },
      async install() {
        throw new Error('unused')
      },
      async uninstall() {
        throw new Error('unused')
      },
      async verifyWfp() {
        return {
          egress_probe: 'blocked',
          target: '1.1.1.1:443',
          write_restricted_token: true,
        }
      },
      async forgetProfileRead() {
        return { cleared: true, deferred: false }
      },
      async applyDenies() {
        return {
          inPlace: 0,
          planted: 0,
          laid: 0,
          pushedDown: 0,
          guarded: 0,
          extrasSkipped: 0,
          ms: 1,
          stands: 0,
          handedBack: 0,
        }
      },
      async probeMxc() {
        throw new Error('unused')
      },
      async spawnSandboxed() {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          outputLimitExceeded: false,
          signal: null,
        }
      },
    }

    const adapted = adaptSrtWinNativeProvider(fakeSrt)
    const st = await adapted.checkStatus({
      sublayerGuid: 'c8d1f2a4-5e7b-4a9c-8d12-3f6a9b0c1e2f',
    })
    expect(receivedGuids).toEqual(['c8d1f2a4-5e7b-4a9c-8d12-3f6a9b0c1e2f'])
    expect(st.wfp.state).toBe('cannot-read')

    // R3-P2-3: trustedPair requires BOTH caCertPath AND caKeyPath
    runWithNewHostSession({}, () => {
      getPlatform.cache.set(undefined, 'windows')
      registerWindowsSandboxNativeProvider(makeMockProvider())
      seedHostSettings({
        userSettings: {
          sandbox: {
            windows: { backend: 'sandboxuser' },
            network: {
              tlsTerminate: { caCertPath: 'C:\\only-cert.pem' },
            },
          },
        },
      })
      const caDir = makeTempDir('win-ca-pair-check-')
      // Missing caKeyPath -> must NOT return trustedPair, falls back to managed
      expect(resolveWindowsTlsTerminateCaSource({ caDir })).toEqual({
        source: 'managed',
        certPath: join(caDir, 'cert.pem'),
        keyPath: join(caDir, 'key.pem'),
      })

      // Ensure process-level negative discovery helper returns undefined cleanly when disabled
      registerWindowsSandboxNativeProvider(null)
      expect(ensureDefaultWindowsSandboxNativeProvider()).toBeUndefined()
    })
  })
})
