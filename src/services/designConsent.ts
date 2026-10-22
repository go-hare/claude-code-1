/**
 * densable 2.1.289 design consent POST/DELETE (`LAe` / `ewo`).
 * Consent bit: `agent_design_projects`.
 */
import axios from 'axios'
import { getOauthConfig } from '../constants/oauth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
} from '../utils/auth.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js'
import { isHoverRestOn } from '../utils/storageV5/hoverRestPin.js'
import { getOAuthHeaders } from '../utils/teleport/api.js'
import type { DesignSessionState } from './designProjectGrant.js'

export const DESIGN_CONSENT_BIT = 'agent_design_projects' as const

/** Gold `DAe` consent prompt. */
export function getDesignConsentPrompt(
  bit: typeof DESIGN_CONSENT_BIT = DESIGN_CONSENT_BIT,
): string {
  switch (bit) {
    case 'agent_design_projects':
      return 'Connect to Claude Design? Claude can read and edit your Design projects from this tool. Change anytime at claude.ai/design/settings or with /design revoke.'
  }
}

/** densable se — the approval card can reach a person in this mode. */
export function designAskCanReachUser(context: {
  options?: { isNonInteractiveSession?: boolean }
  getAppState?: () => {
    toolPermissionContext?: {
      mode?: string
      isBypassPermissionsModeAvailable?: boolean
    }
  }
}): boolean {
  if (context.options?.isNonInteractiveSession === true) return false
  let mode: string | undefined
  let bypassAvailable = false
  try {
    const perms = context.getAppState?.().toolPermissionContext
    mode = perms?.mode
    bypassAvailable = perms?.isBypassPermissionsModeAvailable === true
  } catch {
    return false
  }
  if (context.getAppState === undefined) return false
  if (mode === 'bypassPermissions') return false
  if (mode === 'plan' && bypassAvailable) return false
  return true
}

/**
 * densable call() 403 intercept. POST only when this approval showed the
 * same consent bit and a person can still answer.
 */
export function designConsentRetryAction(input: {
  shown: string | null
  askCanReachUser: boolean
  bodyConsent: string | null
}): 'post_and_retry' | 'not_shown' | 'no_prompt' | 'ignore' {
  if (input.bodyConsent !== DESIGN_CONSENT_BIT) return 'ignore'
  if (input.bodyConsent !== input.shown) return 'not_shown'
  if (!input.askCanReachUser) return 'no_prompt'
  return 'post_and_retry'
}

export function designConsentNotShownMessage(): string {
  return `${getDesignConsentPrompt()} The user hasn't granted this yet — ask them to retry (the prompt will show on the next call) or run /design consent.`
}

export function designConsentNoPromptMessage(): string {
  return `${getDesignConsentPrompt()} The user hasn't granted this — run /design consent to grant it (it can't be approved automatically in this permission mode).`
}

/** Gold `fe` — extra line on a finalize_plan approval. */
export const DESIGN_FINALIZE_PLAN_ASK =
  'Approving also lets writes and deletes to exactly these paths run without another prompt for up to 15 minutes (file contents are not shown again; anything to any other path will still ask).'

export const DESIGN_CONSENT_DECISION_REASON =
  'design agent consent — approving records a server-side grant for Claude agents to read and write your design projects'

/**
 * Test seam. Gold's cache lives on the tool state (`e.consentCache`).
 * `null` means "do not override". A set value is copied onto each state
 * the next time `$Pt` reads it, so two tool states do not share one cache.
 */
let consentSeed: boolean | Record<string, boolean> | null = null
let consentSeedEpoch = 0
const consentSeedApplied = new WeakMap<DesignSessionState, number>()

export function seedDesignConsentCache(
  value: boolean | Record<string, boolean> | null,
): void {
  consentSeedEpoch += 1
  consentSeed = value
}

function applyConsentSeed(state: DesignSessionState): void {
  if (consentSeed === null) return
  if (consentSeedApplied.get(state) === consentSeedEpoch) return
  state.consentFetch = null
  state.consentCacheGeneration += 1
  state.consentCache =
    typeof consentSeed === 'boolean'
      ? { [DESIGN_CONSENT_BIT]: consentSeed }
      : { ...consentSeed }
  consentSeedApplied.set(state, consentSeedEpoch)
}

async function fetchDesignConsent(
  credentials?: unknown,
): Promise<Record<string, boolean>> {
  try {
    const response = await axios.get(consentUrl(), {
      ...(await designRequestAuth(credentials)),
      timeout: 15000,
      validateStatus: status => status < 500,
    })
    if (response.status !== 200 || response.data == null) return {}
    const body = response.data as Record<string, unknown>
    const bit = body[DESIGN_CONSENT_BIT]
    return typeof bit === 'boolean' ? { [DESIGN_CONSENT_BIT]: bit } : {}
  } catch {
    return {}
  }
}

async function writeFetchedConsentBit(
  state: DesignSessionState,
  bit: string,
  value: boolean,
): Promise<void> {
  const { writeDesignConsentBit } = await import('./designProjectGrant.js')
  writeDesignConsentBit(state, bit, value)
}

/**
 * densable $Pt — the consent bit to ask for, or null when this call must
 * not prompt (already granted, non-first-party, essential-traffic, or the
 * preflight did not say false). A fetched `false` goes through `ene`.
 */
export async function missingDesignConsentBit(
  state: DesignSessionState,
  credentials?: unknown,
): Promise<typeof DESIGN_CONSENT_BIT | null> {
  if (getAPIProvider() !== 'firstParty' || isEssentialTrafficOnly()) {
    return null
  }
  applyConsentSeed(state)
  if (consentSeed !== null) {
    return state.consentCache?.[DESIGN_CONSENT_BIT] === false
      ? DESIGN_CONSENT_BIT
      : null
  }
  if (state.consentCache === null) {
    const generation = state.consentCacheGeneration
    const pending = (state.consentFetch ??= fetchDesignConsent(credentials))
    const data = await pending
    if (
      state.consentCache === null &&
      state.consentCacheGeneration === generation
    ) {
      state.consentCache = {}
      for (const bit of [DESIGN_CONSENT_BIT]) {
        const value = data[bit]
        if (typeof value === 'boolean') {
          await writeFetchedConsentBit(state, bit, value)
        }
      }
    }
    if (state.consentFetch === pending) state.consentFetch = null
  }
  return state.consentCache?.[DESIGN_CONSENT_BIT] === false
    ? DESIGN_CONSENT_BIT
    : null
}

export function designProjectGrantNotShownMessage(input: {
  operation: string
  nonInteractive: boolean
}): string {
  if (
    input.operation === 'write_files' ||
    input.operation === 'create_support_js'
  ) {
    if (input.nonInteractive) {
      return 'Writing to this project needs a project write grant that is not currently active (it may have been revoked) — use finalize_plan with writes (and deletes if needed), then pass the returned plan_token. A durable project write grant can be approved from an interactive Claude Code session.'
    }
    return 'Writing to this project needs a one-time approval — retry the write: you will be shown the approval, or routed to the per-batch finalize_plan flow.'
  }
  return 'This operation needs a plan_token here — use finalize_plan (listing the destination paths in writes) and pass the returned plan_token. (It can run without one only under an existing project write grant, set up by a write_files to this project.)'
}

export function designProjectGrantNoPromptMessage(): string {
  return 'Writing to this project needs a one-time approval, which cannot be granted automatically in this permission mode — use finalize_plan with writes/deletes and pass the returned plan_token.'
}

export function designProjectGrantAuthMessage(): string {
  return "This session's credential cannot record the project approval — approve this project from an interactive Claude Code session (run the write there and accept the approval card), then retry here: this session picks the recorded approval up from the server."
}

function consentUrl(): string {
  return `${getOauthConfig().BASE_API_URL}/v1/design/consent`
}

type DesignLoginTokens = {
  accessToken?: string | null
  refreshToken?: string | null
  scopes?: string[] | null
}

/**
 * densable `f` / `c(e)` login half. `F()` is `isHoverRestOn`. When it is
 * pinned and credentials are defined, `il(credentials)` reads the handle.
 * Otherwise the token is the global `mn()` reader.
 */
async function designLoginTokens(
  credentials?: unknown,
): Promise<DesignLoginTokens | null> {
  await checkAndRefreshOAuthTokenIfNeeded(0, false, credentials)
  if (isHoverRestOn() && credentials !== undefined) {
    const { readClaudeAiOauthFromCredentials } = await import(
      '../cli/handlers/designOauth.js'
    )
    return readClaudeAiOauthFromCredentials(credentials)
  }
  return getClaudeAIOAuthTokens()
}

/**
 * densable `f` / `c(e)` — design bearer: a claude.ai login that can refresh and
 * already carries `user:design:read`, else the `/design login` credential,
 * else the plain claude.ai access token.
 */
export async function resolveDesignAccessToken(
  credentials?: unknown,
): Promise<string | null> {
  const login = await designLoginTokens(credentials)
  if (
    login?.accessToken &&
    login.refreshToken &&
    login.scopes?.includes('user:design:read')
  ) {
    return login.accessToken
  }
  const { readDesignOauth } = await import('../cli/handlers/designOauth.js')
  const design = await readDesignOauth(credentials)
  if (design?.accessToken) return design.accessToken
  return login?.accessToken ?? null
}

/** densable `c(e)` — `{auth:'none'}` plus a bearer when one resolved. */
export async function designRequestAuth(credentials?: unknown): Promise<{
  headers?: { Authorization: string }
}> {
  const token = await resolveDesignAccessToken(credentials)
  if (!token) return {}
  return { headers: { Authorization: `Bearer ${token}` } }
}

export async function designAuthHeaders(
  credentials?: unknown,
): Promise<Record<string, string>> {
  const token = await resolveDesignAccessToken(credentials)
  if (!token) {
    throw new Error('no-auth')
  }
  return getOAuthHeaders(token)
}

export async function postDesignConsent(
  state?: DesignSessionState,
  credentials?: unknown,
): Promise<void> {
  const response = await axios.post(
    consentUrl(),
    { consent: DESIGN_CONSENT_BIT },
    {
      headers: await designAuthHeaders(credentials),
      timeout: 15000,
      validateStatus: s => s < 300,
    },
  )
  if (response.status >= 300) {
    throw new Error(`Couldn't record Design consent (${response.status}).`)
  }
  if (state) {
    await writeFetchedConsentBit(state, DESIGN_CONSENT_BIT, true)
    return
  }
  // A caller with no toolState still seeds the next read.
  seedDesignConsentCache(true)
}

export async function postDesignProjectGrant(
  projectId: string,
  credentials?: unknown,
): Promise<void> {
  const response = await axios.post(
    `${getOauthConfig().BASE_API_URL}/v1/design/grants`,
    { project_id: projectId },
    {
      headers: await designAuthHeaders(credentials),
      timeout: 15000,
      validateStatus: status => status < 300 || status === 404,
    },
  )
  if (response.status === 404) {
    throw new Error(
      'This project cannot hold a durable write grant for this account (it may be shared from another organization, or not viewable) — use finalize_plan with writes/deletes and pass the returned plan_token for writes to this project.',
    )
  }
  if (response.status >= 300) {
    throw new Error(
      `Couldn't record the Design project write grant (${response.status}).`,
    )
  }
}

export async function deleteDesignConsent(
  state?: DesignSessionState,
  credentials?: unknown,
): Promise<void> {
  const response = await axios.delete(consentUrl(), {
    data: { consent: DESIGN_CONSENT_BIT },
    headers: await designAuthHeaders(credentials),
    timeout: 15000,
    validateStatus: s => s < 300 || s === 404,
  })
  if (response.status >= 300 && response.status !== 404) {
    throw new Error(`Couldn't revoke Design consent (${response.status}).`)
  }
  if (state) {
    await writeFetchedConsentBit(state, DESIGN_CONSENT_BIT, false)
  }
  seedDesignConsentCache(false)
}
