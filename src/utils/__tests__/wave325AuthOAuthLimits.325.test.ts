import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import type { ServerResponse } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ALL_OAUTH_SCOPES,
  PRIVACY_CONSENTS_WRITE_SCOPE,
} from '../../constants/oauth.js'
import {
  AuthCodeListener,
  OAUTH_ERROR_REDIRECT_BODY,
} from '../../services/oauth/auth-code-listener.js'
import {
  getRateLimitErrorMessage,
  getUsageCreditsAskAdminHint,
  type RateLimitMessageLimits,
} from '../../services/rateLimitMessages.js'
import {
  cleanupStaleOAuthRefreshLockTmpFiles,
  ensureHomeEnvForCloudCredentials,
} from '../auth.js'
import { formatModelRestrictionOrCheckError } from '../model/validateModel.js'
import {
  clearWifCredentialRaceStateForTests,
  declareNoWifTokenRenewal,
  isWifTokenRenewalAllowed,
  readValidCachedWifToken,
  releaseAllHeldWifLocks,
  setWifCredentialsLockForTests,
  wrapWifCredentialsLock,
} from '../wifCredentialRace.js'

const savedRemote = process.env.CLAUDE_CODE_REMOTE
const savedBridge = process.env.CLAUDE_CODE_BRIDGE_MODE

afterEach(() => {
  clearWifCredentialRaceStateForTests()
  if (savedRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
  else process.env.CLAUDE_CODE_REMOTE = savedRemote
  if (savedBridge === undefined) delete process.env.CLAUDE_CODE_BRIDGE_MODE
  else process.env.CLAUDE_CODE_BRIDGE_MODE = savedBridge
})

describe('Wave 325 Group 2 — Auth / OAuth / WIF / RateLimit', () => {
  test('#2284: cleanupStaleOAuthRefreshLockTmpFiles removes stale .oauth_refresh.lock.owner.tmp.* files only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-325-locktmp-'))
    try {
      const stale = join(dir, '.oauth_refresh.lock.owner.tmp.abcd1234')
      const fresh = join(dir, '.oauth_refresh.lock.owner.tmp.fresh999')
      const unrelated = join(dir, 'settings.json')
      writeFileSync(stale, '{}')
      writeFileSync(fresh, '{}')
      writeFileSync(unrelated, '{}')
      const oldDate = new Date(Date.now() - 120_000)
      utimesSync(stale, oldDate, oldDate)

      const removed = await cleanupStaleOAuthRefreshLockTmpFiles(dir, 60_000)
      expect(removed).toBe(1)
      const remaining = readdirSync(dir)
      expect(remaining).not.toContain('.oauth_refresh.lock.owner.tmp.abcd1234')
      expect(remaining).toContain('.oauth_refresh.lock.owner.tmp.fresh999')
      expect(remaining).toContain('settings.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2286: formatModelRestrictionOrCheckError distinguishes network check failure from org restriction', () => {
    const offline = formatModelRestrictionOrCheckError('claude-opus-4-7', {
      valid: false,
      checkFailed: true,
      error:
        "Could not check whether model 'claude-opus-4-7' is available — check your network connection and try again.",
    })
    expect(offline.code).toBe('check_failed')
    expect(offline.message).toContain('check your network connection')
    expect(offline.message).not.toContain('organization restricts')

    const org = formatModelRestrictionOrCheckError('claude-opus-4-7')
    expect(org.code).toBe('restricted_by_org')
    expect(org.message).toContain('Your organization restricts model selection')
  })

  test('#2287: ConsoleOAuthFlow guards installOAuthTokens with shouldCommitOAuthResult(attemptController.signal) and aborts on unmount', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../components/ConsoleOAuthFlow.tsx'),
      'utf8',
    )
    expect(src).toContain('export function shouldCommitOAuthResult(')
    expect(src).toContain(
      'if (!shouldCommitOAuthResult(attemptController.signal))',
    )
    expect(src).toContain('oauthAttemptAbortRef.current?.abort()')
    const installIdx = src.indexOf('await installOAuthTokens(')
    const guardIdx = src.indexOf(
      'if (!shouldCommitOAuthResult(attemptController.signal))',
    )
    expect(guardIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(installIdx)
  })

  test('#2285: fastMode keyless Console sign-in uses reason unknown instead of preference', () => {
    const src = readFileSync(join(import.meta.dir, '../fastMode.ts'), 'utf8')
    expect(src).toContain('const isKeylessConsole = isProfileAuthActive()')
    expect(src).toContain("reason: isKeylessConsole ? 'unknown' : 'preference'")
  })

  test('#2288: AuthCodeListener.handleErrorRedirect serves plain text 200 instead of 302 success redirect', () => {
    const listener = new AuthCodeListener('/callback')
    let statusCode: number | undefined
    let headers: Record<string, string> | undefined
    let body: string | undefined
    const fakeRes = {
      writeHead(code: number, hdrs: Record<string, string>) {
        statusCode = code
        headers = hdrs
      },
      end(chunk?: string) {
        body = chunk
      },
    } as unknown as ServerResponse
    ;(
      listener as unknown as { pendingResponse: ServerResponse | null }
    ).pendingResponse = fakeRes

    listener.handleErrorRedirect()
    expect(statusCode).toBe(200)
    expect(headers?.['Content-Type']).toBe('text/plain; charset=utf-8')
    expect(body).toBe(OAUTH_ERROR_REDIRECT_BODY)
    expect(listener.hasPendingResponse()).toBe(false)
  })

  test('#2343: wrapWifCredentialsLock reads valid cached token without acquiring the lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-325-wif-'))
    try {
      const credPath = join(dir, 'credentials.json')
      const futureExp = Math.floor(Date.now() / 1000) + 3600
      writeFileSync(
        credPath,
        JSON.stringify({ access_token: 'tok-cached', expires_at: futureExp }),
      )

      let lockCalled = false
      let innerCalled = false
      setWifCredentialsLockForTests({
        lock: async () => {
          lockCalled = true
          return async () => {}
        },
      })

      const cached = await readValidCachedWifToken(credPath)
      expect(cached).toEqual({ token: 'tok-cached', expiresAt: futureExp })

      const wrapped = wrapWifCredentialsLock(
        async () => {
          innerCalled = true
          return { token: 'tok-refreshed', expiresAt: futureExp + 3600 }
        },
        credPath,
        'fail-closed',
      )

      const tok = await wrapped()
      expect(tok.token).toBe('tok-cached')
      expect(lockCalled).toBe(false)
      expect(innerCalled).toBe(false)

      // forceRefresh bypasses lockless read and acquires the lock
      const forced = await wrapped({ forceRefresh: true })
      expect(forced.token).toBe('tok-refreshed')
      expect(lockCalled).toBe(true)
      expect(innerCalled).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2289: declareNoWifTokenRenewal prevents lock acquisition and releaseAllHeldWifLocks releases active locks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-325-wif-short-'))
    try {
      const credPath = join(dir, 'credentials.json')
      writeFileSync(
        credPath,
        JSON.stringify({ access_token: 'expired', expires_at: 1 }),
      )

      declareNoWifTokenRenewal()
      expect(isWifTokenRenewalAllowed()).toBe(false)
      let lockCalled = false
      setWifCredentialsLockForTests({
        lock: async () => {
          lockCalled = true
          return async () => {}
        },
      })
      const wrapped = wrapWifCredentialsLock(
        async () => ({ token: 'new', expiresAt: null }),
        credPath,
        'fail-closed',
      )
      await expect(wrapped()).rejects.toThrow('This command does not renew it')
      expect(lockCalled).toBe(false)

      // Active held lock is released by releaseAllHeldWifLocks()
      clearWifCredentialRaceStateForTests()
      let releasedCount = 0
      let resolveInner!: () => void
      const innerDone = new Promise<void>(r => {
        resolveInner = r
      })
      setWifCredentialsLockForTests({
        lock: async () => async () => {
          releasedCount++
        },
      })
      const wrapped2 = wrapWifCredentialsLock(
        async () => {
          await innerDone
          return { token: 'new', expiresAt: null }
        },
        credPath,
        'fail-closed',
      )
      const pending = wrapped2({ forceRefresh: true })
      await new Promise(r => setTimeout(r, 10))
      await releaseAllHeldWifLocks()
      expect(releasedCount).toBe(1)
      resolveInner()
      await pending
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2294: ensureHomeEnvForCloudCredentials restores missing HOME from homedir on POSIX', () => {
    const env: NodeJS.ProcessEnv = {}
    const resolved = ensureHomeEnvForCloudCredentials(
      env,
      'linux',
      () => '/home/service-user',
    )
    expect(resolved).toBe('/home/service-user')
    expect(env.HOME).toBe('/home/service-user')

    const existingEnv: NodeJS.ProcessEnv = { HOME: '/custom/home' }
    expect(
      ensureHomeEnvForCloudCredentials(existingEnv, 'darwin', () => '/ignored'),
    ).toBe('/custom/home')
  })

  test('#2369: ALL_OAUTH_SCOPES includes user:privacy_consents:write', () => {
    expect(PRIVACY_CONSENTS_WRITE_SCOPE).toBe('user:privacy_consents:write')
    expect(ALL_OAUTH_SCOPES).toContain('user:privacy_consents:write')
  })

  test('#2382: cloud / Remote Control omits "ask your admin" from spend limit and shared budget errors', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(getUsageCreditsAskAdminHint()).toBe('')
    const sharedBudgetErr = getRateLimitErrorMessage(
      {
        status: 'rejected',
        overageScope: 'group_pool',
        overageStatus: 'rejected',
        isUsingOverage: false,
      } as RateLimitMessageLimits,
      'claude-sonnet-4-6',
    )
    expect(sharedBudgetErr).toContain("team's shared budget")
    expect(sharedBudgetErr).not.toContain('ask your admin')
  })
})
