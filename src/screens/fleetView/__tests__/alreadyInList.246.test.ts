import { describe, expect, test } from 'bun:test'
import {
  ALREADY_IN_LIST_MESSAGE,
  isSessionAlreadyInJobList,
} from '../helpers.js'

describe('isSessionAlreadyInJobList (official already_in_list)', () => {
  test('matches a job directory named after the past session short', () => {
    expect(
      isSessionAlreadyInJobList('abcdef12-9999', [
        { short: 'abcdef12', state: { sessionId: 'other' } },
      ]),
    ).toBe(true)
  })

  test('matches sessionId or resumeSessionId', () => {
    const id = 'sid-1'
    expect(
      isSessionAlreadyInJobList(id, [
        { short: 'zzzzzzzz', state: { sessionId: id } },
      ]),
    ).toBe(true)
    expect(
      isSessionAlreadyInJobList(id, [
        { short: 'zzzzzzzz', state: { resumeSessionId: id } },
      ]),
    ).toBe(true)
  })

  test('is false when the conversation is not in the fleet', () => {
    expect(
      isSessionAlreadyInJobList('sid-1', [
        { short: 'zzzzzzzz', state: { sessionId: 'other' } },
      ]),
    ).toBe(false)
  })

  test('keeps the official refuse copy', () => {
    expect(ALREADY_IN_LIST_MESSAGE).toBe(
      'This session is already in the list — press enter on its row',
    )
  })
})
