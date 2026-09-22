/**
 * densable 2.1.248 #43 — local /ultrareview <PR#> GitHub access precheck.
 *
 * SEA: k @183083641 · TUn @184607964 · oae @183081248 · be @193401353
 * Gate: Mo(host) && TUn() && !Tt(). Cloud launch host is N/A — do not invent.
 */

import axios from 'axios'
import { z } from 'zod'
import { getOauthConfig } from '../../constants/oauth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getOrganizationUUID } from '../../services/oauth/client.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  hasProfileScope,
} from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getOAuthHeaders } from '../../utils/teleport/api.js'

/** densable `use` @184605912 */
export const GITHUB_APP_INSTALLATIONS_NEW_URL =
  'https://github.com/apps/claude/installations/new'

export type LinkedGithubAccountAccess =
  | 'ok'
  | 'inconclusive'
  | 'github_not_connected'
  | 'github_repo_not_found'

export type GithubAccessProbeResult = {
  verdict: LinkedGithubAccountAccess
  httpStatus: number | null
}

export type GithubAppLinkedPreflight = {
  appInstalled: boolean
  defaultBranch: string | null
  transient: boolean
  linkedAccountAccess: LinkedGithubAccountAccess
  httpStatus: number | null
}

/**
 * densable g — lazy zod for k() error.details.
 * `m({error:m({details:m({error_code:i().optional(),type:i().optional()})})})`
 */
const linkedGithubAccessErrorSchema = z.object({
  error: z.object({
    details: z.object({
      error_code: z.string().optional(),
      type: z.string().optional(),
    }),
  }),
})

/**
 * densable k(e,t) @183083641.
 * 401 + auth_required + type github → github_not_connected
 * 404 + github_resource_not_found → github_repo_not_found
 * else inconclusive
 */
export function mapLinkedGithubAccessHttpError(
  status: number | undefined,
  body: unknown,
): LinkedGithubAccountAccess {
  if (status !== 401 && status !== 404) return 'inconclusive'
  const parsed = linkedGithubAccessErrorSchema.safeParse(body)
  const details = parsed.success ? parsed.data.error.details : undefined
  if (
    status === 401 &&
    details?.error_code === 'auth_required' &&
    details.type === 'github'
  ) {
    return 'github_not_connected'
  }
  if (status === 404 && details?.error_code === 'github_resource_not_found') {
    return 'github_repo_not_found'
  }
  return 'inconclusive'
}

function bughunterConfig(
  config?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (config !== undefined) return config
  return getFeatureValue_CACHED_MAY_BE_STALE<Record<string, unknown> | null>(
    'tengu_review_bughunter_config',
    null,
  )
}

/**
 * densable TUn ← dse()?.github_access_precheck_enabled !== false
 * dse leftover = getFeatureValue_CACHED_MAY_BE_STALE('tengu_review_bughunter_config', null)
 * Same GB helper as leftover Wau / isEmptyTreeFallbackEnabled / isHarborKiteEnabled.
 * Default ON unless GrowthBook is explicitly false.
 */
export function isGithubAccessPrecheckEnabled(
  config?: Record<string, unknown> | null,
): boolean {
  return bughunterConfig(config)?.github_access_precheck_enabled !== false
}

/**
 * gold _d() @179726987 — leftover isDesktopLikeEntrypoint / WW.
 * `e!==void 0 && r.has(e)` with r = claude-desktop | claude-desktop-3p | local-agent.
 */
function isDesktopLikeEntrypointGold(
  entrypoint: string | undefined = process.env.CLAUDE_CODE_ENTRYPOINT,
): boolean {
  return (
    entrypoint !== undefined &&
    (entrypoint === 'claude-desktop' ||
      entrypoint === 'claude-desktop-3p' ||
      entrypoint === 'local-agent')
  )
}

/**
 * gold: Mo(u.host) && TUn() && !Tt()
 * Mo leftover = isGithubComHost (pass leftover; do not invent a second host check)
 * Tt leftover = isEssentialTrafficOnly (x()==="essential-traffic")
 */
export function shouldProbeGithubAccess(
  host: string,
  isGithubCom: (h: string) => boolean,
  config?: Record<string, unknown> | null,
): boolean {
  return (
    isGithubCom(host) &&
    isGithubAccessPrecheckEnabled(config) &&
    !isEssentialTrafficOnly()
  )
}

/** densable Vt().CLAUDE_AI_ORIGIN + /code/onboarding?step=alt-auth */
export function linkedGithubOnboardingUrl(): string {
  return `${getOauthConfig().CLAUDE_AI_ORIGIN}/code/onboarding?step=alt-auth`
}

/**
 * gold x — /web-setup hint.
 * `!_d()&&!Tt()&&Rt("allow_remote_sessions")&&Rt("allow_quick_web_setup")`
 */
export function webSetupReuseHint(invocation: string): string {
  if (
    !isDesktopLikeEntrypointGold() &&
    !isEssentialTrafficOnly() &&
    isPolicyAllowed('allow_remote_sessions') &&
    isPolicyAllowed('allow_quick_web_setup')
  ) {
    return `run /web-setup${invocation.startsWith('/') ? '' : ' in Claude Code'} to reuse your GitHub CLI login`
  }
  return ''
}

/**
 * gold se — official refuse copy. Do not paraphrase.
 */
export function formatGithubAccessPrecheckError(input: {
  verdict: 'github_not_connected' | 'github_repo_not_found'
  owner: string
  name: string
  invocation: string
  prArg: string
  ghPrViewCode: number
  webSetupHint?: string
  onboardingUrl?: string
  installAppUrl?: string
}): string {
  const repo = `${input.owner}/${input.name}`
  const onboarding = input.onboardingUrl ?? linkedGithubOnboardingUrl()
  const webSetup = input.webSetupHint ?? webSetupReuseHint(input.invocation)
  const rerun = `then re-run ${input.invocation} ${input.prArg}`
  const installUrl = input.installAppUrl ?? GITHUB_APP_INSTALLATIONS_NEW_URL
  const install = `install the app at ${installUrl}`
  const fixRepo =
    webSetup && input.ghPrViewCode === 0
      ? `${webSetup}, or ${install}`
      : `${install}${webSetup ? `, or ${webSetup}` : ''}`
  if (input.verdict === 'github_not_connected') {
    return `Ultrareview clones ${repo} in the cloud with the GitHub account connected to your Claude account, and none is connected (or the connection expired). To fix: ${webSetup ? `${webSetup}, or connect` : 'connect'} an account at ${onboarding} \u2014 ${rerun} (allow a minute after connecting).`
  }
  return `Your connected GitHub account can't see ${repo} \u2014 usually the Claude GitHub app isn't installed on ${input.owner} or wasn't granted this repo (web-connected accounts need it for private repos), or a different GitHub account is connected. To fix: ${fixRepo} \u2014 ${rerun}.`
}

/**
 * densable oae — leftover FZt plus linkedAccountAccess / httpStatus.
 * Reuses leftover org UUID / BASE_API_URL / axios / OAuth headers.
 * Default axios validateStatus (4xx throw) so k() sees 401/404.
 */
export async function checkGithubAppInstalledLinkedAccess(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<GithubAppLinkedPreflight> {
  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging(
        'checkGithubAppInstalled: No access token found, assuming app not installed',
      )
      return {
        appInstalled: false,
        defaultBranch: null,
        transient: false,
        linkedAccountAccess: 'inconclusive',
        httpStatus: null,
      }
    }

    const orgUUID = await getOrganizationUUID()
    if (!orgUUID) {
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
        linkedAccountAccess: 'inconclusive',
        httpStatus: null,
      }
    }

    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/code/repos/${owner}/${repo}`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    logForDebugging(`Checking GitHub app installation for ${owner}/${repo}`)

    const response = await axios.get<{
      repo?: { default_branch?: string }
      status: { app_installed: boolean } | null
    }>(url, {
      headers,
      timeout: 15000,
      signal,
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
          linkedAccountAccess: 'ok',
          httpStatus: response.status,
        }
      }
      logForDebugging(
        `GitHub app is not installed on ${owner}/${repo} (status is null)`,
      )
      return {
        appInstalled: false,
        defaultBranch,
        transient: false,
        linkedAccountAccess: 'ok',
        httpStatus: response.status,
      }
    }

    logForDebugging(
      `checkGithubAppInstalled: Unexpected response status ${response.status}`,
    )
    return {
      appInstalled: false,
      defaultBranch: null,
      transient: true,
      linkedAccountAccess: 'inconclusive',
      httpStatus: response.status,
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const headers = error.response?.headers ?? {}
      const data = error.response?.data as
        | { error?: string; message?: string }
        | undefined
      const linkedAccountAccess = mapLinkedGithubAccessHttpError(
        status,
        error.response?.data,
      )
      const rateLimited =
        status === 403 &&
        (headers['x-ratelimit-remaining'] === '0' ||
          headers['retry-after'] !== undefined ||
          [data?.error, data?.message].some(
            v => typeof v === 'string' && /rate limit/i.test(v),
          ))
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
          `checkGithubAppInstalled: Got ${status} error, app likely not installed on ${owner}/${repo} (linked-account access: ${linkedAccountAccess})`,
        )
        return {
          appInstalled: false,
          defaultBranch: null,
          transient: false,
          linkedAccountAccess,
          httpStatus: status,
        }
      }
      logForDebugging(`checkGithubAppInstalled error: ${errorMessage(error)}`)
      return {
        appInstalled: false,
        defaultBranch: null,
        transient: true,
        linkedAccountAccess,
        httpStatus: status ?? null,
      }
    }

    logForDebugging(`checkGithubAppInstalled error: ${errorMessage(error)}`)
    return {
      appInstalled: false,
      defaultBranch: null,
      transient: true,
      linkedAccountAccess: 'inconclusive',
      httpStatus: null,
    }
  }
}

/**
 * densable be(r,t,d) — budgeted oae probe.
 * `await es()` leftover = checkAndRefreshOAuthTokenIfNeeded.
 */
export async function probeLinkedGithubAccountAccess(
  owner: string,
  repo: string,
  budgetMs: number = 5000,
): Promise<GithubAccessProbeResult> {
  const inconclusive: GithubAccessProbeResult = {
    verdict: 'inconclusive',
    httpStatus: null,
  }
  const timeoutMs =
    Number.isSafeInteger(budgetMs) && budgetMs > 0 ? budgetMs : 0
  const signal = AbortSignal.timeout(timeoutMs)
  const onAbort = new Promise<GithubAccessProbeResult>(resolve => {
    signal.addEventListener('abort', () => resolve(inconclusive), {
      once: true,
    })
  })
  const probe = (async () => {
    await checkAndRefreshOAuthTokenIfNeeded()
    const { linkedAccountAccess, httpStatus } =
      await checkGithubAppInstalledLinkedAccess(owner, repo, signal)
    return { verdict: linkedAccountAccess, httpStatus }
  })().catch(error => {
    logForDebugging(
      `ultrareview: linked-account access probe failed, treating as inconclusive: ${errorMessage(error)}`,
    )
    return inconclusive
  })
  return Promise.race([probe, onAbort])
}
