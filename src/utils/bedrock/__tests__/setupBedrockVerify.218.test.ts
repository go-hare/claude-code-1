/**
 * densable 2.1.218 #17 — iEp / Fzy / Nzy pure-surface tests.
 * Runtime fYt/pYt covered by awsProxyHandler.218.test.ts.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  createWizardCredentialProvider,
  mapBedrockVerifyError,
  verifyBedrockBearer,
  type BedrockWizardData,
} from '../setupBedrockVerify.js'

const profileData = (
  over: Partial<BedrockWizardData> = {},
): BedrockWizardData => ({
  authMethod: 'profile',
  region: 'us-gov-west-1',
  awsProfile: 'my-sso',
  ...over,
})

describe('densable 2.1.218 #17 Fzy mapBedrockVerifyError', () => {
  test('CredentialsProviderError + profile → SSO login command', () => {
    const r = mapBedrockVerifyError(
      { name: 'CredentialsProviderError', message: 'Could not load' },
      profileData(),
    )
    expect(r.error).toContain('Could not load credentials for profile "my-sso"')
    expect(r.command).toBe('aws sso login --profile my-sso')
  })

  test('CredentialsProviderError + accessKey → no credentials found', () => {
    const r = mapBedrockVerifyError(
      { name: 'CredentialsProviderError', message: 'boom' },
      { authMethod: 'accessKey', region: 'us-east-1' },
    )
    expect(r.error).toContain('No AWS credentials found')
    expect(r.command).toBeUndefined()
  })

  test('ExpiredTokenException profile → SSO session expired', () => {
    const r = mapBedrockVerifyError(
      { name: 'ExpiredTokenException', message: 'expired' },
      profileData(),
    )
    expect(r.error).toBe('SSO session expired. Run:')
    expect(r.command).toBe('aws sso login --profile my-sso')
  })

  test('TokenRefreshRequired non-profile → Credentials expired', () => {
    const r = mapBedrockVerifyError(
      { name: 'TokenRefreshRequired', message: 'x' },
      { authMethod: 'environment', region: 'eu-west-1' },
    )
    expect(r.error).toContain('Credentials expired')
  })

  test('ForbiddenException profile → permission set message', () => {
    const r = mapBedrockVerifyError(
      { name: 'ForbiddenException', message: 'nope' },
      profileData(),
    )
    expect(r.error).toContain('SSO portal denied access')
    expect(r.error).toContain('my-sso')
  })

  test('AccessDeniedException → ListInferenceProfiles permission', () => {
    const r = mapBedrockVerifyError(
      { name: 'AccessDeniedException', message: 'denied' },
      profileData(),
    )
    expect(r.error).toContain('bedrock:ListInferenceProfiles')
  })

  test('UnrecognizedClientException / InvalidSignatureException', () => {
    expect(
      mapBedrockVerifyError(
        { name: 'UnrecognizedClientException', message: 'bad' },
        profileData(),
      ).error,
    ).toContain('Invalid credentials')
    expect(
      mapBedrockVerifyError(
        { name: 'InvalidSignatureException', message: 'sig' },
        profileData(),
      ).error,
    ).toContain('Invalid credentials')
  })

  test('UnknownEndpoint / ENOTFOUND → region network message', () => {
    const r = mapBedrockVerifyError(
      { name: 'UnknownEndpoint', message: 'dns' },
      profileData({ region: 'cn-north-1' }),
    )
    expect(r.error).toContain('cn-north-1')
    expect(r.error).toContain('Cannot reach AWS')
    const r2 = mapBedrockVerifyError(
      { name: 'ENOTFOUND', message: 'dns' },
      profileData({ region: 'eu-central-1' }),
    )
    expect(r2.error).toContain('eu-central-1')
  })

  test('default → name: message', () => {
    const r = mapBedrockVerifyError(
      { name: 'SomeOtherError', message: 'detail' },
      profileData(),
    )
    expect(r.error).toBe('SomeOtherError: detail')
  })
})

describe('densable 2.1.218 #17 iEp createWizardCredentialProvider', () => {
  const prevHttps = process.env.HTTPS_PROXY
  const prevHttp = process.env.HTTP_PROXY

  afterEach(() => {
    if (prevHttps === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = prevHttps
    if (prevHttp === undefined) delete process.env.HTTP_PROXY
    else process.env.HTTP_PROXY = prevHttp
    mock.restore()
  })

  test('accessKey returns static credentials provider', async () => {
    const provider = await createWizardCredentialProvider({
      authMethod: 'accessKey',
      region: 'us-east-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
    })
    expect(provider).toBeDefined()
    const creds = await provider!()
    expect(creds).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
    })
  })

  test('environment / bearer return undefined (SDK default chain)', async () => {
    expect(
      await createWizardCredentialProvider({
        authMethod: 'environment',
        region: 'us-east-1',
      }),
    ).toBeUndefined()
    expect(
      await createWizardCredentialProvider({
        authMethod: 'bearer',
        region: 'us-east-1',
        bearerToken: 'x',
      }),
    ).toBeUndefined()
  })

  test('profile injects parentClientConfig.region + requestHandler on both configs', async () => {
    // Force fYt null so iEp falls back to NodeHttpHandler timeout handler.
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY

    let captured: Record<string, unknown> | undefined
    mock.module('@aws-sdk/credential-providers', () => ({
      fromNodeProviderChain: (opts: Record<string, unknown>) => {
        captured = opts
        return async () => ({
          accessKeyId: 'A',
          secretAccessKey: 'S',
        })
      },
    }))

    // Dynamic import is inside createWizardCredentialProvider — mock applies.
    const provider = await createWizardCredentialProvider({
      authMethod: 'profile',
      region: 'us-gov-west-1',
      awsProfile: 'partition-role',
    })
    expect(provider).toBeDefined()
    expect(captured).toBeDefined()
    expect(captured!.profile).toBe('partition-role')
    expect(captured!.ignoreCache).toBe(true)
    const parent = captured!.parentClientConfig as {
      region: string
      requestHandler: unknown
    }
    const client = captured!.clientConfig as { requestHandler: unknown }
    expect(parent.region).toBe('us-gov-west-1')
    expect(parent.requestHandler).toBeDefined()
    expect(client.requestHandler).toBe(parent.requestHandler)
  })
})

describe('densable 2.1.218 #17 Nzy verifyBedrockBearer', () => {
  test('empty token → invalid key error', async () => {
    const r = await verifyBedrockBearer({
      authMethod: 'bearer',
      region: 'us-east-1',
      bearerToken: '   ',
    })
    expect(r.status).toBe('error')
    if (r.status === 'error') {
      expect(r.error).toContain('Invalid Bedrock API key')
    }
  })
})
