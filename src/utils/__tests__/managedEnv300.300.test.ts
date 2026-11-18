import { describe, expect, test } from 'bun:test'
import { stripHostManagedSettingsEnv } from '../managedEnv.js'
import { isHostTransportSensitiveEnvVar } from '../managedEnvConstants.js'

describe('managedEnv 2.1.300 alignment (#809)', () => {
  test('#809 isHostTransportSensitiveEnvVar matches CA-bundle, git TLS, and git config vars', () => {
    for (const key of [
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
      'REQUESTS_CA_BUNDLE',
      'CURL_CA_BUNDLE',
      'GIT_SSL_CAINFO',
      'GIT_SSL_NO_VERIFY',
      'GIT_PROXY_COMMAND',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_12',
    ]) {
      expect(isHostTransportSensitiveEnvVar(key)).toBe(true)
    }
    expect(isHostTransportSensitiveEnvVar('PATH')).toBe(false)
  })

  test('#809 under desktopHost, transport/proxy/CA/git vars are stripped only in project/local settings', () => {
    const sample = {
      SSL_CERT_FILE: '/tmp/ca.pem',
      REQUESTS_CA_BUNDLE: '/tmp/req.pem',
      HTTPS_PROXY: 'http://127.0.0.1:8888',
      GIT_SSL_CAINFO: '/tmp/git.pem',
      GIT_CONFIG_GLOBAL: '/tmp/gitconfig',
      MY_APP_VAR: 'keep',
    }
    const stripped: string[] = []

    const fromUser = stripHostManagedSettingsEnv(sample, {
      managedByHost: true,
      managedByHostFlag: true,
      desktopHost: true,
      source: 'userSettings',
      onStrip: k => stripped.push(k),
    })
    expect(fromUser).toEqual(sample)
    expect(stripped).toEqual([])

    const fromProject = stripHostManagedSettingsEnv(sample, {
      managedByHost: true,
      managedByHostFlag: true,
      desktopHost: true,
      source: 'projectSettings',
      onStrip: k => stripped.push(k),
    })
    expect(fromProject).toEqual({ MY_APP_VAR: 'keep' })
    expect(stripped).toEqual([
      'SSL_CERT_FILE',
      'REQUESTS_CA_BUNDLE',
      'HTTPS_PROXY',
      'GIT_SSL_CAINFO',
      'GIT_CONFIG_GLOBAL',
    ])
  })

  test('#809 when desktopHost is false, transport/proxy/CA/git vars are stripped from all sources', () => {
    const sample = {
      SSL_CERT_FILE: '/tmp/ca.pem',
      HTTPS_PROXY: 'http://127.0.0.1:8888',
      MY_APP_VAR: 'keep',
    }
    const fromUser = stripHostManagedSettingsEnv(sample, {
      managedByHost: true,
      managedByHostFlag: true,
      desktopHost: false,
      source: 'userSettings',
      onStrip: () => {},
    })
    expect(fromUser).toEqual({ MY_APP_VAR: 'keep' })
  })
})
