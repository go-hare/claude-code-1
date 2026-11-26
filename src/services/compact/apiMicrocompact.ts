import { APIError } from '@anthropic-ai/sdk'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '@claude-code/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebSearchTool/prompt.js'
import { SHELL_TOOL_NAMES } from 'src/utils/shell/shellToolUtils.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionHost.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

// Official 2.1.328 `SHe` / `Tis` (`chunk@294254613.js:2025684, 2029283`)
export const CLEAR_TOOL_USES_AFTER_IDLE_FLAG = 'tengu_jiggly_blossom'
export const DEFAULT_MIN_IDLE_SECONDS = 3900 // 65m (past 1h prompt cache TTL)
export const DEFAULT_KEEP_TOOL_USES = 12 // `DY = 12`
export const DEFAULT_CLEAR_AT_LEAST_TOKENS = 20_000 // `fGr = 20000`
export const DEFAULT_TRIGGER_TOOL_USES_BELOW_COUNT = 3
export const DEFAULT_MIN_TRIGGER_TOOL_USES = DEFAULT_KEEP_TOOL_USES + 15 // 27

// Legacy env-override defaults (ONLY when USE_API_CLEAR_TOOL_RESULTS=1 or USE_API_CLEAR_TOOL_USES=1)
const DEFAULT_MAX_INPUT_TOKENS = 180_000
const DEFAULT_TARGET_INPUT_TOKENS = 40_000

const SYNTHETIC_MODEL = '<synthetic>'
const SAFE_TOOL_NAME_RE = /^[A-Za-z0-9_.:-]+$/

const TOOLS_CLEARABLE_RESULTS = [
  ...SHELL_TOOL_NAMES,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
]

const TOOLS_CLEARABLE_RESULTS_SET = new Set<string>(TOOLS_CLEARABLE_RESULTS)

const TOOLS_CLEARABLE_USES = [
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
]

/**
 * Official 2.1.328 `Gjn` (`chunk@294254613.js:2034842`) — regex matching API
 * HTTP 400 rejecting `clear_tool_uses_20250919` on a model.
 */
const CLEAR_TOOL_USES_REFUSED_RE =
  /^\S{1,128} does not support the \W?clear_tool_uses_20250919\W? context management strategy/

/**
 * Official 2.1.328 `modelsThatRefusedTheEdit` + 2.1.331 `sys = new $e(...)` —
 * per-session latch per normalized model name so unsupported models stop
 * receiving `clear_tool_uses_20250919` after a 400 refusal without bleeding
 * across concurrent sessions.
 */
const modelsThatRefusedTheEditBySession = new RootSessionSlot(
  () => new Set<string>(),
)

function getModelsThatRefusedTheEdit(): Set<string> {
  return modelsThatRefusedTheEditBySession.of(getBootstrapSession())
}

function normalizeModelForRefusalLatch(model: string): string {
  return model
    .replace(/\[1m\]/gi, '')
    .trim()
    .toLowerCase()
}

export function recordClearToolUsesRefusal(model: string): void {
  if (!model) return
  getModelsThatRefusedTheEdit().add(normalizeModelForRefusalLatch(model))
}

export function hasModelRefusedClearToolUses(model: string): boolean {
  if (!model) return false
  return getModelsThatRefusedTheEdit().has(normalizeModelForRefusalLatch(model))
}

export function clearRefusedClearToolUsesModelsForTesting(): void {
  getModelsThatRefusedTheEdit().clear()
}

/** Official 2.1.328 `wFt(e)` — extract inner API error headline. */
function apiErrorHeadline(error: APIError): string {
  const body = error.error
  if (body && typeof body === 'object' && 'error' in body) {
    const inner = (body as { error?: unknown }).error
    if (
      inner &&
      typeof inner === 'object' &&
      'message' in inner &&
      typeof (inner as { message?: unknown }).message === 'string'
    ) {
      const msg = (inner as { message: string }).message.replace(/^\d{3} /, '')
      const nl = msg.indexOf('\n')
      return nl === -1 ? msg : msg.slice(0, nl)
    }
  }
  const stripped = error.message.replace(/^\d{3} /, '')
  const nl = stripped.indexOf('\n')
  return nl === -1 ? stripped : stripped.slice(0, nl)
}

/**
 * Official 2.1.328 `Gjn` predicate — HTTP 400 indicating the model does not
 * support the `clear_tool_uses_20250919` context management strategy.
 */
export function isClearToolUsesRefusedError(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 400) return false
  return CLEAR_TOOL_USES_REFUSED_RE.test(apiErrorHeadline(error))
}

/**
 * Official 2.1.328 `Gjn` (`chunk@294254613.js:2034842`) — latch refusal for
 * `model` when the API returns 400 rejecting `clear_tool_uses_20250919`.
 * Returns true if the error matched and the caller should strip the edit & retry.
 */
export function handleClearToolUsesRefusalError(
  error: unknown,
  model: string,
): boolean {
  if (!isClearToolUsesRefusedError(error)) return false
  recordClearToolUsesRefusal(model)
  logForDebugging(
    `[tool-result-clearing] The API does not support clear_tool_uses_20250919 on ${model}. This session stops sending it to that model until the process ends, so old tool results stay in the prompt.`,
    { level: 'warn' },
  )
  return true
}

export type ClearToolUsesStrategy = {
  type: 'clear_tool_uses_20250919'
  trigger?:
    | {
        type: 'tool_uses'
        value: number
      }
    | {
        type: 'input_tokens'
        value: number
      }
  keep?: {
    type: 'tool_uses'
    value: number
  }
  clear_tool_inputs?: boolean | string[]
  exclude_tools?: string[]
  clear_at_least?: {
    type: 'input_tokens'
    value: number
  }
}

// Context management strategy types matching API documentation
export type ContextEditStrategy =
  | ClearToolUsesStrategy
  | {
      type: 'clear_thinking_20251015'
      keep: { type: 'thinking_turns'; value: number } | 'all'
    }

// Context management configuration wrapper
export type ContextManagementConfig = {
  edits: ContextEditStrategy[]
}

export type ClearToolUsesAfterIdleOptions = {
  model?: string
  minIdleSeconds?: number
  keepToolUses?: number
  clearAtLeastTokens?: number
  triggerToolUsesBelowCount?: number
  minTriggerToolUses?: number
  /** Test/override for current time when checking return after idle. */
  nowMs?: number
  /** Test/override for `tengu_jiggly_blossom` ('on' | 'shadow' | 'off'). */
  modeOverride?: 'on' | 'shadow' | 'off'
}

function getClearToolUsesAfterIdleMode(
  modeOverride?: 'on' | 'shadow' | 'off',
): 'on' | 'shadow' | 'off' {
  if (modeOverride !== undefined) return modeOverride
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<string>(
    CLEAR_TOOL_USES_AFTER_IDLE_FLAG,
    'off',
  )
  return raw === 'on' || raw === 'shadow' ? raw : 'off'
}

/** Official 2.1.328 `YH(msg)` (`chunk@294254613.js:2054500`). */
function getMessageActivityTimestampMs(msg: Message): number | undefined {
  if (msg.type === 'assistant') {
    if (msg.message?.model === SYNTHETIC_MODEL || msg.isApiErrorMessage) {
      return undefined
    }
  } else if (msg.type === 'user') {
    if (
      msg.isMeta ||
      msg.isVisibleInTranscriptOnly ||
      msg.isCompactSummary ||
      (msg as { ephemeral?: boolean }).ephemeral ||
      (msg as { isVirtual?: boolean }).isVirtual ||
      (msg as { toolDenialKind?: string }).toolDenialKind === 'interrupted'
    ) {
      return undefined
    }
  } else {
    return undefined
  }
  const rawTimestamp = (msg as { timestamp?: unknown }).timestamp
  if (typeof rawTimestamp !== 'string') return undefined
  const ts = Date.parse(rawTimestamp)
  return Number.isFinite(ts) ? ts : undefined
}

/** Official 2.1.328 `okt(msg)` — non-tool-result human user message. */
function isReturnUserMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  if (typeof content === 'string') return true
  return (
    Array.isArray(content) &&
    !content.some(
      block =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'tool_result',
    )
  )
}

/**
 * Official 2.1.328 `$0e` + `H0e` + `zjn` (`chunk@294254613.js:2035500-2045500`) —
 * plan a `clear_tool_uses_20250919` strategy strictly after an idle/cold-cache
 * return (`idleMs > minIdleSeconds * 1000`), using `tool_uses` trigger + `keep`
 * + `exclude_tools` instead of an unconditional input_tokens threshold.
 */
export function planClearToolUsesAfterIdle(
  messages: readonly Message[] | undefined,
  options?: ClearToolUsesAfterIdleOptions,
): ClearToolUsesStrategy | undefined {
  if (!messages || messages.length === 0) return undefined
  if (options?.model && hasModelRefusedClearToolUses(options.model)) {
    return undefined
  }
  const mode = getClearToolUsesAfterIdleMode(options?.modeOverride)
  if (mode !== 'on') return undefined

  const minIdleMs = (options?.minIdleSeconds ?? DEFAULT_MIN_IDLE_SECONDS) * 1000
  const keepToolUses = options?.keepToolUses ?? DEFAULT_KEEP_TOOL_USES
  const clearAtLeastTokens =
    options?.clearAtLeastTokens ?? DEFAULT_CLEAR_AT_LEAST_TOKENS
  const triggerBelow =
    options?.triggerToolUsesBelowCount ?? DEFAULT_TRIGGER_TOOL_USES_BELOW_COUNT
  const minTriggerToolUses =
    options?.minTriggerToolUses ??
    Math.max(keepToolUses + 1, DEFAULT_MIN_TRIGGER_TOOL_USES)

  // `$0e`: locate the latest idle gap (> minIdleMs) after an assistant reply
  let returnIndex: number | undefined
  let lastTimestampMs: number | undefined
  let hadAssistant = false

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    const ts = getMessageActivityTimestampMs(msg)
    if (ts === undefined) continue
    if (
      hadAssistant &&
      lastTimestampMs !== undefined &&
      ts - lastTimestampMs > minIdleMs &&
      isReturnUserMessage(msg)
    ) {
      returnIndex = i
    }
    if (msg.type === 'assistant') {
      hadAssistant = true
    }
    lastTimestampMs =
      lastTimestampMs === undefined ? ts : Math.max(lastTimestampMs, ts)
  }

  if (
    returnIndex === undefined &&
    hadAssistant &&
    lastTimestampMs !== undefined &&
    options?.nowMs !== undefined &&
    options.nowMs - lastTimestampMs > minIdleMs
  ) {
    returnIndex = messages.length
  }

  if (returnIndex === undefined) return undefined

  // `H0e`: count clearable tool uses before and since return, collect exclude_tools
  const clearableBeforeIds = new Set<string>()
  const clearableSinceIds = new Set<string>()
  const clearableToolById = new Map<string, string>()
  const excludeToolsSet = new Set<string>()

  let clearableCompletedBefore = 0
  let clearableCompletedSince = 0

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.type !== 'assistant' && msg.type !== 'user') continue
    if (msg.type === 'assistant' && msg.isApiErrorMessage) continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as {
        type?: string
        id?: string
        name?: string
        tool_use_id?: string
      }
      if (
        b.type === 'tool_use' ||
        b.type === 'server_tool_use' ||
        b.type === 'mcp_tool_use'
      ) {
        if (typeof b.name !== 'string') continue
        if (!TOOLS_CLEARABLE_RESULTS_SET.has(b.name)) {
          if (SAFE_TOOL_NAME_RE.test(b.name)) {
            excludeToolsSet.add(b.name)
          }
        } else if (b.type === 'tool_use' && typeof b.id === 'string') {
          if (!clearableToolById.has(b.id)) {
            clearableToolById.set(b.id, b.name)
            if (i < returnIndex) {
              clearableBeforeIds.add(b.id)
            } else {
              clearableSinceIds.add(b.id)
            }
          }
        }
      } else if (
        b.type === 'tool_result' &&
        typeof b.tool_use_id === 'string'
      ) {
        if (i < returnIndex && clearableBeforeIds.delete(b.tool_use_id)) {
          clearableCompletedBefore++
        } else if (clearableSinceIds.delete(b.tool_use_id)) {
          clearableCompletedSince++
        }
      }
    }
  }

  const triggerToolUses = clearableCompletedBefore - triggerBelow
  if (triggerToolUses <= keepToolUses || triggerToolUses < minTriggerToolUses) {
    return undefined
  }

  // `zjn`: shift trigger & keep together by clearable tool uses since return
  const delta = Math.max(
    clearableCompletedSince,
    -Math.min(keepToolUses, triggerToolUses - keepToolUses - 3),
  )

  return {
    type: 'clear_tool_uses_20250919',
    trigger: {
      type: 'tool_uses',
      value: triggerToolUses + delta,
    },
    keep: {
      type: 'tool_uses',
      value: keepToolUses + delta,
    },
    clear_at_least: {
      type: 'input_tokens',
      value: clearAtLeastTokens,
    },
    exclude_tools: [...excludeToolsSet].sort(),
  }
}

/**
 * Official 2.1.328 `SUn` (`chunk@294254613.js:1970515`) + idle-gated `sYn`/`zjn`.
 *
 * `clear_tool_uses_20250919` is NO LONGER enabled unconditionally by default at
 * 180K input tokens (which broke warm 1M caches and triggered unrecoverable 400s
 * on unsupported models). It is emitted ONLY when:
 *   1. The model has not refused `clear_tool_uses_20250919` (`Gjn` latch), AND
 *   2. Either an explicit env override (`USE_API_CLEAR_TOOL_RESULTS=1` or
 *      `USE_API_CLEAR_TOOL_USES=1`) is set, OR `planClearToolUsesAfterIdle`
 *      triggers on cold-cache return (`minIdleSeconds` + GrowthBook `tengu_jiggly_blossom='on'`).
 */
export function getAPIContextManagement(options?: {
  hasThinking?: boolean
  isRedactThinkingActive?: boolean
  clearAllThinking?: boolean
  model?: string
  messages?: readonly Message[]
  disableClearToolUses?: boolean
  minIdleSeconds?: number
  nowMs?: number
  modeOverride?: 'on' | 'shadow' | 'off'
}): ContextManagementConfig | undefined {
  const {
    hasThinking = false,
    isRedactThinkingActive = false,
    clearAllThinking = false,
    model,
    messages,
    disableClearToolUses = false,
  } = options ?? {}

  const strategies: ContextEditStrategy[] = []

  // Preserve thinking blocks in previous assistant turns. Skip when
  // redact-thinking is active — redacted blocks have no model-visible content.
  if (hasThinking && !isRedactThinkingActive) {
    strategies.push({
      type: 'clear_thinking_20251015',
      keep: clearAllThinking ? { type: 'thinking_turns', value: 1 } : 'all',
    })
  }

  const refusedByModel =
    disableClearToolUses ||
    (model !== undefined && hasModelRefusedClearToolUses(model))

  if (!refusedByModel) {
    // Explicit developer env overrides (strictly opt-in; never default true)
    const explicitClearToolResults = isEnvTruthy(
      process.env.USE_API_CLEAR_TOOL_RESULTS,
    )
    const explicitClearToolUses = isEnvTruthy(
      process.env.USE_API_CLEAR_TOOL_USES,
    )

    if (explicitClearToolResults || explicitClearToolUses) {
      const triggerThreshold = process.env.API_MAX_INPUT_TOKENS
        ? parseInt(process.env.API_MAX_INPUT_TOKENS, 10)
        : DEFAULT_MAX_INPUT_TOKENS
      const keepTarget = process.env.API_TARGET_INPUT_TOKENS
        ? parseInt(process.env.API_TARGET_INPUT_TOKENS, 10)
        : DEFAULT_TARGET_INPUT_TOKENS

      if (explicitClearToolResults) {
        strategies.push({
          type: 'clear_tool_uses_20250919',
          trigger: {
            type: 'input_tokens',
            value: triggerThreshold,
          },
          clear_at_least: {
            type: 'input_tokens',
            value: triggerThreshold - keepTarget,
          },
          clear_tool_inputs: TOOLS_CLEARABLE_RESULTS,
        })
      }

      if (explicitClearToolUses) {
        strategies.push({
          type: 'clear_tool_uses_20250919',
          trigger: {
            type: 'input_tokens',
            value: triggerThreshold,
          },
          clear_at_least: {
            type: 'input_tokens',
            value: triggerThreshold - keepTarget,
          },
          exclude_tools: TOOLS_CLEARABLE_USES,
        })
      }
    } else {
      // Official 2.1.328 idle/cold-cache return tool-result clearing (`zjn`)
      const idleStrategy = planClearToolUsesAfterIdle(messages, {
        model,
        minIdleSeconds: options?.minIdleSeconds,
        nowMs: options?.nowMs,
        modeOverride: options?.modeOverride,
      })
      if (idleStrategy) {
        strategies.push(idleStrategy)
      }
    }
  }

  return strategies.length > 0 ? { edits: strategies } : undefined
}
