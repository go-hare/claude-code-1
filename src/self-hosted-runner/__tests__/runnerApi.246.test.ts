/**
 * densable 2.1.246 #51 — official PollWork `Le` / malformed-body throws.
 */
import { describe, expect, mock, test } from 'bun:test'

import {
  assertSafeId,
  createSelfHostedRunnerApi,
  isSafePollAssignmentId,
  SAFE_ID_MAX_LENGTH,
} from '../runnerApi.js'

function apiWithPollData(data: unknown) {
  const http = {
    post: mock(async () => ({ status: 200, data, headers: {} })),
    get: mock(async () => ({ status: 200, data: {}, headers: {} })),
    put: mock(async () => ({ status: 200, data: {}, headers: {} })),
  }
  return createSelfHostedRunnerApi({
    baseUrl: 'https://api.example.test',
    poolSecret: 's',
    http: http as never,
  })
}

describe('densable 2.1.246 #51 Le / D', () => {
  test('Le accepts [A-Za-z0-9_-] up to 256', () => {
    expect(isSafePollAssignmentId('sess_1')).toBe(true)
    expect(isSafePollAssignmentId('a'.repeat(SAFE_ID_MAX_LENGTH))).toBe(true)
    expect(isSafePollAssignmentId('a'.repeat(SAFE_ID_MAX_LENGTH + 1))).toBe(
      false,
    )
    expect(isSafePollAssignmentId('bad/id')).toBe(false)
    expect(isSafePollAssignmentId(1)).toBe(false)
  })

  test('D rejects overlong ids with official wording', () => {
    expect(() => assertSafeId('x'.repeat(257), 'sessionId')).toThrow(
      `exceeds ${SAFE_ID_MAX_LENGTH} characters`,
    )
  })
})

describe('densable 2.1.246 #51 PollWork throws', () => {
  test('HTML / non-object body → intercepting proxy throw', async () => {
    const api = apiWithPollData('<html>nope</html>')
    await expect(api.pollWork('rtok', 'r1', 1)).rejects.toThrow(
      'PollWork: response body is not a JSON object (an intercepting proxy may have answered) — rejecting the malformed poll response',
    )
  })

  test('array body is not a JSON object', async () => {
    const api = apiWithPollData([])
    await expect(api.pollWork('rtok', 'r1', 1)).rejects.toThrow(
      'not a JSON object',
    )
  })

  test('assignment_ids not an array', async () => {
    const api = apiWithPollData({ assignment_ids: 'sess_1' })
    await expect(api.pollWork('rtok', 'r1', 1)).rejects.toThrow(
      'PollWork: response assignment_ids is not an array — rejecting the malformed poll response',
    )
  })

  test('assignment_ids contains a malformed session id', async () => {
    const api = apiWithPollData({ assignment_ids: ['ok', 'bad/id'] })
    await expect(api.pollWork('rtok', 'r1', 1)).rejects.toThrow(
      'PollWork: response assignment_ids contains a malformed session id — rejecting the malformed poll response',
    )
  })

  test('valid object still returns assignment_ids', async () => {
    const api = apiWithPollData({
      assignment_ids: ['a1'],
      lease_expires_at: 'soon',
      session_assignments: [{ id: 1 }],
    })
    await expect(api.pollWork('rtok', 'r1', 1)).resolves.toEqual({
      assignment_ids: ['a1'],
      lease_expires_at: 'soon',
      session_assignments: [{ id: 1 }],
    })
  })
})
