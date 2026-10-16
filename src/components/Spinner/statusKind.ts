import { formatDuration } from '../../utils/format.js'
import { progressiveThinkingLabel } from './thinkingFade.js'

/** densable qn — ping-pong frame period for Xn. */
export const SPINNER_FRAME_PERIOD_MS = 2000

/** densable Un — stall telemetry thresholds. */
export const STALL_TELEMETRY_THRESHOLDS_MS = [10_000, 45_000, 300_000] as const

/** densable Fe window. */
export type SpinnerToolWindow = {
  toolWindowStart: number | null
  toolWindowEnd: number | null
  thinkingBurstStart: number | null
  wasThinking: boolean
}

export type SpinnerStatusKind =
  | { kind: 'tool-running'; toolMs: number }
  | { kind: 'tool-done'; toolMs: number }
  | { kind: 'recovering'; recovery: { attempt: number; limit: number } }
  | { kind: 'thinking'; thinkingMs: number }
  | { kind: 'thought-for'; thoughtMs: number }
  | { kind: 'none' }

export type OutputLimitRecovery = {
  attempt: number
  limit: number
}

export function emptySpinnerToolWindow(): SpinnerToolWindow {
  return {
    toolWindowStart: null,
    toolWindowEnd: null,
    thinkingBurstStart: null,
    wasThinking: false,
  }
}

/** densable Fe. */
export function advanceSpinnerToolWindow(
  prev: SpinnerToolWindow,
  input: {
    now: number
    isThinking: boolean
    hasActiveTools: boolean
    thinkingStatus: 'thinking' | number | null
  },
): SpinnerToolWindow {
  let { toolWindowStart, toolWindowEnd, thinkingBurstStart } = prev
  if (input.hasActiveTools) {
    if (toolWindowStart === null || toolWindowEnd !== null) {
      toolWindowStart = input.now
    }
    toolWindowEnd = null
  } else if (toolWindowStart !== null && toolWindowEnd === null) {
    toolWindowEnd = input.now
  }
  if (!input.hasActiveTools && input.thinkingStatus !== null) {
    toolWindowStart = null
    toolWindowEnd = null
  }
  if (input.isThinking) {
    if (!prev.wasThinking) thinkingBurstStart = input.now
  } else {
    thinkingBurstStart = null
  }
  return {
    toolWindowStart,
    toolWindowEnd,
    thinkingBurstStart,
    wasThinking: input.isThinking,
  }
}

/** densable qe. */
export function resolveSpinnerStatusKind(
  window: SpinnerToolWindow,
  input: {
    now: number
    hasActiveTools: boolean
    thinkingStatus: 'thinking' | number | null
    showToolCallTimer: boolean
    outputLimitRecovery: OutputLimitRecovery | null
  },
): SpinnerStatusKind {
  if (
    input.showToolCallTimer &&
    input.hasActiveTools &&
    window.toolWindowStart !== null
  ) {
    const toolMs = input.now - window.toolWindowStart
    if (toolMs >= 2000) return { kind: 'tool-running', toolMs }
  }
  if (input.outputLimitRecovery !== null && !input.hasActiveTools) {
    return { kind: 'recovering', recovery: input.outputLimitRecovery }
  }
  if (
    input.showToolCallTimer &&
    !input.hasActiveTools &&
    input.thinkingStatus === null &&
    window.toolWindowStart !== null &&
    window.toolWindowEnd !== null
  ) {
    const toolMs = window.toolWindowEnd - window.toolWindowStart
    if (toolMs >= 2000) return { kind: 'tool-done', toolMs }
  }
  if (input.thinkingStatus === 'thinking' && !input.hasActiveTools) {
    return {
      kind: 'thinking',
      thinkingMs:
        window.thinkingBurstStart !== null
          ? input.now - window.thinkingBurstStart
          : 0,
    }
  }
  if (typeof input.thinkingStatus === 'number') {
    return { kind: 'thought-for', thoughtMs: input.thinkingStatus }
  }
  return { kind: 'none' }
}

/** densable eo. */
export function recoveringLabel(recovery: {
  attempt: number
  limit: number
}): string {
  return recovery.attempt > 1
    ? `picking the thought back up (${recovery.attempt} of ${recovery.limit})`
    : 'picking the thought back up'
}

export function thoughtForLabel(thoughtMs: number): string {
  return `thought for ${Math.max(1, Math.round(thoughtMs / 1000))}s`
}

/** densable Je lt switch. */
export function formatSpinnerStatusText(
  status: SpinnerStatusKind,
  effortSuffix: string,
): { text: string | null; progressiveThinkingBase: string } {
  const progressiveThinkingBase =
    status.kind === 'thinking'
      ? progressiveThinkingLabel(status.thinkingMs)
      : 'thinking'
  switch (status.kind) {
    case 'tool-running':
      return {
        text: `running tool for ${formatDuration(status.toolMs)}`,
        progressiveThinkingBase,
      }
    case 'tool-done':
      return {
        text: `ran tool for ${formatDuration(status.toolMs)}`,
        progressiveThinkingBase,
      }
    case 'recovering':
      return {
        text: recoveringLabel(status.recovery),
        progressiveThinkingBase,
      }
    case 'thinking':
      return {
        text: `${progressiveThinkingBase}${effortSuffix}`,
        progressiveThinkingBase,
      }
    case 'thought-for':
      return {
        text: thoughtForLabel(status.thoughtMs),
        progressiveThinkingBase,
      }
    case 'none':
      return { text: null, progressiveThinkingBase }
  }
}

/**
 * densable jTt(e,r) — cosine pulse 0..1 over period r.
 * Rte reduced-motion uses 1-jTt(time, 2000); Xn uses jTt(time, 2000).
 */
export function cosinePulse(time: number, periodMs: number): number {
  return (1 - Math.cos((2 * Math.PI * time) / periodMs)) / 2
}

/**
 * densable Xn — map jTt pulse onto h7t base frames (not ping-pong).
 * Gold: `Math.round(jTt(time, qn) * (h7t().length - 1))`.
 */
export function pingPongFrameIndex(
  time: number,
  frameCount: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0
  const pulse = cosinePulse(time, SPINNER_FRAME_PERIOD_MS)
  return Math.round(pulse * (frameCount - 1))
}
