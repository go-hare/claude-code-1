/**
 * densable Tje / gYu / Prr launch-prompt-warning store.
 *
 * Sticky footer warning when session launches with a prefilled prompt
 * (deep-link or --prefill). Cleared when the user empties the input.
 */
import { useSyncExternalStore } from 'react'

export type LaunchWarning = {
  type: 'deep-link' | 'prefill'
  prefillLength: number
}

type Listener = () => void

let launchWarning: LaunchWarning | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

/** densable gYu */
export function getLaunchWarning(): LaunchWarning | null {
  return launchWarning
}

/**
 * densable Tje — set sticky launch warning; skip no-op if same type+length.
 */
export function setLaunchWarning(next: LaunchWarning | null): void {
  if (next === null) {
    if (launchWarning === null) return
    launchWarning = null
    emit()
    return
  }
  if (
    launchWarning?.type === next.type &&
    launchWarning.prefillLength === next.prefillLength
  ) {
    return
  }
  launchWarning = next
  emit()
}

/**
 * densable Prr fragment: when input goes from non-empty → empty, drop
 * launchWarning so the pinned footer pin clears after user clears draft.
 */
export function maybeClearLaunchWarningOnInputChange(
  previous: string,
  next: string,
): void {
  if (launchWarning !== null && previous !== '' && next === '') {
    launchWarning = null
    emit()
  }
}

export function subscribeLaunchWarning(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook for launch-prompt-warning consumers (useLaunchPromptWarning). */
export function useLaunchWarning(): LaunchWarning | null {
  return useSyncExternalStore(
    subscribeLaunchWarning,
    getLaunchWarning,
    getLaunchWarning,
  )
}
