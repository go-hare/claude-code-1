/**
 * Extracts durable memories from the current session transcript
 * and writes them to the auto-memory directory (~/.claude/projects/<path>/memory/).
 *
 * It runs once at the end of each complete query loop (when the model produces
 * a final response with no tool calls) via handleStopHooks in stopHooks.ts.
 *
 * Uses the forked agent pattern (runForkedAgent) — a perfect fork of the main
 * conversation that shares the parent's prompt cache.
 *
 * State is closure-scoped inside initExtractMemories() rather than module-level,
 * following the same pattern as confidenceRating.ts. Tests call
 * initExtractMemories() in beforeEach to get a fresh closure.
 */

import { feature } from 'bun:bundle'
import { basename } from 'path'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { ENTRYPOINT_NAME } from '../../memdir/memdir.js'
import {
  formatMemoryManifest,
  scanMemoryFiles,
} from '../../memdir/memoryScan.js'
import {
  getAutoMemPath,
  isAutoMemoryEnabled,
  isAutoMemPath,
} from '../../memdir/paths.js'
import type { Tool } from '../../Tool.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '@claude-code/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import type {
  AssistantMessage,
  Message,
  SystemMessage,
} from '../../types/message.js'
import { createAbortController } from '../../utils/abortController.js'
import { count, uniq } from '../../utils/array.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import {
  createMemorySavedMessage,
  createUserMessage,
} from '../../utils/messages.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  hasActiveSessionAls,
  RootSessionSlot,
  runWithSession,
} from '../../utils/sessionHost.js'
import type { Session } from '../../utils/sessionRoot.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../analytics/metadata.js'
import {
  buildExtractAutoOnlyPrompt,
  buildExtractCombinedPrompt,
} from './prompts.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('../../memdir/teamMemPaths.js') as typeof import('../../memdir/teamMemPaths.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if a message is visible to the model (sent in API calls).
 * Excludes progress, system, and attachment messages.
 */
function isModelVisibleMessage(message: Message): boolean {
  return message.type === 'user' || message.type === 'assistant'
}

function countModelVisibleMessagesSince(
  messages: Message[],
  sinceUuid: string | undefined,
): number {
  if (sinceUuid === null || sinceUuid === undefined) {
    return count(messages, isModelVisibleMessage)
  }

  let foundStart = false
  let n = 0
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (isModelVisibleMessage(message)) {
      n++
    }
  }
  // If sinceUuid was not found (e.g., removed by context compaction),
  // fall back to counting all model-visible messages rather than returning 0
  // which would permanently disable extraction for the rest of the session.
  if (!foundStart) {
    return count(messages, isModelVisibleMessage)
  }
  return n
}

/**
 * Returns true if any assistant message after the cursor UUID contains a
 * Write/Edit tool_use block targeting an auto-memory path.
 *
 * The main agent's prompt has full save instructions — when it writes
 * memories, the forked extraction is redundant. runExtraction skips the
 * agent and advances the cursor past this range, making the main agent
 * and the background agent mutually exclusive per turn.
 */
function hasMemoryWritesSince(
  messages: Message[],
  sinceUuid: string | undefined,
): boolean {
  let foundStart = sinceUuid === undefined
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (message.type !== 'assistant') {
      continue
    }
    const content = (message as AssistantMessage).message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const filePath = getWrittenFilePath(block)
      if (filePath !== undefined && isAutoMemPath(filePath)) {
        return true
      }
    }
  }
  return false
}

/**
 * Returns true if there is at least one "prose" user message since sinceUuid.
 * Prose = non-meta, non-tool-result user messages that contain actual text.
 * Without user prose there is nothing new worth extracting into memories.
 */
function hasUserProseSince(
  messages: Message[],
  sinceUuid: string | undefined,
): boolean {
  let foundStart = sinceUuid === undefined
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (message.type !== 'user') {
      continue
    }
    // Skip meta messages (system injections, tool results, etc.)
    if ((message as { isMeta?: boolean }).isMeta) {
      continue
    }
    if ((message as { toolUseResult?: unknown }).toolUseResult !== undefined) {
      continue
    }
    // Must have at least some text content
    const content = (message as { message?: { content?: unknown } }).message
      ?.content
    if (typeof content === 'string' && content.trim().length > 0) {
      return true
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'text' &&
          typeof (block as { text?: string }).text === 'string' &&
          (block as { text: string }).text.trim().length > 0
        ) {
          return true
        }
      }
    }
  }
  return false
}

// ============================================================================
// Tool Permissions
// ============================================================================

function denyAutoMemTool(tool: Tool, reason: string) {
  logForDebugging(`[autoMem] denied ${tool.name}: ${reason}`)
  logEvent('tengu_auto_mem_tool_denied', {
    tool_name: sanitizeToolNameForAnalytics(tool.name),
  })
  return {
    behavior: 'deny' as const,
    message: reason,
    decisionReason: { type: 'other' as const, reason },
  }
}

/**
 * Creates a canUseTool function that allows Read/Grep/Glob (unrestricted),
 * read-only Bash commands, and Edit/Write only for paths within the
 * auto-memory directory. Shared by extractMemories and autoDream.
 */
export function createAutoMemCanUseTool(memoryDir: string): CanUseToolFn {
  return async (tool: Tool, input: Record<string, unknown>) => {
    // Allow REPL — when REPL mode is enabled (ant-default), primitive tools
    // are hidden from the tool list so the forked agent calls REPL instead.
    // REPL's VM context re-invokes this canUseTool for each inner primitive
    // (toolWrappers.ts createToolWrapper), so the Read/Bash/Edit/Write checks
    // below still gate the actual file and shell operations. Giving the fork a
    // different tool list would break prompt cache sharing (tools are part of
    // the cache key — see CacheSafeParams in forkedAgent.ts).
    if (tool.name === REPL_TOOL_NAME) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Read/Grep/Glob unrestricted — all inherently read-only
    if (
      tool.name === FILE_READ_TOOL_NAME ||
      tool.name === GREP_TOOL_NAME ||
      tool.name === GLOB_TOOL_NAME
    ) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Bash only for commands that pass BashTool.isReadOnly.
    // `tool` IS BashTool here — no static import needed.
    if (tool.name === BASH_TOOL_NAME) {
      const parsed = tool.inputSchema.safeParse(input)
      if (parsed.success && tool.isReadOnly(parsed.data)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      return denyAutoMemTool(
        tool,
        'Only read-only shell commands are permitted in this context (ls, find, grep, cat, stat, wc, head, tail, and similar)',
      )
    }

    if (
      (tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && isAutoMemPath(filePath)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }

    return denyAutoMemTool(
      tool,
      `only ${FILE_READ_TOOL_NAME}, ${GREP_TOOL_NAME}, ${GLOB_TOOL_NAME}, read-only ${BASH_TOOL_NAME}, and ${FILE_EDIT_TOOL_NAME}/${FILE_WRITE_TOOL_NAME} within ${memoryDir} are allowed`,
    )
  }
}

// ============================================================================
// Extract file paths from agent output
// ============================================================================

/**
 * Extract file_path from a tool_use block's input, if present.
 * Returns undefined when the block is not an Edit/Write tool use or has no file_path.
 */
function getWrittenFilePath(block: {
  type: string
  name?: string
  input?: unknown
}): string | undefined {
  if (
    block.type !== 'tool_use' ||
    (block.name !== FILE_EDIT_TOOL_NAME && block.name !== FILE_WRITE_TOOL_NAME)
  ) {
    return undefined
  }
  const input = block.input
  if (typeof input === 'object' && input !== null && 'file_path' in input) {
    const fp = (input as { file_path: unknown }).file_path
    return typeof fp === 'string' ? fp : undefined
  }
  return undefined
}

function extractWrittenPaths(agentMessages: Message[]): string[] {
  const paths: string[] = []
  for (const message of agentMessages) {
    if (message.type !== 'assistant') {
      continue
    }
    const content = (message as AssistantMessage).message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const filePath = getWrittenFilePath(block)
      if (filePath !== undefined) {
        paths.push(filePath)
      }
    }
  }
  return uniq(paths)
}

// ============================================================================
// Initialization & Per-Session State
// ============================================================================

type AppendSystemMessageFn = (msg: SystemMessage) => void

export type MemoryExtractorStateSnapshot = {
  lastMemoryMessageUuid: string | undefined
  inProgress: boolean
  hasPendingContext: boolean
  inFlightCount: number
  turnsSinceLastExtraction: number
}

export type MemoryExtractor = {
  execute: (
    context: REPLHookContext,
    appendSystemMessage?: AppendSystemMessageFn,
  ) => Promise<void>
  drain: (timeoutMs?: number) => Promise<void>
  getStateForTesting: () => MemoryExtractorStateSnapshot
}

export type MemoryExtractorDeps = {
  runForkedAgentFn?: typeof runForkedAgent
  scanMemoryFilesFn?: typeof scanMemoryFiles
  isGateEnabledFn?: () => boolean
  isAutoMemoryEnabledFn?: () => boolean
  isRemoteModeFn?: () => boolean
  throttleTurnsFn?: () => number
}

/**
 * Create a standalone memory extractor closure with isolated mutable state
 * (cursor position, overlap guard, pending context, in-flight promise set).
 * Preserves active ALS `Session` across async `.finally` and trailing runs.
 */
export function createMemoryExtractor(
  deps?: MemoryExtractorDeps,
): MemoryExtractor {
  // --- Closure-scoped mutable state ---

  /** Every promise handed out by the extractor that hasn't settled yet.
   *  Coalesced calls that stash-and-return add fast-resolving promises
   *  (harmless); the call that starts real work adds a promise covering the
   *  full trailing-run chain via runExtraction's recursive finally. */
  const inFlightExtractions = new Set<Promise<void>>()

  /** UUID of the last message processed — cursor so each run only
   *  considers messages added since the previous extraction. */
  let lastMemoryMessageUuid: string | undefined

  /** One-shot flag: once we log that the gate is disabled, don't repeat. */
  let hasLoggedGateFailure = false

  /** True while runExtraction is executing — prevents overlapping runs. */
  let inProgress = false

  /** Counts eligible turns since the last extraction run. Resets to 0 after each run. */
  let turnsSinceLastExtraction = 0

  /** Last announced memory path set — skip a second Saved banner for the same files. */
  let lastAnnouncedMemoryKey = ''

  /** When a call arrives during an in-progress run, we stash the context here
   *  and run one trailing extraction after the current one finishes. */
  let pendingContext:
    | {
        session: Session | undefined
        context: REPLHookContext
        appendSystemMessage?: AppendSystemMessageFn
      }
    | undefined

  // --- Inner extraction logic ---

  async function runExtraction({
    context,
    appendSystemMessage,
    isTrailingRun,
  }: {
    context: REPLHookContext
    appendSystemMessage?: AppendSystemMessageFn
    isTrailingRun?: boolean
  }): Promise<void> {
    const { messages } = context
    const memoryDir = getAutoMemPath()
    const newMessageCount = countModelVisibleMessagesSince(
      messages,
      lastMemoryMessageUuid,
    )

    // Official CLAUDE_CODE_FORCE_EVALUATE_MEMORY densable — bypass skip gates
    // so extractMemories always runs (test / forced evaluation).
    let forceEvaluateMemory = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isForceEvaluateMemoryEnabled } =
        require('../../utils/residualMoreEnvGates.js') as typeof import('../../utils/residualMoreEnvGates.js')
      forceEvaluateMemory = isForceEvaluateMemoryEnabled()
    } catch {
      forceEvaluateMemory =
        process.env.CLAUDE_CODE_FORCE_EVALUATE_MEMORY === '1' ||
        process.env.CLAUDE_CODE_FORCE_EVALUATE_MEMORY === 'true'
    }

    // Mutual exclusion: when the main agent wrote memories, skip the
    // forked agent and advance the cursor past this range so the next
    // extraction only considers messages after the main agent's write.
    if (
      !forceEvaluateMemory &&
      hasMemoryWritesSince(messages, lastMemoryMessageUuid)
    ) {
      logForDebugging(
        '[extractMemories] skipping — conversation already wrote to memory files',
      )
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }
      logEvent('tengu_extract_memories_skipped_direct_write', {
        message_count: newMessageCount,
      })
      return
    }

    // Skip when there is no new user prose since the last extraction. Turns
    // driven purely by tool results / meta messages carry no durable
    // preferences or facts worth extracting — running the fork would burn
    // tokens for nothing. Advance the cursor so the next run only considers
    // messages after this point.
    if (
      !forceEvaluateMemory &&
      !hasUserProseSince(messages, lastMemoryMessageUuid)
    ) {
      logForDebugging(
        '[extractMemories] skipping — no user prose since last extraction',
      )
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }
      logEvent('tengu_extract_memories_skipped_no_prose', {
        message_count: newMessageCount,
      })
      return
    }

    const teamMemoryEnabled = feature('TEAMMEM')
      ? teamMemPaths!.isTeamMemoryEnabled()
      : false

    const skipIndex = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_moth_copse',
      false,
    )

    const canUseTool = createAutoMemCanUseTool(memoryDir)
    const cacheSafeParams = createCacheSafeParams(context)

    // Only run extraction every N eligible turns (tengu_bramble_lintel, default 1).
    // Trailing extractions (from stashed contexts) skip this check since they
    // process already-committed work that should not be throttled.
    if (!isTrailingRun) {
      turnsSinceLastExtraction++
      const minTurns = deps?.throttleTurnsFn
        ? deps.throttleTurnsFn()
        : (getFeatureValue_CACHED_MAY_BE_STALE('tengu_bramble_lintel', null) ??
          1)
      if (turnsSinceLastExtraction < minTurns) {
        return
      }
    }
    turnsSinceLastExtraction = 0

    inProgress = true
    const startTime = Date.now()
    try {
      logForDebugging(
        `[extractMemories] starting — ${newMessageCount} new messages, memoryDir=${memoryDir}`,
      )

      // Pre-inject the memory directory manifest so the agent doesn't spend
      // a turn on `ls`. Reuses findRelevantMemories' frontmatter scan.
      // Placed after the throttle gate so skipped turns don't pay the scan cost.
      const scanFn = deps?.scanMemoryFilesFn ?? scanMemoryFiles
      const existingMemories = formatMemoryManifest(
        await scanFn(memoryDir, createAbortController().signal),
      )

      const userPrompt = feature('TEAMMEM')
        ? teamMemoryEnabled
          ? buildExtractCombinedPrompt(
              newMessageCount,
              existingMemories,
              skipIndex,
            )
          : buildExtractAutoOnlyPrompt(
              newMessageCount,
              existingMemories,
              skipIndex,
            )
        : buildExtractAutoOnlyPrompt(
            newMessageCount,
            existingMemories,
            skipIndex,
          )

      const runFork = deps?.runForkedAgentFn ?? runForkedAgent
      const result = await runFork({
        promptMessages: [createUserMessage({ content: userPrompt })],
        cacheSafeParams,
        canUseTool,
        querySource: 'extract_memories',
        forkLabel: 'extract_memories',
        // The extractMemories subagent does not need to record to transcript.
        // Doing so can create race conditions with the main thread.
        skipTranscript: true,
        // Well-behaved extractions complete in 2-4 turns (read → write).
        // A hard cap prevents verification rabbit-holes from burning turns.
        maxTurns: 5,
      })

      // Advance the cursor only after a successful run. If the agent errors
      // out (caught below), the cursor stays put so those messages are
      // reconsidered on the next extraction.
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }

      const writtenPaths = extractWrittenPaths(result.messages)
      const turnCount = count(result.messages, m => m.type === 'assistant')

      const totalInput =
        result.totalUsage.input_tokens +
        result.totalUsage.cache_creation_input_tokens +
        result.totalUsage.cache_read_input_tokens
      const hitPct =
        totalInput > 0
          ? (
              (result.totalUsage.cache_read_input_tokens / totalInput) *
              100
            ).toFixed(1)
          : '0.0'
      logForDebugging(
        `[extractMemories] finished — ${writtenPaths.length} files written, cache: read=${result.totalUsage.cache_read_input_tokens} create=${result.totalUsage.cache_creation_input_tokens} input=${result.totalUsage.input_tokens} (${hitPct}% hit)`,
      )

      if (writtenPaths.length > 0) {
        logForDebugging(
          `[extractMemories] memories saved: ${writtenPaths.join(', ')}`,
        )
      } else {
        logForDebugging('[extractMemories] no memories saved this run')
      }

      // Index file updates are mechanical — the agent touches MEMORY.md to add
      // a topic link, but the user-visible "memory" is the topic file itself.
      const memoryPaths = writtenPaths.filter(
        p => basename(p) !== ENTRYPOINT_NAME,
      )
      const teamCount = feature('TEAMMEM')
        ? count(memoryPaths, teamMemPaths!.isTeamMemPath)
        : 0

      // Log extraction event with usage from the forked agent
      logEvent('tengu_extract_memories_extraction', {
        input_tokens: result.totalUsage.input_tokens,
        output_tokens: result.totalUsage.output_tokens,
        cache_read_input_tokens: result.totalUsage.cache_read_input_tokens,
        cache_creation_input_tokens:
          result.totalUsage.cache_creation_input_tokens,
        message_count: newMessageCount,
        turn_count: turnCount,
        files_written: writtenPaths.length,
        memories_saved: memoryPaths.length,
        team_memories_saved: teamCount,
        duration_ms: Date.now() - startTime,
      })

      logForDebugging(
        `[extractMemories] writtenPaths=${writtenPaths.length} memoryPaths=${memoryPaths.length} appendSystemMessage defined=${appendSystemMessage != null}`,
      )
      if (memoryPaths.length > 0) {
        const announcedKey = [...memoryPaths].sort().join('\0')
        if (announcedKey === lastAnnouncedMemoryKey) {
          logForDebugging(
            '[extractMemories] skipping Saved banner — same paths as last announcement',
          )
        } else {
          lastAnnouncedMemoryKey = announcedKey
          const msg = createMemorySavedMessage(memoryPaths)
          if (feature('TEAMMEM')) {
            msg.teamCount = teamCount
          }
          appendSystemMessage?.(msg)
        }
      }
    } catch (error) {
      // Extraction is best-effort — log but don't notify on error
      logForDebugging(`[extractMemories] error: ${error}`)
      logEvent('tengu_extract_memories_error', {
        duration_ms: Date.now() - startTime,
      })
    } finally {
      inProgress = false

      // If a call arrived while we were running, run a trailing extraction
      // with the latest stashed context under its captured ALS Session (if any).
      const trailing = pendingContext
      pendingContext = undefined
      if (trailing) {
        logForDebugging(
          '[extractMemories] running trailing extraction for stashed context',
        )
        const runTrailing = () =>
          runExtraction({
            context: trailing.context,
            appendSystemMessage: trailing.appendSystemMessage,
            isTrailingRun: true,
          })
        if (
          trailing.session !== undefined &&
          getActiveSessionFromAls() !== trailing.session
        ) {
          await runWithSession(trailing.session, runTrailing)
        } else {
          await runTrailing()
        }
      }
    }
  }

  // --- Public entry point (captured by extractor) ---

  async function executeExtractMemoriesImpl(
    session: Session | undefined,
    context: REPLHookContext,
    appendSystemMessage?: AppendSystemMessageFn,
  ): Promise<void> {
    // Only run for the main agent, not subagents
    if (context.toolUseContext.agentId) {
      return
    }

    const gateOpen = deps?.isGateEnabledFn
      ? deps.isGateEnabledFn()
      : getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)
    if (!gateOpen) {
      if (process.env.USER_TYPE === 'ant' && !hasLoggedGateFailure) {
        hasLoggedGateFailure = true
        logEvent('tengu_extract_memories_gate_disabled', {})
      }
      return
    }

    // Check auto-memory is enabled
    const autoMemOpen = deps?.isAutoMemoryEnabledFn
      ? deps.isAutoMemoryEnabledFn()
      : isAutoMemoryEnabled()
    if (!autoMemOpen) {
      return
    }

    // Skip in remote mode
    const remoteMode = deps?.isRemoteModeFn
      ? deps.isRemoteModeFn()
      : getIsRemoteMode()
    if (remoteMode) {
      return
    }

    // If an extraction is already in progress, stash this context for a
    // trailing run (overwrites any previously stashed context — only the
    // latest matters since it has the most messages).
    if (inProgress) {
      logForDebugging(
        '[extractMemories] extraction in progress — stashing for trailing run',
      )
      logEvent('tengu_extract_memories_coalesced', {})
      pendingContext = { session, context, appendSystemMessage }
      return
    }

    await runExtraction({ context, appendSystemMessage })
  }

  let registeredInLiveSet = false
  const extractor: MemoryExtractor = {
    execute: async (context, appendSystemMessage) => {
      if (!registeredInLiveSet) {
        registeredInLiveSet = true
        trackLiveMemoryExtractor(extractor)
      }
      const capturedAlsSession = getActiveSessionFromAls()
      const run = () =>
        executeExtractMemoriesImpl(
          capturedAlsSession,
          context,
          appendSystemMessage,
        )
      const p =
        capturedAlsSession !== undefined &&
        getActiveSessionFromAls() !== capturedAlsSession
          ? runWithSession(capturedAlsSession, run)
          : run()
      inFlightExtractions.add(p)
      activeInFlightExtractors.add(extractor)
      try {
        await p
      } finally {
        inFlightExtractions.delete(p)
        if (inFlightExtractions.size === 0) {
          activeInFlightExtractors.delete(extractor)
        }
      }
    },
    drain: async (timeoutMs = 60_000) => {
      if (inFlightExtractions.size === 0) return
      await Promise.race([
        Promise.all(inFlightExtractions).catch(() => {}),
        // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
        new Promise<void>(r => setTimeout(r, timeoutMs).unref()),
      ])
    },
    getStateForTesting: () => ({
      lastMemoryMessageUuid,
      inProgress,
      hasPendingContext: pendingContext !== undefined,
      inFlightCount: inFlightExtractions.size,
      turnsSinceLastExtraction,
    }),
  }
  return extractor
}

const liveMemoryExtractors = new Set<WeakRef<MemoryExtractor>>()
const activeInFlightExtractors = new Set<MemoryExtractor>()

function pruneDeadMemoryExtractors(): void {
  for (const ref of liveMemoryExtractors) {
    if (ref.deref() === undefined) {
      liveMemoryExtractors.delete(ref)
    }
  }
}

function trackLiveMemoryExtractor(extractor: MemoryExtractor): void {
  if (liveMemoryExtractors.size > 64) {
    pruneDeadMemoryExtractors()
  }
  liveMemoryExtractors.add(new WeakRef(extractor))
}

type SessionMemoryExtractorSlot = {
  initialized: boolean
  extractor: MemoryExtractor
}

let globalExtractMemoriesInitialized = false
let defaultExtractorDeps: MemoryExtractorDeps | undefined

const memoryExtractorBySession =
  new RootSessionSlot<SessionMemoryExtractorSlot>(() => ({
    initialized: false,
    extractor: createMemoryExtractor(defaultExtractorDeps),
  }))

/**
 * Initialize the memory extraction system for the active session.
 * Creates a fresh closure that captures all mutable state (cursor position,
 * overlap guard, pending context). Call once at startup alongside
 * initConfidenceRating/initPromptCoaching, or per-test in beforeEach.
 */
export function initExtractMemories(deps?: MemoryExtractorDeps): void {
  if (!hasActiveSessionAls()) {
    defaultExtractorDeps = deps
  }
  const slot = memoryExtractorBySession.of(getBootstrapSession())
  slot.initialized = true
  slot.extractor = createMemoryExtractor(deps ?? defaultExtractorDeps)
  if (!hasActiveSessionAls()) {
    globalExtractMemoriesInitialized = true
  }
}

export function getMemoryExtractorStateForTesting(): MemoryExtractorStateSnapshot {
  const existing = memoryExtractorBySession.peek(getBootstrapSession())
  if (!existing) {
    return {
      lastMemoryMessageUuid: undefined,
      inProgress: false,
      hasPendingContext: false,
      inFlightCount: 0,
      turnsSinceLastExtraction: 0,
    }
  }
  return existing.extractor.getStateForTesting()
}

export function resetExtractMemoriesForTests(): void {
  if (!hasActiveSessionAls()) {
    globalExtractMemoriesInitialized = false
    defaultExtractorDeps = undefined
  }
  memoryExtractorBySession.drop(getBootstrapSession())
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run memory extraction at the end of a query loop.
 * Called fire-and-forget from handleStopHooks, alongside prompt suggestion/coaching.
 * No-ops until initExtractMemories() has been called.
 */
export async function executeExtractMemories(
  context: REPLHookContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  const session = getBootstrapSession()
  const existing = memoryExtractorBySession.peek(session)
  if (!existing && !globalExtractMemoriesInitialized) return
  const slot = existing ?? memoryExtractorBySession.of(session)
  if (!slot.initialized && !globalExtractMemoriesInitialized) return
  await slot.extractor.execute(context, appendSystemMessage)
}

/**
 * Awaits all in-flight extractions (including trailing stashed runs) with a
 * soft timeout. Called by print.ts after the response is flushed but before
 * gracefulShutdownSync, so the forked agent completes before the 5s shutdown
 * failsafe kills it. No-op until initExtractMemories() has been called.
 */
export async function drainPendingExtraction(
  timeoutMs?: number,
): Promise<void> {
  if (hasActiveSessionAls()) {
    const session = getBootstrapSession()
    const existing = memoryExtractorBySession.peek(session)
    if (!existing) return
    if (!existing.initialized && !globalExtractMemoriesInitialized) return
    await existing.extractor.drain(timeoutMs)
    return
  }

  // Outside ALS (process shutdown): drain ALL live hosts' in-flight extractions.
  const extractorsToDrain = new Set<MemoryExtractor>()
  for (const extractor of activeInFlightExtractors) {
    extractorsToDrain.add(extractor)
  }
  for (const ref of liveMemoryExtractors) {
    const extractor = ref.deref()
    if (!extractor) {
      liveMemoryExtractors.delete(ref)
      continue
    }
    extractorsToDrain.add(extractor)
  }
  const defaultExisting = memoryExtractorBySession.peek(getBootstrapSession())
  if (
    defaultExisting &&
    (defaultExisting.initialized || globalExtractMemoriesInitialized)
  ) {
    extractorsToDrain.add(defaultExisting.extractor)
  }
  if (extractorsToDrain.size === 0) return
  await Promise.allSettled(
    [...extractorsToDrain].map(extractor => extractor.drain(timeoutMs)),
  )
}
