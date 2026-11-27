/**
 * Detached tool-call execution support:
 * - Eligibility gate (`canDetachToolCall`, blocking hook checks, open permission dialog check)
 * - `runWithDetachSupport` wrapper racing foreground completion vs. send-now detach
 * - Background settlement, persistence, notification queueing, and ceiling timeout
 *
 * Preserves Stage-1 fix: passes `session` to `enqueueDetachedToolCallResult` on
 * both success and failure/cancellation settlement paths.
 */

import { logEvent } from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import {
  getMainThreadAgentHooks,
  getRegisteredHooks,
  getSessionId,
  isSingleShotPrintSession,
} from '../../../bootstrap/state.js'
import { getPermissionConfirm } from '../../../dialog/permissionConfirmRegistry.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import { createAbortController } from '../../../utils/abortController.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  DETACH_RESULT_CAP,
  enqueueDetachedToolCallResult,
  stillRunningDetachText,
} from '../../../utils/detachedToolCallNotify.js'
import {
  detachedToolCallEnded,
  detachedToolCallLetGo,
  detachedToolCallResultQueued,
  detachedToolCallSetText,
  detachedToolCallSettled,
  detachedToolCallStarted,
  getDetachedToolCallSnapshot,
  isDetachBackgrounding,
} from '../../../utils/detachedToolCallStore.js'
import { AbortError, errorMessage } from '../../../utils/errors.js'
import { registerForegroundToolCall } from '../../../utils/foregroundToolCalls.js'
import {
  getHooksConfigFromSnapshot,
  shouldDisableAllHooksIncludingManaged,
} from '../../../utils/hooks/hooksConfigSnapshot.js'
import { hasMatchingFunctionHook } from '../../../utils/plugins/functionHooksModules.js'
import { areBackgroundTasksDisabled } from '../../../utils/sessionBackgroundGates.js'
import { isUserPromptWaiting } from '../../../utils/sessionHost.js'
import { plural } from '../../../utils/stringUtils.js'
import {
  persistToolResult,
  processPreMappedToolResultBlock,
} from '../../../utils/toolResultStorage.js'
import { ToolPermissionPromptsUp } from '../../../utils/toolState.js'
import { escapeXml } from '../../../utils/xml.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../analytics/growthbook.js'
import type { OnToolProgressFn } from './types.js'

const DETACH_CEILING_MS = 300_000

function detachHookMatcherHitsTool(
  matcherPattern: string | undefined,
  tool: Tool,
): boolean {
  if (!matcherPattern || matcherPattern === '*') return true
  const names = [tool.name, ...(tool.aliases ?? [])]
  if (names.some(name => name === matcherPattern)) return true
  try {
    const regex = new RegExp(`^(${matcherPattern})$`)
    return names.some(name => regex.test(name))
  } catch {
    return false
  }
}

function hasBlockingHookForDetach(
  tool: Tool,
  toolUseContext: ToolUseContext,
): boolean {
  if (shouldDisableAllHooksIncludingManaged()) return false
  if (
    hasMatchingFunctionHook('PostToolUse', { tool_name: tool.name }) ||
    hasMatchingFunctionHook('PostToolUseFailure', { tool_name: tool.name }) ||
    hasMatchingFunctionHook('PostToolBatch') ||
    hasMatchingFunctionHook('tool.call', { tool: tool.name })
  ) {
    return true
  }
  if (toolUseContext.options.settingsHooksOff === true) return false
  let sessionHooksForId:
    | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
    | undefined
  try {
    const appState = toolUseContext.getAppState?.()
    const sessionObj = toolUseContext.session as { id?: string } | undefined
    const sid = toolUseContext.agentId ?? sessionObj?.id ?? getSessionId()
    sessionHooksForId = appState?.sessionHooks?.get(sid)?.hooks as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | undefined
  } catch {
    sessionHooksForId = undefined
  }
  const sources = [
    getHooksConfigFromSnapshot() as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | null
      | undefined,
    getRegisteredHooks() as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | null
      | undefined,
    getMainThreadAgentHooks() as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | null
      | undefined,
    sessionHooksForId,
  ]
  for (const event of ['PostToolUse', 'PostToolUseFailure'] as const) {
    for (const src of sources) {
      const matchers = src?.[event]
      if (!Array.isArray(matchers)) continue
      for (const m of matchers) {
        if (m.hooks.length > 0 && detachHookMatcherHitsTool(m.matcher, tool)) {
          return true
        }
      }
    }
  }
  for (const src of sources) {
    const matchers = src?.PostToolBatch
    if (Array.isArray(matchers) && matchers.some(m => m.hooks.length > 0)) {
      return true
    }
  }
  return false
}

/** densable `FDe` @188766400 — gate whether a tool call may detach. */
export function canDetachToolCall(
  tool: Tool,
  _input: unknown,
  toolUseContext: ToolUseContext,
): boolean {
  try {
    if (
      !isDetachBackgrounding(tool) ||
      toolUseContext.session === undefined ||
      toolUseContext.agentId !== undefined ||
      toolUseContext.innerCall === true ||
      (toolUseContext as { remoteCall?: unknown }).remoteCall !== undefined
    ) {
      return false
    }
    if (toolUseContext.options.isNonInteractiveSession) {
      const nonInteractiveDetachAllowed =
        !isSingleShotPrintSession() &&
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_velvet_panda', true) ===
          true &&
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_bubbly_meteor', true) ===
          true
      if (!nonInteractiveDetachAllowed) return false
    }
    if (
      areBackgroundTasksDisabled() ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_tool_detach', true) !== true
    ) {
      return false
    }
    return !hasBlockingHookForDetach(tool, toolUseContext)
  } catch (err) {
    logForDebugging(
      `[detach] ${tool.name}: the gate threw, so the call runs inline (${errorMessage(err)})`,
      { level: 'error' },
    )
    return false
  }
}

export function isDetachPermissionDialogOpen(
  toolUseContext: ToolUseContext,
  toolUseID: string,
): boolean {
  if ((toolUseContext.toolState?.get(ToolPermissionPromptsUp).count ?? 0) > 0) {
    return true
  }
  if (getPermissionConfirm(toolUseID) !== undefined) {
    return true
  }
  if (toolUseContext.session !== undefined) {
    try {
      if (isUserPromptWaiting(toolUseContext.session)) return true
    } catch {
      // Synthetic session objects without SessionHost slots are treated as non-waiting.
    }
  }
  try {
    const queue = (
      toolUseContext.getAppState?.() as
        | { toolUseConfirmQueue?: unknown[] }
        | undefined
    )?.toolUseConfirmQueue
    if (Array.isArray(queue) && queue.length > 0) return true
  } catch {
    // Ignore partial test appState objects.
  }
  return false
}

function formatDetachedMappedContent(content: unknown): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  const parts: string[] = []
  let nonText = 0
  for (const s of content) {
    if (
      s &&
      typeof s === 'object' &&
      (s as { type?: string }).type === 'text' &&
      typeof (s as { text?: unknown }).text === 'string'
    ) {
      parts.push((s as { text: string }).text)
    } else {
      nonText++
    }
  }
  if (nonText > 0) {
    parts.push(
      `[${nonText} non-text ${plural(nonText, 'block')} of the result could not be carried in a notification]`,
    )
  }
  return parts.join('\n')
}

/**
 * densable `dOt` + `Zho` (@188766700–@188769600) — wraps post-permission
 * `tool.call` execution so permission prompts never race with send-now detach.
 */
export async function runWithDetachSupport<T extends { data: unknown }>(opts: {
  tool: Tool
  input: unknown
  toolUseID: string
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  onProgress: OnToolProgressFn
  run: (
    ctx: ToolUseContext,
    wrappedCanUseTool: CanUseToolFn,
    onProgress: OnToolProgressFn,
  ) => Promise<T>
}): Promise<{ detached: false; result: T } | { detached: true; text: string }> {
  const {
    tool,
    input,
    toolUseID,
    toolUseContext,
    canUseTool,
    onProgress,
    run,
  } = opts
  if (!canDetachToolCall(tool, input, toolUseContext)) {
    return {
      detached: false,
      result: await run(toolUseContext, canUseTool, onProgress),
    }
  }

  const session = toolUseContext.session!
  const detachAbortController = createAbortController()
  let inForeground = true
  let localPromptsUp = 0

  const onParentAbort = () => {
    if (inForeground && !detachAbortController.signal.aborted) {
      detachAbortController.abort(toolUseContext.abortController.signal.reason)
    }
  }
  if (toolUseContext.abortController.signal.aborted) {
    onParentAbort()
  } else {
    toolUseContext.abortController.signal.addEventListener(
      'abort',
      onParentAbort,
      { once: true },
    )
  }
  detachAbortController.signal.addEventListener(
    'abort',
    () => {
      if (inForeground && !toolUseContext.abortController.signal.aborted) {
        toolUseContext.abortController.abort(
          detachAbortController.signal.reason,
        )
      }
    },
    { once: true },
  )

  const wrappedCanUseTool: CanUseToolFn = async (
    targetTool,
    targetInput,
    targetCtx,
    parentMsg,
    targetId,
    forceDecision,
  ) => {
    localPromptsUp++
    const slot = toolUseContext.toolState?.get(ToolPermissionPromptsUp)
    if (slot) slot.count++
    try {
      return await canUseTool(
        targetTool,
        targetInput,
        targetCtx,
        parentMsg,
        targetId,
        forceDecision,
      )
    } finally {
      localPromptsUp--
      if (slot) slot.count = Math.max(0, slot.count - 1)
    }
  }

  let signalDetachEarly: (() => void) | undefined
  const detachEarly = new Promise<'detach'>(resolve => {
    signalDetachEarly = () => resolve('detach')
  })

  const unregisterForeground = registerForegroundToolCall(session, {
    toolUseId: toolUseID,
    backgroundNow: () => {
      if (
        !inForeground ||
        localPromptsUp > 0 ||
        detachAbortController.signal.aborted ||
        toolUseContext.abortController.signal.aborted ||
        areBackgroundTasksDisabled() ||
        isDetachPermissionDialogOpen(toolUseContext, toolUseID)
      ) {
        return false
      }
      inForeground = false
      detachedToolCallLetGo(toolUseID, session)
      signalDetachEarly?.()
      return true
    },
  })

  const callPromise = run(
    { ...toolUseContext, abortController: detachAbortController },
    wrappedCanUseTool,
    progress => {
      if (inForeground) onProgress(progress)
    },
  ).finally(() => {
    toolUseContext.abortController.signal.removeEventListener(
      'abort',
      onParentAbort,
    )
    unregisterForeground()
  })

  let race: 'settled' | 'detach'
  try {
    race = await Promise.race([
      callPromise.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      detachEarly,
    ])
  } finally {
    unregisterForeground()
  }

  if (race === 'settled' || toolUseContext.abortController.signal.aborted) {
    try {
      return { detached: false, result: await callPromise }
    } finally {
      detachedToolCallEnded(toolUseID, session)
    }
  }

  const isOnScreen = toolUseContext.options.isNonInteractiveSession !== true
  logEvent('tengu_tool_call_detached', {
    toolName: sanitizeToolNameForAnalytics(tool.name),
  })
  logForDebugging(
    `[detach] ${tool.name} ${toolUseID} moved to the background to deliver a message`,
  )
  detachedToolCallStarted(
    toolUseID,
    {
      tool,
      input,
      detachedAt: Date.now(),
    },
    reason => detachAbortController.abort(reason),
    session,
  )

  let ceilingHit = false
  const ceiling = setTimeout(() => {
    ceilingHit = true
    detachAbortController.abort('detached-ceiling')
  }, DETACH_CEILING_MS)
  ceiling.unref?.()

  const stillHeard = () => getDetachedToolCallSnapshot(session).has(toolUseID)

  void callPromise
    .finally(() => clearTimeout(ceiling))
    .then(res => {
      // densable dOt @188768350: any abort reason routes into the failure arm.
      if (detachAbortController.signal.aborted) {
        throw new AbortError()
      }
      return res
    })
    .then(
      async res => {
        // densable Zho: settle completed data into store BEFORE persistence so
        // in-place UI rendering retains `data` even if disk persistence fails.
        if (
          !detachedToolCallSettled(
            toolUseID,
            { status: 'completed', data: res.data },
            session,
          )
        ) {
          return
        }

        let text = ''
        let notifyStatus: 'completed' | 'failed' = 'completed'
        try {
          const mapped = tool.mapToolResultToToolResultBlockParam(
            res.data as never,
            toolUseID,
          )
          const block = await processPreMappedToolResultBlock(
            mapped,
            tool.name,
            tool.maxResultSizeChars ?? Number.POSITIVE_INFINITY,
          )
          if (!stillHeard()) return
          text = formatDetachedMappedContent(block?.content)
          if (block?.is_error === true) {
            notifyStatus = 'failed'
            if (
              !detachedToolCallSettled(
                toolUseID,
                { status: 'failed', text, data: res.data },
                session,
              )
            ) {
              return
            }
          } else if (escapeXml(text).length > DETACH_RESULT_CAP) {
            const saved = await persistToolResult(text, toolUseID)
            if (!stillHeard()) return
            if ('error' in saved) {
              notifyStatus = 'failed'
              text =
                'The call completed, but its result is too large to carry in a notification and could not be saved to a file.'
            } else {
              text = `The result is ${saved.originalSize} characters, too large to carry in a notification, so none of it is quoted here. ${saved.truncatedAtBytes === undefined ? 'All of it' : `Its first ${saved.truncatedAtBytes} bytes`} was saved to ${saved.filepath}. Read that file to see it.`
              detachedToolCallSetText(toolUseID, text, session)
            }
          } else {
            detachedToolCallSetText(toolUseID, text, session)
          }
        } catch {
          if (!stillHeard()) return
          notifyStatus = 'failed'
          text = 'The call completed but its result could not be rendered.'
        }

        if (!stillHeard()) return
        enqueueDetachedToolCallResult({
          toolName: tool.name,
          toolUseId: toolUseID,
          status: notifyStatus,
          text,
          isOnScreen,
          session,
        })
        detachedToolCallResultQueued(toolUseID, session)
      },
      (err: unknown) => {
        const ceilingAbort =
          ceilingHit ||
          detachAbortController.signal.reason === 'detached-ceiling'
        const userCancel =
          !ceilingAbort && detachAbortController.signal.reason === 'user-cancel'
        const text = ceilingAbort
          ? `The call did not finish within ${DETACH_CEILING_MS / 60000} minutes and was stopped.`
          : userCancel
            ? 'The user stopped this call before it finished.'
            : errorMessage(err)
        const status = userCancel ? 'stopped' : 'failed'
        if (!detachedToolCallSettled(toolUseID, { status, text }, session)) {
          return
        }
        enqueueDetachedToolCallResult({
          toolName: tool.name,
          toolUseId: toolUseID,
          status,
          text,
          isOnScreen,
          passive: userCancel,
          session,
        })
        detachedToolCallResultQueued(toolUseID, session)
      },
    )
    .finally(() => {
      detachedToolCallEnded(toolUseID, session)
    })

  return {
    detached: true,
    text: stillRunningDetachText(tool.name, isOnScreen),
  }
}
