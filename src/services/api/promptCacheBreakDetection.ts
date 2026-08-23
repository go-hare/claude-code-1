import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { createPatch } from 'diff'
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from 'src/bootstrap/state.js'
import type { AgentId } from 'src/types/ids.js'
import type { Message } from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { djb2Hash } from 'src/utils/hash.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { getClaudeTempDir } from 'src/utils/permissions/filesystem.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { z } from 'zod/v4'
import type { QuerySource } from '../../constants/querySource.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

function getCacheBreakDiffPath(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return join(getClaudeTempDir(), `cache-break-${suffix}.diff`)
}

type PreviousState = {
  systemHash: number
  toolsHash: number
  /** Hash of system blocks WITH cache_control intact. Catches scope/TTL flips
   *  (global↔org, 1h↔5m) that stripCacheControl erases from systemHash. */
  cacheControlHash: number
  toolNames: string[]
  /** Per-tool schema hash. Diffed to name which tool's description changed
   *  when toolSchemasChanged but added=removed=0 (77% of tool breaks per
   *  BQ 2026-03-22). AgentTool/SkillTool embed dynamic agent/command lists. */
  perToolHashes: Record<string, number>
  systemCharCount: number
  model: string
  fastMode: boolean
  /** 'tool_based' | 'system_prompt' | 'none' — flips when MCP tools are
   *  discovered/removed. */
  globalCacheStrategy: string
  /** Sorted beta header list. Diffed to show which headers were added/removed. */
  betas: string[]
  /** AFK_MODE_BETA_HEADER presence — should NOT break cache anymore
   *  (sticky-on latched in claude.ts). Tracked to verify the fix. */
  autoModeActive: boolean
  /** Overage state flip — should NOT break cache anymore (eligibility is
   *  latched session-stable in should1hCacheTTL). Tracked to verify the fix. */
  isUsingOverage: boolean
  /** Cache-editing beta header presence — should NOT break cache anymore
   *  (sticky-on latched in claude.ts). Tracked to verify the fix.
   *  In-memory only — SEA Zxv has no cachedMCEnabled. */
  cachedMCEnabled: boolean
  /** densable t1f `anyDeferLoading` — true when the hashed tool list dropped
   *  defer_loading tools relative to the full tools array. */
  anyDeferLoading: boolean
  /** densable t1f `is1hCacheTTL` — cache_control ttl === "1h". */
  is1hCacheTTL: boolean
  /** densable t1f `queryDepth` — queryTracking.depth. */
  queryDepth?: number
  /** densable t1f `cacheDiagnosis` — sticky cache-diagnosis-2026-04-07 sent. */
  cacheDiagnosis: boolean
  /** densable t1f `messageHashes` / oIv. */
  messageHashes: number[]
  /** densable t1f `perBlockHashes` — per system-block hash after YLf strip. */
  perBlockHashes: number[]
  /** densable t1f `perBlockLengths` — per system-block text length. */
  perBlockLengths: number[]
  /** Resolved effort (env → options → model default). Goes into output_config
   *  or anthropic_internal.effort_override. */
  effortValue: string
  /** Hash of getExtraBodyParams() — catches CLAUDE_CODE_EXTRA_BODY and
   *  anthropic_internal changes. */
  extraBodyHash: number
  callCount: number
  pendingChanges: PendingChanges | null
  prevCacheReadTokens: number | null
  /** Set when cached microcompact sends cache_edits deletions. Cache reads
   *  will legitimately drop — this is expected, not a break. */
  cacheDeletionsPending: boolean
  /**
   * densable `baselineFromDisk` — true after NQa hydrates this source from
   * `cache-break-state-${session}.json`. r1f then uses "hydrated baseline" copy
   * and omits removedTools/removedBetas. Persist (q$t) strips this field.
   */
  baselineFromDisk: boolean
  buildDiffableContent: string
}

type PendingChanges = {
  systemPromptChanged: boolean
  toolSchemasChanged: boolean
  modelChanged: boolean
  fastModeChanged: boolean
  cacheControlChanged: boolean
  globalCacheStrategyChanged: boolean
  betasChanged: boolean
  autoModeChanged: boolean
  overageChanged: boolean
  cachedMCChanged: boolean
  cacheDiagnosisChanged: boolean
  effortChanged: boolean
  extraBodyChanged: boolean
  deferLoadingPresenceChanged: boolean
  messagesHistoryChanged: boolean
  firstChangedMessageIndex: number
  prevMessageCount: number
  addedToolCount: number
  removedToolCount: number
  systemCharDelta: number
  addedTools: string[]
  removedTools: string[]
  changedToolSchemas: string[]
  prevBlockCount: number
  newBlockCount: number
  changedBlockIndices: number[]
  changedBlockLengthDeltas: number[]
  previousModel: string
  newModel: string
  prevGlobalCacheStrategy: string
  newGlobalCacheStrategy: string
  addedBetas: string[]
  removedBetas: string[]
  prevEffortValue: string
  newEffortValue: string
  prevDiffableContent: string
}

const previousStateBySource = new Map<string, PreviousState>()

/**
 * densable DJd.promptCacheBreak (W$t): hydrationAttempted + persist queue.
 * previousStateBySource stays the in-memory map; persist is gated by XLf.
 */
const promptCacheBreakStore = {
  previousStateBySource,
  hydrationAttempted: false,
  pendingPersist: Promise.resolve() as Promise<void>,
  latestQueuedPersist: null as PromptCacheBreakPersistAction | null,
}

type PromptCacheBreakPersistAction =
  | { action: 'remove' }
  | { action: 'write'; payload: string }

// Cap the number of tracked sources to prevent unbounded memory growth.
// Each entry stores a ~300KB+ diffableContent string (serialized system prompt
// + tool schemas). Without a cap, spawning many subagents (each with a unique
// agentId key) causes the map to grow indefinitely.
const MAX_TRACKED_SOURCES = 10

/** densable Xxv — max bytes for cache-break-state-*.json (ePd size gate). */
const CACHE_BREAK_STATE_MAX_BYTES = 4_000_000

/**
 * densable Pna / HRi — persistable source keys. q$t/NQa skip agent:* keys.
 * TRACKED_SOURCE_PREFIXES still tracks agents in-memory.
 */
const PERSISTABLE_SOURCE_KEYS: Readonly<Record<string, true>> = {
  repl_main_thread: true,
  'repl_main_thread:outputStyle:custom': true,
  'repl_main_thread:outputStyle:Concise': true,
  'repl_main_thread:outputStyle:Proactive': true,
  'repl_main_thread:outputStyle:Explanatory': true,
  'repl_main_thread:outputStyle:Learning': true,
  sdk: true,
}

const SESSION_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const GLOBAL_CACHE_STRATEGY_KEYS: Readonly<Record<string, true>> = {
  '': true,
  none: true,
  tool_based: true,
  system_prompt: true,
}

const persistableStateSchema = lazySchema(() =>
  z.record(
    z.string().max(200),
    z.object({
      systemHash: z.number(),
      toolsHash: z.number(),
      cacheControlHash: z.number(),
      toolNames: z.array(z.string().max(200)).max(2000),
      perToolHashes: z
        .record(z.string().max(200), z.number())
        .refine(e => Object.keys(e).length <= 2000),
      perBlockHashes: z.array(z.number()).max(5000),
      perBlockLengths: z.array(z.number()).max(5000),
      systemCharCount: z.number(),
      model: z.string().max(200),
      fastMode: z.boolean(),
      globalCacheStrategy: z.custom<string>(
        e =>
          typeof e === 'string' && Object.hasOwn(GLOBAL_CACHE_STRATEGY_KEYS, e),
      ),
      betas: z.array(z.string().max(200)).max(100),
      autoModeActive: z.boolean(),
      isUsingOverage: z.boolean(),
      anyDeferLoading: z.boolean().default(false),
      is1hCacheTTL: z.boolean().default(false),
      queryDepth: z.number().optional(),
      cacheDiagnosis: z.boolean().default(false),
      effortValue: z.string().max(200),
      extraBodyHash: z.number(),
      callCount: z.number(),
      prevCacheReadTokens: z.number().nullable(),
      cacheDeletionsPending: z.boolean(),
      messageHashes: z.array(z.number()).max(20000),
    }),
  ),
)

const TRACKED_SOURCE_PREFIXES = [
  'repl_main_thread',
  'sdk',
  'agent:custom',
  'agent:default',
  'agent:builtin',
]

/** densable HQa — CLAUDE_CODE_ENTRYPOINT === "claude-desktop" (exact). */
export function isClaudeDesktopEntrypoint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
}

/**
 * densable XLf — persist (NQa/q$t) only when cowork OR desktop.
 * CLI / vscode / local-agent do not write cache-break-state-*.json.
 */
export function isPromptCacheBreakPersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // densable XLf: V.CLAUDE_CODE_IS_COWORK || HQa() — any env truthy, not isEnvTruthy.
  return Boolean(env.CLAUDE_CODE_IS_COWORK) || isClaudeDesktopEntrypoint(env)
}

function isPersistableSourceKey(key: string): boolean {
  return Object.hasOwn(PERSISTABLE_SOURCE_KEYS, key)
}

function sanitizeSessionIdForPersist(sessionId: string): string | null {
  if (typeof sessionId !== 'string') return null
  return SESSION_ID_UUID_RE.test(sessionId) ? sessionId : null
}

function getCacheBreakStatePath(): string | null {
  const sessionId = sanitizeSessionIdForPersist(getSessionId())
  if (sessionId === null) return null
  return join(getClaudeTempDir(), `cache-break-state-${sessionId}.json`)
}

/** densable ePd — sync read with isFile + size gate; any error → null. */
function readCacheBreakStateFile(
  path: string,
  maxBytes: number,
): string | null {
  try {
    const st = lstatSync(path)
    if (!st.isFile() || st.size > maxBytes) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * densable MDt — refuse attacker-planted / wrong-uid tempdir; chmod 0700.
 * uid-less platforms (Windows) no-op like SEA `getuid===undefined`.
 */
function ensureClaudeTempDirSafe(dir: string): void {
  const uid = process.getuid?.()
  if (uid === undefined) return
  const trimmed = dir.replace(/[/]+$/, '') || dir
  const hint =
    'Set CLAUDE_CODE_TMPDIR to a directory you control, or ask an administrator to remove it.'
  let fd: number
  try {
    fd = openSync(
      trimmed,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    )
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      throw new Error(
        `Temp directory ${dir} is not a directory (may be an attacker-planted symlink). Refusing to use it. ${hint}`,
      )
    }
    if (code === 'EACCES') {
      let ownerUid: number | undefined
      try {
        const st = lstatSync(trimmed)
        if (st.uid !== uid) ownerUid = st.uid
      } catch {
        /* ignore */
      }
      if (ownerUid !== undefined) {
        throw new Error(
          `Temp directory ${dir} is owned by uid ${ownerUid}, expected ${uid}. Refusing to use it — another user may have pre-created it. ${hint}`,
        )
      }
      throw new Error(
        `Temp directory ${dir} is not readable (its mode may have been altered, or a path component denies search). Refusing to use it — restore its permissions (chmod 0700) or remove it. ${hint}`,
      )
    }
    throw err
  }
  try {
    const st = fstatSync(fd)
    if (st.uid !== uid) {
      if (uid === 0 && process.env.CLAUDE_CODE_CONTAINER_ID) {
        logEvent('tempdir_owner_mismatch', {
          observed_uid: st.uid,
        })
        return
      }
      throw new Error(
        `Temp directory ${dir} is owned by uid ${st.uid}, expected ${uid}. Refusing to use it — another user may have pre-created it. ${hint}`,
      )
    }
    if ((st.mode & 0o777) !== 0o700) {
      fchmodSync(fd, 0o700)
    }
  } finally {
    closeSync(fd)
  }
}

type PersistablePreviousState = {
  systemHash: number
  toolsHash: number
  cacheControlHash: number
  toolNames: string[]
  perToolHashes: Record<string, number>
  perBlockHashes: number[]
  perBlockLengths: number[]
  systemCharCount: number
  model: string
  fastMode: boolean
  globalCacheStrategy: string
  betas: string[]
  autoModeActive: boolean
  isUsingOverage: boolean
  anyDeferLoading: boolean
  is1hCacheTTL: boolean
  queryDepth?: number
  cacheDiagnosis: boolean
  effortValue: string
  extraBodyHash: number
  callCount: number
  prevCacheReadTokens: number | null
  cacheDeletionsPending: boolean
  messageHashes: number[]
}

function toPersistableState(state: PreviousState): PersistablePreviousState {
  return {
    systemHash: state.systemHash,
    toolsHash: state.toolsHash,
    cacheControlHash: state.cacheControlHash,
    toolNames: state.toolNames,
    perToolHashes: state.perToolHashes,
    perBlockHashes: state.perBlockHashes,
    perBlockLengths: state.perBlockLengths,
    systemCharCount: state.systemCharCount,
    model: state.model,
    fastMode: state.fastMode,
    globalCacheStrategy: state.globalCacheStrategy,
    betas: state.betas,
    autoModeActive: state.autoModeActive,
    isUsingOverage: state.isUsingOverage,
    anyDeferLoading: state.anyDeferLoading,
    is1hCacheTTL: state.is1hCacheTTL,
    queryDepth: state.queryDepth,
    cacheDiagnosis: state.cacheDiagnosis,
    effortValue: state.effortValue,
    extraBodyHash: state.extraBodyHash,
    callCount: state.callCount,
    prevCacheReadTokens: state.prevCacheReadTokens,
    cacheDeletionsPending: state.cacheDeletionsPending,
    messageHashes: state.messageHashes,
  }
}

function fromPersistableState(raw: PersistablePreviousState): PreviousState {
  return {
    ...raw,
    // Local in-memory extra; SEA Zxv has no cachedMCEnabled.
    cachedMCEnabled: false,
    anyDeferLoading: raw.anyDeferLoading ?? false,
    is1hCacheTTL: raw.is1hCacheTTL ?? false,
    cacheDiagnosis: raw.cacheDiagnosis ?? false,
    messageHashes: raw.messageHashes ?? [],
    perBlockHashes: raw.perBlockHashes ?? [],
    perBlockLengths: raw.perBlockLengths ?? [],
    pendingChanges: null,
    baselineFromDisk: true,
    buildDiffableContent: '',
  }
}

/** densable NQa — hydrate once, cowork/desktop only. */
function hydratePromptCacheBreakState(): void {
  const store = promptCacheBreakStore
  if (store.hydrationAttempted || !isPromptCacheBreakPersistEnabled()) return
  store.hydrationAttempted = true
  const map = store.previousStateBySource
  try {
    const tempDir = getClaudeTempDir()
    ensureClaudeTempDirSafe(tempDir)
    const path = getCacheBreakStatePath()
    if (path === null) return
    const raw = readCacheBreakStateFile(path, CACHE_BREAK_STATE_MAX_BYTES)
    if (raw === null) return
    const parsed = persistableStateSchema().safeParse(JSON.parse(raw))
    if (!parsed.success) return
    for (const [key, value] of Object.entries(parsed.data)) {
      if (map.size >= MAX_TRACKED_SOURCES) break
      if (!isPersistableSourceKey(key)) continue
      if (map.has(key)) continue
      map.set(key, fromPersistableState(value as PersistablePreviousState))
    }
  } catch {
    /* SEA NQa swallows */
  }
}

/** densable q$t — queue persist; no-op on CLI. */
function persistPromptCacheBreakState(): void {
  if (!isPromptCacheBreakPersistEnabled()) return
  try {
    const store = promptCacheBreakStore
    const payload: Record<string, PersistablePreviousState> = {}
    for (const [key, state] of store.previousStateBySource) {
      if (!isPersistableSourceKey(key)) continue
      // densable q$t strips buildDiffContent/pendingChanges/baselineFromDisk.
      // Local extra cachedMCEnabled is also omitted (not in Zxv).
      payload[key] = toPersistableState(state)
    }
    const path = getCacheBreakStatePath()
    if (path === null) return
    const action: PromptCacheBreakPersistAction =
      Object.keys(payload).length === 0
        ? { action: 'remove' }
        : { action: 'write', payload: jsonStringify(payload) }
    store.latestQueuedPersist = action
    store.pendingPersist = store.pendingPersist
      .then(async () => {
        if (action.action === 'remove') {
          ensureClaudeTempDirSafe(getClaudeTempDir())
          await rm(path, { force: true })
          return
        }
        if (store.latestQueuedPersist !== action) return
        await mkdir(getClaudeTempDir(), { recursive: true, mode: 0o700 })
        ensureClaudeTempDirSafe(getClaudeTempDir())
        await writeFile(path, action.payload, { encoding: 'utf8' })
      })
      .catch(() => {})
  } catch {
    /* SEA q$t swallows */
  }
}

// Minimum absolute token drop required to trigger a cache break warning.
// Small drops (e.g., a few thousand tokens) can happen due to normal variation
// and aren't worth alerting on.
const MIN_CACHE_MISS_TOKENS = 2_000

// Anthropic's server-side prompt cache TTL thresholds to test.
// Cache breaks after these durations are likely due to TTL expiration
// rather than client-side changes.
const CACHE_TTL_5MIN_MS = 5 * 60 * 1000
export const CACHE_TTL_1HOUR_MS = 60 * 60 * 1000

// Models to exclude from cache break detection (e.g., haiku has different caching behavior)
function isExcludedModel(model: string): boolean {
  return model.includes('haiku')
}

/**
 * Returns the tracking key for a querySource, or null if untracked.
 * Compact shares the same server-side cache as repl_main_thread
 * (same cacheSafeParams), so they share tracking state.
 *
 * For subagents with a tracked querySource, uses the unique agentId to
 * isolate tracking state. This prevents false positive cache break
 * notifications when multiple instances of the same agent type run
 * concurrently.
 *
 * Untracked sources (speculation, session_memory, prompt_suggestion, etc.)
 * are short-lived forked agents where cache break detection provides no
 * value — they run 1-3 turns with a fresh agentId each time, so there's
 * nothing meaningful to compare against. Their cache metrics are still
 * logged via tengu_api_success for analytics.
 */
function getTrackingKey(
  querySource: QuerySource,
  agentId?: AgentId,
): string | null {
  if (querySource === 'compact') return 'repl_main_thread'
  for (const prefix of TRACKED_SOURCE_PREFIXES) {
    if (querySource.startsWith(prefix)) return agentId || querySource
  }
  return null
}

function stripCacheControl(
  items: ReadonlyArray<Record<string, unknown>>,
): unknown[] {
  return items.map(item => {
    if (!('cache_control' in item)) return item
    const { cache_control: _, ...rest } = item
    return rest
  })
}

function computeHash(data: unknown): number {
  const str = jsonStringify(data)
  if (typeof Bun !== 'undefined') {
    const hash = Bun.hash(str)
    // Bun.hash can return bigint for large inputs; convert to number safely
    return typeof hash === 'bigint' ? Number(hash & 0xffffffffn) : hash
  }
  // Fallback for non-Bun runtimes (e.g. Node.js via npm global install)
  return djb2Hash(str)
}

/** densable rIv — billing attribution header is stripped from system hashes. */
const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:'

/** densable e1f — sentinel hash for ephemeral api_system (skipped in compare). */
const EPHEMERAL_API_SYSTEM_HASH = -1

/** densable nIv — known content-block keys skipped by LQa extra-entry walk. */
const KNOWN_CONTENT_BLOCK_KEYS = new Set([
  'type',
  'text',
  'thinking',
  'id',
  'tool_use_id',
  'name',
  'input',
  'source',
  'content',
  'cache_control',
])

/** densable PKo — mcp servers whose name is kept under local-agent OR allowlist.
 *  SEA: `PKo=new Set([Sbe])` with `Sbe="computer-use"`. */
const MCP_KEEP_SERVER_NAMES = new Set(['computer-use'])

function blockText(block: { text?: unknown }): string | undefined {
  return typeof block.text === 'string' ? block.text : undefined
}

/** densable YLf — billing-header system blocks are excluded from hashes. */
function isBillingHeaderBlock(block: { text?: unknown }): boolean {
  return blockText(block)?.startsWith(BILLING_HEADER_PREFIX) ?? false
}

/** densable $Qa + sIv — char count after YLf strip. */
function getSystemCharCount(system: TextBlockParam[]): number {
  let total = 0
  for (const block of system) {
    total += blockText(block)?.length ?? 0
  }
  return total
}

/**
 * densable MQa — collapse MCP tool names for telemetry.
 * Keep `mcp__<server>` when ENTRYPOINT==="local-agent" or PKo.has(server).
 */
function sanitizeToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const server = name.split('__')[1]
  if (!server) return 'mcp'
  if (
    process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent' ||
    MCP_KEEP_SERVER_NAMES.has(server)
  ) {
    return `mcp__${server}`
  }
  return 'mcp'
}

function computePerToolHashes(
  strippedTools: ReadonlyArray<unknown>,
  names: string[],
): Record<string, number> {
  const hashes: Record<string, number> = {}
  for (let i = 0; i < strippedTools.length; i++) {
    hashes[names[i] ?? `__idx_${i}`] = computeHash(strippedTools[i])
  }
  return hashes
}

/** densable CLs / iRt — identity join for telemetry (SEA iRt is identity). */
function joinForTelemetry(values: number[]): string {
  return values.join(',')
}

/**
 * densable LQa — fingerprint one content block (or string) into `parts`.
 * Used by oIv messageHashes.
 */
function fingerprintContentPart(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    parts.push('s', String(value.length), value.slice(0, 32), value.slice(-32))
    return
  }
  if (!value || typeof value !== 'object') return
  const block = value as Record<string, unknown>
  switch (block.type) {
    case 'text':
    case 'image':
    case 'document':
    case 'search_result':
    case 'thinking':
    case 'redacted_thinking':
    case 'tool_use':
    case 'tool_result':
    case 'tool_reference':
    case 'server_tool_use':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
    case 'advisor_tool_result':
    case 'code_execution_tool_result':
    case 'bash_code_execution_tool_result':
    case 'text_editor_code_execution_tool_result':
    case 'tool_search_tool_result':
    case 'mcp_tool_use':
    case 'mcp_tool_result':
    case 'container_upload':
    case 'compaction':
    case 'mid_conv_system':
    case 'fallback':
      break
    default:
      break
  }
  // densable LQa: always push e.type (join treats undefined as "").
  parts.push(block.type as string)
  if (typeof block.text === 'string') {
    parts.push(
      't',
      String(block.text.length),
      block.text.slice(0, 32),
      block.text.slice(-32),
    )
  }
  if (typeof block.thinking === 'string') {
    parts.push('k', String(block.thinking.length))
  }
  if (typeof block.id === 'string') parts.push('i', block.id)
  if (typeof block.tool_use_id === 'string') parts.push('u', block.tool_use_id)
  if (typeof block.name === 'string') parts.push('n', block.name)
  if (block.input !== undefined) parts.push('p', jsonStringify(block.input))
  if (block.source && typeof block.source === 'object') {
    const source = block.source as Record<string, unknown>
    parts.push('m', String(source.type ?? ''), String(source.media_type ?? ''))
    if (typeof source.data === 'string') parts.push(String(source.data.length))
  }
  const content = block.content
  if (Array.isArray(content)) {
    parts.push('[', String(content.length))
    for (const child of content) fingerprintContentPart(child, parts)
    parts.push(']')
  } else if (typeof content === 'string') {
    parts.push(
      'c',
      String(content.length),
      content.slice(0, 32),
      content.slice(-32),
    )
  }
  for (const [key, extra] of Object.entries(block)) {
    if (KNOWN_CONTENT_BLOCK_KEYS.has(key) || extra === undefined) continue
    const serialized = typeof extra === 'string' ? extra : jsonStringify(extra)
    parts.push(
      key,
      serialized.length > 256 ? `len:${serialized.length}` : serialized,
    )
  }
}

type MessagesForApiFingerprint = ReadonlyArray<{
  type?: string
  ephemeral?: boolean
  outputConfig?: { effort?: string | number }
  message: { role: string; content: unknown }
}>

/** densable oIv — per-message hash; ephemeral api_system → e1f (-1). */
function hashMessagesForApi(messages: MessagesForApiFingerprint): number[] {
  return messages.map(msg => {
    if (msg.type === 'api_system' && msg.ephemeral) {
      return EPHEMERAL_API_SYSTEM_HASH
    }
    const parts: string[] = [msg.message.role]
    if (msg.type === 'api_system' && msg.outputConfig !== undefined) {
      parts.push(`oc:${msg.outputConfig.effort ?? ''}`)
    }
    const content = msg.message.content
    if (Array.isArray(content)) {
      parts.push(String(content.length))
      for (const part of content) fingerprintContentPart(part, parts)
    } else {
      fingerprintContentPart(content, parts)
    }
    if (typeof Bun !== 'undefined') {
      const hash = Bun.hash(parts.join('|'))
      return typeof hash === 'bigint' ? Number(hash & 0xffffffffn) : hash
    }
    return djb2Hash(parts.join('|'))
  })
}

function buildDiffableContent(
  system: TextBlockParam[],
  tools: BetaToolUnion[],
  model: string,
): string {
  const systemText = system.map(b => b.text).join('\n\n')
  const toolDetails = tools
    .map(t => {
      if (!('name' in t)) return 'unknown'
      const desc = 'description' in t ? t.description : ''
      const schema = 'input_schema' in t ? jsonStringify(t.input_schema) : ''
      return `${t.name}\n  description: ${desc}\n  input_schema: ${schema}`
    })
    .sort()
    .join('\n\n')
  return `Model: ${model}\n\n=== System Prompt ===\n\n${systemText}\n\n=== Tools (${tools.length}) ===\n\n${toolDetails}\n`
}

/** Extended tracking snapshot — everything that could affect the server-side
 *  cache key that we can observe from the client. All fields are optional so
 *  the call site can add incrementally; undefined fields compare as stable. */
export type PromptStateSnapshot = {
  system: TextBlockParam[]
  toolSchemas: BetaToolUnion[]
  querySource: QuerySource
  model: string
  agentId?: AgentId
  fastMode?: boolean
  globalCacheStrategy?: string
  betas?: readonly string[]
  autoModeActive?: boolean
  isUsingOverage?: boolean
  cachedMCEnabled?: boolean
  anyDeferLoading?: boolean
  is1hCacheTTL?: boolean
  queryDepth?: number
  cacheDiagnosis?: boolean
  effortValue?: string | number
  extraBodyParams?: unknown
  /** densable t1f `messagesForAPI` / oIv. Structural fingerprint only. */
  messagesForAPI?: ReadonlyArray<unknown>
}

/**
 * Phase 1 (pre-call): Record the current prompt/tool state and detect what changed.
 * Does NOT fire events — just stores pending changes for phase 2 to use.
 */
export function recordPromptState(snapshot: PromptStateSnapshot): void {
  try {
    hydratePromptCacheBreakState()
    const {
      system,
      toolSchemas,
      querySource,
      model,
      agentId,
      fastMode,
      globalCacheStrategy = '',
      betas = [],
      autoModeActive = false,
      isUsingOverage = false,
      cachedMCEnabled = false,
      anyDeferLoading = false,
      is1hCacheTTL = false,
      queryDepth,
      cacheDiagnosis = false,
      effortValue,
      extraBodyParams,
      messagesForAPI,
    } = snapshot
    const key = getTrackingKey(querySource, agentId)
    if (!key) return

    // densable t1f: KLf(system).filter(!YLf) — strip cache_control AND billing header.
    const hashedSystem = stripCacheControl(
      system as unknown as ReadonlyArray<Record<string, unknown>>,
    ).filter(block => !isBillingHeaderBlock(block as { text?: unknown }))
    const strippedTools = stripCacheControl(
      toolSchemas as unknown as ReadonlyArray<Record<string, unknown>>,
    )

    const systemHash = computeHash(hashedSystem)
    const toolsHash = computeHash(strippedTools)
    // Hash cache_control of non-billing blocks — YLf filter matches SEA t1f `k`.
    const cacheControlHash = computeHash(
      system
        .filter(b => !isBillingHeaderBlock(b))
        .map(b => ('cache_control' in b ? b.cache_control : null)),
    )
    const toolNames = toolSchemas.map(t => ('name' in t ? t.name : 'unknown'))
    const computeToolHashes = () =>
      computePerToolHashes(strippedTools, toolNames)
    const computePerBlockHashes = () =>
      hashedSystem.map(block => computeHash(block))
    const computePerBlockLengths = () =>
      hashedSystem.map(
        block => blockText(block as { text?: unknown })?.length ?? 0,
      )
    const systemCharCount = getSystemCharCount(hashedSystem as TextBlockParam[])
    const isFastMode = fastMode ?? false
    const sortedBetas = [...betas].sort()
    const effortStr = effortValue === undefined ? '' : String(effortValue)
    const extraBodyHash =
      extraBodyParams === undefined ? 0 : computeHash(extraBodyParams)
    const messageHashes = messagesForAPI
      ? hashMessagesForApi(
          messagesForAPI as unknown as MessagesForApiFingerprint,
        )
      : []

    const prev = previousStateBySource.get(key)

    if (!prev) {
      // densable t1f: evict a non-Pna (agent) key first, else insertion order.
      while (previousStateBySource.size >= MAX_TRACKED_SOURCES) {
        const keys = [...previousStateBySource.keys()]
        const evict = keys.find(k => !isPersistableSourceKey(k)) ?? keys[0]
        if (evict === undefined) break
        previousStateBySource.delete(evict)
      }

      previousStateBySource.set(key, {
        systemHash,
        toolsHash,
        cacheControlHash,
        toolNames,
        systemCharCount,
        model,
        fastMode: isFastMode,
        globalCacheStrategy,
        betas: sortedBetas,
        autoModeActive,
        isUsingOverage,
        cachedMCEnabled,
        anyDeferLoading,
        is1hCacheTTL,
        queryDepth,
        cacheDiagnosis,
        effortValue: effortStr,
        extraBodyHash,
        callCount: 1,
        pendingChanges: null,
        prevCacheReadTokens: null,
        cacheDeletionsPending: false,
        baselineFromDisk: false,
        messageHashes,
        buildDiffableContent: buildDiffableContent(system, toolSchemas, model),
        perToolHashes: computeToolHashes(),
        perBlockHashes: computePerBlockHashes(),
        perBlockLengths: computePerBlockLengths(),
      })
      persistPromptCacheBreakState()
      return
    }

    prev.callCount++

    const systemPromptChanged = systemHash !== prev.systemHash
    const toolSchemasChanged = toolsHash !== prev.toolsHash
    const modelChanged = model !== prev.model
    const fastModeChanged = isFastMode !== prev.fastMode
    const cacheControlChanged = cacheControlHash !== prev.cacheControlHash
    const globalCacheStrategyChanged =
      globalCacheStrategy !== prev.globalCacheStrategy
    const betasChanged =
      sortedBetas.length !== prev.betas.length ||
      sortedBetas.some((b, i) => b !== prev.betas[i])
    const autoModeChanged = autoModeActive !== prev.autoModeActive
    const overageChanged = isUsingOverage !== prev.isUsingOverage
    const cachedMCChanged = cachedMCEnabled !== prev.cachedMCEnabled
    const cacheDiagnosisChanged = cacheDiagnosis !== prev.cacheDiagnosis
    const effortChanged = effortStr !== prev.effortValue
    const extraBodyChanged = extraBodyHash !== prev.extraBodyHash
    const deferLoadingPresenceChanged = anyDeferLoading !== prev.anyDeferLoading
    const firstChangedMessageIndex = prev.messageHashes.findIndex(
      (hash, i) =>
        hash !== EPHEMERAL_API_SYSTEM_HASH && messageHashes[i] !== hash,
    )
    const messagesHistoryChanged = firstChangedMessageIndex !== -1

    if (
      systemPromptChanged ||
      toolSchemasChanged ||
      modelChanged ||
      fastModeChanged ||
      cacheControlChanged ||
      globalCacheStrategyChanged ||
      betasChanged ||
      autoModeChanged ||
      overageChanged ||
      cacheDiagnosisChanged ||
      effortChanged ||
      extraBodyChanged ||
      deferLoadingPresenceChanged ||
      messagesHistoryChanged
    ) {
      const prevToolSet = new Set(prev.toolNames)
      const newToolSet = new Set(toolNames)
      const prevBetaSet = new Set(prev.betas)
      const newBetaSet = new Set(sortedBetas)
      const addedTools = toolNames.filter(n => !prevToolSet.has(n))
      const removedTools = prev.toolNames.filter(n => !newToolSet.has(n))
      const changedToolSchemas: string[] = []
      if (toolSchemasChanged) {
        const newHashes = computeToolHashes()
        for (const name of toolNames) {
          if (!prevToolSet.has(name)) continue
          if (newHashes[name] !== prev.perToolHashes[name]) {
            changedToolSchemas.push(name)
          }
        }
        prev.perToolHashes = newHashes
      }
      const prevBlockCount = prev.perBlockHashes.length
      const newBlockCount = hashedSystem.length
      const changedBlockIndices: number[] = []
      const changedBlockLengthDeltas: number[] = []
      if (systemPromptChanged) {
        const newBlockHashes = computePerBlockHashes()
        const newBlockLengths = computePerBlockLengths()
        if (newBlockCount === prevBlockCount) {
          for (let i = 0; i < newBlockCount; i++) {
            if (newBlockHashes[i] !== prev.perBlockHashes[i]) {
              changedBlockIndices.push(i)
              changedBlockLengthDeltas.push(
                (newBlockLengths[i] ?? 0) - (prev.perBlockLengths[i] ?? 0),
              )
            }
          }
        }
        prev.perBlockHashes = newBlockHashes
        prev.perBlockLengths = newBlockLengths
      }
      prev.pendingChanges = {
        systemPromptChanged,
        toolSchemasChanged,
        modelChanged,
        fastModeChanged,
        cacheControlChanged,
        globalCacheStrategyChanged,
        betasChanged,
        autoModeChanged,
        overageChanged,
        cachedMCChanged,
        cacheDiagnosisChanged,
        effortChanged,
        extraBodyChanged,
        deferLoadingPresenceChanged,
        messagesHistoryChanged,
        firstChangedMessageIndex,
        prevMessageCount: prev.messageHashes.length,
        addedToolCount: addedTools.length,
        removedToolCount: removedTools.length,
        addedTools,
        removedTools,
        changedToolSchemas,
        prevBlockCount,
        newBlockCount,
        changedBlockIndices,
        changedBlockLengthDeltas,
        systemCharDelta: systemCharCount - prev.systemCharCount,
        previousModel: prev.model,
        newModel: model,
        prevGlobalCacheStrategy: prev.globalCacheStrategy,
        newGlobalCacheStrategy: globalCacheStrategy,
        addedBetas: sortedBetas.filter(b => !prevBetaSet.has(b)),
        removedBetas: prev.betas.filter(b => !newBetaSet.has(b)),
        prevEffortValue: prev.effortValue,
        newEffortValue: effortStr,
        prevDiffableContent: prev.buildDiffableContent,
      }
    } else {
      prev.pendingChanges = null
    }

    prev.systemHash = systemHash
    prev.toolsHash = toolsHash
    prev.cacheControlHash = cacheControlHash
    prev.toolNames = toolNames
    prev.systemCharCount = systemCharCount
    prev.model = model
    prev.fastMode = isFastMode
    prev.globalCacheStrategy = globalCacheStrategy
    prev.betas = sortedBetas
    prev.autoModeActive = autoModeActive
    prev.isUsingOverage = isUsingOverage
    prev.cachedMCEnabled = cachedMCEnabled
    prev.anyDeferLoading = anyDeferLoading
    prev.is1hCacheTTL = is1hCacheTTL
    prev.queryDepth = queryDepth
    prev.cacheDiagnosis = cacheDiagnosis
    prev.effortValue = effortStr
    prev.extraBodyHash = extraBodyHash
    prev.messageHashes = messageHashes
    prev.buildDiffableContent = buildDiffableContent(system, toolSchemas, model)
    persistPromptCacheBreakState()
  } catch (e: unknown) {
    logError(e)
  }
}

/**
 * Phase 2 (post-call): Check the API response's cache tokens to determine
 * if a cache break actually occurred. If it did, use the pending changes
 * from phase 1 to explain why.
 */
export async function checkResponseForCacheBreak(
  querySource: QuerySource,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  messages: Message[],
  agentId?: AgentId,
  requestId?: string | null,
  previousMessageId?: string | null,
): Promise<void> {
  try {
    const key = getTrackingKey(querySource, agentId)
    if (!key) return

    const state = previousStateBySource.get(key)
    if (!state) return

    // Skip excluded models (e.g., haiku has different caching behavior)
    if (isExcludedModel(state.model)) return

    const prevCacheRead = state.prevCacheReadTokens
    state.prevCacheReadTokens = cacheReadTokens
    const hydratedFromDisk = state.baselineFromDisk
    state.baselineFromDisk = false
    try {
      // Calculate time since last call for TTL detection by finding the most recent
      // assistant message timestamp in the messages array (before the current response)
      const lastAssistantMessage = messages.findLast(
        m => m.type === 'assistant',
      )
      const timeSinceLastAssistantMsg = lastAssistantMessage
        ? Date.now() -
          new Date(lastAssistantMessage.timestamp as string | number).getTime()
        : null

      // densable r1f: first call (incl. post-compaction baseline) clears pending
      // so a compact-window model/effort flip cannot attribute the next drop.
      if (prevCacheRead === null) {
        state.pendingChanges = null
        return
      }

      const changes = state.pendingChanges

      // Cache deletions via cached microcompact intentionally reduce the cached
      // prefix. The drop in cache read tokens is expected — reset the baseline
      // so we don't false-positive on the next call.
      if (state.cacheDeletionsPending) {
        state.cacheDeletionsPending = false
        logForDebugging(
          `[PROMPT CACHE] cache deletion applied, cache read: ${prevCacheRead} → ${cacheReadTokens} (expected drop)`,
        )
        // Don't flag as a break — the remaining state is still valid
        state.pendingChanges = null
        return
      }

      // Detect a cache break: cache read dropped >5% from previous AND
      // the absolute drop exceeds the minimum threshold.
      const tokenDrop = prevCacheRead - cacheReadTokens
      if (
        cacheReadTokens >= prevCacheRead * 0.95 ||
        tokenDrop < MIN_CACHE_MISS_TOKENS
      ) {
        state.pendingChanges = null
        return
      }

      // Build explanation from pending changes (if any)
      const parts: string[] = []
      if (changes) {
        if (changes.modelChanged) {
          parts.push(
            `model changed (${hydratedFromDisk ? 'hydrated baseline' : changes.previousModel} → ${changes.newModel})`,
          )
        }
        if (changes.systemPromptChanged) {
          const charDelta = changes.systemCharDelta
          const charInfo =
            charDelta === 0
              ? ''
              : charDelta > 0
                ? ` (+${charDelta} chars)`
                : ` (${charDelta} chars)`
          parts.push(`system prompt changed${charInfo}`)
        }
        if (changes.toolSchemasChanged) {
          const toolDiff =
            changes.addedToolCount > 0 || changes.removedToolCount > 0
              ? ` (+${changes.addedToolCount}/-${changes.removedToolCount} tools)`
              : ' (tool prompt/schema changed, same tool set)'
          parts.push(`tools changed${toolDiff}`)
        }
        if (changes.fastModeChanged) {
          parts.push('fast mode toggled')
        }
        if (changes.globalCacheStrategyChanged) {
          parts.push(
            `global cache strategy changed (${changes.prevGlobalCacheStrategy || 'none'} → ${changes.newGlobalCacheStrategy || 'none'})`,
          )
        }
        if (
          changes.cacheControlChanged &&
          !changes.globalCacheStrategyChanged &&
          !changes.systemPromptChanged
        ) {
          // Only report as standalone cause if nothing else explains it —
          // otherwise the scope/TTL flip is a consequence, not the root cause.
          parts.push('cache_control changed (scope or TTL)')
        }
        if (changes.betasChanged) {
          const added = changes.addedBetas.length
            ? `+${changes.addedBetas.join(',')}`
            : ''
          const removed = changes.removedBetas.length
            ? `-${hydratedFromDisk ? 'hydrated baseline' : changes.removedBetas.join(',')}`
            : ''
          const diff = [added, removed].filter(Boolean).join(' ')
          parts.push(`betas changed${diff ? ` (${diff})` : ''}`)
        }
        if (changes.autoModeChanged) {
          parts.push('auto mode toggled')
        }
        if (changes.overageChanged) {
          parts.push('overage state changed (TTL flip expected)')
        }
        if (changes.cachedMCChanged) {
          parts.push('cached microcompact toggled')
        }
        if (changes.cacheDiagnosisChanged) {
          parts.push('cache diagnosis toggled')
        }
        if (changes.effortChanged) {
          parts.push(
            `effort changed (${hydratedFromDisk ? 'hydrated baseline' : changes.prevEffortValue || 'default'} → ${changes.newEffortValue || 'default'})`,
          )
        }
        if (changes.extraBodyChanged) {
          parts.push('extra body params changed')
        }
        if (changes.deferLoadingPresenceChanged) {
          parts.push(
            'defer_loading presence flipped (deferred-tool hint section, inc-5316)',
          )
        }
        if (changes.messagesHistoryChanged) {
          parts.push(
            `message history mutated at index ${changes.firstChangedMessageIndex}/${changes.prevMessageCount}`,
          )
        }
      }

      // Check if time gap suggests TTL expiration
      const lastAssistantMsgOver5minAgo =
        timeSinceLastAssistantMsg !== null &&
        timeSinceLastAssistantMsg > CACHE_TTL_5MIN_MS
      const lastAssistantMsgOver1hAgo =
        timeSinceLastAssistantMsg !== null &&
        timeSinceLastAssistantMsg > CACHE_TTL_1HOUR_MS

      // Post PR #19823 BQ analysis (bq-queries/prompt-caching/cache_break_pr19823_analysis.sql):
      // when all client-side flags are false and the gap is under TTL, ~90% of breaks
      // are server-side routing/eviction or billed/inference disagreement. Label
      // accordingly instead of implying a CC bug hunt.
      let reason: string
      if (parts.length > 0) {
        reason = parts.join(', ')
      } else if (lastAssistantMsgOver1hAgo) {
        reason = 'possible 1h TTL expiry (prompt unchanged)'
      } else if (lastAssistantMsgOver5minAgo) {
        reason = 'possible 5min TTL expiry (prompt unchanged)'
      } else if (timeSinceLastAssistantMsg !== null) {
        reason = 'likely server-side (prompt unchanged, <5min gap)'
      } else {
        reason = 'unknown cause'
      }

      logEvent('tengu_prompt_cache_break', {
        systemPromptChanged: changes?.systemPromptChanged ?? false,
        toolSchemasChanged: changes?.toolSchemasChanged ?? false,
        modelChanged: changes?.modelChanged ?? false,
        fastModeChanged: changes?.fastModeChanged ?? false,
        cacheControlChanged: changes?.cacheControlChanged ?? false,
        globalCacheStrategyChanged:
          changes?.globalCacheStrategyChanged ?? false,
        betasChanged: changes?.betasChanged ?? false,
        autoModeChanged: changes?.autoModeChanged ?? false,
        overageChanged: changes?.overageChanged ?? false,
        cachedMCChanged: changes?.cachedMCChanged ?? false,
        cacheDiagnosisChanged: changes?.cacheDiagnosisChanged ?? false,
        effortChanged: changes?.effortChanged ?? false,
        extraBodyChanged: changes?.extraBodyChanged ?? false,
        deferLoadingPresenceChanged:
          changes?.deferLoadingPresenceChanged ?? false,
        messagesHistoryChanged: changes?.messagesHistoryChanged ?? false,
        firstChangedMessageIndex: changes?.firstChangedMessageIndex ?? -1,
        addedToolCount: changes?.addedToolCount ?? 0,
        removedToolCount: changes?.removedToolCount ?? 0,
        systemCharDelta: changes?.systemCharDelta ?? 0,
        prevBlockCount: changes?.prevBlockCount ?? 0,
        newBlockCount: changes?.newBlockCount ?? 0,
        changedBlockIndices: joinForTelemetry(
          changes?.changedBlockIndices ?? [],
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        changedBlockLengthDeltas: joinForTelemetry(
          changes?.changedBlockLengthDeltas ?? [],
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        // Tool names are sanitized: built-in names are a fixed vocabulary,
        // MCP tools collapse to 'mcp' (user-configured, could leak paths).
        addedTools: (changes?.addedTools ?? [])
          .map(sanitizeToolName)
          .join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        removedTools: (hydratedFromDisk ? [] : (changes?.removedTools ?? []))
          .map(sanitizeToolName)
          .join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        changedToolSchemas: (changes?.changedToolSchemas ?? [])
          .map(sanitizeToolName)
          .join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        // Beta header names and cache strategy are fixed enum-like values,
        // not code or filepaths. requestId is an opaque server-generated ID.
        addedBetas: (changes?.addedBetas ?? []).join(
          ',',
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        removedBetas: (hydratedFromDisk
          ? []
          : (changes?.removedBetas ?? [])
        ).join(
          ',',
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        prevGlobalCacheStrategy: (changes?.prevGlobalCacheStrategy ??
          '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        newGlobalCacheStrategy: (changes?.newGlobalCacheStrategy ??
          '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        systemHash: state.systemHash,
        toolsHash: state.toolsHash,
        is1hCacheTTL: state.is1hCacheTTL,
        queryDepth: state.queryDepth,
        querySource:
          querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        model:
          state.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        globalCacheStrategy:
          state.globalCacheStrategy as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        callNumber: state.callCount,
        prevCacheReadTokens: prevCacheRead,
        cacheReadTokens,
        cacheCreationTokens,
        timeSinceLastAssistantMsg: timeSinceLastAssistantMsg ?? -1,
        lastAssistantMsgOver5minAgo,
        lastAssistantMsgOver1hAgo,
        isCowork: isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK),
        isDesktop: isClaudeDesktopEntrypoint(),
        baselineFromDisk: hydratedFromDisk,
        requestId: (requestId ??
          '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        previousMessageId: (previousMessageId ??
          '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      // Write diff file for ant debugging via --debug. The path is included in
      // the summary log so ants can find it (DevBar UI removed — event data
      // flows reliably to BQ for analytics).
      let diffPath: string | undefined
      if (changes?.prevDiffableContent) {
        diffPath = await writeCacheBreakDiff(
          changes.prevDiffableContent,
          state.buildDiffableContent,
        )
      }

      const diffSuffix = diffPath ? `, diff: ${diffPath}` : ''
      const summary = `[PROMPT CACHE BREAK] ${reason} [source=${querySource}, call #${state.callCount}, cache read: ${prevCacheRead} → ${cacheReadTokens}, creation: ${cacheCreationTokens}${diffSuffix}]`

      logForDebugging(summary, { level: 'warn' })

      state.pendingChanges = null
    } finally {
      persistPromptCacheBreakState()
    }
  } catch (e: unknown) {
    logError(e)
  }
}

/**
 * Call when cached microcompact sends cache_edits deletions.
 * The next API response will have lower cache read tokens — that's
 * expected, not a cache break.
 */
export function notifyCacheDeletion(
  querySource: QuerySource,
  agentId?: AgentId,
): void {
  hydratePromptCacheBreakState()
  const key = getTrackingKey(querySource, agentId)
  const state = key ? previousStateBySource.get(key) : undefined
  if (state) {
    state.cacheDeletionsPending = true
    persistPromptCacheBreakState()
  }
}

/**
 * Call after compaction to reset the cache read baseline.
 * Compaction legitimately reduces message count, so cache read tokens
 * will naturally drop on the next call — that's not a break.
 */
export function notifyCompaction(
  querySource: QuerySource,
  agentId?: AgentId,
): void {
  hydratePromptCacheBreakState()
  const key = getTrackingKey(querySource, agentId)
  const state = key ? previousStateBySource.get(key) : undefined
  if (state) {
    state.prevCacheReadTokens = null
    persistPromptCacheBreakState()
  }
}

export function cleanupAgentTracking(agentId: AgentId): void {
  if (previousStateBySource.delete(agentId)) {
    persistPromptCacheBreakState()
  }
}

export function resetPromptCacheBreakDetection(): void {
  const store = promptCacheBreakStore
  const empty =
    store.previousStateBySource.size === 0 && !store.hydrationAttempted
  store.previousStateBySource.clear()
  store.hydrationAttempted = false
  if (!empty) persistPromptCacheBreakState()
}

/** Test helper: densable ZLf path (null if session id is not a UUID). */
export function getPromptCacheBreakStatePathForTesting(): string | null {
  return getCacheBreakStatePath()
}

/** Test helper: await q$t queued persist. */
export async function flushPromptCacheBreakPersistForTesting(): Promise<void> {
  await promptCacheBreakStore.pendingPersist
}

async function writeCacheBreakDiff(
  prevContent: string,
  newContent: string,
): Promise<string | undefined> {
  try {
    const diffPath = getCacheBreakDiffPath()
    await mkdir(getClaudeTempDir(), { recursive: true })
    const patch = createPatch(
      'prompt-state',
      prevContent,
      newContent,
      'before',
      'after',
    )
    await writeFile(diffPath, patch)
    return diffPath
  } catch {
    return undefined
  }
}
