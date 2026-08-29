/**
 * Modal slot context for fullscreen slash-command panes.
 *
 * FullscreenLayout provides this around its bottom-anchored modal region.
 * Pane/Tabs/Dialog read it via the same createContext instance so they can:
 * - skip their own full-width Divider (layout already draws ▔)
 * - size Select pagination to modal rows (not full terminal)
 * - own ScrollBox scroll reset on tab switch
 *
 * IMPORTANT: There must be only ONE ModalContext module instance. App code
 * must import from `@anthropic/ink` (or a re-export of this file). A second
 * `createContext` in src/context/modalContext.tsx would leave Pane's
 * useIsInsideModal() always false → double top border on /permissions etc.
 */

import { createContext, type RefObject, useContext } from 'react'
import type { ScrollBoxHandle } from '../components/ScrollBox.js'

type ModalCtx = {
  rows: number
  columns: number
  scrollRef: RefObject<ScrollBoxHandle | null> | null
  /**
   * densable lRc claimScrollBox. Outer Tyn Bxc passes null; inner lRc
   * provides a setter so a descendant (Tabs) can claim the scroller.
   */
  claimScrollBox?: ((height: number | null) => void) | null
}

export const ModalContext = createContext<ModalCtx | null>(null)

export function useIsInsideModal(): boolean {
  return useContext(ModalContext) !== null
}

/**
 * Available content rows/columns when inside a Modal, else falls back to
 * the provided terminal size. Use instead of `useTerminalSize()` when a
 * component caps its visible content height — the modal's inner area is
 * smaller than the terminal.
 */
export function useModalOrTerminalSize(fallback: {
  rows: number
  columns: number
}): { rows: number; columns: number } {
  const ctx = useContext(ModalContext)
  return ctx ? { rows: ctx.rows, columns: ctx.columns } : fallback
}

export function useModalScrollRef(): RefObject<ScrollBoxHandle | null> | null {
  return useContext(ModalContext)?.scrollRef ?? null
}

/** densable lRc claimScrollBox from inner ModalContext. */
export function useModalClaimScrollBox():
  | ((height: number | null) => void)
  | null
  | undefined {
  return useContext(ModalContext)?.claimScrollBox
}
