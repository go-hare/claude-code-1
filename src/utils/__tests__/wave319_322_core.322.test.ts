import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFeatureFlagsDisabledEnvVar } from '../../services/analytics/growthbook.js'
import {
  isCoworkCloudBlockedEnvVar,
  isPolicyTransportEnvVar,
  SAFE_ENV_VARS,
} from '../managedEnvConstants.js'
import { SettingsSchema } from '../settings/types.js'
import {
  classifyPlutilUnreadCause,
  isRetryableMdmUnreadCause,
} from '../settings/mdm/rawRead.js'
import {
  detectTwoConfigFiles,
  formatTwoConfigFilesWarning,
  isFeedbackRefusedByServer,
  recordFeedbackRefusedByServer,
  getGlobalConfig,
  saveGlobalConfig,
} from '../config.js'
import { detectFeedbackGatewayState } from '../feedbackDrafts/gates.js'
import {
  NETWORK_FILESYSTEM_STATFS_MAGICS,
  shouldSkipStartupFileIndexing,
} from '../fileIndexing.js'
import { removeDirectoryTreeWithRetry } from '../cleanup.js'
import {
  getMediaRemovedPlaceholderText,
  MEDIA_REMOVED_SEEN_TEXT,
  MEDIA_REMOVED_UNSEEN_TEXT,
} from '../subagentCacheEvict.js'
import {
  parseVcsRepositoryAttributes,
  shouldIncludeRepositoryMetrics,
} from '../telemetry/vcsRepositoryAttributes.js'
import {
  clearVerifiedVersionsCacheForTesting,
  isVersionBinaryVerifiedCached,
  updateSymlink,
} from '../nativeInstaller/installer.js'
import {
  recordSessionCountMetricOnce,
  resetSessionCountMetricForTesting,
} from '../../entrypoints/init.js'
import { shouldSkipRemoteManagedSettingsPollForExpiredGateway } from '../settings/remoteSettingsState.js'
import { setGatewayAuth } from '../gatewayEnv.js'

const savedEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key]
    }
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v !== undefined) {
      process.env[k] = v
    }
  }
}

afterEach(() => {
  restoreEnv()
  setGatewayAuth(null)
  resetSessionCountMetricForTesting()
  clearVerifiedVersionsCacheForTesting()
})

describe('Wave 319-322 Group 2: Settings, ManagedEnv & Feature Flags (#1703, #1705, #1808, #1903, #1935)', () => {
  test('#1703 & #1935: SettingsSchema accepts permissions.denyInsteadOfPrompting and documents Pro/Max/Ultra', () => {
    const parsed = SettingsSchema().parse({
      permissions: {
        denyInsteadOfPrompting: true,
      },
    })
    expect(parsed.permissions?.denyInsteadOfPrompting).toBe(true)

    const schemaShape = SettingsSchema().shape
    expect(schemaShape.allowedProviders.description).toContain('Pro/Max/Ultra')
  })

  test('#1705: CLAUDE_CODE_DISABLE_FEATURE_FLAGS disables GrowthBook / feature flags', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FEATURE_FLAGS
    delete process.env.DISABLE_GROWTHBOOK
    expect(getFeatureFlagsDisabledEnvVar()).toBeNull()

    process.env.CLAUDE_CODE_DISABLE_FEATURE_FLAGS = '1'
    expect(getFeatureFlagsDisabledEnvVar()).toBe(
      'CLAUDE_CODE_DISABLE_FEATURE_FLAGS',
    )
  })

  test('#1808: blocks CLAUDE_CODE_PROXY_RESOLVES_HOSTS under coworkCloud and policyTransportEnv', () => {
    expect(isPolicyTransportEnvVar('CLAUDE_CODE_PROXY_RESOLVES_HOSTS')).toBe(
      true,
    )
    expect(isCoworkCloudBlockedEnvVar('CLAUDE_CODE_PROXY_RESOLVES_HOSTS')).toBe(
      true,
    )
  })

  test('#1903: classifies macOS MDM slow-read timeout as retryable unreadCause', () => {
    const result = classifyPlutilUnreadCause({
      status: 'timeout',
      stdout: '',
      stderr: '',
      code: null,
      signal: 'SIGTERM',
      errno: null,
    })
    expect(result.unreadCause).toBe('timeout')
    expect(isRetryableMdmUnreadCause(result.unreadCause)).toBe(true)
  })
})

describe('Wave 319-322 Group 2: Config, Feedback Drafts & File Indexing (#1725, #1728, #1729, #1738)', () => {
  test('#1738: detects two distinct non-empty config files and formats warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-two-cfg-'))
    try {
      const legacyPath = join(dir, '.config.json')
      const primaryPath = join(dir, '.claude.json')
      writeFileSync(legacyPath, '{"a":1}', 'utf8')
      writeFileSync(primaryPath, '{"b":2}', 'utf8')

      const detected = detectTwoConfigFiles({ legacyPath, primaryPath })
      expect(detected).toEqual({ active: legacyPath, unused: primaryPath })
      const msg = formatTwoConfigFilesWarning(
        detected!.active,
        detected!.unused,
      )
      expect(msg).toContain(legacyPath)
      expect(msg).toContain(primaryPath)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1728 & #1729: remembers server feedback refusal and detects third-party LLM gateway', () => {
    const original = getGlobalConfig()
    try {
      recordFeedbackRefusedByServer('org-test-zdr')
      expect(isFeedbackRefusedByServer('org-test-zdr')).toBe(true)
      expect(isFeedbackRefusedByServer('org-other')).toBe(false)

      process.env.ANTHROPIC_BASE_URL = 'https://proxy.corp.example.com'
      const gw = detectFeedbackGatewayState()
      expect(gw).toBe('gateway')
    } finally {
      saveGlobalConfig(() => original)
    }
  })

  test('#1725: network filesystem magic set includes NFS/SMB/CIFS/Lustre/GPFS and skips indexing on matched magic', async () => {
    expect(NETWORK_FILESYSTEM_STATFS_MAGICS.has(0x6969)).toBe(true) // NFS
    expect(NETWORK_FILESYSTEM_STATFS_MAGICS.has(0xff534d42)).toBe(true) // CIFS
    expect(NETWORK_FILESYSTEM_STATFS_MAGICS.has(0xfe534d42)).toBe(true) // SMB2
    expect(NETWORK_FILESYSTEM_STATFS_MAGICS.has(0x0bd00bd0)).toBe(true) // Lustre
    expect(NETWORK_FILESYSTEM_STATFS_MAGICS.has(0x47504653)).toBe(true) // GPFS

    expect(
      await shouldSkipStartupFileIndexing('/mnt/nfs/repo', {
        platform: 'linux',
        statfsFn: async () => ({ type: 0x6969 }),
      }),
    ).toBe(true)
    expect(
      await shouldSkipStartupFileIndexing('/tmp/local-repo', {
        platform: 'linux',
        statfsFn: async () => ({ type: 0xef53 }), // ext4
      }),
    ).toBe(false)
  })
})

describe('Wave 319-322 Group 2: Telemetry, Cleanup, Subagent Media & Installer (#1759, #1761, #1795, #1873, #1923, #1929)', () => {
  test('#1761: skips remote managed settings background poll when pinned gateway session is expired', async () => {
    setGatewayAuth({
      url: 'https://gw.example.com',
      jwt: 'expired-jwt',
      expiresAtMs: Date.now() - 10_000,
    })
    expect(await shouldSkipRemoteManagedSettingsPollForExpiredGateway()).toBe(
      true,
    )

    setGatewayAuth({
      url: 'https://gw.example.com',
      jwt: 'fresh-jwt',
      expiresAtMs: Date.now() + 60_000,
    })
    expect(await shouldSkipRemoteManagedSettingsPollForExpiredGateway()).toBe(
      false,
    )
  })

  test('#1759: recordSessionCountMetricOnce returns false safely when meter is uninitialized', () => {
    expect(recordSessionCountMetricOnce()).toBe(false)
  })

  test('#1873: OTEL_METRICS_INCLUDE_REPOSITORY is in SAFE_ENV_VARS and parses vcs.* attributes', () => {
    expect(SAFE_ENV_VARS.has('OTEL_METRICS_INCLUDE_REPOSITORY')).toBe(true)
    process.env.OTEL_METRICS_INCLUDE_REPOSITORY = '1'
    expect(shouldIncludeRepositoryMetrics()).toBe(true)

    const attrs = parseVcsRepositoryAttributes(
      'git@github.com:anthropics/claude-code.git',
      { revision: 'abc1234', name: 'main', type: 'branch' },
    )
    expect(attrs['vcs.repository.name']).toBe('claude-code')
    expect(attrs['vcs.repository.url.full']).toBe(
      'https://github.com/anthropics/claude-code',
    )
    expect(attrs['vcs.ref.head.revision']).toBe('abc1234')
    expect(attrs['vcs.ref.head.name']).toBe('main')
    expect(attrs['vcs.ref.head.type']).toBe('branch')
  })

  test('#1795: removeDirectoryTreeWithRetry retries ENOTEMPTY with 50ms * attempt backoff and re-checks lstat', async () => {
    const delays: number[] = []
    let rmCalls = 0
    await removeDirectoryTreeWithRetry('/tmp/fake-dir', {
      rmFn: async () => {
        rmCalls++
        if (rmCalls < 3) {
          throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' })
        }
      },
      lstatFn: async () => {
        if (rmCalls < 3) return {}
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      sleepFn: async ms => {
        delays.push(ms)
      },
    })
    expect(rmCalls).toBe(3)
    expect(delays).toEqual([50, 100])

    // Still present after 3 attempts throws ENOTEMPTY error
    await expect(
      removeDirectoryTreeWithRetry('/tmp/stuck-dir', {
        rmFn: async () => {},
        lstatFn: async () => ({}),
        sleepFn: async () => {},
      }),
    ).rejects.toThrow(/still on disk after three tries/)
  })

  test('#1929: distinguishes seen vs unseen stripped image placeholders', () => {
    expect(getMediaRemovedPlaceholderText(0, 1)).toBe(MEDIA_REMOVED_SEEN_TEXT)
    expect(getMediaRemovedPlaceholderText(2, 1)).toBe(MEDIA_REMOVED_UNSEEN_TEXT)
    expect(MEDIA_REMOVED_SEEN_TEXT).toContain('You have already seen this')
    expect(MEDIA_REMOVED_UNSEEN_TEXT).toContain('You have not seen this')
  })

  test('#1923: native installer direct symlink fast-path, noop skip, and verified-version cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-inst-321-'))
    try {
      const versionsDir = join(dir, 'claude', 'versions')
      const binDir = join(dir, 'bin')
      mkdirSync(versionsDir, { recursive: true })
      mkdirSync(binDir, { recursive: true })
      const v1 = join(versionsDir, '2.1.321')
      const v2 = join(versionsDir, '2.1.322')
      writeFileSync(v1, '#!/bin/sh\necho v1\n', { mode: 0o755 })
      writeFileSync(v2, '#!/bin/sh\necho v2\n', { mode: 0o755 })
      const link = join(binDir, 'claude')

      // Fresh install: direct symlink succeeds
      expect(await updateSymlink(link, v1)).toBe(true)
      // Same target: fast noop
      expect(await updateSymlink(link, v1)).toBe(false)
      // Native-owned symlink: atomic update to v2
      expect(await updateSymlink(link, v2)).toBe(true)

      // Verified-version cache hit
      expect(await isVersionBinaryVerifiedCached('2.1.322', v2)).toBe(true)
      expect(await isVersionBinaryVerifiedCached('2.1.322', v2)).toBe(true)

      // External symlink not owned by native installer is refused
      const extLink = join(binDir, 'claude-ext')
      const extTarget = join(dir, 'custom-wrapper')
      writeFileSync(extTarget, '#!/bin/sh\necho custom\n', { mode: 0o755 })
      symlinkSync(extTarget, extLink)
      expect(await updateSymlink(extLink, v2)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
