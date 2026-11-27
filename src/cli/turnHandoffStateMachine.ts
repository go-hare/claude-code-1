/**
 * Official 2.1.331 client multi-tenant worker `turn_handoff` state machine
 * (aligned with chunks #193, #492, #2484, #2520).
 *
 * Scoped per root session via `RootSessionSlot` so multiple tenants sharing one
 * process never collide on `workerEpoch`, staged files, carried writes, or
 * multi-tenant shutdown state.
 */
import { createHash } from 'node:crypto'
import {
  getBootstrapSession,
  RootSessionSlot,
  type Session,
} from 'src/utils/sessionRoot.js'
import { z } from 'zod/v4'

export const TURN_HANDOFF_VERSION = 1 as const

export const TURN_HANDOFF_DEFAULT_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
] as const

/** Official chunk #492 `gr = 200` cap on carried snapshot entries/messages. */
export const TURN_HANDOFF_MAX_ITEMS = 200

/** Maximum serialized UTF-8 byte budget for a turn_handoff snapshot (4 MiB). */
export const TURN_HANDOFF_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

/** Upper bound on `worker_epoch` so `worker_epoch + 1` always stays a safe integer. */
export const TURN_HANDOFF_MAX_WORKER_EPOCH = Number.MAX_SAFE_INTEGER - 1

export type TurnHandoffAdmission =
  | {
      admitted: true
      tools: readonly string[]
      hydratesCarriedLines: boolean
      answersComparisonFork?: boolean
    }
  | {
      admitted: false
      reason: 'not_managed_cloud_worker' | 'disabled'
    }

export type TurnHandoffAdmissionInput = {
  remoteSessionId?: string | null
  environmentKind?: string
  disabled?: boolean
  tools?: readonly string[]
  hydratesCarriedLines?: boolean
  answersComparisonFork?: boolean
}

export function evaluateTurnHandoffAdmission(
  input: TurnHandoffAdmissionInput,
): TurnHandoffAdmission {
  if (input.disabled) {
    return { admitted: false, reason: 'disabled' }
  }
  if (!input.remoteSessionId && input.environmentKind === undefined) {
    return { admitted: false, reason: 'not_managed_cloud_worker' }
  }
  return {
    admitted: true,
    tools: input.tools ?? TURN_HANDOFF_DEFAULT_TOOLS,
    hydratesCarriedLines: input.hydratesCarriedLines === true,
    ...(input.answersComparisonFork ? { answersComparisonFork: true } : {}),
  }
}

/**
 * Official 2.1.331 `g5r`: relay_marker is advertised only when turn handoff is
 * admitted, relay is configured, transcript persistence is on, and the worker
 * is NOT running on a shared backend.
 */
export function shouldAdvertiseTurnHandoffRelayMarker(input: {
  admission: TurnHandoffAdmission
  relayConfigured: boolean
  persistsTranscript: boolean
  sharedBackend: boolean
}): boolean {
  return (
    input.admission.admitted &&
    input.relayConfigured &&
    input.persistsTranscript &&
    !input.sharedBackend
  )
}

export type TurnHandoffAdvertisedCapability = {
  v: typeof TURN_HANDOFF_VERSION
  tools: readonly string[]
  worker_epoch: number
  staged_files: true
  no_query_first: true
  shared_message_id: true
  requires_rewind_request_id: true
  relay_marker?: true
  home_files?: true
  file_names?: true
  carried_writes?: true
  hydrates_carried_lines?: true
  comparison_fork?: true
}

/**
 * Official 2.1.331 `sr`: builds the exact `initialize` wire capability block
 * for `turn_handoff`.
 */
export function buildTurnHandoffCapability(
  admission: TurnHandoffAdmission,
  opts: {
    workerEpoch: number
    relayMarker?: boolean
    homeFiles?: boolean
    carriedWrites?: boolean
  },
): { turn_handoff: TurnHandoffAdvertisedCapability | null } | undefined {
  if (!admission.admitted) {
    if (admission.reason === 'disabled') {
      return { turn_handoff: null }
    }
    return undefined
  }
  return {
    turn_handoff: {
      v: TURN_HANDOFF_VERSION,
      tools: admission.tools,
      worker_epoch: opts.workerEpoch,
      staged_files: true,
      no_query_first: true,
      shared_message_id: true,
      requires_rewind_request_id: true,
      ...(opts.relayMarker ? { relay_marker: true as const } : {}),
      ...(opts.homeFiles
        ? {
            home_files: true as const,
            file_names: true as const,
            ...(opts.carriedWrites ? { carried_writes: true as const } : {}),
          }
        : {}),
      ...(admission.hydratesCarriedLines
        ? { hydrates_carried_lines: true as const }
        : {}),
      ...(admission.answersComparisonFork
        ? { comparison_fork: true as const }
        : {}),
    },
  }
}

const WINDOWS_RESERVED_DEVICE_RE =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i

/**
 * Security guard for relative handoff paths: rejects empty strings, ASCII
 * control characters, leading/trailing whitespace, colons (drive prefixes /
 * NTFS ADS), Windows reserved device names, POSIX/Windows absolute paths,
 * empty segments, and `.` / `..` segments.
 */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) {
    return false
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII control character rejection
  if (/[\x00-\x1f\x7f]/.test(value)) {
    return false
  }
  if (value.includes(':')) {
    return false
  }
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/')) {
    return false
  }
  const segments = normalized.split('/')
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment !== segment.trim() ||
      WINDOWS_RESERVED_DEVICE_RE.test(segment)
    ) {
      return false
    }
  }
  return true
}

export const safeRelativePathSchema = z
  .string()
  .min(1)
  .refine(isSafeRelativePath, {
    message:
      'Path must be a safe relative path without NUL bytes, colons, reserved device names, absolute root, or .. traversal',
  })
  .transform(value => value.replace(/\\/g, '/'))

export const TurnHandoffStagedFileSchema = z.object({
  path: safeRelativePathSchema,
  content: z.string(),
  sha256: z.string().optional(),
  mtime_ms: z.number().optional(),
})

export const TurnHandoffCarriedWriteSchema = z.object({
  path: safeRelativePathSchema,
  content: z.string(),
  mode: z.enum(['create', 'update', 'delete']).default('update'),
})

export const TurnHandoffHomeFileSchema = z.object({
  name: safeRelativePathSchema,
  content: z.string(),
})

function serializedUtf8ByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      return null
    }
    return Buffer.byteLength(serialized, 'utf8')
  } catch {
    return null
  }
}

export const TurnHandoffSnapshotSchema = z.object({
  v: z.literal(TURN_HANDOFF_VERSION),
  worker_epoch: z.number().int().positive().max(TURN_HANDOFF_MAX_WORKER_EPOCH),
  session_id: z.string().min(1),
  shared_message_id: z.string().min(1).optional(),
  rewind_request_id: z.string().min(1).optional(),
  multi_tenant_worker_shutdown: z.boolean().optional(),
  staged_files: z
    .array(TurnHandoffStagedFileSchema)
    .max(TURN_HANDOFF_MAX_ITEMS)
    .optional(),
  carried_writes: z
    .array(TurnHandoffCarriedWriteSchema)
    .max(TURN_HANDOFF_MAX_ITEMS)
    .optional(),
  home_files: z
    .array(TurnHandoffHomeFileSchema)
    .max(TURN_HANDOFF_MAX_ITEMS)
    .optional(),
  messages: z.array(z.unknown()).max(TURN_HANDOFF_MAX_ITEMS).optional(),
})

export type TurnHandoffStagedFile = z.infer<typeof TurnHandoffStagedFileSchema>
export type TurnHandoffCarriedWrite = z.infer<
  typeof TurnHandoffCarriedWriteSchema
>
export type TurnHandoffHomeFile = z.infer<typeof TurnHandoffHomeFileSchema>
export type TurnHandoffSnapshot = z.infer<typeof TurnHandoffSnapshotSchema>

export type TurnHandoffHydrateResult =
  | {
      ok: true
      appliedEpoch: number
      stagedCount: number
      carriedWriteCount: number
      homeFileCount: number
      droppedMessages: number
    }
  | {
      ok: false
      error: string
    }

export type TurnHandoffControlRequest = {
  subtype: 'turn_handoff'
  request_id?: string
  action?: 'hydrate' | 'export'
  session_id?: string
  shared_message_id?: string
  rewind_request_id?: string
  payload?: unknown
}

export type TurnHandoffControlResponse =
  | {
      ok: true
      action: 'hydrate'
      request_id?: string
      appliedEpoch: number
      stagedCount: number
      carriedWriteCount: number
      homeFileCount: number
      droppedMessages: number
    }
  | {
      ok: true
      action: 'export'
      request_id?: string
      snapshot: TurnHandoffSnapshot
    }
  | {
      ok: false
      request_id?: string
      error: string
    }

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function setCappedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxItems: number = TURN_HANDOFF_MAX_ITEMS,
): void {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)
  while (map.size > maxItems) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

export class TurnHandoffManager {
  #workerEpoch = 0
  #stagedFiles = new Map<string, TurnHandoffStagedFile>()
  #carriedWrites = new Map<string, TurnHandoffCarriedWrite>()
  #homeFiles = new Map<string, TurnHandoffHomeFile>()
  #hydratedMessages: unknown[] = []
  #multiTenantShutdownAborted = false
  #lastSessionId: string | undefined
  #lastSharedMessageId: string | undefined
  #lastRewindRequestId: string | undefined

  get workerEpoch(): number {
    return this.#workerEpoch
  }

  get stagedFiles(): ReadonlyMap<string, TurnHandoffStagedFile> {
    return this.#stagedFiles
  }

  get carriedWrites(): ReadonlyMap<string, TurnHandoffCarriedWrite> {
    return this.#carriedWrites
  }

  get homeFiles(): ReadonlyMap<string, TurnHandoffHomeFile> {
    return this.#homeFiles
  }

  get hydratedMessages(): readonly unknown[] {
    return this.#hydratedMessages
  }

  get multiTenantShutdownAborted(): boolean {
    return this.#multiTenantShutdownAborted
  }

  get lastSessionId(): string | undefined {
    return this.#lastSessionId
  }

  get lastSharedMessageId(): string | undefined {
    return this.#lastSharedMessageId
  }

  get lastRewindRequestId(): string | undefined {
    return this.#lastRewindRequestId
  }

  stageFile(relPath: string, content: string): TurnHandoffStagedFile {
    const validatedPath = safeRelativePathSchema.parse(relPath)
    const entry: TurnHandoffStagedFile = {
      path: validatedPath,
      content,
      sha256: sha256Hex(content),
      mtime_ms: Date.now(),
    }
    setCappedMapEntry(this.#stagedFiles, validatedPath, entry)
    return entry
  }

  recordCarriedWrite(
    relPath: string,
    content: string,
    mode: 'create' | 'update' | 'delete' = 'update',
  ): TurnHandoffCarriedWrite {
    const validatedPath = safeRelativePathSchema.parse(relPath)
    const entry: TurnHandoffCarriedWrite = {
      path: validatedPath,
      content,
      mode,
    }
    setCappedMapEntry(this.#carriedWrites, validatedPath, entry)
    return entry
  }

  recordHomeFile(name: string, content: string): TurnHandoffHomeFile {
    const validatedName = safeRelativePathSchema.parse(name)
    const entry: TurnHandoffHomeFile = {
      name: validatedName,
      content,
    }
    setCappedMapEntry(this.#homeFiles, validatedName, entry)
    return entry
  }

  /**
   * Official chunk #193: marks that the host of a multi-tenant worker shut the
   * worker down while this turn ran, leaving the turn for the next worker.
   */
  markMultiTenantWorkerShutdown(): void {
    this.#multiTenantShutdownAborted = true
  }

  exportHandoffSnapshot(opts: {
    sessionId: string
    sharedMessageId?: string
    rewindRequestId?: string
    messages?: readonly unknown[]
  }): TurnHandoffSnapshot {
    if (!opts.sessionId || opts.sessionId.trim().length === 0) {
      throw new Error('exportHandoffSnapshot requires a non-empty sessionId')
    }

    if (this.#workerEpoch >= TURN_HANDOFF_MAX_WORKER_EPOCH) {
      throw new Error(
        `Turn handoff worker_epoch exceeded safe bound (${TURN_HANDOFF_MAX_WORKER_EPOCH})`,
      )
    }

    const nextEpoch = this.#workerEpoch + 1
    const sharedMessageId = opts.sharedMessageId ?? this.#lastSharedMessageId
    const rewindRequestId = opts.rewindRequestId ?? this.#lastRewindRequestId
    const stagedFiles = [...this.#stagedFiles.values()].slice(
      -TURN_HANDOFF_MAX_ITEMS,
    )
    const carriedWrites = [...this.#carriedWrites.values()].slice(
      -TURN_HANDOFF_MAX_ITEMS,
    )
    const homeFiles = [...this.#homeFiles.values()].slice(
      -TURN_HANDOFF_MAX_ITEMS,
    )
    const sourceMessages = opts.messages ?? this.#hydratedMessages
    const messages =
      sourceMessages.length > 0
        ? sourceMessages.slice(-TURN_HANDOFF_MAX_ITEMS)
        : undefined

    const candidate: TurnHandoffSnapshot = {
      v: TURN_HANDOFF_VERSION,
      worker_epoch: nextEpoch,
      session_id: opts.sessionId,
      ...(sharedMessageId !== undefined
        ? { shared_message_id: sharedMessageId }
        : {}),
      ...(rewindRequestId !== undefined
        ? { rewind_request_id: rewindRequestId }
        : {}),
      ...(this.#multiTenantShutdownAborted
        ? { multi_tenant_worker_shutdown: true }
        : {}),
      ...(stagedFiles.length > 0 ? { staged_files: stagedFiles } : {}),
      ...(carriedWrites.length > 0 ? { carried_writes: carriedWrites } : {}),
      ...(homeFiles.length > 0 ? { home_files: homeFiles } : {}),
      ...(messages !== undefined ? { messages } : {}),
    }

    const candidateBytes = serializedUtf8ByteLength(candidate)
    if (
      candidateBytes === null ||
      candidateBytes > TURN_HANDOFF_MAX_PAYLOAD_BYTES
    ) {
      throw new Error(
        `Turn handoff snapshot exceeds ${TURN_HANDOFF_MAX_PAYLOAD_BYTES} byte budget`,
      )
    }

    const validated = TurnHandoffSnapshotSchema.parse(candidate)
    this.#workerEpoch = nextEpoch
    this.#lastSessionId = opts.sessionId
    this.#lastSharedMessageId = sharedMessageId
    this.#lastRewindRequestId = rewindRequestId
    return validated
  }

  hydrateFromHandoffSnapshot(raw: unknown): TurnHandoffHydrateResult {
    const rawBytes = serializedUtf8ByteLength(raw)
    if (rawBytes === null) {
      return {
        ok: false,
        error: 'Turn handoff snapshot is not JSON-serializable',
      }
    }
    if (rawBytes > TURN_HANDOFF_MAX_PAYLOAD_BYTES) {
      return {
        ok: false,
        error: `Turn handoff snapshot exceeds ${TURN_HANDOFF_MAX_PAYLOAD_BYTES} byte budget (got ${rawBytes} bytes)`,
      }
    }

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        error: 'Turn handoff snapshot must be a JSON object',
      }
    }

    const record = raw as Record<string, unknown>
    let droppedMessages = 0
    let candidate: Record<string, unknown> = record
    if (
      Array.isArray(record.messages) &&
      record.messages.length > TURN_HANDOFF_MAX_ITEMS
    ) {
      droppedMessages = record.messages.length - TURN_HANDOFF_MAX_ITEMS
      candidate = {
        ...record,
        messages: record.messages.slice(-TURN_HANDOFF_MAX_ITEMS),
      }
    }

    const parsed = TurnHandoffSnapshotSchema.safeParse(candidate)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const issuePath =
        issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return {
        ok: false,
        error: `Invalid turn_handoff snapshot: ${issuePath}${issue?.message ?? parsed.error.message}`,
      }
    }

    const snapshot = parsed.data
    if (snapshot.worker_epoch <= this.#workerEpoch) {
      return {
        ok: false,
        error: `Stale worker_epoch rollback rejected: received ${snapshot.worker_epoch}, current ${this.#workerEpoch}`,
      }
    }

    // Verify all declared staged file SHA-256 digests before mutating state
    const verifiedStagedFiles: TurnHandoffStagedFile[] = []
    for (const file of snapshot.staged_files ?? []) {
      const computedSha = sha256Hex(file.content)
      if (
        file.sha256 !== undefined &&
        file.sha256.toLowerCase() !== computedSha
      ) {
        return {
          ok: false,
          error: `Staged file "${file.path}" sha256 mismatch`,
        }
      }
      verifiedStagedFiles.push({
        path: file.path,
        content: file.content,
        sha256: computedSha,
        ...(file.mtime_ms !== undefined ? { mtime_ms: file.mtime_ms } : {}),
      })
    }

    this.#workerEpoch = snapshot.worker_epoch
    this.#lastSessionId = snapshot.session_id
    this.#lastSharedMessageId = snapshot.shared_message_id
    this.#lastRewindRequestId = snapshot.rewind_request_id
    this.#multiTenantShutdownAborted =
      snapshot.multi_tenant_worker_shutdown === true

    this.#stagedFiles.clear()
    for (const file of verifiedStagedFiles) {
      setCappedMapEntry(this.#stagedFiles, file.path, file)
    }

    this.#carriedWrites.clear()
    for (const write of snapshot.carried_writes ?? []) {
      setCappedMapEntry(this.#carriedWrites, write.path, {
        path: write.path,
        content: write.content,
        mode: write.mode,
      })
    }

    this.#homeFiles.clear()
    for (const homeFile of snapshot.home_files ?? []) {
      setCappedMapEntry(this.#homeFiles, homeFile.name, {
        name: homeFile.name,
        content: homeFile.content,
      })
    }

    this.#hydratedMessages = snapshot.messages ? [...snapshot.messages] : []

    return {
      ok: true,
      appliedEpoch: snapshot.worker_epoch,
      stagedCount: this.#stagedFiles.size,
      carriedWriteCount: this.#carriedWrites.size,
      homeFileCount: this.#homeFiles.size,
      droppedMessages,
    }
  }

  handleControlRequest(
    req: TurnHandoffControlRequest,
  ): TurnHandoffControlResponse {
    if (req.payload !== undefined || req.action === 'hydrate') {
      const hydrated = this.hydrateFromHandoffSnapshot(req.payload)
      if (!hydrated.ok) {
        return {
          ok: false,
          ...(req.request_id !== undefined
            ? { request_id: req.request_id }
            : {}),
          error: hydrated.error,
        }
      }
      return {
        ok: true,
        action: 'hydrate',
        ...(req.request_id !== undefined ? { request_id: req.request_id } : {}),
        appliedEpoch: hydrated.appliedEpoch,
        stagedCount: hydrated.stagedCount,
        carriedWriteCount: hydrated.carriedWriteCount,
        homeFileCount: hydrated.homeFileCount,
        droppedMessages: hydrated.droppedMessages,
      }
    }

    const sessionId = req.session_id ?? this.#lastSessionId
    if (!sessionId) {
      return {
        ok: false,
        ...(req.request_id !== undefined ? { request_id: req.request_id } : {}),
        error:
          'turn_handoff control request requires payload (for hydrate) or session_id (for export)',
      }
    }

    try {
      const snapshot = this.exportHandoffSnapshot({
        sessionId,
        sharedMessageId: req.shared_message_id,
        rewindRequestId: req.rewind_request_id,
      })
      return {
        ok: true,
        action: 'export',
        ...(req.request_id !== undefined ? { request_id: req.request_id } : {}),
        snapshot,
      }
    } catch (err) {
      return {
        ok: false,
        ...(req.request_id !== undefined ? { request_id: req.request_id } : {}),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

const turnHandoffManagerSlot = new RootSessionSlot<TurnHandoffManager>(
  () => new TurnHandoffManager(),
)

export function getTurnHandoffManager(
  session: Session = getBootstrapSession(),
): TurnHandoffManager {
  return turnHandoffManagerSlot.of(session)
}

export function resetTurnHandoffManager(
  session: Session = getBootstrapSession(),
): void {
  turnHandoffManagerSlot.drop(session)
}
