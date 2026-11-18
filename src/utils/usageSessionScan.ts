/**
 * densable `Q5e` / `mBt` / `ue` / `Ln` / `Un` / `ee` / `ne` / `U(Ee)` —
 * local transcript scan for `/usage` contributing tables.
 */

import { basename, dirname, extname, join, sep } from 'path'
import { open, readdir, stat } from 'fs/promises'
import {
  isPolicyLimitsAllowed,
  leftoverPolicyLimitsDp,
  leftoverPolicyLimitsHost,
  leftoverPolicyLimitsRh,
  policyLimitsFeatureCopy,
} from '../cli/leftoverTulip.js'
import { logForDebugging } from './debug.js'
import { getErrnoCode, isENOENT } from './errors.js'
import type { LoopUsageRow } from './loopUsage.js'
import { isValidStoragePathSegment } from './sessionNameJobSidecar.js'
import { getProjectsDir } from './sessionPaths.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import {
  getPinnedStorageV5,
  type StorageV5,
  type StorageV5Result,
} from './storageV5/index.js'

/** densable `he`. */
export const USAGE_TRANSCRIPT_SCAN_POLICY = 'allow_usage_transcript_scan'

/** densable `Oe.hipaaReason`. */
export const USAGE_TRANSCRIPT_SCAN_HIPAA_REASON =
  "Not shown under your organization's policy: this breakdown is built by scanning the session transcripts saved on this machine."

/** densable `B` / `v`. */
const SCAN_BATCH = 4
/** densable `ce` / `te`. */
const MAX_TRANSCRIPT_CHUNK = 4_194_304
/** densable `Wf`. */
const V5_SCAN_PAGE_BUDGET = 10_000
/** densable `ae` / `oe`. */
const WEEK_MS = 604_800_000
/** densable `xe` / `Ae`. */
const CACHE_MISS_UNCACHED = 100_000
/** densable `Ne` / `Oe`. */
const LONG_CTX_TOKENS = 150_000
/** densable `Ie` / `Le`. */
const SUBAGENT_HEAVY_COUNT = 3
/** densable `De` / `Ne`. */
const SUBAGENT_HEAVY_RATIO = 0.5
/** densable `Pe` / `we`. */
const PARALLEL_BUCKET_MS = 300_000
/** densable `Be` / `Ie`. */
const HIGH_PARALLEL_SIDS = 4
/** densable `ve` / `ke`. */
const CRON_HOURS = 8
/** densable `Po` (2.1.295). */
export const BEHAVIOR_PCT_MIN = 10
/** densable `Y` / `G` / `Se` / `Fn`. */
const LOOP_PROMPT_MAX_CHARS = 200
const LOOP_PROMPT_SCAN_BYTES = 6 * LOOP_PROMPT_MAX_CHARS
const LOOP_CRON_MAX_CHARS = 64
const LOOP_CRON_SCAN_BYTES = 6 * LOOP_CRON_MAX_CHARS

const COMMAND_NAME_RE = /<command-name>([^<]{1,200})<\/command-name>/

const TYPE_ASSISTANT = Buffer.from('"type":"assistant"')
const USAGE = Buffer.from('"usage":{')
const TIMESTAMP = Buffer.from('"timestamp":"')
const SESSION_ID = Buffer.from('"sessionId":"')
const MODEL = Buffer.from('"model":"')
const REQUEST_ID = Buffer.from('"requestId":"')
const ID_FIELD = Buffer.from('"id":"')
const MSG_PREFIX = Buffer.from('msg_')
const UUID = Buffer.from('"uuid":"')
const INPUT_TOKENS = Buffer.from('"input_tokens":')
const OUTPUT_TOKENS = Buffer.from('"output_tokens":')
const CACHE_CREATE = Buffer.from('"cache_creation_input_tokens":')
const CACHE_READ = Buffer.from('"cache_read_input_tokens":')
const SIDECHAIN = Buffer.from('"isSidechain":true')
const SIDECHAIN_SP = Buffer.from('"isSidechain": true')
const HAS_ATTRIBUTION = Buffer.from('"attribution')
const ATTR_AGENT = Buffer.from('"attributionAgent":"')
const ATTR_SKILL = Buffer.from('"attributionSkill":"')
const ATTR_PLUGIN = Buffer.from('"attributionPlugin":"')
const ATTR_MCP = Buffer.from('"attributionMcpServer":"')
const TYPE_USER = Buffer.from('"type":"user"')
const IS_META = Buffer.from('"isMeta":true')
const SCHEDULED_FIRE = Buffer.from('"subtype":"scheduled_task_fire"')
const TASK_ID = Buffer.from('"taskId":"')
const SCHEDULED_TASK_ID = Buffer.from('"scheduledTaskId":"')
const SCHEDULED_FIRE_ID = Buffer.from('"scheduledFireId":"')
const TYPE_TOOL_RESULT = Buffer.from('"type":"tool_result"')
const TURN_COMPANION = Buffer.from('"turnCompanion":true')
const INTERRUPTED_BY_USER = Buffer.from('"text":"[Request interrupted by user')
const CONTENT_BRACKET = Buffer.from('"content":"[')
const PRIOR_LOOP_WAKEUP = Buffer.from(' prior /loop wakeup')
const COMPACT_SUMMARY = Buffer.from('"isCompactSummary":true')
const TYPE_ATTACHMENT = Buffer.from('"type":"attachment"')
const TYPE_QUEUED_COMMAND = Buffer.from('"type":"queued_command"')
const ORIGIN_OBJ = Buffer.from('"origin":{')
const ORIGIN_HUMAN = Buffer.from('"origin":{"kind":"human"')
const PROMPT_SOURCE = Buffer.from('"promptSource":"')
const TYPE_SYSTEM = Buffer.from('"type":"system"')
const SUBTYPE_LOCAL_COMMAND = Buffer.from('"subtype":"local_command"')
const LOOP_CRON = Buffer.from('"cron":"')
const LOOP_PROMPT = Buffer.from('"prompt":"')
const TASK_KIND_LOOP = Buffer.from('"taskKind":"loop"')
const CONTENT_QUOTE = Buffer.from('"content":"')
const TEXT_QUOTE = Buffer.from('"text":"')
const EFFORT_MAX = Buffer.from('"effort":"max"')
const CONTENT_FIELD = Buffer.from('"content":')
const TOOL_USE_ID_FIELD = Buffer.from('"tool_use_id":"')
const CHAR_QUOTE = 34
const CHAR_BACKSLASH = 92
const CHAR_LBRACE = 123
const CHAR_RBRACE = 125
const CHAR_LBRACKET = 91
const CHAR_RBRACKET = 93
const LARGE_TOOL_RESULT_MIN_TOKENS = 10_000
const ALWAYS_ON_MIN_TOKENS = 40_000
const BYTES_PER_TOKEN = 2.5

function tagNeedles(tag: string): Buffer[] {
  return [Buffer.from(`"content":"<${tag}>`), Buffer.from(`"text":"<${tag}>`)]
}

const COMMAND_TAG_NEEDLES = [
  ...tagNeedles('command-message'),
  ...tagNeedles('command-name'),
]
const LOCAL_CAVEAT_NEEDLES = tagNeedles('local-command-caveat')
const LOCAL_OUTPUT_NEEDLES = [
  ...tagNeedles('local-command-stdout'),
  ...tagNeedles('local-command-stderr'),
]
const BASH_OUTPUT_NEEDLES = [
  ...tagNeedles('bash-stdout'),
  ...tagNeedles('bash-stderr'),
]

function jsonFieldNeedles(text: string, full: boolean): Buffer[] {
  const encoded = jsonStringify(text)
  const slice = full ? encoded : encoded.slice(0, -1)
  return [Buffer.from(`"content":${slice}`), Buffer.from(`"text":${slice}`)]
}

const HOOK_STOPPED_NEEDLES = jsonFieldNeedles(
  'Operation stopped by hook',
  false,
)

const META_PREFIX_NEEDLES = [
  'Stop hook feedback:\n',
  'TeammateIdle hook feedback:\n',
  'TaskCreated hook feedback:\n',
  'TaskCompleted hook feedback:\n',
  '[structured-output-enforce]',
  '[projects-reply-gate]',
  'You ended the turn without calling SendUserMessage.',
  'Goal check-in: «',
].flatMap(s => jsonFieldNeedles(s, false))

const META_EXACT_NEEDLES = [
  'The previous response failed to produce a valid tool call. Please retry the tool call now.',
  'Your tool call was malformed and could not be parsed. Please retry.',
  '[Your previous response had no visible output. Please continue and produce a user-visible response.]',
  'The PermissionDenied hook indicated you may retry this tool call.',
  'Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of it was withheld, and tool calls in it that had not finished did not run. Do not produce that content again, even reworded.',
  'Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of it was withheld, and tool calls in it that had not finished did not run. Do not produce that content again, even reworded. Exception: a tool call whose result reads "Interrupted" was already running when the response was stopped; it may have partially or fully completed.',
  'Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
  'Output token limit hit while you were still reasoning, before this response produced any text or tool call. That reasoning was not kept and is not part of this conversation, so there is nothing to resume. Continue from the conversation above: reason much more briefly and produce your answer or next tool call well within the output limit.',
  "Your response was cut off because it exceeded the output token limit. Continue from where you left off. What you write next is shown as a separate block below the text so far, so begin at the start of the line, table row, list item or sentence that was cut, writing it again in full, and if you were inside a code block or a table, open it again first (the same code fence and language, the table's header row). Repeat nothing before that point and do not comment on the interruption. Keep going until the response is complete.",
  'Your response above was cut off mid-stream. Resume directly from where it stops — no apology, no recap. If none of it survived, answer the request from the start.',
  'Your response above was cut off mid-stream and only your next message is delivered. Write the complete response again from the start — no apology, no mention of the cut-off.',
].flatMap(s => jsonFieldNeedles(s, true))

export type UsageScanPermission =
  | { allowed: true }
  | { allowed: false; reason: string }

function hasHipaaComplianceTaint(): boolean {
  const host = leftoverPolicyLimitsHost()
  return (
    host.complianceTaints.includes('hipaa') ||
    host.hintedTaints.includes('hipaa')
  )
}

/** densable `U(Ee)` / `v(Oe)`. */
export function usageTranscriptScanPermission(): UsageScanPermission {
  if (isPolicyLimitsAllowed(USAGE_TRANSCRIPT_SCAN_POLICY)) {
    return { allowed: true }
  }
  if (
    leftoverPolicyLimitsRh(USAGE_TRANSCRIPT_SCAN_POLICY) === 'org_denied' &&
    hasHipaaComplianceTaint()
  ) {
    return { allowed: false, reason: USAGE_TRANSCRIPT_SCAN_HIPAA_REASON }
  }
  const { featureLabel, verb } = policyLimitsFeatureCopy(
    USAGE_TRANSCRIPT_SCAN_POLICY,
  )
  return {
    allowed: false,
    reason:
      leftoverPolicyLimitsDp(
        USAGE_TRANSCRIPT_SCAN_POLICY,
        featureLabel,
        verb,
      ) ?? `${featureLabel} ${verb} unavailable right now.`,
  }
}

export type UsageBehaviorKey =
  | 'cache_miss'
  | 'long_context'
  | 'subagent_heavy'
  | 'high_parallel'
  | 'cron'

export type UsageWarningBehaviorKey =
  | 'max_effort'
  | 'workflow'
  | 'always_on_context'
  | 'large_tool_results'

export type UsageBehaviorStat = {
  key: UsageBehaviorKey
  cost: number
  count: number
}

export type UsageWarningBehaviorStat = {
  key: UsageWarningBehaviorKey
  cost: number
  count: number
}

export type UsageNamedShare = {
  name: string
  pct: number
}

export type UsageScanWindow = {
  totalCost: number
  requestCount: number
  sessionCount: number
  behaviors: UsageBehaviorStat[]
  warningBehaviors?: UsageWarningBehaviorStat[]
  peakParallel?: number
  agents: UsageNamedShare[]
  skills: UsageNamedShare[]
  plugins: UsageNamedShare[]
  mcpServers: UsageNamedShare[]
  loops: LoopUsageRow[]
}

export type UsageScanResult = {
  day: UsageScanWindow
  week: UsageScanWindow
}

type LoopSpec = { prompt: string; cron?: string; isDynamic: boolean }

type LoopShare = { loop: LoopSpec; fireTs: number; share: number }

type ScanRecord = {
  ts: number
  sessionId: string
  uuid: string
  cached: number
  cacheCreate: number
  recached: number
  uncached: number
  output: number
  isSubagent: boolean
  isMaxEffort: boolean
  isWorkflow: boolean
  alwaysOnTokens: number
  largeToolResultTokens: number
  modelTier: number
  model?: string
  attributionAgent?: string
  attributionSkill?: string
  attributionPlugin?: string
  attributionMcpServer?: string
  loop?: LoopSpec
  loopFireTs?: number
  loopShares?: LoopShare[]
}

type LoopFire = {
  ts: number
  uuid: string
  loop: LoopSpec
}

type QueuedFire = {
  ts: number
  openBatch?: number
  uuid: string
  taskId?: string
  loop: LoopSpec | null
}

type AccSession = {
  cost: number
  requests: number
  subCost: number
  subCount: number
  hours: Set<number>
}

type AccBucket = { sids: Set<string>; cost: number; count: number }

type WindowAcc = {
  totalCost: number
  requestCount: number
  cacheMissCost: number
  cacheMissCount: number
  longCtxCost: number
  longCtxCount: number
  maxEffortCost: number
  maxEffortCount: number
  workflowCost: number
  workflowCount: number
  alwaysOnCost: number
  alwaysOnCount: number
  largeToolResultCost: number
  largeToolResultCount: number
  sessions: Map<string, AccSession>
  buckets: Map<number, AccBucket>
  byAgent: Map<string, number>
  bySkill: Map<string, number>
  byPlugin: Map<string, number>
  byMcpServer: Map<string, number>
  loops: Map<string, LoopUsageRow>
}

function emptyAcc(): WindowAcc {
  return {
    totalCost: 0,
    requestCount: 0,
    cacheMissCost: 0,
    cacheMissCount: 0,
    longCtxCost: 0,
    longCtxCount: 0,
    maxEffortCost: 0,
    maxEffortCount: 0,
    workflowCost: 0,
    workflowCount: 0,
    alwaysOnCost: 0,
    alwaysOnCount: 0,
    largeToolResultCost: 0,
    largeToolResultCount: 0,
    sessions: new Map(),
    buckets: new Map(),
    byAgent: new Map(),
    bySkill: new Map(),
    byPlugin: new Map(),
    byMcpServer: new Map(),
    loops: new Map(),
  }
}

function indexOf(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): number {
  const r = buf.subarray(start, end).indexOf(needle)
  return r < 0 ? -1 : start + r
}

function hasNeedle(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): boolean {
  return indexOf(buf, needle, start, end) >= 0
}

function hasAnyNeedle(
  buf: Buffer,
  needles: readonly Buffer[],
  end: number,
): boolean {
  return needles.some(n => indexOf(buf, n, 0, end) >= 0)
}

function readQuoted(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): string | undefined {
  const at = indexOf(buf, needle, start, end)
  if (at < 0) return
  const i = at + needle.length
  let c = i
  while (c < end && buf[c] !== 34) c++
  return buf.toString('utf8', i, c)
}

/** densable `Cn` — avoid splitting a trailing UTF-8 multibyte sequence. */
function trimIncompleteUtf8(buf: Buffer, start: number, end: number): number {
  let s = end
  while (s > start && (buf[s - 1]! & 192) === 128) s--
  if (s === start) return start
  const lead = buf[s - 1]!
  const need = lead >= 240 ? 4 : lead >= 224 ? 3 : lead >= 192 ? 2 : 1
  return end - (s - 1) < need ? s - 1 : end
}

/** densable `P` — unescaped JSON string field up to `maxBytes`. */
function readJsonEscapedString(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
  maxBytes: number,
): string | undefined {
  const at = indexOf(buf, needle, start, end)
  if (at < 0) return
  const a = at + needle.length
  let u = a
  const limit = Math.min(end, a + maxBytes)
  while (u < limit && buf[u] !== 34) {
    if (buf[u] === 92) u++
    u++
  }
  const truncated = u >= limit
  if (u > limit) u = limit - 1
  if (truncated) u = trimIncompleteUtf8(buf, a, u)
  let raw = buf.toString('utf8', a, u)
  if (truncated) {
    raw = raw.replace(/(^|[^\\])((?:\\\\)*)\\u[0-9a-fA-F]{0,3}$/, '$1$2')
  }
  try {
    const parsed = jsonParse(`"${raw}"`)
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** densable `CV`. */
function sanitizeLoopText(raw: string, maxChars: number): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned
}

function sanitizeLoopCron(raw: string | undefined): string | undefined {
  return raw === undefined
    ? undefined
    : sanitizeLoopText(raw, LOOP_CRON_MAX_CHARS)
}

/** densable `bn` — find `"id":"msg_..."`. */
function readMessageId(
  buf: Buffer,
  start: number,
  end: number,
): string | undefined {
  let pos = start
  for (;;) {
    pos = indexOf(buf, ID_FIELD, pos, end)
    if (pos < 0) return
    const valStart = pos + ID_FIELD.length
    if (indexOf(buf, MSG_PREFIX, valStart, valStart + 4) === valStart) {
      let c = valStart
      while (c < end && buf[c] !== 34) c++
      return buf.toString('utf8', valStart, c)
    }
    pos = valStart
  }
}

function readInt(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): number {
  const at = indexOf(buf, needle, start, end)
  if (at < 0) return 0
  let i = at + needle.length
  let n = 0
  while (i < end && buf[i]! >= 48 && buf[i]! <= 57) {
    n = n * 10 + (buf[i]! - 48)
    i++
  }
  return n
}

/** densable `Nt` / `An`. */
export function modelTier(model: string | undefined): number {
  if (!model) return 3
  const n = model.toLowerCase()
  if (n.includes('fable')) return 10
  if (n.includes('opus')) return 5
  if (n.includes('haiku')) return 1
  return 3
}

/** densable `xuo` / `On`. */
export function recordCostUsd(rec: {
  cached: number
  uncached: number
  cacheCreate: number
  output: number
  modelTier: number
}): number {
  return (
    (rec.cached +
      rec.uncached * 10 +
      rec.cacheCreate * 12.5 +
      rec.output * 50) *
    rec.modelTier
  )
}

/** Official 2.1.299 (#581) `Vt` — check if `needle` sits at the root JSON object of `buf`. */
function hasTopLevelNeedle(buf: Buffer, needle: Buffer): boolean {
  const rootEnd = buf.lastIndexOf(CHAR_RBRACE)
  for (
    let pos = buf.lastIndexOf(needle);
    pos >= 0;
    pos = pos === 0 ? -1 : buf.lastIndexOf(needle, pos - 1)
  ) {
    let depth = 1
    let inString = false
    let i = pos + needle.length
    for (; i < buf.length && depth > 0; i++) {
      const ch = buf[i]!
      if (inString) {
        if (ch === CHAR_BACKSLASH) i++
        else if (ch === CHAR_QUOTE) inString = false
      } else if (ch === CHAR_QUOTE) {
        inString = true
      } else if (ch === CHAR_LBRACE || ch === CHAR_LBRACKET) {
        depth++
      } else if (ch === CHAR_RBRACE || ch === CHAR_RBRACKET) {
        depth--
      }
    }
    if (depth === 0 && i - 1 === rootEnd) return true
  }
  return false
}

type ContextTracker = {
  firstPromptBytes: number
  startTokens: number
  lastRequest: string | undefined
  lastContext: number
  carriedTokens: number
  pendingToolResultBytes: number
  largeToolResultTokens: number
}

function createContextTracker(): ContextTracker {
  return {
    firstPromptBytes: 0,
    startTokens: Infinity,
    lastRequest: undefined,
    lastContext: 0,
    carriedTokens: 0,
    pendingToolResultBytes: 0,
    largeToolResultTokens: 0,
  }
}

function isLargeToolResultSize(bytes: number): boolean {
  return bytes / BYTES_PER_TOKEN > LARGE_TOOL_RESULT_MIN_TOKENS
}

function noteFirstPromptBytes(tracker: ContextTracker, bytes: number): void {
  if (tracker.lastRequest === undefined && tracker.firstPromptBytes === 0) {
    tracker.firstPromptBytes = bytes
  }
}

function noteToolResultBytes(tracker: ContextTracker, bytes: number): void {
  if (isLargeToolResultSize(bytes)) {
    tracker.pendingToolResultBytes += bytes
  }
}

function noteAssistantContext(tracker: ContextTracker, rec: ScanRecord): void {
  const ctx = rec.cached + rec.cacheCreate + rec.uncached
  if (rec.uuid === tracker.lastRequest) {
    tracker.carriedTokens = Math.max(tracker.carriedTokens, ctx + rec.output)
  } else {
    if (tracker.lastRequest === undefined) {
      tracker.startTokens =
        ctx - Math.round(tracker.firstPromptBytes / BYTES_PER_TOKEN)
    } else if (ctx < tracker.lastContext) {
      tracker.largeToolResultTokens = Math.max(
        0,
        tracker.largeToolResultTokens - (tracker.lastContext - ctx),
      )
    } else {
      const added = Math.min(
        ctx - tracker.carriedTokens,
        tracker.pendingToolResultBytes / BYTES_PER_TOKEN,
      )
      if (added > LARGE_TOOL_RESULT_MIN_TOKENS) {
        tracker.largeToolResultTokens += added
      }
    }
    tracker.startTokens = Math.min(tracker.startTokens, ctx)
    tracker.lastRequest = rec.uuid
    tracker.lastContext = ctx
    tracker.carriedTokens = ctx + rec.output
    tracker.pendingToolResultBytes = 0
  }
  rec.largeToolResultTokens = tracker.largeToolResultTokens
  rec.alwaysOnTokens =
    !rec.isSubagent && tracker.startTokens > ALWAYS_ON_MIN_TOKENS
      ? tracker.startTokens
      : 0
}

/** densable `Gn` / `Xt` (assistant usage record). */
function recordFromChunk(
  buf: Buffer,
  start: number,
  end: number,
  cutoff: number,
  isSubagentFile = false,
  isWorkflow = false,
): ScanRecord | null {
  if (!hasNeedle(buf, TYPE_ASSISTANT, start, end)) return null
  if (!hasNeedle(buf, USAGE, start, end)) return null
  const tsRaw = readQuoted(buf, TIMESTAMP, start, end)
  const sessionId = readQuoted(buf, SESSION_ID, start, end)
  if (!tsRaw || !sessionId) return null
  const ts = Date.parse(tsRaw)
  if (Number.isNaN(ts) || ts < cutoff) return null
  const uncached = readInt(buf, INPUT_TOKENS, start, end)
  const output = readInt(buf, OUTPUT_TOKENS, start, end)
  const cacheCreate = readInt(buf, CACHE_CREATE, start, end)
  const cached = readInt(buf, CACHE_READ, start, end)
  if (uncached + output + cacheCreate + cached === 0) return null
  const model = readQuoted(buf, MODEL, start, end)
  const hasAttr = hasNeedle(buf, HAS_ATTRIBUTION, start, end)
  const uuid =
    readQuoted(buf, REQUEST_ID, start, end) ??
    readMessageId(buf, start, end) ??
    readQuoted(buf, UUID, start, end) ??
    ''
  const isSubagent =
    isSubagentFile ||
    hasNeedle(buf, SIDECHAIN, start, end) ||
    hasNeedle(buf, SIDECHAIN_SP, start, end)
  return {
    ts,
    sessionId,
    uuid,
    cached,
    cacheCreate,
    recached: 0,
    uncached,
    output,
    isSubagent,
    isMaxEffort: hasTopLevelNeedle(buf.subarray(start, end), EFFORT_MAX),
    isWorkflow,
    alwaysOnTokens: 0,
    largeToolResultTokens: 0,
    modelTier: modelTier(model),
    model,
    ...(hasAttr
      ? {
          attributionAgent: readQuoted(buf, ATTR_AGENT, start, end),
          attributionSkill: readQuoted(buf, ATTR_SKILL, start, end),
          attributionPlugin: readQuoted(buf, ATTR_PLUGIN, start, end),
          attributionMcpServer: readQuoted(buf, ATTR_MCP, start, end),
        }
      : {}),
  }
}

/** densable `Bn`. */
function isPriorLoopWakeupSummary(buf: Buffer, end: number): boolean {
  const o = indexOf(buf, CONTENT_BRACKET, 0, end)
  if (o < 0) return false
  let s = o + CONTENT_BRACKET.length
  const r = s
  while (s < end && buf[s]! >= 48 && buf[s]! <= 57) s++
  return s > r && indexOf(buf, PRIOR_LOOP_WAKEUP, s, end) === s
}

/** densable `Kn`. */
function extractFallbackLoopFromUser(
  buf: Buffer,
  end: number,
): LoopSpec | null {
  const raw =
    readJsonEscapedString(buf, CONTENT_QUOTE, 0, end, LOOP_PROMPT_SCAN_BYTES) ??
    readJsonEscapedString(buf, TEXT_QUOTE, 0, end, LOOP_PROMPT_SCAN_BYTES)
  if (!raw) return null
  const cmdName = raw.match(COMMAND_NAME_RE)?.[1]
  const prompt = sanitizeLoopText(cmdName ?? raw, LOOP_PROMPT_MAX_CHARS)
  return prompt ? { prompt, cron: undefined, isDynamic: false } : null
}

/**
 * densable `Un` / `qt` — per-file state machine pairing `scheduled_task_fire`
 * with user/assistant turns, tracking `openBatch` and splitting shared turns
 * across `loopShares`.
 */
function createFileLineConsumer(
  target: { records: ScanRecord[]; fires: LoopFire[] },
  cutoff: number,
  isSubagentFile = false,
  isWorkflow = false,
): (line: Buffer) => void {
  let batchId = 0
  let pendingFires: QueuedFire[] = []
  let activeFires: Array<{ loop: LoopSpec; fireTs: number }> = []
  let turnUserCount = 0
  let afterAssistant = true
  let lastPending:
    | { fire: QueuedFire | undefined; run: boolean; isCommandRecord: boolean }
    | undefined
  let stickyDynamicPrompt: string | undefined
  const ctxTracker = createContextTracker()
  const prevBySubagent = new Map<boolean, ScanRecord>()

  const advanceBatch = () => {
    batchId++
    activeFires = []
    turnUserCount = 0
    afterAssistant = false
  }
  const resetBatch = () => {
    batchId++
    activeFires = []
    turnUserCount = 0
    afterAssistant = true
    stickyDynamicPrompt = undefined
    lastPending = undefined
  }
  const rollbackLastPending = () => {
    if (!lastPending) return
    turnUserCount = Math.max(0, turnUserCount - 1)
    if (lastPending.run) {
      target.fires.pop()
      activeFires.pop()
    }
    if (lastPending.fire && lastPending.fire.taskId === undefined) {
      pendingFires.unshift(lastPending.fire)
    }
    lastPending = undefined
  }
  const cancelCommandRecord = () => {
    if (lastPending?.isCommandRecord) {
      rollbackLastPending()
      resetBatch()
    }
  }
  const dequeueMatchingFire = (
    line: Buffer,
    end: number,
  ): QueuedFire | undefined => {
    const fireId = readQuoted(line, SCHEDULED_FIRE_ID, 0, end)
    if (fireId !== undefined) {
      const idx = pendingFires.findIndex(f => f.uuid === fireId)
      return idx < 0 ? undefined : pendingFires.splice(idx, 1)[0]
    }
    const taskId = readQuoted(line, SCHEDULED_TASK_ID, 0, end)
    if (taskId !== undefined) {
      const idx = pendingFires.findLastIndex(f => f.taskId === taskId)
      if (idx < 0) return undefined
      const hit = pendingFires[idx]
      pendingFires = pendingFires.filter(f => f.taskId !== taskId)
      return hit
    }
    if (
      !(
        indexOf(line, ORIGIN_OBJ, 0, end) < 0 &&
        (indexOf(line, IS_META, 0, end) >= 0 ||
          hasAnyNeedle(line, COMMAND_TAG_NEEDLES, end))
      )
    ) {
      pendingFires = pendingFires.filter(f => f.taskId !== undefined)
      return undefined
    }
    if (pendingFires[0]?.taskId === undefined) {
      return pendingFires.shift()
    }
    return undefined
  }
  const isIgnoredMetaUser = (line: Buffer, end: number): boolean =>
    indexOf(line, IS_META, 0, end) >= 0 &&
    (META_PREFIX_NEEDLES.some(n => indexOf(line, n, 0, end) >= 0) ||
      META_EXACT_NEEDLES.some(n => indexOf(line, n, 0, end) >= 0))

  return (line: Buffer) => {
    const end = line.length
    if (indexOf(line, TYPE_ASSISTANT, 0, end) >= 0) {
      const rec = recordFromChunk(
        line,
        0,
        end,
        cutoff,
        isSubagentFile,
        isWorkflow,
      )
      afterAssistant = true
      lastPending = undefined
      if (rec) {
        noteAssistantContext(ctxTracker, rec)
        const prev = prevBySubagent.get(rec.isSubagent)
        if (
          prev?.cached === rec.cached &&
          prev.cacheCreate === rec.cacheCreate &&
          prev.uncached === rec.uncached
        ) {
          rec.recached = prev.recached
        } else if (prev) {
          rec.recached = Math.min(
            rec.cacheCreate,
            Math.max(0, prev.cached + prev.cacheCreate - rec.cached),
          )
        }
        prevBySubagent.set(rec.isSubagent, rec)
        if (turnUserCount > 1 && activeFires.length > 0) {
          const share = 1 / turnUserCount
          rec.loopShares = activeFires.map(f => ({ ...f, share }))
        } else if (activeFires[0]) {
          rec.loop = activeFires[0].loop
          rec.loopFireTs = activeFires[0].fireTs
        }
        target.records.push(rec)
      }
      return
    }
    if (indexOf(line, TYPE_USER, 0, end) >= 0) {
      const toolUsePos = indexOf(line, TOOL_USE_ID_FIELD, 0, end)
      if (toolUsePos < 0) {
        noteFirstPromptBytes(ctxTracker, end)
      } else {
        const contentPos = indexOf(line, CONTENT_FIELD, toolUsePos, end)
        if (contentPos >= 0) {
          noteToolResultBytes(ctxTracker, end - contentPos)
        }
      }
      if (
        indexOf(line, TYPE_TOOL_RESULT, 0, end) >= 0 ||
        indexOf(line, TURN_COMPANION, 0, end) >= 0 ||
        indexOf(line, COMPACT_SUMMARY, 0, end) >= 0 ||
        hasAnyNeedle(line, BASH_OUTPUT_NEEDLES, end) ||
        isPriorLoopWakeupSummary(line, end) ||
        isIgnoredMetaUser(line, end)
      ) {
        return
      }
      if (indexOf(line, INTERRUPTED_BY_USER, 0, end) >= 0) {
        resetBatch()
        return
      }
      const isMeta = indexOf(line, IS_META, 0, end) >= 0
      if (isMeta && hasAnyNeedle(line, HOOK_STOPPED_NEEDLES, end)) {
        rollbackLastPending()
        if (turnUserCount === 0) resetBatch()
        return
      }
      if (hasAnyNeedle(line, LOCAL_OUTPUT_NEEDLES, end)) {
        cancelCommandRecord()
        return
      }
      const isCommandRecord = hasAnyNeedle(line, COMMAND_TAG_NEEDLES, end)
      if (
        hasAnyNeedle(line, LOCAL_CAVEAT_NEEDLES, end) ||
        (isMeta &&
          !isCommandRecord &&
          indexOf(line, PROMPT_SOURCE, 0, end) < 0 &&
          indexOf(line, SCHEDULED_TASK_ID, 0, end) < 0)
      ) {
        return
      }
      const isHumanTurn =
        indexOf(line, ORIGIN_HUMAN, 0, end) >= 0 ||
        (!isMeta &&
          !isCommandRecord &&
          indexOf(line, SCHEDULED_TASK_ID, 0, end) < 0)
      const matchedFire = dequeueMatchingFire(line, end)
      if (
        matchedFire?.openBatch === batchId &&
        !afterAssistant &&
        turnUserCount > 0
      ) {
        resetBatch()
      }
      if (afterAssistant || isHumanTurn) {
        advanceBatch()
      }
      turnUserCount++
      lastPending = {
        fire: matchedFire,
        run: false,
        isCommandRecord,
      }
      if (!matchedFire) {
        stickyDynamicPrompt = undefined
        return
      }
      const resolvedLoop =
        matchedFire.loop ?? extractFallbackLoopFromUser(line, end)
      if (!resolvedLoop) return
      if (!resolvedLoop.isDynamic) stickyDynamicPrompt = undefined
      if (matchedFire.ts < cutoff) return
      target.fires.push({
        ts: matchedFire.ts,
        uuid: matchedFire.uuid,
        loop: resolvedLoop,
      })
      activeFires.push({ loop: resolvedLoop, fireTs: matchedFire.ts })
      lastPending.run = true
      return
    }
    if (
      indexOf(line, TYPE_SYSTEM, 0, end) >= 0 &&
      indexOf(line, SUBTYPE_LOCAL_COMMAND, 0, end) >= 0 &&
      hasAnyNeedle(line, LOCAL_OUTPUT_NEEDLES, end)
    ) {
      cancelCommandRecord()
      return
    }
    if (
      indexOf(line, TYPE_ATTACHMENT, 0, end) >= 0 &&
      indexOf(line, TYPE_QUEUED_COMMAND, 0, end) >= 0
    ) {
      resetBatch()
      return
    }
    if (indexOf(line, SCHEDULED_FIRE, 0, end) >= 0) {
      const tsRaw = readQuoted(line, TIMESTAMP, 0, end)
      const ts = tsRaw ? Date.parse(tsRaw) : NaN
      if (Number.isNaN(ts)) return
      const rawPrompt = readJsonEscapedString(
        line,
        LOOP_PROMPT,
        0,
        end,
        LOOP_PROMPT_SCAN_BYTES,
      )
      let prompt = rawPrompt
        ? sanitizeLoopText(rawPrompt, LOOP_PROMPT_MAX_CHARS)
        : undefined
      const isDynamic = indexOf(line, TASK_KIND_LOOP, 0, end) >= 0
      if (prompt && isDynamic) {
        stickyDynamicPrompt ??= prompt
        prompt = stickyDynamicPrompt
      }
      const rawCron = readJsonEscapedString(
        line,
        LOOP_CRON,
        0,
        end,
        LOOP_CRON_SCAN_BYTES,
      )
      pendingFires.push({
        ts,
        openBatch: turnUserCount > 0 && !afterAssistant ? batchId : undefined,
        uuid: readQuoted(line, UUID, 0, end) ?? '',
        taskId: readQuoted(line, TASK_ID, 0, end),
        loop: prompt
          ? {
              prompt,
              cron: sanitizeLoopCron(rawCron),
              isDynamic,
            }
          : null,
      })
    }
  }
}

function addNamed(
  map: Map<string, number>,
  name: string | undefined,
  cost: number,
): void {
  if (!name) return
  map.set(name, (map.get(name) ?? 0) + cost)
}

function loopRow(acc: WindowAcc, loop: LoopSpec): LoopUsageRow {
  let row = acc.loops.get(loop.prompt)
  if (!row) {
    row = {
      prompt: loop.prompt,
      cron: loop.cron,
      isDynamic: loop.isDynamic,
      runs: 0,
      tokens: 0,
      lastRunMs: 0,
    }
    acc.loops.set(loop.prompt, row)
  }
  return row
}

/** densable `Z` / `se`. */
function addFire(acc: WindowAcc, fire: LoopFire): void {
  const row = loopRow(acc, fire.loop)
  row.runs++
  if (fire.ts >= row.lastRunMs) {
    row.lastRunMs = fire.ts
    row.cron = fire.loop.cron ?? row.cron
    row.isDynamic = fire.loop.isDynamic
  }
}

/** densable `ee` / `re`. */
function addRecord(
  acc: WindowAcc,
  rec: ScanRecord,
  fireCutoff = -Infinity,
): void {
  const cost = recordCostUsd(rec)
  acc.totalCost += cost
  acc.requestCount++
  if (rec.attributionAgent) {
    addNamed(acc.byAgent, rec.attributionSkill ?? rec.attributionAgent, cost)
  } else {
    addNamed(acc.bySkill, rec.attributionSkill, cost)
  }
  addNamed(acc.byPlugin, rec.attributionPlugin, cost)
  addNamed(acc.byMcpServer, rec.attributionMcpServer, cost)
  if (rec.loop || rec.loopShares) {
    const totalTokens = rec.cached + rec.cacheCreate + rec.uncached + rec.output
    const shares: LoopShare[] =
      rec.loopShares ??
      (rec.loop
        ? [
            {
              loop: rec.loop,
              fireTs: rec.loopFireTs ?? rec.ts,
              share: 1,
            },
          ]
        : [])
    for (const { loop, fireTs, share } of shares) {
      if (fireTs >= fireCutoff) {
        loopRow(acc, loop).tokens += totalTokens * share
      }
    }
  }
  const ctx = rec.cached + rec.cacheCreate + rec.uncached
  if (rec.uncached + rec.recached > CACHE_MISS_UNCACHED) {
    acc.cacheMissCost += cost
    acc.cacheMissCount++
  }
  if (ctx > LONG_CTX_TOKENS) {
    acc.longCtxCost += cost
    acc.longCtxCount++
  }
  if (rec.isMaxEffort) {
    acc.maxEffortCost += cost
    acc.maxEffortCount++
  }
  if (rec.isWorkflow) {
    acc.workflowCost += cost
    acc.workflowCount++
  }
  const inputShareCost = cost - rec.output * 50 * rec.modelTier
  if (rec.alwaysOnTokens > 0 && ctx > 0) {
    acc.alwaysOnCost += inputShareCost * Math.min(1, rec.alwaysOnTokens / ctx)
    acc.alwaysOnCount++
  }
  if (rec.largeToolResultTokens > 0 && ctx > 0) {
    acc.largeToolResultCost +=
      inputShareCost * Math.min(1, rec.largeToolResultTokens / ctx)
    acc.largeToolResultCount++
  }
  let session = acc.sessions.get(rec.sessionId)
  if (!session) {
    session = {
      cost: 0,
      requests: 0,
      subCost: 0,
      subCount: 0,
      hours: new Set(),
    }
    acc.sessions.set(rec.sessionId, session)
  }
  session.cost += cost
  session.requests++
  if (rec.isSubagent) {
    session.subCost += cost
    session.subCount++
  }
  session.hours.add(Math.floor(rec.ts / 3_600_000))
  const bucketId = Math.floor(rec.ts / PARALLEL_BUCKET_MS)
  let bucket = acc.buckets.get(bucketId)
  if (!bucket) {
    bucket = { sids: new Set(), cost: 0, count: 0 }
    acc.buckets.set(bucketId, bucket)
  }
  bucket.sids.add(rec.sessionId)
  bucket.cost += cost
  bucket.count++
}

/** densable `k` / `D`. */
function namedShares(
  map: Map<string, number>,
  total: number,
): UsageNamedShare[] {
  if (map.size === 0 || total === 0) return []
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => ({ name, pct: Math.round((cost / total) * 100) }))
    .filter(row => row.pct > 0)
}

/** densable `ne` / `ie`. */
function finalizeWindow(acc: WindowAcc): UsageScanWindow {
  let highParallelCost = 0
  let highParallelCount = 0
  let peakParallel = 0
  for (const bucket of acc.buckets.values()) {
    peakParallel = Math.max(peakParallel, bucket.sids.size)
    if (bucket.sids.size >= HIGH_PARALLEL_SIDS) {
      highParallelCost += bucket.cost
      highParallelCount += bucket.count
    }
  }
  let subCost = 0
  let subCount = 0
  let cronCost = 0
  let cronCount = 0
  for (const session of acc.sessions.values()) {
    if (
      session.subCount >= SUBAGENT_HEAVY_COUNT ||
      (session.cost > 0 &&
        session.subCost / session.cost > SUBAGENT_HEAVY_RATIO)
    ) {
      subCost += session.cost
      subCount++
    }
    if (session.hours.size >= CRON_HOURS) {
      cronCost += session.cost
      cronCount++
    }
  }
  const behaviors: UsageBehaviorStat[] = [
    { key: 'cache_miss', cost: acc.cacheMissCost, count: acc.cacheMissCount },
    { key: 'long_context', cost: acc.longCtxCost, count: acc.longCtxCount },
    { key: 'subagent_heavy', cost: subCost, count: subCount },
    { key: 'high_parallel', cost: highParallelCost, count: highParallelCount },
    { key: 'cron', cost: cronCost, count: cronCount },
  ]
  behaviors.sort((a, b) => b.cost - a.cost)
  const warningBehaviors: UsageWarningBehaviorStat[] = [
    { key: 'max_effort', cost: acc.maxEffortCost, count: acc.maxEffortCount },
    { key: 'workflow', cost: acc.workflowCost, count: acc.workflowCount },
    {
      key: 'always_on_context',
      cost: acc.alwaysOnCost,
      count: acc.alwaysOnCount,
    },
    {
      key: 'large_tool_results',
      cost: acc.largeToolResultCost,
      count: acc.largeToolResultCount,
    },
  ]
  warningBehaviors.sort((a, b) => b.cost - a.cost)
  return {
    totalCost: acc.totalCost,
    requestCount: acc.requestCount,
    sessionCount: acc.sessions.size,
    behaviors,
    warningBehaviors,
    peakParallel,
    agents: namedShares(acc.byAgent, acc.totalCost),
    skills: namedShares(acc.bySkill, acc.totalCost),
    plugins: namedShares(acc.byPlugin, acc.totalCost),
    mcpServers: namedShares(acc.byMcpServer, acc.totalCost),
    loops: [...acc.loops.values()]
      .map(row => ({ ...row, tokens: Math.round(row.tokens) }))
      .sort((a, b) => b.tokens - a.tokens),
  }
}

/** densable `ro`. */
export function behaviorsOverMin(window: UsageScanWindow): UsageBehaviorStat[] {
  if (window.totalCost === 0) return []
  return window.behaviors.filter(
    b => (b.cost / window.totalCost) * 100 >= BEHAVIOR_PCT_MIN,
  )
}

/** Official 2.1.299 (#581) — filter extended warning behaviors >= BEHAVIOR_PCT_MIN. */
export function warningBehaviorsOverMin(
  window: UsageScanWindow,
): UsageWarningBehaviorStat[] {
  if (window.totalCost === 0) return []
  return (window.warningBehaviors ?? []).filter(
    b => (b.cost / window.totalCost) * 100 >= BEHAVIOR_PCT_MIN,
  )
}

/** densable `$t`. */
export function windowHasNamedRows(window: UsageScanWindow): boolean {
  return (
    window.agents.length > 0 ||
    window.skills.length > 0 ||
    window.plugins.length > 0 ||
    window.mcpServers.length > 0 ||
    window.loops.length > 0
  )
}

/** densable `de` — deduplicate records and fires across files by uuid. */
function createBatchAggregator(
  onRecord: (rec: ScanRecord) => void,
  onFire?: (fire: LoopFire) => void,
): (fileResult: { records: ScanRecord[]; fires: LoopFire[] }) => void {
  const seen = new Set<string>()
  const take = (uuid: string): boolean => {
    if (!uuid) return true
    if (seen.has(uuid)) return false
    seen.add(uuid)
    return true
  }
  return fileResult => {
    for (const rec of fileResult.records) {
      if (take(rec.uuid)) onRecord(rec)
    }
    if (onFire) {
      for (const fire of fileResult.fires) {
        if (take(fire.uuid)) onFire(fire)
      }
    }
  }
}

async function listTranscriptFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') return []
    throw error
  }
  const files: string[] = []
  const subdirs: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && extname(entry.name) === '.jsonl') {
      files.push(join(dir, entry.name))
    } else if (entry.isDirectory()) {
      subdirs.push(entry.name)
    }
  }
  for (const name of subdirs) {
    const nested = await (async () => {
      const sub = join(dir, name, 'subagents')
      try {
        return (await readdir(sub, { recursive: true }))
          .filter(item => extname(item) === '.jsonl')
          .map(item => join(sub, item))
      } catch (error) {
        if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') return []
        throw error
      }
    })()
    files.push(...nested)
  }
  return files
}

function pathIsSubagent(path: string): boolean {
  return basename(dirname(path)) === 'subagents'
}

function feedLinesFromBuffer(
  buf: Buffer,
  onLine: (line: Buffer) => void,
): void {
  let i = 0
  while (i < buf.length) {
    let j = buf.indexOf(10, i)
    if (j < 0) j = buf.length
    if (j > i) onLine(buf.subarray(i, j))
    i = j + 1
  }
}

async function scanJsonlFile(
  path: string,
  cutoff: number,
): Promise<{ records: ScanRecord[]; fires: LoopFire[] }> {
  const out = { records: [] as ScanRecord[], fires: [] as LoopFire[] }
  let st
  try {
    st = await stat(path)
  } catch (error) {
    if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') return out
    throw error
  }
  if (!st.isFile() || st.mtimeMs < cutoff) return out
  const onLine = createFileLineConsumer(
    out,
    cutoff,
    pathIsSubagent(path),
    path.includes(`${sep}subagents${sep}workflows${sep}`),
  )
  let fh
  try {
    fh = await open(path, 'r')
  } catch (error) {
    if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') return out
    throw error
  }
  try {
    const size = st.size
    if (size <= MAX_TRANSCRIPT_CHUNK) {
      const buf = Buffer.alloc(size)
      let bytesRead = 0
      while (bytesRead < size) {
        const read = await fh.read(buf, bytesRead, size - bytesRead, bytesRead)
        if (read.bytesRead === 0) break
        bytesRead += read.bytesRead
      }
      feedLinesFromBuffer(buf.subarray(0, bytesRead), onLine)
      return out
    }
    let offset = 0
    let carry = Buffer.alloc(0)
    while (offset < size) {
      const len = Math.min(MAX_TRANSCRIPT_CHUNK, size - offset)
      const chunk = Buffer.alloc(len)
      const { bytesRead } = await fh.read(chunk, 0, len, offset)
      if (bytesRead === 0) break
      const data = chunk.subarray(0, bytesRead)
      const buf = carry.length ? Buffer.concat([carry, data]) : data
      const lastNl = buf.lastIndexOf(10)
      if (lastNl >= 0) {
        feedLinesFromBuffer(buf.subarray(0, lastNl + 1), onLine)
        carry = Buffer.from(buf.subarray(lastNl + 1))
      } else {
        carry = buf
      }
      offset += bytesRead
    }
    if (carry.length > 0) feedLinesFromBuffer(carry, onLine)
  } finally {
    await fh.close()
  }
  return out
}

type V5PageBudget = { pagesLeft: number; capped: number }

type V5PageOutcome =
  | { status: 'done' }
  | { status: 'capped' }
  | { status: 'error'; error: { code: string } }

type V5TranscriptEntry = {
  key: Record<string, unknown>
  size: number
  mtimeMs: number
}

function isStorageV5(value: unknown): value is StorageV5 {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StorageV5).listEntries === 'function' &&
    typeof (value as StorageV5).read === 'function'
  )
}

/** densable `Bi` — paged v5 listing with shared page budget. */
async function paginateV5(
  fetchPage: (
    cursor: unknown,
  ) => Promise<StorageV5Result<{ items: unknown[]; cursor?: unknown }>>,
  onItems: (items: unknown[]) => void | Promise<void>,
  budget: V5PageBudget,
): Promise<V5PageOutcome> {
  let cursor: unknown
  for (let i = 0; i < V5_SCAN_PAGE_BUDGET; i++) {
    if (budget.pagesLeft < 1) return { status: 'capped' }
    budget.pagesLeft--
    const res = await fetchPage(cursor)
    if (!res.ok) return { status: 'error', error: res.error }
    await onItems(res.value.items)
    cursor = res.value.cursor
    if (!cursor) return { status: 'done' }
  }
  return { status: 'capped' }
}

/** densable `W` — log v5 listing error or first truncation. */
function reportV5ListingStatus(
  label: string,
  outcome: V5PageOutcome,
  budget: V5PageBudget,
): void {
  if (outcome.status === 'error') {
    logForDebugging(
      `foldRecentRecords: v5 ${label} listing failed: ${outcome.error.code}`,
    )
    return
  }
  if (outcome.status === 'capped') {
    budget.capped++
    if (budget.capped === 1) {
      logForDebugging(
        `foldRecentRecords: v5 ${label} listing cut short (the scan's ${V5_SCAN_PAGE_BUDGET}-page budget is spent); keeping what was listed`,
      )
    }
  }
}

function collectV5KeyEntry(target: V5TranscriptEntry[], item: unknown): void {
  const row = item as {
    kind?: string
    key?: Record<string, unknown>
    size?: number
    mtimeMs?: number
  }
  if (
    row.kind === 'key' &&
    row.key?.namespace === 'transcript' &&
    typeof row.size === 'number' &&
    typeof row.mtimeMs === 'number'
  ) {
    target.push({ key: row.key, size: row.size, mtimeMs: row.mtimeMs })
  }
}

/** densable `pe` — recursive v5 subagent transcript listing. */
async function listV5SubagentEntries(
  storage: StorageV5,
  projectKey: string,
  sessionId: string,
  budget: V5PageBudget,
  agentRelPath?: string[],
): Promise<V5TranscriptEntry[]> {
  const entries: V5TranscriptEntry[] = []
  const nestedPaths: string[][] = []
  const outcome = await paginateV5(
    cursor =>
      storage.listEntries(
        {
          namespace: 'transcript',
          projectKey,
          sessionId,
          ...(agentRelPath !== undefined ? { agentRelPath } : {}),
        },
        {
          skipScopeStats: true,
          ...(cursor !== undefined ? { cursor } : {}),
        },
      ),
    items => {
      for (const raw of items) {
        const item = raw as {
          kind?: string
          key?: Record<string, unknown>
          scope?: { namespace?: string; agentRelPath?: string[] }
        }
        if (item.kind === 'key') {
          if (
            item.key?.namespace === 'transcript' &&
            (item.key.agentId !== undefined || item.key.journal === true)
          ) {
            collectV5KeyEntry(entries, raw)
          }
        } else if (
          item.scope?.namespace === 'transcript' &&
          Array.isArray(item.scope.agentRelPath) &&
          item.scope.agentRelPath.length > (agentRelPath?.length ?? 0)
        ) {
          nestedPaths.push(item.scope.agentRelPath)
        }
      }
    },
    budget,
  )
  reportV5ListingStatus('subagent', outcome, budget)
  for (const rel of nestedPaths) {
    entries.push(
      ...(await listV5SubagentEntries(
        storage,
        projectKey,
        sessionId,
        budget,
        rel,
      )),
    )
  }
  return entries
}

/** densable `Nn` — v5 session + subagent transcript listing for one project. */
async function listV5ProjectEntries(
  storage: StorageV5,
  projectKey: string,
  cutoff: number,
  budget: V5PageBudget,
): Promise<V5TranscriptEntry[]> {
  const entries: V5TranscriptEntry[] = []
  const sessionScopes: string[] = []
  const outcome = await paginateV5(
    cursor =>
      storage.listEntries(
        { namespace: 'transcript', projectKey },
        {
          skipScopeStats: true,
          ...(cursor !== undefined ? { cursor } : {}),
        },
      ),
    items => {
      for (const raw of items) {
        const item = raw as {
          kind?: string
          scope?: { namespace?: string; sessionId?: string }
        }
        if (item.kind === 'key') {
          collectV5KeyEntry(entries, raw)
        } else if (
          item.scope?.namespace === 'transcript' &&
          typeof item.scope.sessionId === 'string' &&
          isValidStoragePathSegment(item.scope.sessionId)
        ) {
          sessionScopes.push(item.scope.sessionId)
        }
      }
    },
    budget,
  )
  reportV5ListingStatus('session', outcome, budget)
  const mainMtime = new Map<string, number>()
  for (const entry of entries) {
    if (
      entry.key.namespace === 'transcript' &&
      entry.key.agentId === undefined &&
      entry.key.journal !== true &&
      typeof entry.key.sessionId === 'string'
    ) {
      mainMtime.set(entry.key.sessionId, entry.mtimeMs)
    }
  }
  const activeSessions = sessionScopes.filter(
    sid => (mainMtime.get(sid) ?? Infinity) >= cutoff,
  )
  for (const sid of activeSessions) {
    entries.push(
      ...(await listV5SubagentEntries(storage, projectKey, sid, budget)),
    )
  }
  return entries
}

/** densable `In` — streamed v5 transcript read into line callback. */
async function readV5EntryLines(
  storage: StorageV5,
  entry: V5TranscriptEntry,
  onLine: (line: Buffer) => void,
): Promise<void> {
  const { key } = entry
  const singleRead = entry.size <= MAX_TRANSCRIPT_CHUNK
  let offset = 0
  let carry: Buffer[] = []
  let carryBytes = 0
  for (;;) {
    const res = await storage.read([
      singleRead ? key : { key, offset, length: MAX_TRANSCRIPT_CHUNK },
    ])
    if (!res.ok) {
      logForDebugging(
        `readRecordsFromStream: v5 read failed: ${res.error.code}`,
      )
      return
    }
    const item = res.value.items[0] as
      | {
          found: true
          value: Uint8Array
          totalBytes: number
        }
      | { found: false }
      | undefined
    if (!item || !item.found) return
    const chunk = Buffer.from(
      item.value.buffer,
      item.value.byteOffset,
      item.value.byteLength,
    )
    let pos = 0
    while (pos < chunk.length) {
      const nl = chunk.indexOf(10, pos)
      if (nl === -1) {
        carry.push(Buffer.from(chunk.subarray(pos)))
        carryBytes += chunk.length - pos
        break
      }
      if (carryBytes === 0) {
        onLine(chunk.subarray(pos, nl))
      } else {
        onLine(
          Buffer.concat(
            [...carry, chunk.subarray(pos, nl)],
            carryBytes + (nl - pos),
          ),
        )
        carry = []
        carryBytes = 0
      }
      pos = nl + 1
    }
    offset += item.value.byteLength
    if (
      singleRead ||
      item.value.byteLength === 0 ||
      offset >= item.totalBytes
    ) {
      break
    }
  }
  if (carryBytes > 0) {
    onLine(carry.length === 1 ? carry[0]! : Buffer.concat(carry, carryBytes))
  }
}

/** densable `Ln` — v5 arm of `ue`. */
async function foldRecentRecordsV5(
  storage: StorageV5,
  cutoff: number,
  onRecord: (rec: ScanRecord) => void,
  onFire: (fire: LoopFire) => void,
): Promise<void> {
  const projectKeys: string[] = []
  const budget: V5PageBudget = { pagesLeft: V5_SCAN_PAGE_BUDGET, capped: 0 }
  const outcome = await paginateV5(
    cursor =>
      storage.listEntries(
        { namespace: 'transcript' },
        {
          skipScopeStats: true,
          ...(cursor !== undefined ? { cursor } : {}),
        },
      ),
    items => {
      for (const raw of items) {
        const item = raw as {
          kind?: string
          scope?: {
            namespace?: string
            projectKey?: string
            sessionId?: string
          }
        }
        if (
          item.kind === 'scope' &&
          item.scope?.namespace === 'transcript' &&
          typeof item.scope.projectKey === 'string' &&
          item.scope.sessionId === undefined &&
          isValidStoragePathSegment(item.scope.projectKey)
        ) {
          projectKeys.push(item.scope.projectKey)
        }
      }
    },
    budget,
  )
  reportV5ListingStatus('project', outcome, budget)
  const entries: V5TranscriptEntry[] = []
  for (let i = 0; i < projectKeys.length; i += SCAN_BATCH) {
    const groups = await Promise.all(
      projectKeys
        .slice(i, i + SCAN_BATCH)
        .map(pk => listV5ProjectEntries(storage, pk, cutoff, budget)),
    )
    for (const group of groups) entries.push(...group)
  }
  const aggregate = createBatchAggregator(onRecord, onFire)
  for (let i = 0; i < entries.length; i += SCAN_BATCH) {
    const batch = entries.slice(i, i + SCAN_BATCH)
    const results = await Promise.all(
      batch.map(async entry => {
        const out = { records: [] as ScanRecord[], fires: [] as LoopFire[] }
        if (entry.mtimeMs >= cutoff) {
          const isSubagentFile = entry.key.agentId !== undefined
          const isWorkflow =
            typeof entry.key.agentId === 'string' &&
            entry.key.agentId.startsWith('workflows/')
          await readV5EntryLines(
            storage,
            entry,
            createFileLineConsumer(out, cutoff, isSubagentFile, isWorkflow),
          )
        }
        return out
      }),
    )
    for (const res of results) aggregate(res)
  }
  const extraTruncations = Math.max(0, budget.capped - 1)
  if (extraTruncations > 0) {
    logForDebugging(
      `foldRecentRecords: ${extraTruncations} more v5 listings were cut short after the scan's ${V5_SCAN_PAGE_BUDGET}-page budget ran out`,
    )
  }
}

/** densable `mBt` / `Q5e` — v5 (`Ln`) when storageV5 is provided/pinned, else filesystem. */
export async function scanUsageTranscripts(
  storageV5: unknown = getPinnedStorageV5(),
): Promise<UsageScanResult> {
  const now = Date.now()
  const weekCutoff = now - WEEK_MS
  const dayCutoff = now - 86_400_000
  const day = emptyAcc()
  const week = emptyAcc()
  const onRecord = (rec: ScanRecord) => {
    addRecord(week, rec)
    if (rec.ts >= dayCutoff) addRecord(day, rec, dayCutoff)
  }
  const onFire = (fire: LoopFire) => {
    addFire(week, fire)
    if (fire.ts >= dayCutoff) addFire(day, fire)
  }
  if (isStorageV5(storageV5)) {
    await foldRecentRecordsV5(storageV5, weekCutoff, onRecord, onFire)
    return { day: finalizeWindow(day), week: finalizeWindow(week) }
  }
  let projectDirs: string[]
  try {
    const entries = await readdir(getProjectsDir(), { withFileTypes: true })
    projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch (error) {
    if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') {
      return { day: finalizeWindow(day), week: finalizeWindow(week) }
    }
    throw error
  }
  const files: string[] = []
  for (let i = 0; i < projectDirs.length; i += SCAN_BATCH) {
    const groups = await Promise.all(
      projectDirs
        .slice(i, i + SCAN_BATCH)
        .map(name => listTranscriptFiles(join(getProjectsDir(), name))),
    )
    for (const group of groups) files.push(...group)
  }
  const aggregate = createBatchAggregator(onRecord, onFire)
  for (let i = 0; i < files.length; i += SCAN_BATCH) {
    const batch = files.slice(i, i + SCAN_BATCH)
    const results = await Promise.all(
      batch.map(p => scanJsonlFile(p, weekCutoff)),
    )
    for (const res of results) aggregate(res)
  }
  return { day: finalizeWindow(day), week: finalizeWindow(week) }
}
