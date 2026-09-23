/**
 * densable 2.1.251 Vd / jx / G$ — Host park mode, visibility, and
 * next-offer picker. Plugin-hint / LSP recommendation stay Host kinds
 * (they answer through Host); this file does not invent those ids.
 */

import type { ModalChromeVisibility } from './DialogHost.js'
import type { DialogSuppressReason } from './legacyDialogFocus.js'

/** densable Vd */
export type HostParkMode =
  | 'legacy-dialog'
  | 'progress'
  | 'panel'
  | 'draft'
  | 'typing'
  | null

/** densable YTe — Host parked while the prompt has unsent text. */
export const HOST_PARKED_TYPING_QUESTION =
  "Claude has a question for you — it shows once you send or clear what you're typing."

/** densable JTe */
export const HOST_PARKED_TYPING_SUGGESTION =
  "Claude has a suggestion for you — it shows once you send or clear what you're typing."

export type HostParkInputs = {
  hasLegacyDialog: boolean
  hasBlockingToolProgress: boolean
  hasLocalJsxPanel: boolean
  hasDraft: boolean
  isPromptInputActive: boolean
}

/**
 * densable Vd — first matching mode wins:
 * legacy-dialog / progress / panel / draft / typing.
 */
export function getHostParkMode(opts: HostParkInputs): HostParkMode {
  if (opts.hasLegacyDialog) return 'legacy-dialog'
  if (opts.hasBlockingToolProgress) return 'progress'
  if (opts.hasLocalJsxPanel) return 'panel'
  if (opts.hasDraft) return 'draft'
  if (opts.isPromptInputActive) return 'typing'
  return null
}

/** Map Vd onto the Host suppressReason the existing DialogHost accepts. */
export function hostParkToSuppressReason(
  mode: HostParkMode,
): DialogSuppressReason {
  if (mode === 'legacy-dialog') return 'legacy-dialog'
  if (mode === null) return null
  return 'typing'
}

export type HostDialogVisibilityInputs = {
  hasOpenDialogs: boolean
  focusedOverlay: string | undefined | null
  parkMode: HostParkMode
}

/**
 * densable jx — visible if a focused overlay is up, or Host is open
 * with no park reason; suppressed while Host is open and parked; else none.
 */
export function getHostDialogVisibility(
  opts: HostDialogVisibilityInputs,
): ModalChromeVisibility {
  const hasFocus = opts.focusedOverlay != null
  if (hasFocus || (opts.hasOpenDialogs && opts.parkMode === null)) {
    return 'visible'
  }
  return opts.hasOpenDialogs ? 'suppressed' : 'none'
}

export type NextHostOfferInputs = {
  exitFlowActive: boolean
  isPromptInputActive: boolean
  hasBlockingToolProgress: boolean
  hasLocalJsxPanel: boolean
  hasElicitationRequest: boolean
  leftArrowConfirmOpen: boolean
  isLoading: boolean
  isBgSession: boolean
  hasEffortMediumNudge: boolean
  hasOpenDialog: boolean
}

export type NextHostOffer = 'elicitation' | 'effort-medium-nudge' | undefined

/**
 * densable G$ — returns before elicitation / effort-medium while the
 * prompt is active (or exit / left-arrow / progress / panel / bg).
 */
export function pickNextHostOffer(opts: NextHostOfferInputs): NextHostOffer {
  if (opts.exitFlowActive) return undefined
  if (opts.isPromptInputActive) return undefined
  const clearOfProgressAndPanel =
    !opts.hasBlockingToolProgress && !opts.hasLocalJsxPanel
  const clearOfHost = clearOfProgressAndPanel && !opts.hasOpenDialog
  if (opts.leftArrowConfirmOpen) return undefined
  if (clearOfProgressAndPanel && opts.hasElicitationRequest) {
    return 'elicitation'
  }
  if (opts.isBgSession) return undefined
  if (clearOfHost && !opts.isLoading && opts.hasEffortMediumNudge) {
    return 'effort-medium-nudge'
  }
  return undefined
}
