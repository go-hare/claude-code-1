/**
 * densable precompute compaction sidecar residual (gQt / hIg / Tvu pure half).
 *
 * densable:
 *   gQt(sessionId)  — transcript .jsonl → .precompact.json path
 *   hIg(payload)    — versioned sidecar schema check
 *   Tvu rehydrate   — session/model/age/growth/boundary/preserve checks
 *
 * Full arm/persist/consume pipeline (iXi/pvu/p8 Map) remains denser; these are
 * pure path + rehydrate decision helpers with matching analytics reason tags.
 */

export const PRECOMPACT_SIDECAR_VERSION = 1
/** densable XJi */
export const PRECOMPACT_SIDECAR_MAX_BYTES = 8_000_000
/** densable uvu */
export const PRECOMPACT_SIDECAR_SUFFIX = '.precompact.json'
/** densable yIg — 7 days */
export const PRECOMPACT_REHYDRATE_MAX_AGE_MS = 604_800_000
/** densable _Ig */
export const PRECOMPACT_REHYDRATE_MAX_GROWTH_TOKENS = 150_000
/** densable gvu — max arm attempts */
export const PRECOMPACT_ARM_MAX_ATTEMPTS = 3

export type PrecompactSidecarPayload = {
  version: number
  sessionId: string
  agentKey: 'main'
  model: string
  cliVersion: string
  createdAt: string
  precomputedAtUuid: string
  preCompactTokens: number
  readyDurationMs: number
  preCompactHookDisplay?: string
  summaryText: string
  summaryMessages: unknown[]
  preserveUuids: string[]
  attempt: number
  groupsPreserved: number
  totalGroups: number
  forkAssistantMessageCount: number
  totalUsage: Record<string, unknown>
}

export type PrecompactRehydrateRejectReason =
  | 'too_large'
  | 'absent'
  | 'parse_error'
  | 'version'
  | 'session_mismatch'
  | 'model_mismatch'
  | 'bad_timestamp'
  | 'too_old'
  | 'boundary_missing'
  | 'grew_too_much'
  | 'shrank_too_much'
  | 'preserve_uuid_missing'

/**
 * densable gQt — derive sidecar path from transcript path (or session id path).
 * If path ends with .jsonl, replace with .precompact.json; else append suffix.
 */
export function precompactSidecarPathFromTranscript(
  transcriptPath: string,
): string {
  if (transcriptPath.endsWith('.jsonl')) {
    return transcriptPath.slice(0, -'.jsonl'.length) + PRECOMPACT_SIDECAR_SUFFIX
  }
  return transcriptPath + PRECOMPACT_SIDECAR_SUFFIX
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' // densable kot — any string, empty allowed
}

function isSummaryMessage(v: unknown): boolean {
  return typeof v === 'object' && v !== null && 'message' in v && 'uuid' in v
}

/**
 * densable hIg — structural validate precompact sidecar payload.
 * Returns null when schema fails (caller maps to parse_error).
 */
export function parsePrecompactSidecarPayload(
  raw: unknown,
): PrecompactSidecarPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  if (!isFiniteNumber(t.version)) return null
  if (!isNonEmptyString(t.sessionId)) return null
  if (t.agentKey !== 'main') return null
  if (!isNonEmptyString(t.model)) return null
  if (!isNonEmptyString(t.cliVersion)) return null
  if (!isNonEmptyString(t.createdAt)) return null
  if (!isNonEmptyString(t.precomputedAtUuid)) return null
  if (!isFiniteNumber(t.preCompactTokens)) return null
  if (!isFiniteNumber(t.readyDurationMs)) return null
  if (
    t.preCompactHookDisplay !== undefined &&
    !isNonEmptyString(t.preCompactHookDisplay)
  ) {
    return null
  }
  if (!isNonEmptyString(t.summaryText)) return null
  if (!Array.isArray(t.summaryMessages) || t.summaryMessages.length === 0) {
    return null
  }
  if (!t.summaryMessages.every(isSummaryMessage)) return null
  if (
    !Array.isArray(t.preserveUuids) ||
    !t.preserveUuids.every(isNonEmptyString)
  ) {
    return null
  }
  if (!isFiniteNumber(t.attempt)) return null
  if (!isFiniteNumber(t.groupsPreserved)) return null
  if (!isFiniteNumber(t.totalGroups)) return null
  if (!isFiniteNumber(t.forkAssistantMessageCount)) return null
  if (typeof t.totalUsage !== 'object' || t.totalUsage === null) return null

  return {
    version: t.version,
    sessionId: t.sessionId,
    agentKey: 'main',
    model: t.model,
    cliVersion: t.cliVersion,
    createdAt: t.createdAt,
    precomputedAtUuid: t.precomputedAtUuid,
    preCompactTokens: t.preCompactTokens,
    readyDurationMs: t.readyDurationMs,
    ...(typeof t.preCompactHookDisplay === 'string'
      ? { preCompactHookDisplay: t.preCompactHookDisplay }
      : {}),
    summaryText: t.summaryText,
    summaryMessages: t.summaryMessages,
    preserveUuids: t.preserveUuids as string[],
    attempt: t.attempt,
    groupsPreserved: t.groupsPreserved,
    totalGroups: t.totalGroups,
    forkAssistantMessageCount: t.forkAssistantMessageCount,
    totalUsage: t.totalUsage as Record<string, unknown>,
  }
}

/**
 * densable version gate after parse — version must equal QJi (1).
 */
export function isPrecompactSidecarVersionOk(
  payload: Pick<PrecompactSidecarPayload, 'version'>,
): boolean {
  return payload.version === PRECOMPACT_SIDECAR_VERSION
}

export type PrecompactRehydrateInput = {
  payload: PrecompactSidecarPayload
  sessionId: string
  model: string
  /** Current message uuids (for boundary + preserve presence). */
  messageUuids: readonly string[]
  /** densable Fv(messages) current token estimate. */
  currentTokens: number
  nowMs?: number
  maxAgeMs?: number
  maxGrowthTokens?: number
}

export type PrecompactRehydrateResult =
  | {
      ok: true
      ageMs: number
      growthTokens: number
      preservedUuids: string[]
    }
  | { ok: false; reason: PrecompactRehydrateRejectReason; ageMs?: number }

/**
 * densable Tvu rehydrate decision half (no disk I/O, no p8 store mutation).
 */
export function evaluatePrecompactRehydrate(
  input: PrecompactRehydrateInput,
): PrecompactRehydrateResult {
  const payload = input.payload
  if (!isPrecompactSidecarVersionOk(payload)) {
    return { ok: false, reason: 'version' }
  }
  if (payload.sessionId !== input.sessionId) {
    return { ok: false, reason: 'session_mismatch' }
  }
  if (payload.model !== input.model) {
    return { ok: false, reason: 'model_mismatch' }
  }

  const now = input.nowMs ?? Date.now()
  const created = Date.parse(payload.createdAt)
  const ageMs = Math.max(0, now - created)
  if (!Number.isFinite(ageMs) || !Number.isFinite(created)) {
    return { ok: false, reason: 'bad_timestamp' }
  }
  const maxAge = input.maxAgeMs ?? PRECOMPACT_REHYDRATE_MAX_AGE_MS
  if (ageMs > maxAge) {
    return { ok: false, reason: 'too_old', ageMs }
  }

  if (!input.messageUuids.includes(payload.precomputedAtUuid)) {
    return { ok: false, reason: 'boundary_missing', ageMs }
  }

  const growth = input.currentTokens - payload.preCompactTokens
  const maxGrowth =
    input.maxGrowthTokens ?? PRECOMPACT_REHYDRATE_MAX_GROWTH_TOKENS
  if (growth > maxGrowth) {
    return { ok: false, reason: 'grew_too_much', ageMs }
  }
  if (growth < -(payload.preCompactTokens / 2)) {
    return { ok: false, reason: 'shrank_too_much', ageMs }
  }

  const present = new Set(input.messageUuids)
  const preserved: string[] = []
  for (const uuid of payload.preserveUuids) {
    if (!present.has(uuid)) {
      return { ok: false, reason: 'preserve_uuid_missing', ageMs }
    }
    preserved.push(uuid)
  }

  return {
    ok: true,
    ageMs,
    growthTokens: growth,
    preservedUuids: preserved,
  }
}

/**
 * densable oXi pure pre-arm gates (excluding hEu context-token threshold).
 */
export function shouldArmPrecomputeCompaction(input: {
  autocompactRan: boolean
  isPreFirstCompactFork: boolean
  hasAttemptedReactiveCompact: boolean
  lastTransitionReason?: string | null
  precomputeEnabled: boolean
  /** densable hEu result — token threshold already crossed. */
  pastPrecomputeTokenThreshold: boolean
}): boolean {
  if (input.autocompactRan) return false
  if (input.isPreFirstCompactFork) return false
  if (input.hasAttemptedReactiveCompact) return false
  if (input.lastTransitionReason === 'precomputed_compact_swap') return false
  if (!input.precomputeEnabled) return false
  return input.pastPrecomputeTokenThreshold
}

/**
 * densable hEu pure half — whether token usage has crossed precompute arm
 * threshold. When window is still "auto" (unconfigured), always compare to cJi;
 * when configured, densable also requires window >= model-default floor before
 * arming (caller passes windowIsConfigured + minConfiguredWindow).
 */
export function isPastPrecomputeArmThreshold(input: {
  tokenUsage: number
  armThreshold: number
  windowIsConfigured?: boolean
  configuredWindow?: number
  /** densable zve — typically 200_000 model-default floor. */
  minConfiguredWindow?: number
}): boolean {
  if (input.windowIsConfigured) {
    const floor = input.minConfiguredWindow ?? 200_000
    const win = input.configuredWindow ?? 0
    if (win < floor) return false
  }
  return input.tokenUsage >= input.armThreshold
}

/**
 * densable iXi arm-gate pure (no side effects / no fork spawn).
 * Returns reason tag when gated, else null (= may start arm).
 */
export function precomputeArmGateReason(input: {
  precomputeEnabled: boolean
  querySourceBlocked: boolean
  attempts: number
  maxAttempts?: number
  existingStatus?: 'pending' | 'ready' | 'failed' | null
  lastMessageUuid?: string | null
  sdkUserPromptCount?: number
  sdkHistoryRewritten?: boolean
}): string | null {
  if (!input.precomputeEnabled) return 'precompute_disabled'
  if (input.querySourceBlocked) return 'query_source_blocked'
  const max = input.maxAttempts ?? PRECOMPACT_ARM_MAX_ATTEMPTS
  if (input.attempts >= max) return 'rearm_capped'
  if (
    input.existingStatus !== undefined &&
    input.existingStatus !== null &&
    input.existingStatus !== 'failed'
  ) {
    return 'already_armed'
  }
  if (!input.lastMessageUuid) return 'no_boundary_uuid'
  if (
    input.sdkUserPromptCount !== undefined &&
    input.sdkUserPromptCount <= 1 &&
    !input.sdkHistoryRewritten
  ) {
    return 'sdk_single_prompt_gate'
  }
  return null
}

/** densable yQt — agentId default main. */
export function precomputeAgentKey(agentId?: string | null): string {
  return agentId ?? 'main'
}
