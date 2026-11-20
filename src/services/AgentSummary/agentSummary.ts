/**
 * Periodic background summarization for coordinator mode sub-agents.
 *
 * Forks the sub-agent's conversation every ~30s using runForkedAgent()
 * to generate a 1-2 sentence progress summary. The summary is stored
 * on AgentProgress for UI display.
 *
 * Cache sharing: uses the same CacheSafeParams as the parent agent
 * to share the prompt cache. Tools are kept in the request for cache
 * key matching but denied via canUseTool callback.
 */

import type { TaskContext } from '../../Task.js'
import { updateAgentSummary } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { AgentId } from '../../types/ids.js'
import type { AssistantMessage } from '../../types/message.js'
import { getAgentContext } from '../../utils/agentContext.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { getSmallFastModel } from '../../utils/model/model.js'
import {
  type APIProvider,
  getAPIProvider,
} from '../../utils/model/providers.js'
import { getAgentTranscript } from '../../utils/sessionStorage.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { queryWithModel } from '../api/claude.js'
import {
  buildShortSummaryNotes,
  buildSummaryContext,
} from './summaryContext.js'
import {
  buildShortNotesUserPrompt,
  buildSummaryPrompt,
  createSummaryPromptMessage,
  SHORT_NOTES_MAX_OUTPUT_TOKENS,
  SHORT_NOTES_SUMMARY_SYSTEM_PROMPT,
} from './summaryPrompt.js'

const SUMMARY_INTERVAL_MS = 30_000
/**
 * 2.1.323 #2082 (official `wp = 20000`): 20s timeout per summary request so
 * replies taking between 10 and 20 seconds do not get timed out and skipped.
 */
export const AGENT_SUMMARY_REQUEST_TIMEOUT_MS = 20_000
export const AGENT_SUMMARY_MAX_HOLD_MS = 300_000
export const AGENT_SUMMARY_HOLD_POLL_MS = 15_000
export const AGENT_SUMMARY_COLD_CACHE_MS = 270_000

/**
 * Official 2.1.327 `Rp` / `ba()` (#526): cloud providers that always use
 * short-notes mode with the subagent's own model (source: `'release'`).
 */
export const SHORT_NOTES_RELEASE_PROVIDERS = new Set<APIProvider>([
  'bedrock',
  'vertex',
  'foundry',
])

export type AgentSummaryModeDecision = {
  mode: 'short' | 'full'
  source: 'release' | 'default' | 'growthbook' | 'override'
}

/**
 * Official 2.1.327 `xs(e)` (#526) + 2.1.328 (#675):
 * - Bedrock, Vertex AI, and Foundry use short-notes mode (`source: 'release'`).
 * - Anthropic API / firstParty / gateway default to short-notes mode written by
 *   the default small fast model (also when telemetry/GrowthBook is off), unless
 *   `tengu_groovy_ember` explicitly configures `{ mode: 'full' }`.
 */
export function resolveAgentSummaryMode(opts?: {
  provider?: APIProvider
  flagValue?: { mode?: 'short' | 'full' } | null
  overrideMode?: 'short' | 'full'
}): AgentSummaryModeDecision {
  if (opts?.overrideMode !== undefined) {
    return { mode: opts.overrideMode, source: 'override' }
  }
  const provider = opts?.provider ?? getAPIProvider()
  if (SHORT_NOTES_RELEASE_PROVIDERS.has(provider)) {
    return { mode: 'short', source: 'release' }
  }
  const flag =
    opts?.flagValue !== undefined
      ? opts.flagValue
      : getFeatureValue_CACHED_MAY_BE_STALE<{ mode?: 'short' | 'full' } | null>(
          'tengu_groovy_ember',
          null,
        )
  if (flag && (flag.mode === 'full' || flag.mode === 'short')) {
    return { mode: flag.mode, source: 'growthbook' }
  }
  // Official 2.1.328 (#675) `Op.catch({ mode: 'short' })`: default is short
  // notes even when GrowthBook returns null / telemetry is off.
  return { mode: 'short', source: 'default' }
}

/**
 * Official 2.1.327/2.1.328 `vt()` / `pt()` (#526, #675):
 * Pick the model that writes a short-notes progress summary, or `undefined`
 * to use full forked-conversation summarization.
 */
export function resolveSummaryWriterModel(opts: {
  decision: AgentSummaryModeDecision
  agentModel: string
  releaseShortFailed?: boolean
  getSmallFastModelImpl?: () => string
}): string | undefined {
  if (opts.decision.mode !== 'short') return undefined
  if (opts.decision.source === 'release') {
    return opts.releaseShortFailed ? undefined : opts.agentModel
  }
  try {
    return (opts.getSmallFastModelImpl ?? getSmallFastModel)()
  } catch (err) {
    if (err instanceof Error) logError(err)
    return undefined
  }
}

const SUMMARY_MAX_CHARS = 100
const SUMMARY_MARKDOWN_PREFIX_RE = /^(#{1,6}(\s|$)|```|~~~)/
const SUMMARY_FENCE_RE = /```|~~~/
const SUMMARY_XML_WRAPPER_RE = /^<([A-Za-z][\w:.-]*)>([^<>]*)<\/\1>$/

function containsSummaryLineBreak(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      code === 0x0a ||
      code === 0x0d ||
      code === 0x0b ||
      code === 0x0c ||
      code === 0x85 ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.328 `Pa(text, isShortNotes)` (#526, #675): validate and clean
 * a progress summary reply (single line, <= 100 chars, no markdown fences).
 */
export function sanitizeAgentSummaryReply(
  raw: string,
  isShortNotes = false,
): string | null {
  const trimmed = raw.trim()
  if (!trimmed || containsSummaryLineBreak(trimmed)) return null
  const normalized = trimmed.replace(/\s+/g, ' ').trim()
  if (
    !normalized ||
    (normalized.length > SUMMARY_MAX_CHARS &&
      [...normalized].length > SUMMARY_MAX_CHARS)
  ) {
    return null
  }
  if (
    SUMMARY_MARKDOWN_PREFIX_RE.test(normalized) ||
    SUMMARY_FENCE_RE.test(normalized)
  ) {
    return null
  }
  if (!isShortNotes) return normalized
  const unwrapped = normalized
    .replace(SUMMARY_XML_WRAPPER_RE, '$2')
    .replaceAll('`', '')
  return unwrapped === normalized
    ? normalized
    : sanitizeAgentSummaryReply(unwrapped, true)
}

/**
 * 2.1.323 #1976: `CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES=1` turns off
 * subagent progress summaries and the requests that write them.
 */
export function isAgentProgressSummariesDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES)
}

export type AgentOwnRequestsState = {
  lastResponseAt?: number
  isAwaitingResponse: boolean
  responsesBegun: number
  hasChangedModel?: boolean
}

/**
 * Official 2.1.318 pa(jt, now) — true when the sub-agent's own prompt cache is
 * likely cold (no response yet, or >= 270s since last response).
 */
export function isAgentCacheLikelyCold(
  ownRequests: AgentOwnRequestsState,
  now: number = Date.now(),
): boolean {
  return (
    ownRequests.lastResponseAt === undefined ||
    now - ownRequests.lastResponseAt >= AGENT_SUMMARY_COLD_CACHE_MS
  )
}

export function shouldHoldFullSummaryForColdCache(opts: {
  ownRequests: AgentOwnRequestsState | undefined
  heldMs: number
  heldAtResponsesBegun: number | undefined
  now?: number
  maxHoldMs?: number
}): boolean {
  const {
    ownRequests,
    heldMs,
    heldAtResponsesBegun,
    now = Date.now(),
    maxHoldMs = AGENT_SUMMARY_MAX_HOLD_MS,
  } = opts
  if (ownRequests === undefined || ownRequests.hasChangedModel) {
    return false
  }
  if (!isAgentCacheLikelyCold(ownRequests, now)) {
    return false
  }
  if (!ownRequests.isAwaitingResponse) {
    return false
  }
  if (heldMs >= maxHoldMs) {
    return false
  }
  return heldMs === 0 || ownRequests.responsesBegun === heldAtResponsesBegun
}

export type ShortNotesSummaryRequest = {
  model: string
  notes: string
  previousSummary: string | null
  signal: AbortSignal
  leavesEffortSupportAlone: true
}

export type AgentSummaryDependencies = Partial<{
  clearTimeout: typeof clearTimeout
  getAgentTranscript: typeof getAgentTranscript
  logError: typeof logError
  logForDebugging: typeof logForDebugging
  runForkedAgent: typeof runForkedAgent
  runShortNotesSummary: (
    req: ShortNotesSummaryRequest,
  ) => Promise<AssistantMessage[]>
  setTimeout: typeof setTimeout
  updateAgentSummary: typeof updateAgentSummary
  ownRequests: AgentOwnRequestsState
  maxHoldMs: number
  holdPollMs: number
  now: () => number
  provider: APIProvider
  summaryMode: 'short' | 'full'
  getSmallFastModel: () => string
  taskDescription: string
}>

export function startAgentSummarization(
  taskId: string,
  agentId: AgentId,
  cacheSafeParams: CacheSafeParams,
  setAppState: TaskContext['setAppState'],
  dependencies: AgentSummaryDependencies = {},
): { stop: () => void } {
  // Drop forkContextMessages from the closure — runSummary rebuilds it each
  // tick from getAgentTranscript(). Without this, the original fork messages
  // (passed from AgentTool.tsx) are pinned for the lifetime of the timer.
  const { forkContextMessages: _drop, ...baseParams } = cacheSafeParams
  let summaryAbortController: AbortController | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let previousSummary: string | null = null
  let lastHandledTranscriptFingerprint: string | null = null
  let lastHandledShortNotes: string | null = null
  let releaseShortFailed = false
  let heldMs = 0
  let heldAtResponsesBegun: number | undefined
  let didHoldThisTick = false
  const clearTimeoutImpl = dependencies.clearTimeout ?? clearTimeout
  const getAgentTranscriptImpl =
    dependencies.getAgentTranscript ?? getAgentTranscript
  const logErrorImpl = dependencies.logError ?? logError
  const logForDebuggingImpl = dependencies.logForDebugging ?? logForDebugging
  const runForkedAgentImpl = dependencies.runForkedAgent ?? runForkedAgent
  const setTimeoutImpl = dependencies.setTimeout ?? setTimeout
  const updateAgentSummaryImpl =
    dependencies.updateAgentSummary ?? updateAgentSummary
  const maxHoldMs = dependencies.maxHoldMs ?? AGENT_SUMMARY_MAX_HOLD_MS
  const holdPollMs = dependencies.holdPollMs ?? AGENT_SUMMARY_HOLD_POLL_MS
  const nowImpl = dependencies.now ?? Date.now
  const agentModel =
    baseParams.toolUseContext?.options?.mainLoopModel ?? getSmallFastModel()
  // Preserve legacy test harnesses that mock only `runForkedAgent` without
  // specifying short-notes mode or a short-notes runner.
  const defaultOverrideMode =
    dependencies.summaryMode ??
    (dependencies.runForkedAgent !== undefined &&
    dependencies.runShortNotesSummary === undefined &&
    dependencies.provider === undefined
      ? 'full'
      : undefined)
  const runShortNotesSummaryImpl =
    dependencies.runShortNotesSummary ??
    (async (req: ShortNotesSummaryRequest): Promise<AssistantMessage[]> => {
      const msg = await queryWithModel({
        systemPrompt: asSystemPrompt([SHORT_NOTES_SUMMARY_SYSTEM_PROMPT]),
        userPrompt: buildShortNotesUserPrompt({
          notes: req.notes,
          previousSummary: req.previousSummary,
        }),
        signal: req.signal,
        options: {
          model: req.model,
          querySource: 'agent_summary',
          agentContext: getAgentContext(),
          isNonInteractiveSession:
            baseParams.toolUseContext?.options?.isNonInteractiveSession,
          agents: [],
          mcpTools: [],
          hasAppendSystemPrompt: false,
          enablePromptCaching: false,
          // Official 2.1.328 (#570): never disable effort for the subagent's
          // model for the session if Bedrock/Vertex/Foundry rejects effort on
          // this progress summary call.
          leavesEffortSupportAlone: req.leavesEffortSupportAlone,
          maxOutputTokensOverride: SHORT_NOTES_MAX_OUTPUT_TOKENS,
        },
      })
      return [msg]
    })

  // 2.1.323 #1976: do not schedule timers or issue summary requests when disabled
  if (isAgentProgressSummariesDisabled()) {
    logForDebuggingImpl(
      `[AgentSummary] No progress summaries for ${taskId}: CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES is set`,
    )
    return { stop: () => {} }
  }

  async function runSummary(): Promise<void> {
    if (stopped || isAgentProgressSummariesDisabled()) return

    logForDebuggingImpl(`[AgentSummary] Timer fired for agent ${agentId}`)

    try {
      // Read current messages from transcript
      const transcript = await getAgentTranscriptImpl(agentId)
      if (!transcript || transcript.messages.length < 3) {
        // Not enough context yet — finally block will schedule next attempt
        logForDebuggingImpl(
          `[AgentSummary] Skipping summary for ${taskId}: not enough messages (${transcript?.messages.length ?? 0})`,
        )
        return
      }

      const modeDecision = resolveAgentSummaryMode({
        provider: dependencies.provider,
        overrideMode: defaultOverrideMode,
      })
      const summaryWriterModel = resolveSummaryWriterModel({
        decision: modeDecision,
        agentModel,
        releaseShortFailed,
        getSmallFastModelImpl: dependencies.getSmallFastModel,
      })

      if (summaryWriterModel !== undefined) {
        const notes = buildShortSummaryNotes({
          task: dependencies.taskDescription ?? '',
          messages: transcript.messages,
        })
        if (!notes || notes === lastHandledShortNotes) {
          logForDebuggingImpl(
            `[AgentSummary] Skipping summary for ${taskId}: ${!notes ? 'nothing to describe' : 'notes unchanged'}`,
          )
          return
        }
        lastHandledShortNotes = notes
        logForDebuggingImpl(
          `[AgentSummary] Asking ${summaryWriterModel} for summary from ${notes.length} characters of notes`,
        )

        summaryAbortController = new AbortController()
        const requestTimeoutHandle = globalThis.setTimeout(() => {
          summaryAbortController?.abort()
        }, AGENT_SUMMARY_REQUEST_TIMEOUT_MS)
        if (
          requestTimeoutHandle &&
          typeof (requestTimeoutHandle as { unref?: () => void }).unref ===
            'function'
        ) {
          ;(requestTimeoutHandle as { unref: () => void }).unref()
        }

        let shortMessages: AssistantMessage[]
        try {
          shortMessages = await runShortNotesSummaryImpl({
            model: summaryWriterModel,
            notes,
            previousSummary,
            signal: summaryAbortController.signal,
            leavesEffortSupportAlone: true,
          })
        } finally {
          globalThis.clearTimeout(requestTimeoutHandle)
        }

        if (stopped) return

        for (const msg of shortMessages) {
          if (msg.type !== 'assistant') continue
          if (msg.isApiErrorMessage) {
            logForDebuggingImpl(
              `[AgentSummary] Skipping API error message for ${taskId}`,
            )
            if (modeDecision.source === 'release') {
              releaseShortFailed = true
            }
            continue
          }
          const contentArr = Array.isArray(msg.message?.content)
            ? msg.message.content
            : []
          const textBlock = contentArr.find(b => b.type === 'text')
          if (textBlock && textBlock.type === 'text' && textBlock.text.trim()) {
            const summary = sanitizeAgentSummaryReply(textBlock.text, true)
            if (summary !== null) {
              logForDebuggingImpl(
                `[AgentSummary] Summary result for ${taskId}: ${summary.length} chars`,
              )
              previousSummary = summary
              updateAgentSummaryImpl(taskId, summary, setAppState)
            }
            break
          }
        }
        return
      }

      const summaryContext = buildSummaryContext(
        transcript.messages,
        lastHandledTranscriptFingerprint,
      )
      if (summaryContext.skipReason === 'unchanged') {
        logForDebuggingImpl(
          `[AgentSummary] Skipping summary for ${taskId}: transcript unchanged`,
        )
        return
      }

      if (summaryContext.skipReason === 'too_small') {
        logForDebuggingImpl(
          `[AgentSummary] Skipping summary for ${taskId}: no bounded context available`,
        )
        return
      }

      didHoldThisTick = false
      if (
        shouldHoldFullSummaryForColdCache({
          ownRequests: dependencies.ownRequests,
          heldMs,
          heldAtResponsesBegun,
          now: nowImpl(),
          maxHoldMs,
        })
      ) {
        if (heldMs === 0) {
          logForDebuggingImpl(
            `[AgentSummary] Holding summary for ${taskId}: the sub-agent's own request has no response yet and its prompt cache is likely cold. Looking again every ${holdPollMs / 1000}s, for ${maxHoldMs / 60_000} min at most`,
          )
          heldAtResponsesBegun = dependencies.ownRequests?.responsesBegun
        }
        heldMs += holdPollMs
        didHoldThisTick = true
        return
      }
      if (heldMs > 0) {
        logForDebuggingImpl(
          `[AgentSummary] The hold for ${taskId} ended after ${heldMs / 1000}s`,
        )
      }

      // Build fork params with current messages
      const forkParams: CacheSafeParams = {
        ...baseParams,
        forkContextMessages: summaryContext.messages,
      }

      logForDebuggingImpl(
        `[AgentSummary] Forking for summary, ${summaryContext.messages.length} messages in context`,
      )

      // Create abort controller for this summary with 20s timeout (#2082)
      summaryAbortController = new AbortController()
      const requestTimeoutHandle = globalThis.setTimeout(() => {
        summaryAbortController?.abort()
      }, AGENT_SUMMARY_REQUEST_TIMEOUT_MS)
      if (
        requestTimeoutHandle &&
        typeof (requestTimeoutHandle as { unref?: () => void }).unref ===
          'function'
      ) {
        ;(requestTimeoutHandle as { unref: () => void }).unref()
      }

      // Deny tools via callback, NOT by passing tools:[] - that busts cache
      const canUseTool = async () => ({
        behavior: 'deny' as const,
        message: 'No tools needed for summary',
        decisionReason: { type: 'other' as const, reason: 'summary only' },
      })

      let result: Awaited<ReturnType<typeof runForkedAgentImpl>>
      try {
        result = await runForkedAgentImpl({
          promptMessages: [
            createSummaryPromptMessage(buildSummaryPrompt(previousSummary)),
          ],
          cacheSafeParams: forkParams,
          canUseTool,
          querySource: 'agent_summary',
          forkLabel: 'agent_summary',
          // Official 2.1.321 (#1899): cap at 1 turn and abort immediately if the
          // model attempts a tool_use block so summaries never run extra API turns.
          maxTurns: 1,
          onMessage: msg => {
            if (
              msg.type === 'assistant' &&
              Array.isArray(msg.message?.content) &&
              msg.message.content.some(b => b.type === 'tool_use')
            ) {
              summaryAbortController?.abort()
              return
            }
            const rawMsg = msg as unknown as {
              type?: string
              event?: { type?: string; content_block?: { type?: string } }
            }
            if (
              rawMsg.type === 'stream_event' &&
              rawMsg.event?.type === 'content_block_start' &&
              rawMsg.event.content_block?.type === 'tool_use'
            ) {
              summaryAbortController?.abort()
            }
          },
          overrides: { abortController: summaryAbortController },
          skipTranscript: true,
        })
      } finally {
        globalThis.clearTimeout(requestTimeoutHandle)
      }

      if (stopped) return

      // Extract summary text from result
      for (const msg of result.messages) {
        if (msg.type !== 'assistant') continue
        // Skip API error messages
        if (msg.isApiErrorMessage) {
          logForDebugging(
            `[AgentSummary] Skipping API error message for ${taskId}`,
          )
          continue
        }
        const contentArr = Array.isArray(msg.message!.content)
          ? msg.message!.content
          : []
        const textBlock = contentArr.find(b => b.type === 'text')
        if (textBlock?.type === 'text' && textBlock.text.trim()) {
          const summaryText = textBlock.text.trim()
          logForDebuggingImpl(
            `[AgentSummary] Summary result for ${taskId}: ${summaryText}`,
          )
          lastHandledTranscriptFingerprint = summaryContext.fingerprint
          previousSummary = summaryText
          updateAgentSummaryImpl(taskId, summaryText, setAppState)
          break
        }
      }
    } catch (e) {
      if (!stopped && e instanceof Error) {
        logErrorImpl(e)
      }
    } finally {
      summaryAbortController = null
      if (!didHoldThisTick) {
        heldMs = 0
        heldAtResponsesBegun = undefined
      }
      // Reset timer on completion (not initiation) to prevent overlapping summaries
      if (!stopped) {
        scheduleNext()
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    timeoutId = setTimeoutImpl(
      runSummary,
      heldMs > 0 ? holdPollMs : SUMMARY_INTERVAL_MS,
    )
  }

  function stop(): void {
    logForDebuggingImpl(`[AgentSummary] Stopping summarization for ${taskId}`)
    stopped = true
    if (timeoutId) {
      clearTimeoutImpl(timeoutId)
      timeoutId = null
    }
    if (summaryAbortController) {
      summaryAbortController.abort()
      summaryAbortController = null
    }
  }

  // Start the first timer
  scheduleNext()

  return { stop }
}
