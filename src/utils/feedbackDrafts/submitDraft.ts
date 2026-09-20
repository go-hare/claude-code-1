import axios from 'axios'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getSessionId } from '../../bootstrap/state.js'
import { checkAndRefreshOAuthTokenIfNeeded } from '../auth.js'
import { getAuthHeaders, getUserAgent } from '../http.js'
import { logForDebugging } from '../debug.js'
import { jsonStringify } from '../slowOperations.js'
import {
  FEEDBACK_TRANSCRIPT_SUBMIT_TAIL_BYTES,
  THIRD_PARTY_TRANSCRIPT_MARKERS,
} from './constants.js'
import type { FeedbackDraft } from './draft.js'
import {
  formatDraftedFeedbackDescription,
  type FeedbackDraftSubmitSurface,
} from './draftedBylines.js'
import { fitFeedbackPayloadToBudget } from './fitFeedbackPayloadToBudget.js'
import {
  parseDraftTranscriptMessages,
  sessionMessagesToDraftTranscript,
} from './parseDraftTranscriptMessages.js'
import {
  clearFeedbackNoticeForDraft,
  decrementSessionDraftCount,
} from './notice.js'
import {
  deleteFeedbackDraft,
  dropTornTranscriptHead,
  readTranscriptTail,
  resolveDraftTranscriptPath,
  transcriptContentCorroboratesDraft,
} from './writeDraft.js'

/** densable leftover xe */
export const FEEDBACK_PAYLOAD_TOO_LARGE =
  'Feedback payload too large. Try again without the transcript, or shorten the details.'

/** densable leftover ot isZdrOrg */
export const FEEDBACK_ZDR_ORG_ERROR =
  'Feedback collection is not available for organizations with custom data retention policies.'

export type SubmitQueuedFeedbackDraftArgs = {
  draft: FeedbackDraft
  includeTranscript?: boolean
  currentSessionMessages?: unknown[]
  surface?: 'cli' | FeedbackDraftSubmitSurface
  via?: FeedbackDraftSubmitSurface
  signal?: AbortSignal
  storageV5?: unknown
  credentials?: unknown
}

export type SubmitQueuedFeedbackDraftResult = {
  success: boolean
  error?: string
  payloadTooLarge?: boolean
  feedbackId?: string
}

function containsThirdPartyTranscriptMarkers(value: string): boolean {
  return THIRD_PARTY_TRANSCRIPT_MARKERS.some(marker => value.includes(marker))
}

function transcriptHasThirdPartyMarkers(
  messages: ReturnType<typeof parseDraftTranscriptMessages>,
): boolean {
  return messages.some(message =>
    containsThirdPartyTranscriptMarkers(jsonStringify(message) ?? ''),
  )
}

function isZdrRetentionError(data: unknown): boolean {
  if (data === null || typeof data !== 'object' || !('error' in data)) {
    return false
  }
  const nested = (data as { error?: unknown }).error
  if (nested === null || typeof nested !== 'object') {
    return false
  }
  const record = nested as { type?: unknown; message?: unknown }
  return (
    record.type === 'permission_error' &&
    typeof record.message === 'string' &&
    record.message.includes('Custom data retention settings')
  )
}

/** densable leftover ie — success increment; body leftover-wired (unpeeled). */
function leftoverIe(op: string): void {
  logForDebugging(op)
}

/** densable leftover ae — failure increment; body leftover-wired (unpeeled). */
function leftoverAe(
  op: string,
  reason: string,
  extra: { from_this_session: string },
): void {
  logForDebugging(
    `${op} ${reason} from_this_session=${extra.from_this_session}`,
  )
}

/** densable leftover he(k, p, y) */
async function postFeedbackPayload(
  payload: unknown,
  signal?: AbortSignal,
  credentials?: unknown,
  storageV5?: unknown,
): Promise<{
  success: boolean
  feedbackId?: string
  failureReason?: string
  payloadTooLarge?: boolean
  statusCode?: number
  isZdrOrg?: boolean
}> {
  await checkAndRefreshOAuthTokenIfNeeded(0, false, credentials, storageV5)
  const auth = getAuthHeaders()
  if (auth.error) return { success: false, failureReason: 'auth_error' }
  try {
    const response = await axios.post(
      'https://api.anthropic.com/api/claude_cli_feedback',
      { content: jsonStringify(payload) },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getUserAgent(),
          ...auth.headers,
        },
        timeout: 30000,
        signal,
      },
    )
    if (response.status === 200 && response.data?.feedback_id) {
      return { success: true, feedbackId: String(response.data.feedback_id) }
    }
    return { success: false, statusCode: response.status }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status
      if (statusCode === 413) {
        return { success: false, payloadTooLarge: true, statusCode }
      }
      if (statusCode === 403 && isZdrRetentionError(error.response?.data)) {
        return { success: false, isZdrOrg: true, statusCode }
      }
      if (error.code === 'ECONNABORTED') {
        return { success: false, failureReason: 'timeout', statusCode }
      }
      return { success: false, failureReason: 'network_error', statusCode }
    }
    return { success: false, failureReason: 'network_error' }
  }
}

function leftoverSubmitError(posted: {
  failureReason?: string
  payloadTooLarge?: boolean
  statusCode?: number
  isZdrOrg?: boolean
}): SubmitQueuedFeedbackDraftResult {
  if (posted.isZdrOrg) {
    return { success: false, error: FEEDBACK_ZDR_ORG_ERROR }
  }
  if (posted.failureReason === 'auth_error') {
    return {
      success: false,
      error: "Couldn't send feedback: not signed in. Run /login, then retry.",
    }
  }
  if (posted.payloadTooLarge) {
    return {
      success: false,
      error: FEEDBACK_PAYLOAD_TOO_LARGE,
      payloadTooLarge: true,
    }
  }
  return {
    success: false,
    error: `Couldn't send feedback${
      posted.statusCode
        ? ` (server returned ${posted.statusCode})`
        : posted.failureReason === 'timeout'
          ? ' (request timed out)'
          : " (couldn't reach the service)"
    }. The draft is still queued. Try again later.`,
  }
}

async function readSubmitTranscriptTail(
  file: string,
): Promise<string | undefined> {
  try {
    const { content, bytesRead, bytesTotal } = await readTranscriptTail(
      file,
      FEEDBACK_TRANSCRIPT_SUBMIT_TAIL_BYTES,
    )
    return dropTornTranscriptHead(content, bytesRead, bytesTotal)
  } catch {
    return undefined
  }
}

/** densable leftover ot / Gw / jt */
export async function submitQueuedFeedbackDraft({
  draft,
  includeTranscript = false,
  currentSessionMessages = [],
  surface = 'cli',
  via = 'panel',
  signal,
  storageV5,
  credentials,
}: SubmitQueuedFeedbackDraftArgs): Promise<SubmitQueuedFeedbackDraftResult> {
  let transcript = [] as ReturnType<typeof parseDraftTranscriptMessages>
  let rawTranscriptJsonl: string | undefined
  const fromThisSession = draft.source_session_id === getSessionId()
  if (includeTranscript && draft.transcript_ref) {
    const file = await resolveDraftTranscriptPath(draft)
    if (fromThisSession) {
      transcript = sessionMessagesToDraftTranscript(currentSessionMessages)
      if (file !== null) {
        const raw = await readSubmitTranscriptTail(file)
        if (raw !== undefined) {
          if (containsThirdPartyTranscriptMarkers(raw)) {
            logForDebugging(
              'rawTranscriptJsonl withheld from feedback draft submit: contains_3p_transcript_markers',
            )
          } else {
            rawTranscriptJsonl = raw
          }
        }
      }
    } else if (file !== null) {
      const raw = await readSubmitTranscriptTail(file)
      if (raw !== undefined) {
        if (!transcriptContentCorroboratesDraft(raw, draft)) {
          logForDebugging(
            'draft transcript withheld from feedback submit: identity_not_corroborated',
          )
        } else {
          transcript = parseDraftTranscriptMessages(raw)
          if (transcriptHasThirdPartyMarkers(transcript)) {
            transcript = []
            logForDebugging(
              'draft transcript withheld from feedback submit: contains_3p_transcript_markers',
            )
          }
          if (containsThirdPartyTranscriptMarkers(raw)) {
            logForDebugging(
              'rawTranscriptJsonl withheld from feedback draft submit: contains_3p_transcript_markers',
            )
          } else {
            rawTranscriptJsonl = raw
          }
        }
      }
    }
  }
  const latestAssistantMessageId = draft.request_ids.at(-1) ?? null
  const { payload, trim } = fitFeedbackPayloadToBudget({
    latestAssistantMessageId,
    latestAssistantAPIMessageId: null,
    lastInterruptedAssistantAPIMessageId: null,
    message_count: transcript.length,
    datetime: new Date().toISOString(),
    description: formatDraftedFeedbackDescription(draft, via),
    surface,
    platform: process.platform,
    gitRepo: false,
    commitSha: null,
    version: draft.cli_version,
    transcript,
    ...(rawTranscriptJsonl !== undefined && { rawTranscriptJsonl }),
  })
  const posted = await postFeedbackPayload(
    payload,
    signal,
    credentials,
    storageV5,
  )
  if (posted.success) {
    try {
      await deleteFeedbackDraft(draft.draft_id, storageV5)
    } catch (error) {
      logForDebugging(
        `feedbackDrafts: post-submit draft delete failed: ${error instanceof Error ? error.name : 'unknown'}`,
        { level: 'error' },
      )
      logEvent('tengu_feedback_draft_delete_failed', {
        phase:
          'post_submit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    if (fromThisSession) decrementSessionDraftCount(1)
    if (via !== 'card_send_as_is') {
      clearFeedbackNoticeForDraft(draft.draft_id)
    }
    logEvent('tengu_feedback_draft_submitted', {
      type: draft.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger:
        draft.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      failure_mode: (draft.failure_mode ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      task_category: (draft.task_category ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface:
        via as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transcript_included: (transcript.length > 0 ||
      rawTranscriptJsonl !== undefined
        ? 'true'
        : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transcript_trimmed: (trim !== null
        ? 'true'
        : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transcript_requested: (includeTranscript
        ? 'true'
        : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transcript_available: (draft.transcriptAvailable
        ? 'true'
        : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_this_session: (fromThisSession
        ? 'true'
        : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      feedback_id: (posted.feedbackId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_request_id: (latestAssistantMessageId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    leftoverIe('feedback_draft_submit')
    return { success: true, feedbackId: posted.feedbackId }
  }
  leftoverAe('feedback_draft_submit', posted.failureReason ?? 'network_error', {
    from_this_session: fromThisSession ? 'true' : 'false',
  })
  return leftoverSubmitError(posted)
}

/** densable leftover ot positional host used by Fqe card */
export async function submitFeedbackDraft(
  draft: FeedbackDraft,
  surface: FeedbackDraftSubmitSurface = 'panel',
  storageV5?: unknown,
  credentials?: unknown,
): Promise<{ success: boolean; message?: string }> {
  const result = await submitQueuedFeedbackDraft({
    draft,
    includeTranscript: surface !== 'card_send_as_is',
    currentSessionMessages: [],
    via: surface,
    storageV5,
    credentials,
  })
  return { success: result.success, message: result.error }
}
