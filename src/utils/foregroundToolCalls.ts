/**
 * densable 2.1.283 send-now detach registry (EEe / Wuo).
 * Running tool uses register a backgroundNow() that detaches instead of cancel.
 */
import { logError } from './log.js'
import { logForDebugging } from './debug.js'

export type ForegroundToolCall = {
  toolUseId?: string
  backgroundNow: () => boolean
}

const sessions = new WeakMap<object, Set<ForegroundToolCall>>()

function bagFor(session: object): Set<ForegroundToolCall> {
  let bag = sessions.get(session)
  if (!bag) {
    bag = new Set()
    sessions.set(session, bag)
  }
  return bag
}

export function registerForegroundToolCall(
  session: object,
  call: ForegroundToolCall,
): () => void {
  const bag = bagFor(session)
  bag.add(call)
  return () => {
    bag.delete(call)
  }
}

export function listForegroundToolCalls(session: object): ForegroundToolCall[] {
  return [...(sessions.get(session) ?? [])]
}

/** densable Wuo — background running tools; do not cancel. */
export function backgroundForegroundToolCalls(session: object): number {
  let moved = 0
  for (const call of listForegroundToolCalls(session)) {
    try {
      if (call.backgroundNow()) moved++
    } catch (error) {
      logForDebugging(
        `[foreground-tool-calls] moving ${call.toolUseId ?? 'a call'} threw; it stays in the foreground`,
        { level: 'error' },
      )
      logError(error)
    }
  }
  return moved
}

/** Process-wide bag for the interactive query (local has no gold session WeakMap host). */
export const queryForegroundSession: object = {}
