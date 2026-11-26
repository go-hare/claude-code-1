import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'
import {
  DEFAULT_MAX_DRAFT_PROMPTS_PER_SESSION,
  DEFAULT_MAX_TOOL_CALLS_PER_SESSION,
  FEEDBACK_TURNOFF_PROMPT_DECLINE_CAP,
  MAX_DRAFT_PROMPTS_PER_SESSION_CAP,
  MAX_TOOL_CALLS_PER_SESSION_CAP,
} from './constants.js'

export type JuniperRelayConfig = {
  description?: string
  prompt?: string
  maxToolCallsPerSession?: number
  maxDraftPromptsPerSession?: number
}

export type FeedbackDraftNotice = {
  draftId: string
  title: string
  type: string
  detailsPreview: string
}

export type FeedbackNoticeState = {
  notice: FeedbackDraftNotice | null
  shownLoggedForDraftId: string | null
  promptedCount: number
  sessionDraftCount: number
  seededFromDisk: boolean
  seedStarted: boolean
  toolCallCount: number
}

const initialNoticeState: FeedbackNoticeState = {
  notice: null,
  shownLoggedForDraftId: null,
  promptedCount: 0,
  sessionDraftCount: 0,
  seededFromDisk: false,
  seedStarted: false,
  toolCallCount: 0,
}

class FeedbackNoticeSessionState {
  noticeState: FeedbackNoticeState = { ...initialNoticeState }
  noticeListeners = new Set<() => void>()
}

const fallbackFeedbackNoticeSession = { root: {} as object }
const feedbackNoticeBySession = new RootSessionSlot<FeedbackNoticeSessionState>(
  () => new FeedbackNoticeSessionState(),
)

function getFeedbackNoticeSessionState(): FeedbackNoticeSessionState {
  try {
    const session = getBootstrapSession()
    if (session?.root) return feedbackNoticeBySession.of(session)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return feedbackNoticeBySession.of(fallbackFeedbackNoticeSession)
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback
}

/** densable leftover j_e */
export function getJuniperRelayConfig(): JuniperRelayConfig {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_juniper_relay_config',
    {},
  )
  return raw !== null && typeof raw === 'object'
    ? (raw as JuniperRelayConfig)
    : {}
}

/** densable leftover LKe */
export function getMaxToolCallsPerSession(): number {
  return clampInt(
    getJuniperRelayConfig().maxToolCallsPerSession,
    DEFAULT_MAX_TOOL_CALLS_PER_SESSION,
    1,
    MAX_TOOL_CALLS_PER_SESSION_CAP,
  )
}

/** densable leftover tgr */
export function getMaxDraftPromptsPerSession(): number {
  return clampInt(
    getJuniperRelayConfig().maxDraftPromptsPerSession,
    DEFAULT_MAX_DRAFT_PROMPTS_PER_SESSION,
    0,
    MAX_DRAFT_PROMPTS_PER_SESSION_CAP,
  )
}

function emitNoticeChange(
  state: FeedbackNoticeSessionState = getFeedbackNoticeSessionState(),
): void {
  for (const listener of state.noticeListeners) listener()
}

export function getFeedbackNoticeState(): FeedbackNoticeState {
  return getFeedbackNoticeSessionState().noticeState
}

/** densable leftover `_6` store subscribe. */
export function subscribeFeedbackNotice(listener: () => void): () => void {
  const listeners = getFeedbackNoticeSessionState().noticeListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setFeedbackNoticeState(
  update: (prev: FeedbackNoticeState) => FeedbackNoticeState,
): FeedbackNoticeState {
  const state = getFeedbackNoticeSessionState()
  const next = update(state.noticeState)
  if (next !== state.noticeState) {
    state.noticeState = next
    emitNoticeChange(state)
  }
  return state.noticeState
}

export function resetFeedbackNoticeStateForTests(): void {
  getFeedbackNoticeSessionState().noticeState = { ...initialNoticeState }
}

/** densable leftover Rgr */
export function tryConsumeSendFeedbackCall(): boolean {
  let allowed = false
  setFeedbackNoticeState(prev => {
    if (prev.toolCallCount >= getMaxToolCallsPerSession()) return prev
    allowed = true
    return { ...prev, toolCallCount: prev.toolCallCount + 1 }
  })
  return allowed
}

/** densable leftover Cgr */
export function queueFeedbackDraftNotice(
  notice: FeedbackDraftNotice,
): 'silent' | 'notice_pending' {
  let presentation: 'silent' | 'notice_pending' = 'silent'
  setFeedbackNoticeState(prev => {
    const next = { ...prev, sessionDraftCount: prev.sessionDraftCount + 1 }
    if (prev.notice !== null) {
      presentation = 'notice_pending'
      next.notice = notice
      return next
    }
    if (prev.promptedCount >= getMaxDraftPromptsPerSession()) {
      presentation = 'silent'
      return next
    }
    next.promptedCount = prev.promptedCount + 1
    presentation = 'notice_pending'
    next.notice = notice
    return next
  })
  return presentation
}

/** densable leftover Agr */
export function decrementSessionDraftCount(count = 1): void {
  setFeedbackNoticeState(prev => ({
    ...prev,
    sessionDraftCount: Math.max(0, prev.sessionDraftCount - count),
  }))
}

/** densable leftover Iwc */
export function clearFeedbackNoticeForDraft(draftId: string): void {
  setFeedbackNoticeState(prev =>
    prev.notice?.draftId === draftId ? { ...prev, notice: null } : prev,
  )
}

/** densable leftover Mwc */
export function clearFeedbackNotice(): void {
  setFeedbackNoticeState(prev =>
    prev.notice === null ? prev : { ...prev, notice: null },
  )
}

/** densable leftover Owc */
export function markFeedbackNoticeShown(draftId: string): boolean {
  let logged = false
  setFeedbackNoticeState(prev => {
    if (prev.shownLoggedForDraftId === draftId) return prev
    logged = true
    return { ...prev, shownLoggedForDraftId: draftId }
  })
  return logged
}

/** densable leftover Dwc */
export function tryStartFeedbackDraftSeed(): boolean {
  let started = false
  setFeedbackNoticeState(prev => {
    if (prev.seedStarted || prev.seededFromDisk) return prev
    started = true
    return { ...prev, seedStarted: true }
  })
  return started
}

/** densable leftover $wc */
export function seedSessionDraftCount(count: number): void {
  setFeedbackNoticeState(prev => {
    if (prev.seededFromDisk) return prev
    return {
      ...prev,
      seededFromDisk: true,
      sessionDraftCount: Math.max(prev.sessionDraftCount, count),
    }
  })
}

/** densable leftover Lwc */
export function setSeededSessionDraftCount(count: number): void {
  setFeedbackNoticeState(prev =>
    prev.sessionDraftCount === count && prev.seededFromDisk
      ? prev
      : { ...prev, seededFromDisk: true, sessionDraftCount: count },
  )
}

/** densable leftover vqe */
export function canShowFeedbackTurnOffPrompt(): boolean {
  return (
    (getGlobalConfig().feedbackDraftsTurnOffPromptDeclines ?? 0) <
    FEEDBACK_TURNOFF_PROMPT_DECLINE_CAP
  )
}

/** densable leftover ore */
export function incrementFeedbackTurnOffPromptDeclines(
  storageV5?: unknown,
): void {
  saveGlobalConfig(
    current => ({
      ...current,
      feedbackDraftsTurnOffPromptDeclines:
        (current.feedbackDraftsTurnOffPromptDeclines ?? 0) + 1,
    }),
    storageV5,
  )
}
