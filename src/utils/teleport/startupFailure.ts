/**
 * densable 2.1.251 #38 — `j8` / `K8` / `G8` / `Q_r.startup_failure`.
 * Poll object field is `startupFailure` (z6 maps `startup_failure`).
 */

/** densable G8 — last_init_error older than this is treated as terminal. */
export const CLOUD_INIT_ERROR_STALE_MS = 120_000

export type CloudInitError = {
  message?: unknown
  error_type?: unknown
  error_kind?: unknown
  recoverable?: unknown
  at?: unknown
}

export type SessionStartupFailureSource = {
  environment_kind?: string | null
  worker_status?: string | null
  status?: string | null
  external_metadata?: {
    last_init_error?: CloudInitError | null
  } | null
}

/**
 * densable K8 — prefer last_init_error.message; else typed kind.
 */
export function formatCloudEnvironmentStartError(e: CloudInitError): string {
  const t = typeof e.message === 'string' ? e.message.slice(0, 500).trim() : ''
  if (t && t !== '<nil>') return t
  const r = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
  const o = [e.error_type, e.error_kind].find(
    (u): u is string => typeof u === 'string' && r.test(u),
  )
  return o
    ? `the cloud environment failed to start (${o})`
    : 'the cloud environment failed to start'
}

/**
 * densable j8 — session metadata → startup_failure string, or undefined.
 */
export function deriveSessionStartupFailure(
  e: SessionStartupFailureSource,
  t: number,
): string | undefined {
  const r =
    e.environment_kind === 'bridge'
      ? null
      : (e.external_metadata?.last_init_error ?? null)
  if (r) {
    const o =
      e.worker_status === 'running' ||
      e.worker_status === 'idle' ||
      e.worker_status === 'requires_action'
    const u = String(r.recoverable) === 'true'
    const d = typeof r.at === 'string' ? Date.parse(r.at) : Number.NaN
    const A = Number.isFinite(d) && t - d > CLOUD_INIT_ERROR_STALE_MS
    if (r.error_kind === 'environment_deleted' || (!o && (!u || A))) {
      return formatCloudEnvironmentStartError(r)
    }
  }
  if (e.status === 'failed') {
    return 'the cloud environment could not be provisioned'
  }
  return undefined
}
