import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { createHash, generateKeyPairSync, sign } from 'crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as growthbook from 'src/services/analytics/growthbook.js'
import * as autoUpdaterMod from '../autoUpdater.js'
import * as bundledModeMod from '../bundledMode.js'
import {
  checkGlobalInstallPermissions,
  classifyNpmStderrSignature,
  getGlobalPackageManager,
  getLatestVersion,
  getMaxVersion,
  installGlobalPackage,
  isPathInBunGlobalInstall,
  locatePreservedBackupForTests,
  mintPreservedInodeForTests,
  PLACEHOLDER_STUB_SENTINEL,
} from '../autoUpdater.js'
import { env } from '../env.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import * as execMod from '../execFileNoThrow.js'
import * as downloadMod from '../nativeInstaller/download.js'
import {
  downloadVersionFromBinaryRepo,
  fetchAndVerifyReleaseManifest,
  getManifestSignaturePolicy,
  isManifestSignatureEnforced,
  isReleaseEnforcingManifestSignature,
  MANIFEST_SIGNATURE_DOMAIN_PREFIX,
  ManifestSignatureError,
  verifyReleaseManifestSignature,
} from '../nativeInstaller/download.js'
import {
  clearVerifiedVersionsCacheForTesting,
  getBinaryName,
  getPlatform,
  installLatest,
  StagedBinaryChecksumMismatchError,
  updateSymlink,
} from '../nativeInstaller/installer.js'
import { getXDGDataHome } from '../xdg.js'

const { publicKey: TEST_PUB_KEY, privateKey: TEST_PRIV_KEY } =
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

const TEST_PUB_KEY_SHA256 = createHash('sha256')
  .update(
    Buffer.from(
      TEST_PUB_KEY.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
      'base64',
    ),
  )
  .digest('hex')

function signManifest(manifestObj: Record<string, unknown>) {
  const manifestBytes = Buffer.from(JSON.stringify(manifestObj), 'utf8')
  const payload = Buffer.concat([
    MANIFEST_SIGNATURE_DOMAIN_PREFIX,
    manifestBytes,
  ])
  const signature = sign('sha512', payload, TEST_PRIV_KEY).toString('base64')
  const sidecar = {
    schema: 1 as const,
    algorithm: 'RSASSA-PKCS1-v1_5-SHA512' as const,
    signature,
    publicKeySha256: TEST_PUB_KEY_SHA256,
  }
  return { manifestBytes, sidecar }
}

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex')
}

function make404Error(url: string): Error {
  const err = new Error(
    `Request failed with status code 404 (${url})`,
  ) as Error & {
    isAxiosError: boolean
    response: { status: number }
  }
  err.isAxiosError = true
  err.response = { status: 404 }
  return err
}

describe('Deep Parity Fix 4: Auto-Update & Install Integrity (2.1.328)', () => {
  let tempRoot: string
  let savedConfigDir: string | undefined
  let savedXdgData: string | undefined
  let savedXdgCache: string | undefined
  let savedXdgState: string | undefined
  let savedHome: string | undefined
  let savedBunInstall: string | undefined
  let savedUserType: string | undefined
  let savedEnableLockless: string | undefined
  let savedMacro: unknown
  const origExecPath = process.execPath
  const origArgv1 = process.argv[1]
  const origPlatform = env.platform

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cc-integrity-328-'))
    savedMacro = (globalThis as { MACRO?: unknown }).MACRO
    ;(globalThis as { MACRO?: Record<string, string> }).MACRO = {
      VERSION: '2.1.328',
      PACKAGE_URL: '@go-hare/claude-code',
      NATIVE_PACKAGE_URL: '@anthropic-ai/claude-cli-native',
      ISSUES_EXPLAINER: '',
      README_URL: '',
      FEEDBACK_CHANNEL: '',
      BUILD_TIME: '2026-11-20T00:00:00Z',
    }
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    savedXdgData = process.env.XDG_DATA_HOME
    savedXdgCache = process.env.XDG_CACHE_HOME
    savedXdgState = process.env.XDG_STATE_HOME
    savedHome = process.env.HOME
    savedBunInstall = process.env.BUN_INSTALL
    savedUserType = process.env.USER_TYPE
    savedEnableLockless = process.env.ENABLE_LOCKLESS_UPDATES

    process.env.CLAUDE_CONFIG_DIR = join(tempRoot, 'config')
    process.env.XDG_DATA_HOME = join(tempRoot, 'data')
    process.env.XDG_CACHE_HOME = join(tempRoot, 'cache')
    process.env.XDG_STATE_HOME = join(tempRoot, 'state')
    process.env.HOME = join(tempRoot, 'home')
    mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
    mkdirSync(process.env.HOME, { recursive: true })
    delete process.env.USER_TYPE
    process.env.ENABLE_LOCKLESS_UPDATES = '1'
    getClaudeConfigHomeDir.cache?.clear?.()
    clearVerifiedVersionsCacheForTesting()
  })

  afterEach(() => {
    Object.defineProperty(process, 'execPath', {
      value: origExecPath,
      configurable: true,
      writable: true,
    })
    process.argv[1] = origArgv1
    env.platform = origPlatform
    if (savedMacro === undefined) {
      delete (globalThis as { MACRO?: unknown }).MACRO
    } else {
      ;(globalThis as { MACRO?: unknown }).MACRO = savedMacro
    }

    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    restore('CLAUDE_CONFIG_DIR', savedConfigDir)
    restore('XDG_DATA_HOME', savedXdgData)
    restore('XDG_CACHE_HOME', savedXdgCache)
    restore('XDG_STATE_HOME', savedXdgState)
    restore('HOME', savedHome)
    restore('BUN_INSTALL', savedBunInstall)
    restore('USER_TYPE', savedUserType)
    restore('ENABLE_LOCKLESS_UPDATES', savedEnableLockless)
    getClaudeConfigHomeDir.cache?.clear?.()
    clearVerifiedVersionsCacheForTesting()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  // =========================================================================
  // Bug 1 (P1): Post-install target binary `--version` probe (`XKt` / `Fe`)
  // =========================================================================
  describe('Bug 1: installGlobalPackage post-install target binary --version probe', () => {
    // These tests exercise the npm install path. Under `bun test` the runtime
    // IS Bun running JS (not a compiled binary), so `getGlobalPackageManager`
    // would honestly pick 'bun' per official `oe`. Pin `isInBundledMode` → true
    // to simulate the npm-installed compiled binary these cases target.
    let bundledSpy: { mockRestore: () => void } | undefined
    beforeEach(() => {
      bundledSpy = spyOn(bundledModeMod, 'isInBundledMode').mockReturnValue(
        true,
      )
    })
    afterEach(() => {
      bundledSpy?.mockRestore()
    })

    test('exit 0 leaving placeholder stub (sentinel message) returns native_binary_missing', async () => {
      const prefixDir = join(tempRoot, 'npm-prefix')
      mkdirSync(join(prefixDir, 'bin'), { recursive: true })
      Object.defineProperty(process, 'execPath', {
        value: '/usr/local/lib/node_modules/@go-hare/claude-code/claude',
        configurable: true,
        writable: true,
      })

      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockImplementation(async (file, args) => {
        if (file === 'npm' && args[0] === '-g') {
          return { stdout: `${prefixDir}\n`, stderr: '', code: 0 }
        }
        if (file === 'npm' && args[0] === 'install') {
          return { stdout: 'added 1 package\n', stderr: '', code: 0 }
        }
        if (
          file === join(prefixDir, 'bin', 'claude') &&
          args[0] === '--version'
        ) {
          return {
            stdout: '',
            stderr: `Error: ${PLACEHOLDER_STUB_SENTINEL}`,
            code: 1,
          }
        }
        if (
          file === 'npm' &&
          args[0] === 'config' &&
          args[2] === 'ignore-scripts'
        ) {
          return { stdout: 'false\n', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 1 }
      })

      try {
        const outcome = await installGlobalPackage('2.1.329')
        expect(outcome).toEqual({
          status: 'install_failed',
          failureHint: 'native_binary_missing',
        })
      } finally {
        execSpy.mockRestore()
      }
    })

    test('exit 0 leaving small placeholder binary (<65536 bytes) on disk returns native_binary_missing', async () => {
      const prefixDir = join(tempRoot, 'npm-prefix-small')
      mkdirSync(join(prefixDir, 'bin'), { recursive: true })
      const binFile = join(prefixDir, 'bin', 'claude')
      writeFileSync(binFile, '#!/bin/sh\nexit 1\n', 'utf8')
      Object.defineProperty(process, 'execPath', {
        value: '/usr/local/lib/node_modules/@go-hare/claude-code/claude',
        configurable: true,
        writable: true,
      })

      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockImplementation(async (file, args) => {
        if (file === 'npm' && args[0] === '-g') {
          return { stdout: `${prefixDir}\n`, stderr: '', code: 0 }
        }
        if (file === 'npm' && args[0] === 'install') {
          return { stdout: 'added 1 package\n', stderr: '', code: 0 }
        }
        if (file === binFile && args[0] === '--version') {
          return { stdout: '', stderr: 'broken binary', code: 1 }
        }
        if (
          file === 'npm' &&
          args[0] === 'config' &&
          args[2] === 'ignore-scripts'
        ) {
          return { stdout: 'false\n', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 1 }
      })

      try {
        const outcome = await installGlobalPackage('2.1.329')
        expect(outcome).toEqual({
          status: 'install_failed',
          failureHint: 'native_binary_missing',
        })
      } finally {
        execSpy.mockRestore()
      }
    })

    test('exit 0 with placeholder stub trusts exit code when npm ignore-scripts=true', async () => {
      const prefixDir = join(tempRoot, 'npm-prefix-ignore-scripts')
      mkdirSync(join(prefixDir, 'bin'), { recursive: true })
      Object.defineProperty(process, 'execPath', {
        value: '/usr/local/lib/node_modules/@go-hare/claude-code/claude',
        configurable: true,
        writable: true,
      })

      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockImplementation(async (file, args) => {
        if (file === 'npm' && args[0] === '-g') {
          return { stdout: `${prefixDir}\n`, stderr: '', code: 0 }
        }
        if (file === 'npm' && args[0] === 'install') {
          return { stdout: 'added 1 package\n', stderr: '', code: 0 }
        }
        if (
          file === join(prefixDir, 'bin', 'claude') &&
          args[0] === '--version'
        ) {
          return { stdout: '', stderr: PLACEHOLDER_STUB_SENTINEL, code: 1 }
        }
        if (
          file === 'npm' &&
          args[0] === 'config' &&
          args[2] === 'ignore-scripts'
        ) {
          return { stdout: 'true\n', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 1 }
      })

      try {
        const outcome = await installGlobalPackage('2.1.329')
        expect(outcome.status).toBe('success')
      } finally {
        execSpy.mockRestore()
      }
    })

    test('warning-only non-zero exit returns success when re-probe confirms target version landed', async () => {
      const prefixDir = join(tempRoot, 'npm-prefix-warn-ok')
      mkdirSync(join(prefixDir, 'bin'), { recursive: true })
      Object.defineProperty(process, 'execPath', {
        value: '/usr/local/lib/node_modules/@go-hare/claude-code/claude',
        configurable: true,
        writable: true,
      })

      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockImplementation(async (file, args) => {
        if (file === 'npm' && args[0] === '-g') {
          return { stdout: `${prefixDir}\n`, stderr: '', code: 0 }
        }
        if (file === 'npm' && args[0] === 'install') {
          return {
            stdout: '',
            stderr:
              'npm warn Unknown user config "foo"\nnpm notice New minor version of npm available',
            code: 1,
          }
        }
        if (
          file === join(prefixDir, 'bin', 'claude') &&
          args[0] === '--version'
        ) {
          return { stdout: '2.1.329 (Claude Code)\n', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 1 }
      })

      try {
        expect(
          classifyNpmStderrSignature('npm warn Unknown user config "foo"'),
        ).toBe('warning_only')
        const outcome = await installGlobalPackage('2.1.329')
        expect(outcome.status).toBe('success')
        expect(typeof outcome.probeDurationMs).toBe('number')
      } finally {
        execSpy.mockRestore()
      }
    })

    test('warning-only non-zero exit still fails when re-probe shows old version', async () => {
      const prefixDir = join(tempRoot, 'npm-prefix-warn-fail')
      mkdirSync(join(prefixDir, 'bin'), { recursive: true })
      Object.defineProperty(process, 'execPath', {
        value: '/usr/local/lib/node_modules/@go-hare/claude-code/claude',
        configurable: true,
        writable: true,
      })

      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockImplementation(async (file, args) => {
        if (file === 'npm' && args[0] === '-g') {
          return { stdout: `${prefixDir}\n`, stderr: '', code: 0 }
        }
        if (file === 'npm' && args[0] === 'install') {
          return {
            stdout: '',
            stderr: 'npm warn deprecated pkg@1.0.0',
            code: 1,
          }
        }
        if (
          file === join(prefixDir, 'bin', 'claude') &&
          args[0] === '--version'
        ) {
          return { stdout: '2.1.320 (Claude Code)\n', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 1 }
      })

      try {
        const outcome = await installGlobalPackage('2.1.329')
        expect(outcome).toEqual({ status: 'install_failed' })
      } finally {
        execSpy.mockRestore()
      }
    })
  })

  // =========================================================================
  // Bug 2 (P1): Native update server-side forceDowngrade (`ti`)
  // =========================================================================
  describe('Bug 2: native installer installLatest honors external_force_downgrade', () => {
    test('forces downgrade to maxVersion when current > maxVersion and external_force_downgrade is true', async () => {
      const targetDowngrade = '2.0.1'
      const binaryBytes = Buffer.from('#!/bin/sh\necho 2.0.1\n', 'utf8')
      const binaryChecksum = sha256Hex(binaryBytes)
      const platform = getPlatform()
      const binaryName = getBinaryName(platform)

      const maxVerSpy = spyOn(
        autoUpdaterMod,
        'getMaxVersion',
      ).mockResolvedValue(targetDowngrade)
      const forceDownSpy = spyOn(
        autoUpdaterMod,
        'isForceDowngradeEnabled',
      ).mockReturnValue(true)
      const latestSpy = spyOn(
        downloadMod,
        'getLatestVersion',
      ).mockResolvedValue('9.9.9')
      const downloadSpy = spyOn(
        downloadMod,
        'downloadVersion',
      ).mockImplementation(async (_ver, stagingPath) => {
        mkdirSync(stagingPath, { recursive: true })
        const p = join(stagingPath, binaryName)
        writeFileSync(p, binaryBytes)
        chmodSync(p, 0o755)
        return {
          downloadType: 'binary',
          signatureVerified: true,
          expectedChecksum: binaryChecksum,
        }
      })

      try {
        const res = await installLatest('latest')
        expect(res.wasUpdated).toBe(true)
        expect(res.wasSkipped).toBeFalsy()
        expect(res.latestVersion).toBe(targetDowngrade)
        // Official `ti`: forced downgrade directly targets maxVersion without calling getLatestVersion
        expect(latestSpy).not.toHaveBeenCalled()
        expect(downloadSpy).toHaveBeenCalledTimes(1)
        expect(downloadSpy.mock.calls[0]?.[0]).toBe(targetDowngrade)
      } finally {
        maxVerSpy.mockRestore()
        forceDownSpy.mockRestore()
        latestSpy.mockRestore()
        downloadSpy.mockRestore()
      }
    })

    test('skips update when current >= maxVersion and external_force_downgrade is false', async () => {
      const maxVerSpy = spyOn(
        autoUpdaterMod,
        'getMaxVersion',
      ).mockResolvedValue('2.0.1')
      const forceDownSpy = spyOn(
        autoUpdaterMod,
        'isForceDowngradeEnabled',
      ).mockReturnValue(false)
      const forceDownAsyncSpy = spyOn(
        autoUpdaterMod,
        'isForceDowngradeEnabledAsync',
      ).mockResolvedValue(false)
      const latestSpy = spyOn(
        downloadMod,
        'getLatestVersion',
      ).mockResolvedValue('9.9.9')
      const downloadSpy = spyOn(downloadMod, 'downloadVersion')

      try {
        const res = await installLatest('latest')
        expect(res.wasUpdated).toBe(false)
        expect(res.wasSkipped).toBe(true)
        expect(res.latestVersion).toBe('9.9.9')
        expect(downloadSpy).not.toHaveBeenCalled()
      } finally {
        maxVerSpy.mockRestore()
        forceDownSpy.mockRestore()
        forceDownAsyncSpy.mockRestore()
        latestSpy.mockRestore()
        downloadSpy.mockRestore()
      }
    })

    test('does not force downgrade when an explicit version argument is requested', async () => {
      const explicitVer = '2.0.5'
      const binaryBytes = Buffer.from('#!/bin/sh\necho 2.0.5\n', 'utf8')
      const binaryChecksum = sha256Hex(binaryBytes)
      const binaryName = getBinaryName(getPlatform())

      const maxVerSpy = spyOn(
        autoUpdaterMod,
        'getMaxVersion',
      ).mockResolvedValue('2.0.1')
      const forceDownSpy = spyOn(
        autoUpdaterMod,
        'isForceDowngradeEnabled',
      ).mockReturnValue(true)
      const downloadSpy = spyOn(
        downloadMod,
        'downloadVersion',
      ).mockImplementation(async (_ver, stagingPath) => {
        mkdirSync(stagingPath, { recursive: true })
        const p = join(stagingPath, binaryName)
        writeFileSync(p, binaryBytes)
        chmodSync(p, 0o755)
        return {
          downloadType: 'binary',
          signatureVerified: true,
          expectedChecksum: binaryChecksum,
        }
      })

      try {
        // Explicit version > maxVersion with !forceReinstall hits normal maxVersion cap/skip, NOT forced downgrade
        const res = await installLatest(explicitVer)
        expect(res.wasSkipped).toBe(true)
        expect(res.latestVersion).toBe(explicitVer)
        expect(downloadSpy).not.toHaveBeenCalled()
      } finally {
        maxVerSpy.mockRestore()
        forceDownSpy.mockRestore()
        downloadSpy.mockRestore()
      }
    })
  })

  // =========================================================================
  // Bug 3 (P1): Package manager selection (`getGlobalPackageManager`)
  // =========================================================================
  describe('Bug 3: getGlobalPackageManager never chooses bun solely because runtime is Bun', () => {
    test('chooses npm for npm-installed Bun-compiled binary even under Bun runtime', () => {
      expect(typeof Bun).not.toBe('undefined')
      // npm-installed compiled binary (`vh` true): official `oe` → npm.
      expect(
        getGlobalPackageManager({
          execPath:
            '/usr/local/lib/node_modules/@go-hare/claude-code-darwin-arm64/claude',
          argv1: '/usr/local/bin/claude',
          isBundledBinary: true,
        }),
      ).toBe('npm')
      // Bun-compiled binary under ~/.bun/bin/bun but argv1 in an npm global
      // install still belongs to npm (path check wins over runtime).
      expect(
        getGlobalPackageManager({
          execPath: '/Users/dev/.bun/bin/bun',
          argv1: '/usr/local/lib/node_modules/@go-hare/claude-code/dist/cli.js',
          isBundledBinary: true,
        }),
      ).toBe('npm')
    })

    test('chooses bun for Bun global install and for JS-run-under-Bun', () => {
      expect(
        isPathInBunGlobalInstall(
          '/Users/dev/.bun/install/global/node_modules/@go-hare/claude-code/claude',
        ),
      ).toBe(true)
      // Bun global install path → bun, regardless of bundled mode.
      expect(
        getGlobalPackageManager({
          execPath:
            '/Users/dev/.bun/install/global/node_modules/@go-hare/claude-code-darwin-arm64/claude',
          argv1: undefined,
          isBundledBinary: true,
        }),
      ).toBe('bun')
      // Custom BUN_INSTALL directory
      expect(
        getGlobalPackageManager({
          execPath:
            '/opt/custom-bun/install/global/node_modules/@go-hare/claude-code/claude',
          argv1: undefined,
          bunInstallDir: '/opt/custom-bun/',
          isBundledBinary: true,
        }),
      ).toBe('bun')
      // Bun global path but bun CLI NOT on PATH -> official `oe` still keeps
      // the install's ownership ('bun'); the missing CLI fails at install time
      // rather than silently redirecting the update to the npm prefix.
      expect(
        getGlobalPackageManager({
          execPath:
            '/Users/dev/.bun/install/global/node_modules/@go-hare/claude-code/claude',
          argv1: undefined,
          isBundledBinary: true,
        }),
      ).toBe('bun')
      // JS run with the `bun` command (not a compiled binary) outside Bun's
      // global dir → 'bun' (the second `oe` branch).
      expect(
        getGlobalPackageManager({
          execPath: '/Users/dev/.bun/bin/bun',
          argv1: '/home/dev/somewhere/cli.js',
          isBundledBinary: false,
        }),
      ).toBe('bun')
    })

    test('checkGlobalInstallPermissions queries npm (not bun) for npm-installed Bun-compiled binary', async () => {
      // Pin bundled so the Bun-runtime branch of `oe` does not divert to 'bun'
      // while running under `bun test`.
      const bundledSpy = spyOn(
        bundledModeMod,
        'isInBundledMode',
      ).mockReturnValue(true)
      const prefixDir = join(tempRoot, 'npm-perm-prefix')
      mkdirSync(prefixDir, { recursive: true })
      Object.defineProperty(process, 'execPath', {
        value:
          '/usr/local/lib/node_modules/@go-hare/claude-code-darwin-arm64/claude',
        configurable: true,
        writable: true,
      })
      process.argv[1] = '/usr/local/bin/claude'

      const calledTools: string[] = []
      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockImplementation(async (file, args) => {
        calledTools.push(`${file} ${args.join(' ')}`)
        if (file === 'npm') {
          return { stdout: `${prefixDir}\n`, stderr: '', code: 0 }
        }
        // Simulate machine without bun CLI installed
        return { stdout: '', stderr: 'bun: command not found', code: 127 }
      })

      try {
        const perm = await checkGlobalInstallPermissions()
        expect(perm).toEqual({ hasPermissions: true, npmPrefix: prefixDir })
        expect(calledTools).toEqual(['npm -g config get prefix'])
      } finally {
        execSpy.mockRestore()
        bundledSpy.mockRestore()
      }
    })
  })

  // =========================================================================
  // Bug 3b (P2): getMaxVersion normalizes external through semver.parse (`Ldt`)
  // =========================================================================
  describe('Bug 3b: getMaxVersion semver normalization (official Ldt)', () => {
    test('accepts v-prefixed external and normalizes to bare semver', async () => {
      const gbSpy = spyOn(
        growthbook,
        'getDynamicConfig_BLOCKS_ON_INIT',
      ).mockResolvedValue({
        external: 'v2.1.300',
        external_force_downgrade: true,
      })
      try {
        expect(await getMaxVersion()).toBe('2.1.300')
      } finally {
        gbSpy.mockRestore()
      }
    })

    test('invalid external is ignored (returns undefined), never reaches download path', async () => {
      const gbSpy = spyOn(
        growthbook,
        'getDynamicConfig_BLOCKS_ON_INIT',
      ).mockResolvedValue({ external: 'not-a-version' })
      try {
        expect(await getMaxVersion()).toBeUndefined()
      } finally {
        gbSpy.mockRestore()
      }
    })

    test('ant user type still returns config.ant verbatim', async () => {
      process.env.USER_TYPE = 'ant'
      const gbSpy = spyOn(
        growthbook,
        'getDynamicConfig_BLOCKS_ON_INIT',
      ).mockResolvedValue({ external: '2.1.300', ant: 'ant-dev-9' })
      try {
        expect(await getMaxVersion()).toBe('ant-dev-9')
      } finally {
        gbSpy.mockRestore()
      }
    })
  })

  // =========================================================================
  // Bug 5 (P1): Windows retired-dir preserved-backup relocation (`We`/`Be`/`ee`)
  // =========================================================================
  describe('Bug 5: retired-dir preserved backup location (official We/Be/ee)', () => {
    test('locatePreservedBackup finds a minted backup whose file moved into a retired dir', async () => {
      // execPath under <root>/node_modules/@scope/pkg/bin — Ve() roots are the
      // scope dir and its parent, Be() picks ".<name>" dirs inside them.
      const nodeModules = join(tempRoot, 'lib', 'node_modules')
      const pkgBin = join(nodeModules, '@go-hare', 'claude-code', 'bin')
      mkdirSync(pkgBin, { recursive: true })
      const execPath = join(pkgBin, 'claude.exe')
      writeFileSync(execPath, 'binary')
      Object.defineProperty(process, 'execPath', {
        value: execPath,
        configurable: true,
        writable: true,
      })

      const backupName = 'claude.exe.old.1700000000000'
      const retiredDir = join(nodeModules, '.claude-code-AbCdEf')
      mkdirSync(join(retiredDir, 'bin'), { recursive: true })
      const relocated = join(retiredDir, 'bin', backupName)
      writeFileSync(relocated, 'preserved-binary')

      // Not minted → no match anywhere (inode check is the authorization).
      const originalBackupPath = join(pkgBin, backupName)
      expect(await locatePreservedBackupForTests(originalBackupPath)).toBeNull()
      expect(await locatePreservedBackupForTests(relocated)).toBeNull()

      // Mint the inode of the relocated file → `We` finds it under the
      // retired dir's `bin/` even though the original path is gone.
      const { statSync } = await import('fs')
      mintPreservedInodeForTests(statSync(relocated, { bigint: true }).ino)
      expect(await locatePreservedBackupForTests(originalBackupPath)).toBe(
        relocated,
      )
    })
  })

  // =========================================================================
  // Bug 4 (P1): Manifest signature verification & pre-signing downgrade gate
  // =========================================================================
  describe('Bug 4: Official GCS manifest signature verification & skippedUnverifiedRelease gate', () => {
    test('verifyReleaseManifestSignature accepts valid signature and rejects tampering/mismatches', () => {
      const platform = getPlatform()
      const binaryName = getBinaryName(platform)
      const manifestObj = {
        version: '2.1.328',
        manifestSignatureEnforcement: 'flag',
        platforms: {
          [platform]: {
            checksum: sha256Hex('good-binary'),
            size: 11,
            binary: binaryName,
          },
        },
      }
      const { manifestBytes, sidecar } = signManifest(manifestObj)

      // Valid signature succeeds
      const verified = verifyReleaseManifestSignature({
        manifestBytes,
        sidecar,
        expectedVersion: '2.1.328',
        publicKeyPem: TEST_PUB_KEY,
      })
      expect(verified.version).toBe('2.1.328')

      // Tampered manifest bytes -> signature_invalid
      const tamperedBytes = Buffer.from(
        manifestBytes.toString('utf8').replace('good-binary', 'evil-binary') +
          ' ',
        'utf8',
      )
      expect(() =>
        verifyReleaseManifestSignature({
          manifestBytes: tamperedBytes,
          sidecar,
          expectedVersion: '2.1.328',
          publicKeyPem: TEST_PUB_KEY,
        }),
      ).toThrow(ManifestSignatureError)
      try {
        verifyReleaseManifestSignature({
          manifestBytes: tamperedBytes,
          sidecar,
          expectedVersion: '2.1.328',
          publicKeyPem: TEST_PUB_KEY,
        })
      } catch (e) {
        expect((e as ManifestSignatureError).reason).toBe('signature_invalid')
      }

      // Wrong publicKeySha256 -> key_mismatch
      try {
        verifyReleaseManifestSignature({
          manifestBytes,
          sidecar: { ...sidecar, publicKeySha256: '0'.repeat(64) },
          expectedVersion: '2.1.328',
          publicKeyPem: TEST_PUB_KEY,
        })
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestSignatureError)
        expect((e as ManifestSignatureError).reason).toBe('key_mismatch')
      }

      // Expected version mismatch -> version_mismatch
      try {
        verifyReleaseManifestSignature({
          manifestBytes,
          sidecar,
          expectedVersion: '2.1.329',
          publicKeyPem: TEST_PUB_KEY,
        })
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestSignatureError)
        expect((e as ManifestSignatureError).reason).toBe('version_mismatch')
      }

      // Malformed sidecar -> sidecar_malformed
      try {
        verifyReleaseManifestSignature({
          manifestBytes,
          sidecar: { schema: 2, algorithm: 'bad' },
          expectedVersion: '2.1.328',
          publicKeyPem: TEST_PUB_KEY,
        })
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestSignatureError)
        expect((e as ManifestSignatureError).reason).toBe('sidecar_malformed')
      }
    })

    test('policy & enforcement helpers match official 2.1.328 rules', () => {
      expect(
        getManifestSignaturePolicy('2.1.200', {
          explicitVersionRequested: true,
          requireEnforcingRelease: false,
        }),
      ).toBe('allow-unsigned-legacy')
      expect(
        getManifestSignaturePolicy('2.1.207', {
          explicitVersionRequested: true,
          requireEnforcingRelease: false,
        }),
      ).toBe('require')
      expect(
        getManifestSignaturePolicy('2.1.200', {
          explicitVersionRequested: false,
          requireEnforcingRelease: true,
        }),
      ).toBe('require-enforcing-release')

      expect(isManifestSignatureEnforced('flag', true)).toBe(true)
      expect(isManifestSignatureEnforced('flag', false)).toBe(false)
      expect(isManifestSignatureEnforced('flag', null)).toBe(false)
      expect(isManifestSignatureEnforced('always', null)).toBe(true)
      expect(isManifestSignatureEnforced('always', false)).toBe(false)

      expect(isReleaseEnforcingManifestSignature('always', false)).toBe(true)
      expect(isReleaseEnforcingManifestSignature('flag', true)).toBe(true)
      expect(isReleaseEnforcingManifestSignature('flag', false)).toBe(false)
      expect(isReleaseEnforcingManifestSignature(undefined, true)).toBe(false)
    })

    test('downloadVersionFromBinaryRepo verifies signature when enforced and blocks invalid signatures', async () => {
      const platform = getPlatform()
      const binaryName = getBinaryName(platform)
      const binaryBytes = Buffer.from('#!/bin/sh\necho ok\n', 'utf8')
      const binaryChecksum = sha256Hex(binaryBytes)
      const manifestObj = {
        version: '2.1.328',
        manifestSignatureEnforcement: 'flag',
        platforms: {
          [platform]: {
            checksum: binaryChecksum,
            size: binaryBytes.length,
            binary: binaryName,
          },
        },
      }
      const { manifestBytes, sidecar } = signManifest(manifestObj)
      const stagingPath = join(tempRoot, 'staging-sig-ok')
      const baseUrl = 'https://downloads.claude.ai/claude-code-releases'

      const gbSpy = spyOn(
        growthbook,
        'getFeatureValue_CACHED_MAY_BE_STALE',
      ).mockImplementation((key: string, fallback: unknown) =>
        key === 'tengu_elegant_pancake' ? (true as never) : (fallback as never),
      )

      let serveBadSig = false
      const axiosSpy = spyOn(axios, 'get').mockImplementation(
        async (url: string) => {
          if (url.endsWith('/manifest.json')) {
            return { data: manifestBytes } as never
          }
          if (url.endsWith('/manifest.json.raw-sig.json')) {
            return {
              data: serveBadSig
                ? {
                    ...sidecar,
                    signature: Buffer.from('bad').toString('base64'),
                  }
                : sidecar,
            } as never
          }
          return { data: binaryBytes } as never
        },
      )

      try {
        // 1. Valid signature succeeds and downloads binary
        const ok = await downloadVersionFromBinaryRepo(
          '2.1.328',
          stagingPath,
          baseUrl,
          undefined,
          { signaturePolicy: 'require', publicKeyPem: TEST_PUB_KEY },
        )
        expect(ok).toEqual({
          signatureVerified: true,
          expectedChecksum: binaryChecksum,
        })
        expect(existsSync(join(stagingPath, binaryName))).toBe(true)

        // 2. Invalid signature aborts before binary download
        serveBadSig = true
        const badStaging = join(tempRoot, 'staging-sig-bad')
        await expect(
          downloadVersionFromBinaryRepo(
            '2.1.328',
            badStaging,
            baseUrl,
            undefined,
            { signaturePolicy: 'require', publicKeyPem: TEST_PUB_KEY },
          ),
        ).rejects.toThrow(ManifestSignatureError)
        expect(existsSync(join(badStaging, binaryName))).toBe(false)
      } finally {
        axiosSpy.mockRestore()
        gbSpy.mockRestore()
      }
    })

    test('allow-unsigned-legacy permits 404 sidecar for explicit pre-2.1.207 version even when enforced', async () => {
      const platform = getPlatform()
      const binaryName = getBinaryName(platform)
      const manifestBytes = Buffer.from(
        JSON.stringify({
          version: '2.1.200',
          platforms: {
            [platform]: { checksum: sha256Hex('legacy'), binary: binaryName },
          },
        }),
        'utf8',
      )

      const gbSpy = spyOn(
        growthbook,
        'getFeatureValue_CACHED_MAY_BE_STALE',
      ).mockImplementation((key: string, fallback: unknown) =>
        key === 'tengu_elegant_pancake' ? (true as never) : (fallback as never),
      )
      const axiosSpy = spyOn(axios, 'get').mockImplementation(
        async (url: string) => {
          if (url.endsWith('/manifest.json')) {
            return { data: manifestBytes } as never
          }
          throw make404Error(url)
        },
      )

      try {
        const res = await fetchAndVerifyReleaseManifest(
          'https://downloads.claude.ai/claude-code-releases',
          '2.1.200',
          {
            signaturePolicy: 'allow-unsigned-legacy',
            platform,
            startTime: Date.now(),
            publicKeyPem: TEST_PUB_KEY,
          },
        )
        expect(res.manifestAuthenticated).toBe(false)
        expect(res.signatureVerified).toBe(false)
        expect(res.manifest.version).toBe('2.1.200')
      } finally {
        axiosSpy.mockRestore()
        gbSpy.mockRestore()
      }
    })

    test('installLatest channel update refuses downgrade to pre-enforcement release with skippedUnverifiedRelease: true', async () => {
      // Simulate existing native installation (execPath inside native versions dir)
      const versionsDir = join(getXDGDataHome(), 'claude', 'versions')
      mkdirSync(versionsDir, { recursive: true })
      const currentBin = join(versionsDir, '2.1.328')
      writeFileSync(currentBin, '#!/bin/sh\necho 2.1.328\n', 'utf8')
      chmodSync(currentBin, 0o755)
      Object.defineProperty(process, 'execPath', {
        value: currentBin,
        configurable: true,
        writable: true,
      })

      const maxVerSpy = spyOn(
        autoUpdaterMod,
        'getMaxVersion',
      ).mockResolvedValue(undefined)
      const latestSpy = spyOn(
        downloadMod,
        'getLatestVersion',
      ).mockResolvedValue('2.1.210')
      // Simulate downloadVersion hitting an enforcing release gate failure
      const downloadSpy = spyOn(
        downloadMod,
        'downloadVersion',
      ).mockImplementation(async (version, _staging, opts) => {
        expect(opts?.requireEnforcingRelease).toBe(true)
        expect(opts?.explicitVersionRequested).toBe(false)
        throw new ManifestSignatureError(
          version,
          'release_predates_enforcement',
        )
      })

      try {
        const res = await installLatest('stable')
        expect(res).toEqual({
          latestVersion: '2.1.210',
          wasUpdated: false,
          wasSkipped: true,
          skippedUnverifiedRelease: true,
          lockFailed: false,
        })
      } finally {
        maxVerSpy.mockRestore()
        latestSpy.mockRestore()
        downloadSpy.mockRestore()
      }
    })

    test('fetchAndVerifyReleaseManifest enforces release_predates_enforcement and respects enforcement flag off', async () => {
      const platform = getPlatform()
      const binaryName = getBinaryName(platform)
      // Signed manifest WITHOUT manifestSignatureEnforcement (predates enforcement)
      const manifestObj = {
        version: '2.1.210',
        platforms: {
          [platform]: {
            checksum: sha256Hex('pre-enforcement'),
            binary: binaryName,
          },
        },
      }
      const { manifestBytes, sidecar } = signManifest(manifestObj)
      let enforceFlag = true
      const gbSpy = spyOn(
        growthbook,
        'getFeatureValue_CACHED_MAY_BE_STALE',
      ).mockImplementation((key: string, fallback: unknown) =>
        key === 'tengu_elegant_pancake'
          ? (enforceFlag as never)
          : (fallback as never),
      )
      const axiosSpy = spyOn(axios, 'get').mockImplementation(
        async (url: string) => {
          if (url.endsWith('/manifest.json')) {
            return { data: manifestBytes } as never
          }
          return { data: sidecar } as never
        },
      )

      try {
        // Enforced -> throws release_predates_enforcement
        try {
          await fetchAndVerifyReleaseManifest(
            'https://downloads.claude.ai/claude-code-releases',
            '2.1.210',
            {
              signaturePolicy: 'require-enforcing-release',
              platform,
              startTime: Date.now(),
              publicKeyPem: TEST_PUB_KEY,
            },
          )
          expect.unreachable()
        } catch (err) {
          expect(err).toBeInstanceOf(ManifestSignatureError)
          expect((err as ManifestSignatureError).reason).toBe(
            'release_predates_enforcement',
          )
        }

        // Enforcement disabled -> logs warning and continues with signatureVerified: false
        enforceFlag = false
        const nonEnforced = await fetchAndVerifyReleaseManifest(
          'https://downloads.claude.ai/claude-code-releases',
          '2.1.210',
          {
            signaturePolicy: 'require-enforcing-release',
            platform,
            startTime: Date.now(),
            publicKeyPem: TEST_PUB_KEY,
          },
        )
        expect(nonEnforced.manifestAuthenticated).toBe(true)
        expect(nonEnforced.signatureVerified).toBe(false)
      } finally {
        axiosSpy.mockRestore()
        gbSpy.mockRestore()
      }
    })
  })

  // =========================================================================
  // Bug 5 (P1): Windows activation copy SHA-256 verification (`ri`)
  // =========================================================================
  describe('Bug 5: Windows updateSymlink verifies existing same-size target & staged copy SHA-256', () => {
    test('replaces same-size existing target when its SHA-256 does not match expectedChecksum', async () => {
      env.platform = 'win32'
      const binDir = join(tempRoot, 'win-bin')
      const versionsDir = join(tempRoot, 'win-versions')
      mkdirSync(binDir, { recursive: true })
      mkdirSync(versionsDir, { recursive: true })

      const targetPath = join(versionsDir, '2.1.328')
      const launcherPath = join(binDir, 'claude.exe')
      // Exact same length (16 bytes), DIFFERENT bytes!
      const validContent = Buffer.from('VALID_BINARY_328', 'utf8')
      const corruptContent = Buffer.from('CORRUPT_SAME_LEN', 'utf8')
      expect(validContent.length).toBe(corruptContent.length)

      writeFileSync(targetPath, validContent)
      writeFileSync(launcherPath, corruptContent)
      const expectedChecksum = sha256Hex(validContent)

      // Must NOT skip despite same size — must replace with valid bytes
      const updated = await updateSymlink(launcherPath, targetPath, {
        expectedChecksum,
      })
      expect(updated).toBe(true)
      expect(readFileSync(launcherPath).equals(validContent)).toBe(true)

      // Now that bytes AND size match expectedChecksum, a second call is a noop
      const noop = await updateSymlink(launcherPath, targetPath, {
        expectedChecksum,
      })
      expect(noop).toBe(false)
    })

    test('refuses to swap staged copy and cleans up temp file when staged copy hash mismatches expectedChecksum', async () => {
      env.platform = 'win32'
      const binDir = join(tempRoot, 'win-bin-mismatch')
      const versionsDir = join(tempRoot, 'win-versions-mismatch')
      mkdirSync(binDir, { recursive: true })
      mkdirSync(versionsDir, { recursive: true })

      const targetPath = join(versionsDir, '2.1.328')
      const launcherPath = join(binDir, 'claude.exe')
      const oldLauncherContent = Buffer.from('OLD_WORKING_CLAUDE_EXE', 'utf8')
      const tamperedSource = Buffer.from('TAMPERED_SOURCE_BYTES', 'utf8')
      const certifiedChecksum = sha256Hex('EXPECTED_CERTIFIED_BYTES')

      writeFileSync(launcherPath, oldLauncherContent)
      writeFileSync(targetPath, tamperedSource)

      const updated = await updateSymlink(launcherPath, targetPath, {
        expectedChecksum: certifiedChecksum,
      })
      expect(updated).toBe(false)
      // Old working launcher MUST remain intact
      expect(readFileSync(launcherPath).equals(oldLauncherContent)).toBe(true)
      // Staged temp file MUST be cleaned up
      const leftovers = readdirSync(binDir).filter(f => f.includes('.new.'))
      expect(leftovers).toEqual([])
    })

    test('installLatest rejects tampered staged binary before atomic install via StagedBinaryChecksumMismatchError', async () => {
      const binaryName = getBinaryName(getPlatform())
      const maxVerSpy = spyOn(
        autoUpdaterMod,
        'getMaxVersion',
      ).mockResolvedValue(undefined)
      const downloadSpy = spyOn(
        downloadMod,
        'downloadVersion',
      ).mockImplementation(async (_ver, stagingPath) => {
        mkdirSync(stagingPath, { recursive: true })
        const p = join(stagingPath, binaryName)
        writeFileSync(p, Buffer.from('TAMPERED_AFTER_VERIFY', 'utf8'))
        chmodSync(p, 0o755)
        return {
          downloadType: 'binary',
          signatureVerified: true,
          expectedChecksum: sha256Hex('GENUINE_VERIFIED_BYTES'),
        }
      })

      try {
        await expect(installLatest('2.1.335')).rejects.toThrow(
          StagedBinaryChecksumMismatchError,
        )
      } finally {
        maxVerSpy.mockRestore()
        downloadSpy.mockRestore()
      }
    })
  })

  // =========================================================================
  // Bug 6 (P2): `getLatestVersion` (`npm view`) semver validation & warning exit
  // =========================================================================
  describe('Bug 6: getLatestVersion validates semver & accepts non-zero exit with valid semver stdout', () => {
    test('returns version on exit 0 with valid semver', async () => {
      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockResolvedValue({
        stdout: '2.1.328\n',
        stderr: '',
        code: 0,
      })
      try {
        expect(await getLatestVersion('latest')).toBe('2.1.328')
      } finally {
        execSpy.mockRestore()
      }
    })

    test('rejects exit 0 when stdout is garbage/non-semver or empty', async () => {
      const execSpy = spyOn(execMod, 'execFileNoThrowWithCwd')
      try {
        execSpy.mockResolvedValue({
          stdout: '<html>502 Bad Gateway</html>\n',
          stderr: '',
          code: 0,
        })
        expect(await getLatestVersion('latest')).toBeNull()

        execSpy.mockResolvedValue({
          stdout: '2.1.328 unexpected trailing text\n',
          stderr: '',
          code: 0,
        })
        expect(await getLatestVersion('stable')).toBeNull()

        execSpy.mockResolvedValue({
          stdout: '   \n',
          stderr: '',
          code: 0,
        })
        expect(await getLatestVersion('latest')).toBeNull()
      } finally {
        execSpy.mockRestore()
      }
    })

    test('accepts non-zero exit when stdout cleanly parses as valid semver', async () => {
      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockResolvedValue({
        stdout: '2.1.328\n',
        stderr: 'npm warn EACCES could not write cache',
        code: 1,
      })
      try {
        expect(await getLatestVersion('latest')).toBe('2.1.328')
      } finally {
        execSpy.mockRestore()
      }
    })

    test('returns null on non-zero exit when stdout is not valid semver', async () => {
      const execSpy = spyOn(
        execMod,
        'execFileNoThrowWithCwd',
      ).mockResolvedValue({
        stdout: 'npm ERR! 404 Not Found',
        stderr: 'npm ERR! 404 Not Found',
        code: 1,
      })
      try {
        expect(await getLatestVersion('latest')).toBeNull()
      } finally {
        execSpy.mockRestore()
      }
    })
  })
})
