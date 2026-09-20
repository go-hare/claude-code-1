/**
 * densable leftover ot — same-session ye(m) + other-session ogr/Oe + W().
 * HTTP is stubbed; do not mock writeDraft / parse / notice.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { analyticsMock } from '../../../../tests/mocks/analytics.js'
import { debugMock } from '../../../../tests/mocks/debug'
import { logMock } from '../../../../tests/mocks/log'
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/services/analytics/index.js', analyticsMock)
mock.module('src/utils/http.ts', () => ({
  getAuthHeaders: () => ({ headers: { 'x-api-key': 'test' } }),
  getUserAgent: () => 'test-agent',
}))

const refreshCalls: Array<{
  credentials?: unknown
  storageV5?: unknown
}> = []
mock.module('src/utils/auth.ts', () => ({
  checkAndRefreshOAuthTokenIfNeeded: async (
    _retryCount = 0,
    _force = false,
    credentials?: unknown,
    storageV5?: unknown,
  ) => {
    refreshCalls.push({ credentials, storageV5 })
    return true
  },
}))

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.isAxiosError = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  'isAxiosError' in err &&
  (err as { isAxiosError?: boolean }).isAxiosError === true

import { getSessionId } from '../../../bootstrap/state.js'
import { createFeedbackDraft } from '../draft.js'
import {
  getFeedbackNoticeState,
  resetFeedbackNoticeStateForTests,
  seedSessionDraftCount,
} from '../notice.js'
import { FEEDBACK_TRANSCRIPT_SUBMIT_TAIL_BYTES } from '../constants.js'
import { resolveDraftTranscriptPath } from '../writeDraft.js'
import { submitQueuedFeedbackDraft } from '../submitDraft.js'

async function writeResolvedTranscript(
  draft: ReturnType<typeof createFeedbackDraft>,
  raw: string,
): Promise<string> {
  const file = await resolveDraftTranscriptPath(draft)
  if (file === null) throw new Error('Dfs returned null')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, raw)
  return file
}

const liveMessage = {
  type: 'user' as const,
  uuid: 'u1',
  timestamp: 't1',
  message: { role: 'user', content: 'hi' },
}
const liveAssistant = {
  type: 'assistant' as const,
  uuid: 'a1',
  timestamp: 't2',
  message: { id: 'm1', role: 'assistant', content: [] },
  requestId: 'req_1',
}
const sidechain = {
  type: 'user' as const,
  uuid: 'u2',
  timestamp: 't3',
  isSidechain: true,
  message: { role: 'user', content: 'no' },
}

function postedPayload(body: { content?: string }): {
  transcript: unknown[]
  rawTranscriptJsonl?: string
  surface?: string
} {
  return JSON.parse(body.content ?? '{}') as {
    transcript: unknown[]
    rawTranscriptJsonl?: string
    surface?: string
  }
}

beforeAll(() => {
  axiosHandle.useStubs = true
})

afterAll(() => {
  axiosHandle.useStubs = false
})

afterEach(() => {
  resetFeedbackNoticeStateForTests()
  axiosHandle.stubs.post = undefined
  refreshCalls.length = 0
})

describe('densable leftover ot submit', () => {
  test('same-session uses ye(m) and W() on success', async () => {
    const raw = `${JSON.stringify({ sessionId: getSessionId(), cwd: '/tmp' })}\n`
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: getSessionId(),
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    await writeResolvedTranscript(draft, raw)
    seedSessionDraftCount(3)
    let body: { content?: string } | undefined
    axiosHandle.stubs.post = (_url: string, posted: { content?: string }) => {
      body = posted
      return Promise.resolve({
        status: 200,
        data: { feedback_id: 'fb_same' },
      })
    }
    const result = await submitQueuedFeedbackDraft({
      draft,
      includeTranscript: true,
      currentSessionMessages: [liveMessage, liveAssistant, sidechain],
    })
    expect(result.success).toBe(true)
    const payload = postedPayload(body ?? {})
    expect(payload.transcript).toEqual([liveMessage, liveAssistant])
    expect(payload.rawTranscriptJsonl).toBe(raw)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(2)
  })

  test('other-session withholds when ogr fails', async () => {
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: 'other-sess',
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    await writeResolvedTranscript(
      draft,
      `${JSON.stringify({ sessionId: 'wrong', cwd: '/tmp' })}\n${JSON.stringify(liveMessage)}\n`,
    )
    seedSessionDraftCount(3)
    let body: { content?: string } | undefined
    axiosHandle.stubs.post = (_url: string, posted: { content?: string }) => {
      body = posted
      return Promise.resolve({
        status: 200,
        data: { feedback_id: 'fb_other_fail' },
      })
    }
    const result = await submitQueuedFeedbackDraft({
      draft,
      includeTranscript: true,
      currentSessionMessages: [liveMessage, liveAssistant],
    })
    expect(result.success).toBe(true)
    const payload = postedPayload(body ?? {})
    expect(payload.transcript).toEqual([])
    expect(payload.rawTranscriptJsonl).toBeUndefined()
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(3)
  })

  test('other-session corroborated file uses Oe and does not W()', async () => {
    const raw = [
      JSON.stringify({ sessionId: 'other-sess', cwd: '/tmp' }),
      JSON.stringify(liveMessage),
      JSON.stringify(liveAssistant),
      JSON.stringify(sidechain),
    ].join('\n')
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: 'other-sess',
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    await writeResolvedTranscript(draft, `${raw}\n`)
    seedSessionDraftCount(3)
    let body: { content?: string } | undefined
    axiosHandle.stubs.post = (_url: string, posted: { content?: string }) => {
      body = posted
      return Promise.resolve({
        status: 200,
        data: { feedback_id: 'fb_other_ok' },
      })
    }
    const result = await submitQueuedFeedbackDraft({
      draft,
      includeTranscript: true,
      currentSessionMessages: [liveMessage],
    })
    expect(result.success).toBe(true)
    const payload = postedPayload(body ?? {})
    expect(payload.transcript).toEqual([liveMessage, liveAssistant])
    expect(payload.rawTranscriptJsonl).toBe(`${raw}\n`)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(3)
  })

  test('ot leftover Ri drops the torn first JSONL line when tail-capped', async () => {
    const keep = `${JSON.stringify({ sessionId: getSessionId(), cwd: '/tmp' })}\n`
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: getSessionId(),
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    await writeResolvedTranscript(
      draft,
      `${'x'.repeat(FEEDBACK_TRANSCRIPT_SUBMIT_TAIL_BYTES)}torn\n${keep}`,
    )
    let body: { content?: string } | undefined
    axiosHandle.stubs.post = (_url: string, posted: { content?: string }) => {
      body = posted
      return Promise.resolve({
        status: 200,
        data: { feedback_id: 'fb_tail' },
      })
    }
    const result = await submitQueuedFeedbackDraft({
      draft,
      includeTranscript: true,
      currentSessionMessages: [liveMessage],
    })
    expect(result.success).toBe(true)
    const payload = postedPayload(body ?? {})
    expect(payload.rawTranscriptJsonl).toBe(keep)
    expect(payload.rawTranscriptJsonl?.startsWith('x')).toBe(false)
  })

  test('he(k,p,y) refreshes with credentials and applies surface', async () => {
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: getSessionId(),
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
    })
    let body: { content?: string } | undefined
    axiosHandle.stubs.post = (_url: string, posted: { content?: string }) => {
      body = posted
      return Promise.resolve({
        status: 200,
        data: { feedback_id: 'fb_creds' },
      })
    }
    const credentials = { token: 'sess' }
    const storageV5 = { ns: 'v5' }
    const result = await submitQueuedFeedbackDraft({
      draft,
      surface: 'panel',
      credentials,
      storageV5,
    })
    expect(result.success).toBe(true)
    expect(refreshCalls).toEqual([{ credentials, storageV5 }])
    expect(postedPayload(body ?? {}).surface).toBe('panel')
  })

  test('ot returns the leftover ZDR-org sentence on 403 retention', async () => {
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: getSessionId(),
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
    })
    axiosHandle.stubs.post = () =>
      Promise.reject({
        isAxiosError: true,
        response: {
          status: 403,
          data: {
            error: {
              type: 'permission_error',
              message: 'Custom data retention settings are enabled',
            },
          },
        },
      })
    const result = await submitQueuedFeedbackDraft({ draft })
    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Feedback collection is not available for organizations with custom data retention policies.',
    )
  })

  test('Fqe card host passes leftover ot credentials through he(k,p,y)', async () => {
    const { submitFeedbackDraft } = await import('../submitDraft.js')
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: getSessionId(),
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
    })
    axiosHandle.stubs.post = () =>
      Promise.resolve({
        status: 200,
        data: { feedback_id: 'fb_card' },
      })
    const credentials = { token: 'card' }
    const storageV5 = { ns: 'card' }
    const result = await submitFeedbackDraft(
      draft,
      'card_send_as_is',
      storageV5,
      credentials,
    )
    expect(result.success).toBe(true)
    expect(refreshCalls).toEqual([{ credentials, storageV5 }])
  })
})
