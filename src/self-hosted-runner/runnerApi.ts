/**
 * densable 2.1.224 self-hosted-runner HTTP client (LUi + OJl/dGr/pGr/Oae/ere).
 * 1:1 from SEA — no poll-loop invent; pure API surface for root/orchestrator.
 */
import axios, { type AxiosInstance } from 'axios'

const ANTHROPIC_VERSION = '2023-06-01'

/** densable `Z6v` — id safety for path segments */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

/** densable `aHt` — VERSION without leading v / pre-release / build */
export function resolveRunnerVersion(
  version: string = typeof MACRO !== 'undefined' &&
  typeof MACRO.VERSION === 'string'
    ? MACRO.VERSION
    : '0.0.0',
): string {
  return version.replace(/^v/, '').split(/[-+]/)[0] ?? version
}

/** densable `G3` — extract human detail from error JSON body */
export function extractRunnerApiErrorDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  if (typeof obj.message === 'string') return obj.message
  if (
    obj.error !== null &&
    typeof obj.error === 'object' &&
    typeof (obj.error as { message?: unknown }).message === 'string'
  ) {
    return (obj.error as { message: string }).message
  }
  return undefined
}

/** densable `ere` */
export function assertSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`)
  }
  return value
}

/** densable `OJl` / `dGr` — pool or runner JWT */
export function runnerAuthHeaders(
  token: string,
  runnerVersion: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-self-hosted-runner-version': runnerVersion,
  }
}

/** densable `pGr` — session token without runner version header */
export function sessionAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

/** densable `eqv` */
function errorTypeFromBody(data: unknown): string | undefined {
  if (
    data !== null &&
    typeof data === 'object' &&
    'error' in data &&
    (data as { error: unknown }).error !== null &&
    typeof (data as { error: unknown }).error === 'object' &&
    'type' in ((data as { error: object }).error as object) &&
    typeof ((data as { error: { type: unknown } }).error as { type: unknown })
      .type === 'string'
  ) {
    return (data as { error: { type: string } }).error.type
  }
  return undefined
}

export type RunnerApiError = Error & {
  httpStatus?: number
  isAuthFailure?: boolean
  isNotFound?: boolean
  isEpochMismatch?: boolean
  isSessionNotActive?: boolean
}

/** densable `Oae` */
export function assertRunnerApiOk(
  status: number,
  data: unknown,
  op: string,
): void {
  if (status >= 200 && status < 300) return
  const detail = extractRunnerApiErrorDetail(data)
  const err = new Error(
    status === 401
      ? `${op}: Authentication failed (401)${detail ? `: ${detail}` : ''}. Check your credentials.`
      : status === 403
        ? `${op}: Access denied (403)${detail ? `: ${detail}` : ''}. Token may be revoked.`
        : status === 404
          ? (detail ?? `${op}: Not found (404). The resource may not exist.`)
          : status === 409 && errorTypeFromBody(data) === 'session_not_active'
            ? 'Session not active (409): the session was archived or deleted.'
            : status === 409
              ? `${op}: Epoch conflict (409)${detail ? `: ${detail}` : ''}. Another runner has taken over this session.`
              : status === 429
                ? `${op}: Rate limited (429). Polling too frequently.`
                : `${op}: Failed with status ${status}${detail ? `: ${detail}` : ''}`,
  ) as RunnerApiError
  err.httpStatus = status
  if (status === 401 || status === 403) err.isAuthFailure = true
  if (status === 404) err.isNotFound = true
  if (status === 409) {
    err.isEpochMismatch = true
    if (errorTypeFromBody(data) === 'session_not_active') {
      err.isSessionNotActive = true
    }
  }
  throw err
}

/** densable `qrr` */
export function getHttpStatusFromError(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object') {
    const e = err as {
      httpStatus?: unknown
      response?: { status?: unknown }
    }
    if (typeof e.httpStatus === 'number') return e.httpStatus
    if (typeof e.response?.status === 'number') return e.response.status
  }
  return undefined
}

/** densable `jrr` — retryable? */
export function isRetryableRunnerError(err: unknown): boolean {
  if (err !== null && typeof err === 'object') {
    const e = err as { name?: string; code?: string }
    if (e.name === 'AbortError' || e.code === 'ERR_CANCELED') return false
  }
  const status = getHttpStatusFromError(err)
  return status === undefined || status === 429 || status >= 500
}

/** densable `yKn` — failure class for metrics */
export function classifyRunnerError(
  err: unknown,
): 'timeout' | 'transport' | '5xx' | '429' | '4xx' {
  if (err !== null && typeof err === 'object') {
    const code = (err as { code?: string }).code
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout'
  }
  const status = getHttpStatusFromError(err)
  if (status === undefined) return 'transport'
  if (status >= 500) return '5xx'
  if (status === 429) return '429'
  return '4xx'
}

/** densable `MUi` */
export function emptyRunnerErrorCounts(): Record<
  'transport' | 'timeout' | '5xx' | '429' | '4xx',
  number
> {
  return { transport: 0, timeout: 0, '5xx': 0, '429': 0, '4xx': 0 }
}

export type SpawnHint = {
  session_uuid: string
  attempt: number
  work_order_jwt: string
  sources: unknown[]
  [key: string]: unknown
}

export type PollSpawnHintsResult = {
  hints: SpawnHint[]
  warm_hints: SpawnHint[]
  pending_count: number
  backing_off_count: number
  circuit_broken_count: number
  pool_pending_session_count: number
  pool_active_session_count: number
  server_date: string | null
}

export type PollWorkResult = {
  assignment_ids: string[]
  lease_expires_at?: unknown
  session_assignments: unknown[]
}

export type SelfHostedRunnerApi = {
  registerRunner: (
    clientLabel?: string,
    lockToAccountId?: string,
  ) => Promise<{ runner_id: string; [key: string]: unknown }>
  pollSpawnHints: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<PollSpawnHintsResult>
  nackSpawnHint: (
    body: {
      session_uuid: string
      attempt: number
      retryable: boolean
      error: string
      failure_kind?: string
      [key: string]: unknown
    },
    signal?: AbortSignal,
  ) => Promise<void>
  pollWork: (
    runnerToken: string,
    runnerId: string,
    availableCapacity: number,
    signal?: AbortSignal,
    wakeSource?: string,
  ) => Promise<PollWorkResult>
  issueSessionToken: (
    runnerToken: string,
    sessionId: string,
    signal?: AbortSignal,
  ) => Promise<{ session_token: string; [key: string]: unknown }>
  reportSessionFailure: (
    runnerToken: string,
    sessionId: string,
    reason: string,
    setupFailureKind?: string,
    failureKind?: string,
  ) => Promise<{
    excluded_count?: number
    stuck?: boolean
    [key: string]: unknown
  }>
  releaseSession: (
    runnerToken: string,
    sessionId: string,
  ) => Promise<{ released: boolean }>
  deregisterRunner: (runnerToken: string) => Promise<void>
  refreshToken: (
    runnerToken: string,
  ) => Promise<{ token: string; [key: string]: unknown }>
  getSessionRemoteConfig: (
    sessionId: string,
    sessionToken: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, unknown>>
  registerWorker: (
    apiBaseUrl: string,
    sessionId: string,
    sessionToken: string,
    signal?: AbortSignal,
  ) => Promise<number>
  postWorkerEvents: (
    apiBaseUrl: string,
    sessionId: string,
    sessionToken: string,
    workerEpoch: number,
    events: unknown[],
    signal?: AbortSignal,
  ) => Promise<void>
  updateSessionWorkerState: (
    apiBaseUrl: string,
    sessionId: string,
    sessionToken: string,
    workerEpoch: number,
    workerStatus: string,
    signal?: AbortSignal,
  ) => Promise<void>
  heartbeat: (
    apiBaseUrl: string,
    sessionId: string,
    sessionToken: string,
    workerEpoch: number,
    signal?: AbortSignal,
  ) => Promise<void>
  /**
   * densable Fjv payload: `{timestamp, fields:{message}}[]` as `lines`.
   * (Not bare strings — SEA posts structured log lines.)
   */
  forwardDiagnostics: (
    apiBaseUrl: string,
    sessionId: string,
    sessionToken: string,
    workerEpoch: number,
    lines: Array<{ timestamp: string; fields: { message: string } }>,
  ) => Promise<void>
}

export type CreateSelfHostedRunnerApiOpts = {
  baseUrl: string
  poolSecret: string
  onDebug?: (msg: string) => void
  http?: AxiosInstance
  runnerVersion?: string
}

function normalizeHint(raw: Record<string, unknown>): SpawnHint {
  return {
    ...raw,
    session_uuid: (raw.session_uuid as string | undefined) ?? '',
    attempt: (raw.attempt as number | undefined) ?? 0,
    work_order_jwt: (raw.work_order_jwt as string | undefined) ?? '',
    sources: (raw.sources as unknown[] | undefined) ?? [],
  }
}

/**
 * densable `LUi(e)` — factory for self-hosted runner control-plane client.
 */
export function createSelfHostedRunnerApi(
  opts: CreateSelfHostedRunnerApiOpts,
): SelfHostedRunnerApi {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const runnerVersion = opts.runnerVersion ?? resolveRunnerVersion()
  const http = opts.http ?? axios
  const debug = (msg: string): void => {
    opts.onDebug?.(msg)
  }

  // densable empty-poll counter (r) + log every n=30
  let emptyPolls = 0
  const emptyPollLogEvery = 30

  return {
    async registerRunner(clientLabel, lockToAccountId) {
      debug('[runner:api] POST /v1/code/runners/self-hosted/runners/register')
      const body: Record<string, unknown> = {
        runner_version: runnerVersion,
      }
      if (clientLabel) body.client_label = clientLabel
      if (lockToAccountId) body.lock_to_account_id = lockToAccountId
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/runners/register`,
        body,
        {
          headers: runnerAuthHeaders(opts.poolSecret, runnerVersion),
          timeout: 15_000,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'RegisterRunner')
      assertSafeId(res.data?.runner_id, 'runner_id')
      debug(
        `[runner:api] RegisterRunner -> ${res.status} runner_id=${res.data.runner_id}`,
      )
      return res.data
    },

    async pollSpawnHints(body, signal) {
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/spawn-hints/poll`,
        body,
        {
          headers: runnerAuthHeaders(opts.poolSecret, runnerVersion),
          timeout: 30_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'PollSpawnHints')
      const serverDate =
        typeof res.headers?.date === 'string' ? res.headers.date : null
      const data = res.data as Record<string, unknown>
      const out: PollSpawnHintsResult = {
        hints: ((data.hints as Record<string, unknown>[]) ?? []).map(
          normalizeHint,
        ),
        warm_hints: ((data.warm_hints as Record<string, unknown>[]) ?? []).map(
          normalizeHint,
        ),
        pending_count: (data.pending_count as number | undefined) ?? 0,
        backing_off_count: (data.backing_off_count as number | undefined) ?? 0,
        circuit_broken_count:
          (data.circuit_broken_count as number | undefined) ?? 0,
        pool_pending_session_count:
          (data.pool_pending_session_count as number | undefined) ?? 0,
        pool_active_session_count:
          (data.pool_active_session_count as number | undefined) ?? 0,
        server_date: serverDate,
      }
      debug(
        `[runner:api] PollSpawnHints -> ${res.status} hints=${out.hints.length} warm=${out.warm_hints.length} pending=${out.pending_count} backing_off=${out.backing_off_count} circuit_broken=${out.circuit_broken_count}`,
      )
      return out
    },

    async nackSpawnHint(body, signal) {
      debug(
        `[runner:api] POST /v1/code/runners/self-hosted/spawn-hints/nack session=${body.session_uuid} attempt=${body.attempt} retryable=${body.retryable}${body.failure_kind ? ` cause=${body.failure_kind}` : ''}`,
      )
      const error =
        body.error.length > 512 ? body.error.slice(0, 512) : body.error
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/spawn-hints/nack`,
        { ...body, error },
        {
          headers: runnerAuthHeaders(opts.poolSecret, runnerVersion),
          timeout: 15_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'NackSpawnHint')
      debug(`[runner:api] NackSpawnHint -> ${res.status}`)
    },

    async pollWork(
      runnerToken,
      runnerId,
      availableCapacity,
      signal,
      wakeSource,
    ) {
      assertSafeId(runnerId, 'runnerId')
      const prevEmpty = emptyPolls
      emptyPolls = 0
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/runners/${runnerId}/poll`,
        {
          available_capacity: availableCapacity,
          ...(wakeSource !== undefined ? { wake_source: wakeSource } : {}),
        },
        {
          headers: runnerAuthHeaders(runnerToken, runnerVersion),
          timeout: 30_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'PollWork')
      const data = res.data as Record<string, unknown>
      const assignmentIds = (data.assignment_ids as string[] | undefined) ?? []
      if (assignmentIds.length === 0) {
        emptyPolls = prevEmpty + 1
        if (emptyPolls === 1 || emptyPolls % emptyPollLogEvery === 0) {
          debug(
            `[runner:api] PollWork -> ${res.status} (no work, ${emptyPolls} consecutive empty polls)`,
          )
        }
      } else {
        debug(
          `[runner:api] PollWork -> ${res.status} assignments=${assignmentIds.length}`,
        )
      }
      return {
        assignment_ids: assignmentIds,
        lease_expires_at: data.lease_expires_at,
        session_assignments:
          (data.session_assignments as unknown[] | undefined) ?? [],
      }
    },

    async issueSessionToken(runnerToken, sessionId, signal) {
      assertSafeId(sessionId, 'sessionId')
      const path = `/v1/code/runners/self-hosted/sessions/${encodeURIComponent(sessionId)}/token`
      debug(`[runner:api] POST ${path}`)
      const res = await http.post(
        `${baseUrl}${path}`,
        {},
        {
          headers: runnerAuthHeaders(runnerToken, runnerVersion),
          timeout: 15_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'IssueSessionToken')
      if (!res.data?.session_token) {
        throw new Error('IssueSessionToken: response missing session_token')
      }
      debug(`[runner:api] IssueSessionToken -> ${res.status}`)
      return res.data
    },

    async reportSessionFailure(
      runnerToken,
      sessionId,
      reason,
      setupFailureKind,
      failureKind,
    ) {
      assertSafeId(sessionId, 'sessionId')
      debug(
        `[runner:api] POST /v1/code/runners/self-hosted/sessions/${sessionId}/report-failure reason=${reason}${setupFailureKind ? ` kind=${setupFailureKind}` : ''}${failureKind ? ` cause=${failureKind}` : ''}`,
      )
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/sessions/${sessionId}/report-failure`,
        {
          reason,
          ...(setupFailureKind ? { setup_failure_kind: setupFailureKind } : {}),
          ...(failureKind ? { failure_kind: failureKind } : {}),
        },
        {
          headers: runnerAuthHeaders(runnerToken, runnerVersion),
          timeout: 15_000,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'ReportSessionFailure')
      debug(
        `[runner:api] ReportSessionFailure -> ${res.status} excluded_count=${res.data?.excluded_count} stuck=${res.data?.stuck}`,
      )
      return res.data
    },

    async releaseSession(runnerToken, sessionId) {
      assertSafeId(sessionId, 'sessionId')
      debug(
        `[runner:api] POST /v1/code/runners/self-hosted/sessions/${sessionId}/release`,
      )
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/sessions/${sessionId}/release`,
        {},
        {
          headers: runnerAuthHeaders(runnerToken, runnerVersion),
          timeout: 15_000,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'ReleaseSession')
      const released = res.data?.released ?? true
      debug(`[runner:api] ReleaseSession -> ${res.status} released=${released}`)
      return { released: Boolean(released) }
    },

    async deregisterRunner(runnerToken) {
      debug('[runner:api] POST /v1/code/runners/self-hosted/deregister')
      const res = await http.post(
        `${baseUrl}/v1/code/runners/self-hosted/deregister`,
        {},
        {
          headers: runnerAuthHeaders(runnerToken, runnerVersion),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'DeregisterRunner')
      debug(`[runner:api] DeregisterRunner -> ${res.status}`)
    },

    async refreshToken(runnerToken) {
      debug('[runner:api] POST /v1/code/auth/refresh')
      const res = await http.post(
        `${baseUrl}/v1/code/auth/refresh`,
        {},
        {
          headers: runnerAuthHeaders(runnerToken, runnerVersion),
          timeout: 15_000,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'RefreshToken')
      if (!res.data?.token) {
        throw new Error('RefreshToken: response missing token')
      }
      debug(`[runner:api] RefreshToken -> ${res.status}`)
      return res.data
    },

    async getSessionRemoteConfig(sessionId, sessionToken, signal) {
      assertSafeId(sessionId, 'sessionId')
      debug(`[runner:api] GET /v1/code/sessions/${sessionId}/remote`)
      const res = await http.get(
        `${baseUrl}/v1/code/sessions/${sessionId}/remote`,
        {
          headers: sessionAuthHeaders(sessionToken),
          timeout: 15_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'GetSessionRemoteConfig')
      const l = res.data as Record<string, unknown>
      return {
        ...l,
        sources: l.sources ?? [],
        push_targets: l.push_targets ?? [],
        claude_code_args: l.claude_code_args ?? {},
        environment_variables: l.environment_variables ?? {},
      }
    },

    async registerWorker(apiBaseUrl, sessionId, sessionToken, signal) {
      assertSafeId(sessionId, 'sessionId')
      const base = apiBaseUrl.replace(/\/+$/, '')
      debug(
        `[runner:api] POST ${base}/v1/code/sessions/${sessionId}/worker/register`,
      )
      const res = await http.post(
        `${base}/v1/code/sessions/${sessionId}/worker/register`,
        { session_id: sessionId },
        {
          headers: sessionAuthHeaders(sessionToken),
          timeout: 30_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'RegisterWorker')
      const epoch = Number.parseInt(String(res.data?.worker_epoch), 10)
      if (Number.isNaN(epoch)) {
        throw new Error(
          `RegisterWorker: invalid worker_epoch in response: ${res.data?.worker_epoch}`,
        )
      }
      debug(
        `[runner:api] RegisterWorker -> ${res.status} worker_epoch=${epoch}`,
      )
      return epoch
    },

    async postWorkerEvents(
      apiBaseUrl,
      sessionId,
      sessionToken,
      workerEpoch,
      events,
      signal,
    ) {
      assertSafeId(sessionId, 'sessionId')
      const base = apiBaseUrl.replace(/\/+$/, '')
      const noun = events.length === 1 ? 'event' : 'events'
      debug(
        `[runner:api] POST ${base}/v1/code/sessions/${sessionId}/worker/events (${events.length} ${noun})`,
      )
      const res = await http.post(
        `${base}/v1/code/sessions/${sessionId}/worker/events`,
        {
          worker_epoch: workerEpoch,
          events: events.map(payload => ({ payload })),
        },
        {
          headers: sessionAuthHeaders(sessionToken),
          timeout: 15_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'PostWorkerEvents')
      debug(`[runner:api] PostWorkerEvents -> ${res.status}`)
    },

    async updateSessionWorkerState(
      apiBaseUrl,
      sessionId,
      sessionToken,
      workerEpoch,
      workerStatus,
      signal,
    ) {
      assertSafeId(sessionId, 'sessionId')
      const base = apiBaseUrl.replace(/\/+$/, '')
      debug(`[runner:api] PUT ${base}/v1/code/sessions/${sessionId}/worker`)
      const res = await http.put(
        `${base}/v1/code/sessions/${sessionId}/worker`,
        { worker_epoch: workerEpoch, worker_status: workerStatus },
        {
          headers: sessionAuthHeaders(sessionToken),
          timeout: 15_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'UpdateSessionWorkerState')
      debug(`[runner:api] UpdateSessionWorkerState -> ${res.status}`)
    },

    async heartbeat(apiBaseUrl, sessionId, sessionToken, workerEpoch, signal) {
      assertSafeId(sessionId, 'sessionId')
      const base = apiBaseUrl.replace(/\/+$/, '')
      const res = await http.post(
        `${base}/v1/code/sessions/${sessionId}/worker/heartbeat`,
        { worker_epoch: workerEpoch },
        {
          headers: sessionAuthHeaders(sessionToken),
          timeout: 10_000,
          signal,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'Heartbeat')
    },

    async forwardDiagnostics(
      apiBaseUrl,
      sessionId,
      sessionToken,
      workerEpoch,
      lines,
    ) {
      assertSafeId(sessionId, 'sessionId')
      if (lines.length === 0) return
      const base = apiBaseUrl.replace(/\/+$/, '')
      debug(
        `[runner:api] POST ${base}/v1/code/sessions/${sessionId}/worker/diagnostics (${lines.length} lines)`,
      )
      const res = await http.post(
        `${base}/v1/code/sessions/${sessionId}/worker/diagnostics`,
        { worker_epoch: workerEpoch, lines },
        {
          headers: sessionAuthHeaders(sessionToken),
          timeout: 30_000,
          validateStatus: s => s < 500,
        },
      )
      assertRunnerApiOk(res.status, res.data, 'ForwardDiagnostics')
      debug(`[runner:api] ForwardDiagnostics -> ${res.status}`)
    },
  }
}
