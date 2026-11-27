import type { AgentId } from '../../types/ids.js'
import type { Entry, LogOption, TranscriptMessage } from '../../types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import type { UUID } from 'crypto'

// Cache MACRO.VERSION at module level to work around bun --define bug in async contexts
// See: https://github.com/oven-sh/bun/issues/26168
export const VERSION = typeof MACRO !== 'undefined' ? MACRO.VERSION : 'unknown'

export type Transcript = (
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
)[]

// Use getOriginalCwd() at each call site instead of capturing at module load
// time. getCwd() at import time may run before bootstrap resolves symlinks via
// realpathSync, causing a different sanitized project directory than what
// getOriginalCwd() returns after bootstrap. This split-brain made sessions
// saved under one path invisible when loaded via the other.

/**
 * Pre-compiled regex to skip non-meaningful messages when extracting first prompt.
 * Matches anything starting with a lowercase XML-like tag (IDE context, hook
 * output, task notifications, channel messages, etc.) or a synthetic interrupt
 * marker. Kept in sync with sessionStoragePortable.ts — generic pattern avoids
 * an ever-growing allowlist that falls behind as new notification types ship.
 */
// 50MB — prevents OOM in the tombstone slow path which reads + rewrites the
// entire session file. Session files can grow to multiple GB (inc-3930).
export const MAX_TOMBSTONE_REWRITE_BYTES = 50 * 1024 * 1024

export const SKIP_FIRST_PROMPT_PATTERN =
  /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/

export type LegacyProgressEntry = {
  type: 'progress'
  uuid: UUID
  parentUuid: UUID | null
}

export type InternalEventWriter = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    isCompaction?: boolean
    agentId?: string
    /** densable preservedEventIds on compact_boundary uploads */
    preservedEventIds?: string[]
  },
) => Promise<void>

/**
 * densable leftover eQe?.() — official He/fi/Jre live binding probe.
 * Optional (`eQe?.()`). Official `e9s`/`TUa` has no JS caller. Do not invent
 * a product setter.
 */
export type ForeignSessionBinding = {
  foreign: boolean
  boundSid?: string
}

/**
 * densable internal-event read result (Q0a reader).
 * `events` may be a bare array for legacy readers; prefer the object form
 * with optional stats/anchorFallback for delta rehydrate.
 */
export type InternalEventReadResult = {
  events: Array<{
    payload: Record<string, unknown>
    agent_id?: string
    /** densable session_agent_id on subagent stream */
    session_agent_id?: string
    event_id?: string
  }>
  stats?: {
    pageCount?: number
    bytesReceived?: number | null
    contentEncoding?: string
  }
  /**
   * densable paginatedGet anchorFallback — after_event_id was rejected or
   * not found; result is a full refetch without the anchor.
   */
  anchorFallback?: 'rejected' | 'not-found'
}

export type InternalEventReader = (afterEventId?: string) => Promise<
  | InternalEventReadResult
  | Array<{
      payload: Record<string, unknown>
      agent_id?: string
      session_agent_id?: string
      event_id?: string
    }>
  | null
>

/**
 * densable Project.internalAgentEventReader — `fetchAgentTranscriptOnce(s,e,n,r,g)`
 * calls `e(n,s)` (agentId, AbortSignal). Distinct from session CCR reader.
 */
export type LeftoverInternalAgentEventReader = (
  agentId: string,
  signal?: AbortSignal,
) => Promise<unknown>

/**
 * Prefetch triple from densable RemoteIO hydratePrefetch:
 * [foregroundRead, subagentRead, tipValidation]
 */
export type CCRHydratePrefetch = [
  InternalEventReadResult | null | undefined,
  InternalEventReadResult | null | undefined,
  { eventId?: string; fallbackReason?: string } | undefined,
]

export type SidecarTextStorage = {
  readText?: (keys: readonly unknown[]) => Promise<
    | {
        ok: true
        value: {
          items: ReadonlyArray<
            | { found: boolean; value?: string | null }
            | { ok: boolean; value?: string | null }
          >
        }
      }
    | { ok: false; error?: { code?: string } }
  >
  write?: (
    key: unknown,
    value: string | Uint8Array,
    opts?: { mode?: number },
  ) => Promise<{ ok: boolean; error?: { code?: string } }>
  delete?: (key: unknown) => Promise<{ ok: boolean; error?: { code?: string } }>
  stat?: (key: unknown) => Promise<{ ok: boolean; error?: { code?: string } }>
}

export type FileTailWindow = {
  content: string
  bytesRead: number
  bytesTotal: number
}

export const REMOTE_FLUSH_INTERVAL_MS = 10

export type LeftoverParkedAppend = {
  entry: Entry
  storageV5?: unknown
  opts?: { tornTailEntry?: Entry; onlyIfExists?: boolean }
  resolve: () => void
  reject: (error: unknown) => void
}

// Limit the number of cached session-file lookups to prevent unbounded Map growth
// in long-running daemon / swarm sessions that spawn many sub-agents.
export const MAX_CACHED_SESSION_FILES = 200

// ---------------------------------------------------------------------------
// #1912 — Linux NFS statfs (0x6969) append sync() & fullDiskCode propagation
// Official `H5e` + `VYt` + `z5e.fullDiskCode` / `fullDiskPaths`
// ---------------------------------------------------------------------------

/** Linux NFS_SUPER_MAGIC (`0x6969` = 26985). */
export const NFS_SUPER_MAGIC = 0x6969
export const NFS_STATFS_UNSUPPORTED_CODES = new Set([
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
])
export const NFS_STATFS_TIMEOUT_MS = 1_000
export const FULL_DISK_ERRNO_CODES = new Set(['ENOSPC', 'EDQUOT'])

export type TranscriptFullDiskCode = 'ENOSPC' | 'EDQUOT'

export type TranscriptFullDiskState = {
  fullDiskCode: TranscriptFullDiskCode | undefined
  fullDiskPaths: Set<string>
}

export type StatfsFn = (dir: string) => Promise<{ type: number | bigint }>

export type TeamInfo = {
  teamName?: string
  agentName?: string
}

// Filter out already-recorded messages before passing to insertMessageChain.
// Without this, after compaction messagesToKeep (same UUIDs as pre-compact
// messages) are dedup-skipped by appendEntry but still advance the parentUuid
// cursor in insertMessageChain, causing new messages to chain from pre-compact
// UUIDs instead of the post-compact summary — orphaning the compact boundary.
//
// `startingParentUuidHint`: used by useLogMessages to pass the parent from
// the previous incremental slice, avoiding an O(n) scan to rediscover it.
//
// Skip-tracking: already-recorded messages are tracked as the parent ONLY if
// they form a PREFIX (appear before any new message). This handles both cases:
//  - Growing-array callers (QueryEngine, queryHelpers, LocalMainSessionTask,
//    trajectory): recorded messages are always a prefix → tracked → correct
//    parent chain for new messages.
//  - Compaction (useLogMessages): new CB/summary appear FIRST, then recorded
//    messagesToKeep → not a prefix → not tracked → CB gets parentUuid=null
//    (correct: truncates --continue chain at compact boundary).
/**
 * Official 2.1.323 #1981 (`Otn` / `F1`, cap 4096): UUIDs that must NEVER be
 * chosen as `parentUuid` for subsequent messages — e.g. old interrupted
 * messages that were not resumed, or out-of-order reordered transcript rows.
 */
export const MAX_NOT_CHAIN_PARENT_UUIDS = 4096

export const FILE_ARRIVAL_ATTACHMENT_TYPES = new Set([
  'file',
  'directory',
  'pdf_reference',
  'compact_file_reference',
  'already_read_file',
  'at_mention_reference',
  'nested_memory',
])

// ── Official CLAUDE_CODE_TRANSCRIPT_LOCAL_GC (#530, #543, #968) ──────────────
export const TRANSCRIPT_COMPACT_MIN_BYTES = 5_242_880 // SEA L9i (5 MiB)
export const TRANSCRIPT_COMPACT_BACKSTOP_BYTES = 20_971_520 // SEA O4 (20 MiB)
export const LOW_YIELD_COMPACT_RATIO = 0.1

/**
 * Official 2.1.328 (`chunk@294254613.js @397500`, `Spr` / `BZe` / `WZe`):
 * per-type retention policy for local transcript GC.
 */
export type GcRowDisposition =
  | 'transcript'
  | 'boundary-cleared'
  | 'accumulate'
  | 'last-wins'

/**
 * Official 2.1.328 (`Sfs = 1e4`, `chunk@285198511.js`): maximum length of
 * `toolUseResult.originalFile` retained when writing transcript rows.
 */
export const MAX_ORIGINAL_FILE_STORAGE_CHARS = 10_000

export type StripForStorageTool = {
  name: string
  aliases?: readonly string[]
  stripForStorage?: (output: unknown, verbose?: boolean) => unknown
}

/**
 * Splice the preserved segment back into the chain after compaction.
 *
 * Preserved messages exist in the JSONL with their ORIGINAL pre-compact
 * parentUuids (recordTranscript dedup-skipped them — can't rewrite).
 * The internal chain (keep[i+1]→keep[i]) is intact; only endpoints need
 * patching: head→anchor, and anchor's other children→tail. Anchor is the
 * last summary for suffix-preserving, boundary itself for prefix-preserving.
 *
 * Only the LAST seg-boundary is relinked — earlier segs were summarized
 * into it. Everything physically before the absolute-last boundary (except
 * preservedUuids) is deleted, which handles all multi-boundary shapes
 * without special-casing.
 *
 * Mutates the Map in place.
 */
export type PreservedMessagesRef = {
  anchorUuid: UUID
  uuids: UUID[]
  allUuids?: UUID[]
}

export type PreservedCompactMeta =
  SystemCompactBoundaryMessage['compactMetadata'] & {
    preservedMessages?: PreservedMessagesRef
  }

/**
 * Builds a conversation chain from a leaf message to root
 * @param messages Map of all messages
/**
 * Official 2.1.326 #30 (`r_r` / `s_r` / `i_r`): maximum number of dangling
 * `parentUuid` gaps bridged while reconstructing a resumed conversation chain
 * (e.g. after a crash when a previous turn ended with an empty reply).
 */
export const MAX_CHAIN_GAP_BRIDGES = 16

/**
 * Official 2.1.328 (#370) `tqs`: warning text shown as a non-persisted system
 * message when part of a resumed session's transcript file is missing or
 * damaged and earlier messages could not be loaded.
 */
export const MISSING_EARLIER_MESSAGES_WARNING =
  "Earlier messages couldn't be loaded because part of this session's file is missing or damaged. Claude won't see them, so repeat anything it still needs."

export const PUT_BACK_MAX_ROWS = 100
export const DISALLOWED_PUT_BACK_ATTACHMENT_TYPES = new Set<string | undefined>(
  [undefined, 'queued_command', 'project_doc_reads', 'message_pdf_reads'],
)

/**
 * Official 2.1.328 (#646) `orn` / `rrn` / `ptt`: bounded 1024-entry map from
 * assistant `tool_use` ID -> tool name used during transcript load to strip
 * duplicated large payloads (`base64`, `content`, `stdout`, `stderr`,
 * `originalFile`) from `toolUseResult` on resume while preserving `message.content`.
 */
export const SLIM_TOOL_USE_WINDOW_MAX = 1024

export const CHAIN_TIMESTAMP_FALLBACK_WINDOW_MS = 5_000

export type TimedFallbackEntry = {
  time: number
  entry: TranscriptMessage
}

type TimedFallbackIndex = {
  timedEntries: TimedFallbackEntry[]
  previousCandidate: Int32Array
}

export type TimedFallbackState = {
  entriesBySide?: Map<boolean, TranscriptMessage[]>
  timedSides: Map<boolean, TimedFallbackIndex>
}

/** densable leftover `_585` `V`. */
export const SIDECAR_KEY_MAX_REL_PATH_SEGMENTS = 6

export type SessionSidecarKey = {
  namespace: 'sidecar'
  projectKey: string
  sessionId: string
  relPath: string[]
}

export type TitleSidecarStorage = {
  write: (
    key: unknown,
    value: string,
    opts?: { mode?: number },
  ) => Promise<{ ok: boolean; error?: { code?: string } }>
  delete: (key: unknown) => Promise<{ ok: boolean; error?: { code?: string } }>
}

/** densable leftover `kno=1e5`. */
export const HISTORY_SUPPRESSION_SCAN_LINE_LIMIT = 100_000

/** densable leftover `$ib` / `uE` / `ajb` bind — `{backend,key}`. */
export type TranscriptPersistenceBind = {
  backend: unknown
  key: {
    namespace: 'transcript'
    projectKey: string
    sessionId: string
    agentId?: string
    agentRelPath?: string[]
  }
}

export type LeftoverStorageV5Append = {
  append: (
    key: unknown,
    records: Array<{ data: string | Uint8Array; recordId?: string }>,
    opts?: { precondition?: { type?: string } },
  ) => Promise<{ ok: boolean; error?: { code?: string } }>
  stat?: (key: unknown) => Promise<{
    ok: boolean
    error?: { code?: string }
    value?: { storedBytes?: number; size?: number; tornTailBytes?: number }
  }>
}

/**
 * Metadata entry types that can appear before a compact boundary but must
 * still be loaded (they're session-scoped, not message-scoped).
 * Kept as raw JSON string markers for cheap line filtering during streaming.
 */
const METADATA_TYPE_MARKERS = [
  '"type":"summary"',
  '"type":"custom-title"',
  // Session-scoped AI tab title — must survive compact-boundary skip on large transcripts
  '"type":"ai-title"',
  // densable 2.1.214 EndConversation marker — session-scoped like custom-title
  '"type":"ended-by-model"',
  '"type":"tag"',
  '"type":"agent-name"',
  '"type":"agent-color"',
  '"type":"agent-setting"',
  '"type":"mode"',
  '"type":"permission-mode"',
  '"type":"session-model"',
  '"type":"worktree-state"',
  '"type":"dev-mods"',
  '"type":"bridge-session"',
  '"type":"goal"',
  '"type":"goal-cleared"',
  '"type":"pr-link"',
]
export const METADATA_MARKER_BUFS = METADATA_TYPE_MARKERS.map(m =>
  Buffer.from(m),
)
// Longest marker is 24 bytes (`"type":"permission-mode"`); +1 for leading `{` = 25.
export const METADATA_PREFIX_BOUND = 27

export const LOW_MEMORY_CHUNK_BYTES = 256 * 1024
export const LOW_MEMORY_MAX_LINE_BYTES = 16 * 1024 * 1024

/**
 * Loads message logs from all worktrees of the same git repository.
 * Falls back to loadMessageLogs if no worktrees provided.
 *
 * Uses pure filesystem metadata for fast loading.
 *
 * @param worktreePaths Array of worktree paths (from getWorktreePaths)
 * @param limit Optional limit on number of session files to load per project
 * @returns List of message logs sorted by date
 */
/**
 * Result of loading session logs with progressive enrichment support.
 */
export type SessionLogResult = {
  /** Enriched logs ready for display */
  logs: LogOption[]
  /** Full stat-only list for progressive loading (call enrichLogs to get more) */
  allStatLogs: LogOption[]
  /** Index into allStatLogs where progressive loading should continue from */
  nextIndex: number
}

/**
 * Number of sessions to enrich on the initial load of the resume picker.
 * Each enrichment reads up to 128 KB per file (head + tail), so 50 sessions
 * means ~6.4 MB of I/O — fast on any modern filesystem while giving users
 * a much better initial view than the previous default of 10.
 */
export const INITIAL_ENRICH_COUNT = 50

export type LiteMetadata = {
  firstPrompt: string
  gitBranch?: string
  isSidechain: boolean
  projectPath?: string
  /** densable `sNr` — first-line `cwd`, not relocated. */
  headCwdStrict?: string
  /** densable `Llh` — last user/assistant timestamp in the tail. */
  lastMessageAtMs?: number
  /** densable 2.1.223 #8 — last relocated stamp (if any). */
  relocatedCwd?: string
  teamName?: string
  customTitle?: string
  /** Distinct from customTitle so loadFullLog can restore the tab title. */
  aiTitle?: string
  summary?: string
  tag?: string
  agentSetting?: string
  prNumber?: number
  prUrl?: string
  prRepository?: string
  sessionKind?: string
  /** 2.1.309 #1139: customTitle extracted specifically from the JSONL tail. */
  customTitleFromTail?: string
  /** 2.1.305 #1045 (SEA zBn): true if transcript has no user/assistant messages. */
  bookkeepingOnly?: boolean
}

/**
 * Reads the first and last ~64KB of a JSONL file and extracts lite metadata.
 *
 * Head (first 64KB): isSidechain, projectPath, teamName, firstPrompt.
 * Tail (last 64KB): customTitle, tag, PR link, latest gitBranch.
 *
 * Accepts a shared buffer to avoid per-file allocation overhead.
 */
export const PARENT_UUID_MARKER = '"parentUuid":'
export const BOOKKEEPING_SCAN_MAX_BYTES = 16 * 1024 * 1024
export const BOOKKEEPING_SCAN_CHUNK_BYTES = 1024 * 1024

export const MAX_REPLAY_SHAPE_BYTES = 4 * 1024 * 1024

export type RequestReplayWriteResult =
  | 'written'
  | 'no_transcript'
  | 'shape_too_large'

export type ApiRequestShapeEntry = {
  type: 'api-request-shape'
  sessionId: string
  agentId?: AgentId
  shapeHash: string
  timestamp: string
  version: string
  shape: {
    system: unknown
    tools: unknown
  }
}

export type ApiRequestBlobEntry = {
  type: 'api-request-blob'
  sessionId: string
  agentId?: AgentId
  hash: string
  message: unknown
}

export type ApiRequestEntry = {
  type: 'api-request'
  sessionId: string
  agentId?: AgentId
  id: string
  timestamp: string
  version: string
  querySource?: string
  shapeHash: string
  params: Record<string, unknown>
  base?: string
  keep: number
  tail: string[]
}

export type RequestReplayRecords = {
  target: {
    sessionId: string
    agentId?: AgentId
  }
  shapeHash: string
  shape: {
    system: unknown
    tools: unknown
  }
  blobCandidates: Array<{ hash: string; message: unknown }>
  request: ApiRequestEntry
}

export const REHYDRATE_AGENT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/
export const RESERVED_AGENT_NAMES = new Set(['team-lead', 'main', 'lead'])

// ---------------------------------------------------------------------------
// Official 2.1.325 (#1432): resume-head.jsonl side-file cache & vouching
// ---------------------------------------------------------------------------

export const RESUME_HEAD_FILENAME = 'resume-head.jsonl'
export const RESUME_HEAD_VERSION = 1
export const RESUME_HEAD_RULES = 1
export const RESUME_HEAD_MAX_BYTES = 1_048_576
export const RESUME_HEAD_MIN_ROW_STRIDE = 32
export const RESUME_HEAD_MAX_PRESERVED_BYTES = 8_388_608
export const RESUME_HEAD_WINDOW_BYTES = 1_048_576
export const RESUME_HEAD_PIECE_BYTES = 1_048_576
export const RESUME_HEAD_MAX_PIECES = 32
export const RESUME_HEAD_MAX_BOUNDARY_LEN = 1_048_576
export const RESUME_HEAD_MIN_GAIN = 4_194_304
export const RESUME_HEAD_MAX_GENERATION = 8

export const RESUME_HEAD_SHA256_RE = /^[0-9a-f]{64}$/
export const RESUME_HEAD_HEADER_PREFIX = '{"sha256":"'
export const RESUME_HEAD_HEADER_SUFFIX = '"}\n'
export const RESUME_HEAD_HEADER_LEN =
  RESUME_HEAD_HEADER_PREFIX.length + 64 + RESUME_HEAD_HEADER_SUFFIX.length

export type ResumeHeadData = {
  boundaryOffset: number
  boundaryLength: number
  probe: string
  generation: number
  rowOffsets: number[]
  rowLengths: number[]
}

export type ResumeHeadParseResult =
  | ResumeHeadData
  | 'too_large'
  | 'malformed'
  | 'checksum'
  | 'other_version'
  | 'other_rules'

// ============================================================================
// Official 2.1.331 Cross-Machine Saved Chat Refusal Guard
// (`09_cross_machine_transcript.js`: `__n`, `P1o`, `Qji` remoteCall check)
// ============================================================================

/** Official 2.1.331 `__n` basename prefix for files saved from claude.ai chats. */
export const SAVED_CHAT_FILE_PREFIX = 'artifact-chat.'

/** Official 2.1.331 telemetry/refusal code for cross-machine saved chat reads. */
export const SAVED_CHAT_CROSS_MACHINE_REFUSAL_REASON =
  'Read of a saved chat file refused for another machine'
export interface ToolUseNameWindowLike {
  recordAssistantMessage(entry: TranscriptMessage): void
  getToolName(toolUseId: string): string | undefined
}

export interface SessionProjectHandle {
  sessionFile: string | null
  appendToolUseWindow: ToolUseNameWindowLike | undefined
  flushQueuedWritesSync(
    skipPersistenceOverride?: boolean,
    skipHealthReporting?: boolean,
  ): void
  reAppendSessionMetadata(skipIfEmpty?: boolean, sync?: boolean): void
  flush(): Promise<void>
  _resetFlushState(): void
  hasPendingWritesForFile(filePath: string): boolean
  sealTornTailOnNextAppend(path: string): void
}
