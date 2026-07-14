import { afterEach, describe, expect, test } from 'bun:test'
import {
  AWS_AUTH_REFRESH_COOLDOWN_MS,
  AWS_CHAIN_RESOLVE_TIMEOUT_MS,
  AWS_CREDENTIAL_DEFAULT_TTL_MS,
  AWS_CREDENTIAL_MIN_REMAINING_MS,
  AWS_CREDENTIAL_REFRESH_MARGIN_MS,
  awsCredentialCacheTtlMs,
  hasHostManagedAwsMaterial,
  hostManagedAwsSdkCredentials,
  hostManagedNoCredsError,
  isAwsAuthMaterialError,
  isHostManagedProviderAuth,
  isValidAwsCredentialsShape,
  isValidAwsStsOutput,
  parseAwsCredentialExport,
  resolveWithStallGuard,
} from '../aws.js'

describe('parseAwsCredentialExport', () => {
  test('accepts nested STS Credentials shape', () => {
    const creds = parseAwsCredentialExport({
      Credentials: {
        AccessKeyId: 'AKIAtest',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
        Expiration: '2099-01-01T00:00:00Z',
      },
    })
    expect(creds?.AccessKeyId).toBe('AKIAtest')
    expect(creds?.Expiration).toBe('2099-01-01T00:00:00Z')
  })

  test('accepts flat credential object (official 2.1.207 zKl)', () => {
    const creds = parseAwsCredentialExport({
      AccessKeyId: 'AKIAflat',
      SecretAccessKey: 'secret',
      SessionToken: 'token',
    })
    expect(creds?.AccessKeyId).toBe('AKIAflat')
  })

  test('rejects missing fields', () => {
    expect(parseAwsCredentialExport({})).toBeNull()
    expect(parseAwsCredentialExport({ AccessKeyId: 'x' })).toBeNull()
    expect(parseAwsCredentialExport(null)).toBeNull()
  })
})

describe('isValidAwsStsOutput / isValidAwsCredentialsShape', () => {
  test('nested STS only for isValidAwsStsOutput', () => {
    expect(
      isValidAwsStsOutput({
        Credentials: {
          AccessKeyId: 'A',
          SecretAccessKey: 'B',
          SessionToken: 'C',
        },
      }),
    ).toBe(true)
    expect(
      isValidAwsCredentialsShape({
        AccessKeyId: 'A',
        SecretAccessKey: 'B',
        SessionToken: 'C',
      }),
    ).toBe(true)
    expect(
      isValidAwsStsOutput({
        AccessKeyId: 'A',
        SecretAccessKey: 'B',
        SessionToken: 'C',
      }),
    ).toBe(false)
  })
})

describe('awsCredentialCacheTtlMs', () => {
  test('defaults to 1h when no expiration', () => {
    expect(awsCredentialCacheTtlMs(undefined)).toBe(
      AWS_CREDENTIAL_DEFAULT_TTL_MS,
    )
  })

  test('uses remaining lifetime minus 5m margin when far from expiry', () => {
    const far = Date.now() + 60 * 60 * 1000
    const ttl = awsCredentialCacheTtlMs(far)
    expect(ttl).toBeGreaterThan(
      60 * 60 * 1000 -
        AWS_CREDENTIAL_REFRESH_MARGIN_MS -
        AWS_CREDENTIAL_MIN_REMAINING_MS,
    )
    expect(ttl).toBeLessThanOrEqual(
      60 * 60 * 1000 - AWS_CREDENTIAL_REFRESH_MARGIN_MS + 5,
    )
  })

  test('falls back to default TTL when near expiry', () => {
    const near =
      Date.now() +
      AWS_CREDENTIAL_REFRESH_MARGIN_MS +
      AWS_CREDENTIAL_MIN_REMAINING_MS -
      1
    expect(awsCredentialCacheTtlMs(near)).toBe(AWS_CREDENTIAL_DEFAULT_TTL_MS)
  })
})

describe('isAwsAuthMaterialError', () => {
  test('matches ExpiredToken / invalid security token', () => {
    expect(isAwsAuthMaterialError('ExpiredTokenException', '')).toBe(true)
    expect(
      isAwsAuthMaterialError(
        null,
        'The security token included in the request is invalid',
      ),
    ).toBe(true)
    expect(
      isAwsAuthMaterialError('AccessDeniedException', 'not authorized'),
    ).toBe(false)
  })
})

describe('resolveWithStallGuard', () => {
  test('returns resolved value before timeout', async () => {
    const v = await resolveWithStallGuard(Promise.resolve(42), 1000)
    expect(v).toBe(42)
  })

  test('rejects with CredentialsProviderError on timeout', async () => {
    const never = new Promise<number>(() => {})
    await expect(resolveWithStallGuard(never, 20)).rejects.toMatchObject({
      name: 'CredentialsProviderError',
      message: 'AWS default-chain credential resolve timed out',
    })
  })

  test('default timeout constant is 60s (Windows Cred Manager stall)', () => {
    expect(AWS_CHAIN_RESOLVE_TIMEOUT_MS).toBe(60_000)
    expect(AWS_AUTH_REFRESH_COOLDOWN_MS).toBe(30_000)
  })
})

describe('host-managed AWS (official Qv / SPr / vpe)', () => {
  const keys = [
    'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_CONFIG_FILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_PROFILE',
  ] as const
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {}

  afterEach(() => {
    for (const k of keys) {
      if (k in saved) {
        const v = saved[k]
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
        delete saved[k]
      }
    }
  })

  function setEnv(k: (typeof keys)[number], v: string | undefined): void {
    if (!(k in saved)) saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  test('isHostManagedProviderAuth mirrors CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', () => {
    setEnv('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', undefined)
    expect(isHostManagedProviderAuth()).toBe(false)
    setEnv('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', '1')
    expect(isHostManagedProviderAuth()).toBe(true)
    setEnv('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'true')
    expect(isHostManagedProviderAuth()).toBe(true)
  })

  test('hostManagedNoCredsError uses desktop restart telemetry message', () => {
    const err = hostManagedNoCredsError('Bedrock')
    expect(err.message).toContain(
      'Bedrock credentials are managed by the desktop app',
    )
    expect(err.telemetryMessage).toContain(
      'host-managed provider credentials unavailable',
    )
  })

  test('hostManagedAwsSdkCredentials throws without material', () => {
    setEnv('AWS_ACCESS_KEY_ID', undefined)
    setEnv('AWS_SECRET_ACCESS_KEY', undefined)
    setEnv('AWS_CONFIG_FILE', undefined)
    setEnv('AWS_SHARED_CREDENTIALS_FILE', undefined)
    expect(hasHostManagedAwsMaterial()).toBe(false)
    expect(() => hostManagedAwsSdkCredentials('Bedrock')).toThrow(
      /managed by the desktop app/,
    )
  })

  test('hostManagedAwsSdkCredentials returns static keys from env', async () => {
    setEnv('AWS_ACCESS_KEY_ID', 'AKIAtest')
    setEnv('AWS_SECRET_ACCESS_KEY', 'secret')
    setEnv('AWS_SESSION_TOKEN', 'tok')
    setEnv('AWS_CONFIG_FILE', undefined)
    setEnv('AWS_SHARED_CREDENTIALS_FILE', undefined)
    expect(hasHostManagedAwsMaterial()).toBe(true)
    const { credentials } = hostManagedAwsSdkCredentials('Bedrock')
    const id = await credentials()
    expect(id).toEqual({
      accessKeyId: 'AKIAtest',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
    })
  })
})
