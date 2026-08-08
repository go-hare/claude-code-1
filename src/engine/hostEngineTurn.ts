/**
 * densable 2.1.218 HWf — Host REPL turn pump over S8o engine.
 *
 * densable:
 *   async function HWf({engine:e, inputRef:t, pendingQueryParamsRef:r,
 *     turnInput:n, newMessages:o, onQueryEvent:i, addNotification:s}) {
 *     r.current.push(n)
 *     // ensure streamInput on YZ queue once
 *     t.current.enqueue({type:"user", message:a?.message??…, parent_tool_use_id:null})
 *     while (true) {
 *       const {value:l, done:c} = await e.next()
 *       if (c) break
 *       // map/filter engine frames → onQueryEvent / notifications
 *       if (l.type === "result") break
 *     }
 *   }
 *
 * Local: same closed-gate turn path. Engine frames that are already
 * Message-shaped (from runTurn → query()) are forwarded via onQueryEvent.
 * Lifecycle / system/init / result envelopes are filtered densable-style.
 */

import type { HostEngine } from './hostEngine.js'
import { Stream } from '../utils/stream.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'

export type HostEngineTurnInput = Record<string, unknown>

export type HostEngineTurnOptions = {
  engine: HostEngine
  /** densable inputRef — YZ stream fed to engine.streamInput once. */
  inputRef: { current: Stream<Record<string, unknown>> | null }
  /** densable pendingQueryParamsRef — prepareTurn shifts from here. */
  pendingQueryParamsRef: { current: HostEngineTurnInput[] }
  turnInput: HostEngineTurnInput
  newMessages: Array<{ type?: string; message?: unknown }>
  onQueryEvent: (event: unknown) => void
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
): Promise<void> {
  const {
    engine,
    inputRef,
    pendingQueryParamsRef,
    turnInput,
    newMessages,
    onQueryEvent,
    addNotification,
  } = options

  pendingQueryParamsRef.current.push(turnInput)

  const lastUser = [...newMessages].reverse().find(m => m.type === 'user')
  if (inputRef.current === null) {
    const queue = new Stream<Record<string, unknown>>()
    inputRef.current = queue
    void engine.streamInput(queue).catch(err => {
      logForDebugging(`[engine] streamInput error: ${errorMessage(err)}`, {
        level: 'error',
      })
    })
  }

  inputRef.current.enqueue({
    type: 'user',
    message: lastUser?.message ?? { role: 'user', content: '' },
    parent_tool_use_id: null,
  })

  try {
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
        if (subtype === 'status') continue
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
        if (l.is_error) {
          const msg =
            l.subtype === 'success' && typeof l.result === 'string'
              ? l.result
              : Array.isArray(l.errors)
                ? (l.errors as string[]).join('; ')
                : 'turn error'
          logForDebugging(`[engine] turn ended in error: ${msg}`, {
            level: 'error',
          })
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
  }
}
