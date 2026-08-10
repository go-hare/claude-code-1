import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  parseAwsIniSections,
  parseHostPinnedSsoProfile,
  resolveHostPinnedSsoCredentials,
} from '../aws.js'

describe('densable 2.1.221 host-pinned SSO (Twu/sc_/Ewu)', () => {
  let dir: string
  const prevHome = process.env.HOME

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('parseAwsIniSections maps profile + sso-session keys', () => {
    const config = parseAwsIniSections(
      `
[default]
region = us-east-1
[profile desktop-sso]
sso_session = mysession
sso_account_id = 111122223333
sso_role_name = MyRole
[sso-session mysession]
sso_start_url = https://example.awsapps.com/start
sso_region = us-west-2
`,
      'config',
    )
    expect(config['desktop-sso']?.sso_account_id).toBe('111122223333')
    expect(config['sso-session.mysession']?.sso_region).toBe('us-west-2')
  })

  test('Twu: pure SSO profile resolves; static keys rejected', async () => {
    dir = await mkdtemp(join(tmpdir(), 'aws-sso-twu-'))
    const configPath = join(dir, 'config')
    await writeFile(
      configPath,
      `
[profile pure]
sso_session = sess
sso_account_id = 123456789012
sso_role_name = Admin
[sso-session sess]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
[profile staticy]
aws_access_key_id = AKIAxxxx
aws_secret_access_key = secret
sso_account_id = 123456789012
sso_role_name = Admin
`,
    )
    const pure = await parseHostPinnedSsoProfile(configPath, null, 'pure')
    expect(pure).toEqual({
      cacheId: 'sess',
      accountId: '123456789012',
      roleName: 'Admin',
      region: 'us-east-1',
    })
    expect(
      await parseHostPinnedSsoProfile(configPath, null, 'staticy'),
    ).toBeNull()
  })

  test('sc_: poisoned HOME still reads cache next to AWS_CONFIG_FILE', async () => {
    dir = await mkdtemp(join(tmpdir(), 'aws-sso-sc-'))
    // Stray HOME that would poison getHomeDir()/.aws/sso/cache
    const poisonHome = join(dir, 'poison-home')
    await mkdir(poisonHome, { recursive: true })
    process.env.HOME = poisonHome

    const hostConfigDir = join(dir, 'host-aws')
    await mkdir(hostConfigDir, { recursive: true })
    const configPath = join(hostConfigDir, 'config')
    await writeFile(
      configPath,
      `
[profile desktop-sso]
sso_session = sess
sso_account_id = 123456789012
sso_role_name = Admin
[sso-session sess]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
`,
    )
    const cacheId = 'sess'
    const cacheHash = createHash('sha1').update(cacheId).digest('hex')
    const cachePath = join(hostConfigDir, 'sso', 'cache', `${cacheHash}.json`)
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(
      cachePath,
      JSON.stringify({
        accessToken: 'tok-host-pinned',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    )
    // Poison HOME has no usable cache
    await mkdir(join(poisonHome, '.aws', 'sso', 'cache'), { recursive: true })

    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input)
      expect(url).toContain('portal.sso.us-east-1.amazonaws.com')
      expect(url).toContain('account_id=123456789012')
      expect(url).toContain('role_name=Admin')
      const headers = new Headers(init?.headers)
      expect(headers.get('x-amz-sso_bearer_token')).toBe('tok-host-pinned')
      return new Response(
        JSON.stringify({
          roleCredentials: {
            accessKeyId: 'ASIAHOST',
            secretAccessKey: 'secret-host',
            sessionToken: 'token-host',
            expiration: Date.now() + 3600_000,
          },
        }),
        { status: 200 },
      )
    }

    const creds = await resolveHostPinnedSsoCredentials(
      configPath,
      null,
      'desktop-sso',
      { fetchImpl },
    )
    expect(creds).toEqual({
      accessKeyId: 'ASIAHOST',
      secretAccessKey: 'secret-host',
      sessionToken: 'token-host',
    })
  })

  test('sc_: non-SSO / missing cache returns null (fromIni fallback)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'aws-sso-null-'))
    const configPath = join(dir, 'config')
    await writeFile(
      configPath,
      `
[profile plain]
region = us-east-1
`,
    )
    expect(
      await resolveHostPinnedSsoCredentials(configPath, null, 'plain'),
    ).toBeNull()
  })
})
