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

import { notifyTaskNotification } from './adoptFailNotify.js'

/** Official Agent tool wire names that mark launchedByAgentTool. */
const AGENT_TOOL_NAMES = new Set(['Agent', 'Task'])

/** Official hGo — max orphans before aggregate-only summary. */
export const ORPHAN_AGENT_CAP = 20

/** Official Aqb — transcript mtime freshness window for auto-resume (48h). */
export const ORPHAN_AUTO_RESUME_MAX_AGE_MS = 172_800_000

/** Official gGo — internal scan marker prefix (F$a task-id markers). */
export const ORPHAN_SUMMARY_PREFIX = '__orphan_summary'

/** Official N$a — aggregate orphan summary text. */
export const ORPHAN_AGGREGATE_SUMMARY =
  'Orphaned by a previous Claude Code process exit and reported in an aggregate summary.'

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
  },
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('./sdkEventQueue.js') as typeof import('./sdkEventQueue.js')
    emitTaskTerminatedSdk(taskId, status, {
      toolUseId: opts?.toolUseId,
      summary: opts?.summary,
      outputFile: opts?.outputFile,
    })
  } catch {
    /* best-effort */
  }
}

export type OrphanAgentEntry = {
  agentId: string
  description?: string
  outputFile?: string
  /** Official redispatched — re-dispatched via SendMessage previously. */
  redispatched?: boolean
  /** Official launchedByAgentTool — only AgentTool-spawned are auto-resumable. */
  launchedByAgentTool?: boolean
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
  timestamp?: string
  message?: { content?: unknown }
  toolUseResult?: unknown
  attachment?: { type?: string; prompt?: unknown }
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

/**
 * Official bAf portable (agent subset) — only when both
 * `<task-notification>` and `<status>` open tags are present, collect
 * `<task-id>` values into `notified`. Single-pass; later redispatched
 * deletes win over earlier notifies.
 */
function collectNotifiedTaskIdsFromText(
  text: string,
  notified: Set<string>,
): void {
  // Official Cqb + wqb gate
  if (!text.includes('<task-notification>') || !text.includes('<status>')) {
    return
  }
  for (const m of text.matchAll(/<task-id>([^<]+)<\/task-id>/g)) {
    const id = m[1]?.trim()
    if (id) notified.add(id)
  }
}

function collectNotifiedFromContent(
  content: unknown,
  notified: Set<string>,
): void {
  for (const t of contentTextSlices(content)) {
    collectNotifiedTaskIdsFromText(t, notified)
  }
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
        }
      }
      continue
    }

    if (d.type === 'user') {
      // Official: u(bAf(xqb(d.message.content), notifiedTaskIds)) first
      collectNotifiedFromContent(d.message?.content, notifiedTaskIds)

      const f = d.toolUseResult
      if (!isRecord(f)) continue
      const content = d.message?.content
      if (!Array.isArray(content)) continue

      let fromAgentTool = false
      for (const g of content) {
        if (!isRecord(g) || g.type !== 'tool_result') continue
        if (g.is_error) continue
        const tuid = typeof g.tool_use_id === 'string' ? g.tool_use_id : ''
        if (tuid && agentToolUseIds.has(tuid)) fromAgentTool = true

        // Official: SendMessage resume → redispatched; delete prior notify
        if (
          f.success === true &&
          typeof f.message === 'string' &&
          typeof f.resumedAgentId === 'string' &&
          f.resumedAgentId.length > 0
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
      collectNotifiedTaskIdsFromText(d.attachment.prompt, notifiedTaskIds)
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
      out.push({ ...a, mtimeMs: null, hasMeta: false })
      continue
    }
    let mtimeMs: number | null = null
    let hasMeta = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getAgentTranscriptPath, readAgentMetadata } =
        require('./sessionStorage.js') as typeof import('./sessionStorage.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { asAgentId } =
        require('../types/ids.js') as typeof import('../types/ids.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { stat } = require('fs/promises') as typeof import('fs/promises')
      const path = getAgentTranscriptPath(asAgentId(a.agentId))
      try {
        const st = await stat(path)
        mtimeMs = st.size > 0 ? st.mtimeMs : null
      } catch {
        mtimeMs = null
      }
      try {
        const meta = await readAgentMetadata(asAgentId(a.agentId))
        hasMeta = meta !== null && meta !== undefined
      } catch {
        hasMeta = false
      }
    } catch {
      mtimeMs = null
      hasMeta = false
    }
    out.push({ ...a, mtimeMs, hasMeta })
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
  resumeAgent?: (entry: OrphanAgentEntry) => Promise<{
    alreadyCompleted?: boolean
    outputFile?: string
  } | void>
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
      summary: string
    }

/**
 * Official kqb per-agent decision (subset without lf registry write).
 * Auto-resume when: onDiskResumable callback path enabled + launchedByAgentTool
 * + hasMeta + fresh mtime. Else stopped if transcript mtime or redispatched;
 * failed if no transcript residue.
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

  if (
    autoOk &&
    input.launchedByAgentTool === true &&
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
      },
    }
  }

  const hasTranscript = mtime !== null
  const status: 'stopped' | 'failed' =
    input.redispatched || hasTranscript ? 'stopped' : 'failed'

  let summary: string
  if (input.redispatched) {
    summary = `No completion record was found for background agent "${desc}" after it was re-dispatched via SendMessage in the previous session. It may have been stopped (via the UI, an SDK interrupt, or agent teardown — these leave no transcript marker), or it may have been running when the previous Claude Code process exited. Check its worktree/output for partial work before assuming the task landed.`
  } else if (hasTranscript) {
    summary = `No completion record was found for background agent "${desc}" from the previous session. It may have been stopped, or it may have been running when the previous Claude Code process exited — either way its transcript is saved on disk, so its progress is not lost. Resume it by sending it a message with SendMessage, or check its worktree/output for partial work before assuming the task landed.`
  } else {
    summary = `Background agent "${desc}" was running when the previous Claude Code process exited and did not complete. Its in-process state was lost. Check its worktree/output for partial work before assuming the task landed.`
  }

  return { kind: status, entry: input, summary }
}

/**
 * Official SAf — auto-resume succeeded (agent running again). No <status>.
 */
export function notifyOrphanAgentAutoResumed(entry: OrphanAgentEntry): string {
  const desc = entry.description ?? entry.agentId
  const summary = `Background agent "${desc}" had no completion record after the previous Claude Code process exited, and was automatically restarted from its saved transcript. It is running in the background again; its result will arrive as a separate task notification.`
  return notifyTaskNotification({
    taskId: entry.agentId,
    summary,
    outputFile: entry.outputFile,
    // No status — still running.
    emitSdk: false,
  })
}

/**
 * Official EAf — agent already completed; only notification was lost.
 */
export function notifyOrphanAgentAlreadyCompleted(
  entry: OrphanAgentEntry,
): string {
  const desc = entry.description ?? entry.agentId
  const summary = `Background agent "${desc}" had already completed before the previous Claude Code process exited — only its completion notification was lost, so it was not restarted and no further task notification will arrive. Read its output file (and check its worktree, if any) for the result.`
  return notifyTaskNotification({
    taskId: entry.agentId,
    summary,
    status: 'completed',
    outputFile: entry.outputFile,
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
  const summary = `Background agent "${desc}" from the previous session could not be automatically restarted: ${reason}. Its transcript may still be resumable by sending it a message with SendMessage; check its worktree/output for partial work before assuming the task landed.`
  return notifyTaskNotification({
    taskId: entry.agentId,
    summary,
    status: 'stopped',
    outputFile: entry.outputFile,
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
  const summary =
    status === 'stopped'
      ? `No completion record was found for ${agents.length} background agents from the previous session: ${named}. They may have been stopped, or they may have been running when the previous Claude Code process exited — either way their transcripts are saved on disk, so their progress is not lost. Resume any of them by sending a message to its id with SendMessage, or check its worktree/output for partial work before assuming the task landed.`
      : `${agents.length} background agents were running when the previous Claude Code process exited and did not complete: ${named}. Their in-process state was lost. Check each agent's worktree/output for partial work before assuming the tasks landed.`

  // Official Iqb: multiple <task-id> tags then one status + summary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TASK_ID_TAG, TASK_NOTIFICATION_TAG, STATUS_TAG, SUMMARY_TAG } =
    require('../constants/xml.js') as typeof import('../constants/xml.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enqueuePendingNotification } =
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { asAgentId } =
    require('../types/ids.js') as typeof import('../types/ids.js')

  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const idLines = ids
    .map(id => `<${TASK_ID_TAG}>${esc(id)}</${TASK_ID_TAG}>`)
    .join('\n')
  const message = `<${TASK_NOTIFICATION_TAG}>
${idLines}
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${esc(summary)}</${SUMMARY_TAG}>
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
      priority: 'next',
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
  stopped: Array<{ entry: OrphanAgentEntry; summary: string }>
  failed: Array<{ entry: OrphanAgentEntry; summary: string }>
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
          outputFile: o.outputFile,
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
      })),
      skippedLive,
      skippedNotified,
      aggregateFailed: true,
    }
  }

  const autoResume: OrphanAgentEntry[] = []
  const stopped: Array<{ entry: OrphanAgentEntry; summary: string }> = []
  const failed: Array<{ entry: OrphanAgentEntry; summary: string }> = []
  for (const o of orphans) {
    const r = classifyOrphanAgent(o, {
      nowMs: opts?.nowMs,
      autoResumeEnabled: opts?.autoResumeEnabled,
    })
    if (r.kind === 'auto-resume') autoResume.push(r.entry)
    else if (r.kind === 'stopped')
      stopped.push({ entry: r.entry, summary: r.summary })
    else failed.push({ entry: r.entry, summary: r.summary })
  }

  if (opts?.notify !== false) {
    // Official kqb: lf each stopped/failed in classify loop, then Ebn/Iqb.
    for (const status of ['stopped', 'failed'] as const) {
      const list = status === 'stopped' ? stopped : failed
      for (const item of list) {
        emitOrphanLf(item.entry.agentId, status, {
          summary: item.summary,
          outputFile: item.entry.outputFile,
        })
      }
      if (list.length === 1) {
        const only = list[0]!
        // emitSdk false — lf already closed the bookend (c7c would no-op anyway).
        notifyTaskNotification({
          taskId: only.entry.agentId,
          summary: only.summary,
          status,
          outputFile: only.entry.outputFile,
          emitSdk: false,
        })
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

/** Official Hqb single-shell summary. */
export const ORPHAN_SHELL_STOPPED_SUMMARY =
  'No completion record was found for this background shell command from the previous session. It may have been stopped (via the UI, Monitor timeout, or agent teardown — these leave no transcript marker), or it may have been running when the previous Claude Code process exited. Check the output file for partial results before assuming it completed.'

/**
 * Official Dqb single-workflow summary builder.
 */
export function buildOrphanWorkflowStoppedSummary(
  entry: OrphanWorkflowEntry,
): string {
  const name = entry.workflowName ? ` "${entry.workflowName}"` : ''
  const resumeHint = entry.runId
    ? ` To pick up where it left off, relaunch with Workflow({scriptPath, resumeFromRunId: "${entry.runId}"}) — completed agent() calls return cached.`
    : ''
  return `No completion record was found for background workflow${name} from the previous session. It may have been stopped (via the UI or TaskStop — these leave no transcript marker), or it may have been running when the previous Claude Code process exited.${resumeHint}`
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
  const { TASK_ID_TAG, TASK_NOTIFICATION_TAG, STATUS_TAG, SUMMARY_TAG } =
    require('../constants/xml.js') as typeof import('../constants/xml.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enqueuePendingNotification } =
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { asAgentId } =
    require('../types/ids.js') as typeof import('../types/ids.js')

  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const allIds = [...shown, marker, ...liveMarkers]
  const idLines = allIds
    .map(id => `<${TASK_ID_TAG}>${esc(id)}</${TASK_ID_TAG}>`)
    .join('\n')
  const why =
    opts.status === 'failed'
      ? 'They were running when the previous Claude Code process exited and did not complete; their in-process state was lost. Check each worktree/output for partial work before assuming a task landed.'
      : 'They may have been stopped (via the UI, Monitor timeout, or agent teardown — these leave no transcript marker), or they may have been running when the previous Claude Code process exited.'
  const idNote =
    shown.length === opts.taskIds.length
      ? `Task ids: ${shown.join(', ')}.`
      : `First ${cap} task ids: ${shown.join(', ')}.`
  const summary = `${opts.taskIds.length} background ${opts.label} task(s) from the previous session have no completion record. ${why} They have been marked ${opts.status}. ${idNote} Task ids in this notification beginning with "${ORPHAN_SUMMARY_PREFIX}" are internal scan markers, not tasks.`

  const message = `<${TASK_NOTIFICATION_TAG}>
${idLines}
<${STATUS_TAG}>${opts.status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${esc(summary)}</${SUMMARY_TAG}>
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
      priority: 'next',
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
        summary: ORPHAN_SHELL_STOPPED_SUMMARY,
      })
      notifyTaskNotification({
        taskId: only.taskId,
        summary: ORPHAN_SHELL_STOPPED_SUMMARY,
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
        const summary = buildOrphanWorkflowStoppedSummary(w)
        emitOrphanLf(w.taskId, 'stopped', {
          toolUseId: w.toolUseId,
          summary,
        })
        notifyTaskNotification({
          taskId: w.taskId,
          summary,
          status: 'stopped',
          // Official Dqb QO tool-use-id
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
  resumeAgent: (entry: OrphanAgentEntry) => Promise<{
    alreadyCompleted?: boolean
    outputFile?: string
  } | void>
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
    try {
      const r = await input.resumeAgent(a)
      if (r && r.alreadyCompleted) {
        alreadyCompleted++
        if (doNotify) {
          notifyOrphanAgentAlreadyCompleted({
            ...a,
            outputFile: r.outputFile ?? a.outputFile,
          })
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
    }
  }
  return { resumed, alreadyCompleted, failed, skipped: false }
}
