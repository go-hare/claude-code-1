/**
 * densable 2.1.234 #34 — ListAgents incomplete-list notes via formatPeersListing.
 */
import { describe, expect, test } from 'bun:test'
import {
  ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE,
  CLOUD_SESSION_LIST_FAILED_LISTING_NOTE,
  SESSION_LIST_TRUNCATED_LISTING_NOTE,
} from 'src/utils/sessionListIncompleteCopy.js'
import { CLOUD_PEER_UNREACHABLE_FROM_HERE } from 'src/utils/teleport/cloudPeerSessions.js'
import { __test } from '../ListPeersTool.js'

describe('densable 2.1.234 #34 ListAgents incomplete notes', () => {
  test('formatPeersListing appends CSf / cloud-failed / account-incomplete', () => {
    const listing = __test.formatPeersListing(
      [
        {
          address: 'uds:/tmp/a.sock',
          name: 'alpha',
          transport: 'uds',
          connected: true,
        },
      ],
      {
        listTruncated: true,
        cloudListFailed: true,
        bridgeWalkIncomplete: true,
      },
    )
    expect(listing).toContain('Found 1 agent(s):')
    expect(listing).toContain(ACCOUNT_SESSION_LIST_INCOMPLETE_LISTING_NOTE)
    expect(listing).toContain(CLOUD_SESSION_LIST_FAILED_LISTING_NOTE)
    expect(listing).toContain(SESSION_LIST_TRUNCATED_LISTING_NOTE)
  })

  test('cloud row appends official xSf when unreachableFromHere', () => {
    const listing = __test.formatPeersListing([
      {
        address: 'cloud:session_bridge',
        name: 'rc',
        transport: 'cloud',
        connected: true,
        status: 'cloud',
        unreachableFromHere: true,
      },
    ])
    expect(listing).toContain(CLOUD_PEER_UNREACHABLE_FROM_HERE)
  })

  test('empty peers still surface truncated notes', () => {
    const listing = __test.formatPeersListing([], { listTruncated: true })
    expect(listing).toContain('No agents found.')
    expect(listing).toContain(SESSION_LIST_TRUNCATED_LISTING_NOTE)
  })
})
