/**
 * Official 2.1.328 BLt: enqueue turns immediately, then hold the feed's read
 * lock until that turn's result (including consumer-error draining). Esc can
 * start another turn before the previous reader has consumed its final frames.
 */

import type { SDKResultMessage } from '../entrypoints/sdk/coreTypes.generated.js'
import { enqueueSdkEvent } from '../utils/sdkEventQueue.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  isForeignSessionBinding,
  isSessionHistorySuppressed,
  isCompactPairWithheldFromRemote,
  isCurrentSessionPrecautionarySuppressed,
} from '../utils/sessionStorage.js'
import { createAssistantMessage } from '../utils/messages.js'
import { isUserAbortTerminalReason, type HostEngine } from './hostEngine.js'
import { Stream } from '../utils/stream.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'

export type HostEngineTurnInput = Record<string, unknown>

export type HostEngineFeed<T = HostEngineTurnInput> = {
  input: Stream<Record<string, unknown>> | null
  pendingQueryParams: T[]
  readLock: { acquire: () => Promise<() => void> }
}

/** Official iie.engineFeed + BJ promise-chain mutex. */
export function createHostEngineFeed<
  T = HostEngineTurnInput,
>(): HostEngineFeed<T> {
  let previous = Promise.resolve()
  return {
    input: null,
    pendingQueryParams: [],
    readLock: {
      acquire() {
        let release = () => {}
        const next = new Promise<void>(resolve => {
          release = resolve
        })
        const waiting = previous
        previous = next
        return waiting.then(() => release)
      },
    },
  }
}

export type HostEngineTurnOptions = {
  engine: HostEngine
  feed: HostEngineFeed
  turnInput: HostEngineTurnInput
  newMessages: Array<{ type?: string; message?: unknown }>
  onQueryEvent: (event: unknown) => void
  onRead?: () => void
  onMainRequestStart?: () => void
  onStatus?: (compactResult: unknown) => void
  addNotification?: (n: {
    key?: string
    text: string
    priority?: string
    color?: string
    timeoutMs?: number
  }) => void
}

/**
 * densable HWf — push turn params, enqueue user intent, drain engine until result/done.
 */
export async function runHostEngineTurn(
  options: HostEngineTurnOptions,
): Promise<SDKResultMessage | undefined> {
  const {
    engine,
    feed,
    turnInput,
    newMessages,
    onQueryEvent,
    addNotification,
    onRead,
    onMainRequestStart,
    onStatus,
  } = options

  feed.pendingQueryParams.push(turnInput)

  const lastUser = newMessages.findLast(m => m.type === 'user')
  if (feed.input === null) {
    const queue = new Stream<Record<string, unknown>>()
    feed.input = queue
    void engine.streamInput(queue).catch(err => {
      logForDebugging(`[engine] streamInput error: ${errorMessage(err)}`, {
        level: 'error',
      })
    })
  }

  feed.input.enqueue({
    type: 'user',
    message: lastUser?.message ?? { role: 'user', content: '' },
    parent_tool_use_id: null,
  })

  const readStartedAt = Date.now()
  const release = await feed.readLock.acquire()
  const waitedMs = Date.now() - readStartedAt
  if (waitedMs >= 5) {
    logForDebugging(
      `[engine] turn read waited ${waitedMs}ms for the previous turn's result`,
    )
  }
  let result: SDKResultMessage | undefined
  try {
    onRead?.()
    while (true) {
      const { value: frame, done } = await engine.next()
      if (done) break
      if (frame === null || frame === undefined) continue
      if (typeof frame !== 'object') {
        onQueryEvent(frame)
        continue
      }
      const l = frame as Record<string, unknown>
      const type = l.type

      // densable HWf filters — skip host-only envelopes, forward message stream
      if (type === 'system') {
        const subtype = l.subtype
        if (subtype === 'api_retry') continue
        if (subtype === 'memory_recall') continue
        if (subtype === 'thinking_tokens') continue
        if (subtype === 'status') {
          if (l.status === 'requesting') onMainRequestStart?.()
          try {
            if (
              l.status !== 'requesting' &&
              (typeof l.status === 'string' || l.status === null) &&
              getFeatureValue_CACHED_MAY_BE_STALE('tengu_luminous_seal', true)
            ) {
              enqueueSdkEvent({
                type: 'system',
                subtype: 'status',
                status: l.status,
                ...(l.permissionMode !== undefined
                  ? { permissionMode: l.permissionMode }
                  : {}),
                ...(l.compact_result !== undefined
                  ? { compact_result: l.compact_result }
                  : {}),
                ...(typeof l.compact_error === 'string' &&
                !isForeignSessionBinding() &&
                !isSessionHistorySuppressed() &&
                !isCompactPairWithheldFromRemote() &&
                !isCurrentSessionPrecautionarySuppressed()
                  ? { compact_error: l.compact_error }
                  : {}),
              })
            }
          } catch (error) {
            logForDebugging(
              `[engine] failed to forward status: ${errorMessage(error)}`,
              { level: 'error' },
            )
          }
          onStatus?.(l.compact_result)
          continue
        }
        if (subtype === 'permission_denied') continue
        if (subtype === 'init') continue
        if (subtype === 'notification') {
          if (addNotification && typeof l.text === 'string') {
            addNotification({
              key: typeof l.key === 'string' ? l.key : undefined,
              text: l.text,
              priority: typeof l.priority === 'string' ? l.priority : undefined,
              color: typeof l.color === 'string' ? l.color : undefined,
              timeoutMs:
                typeof l.timeout_ms === 'number' ? l.timeout_ms : undefined,
            })
          }
          continue
        }
        // system subtypes densable continues without i(l):
        if (
          subtype === 'task_started' ||
          subtype === 'task_progress' ||
          subtype === 'task_updated' ||
          subtype === 'task_notification' ||
          subtype === 'background_tasks_changed' ||
          subtype === 'task_summary' ||
          subtype === 'session_state_changed' ||
          subtype === 'post_turn_summary' ||
          subtype === 'hook_started' ||
          subtype === 'hook_progress' ||
          subtype === 'hook_response' ||
          subtype === 'commands_changed' ||
          subtype === 'elicitation_complete' ||
          subtype === 'files_persisted' ||
          subtype === 'mirror_error' ||
          subtype === 'code_change_published' ||
          subtype === 'vcs_state_changed'
        ) {
          continue
        }
        // model_fallback / compact_boundary / refusal* → densable maps then i(…)
        onQueryEvent(frame)
        continue
      }

      if (type === 'result') {
        result = l as SDKResultMessage
        if (l.is_error) {
          const msg =
            l.subtype === 'success' && typeof l.result === 'string'
              ? l.result
              : Array.isArray(l.errors)
                ? (l.errors as string[]).join('; ')
                : 'turn error'
          const stopped =
            typeof l.terminal_reason === 'string' &&
            isUserAbortTerminalReason(l.terminal_reason)
          logForDebugging(
            `[engine] turn ended in error: ${msg}`,
            stopped ? undefined : { level: 'error' },
          )
          if (l.subtype === 'error_during_execution' && !stopped) {
            try {
              onQueryEvent({
                ...createAssistantMessage({ content: msg }),
                isApiErrorMessage: true,
              })
            } catch (error) {
              logForDebugging(
                `[engine] failed to render degraded-turn error: ${errorMessage(error)}`,
                { level: 'error' },
              )
            }
          }
        }
        break
      }

      if (type === 'tool_progress') continue
      if (type === 'tool_use_summary') continue
      if (type === 'auth_status') continue
      if (type === 'prompt_suggestion') continue
      if (type === 'rate_limit_event') continue
      if (type === 'conversation_reset') continue
      if (type === 'command_lifecycle') continue
      // densable CLI host onQueryEvent @204905001 — no set_expanded_view arm.
      // TaskCreate/TaskUpdate emit it via onProgress; HWf must drop it so
      // TaskCreate does not auto-expand the spinner TaskList.
      if (type === 'set_expanded_view') continue
      // densable: assistant with parent_tool_use_id skipped in HWf
      if (
        type === 'assistant' &&
        'parent_tool_use_id' in l &&
        l.parent_tool_use_id
      ) {
        continue
      }

      onQueryEvent(frame)
    }
  } catch (err) {
    // densable: e.interrupt("consumer-error"); drain until result
    await engine.interrupt('consumer-error')
    let step = await engine.next()
    while (!step.done) {
      const v = step.value
      if (
        v &&
        typeof v === 'object' &&
        (v as { type?: string }).type === 'result'
      ) {
        break
      }
      step = await engine.next()
    }
    throw err
  } finally {
    release()
  }
  return result
}
