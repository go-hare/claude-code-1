/**
 * densable 2.1.224 self-hosted-runner health HTTP (hFh) + Prometheus (tqv/rqv).
 * 1:1 from SEA `/tmp/shr-extract-224/health-hFh.js` + `metrics-*.js`.
 */
import { createServer, type Server } from 'node:http'

/** densable `pFh` */
export const METRICS_PREFIX = 'claude_code_self_hosted_runner'

/** densable `Wrr` */
export const UNKNOWN_CLIENT_PLATFORM = 'unknown'

/** densable `HUi` — poll error kinds always present for rate() */
export const POLL_ERROR_KINDS = [
  'transport',
  'timeout',
  '5xx',
  '429',
  '4xx',
] as const
export type PollErrorKind = (typeof POLL_ERROR_KINDS)[number]

/** densable `bKn` — session init duration histogram bounds (seconds) */
export const SESSION_INIT_DURATION_BOUNDS = [
  1, 2.5, 5, 10, 20, 40, 80, 160, 320, 640, 1280,
] as const

export type HistogramState = {
  buckets: number[]
  sum: number
  count: number
}

export type ChildMetricSeries = {
  help: string
  type: string
  points: Map<string, number>
}

export type RunnerHealthState = {
  runnerId: string
  version: string
  clientLabel: string
  capacity: number
  activeSessions: number
  lastPollAt: number
  listeningOn?: number
  sessionsStarted: Map<string, number>
  sessionsCompleted: Map<string, number>
  sessionsFailed: Map<string, number>
  sessionsInterrupted: Map<string, number>
  lockedAccountEmail: string | null
  pollErrors: Record<PollErrorKind, number>
  initializingSessions: number
  sessionInitErrors: number
  sessionInitDurations: HistogramState
  sessionStartHookErrors: number
  sessionIdle: Map<string, number | null>
  sessionClientPlatform: Map<string, string>
  childMetrics?: Map<string, ChildMetricSeries>
}

/** densable `uFh` */
export function emptyInitDurationHistogram(): HistogramState {
  return {
    buckets: SESSION_INIT_DURATION_BOUNDS.map(() => 0),
    sum: 0,
    count: 0,
  }
}

/** densable `MUi` */
export function emptyPollErrors(): Record<PollErrorKind, number> {
  return {
    transport: 0,
    timeout: 0,
    '5xx': 0,
    '429': 0,
    '4xx': 0,
  }
}

/** densable health state factory (azv `$`) */
export function createRunnerHealthState(opts: {
  runnerId: string
  version: string
  clientLabel: string
  capacity: number
}): RunnerHealthState {
  return {
    runnerId: opts.runnerId,
    version: opts.version,
    clientLabel: opts.clientLabel,
    capacity: opts.capacity,
    activeSessions: 0,
    lastPollAt: 0,
    sessionsStarted: new Map(),
    sessionsCompleted: new Map(),
    sessionsFailed: new Map(),
    sessionsInterrupted: new Map(),
    lockedAccountEmail: null,
    pollErrors: emptyPollErrors(),
    initializingSessions: 0,
    sessionInitErrors: 0,
    sessionInitDurations: emptyInitDurationHistogram(),
    sessionStartHookErrors: 0,
    sessionIdle: new Map(),
    sessionClientPlatform: new Map(),
  }
}

/**
 * densable `fFh` — drop per-session child metric points when a session ends.
 */
export function clearChildMetricsForSession(
  state: RunnerHealthState,
  sessionId: string,
): void {
  const childMetrics = state.childMetrics
  if (childMetrics === undefined) return
  const needle = `session_id="${promEscapeLabel(sessionId)}"`
  for (const [name, series] of childMetrics) {
    for (const key of series.points.keys()) {
      if (key.includes(needle)) series.points.delete(key)
    }
    if (series.points.size === 0) childMetrics.delete(name)
  }
}

/** densable `wme` — Prometheus label escape */
export function promEscapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/** densable `aFh` — sanitize metric name */
export function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&')
}

/** densable `mFh` — OTel attribute value → string */
export function otelAttrToString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (typeof v.stringValue === 'string') return v.stringValue
  if (v.intValue !== undefined) return String(v.intValue)
  if (typeof v.doubleValue === 'number') return String(v.doubleValue)
  if (typeof v.boolValue === 'boolean') return String(v.boolValue)
  return undefined
}

/** densable `lFh` — find attribute by key */
export function findOtelAttr(
  attrs: Array<{ key?: string; value?: unknown }> | undefined,
  key: string,
): string | undefined {
  for (const a of attrs ?? []) {
    if (a.key === key) return otelAttrToString(a.value)
  }
  return undefined
}

/** densable `dFh` — observe histogram sample (seconds) */
export function observeInitDuration(
  hist: HistogramState,
  durationSec: number,
): void {
  if (!Number.isFinite(durationSec) || durationSec < 0) return
  hist.count++
  hist.sum += durationSec
  for (let i = 0; i < SESSION_INIT_DURATION_BOUNDS.length; i++) {
    if (durationSec <= SESSION_INIT_DURATION_BOUNDS[i]!) {
      hist.buckets[i]!++
    }
  }
}

/**
 * densable poll error classifier used by xBh (`yKn`).
 * Maps axios-style errors to HUi kinds.
 */
export function classifyPollError(err: unknown): PollErrorKind {
  if (err !== null && typeof err === 'object') {
    const e = err as {
      code?: string
      httpStatus?: number
      status?: number
      message?: string
    }
    const status =
      typeof e.httpStatus === 'number'
        ? e.httpStatus
        : typeof e.status === 'number'
          ? e.status
          : undefined
    if (status === 429) return '429'
    if (status !== undefined && status >= 500) return '5xx'
    if (status !== undefined && status >= 400) return '4xx'
    if (
      e.code === 'ECONNABORTED' ||
      e.code === 'ETIMEDOUT' ||
      (typeof e.message === 'string' && /timeout/i.test(e.message))
    ) {
      return 'timeout'
    }
  }
  return 'transport'
}

/** densable `rqv` — ingest OTLP JSON body from child POST /v1/metrics (localhost only) */
export function ingestChildOtlpMetrics(
  state: RunnerHealthState,
  body: unknown,
): void {
  const root =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : null
  if (!root) return
  const childMetrics = (state.childMetrics ??= new Map())
  const resourceMetrics = (root.resourceMetrics ?? []) as Array<
    Record<string, unknown>
  >
  for (const rm of resourceMetrics) {
    const resource = rm.resource as
      | { attributes?: Array<{ key?: string; value?: unknown }> }
      | undefined
    const sessionId = findOtelAttr(resource?.attributes, 'session.id')
    const clientPlatform = findOtelAttr(resource?.attributes, 'client.platform')
    const scopeMetrics = (rm.scopeMetrics ?? []) as Array<
      Record<string, unknown>
    >
    for (const sm of scopeMetrics) {
      const metrics = (sm.metrics ?? []) as Array<Record<string, unknown>>
      for (const metric of metrics) {
        if (typeof metric.name !== 'string' || metric.name === '') continue
        const sanitized = sanitizeMetricName(metric.name)
        let type: string
        let name: string
        let dataPoints: Array<Record<string, unknown>> | undefined
        if (metric.sum && typeof metric.sum === 'object') {
          const sum = metric.sum as {
            isMonotonic?: boolean
            dataPoints?: Array<Record<string, unknown>>
          }
          type = sum.isMonotonic ? 'counter' : 'gauge'
          name =
            sum.isMonotonic && !sanitized.endsWith('_total')
              ? `${sanitized}_total`
              : sanitized
          dataPoints = sum.dataPoints
        } else if (metric.gauge && typeof metric.gauge === 'object') {
          type = 'gauge'
          name = sanitized
          dataPoints = (
            metric.gauge as { dataPoints?: Array<Record<string, unknown>> }
          ).dataPoints
        } else {
          continue
        }
        if (name.startsWith(METRICS_PREFIX)) continue
        const series =
          childMetrics.get(name) ??
          ({
            help:
              typeof metric.description === 'string' ? metric.description : '',
            type,
            points: new Map(),
          } satisfies ChildMetricSeries)
        for (const dp of dataPoints ?? []) {
          const labels: Array<[string, string]> = []
          const seen = new Set<string>()
          if (sessionId !== undefined) {
            labels.push(['session_id', sessionId])
            seen.add('session_id')
          }
          if (clientPlatform !== undefined) {
            labels.push(['client_platform', clientPlatform])
            seen.add('client_platform')
          }
          for (const attr of (dp.attributes ?? []) as Array<{
            key?: string
            value?: unknown
          }>) {
            if (typeof attr.key !== 'string') continue
            const raw = otelAttrToString(attr.value)
            if (raw === undefined) continue
            const key = sanitizeMetricName(attr.key)
            if (key === '' || seen.has(key)) continue
            seen.add(key)
            labels.push([key, raw])
          }
          const labelStr =
            labels.length > 0
              ? `{${labels
                  .map(([k, v]) => `${k}="${promEscapeLabel(v)}"`)
                  .join(',')}}`
              : ''
          const num =
            typeof dp.asDouble === 'number'
              ? dp.asDouble
              : dp.asInt !== undefined
                ? Number(dp.asInt)
                : undefined
          if (num === undefined || !Number.isFinite(num)) continue
          series.points.set(labelStr, num)
        }
        childMetrics.set(name, series)
      }
    }
  }
}

/** densable `tqv` — render Prometheus text exposition */
export function renderPrometheusMetrics(
  state: RunnerHealthState,
  nowMs: number = Date.now(),
): string {
  const age = state.lastPollAt > 0 ? (nowMs - state.lastPollAt) / 1000 : 0
  const idLabels = `runner_id="${promEscapeLabel(state.runnerId)}",version="${promEscapeLabel(state.version)}",client_label="${promEscapeLabel(state.clientLabel)}"`
  const p = METRICS_PREFIX
  let out = ''
  out += `# HELP ${p}_info Self-hosted runner identity (info-style gauge; value is always 1).\n`
  out += `# TYPE ${p}_info gauge\n`
  out += `${p}_info{${idLabels}} 1\n`
  out += `# HELP ${p}_capacity Max concurrent sessions this runner accepts (--capacity).\n`
  out += `# TYPE ${p}_capacity gauge\n`
  out += `${p}_capacity ${state.capacity}\n`
  out += `# HELP ${p}_active_sessions Sessions currently being handled by this runner.\n`
  out += `# TYPE ${p}_active_sessions gauge\n`
  out += `${p}_active_sessions ${state.activeSessions}\n`

  const counters: Array<[string, Map<string, number>]> = [
    ['sessions_started_total', state.sessionsStarted],
    ['sessions_completed_total', state.sessionsCompleted],
    ['sessions_failed_total', state.sessionsFailed],
    ['sessions_interrupted_total', state.sessionsInterrupted],
  ]
  const helps: Record<string, string> = {
    sessions_started_total:
      "Session child processes spawned over the runner's lifetime. One increment per child spawn; a session that is re-spawned (runner restart, re-assignment) counts again. NOT comparable to the orchestrator's spawn_hooks_total (which counts orchestrator spawn-runner hook runs, including warm hints).",
    sessions_completed_total:
      "Session child processes that ended cleanly over the runner's lifetime: child exited 0, the server closed the session (archive/delete), or the runner released the slot as a clean handoff (idle release, startup timeout, server deassign). Drain/SIGTERM are NOT counted (those increment sessions_interrupted_total instead).",
    sessions_failed_total:
      "Session child processes that exited with a non-zero code over the runner's lifetime (crash, OOM, spawn error). Does NOT include idle-release or a server deassign the poll loop observed first (those count as completed); a deassign the child notices first via its epoch-409 exit still lands here.",
    sessions_interrupted_total:
      'Session child processes that were terminated for a non-session-outcome reason over its lifetime (drain/SIGTERM, max-lifetime watchdog, released=false backstop, or an external signal). Watchdog and external-signal kills are additionally reported to the server as session failures. Closes the accounting: started - (completed + failed + interrupted) equals the number of session children currently running.',
  }
  for (const [name, map] of counters) {
    out += `# HELP ${p}_${name} ${helps[name]}\n`
    out += `# TYPE ${p}_${name} counter\n`
    for (const [platform, n] of map) {
      out += `${p}_${name}{client_platform="${promEscapeLabel(platform)}"} ${n}\n`
    }
  }

  out += `# HELP ${p}_locked_account Present (value 1) once the runner is locked to an account; absent while fungible.\n`
  out += `# TYPE ${p}_locked_account gauge\n`
  if (state.lockedAccountEmail !== null) {
    out += `${p}_locked_account{email="${promEscapeLabel(state.lockedAccountEmail)}"} 1\n`
  }
  out += `# HELP ${p}_last_poll_age_seconds Seconds since the last successful pollWork return.\n`
  out += `# TYPE ${p}_last_poll_age_seconds gauge\n`
  out += `${p}_last_poll_age_seconds ${age}\n`
  out += `# HELP ${p}_poll_errors_total PollWork request failures by error kind (transport=no HTTP response; timeout=client deadline; 5xx/429/4xx by status). All five series present from process start so rate() works and absent() means process-down.\n`
  out += `# TYPE ${p}_poll_errors_total counter\n`
  for (const kind of POLL_ERROR_KINDS) {
    out += `${p}_poll_errors_total{error_kind="${kind}"} ${state.pollErrors[kind]}\n`
  }
  out += `# HELP ${p}_initializing_sessions Sessions currently in the init phase (handleSession entry to child system/init).\n`
  out += `# TYPE ${p}_initializing_sessions gauge\n`
  out += `${p}_initializing_sessions ${state.initializingSessions}\n`
  out += `# HELP ${p}_session_init_errors_total Sessions that exited as failed before the child reached init (checkout hook / git prep / token issue / pre-init child crash).\n`
  out += `# TYPE ${p}_session_init_errors_total counter\n`
  out += `${p}_session_init_errors_total ${state.sessionInitErrors}\n`
  out += `# HELP ${p}_session_init_duration_seconds Wall-clock seconds from session assignment to child init (successful inits only).\n`
  out += `# TYPE ${p}_session_init_duration_seconds histogram\n`
  const hist = state.sessionInitDurations
  for (let i = 0; i < SESSION_INIT_DURATION_BOUNDS.length; i++) {
    out += `${p}_session_init_duration_seconds_bucket{le="${SESSION_INIT_DURATION_BOUNDS[i]}"} ${hist.buckets[i]}\n`
  }
  out += `${p}_session_init_duration_seconds_bucket{le="+Inf"} ${hist.count}\n`
  out += `${p}_session_init_duration_seconds_sum ${hist.sum}\n`
  out += `${p}_session_init_duration_seconds_count ${hist.count}\n`
  out += `# HELP ${p}_session_start_hook_errors_total SessionStart hooks that reported an error outcome (nonzero exit, validation/spawn failure, or HTTP/MCP error; one per failing hook execution).\n`
  out += `# TYPE ${p}_session_start_hook_errors_total counter\n`
  out += `${p}_session_start_hook_errors_total ${state.sessionStartHookErrors}\n`
  out += `# HELP ${p}_session_idle_seconds Seconds since the session went idle (turn-end or awaiting-action); 0 while a turn is running, background work is pending, or the session is initializing. One series per active session; disappears at session end.\n`
  out += `# TYPE ${p}_session_idle_seconds gauge\n`
  for (const [sid, idleAt] of state.sessionIdle) {
    const sec = idleAt === null ? '0' : ((nowMs - idleAt) / 1000).toFixed(3)
    const platform =
      state.sessionClientPlatform.get(sid) ?? UNKNOWN_CLIENT_PLATFORM
    out += `${p}_session_idle_seconds{session_id="${promEscapeLabel(sid)}",client_platform="${promEscapeLabel(platform)}"} ${sec}\n`
  }
  for (const [name, series] of state.childMetrics ?? []) {
    const help = series.help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
    out += `# HELP ${name} ${help}\n`
    out += `# TYPE ${name} ${series.type}\n`
    for (const [labels, val] of series.points) {
      out += `${name}${labels} ${val}\n`
    }
  }
  return out
}

/**
 * densable `hFh` — HTTP server for GET /healthz, GET /metrics, POST /v1/metrics.
 * POST only from loopback; body ≤ 1 MiB.
 */
export function startHealthServer(
  port: number,
  state: RunnerHealthState,
  onStatus: (msg: string) => void,
): Server {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/metrics') {
      const remote = req.socket.remoteAddress
      if (
        remote !== '127.0.0.1' &&
        remote !== '::1' &&
        remote !== '::ffff:127.0.0.1'
      ) {
        res.writeHead(403).end()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_048_576) {
          tooLarge = true
          res.writeHead(413).end()
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (tooLarge) return
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          const body = JSON.parse(text) as unknown
          ingestChildOtlpMetrics(state, body)
          res.writeHead(200).end()
        } catch (err) {
          onStatus(
            `[runner:warn] /v1/metrics rejected malformed body: ${err instanceof Error ? err.message : String(err)}`,
          )
          res.writeHead(400).end()
        }
      })
      return
    }
    if (req.method === 'GET' && req.url === '/metrics') {
      const body = renderPrometheusMetrics(state)
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }
    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found\n')
      return
    }
    const now = Date.now()
    const age = state.lastPollAt > 0 ? now - state.lastPollAt : null
    const payload = JSON.stringify({
      status: 'ok',
      runner_id: state.runnerId,
      active_sessions: state.activeSessions,
      last_poll_at:
        state.lastPollAt > 0 ? new Date(state.lastPollAt).toISOString() : null,
      last_poll_age_ms: age,
    })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    })
    res.end(payload)
  })
  server.unref()
  let reported = false
  server.on('error', (err: Error) => {
    if (!server.listening) state.listeningOn = undefined
    if (!reported) {
      reported = true
      onStatus(
        `[runner:warn] /healthz listener failed on port ${port}: ${err.message} — continuing without health endpoint`,
      )
    }
  })
  // densable: n.listen(e, () => …) — no host bind override
  server.listen(port, () => {
    const addr = server.address()
    state.listeningOn =
      typeof addr === 'object' && addr !== null ? addr.port : port
    if (!reported) {
      reported = true
      onStatus(
        `[runner:health] /healthz and /metrics listening on :${state.listeningOn}`,
      )
    }
  })
  return server
}
