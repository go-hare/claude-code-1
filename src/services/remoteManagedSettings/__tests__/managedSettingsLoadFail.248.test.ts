/**
 * densable 2.1.248 #4 — remote managed settings load-fail diagnostics.
 * SEA ISe @180756302 sha=22320eb7789c1845
 * SEA zre @199434623 sha=486d03ff1ba09fd6
 * SEA WTt @199435288 · r @199434788 · cZe @199436286
 * UI @201568447
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ISe,
  WTt,
  cZe,
  classifyRemoteManagedSettingsErrorKind,
  formatIneligibleReason,
  formatRemoteManagedSettingsDoctorLine,
  formatRemoteManagedSettingsStartupWarning,
  oIn,
  recordEligibility,
  recordRemoteManagedSettingsFetchOutcome,
  resetRemoteManagedSettingsLoadStatus,
  sbt,
  zre,
} from '../loadStatus.js'

const loadStatusSrc = readFileSync(
  join(import.meta.dir, '../loadStatus.ts'),
  'utf8',
)
const syncCacheSrc = readFileSync(
  join(import.meta.dir, '../syncCache.ts'),
  'utf8',
)
const statusSrc = readFileSync(
  join(import.meta.dir, '../../../utils/status.tsx'),
  'utf8',
)
const doctorSrc = readFileSync(
  join(import.meta.dir, '../../../screens/Doctor.tsx'),
  'utf8',
)
const noticesSrc = readFileSync(
  join(import.meta.dir, '../../../utils/statusNoticeDefinitions.tsx'),
  'utf8',
)

afterEach(() => {
  resetRemoteManagedSettingsLoadStatus()
})

describe('densable 2.1.248 #4 ISe / zre maps', () => {
  test('ISe gold reasons are the only ISe returns', () => {
    expect(loadStatusSrc).toContain('third_party_provider')
    expect(loadStatusSrc).toContain('custom_base_url')
    expect(loadStatusSrc).toContain('no_auth')
    expect(loadStatusSrc).toContain('oauth_no_inference_scope')
    expect(loadStatusSrc).toContain('prosumer_oauth')
    expect(loadStatusSrc).toContain("getAPIProvider() !== 'firstParty'")
    expect(loadStatusSrc).toContain('skipBaseUrlCheck')
    expect(loadStatusSrc).toContain('skipRetrievingKeyFromApiKeyHelper')
    expect(loadStatusSrc).toContain("o.subscriptionType !== 'enterprise'")
    expect(loadStatusSrc).toContain("o.subscriptionType !== 'team'")
  })

  test('r() gold copy only — no invented ineligible reasons', () => {
    expect(formatIneligibleReason('third_party_provider')).toBe(
      'not available on Bedrock/Vertex/third-party providers',
    )
    expect(formatIneligibleReason('custom_base_url')).toBe(
      'not available with a custom ANTHROPIC_BASE_URL',
    )
    expect(formatIneligibleReason('sandboxed_entrypoint')).toBe(
      'not available in sandboxed sessions',
    )
    expect(formatIneligibleReason('unpinned_gateway')).toBe(
      'gateway auth is unpinned; run `claude auth login` to pin',
    )
    expect(formatIneligibleReason('unsupported_subscription')).toBe(
      'requires an Enterprise or Team subscription',
    )
    expect(formatIneligibleReason('no_auth')).toBe(
      'no usable credentials for the settings fetch',
    )
    expect(loadStatusSrc).not.toContain('oauth_no_inference_scope:')
    expect(syncCacheSrc).toContain('unpinned_gateway')
    expect(syncCacheSrc).toContain('sandboxed_entrypoint')
  })

  test('WTt gold errorKind map', () => {
    expect(WTt('no_auth_available')).toBe('no credentials available')
    expect(WTt('http_401')).toBe('authentication rejected (401)')
    expect(WTt('http_403')).toBe('access denied (403)')
    expect(WTt('http_4xx', 418)).toBe('client error (418)')
    expect(WTt('http_4xx')).toBe('client error')
    expect(WTt('http_5xx', 503)).toBe('server error (503)')
    expect(WTt('timeout')).toBe('request timed out')
    expect(WTt('network_error')).toBe('network error')
    expect(WTt('gateway_cert_mismatch')).toBe('gateway certificate mismatch')
    expect(WTt('gateway_pin_refused')).toBe(
      'gateway TLS pin is in a symlinked credentials file',
    )
    expect(WTt('gateway_pin_unreadable')).toBe(
      'gateway TLS pin could not be read from the credentials file',
    )
    expect(WTt('parse_error')).toBe('server response could not be parsed')
    expect(WTt('invalid_settings')).toBe('server returned invalid settings')
    expect(WTt('unknown_error')).toBe('unexpected error')
  })
})

describe('densable 2.1.248 #4 zre / cZe / startup', () => {
  test('zre synthesizes ineligible from eligibility memo', () => {
    recordEligibility(false, 'third_party_provider')
    expect(zre()).toEqual({
      state: 'ineligible',
      reason: 'third_party_provider',
    })
    expect(cZe(zre()!)).toBe(
      'not fetched \u2014 not available on Bedrock/Vertex/third-party providers',
    )
    expect(formatRemoteManagedSettingsDoctorLine()).toBe(
      'Managed settings (remote): not fetched \u2014 not available on Bedrock/Vertex/third-party providers',
    )
    expect(formatRemoteManagedSettingsStartupWarning()).toBeUndefined()
  })

  test('cZe ok / failed / stale_cache (withheld and not)', () => {
    expect(cZe({ state: 'ok', hasSettings: true })).toBe('loaded')
    expect(cZe({ state: 'ok', hasSettings: false })).toBe(
      'none configured for this organization',
    )
    expect(
      cZe({
        state: 'failed',
        failure: { errorKind: 'timeout' },
      }),
    ).toBe('fetch failed \u2014 no policy applied (request timed out)')
    expect(
      cZe({
        state: 'stale_cache',
        failure: { errorKind: 'network_error' },
        transportEnvWithheld: false,
      }),
    ).toBe('fetch failed \u2014 using stale cache (network error)')
    expect(
      cZe({
        state: 'stale_cache',
        failure: { errorKind: 'network_error' },
        transportEnvWithheld: true,
      }),
    ).toBe(
      'fetch failed \u2014 using stale cache (network error); proxy/CA/provider env withheld until a fetch succeeds',
    )
  })

  test('Gf startup warning: failed and stale_cache only', () => {
    sbt({
      state: 'failed',
      failure: { errorKind: 'http_401' },
    })
    expect(formatRemoteManagedSettingsStartupWarning()).toBe(
      'Remote managed settings failed to load (authentication rejected (401)) \u00b7 no remote policy applied \u00b7 /status for details',
    )

    sbt({
      state: 'stale_cache',
      failure: { errorKind: 'network_error' },
      transportEnvWithheld: true,
    })
    expect(formatRemoteManagedSettingsStartupWarning()).toBe(
      'Remote managed settings failed to load (network error) \u00b7 using cached policy (proxy/CA/provider env withheld) \u00b7 /status for details',
    )

    sbt({
      state: 'stale_cache',
      failure: { errorKind: 'timeout' },
      transportEnvWithheld: false,
    })
    expect(formatRemoteManagedSettingsStartupWarning()).toBe(
      'Remote managed settings failed to load (request timed out) \u00b7 using cached policy \u00b7 /status for details',
    )

    sbt({ state: 'ok', hasSettings: true })
    expect(formatRemoteManagedSettingsStartupWarning()).toBeUndefined()
  })

  test('oIn checking line when eligible and no status', () => {
    recordEligibility(true)
    expect(oIn()).toBe(true)
    expect(zre()).toBeUndefined()
    expect(formatRemoteManagedSettingsDoctorLine()).toBe(
      'Managed settings (remote): checking\u2026 (fetch in progress; re-run in a moment)',
    )
  })

  test('x() records failed vs stale_cache from cache presence', () => {
    recordEligibility(true)
    recordRemoteManagedSettingsFetchOutcome({
      fetchSucceeded: false,
      settings: null,
      failure: { errorKind: 'http_5xx', httpStatus: 502 },
    })
    expect(zre()).toEqual({
      state: 'failed',
      failure: { errorKind: 'http_5xx', httpStatus: 502 },
    })

    recordRemoteManagedSettingsFetchOutcome({
      fetchSucceeded: false,
      settings: { env: { A: '1' } },
      failure: { errorKind: 'timeout' },
      transportEnvWithheld: true,
    })
    expect(zre()).toEqual({
      state: 'stale_cache',
      failure: { errorKind: 'timeout' },
      transportEnvWithheld: true,
    })
  })

  test('classify maps axios buckets onto WTt kinds', () => {
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'auth',
        status: 401,
        message: 'nope',
      }),
    ).toEqual({ errorKind: 'http_401', httpStatus: 401 })
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'auth',
        status: 403,
        message: 'nope',
      }),
    ).toEqual({ errorKind: 'http_403', httpStatus: 403 })
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'timeout',
        message: 'aborted',
      }),
    ).toEqual({ errorKind: 'timeout' })
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'network',
        message: 'ECONNREFUSED',
      }),
    ).toEqual({ errorKind: 'network_error' })
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'http',
        status: 418,
        message: 'teapot',
      }),
    ).toEqual({ errorKind: 'http_4xx', httpStatus: 418 })
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'http',
        status: 503,
        message: 'down',
      }),
    ).toEqual({ errorKind: 'http_5xx', httpStatus: 503 })
    expect(
      classifyRemoteManagedSettingsErrorKind({
        kind: 'other',
        message: 'gateway TLS certificate does not match stored pin',
      }),
    ).toEqual({ errorKind: 'gateway_cert_mismatch' })
  })

  test('/doctor and /status land the gold lines', () => {
    expect(doctorSrc).toContain('formatRemoteManagedSettingsDoctorLine')
    expect(statusSrc).toContain('formatRemoteManagedSettingsStatusValue')
    expect(statusSrc).toContain('formatRemoteManagedSettingsStartupWarning')
    expect(statusSrc).toContain("'Managed settings (remote)'")
  })

  test('Gf startup warning is a StatusNotices definition', () => {
    expect(noticesSrc).toContain("id: 'remote-managed-settings-load-fail'")
    expect(noticesSrc).toContain('formatRemoteManagedSettingsStartupWarning')
    expect(noticesSrc).toContain('remoteManagedSettingsLoadFailNotice')
  })
})

describe('densable 2.1.248 #4 ISe live reasons', () => {
  test('ISe is a function and skipBaseUrlCheck is accepted', () => {
    const reason = ISe({ skipBaseUrlCheck: true })
    expect(
      reason === undefined ||
        reason === 'third_party_provider' ||
        reason === 'no_auth' ||
        reason === 'oauth_no_inference_scope' ||
        reason === 'prosumer_oauth',
    ).toBe(true)
    expect(ISe({ skipBaseUrlCheck: true })).not.toBe('custom_base_url')
  })
})
