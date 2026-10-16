import { useRef } from 'react'

/** densable Ye — stall after 10s, fade over 10s. */
export const STALL_AFTER_MS = 10_000
export const STALL_FADE_MS = 10_000

// Hook to handle the transition to red when tokens stop flowing.
// Driven by the parent's animation clock time instead of independent intervals,
// so it slows down when the terminal is blurred.
export function useStalledAnimation(
  time: number,
  currentResponseLength: number,
  hasActiveTools = false,
  reducedMotion = false,
  agentId?: string,
): {
  isStalled: boolean
  stalledIntensity: number
  timeSinceLastToken: number
} {
  const lastTokenTime = useRef(time)
  const lastResponseLength = useRef(currentResponseLength)
  const stalledIntensityRef = useRef(0)
  const lastSmoothTime = useRef(time)
  const agentIdRef = useRef(agentId)

  // densable Ye: length up OR agentId change resets stall; length down only tracks baseline.
  if (
    currentResponseLength > lastResponseLength.current ||
    agentIdRef.current !== agentId
  ) {
    agentIdRef.current = agentId
    lastTokenTime.current = time
    lastResponseLength.current = currentResponseLength
    stalledIntensityRef.current = 0
    lastSmoothTime.current = time
  } else if (currentResponseLength < lastResponseLength.current) {
    lastResponseLength.current = currentResponseLength
  }

  // densable Ye: hold (tools / thinking / pause / compact-not-responding) zeros E.
  let timeSinceLastToken: number
  if (hasActiveTools) {
    timeSinceLastToken = 0
    lastTokenTime.current = time
  } else {
    timeSinceLastToken = time - lastTokenTime.current
  }

  const isStalled = timeSinceLastToken > STALL_AFTER_MS && !hasActiveTools
  const intensity = isStalled
    ? Math.min((timeSinceLastToken - STALL_AFTER_MS) / STALL_FADE_MS, 1)
    : 0

  // Smooth intensity transition driven by animation frame ticks
  if (!reducedMotion && (intensity > 0 || stalledIntensityRef.current > 0)) {
    const dt = time - lastSmoothTime.current
    if (dt >= 50) {
      const steps = Math.floor(dt / 50)
      let current = stalledIntensityRef.current
      for (let i = 0; i < steps; i++) {
        const diff = intensity - current
        if (Math.abs(diff) < 0.01) {
          current = intensity
          break
        }
        current += diff * 0.1
      }
      stalledIntensityRef.current = current
      lastSmoothTime.current = time
    }
  } else {
    stalledIntensityRef.current = intensity
    lastSmoothTime.current = time
  }

  const effectiveIntensity = reducedMotion
    ? intensity
    : stalledIntensityRef.current

  return {
    isStalled,
    stalledIntensity: effectiveIntensity,
    timeSinceLastToken,
  }
}
