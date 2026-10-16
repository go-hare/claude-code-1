/**
 * densable 2.1.289 credential FD reads: sync snapshot `P`, bounded `b`,
 * descriptor `k`, and gateway `Het`. Does not mock src/utils/auth.ts.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getGatewayTokenFromDescriptor,
  getOauthScopesFromFd,
  getOauthTokenFromFd,
  isOauthTokenFromBgSnapshot,
  resetFdCredentialState,
  setGatewayTokenFromDescriptor,
} from '../../bootstrap/state.js'
import {
  CCR_OAUTH_TOKEN_PATH,
  consumeStartupCredentialDescriptors,
  getApiKeyFromFileDescriptor,
  getOAuthTokenFromFileDescriptor,
  readGatewayTokenFromDescriptor,
  readOAuthTokenFromFileDescriptor,
} from '../authFileDescriptor.js'
import * as debug from '../debug.js'

const ENV_KEYS = [
  'CLAUDE_BG_AUTH_SNAPSHOT_PATH',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_REMOTE_SESSION_ORIGIN',
  'CLAUDE_CODE_SUBSCRIPTION_TYPE',
  'CLAUDE_CODE_RATE_LIMIT_TIER',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map(key => [key, process.env[key]]),
)

let dir = ''

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

function resetSlots(): void {
  resetFdCredentialState()
  setGatewayTokenFromDescriptor(undefined)
}

async function waitUntilGone(path: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (!fs.existsSync(path)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function throwBusy(): never {
  const error = new Error('EBUSY: resource busy') as NodeJS.ErrnoException
  error.code = 'EBUSY'
  throw error
}

beforeEach(() => {
  clearEnv()
  resetSlots()
  dir = fs.mkdtempSync(join(tmpdir(), 'auth-fd-289-'))
})

afterEach(() => {
  restoreEnv()
  resetSlots()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe('authFileDescriptor 2.1.289', () => {
  test('P via getOAuthTokenFromFileDescriptor consumes accessToken and scopes', async () => {
    const snap = join(dir, 'snap.json')
    fs.writeFileSync(
      snap,
      `${JSON.stringify({
        accessToken: 'snap-access',
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_ai',
      })}\n`,
    )
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap

    const token = getOAuthTokenFromFileDescriptor()

    expect(token).toBe('snap-access')
    expect(getOauthTokenFromFd()).toBe('snap-access')
    expect(isOauthTokenFromBgSnapshot()).toBe(true)
    expect(getOauthScopesFromFd()).toEqual(['user:inference', 'user:profile'])
    expect(process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE).toBe('max')
    expect(process.env.CLAUDE_CODE_RATE_LIMIT_TIER).toBe('default_claude_ai')
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
    await waitUntilGone(snap)
    expect(fs.existsSync(snap)).toBe(false)
  })

  test('gatewayToken snapshot does not set the oauth FD token', () => {
    const snap = join(dir, 'gw.json')
    fs.writeFileSync(
      snap,
      JSON.stringify({
        gatewayToken: 'gw-from-snap',
        accessToken: 'oauth-should-not-apply',
      }),
    )
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap

    const token = getOAuthTokenFromFileDescriptor()

    expect(getGatewayTokenFromDescriptor()).toBe('gw-from-snap')
    expect(token).not.toBe('oauth-should-not-apply')
    expect(getOauthTokenFromFd()).not.toBe('oauth-should-not-apply')
    expect(isOauthTokenFromBgSnapshot()).toBe(false)
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
  })

  test('ENOENT snapshot deletes the env and does not throw', () => {
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = join(dir, 'missing.json')

    expect(() => getOAuthTokenFromFileDescriptor()).not.toThrow()
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
    expect(isOauthTokenFromBgSnapshot()).toBe(false)
  })

  test('EBUSY snapshot keeps the env so the next read can retry', () => {
    const snap = join(dir, 'busy.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'busy-token' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap
    let snapOpens = 0
    const original = fs.openSync
    const openSpy = spyOn(fs, 'openSync').mockImplementation(((
      path: fs.PathLike,
      flags: number | string,
    ) => {
      if (String(path) === snap) {
        snapOpens += 1
        throwBusy()
      }
      return original(path, flags)
    }) as typeof fs.openSync)
    const logs: string[] = []
    const logSpy = spyOn(debug, 'logForDebugging').mockImplementation(msg => {
      logs.push(String(msg))
    })

    try {
      expect(() => getOAuthTokenFromFileDescriptor()).not.toThrow()
      expect(snapOpens).toBe(2)
      expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBe(snap)
      expect(fs.existsSync(snap)).toBe(true)
      expect(getOauthTokenFromFd()).not.toBe('busy-token')
      expect(isOauthTokenFromBgSnapshot()).toBe(false)
      expect(
        logs.some(line =>
          line.startsWith(
            'bg auth snapshot busy, will retry on the next read: ',
          ),
        ),
      ).toBe(true)
    } finally {
      openSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  test('busy snapshot read retries once and then consumes the token', () => {
    const snap = join(dir, 'retry.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'retried-token' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap
    let snapOpens = 0
    const original = fs.openSync
    const openSpy = spyOn(fs, 'openSync').mockImplementation(((
      path: fs.PathLike,
      flags: number | string,
    ) => {
      if (String(path) === snap) {
        snapOpens += 1
        if (snapOpens === 1) throwBusy()
      }
      return original(path, flags)
    }) as typeof fs.openSync)

    try {
      expect(getOAuthTokenFromFileDescriptor()).toBe('retried-token')
      expect(snapOpens).toBe(2)
      expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
      expect(isOauthTokenFromBgSnapshot()).toBe(true)
    } finally {
      openSpy.mockRestore()
    }
  })

  test('non-provider-managed symlink does not yield the target token', () => {
    const target = join(dir, 'target.json')
    const link = join(dir, 'link.json')
    fs.writeFileSync(
      target,
      JSON.stringify({ accessToken: 'symlink-target-token-289' }),
    )
    fs.symlinkSync(target, link)
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = link

    const token = getOAuthTokenFromFileDescriptor()

    expect(token).not.toBe('symlink-target-token-289')
    expect(getOauthTokenFromFd()).not.toBe('symlink-target-token-289')
    expect(isOauthTokenFromBgSnapshot()).toBe(false)
    expect(fs.existsSync(target)).toBe(true)
  })

  test('provider-managed "0" follows a snapshot symlink', async () => {
    const target = join(dir, 'target.json')
    const link = join(dir, 'link.json')
    fs.writeFileSync(
      target,
      JSON.stringify({
        accessToken: 'followed-token',
        scopes: ['user:inference'],
      }),
    )
    fs.symlinkSync(target, link)
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '0'
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = link

    expect(getOAuthTokenFromFileDescriptor()).toBe('followed-token')
    expect(getOauthTokenFromFd()).toBe('followed-token')
    expect(isOauthTokenFromBgSnapshot()).toBe(true)
    expect(getOauthScopesFromFd()).toEqual(['user:inference'])
    expect(fs.existsSync(target)).toBe(true)
    await waitUntilGone(link)
    expect(fs.existsSync(link)).toBe(false)
  })

  test('review-origin remote session skips oauth disk persistence', () => {
    const file = join(dir, 'oauth.txt')
    fs.writeFileSync(file, 'review-fd-token\n')
    const fd = fs.openSync(file, 'r')
    const logs: string[] = []
    const logSpy = spyOn(debug, 'logForDebugging').mockImplementation(msg => {
      logs.push(String(msg))
    })
    process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = String(fd)
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_REMOTE_SESSION_ORIGIN = 'review'
    const skip =
      'Skipping OAuth token disk persistence in review-origin session'

    try {
      expect(getOAuthTokenFromFileDescriptor()).toBe('review-fd-token')
      expect(logs).toContain(skip)
      expect(
        logs.some(line =>
          line.startsWith('Successfully read OAuth token from file descriptor'),
        ),
      ).toBe(true)
      expect(logs.some(line => line.startsWith('Persisted '))).toBe(false)
    } finally {
      logSpy.mockRestore()
      try {
        fs.closeSync(fd)
      } catch {
        // the inherited reader closes the fd itself
      }
    }
  })

  test('Het returns a snapshot gateway token and then the cached slot', async () => {
    const snap = join(dir, 'het.json')
    fs.writeFileSync(
      snap,
      JSON.stringify({
        gatewayToken: 'het-gateway',
        accessToken: 'het-oauth-should-not-apply',
      }),
    )
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap

    expect(readGatewayTokenFromDescriptor()).toBe('het-gateway')
    expect(getOauthTokenFromFd()).toBeUndefined()
    expect(isOauthTokenFromBgSnapshot()).toBe(false)
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()

    delete process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
    await waitUntilGone(snap)
    fs.rmSync(snap, { force: true })

    expect(readGatewayTokenFromDescriptor()).toBe('het-gateway')
    expect(getGatewayTokenFromDescriptor()).toBe('het-gateway')
    expect(getOauthTokenFromFd()).toBeUndefined()
  })

  test('async oauth reader does not consume the bg snapshot', async () => {
    const snap = join(dir, 'async.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'async-snap' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap

    const token = await readOAuthTokenFromFileDescriptor({
      readHandoffCredential: async () => ({
        state: 'present',
        contents: 'handoff-token\n',
      }),
    })

    expect(token).toBe('handoff-token')
    expect(getOauthTokenFromFd()).toBe('handoff-token')
    expect(isOauthTokenFromBgSnapshot()).toBe(false)
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBe(snap)
    expect(fs.existsSync(snap)).toBe(true)
  })

  test('api key reader does not consume the bg snapshot', () => {
    const snap = join(dir, 'api.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'api-snap' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap

    getApiKeyFromFileDescriptor()

    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBe(snap)
    expect(fs.existsSync(snap)).toBe(true)
    expect(getOauthTokenFromFd()).toBeUndefined()
    expect(isOauthTokenFromBgSnapshot()).toBe(false)
  })

  test('$n consumes a snapshot when bare mode and oauth env token are off', () => {
    const snap = join(dir, 'startup.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'startup-snap' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap

    consumeStartupCredentialDescriptors()

    expect(getOauthTokenFromFd()).toBe('startup-snap')
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
  })

  test('$n leaves a snapshot alone in bare mode without an oauth FD', () => {
    const snap = join(dir, 'bare.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'bare-snap' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap
    process.env.CLAUDE_CODE_SIMPLE = '1'

    consumeStartupCredentialDescriptors()

    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBe(snap)
    expect(getOauthTokenFromFd()).toBeUndefined()
    expect(fs.existsSync(snap)).toBe(true)
  })

  test('$n leaves a snapshot alone when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    const snap = join(dir, 'env-token.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'env-snap' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'already-set'

    consumeStartupCredentialDescriptors()

    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBe(snap)
    expect(getOauthTokenFromFd()).toBeUndefined()
  })

  test('$n skips every descriptor when the session is remote', () => {
    const snap = join(dir, 'remote.json')
    fs.writeFileSync(snap, JSON.stringify({ accessToken: 'remote-snap' }))
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snap
    process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR = '99'
    process.env.CLAUDE_CODE_REMOTE = '1'

    consumeStartupCredentialDescriptors()

    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBe(snap)
    expect(process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR).toBe('99')
    expect(getGatewayTokenFromDescriptor()).toBeUndefined()
  })

  test('$n reads a gateway descriptor and caches an empty miss', () => {
    process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR = '99'

    consumeStartupCredentialDescriptors()

    expect(
      process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR,
    ).toBeUndefined()
    expect(getGatewayTokenFromDescriptor()).toBeNull()
  })

  test('async FD persist uses writeHandoffCredential when /dev/fd is readable', async () => {
    const file = join(dir, 'async-fd.txt')
    fs.writeFileSync(file, 'async-fd-token\n')
    const fd = fs.openSync(file, 'r')
    process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = String(fd)
    process.env.CLAUDE_CODE_REMOTE = '1'
    let written: { path: string; token: string } | undefined

    try {
      const token = await readOAuthTokenFromFileDescriptor({
        writeHandoffCredential: async (path: string, value: string) => {
          written = { path, token: value }
          return { state: 'written' }
        },
      })
      expect(token).toBe('async-fd-token')
      expect(written).toEqual({
        path: CCR_OAUTH_TOKEN_PATH,
        token: 'async-fd-token',
      })
    } finally {
      try {
        fs.closeSync(fd)
      } catch {
        // inherited reader may already have closed it
      }
    }
  })
})
