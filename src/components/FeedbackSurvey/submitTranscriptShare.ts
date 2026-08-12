import axios from 'axios'
import { readFile, stat } from 'fs/promises'
import { getIsRemoteMode, getLastAPIRequest } from '../../bootstrap/state.js'
import type { Message } from '../../types/message.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { checkAndRefreshOAuthTokenIfNeeded } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { classifyAxiosError, errorMessage } from '../../utils/errors.js'
import { getHead } from '../../utils/git.js'
import { getAuthHeaders, getUserAgent } from '../../utils/http.js'
import { normalizeMessagesForAPI } from '../../utils/messages.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import {
  extractAgentIdsFromMessages,
  getTranscriptPath,
  loadSubagentTranscripts,
  MAX_TRANSCRIPT_READ_BYTES,
} from '../../utils/sessionStorage.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { redactSensitiveInfo } from '../Feedback.js'
import {
  encodeShareRequestBody,
  resolveTranscriptShareMode,
  writeFeedbackBundleZip,
} from './shareBundle.js'

/**
 * densable S1r — max serialized share payload (8 MiB).
 * Long sessions trip payload_too_large_precheck / http_413 without size ladder.
 */
export const MAX_SHARE_PAYLOAD_BYTES = 8_388_608

/**
 * densable JHS — third-party (Bedrock/Vertex/inf) transcript id markers.
 * SEA 2.1.224 exact list (note bolt-inf- hyphen, not underscore).
 * Used by oot/_1r to withhold raw/subagent bodies on the post path only.
 */
export const THIRD_PARTY_TRANSCRIPT_MARKERS = [
  'msg_bdrk_',
  'msg_vrtx_',
  'bolt-inf-',
  'toolu_bdrk_',
  'toolu_vrtx_',
  'srvtoolu_bdrk_',
  'srvtoolu_vrtx_',
  'req_bdrk_',
  'req_vrtx_',
] as const

/**
 * densable PEv / OEv — last request model-settings fields allowed in share.
 * Dropped first when payload is too large (224 #25).
 */
export const LAST_API_REQUEST_SHARE_KEYS = [
  'model',
  'system',
  'tools',
  'tool_choice',
  'betas',
  'max_tokens',
  'thinking',
  'temperature',
  'context_management',
  'output_config',
] as const

export type TranscriptShareErrorCode =
  | 'payload_too_large_precheck'
  | 'payload_range_error'
  | 'payload_stripped'
  | 'http_413'
  | `http_${number}`
  | 'timeout'
  | 'network'
  | 'auth_unavailable'
  | 'no_response'
  | 'exception'
  | 'essential_traffic_only'
  | 'policy_blocked'
  | 'data_residency'
  | 'bundle_write_failed'
  /** Bundle path: redact/stringify/parse failed — never write unredacted zip. */
  | 'bundle_redact_failed'
  | string

type TranscriptShareResult = {
  success: boolean
  transcriptId?: string
  /** densable hBa zip path when m0t mode is bundle */
  bundlePath?: string
  errorCode?: TranscriptShareErrorCode
}

export {
  encodeShareRequestBody,
  resolveTranscriptShareMode,
  writeFeedbackBundleZip,
} from './shareBundle.js'

export type TranscriptShareTrigger =
  | 'bad_feedback_survey'
  | 'good_feedback_survey'
  | 'frustration'
  | 'memory_survey'

type LastApiRequestShare = Partial<
  Record<(typeof LAST_API_REQUEST_SHARE_KEYS)[number], unknown>
>

/** densable OEv — pick allowed model-settings keys from last API request */
export function pickLastApiRequestForShare(
  last: ReturnType<typeof getLastAPIRequest>,
): LastApiRequestShare | undefined {
  if (!last || typeof last !== 'object') return undefined
  const out: LastApiRequestShare = {}
  let any = false
  const rec = last as Record<string, unknown>
  for (const key of LAST_API_REQUEST_SHARE_KEYS) {
    if (rec[key] !== undefined) {
      out[key] = rec[key]
      any = true
    }
  }
  return any ? out : undefined
}

/** densable oot — raw string contains any JHS third-party marker */
export function hasThirdPartyTranscriptMarkers(content: string): boolean {
  return THIRD_PARTY_TRANSCRIPT_MARKERS.some(marker => content.includes(marker))
}

/**
 * densable _1r — any message in a subagent transcript serializes with a JHS
 * marker. JSON.stringify throw → treat as third-party (withhold).
 */
export function subagentTranscriptHasThirdPartyMarkers(
  messages: unknown[],
): boolean {
  return messages.some(msg => {
    try {
      return hasThirdPartyTranscriptMarkers(jsonStringify(msg))
    } catch {
      return true
    }
  })
}

/**
 * densable lql post-path only: drop subagent bodies + raw jsonl that carry 3p
 * markers before building the share ladder (never send Bedrock/Vertex ids).
 */
export function stripThirdPartyTranscriptFields(input: {
  subagentTranscripts: Record<string, unknown[]>
  rawTranscriptJsonl: string | undefined
}): {
  subagentTranscripts: Record<string, unknown[]>
  rawTranscriptJsonl: string | undefined
} {
  const subagentTranscripts = { ...input.subagentTranscripts }
  for (const [agentId, messages] of Object.entries(subagentTranscripts)) {
    if (!Array.isArray(messages)) continue
    if (subagentTranscriptHasThirdPartyMarkers(messages)) {
      delete subagentTranscripts[agentId]
      logForDebugging(
        `subagent transcript ${agentId} withheld: contains_3p_transcript_markers`,
      )
    }
  }
  let rawTranscriptJsonl = input.rawTranscriptJsonl
  if (
    rawTranscriptJsonl !== undefined &&
    hasThirdPartyTranscriptMarkers(rawTranscriptJsonl)
  ) {
    rawTranscriptJsonl = undefined
    logForDebugging(
      'rawTranscriptJsonl withheld from transcript share: contains_3p_transcript_markers',
    )
  }
  return { subagentTranscripts, rawTranscriptJsonl }
}

/**
 * densable FNi headSha: Iar()≡getHead when !Is(); Is = remote workspace OR
 * remote session. Local: getIsRemoteMode() covers remote session path; skip
 * git head (empty → commitSha null) when remote.
 */
export async function resolveShareCommitSha(): Promise<string | null> {
  if (getIsRemoteMode()) return null
  try {
    const head = await getHead()
    return head || null
  } catch {
    return null
  }
}

function classifyShareError(err: unknown): TranscriptShareErrorCode {
  if (err instanceof RangeError) return 'payload_range_error'
  const { kind, status } = classifyAxiosError(err)
  switch (kind) {
    case 'timeout':
    case 'network':
      return kind
    case 'auth':
    case 'http':
      if (status !== undefined) {
        return status === 413 ? 'http_413' : `http_${status}`
      }
      return 'no_response'
    default:
      return 'exception'
  }
}

export async function submitTranscriptShare(
  messages: Message[],
  trigger: TranscriptShareTrigger,
  appearanceId: string,
): Promise<TranscriptShareResult> {
  try {
    // densable early gates (SEA feedback_transcript_share): essential traffic
    // then allow_product_feedback policy — before any payload work.
    if (isEssentialTrafficOnly()) {
      return { success: false, errorCode: 'essential_traffic_only' }
    }
    if (!isPolicyAllowed('allow_product_feedback')) {
      return { success: false, errorCode: 'policy_blocked' }
    }

    logForDebugging('Collecting transcript for sharing', { level: 'info' })

    // densable FNi: normalize + subagents + headSha (skip when remote) + raw
    const transcript = normalizeMessagesForAPI(messages)
    const agentIds = extractAgentIdsFromMessages(messages)
    const remote = getIsRemoteMode()
    const [loadedSubagents, headSha] = await Promise.all([
      loadSubagentTranscripts(agentIds),
      remote ? Promise.resolve(null) : resolveShareCommitSha(),
    ])

    // Read raw JSONL transcript (with size guard to prevent OOM)
    let rawTranscriptJsonl: string | undefined
    try {
      const transcriptPath = getTranscriptPath()
      const { size } = await stat(transcriptPath)
      if (size <= MAX_TRANSCRIPT_READ_BYTES) {
        rawTranscriptJsonl = await readFile(transcriptPath, 'utf-8')
      } else {
        logForDebugging(
          `Skipping raw transcript read: file too large (${size} bytes)`,
          { level: 'warn' },
        )
      }
    } catch {
      // File may not exist
    }

    // densable m0t: bundle when provider≠firstParty or no Anthropic creds.
    const shareMode = resolveTranscriptShareMode()
    const isPost = shareMode.kind !== 'bundle'

    // densable lql: 3p strip ONLY on post path (not bundle).
    let subagentTranscripts = loadedSubagents as Record<string, unknown[]>
    if (isPost) {
      const stripped = stripThirdPartyTranscriptFields({
        subagentTranscripts,
        rawTranscriptJsonl,
      })
      subagentTranscripts = stripped.subagentTranscripts
      rawTranscriptJsonl = stripped.rawTranscriptJsonl
    }

    // densable 2.1.224 #25 — last request model settings (system/tools/params)
    const lastApiRequest = pickLastApiRequestForShare(getLastAPIRequest())

    // densable payload: commitSha = headSha||null (Iar/jJr → getHead)
    const fullData = {
      trigger,
      version: MACRO.VERSION,
      platform: process.platform,
      commitSha: headSha || null,
      transcript,
      subagentTranscripts:
        Object.keys(subagentTranscripts).length > 0
          ? subagentTranscripts
          : undefined,
      lastApiRequest,
      rawTranscriptJsonl,
    }

    // densable bundle path: Y7t + hBa("transcript.json") — no size ladder, no POST.
    // Redact before encode/zip (post path already redacts at ~350); otherwise
    // local feedback-bundles/*.zip retain secrets that never hit the network.
    // Fail-closed on redact/stringify/parse failure — never write fullData
    // unredacted (align post path: RangeError → payload_range_error; else abort).
    if (!isPost) {
      try {
        let payloadForBundle: Record<string, unknown>
        try {
          payloadForBundle = JSON.parse(
            redactSensitiveInfo(jsonStringify(fullData)),
          ) as Record<string, unknown>
        } catch (err) {
          logForDebugging(errorMessage(err), { level: 'error' })
          if (err instanceof RangeError) {
            return { success: false, errorCode: 'payload_range_error' }
          }
          return { success: false, errorCode: 'bundle_redact_failed' }
        }
        const body = encodeShareRequestBody(payloadForBundle, {
          extraOuterFields: { appearance_id: appearanceId },
        })
        const written = await writeFeedbackBundleZip(body, 'transcript.json')
        if (written.success) {
          logForDebugging('feedback_transcript_share bundle written', {
            level: 'info',
          })
          return { success: true, bundlePath: written.zipPath }
        }
        return { success: false, errorCode: 'bundle_write_failed' }
      } catch (err) {
        logForDebugging(errorMessage(err), { level: 'error' })
        return { success: false, errorCode: 'bundle_write_failed' }
      }
    }

    // densable size ladder (strip model settings first, then transcript):
    // 0 full · 1 drop lastApiRequest · 2 raw-only · 3 empty transcript
    const {
      transcript: _t,
      subagentTranscripts: _s,
      lastApiRequest: _l,
      rawTranscriptJsonl: raw,
      ...base
    } = fullData
    const ladder: Array<typeof fullData | Record<string, unknown>> = [
      fullData,
      ...(lastApiRequest !== undefined
        ? [{ ...fullData, lastApiRequest: undefined }]
        : []),
      ...(raw?.trim()
        ? [{ ...base, transcript: [], rawTranscriptJsonl: raw }]
        : []),
      { ...base, transcript: [] },
    ]

    await checkAndRefreshOAuthTokenIfNeeded()

    const authResult = getAuthHeaders()
    if (authResult.error) {
      // densable m0t would have chosen bundle when no_creds; if we still reach
      // post without headers, treat as auth_unavailable (race / provider edge).
      return { success: false, errorCode: 'auth_unavailable' }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getUserAgent(),
      ...authResult.headers,
    }

    let failureCode: TranscriptShareErrorCode = 'payload_too_large_precheck'

    for (let i = 0; i < ladder.length; i++) {
      const candidate = ladder[i]!
      let content: string
      try {
        content = redactSensitiveInfo(jsonStringify(candidate))
      } catch (err) {
        if (err instanceof RangeError) {
          failureCode = 'payload_range_error'
          continue
        }
        throw err
      }

      if (content.length > MAX_SHARE_PAYLOAD_BYTES) {
        failureCode = 'payload_too_large_precheck'
        continue
      }

      try {
        const response = await axios.post(
          'https://api.anthropic.com/api/claude_code_shared_session_transcripts',
          { content, appearance_id: appearanceId },
          {
            headers,
            timeout: 30000,
          },
        )

        if (response.status === 200 || response.status === 201) {
          const result = response.data
          logForDebugging('Transcript shared successfully', { level: 'info' })
          // densable: S>0 → Oe("feedback_transcript_share","payload_stripped")
          // else Se(...); success return is {success, transcriptId} only —
          // payload_stripped is telemetry, never success.errorCode.
          if (i > 0) {
            logForDebugging('feedback_transcript_share payload_stripped', {
              level: 'info',
            })
          }
          return {
            success: true,
            transcriptId: result?.transcript_id,
          }
        }

        const status = response.status
        failureCode = status === 413 ? 'http_413' : `http_${status}`
        // densable: only continue ladder on payload-too-large class
        if (status !== 413) {
          return { success: false, errorCode: failureCode }
        }
      } catch (err) {
        const code = classifyShareError(err)
        failureCode = code
        const payloadTooLarge =
          code === 'http_413' ||
          code === 'payload_range_error' ||
          (code === 'timeout' && content.length > MAX_SHARE_PAYLOAD_BYTES / 8)
        if (!payloadTooLarge) {
          logForDebugging(errorMessage(err), { level: 'error' })
          return { success: false, errorCode: code }
        }
        // continue ladder
      }
    }

    return { success: false, errorCode: failureCode }
  } catch (err) {
    logForDebugging(errorMessage(err), {
      level: 'error',
    })
    return { success: false, errorCode: classifyShareError(err) }
  }
}
