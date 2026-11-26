import { execa } from 'execa'
import { getSessionId } from '../bootstrap/state.js'
import {
  getOauthAccountInfo,
  getRateLimitTier,
  getSubscriptionType,
} from './auth.js'
import { getGlobalConfig, getOrCreateUserID } from './config.js'
import { getCwd } from './cwd.js'
import { type env, getHostPlatformForAnalytics } from './env.js'
import { isEnvTruthy } from './envUtils.js'
import { RootSessionSlot } from './hostSlot.js'
import { getBootstrapSession } from './sessionRoot.js'

type SessionMemoized<Args extends unknown[], Result> = ((
  ...args: Args
) => Result) & {
  cache: Map<unknown, Result>
}

function memoizePerRootSession<Args extends unknown[], Result, Key = Args[0]>(
  fn: (...args: Args) => Result,
  resolver?: (...args: Args) => Key,
): SessionMemoized<Args, Result> {
  const slot = new RootSessionSlot<{ cache: Map<unknown, Result> }>(() => ({
    cache: new Map<unknown, Result>(),
  }))
  const memoized = (...args: Args): Result => {
    const key = resolver ? resolver(...args) : args[0]
    const cache = slot.of(getBootstrapSession()).cache
    if (cache.has(key)) {
      return cache.get(key) as Result
    }
    const result = fn(...args)
    cache.set(key, result)
    return result
  }
  Object.defineProperty(memoized, 'cache', {
    get: () => slot.of(getBootstrapSession()).cache,
    set: (next: Map<unknown, Result>) => {
      slot.of(getBootstrapSession()).cache = next
    },
    configurable: true,
    enumerable: true,
  })
  return memoized as unknown as SessionMemoized<Args, Result>
}

type UserSessionState = {
  // null means not fetched yet
  cachedEmail: string | undefined | null
  emailFetchPromise: Promise<string | undefined> | null
}

const userSessionSlot = new RootSessionSlot<UserSessionState>(() => ({
  cachedEmail: null,
  emailFetchPromise: null,
}))

function getUserSessionState(): UserSessionState {
  return userSessionSlot.of(getBootstrapSession())
}

/**
 * GitHub Actions metadata when running in CI
 */
export type GitHubActionsMetadata = {
  actor?: string
  actorId?: string
  repository?: string
  repositoryId?: string
  repositoryOwner?: string
  repositoryOwnerId?: string
}

/**
 * Core user data used as base for all analytics providers.
 * This is also the format used by GrowthBook.
 */
export type CoreUserData = {
  deviceId: string
  sessionId: string
  email?: string
  appVersion: string
  platform: typeof env.platform
  organizationUuid?: string
  accountUuid?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  githubActionsMetadata?: GitHubActionsMetadata
}

/**
 * Initialize user data asynchronously. Should be called early in startup.
 * This pre-fetches the email so getUser() can remain synchronous.
 */
export async function initUser(): Promise<void> {
  const state = getUserSessionState()
  if (state.cachedEmail === null && !state.emailFetchPromise) {
    const fetchPromise = getEmailAsync()
    state.emailFetchPromise = fetchPromise
    try {
      const email = await fetchPromise
      if (state.emailFetchPromise === fetchPromise) {
        state.cachedEmail = email
        state.emailFetchPromise = null
        // Clear memoization cache so next call picks up the email
        getCoreUserData.cache.clear?.()
      }
    } catch (err) {
      if (state.emailFetchPromise === fetchPromise) {
        state.emailFetchPromise = null
      }
      throw err
    }
  } else if (state.emailFetchPromise) {
    await state.emailFetchPromise
  }
}

/**
 * Reset all user data caches. Call on auth changes (login/logout/account switch)
 * so the next getCoreUserData() call picks up fresh credentials and email.
 */
export function resetUserCache(): void {
  const state = getUserSessionState()
  state.cachedEmail = null
  state.emailFetchPromise = null
  getCoreUserData.cache.clear?.()
  getGitEmail.cache.clear?.()
}

/**
 * Get core user data.
 * This is the base representation that gets transformed for different analytics providers.
 */
export const getCoreUserData = memoizePerRootSession(
  (includeAnalyticsMetadata?: boolean): CoreUserData => {
    const deviceId = getOrCreateUserID()
    const config = getGlobalConfig()

    let subscriptionType: string | undefined
    let rateLimitTier: string | undefined
    let firstTokenTime: number | undefined
    if (includeAnalyticsMetadata) {
      subscriptionType = getSubscriptionType() ?? undefined
      rateLimitTier = getRateLimitTier() ?? undefined
      if (subscriptionType && config.claudeCodeFirstTokenDate) {
        const configFirstTokenTime = new Date(
          config.claudeCodeFirstTokenDate,
        ).getTime()
        if (!isNaN(configFirstTokenTime)) {
          firstTokenTime = configFirstTokenTime
        }
      }
    }

    // Only include OAuth account data when actively using OAuth authentication
    const oauthAccount = getOauthAccountInfo()
    const organizationUuid = oauthAccount?.organizationUuid
    const accountUuid = oauthAccount?.accountUuid

    return {
      deviceId,
      sessionId: getSessionId(),
      email: getEmail(),
      appVersion: typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.0',
      platform: getHostPlatformForAnalytics(),
      organizationUuid,
      accountUuid,
      userType: process.env.USER_TYPE,
      subscriptionType,
      rateLimitTier,
      firstTokenTime,
      ...(isEnvTruthy(process.env.GITHUB_ACTIONS) && {
        githubActionsMetadata: {
          actor: process.env.GITHUB_ACTOR,
          actorId: process.env.GITHUB_ACTOR_ID,
          repository: process.env.GITHUB_REPOSITORY,
          repositoryId: process.env.GITHUB_REPOSITORY_ID,
          repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
          repositoryOwnerId: process.env.GITHUB_REPOSITORY_OWNER_ID,
        },
      }),
    }
  },
  (includeAnalyticsMetadata?: boolean) =>
    `${String(includeAnalyticsMetadata)}::${getSessionId()}`,
)

/**
 * Get user data for GrowthBook (same as core data with analytics metadata).
 */
export function getUserForGrowthBook(): CoreUserData {
  return getCoreUserData(true)
}

function getEmail(): string | undefined {
  const { cachedEmail } = getUserSessionState()
  // Return cached email if available (from async initialization)
  if (cachedEmail !== null) {
    return cachedEmail
  }

  // Only include OAuth email when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount?.emailAddress) {
    return oauthAccount.emailAddress
  }

  // Ant-only fallbacks below (no execSync)
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }

  if (process.env.COO_CREATOR) {
    return `${process.env.COO_CREATOR}@anthropic.com`
  }

  // If initUser() wasn't called, we return undefined instead of blocking
  return undefined
}

async function getEmailAsync(): Promise<string | undefined> {
  // Only include OAuth email when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount?.emailAddress) {
    return oauthAccount.emailAddress
  }

  // Ant-only fallbacks below
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }

  if (process.env.COO_CREATOR) {
    return `${process.env.COO_CREATOR}@anthropic.com`
  }

  return getGitEmail()
}

/**
 * Get the user's git email from `git config user.email`.
 * Memoized per root session and cwd so concurrent multi-host sessions never
 * leak repository-local git email across hosts.
 */
export const getGitEmail = memoizePerRootSession(
  async (): Promise<string | undefined> => {
    const result = await execa('git config --get user.email', {
      shell: true,
      reject: false,
      cwd: getCwd(),
    })
    return result.exitCode === 0 && result.stdout
      ? result.stdout.trim()
      : undefined
  },
  () => getCwd(),
)
