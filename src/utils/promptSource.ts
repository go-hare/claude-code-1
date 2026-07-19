/**
 * densable OXd / PXd — promptSource + wakeupSource resolution (behavior only).
 *
 * Gold:
 *   OXd({isNonInteractive,isMeta,callerSource}) →
 *     nonInteractive → "sdk"; isMeta → "system"; else callerSource ?? "typed"
 *   PXd({promptSource,wakeupSource}) →
 *     explicit wakeupSource, else map sdk/system/typed|queued|suggestion_accepted→user
 */

import { isHumanMessageOrigin } from './sessionTitle.js'

/** densable promptSource values stamped on UserMessage (open string for forward compat). */
export type PromptSource =
  | 'sdk'
  | 'system'
  | 'typed'
  | 'queued'
  | 'suggestion_accepted'
  | (string & {})

/** densable attachment / UPS wakeup source derived from promptSource. */
export type WakeupSource = 'sdk' | 'system' | 'user' | (string & {})

/**
 * densable OXd — resolve promptSource for a user turn.
 * Non-interactive sessions always stamp "sdk"; meta/system prompts stamp
 * "system"; otherwise callerSource (queue/input) or default "typed".
 */
export function resolvePromptSource({
  isNonInteractive,
  isMeta,
  callerSource,
}: {
  isNonInteractive?: boolean
  isMeta?: boolean
  callerSource?: string
}): PromptSource {
  if (isNonInteractive) return 'sdk'
  if (isMeta) return 'system'
  return callerSource ?? 'typed'
}

/**
 * densable PXd — map promptSource to attachment wakeup source.
 * Explicit wakeupSource wins; typed/queued/suggestion_accepted → "user".
 */
export function resolveWakeupSource({
  promptSource,
  wakeupSource,
}: {
  promptSource?: string
  wakeupSource?: string
}): WakeupSource | undefined {
  if (wakeupSource) return wakeupSource
  switch (promptSource) {
    case 'sdk':
      return 'sdk'
    case 'system':
      return 'system'
    case 'typed':
    case 'queued':
    case 'suggestion_accepted':
      return 'user'
    default:
      return undefined
  }
}

/**
 * densable Jcf queue callerSource:
 *   isMeta || !Ite(origin) → "system"; else inputSource ?? defaultSource
 */
export function resolveCallerSourceFromQueuedCommand({
  isMeta,
  origin,
  inputSource,
  defaultSource = 'typed',
}: {
  isMeta?: boolean
  origin?: { kind?: string } | null
  inputSource?: string
  defaultSource?: string
}): PromptSource {
  if (isMeta || !isHumanMessageOrigin(origin)) return 'system'
  return inputSource ?? defaultSource
}
