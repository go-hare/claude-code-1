import { describe, expect, test } from 'bun:test'
import { applyWorkerCredentialSwitchCleanup } from '../bgHostManagedEnv.js'
import {
  BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE,
  BG_ENV_LOGIN_SENTINEL,
  BG_SESSION_CREDENTIAL_ENV,
  computeBgSessionCredentialAnchor,
  getConflictingDaemonCredentialEnvKeys,
  verifyRuntimeBgCredentialAnchor,
} from '../bgSessionCredential.js'

describe('#1993/#1999/#2290 daemon conflicting credential stripping & runtime verification', () => {
  test('getConflictingDaemonCredentialEnvKeys covers env-login, env-authtoken, env-key, and env-apikey completely', () => {
    const loginKeys = getConflictingDaemonCredentialEnvKeys(
      BG_ENV_LOGIN_SENTINEL,
    )
    expect(loginKeys).toContain('ANTHROPIC_API_KEY')
    expect(loginKeys).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(loginKeys).toContain('ANTHROPIC_FEDERATION_RULE_ID')
    expect(loginKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(loginKeys).toContain('ANTHROPIC_PROFILE')
    expect(loginKeys).toContain('ANTHROPIC_CONFIG_DIR')

    const authTokenAnchor = computeBgSessionCredentialAnchor({
      ANTHROPIC_AUTH_TOKEN: 'tok-abc',
    })
    expect(authTokenAnchor.credential).toMatch(/^env-authtoken:/)
    const authTokenKeys = getConflictingDaemonCredentialEnvKeys(
      authTokenAnchor.credential,
    )
    expect(authTokenKeys).toEqual([
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ])

    const apiKeyAnchor = computeBgSessionCredentialAnchor({
      ANTHROPIC_API_KEY: 'sk-ant-123',
    })
    expect(apiKeyAnchor.credential).toMatch(/^env-apikey:/)
    for (const anchor of [
      apiKeyAnchor.credential,
      'env-key:0123456789abcdef:0123456789abcdef0123456789abcdef',
    ]) {
      const keys = getConflictingDaemonCredentialEnvKeys(anchor)
      expect(keys).toContain('ANTHROPIC_AUTH_TOKEN')
      expect(keys).toContain('CLAUDE_CODE_OAUTH_TOKEN')
      expect(keys).toContain('ANTHROPIC_PROFILE')
      expect(keys).toContain('ANTHROPIC_CONFIG_DIR')
    }
  })

  test('verifyRuntimeBgCredentialAnchor rejects daemon-inherited ANTHROPIC_PROFILE and ANTHROPIC_CONFIG_DIR on env-login', () => {
    expect(
      verifyRuntimeBgCredentialAnchor({
        [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
        ANTHROPIC_PROFILE: 'work',
      }),
    ).toBe(BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE)

    expect(
      verifyRuntimeBgCredentialAnchor({
        [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
        ANTHROPIC_CONFIG_DIR: '/tmp/work-config',
      }),
    ).toBe(BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE)

    expect(
      verifyRuntimeBgCredentialAnchor({
        [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
      }),
    ).toBeNull()
  })

  test('applyWorkerCredentialSwitchCleanup strips conflicting keys for env-login, env-authtoken, and env-apikey', () => {
    // env-login strips profile, config dir, API key, auth token, oauth token, federation
    const loginWorkerEnv: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-daemon',
      ANTHROPIC_AUTH_TOKEN: 'tok-daemon',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon',
      ANTHROPIC_FEDERATION_RULE_ID: 'fed-daemon',
      ANTHROPIC_PROFILE: 'daemon-profile',
      ANTHROPIC_CONFIG_DIR: '/tmp/daemon-cfg',
      PATH: '/usr/bin',
    }
    applyWorkerCredentialSwitchCleanup(loginWorkerEnv, loginWorkerEnv, {
      [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
    })
    expect(loginWorkerEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(loginWorkerEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(loginWorkerEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(loginWorkerEnv.ANTHROPIC_FEDERATION_RULE_ID).toBeUndefined()
    expect(loginWorkerEnv.ANTHROPIC_PROFILE).toBeUndefined()
    expect(loginWorkerEnv.ANTHROPIC_CONFIG_DIR).toBeUndefined()
    expect(loginWorkerEnv.PATH).toBe('/usr/bin')

    // env-authtoken strips API key, oauth token, profile, config dir, preserves auth token
    const authTokenAnchor = computeBgSessionCredentialAnchor({
      ANTHROPIC_AUTH_TOKEN: 'tok-caller',
    })
    const authWorkerEnv: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-daemon',
      ANTHROPIC_AUTH_TOKEN: 'tok-caller',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon',
      ANTHROPIC_PROFILE: 'daemon-profile',
      ANTHROPIC_CONFIG_DIR: '/tmp/daemon-cfg',
    }
    applyWorkerCredentialSwitchCleanup(authWorkerEnv, authWorkerEnv, {
      [BG_SESSION_CREDENTIAL_ENV]: authTokenAnchor.credential,
    })
    expect(authWorkerEnv.ANTHROPIC_AUTH_TOKEN).toBe('tok-caller')
    expect(authWorkerEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(authWorkerEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(authWorkerEnv.ANTHROPIC_PROFILE).toBeUndefined()
    expect(authWorkerEnv.ANTHROPIC_CONFIG_DIR).toBeUndefined()

    // env-apikey strips auth token, oauth token, profile, config dir, preserves API key
    const apiKeyAnchor = computeBgSessionCredentialAnchor({
      ANTHROPIC_API_KEY: 'sk-caller',
    })
    const apiKeyWorkerEnv: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-caller',
      ANTHROPIC_AUTH_TOKEN: 'tok-daemon',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon',
      ANTHROPIC_PROFILE: 'daemon-profile',
      ANTHROPIC_CONFIG_DIR: '/tmp/daemon-cfg',
    }
    applyWorkerCredentialSwitchCleanup(apiKeyWorkerEnv, apiKeyWorkerEnv, {
      [BG_SESSION_CREDENTIAL_ENV]: apiKeyAnchor.credential,
    })
    expect(apiKeyWorkerEnv.ANTHROPIC_API_KEY).toBe('sk-caller')
    expect(apiKeyWorkerEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(apiKeyWorkerEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(apiKeyWorkerEnv.ANTHROPIC_PROFILE).toBeUndefined()
    expect(apiKeyWorkerEnv.ANTHROPIC_CONFIG_DIR).toBeUndefined()
  })
})
