/**
 * densable 2.1.234 #34 — incomplete session-list disclosure copy.
 */
import { describe, expect, test } from 'bun:test'
import {
  ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE,
  appendSearchTruncatedBody,
  appendSearchTruncatedSuccessSuffix,
  CLOUD_SESSION_LIST_FAILED_LISTING_NOTE,
  listAgentsIncompleteNotes,
  searchTruncatedDisplayNote,
  SESSION_LIST_SEARCH_TRUNCATED_BODY,
  SESSION_LIST_SEARCH_TRUNCATED_SHORT,
  SESSION_LIST_SEARCH_TRUNCATED_SUCCESS_SUFFIX,
  SESSION_LIST_TRUNCATED_LISTING_NOTE,
} from '../sessionListIncompleteCopy.js'

describe('densable 2.1.234 #34 sessionListIncompleteCopy', () => {
  test('Gff / wWr / iza / CSf gold strings', () => {
    expect(SESSION_LIST_SEARCH_TRUNCATED_SUCCESS_SUFFIX).toBe(
      '; your session list was too long to check completely, so a same-named session beyond what was searched would not have been seen',
    )
    expect(SESSION_LIST_SEARCH_TRUNCATED_BODY).toBe(
      '\nYour session list was too long to check completely, so a session by that name may exist beyond what was searched.',
    )
    expect(SESSION_LIST_SEARCH_TRUNCATED_SHORT).toBe(
      'your session list was too long to check completely',
    )
    expect(SESSION_LIST_TRUNCATED_LISTING_NOTE).toBe(
      '(session list too long to fetch completely — sessions beyond the first pages are missing from this listing)',
    )
    expect(CLOUD_SESSION_LIST_FAILED_LISTING_NOTE).toContain(
      'cloud session list could not be fetched',
    )
    expect(ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE).toContain(
      'account session list incomplete',
    )
  })

  test('appendSearchTruncatedSuccessSuffix only when truncated', () => {
    expect(appendSearchTruncatedSuccessSuffix('ok', false)).toBe('ok')
    expect(appendSearchTruncatedSuccessSuffix('ok', undefined)).toBe('ok')
    expect(appendSearchTruncatedSuccessSuffix('ok', true)).toBe(
      `ok${SESSION_LIST_SEARCH_TRUNCATED_SUCCESS_SUFFIX}`,
    )
  })

  test('appendSearchTruncatedBody / display Note', () => {
    expect(appendSearchTruncatedBody('nope', true)).toBe(
      `nope${SESSION_LIST_SEARCH_TRUNCATED_BODY}`,
    )
    expect(searchTruncatedDisplayNote(false)).toBe('')
    expect(searchTruncatedDisplayNote(true)).toBe(
      ` Note: ${SESSION_LIST_SEARCH_TRUNCATED_SHORT} — it may exist beyond what was searched.`,
    )
  })

  test('listAgentsIncompleteNotes order: bridge incomplete → cloud failed → truncated', () => {
    expect(
      listAgentsIncompleteNotes({
        listTruncated: true,
        cloudListFailed: true,
        bridgeWalkIncomplete: true,
      }),
    ).toEqual([
      ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE,
      CLOUD_SESSION_LIST_FAILED_LISTING_NOTE,
      SESSION_LIST_TRUNCATED_LISTING_NOTE,
    ])
    expect(listAgentsIncompleteNotes({})).toEqual([])
  })
})
