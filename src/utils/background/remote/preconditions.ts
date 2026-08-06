import axios from 'axios'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getOrganizationUUID } from 'src/services/oauth/client.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../auth.js'
import { getCwd } from '../../cwd.js'
import { logForDebugging } from '../../debug.js'
import { detectCurrentRepository } from '../../detectRepository.js'
import { errorMessage } from '../../errors.js'
import { findGitRoot, getIsClean } from '../../git.js'
import { getOAuthHeaders } from '../../teleport/api.js'
import { fetchEnvironments } from '../../teleport/environments.js'

/**
 * Checks if user needs to log in with Claude.ai
 * Extracted from getTeleportErrors() in TeleportError.tsx
 * @returns true if login is required, false otherwise
 */
export async function checkNeedsClaudeAiLogin(): Promise<boolean> {
  if (!isClaudeAISubscriber()) {
    return false
  }
  return checkAndRefreshOAuthTokenIfNeeded()
}

/**
 * Checks if git working directory is clean (no uncommitted changes)
 * Ignores untracked files since they won't be lost during branch switching
 * Extracted from getTeleportErrors() in TeleportError.tsx
 * @returns true if git is clean, false otherwise
 */
export async function checkIsGitClean(): Promise<boolean> {
  const isClean = await getIsClean({ ignoreUntracked: true })
  return isClean
}

/**
 * Checks if user has access to at least one remote environment
 * @returns true if user has remote environments, false otherwise
 */
export async function checkHasRemoteEnvironment(): Promise<boolean> {
  try {
    const environments = await fetchEnvironments()
    return environments.length > 0
  } catch (error) {
    logForDebugging(`checkHasRemoteEnvironment failed: ${errorMessage(error)}`)
    return false
  }
}

/**
 * Checks if current directory is inside a git repository (has .git/).
 * Distinct from checkHasGitRemote — a local-only repo passes this but not that.
 */
export function checkIsInGitRepo(): boolean {
  return findGitRoot(getCwd()) !== null
}

/**
 * Checks if current repository has a GitHub remote configured.
 * Returns false for local-only repos (git init with no `origin`).
 */
export async function checkHasGitRemote(): Promise<boolean> {
  const repository = await detectCurrentRepository()
  return repository !== null
}

/**
 * densable FZt — GitHub App preflight with default_branch + transient flag.
 */
export type GithubAppPreflight = {
  appInstalled: boolean
  defaultBranch: string | null
  /** true when failure may be network/service (retry); false when deterministic */
  transient: boolean
}

/**
 * densable `FZt(owner, repo, signal)`.
 * Returns app install status, repo default_branch (when API returns it), and
 * whether a negative result is transient.
 */
export async function checkGithubAppPreflight(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<GithubAppPreflight> {
  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging(
        'checkGithubAppInstalled: No access token found, assuming app not installed',
      )
      return { appInstalled: false, defaultBranch: null, transient: false }
    }

    const orgUUID = await getOrganizationUUID()
    if (!orgUUID) {
      // densable ER() — has user:profile scope ⇒ missing org is possibly transient
      const profileScoped = hasProfileScope()
      logForDebugging(
        profileScoped
          ? 'checkGithubAppInstalled: No org UUID found (profile fetch null — possibly transient), assuming app not installed'
          : 'checkGithubAppInstalled: No org UUID found (token lacks user:profile scope — deterministic), assuming app not installed',
      )
      return {
        appInstalled: false,
        defaultBranch: null,
        transient: profileScoped,
      }
    }

    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/code/repos/${owner}/${repo}`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    logForDebugging(`Checking GitHub app installation for ${owner}/${repo}`)

    const response = await axios.get<{
      repo?: {
        name?: string
        owner?: { login?: string }
        default_branch?: string
      }
      status: {
        app_installed: boolean
        relay_enabled?: boolean
      } | null
    }>(url, {
      headers,
      timeout: 15000,
      signal,
      // densable: treat non-2xx via status check / catch, not throw-on-4xx alone
      validateStatus: s => s < 500,
    })

    if (response.status === 200) {
      const defaultBranch = response.data.repo?.default_branch || null
      if (response.data.status) {
        const installed = response.data.status.app_installed
        logForDebugging(
          `GitHub app ${installed ? 'is' : 'is not'} installed on ${owner}/${repo}`,
        )
        return {
          appInstalled: installed,
          defaultBranch,
          transient: false,
        }
      }
      logForDebugging(
        `GitHub app is not installed on ${owner}/${repo} (status is null)`,
      )
      return { appInstalled: false, defaultBranch, transient: false }
    }

    logForDebugging(
      `checkGithubAppInstalled: Unexpected response status ${response.status}`,
    )
    return { appInstalled: false, defaultBranch: null, transient: true }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const headers = error.response?.headers ?? {}
      const data = error.response?.data as
        | { error?: string; message?: string }
        | undefined
      const rateLimited =
        status === 403 &&
        (headers['x-ratelimit-remaining'] === '0' ||
          headers['retry-after'] !== undefined ||
          [data?.error, data?.message].some(
            v => typeof v === 'string' && /rate limit/i.test(v),
          ))
      // densable: deterministic "not installed" for most 4xx except
      // 401 / 408 / 429 / rate-limit 403
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429 &&
        status !== 401 &&
        !rateLimited
      ) {
        logForDebugging(
          `checkGithubAppInstalled: Got ${status} error, app likely not installed on ${owner}/${repo}`,
        )
        return { appInstalled: false, defaultBranch: null, transient: false }
      }
    }

    logForDebugging(`checkGithubAppInstalled error: ${errorMessage(error)}`)
    return { appInstalled: false, defaultBranch: null, transient: true }
  }
}

/**
 * densable `_0u` — boolean wrapper over FZt for callers that only need install.
 */
export async function checkGithubAppInstalled(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return (await checkGithubAppPreflight(owner, repo, signal)).appInstalled
}

/**
 * Checks if the user has synced their GitHub credentials via /web-setup
 * @returns true if GitHub token is synced, false otherwise
 */
export async function checkGithubTokenSynced(): Promise<boolean> {
  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging('checkGithubTokenSynced: No access token found')
      return false
    }

    const orgUUID = await getOrganizationUUID()
    if (!orgUUID) {
      logForDebugging('checkGithubTokenSynced: No org UUID found')
      return false
    }

    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/sync/github/auth`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    logForDebugging('Checking if GitHub token is synced via web-setup')

    const response = await axios.get(url, {
      headers,
      timeout: 15000,
    })

    const synced =
      response.status === 200 && response.data?.is_authenticated === true
    logForDebugging(
      `GitHub token synced: ${synced} (status=${response.status}, data=${JSON.stringify(response.data)})`,
    )
    return synced
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status && status >= 400 && status < 500) {
        logForDebugging(
          `checkGithubTokenSynced: Got ${status}, token not synced`,
        )
        return false
      }
    }

    logForDebugging(`checkGithubTokenSynced error: ${errorMessage(error)}`)
    return false
  }
}

type RepoAccessMethod = 'github-app' | 'token-sync' | 'none'

/**
 * Tiered check for whether a GitHub repo is accessible for remote operations.
 * 1. GitHub App installed on the repo
 * 2. GitHub token synced via /web-setup (gated by tengu_cobalt_lantern)
 * 3. Neither — caller should prompt user to set up access
 */
export async function checkRepoForRemoteAccess(
  owner: string,
  repo: string,
): Promise<{ hasAccess: boolean; method: RepoAccessMethod }> {
  if (await checkGithubAppInstalled(owner, repo)) {
    return { hasAccess: true, method: 'github-app' }
  }
  if (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_lantern', false) &&
    (await checkGithubTokenSynced())
  ) {
    return { hasAccess: true, method: 'token-sync' }
  }
  return { hasAccess: false, method: 'none' }
}
