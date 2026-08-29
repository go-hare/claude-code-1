/**
 * densable `bp.legacyDialogFocus` + `uQc` / `oIA` / `zIr`.
 *
 * Gold (239 SEA):
 *   legacyDialogFocus = yP({ focus: null })
 *   uQc(e)  → setState focus
 *   oIA()   → focus !== null (hook)
 *   Zwn()   → IW.active (promptInputCursorStore.active)
 *   zIr()   → oIA() ? "legacy-dialog" : Zwn() ? "typing" : null
 *   RPs()   → !KUe() ? "none" : zIr()!=null ? "suppressed" : "visible"
 *   dQc()   → zIr()!=null ? null : wrs()
 *
 * REPL sync: useLayoutEffect(() => (uQc(legacyFocusForUqc(e$)), () => uQc(null)), [e$])
 * Tip `focusedInputDialog` is a SUPERSET of gold `_Zt`. Only allowlisted focus
 * ids enter uQc — Host-owned NMs (permission / managed-settings) and any future
 * Host kind stay out, or dQc would self-suppress the Host that paints them.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from '../state/store.js'
import {
  getPromptInputCursorState,
  subscribePromptInputCursorStore,
} from '../utils/promptInputCursorStore.js'

export type LegacyDialogFocus = string | null

/**
 * densable `_Zt` returns (239 SEA) + tip focused overlays that are NOT NMs Host.
 * Allowlist — unknown / Host-owned tip ids map to null for uQc.
 */
const UQC_FOCUS_ALLOWLIST = new Set<string>([
  // gold _Zt
  'message-selector',
  'left-arrow-confirm',
  'worker-sandbox-permission',
  'elicitation',
  'ultraplan-choice',
  'ultraplan-launch',
  'remote-callout',
  'fullscreen-upsell',
  'lsp-recommendation',
  'plugin-hint',
  // tip focused overlays (not DialogHost content)
  'prompt',
  'model-switch',
  'undercover-callout',
  'effort-callout',
  'search-extra-tools-hint',
  'desktop-upsell',
])

/**
 * Map tip focusedInputDialog → value for densable uQc.
 * Allowlist only; Host-owned / unknown → null.
 */
export function legacyFocusForUqc(
  focusedInputDialog: string | undefined | null,
): LegacyDialogFocus {
  if (focusedInputDialog == null) return null
  return UQC_FOCUS_ALLOWLIST.has(focusedInputDialog) ? focusedInputDialog : null
}

/** @internal test — densable uQc allowlist */
export const UQC_FOCUS_ALLOWLIST_FOR_TEST = UQC_FOCUS_ALLOWLIST

type LegacyDialogFocusState = {
  focus: LegacyDialogFocus
}

const store = createStore<LegacyDialogFocusState>({ focus: null })

/** densable uQc — mirror gold `_Zt` focus into the process store. */
export function setLegacyDialogFocus(focus: LegacyDialogFocus): void {
  store.setState(prev => (prev.focus === focus ? prev : { focus }))
}

/** densable uQc(null) clear — also used as effect cleanup. */
export function clearLegacyDialogFocus(): void {
  setLegacyDialogFocus(null)
}

export function getLegacyDialogFocus(): LegacyDialogFocus {
  return store.getState().focus
}

/** densable oIA — true when a legacy (_Zt) dialog holds focus. */
export function useHasLegacyDialogFocus(): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().focus !== null,
    () => store.getState().focus !== null,
  )
}

/** densable Zwn — IW.active (prompt typing suppression latch). */
export function useIsPromptInputTypingActive(): boolean {
  return useSyncExternalStore(
    subscribePromptInputCursorStore,
    () => getPromptInputCursorState().active,
    () => getPromptInputCursorState().active,
  )
}

export type DialogSuppressReason = 'typing' | 'legacy-dialog' | null

/**
 * densable zIr — Host / RPs suppress reason.
 * Hook: must be called during render (subscribes to both stores).
 */
export function useDialogSuppressReason(): DialogSuppressReason {
  const legacy = useHasLegacyDialogFocus()
  const typing = useIsPromptInputTypingActive()
  if (legacy) return 'legacy-dialog'
  if (typing) return 'typing'
  return null
}

/**
 * densable zIr as a pure snapshot (tests / non-React). Prefer the hook in UI.
 */
export function getDialogSuppressReason(): DialogSuppressReason {
  if (store.getState().focus !== null) return 'legacy-dialog'
  if (getPromptInputCursorState().active) return 'typing'
  return null
}

/** Test helper — reset module store. */
export function resetLegacyDialogFocusForTests(): void {
  store.setState(() => ({ focus: null }))
}
