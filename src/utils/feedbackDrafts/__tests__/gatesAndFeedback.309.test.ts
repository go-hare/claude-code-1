import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FEEDBACK_GITHUB_ISSUES_URL,
  formatFeedbackWithIssueFallback,
} from '../gates.js'
import {
  formatFeedbackFailureMessage,
  parseFeedbackHttpError,
  submitFeedback,
} from '../../../components/Feedback.js'

describe('Feedback 2.1.302–2.1.309 alignment', () => {
  test('#929 org policy disabled /feedback points to GitHub issues instead of org admin', () => {
    const msg = formatFeedbackWithIssueFallback(
      "/feedback is disabled by your organization's policy.",
    )
    expect(msg).toContain(
      "/feedback is disabled by your organization's policy.",
    )
    expect(msg).toContain(FEEDBACK_GITHUB_ISSUES_URL)
    expect(msg).toContain(
      'Issues are public, so leave out anything confidential.',
    )

    const gatesSrc = readFileSync(join(import.meta.dir, '../gates.ts'), 'utf8')
    expect(gatesSrc).toMatch(
      /formatFeedbackWithIssueFallback\(\s*`\$\{command\} is disabled by your organization's policy\.`,?\s*\)/,
    )

    const suppressed = formatFeedbackWithIssueFallback(
      "Feedback submission is disabled by your organization's policy.",
      "Feedback submission is disabled by your organization's policy.",
    )
    expect(suppressed).toBe(
      "Feedback submission is disabled by your organization's policy.",
    )
  })

  test('#1142 parseFeedbackHttpError and formatFeedbackFailureMessage surface server org refusal reason + GitHub issues', () => {
    const parsed = parseFeedbackHttpError(403, {
      error: {
        type: 'permission_error',
        message: 'Product feedback is turned off for Acme Corp.',
        details: { error_code: 'feedback_disabled' },
      },
    })
    expect(parsed.failureReason).toBe('org_refused')
    expect(parsed.refusal?.kind).toBe('org')
    expect(parsed.refusal?.serverMessage).toBe(
      'Product feedback is turned off for Acme Corp.',
    )

    const msg = formatFeedbackFailureMessage(parsed)
    expect(msg).toContain(
      "Couldn't send feedback: Product feedback is turned off for Acme Corp.",
    )
    expect(msg).toContain(FEEDBACK_GITHUB_ISSUES_URL)
    expect(msg).not.toContain('try again later')
  })

  test('#1143 submitFeedback strips transcript and resends when initial payload is too large', async () => {
    const seenPayloads: Array<{ transcriptLen: number }> = []
    const data = {
      message_count: 2,
      datetime: '2026-01-01T00:00:00.000Z',
      description: 'bug report',
      platform: 'darwin',
      git_repository: false,
      terminal: 'iTerm2',
      transcript: [
        { type: 'user', message: { role: 'user', content: 'huge' } },
      ] as never[],
      last_api_request: null,
      errors: [],
      env: {},
    }
    const res = await submitFeedback(
      data as never,
      undefined,
      async payload => {
        seenPayloads.push({ transcriptLen: payload.transcript.length })
        if (payload.transcript.length > 0) {
          return {
            success: false,
            payloadTooLarge: true,
            failureReason: 'payload_too_large_413',
            statusCode: 413,
          }
        }
        return { success: true, feedbackId: 'fb-123' }
      },
    )

    expect(seenPayloads).toEqual([{ transcriptLen: 1 }, { transcriptLen: 0 }])
    expect(res).toEqual({ success: true, feedbackId: 'fb-123' })
  })
})
