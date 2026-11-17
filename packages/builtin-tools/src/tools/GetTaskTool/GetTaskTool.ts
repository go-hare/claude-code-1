/**
 * densable `eg` / `Do` — GetTask. Model-callable poll of a background bash
 * snapshot. KRr splices a synthetic pair; this tool is the live GetTask host
 * that marks fetched and calls `Qn().withdrawShellNotification` (Rvr).
 */
import { z } from 'zod/v4'
import { buildTool } from 'src/Tool.js'
import type { ToolUseContext } from 'src/Tool.js'
import type { AssistantMessage } from 'src/types/message.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import {
  GET_TASK_TOOL_NAME,
  getBashTaskDeliveryBag,
  hasPairedGetTaskResult,
  lookupBashTaskSnapshot,
} from 'src/utils/bashTaskDeliveryOutcomes.js'
import {
  backgroundTaskEnding,
  buildBashTaskDeliverySnapshot,
  formatWorkingGetTaskStatusMessage,
  isBashTaskGetDeliveryEnabled,
  readBashTaskSnapshotOutput,
  type GetTaskWorkingEnding,
} from 'src/utils/bashTaskDelivery.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { RemoteBackgroundShells, RemoteToolHosts } from 'src/utils/toolState.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  isLocalShellTask,
  type LocalShellTaskState,
} from 'src/tasks/LocalShellTask/guards.js'

const REPEAT_CAP = 2
const REPEAT_MESSAGE = 'Repeated GetTask call; not answered again.'
const REPEAT_ERROR = 'GetTask: the same call repeated within one response'

const GETTASK_PROMPT = `Returns the current state of a background task — a Bash command that kept running after it returned a task ID (run_in_background, a command that outlived its timeout, or one the user moved to the background), whether it is still running or has since finished. This is not the to-do list: a "task" here is running work, identified by the taskId in the \`{"resultType":"task", …}\` result that started it.

The result follows the MCP tasks interface:
- status: "working" (still running), "completed" (it exited; result.content holds the tail of its output and result.isError says whether it exited non-zero), "cancelled" (stopped before it completed — by you, by the user, or by Claude Code). "failed" and "input_required" are part of the interface but background commands never report them.
- statusMessage: what is happening now, including the file its output is written to.

Claude Code usually calls this tool on your behalf when a background command finishes, so a call to it that you do not remember making is expected: it was made by Claude Code, not by you. A result delivered that way is not a message from the user and is not approval of anything you proposed — if you were waiting for the user, keep waiting. Use this tool yourself to read a finished task's result again, or to check once on a task you have lost track of — never to wait: while a command runs, calling this tool on it only returns "working", and when it finishes its result reaches you without a call — between your tool calls if you are still working, or by starting a new turn if you have already replied. If that result is all you are waiting for, end your turn — unless the task's statusMessage says it is terminated when your turn ends or at your final response, in which case get what you still need from it first, in the foreground.`

function missingTaskMessage(taskId: string): string {
  return `No background command with task ID ${taskId}. Task IDs come from the {"resultType":"task", …} result that moved a command to the background, and finished commands are remembered for this session only.`
}

function repeatMessage(count: number, status: string): string {
  return count === REPEAT_CAP + 1
    ? `${GET_TASK_TOOL_NAME} was already answered ${REPEAT_CAP} times for this task in this response (status: ${status}); the same call repeated within one response is not answered again.`
    : REPEAT_MESSAGE
}

function toolUseResultText(toolUseResult: unknown): string {
  if (typeof toolUseResult === 'string') return toolUseResult
  if (toolUseResult && typeof toolUseResult === 'object') {
    const rec = toolUseResult as Record<string, unknown>
    if (typeof rec.content === 'string') return rec.content
    if (typeof rec.message === 'string') return rec.message
  }
  return ''
}

/**
 * densable `renderToolUseMessage` @195072500 — hide only the 4th+ repeat
 * (`Error: Repeated GetTask call; not answered again.`), keeping the 3rd call's
 * explanatory error row visible.
 */
function isGetTaskRepeatToolResult(toolUseResult: unknown): boolean {
  const text = toolUseResultText(toolUseResult).trim()
  return text === `Error: ${REPEAT_MESSAGE}` || text === REPEAT_MESSAGE
}

/** densable `F5` — `e.agentId` else `mA()?.agentId`. */
function callerAgentId(context: ToolUseContext): string | undefined {
  if (context.agentId) return context.agentId
  return getAgentContext()?.agentId
}

/** densable `uNe` — unset caller matches any owner. */
function agentOwnsTask(
  caller: string | undefined,
  owner: string | undefined,
): boolean {
  if (caller === undefined) return true
  return caller === owner
}

/** densable `e.taskRegistry`. Missing host → Po miss (no analog getAppState). */
function taskRegistryOf(context: ToolUseContext): {
  get(id: string): unknown
} {
  return context.taskRegistry ?? { get: () => undefined }
}

/**
 * densable `Po(taskId, taskRegistry, agentId)` —
 * `Vu(s)&&s.kind!=="monitor"&&uNe(n,s.agentId)?s:void 0`.
 */
function lookupLiveBashTask(
  taskId: string,
  registry: { get(id: string): unknown },
  agentId: string | undefined,
): LocalShellTaskState | undefined {
  const task = registry.get(taskId)
  return isLocalShellTask(task) &&
    task.kind !== 'monitor' &&
    agentOwnsTask(agentId, task.agentId)
    ? task
    : undefined
}

const NO_REMOTE_STATUS = 'did not say what became of background command'
const NO_REMOTE_STATUS_DETAIL =
  'no status for a background command on an attached machine'
/** densable `S` — `ran_ms` zod `.nonnegative().max(S)` (366d). */
const GETTASK_REMOTE_RAN_MS_MAX = 31_622_400_000
const GETTASK_REMOTE_CONTENT_CHARS = 16_384

/** densable `re(t,n)` — UTF-16-safe clip; drop a trailing high surrogate. */
function truncateUtf16Chars(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  let clipped = text.slice(0, maxChars)
  const last = clipped.charCodeAt(maxChars - 1)
  if (last >= 0xd800 && last <= 0xdbff) {
    clipped = clipped.slice(0, -1)
  }
  return Buffer.from(clipped, 'utf16le').toString('utf16le')
}

function throwNoRemoteStatus(message: string): never {
  const err = new Error(message) as Error & { detail?: string }
  err.detail = NO_REMOTE_STATUS_DETAIL
  throw err
}

async function jboRemoteBackground(
  taskId: string,
  agentId: string | undefined,
  context: ToolUseContext,
): Promise<unknown> {
  const rec = context.toolState
    ?.get(RemoteBackgroundShells)
    .find(taskId, agentId)
  if (!rec) return undefined
  const noStatus = `${rec.hostName} did not say what became of background command ${taskId}: it is not attached or did not answer in time, or it no longer reports on the command (it keeps the last 16 that ended, and its record goes with a restart of Claude Code there or with background commands being switched off there).`
  try {
    // densable `e.get(rF).resolve(a)` then `host.transport.call`.
    const resolved = context.toolState
      ?.get(RemoteToolHosts)
      .resolve(rec.hostName)
    const sent =
      resolved?.kind === 'remote'
        ? await resolved.host.transport
            .call(
              'Bash',
              {},
              { v: 1, op: 'outcome_of', call_id: rec.callId },
              {
                signal: context.abortController.signal,
                deadlineMs: 15_000,
                toolUseId: rec.callId,
              },
            )
            .catch(() => undefined)
        : undefined
    const env = sent?.kind === 'result' ? sent.envelope : undefined
    const output =
      env?.outcome === 'completed' &&
      env.output !== null &&
      typeof env.output === 'object'
        ? (env.output as Record<string, unknown>)
        : undefined
    const bg =
      output?.background !== null && typeof output?.background === 'object'
        ? (output.background as {
            state?: unknown
            exit_code?: unknown
            ran_ms?: unknown
            ended_ms_ago?: unknown
          })
        : undefined
    const validEndedMsAgo =
      bg?.ended_ms_ago === undefined ||
      (typeof bg.ended_ms_ago === 'number' &&
        bg.ended_ms_ago >= 0 &&
        bg.ended_ms_ago <= GETTASK_REMOTE_RAN_MS_MAX)
    const validExitCode =
      bg?.exit_code === undefined ||
      (typeof bg.exit_code === 'number' && Number.isFinite(bg.exit_code))
    if (
      env?.outcome !== 'completed' ||
      typeof bg?.state !== 'string' ||
      typeof bg.ran_ms !== 'number' ||
      !(bg.ran_ms >= 0) ||
      bg.ran_ms > GETTASK_REMOTE_RAN_MS_MAX ||
      !validEndedMsAgo ||
      !validExitCode
    ) {
      throwNoRemoteStatus(noStatus)
    }
    const d = env.content
    if (typeof d !== 'string' && !Array.isArray(d)) {
      throwNoRemoteStatus(noStatus)
    }
    const g =
      typeof d === 'string'
        ? d
        : d
            .map(block =>
              block &&
              typeof block === 'object' &&
              (block as { type?: unknown }).type === 'text' &&
              typeof (block as { text?: unknown }).text === 'string'
                ? (block as { text: string }).text
                : '',
            )
            .join('')
    const clipped = truncateUtf16Chars(g, GETTASK_REMOTE_CONTENT_CHARS)
    const f = `[from ${rec.hostName}, about background command ${taskId}]\n${clipped}`
    const endedAgo = typeof bg.ended_ms_ago === 'number' ? bg.ended_ms_ago : 0
    const ranMs = typeof bg.ran_ms === 'number' ? bg.ran_ms : 0
    const endedAt = Date.now() - endedAgo
    const base = {
      taskId,
      createdAt: new Date(endedAt - ranMs).toISOString(),
      lastUpdatedAt: new Date(endedAt).toISOString(),
    }
    if (bg.state === 'exited') {
      return {
        ...base,
        status: 'completed' as const,
        statusMessage: `Exited on ${rec.hostName}.`,
        result: {
          content: [{ type: 'text' as const, text: f }],
          isError: bg.exit_code !== 0,
        },
      }
    }
    return {
      ...base,
      status:
        bg.state === 'running' ? ('working' as const) : ('cancelled' as const),
      statusMessage: f,
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes(NO_REMOTE_STATUS)) {
      throw err
    }
    throwNoRemoteStatus(noStatus)
  }
}

/**
 * densable `cZe(e)` — `e!==void 0 && agentType==="subagent" && isAsync===!1`.
 */
function cZe(): boolean {
  const ctx = getAgentContext()
  return (
    ctx !== undefined && ctx.agentType === 'subagent' && ctx.isAsync === false
  )
}

/** densable `g.agentId!==s?"other_agent":mdt(cZe(e.agentContext))`. */
function workingEnding(
  task: LocalShellTaskState,
  caller: string | undefined,
): GetTaskWorkingEnding | undefined {
  if (task.agentId !== caller) return 'other_agent'
  return backgroundTaskEnding(cZe())
}

/** densable `ZMt` / `iCn` */
function formatGetTaskSnapshot(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const e = raw as {
    taskId?: unknown
    status?: unknown
    statusMessage?: unknown
    createdAt?: unknown
    lastUpdatedAt?: unknown
    result?: unknown
    error?: unknown
  }
  const base = {
    taskId: e.taskId,
    status: e.status,
    statusMessage: e.statusMessage,
    createdAt: e.createdAt,
    lastUpdatedAt: e.lastUpdatedAt,
  }
  if (e.status === 'completed') {
    return { ...base, result: e.result }
  }
  if (e.status === 'failed') {
    return { ...base, error: e.error }
  }
  return base
}

async function snapshotFromLive(
  task: LocalShellTaskState,
  caller: string | undefined,
): Promise<unknown> {
  switch (task.status) {
    case 'pending':
    case 'running':
    case 'paused':
      return {
        taskId: task.id,
        status: 'working',
        statusMessage: formatWorkingGetTaskStatusMessage(
          task.outputFile,
          workingEnding(task, caller),
        ),
        createdAt: new Date(task.startTime).toISOString(),
        lastUpdatedAt: new Date(task.startTime).toISOString(),
      }
    case 'completed':
    case 'failed': {
      const output = task.isAdopted
        ? undefined
        : await readBashTaskSnapshotOutput(task.id)
      return buildBashTaskDeliverySnapshot({
        taskId: task.id,
        outcome: task.status,
        exitCode: task.isAdopted ? undefined : task.result?.code,
        startTime: task.startTime,
        endTime: task.endTime ?? task.startTime,
        outputFile: task.outputFile,
        output,
      })
    }
    case 'killed':
      return buildBashTaskDeliverySnapshot({
        taskId: task.id,
        outcome: 'killed',
        exitCode: undefined,
        startTime: task.startTime,
        endTime: task.endTime ?? task.startTime,
        outputFile: task.outputFile,
      })
    default:
      return {
        taskId: task.id,
        status: 'working',
        statusMessage: formatWorkingGetTaskStatusMessage(
          task.outputFile,
          workingEnding(task, caller),
        ),
        createdAt: new Date(task.startTime).toISOString(),
        lastUpdatedAt: new Date(task.startTime).toISOString(),
      }
  }
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z
      .string()
      .describe(
        'The taskId from the result that moved the command to the background',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const snapshotFields = {
  taskId: z.string(),
  statusMessage: z.string(),
  createdAt: z.string(),
  lastUpdatedAt: z.string(),
}
const outputSchema = lazySchema(() =>
  z.discriminatedUnion('status', [
    z.object({ ...snapshotFields, status: z.literal('working') }),
    z.object({
      ...snapshotFields,
      status: z.literal('completed'),
      result: z.object({
        content: z.array(
          z.object({ type: z.literal('text'), text: z.string() }),
        ),
        isError: z.boolean(),
      }),
    }),
    z.object({
      ...snapshotFields,
      status: z.literal('failed'),
      error: z.object({ code: z.number(), message: z.string() }),
    }),
    z.object({ ...snapshotFields, status: z.literal('cancelled') }),
  ]),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const GetTaskTool = buildTool({
  name: GET_TASK_TOOL_NAME,
  searchHint: 'check on a background shell command by task ID',
  backgrounding: 'never' as const,
  maxResultSizeChars: 100_000,
  async description() {
    return 'Get the current state of a background task (a shell command that is running, or has finished, in the background) by its task ID'
  },
  async prompt() {
    return GETTASK_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return GET_TASK_TOOL_NAME
  },
  isEnabled() {
    return isBashTaskGetDeliveryEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  extractSearchText() {
    return ''
  },
  toAutoClassifierInput(input: { taskId?: string }) {
    return input.taskId ?? ''
  },
  async validateInput({ taskId }: { taskId: string }, context: ToolUseContext) {
    const agentId = callerAgentId(context)
    if (lookupBashTaskSnapshot(taskId, agentId)) {
      return { result: true as const }
    }
    if (lookupLiveBashTask(taskId, taskRegistryOf(context), agentId)) {
      return { result: true as const }
    }
    if (context.toolState?.get(RemoteBackgroundShells).find(taskId, agentId)) {
      return { result: true as const }
    }
    return {
      result: false as const,
      message: missingTaskMessage(taskId),
      errorCode: 1,
    }
  },
  async call(
    { taskId }: { taskId: string },
    context: ToolUseContext,
    _canUseTool?: unknown,
    parentMessage?: AssistantMessage,
  ) {
    const agentId = callerAgentId(context)
    const bag = getBashTaskDeliveryBag()
    const entry = lookupBashTaskSnapshot(taskId, agentId)
    const liveTask = lookupLiveBashTask(
      taskId,
      taskRegistryOf(context),
      agentId,
    )
    const status = entry
      ? String(
          (entry.snapshot as { status?: unknown } | undefined)?.status ?? '',
        )
      : liveTask
        ? liveTask.status === 'pending' ||
          liveTask.status === 'running' ||
          liveTask.status === 'paused'
          ? 'working'
          : liveTask.status === 'killed'
            ? 'cancelled'
            : 'completed'
        : undefined
    const parentId = context.innerCall ? undefined : parentMessage?.message.id
    const statusKey =
      status === undefined
        ? undefined
        : { status, key: entry ? `settled:${status}` : status }
    const repeats =
      parentId !== undefined && statusKey !== undefined
        ? bag.countBashTaskGetInResponse(parentId, taskId, statusKey.key)
        : 1
    if (statusKey !== undefined && repeats > REPEAT_CAP) {
      logEvent('tengu_bash_task_get', {
        caller:
          'model' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        status:
          statusKey.status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        get_count_for_task: bag.countBashTaskGet(taskId),
        repeat_in_response: repeats,
        short_circuited: true,
      })
      const err = new Error(
        repeatMessage(repeats, statusKey.status),
      ) as Error & { code?: string; detail?: string }
      err.code = 'gettask_repeat_in_response'
      err.detail = REPEAT_ERROR
      throw err
    }
    let snapshot: unknown =
      entry?.snapshot ??
      (liveTask !== undefined
        ? await snapshotFromLive(liveTask, agentId)
        : undefined)
    if (snapshot === undefined) {
      snapshot = await jboRemoteBackground(taskId, agentId, context)
      if (snapshot === undefined) {
        const missing = new Error(missingTaskMessage(taskId)) as Error & {
          detail?: string
        }
        missing.detail = 'GetTask: no background command with this task ID'
        throw missing
      }
    }
    const { abortController } = context
    // densable @195074180: `if (p && p.agentId === s && !n.innerCall && !B.aborted)`
    // Main thread may inspect evicted subagent snapshots, but only the owning
    // agent of a settled snapshot marks fetched and withdraws its queued notification.
    if (
      entry &&
      entry.agentId === agentId &&
      !context.innerCall &&
      !abortController.signal.aborted
    ) {
      const wasFetched = entry.fetched
      bag.markBashTaskSnapshotFetched(taskId)
      const restore = bag.withdrawShellNotification?.(
        taskId,
        agentId,
        context.taskRegistry,
        () => context.messages,
      )
      abortController.signal.addEventListener(
        'abort',
        () => {
          if (
            !wasFetched &&
            !hasPairedGetTaskResult(
              taskId,
              agentId,
              context.taskRegistry,
              () => context.messages,
            )
          ) {
            bag.unmarkBashTaskSnapshotFetched(taskId)
          }
          restore?.()
        },
        { once: true },
      )
    }
    const parsed = snapshot as { status?: string; createdAt?: string }
    logEvent('tengu_bash_task_get', {
      caller: (context.innerCall
        ? 'script'
        : 'model') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      status: String(
        parsed.status ?? '',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(!context.innerCall
        ? {
            get_count_for_task: bag.countBashTaskGet(taskId),
            repeat_in_response: repeats,
            short_circuited: false,
          }
        : {}),
      since_created_ms:
        typeof parsed.createdAt === 'string'
          ? Date.now() - Date.parse(parsed.createdAt)
          : 0,
    })
    return { data: snapshot }
  },
  mapToolResultToToolResultBlockParam(data: unknown, toolUseId: string) {
    const parsed = outputSchema().safeParse(data)
    return {
      tool_use_id: toolUseId,
      type: 'tool_result' as const,
      content: jsonStringify(
        parsed.success ? formatGetTaskSnapshot(parsed.data) : data,
      ),
    }
  },
  renderToolUseMessage(
    { taskId }: { taskId?: string },
    {
      verbose,
      isTranscriptMode,
      toolUseResult,
    }: {
      verbose?: boolean
      isTranscriptMode?: boolean
      toolUseResult?: unknown
    },
  ) {
    const parsed = outputSchema().safeParse(toolUseResult)
    const hideWorking = parsed.success && parsed.data.status === 'working'
    const hideRepeat = isGetTaskRepeatToolResult(toolUseResult)
    if (!verbose && !isTranscriptMode && (hideWorking || hideRepeat)) {
      return null
    }
    return taskId ?? ''
  },
})
