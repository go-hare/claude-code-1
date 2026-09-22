import { useCallback, useRef, useState } from 'react'

/**
 * densable 2.1.248 chunk-zjmyxdw3 — Ky / sa / ed / Is / Hi / Q$e.
 * Used by official X login_handoff refuse-within (`d` / `Ke`).
 */
/** densable Ky */
export const REFUSE_WITHIN_DEFAULT_MS = 150
/** densable sa — X `c=sa` for Is(c) / de(c) / Hs(..., c) / windowMs */
export const LOGIN_HANDOFF_WINDOW_MS = 250

/** densable ed */
export function isWithinRefuseWindow(
  fromMs: number,
  windowMs: number = REFUSE_WITHIN_DEFAULT_MS,
): boolean {
  const elapsed = Date.now() - fromMs
  return elapsed >= 0 && elapsed < windowMs
}

/** densable Is */
export function useIsWithinWindow(
  windowMs: number = REFUSE_WITHIN_DEFAULT_MS,
): () => boolean {
  const start = useRef(Date.now())
  return useCallback(
    () => isWithinRefuseWindow(start.current, windowMs),
    [windowMs],
  )
}

/** densable Hi / Q$e */
export function useRefusedWithin(): {
  refusedWithin: (windowMs?: number) => boolean
  noteRefused: () => void
  epoch: number
} {
  const at = useRef<number | null>(null)
  const [epoch, setEpoch] = useState(0)
  const noteRefused = useCallback(() => {
    at.current = Date.now()
    setEpoch(n => n + 1)
  }, [])
  const refusedWithin = useCallback(
    (windowMs: number = REFUSE_WITHIN_DEFAULT_MS) =>
      at.current !== null && isWithinRefuseWindow(at.current, windowMs),
    [],
  )
  return { refusedWithin, noteRefused, epoch }
}
