/**
 * densable tpr / Um_ — task:background cohesion keybinding hook.
 *
 * When CLAUDE_CODE_KB_COHESION_FIXES is on and Task bindings are still the
 * default pair (ctrl+b + ctrl+x ctrl+b), bare ctrl+b registers with
 * singleKey:false so ChordInterceptor will not steal readline backward-char;
 * the UI points users at ctrl+x ctrl+b (tmux-aware). Customized bindings keep
 * singleKey:true and show the resolved shortcut.
 *
 * Registration is registry-only (no useInput), matching densable En/tpr —
 * ChordInterceptor dispatches chord completions and singleKey handlers.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useOptionalKeybindingContext } from './KeybindingContext.js'
import { chordToString, parseChord } from './parser.js'
import { useShortcutDisplay } from './useShortcutDisplay.js'
import type { ParsedBinding } from './types.js'
import { env } from '../utils/env.js'
import { isKbCohesionFixesEnabled } from '../utils/systemPromptArms.js'

/** densable ron — legacy single-key task:background */
export const TASK_BACKGROUND_DEFAULT_KEY = 'ctrl+b'
/** densable hnp — cohesion chord that avoids bare ctrl+b */
export const TASK_BACKGROUND_COHESION_KEY = 'ctrl+x ctrl+b'

const DEFAULT_TASK_BG_FINGERPRINTS = new Set(
  [TASK_BACKGROUND_DEFAULT_KEY, TASK_BACKGROUND_COHESION_KEY].map(chord =>
    chordToString(parseChord(chord)),
  ),
)

/**
 * densable Um_ — true when Task bindings customize task:background away from
 * the default pair (or null-unbind a default chord).
 */
export function isTaskBackgroundBindingCustomized(
  bindings: ParsedBinding[],
): boolean {
  for (const binding of bindings) {
    if (binding.context !== 'Task') continue
    const fingerprint = chordToString(binding.chord)
    if (binding.action === 'task:background') {
      if (!DEFAULT_TASK_BG_FINGERPRINTS.has(fingerprint)) return true
    } else if (binding.action === null) {
      if (DEFAULT_TASK_BG_FINGERPRINTS.has(fingerprint)) return true
    }
  }
  return false
}

/**
 * densable tmux display transform on cohesion gate chord: double any
 * ctrl+b token (prefix escape), leave other tokens alone.
 */
export function formatTaskBackgroundTmuxShortcut(shortcut: string): string {
  if (shortcut === '') return ''
  return shortcut
    .split(' ')
    .map(token =>
      token === TASK_BACKGROUND_DEFAULT_KEY
        ? `${TASK_BACKGROUND_DEFAULT_KEY} ${TASK_BACKGROUND_DEFAULT_KEY}`
        : token,
    )
    .join(' ')
}

type Options = {
  handler: () => void | false | Promise<void>
  isActive?: boolean
}

export type TaskBackgroundKeybindingResult = {
  cohesionFixes: boolean
  /** densable gateOnShortcut — preferred display under cohesion */
  gateOnShortcut: string
  /** Resolved display from bindings (or fallback ctrl+b) */
  resolvedShortcut: string
  /**
   * Final UI chord: cohesion → gateOnShortcut; else legacy tmux-aware
   * resolved shortcut. Empty string means hide the hint (cohesion + unbound).
   */
  displayShortcut: string
}

/**
 * densable tpr — register task:background with cohesion-aware singleKey.
 */
export function useTaskBackgroundKeybinding({
  handler,
  isActive = true,
}: Options): TaskBackgroundKeybindingResult {
  const cohesionFixes = isKbCohesionFixesEnabled()
  const keybindingContext = useOptionalKeybindingContext()
  const bindings = keybindingContext?.bindings
  const customized = useMemo(
    () => (bindings ? isTaskBackgroundBindingCustomized(bindings) : false),
    [bindings],
  )

  const handlerRef = useRef(handler)
  handlerRef.current = handler

  // densable: singleKey = !(cohesion && !customized)
  const singleKey = !(cohesionFixes && !customized)

  useEffect(() => {
    if (!keybindingContext || !isActive) return
    return keybindingContext.registerHandler({
      action: 'task:background',
      context: 'Task',
      handler: () => handlerRef.current(),
      singleKey,
    })
  }, [keybindingContext, isActive, singleKey])

  const resolvedShortcut = useShortcutDisplay(
    'task:background',
    'Task',
    TASK_BACKGROUND_DEFAULT_KEY,
  )

  // densable: customized ? resolved : cohesion chord fallback
  const preferred = customized ? resolvedShortcut : TASK_BACKGROUND_COHESION_KEY
  const gateOnShortcut =
    resolvedShortcut === ''
      ? ''
      : env.terminal === 'tmux'
        ? formatTaskBackgroundTmuxShortcut(preferred)
        : preferred

  let displayShortcut: string
  if (cohesionFixes) {
    displayShortcut = gateOnShortcut
  } else if (
    env.terminal === 'tmux' &&
    resolvedShortcut === TASK_BACKGROUND_DEFAULT_KEY
  ) {
    // Legacy Bash hint used "(twice)"; SessionBackgroundHint used bare double.
    // Keep the shorter form here — callers that want "(twice)" can append.
    displayShortcut = `${TASK_BACKGROUND_DEFAULT_KEY} ${TASK_BACKGROUND_DEFAULT_KEY}`
  } else {
    displayShortcut = resolvedShortcut
  }

  return {
    cohesionFixes,
    gateOnShortcut,
    resolvedShortcut,
    displayShortcut,
  }
}
