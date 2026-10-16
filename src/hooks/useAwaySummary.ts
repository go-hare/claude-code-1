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

/** densable hrt=180000 — generate recap while blurred (not on focus). */
const BLUR_DELAY_MS = 180_000
/** densable xgo=30000 — Lgo floor for GB delayMs. */
const MIN_RECAP_DELAY_MS = 30_000
/** densable Dgo=3 — first N recaps append disable-in-/config trailer. */
const RECAP_TRAILER_COUNT = 3
const RECAP_TRAILER = ' (disable recaps in /config)'
/** densable Igo=3 / Ego=2 — human turns before first recap / between recaps. */
const MIN_USERS_BEFORE_FIRST_RECAP = 3
const MIN_USERS_SINCE_LAST_RECAP = 2

type SetMessages = (updater: (prev: Message[]) => Message[]) => void

function isHumanUserTurn(m: Message): boolean {
  return m.type === 'user' && !m.isMeta && !m.isCompactSummary && !m.isVirtual
}

function hasSummarySinceLastUserTurn(messages: readonly Message[]): boolean {
  const last = messages.at(-1)
  return last?.type === 'system' && last.subtype === 'away_summary'
}

/** densable Ogo — enough human turns to warrant a recap. */
export function shouldRecapByTurnCount(messages: readonly Message[]): boolean {
  let users = 0
  let lastRecap = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (isHumanUserTurn(m)) users++
    if (m.type === 'system' && m.subtype === 'away_summary') lastRecap = i
  }
  if (users < MIN_USERS_BEFORE_FIRST_RECAP) return false
  if (lastRecap === -1) return true
  let since = 0
  for (let i = lastRecap + 1; i < messages.length; i++) {
    if (isHumanUserTurn(messages[i]!)) since++
  }
  return since >= MIN_USERS_SINCE_LAST_RECAP
}

/**
 * densable Lgo — GB `tengu_sedge_lantern_config.delayMs`, floor xgo, else hrt.
 */
export function resolveRecapDelayMs(
  config?: { delayMs?: unknown } | null,
): number {
  const resolved =
    config !== undefined
      ? config
      : getFeatureValue_CACHED_MAY_BE_STALE('tengu_sedge_lantern_config', {
          delayMs: BLUR_DELAY_MS,
        })
  const delay = resolved?.delayMs
  if (typeof delay === 'number' && Number.isFinite(delay)) {
    return Math.max(MIN_RECAP_DELAY_MS, delay)
  }
  return BLUR_DELAY_MS
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
  // densable Ube: enabled = awaySummaryEnabled (GB only tunes delayMs).
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
  if (!shouldRecapByTurnCount(opts.messages)) return false
  return true
}

/**
 * densable Hbe: generate recap while blurred (~3 min, hrt). Do not abort on
 * focus — the recap must already be in the transcript when the user returns.
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
  const recapCountRef = useRef(0)
  const lastTurnEndRef = useRef<number | null>(null)
  const wasLoadingRef = useRef(isLoading)
  const generateRef = useRef<(() => Promise<void>) | null>(null)
  const armAwayTimerRef = useRef<(() => void) | null>(null)
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
      const n = recapCountRef.current
      recapCountRef.current = n + 1
      const content = n < RECAP_TRAILER_COUNT ? `${text}${RECAP_TRAILER}` : text
      setMessages(prev => [...prev, createAwaySummaryMessage(content)])
    }

    function armAwayTimer(): void {
      clearTimer()
      if (isLoadingRef.current) return
      // densable #P: #r null → no wait. Remaining = Lgo − elapsed since turn-end.
      const turnEnd = lastTurnEndRef.current
      if (turnEnd === null) return
      const remaining = Math.max(
        0,
        resolveRecapDelayMs() - (Date.now() - turnEnd),
      )
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (isLoadingRef.current) {
          pendingRef.current = true
          return
        }
        const focus = getTerminalFocusState()
        if (focus !== 'blurred' && focus !== 'unknown') return
        void generate()
      }, remaining)
    }

    function onFocusChange(): void {
      const state = getTerminalFocusState()
      if (state === 'blurred') {
        // densable #M blurred → #P
        armAwayTimer()
        return
      }
      if (state === 'unknown') {
        // no DECSET 1004: turn-end effect arms idle timer
        return
      }
      if (state === 'focused') {
        // densable #M focused: clear wait timer; do NOT abort in-flight generate.
        clearTimer()
        pendingRef.current = false
      }
    }

    const unsubscribe = subscribeTerminalFocus(onFocusChange)
    // Handle the case where we're already blurred when the effect mounts
    onFocusChange()
    generateRef.current = generate
    armAwayTimerRef.current = armAwayTimer

    return () => {
      unsubscribe()
      clearTimer()
      abortInFlight()
      generateRef.current = null
      armAwayTimerRef.current = null
    }
  }, [gbEnabled, setMessages, awaySummaryEnabled, featureOn])

  // densable setInputs: turn-end (#o false) → #P if still away.
  // unknown terminals KEEP idle-after-turn (gold #P fire is blurred-only).
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      lastTurnEndRef.current = Date.now()
    }
    wasLoadingRef.current = isLoading

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
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const state = getTerminalFocusState()
    if (pendingRef.current) {
      pendingRef.current = false
      if (state === 'blurred' || state === 'unknown') {
        void generateRef.current?.()
      }
      return
    }

    if (state === 'blurred' || state === 'unknown') {
      armAwayTimerRef.current?.()
    }
  }, [isLoading, gbEnabled, awaySummaryEnabled, featureOn])
}
