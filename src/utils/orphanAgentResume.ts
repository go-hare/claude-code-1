/**
 * Official kqb / SAf / EAf / vAf / Iqb / ese / Hqb / Dqb portable — orphaned
 * background agent/shell/workflow handling on session resume (not bg-adopt claim).
 *
 * Official flow (2.1.211):
 *   wvr(messages, taskRegistry, onDiskResumable?)
 *     → Rqb scan transcript for async agents + shells + workflows + notified
 *     → kqb: classify orphans → auto-resume candidates | stopped/failed notify
 *     → Hqb shell orphans (stopped notify; multi → F$a)
 *     → Dqb workflow orphans (stopped notify + resume hint; >hGo → F$a)
 *   ese.current: after MCP settle, Aye each disk-resumable → EAf|SAf|vAf
 *
 * Portable: Rqb scan + kqb classify/notify + Hqb/Dqb stopped notify + deferred
 * auto-resume. Official lf → emitTaskTerminatedSdk (once-gated) on kqb/Hqb/Dqb
 * terminal orphans (multi F$a + singles).
 */

import {
  COMMAND_ARGS_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  FORKED_SKILL_LAUNCH_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  NOTE_TAG,
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import { asAgentId, toAgentId } from '../types/ids.js'
import { notifyTaskNotification } from './adoptFailNotify.js'
import { escapeXml, unescapeXmlEntities } from './xml.js'

/** Official Agent tool wire names that mark launchedByAgentTool. */
const AGENT_TOOL_NAMES = new Set(['Agent', 'Task'])

/** densable qi `Co` — Skill tool_use ids mark launchedByForkedSkill. */
const SKILL_TOOL_NAMES = new Set(['Skill'])

const FORKED_SKILL_LAUNCH_STRIP_RE = new RegExp(
  `<(${LOCAL_COMMAND_STDOUT_TAG}|${LOCAL_COMMAND_STDERR_TAG}|${COMMAND_NAME_TAG}|${COMMAND_MESSAGE_TAG}|${COMMAND_ARGS_TAG})>[\\s\\S]*</\\1>`,
  'g',
)

const FORKED_SKILL_LAUNCH_BODY_RE = new RegExp(
  `^[\\s�]*<${FORKED_SKILL_LAUNCH_TAG}>([^<]*)</${FORKED_SKILL_LAUNCH_TAG}>\\s*$`,
)

/** Official hGo — max orphans before aggregate-only summary. */
export const ORPHAN_AGENT_CAP = 20

/** Official Aqb — transcript mtime freshness window for auto-resume (48h). */
export const ORPHAN_AUTO_RESUME_MAX_AGE_MS = 172_800_000

/** Official gGo — internal scan marker prefix (F$a task-id markers). */
export const ORPHAN_SUMMARY_PREFIX = '__orphan_summary'
/** densable Et — `__orphan_summary__:agent|shell|workflow` marks remaining keys notified. */
const ORPHAN_SUMMARY_KIND_PREFIX = `${ORPHAN_SUMMARY_PREFIX}__:`
/** densable Pt — `__orphan_summary_live__:` ids stay out of the remaining-key sweep. */
const ORPHAN_SUMMARY_LIVE_PREFIX = `${ORPHAN_SUMMARY_PREFIX}_live__:`

/** Official N$a — aggregate orphan summary text. */
export const ORPHAN_AGGREGATE_SUMMARY =
  'Orphaned by a previous Claude Code process exit and reported in an aggregate summary.'

/**
 * densable Oe — Sp title stem + "didn't finish before the previous session
 * ended". Not exported (gold minify Oe).
 */
function leftoverOrphanDidntFinish(stem: string): string {
  return `${stem} didn't finish before the previous session ended`
}

/** densable `_vr` — Agent/Task tool_use whose subagent_type is web-fetch. */
function leftoverIsWebFetchAgentToolUse(
  block: Record<string, unknown>,
): boolean {
  if (!AGENT_TOOL_NAMES.has(typeof block.name === 'string' ? block.name : '')) {
    return false
  }
  const input = block.input
  if (!isRecord(input) || !('subagent_type' in input)) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isWebFetchAgentTypeName } =
      require('@claude-code/builtin-tools/tools/AgentTool/built-in/webFetchAgent.js') as typeof import('@claude-code/builtin-tools/tools/AgentTool/built-in/webFetchAgent.js')
    return isWebFetchAgentTypeName(input.subagent_type)
  } catch {
    return (
      typeof input.subagent_type === 'string' &&
      input.subagent_type
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\-_]+/g, '') === 'webfetch'
    )
  }
}

/** densable `n=!Nt()` — parent can read output files unless diskless. */
function leftoverLiveAgentTasks(
  getState?: () => unknown,
): Map<string, { type?: string; webFetchSavedFiles?: unknown }> | undefined {
  if (!getState) return undefined
  try {
    const state = getState() as {
      tasks?: Record<string, { type?: string; webFetchSavedFiles?: unknown }>
    }
    const tasks = state?.tasks
    if (!tasks) return undefined
    return new Map(Object.entries(tasks))
  } catch {
    return undefined
  }
}

function leftoverParentCanReadOutputFile(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isDisklessLaunch } =
      require('./sessionHost.js') as typeof import('./sessionHost.js')
    return !isDisklessLaunch()
  } catch {
    return true
  }
}

/**
 * densable kqb `ne` / es / Kco / Yco closing sentence.
 * isWebFetchLaunch → SendMessage only; canReadOutputFile → worktree/output;
 * else status-report SendMessage.
 */
function leftoverOrphanLandingHint(entry: {
  isWebFetchLaunch?: boolean
  canReadOutputFile?: boolean
}): 'webfetch' | 'output' | 'status' {
  if (entry.isWebFetchLaunch === true) return 'webfetch'
  // densable es `!b.canReadOutputFile` — missing field is not readable.
  if (entry.canReadOutputFile !== true) return 'status'
  if (!leftoverParentCanReadOutputFile()) return 'status'
  return 'output'
}

/** densable Lt — omit outputFile for web-fetch launches. Never export minify `Lt`. */
function leftoverOrphanOutputFile(entry: {
  isWebFetchLaunch?: boolean
  outputFile?: string
}): string | undefined {
  if (entry.isWebFetchLaunch) return undefined
  return entry.outputFile
}

/** densable Pe `s=e.canReadOutputFile?Lt(e):void 0`. Never export minify `Pe`. */
function leftoverPeOutputFile(entry: {
  isWebFetchLaunch?: boolean
  canReadOutputFile?: boolean
  outputFile?: string
}): string | undefined {
  if (entry.canReadOutputFile !== true) return undefined
  return leftoverOrphanOutputFile(entry)
}

/**
 * densable Pe XML bookend — SDK already closed via Di/Lt.
 * Gold Zi interpolates Q/ne after Wt; do not escapeXml summary/note again.
 */
function leftoverNotifyOrphanPe(
  entry: OrphanAgentEntry,
  status: 'stopped' | 'failed',
  summary: string,
  note: string,
): void {
  const outputFile = leftoverPeOutputFile(entry)
  const outputLine =
    outputFile !== undefined && outputFile.length > 0
      ? `\n<${OUTPUT_FILE_TAG}>${escapeXml(outputFile)}</${OUTPUT_FILE_TAG}>`
      : ''
  const noteLine = `\n<${NOTE_TAG}>${note}</${NOTE_TAG}>`
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(entry.agentId)}</${TASK_ID_TAG}>${outputLine}
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>${noteLine}
</${TASK_NOTIFICATION_TAG}>`
  try {
    const { enqueuePendingNotification } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
    let targetAgentId: string | undefined
    try {
      const { getSessionId } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      targetAgentId = getSessionId()
    } catch {
      targetAgentId = undefined
    }
    enqueuePendingNotification({
      value: message,
      mode: 'task-notification',
      agentId:
        targetAgentId !== undefined ? asAgentId(targetAgentId) : undefined,
      skipAttachments: true,
      priority: 'next',
      shouldQuery: false,
    })
  } catch {
    /* best-effort */
  }
}

/**
 * densable PNt — `mi().hasInternalAgentEventReader()`. Session CCR
 * `getInternalEventReader()` is a different field; missing agent reader →
 * false (classify failed, not stopped).
 */
function leftoverHasInternalAgentEventReader(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProject } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    return getProject().hasInternalAgentEventReader()
  } catch {
    return false
  }
}

/**
 * densable EPo — unescapeXmlEntities then JSON.parse of
 * `<forked-skill-launch>` JSON. File-private; never export minify `EPo`.
 */
function leftoverParseForkedSkillLaunch(content: string): Array<{
  agentId: string
  skillName: string
  description: string
}> {
  const inner = content
    .replace(FORKED_SKILL_LAUNCH_STRIP_RE, '�')
    .match(FORKED_SKILL_LAUNCH_BODY_RE)?.[1]
  if (inner === undefined) return []
  try {
    const parsed: unknown = JSON.parse(unescapeXmlEntities(inner))
    if (!isRecord(parsed)) return []
    const agentId = typeof parsed.agentId === 'string' ? parsed.agentId : ''
    const skillName =
      typeof parsed.skillName === 'string' ? parsed.skillName : ''
    const description =
      typeof parsed.description === 'string' ? parsed.description : ''
    if (toAgentId(agentId) === null) return []
    if (
      skillName.length < 1 ||
      skillName.length > 256 ||
      /[\r\n]/.test(skillName)
    ) {
      return []
    }
    if (description.length > 4096) return []
    return [{ agentId, skillName, description }]
  } catch {
    return []
  }
}

/** densable kqb `ne` — "it" body + landing-hint tail. */
function leftoverOrphanStoppedNote(
  entry: OrphanAgentEntry,
  kind: 'redispatched' | 'transcript' | 'lost',
): string {
  const hint = leftoverOrphanLandingHint(entry)
  if (kind === 'redispatched') {
    const tail =
      hint === 'webfetch'
        ? 'Send it another message with SendMessage to resume it and get its report before assuming the fetch landed.'
        : hint === 'output'
          ? 'Check its worktree/output for partial work before assuming the task landed.'
          : 'Send it another message with SendMessage to resume it and ask for a status report before assuming the task landed.'
    return `No completion record was found for it after it was re-dispatched via SendMessage in the previous session. It may have been stopped (via the UI, an SDK interrupt, or agent teardown — these leave no transcript marker), or it may have been running when the previous Claude Code process exited. ${tail}`
  }
  if (kind === 'transcript') {
    const tail =
      hint === 'webfetch'
        ? 'Resume it by sending it a message with SendMessage to get its report.'
        : hint === 'output'
          ? 'Resume it by sending it a message with SendMessage, or check its worktree/output for partial work before assuming the task landed.'
          : 'Resume it by sending it a message with SendMessage and ask for a status report before assuming the task landed.'
    return `No completion record was found for it in the previous session. It may have been stopped, or it may have been running when the previous Claude Code process exited — either way its transcript is saved, so its progress is not lost. ${tail}`
  }
  const tail =
    hint === 'webfetch'
      ? 'Launch it again if its report is still needed.'
      : hint === 'output'
        ? 'Check its worktree/output for partial work before assuming the task landed.'
        : 'Do not assume the task landed; launch it again if its result is still needed.'
  return `It was running when the previous Claude Code process exited and did not complete. Its in-process state was lost. ${tail}`
}

/**
 * Official lf portable — once-gated SDK task_notification bookend for orphan
 * terminal paths (kqb/Hqb/Dqb). Singles may also emit via notifyTaskNotification;
 * c7c once-gate in emitTaskTerminatedSdk prevents doubles.
 */
function emitOrphanLf(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  opts?: {
    toolUseId?: string
    summary?: string
    outputFile?: string
    /** densable 2.1.289 Di reason — print restart orphans only */
    reason?: 'worker_restart'
  },
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('./sdkEventQueue.js') as typeof import('./sdkEventQueue.js')
    emitTaskTerminatedSdk(taskId, status, {
      toolUseId: opts?.toolUseId,
      // densable Di `{summary:KS(Q)}` — display-side amp/lt/gt after Wt.
      summary:
        opts?.summary !== undefined
          ? unescapeXmlEntities(opts.summary)
          : undefined,
      outputFile: opts?.outputFile,
      reason: opts?.reason,
    })
  } catch {
    /* best-effort */
  }
}

/** densable print.ts nSm — meta reminder after worker restart orphan stop. */
export function formatWorkerRestartOrphanReminder(
  tasks: ReadonlyArray<{ task_id: string; description?: string }>,
): string {
  return (
    `<system-reminder>\n` +
    `The container was restarted. The following background tasks were running and are now stopped:\n` +
    `${tasks
      .map(t => `- ${t.description || '(no description)'} (task ${t.task_id})`)
      .join('\n')}\n` +
    `Re-create them if still needed.\n` +
    `</system-reminder>`
  )
}

/**
 * densable print.ts Di/Xg restart orphan bookend:
 * Di(id,"stopped",{summary:`Stopped by a worker restart: ${desc||id}`, reason:"worker_restart"})
 */
export function emitWorkerRestartOrphanStopped(
  taskId: string,
  description?: string,
): void {
  emitOrphanLf(taskId, 'stopped', {
    summary: escapeXml(`Stopped by a worker restart: ${description || taskId}`),
    reason: 'worker_restart',
  })
}

/**
 * densable print.ts merge of running_background_tasks +
 * orphaned_background_tasks_pending_notification (task_id keyed; prefer
 * description when present).
 */
export function mergeRestoredWorkerRestartOrphans(
  running: unknown,
  pending: unknown,
): Array<{ task_id: string; description?: string }> {
  const runningList = Array.isArray(running) ? running : []
  const pendingList = Array.isArray(pending) ? pending : []
  const byId = new Map<string, { task_id: string; description?: string }>()
  for (const raw of [...pendingList, ...runningList]) {
    if (!raw || typeof raw !== 'object') continue
    const taskId = (raw as { task_id?: unknown }).task_id
    if (typeof taskId !== 'string' || !taskId) continue
    const descriptionRaw = (raw as { description?: unknown }).description
    const description =
      typeof descriptionRaw === 'string' ? descriptionRaw : undefined
    const prev = byId.get(taskId)
    if (!prev || (!prev.description && description)) {
      byId.set(taskId, { task_id: taskId, description })
    }
  }
  return Array.from(byId.values())
}

export type OrphanAgentEntry = {
  agentId: string
  description?: string
  outputFile?: string
  /** Official redispatched — re-dispatched via SendMessage previously. */
  redispatched?: boolean
  /** Official launchedByAgentTool — only AgentTool-spawned are auto-resumable. */
  launchedByAgentTool?: boolean
  /**
   * densable qi `launchedByForkedSkill` — Skill tool / local_command
   * `<forked-skill-launch>` marker.
   */
  launchedByForkedSkill?: boolean
  /**
   * densable `_vr` — Agent/Task tool_use `subagent_type` is web-fetch
   * (`h9n` / leftover `isWebFetchAgentTypeName`).
   */
  isWebFetchLaunch?: boolean
  /**
   * densable `n && w.canReadOutputFile!==!1` — parent can Read/Bash the
   * output file (`n=!Nt()` diskless).
   */
  canReadOutputFile?: boolean
}

export type OrphanShellEntry = {
  taskId: string
  toolUseId: string
}

export type OrphanWorkflowEntry = {
  taskId: string
  toolUseId: string
  workflowName?: string
  runId?: string
}

export type OrphanClassifyInput = OrphanAgentEntry & {
  /** Transcript file mtime when size>0; null if missing/empty. */
  mtimeMs?: number | null
  /** Official F3 meta present (agent metadata readable). */
  hasMeta?: boolean
  /**
   * densable kqb `fetchable` — no mtime but PNt internal agent event
   * reader can hydrate. Stopped (not failed) when true.
   */
  fetchable?: boolean
}

/**
 * Process-local claim/orphan resume de-dupe (agentId).
 * Covers race where claim BSe + orphan ese both schedule Aye for the same id
 * before registry resuming CAS is visible (cold disk / dual schedule).
 * densable relies on Aye Wl(_) CAS once a task is in-registry; this set
 * covers the pre-registry window shared by claim+orphan paths.
 */
const agentResumeInFlight = new Set<string>()

/** Try to claim agentId for deferred resume. Returns false if already claimed. */
export function tryClaimAgentResumeInFlight(agentId: string): boolean {
  if (!agentId) return false
  if (agentResumeInFlight.has(agentId)) return false
  agentResumeInFlight.add(agentId)
  return true
}

/** Release agentId after deferred resume attempt finishes (success or fail). */
export function releaseAgentResumeInFlight(agentId: string): void {
  agentResumeInFlight.delete(agentId)
}

export function isAgentResumeInFlight(agentId: string): boolean {
  return agentResumeInFlight.has(agentId)
}

/** Test helper — clear process-local claim set. */
export function clearAgentResumeInFlightForTests(): void {
  agentResumeInFlight.clear()
}

export type ScannedAsyncAgents = {
  /** Official Rqb asyncAgents map values. */
  asyncAgents: OrphanAgentEntry[]
  /** Official Rqb bgShells map values. */
  bgShells: OrphanShellEntry[]
  /** Official Rqb workflows map values. */
  workflows: OrphanWorkflowEntry[]
  /** Official notifiedTaskIds — task-notification agent ids seen in transcript. */
  notifiedTaskIds: Set<string>
  /** Official stoppedTaskIds — task_id+task_type tool results (already terminal). */
  stoppedTaskIds: Set<string>
}

type ScanMsg = {
  type?: string
  subtype?: string
  content?: unknown
  timestamp?: string
  message?: { content?: unknown }
  toolUseResult?: unknown
  attachment?: {
    type?: string
    prompt?: unknown
    taskType?: string
    status?: string
    taskId?: string
    shell?: { toolUseId?: string }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Flatten message content to text slices for bAf-style notify parsing. */
function contentTextSlices(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const c of content) {
    if (isRecord(c) && typeof c.text === 'string') out.push(c.text)
  }
  return out
}

type LeftoverOrphanSummaryMarkers = {
  summarizedKinds: Set<'agent' | 'shell' | 'workflow'>
  liveExclusions: Set<string>
}

/**
 * densable co — gate both `<task-notification>` and `<status>`; KS each
 * `<task-id>`. `__orphan_summary_live__:` → liveExclusions (not notified);
 * `__orphan_summary__:kind` → notified + summarizedKinds.
 */
function leftoverCo(
  text: string,
  notified: Set<string>,
): LeftoverOrphanSummaryMarkers {
  const o: LeftoverOrphanSummaryMarkers = {
    summarizedKinds: new Set(),
    liveExclusions: new Set(),
  }
  if (
    !text.includes(`<${TASK_NOTIFICATION_TAG}>`) ||
    !text.includes(`<${STATUS_TAG}>`)
  ) {
    return o
  }
  for (const m of text.matchAll(/<task-id>([^<]*)<\/task-id>/g)) {
    const raw = m[1]
    if (raw === undefined) continue
    const s = unescapeXmlEntities(raw)
    if (!s) continue
    if (s.startsWith(ORPHAN_SUMMARY_LIVE_PREFIX)) {
      o.liveExclusions.add(s.slice(ORPHAN_SUMMARY_LIVE_PREFIX.length))
      continue
    }
    notified.add(s)
    if (s.startsWith(ORPHAN_SUMMARY_KIND_PREFIX)) {
      const u = s.slice(ORPHAN_SUMMARY_KIND_PREFIX.length)
      if (u === 'agent' || u === 'shell' || u === 'workflow') {
        o.summarizedKinds.add(u)
      }
    }
  }
  return o
}

/** densable R — remaining map keys of summarized kinds, minus liveExclusions. */
function leftoverApplyOrphanSummaryMarkers(
  markers: LeftoverOrphanSummaryMarkers,
  maps: {
    agent: Map<string, unknown>
    shell: Map<string, unknown>
    workflow: Map<string, unknown>
  },
  notified: Set<string>,
): void {
  for (const kind of markers.summarizedKinds) {
    const w =
      kind === 'agent'
        ? maps.agent
        : kind === 'shell'
          ? maps.shell
          : maps.workflow
    for (const id of w.keys()) {
      if (!markers.liveExclusions.has(id)) notified.add(id)
    }
  }
}

function collectNotifiedFromContent(
  content: unknown,
  notified: Set<string>,
  maps: {
    agent: Map<string, unknown>
    shell: Map<string, unknown>
    workflow: Map<string, unknown>
  },
): void {
  // densable Yi — join then one co/R (not per-slice).
  leftoverApplyOrphanSummaryMarkers(
    leftoverCo(contentTextSlices(content).join('\n'), notified),
    maps,
    notified,
  )
}

/**
 * Official $co portable — walk transcript reverse:
 *   last user (non-interrupt / !bYt) → incomplete (true)
 *   last assistant → complete (false)
 * Used by Aye alreadyCompleted short-circuit after LVr strip.
 */
export function isAgentTranscriptIncomplete(
  messages: readonly {
    type?: string
    message?: { content?: unknown; stop_reason?: string | null }
  }[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.type === 'user') {
      // Official $co: return !bYt(user)
      if (isInterruptOnlyUserMessage(m)) continue
      return true
    }
    if (m.type === 'assistant') {
      return false
    }
  }
  return false
}

/** Official Ynu — interrupt/meta prefixes for bYt. */
const INTERRUPT_PREFIXES = [
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
]

function startsWithInterruptPrefix(s: string): boolean {
  return INTERRUPT_PREFIXES.some(p => s.startsWith(p))
}

/** Official bYt — user message is only interrupt/meta prefixes. */
export function isInterruptOnlyUserMessage(msg: {
  type?: string
  message?: { content?: unknown }
}): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  if (typeof content === 'string') return startsWithInterruptPrefix(content)
  if (!Array.isArray(content) || content.length === 0) return false
  return content.every(block => {
    if (!isRecord(block)) return false
    let text: string | undefined
    if (block.type === 'text' && typeof block.text === 'string') {
      text = block.text
    } else if (
      block.type === 'tool_result' &&
      block.is_error === true &&
      typeof block.content === 'string'
    ) {
      text = block.content
    }
    return typeof text === 'string' && startsWithInterruptPrefix(text)
  })
}

/** Official tzu — user message is only tool_result blocks. */
function isToolResultOnlyUserMessage(msg: {
  type?: string
  message?: { content?: unknown }
}): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  if (!Array.isArray(content) || content.length === 0) return false
  return content.every(block => isRecord(block) && block.type === 'tool_result')
}

/**
 * Official lXg assistant branch — stripable when stop_reason is null or tool_use.
 */
function isLvrIncompleteAssistant(msg: {
  type?: string
  message?: { stop_reason?: string | null }
}): boolean {
  if (msg.type !== 'assistant') return false
  const stop = msg.message?.stop_reason
  return stop === null || stop === 'tool_use'
}

type LvrMsg = {
  type?: string
  message?: { content?: unknown; stop_reason?: string | null }
  [key: string]: unknown
}

/**
 * Official LVr portable — strip trailing interrupt / incomplete tool-use turns
 * before Aye $co alreadyCompleted check.
 *
 * Walk reverse (official):
 *   user + bYt → strip (r ||= tzu)
 *   user + r && tzu → strip
 *   user else → break
 *   assistant + !lXg → break; else strip and r=false
 *   other types → strip (t--)
 * Then keep non user/assistant/system trailers from the stripped suffix.
 */
export function stripInterruptedTrailingTurns<T extends LvrMsg>(
  messages: readonly T[],
): T[] {
  let cut = messages.length
  let sawInterruptToolResultUser = false
  while (cut > 0) {
    const o = messages[cut - 1]
    if (!o) break
    if (o.type === 'user') {
      if (isInterruptOnlyUserMessage(o)) {
        sawInterruptToolResultUser =
          sawInterruptToolResultUser || isToolResultOnlyUserMessage(o)
      } else if (sawInterruptToolResultUser && isToolResultOnlyUserMessage(o)) {
        // Official: else if (r && tzu(o)); — empty body, still strip
      } else {
        break
      }
    } else if (o.type === 'assistant') {
      if (!isLvrIncompleteAssistant(o)) break
      sawInterruptToolResultUser = false
    }
    // other types: official still t-- (no break)
    cut--
  }
  const trail = messages
    .slice(cut)
    .filter(
      o => o.type !== 'user' && o.type !== 'assistant' && o.type !== 'system',
    )
  if (cut + trail.length === messages.length) return messages as T[]
  return [...messages.slice(0, cut), ...trail]
}

/**
 * Official Aye alreadyCompleted probe — when continueInterruptedTurn would
 * short-circuit because the sidechain already ends on an assistant turn.
 * Reads disk transcript only; does not spawn.
 */
export async function probeAgentTranscriptAlreadyCompleted(
  agentId: string,
): Promise<{ alreadyCompleted: boolean; outputFile?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAgentTranscript } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { asAgentId } =
      require('../types/ids.js') as typeof import('../types/ids.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTaskOutputPath } =
      require('./task/diskOutput.js') as typeof import('./task/diskOutput.js')
    const transcript = await getAgentTranscript(asAgentId(agentId))
    if (!transcript?.messages?.length) {
      return { alreadyCompleted: false }
    }
    // Official Aye: LVr then !$co → alreadyCompleted
    const stripped = stripInterruptedTrailingTurns(
      transcript.messages as LvrMsg[],
    )
    if (stripped.length > 0 && !isAgentTranscriptIncomplete(stripped)) {
      return {
        alreadyCompleted: true,
        outputFile: getTaskOutputPath(agentId),
      }
    }
    return {
      alreadyCompleted: false,
      outputFile: getTaskOutputPath(agentId),
    }
  } catch {
    return { alreadyCompleted: false }
  }
}

/**
 * Official Rqb portable — single-pass chronological scan for async_launched
 * agents, bg shells, workflows, SendMessage redispatches, and task-notification
 * completion ids (bAf). Cron Pqb residual out of scope.
 *
 * Order matches official Rqb per user message:
 *   1) bAf notify collect (add)
 *   2) tool_result redispatched → delete from notified + mark redispatched
 *   3) bg shell / stoppedTaskIds / workflow / async agent upsert
 * No second re-add pass (that re-notified after redispatched).
 */
export function scanAsyncAgentsFromMessages(
  messages: readonly ScanMsg[],
): ScannedAsyncAgents {
  const asyncAgents = new Map<string, OrphanAgentEntry>()
  const bgShells = new Map<string, OrphanShellEntry>()
  const workflows = new Map<string, OrphanWorkflowEntry>()
  const notifiedTaskIds = new Set<string>()
  const stoppedTaskIds = new Set<string>()
  const agentToolUseIds = new Set<string>()
  const webFetchAgentToolUseIds = new Set<string>()
  const skillToolUseIds = new Set<string>()
  const parentCanRead = leftoverParentCanReadOutputFile()

  for (const d of messages) {
    if (d.type === 'assistant') {
      const content = d.message?.content
      if (!Array.isArray(content)) continue
      for (const m of content) {
        if (!isRecord(m) || m.type !== 'tool_use') continue
        const name = typeof m.name === 'string' ? m.name : ''
        const id = typeof m.id === 'string' ? m.id : ''
        if (id && AGENT_TOOL_NAMES.has(name)) {
          agentToolUseIds.add(id)
          if (leftoverIsWebFetchAgentToolUse(m)) {
            webFetchAgentToolUseIds.add(id)
          }
        } else if (id && SKILL_TOOL_NAMES.has(name)) {
          skillToolUseIds.add(id)
        }
      }
      continue
    }

    if (d.type === 'user') {
      // densable R(co(Yi(content), h)) before tool_result — remaining keys of
      // summarized kinds minus liveExclusions.
      collectNotifiedFromContent(d.message?.content, notifiedTaskIds, {
        agent: asyncAgents,
        shell: bgShells,
        workflow: workflows,
      })

      const f = d.toolUseResult
      if (!isRecord(f)) continue
      const content = d.message?.content
      if (!Array.isArray(content)) continue

      let fromAgentTool = false
      let isWebFetchLaunch = false
      let fromSkillTool = false
      for (const g of content) {
        if (!isRecord(g) || g.type !== 'tool_result') continue
        if (g.is_error) continue
        const tuid = typeof g.tool_use_id === 'string' ? g.tool_use_id : ''
        if (tuid && agentToolUseIds.has(tuid)) {
          fromAgentTool = true
          if (webFetchAgentToolUseIds.has(tuid)) isWebFetchLaunch = true
        }
        if (tuid && skillToolUseIds.has(tuid)) fromSkillTool = true

        // Official: SendMessage resume → redispatched; OA UUID gate
        if (
          f.success === true &&
          typeof f.message === 'string' &&
          typeof f.resumedAgentId === 'string' &&
          toAgentId(f.resumedAgentId) !== null
        ) {
          const rid = f.resumedAgentId
          notifiedTaskIds.delete(rid)
          const prev = asyncAgents.get(rid)
          if (prev) {
            prev.redispatched = true
          } else {
            asyncAgents.set(rid, {
              agentId: rid,
              description: f.message,
              redispatched: true,
              isWebFetchLaunch: false,
              canReadOutputFile: parentCanRead,
            })
          }
        }

        // Official: bg shell from Bash background result
        // y = backgroundTaskId+stdout | taskId+timeoutMs
        const shellId =
          typeof f.backgroundTaskId === 'string' && typeof f.stdout === 'string'
            ? f.backgroundTaskId
            : typeof f.taskId === 'string' && typeof f.timeoutMs === 'number'
              ? f.taskId
              : undefined
        if (
          shellId !== undefined &&
          !shellId.startsWith(ORPHAN_SUMMARY_PREFIX) &&
          tuid
        ) {
          bgShells.set(shellId, { taskId: shellId, toolUseId: tuid })
        }

        // Official: task_id + task_type → already-stopped set
        if (
          typeof f.task_id === 'string' &&
          typeof f.task_type === 'string' &&
          f.task_id.length > 0
        ) {
          stoppedTaskIds.add(f.task_id)
        }

        // Official: async_launched local_workflow
        if (
          f.status === 'async_launched' &&
          f.taskType === 'local_workflow' &&
          typeof f.taskId === 'string' &&
          !f.taskId.startsWith(ORPHAN_SUMMARY_PREFIX) &&
          typeof f.error !== 'string' &&
          tuid
        ) {
          workflows.set(f.taskId, {
            taskId: f.taskId,
            toolUseId: tuid,
            workflowName:
              typeof f.workflowName === 'string' ? f.workflowName : undefined,
            runId: typeof f.runId === 'string' ? f.runId : undefined,
          })
        }
      }

      // Official: async_launched agent from Agent tool result
      if (
        f.status === 'async_launched' &&
        typeof f.agentId === 'string' &&
        f.agentId.length > 0 &&
        typeof f.description === 'string'
      ) {
        // Skip official __orphan_summary synthetic ids
        if (f.agentId.startsWith(ORPHAN_SUMMARY_PREFIX)) continue
        asyncAgents.set(f.agentId, {
          agentId: f.agentId,
          description: f.description,
          outputFile:
            typeof f.outputFile === 'string' ? f.outputFile : undefined,
          launchedByAgentTool: fromAgentTool,
          isWebFetchLaunch,
          canReadOutputFile: parentCanRead && f.canReadOutputFile !== false,
        })
      }

      // densable qi: Skill tool_result status=forked + background
      if (
        f.status === 'forked' &&
        f.background === true &&
        typeof f.agentId === 'string' &&
        f.agentId.length > 0 &&
        !f.agentId.startsWith(ORPHAN_SUMMARY_PREFIX) &&
        !asyncAgents.has(f.agentId)
      ) {
        asyncAgents.set(f.agentId, {
          agentId: f.agentId,
          description:
            typeof f.commandName === 'string' ? f.commandName : f.agentId,
          isWebFetchLaunch: false,
          canReadOutputFile: parentCanRead,
          launchedByForkedSkill: fromSkillTool,
        })
      }
      continue
    }

    // densable qi: system local_command → EPo forked-skill-launch
    if (
      d.type === 'system' &&
      d.subtype === 'local_command' &&
      typeof d.content === 'string'
    ) {
      for (const launched of leftoverParseForkedSkillLaunch(d.content)) {
        if (
          launched.agentId.startsWith(ORPHAN_SUMMARY_PREFIX) ||
          asyncAgents.has(launched.agentId)
        ) {
          continue
        }
        asyncAgents.set(launched.agentId, {
          agentId: launched.agentId,
          description: launched.description,
          isWebFetchLaunch: false,
          canReadOutputFile: parentCanRead,
          launchedByForkedSkill: true,
        })
      }
      continue
    }

    // densable qi: attachment task_status local_bash running → bgShells
    if (
      d.type === 'attachment' &&
      d.attachment?.type === 'task_status' &&
      d.attachment.taskType === 'local_bash' &&
      d.attachment.status === 'running' &&
      d.attachment.shell !== undefined &&
      typeof d.attachment.taskId === 'string' &&
      !d.attachment.taskId.startsWith(ORPHAN_SUMMARY_PREFIX)
    ) {
      const tuid = d.attachment.shell.toolUseId
      if (typeof tuid === 'string' && tuid.length > 0) {
        bgShells.set(d.attachment.taskId, {
          taskId: d.attachment.taskId,
          toolUseId: tuid,
        })
      }
      continue
    }

    // Official attachment queued_command → bAf on prompt
    if (
      d.type === 'attachment' &&
      d.attachment?.type === 'queued_command' &&
      typeof d.attachment.prompt === 'string'
    ) {
      leftoverApplyOrphanSummaryMarkers(
        leftoverCo(d.attachment.prompt, notifiedTaskIds),
        {
          agent: asyncAgents,
          shell: bgShells,
          workflow: workflows,
        },
        notifiedTaskIds,
      )
    }
  }

  return {
    asyncAgents: [...asyncAgents.values()],
    bgShells: [...bgShells.values()],
    workflows: [...workflows.values()],
    notifiedTaskIds,
    stoppedTaskIds,
  }
}

/**
 * Official kqb disk probe subset — attach transcript mtime + meta presence.
 */
export async function enrichOrphanCandidatesWithDisk(
  agents: readonly OrphanAgentEntry[],
): Promise<OrphanClassifyInput[]> {
  const out: OrphanClassifyInput[] = []
  for (const a of agents) {
    if (a.redispatched) {
      out.push({ ...a, mtimeMs: null, hasMeta: false, fetchable: false })
      continue
    }
    // densable OA — non-UUID agentId → {mtimeMs:null,hasMeta:!1,fetchable:!1}
    if (toAgentId(a.agentId) === null) {
      out.push({ ...a, mtimeMs: null, hasMeta: false, fetchable: false })
      continue
    }
    let mtimeMs: number | null = null
    let hasMeta = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        getAgentTranscriptPath,
        bindSubagentTranscriptPersistence,
        readAgentMetadata,
      } = require('./sessionStorage.js') as typeof import('./sessionStorage.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { asAgentId } =
        require('../types/ids.js') as typeof import('../types/ids.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { stat } = require('fs/promises') as typeof import('fs/promises')
      const { getPinnedStorageV5 } =
        require('./storageV5/index.js') as typeof import('./storageV5/index.js')
      const branded = asAgentId(a.agentId)
      const path = getAgentTranscriptPath(branded)
      try {
        // densable leftover `Ii` @228342935 — `pe()&&t?On(n,t).statMeta:yi`.
        const bind = bindSubagentTranscriptPersistence(
          path,
          getPinnedStorageV5(),
        )
        const backend = bind?.backend as
          | {
              statMeta?: (key: unknown) => Promise<{
                ok: boolean
                value?: { size?: number; mtimeMs?: number }
              }>
            }
          | undefined
        if (bind && backend?.statMeta) {
          const meta = await backend.statMeta(bind.key)
          if (meta.ok && (meta.value?.size ?? 0) > 0) {
            mtimeMs = meta.value?.mtimeMs ?? null
          }
        }
      } catch {
        /* leftover On miss → FS yi */
      }
      if (mtimeMs === null) {
        try {
          const st = await stat(path)
          mtimeMs = st.size > 0 ? st.mtimeMs : null
        } catch {
          mtimeMs = null
        }
      }
      // densable: hasMeta only when launchedByAgentTool||launchedByForkedSkill
      // and mtime present and ux probe succeeds.
      const launchOk =
        a.launchedByAgentTool === true || a.launchedByForkedSkill === true
      if (launchOk && mtimeMs !== null) {
        try {
          const meta = await readAgentMetadata(branded)
          hasMeta = meta !== null && meta !== undefined
        } catch {
          hasMeta = false
        }
      }
      out.push({
        ...a,
        mtimeMs,
        hasMeta,
        fetchable: mtimeMs === null && leftoverHasInternalAgentEventReader(),
      })
      continue
    } catch {
      mtimeMs = null
      hasMeta = false
    }
    out.push({
      ...a,
      mtimeMs,
      hasMeta,
      fetchable: mtimeMs === null && leftoverHasInternalAgentEventReader(),
    })
  }
  return out
}

/**
 * Official wvr portable — scan → Pqb cron → kqb agents → Hqb shells →
 * Dqb workflows → schedule deferred auto-resume when resumeAgent provided.
 */
export async function runOrphanAgentResumePass(input: {
  messages: readonly ScanMsg[]
  /** Live task registry agent ids (official r.get for agents). */
  liveAgentIds?: ReadonlySet<string> | readonly string[]
  /** Live shell/workflow task ids (official r.get for Hqb/Dqb). */
  liveTaskIds?: ReadonlySet<string> | readonly string[]
  getState?: () => unknown
  subscribe?: (listener: () => void) => () => void
  waitForMcp?: boolean
  /**
   * Official ese Aye. When omitted, auto-resume candidates are still returned
   * but not scheduled.
   */
  resumeAgent?: (entry: OrphanAgentEntry) => Promise<
    | {
        alreadyCompleted?: boolean
        outputFile?: string
      }
    | undefined
  >
  isCurrent?: () => boolean
  notify?: boolean
  autoResumeEnabled?: boolean
  /** When false, skip official Pqb session-cron resurrection. Default true. */
  resurrectCrons?: boolean
}): Promise<{
  scanned: number
  autoResume: OrphanAgentEntry[]
  stopped: number
  failed: number
  shells: { notified: number; skippedLive: number }
  workflows: { notified: number; skippedLive: number }
  crons?: { scanned: number; resurrected: number; skipped: number }
  deferred?: {
    resumed: number
    alreadyCompleted: number
    failed: number
    skipped: boolean
  }
}> {
  // Official Pqb before kqb — session-scoped cron resurrection.
  let crons:
    | { scanned: number; resurrected: number; skipped: number }
    | undefined
  if (input.resurrectCrons !== false) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { runOrphanCronResumePass } =
        require('./orphanCronResume.js') as typeof import('./orphanCronResume.js')
      crons = runOrphanCronResumePass(input.messages)
    } catch {
      crons = { scanned: 0, resurrected: 0, skipped: 0 }
    }
  }

  const scanned = scanAsyncAgentsFromMessages(input.messages)
  const live =
    input.liveAgentIds instanceof Set
      ? input.liveAgentIds
      : new Set(input.liveAgentIds ?? [])
  const liveTasks =
    input.liveTaskIds instanceof Set
      ? input.liveTaskIds
      : new Set(input.liveTaskIds ?? [])
  // Live agents also count as live task ids for shell/workflow skip.
  for (const id of live) liveTasks.add(id)

  const enriched = await enrichOrphanCandidatesWithDisk(scanned.asyncAgents)
  const classified = processOrphanAgentCandidates(enriched, {
    liveAgentIds: live,
    notifiedTaskIds: scanned.notifiedTaskIds,
    notify: input.notify,
    autoResumeEnabled:
      input.autoResumeEnabled !== false && input.resumeAgent !== undefined,
  })

  // Official Hqb / Dqb after kqb
  const shells = processOrphanShells(scanned.bgShells, {
    notifiedTaskIds: scanned.notifiedTaskIds,
    stoppedTaskIds: scanned.stoppedTaskIds,
    liveTaskIds: liveTasks,
    notify: input.notify,
  })
  const workflows = processOrphanWorkflows(scanned.workflows, {
    notifiedTaskIds: scanned.notifiedTaskIds,
    stoppedTaskIds: scanned.stoppedTaskIds,
    liveTaskIds: liveTasks,
    notify: input.notify,
  })

  let deferred:
    | {
        resumed: number
        alreadyCompleted: number
        failed: number
        skipped: boolean
      }
    | undefined
  if (input.resumeAgent && classified.autoResume.length > 0) {
    deferred = await scheduleDeferredOrphanAutoResume({
      agents: classified.autoResume,
      getState: input.getState,
      subscribe: input.subscribe,
      waitForMcp: input.waitForMcp,
      resumeAgent: input.resumeAgent,
      isCurrent: input.isCurrent,
      notify: input.notify,
    })
  }

  return {
    scanned: scanned.asyncAgents.length,
    autoResume: classified.autoResume,
    stopped: classified.stopped.length,
    failed: classified.failed.length,
    shells: {
      notified: shells.notified.length,
      skippedLive: shells.skippedLive.length,
    },
    workflows: {
      notified: workflows.notified.length,
      skippedLive: workflows.skippedLive.length,
    },
    crons,
    deferred,
  }
}

export type OrphanClassifyResult =
  | {
      kind: 'auto-resume'
      entry: OrphanAgentEntry
    }
  | {
      kind: 'stopped' | 'failed'
      entry: OrphanAgentEntry
      /** densable Pe `o` / Zi `summary` — short title Sp paints. */
      summary: string
      /** densable Pe `r` / Zi `body` `<note>` — long copy. Empty when none. */
      note: string
    }

/**
 * Official kqb per-agent decision (subset without lf registry write).
 * Auto-resume when: onDiskResumable callback path enabled +
 * (launchedByAgentTool||launchedByForkedSkill) + hasMeta + fresh mtime.
 * Else stopped if redispatched || mtime || fetchable; failed if no residue.
 */
export function classifyOrphanAgent(
  input: OrphanClassifyInput,
  opts?: {
    nowMs?: number
    /** When false, never auto-resume (no ese path). Default true. */
    autoResumeEnabled?: boolean
    maxAgeMs?: number
  },
): OrphanClassifyResult {
  const now = opts?.nowMs ?? Date.now()
  const maxAge = opts?.maxAgeMs ?? ORPHAN_AUTO_RESUME_MAX_AGE_MS
  const autoOk = opts?.autoResumeEnabled !== false
  const mtime =
    typeof input.mtimeMs === 'number' && Number.isFinite(input.mtimeMs)
      ? input.mtimeMs
      : null
  const hasMeta = input.hasMeta === true
  const desc = input.description ?? input.agentId
  // densable Q = Oe(`Background agent "${Wt(description)}"`)
  const title = leftoverOrphanDidntFinish(
    `Background agent "${escapeXml(desc)}"`,
  )

  if (
    autoOk &&
    (input.launchedByAgentTool === true ||
      input.launchedByForkedSkill === true) &&
    hasMeta &&
    mtime !== null &&
    now - mtime < maxAge
  ) {
    return {
      kind: 'auto-resume',
      entry: {
        agentId: input.agentId,
        description: input.description,
        outputFile: input.outputFile,
        redispatched: input.redispatched,
        launchedByAgentTool: input.launchedByAgentTool,
        launchedByForkedSkill: input.launchedByForkedSkill,
        isWebFetchLaunch: input.isWebFetchLaunch,
        canReadOutputFile: input.canReadOutputFile,
      },
    }
  }

  const hasTranscript = mtime !== null || input.fetchable === true
  const status: 'stopped' | 'failed' =
    input.redispatched || hasTranscript ? 'stopped' : 'failed'

  // densable ne — body uses "it", not the agent name (name lives in Q).
  const note = leftoverOrphanStoppedNote(
    input,
    input.redispatched
      ? 'redispatched'
      : mtime !== null || input.fetchable === true
        ? 'transcript'
        : 'lost',
  )

  return { kind: status, entry: input, summary: title, note }
}

/**
 * Official SAf — auto-resume succeeded (agent running again). No <status>.
 */
export function notifyOrphanAgentAutoResumed(entry: OrphanAgentEntry): string {
  const desc = entry.description ?? entry.agentId
  // densable qco: Pe title + note (not one fused summary).
  return notifyTaskNotification({
    taskId: entry.agentId,
    summary: `Background agent "${desc}" was restarted after the previous session ended`,
    note: 'It had no completion record after the previous Claude Code process exited, and was automatically restarted from its saved transcript. It is running in the background again; its result will arrive as a separate task notification.',
    outputFile: leftoverPeOutputFile(entry),
    // No status — still running.
    emitSdk: false,
  })
}

/**
 * Official EAf — agent already completed; only notification was lost.
 */
export function notifyOrphanAgentAlreadyCompleted(
  entry: OrphanAgentEntry,
  live?: Map<string, { type?: string; webFetchSavedFiles?: unknown }>,
): string {
  const desc = entry.description ?? entry.agentId
  const liveTask = live?.get(entry.agentId)
  const webFetch =
    entry.isWebFetchLaunch === true ||
    (liveTask?.type === 'local_agent' &&
      liveTask.webFetchSavedFiles !== undefined)
  const painted: OrphanAgentEntry = webFetch
    ? { ...entry, isWebFetchLaunch: true }
    : entry
  return notifyTaskNotification({
    taskId: entry.agentId,
    summary: `Background agent "${desc}" finished before the previous session ended, but its result was never reported`,
    note: `It had already completed before the previous Claude Code process exited — only its completion notification was lost, so it was not restarted and no further task notification will arrive. ${
      leftoverOrphanLandingHint(painted) === 'output'
        ? 'Read its output file (and check its worktree, if any) for the result.'
        : 'Send it a message with SendMessage to get its report.'
    }`,
    status: 'completed',
    outputFile: leftoverPeOutputFile(painted),
    // densable Kco is Pe-only — no SDK task_notification.
    emitSdk: false,
  })
}

/**
 * Official vAf — auto-resume threw.
 */
export function notifyOrphanAgentAutoResumeFailed(
  entry: OrphanAgentEntry,
  reason: string,
): string {
  const desc = entry.description ?? entry.agentId
  const hint = leftoverOrphanLandingHint(entry)
  return notifyTaskNotification({
    taskId: entry.agentId,
    summary: `Background agent "${desc}" from the previous session couldn't be restarted: ${reason}`,
    note: `It could not be automatically restarted. Its transcript may still be resumable by sending it a message with SendMessage${
      hint === 'webfetch'
        ? ', which is the only way to get its report.'
        : hint === 'output'
          ? '; check its worktree/output for partial work before assuming the task landed.'
          : ' and asking for a status report before assuming the task landed.'
    }`,
    status: 'stopped',
    outputFile: leftoverPeOutputFile(entry),
    // densable Yco is Pe-only — no SDK task_notification.
    emitSdk: false,
  })
}

/**
 * Official Iqb — batch stopped/failed when multiple orphans share status.
 */
export function notifyOrphanAgentsBatch(
  status: 'stopped' | 'failed',
  agents: readonly OrphanAgentEntry[],
): string {
  if (agents.length === 0) return ''
  if (agents.length === 1) {
    // Single should use Ebn with per-agent summary — callers usually do that.
    // Fall through to multi shape for API simplicity with one id.
  }
  const ids = agents.map(a => a.agentId)
  const named = agents
    .map(a => `"${a.description ?? a.agentId}" (${a.agentId})`)
    .join(', ')
  // densable es: s=webFetch ids, u=all webFetch, f=every webFetch||!canRead.
  const webFetchIds = agents
    .filter(a => a.isWebFetchLaunch === true)
    .map(a => a.agentId)
  const allWebFetch = webFetchIds.length === agents.length
  const noneReadable = agents.every(
    a =>
      a.isWebFetchLaunch === true || leftoverOrphanLandingHint(a) !== 'output',
  )
  const webFetchSuffix =
    webFetchIds.length === 0 || allWebFetch
      ? ''
      : status === 'stopped'
        ? ` ${webFetchIds.length === 1 ? 'Agent' : 'Agents'} ${webFetchIds.join(', ')} fetched web content and ${webFetchIds.length === 1 ? 'has' : 'have'} no worktree or output to check — resume ${webFetchIds.length === 1 ? 'it' : 'them'} with SendMessage only.`
        : ` ${webFetchIds.length === 1 ? 'Agent' : 'Agents'} ${webFetchIds.join(', ')} fetched web content and ${webFetchIds.length === 1 ? 'has' : 'have'} nothing to check — launch ${webFetchIds.length === 1 ? 'it' : 'them'} again if still needed.`
  const summary = `${leftoverOrphanDidntFinish(`${agents.length} background agents`)}: ${named}.${webFetchSuffix}`
  const note =
    status === 'stopped'
      ? `No completion record was found for them in the previous session. They may have been stopped, or they may have been running when the previous Claude Code process exited — either way their transcripts are saved, so their progress is not lost. ${
          allWebFetch
            ? 'Resume any of them by sending a message to its id with SendMessage to get its report.'
            : noneReadable
              ? 'Resume any of them by sending a message to its id with SendMessage and ask for a status report before assuming the task landed.'
              : 'Resume any of them by sending a message to its id with SendMessage, or check its worktree/output for partial work before assuming the task landed.'
        }`
      : `They were running when the previous Claude Code process exited and did not complete. Their in-process state was lost. ${
          allWebFetch
            ? 'Launch them again if their reports are still needed.'
            : noneReadable
              ? 'Do not assume the tasks landed; launch them again if their results are still needed.'
              : "Check each agent's worktree/output for partial work before assuming the tasks landed."
        }`

  // Official Iqb/es: multiple <task-id> tags then status + summary + note.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    TASK_ID_TAG,
    TASK_NOTIFICATION_TAG,
    STATUS_TAG,
    SUMMARY_TAG,
    NOTE_TAG,
  } = require('../constants/xml.js') as typeof import('../constants/xml.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enqueuePendingNotification } =
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { asAgentId } =
    require('../types/ids.js') as typeof import('../types/ids.js')

  const idLines = ids
    .map(id => `<${TASK_ID_TAG}>${escapeXml(id)}</${TASK_ID_TAG}>`)
    .join('\n')
  const message = `<${TASK_NOTIFICATION_TAG}>
${idLines}
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
<${NOTE_TAG}>${escapeXml(note)}</${NOTE_TAG}>
</${TASK_NOTIFICATION_TAG}>`

  let targetAgentId: string | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    targetAgentId = getSessionId()
  } catch {
    targetAgentId = undefined
  }
  try {
    enqueuePendingNotification({
      value: message,
      mode: 'task-notification',
      agentId:
        targetAgentId !== undefined ? asAgentId(targetAgentId) : undefined,
      skipAttachments: true,
      priority: 'next',
      shouldQuery: false,
    })
  } catch {
    /* best-effort */
  }
  return message
}

/**
 * Official kqb portable without transcript scan — classify a list of orphan
 * candidates and emit stopped/failed notifies; return auto-resume set.
 * Caps at ORPHAN_AGENT_CAP with aggregate fail (official F$a/N$a).
 */
export function processOrphanAgentCandidates(
  candidates: readonly OrphanClassifyInput[],
  opts?: {
    nowMs?: number
    autoResumeEnabled?: boolean
    /** Skip agents already live in task registry (official r.get). */
    liveAgentIds?: ReadonlySet<string>
    /** Skip agents already notified (official notifiedTaskIds). */
    notifiedTaskIds?: ReadonlySet<string>
    notify?: boolean
  },
): {
  autoResume: OrphanAgentEntry[]
  stopped: Array<{ entry: OrphanAgentEntry; summary: string; note: string }>
  failed: Array<{ entry: OrphanAgentEntry; summary: string; note: string }>
  skippedLive: string[]
  skippedNotified: string[]
  aggregateFailed: boolean
} {
  const live = opts?.liveAgentIds
  const notified = opts?.notifiedTaskIds
  const skippedLive: string[] = []
  const skippedNotified: string[] = []
  const orphans: OrphanClassifyInput[] = []
  for (const c of candidates) {
    if (notified?.has(c.agentId)) {
      skippedNotified.push(c.agentId)
      continue
    }
    if (live?.has(c.agentId)) {
      skippedLive.push(c.agentId)
      continue
    }
    orphans.push(c)
  }

  if (orphans.length === 0) {
    return {
      autoResume: [],
      stopped: [],
      failed: [],
      skippedLive,
      skippedNotified,
      aggregateFailed: false,
    }
  }

  if (orphans.length > ORPHAN_AGENT_CAP) {
    // Official: all failed with aggregate summary N$a; lf each then F$a multi.
    const summary = ORPHAN_AGGREGATE_SUMMARY
    if (opts?.notify !== false) {
      for (const o of orphans) {
        emitOrphanLf(o.agentId, 'failed', {
          summary,
          outputFile: leftoverOrphanOutputFile(o),
        })
      }
      notifyOrphanKindBatch({
        status: 'failed',
        kind: 'agent',
        label: 'agent',
        taskIds: orphans.map(o => o.agentId),
        liveExclusions: skippedLive,
      })
    }
    return {
      autoResume: [],
      stopped: [],
      failed: orphans.map(o => ({
        entry: o,
        summary,
        note: '',
      })),
      skippedLive,
      skippedNotified,
      aggregateFailed: true,
    }
  }

  const autoResume: OrphanAgentEntry[] = []
  const stopped: Array<{
    entry: OrphanAgentEntry
    summary: string
    note: string
  }> = []
  const failed: Array<{
    entry: OrphanAgentEntry
    summary: string
    note: string
  }> = []
  for (const o of orphans) {
    const r = classifyOrphanAgent(o, {
      nowMs: opts?.nowMs,
      autoResumeEnabled: opts?.autoResumeEnabled,
    })
    if (r.kind === 'auto-resume') autoResume.push(r.entry)
    else if (r.kind === 'stopped')
      stopped.push({ entry: r.entry, summary: r.summary, note: r.note })
    else failed.push({ entry: r.entry, summary: r.summary, note: r.note })
  }

  if (opts?.notify !== false) {
    // densable kqb: Di each with Lt; redispatched Pe immediately (not batch).
    const batch: Record<
      'stopped' | 'failed',
      Array<{ entry: OrphanAgentEntry; summary: string; note: string }>
    > = { stopped: [], failed: [] }
    for (const status of ['stopped', 'failed'] as const) {
      const list = status === 'stopped' ? stopped : failed
      for (const item of list) {
        emitOrphanLf(item.entry.agentId, status, {
          summary: item.summary,
          outputFile: leftoverOrphanOutputFile(item.entry),
        })
        if (item.entry.redispatched) {
          leftoverNotifyOrphanPe(item.entry, status, item.summary, item.note)
        } else {
          batch[status].push(item)
        }
      }
    }
    for (const status of ['stopped', 'failed'] as const) {
      const list = batch[status]
      if (list.length === 1) {
        const only = list[0]!
        leftoverNotifyOrphanPe(only.entry, status, only.summary, only.note)
      } else if (list.length > 1) {
        notifyOrphanAgentsBatch(
          status,
          list.map(x => x.entry),
        )
      }
    }
  }

  return {
    autoResume,
    stopped,
    failed,
    skippedLive,
    skippedNotified,
    aggregateFailed: false,
  }
}

/** Official Hqb single-shell densable `g=Oe("Background shell command")`. */
export const ORPHAN_SHELL_STOPPED_TITLE =
  "Background shell command didn't finish before the previous session ended"

/** Official Hqb single-shell densable `h` note body. Nt() omits output-file check. */
export const ORPHAN_SHELL_STOPPED_SUMMARY =
  'No completion record was found for it in the previous session. It may have been stopped (via the UI, Monitor timeout, or agent teardown — these leave no transcript marker), or it may have been running when the previous Claude Code process exited. Check the output file for partial results before assuming it completed.'

function leftoverOrphanShellStoppedNote(): string {
  const check = leftoverParentCanReadOutputFile()
    ? ' Check the output file for partial results before assuming it completed.'
    : ''
  return `No completion record was found for it in the previous session. It may have been stopped (via the UI, Monitor timeout, or agent teardown — these leave no transcript marker), or it may have been running when the previous Claude Code process exited.${check}`
}

/**
 * Official Dqb single-workflow summary builder.
 */
export function buildOrphanWorkflowStoppedTitle(
  entry: OrphanWorkflowEntry,
): string {
  const name = entry.workflowName ? ` "${entry.workflowName}"` : ''
  const run = entry.runId ? ` (run ${entry.runId})` : ''
  return leftoverOrphanDidntFinish(`Background workflow${name}${run}`)
}

export function buildOrphanWorkflowStoppedSummary(
  entry: OrphanWorkflowEntry,
): string {
  const resumeHint = entry.runId
    ? ' To pick up where it left off, relaunch with Workflow({scriptPath, resumeFromRunId}) using the run id from the summary — completed agent() calls return cached.'
    : ''
  return `No completion record was found for it in the previous session. It may have been stopped (via the UI or TaskStop — these leave no transcript marker), or it may have been running when the previous Claude Code process exited.${resumeHint}`
}

/**
 * Official F$a portable — multi-id aggregate notify with kind marker + live
 * exclusion markers (agent|shell|workflow).
 */
export function notifyOrphanKindBatch(opts: {
  status: 'stopped' | 'failed'
  kind: 'agent' | 'shell' | 'workflow'
  label: string
  taskIds: readonly string[]
  liveExclusions?: readonly string[]
}): string {
  const cap = ORPHAN_AGENT_CAP
  const shown = opts.taskIds.slice(0, cap)
  const marker = `${ORPHAN_SUMMARY_PREFIX}__:${opts.kind}`
  const liveMarkers = (opts.liveExclusions ?? []).map(
    id => `${ORPHAN_SUMMARY_PREFIX}_live__:${id}`,
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    TASK_ID_TAG,
    TASK_NOTIFICATION_TAG,
    STATUS_TAG,
    SUMMARY_TAG,
    NOTE_TAG,
  } = require('../constants/xml.js') as typeof import('../constants/xml.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enqueuePendingNotification } =
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { asAgentId } =
    require('../types/ids.js') as typeof import('../types/ids.js')

  const allIds = [...shown, marker, ...liveMarkers]
  const idLines = allIds
    .map(id => `<${TASK_ID_TAG}>${escapeXml(id)}</${TASK_ID_TAG}>`)
    .join('\n')
  // densable Ut `h` — marked-status lives in the note, not the Sp title.
  const checkOutput = leftoverParentCanReadOutputFile()
    ? ' Check each worktree/output for partial work before assuming a task landed.'
    : ''
  const why =
    opts.status === 'failed'
      ? `They were running when the previous Claude Code process exited and did not complete; their in-process state was lost.${checkOutput} They have been marked failed.`
      : 'They may have been stopped (via the UI, Monitor timeout, or agent teardown — these leave no transcript marker), or they may have been running when the previous Claude Code process exited. They have been marked stopped.'
  const idNote =
    shown.length === opts.taskIds.length
      ? `Task ids: ${shown.join(', ')}.`
      : `First ${cap} task ids: ${shown.join(', ')}.`
  const summary = `${leftoverOrphanDidntFinish(`${opts.taskIds.length} background ${opts.label} tasks`)}. ${idNote}`
  const note = `No completion record was found for them in the previous session. ${why} Task ids in this notification beginning with "${ORPHAN_SUMMARY_PREFIX}" are internal scan markers, not tasks.`

  const message = `<${TASK_NOTIFICATION_TAG}>
${idLines}
<${STATUS_TAG}>${opts.status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
<${NOTE_TAG}>${escapeXml(note)}</${NOTE_TAG}>
</${TASK_NOTIFICATION_TAG}>`

  let targetAgentId: string | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    targetAgentId = getSessionId()
  } catch {
    targetAgentId = undefined
  }
  try {
    enqueuePendingNotification({
      value: message,
      mode: 'task-notification',
      agentId:
        targetAgentId !== undefined ? asAgentId(targetAgentId) : undefined,
      skipAttachments: true,
      priority: 'next',
      shouldQuery: false,
    })
  } catch {
    /* best-effort */
  }
  return message
}

/**
 * Official Hqb portable — orphaned bg shells → stopped notify.
 * Multi (>1) uses lf each + F$a aggregate; single uses full shell summary + lf.
 */
export function processOrphanShells(
  shells: readonly OrphanShellEntry[],
  opts?: {
    notifiedTaskIds?: ReadonlySet<string>
    stoppedTaskIds?: ReadonlySet<string>
    liveTaskIds?: ReadonlySet<string>
    notify?: boolean
  },
): {
  notified: OrphanShellEntry[]
  skippedNotified: string[]
  skippedStopped: string[]
  skippedLive: string[]
  aggregate: boolean
} {
  const notifiedSet = opts?.notifiedTaskIds
  const stoppedSet = opts?.stoppedTaskIds
  const live = opts?.liveTaskIds
  const skippedNotified: string[] = []
  const skippedStopped: string[] = []
  const skippedLive: string[] = []
  const orphans: OrphanShellEntry[] = []
  for (const s of shells) {
    if (notifiedSet?.has(s.taskId)) {
      skippedNotified.push(s.taskId)
      continue
    }
    if (stoppedSet?.has(s.taskId)) {
      skippedStopped.push(s.taskId)
      continue
    }
    if (live?.has(s.taskId)) {
      skippedLive.push(s.taskId)
      continue
    }
    orphans.push(s)
  }
  if (orphans.length === 0) {
    return {
      notified: [],
      skippedNotified,
      skippedStopped,
      skippedLive,
      aggregate: false,
    }
  }
  // Official: o.length>1 → lf each + F$a; single → cf + lf
  if (opts?.notify !== false) {
    if (orphans.length > 1) {
      for (const s of orphans) {
        emitOrphanLf(s.taskId, 'stopped', {
          toolUseId: s.toolUseId,
          summary: ORPHAN_AGGREGATE_SUMMARY,
        })
      }
      notifyOrphanKindBatch({
        status: 'stopped',
        kind: 'shell',
        label: 'shell command',
        taskIds: orphans.map(s => s.taskId),
        liveExclusions: skippedLive,
      })
    } else {
      const only = orphans[0]!
      emitOrphanLf(only.taskId, 'stopped', {
        toolUseId: only.toolUseId,
        summary: ORPHAN_SHELL_STOPPED_TITLE,
      })
      notifyTaskNotification({
        taskId: only.taskId,
        summary: ORPHAN_SHELL_STOPPED_TITLE,
        note: leftoverOrphanShellStoppedNote(),
        status: 'stopped',
        // Official Hqb QO tool-use-id
        toolUseId: only.toolUseId,
        emitSdk: false,
      })
    }
  }
  return {
    notified: orphans,
    skippedNotified,
    skippedStopped,
    skippedLive,
    aggregate: orphans.length > 1,
  }
}

/**
 * Official Dqb portable — orphaned workflows → stopped notify + resume hint.
 * Cap >hGo uses F$a; else per-workflow summary. lf residual thin.
 */
export function processOrphanWorkflows(
  workflows: readonly OrphanWorkflowEntry[],
  opts?: {
    notifiedTaskIds?: ReadonlySet<string>
    stoppedTaskIds?: ReadonlySet<string>
    liveTaskIds?: ReadonlySet<string>
    notify?: boolean
  },
): {
  notified: OrphanWorkflowEntry[]
  skippedNotified: string[]
  skippedStopped: string[]
  skippedLive: string[]
  aggregate: boolean
} {
  const notifiedSet = opts?.notifiedTaskIds
  const stoppedSet = opts?.stoppedTaskIds
  const live = opts?.liveTaskIds
  const skippedNotified: string[] = []
  const skippedStopped: string[] = []
  const skippedLive: string[] = []
  const orphans: OrphanWorkflowEntry[] = []
  for (const w of workflows) {
    if (notifiedSet?.has(w.taskId)) {
      skippedNotified.push(w.taskId)
      continue
    }
    if (stoppedSet?.has(w.taskId)) {
      skippedStopped.push(w.taskId)
      continue
    }
    if (live?.has(w.taskId)) {
      skippedLive.push(w.taskId)
      continue
    }
    orphans.push(w)
  }
  if (orphans.length === 0) {
    return {
      notified: [],
      skippedNotified,
      skippedStopped,
      skippedLive,
      aggregate: false,
    }
  }
  if (opts?.notify !== false) {
    if (orphans.length > ORPHAN_AGENT_CAP) {
      // Official Dqb >hGo: lf each then F$a
      for (const w of orphans) {
        emitOrphanLf(w.taskId, 'stopped', {
          toolUseId: w.toolUseId,
          summary: ORPHAN_AGGREGATE_SUMMARY,
        })
      }
      notifyOrphanKindBatch({
        status: 'stopped',
        kind: 'workflow',
        label: 'workflow',
        taskIds: orphans.map(w => w.taskId),
        liveExclusions: skippedLive,
      })
    } else {
      // Official Dqb ≤hGo: cf + lf per workflow
      for (const w of orphans) {
        const summary = buildOrphanWorkflowStoppedTitle(w)
        const note = buildOrphanWorkflowStoppedSummary(w)
        emitOrphanLf(w.taskId, 'stopped', {
          toolUseId: w.toolUseId,
          summary: escapeXml(summary),
        })
        notifyTaskNotification({
          taskId: w.taskId,
          summary,
          note,
          status: 'stopped',
          toolUseId: w.toolUseId,
          emitSdk: false,
        })
      }
    }
  }
  return {
    notified: orphans,
    skippedNotified,
    skippedStopped,
    skippedLive,
    aggregate: orphans.length > ORPHAN_AGENT_CAP,
  }
}

/**
 * Official ese.current portable — after MCP settle, Aye each disk-resumable
 * orphan. Success → SAf (or EAf if alreadyCompleted); fail → vAf.
 */
export async function scheduleDeferredOrphanAutoResume(input: {
  agents: readonly OrphanAgentEntry[]
  getState?: () => unknown
  subscribe?: (listener: () => void) => () => void
  waitForMcp?: boolean
  /**
   * Official Aye. Return `{ alreadyCompleted?: boolean; outputFile?: string }`.
   */
  resumeAgent: (entry: OrphanAgentEntry) => Promise<
    | {
        alreadyCompleted?: boolean
        outputFile?: string
      }
    | undefined
  >
  /** Still-held job / session guard. Default always true. */
  isCurrent?: () => boolean
  notify?: boolean
}): Promise<{
  resumed: number
  alreadyCompleted: number
  failed: number
  skipped: boolean
}> {
  if (input.agents.length === 0) {
    return { resumed: 0, alreadyCompleted: 0, failed: 0, skipped: false }
  }
  if (input.waitForMcp !== false && input.getState) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { waitForStorePredicate, isMcpClientsSettled } =
        require('./bgCheckpoint.js') as typeof import('./bgCheckpoint.js')
      await waitForStorePredicate(
        input.getState,
        s =>
          isMcpClientsSettled(
            s as { mcp?: { clients?: Array<{ type?: string }> } },
          ),
        { timeoutMs: 30_000, subscribe: input.subscribe },
      )
    } catch {
      /* best-effort settle */
    }
  }
  if (input.isCurrent && !input.isCurrent()) {
    return { resumed: 0, alreadyCompleted: 0, failed: 0, skipped: true }
  }

  let resumed = 0
  let alreadyCompleted = 0
  let failed = 0
  const doNotify = input.notify !== false
  for (const a of input.agents) {
    // agentId-level de-dupe vs claim BSe / concurrent orphan passes
    if (!tryClaimAgentResumeInFlight(a.agentId)) {
      continue
    }
    try {
      const r = await input.resumeAgent(a)
      if (r && r.alreadyCompleted) {
        alreadyCompleted++
        if (doNotify) {
          notifyOrphanAgentAlreadyCompleted(
            {
              ...a,
              outputFile: r.outputFile ?? a.outputFile,
            },
            leftoverLiveAgentTasks(input.getState),
          )
        }
      } else {
        resumed++
        if (doNotify) notifyOrphanAgentAutoResumed(a)
      }
    } catch (e) {
      failed++
      if (doNotify) {
        notifyOrphanAgentAutoResumeFailed(
          a,
          e instanceof Error ? e.message : String(e),
        )
      }
    } finally {
      releaseAgentResumeInFlight(a.agentId)
    }
  }
  return { resumed, alreadyCompleted, failed, skipped: false }
}
