import { feature } from 'bun:bundle'
import { pruneDetachedToolCalls } from './utils/detachedToolCallStore.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve as pathResolve } from 'path'
import last from 'lodash-es/last.js'
import {
  getPromptRenderEpoch,
  getSessionId,
  isSessionPersistenceDisabled,
  getAutoModeUnavailableStopNotice,
  setAutoModeUnavailableStopNotice,
  setCwdState,
} from 'src/bootstrap/state.js'
import { createSessionToolUseContext } from './engine/createSessionToolUseContext.js'
import { clearCommandScopedAllowRules } from './utils/permissions/permissionSetup.js'
import type {
  PermissionMode,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPermissionDenial,
  SDKStatus,
  SDKUserMessageReplay,
} from 'src/entrypoints/agentSdkTypes.js'
import type { BetaMessageDeltaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { accumulateUsage, updateUsage } from 'src/services/api/claude.js'
import type { NonNullableUsage } from '@ant/model-provider'
import { EMPTY_USAGE } from '@ant/model-provider'
import stripAnsi from 'strip-ansi'
import type { Command } from './commands.js'
import { getSlashCommandToolSkills } from './commands.js'
import {
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from './constants/xml.js'
import {
  getModelUsage,
  getTotalAPIDuration,
  getTotalCost,
} from './cost-tracker.js'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import { loadMemoryPrompt } from './memdir/memdir.js'
import { hasAutoMemPathOverride } from './memdir/paths.js'
import { query } from './query.js'
import {
  buildRetractedWireFields,
  RetractedWireUuidTracker,
} from './query/queryHelpers.js'
import { categorizeRetryableAPIError } from './services/api/errors.js'
import type { MCPServerConnection } from './services/mcp/types.js'
import type { AppState } from './state/AppState.js'
import {
  findToolByName,
  type Tools,
  type ToolUseContext,
  toolMatchesName,
} from './Tool.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import type { APIError } from '@anthropic-ai/sdk'
import type {
  AssistantMessage,
  Message,
  MessageOrigin,
  SystemCompactBoundaryMessage,
} from './types/message.js'
import type { HookDeferredToolAttachment } from './utils/attachments.js'
import { transformCompletedAssistantMessage } from './utils/messageDisplayTransform.js'
import type { OrphanedPermission } from './types/textInputTypes.js'
import { createAbortController } from './utils/abortController.js'
import { getCwd } from './utils/cwd.js'
import { isEnvTruthy } from './utils/envUtils.js'

/**
 * Official 2.1.328 (#647): avoid retaining high-volume ephemeral `progress`
 * messages (such as `bash_progress`, `tool_progress`, `agent_progress`,
 * `mcp_progress`, `hook_progress`) inside `QueryEngine.mutableMessages`,
 * preventing unbounded memory growth and O(N) scan slowdowns in long SDK /
 * Desktop sessions running slow commands or tools.
 */
export function shouldRetainProgressInMutableMessages(msg: {
  type?: string
  data?: { type?: string }
}): boolean {
  if (msg.type !== 'progress') return true
  const progressType = msg.data?.type
  if (
    progressType === 'bash_progress' ||
    progressType === 'tool_progress' ||
    progressType === 'agent_progress' ||
    progressType === 'mcp_progress' ||
    progressType === 'hook_progress' ||
    progressType === 'waiting_for_task' ||
    progressType === undefined
  ) {
    return false
  }
  return true
}
import { logForDebugging } from './utils/debug.js'
import { isBareMode } from './utils/envUtils.js'
import {
  getFastModeState,
  getFastModeUnavailableReason,
  isModelFastModeRejectedForSession,
} from './utils/fastMode.js'
import { releaseQueuedAfterTurn } from './utils/messageQueueManager.js'
import {
  type FileHistoryState,
  fileHistoryEnabled,
  fileHistoryMakeSnapshot,
} from './utils/fileHistory.js'
import {
  cloneFileStateCache,
  type FileStateCache,
} from './utils/fileStateCache.js'
import { headlessProfilerCheckpoint } from './utils/headlessProfiler.js'
import { registerStructuredOutputEnforcement } from './utils/hooks/hookHelpers.js'
import { getInMemoryErrors, logError } from './utils/log.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from './services/analytics/index.js'
import {
  applyTurnStartOriginFraming,
  countToolCalls,
  isHumanLikeOrigin,
  stampQueueOriginOnUserMessages,
  SYNTHETIC_MESSAGES,
} from './utils/messages.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from './utils/model/model.js'
import { resolveModelFacts } from './utils/model/modelFacts.js'
import { loadAllPluginsCacheOnly } from './utils/plugins/pluginLoader.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
} from './utils/plugins/pluginToolList.js'
import {
  type ProcessUserInputContext,
  processUserInput,
} from './utils/processUserInput/processUserInput.js'
import {
  hasHearthRelayStamps,
  resolveQueuedMessageUuid,
  stampHearthRelay,
  stampQueueSkipAttachments,
  stampVerifiedSlackHumanTurn,
} from './utils/processUserInput/artStamps.js'
import { createPromptSubmitEntries } from './utils/processUserInput/promptSubmitEntries.js'
import {
  createSetInProgressToolUseIDs,
  fetchSystemPromptParts,
} from './utils/queryContext.js'
import {
  credentialsStoreFor,
  getPinnedCredentials,
} from './utils/storageV5/credentialsStore.js'
import { getPinnedStorageV5 } from './utils/storageV5/index.js'
import { ToolStateSlots } from './utils/toolState.js'
import { createTaskRegistry, type TaskRegistry } from './utils/taskRegistry.js'
import { setCwd } from './utils/Shell.js'
import {
  flushSessionStorage,
  recordTranscript,
  removeTranscriptMessage,
} from './utils/sessionStorage.js'
import { resolveChromeAppendSystemPrompt } from './utils/claudeInChrome/prompt.js'
import { asSystemPrompt } from './utils/systemPromptType.js'
import { resolveThemeSetting } from './utils/systemTheme.js'
import {
  shouldEnableThinkingByDefault,
  type ThinkingConfig,
} from './utils/thinking.js'

// Lazy: MessageSelector.tsx pulls React/ink; only needed for message filtering at query time
/* eslint-disable @typescript-eslint/no-require-imports */
const messageSelector = ():
  | typeof import('src/components/MessageSelector.js')
  | null => {
  try {
    return require('src/components/MessageSelector.js')
  } catch {
    return null
  }
}

import {
  localCommandOutputToSDKAssistantMessage,
  toSDKCompactMetadata,
} from './utils/messages/mappers.js'
import {
  buildSystemInitMessage,
  sdkCompatToolName,
} from './utils/messages/systemInit.js'
import { getMcpConfigServerErrors } from './services/mcp/config.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from './utils/permissions/filesystem.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  handleDeferredToolUse,
  handleOrphanedPermission,
  isResultSuccessful,
  normalizeMessage,
} from './utils/queryHelpers.js'
import { getThemeSetting } from './utils/themeSetting.js'

// Dead code elimination: conditional import for coordinator mode.
// Lazy require — top-level `.prop` on require() can hang under Bun incomplete
// ESM namespace (42120cd7); print imports QueryEngine at startup.
function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
  tools?: ReadonlyArray<{ name: string; searchHint?: string }>,
): { [k: string]: string } {
  if (!feature('COORDINATOR_MODE')) return {}
  /* eslint-disable @typescript-eslint/no-require-imports */
  const mod =
    require('./coordinator/coordinatorMode.js') as typeof import('./coordinator/coordinatorMode.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  if (typeof mod?.getCoordinatorUserContext !== 'function') return {}
  return mod.getCoordinatorUserContext(mcpClients, scratchpadDir, tools)
}

// Dead code elimination: conditional import for snip compaction
/* eslint-disable @typescript-eslint/no-require-imports */
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js'))
  : null
const snipProjection = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipProjection.js') as typeof import('./services/compact/snipProjection.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const STREAM_TOOL_USE_BLOCK_TYPES = new Set([
  'tool_use',
  'server_tool_use',
  'mcp_tool_use',
])

export type OuterStreamEvent = {
  type: 'stream_event'
  event: Record<string, unknown>
  session_id: string
  parent_tool_use_id: string | null
  uuid: string
  ttft_ms?: number
  thinking_display?: unknown
  api_message_id?: string
  abandoned_blocks?: {
    api_message_id: string
    from_block_index: number
  }
  text_runs_joined?: boolean
}

function apiMessageIdFields(
  apiMessageId: string | null | undefined,
): { api_message_id: string } | Record<string, never> {
  return typeof apiMessageId === 'string' && apiMessageId !== ''
    ? { api_message_id: apiMessageId }
    : {}
}

function normalizeDeltaUsage(
  usage: BetaMessageDeltaUsage | NonNullableUsage,
): Record<string, unknown> {
  const u = usage as unknown as Record<string, unknown>
  return {
    output_tokens_details: u.output_tokens_details ?? null,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: u.cache_read_input_tokens ?? null,
    input_tokens: u.input_tokens ?? null,
    iterations: u.iterations ?? null,
    output_tokens: u.output_tokens ?? 0,
    server_tool_use: u.server_tool_use ?? null,
    fallback_credit: u.fallback_credit ?? null,
  }
}

function buildSyntheticBlockStop(
  apiMessageId: string | null,
  index: number,
): OuterStreamEvent {
  return {
    type: 'stream_event',
    event: { type: 'content_block_stop', index },
    session_id: getSessionId(),
    parent_tool_use_id: null,
    uuid: randomUUID(),
    ...apiMessageIdFields(apiMessageId),
  }
}

function buildSyntheticMessageStop(
  apiMessageId: string | null,
  fromBlockIndex?: number,
): OuterStreamEvent {
  const idFields = apiMessageIdFields(apiMessageId)
  return {
    type: 'stream_event',
    event: { type: 'message_stop' },
    session_id: getSessionId(),
    parent_tool_use_id: null,
    uuid: randomUUID(),
    ...idFields,
    ...(idFields.api_message_id !== undefined &&
    fromBlockIndex !== undefined &&
    Number.isSafeInteger(fromBlockIndex)
      ? {
          abandoned_blocks: {
            api_message_id: idFields.api_message_id,
            from_block_index: fromBlockIndex,
          },
        }
      : {}),
  }
}

function buildSyntheticMessageEnd(
  apiMessageId: string | null,
  stopReason: string | null,
  stopSequence: string | null,
  usage: Record<string, unknown>,
  fromBlockIndex?: number,
): OuterStreamEvent[] {
  return [
    {
      type: 'stream_event',
      event: {
        type: 'message_delta',
        context_management: null,
        delta: {
          container: null,
          stop_details: null,
          stop_reason: stopReason,
          stop_sequence: stopSequence,
        },
        usage,
      },
      session_id: getSessionId(),
      parent_tool_use_id: null,
      uuid: randomUUID(),
      ...apiMessageIdFields(apiMessageId),
    },
    buildSyntheticMessageStop(apiMessageId, fromBlockIndex),
  ]
}

/** Gold sr(e, n) — forward stream_event fields including api_message_id and abandoned_blocks. */
export function buildStreamEventOut(
  streamMsg: {
    event: Record<string, unknown>
    ttftMs?: number
    thinkingDisplay?: unknown
    apiMessageId?: string
    abandonedBlocks?: { apiMessageId: string; fromBlockIndex: number }
    textRunsJoined?: boolean
  },
  meta: { session_id: string; uuid: string },
): OuterStreamEvent {
  const out: OuterStreamEvent = {
    type: 'stream_event',
    event: streamMsg.event,
    session_id: meta.session_id,
    parent_tool_use_id: null,
    uuid: meta.uuid,
  }
  if (streamMsg.ttftMs !== undefined) out.ttft_ms = streamMsg.ttftMs
  if (streamMsg.thinkingDisplay !== undefined) {
    out.thinking_display = streamMsg.thinkingDisplay
  }
  if (streamMsg.apiMessageId !== undefined) {
    out.api_message_id = streamMsg.apiMessageId
  }
  if (streamMsg.abandonedBlocks !== undefined) {
    out.abandoned_blocks = {
      api_message_id: streamMsg.abandonedBlocks.apiMessageId,
      from_block_index: streamMsg.abandonedBlocks.fromBlockIndex,
    }
  }
  if (streamMsg.textRunsJoined) out.text_runs_joined = true
  return out
}

const NOOP_PARTIAL_STREAM_CLOSER = {
  onStreamEvent: (): OuterStreamEvent[] => [],
  onAssistantMessage: (): void => {},
  onTombstone: (): OuterStreamEvent[] => [],
  closeAtTurnEnd: (): OuterStreamEvent[] => [],
}

/**
 * Gold Xo(includePartialMessages) — tracks open partial-stream blocks and
 * emits synthetic content_block_stop/message_delta/message_stop with
 * api_message_id + abandoned_blocks on tombstone, stale message_start, or turn end.
 */
export function createPartialStreamRetractionCloser(enabled: boolean) {
  if (!enabled) return NOOP_PARTIAL_STREAM_CLOSER
  let currentMessageId: string | null = null
  let openBlockIndex: number | null = null
  let sawAnyBlockStop = false
  let stopReasonSent = false
  let openBlockIsToolUse = false
  const deliveredBlockNextIndex = new Map<string, number>()
  let deferredClose: {
    messageId: string
    retracted: {
      stop_reason?: string | null
      stop_sequence?: string | null
      usage?: BetaMessageDeltaUsage | NonNullableUsage
    }
  } | null = null

  function runSafe(fn: () => OuterStreamEvent[]): OuterStreamEvent[] {
    try {
      return fn()
    } catch (err) {
      logError(err)
      return []
    }
  }

  function flushDeferredClose(): OuterStreamEvent[] {
    if (deferredClose === null) return []
    const d = deferredClose
    deferredClose = null
    logEvent('tengu_partial_stream_retraction_closed', {
      stop_reason: (d.retracted.stop_reason ??
        undefined) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      had_open_block: false,
    })
    return buildSyntheticMessageEnd(
      d.messageId,
      d.retracted.stop_reason ?? null,
      d.retracted.stop_sequence ?? null,
      normalizeDeltaUsage(d.retracted.usage ?? EMPTY_USAGE),
    )
  }

  function closeOpenStream(
    usage: BetaMessageDeltaUsage | NonNullableUsage,
    source: string,
    sameMessageId: boolean,
  ): OuterStreamEvent[] {
    if (currentMessageId === null) return []
    const events: OuterStreamEvent[] = []
    const hadOpenBlock = openBlockIndex !== null
    if (openBlockIndex !== null && !openBlockIsToolUse) {
      events.push(buildSyntheticBlockStop(currentMessageId, openBlockIndex))
    }
    if (stopReasonSent) {
      events.push(buildSyntheticMessageStop(currentMessageId))
    } else {
      events.push(
        ...buildSyntheticMessageEnd(
          currentMessageId,
          null,
          null,
          normalizeDeltaUsage(usage),
          sameMessageId
            ? undefined
            : (deliveredBlockNextIndex.get(currentMessageId) ?? 0),
        ),
      )
    }
    logEvent('tengu_partial_stream_retraction_closed', {
      had_open_block: hadOpenBlock,
      stop_reason_already_sent: stopReasonSent,
      source:
        source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    currentMessageId = null
    openBlockIndex = null
    openBlockIsToolUse = false
    stopReasonSent = false
    return events
  }

  return {
    onStreamEvent(
      event: Record<string, unknown>,
      usage: BetaMessageDeltaUsage | NonNullableUsage,
    ): OuterStreamEvent[] {
      return runSafe(() => {
        const out: OuterStreamEvent[] = []
        if (deferredClose !== null) {
          if (event.type === 'ping') {
            // keep deferredClose across pings
          } else if (event.type === 'message_start') {
            out.push(...flushDeferredClose())
          } else {
            currentMessageId = deferredClose.messageId
            deferredClose = null
          }
        }
        if (event.type === 'message_start') {
          const msg = event.message as { id?: string } | undefined
          const nextId = msg?.id ?? null
          out.push(
            ...closeOpenStream(
              usage,
              'stale_message_start',
              nextId === currentMessageId,
            ),
          )
          currentMessageId = nextId
          openBlockIndex = null
          openBlockIsToolUse = false
          sawAnyBlockStop = false
          stopReasonSent = false
        } else if (event.type === 'content_block_start') {
          openBlockIndex = typeof event.index === 'number' ? event.index : null
          const cb = event.content_block as { type?: string } | undefined
          openBlockIsToolUse =
            cb?.type !== undefined && STREAM_TOOL_USE_BLOCK_TYPES.has(cb.type)
          stopReasonSent = false
        } else if (event.type === 'content_block_stop') {
          openBlockIndex = null
          openBlockIsToolUse = false
          sawAnyBlockStop = true
        } else if (event.type === 'message_delta') {
          const delta = event.delta as
            | { stop_reason?: string | null }
            | undefined
          if (delta?.stop_reason != null && openBlockIndex === null) {
            stopReasonSent = true
          }
        } else if (event.type === 'message_stop') {
          currentMessageId = null
          openBlockIndex = null
          openBlockIsToolUse = false
          stopReasonSent = false
        }
        void sawAnyBlockStop
        return out
      })
    },
    onAssistantMessage(msg: Message): void {
      try {
        const m = msg as unknown as {
          message?: { id?: string }
          apiBlockIndex?: number
        }
        const id = m.message?.id
        if (!id) return
        const idx = m.apiBlockIndex
        const nextIdx =
          idx !== undefined && Number.isSafeInteger(idx) && idx >= 0
            ? idx + 1
            : Number.NaN
        deliveredBlockNextIndex.set(
          id,
          Math.max(deliveredBlockNextIndex.get(id) ?? 0, nextIdx),
        )
      } catch (err) {
        logError(err)
      }
    },
    onTombstone(tombstone: {
      message?: Message
      displayOnly?: boolean
    }): OuterStreamEvent[] {
      return runSafe(() => {
        const inner = tombstone.message as
          | {
              type?: string
              message?: {
                id?: string
                stop_reason?: string | null
                stop_sequence?: string | null
                usage?: BetaMessageDeltaUsage | NonNullableUsage
              }
            }
          | undefined
        if (
          currentMessageId === null ||
          inner?.type !== 'assistant' ||
          inner.message?.id !== currentMessageId
        ) {
          return []
        }
        if (tombstone.displayOnly === true) {
          logEvent('tengu_partial_stream_retraction_display_only', {
            had_open_block: openBlockIndex !== null,
          })
          return []
        }
        const retracted = inner.message
        if (openBlockIndex === null) {
          deferredClose = { messageId: currentMessageId, retracted }
          currentMessageId = null
          return []
        }
        const out: OuterStreamEvent[] = [
          ...(openBlockIsToolUse
            ? []
            : [buildSyntheticBlockStop(currentMessageId, openBlockIndex)]),
          ...buildSyntheticMessageEnd(
            currentMessageId,
            retracted.stop_reason ?? null,
            retracted.stop_sequence ?? null,
            normalizeDeltaUsage(retracted.usage ?? EMPTY_USAGE),
          ),
        ]
        logEvent('tengu_partial_stream_retraction_closed', {
          stop_reason: (retracted.stop_reason ??
            undefined) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          had_open_block: true,
        })
        currentMessageId = null
        openBlockIndex = null
        openBlockIsToolUse = false
        return out
      })
    },
    closeAtTurnEnd(
      usage: BetaMessageDeltaUsage | NonNullableUsage,
    ): OuterStreamEvent[] {
      return runSafe(() => [
        ...flushDeferredClose(),
        ...closeOpenStream(usage, 'turn_end', false),
      ])
    },
  }
}

/**
 * #1734: Normalize an informational system message's `content` so SDK clients
 * never lose text (whether stored as a plain string or an array of text blocks).
 */
export function normalizeInformationalContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (typeof block === 'string') return block
        if (
          block !== null &&
          typeof block === 'object' &&
          'text' in block &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return content == null ? '' : String(content)
}

/**
 * #1864 / official `hs = 600_000` (`zln` / `zDr` / `VDr`) — in non-interactive
 * `-p` mode, background commands default to the 10-minute (600,000 ms) cap
 * (never telling Claude 30 minutes when stopped at 10 minutes), bounded by
 * the maximum timeout cap.
 */
export const NON_INTERACTIVE_BG_TIMEOUT_CAP_MS = 600_000
export const DEFAULT_BG_TIMEOUT_MAX_MS = 1_800_000

export function resolveNonInteractiveBgTimeoutMs(opts?: {
  isNonInteractive?: boolean
  configuredDefaultMs?: number
  configuredMaxMs?: number
  minFloorMs?: number
}): number {
  const maxMs = opts?.configuredMaxMs ?? DEFAULT_BG_TIMEOUT_MAX_MS
  if (opts?.isNonInteractive !== false) {
    const base = Math.max(
      NON_INTERACTIVE_BG_TIMEOUT_CAP_MS,
      opts?.minFloorMs ?? 0,
    )
    return Math.min(base, maxMs)
  }
  return Math.min(opts?.configuredDefaultMs ?? DEFAULT_BG_TIMEOUT_MAX_MS, maxMs)
}

export function formatNonInteractiveBgTimeoutToolDescription(opts?: {
  isNonInteractive?: boolean
  defaultMs?: number
  maxMs?: number
}): string {
  const defaultMs =
    opts?.defaultMs ??
    resolveNonInteractiveBgTimeoutMs({
      isNonInteractive: opts?.isNonInteractive ?? true,
      configuredMaxMs: opts?.maxMs,
    })
  const maxMs = opts?.maxMs ?? DEFAULT_BG_TIMEOUT_MAX_MS
  return `Set to true to run this command in the background. With it, \`timeout\` limits how long the command may run in the background before it is stopped (default ${defaultMs} ms, max ${maxMs} ms).`
}

export function formatNonInteractiveBgTimeoutGuidance(opts?: {
  isNonInteractive?: boolean
  defaultMs?: number
  maxMs?: number
}): string {
  const defaultMs =
    opts?.defaultMs ??
    resolveNonInteractiveBgTimeoutMs({
      isNonInteractive: opts?.isNonInteractive ?? true,
      configuredMaxMs: opts?.maxMs,
    })
  const maxMs = opts?.maxMs ?? DEFAULT_BG_TIMEOUT_MAX_MS
  const maxLabel =
    maxMs < 3_600_000
      ? `${Math.round(maxMs / 60_000)} minutes`
      : `${Math.round(maxMs / 3_600_000)} hours`
  return ` With \`run_in_background\` the timeout is instead how long the command may run in the background (default ${defaultMs}ms / ${Math.round(defaultMs / 60_000)} minutes, max ${maxMs}ms / ${maxLabel}); at that limit it is stopped.`
}

// ---------------------------------------------------------------------------
// Official 2.1.328 #1492: decision_reason_code extraction (`eCe`, chunk@283886268.js)
// ---------------------------------------------------------------------------

const CLASSIFIER_TRANSCRIPT_TOO_LONG_FALLBACK =
  'Auto mode classifier transcript exceeded context window \u2014 falling back to manual approval (try /compact to reduce conversation size)'
const CLASSIFIER_TRANSCRIPT_TOO_LONG_COMPACT =
  'Auto mode classifier transcript exceeded context window; will try to compact the conversation before the next request'
const MEMORY_PAUSED_REASON =
  'Memory is paused for this session; only the user can turn it back on.'
const MEMORY_PAUSED_COMMAND_REASON = 'memory access blocked by /pause-memory'

export const AUTO_MODE_NO_CHECK_HOST_CODES = new Set<string>([
  'auto_mode_no_check_in_session',
  'auto_mode_stop_no_check_in_session',
  'auto_mode_stop_no_result_for_calls',
  'auto_mode_stop_no_verdict',
])

export function extractDecisionReasonType(
  decisionReason: unknown,
): string | undefined {
  if (!decisionReason || typeof decisionReason !== 'object') return undefined
  const r = decisionReason as { type?: unknown; typeOnWire?: unknown }
  if (r.type === 'subcommandResults' && typeof r.typeOnWire === 'string') {
    return r.typeOnWire
  }
  return typeof r.type === 'string' ? r.type : undefined
}

/**
 * Official 2.1.328 `eCe` (`chunk@283886268.js @9666`): map an internal
 * PermissionDecisionReason onto the wire `decision_reason_code` string.
 */
export function extractDecisionReasonCode(
  decisionReason: unknown,
): string | undefined {
  if (!decisionReason || typeof decisionReason !== 'object') return undefined
  const r = decisionReason as {
    type?: unknown
    noVerdict?: unknown
    reason?: unknown
    hostCode?: unknown
    circuitBreaker?: unknown
    reasons?: Map<string, { decisionReason?: unknown }>
  }
  switch (r.type) {
    case 'classifier':
      if (
        r.noVerdict === true &&
        (r.reason === CLASSIFIER_TRANSCRIPT_TOO_LONG_FALLBACK ||
          r.reason === CLASSIFIER_TRANSCRIPT_TOO_LONG_COMPACT)
      ) {
        return 'classifier_transcript_too_long'
      }
      return typeof r.hostCode === 'string' ? r.hostCode : undefined
    case 'other':
    case 'safetyCheck':
      if (r.circuitBreaker === 'outsideReadsBlocked') {
        return 'outside_reads_blocked'
      }
      switch (r.reason) {
        case CLASSIFIER_TRANSCRIPT_TOO_LONG_FALLBACK:
          return 'classifier_transcript_too_long'
        case MEMORY_PAUSED_REASON:
        case MEMORY_PAUSED_COMMAND_REASON:
          return 'memory_paused'
        default:
          return typeof r.hostCode === 'string' ? r.hostCode : undefined
      }
    case 'subcommandResults': {
      if (!(r.reasons instanceof Map)) return undefined
      let first: string | undefined
      for (const entry of r.reasons.values()) {
        const code = extractDecisionReasonCode(entry.decisionReason)
        if (code === 'outside_reads_blocked') return code
        first ??= code
      }
      return first
    }
    default:
      return undefined
  }
}

export function isAutoModeNoVerdictDenialResult(result: {
  behavior?: unknown
  decisionReason?: unknown
  endsTurn?: unknown
}): boolean {
  if (result.behavior !== 'deny') return false
  const code = extractDecisionReasonCode(result.decisionReason)
  if (
    code !== undefined &&
    (AUTO_MODE_NO_CHECK_HOST_CODES.has(code) ||
      code.startsWith('auto_mode_stop_'))
  ) {
    return true
  }
  if (
    result.endsTurn === true &&
    result.decisionReason &&
    typeof result.decisionReason === 'object'
  ) {
    const r = result.decisionReason as { type?: unknown; noVerdict?: unknown }
    if (r.type === 'classifier' && r.noVerdict === true) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Official 2.1.328 #1640: Working-directory pin & approved-shell directory hold
// (`t3t`, `Lzr`, `Oxt`, `call_directory_hold`, `shellNotInApprovedDirectory`)
// ---------------------------------------------------------------------------

/** Official `t3t` (`chunk@294254613.js @3843409`). */
export class MissingWorkingDirectoryError extends Error {
  readonly path: string
  override name = 'MissingWorkingDirectoryError'

  constructor(missingPath: string) {
    super(`Path "${missingPath}" does not exist`)
    this.path = missingPath
  }
}

/** Official `Lzr` — per-session missing working directory pin state. */
export const missingWorkingDirectoryPins = new WeakMap<
  object,
  { pinned: boolean }
>()

/** Official `Oxt` — per-session map of toolUseID -> realpath verified at permission check. */
export const permissionCheckedCwds = new WeakMap<object, Map<string, string>>()

export function getMissingWorkingDirectoryPin(sessionKey: object): {
  pinned: boolean
} {
  let state = missingWorkingDirectoryPins.get(sessionKey)
  if (!state) {
    state = { pinned: false }
    missingWorkingDirectoryPins.set(sessionKey, state)
  }
  return state
}

export function recordPermissionCheckedCwd(
  sessionKey: object,
  toolUseID: string,
  cwdPath: string,
): string | undefined {
  let physical: string
  try {
    physical = realpathSync(cwdPath)
  } catch {
    return undefined
  }
  let map = permissionCheckedCwds.get(sessionKey)
  if (!map) {
    map = new Map<string, string>()
    permissionCheckedCwds.set(sessionKey, map)
  }
  map.set(toolUseID, physical)
  return physical
}

export function getPermissionCheckedCwd(
  sessionKey: object,
  toolUseID: string,
): string | undefined {
  return permissionCheckedCwds.get(sessionKey)?.get(toolUseID)
}

export type CallDirectoryHoldOutcome =
  | { ok: true; physicalPath: string }
  | {
      ok: false
      holdReason: 'changed_before_shell' | 'gone' | 'pinned_refusal'
      message: string
    }

/**
 * Official 2.1.328 #1640 (`chunk@294254613.js @3826200`): validate that the
 * shell's current working directory still exists and still resolves to the
 * same physical directory verified at permission-check time (or refuse when
 * the session is pinned to a missing directory).
 */
export function checkCallDirectoryHold(opts: {
  cwd: string
  checkedPhysicalCwd?: string
  sessionKey?: object
  resolveRealpath?: (p: string) => string | null
}): CallDirectoryHoldOutcome {
  const resolvePath =
    opts.resolveRealpath ??
    ((p: string): string | null => {
      try {
        return realpathSync(p)
      } catch {
        return null
      }
    })
  const currentPhysical = resolvePath(opts.cwd)
  if (currentPhysical === null) {
    if (
      opts.sessionKey !== undefined &&
      missingWorkingDirectoryPins.get(opts.sessionKey)?.pinned === true
    ) {
      logForDebugging(
        `Shell CWD "${opts.cwd}" no longer exists and the session is pinned to it; refusing to run`,
        { level: 'warn' },
      )
      logEvent('tengu_shell_set_cwd', {
        success: false,
        pinned_refusal: true,
      })
      logEvent('call_directory_hold', {
        reason:
          'pinned_refusal' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        ok: false,
        holdReason: 'pinned_refusal',
        message: `Working directory "${opts.cwd}" no longer exists, so shell commands cannot run until it is restored. File tools with absolute paths still work; recreate the directory (writing a file inside it recreates it), or start a new session from an existing directory.`,
      }
    }
    logEvent('call_directory_hold', {
      reason:
        'gone' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      ok: false,
      holdReason: 'gone',
      message: `Working directory "${opts.cwd}" is gone (deleted, moved, replaced by a link, or unreadable), so this command was not run. Re-issue the command if it still makes sense where the session is now.`,
    }
  }
  if (
    opts.checkedPhysicalCwd !== undefined &&
    currentPhysical !== opts.checkedPhysicalCwd
  ) {
    logForDebugging(
      `Shell exec refused: working directory "${opts.cwd}" leads elsewhere than at the command's permission check`,
      { level: 'warn' },
    )
    logEvent('call_directory_hold', {
      reason:
        'changed_before_shell' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      ok: false,
      holdReason: 'changed_before_shell',
      message: `Working directory "${opts.cwd}" no longer leads where it did when this command was permission-checked (a part of the path was replaced, or can't be examined), so this command was not run. Re-issue the command to have it checked afresh.`,
    }
  }
  return { ok: true, physicalPath: currentPhysical }
}

/**
 * Official 2.1.328 #1640 (`chunk@303112704.js @80605-85729`): when an approved
 * shell call resumes after restart carrying `askedInDirectory`, confirm that
 * the shell's current physical directory matches the approved directory under
 * `projectRoot`; otherwise deny with `label: 'shellNotInApprovedDirectory'`.
 */
export function verifyApprovedShellDirectory(opts: {
  askedInDirectory: string | undefined
  projectRoot: string | undefined
  currentCwd: string
  toolUseID: string
  resolveRealpath?: (p: string) => string | null
}):
  | { ok: true }
  | {
      ok: false
      denial: {
        behavior: 'deny'
        toolUseID: string
        message: string
        decisionReason: {
          type: 'other'
          reason: string
          label: 'shellNotInApprovedDirectory'
        }
      }
    } {
  if (opts.askedInDirectory === undefined) return { ok: true }
  const resolvePath =
    opts.resolveRealpath ??
    ((p: string): string | null => {
      try {
        return realpathSync(p)
      } catch {
        return null
      }
    })
  const deny = (noStart: boolean) => ({
    ok: false as const,
    denial: {
      behavior: 'deny' as const,
      toolUseID: opts.toolUseID,
      message: `This call was not run. Claude Code could not confirm that the shell is back in the directory where it was approved. ${
        noStart
          ? 'It does not keep track of that directory across a restart in a session that has been in a worktree.'
          : 'That directory may be gone or replaced, lie outside the directory where the session started, or be one that Claude Code needs approval to enter or is not allowed to examine.'
      } The shell's directory is ${opts.currentCwd}. If the command still makes sense, cd to the directory it was meant for and make the call again; it may need approval again.`,
      decisionReason: {
        type: 'other' as const,
        reason:
          'the shell could not be confirmed in the directory where the call was approved',
        label: 'shellNotInApprovedDirectory' as const,
      },
    },
  })
  if (!opts.projectRoot) {
    return deny(true)
  }
  const rootPhysical = resolvePath(opts.projectRoot)
  const expectedTarget = isAbsolute(opts.askedInDirectory)
    ? opts.askedInDirectory
    : pathResolve(rootPhysical ?? opts.projectRoot, opts.askedInDirectory)
  const expectedPhysical = resolvePath(expectedTarget)
  const currentPhysical = resolvePath(opts.currentCwd)
  if (!rootPhysical || !expectedPhysical || !currentPhysical) {
    return deny(false)
  }
  const relToRoot = relative(rootPhysical, expectedPhysical)
  if (relToRoot.startsWith('..') || isAbsolute(relToRoot)) {
    return deny(false)
  }
  if (currentPhysical !== expectedPhysical) {
    return deny(false)
  }
  return { ok: true }
}

/**
 * Official 2.1.328 `fa`/`ya` (`chunk@322707994.js @99356`): call `setCwd(cwd)`
 * and on missing directory pin the session instead of crashing the turn,
 * returning an informational warning SDK message on first pin.
 */
export function setCwdOrPinMissing(
  cwd: string,
  sessionKey: object,
  setCwdFn: (dir: string) => void = setCwd,
): SDKMessage | undefined {
  try {
    setCwdFn(cwd)
    const pin = missingWorkingDirectoryPins.get(sessionKey)
    if (pin !== undefined) {
      pin.pinned = false
    }
    return undefined
  } catch (err) {
    const missingPath =
      err instanceof MissingWorkingDirectoryError
        ? err.path
        : err instanceof Error
          ? err.message.match(/^Path "(.+)" does not exist$/)?.[1]
          : undefined
    if (missingPath === undefined) {
      throw err
    }
    setCwdState(missingPath)
    logForDebugging(
      `[headless] working directory ${missingPath} no longer exists; the turn starts pinned to it`,
      { level: 'warn' },
    )
    const pin = getMissingWorkingDirectoryPin(sessionKey)
    if (pin.pinned) {
      return undefined
    }
    pin.pinned = true
    try {
      logEvent('tengu_shell_set_cwd', {
        success: false,
        missing_at_turn: true,
      })
    } catch {
      // ignore telemetry failures
    }
    return {
      type: 'system',
      subtype: 'informational',
      content: `The session's working directory ${missingPath} no longer exists; shell commands cannot start there and relative file paths that use it will fail until it is restored.`,
      level: 'warning',
      session_id: getSessionId(),
      uuid: randomUUID(),
    } as unknown as SDKMessage
  }
}

export type QueryResultVerdictInput = {
  result: Message | undefined
  lastStopReason: string | null
  terminalReason?: string
  deferredThisTurn: boolean
  maxTurnsReached?: { turnCount: number; maxTurns: number }
  isApiErrorLatched: boolean
  apiErrorStatus: number | null
  apiErrorCode?: string
  apiErrorType?: string
  apiErrorOrigin?: string
  apiErrorCategory?: string
  apiErrorText: string
  lastTurnAssistantText: string
  structuredOutput: unknown
  refusalDroppedStructuredOutput: boolean
  stoppedByPermissionCheck: boolean
  permissionStopMessage?: string
}

export type QueryResultVerdict =
  | {
      subtype: 'error_max_budget_usd'
      isError: true
    }
  | {
      subtype: 'error_max_turns'
      isError: true
      turnCount: number
      maxTurns: number
    }
  | {
      subtype: 'error_during_execution'
      isError: true
      stoppedByPermissionCheck: boolean
      permissionStopMessage?: string
    }
  | {
      subtype: 'success'
      isError: boolean
      resultText: string
      structuredOutput: unknown
      apiErrorStatus: number | null
      apiErrorCode?: string
      apiErrorType?: string
      apiErrorOrigin?: string
      apiError?: string
    }

/**
 * Official 2.1.328 `HGt` (`chunk@306199530.js @83000-84400`, `sdkResultVerdict: true`):
 * Compute the terminal SDK result envelope classification.
 *
 * Critically, assistant turns with `isApiErrorMessage: true` (401/429/413/500/PTL/
 * billing) satisfy `isResultSuccessful(result, lastStopReason)` because they carry
 * error text, so they emit `subtype: 'success'` with `is_error: true`, actual error
 * text in `result`, and `api_error_*` metadata — NEVER `error_during_execution`.
 * `error_during_execution` is reserved for `!isResultSuccessful(...)`, uncaught
 * throws, or permission/auto-mode-no-verdict stops (`#1492`).
 */
export function resolveQueryEngineResultVerdict(
  input: QueryResultVerdictInput,
): QueryResultVerdict {
  if (input.terminalReason === 'budget_exhausted') {
    return { subtype: 'error_max_budget_usd', isError: true }
  }
  if (!input.deferredThisTurn && input.maxTurnsReached !== undefined) {
    return {
      subtype: 'error_max_turns',
      isError: true,
      turnCount: input.maxTurnsReached.turnCount,
      maxTurns: input.maxTurnsReached.maxTurns,
    }
  }
  if (
    input.stoppedByPermissionCheck &&
    input.permissionStopMessage !== undefined
  ) {
    return {
      subtype: 'error_during_execution',
      isError: true,
      stoppedByPermissionCheck: true,
      permissionStopMessage: input.permissionStopMessage,
    }
  }
  if (
    !input.deferredThisTurn &&
    !isResultSuccessful(input.result, input.lastStopReason)
  ) {
    return {
      subtype: 'error_during_execution',
      isError: true,
      stoppedByPermissionCheck: input.stoppedByPermissionCheck,
    }
  }
  const isApiError =
    input.isApiErrorLatched ||
    (input.result?.type === 'assistant' &&
      Boolean(input.result.isApiErrorMessage))
  const effectiveStructuredOutput = input.refusalDroppedStructuredOutput
    ? undefined
    : input.structuredOutput
  let textResult = isApiError ? input.apiErrorText : input.lastTurnAssistantText
  if (!textResult && input.result?.type === 'assistant') {
    const lastContent = last(
      input.result.message!
        .content as import('@anthropic-ai/sdk/resources/beta/messages/messages.js').BetaContentBlock[],
    )
    if (
      lastContent?.type === 'text' &&
      !SYNTHETIC_MESSAGES.has(lastContent.text)
    ) {
      textResult = stripAnsi(lastContent.text)
    }
  }
  if (textResult === '' && effectiveStructuredOutput !== undefined) {
    textResult = JSON.stringify(effectiveStructuredOutput)
  }
  return {
    subtype: 'success',
    isError: isApiError || input.refusalDroppedStructuredOutput,
    resultText: input.deferredThisTurn ? '' : textResult,
    structuredOutput: effectiveStructuredOutput,
    apiErrorStatus: input.apiErrorStatus,
    ...(input.apiErrorCode !== undefined
      ? { apiErrorCode: input.apiErrorCode }
      : {}),
    ...(input.apiErrorType !== undefined
      ? { apiErrorType: input.apiErrorType }
      : {}),
    ...(input.apiErrorOrigin !== undefined
      ? { apiErrorOrigin: input.apiErrorOrigin }
      : {}),
    ...(isApiError && input.apiErrorCategory !== undefined
      ? { apiError: input.apiErrorCategory }
      : {}),
  }
}

export type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: Command[]
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  initialMessages?: Message[]
  readFileCache: FileStateCache
  customSystemPrompt?: string
  appendSystemPrompt?: string
  /** Official --append-subagent-system-prompt for Task-tool subagents. */
  appendSubagentSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  jsonSchema?: Record<string, unknown>
  verbose?: boolean
  replayUserMessages?: boolean
  /** Handler for URL elicitations triggered by MCP tool -32042 errors. */
  handleElicitation?: ToolUseContext['handleElicitation']
  /**
   * Official requestDialog host (print cvf) for refusal_fallback /
   * fable_overage / mcp_url_elicitation parks. Plumbed onto ToolUseContext.
   */
  requestDialog?: ToolUseContext['requestDialog']
  includePartialMessages?: boolean
  /**
   * densable `replayAcksAtRequestDispatch`. Print sets this only for CCR
   * `jV` transport + GB `tengu_ccr_replay_acks_at_request_dispatch`.
   * `Fi = includePartialMessages && (getter() ?? false)`.
   */
  replayAcksAtRequestDispatch?: () => boolean
  /**
   * densable print `refreshTools:Wi`. After Art, QE may rebuild the
   * system prompt when the live tool list identity changes.
   */
  refreshTools?: () => Tools
  /** densable print `refreshMcpClients:Mo`. */
  refreshMcpClients?: () => MCPServerConnection[]
  /** densable 2.1.219 #6 — nested subagent text/thinking on stream-json */
  forwardSubagentText?: boolean
  setSDKStatus?: (status: SDKStatus) => void
  abortController?: AbortController
  orphanedPermission?: OrphanedPermission
  /** Official JNs `F` — `$2l` attachment from resume, not a message scan. */
  deferredToolUse?: HookDeferredToolAttachment
  /** #1733 / official `keptDeferredToolNotice` — error notice returned when a deferred tool's MCP server is missing and the call is preserved. */
  keptDeferredToolNotice?: string
  /** #1733 / official `dropsUnavailableDeferredTool` — when false (default), preserve the deferred tool call in the transcript instead of dropping it. */
  dropsUnavailableDeferredTool?: boolean
  /** Official toolAliases — SDK-renamed tools for leftover Ld resume. */
  toolAliases?: Record<string, string>
  /** Official 2.1.323 #2043: true on persisted/remote transports (e.g. sdkUrl). */
  isPersistedTransport?: boolean
  /**
   * densable `wN`. Print passes one bag into every `ask()`; a missing
   * bag becomes one slot map for this engine.
   */
  toolState?: ToolStateSlots
  /** Session registry shared by print turns and side questions. */
  taskRegistry?: TaskRegistry
  /** Session credentials handle. Headless falls back to the pinned store. */
  credentials?: ToolUseContext['credentials']
  /**
   * Snip-boundary handler: receives each yielded system message plus the
   * current mutableMessages store. Returns undefined if the message is not a
   * snip boundary; otherwise returns the replayed snip result. Injected by
   * ask() when HISTORY_SNIP is enabled so feature-gated strings stay inside
   * the gated module (keeps QueryEngine free of excluded strings and testable
   * despite feature() returning false under bun test). SDK-only: the REPL
   * keeps full history for UI scrollback and projects on demand via
   * projectSnippedView; QueryEngine truncates here to bound memory in long
   * headless sessions (no UI to preserve).
   */
  snipReplay?: (
    yieldedSystemMsg: Message,
    store: Message[],
  ) => { messages: Message[]; executed: boolean } | undefined
}

/**
 * Headless tool context credentials. Explicit config wins, then the startup
 * pin, then the store for pinned storageV5 (densable `D.credentials`).
 */
function headlessCredentials(
  explicit: ToolUseContext['credentials'],
): ToolUseContext['credentials'] {
  if (explicit !== undefined) return explicit
  return getPinnedCredentials() ?? credentialsStoreFor(getPinnedStorageV5())
}

/**
 * QueryEngine owns the query lifecycle and session state for a conversation.
 * It extracts the core logic from ask() into a standalone class that can be
 * used by both the headless/SDK path and (in a future phase) the REPL.
 *
 * One QueryEngine per conversation. Each submitMessage() call starts a new
 * turn within the same conversation. State (messages, file cache, usage, etc.)
 * persists across turns.
 */
export class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage
  private hasHandledOrphanedPermission = false
  private hasHandledDeferredToolUse = false
  private readFileState: FileStateCache
  // Turn-scoped skill discovery tracking (feeds was_discovered on
  // tengu_skill_tool_invocation). Must persist across the two
  // processUserInputContext rebuilds inside submitMessage, but is cleared
  // at the start of each submitMessage to avoid unbounded growth across
  // many turns in SDK mode.
  private discoveredSkillNames = new Set<string>()
  private loadedNestedMemoryPaths = new Set<string>()
  private pendingNestedMemoryTriggers = new Set<string>()
  private sessionToolState: ToolStateSlots
  /** densable `Xm(e,o)` — caller's session registry, or engine-local fallback. */
  private taskRegistry: TaskRegistry

  constructor(config: QueryEngineConfig) {
    this.config = config
    this.sessionToolState = config.toolState ?? new ToolStateSlots()
    this.taskRegistry =
      config.taskRegistry ??
      createTaskRegistry(config.getAppState, config.setAppState)
    this.mutableMessages = config.initialMessages ?? []
    this.abortController = config.abortController ?? createAbortController()
    this.permissionDenials = []
    this.readFileState = config.readFileCache
    this.totalUsage = EMPTY_USAGE
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { leftoverIhrStartXe } =
        require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      leftoverIhrStartXe()
    } catch {
      // isolation — optional
    }
  }

  async *submitMessage(
    prompt: string | ContentBlockParam[],
    options?: {
      uuid?: string
      isMeta?: boolean
      skipSlashCommands?: boolean
      skipAttachments?: boolean
      skipSubmissionHooks?: boolean
      /** Official drain: seed query() stopHookActive from the SDK host. */
      stopHookActive?: boolean
      bridgeOrigin?: boolean
      /** densable 2.1.221 modelScheduledOrigin fire stamp */
      modelScheduledOrigin?: boolean
      /** densable 2.1.221 wakeupSource fire stamp */
      wakeupSource?: string
      origin?: MessageOrigin
      /** Official 2.1.323 #2199: host-provided prompt provenance for workflow gating. */
      isHumanTypedPrompt?: boolean
      suppressWorkflowKeyword?: boolean
      shouldQuery?: boolean
      /** densable 2.1.289 print task-notification coalesce hold stamp */
      queryHeldForNextTurn?: boolean
      localStdinOrigin?: boolean
      sessionChannelPersonTyped?: boolean
      hostInitiator?: unknown
      artifactCommentTurn?: unknown
      verifiedSlackHumanTurn?: boolean
      projectsUserTurn?: boolean
      hearthRelayRows?: unknown
      hearthRelayThreadTs?: unknown
      hearthRelayMessageIds?: unknown
      inlinedImagePaths?: string[]
      stampThreadState?: boolean
      pollEventDelivery?: boolean
      pollEventProvenance?: unknown[]
      pollEventDeclared?: unknown
      skipSkillPermissionReset?: boolean
      pollEmptyDispatch?: boolean
      fileAttachments?: unknown[]
      frameTiming?: { enqueuedWallMs: number }
      clientPlatform?: string
      /** densable BX `taskDelivery` — GetTask snapshot on As. */
      taskDelivery?: unknown
    },
  ): AsyncGenerator<SDKMessage, void, unknown> {
    const {
      cwd,
      commands,
      tools: initialTools,
      mcpClients: initialMcpClients,
      verbose = false,
      thinkingConfig,
      maxTurns,
      maxBudgetUsd,
      taskBudget,
      canUseTool,
      customSystemPrompt,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      userSpecifiedModel,
      fallbackModel,
      jsonSchema,
      getAppState,
      setAppState,
      replayUserMessages = false,
      includePartialMessages = false,
      replayAcksAtRequestDispatch,
      forwardSubagentText = false,
      agents = [],
      setSDKStatus,
      orphanedPermission,
      deferredToolUse: configDeferredToolUse,
      keptDeferredToolNotice,
      dropsUnavailableDeferredTool = false,
      toolAliases,
      refreshTools,
      refreshMcpClients,
    } = this.config
    let tools = applyPluginToolListFilter(initialTools)
    let mcpClients = initialMcpClients
    // Official 2.1.323 #2199: forward host prompt provenance onto toolUseContext.
    const promptProvenance =
      options?.isHumanTypedPrompt !== undefined ||
      options?.suppressWorkflowKeyword !== undefined ||
      options?.origin !== undefined
        ? {
            ...(options?.isHumanTypedPrompt !== undefined
              ? { isHumanTypedPrompt: options.isHumanTypedPrompt }
              : {}),
            ...(options?.suppressWorkflowKeyword !== undefined
              ? { suppressWorkflowKeyword: options.suppressWorkflowKeyword }
              : {}),
            ...(options?.origin !== undefined
              ? { origin: options.origin }
              : {}),
          }
        : undefined
    const replayRequestingStatus =
      includePartialMessages && (replayAcksAtRequestDispatch?.() ?? false)

    this.discoveredSkillNames.clear()
    this.permissionDenials = []
    const missingDirWarning = setCwdOrPinMissing(cwd, this)
    if (missingDirWarning !== undefined) {
      yield missingDirWarning
    }
    const persistSession = !isSessionPersistenceDisabled()
    const startTime = Date.now()

    // Official 2.1.328 #1492: track auto-mode no-verdict stops and pre-ask
    // system/permission_denied wire frames with decision_reason_code.
    let autoModeNoVerdictStopMessage: string | undefined
    const pendingPermissionDeniedEvents: SDKMessage[] = []

    // Wrap canUseTool to track permission denials, propagate decision_reason_code,
    // and enforce #1640 shell directory pin/hold checks.
    const wrappedCanUseTool: CanUseToolFn = async (
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseID,
      forceDecision,
    ) => {
      const isShellTool = tool.name === 'Bash' || tool.name === 'PowerShell'
      if (isShellTool) {
        const priorChecked = getPermissionCheckedCwd(this, toolUseID)
        const isPinned = missingWorkingDirectoryPins.get(this)?.pinned === true
        if (isPinned || priorChecked !== undefined) {
          const hold = checkCallDirectoryHold({
            cwd: getCwd(),
            checkedPhysicalCwd: priorChecked,
            sessionKey: this,
          })
          if (!hold.ok) {
            const denial = {
              behavior: 'deny' as const,
              message: hold.message,
              decisionReason: {
                type: 'other' as const,
                reason: hold.message,
              },
            }
            this.permissionDenials.push({
              type: 'permission_denial',
              tool_name: sdkCompatToolName(tool.name),
              tool_use_id: toolUseID,
              tool_input: input,
              decision_reason_type: 'other',
            })
            return denial
          }
        }
      }

      const result = await canUseTool(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseID,
        forceDecision,
      )

      if (result.behavior === 'allow' && isShellTool) {
        recordPermissionCheckedCwd(this, toolUseID, getCwd())
      }

      // Track denials for SDK reporting (including decision_reason_code for #1492)
      if (result.behavior !== 'allow') {
        const resRec = result as {
          behavior: string
          message?: string
          decisionReason?: unknown
          decideLocation?: string
          invalidInput?: boolean
          endsTurn?: boolean
        }
        const decisionReasonType = extractDecisionReasonType(
          resRec.decisionReason,
        )
        const decisionReasonCode = extractDecisionReasonCode(
          resRec.decisionReason,
        )
        this.permissionDenials.push({
          type: 'permission_denial',
          tool_name: sdkCompatToolName(tool.name),
          tool_use_id: toolUseID,
          tool_input: input,
          ...(decisionReasonType !== undefined
            ? { decision_reason_type: decisionReasonType }
            : {}),
          ...(decisionReasonCode !== undefined
            ? { decision_reason_code: decisionReasonCode }
            : {}),
        })

        if (isAutoModeNoVerdictDenialResult(resRec)) {
          const reasonText =
            resRec.decisionReason &&
            typeof resRec.decisionReason === 'object' &&
            'reason' in resRec.decisionReason &&
            typeof (resRec.decisionReason as { reason?: unknown }).reason ===
              'string'
              ? (resRec.decisionReason as { reason: string }).reason
              : undefined
          autoModeNoVerdictStopMessage =
            resRec.message ||
            reasonText ||
            'Auto mode unavailable \u2014 stopped after repeated responses with no safety verdict'
        }

        if (
          resRec.behavior === 'deny' &&
          resRec.decideLocation === 'pre-ask' &&
          resRec.invalidInput !== true
        ) {
          const humanReason =
            resRec.decisionReason &&
            typeof resRec.decisionReason === 'object' &&
            'reason' in resRec.decisionReason &&
            typeof (resRec.decisionReason as { reason?: unknown }).reason ===
              'string'
              ? (resRec.decisionReason as { reason: string }).reason
              : undefined
          pendingPermissionDeniedEvents.push({
            type: 'system',
            subtype: 'permission_denied',
            tool_name: tool.name,
            tool_use_id: toolUseID,
            ...(toolUseContext.agentId !== undefined
              ? { agent_id: toolUseContext.agentId }
              : {}),
            ...(decisionReasonType !== undefined
              ? { decision_reason_type: decisionReasonType }
              : {}),
            ...(decisionReasonCode !== undefined
              ? { decision_reason_code: decisionReasonCode }
              : {}),
            ...(humanReason !== undefined
              ? { decision_reason: humanReason }
              : {}),
            message: resRec.message ?? '',
            session_id: getSessionId(),
            uuid: randomUUID(),
          } as unknown as SDKMessage)
        }
      }

      return result
    }

    const initialAppState = getAppState()
    const initialMainLoopModel = userSpecifiedModel
      ? parseUserSpecifiedModel(userSpecifiedModel)
      : getMainLoopModel()

    const initialThinkingConfig: ThinkingConfig = thinkingConfig
      ? thinkingConfig
      : shouldEnableThinkingByDefault() !== false
        ? { type: 'adaptive' }
        : { type: 'disabled' }

    // densable Aa=Tqe then Ss=tte(), before fetchSystemPromptParts.
    const modelFacts =
      options?.shouldQuery === false
        ? undefined
        : await resolveModelFacts(initialMainLoopModel, {
            credentials: headlessCredentials(this.config.credentials),
            abortController: this.abortController,
          })
    const promptRenderEpoch = getPromptRenderEpoch()

    headlessProfilerCheckpoint('before_getSystemPrompt')
    // Narrow once so TS tracks the type through the conditionals below.
    const customPrompt =
      typeof customSystemPrompt === 'string' ? customSystemPrompt : undefined
    const {
      defaultSystemPrompt,
      userContext: baseUserContext,
      systemContext: initialSystemContext,
    } = await fetchSystemPromptParts({
      tools,
      mainLoopModel: initialMainLoopModel,
      additionalWorkingDirectories: Array.from(
        initialAppState.toolPermissionContext.additionalWorkingDirectories.keys(),
      ),
      mcpClients,
      customSystemPrompt: customPrompt,
    })
    headlessProfilerCheckpoint('after_getSystemPrompt')
    let systemContext = initialSystemContext

    // When an SDK caller provides a custom system prompt AND has set
    // CLAUDE_COWORK_MEMORY_PATH_OVERRIDE, inject the memory-mechanics prompt.
    // The env var is an explicit opt-in signal — the caller has wired up
    // a memory directory and needs Claude to know how to use it (which
    // Write/Edit tools to call, MEMORY.md filename, loading semantics).
    // The caller can layer their own policy text via appendSystemPrompt.
    const memoryMechanicsPrompt =
      customPrompt !== undefined && hasAutoMemPathOverride()
        ? await loadMemoryPrompt()
        : null

    const chromeResolvedAppend =
      resolveChromeAppendSystemPrompt(appendSystemPrompt)
    let systemPrompt = asSystemPrompt([
      ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
      ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
      ...(chromeResolvedAppend ? [chromeResolvedAppend] : []),
    ])
    let userContext = {
      ...baseUserContext,
      ...getCoordinatorUserContext(
        mcpClients,
        isScratchpadEnabled() ? getScratchpadDir() : undefined,
        tools,
      ),
    }

    // Register function hook for structured output enforcement
    const hasStructuredOutputTool = tools.some(t =>
      toolMatchesName(t, SYNTHETIC_OUTPUT_TOOL_NAME),
    )
    if (jsonSchema && hasStructuredOutputTool) {
      registerStructuredOutputEnforcement(setAppState, getSessionId())
    }

    const leftoverIhrSdkRetry = (
      status: import('./utils/advisorNetworkStall.js').RetryStatus | null,
    ) => {
      try {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { leftoverIhr } =
          require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        leftoverIhr.main.setRetryStatus(status)
      } catch {
        // isolation — optional
      }
    }
    const leftoverIhrSdkMode = (
      mode: import('./components/Spinner/index.js').SpinnerMode,
    ) => {
      try {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { leftoverIhr } =
          require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        leftoverIhr.main.setMode(mode)
      } catch {
        // isolation — optional
      }
    }

    let processUserInputContext = createSessionToolUseContext({
      messages: this.mutableMessages,
      // Slash commands that mutate the message array (e.g. /force-snip)
      // call setMessages(fn).  In interactive mode this writes back to
      // AppState; in print mode we write back to mutableMessages so the
      // rest of the query loop (push at :389, snapshot at :392) sees
      // the result.  The second processUserInputContext below (after
      // slash-command processing) keeps the no-op — nothing else calls
      // setMessages past that point.
      setMessages: fn => {
        const next = fn(this.mutableMessages)
        pruneDetachedToolCalls(this.mutableMessages, next)
        this.mutableMessages = next
      },
      handleElicitation: this.config.handleElicitation,
      requestDialog: this.config.requestDialog,
      commands,
      debug: false, // we use stdout, so don't want to clobber it
      tools,
      verbose,
      mainLoopModel: initialMainLoopModel,
      fallbackModel,
      thinkingConfig: initialThinkingConfig,
      mcpClients,
      mcpResources: {},
      ideInstallationStatus: null,
      isNonInteractiveSession: true,
      customSystemPrompt,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      baseAgentDefinitions: { activeAgents: agents, allAgents: [] },
      theme: resolveThemeSetting(getThemeSetting()),
      maxBudgetUsd,
      // densable 2.1.219 #6 — plumb into ToolUseContext for AgentTool
      forwardSubagentText,
      toolAliases,
      messageClientPlatform: options?.clientPlatform,
      getAppState,
      taskRegistry: this.taskRegistry,
      setAppState,
      abortController: this.abortController,
      readFileState: this.readFileState,
      toolState: this.sessionToolState,
      credentials: headlessCredentials(this.config.credentials),
      loadedNestedMemoryPaths: this.loadedNestedMemoryPaths,
      pendingNestedMemoryTriggers: this.pendingNestedMemoryTriggers,
      discoveredSkillNames: this.discoveredSkillNames,
      setInProgressToolUseIDs: createSetInProgressToolUseIDs(this.taskRegistry),
      setRetryStatus: leftoverIhrSdkRetry,
      setStreamMode: leftoverIhrSdkMode,
      setSDKStatus,
    })
    if (promptProvenance) {
      processUserInputContext.promptProvenance = promptProvenance
    }

    // Handle orphaned permission (only once per engine lifetime)
    if (orphanedPermission && !this.hasHandledOrphanedPermission) {
      this.hasHandledOrphanedPermission = true
      const { clearTurnAttributionKey } = await import(
        './utils/turnAttribution.js'
      )
      clearTurnAttributionKey()
      // Official 2.1.328 #1640 (`chunk@303112704.js @80605`): if an approved
      // orphaned shell call carries `askedInDirectory`, verify the shell is
      // still in the approved directory before executing; otherwise deny with
      // `shellNotInApprovedDirectory`.
      let effectiveOrphanedPermission = orphanedPermission
      const orphanExtra = orphanedPermission as OrphanedPermission & {
        askedInDirectory?: string
      }
      const permResultRec = orphanedPermission.permissionResult as {
        behavior?: string
        toolUseID?: string
      }
      if (
        orphanExtra.askedInDirectory !== undefined &&
        permResultRec.behavior === 'allow' &&
        typeof permResultRec.toolUseID === 'string'
      ) {
        const orphanToolUseId = permResultRec.toolUseID
        const content = orphanedPermission.assistantMessage.message?.content
        const matchedBlock = Array.isArray(content)
          ? content.find(
              b =>
                typeof b === 'object' &&
                b !== null &&
                'type' in b &&
                b.type === 'tool_use' &&
                'id' in b &&
                b.id === orphanToolUseId,
            )
          : undefined
        const blockName =
          matchedBlock &&
          'name' in matchedBlock &&
          typeof matchedBlock.name === 'string'
            ? matchedBlock.name
            : undefined
        if (blockName === 'Bash' || blockName === 'PowerShell') {
          const check = verifyApprovedShellDirectory({
            askedInDirectory: orphanExtra.askedInDirectory,
            projectRoot: cwd,
            currentCwd: getCwd(),
            toolUseID: orphanToolUseId,
          })
          if (!check.ok) {
            effectiveOrphanedPermission = {
              ...orphanedPermission,
              permissionResult:
                check.denial as unknown as OrphanedPermission['permissionResult'],
            }
          }
        }
      }
      for await (const message of handleOrphanedPermission(
        effectiveOrphanedPermission,
        tools,
        this.mutableMessages,
        processUserInputContext,
      )) {
        yield message
      }
    }

    // Official JNs + 2.1.328 (#545): skip resuming hook-deferred tool calls
    // when CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME is truthy.
    const deferredToolResumeDisabled = isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME,
    )
    const deferredToolUse =
      this.hasHandledDeferredToolUse || deferredToolResumeDisabled
        ? undefined
        : configDeferredToolUse
    if (deferredToolUse) {
      this.hasHandledDeferredToolUse = true
      const { clearTurnAttributionKey } = await import(
        './utils/turnAttribution.js'
      )
      clearTurnAttributionKey()
      const deferredToolAvailable =
        findToolByName(tools, deferredToolUse.toolName) !== undefined ||
        (toolAliases !== undefined &&
          Object.entries(toolAliases).some(
            ([alias, canonical]) =>
              (alias === deferredToolUse.toolName ||
                canonical === deferredToolUse.toolName) &&
              findToolByName(tools, canonical) !== undefined,
          ))
      let resumeOutcome: HookDeferredToolAttachment | 'unavailable' | undefined
      if (!deferredToolAvailable && !dropsUnavailableDeferredTool) {
        // #1733: Keep the deferred tool call intact when its MCP server is missing
        // (do NOT drop it via handleDeferredToolUse). Re-persist the deferred
        // attachment if a notice is set, yield is_error: true with
        // stop_reason/terminal_reason: 'tool_deferred_unavailable' and exit 1.
        logForDebugging(
          `Deferred tool resume: tool '${deferredToolUse.toolName}' is no longer available (MCP server disconnected or tool removed)`,
          { level: 'warn' },
        )
        if (keptDeferredToolNotice !== undefined && persistSession) {
          try {
            await recordTranscript([
              ...this.mutableMessages,
              {
                type: 'attachment',
                attachment: deferredToolUse,
                uuid: randomUUID(),
                timestamp: new Date().toISOString(),
              } as unknown as Message,
            ])
          } catch (err) {
            logForDebugging(
              `Deferred tool resume: not recorded: ${err instanceof Error ? err.message : String(err)}`,
              { level: 'error' },
            )
          }
        }
        resumeOutcome = 'unavailable'
      } else {
        resumeOutcome = yield* handleDeferredToolUse(
          deferredToolUse,
          tools,
          this.mutableMessages,
          wrappedCanUseTool,
          processUserInputContext,
        )
      }
      if (resumeOutcome) {
        const unavailable = resumeOutcome === 'unavailable'
        const attachment =
          resumeOutcome === 'unavailable' ? deferredToolUse : resumeOutcome
        yield {
          type: 'result',
          subtype: 'success',
          is_error: unavailable,
          duration_ms: Date.now() - startTime,
          duration_api_ms: 0,
          num_turns: this.mutableMessages.length,
          result: unavailable ? (keptDeferredToolNotice ?? '') : '',
          stop_reason: unavailable
            ? 'tool_deferred_unavailable'
            : 'tool_deferred',
          session_id: getSessionId(),
          total_cost_usd: getTotalCost(),
          usage: this.totalUsage,
          modelUsage: getModelUsage(),
          permission_denials: this.permissionDenials,
          ...(unavailable
            ? { terminal_reason: 'tool_deferred_unavailable' }
            : {}),
          deferred_tool_use: {
            id: attachment.toolUseID,
            name: attachment.toolName,
            input: attachment.toolInput,
          },
          fast_mode_state: getFastModeState(
            initialMainLoopModel,
            initialAppState.fastMode,
          ),
          uuid: randomUUID(),
        } as SDKMessage
        return
      }
    }

    // densable X9t: generate uuid when Slack/hearth identity stamps need a key.
    const hearthRelay = hasHearthRelayStamps(options ?? {})
    const identityUuid = resolveQueuedMessageUuid(
      options?.uuid,
      options?.verifiedSlackHumanTurn === true || hearthRelay,
    )

    using promptSubmitEntries = createPromptSubmitEntries()
    let {
      messages: messagesFromUserInput,
      shouldQuery,
      allowedTools,
      disallowedTools,
      model: modelFromUserInput,
      resultText,
    } = await processUserInput({
      input: prompt,
      mode: 'prompt',
      setToolJSX: () => {},
      context: {
        ...processUserInputContext,
        messages: this.mutableMessages,
      },
      messages: this.mutableMessages,
      uuid: identityUuid,
      isMeta: options?.isMeta,
      // densable 2.1.221: headless cron fire stamps thread through ask → submitMessage
      skipSlashCommands: options?.skipSlashCommands,
      skipAttachments: options?.skipAttachments
        ? options.shouldQuery === false
          ? 'all'
          : 'mentions'
        : undefined,
      skipSubmissionHooks: options?.skipSubmissionHooks,
      bridgeOrigin: options?.bridgeOrigin,
      modelScheduledOrigin: options?.modelScheduledOrigin,
      wakeupSource: options?.wakeupSource,
      origin: options?.origin,
      suppressWorkflowKeyword: options?.suppressWorkflowKeyword,
      shouldQuery: options?.shouldQuery,
      queryHeldForNextTurn: options?.queryHeldForNextTurn,
      querySource: 'sdk',
      localStdinOrigin: options?.localStdinOrigin,
      sessionChannelPersonTyped: options?.sessionChannelPersonTyped,
      hostInitiator: options?.hostInitiator,
      artifactCommentTurn: options?.artifactCommentTurn,
      verifiedSlackHumanTurn: options?.verifiedSlackHumanTurn,
      inlinedImagePaths: options?.inlinedImagePaths,
      stampThreadState: options?.stampThreadState,
      pollEventDelivery: options?.pollEventDelivery,
      pollEventProvenance: options?.pollEventProvenance,
      pollEventDeclared: options?.pollEventDeclared,
      aheadOfSessionStart: this.config.orphanedPermission !== undefined,
      entries: promptSubmitEntries,
      taskDelivery: options?.taskDelivery,
    })

    // densable: coalesce/hold may force shouldQuery:false even when
    // processUserInput would default plain-text notifications to true.
    if (options?.shouldQuery === false) {
      shouldQuery = false
    }

    // densable cun after Art: skip human-like (jy); fill origin only when unset.
    // Fws on !isMeta users so scheduled-task RZn still lands on the prompt.
    if (options?.origin) {
      stampQueueOriginOnUserMessages(messagesFromUserInput, options.origin)
      if (!isHumanLikeOrigin(options.origin)) {
        for (const m of messagesFromUserInput) {
          if (m.type === 'user' && !m.isMeta) {
            applyTurnStartOriginFraming(
              m,
              options.origin as {
                kind?: string
                from?: string
                trigger?: string
              },
            )
          }
        }
      }
    }

    // densable dun: Me.skipAttachments===true stamps queueSkipAttachments.
    if (options?.skipAttachments === true) {
      stampQueueSkipAttachments(messagesFromUserInput)
    }

    // densable Y9t / $8o after Art — rrr Object.assign onto the matching uuid.
    if (options?.verifiedSlackHumanTurn && identityUuid) {
      stampVerifiedSlackHumanTurn(messagesFromUserInput, identityUuid, {
        projectsUserTurn: options.projectsUserTurn === true,
      })
    }
    if (hearthRelay && identityUuid) {
      stampHearthRelay(messagesFromUserInput, identityUuid, {
        messageIds: options?.hearthRelayMessageIds,
        rows: options?.hearthRelayRows,
        threadTs: options?.hearthRelayThreadTs,
      })
    }
    promptSubmitEntries.handedOff()

    // Push new messages, including user input and any attachments
    this.mutableMessages.push(...messagesFromUserInput)

    // Update params to reflect updates from processing /slash commands
    const messages = [...this.mutableMessages]

    // Persist the user's message(s) to transcript BEFORE entering the query
    // loop. The for-await below only calls recordTranscript when ask() yields
    // an assistant/user/compact_boundary message — which doesn't happen until
    // the API responds. If the process is killed before that (e.g. user clicks
    // Stop in cowork seconds after send), the transcript is left with only
    // queue-operation entries; getLastSessionLog filters those out, returns
    // null, and --resume fails with "No conversation found". Writing now makes
    // the transcript resumable from the point the user message was accepted,
    // even if no API response ever arrives.
    //
    // --bare / SIMPLE: fire-and-forget. Scripted calls don't --resume after
    // kill-mid-request. The await is ~4ms on SSD, ~30ms under disk contention
    // — the single largest controllable critical-path cost after module eval.
    // Transcript is still written (for post-hoc debugging); just not blocking.
    if (persistSession && messagesFromUserInput.length > 0) {
      const transcriptPromise = recordTranscript(messages)
      if (isBareMode()) {
        void transcriptPromise
      } else {
        await transcriptPromise
        await flushSessionStorage()
      }
    }

    // Filter messages that should be acknowledged after transcript
    const _selector = messageSelector()
    const replayableMessages = messagesFromUserInput.filter(
      msg =>
        (msg.type === 'user' &&
          !msg.isMeta && // Skip synthetic caveat messages
          !msg.toolUseResult && // Skip tool results (they'll be acked from query)
          (_selector?.selectableUserMessagesFilter(msg) ?? true)) || // Skip non-user-authored messages (task notifications, etc.)
        (msg.type === 'system' && msg.subtype === 'compact_boundary'), // Always ack compact boundaries
    )
    const messagesToAck = replayUserMessages ? replayableMessages : []

    // Update the ToolPermissionContext based on user input processing (as necessary)
    // densable 2.1.229 xai — disallowedTools → alwaysDenyRules.command:
    // union only when length>0; empty does NOT clear (sticky session harden).
    // Contrast alwaysAllowRules.command which is replaced each turn.
    setAppState(prev => {
      const denyExtra =
        options?.skipSkillPermissionReset === true
          ? []
          : (disallowedTools ?? [])
      const curDeny = prev.toolPermissionContext.alwaysDenyRules.command ?? []
      const nextDeny =
        denyExtra.length === 0
          ? curDeny
          : Array.from(new Set([...curDeny, ...denyExtra]))
      const cleared = clearCommandScopedAllowRules(prev.toolPermissionContext)
      return {
        ...prev,
        toolPermissionContext: applyPluginToolListDenyRules({
          ...cleared,
          alwaysAllowRules: {
            ...cleared.alwaysAllowRules,
            command: allowedTools,
          },
          alwaysDenyRules: {
            ...cleared.alwaysDenyRules,
            command: nextDeny.length > 0 ? nextDeny : undefined,
          },
          pollEventDeliveryGuard: undefined,
        }),
      }
    })

    const mainLoopModel = modelFromUserInput ?? initialMainLoopModel

    // densable after-Art refreshTools:Wi — rebuild system prompt when the
    // live tool-name list identity changes (Km analog).
    const toolsBeforeRefresh = tools
    try {
      const refreshed = applyPluginToolListFilter(refreshTools?.() ?? tools)
      tools =
        refreshed.length === tools.length &&
        refreshed.every((tool, index) => tool.name === tools[index]?.name)
          ? tools
          : refreshed
      mcpClients = refreshMcpClients?.() ?? mcpClients
    } catch (err) {
      logError(err)
    }
    if (tools !== toolsBeforeRefresh) {
      try {
        const {
          defaultSystemPrompt: rebuiltDefault,
          userContext: rebuiltBase,
          systemContext: rebuiltSystem,
        } = await fetchSystemPromptParts({
          tools,
          mainLoopModel: initialMainLoopModel,
          additionalWorkingDirectories: Array.from(
            initialAppState.toolPermissionContext.additionalWorkingDirectories.keys(),
          ),
          mcpClients,
          customSystemPrompt: customPrompt,
        })
        systemPrompt = asSystemPrompt([
          ...(customPrompt !== undefined ? [customPrompt] : rebuiltDefault),
          ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
          ...(chromeResolvedAppend ? [chromeResolvedAppend] : []),
        ])
        userContext = {
          ...rebuiltBase,
          ...getCoordinatorUserContext(
            mcpClients,
            isScratchpadEnabled() ? getScratchpadDir() : undefined,
            tools,
          ),
        }
        systemContext = rebuiltSystem
      } catch (err) {
        logError(err)
      }
    }

    // Recreate after processing the prompt to pick up updated messages and
    // model (from slash commands).
    processUserInputContext = createSessionToolUseContext({
      messages,
      setMessages: () => {},
      handleElicitation: this.config.handleElicitation,
      requestDialog: this.config.requestDialog,
      commands,
      debug: false,
      tools,
      verbose,
      mainLoopModel,
      thinkingConfig: initialThinkingConfig,
      mcpClients,
      mcpResources: {},
      ideInstallationStatus: null,
      isNonInteractiveSession: true,
      customSystemPrompt,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      theme: resolveThemeSetting(getThemeSetting()),
      baseAgentDefinitions: { activeAgents: agents, allAgents: [] },
      maxBudgetUsd,
      // densable 2.1.219 #6
      forwardSubagentText,
      toolAliases,
      messageClientPlatform: options?.clientPlatform,
      getAppState,
      taskRegistry: this.taskRegistry,
      setAppState,
      abortController: this.abortController,
      readFileState: this.readFileState,
      toolState: this.sessionToolState,
      credentials: headlessCredentials(this.config.credentials),
      loadedNestedMemoryPaths: this.loadedNestedMemoryPaths,
      pendingNestedMemoryTriggers: this.pendingNestedMemoryTriggers,
      discoveredSkillNames: this.discoveredSkillNames,
      setInProgressToolUseIDs: createSetInProgressToolUseIDs(this.taskRegistry),
      setRetryStatus: leftoverIhrSdkRetry,
      setStreamMode: leftoverIhrSdkMode,
      setSDKStatus,
    })
    if (promptProvenance) {
      processUserInputContext.promptProvenance = promptProvenance
    }

    headlessProfilerCheckpoint('before_skills_plugins')
    // Cache-only: headless/SDK/CCR startup must not block on network for
    // ref-tracked plugins. CCR populates the cache via CLAUDE_CODE_SYNC_PLUGIN_INSTALL
    // (headlessPluginInstall) or CLAUDE_CODE_PLUGIN_SEED_DIR before this runs;
    // SDK callers that need fresh source can call /reload-plugins.
    const [skills, pluginLoad] = await Promise.all([
      getSlashCommandToolSkills(getCwd()),
      loadAllPluginsCacheOnly(),
    ])
    headlessProfilerCheckpoint('after_skills_plugins')
    const { enabled: enabledPlugins, errors: pluginLoadErrors } = pluginLoad

    yield buildSystemInitMessage({
      tools,
      mcpClients,
      model: mainLoopModel,
      permissionMode: initialAppState.toolPermissionContext
        .mode as PermissionMode, // TODO: avoid the cast
      commands,
      agents,
      skills,
      plugins: enabledPlugins,
      fastMode: initialAppState.fastMode,
      // densable 2.1.219 #4 — yEm() soft-skip store → mcp_server_errors
      mcpServerErrors: getMcpConfigServerErrors(),
      // Official 2.1.323 #2043 — selectInitPluginErrors with policyEnabledPluginIds + persisted redaction
      rawPluginErrors: pluginLoadErrors,
      isPersistedTransport: this.config.isPersistedTransport,
    })

    // Record when system message is yielded for headless latency tracking
    headlessProfilerCheckpoint('system_message_yielded')

    if (!shouldQuery) {
      let localCommandFallbackText: string | undefined
      let localCommandFailed = false
      // Return the results of local slash commands.
      // Use messagesFromUserInput (not replayableMessages) for command output
      // because selectableUserMessagesFilter excludes local-command-stdout tags.
      for (const msg of messagesFromUserInput) {
        if (
          msg.type === 'user' &&
          typeof msg.message!.content === 'string' &&
          (msg.message!.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`) ||
            msg.message!.content.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`) ||
            msg.isCompactSummary)
        ) {
          const stripped = stripAnsi(msg.message!.content)
          if (msg.message!.content.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`)) {
            localCommandFailed = true
            localCommandFallbackText ??= stripped
              .replace(
                new RegExp(
                  `<${LOCAL_COMMAND_STDERR_TAG}>([\\s\\S]*?)</${LOCAL_COMMAND_STDERR_TAG}>`,
                ),
                '$1',
              )
              .trim()
          } else if (
            msg.message!.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`)
          ) {
            localCommandFallbackText ??= stripped
              .replace(
                new RegExp(
                  `<${LOCAL_COMMAND_STDOUT_TAG}>([\\s\\S]*?)</${LOCAL_COMMAND_STDOUT_TAG}>`,
                ),
                '$1',
              )
              .trim()
          }
          yield {
            type: 'user',
            message: {
              ...msg.message,
              content: stripped,
            },
            session_id: getSessionId(),
            parent_tool_use_id: null,
            uuid: msg.uuid,
            timestamp: msg.timestamp,
            isReplay: !msg.isCompactSummary,
            isSynthetic: msg.isMeta || msg.isVisibleInTranscriptOnly,
          } as unknown as SDKUserMessageReplay
        }

        // Local command output — yield as a synthetic assistant message so
        // RC renders it as assistant-style text rather than a user bubble.
        // Emitted as assistant (not the dedicated SDKLocalCommandOutputMessage
        // system subtype) so mobile clients + session-ingress can parse it.
        if (
          msg.type === 'system' &&
          msg.subtype === 'local_command' &&
          typeof msg.content === 'string' &&
          (msg.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`) ||
            msg.content.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`))
        ) {
          if (msg.content.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`)) {
            localCommandFailed = true
          }
          const assistantMsg = localCommandOutputToSDKAssistantMessage(
            msg.content,
            msg.uuid,
          )
          const firstBlock = assistantMsg.message?.content?.[0]
          if (
            firstBlock &&
            typeof firstBlock === 'object' &&
            'text' in firstBlock &&
            typeof firstBlock.text === 'string' &&
            firstBlock.text
          ) {
            localCommandFallbackText ??= firstBlock.text
          }
          yield assistantMsg
        }

        if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
          const compactMsg = msg as SystemCompactBoundaryMessage
          // densable 2.1.218 #23: emit logical_parent_uuid for headless/SDK fork lineage
          const logicalParentUuid = (
            compactMsg as { logicalParentUuid?: string }
          ).logicalParentUuid
          yield {
            type: 'system',
            subtype: 'compact_boundary' as const,
            session_id: getSessionId(),
            uuid: msg.uuid,
            compact_metadata: toSDKCompactMetadata(compactMsg.compactMetadata),
            ...(logicalParentUuid !== undefined && {
              logical_parent_uuid: logicalParentUuid,
            }),
          } as unknown as SDKCompactBoundaryMessage
        }
      }

      if (persistSession) {
        await recordTranscript(messages)
        await flushSessionStorage()
      }

      yield {
        type: 'result',
        subtype: 'success',
        is_error: localCommandFailed,
        duration_ms: Date.now() - startTime,
        duration_api_ms: getTotalAPIDuration(),
        num_turns: 0,
        result: resultText || localCommandFallbackText || '',
        stop_reason: null,
        session_id: getSessionId(),
        total_cost_usd: getTotalCost(),
        usage: this.totalUsage,
        modelUsage: getModelUsage(),
        permission_denials: this.permissionDenials,
        fast_mode_state: getFastModeState(
          mainLoopModel,
          initialAppState.fastMode,
        ),
        uuid: randomUUID(),
      }
      return
    }

    if (fileHistoryEnabled() && persistSession) {
      const _sel = messageSelector()
      const _filter =
        _sel?.selectableUserMessagesFilter ?? ((_msg: unknown) => true)
      messagesFromUserInput.filter(_filter).forEach(message => {
        void fileHistoryMakeSnapshot(
          (updater: (prev: FileHistoryState) => FileHistoryState) => {
            setAppState(prev => ({
              ...prev,
              fileHistory: updater(prev.fileHistory),
            }))
          },
          message.uuid,
        )
      })
    }

    // Track current message usage (reset on each message_start)
    let currentMessageUsage: NonNullableUsage = EMPTY_USAGE
    // Official 2.1: cumulative thinking_delta.estimated_tokens per message
    let thinkingTokenEstimate = 0
    let turnCount = 1
    // densable Yo — per-ask turn id for Tth MessageDisplay hooks
    const messageDisplayTurnId = randomUUID()
    let hasAcknowledgedInitialMessages = false
    // Track structured output from StructuredOutput tool calls
    let structuredOutputFromTool: unknown
    // Track the last stop_reason from assistant messages
    let lastStopReason: string | null = null
    // Reference-based watermark so error_during_execution's errors[] is
    // turn-scoped. A length-based index breaks when the 100-entry ring buffer
    // shift()s during the turn — the index slides. If this entry is rotated
    // out, lastIndexOf returns -1 and we include everything (safe fallback).
    const errorLogWatermark = getInMemoryErrors().at(-1)
    // Snapshot count before this query for delta-based retry limiting
    const initialStructuredOutputCalls = jsonSchema
      ? countToolCalls(this.mutableMessages, SYNTHETIC_OUTPUT_TOOL_NAME)
      : 0
    // Gold Qt / ln / Dr — track surviving vs tombstoned StructuredOutput calls
    const survivingStructuredOutputs: Array<{
      toolUseID?: string
      attachmentUuid: string
    }> = []
    let tombstonedStructuredOutputCalls = 0
    const tombstonedStructuredOutputIDs = new Set<string>()
    const partialStreamCloser = createPartialStreamRetractionCloser(
      Boolean(includePartialMessages),
    )
    // Official ke — only this ask's hook_deferred_tool, not the whole history.
    let deferredThisTurn: HookDeferredToolAttachment | undefined
    let terminalReason: string | undefined
    let maxTurnsReached: { turnCount: number; maxTurns: number } | undefined
    // Official `HGt` (`chunk@306199530.js @74400-74800`): per-turn API error
    // metadata + retracted wire UUID tracking (`RetractedWireUuidTracker`).
    let isApiErrorLatched = false
    let apiErrorStatus: number | null = null
    let apiErrorCode: string | undefined
    let apiErrorType: string | undefined
    let apiErrorOrigin: string | undefined
    let apiErrorCategory: string | undefined
    let apiErrorText = ''
    let lastTurnAssistantText = ''
    const retractedTracker = new RetractedWireUuidTracker()

    const resetApiErrorLatch = (resetAssistantText: boolean): void => {
      if (resetAssistantText) lastTurnAssistantText = ''
      isApiErrorLatched = false
      apiErrorStatus = null
      apiErrorCode = undefined
      apiErrorType = undefined
      apiErrorOrigin = undefined
      apiErrorCategory = undefined
      apiErrorText = ''
    }

    const queryGen = query({
      messages,
      systemPrompt,
      userContext,
      systemContext,
      canUseTool: wrappedCanUseTool,
      toolUseContext: processUserInputContext,
      fallbackModel,
      querySource: 'sdk',
      maxTurns,
      taskBudget,
      promptRenderEpoch,
      modelFacts,
      stopHookActive: options?.stopHookActive,
      // Official 2.1.328 #555: rebuild dynamic systemPrompt after autocompact /
      // reactive compact the same way `/compact` does.
      renderSystemPrompt: async ctx => {
        const { defaultSystemPrompt: freshDefault } =
          await fetchSystemPromptParts({
            tools: ctx.options.tools,
            mainLoopModel: ctx.options.mainLoopModel,
            additionalWorkingDirectories: Array.from(
              ctx
                .getAppState()
                .toolPermissionContext.additionalWorkingDirectories.keys(),
            ),
            mcpClients: ctx.options.mcpClients,
            customSystemPrompt: customPrompt,
          })
        const rebuilt = asSystemPrompt([
          ...(customPrompt !== undefined ? [customPrompt] : freshDefault),
          ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
          ...(chromeResolvedAppend ? [chromeResolvedAppend] : []),
        ])
        return {
          systemPrompt: rebuilt,
          promptRenderEpoch: getPromptRenderEpoch(),
        }
      },
    })
    try {
      while (true) {
        const step = await queryGen.next()
        if (step.done) {
          terminalReason = step.value?.reason
          break
        }
        const message = step.value
        // densable CLI host / SDK: set_expanded_view is a tool-bridge control
        // event, not a transcript message. Skip it here (HWf also drops it).
        if (
          message &&
          typeof message === 'object' &&
          'type' in message &&
          (message as { type: string }).type === 'set_expanded_view'
        ) {
          continue
        }
        if (
          message &&
          typeof message === 'object' &&
          'type' in message &&
          (message as { type: string }).type === 'spinner_mode'
        ) {
          leftoverIhrSdkMode(
            (
              message as unknown as {
                mode: import('./components/Spinner/index.js').SpinnerMode
              }
            ).mode,
          )
          continue
        }
        // Record assistant, user, and compact boundary messages
        if (
          message.type === 'assistant' ||
          message.type === 'user' ||
          (message.type === 'system' && message.subtype === 'compact_boundary')
        ) {
          // Before writing a compact boundary, flush any in-memory-only
          // messages up through the preservedSegment tail. Attachments and
          // progress are now recorded inline (their switch cases below), but
          // this flush still matters for the preservedSegment tail walk.
          // If the SDK subprocess restarts before then (claude-desktop kills
          // between turns), tailUuid points to a never-written message →
          // applyPreservedSegmentRelinks fails its tail→head walk → returns
          // without pruning → resume loads full pre-compact history.
          if (
            persistSession &&
            message.type === 'system' &&
            message.subtype === 'compact_boundary'
          ) {
            const compactMsg = message as SystemCompactBoundaryMessage
            const tailUuid =
              compactMsg.compactMetadata?.preservedSegment?.tailUuid
            if (tailUuid) {
              const tailIdx = this.mutableMessages.findLastIndex(
                m => m.uuid === tailUuid,
              )
              if (tailIdx !== -1) {
                await recordTranscript(
                  this.mutableMessages.slice(0, tailIdx + 1),
                )
              }
            }
          }
          messages.push(message as Message)
          if (persistSession) {
            // Fire-and-forget for assistant messages. claude.ts yields one
            // assistant message per content block, then mutates the last
            // one's message.usage/stop_reason on message_delta — relying on
            // the write queue's 100ms lazy jsonStringify. Awaiting here
            // blocks ask()'s generator, so message_delta can't run until
            // every block is consumed; the drain timer (started at block 1)
            // elapses first. Interactive CC doesn't hit this because
            // useLogMessages.ts fire-and-forgets. enqueueWrite is
            // order-preserving so fire-and-forget here is safe.
            if (message.type === 'assistant') {
              void recordTranscript(messages)
            } else {
              await recordTranscript(messages)
            }
          }

          // Acknowledge initial user messages after first transcript recording
          if (!hasAcknowledgedInitialMessages && messagesToAck.length > 0) {
            hasAcknowledgedInitialMessages = true
            for (const msgToAck of messagesToAck) {
              if (msgToAck.type === 'user') {
                yield {
                  type: 'user',
                  message: msgToAck.message,
                  session_id: getSessionId(),
                  parent_tool_use_id: null,
                  uuid: msgToAck.uuid,
                  timestamp: msgToAck.timestamp,
                  isReplay: true,
                  ...(options?.fileAttachments?.length
                    ? { file_attachments: options.fileAttachments }
                    : {}),
                } as unknown as SDKUserMessageReplay
              }
            }
          }
        }

        if (message.type === 'user') {
          turnCount++
        }

        switch (message.type) {
          case 'tombstone': {
            const tombstonePayload = message as unknown as {
              message?: Message
              displayOnly?: boolean
            }
            for (const ev of partialStreamCloser.onTombstone(
              tombstonePayload,
            )) {
              yield ev as unknown as SDKMessage
            }
            const tombstonedMsg = tombstonePayload.message
            // v2.1.311 (#1231) & v2.1.314 (#1374): remove tombstoned/retracted
            // messages from in-memory conversation and persisted transcript.
            if (!tombstonePayload.displayOnly && tombstonedMsg?.uuid) {
              const targetUuid = tombstonedMsg.uuid
              retractedTracker.add([{ uuid: targetUuid }])
              for (let i = this.mutableMessages.length - 1; i >= 0; i--) {
                if (this.mutableMessages[i]?.uuid === targetUuid) {
                  this.mutableMessages.splice(i, 1)
                }
              }
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i]?.uuid === targetUuid) {
                  messages.splice(i, 1)
                }
              }
              if (persistSession) {
                await removeTranscriptMessage(targetUuid)
              }
            }
            resetApiErrorLatch(true)
            if (
              tombstonedMsg?.type === 'assistant' &&
              Array.isArray(tombstonedMsg.message?.content)
            ) {
              const retractedIds = tombstonedMsg.message.content.flatMap(
                block =>
                  block &&
                  typeof block === 'object' &&
                  block.type === 'tool_use' &&
                  block.name === SYNTHETIC_OUTPUT_TOOL_NAME &&
                  typeof block.id === 'string'
                    ? [block.id]
                    : [],
              )
              if (retractedIds.length > 0) {
                tombstonedStructuredOutputCalls++
                for (const id of retractedIds) {
                  tombstonedStructuredOutputIDs.add(id)
                }
                const isRetracted = (entry: {
                  toolUseID?: string
                  attachmentUuid: string
                }) =>
                  entry.toolUseID === undefined ||
                  retractedIds.includes(entry.toolUseID)
                const retractedResults =
                  survivingStructuredOutputs.filter(isRetracted)
                for (
                  let i = survivingStructuredOutputs.length - 1;
                  i >= 0;
                  i--
                ) {
                  if (isRetracted(survivingStructuredOutputs[i]!)) {
                    survivingStructuredOutputs.splice(i, 1)
                  }
                }
                if (survivingStructuredOutputs.length === 0) {
                  structuredOutputFromTool = undefined
                }
                logEvent('tengu_structured_output_retracted', {
                  retracted_results: retractedResults.length,
                  surviving_results: survivingStructuredOutputs.length,
                  tombstoned_calls: tombstonedStructuredOutputCalls,
                })
              }
            }
            break
          }
          case 'active_goal': {
            // densable worker: setAppState only (no idle-checkin cancel here).
            const value =
              (message as { value?: AppState['activeGoal'] | null }).value ??
              undefined
            setAppState(prev =>
              prev.activeGoal === value ? prev : { ...prev, activeGoal: value },
            )
            break
          }
          case 'assistant': {
            // Capture stop_reason if already set (synthetic messages). For
            // streamed responses, this is null at content_block_stop time;
            // the real value arrives via message_delta (handled below).
            const msg = message as Message
            const msgMeta = msg as Message & {
              isVirtual?: boolean
              isApiErrorMessage?: boolean
              apiErrorStatus?: number
              apiErrorCode?: string
              apiErrorType?: string
              apiErrorOrigin?: string
              apiError?: string
            }
            const stopReason = msg.message?.stop_reason as
              | string
              | null
              | undefined
            if (stopReason != null) {
              lastStopReason = stopReason
            }
            if (msgMeta.isVirtual !== true) {
              isApiErrorLatched = msgMeta.isApiErrorMessage === true
              apiErrorStatus =
                typeof msgMeta.apiErrorStatus === 'number'
                  ? msgMeta.apiErrorStatus
                  : null
              apiErrorCode =
                typeof msgMeta.apiErrorCode === 'string'
                  ? msgMeta.apiErrorCode
                  : undefined
              apiErrorType =
                typeof msgMeta.apiErrorType === 'string'
                  ? msgMeta.apiErrorType
                  : undefined
              apiErrorOrigin =
                typeof msgMeta.apiErrorOrigin === 'string'
                  ? msgMeta.apiErrorOrigin
                  : undefined
              apiErrorCategory =
                isApiErrorLatched && typeof msgMeta.apiError === 'string'
                  ? msgMeta.apiError
                  : undefined
              const lastBlock = last(
                msg.message
                  ?.content as import('@anthropic-ai/sdk/resources/beta/messages/messages.js').BetaContentBlock[],
              )
              const rawText = lastBlock?.type === 'text' ? lastBlock.text : ''
              const cleanedText = SYNTHETIC_MESSAGES.has(rawText)
                ? ''
                : stripAnsi(rawText)
              if (isApiErrorLatched) {
                apiErrorText = cleanedText
                lastTurnAssistantText = ''
              } else {
                lastTurnAssistantText = cleanedText
              }
            }
            partialStreamCloser.onAssistantMessage(msg)
            this.mutableMessages.push(msg)
            // densable Tth — SDK completed-message MessageDisplay (Ath→ilr→GCr)
            // after mutableMessages.push, yield transformed when different.
            let yieldMsg = msg
            try {
              const transformed = await transformCompletedAssistantMessage(
                msg as AssistantMessage,
                messageDisplayTurnId,
                getAppState,
                this.abortController.signal,
              )
              if (transformed !== msg) {
                yieldMsg = transformed as Message
              }
            } catch {
              // densable Tth optional on failure — emit original
            }
            const supersedes = retractedTracker.consumeForSupersedes()
            for (const normalized of normalizeMessage(yieldMsg)) {
              if (supersedes && normalized.type === 'assistant') {
                yield {
                  ...(normalized as Record<string, unknown>),
                  supersedes,
                } as unknown as SDKMessage
              } else {
                yield normalized
              }
            }
            break
          }
          case 'progress': {
            const msg = message as Message
            // Official 2.1.328 (#647): do NOT accumulate ephemeral progress
            // messages (e.g. bash_progress / tool_progress / agent_progress)
            // in `this.mutableMessages` — long SDK/desktop sessions running
            // slow commands or tools would otherwise suffer unbounded O(N)
            // memory growth and per-turn scan latency. Still yield to stream
            // consumers and persist only non-ephemeral progress if required.
            if (shouldRetainProgressInMutableMessages(msg)) {
              this.mutableMessages.push(msg)
              if (persistSession) {
                messages.push(msg)
                await recordTranscript(messages)
              }
            }
            yield* normalizeMessage(msg)
            break
          }
          case 'user': {
            const msg = message as Message & {
              retractedWireUuids?: readonly string[]
              retractedMessageUuids?: readonly string[]
            }
            resetApiErrorLatch(msg.isCompactSummary !== true)
            this.mutableMessages.push(msg)
            const retractedFields = buildRetractedWireFields({
              retractedWireUuids:
                msg.retractedWireUuids ?? msg.retractedMessageUuids,
            })
            if (retractedFields.retracted_message_uuids?.length) {
              retractedTracker.add(
                retractedFields.retracted_message_uuids.map(uuid => ({ uuid })),
              )
            }
            for (const normalized of normalizeMessage(msg)) {
              if (
                retractedFields.retracted_message_uuids &&
                normalized.type === 'user'
              ) {
                yield {
                  ...(normalized as Record<string, unknown>),
                  ...retractedFields,
                } as unknown as SDKMessage
              } else {
                yield normalized
              }
            }
            break
          }
          case 'stream_event': {
            const streamMsg = message as unknown as {
              event: Record<string, unknown>
              ttftMs?: number
              thinkingDisplay?: unknown
              apiMessageId?: string
              abandonedBlocks?: { apiMessageId: string; fromBlockIndex: number }
              textRunsJoined?: boolean
            }
            const event = streamMsg.event
            for (const ev of partialStreamCloser.onStreamEvent(
              event,
              currentMessageUsage,
            )) {
              yield ev as unknown as SDKMessage
            }
            if (event.type === 'message_start') {
              // Reset current message usage for new message
              currentMessageUsage = EMPTY_USAGE
              // Official 2.1: per-message thinking estimate accumulator
              thinkingTokenEstimate = 0
              const eventMessage = event.message as {
                usage: BetaMessageDeltaUsage
              }
              currentMessageUsage = updateUsage(
                currentMessageUsage,
                eventMessage.usage,
              )
            }
            if (event.type === 'message_delta') {
              currentMessageUsage = updateUsage(
                currentMessageUsage,
                event.usage as BetaMessageDeltaUsage,
              )
              // Capture stop_reason from message_delta. The assistant message
              // is yielded at content_block_stop with stop_reason=null; the
              // real value only arrives here (see claude.ts message_delta
              // handler). Without this, result.stop_reason is always null.
              const delta = event.delta as { stop_reason?: string | null }
              if (delta.stop_reason != null) {
                lastStopReason = delta.stop_reason
              }
            }
            if (event.type === 'message_stop') {
              // Accumulate current message usage into total
              this.totalUsage = accumulateUsage(
                this.totalUsage,
                currentMessageUsage,
              )
            }
            // Official 2.1.x: digest thinking_delta.estimated_tokens into
            // system/thinking_tokens for Host (redacted-thinking often has no
            // text deltas). Yield on the main stream (not gated by
            // includePartialMessages) — same shape as official query loop.
            if (event.type === 'content_block_delta') {
              const delta = event.delta as {
                type?: string
                estimated_tokens?: unknown
              }
              if (
                delta?.type === 'thinking_delta' &&
                typeof delta.estimated_tokens === 'number'
              ) {
                thinkingTokenEstimate += delta.estimated_tokens
                yield {
                  type: 'system' as const,
                  subtype: 'thinking_tokens' as const,
                  estimated_tokens: thinkingTokenEstimate,
                  estimated_tokens_delta: delta.estimated_tokens,
                  session_id: getSessionId(),
                  uuid: randomUUID(),
                }
              }
            }

            if (includePartialMessages) {
              yield buildStreamEventOut(streamMsg, {
                session_id: getSessionId(),
                uuid: randomUUID(),
              }) as unknown as SDKMessage
            }

            break
          }
          case 'attachment': {
            const msg = message as Message
            this.mutableMessages.push(msg)
            // Record inline (same reason as progress above).
            if (persistSession) {
              messages.push(msg)
              await recordTranscript(messages)
            }

            const attachment = msg.attachment as {
              type: string
              data?: unknown
              turnCount?: number
              maxTurns?: number
              prompt?: string
              source_uuid?: string
              [key: string]: unknown
            }

            if (attachment.type === 'hook_deferred_tool') {
              deferredThisTurn =
                msg.attachment as unknown as HookDeferredToolAttachment
            }

            // Extract structured output from StructuredOutput tool calls
            if (attachment.type === 'structured_output') {
              const toolUseID = attachment.toolUseID as string | undefined
              if (
                toolUseID !== undefined
                  ? tombstonedStructuredOutputIDs.has(toolUseID)
                  : tombstonedStructuredOutputIDs.size > 0
              ) {
                logEvent('tengu_structured_output_late_retraction_drop', {})
              } else {
                survivingStructuredOutputs.push({
                  toolUseID,
                  attachmentUuid: msg.uuid,
                })
                structuredOutputFromTool = attachment.data
              }
            }
            // Handle max turns reached signal from query.ts.
            // Official 2.1.328 (`chunk@306199530.js @74850, @83900`): record
            // maxTurnsReached and let control flow through closeAtTurnEnd +
            // recordTranscript before yielding `error_max_turns`.
            else if (attachment.type === 'max_turns_reached') {
              maxTurnsReached = {
                turnCount: attachment.turnCount as number,
                maxTurns: attachment.maxTurns as number,
              }
            }
            // Yield queued_command attachments as SDK user message replays
            else if (
              replayUserMessages &&
              attachment.type === 'queued_command'
            ) {
              yield {
                type: 'user',
                message: {
                  role: 'user' as const,
                  content: attachment.prompt,
                },
                session_id: getSessionId(),
                parent_tool_use_id: null,
                uuid: attachment.source_uuid || msg.uuid,
                timestamp: msg.timestamp,
                isReplay: true,
              } as unknown as SDKUserMessageReplay
            }
            break
          }
          case 'stream_request_start': {
            // densable Hze/Qe: map to system/status/requesting. Fi acks even
            // when Py withholds the SDK yield (includePartialMessages).
            if (
              replayRequestingStatus &&
              !hasAcknowledgedInitialMessages &&
              messagesToAck.length > 0
            ) {
              hasAcknowledgedInitialMessages = true
              for (const msgToAck of messagesToAck) {
                if (msgToAck.type === 'user') {
                  yield {
                    type: 'user',
                    message: msgToAck.message,
                    session_id: getSessionId(),
                    parent_tool_use_id: null,
                    uuid: msgToAck.uuid,
                    timestamp: msgToAck.timestamp,
                    isReplay: true,
                    ...(options?.fileAttachments?.length
                      ? { file_attachments: options.fileAttachments }
                      : {}),
                  } as unknown as SDKUserMessageReplay
                }
              }
            }
            if (includePartialMessages) {
              yield {
                type: 'system',
                subtype: 'status',
                status: 'requesting',
                session_id: getSessionId(),
                uuid: randomUUID(),
              }
            }
            break
          }
          case 'system': {
            const msg = message as Message
            // Snip boundary: replay on our store to remove zombie messages and
            // stale markers. The yielded boundary is a signal, not data to push —
            // the replay produces its own equivalent boundary. Without this,
            // markers persist and re-trigger on every turn, and mutableMessages
            // never shrinks (memory leak in long SDK sessions). The subtype
            // check lives inside the injected callback so feature-gated strings
            // stay out of this file (excluded-strings check).
            const snipResult = this.config.snipReplay?.(
              msg,
              this.mutableMessages,
            )
            if (snipResult !== undefined) {
              if (snipResult.executed) {
                this.mutableMessages.length = 0
                this.mutableMessages.push(...snipResult.messages)
              }
              break
            }
            this.mutableMessages.push(msg)
            // Yield compact boundary messages to SDK
            if (msg.subtype === 'compact_boundary' && msg.compactMetadata) {
              const compactMsg = msg as SystemCompactBoundaryMessage
              // Release pre-compaction messages for GC. The boundary was just
              // pushed so it's the last element. query.ts already uses
              // getMessagesAfterCompactBoundary() internally, so only
              // post-boundary messages are needed going forward.
              const mutableBoundaryIdx = this.mutableMessages.length - 1
              if (mutableBoundaryIdx > 0) {
                this.mutableMessages.splice(0, mutableBoundaryIdx)
              }
              const localBoundaryIdx = messages.length - 1
              if (localBoundaryIdx > 0) {
                messages.splice(0, localBoundaryIdx)
              }

              // densable 2.1.218 #23: emit logical_parent_uuid on mid-turn compact_boundary
              const logicalParentUuid = (
                compactMsg as { logicalParentUuid?: string }
              ).logicalParentUuid
              yield {
                type: 'system',
                subtype: 'compact_boundary' as const,
                session_id: getSessionId(),
                uuid: msg.uuid,
                compact_metadata: toSDKCompactMetadata(
                  compactMsg.compactMetadata,
                ),
                ...(logicalParentUuid !== undefined && {
                  logical_parent_uuid: logicalParentUuid,
                }),
              }
            }
            // densable Fi: includePartialMessages + replayAcksAtRequestDispatch
            // also acks on system/status/requesting (CCR request-dispatch).
            const requestingStatus = msg as {
              subtype?: string
              status?: string
            }
            if (
              replayRequestingStatus &&
              !hasAcknowledgedInitialMessages &&
              messagesToAck.length > 0 &&
              requestingStatus.subtype === 'status' &&
              requestingStatus.status === 'requesting'
            ) {
              hasAcknowledgedInitialMessages = true
              for (const msgToAck of messagesToAck) {
                if (msgToAck.type === 'user') {
                  yield {
                    type: 'user',
                    message: msgToAck.message,
                    session_id: getSessionId(),
                    parent_tool_use_id: null,
                    uuid: msgToAck.uuid,
                    timestamp: msgToAck.timestamp,
                    isReplay: true,
                    ...(options?.fileAttachments?.length
                      ? { file_attachments: options.fileAttachments }
                      : {}),
                  } as unknown as SDKUserMessageReplay
                }
              }
            }
            if (msg.subtype === 'api_error') {
              const apiErrorMsg = msg as Message & {
                retryAttempt: number
                maxRetries: number
                retryInMs: number
                error: APIError
              }
              yield {
                type: 'system',
                subtype: 'api_retry' as const,
                attempt: apiErrorMsg.retryAttempt,
                max_retries: apiErrorMsg.maxRetries,
                retry_delay_ms: apiErrorMsg.retryInMs,
                error_status: apiErrorMsg.error.status ?? null,
                error: categorizeRetryableAPIError(apiErrorMsg.error),
                session_id: getSessionId(),
                uuid: msg.uuid,
              }
            }
            // Official densable: permanent model_not_found → stream
            // system/model_fallback (snake_case Host wire). Capacity
            // overloaded stays createSystemMessage informational only.
            if (msg.subtype === 'model_fallback') {
              const fb = msg as Message & {
                subtype: 'model_fallback'
                content?: string
                trigger?: string
                originalModel?: string
                fallbackModel?: string
              }
              if (
                fb.trigger === 'model_not_found' &&
                this.config.userSpecifiedModel &&
                typeof fb.fallbackModel === 'string' &&
                fb.fallbackModel.length > 0
              ) {
                this.config.userSpecifiedModel = fb.fallbackModel
              }
              yield {
                type: 'system' as const,
                subtype: 'model_fallback' as const,
                trigger: (fb.trigger ?? 'model_not_found') as
                  | 'model_not_found'
                  | 'overloaded',
                original_model: fb.originalModel ?? '',
                fallback_model: fb.fallbackModel ?? '',
                content: fb.content ?? '',
                session_id: getSessionId(),
                uuid: msg.uuid,
              }
            }
            // Official 2.1.328 (`chunk@306199530.js @79085`): emit
            // system/model_refusal_fallback with retracted_message_uuids.
            if (msg.subtype === 'model_refusal_fallback') {
              const rf = msg as Message & {
                subtype: 'model_refusal_fallback'
                trigger?: string
                direction?: string
                scope?: string
                originalModel?: string
                fallbackModel?: string
                requestId?: string | null
                apiRefusalCategory?: string | null
                apiRefusalExplanation?: string | null
                apiRefusalCyberVerification?: unknown
                retractedMessageUuids?: readonly string[]
                retractedWireUuids?: readonly string[]
                refusedUserMessageUuid?: string | null
                content?: string
                sawCyberRefusal?: boolean
                provisional?: boolean
              }
              const retractedFields = buildRetractedWireFields({
                retractedWireUuids:
                  rf.retractedWireUuids ?? rf.retractedMessageUuids,
              })
              yield {
                type: 'system' as const,
                subtype: 'model_refusal_fallback' as const,
                trigger: rf.trigger ?? 'refusal',
                direction: rf.direction ?? 'retry',
                ...(rf.scope !== undefined ? { scope: rf.scope } : {}),
                original_model: rf.originalModel ?? '',
                fallback_model: rf.fallbackModel ?? '',
                request_id: rf.requestId ?? null,
                api_refusal_category: rf.apiRefusalCategory ?? null,
                api_refusal_explanation: rf.apiRefusalExplanation ?? null,
                ...(rf.apiRefusalCyberVerification !== undefined
                  ? {
                      api_refusal_cyber_verification:
                        rf.apiRefusalCyberVerification,
                    }
                  : {}),
                ...retractedFields,
                refused_user_message_uuid: rf.refusedUserMessageUuid ?? null,
                content: rf.content ?? '',
                ...(rf.sawCyberRefusal ? { saw_cyber_refusal: true } : {}),
                ...(rf.provisional ? { provisional: rf.provisional } : {}),
                session_id: getSessionId(),
                uuid: msg.uuid,
              } as unknown as SDKMessage
            }
            // #1734: Normalize `informational` system messages for SDK clients
            // while preserving `content` text verbatim.
            if (msg.subtype === 'informational') {
              const infoMsg = msg as Message & {
                subtype: 'informational'
                content?: unknown
                level?: string
              }
              const contentText = normalizeInformationalContent(infoMsg.content)
              yield {
                type: 'system' as const,
                subtype: 'informational' as const,
                content: contentText,
                ...(infoMsg.level !== undefined
                  ? { level: infoMsg.level }
                  : {}),
                session_id: getSessionId(),
                uuid: msg.uuid,
              } as unknown as SDKMessage
            }
            // Don't yield other system messages in headless mode
            break
          }
          case 'tool_use_summary': {
            const msg = message as Message & {
              summary: unknown
              precedingToolUseIds: unknown
            }
            // Yield tool use summary messages to SDK
            yield {
              type: 'tool_use_summary' as const,
              summary: msg.summary,
              preceding_tool_use_ids: msg.precedingToolUseIds,
              session_id: getSessionId(),
              uuid: msg.uuid,
            }
            break
          }
        }

        // Official 2.1.328 #1492: flush any pre-ask system/permission_denied
        // wire frames recorded during tool permission checks.
        if (pendingPermissionDeniedEvents.length > 0) {
          for (const deniedEv of pendingPermissionDeniedEvents.splice(0)) {
            yield deniedEv
          }
        }

        // Check if USD budget has been exceeded.
        // Official 2.1.328 (`chunk@306199530.js @81800`): gate budget checks off
        // raw `stream_event` / status-only frames, and break out of the loop so
        // `partialStreamCloser.closeAtTurnEnd` + `recordTranscript` always run!
        const msgType = (message as { type?: string }).type
        if (
          maxTurnsReached === undefined &&
          msgType !== 'stream_event' &&
          msgType !== 'sdk_status' &&
          msgType !== 'compact_progress' &&
          msgType !== 'stream_mode' &&
          msgType !== 'response_length' &&
          maxBudgetUsd !== undefined &&
          getTotalCost() >= maxBudgetUsd
        ) {
          terminalReason = 'budget_exhausted'
          break
        }

        // Check if structured output retry limit exceeded (only on user messages)
        if (message.type === 'user' && jsonSchema) {
          const currentCalls = countToolCalls(
            this.mutableMessages,
            SYNTHETIC_OUTPUT_TOOL_NAME,
          )
          const callsThisQuery = currentCalls - initialStructuredOutputCalls
          const maxRetries = parseInt(
            process.env.MAX_STRUCTURED_OUTPUT_RETRIES || '5',
            10,
          )
          if (
            callsThisQuery + tombstonedStructuredOutputCalls >= maxRetries &&
            survivingStructuredOutputs.length === 0
          ) {
            // Official 2.1.328 (`chunk@322707994.js:141200`): record transcript
            // BEFORE flushing session storage, close partial stream, and emit
            // terminal_reason + fast_mode_disabled_reason + origin.
            if (persistSession) {
              await recordTranscript(this.mutableMessages)
              await flushSessionStorage()
            }
            for (const ev of partialStreamCloser.closeAtTurnEnd(
              currentMessageUsage,
            )) {
              yield ev as unknown as SDKMessage
            }
            const fastModeState = getFastModeState(
              mainLoopModel,
              initialAppState.fastMode,
            )
            const fastModeDisabledReason =
              fastModeState === 'off'
                ? isModelFastModeRejectedForSession(mainLoopModel)
                  ? 'model_not_allowed'
                  : (getFastModeUnavailableReason() ?? undefined)
                : undefined
            yield {
              type: 'result',
              subtype: 'error_max_structured_output_retries',
              duration_ms: Date.now() - startTime,
              duration_api_ms: getTotalAPIDuration(),
              is_error: true,
              num_turns: turnCount,
              stop_reason: lastStopReason,
              terminal_reason: 'structured_output_retry_exhausted',
              session_id: getSessionId(),
              total_cost_usd: getTotalCost(),
              usage: this.totalUsage,
              modelUsage: getModelUsage(),
              permission_denials: this.permissionDenials,
              fast_mode_state: fastModeState,
              ...(fastModeDisabledReason !== undefined
                ? { fast_mode_disabled_reason: fastModeDisabledReason }
                : {}),
              ...(options?.origin !== undefined
                ? { origin: options.origin }
                : {}),
              uuid: randomUUID(),
              errors: [
                tombstonedStructuredOutputCalls > 0
                  ? `Failed to provide surviving structured output after ${maxRetries} attempts (${tombstonedStructuredOutputCalls} retracted by a model fallback)`
                  : `Failed to provide valid structured output after ${maxRetries} attempts`,
              ],
            } as SDKMessage
            return
          }
        }
      }
    } finally {
      await queryGen.return?.(undefined as never)
      releaseQueuedAfterTurn()
    }

    // Stop hooks yield progress/attachment messages AFTER the assistant
    // response (via yield* handleStopHooks in query.ts). Since #23537 pushes
    // those to `messages` inline, last(messages) can be a progress/attachment
    // instead of the assistant — which makes textResult extraction below
    // return '' and -p mode emit a blank line. Allowlist to assistant|user:
    // isResultSuccessful handles both (user with all tool_result blocks is a
    // valid successful terminal state).
    const result = messages.findLast(
      m => m.type === 'assistant' || m.type === 'user',
    )
    // Capture for the error_during_execution diagnostic — isResultSuccessful
    // is a type predicate (message is Message), so inside the false branch
    // `result` narrows to never and these accesses don't typecheck.
    const edeResultType = result?.type ?? 'undefined'
    const edeLastContentType =
      result?.type === 'assistant'
        ? (last(
            result.message!
              .content as import('@anthropic-ai/sdk/resources/beta/messages/messages.js').BetaContentBlock[],
          )?.type ?? 'none')
        : 'n/a'

    // Official 2.1.323 #2145 & 2.1.328: close any open partial stream blocks
    // BEFORE flushing transcript writes (including on max_turns_reached and
    // maxBudgetUsd) so streamed replies never drop text from the middle.
    for (const ev of partialStreamCloser.closeAtTurnEnd(currentMessageUsage)) {
      yield ev as unknown as SDKMessage
    }

    if (pendingPermissionDeniedEvents.length > 0) {
      for (const deniedEv of pendingPermissionDeniedEvents.splice(0)) {
        yield deniedEv
      }
    }

    // Flush buffered transcript writes before yielding result.
    // The desktop app kills the CLI process immediately after receiving the
    // result message, so any unflushed writes would be lost.
    if (persistSession) {
      await recordTranscript(this.mutableMessages)
      await flushSessionStorage()
    }

    const autoModeStopNotice = getAutoModeUnavailableStopNotice()
    if (autoModeStopNotice !== undefined) {
      setAutoModeUnavailableStopNotice(undefined)
      yield {
        type: 'system',
        subtype: 'informational',
        content: autoModeStopNotice,
        level: 'warning',
        session_id: getSessionId(),
        uuid: randomUUID(),
      } as unknown as SDKMessage
    }

    if (
      jsonSchema !== undefined &&
      terminalReason !== 'budget_exhausted' &&
      maxTurnsReached === undefined &&
      isResultSuccessful(result, lastStopReason) &&
      !deferredThisTurn &&
      survivingStructuredOutputs.length === 0 &&
      tombstonedStructuredOutputCalls > 0
    ) {
      logEvent('tengu_structured_output_retraction_exhausted', {
        tombstoned_calls: tombstonedStructuredOutputCalls,
        num_turns: turnCount,
      })
      yield {
        type: 'result',
        subtype: 'error_max_structured_output_retries',
        duration_ms: Date.now() - startTime,
        duration_api_ms: getTotalAPIDuration(),
        is_error: true,
        num_turns: turnCount,
        stop_reason: lastStopReason,
        terminal_reason: 'structured_output_retry_exhausted',
        session_id: getSessionId(),
        total_cost_usd: getTotalCost(),
        usage: this.totalUsage,
        modelUsage: getModelUsage(),
        permission_denials: this.permissionDenials,
        fast_mode_state: getFastModeState(
          mainLoopModel,
          initialAppState.fastMode,
        ),
        uuid: randomUUID(),
        errors: [
          'Structured output was retracted by a model fallback and no retry produced a valid result',
        ],
      }
      return
    }

    const abortReasonObj = this.abortController.signal.reason
    const abortReasonName =
      abortReasonObj instanceof DOMException &&
      abortReasonObj.name === 'AbortError'
        ? abortReasonObj.message
        : typeof abortReasonObj === 'string'
          ? abortReasonObj
          : undefined
    const stoppedByPermissionCheck =
      abortReasonName === 'permission-stop' ||
      autoModeNoVerdictStopMessage !== undefined
    const permissionStopMessage =
      autoModeNoVerdictStopMessage ??
      (abortReasonName === 'permission-stop' ? autoModeStopNotice : undefined)

    const refusalDroppedStructuredOutput =
      lastStopReason === 'refusal' && survivingStructuredOutputs.length > 0
    const deferredAtEnd = deferredThisTurn

    const verdict = resolveQueryEngineResultVerdict({
      result,
      lastStopReason,
      terminalReason,
      deferredThisTurn: deferredAtEnd !== undefined,
      maxTurnsReached,
      isApiErrorLatched,
      apiErrorStatus,
      apiErrorCode,
      apiErrorType,
      apiErrorOrigin,
      apiErrorCategory,
      apiErrorText,
      lastTurnAssistantText,
      structuredOutput: structuredOutputFromTool,
      refusalDroppedStructuredOutput,
      stoppedByPermissionCheck,
      permissionStopMessage,
    })

    const commonResultFields = {
      duration_ms: Date.now() - startTime,
      duration_api_ms: getTotalAPIDuration(),
      stop_reason: lastStopReason,
      ...(terminalReason !== undefined
        ? { terminal_reason: terminalReason }
        : {}),
      ...(stoppedByPermissionCheck
        ? { stopped_by_permission_check: true }
        : {}),
      session_id: getSessionId(),
      total_cost_usd: getTotalCost(),
      usage: this.totalUsage,
      modelUsage: getModelUsage(),
      permission_denials: this.permissionDenials,
      fast_mode_state: getFastModeState(
        mainLoopModel,
        initialAppState.fastMode,
      ),
      uuid: randomUUID(),
    }

    if (verdict.subtype === 'error_max_budget_usd') {
      yield {
        type: 'result',
        subtype: 'error_max_budget_usd',
        ...commonResultFields,
        is_error: true,
        num_turns: turnCount,
        terminal_reason: 'budget_exhausted',
        errors: [
          `Reached maximum budget ($${maxBudgetUsd}). Increase the limit with --max-budget-usd or start a new session.`,
        ],
      }
      return
    }

    if (verdict.subtype === 'error_max_turns') {
      yield {
        type: 'result',
        subtype: 'error_max_turns',
        ...commonResultFields,
        is_error: true,
        num_turns: verdict.turnCount,
        terminal_reason: terminalReason ?? 'max_turns',
        errors: [`Reached maximum number of turns (${verdict.maxTurns})`],
      }
      return
    }

    if (verdict.subtype === 'error_during_execution') {
      const edeDiagnostic = `[ede_diagnostic] result_type=${edeResultType} last_content_type=${edeLastContentType} stop_reason=${lastStopReason}`
      const errors =
        verdict.permissionStopMessage !== undefined
          ? [edeDiagnostic, verdict.permissionStopMessage]
          : (() => {
              const all = getInMemoryErrors()
              const start = errorLogWatermark
                ? all.lastIndexOf(errorLogWatermark) + 1
                : 0
              return [edeDiagnostic, ...all.slice(start).map(_ => _.error)]
            })()
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        ...commonResultFields,
        is_error: true,
        num_turns: turnCount,
        errors,
      }
      return
    }

    if (refusalDroppedStructuredOutput) {
      try {
        logEvent('tengu_structured_output_refusal_dropped', {
          api_error_latched: isApiErrorLatched,
        })
      } catch {
        // ignore telemetry errors
      }
    }

    yield {
      type: 'result',
      subtype: 'success',
      ...commonResultFields,
      is_error: verdict.isError,
      num_turns: turnCount,
      result: verdict.resultText,
      stop_reason: deferredAtEnd ? 'tool_deferred' : lastStopReason,
      api_error_status: verdict.apiErrorStatus,
      ...(verdict.apiErrorCode !== undefined
        ? { api_error_code: verdict.apiErrorCode }
        : {}),
      ...(verdict.apiErrorType !== undefined
        ? { api_error_type: verdict.apiErrorType }
        : {}),
      ...(verdict.apiErrorOrigin !== undefined
        ? { api_error_origin: verdict.apiErrorOrigin }
        : {}),
      ...(verdict.apiError !== undefined
        ? { api_error: verdict.apiError }
        : {}),
      structured_output: verdict.structuredOutput,
      ...(deferredAtEnd
        ? {
            deferred_tool_use: {
              id: deferredAtEnd.toolUseID,
              name: deferredAtEnd.toolName,
              input: deferredAtEnd.toolInput,
            },
          }
        : {}),
    }
  }

  interrupt(): void {
    this.abortController.abort()
  }

  /** Reset the abort controller so the next submitMessage() call can start
   *  with a fresh, non-aborted signal. Must be called after interrupt(). */
  resetAbortController(): void {
    this.abortController = createAbortController()
  }

  /** Expose the current abort signal for external consumers (e.g. ACP bridge). */
  getAbortSignal(): AbortSignal {
    return this.abortController.signal
  }

  getMessages(): readonly Message[] {
    return this.mutableMessages
  }

  getReadFileState(): FileStateCache {
    return this.readFileState
  }

  getSessionId(): string {
    return getSessionId()
  }

  setModel(model: string): void {
    this.config.userSpecifiedModel = model
  }
}

/**
 * Sends a single prompt to the Claude API and returns the response.
 * Assumes that claude is being used non-interactively -- will not
 * ask the user for permissions or further input.
 *
 * Convenience wrapper around QueryEngine for one-shot usage.
 */
export async function* ask({
  commands,
  prompt,
  promptUuid,
  isMeta,
  skipSlashCommands,
  skipAttachments,
  skipSubmissionHooks,
  stopHookActive,
  bridgeOrigin,
  modelScheduledOrigin,
  wakeupSource,
  origin,
  isHumanTypedPrompt,
  suppressWorkflowKeyword,
  shouldQuery,
  queryHeldForNextTurn,
  localStdinOrigin,
  sessionChannelPersonTyped,
  hostInitiator,
  artifactCommentTurn,
  verifiedSlackHumanTurn,
  projectsUserTurn,
  hearthRelayRows,
  hearthRelayThreadTs,
  hearthRelayMessageIds,
  inlinedImagePaths,
  stampThreadState,
  pollEventDelivery,
  pollEventProvenance,
  pollEventDeclared,
  skipSkillPermissionReset,
  pollEmptyDispatch,
  fileAttachments,
  frameTiming,
  clientPlatform,
  taskDelivery,
  toolState,
  taskRegistry,
  credentials,
  cwd,
  tools,
  mcpClients,
  verbose = false,
  thinkingConfig,
  maxTurns,
  maxBudgetUsd,
  taskBudget,
  canUseTool,
  mutableMessages = [],
  getReadFileCache,
  setReadFileCache,
  customSystemPrompt,
  appendSystemPrompt,
  appendSubagentSystemPrompt,
  userSpecifiedModel,
  fallbackModel,
  jsonSchema,
  getAppState,
  setAppState,
  abortController,
  replayUserMessages = false,
  includePartialMessages = false,
  replayAcksAtRequestDispatch,
  refreshTools,
  refreshMcpClients,
  forwardSubagentText = false,
  handleElicitation,
  requestDialog,
  agents = [],
  setSDKStatus,
  orphanedPermission,
  deferredToolUse,
  keptDeferredToolNotice,
  dropsUnavailableDeferredTool,
  isPersistedTransport,
}: {
  commands: Command[]
  prompt: string | Array<ContentBlockParam>
  promptUuid?: string
  isMeta?: boolean
  /** densable 2.1.221 QueuedCommand fire stamps for headless processUserInput */
  skipSlashCommands?: boolean
  skipAttachments?: boolean
  skipSubmissionHooks?: boolean
  stopHookActive?: boolean
  bridgeOrigin?: boolean
  modelScheduledOrigin?: boolean
  wakeupSource?: string
  origin?: MessageOrigin
  isHumanTypedPrompt?: boolean
  suppressWorkflowKeyword?: boolean
  /** densable 2.1.289 print task-notification coalesce */
  shouldQuery?: boolean
  queryHeldForNextTurn?: boolean
  localStdinOrigin?: boolean
  sessionChannelPersonTyped?: boolean
  hostInitiator?: unknown
  artifactCommentTurn?: unknown
  verifiedSlackHumanTurn?: boolean
  projectsUserTurn?: boolean
  hearthRelayRows?: unknown
  hearthRelayThreadTs?: unknown
  hearthRelayMessageIds?: unknown
  inlinedImagePaths?: string[]
  stampThreadState?: boolean
  pollEventDelivery?: boolean
  pollEventProvenance?: unknown[]
  pollEventDeclared?: unknown
  skipSkillPermissionReset?: boolean
  pollEmptyDispatch?: boolean
  fileAttachments?: unknown[]
  frameTiming?: { enqueuedWallMs: number }
  clientPlatform?: string
  /** densable BX `taskDelivery` — GetTask snapshot on As. */
  taskDelivery?: unknown
  /** densable `wN` shared across print's per-command engines. */
  toolState?: ToolStateSlots
  taskRegistry?: TaskRegistry
  credentials?: ToolUseContext['credentials']
  cwd: string
  tools: Tools
  verbose?: boolean
  mcpClients: MCPServerConnection[]
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  canUseTool: CanUseToolFn
  mutableMessages?: Message[]
  customSystemPrompt?: string
  appendSystemPrompt?: string
  appendSubagentSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  jsonSchema?: Record<string, unknown>
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getReadFileCache: () => FileStateCache
  setReadFileCache: (cache: FileStateCache) => void
  abortController?: AbortController
  replayUserMessages?: boolean
  includePartialMessages?: boolean
  replayAcksAtRequestDispatch?: () => boolean
  refreshTools?: () => Tools
  refreshMcpClients?: () => MCPServerConnection[]
  forwardSubagentText?: boolean
  handleElicitation?: ToolUseContext['handleElicitation']
  requestDialog?: ToolUseContext['requestDialog']
  agents?: AgentDefinition[]
  setSDKStatus?: (status: SDKStatus) => void
  orphanedPermission?: OrphanedPermission
  deferredToolUse?: HookDeferredToolAttachment
  keptDeferredToolNotice?: string
  dropsUnavailableDeferredTool?: boolean
  isPersistedTransport?: boolean
}): AsyncGenerator<SDKMessage, void, unknown> {
  const engine = new QueryEngine({
    cwd,
    tools,
    commands,
    mcpClients,
    agents: agents ?? [],
    canUseTool,
    getAppState,
    setAppState,
    initialMessages: mutableMessages,
    readFileCache: cloneFileStateCache(getReadFileCache()),
    customSystemPrompt,
    appendSystemPrompt,
    appendSubagentSystemPrompt,
    userSpecifiedModel,
    fallbackModel,
    thinkingConfig,
    maxTurns,
    maxBudgetUsd,
    taskBudget,
    jsonSchema,
    verbose,
    handleElicitation,
    requestDialog,
    replayUserMessages,
    includePartialMessages,
    replayAcksAtRequestDispatch,
    refreshTools,
    refreshMcpClients,
    forwardSubagentText,
    setSDKStatus,
    abortController,
    orphanedPermission,
    deferredToolUse,
    keptDeferredToolNotice,
    dropsUnavailableDeferredTool,
    isPersistedTransport,
    toolState,
    taskRegistry,
    credentials,
    ...(feature('HISTORY_SNIP')
      ? {
          snipReplay: (yielded: Message, store: Message[]) => {
            if (!snipProjection!.isSnipBoundaryMessage(yielded))
              return undefined
            return snipModule!.snipCompactIfNeeded(store, { force: true })
          },
        }
      : {}),
  })

  try {
    yield* engine.submitMessage(prompt, {
      uuid: promptUuid,
      isMeta,
      skipSlashCommands,
      skipAttachments,
      skipSubmissionHooks,
      stopHookActive,
      bridgeOrigin,
      modelScheduledOrigin,
      wakeupSource,
      origin,
      isHumanTypedPrompt,
      suppressWorkflowKeyword,
      shouldQuery,
      queryHeldForNextTurn,
      localStdinOrigin,
      sessionChannelPersonTyped,
      hostInitiator,
      artifactCommentTurn,
      verifiedSlackHumanTurn,
      projectsUserTurn,
      hearthRelayRows,
      hearthRelayThreadTs,
      hearthRelayMessageIds,
      inlinedImagePaths,
      stampThreadState,
      pollEventDelivery,
      pollEventProvenance,
      pollEventDeclared,
      skipSkillPermissionReset,
      pollEmptyDispatch,
      fileAttachments,
      frameTiming,
      clientPlatform,
      taskDelivery,
    })
  } finally {
    setReadFileCache(engine.getReadFileState())
  }
}
