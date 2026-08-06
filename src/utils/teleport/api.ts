import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { randomUUID } from 'crypto'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getOrganizationUUID } from 'src/services/oauth/client.js'
import z from 'zod/v4'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
} from '../auth.js'
import { getOAuthTokenFromFileDescriptor } from '../authFileDescriptor.js'
import { getGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { parseGitHubRepository } from '../detectRepository.js'
import { isEnvTruthy } from '../envUtils.js'
import { errorMessage, TeleportOperationError, toError } from '../errors.js'
import { lazySchema } from '../lazySchema.js'
import { logError } from '../log.js'
import { getAPIProvider } from '../model/providers.js'
import { sleep } from '../sleep.js'
import { jsonStringify } from '../slowOperations.js'

// Retry configuration for teleport API requests
const TELEPORT_RETRY_DELAYS = [2000, 4000, 8000, 16000] // 4 retries with exponential backoff
const MAX_TELEPORT_RETRIES = TELEPORT_RETRY_DELAYS.length

export const CCR_BYOC_BETA = 'ccr-byoc-2025-07-29'

/**
 * Checks if an axios error is a transient network error that should be retried
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false
  }

  // Retry on network errors (no response received)
  if (!error.response) {
    return true
  }

  // Retry on server errors (5xx)
  if (error.response.status >= 500) {
    return true
  }

  // Don't retry on client errors (4xx) - they're not transient
  return false
}

/**
 * Makes an axios GET request with automatic retry for transient network errors
 * Uses exponential backoff: 2s, 4s, 8s, 16s (4 retries = 5 total attempts)
 */
export async function axiosGetWithRetry<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_TELEPORT_RETRIES; attempt++) {
    try {
      return await axios.get<T>(url, config)
    } catch (error) {
      lastError = error

      // Don't retry if this isn't a transient error
      if (!isTransientNetworkError(error)) {
        throw error
      }

      // Don't retry if we've exhausted all retries
      if (attempt >= MAX_TELEPORT_RETRIES) {
        logForDebugging(
          `Teleport request failed after ${attempt + 1} attempts: ${errorMessage(error)}`,
        )
        throw error
      }

      const delay = TELEPORT_RETRY_DELAYS[attempt] ?? 2000
      logForDebugging(
        `Teleport request failed (attempt ${attempt + 1}/${MAX_TELEPORT_RETRIES + 1}), retrying in ${delay}ms: ${errorMessage(error)}`,
      )
      await sleep(delay)
    }
  }

  throw lastError
}

// Types matching the actual Sessions API response from api/schemas/sessions/sessions.py
export type SessionStatus = 'requires_action' | 'running' | 'idle' | 'archived'

export type GitSource = {
  type: 'git_repository'
  url: string
  revision?: string | null
  allow_unrestricted_git_push?: boolean
}

export type KnowledgeBaseSource = {
  type: 'knowledge_base'
  knowledge_base_id: string
}

export type SessionContextSource = GitSource | KnowledgeBaseSource

// Outcome types from api/schemas/sandbox.py
export type OutcomeGitInfo = {
  type: 'github'
  repo: string
  branches: string[]
}

export type GitRepositoryOutcome = {
  type: 'git_repository'
  git_info: OutcomeGitInfo
}

export type Outcome = GitRepositoryOutcome

export type SessionContext = {
  sources: SessionContextSource[]
  cwd: string
  outcomes: Outcome[] | null
  custom_system_prompt: string | null
  append_system_prompt: string | null
  model: string | null
  // Seed filesystem with a git bundle on Files API
  seed_bundle_file_id?: string
  github_pr?: { owner: string; repo: string; number: number }
  reuse_outcome_branches?: boolean
}

export type SessionResource = {
  type: 'session'
  id: string
  title: string | null
  session_status: SessionStatus
  environment_id: string
  created_at: string
  updated_at: string
  session_context: SessionContext
}

export type ListSessionsResponse = {
  data: SessionResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

export const CodeSessionSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.enum([
      'idle',
      'working',
      'waiting',
      'completed',
      'archived',
      'cancelled',
      'rejected',
    ]),
    repo: z
      .object({
        name: z.string(),
        owner: z.object({
          login: z.string(),
        }),
        default_branch: z.string().optional(),
      })
      .nullable(),
    turns: z.array(z.string()),
    created_at: z.string(),
    updated_at: z.string(),
  }),
)

// Export the inferred type from the Zod schema
export type CodeSession = z.infer<ReturnType<typeof CodeSessionSchema>>

/**
 * L2 fix (codecov-100 audit #12): predicate for "was the workspace API key
 * explicitly cleared" vs "was it never set". Treats workspaceApiKey
 * present-but-falsy (null, '', whitespace) as cleared, and absent
 * (undefined, missing field) as never-set. The TypeScript type is
 * `string | undefined` but the JSON file can legally hold null if a user
 * manually edited it, so we handle null defensively via runtime check.
 *
 * Other types (number, boolean, object, etc.) conservatively fall through
 * to "not cleared" — the underlying state is corrupt, and the standard
 * "required" message is less misleading than claiming the user cleared a
 * value they never set.
 *
 * Exported so unit tests can pin the predicate directly without needing
 * to bypass the process-wide mock.module() registrations on
 * `src/utils/teleport/api.js` from sibling test files.
 */
export function isWorkspaceKeyCleared(rawValue: unknown): boolean {
  return (
    rawValue === null ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  )
}

/**
 * Validates and prepares for workspace API key requests (agents, vaults, memory_stores, skills).
 *
 * Reads the workspace API key from two sources in priority order:
 *   1. ANTHROPIC_API_KEY environment variable (takes precedence)
 *   2. workspaceApiKey field in ~/.claude.json (set via /login UI, no restart needed)
 *
 * Validates the sk-ant-api03-* prefix and returns the key for use in `x-api-key` headers.
 * Configuration errors (missing or wrong-prefix key) are surfaced as thrown errors so
 * callers can convert them to 501.
 *
 * @throws {Error} when no workspace key is found in env or settings, or the key does not
 *                 start with sk-ant-api03-
 */
export async function prepareWorkspaceApiRequest(): Promise<{
  apiKey: string
}> {
  // Dual-source: env var takes precedence, then settings (saved via /login UI)
  const config = getGlobalConfig()
  const apiKey =
    process.env['ANTHROPIC_API_KEY']?.trim() || config.workspaceApiKey?.trim()

  if (!apiKey) {
    // L2 fix (codecov-100 audit #12): when the user previously had a
    // workspace key and explicitly cleared it (set to null/empty), the
    // generic "required" error doesn't tell them what changed. Detect
    // the cleared-vs-never-set distinction so the prompt is actionable.
    const rawValue = (config as { workspaceApiKey?: string | null })
      .workspaceApiKey
    const wasCleared = isWorkspaceKeyCleared(rawValue)
    const preface = wasCleared
      ? 'Your workspace API key was cleared. '
      : 'A workspace API key (sk-ant-api03-*) is required to use workspace endpoints ' +
        '(/v1/agents, /v1/vaults, /v1/memory_stores, /v1/skills). '
    throw new Error(
      preface +
        'Press W in /login to save your key directly (no restart needed), or ' +
        'set ANTHROPIC_API_KEY=<key> and restart. ' +
        'Obtain a key from https://console.anthropic.com/settings/keys. ' +
        'Subscription OAuth (claude.ai login) cannot reach these endpoints.',
    )
  }
  if (!apiKey.startsWith('sk-ant-api03-')) {
    // D5: expose at most first 4 chars to avoid leaking high-entropy secret bits into error logs/reports
    throw new Error(
      `Workspace API key must start with sk-ant-api03-, got prefix "${apiKey.slice(0, 4)}...". ` +
        'Obtain a workspace API key from https://console.anthropic.com/settings/keys. ' +
        'Press W in /login to save your key, or set ANTHROPIC_API_KEY.',
    )
  }
  return { apiKey }
}

/**
 * densable tP() — anthropic-client-platform header value from CLAUDE_CODE_ENTRYPOINT.
 */
export function getAnthropicClientPlatform(): string {
  switch (process.env.CLAUDE_CODE_ENTRYPOINT) {
    case 'claude-vscode':
      return 'claude_code_vscode'
    case 'remote':
    case 'remote_baku':
    case 'remote_cowork':
    case 'remote_desktop':
    case 'remote_mobile':
      return 'claude_code_remote'
    case 'claude-in-teams':
      return 'claude_code_remote'
    case 'sdk-cli':
    case 'sdk-ts':
    case 'sdk-py':
      return 'claude_code_sdk'
    case 'mcp':
      return 'claude_code_mcp'
    case 'claude-code-github-action':
      return 'claude_code_github_action'
    case 'local-agent':
      return 'claude_code_local_agent'
    case 'claude_in_slack':
      return 'claude_in_slack'
    case 'claude-in-slack':
      return 'claude-in-slack'
    case 'cli':
    default:
      return 'claude_code_cli'
  }
}

/**
 * densable o9t / getAccessTokenWithCcrFallback —
 * keychain OAuth first; when CLAUDE_CODE_REMOTE, fall back to
 * CLAUDE_CODE_OAUTH_TOKEN env or FD/well-known file token.
 */
export function getAccessTokenWithCcrFallback(): string | undefined {
  const fromKeychain = getClaudeAIOAuthTokens()?.accessToken
  if (fromKeychain) return fromKeychain
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return (
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      getOAuthTokenFromFileDescriptor() ||
      undefined
    )
  }
  return undefined
}

/**
 * OAuth access token + org UUID for Anthropic first-party APIs.
 *
 * densable J7 also gates `ou()` (first-party only), but that J7 is the
 * **teleport/code-sessions** helper. Locally this function is shared by
 * non-session callers (usageCredits, referral, adminRequests, schedule, …),
 * so the first-party gate stays on session APIs (fetchSession / poll / send /
 * list / archive / interrupt) — not here.
 */
export async function prepareApiRequest(): Promise<{
  accessToken: string
  orgUUID: string
}> {
  await checkAndRefreshOAuthTokenIfNeeded()
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (accessToken === undefined) {
    throw new Error(
      'Claude Code web sessions require authentication with a Claude.ai account. API key authentication is not sufficient. Please run /login to authenticate, or check your authentication status with /status.',
    )
  }

  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    throw new Error('Unable to get organization UUID')
  }

  return { accessToken, orgUUID }
}

/**
 * densable zLc / ccrSessionToResource — map code-session API shape → SessionResource.
 */
export function ccrSessionToResource(raw: {
  id: string
  title?: string | null
  status?: string
  worker_status?: string | null
  environment_id?: string
  created_at: string
  updated_at?: string
  last_event_at?: string
  config?: {
    sources?: SessionContextSource[]
    outcomes?: Outcome[] | null
    model?: string | null
  }
}): SessionResource {
  const sessionStatus =
    raw.status === 'archived'
      ? 'archived'
      : ((raw.worker_status ?? 'idle') as SessionStatus)
  return {
    type: 'session',
    id: raw.id,
    title: raw.title || null,
    session_status: sessionStatus,
    environment_id: raw.environment_id ?? '',
    created_at: raw.created_at,
    updated_at:
      'updated_at' in raw && raw.updated_at
        ? raw.updated_at
        : (raw.last_event_at ?? raw.created_at),
    session_context: {
      sources: raw.config?.sources ?? [],
      outcomes: raw.config?.outcomes ?? null,
      model: raw.config?.model ?? null,
      cwd: '',
      custom_system_prompt: null,
      append_system_prompt: null,
    },
  }
}

/**
 * densable $Ni — list sessions via GET /v1/code/sessions (OAuth headers only).
 */
export async function fetchCodeSessionsFromSessionsAPI(): Promise<
  CodeSession[]
> {
  // densable J7 first-party gate (session list only)
  if (getAPIProvider() !== 'firstParty') {
    throw new Error(
      'Cloud sessions are only available on the first-party Anthropic API provider.',
    )
  }
  const { accessToken } = await prepareApiRequest()

  const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions`

  try {
    // densable: headers Px(token) only — no beta / org uuid on code/sessions list
    const headers = getOAuthHeaders(accessToken)

    type CodeListItem = {
      id: string
      title?: string | null
      status?: string
      worker_status?: string | null
      created_at: string
      last_event_at?: string
      config?: {
        sources?: Array<{
          type: string
          url?: string
          revision?: string | null
        }>
      }
    }
    type CodeListResponse = { data: CodeListItem[] }

    const response = await axiosGetWithRetry<CodeListResponse>(url, {
      headers,
    })

    if (response.status !== 200) {
      throw new Error(`Failed to fetch code sessions: ${response.statusText}`)
    }

    const sessions: CodeSession[] = (response.data.data ?? []).map(session => {
      const gitSource = session.config?.sources?.find(
        (
          source,
        ): source is {
          type: 'git_repository'
          url?: string
          revision?: string | null
        } => source.type === 'git_repository',
      )

      let repo: CodeSession['repo'] = null
      if (gitSource?.url) {
        const repoPath = parseGitHubRepository(gitSource.url)
        if (repoPath) {
          const [owner, name] = repoPath.split('/')
          if (owner && name) {
            repo = {
              name,
              owner: { login: owner },
              default_branch: gitSource.revision || undefined,
            }
          }
        }
      }

      return {
        id: session.id,
        title: session.title || 'Untitled',
        description: '',
        // densable: status==="archived"?"archived":worker_status??"idle"
        status: (session.status === 'archived'
          ? 'archived'
          : (session.worker_status ?? 'idle')) as CodeSession['status'],
        repo,
        turns: [],
        created_at: session.created_at,
        updated_at: session.last_event_at ?? session.created_at,
      }
    })

    return sessions
  } catch (error) {
    const err = toError(error)
    if (isTransientNetworkError(error)) {
      logForDebugging(`Failed to fetch code sessions: ${err.message}`, {
        level: 'error',
      })
    } else {
      logError(err)
    }
    throw error
  }
}

/**
 * densable Px getOAuthHeaders — Authorization + Content-Type + anthropic-version
 * + anthropic-client-platform. No beta / org uuid (those are call-site specific).
 */
export function getOAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-client-platform': getAnthropicClientPlatform(),
  }
}

/**
 * densable l3e fetchSession — GET /v1/code/sessions/{id}, first-party only.
 * Optional accessToken avoids a second prepareApiRequest when caller already has one.
 */
export async function fetchSession(
  sessionId: string,
  opts?: { accessToken?: string },
): Promise<SessionResource> {
  if (getAPIProvider() !== 'firstParty') {
    throw new TeleportOperationError(
      'Cloud sessions are only available on the first-party Anthropic API provider.',
      'Cloud sessions are only available on the first-party Anthropic API provider.',
    )
  }
  const accessToken =
    opts?.accessToken ?? (await prepareApiRequest()).accessToken

  const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}`
  const headers = getOAuthHeaders(accessToken)

  const response = await axios.get<{
    response_shape?: Parameters<typeof ccrSessionToResource>[0]
    session?: Parameters<typeof ccrSessionToResource>[0]
    error?: { message?: string }
  }>(url, {
    headers,
    timeout: 15000,
    validateStatus: status => status < 500,
  })

  if (response.status !== 200) {
    const apiMessage = response.data?.error?.message

    if (response.status === 404) {
      const a = `Session not found: ${sessionId}`
      throw new TeleportOperationError(a, a)
    }

    if (response.status === 401) {
      throw new TeleportOperationError(
        'Session expired. Please run /login to sign in again.',
        'Session expired. Please run /login to sign in again.',
      )
    }

    if (
      response.status === 400 &&
      typeof apiMessage === 'string' &&
      apiMessage.startsWith('invalid session ID')
    ) {
      throw new TeleportOperationError(apiMessage, apiMessage)
    }

    throw new Error(
      apiMessage ||
        `Failed to fetch session: ${response.status} ${response.statusText}`,
    )
  }

  // densable: response_shape ?? session
  const raw = response.data.response_shape ?? response.data.session
  if (!raw?.id) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  return ccrSessionToResource(raw)
}

/**
 * Extracts the first branch name from a session's git repository outcomes
 * densable oqn
 */
export function getBranchFromSession(
  session: SessionResource,
): string | undefined {
  const gitOutcome = session.session_context.outcomes?.find(
    (outcome): outcome is GitRepositoryOutcome =>
      outcome.type === 'git_repository',
  )
  return gitOutcome?.git_info?.branches[0]
}

/**
 * Content for a remote session message.
 * Accepts a plain string or an array of content blocks (text, image, etc.)
 * following the Anthropic API messages spec.
 */
export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

/** densable KLc / $Ur result shape */
export type SendRemoteEventResult = { ok: true } | { ok: false; reason: string }

/**
 * densable KLc — POST /v1/code/sessions/{id}/events with payload-wrapped event.
 * first-party only. Returns {ok, reason?}.
 */
export async function sendPayloadToRemoteSession(
  sessionId: string,
  payload: Record<string, unknown>,
  logPrefix: string,
): Promise<SendRemoteEventResult> {
  if (getAPIProvider() !== 'firstParty') {
    return {
      ok: false,
      reason:
        'Cloud sessions are only available on the first-party Anthropic API provider.',
    }
  }
  try {
    const { accessToken } = await prepareApiRequest()
    const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/events`
    const headers = getOAuthHeaders(accessToken)
    logForDebugging(`${logPrefix} Sending event to session ${sessionId}`)
    const response = await axios.post(
      url,
      { events: [{ payload }] },
      {
        headers,
        validateStatus: status => status < 500,
        timeout: 30000,
      },
    )
    if (response.status === 200 || response.status === 201) {
      logForDebugging(
        `${logPrefix} Successfully sent event to session ${sessionId}`,
      )
      return { ok: true }
    }
    logForDebugging(
      `${logPrefix} Failed with status ${response.status}: ${jsonStringify(response.data)}`,
    )
    const apiMessage = (
      response.data as { error?: { message?: string } } | undefined
    )?.error?.message
    return {
      ok: false,
      reason:
        typeof apiMessage === 'string'
          ? `${apiMessage} (HTTP ${response.status})`
          : `HTTP ${response.status}`,
    }
  } catch (error) {
    logForDebugging(`${logPrefix} Error: ${errorMessage(error)}`)
    return { ok: false, reason: errorMessage(error) }
  }
}

/**
 * densable $Ur sendEventToRemoteSession — user message via KLc payload path.
 */
export async function sendEventToRemoteSession(
  sessionId: string,
  messageContent: RemoteMessageContent,
  opts?: { uuid?: string },
): Promise<SendRemoteEventResult> {
  return sendPayloadToRemoteSession(
    sessionId,
    {
      uuid: opts?.uuid ?? randomUUID(),
      session_id: sessionId,
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: messageContent,
      },
    },
    '[sendEventToRemoteSession]',
  )
}

/**
 * densable FNi sendBashCommandToRemoteSession.
 */
export async function sendBashCommandToRemoteSession(
  sessionId: string,
  command: { command: string; cwd?: string },
  opts?: { uuid?: string },
): Promise<SendRemoteEventResult> {
  return sendPayloadToRemoteSession(
    sessionId,
    {
      uuid: opts?.uuid ?? randomUUID(),
      session_id: sessionId,
      type: 'bash_command',
      command: command.command,
      ...(command.cwd !== undefined && { cwd: command.cwd }),
    },
    '[sendBashCommandToRemoteSession]',
  )
}

/**
 * densable UNi updateSessionTitle — PUT /v1/code/sessions/{id} (not PATCH /v1/sessions).
 */
export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<boolean> {
  try {
    // densable UNi uses J7 (first-party); soft-fail boolean like densable
    if (getAPIProvider() !== 'firstParty') return false
    const { accessToken } = await prepareApiRequest()

    const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}`
    const headers = getOAuthHeaders(accessToken)

    logForDebugging(
      `[updateSessionTitle] Updating title for session ${sessionId}: "${title}"`,
    )
    const response = await axios.put(
      url,
      { title },
      {
        headers,
        validateStatus: status => status < 500,
      },
    )

    if (response.status === 200) {
      logForDebugging(
        `[updateSessionTitle] Successfully updated title for session ${sessionId}`,
      )
      return true
    }

    logForDebugging(
      `[updateSessionTitle] Failed with status ${response.status}: ${jsonStringify(response.data)}`,
    )
    return false
  } catch (error) {
    logForDebugging(`[updateSessionTitle] Error: ${errorMessage(error)}`)
    return false
  }
}

/**
 * densable BNi markSessionRead — POST /v1/code/sessions/{id}/mark_read
 */
export async function markSessionRead(
  sessionId: string,
  eventId?: string,
): Promise<void> {
  try {
    if (getAPIProvider() !== 'firstParty') return
    const { accessToken } = await prepareApiRequest()
    const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/mark_read`
    const response = await axios.post(
      url,
      eventId ? { event_id: eventId } : {},
      {
        headers: getOAuthHeaders(accessToken),
        timeout: 10_000,
        validateStatus: s => s < 500,
      },
    )
    if (response.status !== 200) {
      logForDebugging(
        `[markSessionRead] Failed with status ${response.status}: ${jsonStringify(response.data)}`,
      )
    }
  } catch (error) {
    logForDebugging(`[markSessionRead] Error: ${errorMessage(error)}`)
  }
}

/**
 * densable FUr reportClientPresence — POST /v1/code/sessions/{id}/client/presence
 * Returns refresh_after_seconds or null.
 */
export async function reportClientPresence(
  sessionId: string,
  clientId: string,
  clear = false,
): Promise<number | null> {
  try {
    if (getAPIProvider() !== 'firstParty') return null
    const { accessToken } = await prepareApiRequest()
    const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/client/presence`
    const response = await axios.post(
      url,
      { client_id: clientId, clear },
      {
        headers: getOAuthHeaders(accessToken),
        timeout: 10_000,
        validateStatus: s => s < 500,
      },
    )
    if (response.status !== 200) {
      logForDebugging(
        `[reportClientPresence] Failed with status ${response.status}: ${jsonStringify(response.data)}`,
      )
      return null
    }
    const refresh = (response.data as { refresh_after_seconds?: number })
      ?.refresh_after_seconds
    return refresh ?? null
  } catch (error) {
    logForDebugging(`[reportClientPresence] Error: ${errorMessage(error)}`)
    return null
  }
}
