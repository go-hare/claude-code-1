import { feature } from 'bun:bundle'
import { useEffect, useRef } from 'react'
import { getTerminalFocusState, subscribeTerminalFocus } from '@anthropic/ink'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { generateAwaySummary } from '../services/awaySummary.js'
import { useAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import { isAwaySummaryEnvEnabled } from '../utils/residualFinalEnvGates.js'
import { createAwaySummaryMessage } from '../utils/messages.js'

const BLUR_DELAY_MS = 5 * 60_000

type SetMessages = (updater: (prev: Message[]) => Message[]) => void

function hasSummarySinceLastUserTurn(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'user' && !m.isMeta && !m.isCompactSummary) return false
    if (m.type === 'system' && m.subtype === 'away_summary') return true
  }
  return false
}

/**
 * densable XiH — live recap gate. Env force-on overrides `/config` off;
 * defined-falsy env force-off; else AppState/settings `=== false` wins.
 */
export function isAwaySummaryLiveEnabled(opts: {
  awaySummaryEnabled: boolean | undefined
  gbEnabled: boolean
  featureOn: boolean
  env?: NodeJS.ProcessEnv
}): boolean {
  const env = opts.env ?? process.env
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY)) return false
  if (isAwaySummaryEnvEnabled(env)) return true
  if (!opts.featureOn) return false
  if (!opts.gbEnabled) return false
  if (opts.awaySummaryEnabled === false) return false
  return true
}

/**
 * generate() first check — off must not append even if the timer already fired.
 */
export function shouldGenerateAwaySummary(opts: {
  awaySummaryEnabled: boolean | undefined
  gbEnabled: boolean
  featureOn: boolean
  messages: readonly Message[]
  env?: NodeJS.ProcessEnv
}): boolean {
  if (!isAwaySummaryLiveEnabled(opts)) return false
  if (hasSummarySinceLastUserTurn(opts.messages)) return false
  return true
}

/**
 * Appends a "while you were away" summary message after the terminal has been
 * blurred for 5 minutes. Fires only when (a) 5min since blur, (b) no turn in
 * progress, and (c) no existing away_summary since the last user message.
 *
 * For terminals that don't support DECSET 1004 focus events (CMD, PowerShell),
 * falls back to idle-based detection: starts an idle timer after each turn
 * ends, resets it when the user starts a new turn.
 */
export function useAwaySummary(
  messages: readonly Message[],
  setMessages: SetMessages,
  isLoading: boolean,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const isLoadingRef = useRef(isLoading)
  const pendingRef = useRef(false)
  const generateRef = useRef<(() => Promise<void>) | null>(null)
  const awaySummaryEnabled = useAppState(s => s.awaySummaryEnabled)
  const awaySummaryEnabledRef = useRef(awaySummaryEnabled)

  messagesRef.current = messages
  isLoadingRef.current = isLoading
  awaySummaryEnabledRef.current = awaySummaryEnabled

  const gbEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_sedge_lantern',
    false,
  )
  const featureOn = feature('AWAY_SUMMARY') ? true : false

  useEffect(() => {
    if (
      !isAwaySummaryLiveEnabled({
        awaySummaryEnabled,
        gbEnabled,
        featureOn,
      })
    ) {
      return
    }

    function clearTimer(): void {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    function abortInFlight(): void {
      abortRef.current?.abort()
      abortRef.current = null
    }

    async function generate(): Promise<void> {
      pendingRef.current = false
      if (
        !shouldGenerateAwaySummary({
          awaySummaryEnabled: awaySummaryEnabledRef.current,
          gbEnabled,
          featureOn,
          messages: messagesRef.current,
        })
      ) {
        return
      }
      abortInFlight()
      const controller = new AbortController()
      abortRef.current = controller
      const text = await generateAwaySummary(
        messagesRef.current,
        controller.signal,
      )
      if (controller.signal.aborted || text === null) return
      if (
        !isAwaySummaryLiveEnabled({
          awaySummaryEnabled: awaySummaryEnabledRef.current,
          gbEnabled,
          featureOn,
        })
      ) {
        return
      }
      setMessages(prev => [...prev, createAwaySummaryMessage(text)])
    }

    function onBlurTimerFire(): void {
      timerRef.current = null
      if (isLoadingRef.current) {
        pendingRef.current = true
        return
      }
      void generate()
    }

    function onFocusChange(): void {
      const state = getTerminalFocusState()
      if (state === 'blurred' || state === 'unknown') {
        // For 'unknown' terminals (CMD, PowerShell), treat mount as
        // potentially away — start idle timer. The isLoading effect
        // below resets the timer on each turn transition.
        clearTimer()
        timerRef.current = setTimeout(onBlurTimerFire, BLUR_DELAY_MS)
      } else if (state === 'focused') {
        clearTimer()
        abortInFlight()
        pendingRef.current = false
      }
    }

    const unsubscribe = subscribeTerminalFocus(onFocusChange)
    // Handle the case where we're already blurred when the effect mounts
    onFocusChange()
    generateRef.current = generate

    return () => {
      unsubscribe()
      clearTimer()
      abortInFlight()
      generateRef.current = null
    }
  }, [gbEnabled, setMessages, awaySummaryEnabled, featureOn])

  // Timer fired mid-turn → fire when turn ends (if still away)
  useEffect(() => {
    if (isLoading) return
    if (!pendingRef.current) return
    if (
      !isAwaySummaryLiveEnabled({
        awaySummaryEnabled: awaySummaryEnabledRef.current,
        gbEnabled,
        featureOn,
      })
    ) {
      return
    }
    const state = getTerminalFocusState()
    if (state !== 'blurred' && state !== 'unknown') return
    void generateRef.current?.()
  }, [isLoading, gbEnabled, featureOn])

  // For 'unknown' terminals: use isLoading transitions as presence signal.
  // User starts a turn → they're present, cancel idle timer.
  // Turn ends → restart idle timer.
  useEffect(() => {
    if (getTerminalFocusState() !== 'unknown') return
    if (
      !isAwaySummaryLiveEnabled({
        awaySummaryEnabled: awaySummaryEnabledRef.current,
        gbEnabled,
        featureOn,
      })
    ) {
      return
    }

    if (isLoading) {
      // User is actively using — cancel idle timer
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      abortRef.current?.abort()
      abortRef.current = null
      pendingRef.current = false
    } else {
      // Turn ended — restart idle timer
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (isLoadingRef.current) {
          pendingRef.current = true
          return
        }
        void generateRef.current?.()
      }, BLUR_DELAY_MS)
    }
  }, [isLoading, gbEnabled, awaySummaryEnabled, featureOn])
}
