import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolDeps,
  type ToolResultBlockParam,
} from 'src/Tool.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import * as codeModeOptIn from 'src/services/codeMode/optIn.js'
import { REPL_MAIN_THREAD_KEY } from 'src/services/codeMode/constants.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  drainPollEventChunk,
  endPollCall,
  enqueueReplStatusPollEvent,
  getActiveMessageQueue,
  type MessageQueueInstance,
  tryBeginPollCall,
} from 'src/utils/messageQueueManager.js'
import {
  buildPollToolPrompt,
  buildPollToolResultContent,
  formatPollDeliveryText,
  NO_PENDING_EVENTS,
  POLL_CACHE_TTL_DEFAULT_MS,
  POLL_CACHE_TTL_MARGIN_MS,
  POLL_EVENT_KIND_REPL_STATUS,
  POLL_TOOL_NAME,
  type PollMediaBlock,
  settleDeliveredPollEvents,
} from './constants.js'

const MAIN_THREAD_KEY = REPL_MAIN_THREAD_KEY

export interface ReplSessionLedgerEntry {
  id: number
  state: string
  runningMs: number
  snippet: string
}

export interface ReplSessionsLike {
  outstanding(key?: string): number
  ledger(key: string): ReadonlyArray<ReplSessionLedgerEntry>
  pending(key: string): ReadonlyArray<{ id: number }>
  onOutstandingChange(fn: () => void): () => void
  takeUnwaited(key: string, filterIds?: Set<number>): unknown
  noteStatusLine(key: string): void
  takeStatusLineGiven(key: string): boolean
}

export interface PollWaitOptions {
  queue?: MessageQueueInstance
  signal?: AbortSignal
  replSessions?: ReplSessionsLike
  agentId?: string
  waitMs?: number
  liveTasks?: () => string[]
}

const pollMediaBlockSchema = lazySchema(() =>
  z.union([
    z.object({
      type: z.literal('image'),
      source: z.object({
        type: z.literal('base64'),
        media_type: z.enum([
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
        ]),
        data: z.string(),
      }),
    }),
    z.object({
      type: z.literal('document'),
      source: z.object({
        type: z.literal('base64'),
        media_type: z.literal('application/pdf'),
        data: z.string(),
      }),
    }),
  ]),
)

const inputSchema = lazySchema(() => z.strictObject({}))

const outputSchema = lazySchema(() =>
  z.object({
    content: z
      .string()
      .describe(`Rendered event envelopes, or "${NO_PENDING_EVENTS}"`),
    eventCount: z
      .number()
      .int()
      .describe('Number of events delivered in this result'),
    remainingWakeCount: z
      .number()
      .int()
      .describe(
        'Wake events still queued after this chunk; they follow in the next delivery',
      ),
    media: z
      .array(z.array(pollMediaBlockSchema()))
      .optional()
      .describe(
        "Each delivered event's images and documents, 1:1 with the events. Absent when none has any",
      ),
    toolsUsed: z.array(z.string()).optional(),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type OutputSchema = ReturnType<typeof outputSchema>
export type PollOutput = z.infer<OutputSchema>

type PollEndReason =
  | 'delivered'
  | 'status_work_running'
  | 'duplicate_call'
  | 'aborted'
  | 'queued_input'
  | 'nothing_to_wait_for'

type PollWaitResult = {
  data: PollOutput
  endReason: PollEndReason
}

function resolveIsPollToolEnabled(): boolean {
  const optInMod = codeModeOptIn as typeof codeModeOptIn & {
    isPollToolEnabled?: () => boolean
  }
  if (typeof optInMod.isPollToolEnabled === 'function') {
    return optInMod.isPollToolEnabled()
  }
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_POLL_EVENTS) ||
    codeModeOptIn.isCodeModeEnabled()
  )
}

function getDefaultReplSessions(): ReplSessionsLike | undefined {
  try {
    // Lazy require: replSessions.ts is optional when Code Mode is off.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('src/services/codeMode/replSessions.js') as {
      getReplSessions?: () => ReplSessionsLike
    }
    return mod.getReplSessions?.()
  } catch {
    return undefined
  }
}

function computeDefaultWaitMs(cacheTtlMs?: number | null): number {
  const ttl = Math.min(
    cacheTtlMs ?? POLL_CACHE_TTL_DEFAULT_MS,
    POLL_CACHE_TTL_DEFAULT_MS,
  )
  return Math.max(0, ttl - POLL_CACHE_TTL_MARGIN_MS)
}

function hasQueuedUserInput(
  queue: MessageQueueInstance,
  agentId?: string,
): boolean {
  const commands = queue.getCommandsByMaxPriority('next')
  return commands.some(cmd => {
    if (cmd.mode === 'poll-event') return false
    if (agentId !== undefined && cmd.agentId !== agentId) return false
    return cmd.mode === 'prompt' || cmd.mode === 'bash'
  })
}

function emitPollCallEndTelemetry(
  reason: PollEndReason,
  waitedMs: number,
  deliveredEventCount: number,
): void {
  try {
    logEvent('tengu_poll_call_end', {
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      waitedMs,
      deliveredEventCount,
    })
  } catch {
    // Telemetry must never break Poll tool execution.
  }
}

function isPollMediaBlock(value: unknown): value is PollMediaBlock {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  if (rec.type !== 'image' && rec.type !== 'document') return false
  const src = rec.source as Record<string, unknown> | undefined
  return (
    typeof src === 'object' &&
    src !== null &&
    src.type === 'base64' &&
    typeof src.media_type === 'string' &&
    typeof src.data === 'string'
  )
}

function extractMediaFromCommands(
  commands: ReadonlyArray<{ pollEvent?: { media?: unknown[] } }>,
): PollMediaBlock[][] | undefined {
  const hasAny = commands.some(
    cmd =>
      Array.isArray(cmd.pollEvent?.media) && cmd.pollEvent.media.length > 0,
  )
  if (!hasAny) return undefined
  return commands.map(cmd =>
    (cmd.pollEvent?.media ?? []).filter(isPollMediaBlock),
  )
}

function getLiveTasksFromDeps(deps: ToolDeps): string[] {
  try {
    const tasks = deps.tasks() as
      | Record<string, { status?: string; type?: string; description?: string }>
      | undefined
    if (!tasks) return []
    const running: string[] = []
    for (const task of Object.values(tasks)) {
      if (
        task &&
        task.status === 'running' &&
        task.type !== 'in_process_teammate'
      ) {
        running.push(task.description ?? task.type ?? 'background task')
      }
    }
    return running
  } catch {
    return []
  }
}

/**
 * Official 2.1.328 `xPo` — core wait/drain loop for `PollTool`.
 */
export async function runPollWaitLoop(
  options: PollWaitOptions = {},
): Promise<PollWaitResult> {
  const queue = options.queue ?? getActiveMessageQueue()
  const signal = options.signal
  const replSessions = options.replSessions
  const agentId = options.agentId
  const sessionKey = agentId ?? MAIN_THREAD_KEY
  const waitMs = options.waitMs ?? computeDefaultWaitMs()
  const getLiveTasks = options.liveTasks ?? (() => [])

  replSessions?.takeStatusLineGiven(sessionKey)
  const startedAt = Date.now()

  const nothingToWaitFor = (): boolean => {
    const outstanding = replSessions ? replSessions.outstanding(sessionKey) : 0
    return outstanding === 0 && getLiveTasks().length === 0
  }

  for (;;) {
    if (signal?.aborted) {
      return {
        data: {
          content: NO_PENDING_EVENTS,
          eventCount: 0,
          remainingWakeCount: 0,
        },
        endReason: 'aborted',
      }
    }

    const { commands, remainingWakeCount } =
      queue === getActiveMessageQueue()
        ? drainPollEventChunk(agentId)
        : queue.drainPollEventChunk(agentId)

    if (commands.length > 0) {
      const envelopes = commands.map(cmd => cmd.pollEvent?.envelope ?? '')
      settleDeliveredPollEvents(commands)
      const media = extractMediaFromCommands(commands)
      const content = formatPollDeliveryText(envelopes, remainingWakeCount)
      const isStatusOnly = commands.every(
        cmd => cmd.pollEvent?.kind === POLL_EVENT_KIND_REPL_STATUS,
      )
      return {
        data: {
          content,
          eventCount: commands.length,
          remainingWakeCount,
          ...(media !== undefined && { media }),
        },
        endReason: isStatusOnly ? 'status_work_running' : 'delivered',
      }
    }

    if (hasQueuedUserInput(queue, agentId)) {
      return {
        data: {
          content: NO_PENDING_EVENTS,
          eventCount: 0,
          remainingWakeCount: 0,
        },
        endReason: 'queued_input',
      }
    }

    if (nothingToWaitFor()) {
      return {
        data: {
          content: NO_PENDING_EVENTS,
          eventCount: 0,
          remainingWakeCount: 0,
        },
        endReason: 'nothing_to_wait_for',
      }
    }

    const elapsed = Date.now() - startedAt
    const ledger = replSessions ? replSessions.ledger(sessionKey) : []
    const liveTasks = ledger.length > 0 ? [] : getLiveTasks()

    if (elapsed >= waitMs) {
      if (ledger.length > 0) {
        enqueueReplStatusPollEvent({ ledger, agentId })
        replSessions?.noteStatusLine(sessionKey)
        continue
      }
      if (liveTasks.length > 0) {
        const taskWord = liveTasks.length === 1 ? 'task' : 'tasks'
        return {
          data: {
            content: `No events yet — ${liveTasks.length} background ${taskWord} still running: ${liveTasks.join('; ')}. Poll again to keep waiting.`,
            eventCount: 0,
            remainingWakeCount: 0,
          },
          endReason: 'status_work_running',
        }
      }
      return {
        data: {
          content: NO_PENDING_EVENTS,
          eventCount: 0,
          remainingWakeCount: 0,
        },
        endReason: 'nothing_to_wait_for',
      }
    }

    const remainingMs = Math.max(0, waitMs - elapsed)
    await new Promise<void>(resolve => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubQueue()
        unsubRepl()
        signal?.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, remainingMs)
      const unsubQueue = queue.subscribe(done)
      const unsubRepl = replSessions
        ? replSessions.onOutstandingChange(done)
        : () => {}
      signal?.addEventListener('abort', done)
      if (
        signal?.aborted ||
        hasQueuedUserInput(queue, agentId) ||
        nothingToWaitFor()
      ) {
        done()
      }
    })
  }
}

export const PollTool = buildTool({
  name: POLL_TOOL_NAME,
  searchHint: 'wait for and receive queued harness events',
  maxResultSizeChars: 200_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return resolveIsPollToolEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isTransparentWrapper() {
    return codeModeOptIn.isCodeModeEnabled()
  },
  async description() {
    return 'Wait for pending harness events'
  },
  async prompt() {
    return buildPollToolPrompt({
      codeMode: codeModeOptIn.isCodeModeEnabled(),
    })
  },
  mapToolResultToToolResultBlockParam(
    output: PollOutput,
    toolUseId: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: buildPollToolResultContent(output.content, output.media),
    }
  },
  renderToolUseMessage() {
    return ''
  },
  create(deps: ToolDeps) {
    return {
      async call(_input, callCtx) {
        const agentId = deps.agentId
        if (agentId !== undefined) {
          throw new Error(
            codeModeOptIn.isCodeModeEnabled()
              ? `${POLL_TOOL_NAME} isn't available here and isn't needed: each REPL call you make here waits for its script to finish and returns the result.`
              : 'Poll is available on the main thread only',
          )
        }

        if (!tryBeginPollCall(agentId)) {
          emitPollCallEndTelemetry('duplicate_call', 0, 0)
          return {
            data: {
              content: NO_PENDING_EVENTS,
              eventCount: 0,
              remainingWakeCount: 0,
            },
          }
        }

        const startedAt = Date.now()
        const replSessions = getDefaultReplSessions()
        try {
          const result = await runPollWaitLoop({
            signal: callCtx.signal,
            replSessions,
            agentId,
            liveTasks: () => getLiveTasksFromDeps(deps),
          })
          emitPollCallEndTelemetry(
            result.endReason,
            Date.now() - startedAt,
            result.endReason === 'delivered' ? result.data.eventCount : 0,
          )
          if (result.data.eventCount > 0) {
            replSessions?.takeUnwaited(MAIN_THREAD_KEY)
          }
          return { data: result.data }
        } finally {
          endPollCall(agentId)
        }
      },
    }
  },
} satisfies ToolDef<InputSchema, PollOutput>)
