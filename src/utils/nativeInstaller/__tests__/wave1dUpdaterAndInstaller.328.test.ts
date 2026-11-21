import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { zstdCompressSync } from 'node:zlib'
import * as growthbook from 'src/services/analytics/growthbook.js'
import * as autoUpdaterMod from '../../autoUpdater.js'
import {
  atomicRestoreExecutableForTests,
  getLatestVersionFromGcs,
  getUpdateRestoreFailure,
  installGlobalPackage,
  mintPreservedInodeForTests,
  reconcileUpdateRestoreFailureForTests,
  setUpdateRestoreFailureForTests,
  sweepHealMissingExecutableForTests,
} from '../../autoUpdater.js'
import * as bundledModeMod from '../../bundledMode.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import * as execMod from '../../execFileNoThrow.js'
import { getXDGDataHome } from '../../xdg.js'
import * as downloadMod from '../download.js'
import {
  _downloadAndVerifyBinaryForTesting,
  downloadVersionFromBinaryRepo,
  getLatestVersion,
  getLatestVersionFromBinaryRepo,
  isValidVersion,
  StallTimeoutError,
} from '../download.js'
import {
  cleanupOldVersions,
  getBinaryName,
  getPlatform,
  getVersionPaths,
  installLatest,
  lockCurrentVersion,
  stopVersionLockMaintenanceForTesting,
} from '../installer.js'
import {
  getPerPidLockPath,
  hasOtherLiveProcessLockForVersion,
  scanActiveLockedVersions,
  writePerPidLock,
} from '../pidLock.js'

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

describe('Wave 1D — P0-22, P1-#41 & P1-#42: Native Installer & Auto-Updater 2.1.328 Parity', () => {
  let tempRoot: string
  let savedMacro: unknown
  const savedEnv: Record<string, string | undefined> = {}
  const origExecPath = process.execPath
  const ENV_KEYS = [
    'CLAUDE_CONFIG_DIR',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'XDG_STATE_HOME',
    'HOME',
    'USER_TYPE',
    'ENABLE_PID_BASED_VERSION_LOCKING',
    'ENABLE_LOCKLESS_UPDATES',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING',
    'CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING',
  ] as const

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wave1d-updater-'))
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
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    process.env.CLAUDE_CONFIG_DIR = join(tempRoot, 'config')
    process.env.XDG_DATA_HOME = join(tempRoot, 'data')
    process.env.XDG_CACHE_HOME = join(tempRoot, 'cache')
    process.env.XDG_STATE_HOME = join(tempRoot, 'state')
    process.env.HOME = join(tempRoot, 'home')
    mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
    mkdirSync(process.env.HOME, { recursive: true })
    delete process.env.USER_TYPE
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING
    delete process.env.CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING
    process.env.ENABLE_PID_BASED_VERSION_LOCKING = 'true'
    getClaudeConfigHomeDir.cache?.clear?.()
    setUpdateRestoreFailureForTests(null)
  })

  afterEach(() => {
    stopVersionLockMaintenanceForTesting()
    setUpdateRestoreFailureForTests(null)
    Object.defineProperty(process, 'execPath', {
      value: origExecPath,
      configurable: true,
      writable: true,
    })
    if (savedMacro === undefined) {
      delete (globalThis as { MACRO?: unknown }).MACRO
    } else {
      ;(globalThis as { MACRO?: unknown }).MACRO = savedMacro
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    getClaudeConfigHomeDir.cache?.clear?.()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('P0-22: isValidVersion, getLatestVersionFromBinaryRepo, getLatestVersion(rc), getVersionPaths, and updateLatest reject bad versions/traversal', async () => {
    expect(isValidVersion('2.1.328')).toBe(true)
    expect(isValidVersion('2.1.328-rc.1')).toBe(true)
    expect(isValidVersion('2.1.328+sha123')).toBe(true)
    expect(isValidVersion('v2.1.328')).toBe(false)
    expect(isValidVersion('<html>502 Bad Gateway</html>')).toBe(false)
    expect(isValidVersion('../2.1.0')).toBe(false)
    expect(isValidVersion('2.1')).toBe(false)

    // External build rejects 'rc' channel (official Wjr)
    await expect(getLatestVersion('rc')).rejects.toThrow(/Invalid channel: rc/)

    // getLatestVersionFromBinaryRepo rejects non-version HTML pointer body
    const axiosSpy = spyOn(axios, 'get').mockResolvedValue({
      data: '<html>502 Bad Gateway</html>\n',
    } as never)
    try {
      await expect(
        getLatestVersionFromBinaryRepo('latest', 'https://example.invalid'),
      ).rejects.toThrow(/did not return a version/)
    } finally {
      axiosSpy.mockRestore()
    }

    // getVersionPaths rejects path traversal and creates 0-byte placeholder with wx without clobbering existing file
    await expect(getVersionPaths('../escape')).rejects.toThrow(/path-unsafe/)
    await expect(getVersionPaths('foo/bar')).rejects.toThrow(/path-unsafe/)
    await expect(getVersionPaths('.')).rejects.toThrow(/path-unsafe/)
    await expect(getVersionPaths('..')).rejects.toThrow(/path-unsafe/)

    const { installPath } = await getVersionPaths('2.1.328')
    expect(existsSync(installPath)).toBe(true)
    expect(statSync(installPath).size).toBe(0)
    writeFileSync(installPath, 'EXISTING_BINARY_DATA')
    await getVersionPaths('2.1.328')
    expect(readFileSync(installPath, 'utf8')).toBe('EXISTING_BINARY_DATA')

    // updateLatest rejects invalid version returned from version pointer
    const maxSpy = spyOn(autoUpdaterMod, 'getMaxVersion').mockResolvedValue(
      undefined,
    )
    const latestSpy = spyOn(downloadMod, 'getLatestVersion').mockResolvedValue(
      'not-a-semver-../../pwn',
    )
    try {
      await expect(installLatest('latest')).rejects.toThrow(
        /not a well-formed version/,
      )
    } finally {
      maxSpy.mockRestore()
      latestSpy.mockRestore()
    }
  })

  test('P0-22: getLatestVersionFromGcs checks isEssentialTrafficOnly, retries 3x, and validates semver', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const skippedSpy = spyOn(axios, 'get')
    try {
      expect(await getLatestVersionFromGcs('latest')).toBeNull()
      expect(skippedSpy).not.toHaveBeenCalled()
    } finally {
      skippedSpy.mockRestore()
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    }

    let calls = 0
    const retrySpy = spyOn(axios, 'get').mockImplementation(async () => {
      calls++
      if (calls < 3) {
        throw Object.assign(new Error('network blip'), { code: 'ECONNRESET' })
      }
      return { data: '2.1.328\n' } as never
    })
    try {
      const ver = await getLatestVersionFromGcs('latest', {
        sleepFn: async () => {},
      })
      expect(ver).toBe('2.1.328')
      expect(calls).toBe(3)
    } finally {
      retrySpy.mockRestore()
    }

    const badSpy = spyOn(axios, 'get').mockResolvedValue({
      data: '<html>403 Forbidden</html>',
    } as never)
    try {
      expect(
        await getLatestVersionFromGcs('stable', { sleepFn: async () => {} }),
      ).toBeNull()
    } finally {
      badSpy.mockRestore()
    }
  })

  test('P1-#41: downloadVersionFromBinaryRepo fetches manifest.zst.json in parallel, decompresses .zst, and falls back to raw binary with signedWireSize', async () => {
    const platform = getPlatform()
    const binaryName = getBinaryName(platform)
    const rawBinary = Buffer.from('#!/bin/sh\necho zst-ok\n', 'utf8')
    const rawChecksum = sha256Hex(rawBinary)
    const zstPayload = Buffer.from(zstdCompressSync(rawBinary))
    const zstChecksum = sha256Hex(zstPayload)

    const manifest = {
      version: '2.1.328',
      platforms: {
        [platform]: {
          checksum: rawChecksum,
          size: rawBinary.length,
          binary: binaryName,
        },
      },
    }
    const zstManifest = {
      version: '2.1.328',
      platforms: {
        [platform]: { checksum: zstChecksum },
      },
    }

    // 1. Compressed `.zst` path succeeds
    const requestedUrls: string[] = []
    const requestedResponseTypes: unknown[] = []
    const axiosSpy = spyOn(axios, 'get').mockImplementation(
      async (url: string, cfg?: { responseType?: string }) => {
        requestedUrls.push(url)
        requestedResponseTypes.push(cfg?.responseType)
        if (url.endsWith('/manifest.json')) {
          return { data: Buffer.from(JSON.stringify(manifest)) } as never
        }
        if (url.endsWith('/manifest.zst.json')) {
          return { data: zstManifest } as never
        }
        if (url.endsWith('.zst')) {
          return { data: Readable.from([zstPayload]) } as never
        }
        return { data: Readable.from([rawBinary]) } as never
      },
    )
    try {
      const stage1 = join(tempRoot, 'stage-zst-ok')
      const res = await downloadVersionFromBinaryRepo(
        '2.1.328',
        stage1,
        'https://mirror.example.invalid',
        undefined,
        { signaturePolicy: 'skip' },
      )
      expect(res.expectedChecksum).toBe(rawChecksum)
      expect(readFileSync(join(stage1, binaryName)).equals(rawBinary)).toBe(
        true,
      )
      expect(requestedUrls.some(u => u.endsWith('/manifest.zst.json'))).toBe(
        true,
      )
      expect(requestedUrls.some(u => u.endsWith(`${binaryName}.zst`))).toBe(
        true,
      )
      // Must stream binary downloads (NOT responseType: 'arraybuffer')
      const binIdx = requestedUrls.findIndex(u => u.endsWith('.zst'))
      expect(requestedResponseTypes[binIdx]).toBe('stream')
    } finally {
      axiosSpy.mockRestore()
    }

    // 2. When .zst returns 404, falls back to raw binary streaming with signedWireSize
    const fallbackUrls: string[] = []
    const fallbackSpy = spyOn(axios, 'get').mockImplementation(
      async (url: string, cfg?: { responseType?: string }) => {
        fallbackUrls.push(`${url}:${cfg?.responseType ?? ''}`)
        if (url.endsWith('/manifest.json')) {
          return { data: Buffer.from(JSON.stringify(manifest)) } as never
        }
        if (url.endsWith('/manifest.zst.json')) {
          return { data: zstManifest } as never
        }
        if (url.endsWith('.zst')) {
          throw Object.assign(new Error('404 Not Found'), {
            isAxiosError: true,
            response: { status: 404 },
          })
        }
        return { data: Readable.from([rawBinary]) } as never
      },
    )
    try {
      const stage2 = join(tempRoot, 'stage-zst-fallback')
      await downloadVersionFromBinaryRepo(
        '2.1.328',
        stage2,
        'https://mirror.example.invalid',
        undefined,
        { signaturePolicy: 'skip' },
      )
      expect(readFileSync(join(stage2, binaryName)).equals(rawBinary)).toBe(
        true,
      )
      expect(fallbackUrls.some(u => u.endsWith(`/${binaryName}:stream`))).toBe(
        true,
      )
    } finally {
      fallbackSpy.mockRestore()
    }
  })

  test('P1-#41: streaming download retries TCP drops & non-deterministic checksum mismatches, and separates stall vs deadline timers', async () => {
    const payload = Buffer.from('VALID_STREAMED_BINARY_CONTENT', 'utf8')
    const expectedChecksum = sha256Hex(payload)

    // 1. Retries mid-stream TCP drop and non-deterministic checksum mismatch -> succeeds on attempt 3
    let attempt = 0
    const retrySpy = spyOn(axios, 'get').mockImplementation(async () => {
      attempt++
      if (attempt === 1) {
        const s = new PassThrough()
        setTimeout(() => {
          s.write(Buffer.from('partial'))
          s.destroy(
            Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
          )
        }, 5)
        return { data: s } as never
      }
      if (attempt === 2) {
        return {
          data: Readable.from([Buffer.from('CORRUPTED_BYTES')]),
        } as never
      }
      return { data: Readable.from([payload]) } as never
    })
    try {
      const out = join(tempRoot, 'stream-retry-bin')
      const outcome = await _downloadAndVerifyBinaryForTesting(
        'https://mirror.example.invalid/claude',
        expectedChecksum,
        out,
        {},
        undefined,
        payload.length,
        0,
      )
      expect(attempt).toBe(3)
      expect(outcome).toEqual({ checksumRetried: true, dropRetried: true })
      expect(readFileSync(out).equals(payload)).toBe(true)
    } finally {
      retrySpy.mockRestore()
    }

    // 2. Signed wire size overflow rejects cleanly without buffering unbounded data
    const oversizeSpy = spyOn(axios, 'get').mockImplementation(
      async () =>
        ({
          data: Readable.from([Buffer.alloc(200, 65)]),
        }) as never,
    )
    try {
      await expect(
        _downloadAndVerifyBinaryForTesting(
          'https://mirror.example.invalid/claude',
          expectedChecksum,
          join(tempRoot, 'oversize-bin'),
          {},
          undefined,
          50,
          0,
        ),
      ).rejects.toThrow(/exceeds the signed size of 50 bytes/)
    } finally {
      oversizeSpy.mockRestore()
    }

    // 3. Separate deadline timer aborts immediately with deadline message (NOT StallTimeoutError, NO retry)
    process.env.CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING = '5000'
    process.env.CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING = '40'
    let deadlineCalls = 0
    const deadlineSpy = spyOn(axios, 'get').mockImplementation(
      async (_url: string, cfg?: { signal?: AbortSignal }) => {
        deadlineCalls++
        const s = new PassThrough()
        const iv = setInterval(() => {
          if (!s.destroyed) s.write(Buffer.from('a'))
        }, 10)
        cfg?.signal?.addEventListener('abort', () => {
          clearInterval(iv)
          s.destroy(new Error('aborted'))
        })
        return { data: s } as never
      },
    )
    try {
      await expect(
        _downloadAndVerifyBinaryForTesting(
          'https://mirror.example.invalid/slow',
          expectedChecksum,
          join(tempRoot, 'deadline-bin'),
          {},
          undefined,
          undefined,
          0,
        ),
      ).rejects.toThrow(/exceeded the total deadline/)
      expect(deadlineCalls).toBe(1)
    } finally {
      deadlineSpy.mockRestore()
    }

    // 4. Separate stall timer triggers StallTimeoutError after 3 retries
    process.env.CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING = '30'
    process.env.CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING = '5000'
    let stallCalls = 0
    const stallSpy = spyOn(axios, 'get').mockImplementation(
      async (_url: string, cfg?: { signal?: AbortSignal }) => {
        stallCalls++
        const s = new PassThrough()
        cfg?.signal?.addEventListener('abort', () => {
          s.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
        return { data: s } as never
      },
    )
    try {
      await expect(
        _downloadAndVerifyBinaryForTesting(
          'https://mirror.example.invalid/stalled',
          expectedChecksum,
          join(tempRoot, 'stall-bin'),
          {},
          undefined,
          undefined,
          0,
        ),
      ).rejects.toBeInstanceOf(StallTimeoutError)
      expect(stallCalls).toBe(3)
    } finally {
      stallSpy.mockRestore()
    }
  })

  test('P1-#41: per-PID ${version}#${pid}.lock protects running versions & 0-byte placeholders do not consume retention slots', async () => {
    const versionsDir = join(getXDGDataHome(), 'claude', 'versions')
    const locksDir = join(process.env.XDG_STATE_HOME!, 'claude', 'locks')
    const binDir = join(process.env.HOME!, '.local', 'bin')
    mkdirSync(versionsDir, { recursive: true })
    mkdirSync(locksDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })

    const mkBin = (
      ver: string,
      ageSec: number,
      content = '#!/bin/sh\necho x\n',
    ) => {
      const p = join(versionsDir, ver)
      writeFileSync(p, content)
      if (content.length > 0) chmodSync(p, 0o755)
      const t = new Date(Date.now() - ageSec * 1000)
      utimesSync(p, t, t)
      return p
    }

    const vActive = mkBin('2.1.328', 10)
    const vKeep1 = mkBin('2.1.327', 20)
    const vKeep2 = mkBin('2.1.326', 30)
    const vLockedByPid = mkBin('2.1.325', 40)
    const vOldDelete = mkBin('2.1.324', 50)
    // Two fresh 0-byte placeholders (MUST NOT evict vKeep1/vKeep2 or be deleted!)
    const vFreshPlaceholder1 = mkBin('2.1.329', 5, '')
    const vFreshPlaceholder2 = mkBin('2.1.330', 6, '')
    // One >1h stale 0-byte placeholder (MUST be deleted!)
    const vStalePlaceholder = mkBin('2.1.320', 7200, '')

    // Point installer-owned launcher symlink to vActive
    const launcher = join(binDir, 'claude')
    symlinkSync(vActive, launcher)

    // Write a per-PID lock file for vLockedByPid (current live PID, NO shared 2.1.325.lock!)
    expect(writePerPidLock(vLockedByPid, locksDir)).toBe(true)
    const perPidFile = getPerPidLockPath(locksDir, '2.1.325', process.pid)
    expect(existsSync(perPidFile)).toBe(true)

    const activeSet = await scanActiveLockedVersions(locksDir)
    expect(activeSet?.has('2.1.325')).toBe(true)
    // Own PID is excluded from hasOtherLiveProcessLockForVersion
    expect(hasOtherLiveProcessLockForVersion(locksDir, '2.1.325')).toBe(false)

    // lockCurrentVersion also writes per-PID lock when running from versionsDir
    Object.defineProperty(process, 'execPath', {
      value: vActive,
      configurable: true,
      writable: true,
    })
    await lockCurrentVersion()
    expect(
      existsSync(getPerPidLockPath(locksDir, '2.1.328', process.pid)),
    ).toBe(true)

    await cleanupOldVersions()

    // Active symlink, 2 newest real binaries, per-PID-locked binary, and fresh 0-byte placeholders ALL stay!
    expect(existsSync(vActive)).toBe(true)
    expect(existsSync(vKeep1)).toBe(true)
    expect(existsSync(vKeep2)).toBe(true)
    expect(existsSync(vLockedByPid)).toBe(true)
    expect(existsSync(vFreshPlaceholder1)).toBe(true)
    expect(existsSync(vFreshPlaceholder2)).toBe(true)
    // Old 3rd real binary & >1h stale 0-byte placeholder were deleted!
    expect(existsSync(vOldDelete)).toBe(false)
    expect(existsSync(vStalePlaceholder)).toBe(false)
  })

  test('P1-#42: installGlobalPackage skips pre-flight prefix W_OK rejection; te(), Ct(), $t() heal and reconcile restore failures', async () => {
    // 1. Pre-flight W_OK rejection removed: read-only prefix does NOT short-circuit installGlobalPackage
    const roPrefix = join(tempRoot, 'ro-prefix')
    mkdirSync(join(roPrefix, 'bin'), { recursive: true })
    const bundledSpy = spyOn(bundledModeMod, 'isInBundledMode').mockReturnValue(
      true,
    )
    Object.defineProperty(process, 'execPath', {
      value: '/usr/local/lib/node_modules/@go-hare/claude-code/claude',
      configurable: true,
      writable: true,
    })
    let installRan = false
    const execSpy = spyOn(execMod, 'execFileNoThrowWithCwd').mockImplementation(
      async (file, args) => {
        if (file === 'npm' && args[0] === 'install') {
          installRan = true
          return { stdout: 'added 1 package\n', stderr: '', code: 0 }
        }
        if (file === 'npm' && args[0] === '-g') {
          return { stdout: `${roPrefix}\n`, stderr: '', code: 0 }
        }
        if (args[0] === '--version') {
          return { stdout: '2.1.330 (Claude Code)\n', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 1 }
      },
    )
    try {
      chmodSync(roPrefix, 0o555)
      const outcome = await installGlobalPackage('2.1.330')
      expect(installRan).toBe(true)
      expect(outcome.status).toBe('success')
    } finally {
      chmodSync(roPrefix, 0o755)
      execSpy.mockRestore()
      bundledSpy.mockRestore()
    }

    // 2. atomicRestoreExecutable (`te`) creates missing parent dirs & cleans stale `.restoring.*` files
    const srcCopy = join(tempRoot, 'backup.old.1')
    writeFileSync(srcCopy, 'RESTORED_EXE_BYTES')
    const missingParentTarget = join(
      tempRoot,
      'deep',
      'nested',
      'bin',
      'claude.exe',
    )
    await atomicRestoreExecutableForTests(srcCopy, missingParentTarget)
    expect(readFileSync(missingParentTarget, 'utf8')).toBe('RESTORED_EXE_BYTES')

    // 3. sweepHealMissingExecutableFromRetiredDirs (`Ct`) restores missing process.execPath from newest minted retired backup
    const nmRoot = join(tempRoot, 'sweep-nm')
    const targetExe = join(
      nmRoot,
      '@go-hare',
      'claude-code',
      'bin',
      'claude.exe',
    )
    const retiredDir = join(nmRoot, '.claude-code-retired1')
    mkdirSync(join(retiredDir, 'bin'), { recursive: true })
    const oldBackup = join(retiredDir, 'bin', 'claude.exe.old.1000')
    const newBackup = join(retiredDir, 'bin', 'claude.exe.old.2000')
    writeFileSync(oldBackup, 'OLD_COPY')
    writeFileSync(newBackup, 'NEWEST_COPY')
    mintPreservedInodeForTests(statSync(oldBackup, { bigint: true }).ino)
    mintPreservedInodeForTests(statSync(newBackup, { bigint: true }).ino)

    Object.defineProperty(process, 'execPath', {
      value: targetExe,
      configurable: true,
      writable: true,
    })
    expect(existsSync(targetExe)).toBe(false)
    await sweepHealMissingExecutableForTests([retiredDir])
    expect(existsSync(targetExe)).toBe(true)
    expect(readFileSync(targetExe, 'utf8')).toBe('NEWEST_COPY')

    // 4. reconcileUpdateRestoreFailure (`$t`) clears failure once originalPath exists again
    setUpdateRestoreFailureForTests({
      originalPath: targetExe,
      preservedPath: newBackup,
    })
    await reconcileUpdateRestoreFailureForTests()
    expect(getUpdateRestoreFailure()).toBeNull()

    // 5. updateCCB.ts awaits async GrowthBook init via isForceDowngradeEnabledAsync (official Ldt)
    const updateCcbSrc = readFileSync(
      join(import.meta.dir, '../../../cli/updateCCB.ts'),
      'utf8',
    )
    expect(updateCcbSrc).toContain('isForceDowngradeEnabledAsync()')
    expect(updateCcbSrc).not.toContain(
      'Promise.resolve(isForceDowngradeEnabled())',
    )

    // Verify isForceDowngradeEnabledAsync awaits getDynamicConfig_BLOCKS_ON_INIT
    const gbSpy = spyOn(
      growthbook,
      'getDynamicConfig_BLOCKS_ON_INIT',
    ).mockResolvedValue({
      external: '2.1.300',
      external_force_downgrade: true,
    })
    try {
      expect(await autoUpdaterMod.isForceDowngradeEnabledAsync()).toBe(true)
    } finally {
      gbSpy.mockRestore()
    }
  })
})
