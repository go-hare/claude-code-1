import { useEffect, useRef, type MutableRefObject } from 'react'
import { useTheme } from '@anthropic/ink'
import type { useSelection } from '@anthropic/ink'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getGlobalConfig } from '../utils/config.js'
import { getTheme } from '../utils/theme.js'

type Selection = ReturnType<typeof useSelection>

/** densable y8i branch classifier — pure, unit-tested. */
export type CopyOnSelectSettle =
  | { kind: 'reset' }
  | { kind: 'spurious' }
  | { kind: 'skip' }
  | { kind: 'whitespace' }
  | { kind: 'copy'; text: string }

export function classifyCopyOnSelectSettle(input: {
  isDragging: boolean
  hasSelection: boolean
  alreadyCopied: boolean
  copyOnSelect: boolean
  text: string
}): CopyOnSelectSettle {
  if (input.isDragging || !input.hasSelection) return { kind: 'reset' }
  if (input.alreadyCopied) return { kind: 'spurious' }
  if (!input.copyOnSelect) return { kind: 'skip' }
  if (!input.text || !input.text.trim()) return { kind: 'whitespace' }
  return { kind: 'copy', text: input.text }
}

/**
 * densable 2.1.234 `y8i` — auto-copy selection on mouse-up / multi-click.
 * Mirrors iTerm2's "Copy to pasteboard on selection" — the highlight is left
 * intact so the user can see what was copied. Only fires in alt-screen mode
 * (selection state is ink-instance-owned; outside alt-screen, the native
 * terminal handles selection and this hook is a no-op via the ink stub).
 *
 * selection.subscribe fires on every mutation (start/update/finish/clear/
 * multiclick). Both char drags and multi-clicks set isDragging=true while
 * pressed, so a selection appearing with isDragging=false is always a
 * drag-finish. copiedRef guards against double-firing on spurious notifies.
 *
 * onCopied is optional — when omitted, copy is silent (clipboard is written
 * but no toast/notification fires). FleetView uses this silent mode; the
 * fullscreen REPL passes showCopiedToast for user feedback.
 *
 * lastCopiedRef (densable 4th arg `n`) caches the last auto-copied text so
 * ctrl+c can clear+toast without re-copying (and without losing chars when
 * the selection screen buffer has already moved). Cleared on drag/clear/
 * already-copied spurious notify, matching SEA `y8i`.
 */
export function useCopyOnSelect(
  selection: Selection,
  isActive: boolean,
  onCopied?: (text: string) => void,
  lastCopiedRef?: MutableRefObject<string | null>,
): void {
  // Tracks whether the *previous* notification had a visible selection with
  // isDragging=false (i.e., we already auto-copied it). Without this, the
  // finish→clear transition would look like a fresh selection-gone-idle
  // event and we'd toast twice for a single drag.
  const copiedRef = useRef(false)
  // onCopied is a fresh closure each render; read through a ref so the
  // effect doesn't re-subscribe (which would reset copiedRef via unmount).
  // densable: i=Dhr.useEffectEvent((s)=>r?.(s))
  const onCopiedRef = useRef(onCopied)
  onCopiedRef.current = onCopied

  useEffect(() => {
    if (!isActive) return

    const unsubscribe = selection.subscribe(() => {
      const enabled = getGlobalConfig().copyOnSelect ?? true
      // Only extract text when we might copy — densable calls copySelectionNoClear
      // after the early gates; for classifier we need text only past alreadyCopied.
      const isDragging = Boolean(selection.getState()?.isDragging)
      const has = selection.hasSelection()
      const alreadyCopied = copiedRef.current
      // densable early gates before copySelectionNoClear
      if (isDragging || !has) {
        copiedRef.current = false
        if (lastCopiedRef) lastCopiedRef.current = null
        return
      }
      if (alreadyCopied) {
        if (lastCopiedRef) lastCopiedRef.current = null
        return
      }
      if (!enabled) return

      const text = selection.copySelectionNoClear()
      const settle = classifyCopyOnSelectSettle({
        isDragging: false,
        hasSelection: true,
        alreadyCopied: false,
        copyOnSelect: true,
        text,
      })
      if (settle.kind === 'whitespace') {
        copiedRef.current = true
        return
      }
      if (settle.kind !== 'copy') return

      copiedRef.current = true
      if (lastCopiedRef) lastCopiedRef.current = settle.text
      // densable `_e("clipboard_write")` → tengu_feature_ok
      logEvent('tengu_feature_ok', {
        feature_name:
          'clipboard_write' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      onCopiedRef.current?.(settle.text)
    })
    return unsubscribe
  }, [isActive, selection, lastCopiedRef])
}

/**
 * Pipe the theme's selectionBg color into the Ink StylePool so the
 * selection overlay renders a solid blue bg instead of SGR-7 inverse.
 * Ink is theme-agnostic (layering: colorize.ts "theme resolution happens
 * at component layer, not here") — this is the bridge. Fires on mount
 * (before any mouse input is possible) and again whenever /theme flips,
 * so the selection color tracks the theme live.
 */
export function useSelectionBgColor(selection: Selection): void {
  const [themeName] = useTheme()
  useEffect(() => {
    selection.setSelectionBgColor(getTheme(themeName).selectionBg)
  }, [selection, themeName])
}
