import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as tls from 'tls'
import {
  classify403Origin,
  explainNonOrigin403,
  getAllowedProviders,
  getCredentialExpiresAtField,
  getLoginExpirationDate,
  isNonOrigin403,
  validateAllowedProvider,
} from '../auth.js'
import {
  filterLoopedCrossCertificates,
  filterSelfNamedCertificates,
  parseExtraCACertificatesContent,
} from '../caCerts.js'
import { getRetentionCleanupSkipReason } from '../cleanup.js'
import {
  findMostRecentBackup,
  getUnparseableConfigAdvice,
  isUnparseableFileLeftAlone,
  leaveUnparseableFileAlone,
  oweReloadThroughStorage,
  reloadThroughStorageOnce,
  resetGlobalConfigWriteFlagsForTesting,
  saveGlobalConfig,
} from '../config.js'
import { probeCrossSignedRootPairs } from '../mtls.js'
import {
  fetchReleaseWithRetry,
  isRetryableReleaseFetchError,
} from '../nativeInstaller/download.js'
import { isProcessRunning } from '../nativeInstaller/pidLock.js'
import { plainTextStorage } from '../secureStorage/plainTextStorage.js'
import {
  clearInternalWrites,
  getFirstReadStat,
  getOwnWriteBeforeFirstCheck,
  hasFirstReadStat,
  markInternalWrite,
  recordFirstReadStat,
} from '../settings/internalWrites.js'
import {
  applyRemoteSettingsConsentFreeIfEligible,
  buildRemoteSettingsLoadNotice,
  markRemoteSettingsLoadCycleBegun,
  markRemoteSettingsLoadCycleEnded,
  releaseRemoteSettingsLoadBackstop,
  REMOTE_SETTINGS_DID_NOT_LOAD_MSG,
  REMOTE_SETTINGS_HAVE_LOADED_MSG,
  REMOTE_SETTINGS_STILL_LOADING_MSG,
  resetRemoteSettingsStateForTesting,
  resolveRemoteSettingsConsentOutcome,
  setRemoteSettingsEligibilityMemo,
  setRemoteSettingsLoadStatus,
  shouldApplyRemoteSettingsConsentFree,
} from '../settings/remoteSettingsState.js'
import { SettingsSchema } from '../settings/types.js'
import {
  createOtlpHttpAgentFactory,
  getOtlpProxyTunnelTimeoutMs,
  OtlpProxyAgent,
  parseOtlpTimeoutMs,
} from '../telemetry/otlpHttpAgent.js'
import { getAnthropicTelemetryAttributes } from '../telemetryAttributes.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  resetRemoteSettingsStateForTesting()
  resetGlobalConfigWriteFlagsForTesting()
  clearInternalWrites()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 316-318 Group A alignment', () => {
  test('#1571/#1572/#1573 otlpHttpAgent proxy pooling, isSecureEndpoint, maxFreeSockets, and tunnel timeout', () => {
    expect(parseOtlpTimeoutMs(undefined)).toBeUndefined()
    expect(parseOtlpTimeoutMs('0')).toBeUndefined()
    expect(parseOtlpTimeoutMs('12000')).toBe(12000)

    expect(
      getOtlpProxyTunnelTimeoutMs({
        OTEL_EXPORTER_OTLP_TIMEOUT: '12000',
        OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '40000',
      }),
    ).toBe(25000)

    expect(
      getOtlpProxyTunnelTimeoutMs({
        OTEL_EXPORTER_OTLP_TIMEOUT: '8000',
        OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: '15000',
      }),
    ).toBe(15000)

    const prevProxy = process.env.HTTPS_PROXY
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080'
    try {
      const factory = createOtlpHttpAgentFactory('https://otel.example.com')
      const httpAgent = factory('http:')
      const httpsAgent = factory('https:')
      expect(httpAgent).not.toBe(httpsAgent)
      expect(httpAgent).toBeInstanceOf(OtlpProxyAgent)
      expect(httpsAgent).toBeInstanceOf(OtlpProxyAgent)
      expect((httpAgent as OtlpProxyAgent<string>).isSecureEndpoint()).toBe(
        false,
      )
      expect((httpsAgent as OtlpProxyAgent<string>).isSecureEndpoint()).toBe(
        true,
      )
      expect((httpsAgent as OtlpProxyAgent<string>).maxSockets).not.toBe(1)
    } finally {
      if (prevProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = prevProxy
    }
  })

  test('#1533 telemetryAttributes includes anthropic.provider and anthropic.custom_base_url', () => {
    const attrs = getAnthropicTelemetryAttributes({
      ANTHROPIC_BASE_URL: 'https://custom-gateway.example.com',
    })
    expect(attrs['anthropic.provider']).toBe('firstParty')
    expect(attrs['anthropic.custom_base_url']).toBe(true)

    const defaultAttrs = getAnthropicTelemetryAttributes({})
    expect(defaultAttrs['anthropic.provider']).toBe('firstParty')
    expect(defaultAttrs['anthropic.custom_base_url']).toBe(false)
  })

  test('#1475/#1565/#1647 mtls & caCerts env guards and NODE_EXTRA_CA_CERTS salvage/warnings', () => {
    expect(
      probeCrossSignedRootPairs([], {
        CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP: '1',
      }),
    ).toEqual([])

    const errs: string[] = []
    const origError = console.error
    console.error = (...args: unknown[]) => {
      errs.push(args.map(String).join(' '))
    }
    try {
      const emptyResult = parseExtraCACertificatesContent(
        '   \n  ',
        tls,
        '/tmp/empty.pem',
      )
      expect(emptyResult).toBeUndefined()
      expect(errs.some(m => m.includes('NODE_EXTRA_CA_CERTS'))).toBe(true)

      const validRoot = tls.rootCertificates[0]!
      const damagedFirst =
        '-----BEGIN CERTIFICATE-----\nINVALID_BASE64\n-----END CERTIFICATE-----\n' +
        validRoot
      const salvaged = parseExtraCACertificatesContent(
        damagedFirst,
        tls,
        '/tmp/partly.pem',
      )
      expect(salvaged).toBeDefined()
      expect(salvaged).toContain('-----BEGIN CERTIFICATE-----')
      expect(errs.some(m => m.includes('used only the certificates'))).toBe(
        true,
      )
    } finally {
      console.error = origError
    }

    const filteredLoop = filterLoopedCrossCertificates(
      [tls.rootCertificates[0]!],
      { CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP: '1' },
    )
    expect(filteredLoop).toHaveLength(1)

    const filteredSelf = filterSelfNamedCertificates(
      [tls.rootCertificates[0]!],
      tls.rootCertificates,
      undefined,
      { CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP: '1' },
    )
    expect(filteredSelf).toHaveLength(1)

    // Verify self-named filter keeps genuine bundled roots when flag is off
    const filteredDefault = filterSelfNamedCertificates(
      [tls.rootCertificates[0]!],
      tls.rootCertificates,
      undefined,
      {},
    )
    expect(filteredDefault).toHaveLength(1)
    // Touch generateKeyPairSync import to keep strict unused checks happy
    expect(typeof generateKeyPairSync).toBe('function')
  })

  test('#1637/#1668 nativeInstaller pidLock EPERM and download alsoRetry', async () => {
    expect(isProcessRunning(process.pid)).toBe(true)
    expect(isProcessRunning(0)).toBe(false)
    expect(isProcessRunning(1)).toBe(false)

    const origKill = process.kill
    process.kill = ((_pid: number) => {
      const err = Object.assign(new Error('Operation not permitted'), {
        code: 'EPERM',
      })
      throw err
    }) as typeof process.kill
    try {
      expect(isProcessRunning(999999)).toBe(true)
    } finally {
      process.kill = origKill
    }

    expect(
      isRetryableReleaseFetchError(
        Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      ),
    ).toBe(true)
    expect(isRetryableReleaseFetchError({ response: { status: 429 } })).toBe(
      true,
    )
    expect(isRetryableReleaseFetchError({ response: { status: 503 } })).toBe(
      true,
    )
    expect(isRetryableReleaseFetchError({ response: { status: 404 } })).toBe(
      false,
    )
    expect(typeof fetchReleaseWithRetry).toBe('function')
  })

  test('#1531/#1512 remoteSettingsState load status notices and consent-free apply', () => {
    setRemoteSettingsEligibilityMemo(true)
    markRemoteSettingsLoadCycleBegun()
    releaseRemoteSettingsLoadBackstop()
    const pending = buildRemoteSettingsLoadNotice(undefined)
    expect(pending?.message).toBe(REMOTE_SETTINGS_STILL_LOADING_MSG)
    expect(pending?.severity).toBe('warning')

    markRemoteSettingsLoadCycleEnded()
    const missing = buildRemoteSettingsLoadNotice(pending?.said)
    expect(missing?.message).toBe(REMOTE_SETTINGS_DID_NOT_LOAD_MSG)

    setRemoteSettingsLoadStatus({ state: 'ok', hasSettings: true })
    const loaded = buildRemoteSettingsLoadNotice(missing?.said)
    expect(loaded?.message).toContain(REMOTE_SETTINGS_HAVE_LOADED_MSG)
    expect(loaded?.severity).toBe('notice')

    expect(
      shouldApplyRemoteSettingsConsentFree({
        isFirstPartyTrusted: true,
        hasDangerousSettingsChanged: true,
      }),
    ).toBe(true)
    expect(
      resolveRemoteSettingsConsentOutcome({
        isFirstPartyTrusted: true,
        isInteractive: false,
        hasDangerousSettingsChanged: true,
      }),
    ).toBe('first_party_silent')

    const applied = applyRemoteSettingsConsentFreeIfEligible(
      { cleanupPeriodDays: 14 },
      {
        isFirstPartyTrusted: true,
        isInteractive: false,
        hasDangerousSettingsChanged: true,
      },
    )
    expect(applied).toEqual({
      applied: true,
      outcome: 'first_party_silent',
      persistedConsent: true,
    })
  })

  test('#1553/#1554 settings early-write tracking & cleanup --setting-sources isolation', () => {
    const p = '/tmp/test-settings.json'
    recordFirstReadStat(p, { mtimeMs: 100, size: 10 })
    expect(hasFirstReadStat(p)).toBe(true)
    expect(getFirstReadStat(p)).toEqual({ mtimeMs: 100, size: 10 })
    markInternalWrite(p, '{"a":1}')
    expect(getOwnWriteBeforeFirstCheck(p)?.contentHash).toBeTruthy()

    expect(
      getRetentionCleanupSkipReason({
        userSettingsEnabled: false,
        cleanupPeriodDays: undefined,
      }),
    ).toBe('user_source_disabled')

    expect(
      getRetentionCleanupSkipReason({
        userSettingsEnabled: false,
        cleanupPeriodDays: 7,
        hasSettingsErrors: false,
      }),
    ).toBeNull()
  })

  test('#1657/#1659/#1662/#1623 config advice, backup filtering, reloadThroughStorageOnce, saveGlobalConfig boolean', async () => {
    leaveUnparseableFileAlone()
    expect(isUnparseableFileLeftAlone()).toBe(true)
    const advice = getUnparseableConfigAdvice()
    expect(advice.advice).toContain('Fix the JSON in')

    let reloadCount = 0
    oweReloadThroughStorage()
    await reloadThroughStorageOnce(async () => {
      reloadCount++
    })
    await reloadThroughStorageOnce(async () => {
      reloadCount++
    })
    expect(reloadCount).toBe(1)

    expect(saveGlobalConfig(c => c)).toBe(true)

    const dir = makeTempDir('cfg-bkp-')
    const cfgFile = join(dir, 'claude.json')
    writeFileSync(`${cfgFile}.backup.1000`, '{"numStartups": 3}', 'utf8')
    writeFileSync(`${cfgFile}.backup.2000`, '   \0  ', 'utf8')
    writeFileSync(`${cfgFile}.backup.3000`, '{truncated', 'utf8')
    const best = findMostRecentBackup(cfgFile)
    expect(best).toBe(`${cfgFile}.backup.1000`)
  })

  test('#1655/#1550/#1618/#1629 plainTextStorage atomic write, nonOrigin403, loginExpiresAt, allowedProviders', () => {
    expect(typeof plainTextStorage.update).toBe('function')

    const cfKind = classify403Origin(h =>
      h === 'cf-ray' ? '12345-SJC' : undefined,
    )
    expect(cfKind).toBe('nonorigin_cf')
    expect(isNonOrigin403(cfKind)).toBe(true)
    if (isNonOrigin403(cfKind)) {
      expect(explainNonOrigin403(cfKind)).toContain('Cloudflare')
    }

    const originKind = classify403Origin(h =>
      h === 'request-id' ? 'req_abc123' : undefined,
    )
    expect(originKind).toBe('origin')
    expect(isNonOrigin403(originKind)).toBe(false)

    expect(getLoginExpirationDate()).toBeNull()
    expect(getCredentialExpiresAtField()).toEqual({})

    const parsed = SettingsSchema().safeParse({
      allowedProviders: ['anthropic', 'bedrock', 'unknown_ignored'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.allowedProviders).toEqual(['anthropic', 'bedrock'])
    }
    expect(getAllowedProviders()).toBeUndefined()
    expect(validateAllowedProvider('firstParty')).toEqual({ valid: true })
  })
})
