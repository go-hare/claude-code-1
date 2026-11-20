import { createContext } from 'react'

/**
 * Official 2.1.328 `SY` / `JCs` — render pacing context used by `useVirtualScroll`
 * (`fb`) to decide whether sticky tail range updates can bypass `useDeferredValue`.
 */
export type RenderPacing = {
  deferred: <T>(fn: () => T) => T
  paced: <T extends (...args: never[]) => unknown>(fn: T) => T
  flush: () => void
  isDeferring: () => boolean
}

export const DEFAULT_RENDER_PACING: RenderPacing = {
  deferred: fn => fn(),
  paced: fn => fn,
  flush: () => {},
  isDeferring: () => false,
}

export const RenderPacingContext = createContext<RenderPacing | null>(null)
