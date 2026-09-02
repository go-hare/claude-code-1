import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __test } from '../ListPeersTool.js'

describe('densable 2.1.239 #50 ListAgents G1w header', () => {
  test('formatPeersListing prepends own-session header', () => {
    const listing = __test.formatPeersListing(
      [{ address: 'uds:/tmp/a.sock', name: 'peer', transport: 'uds' }],
      {
        selfHeader:
          'This session is alpha [abcdef] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).',
      },
    )
    expect(listing.startsWith('This session is alpha [abcdef]')).toBe(true)
    expect(listing).toContain('Peer sessions (1):')
  })

  test('SRl passes g5(t) into DHm (not hardcoded false)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../ListPeersTool.ts'),
      'utf8',
    )
    expect(src).toContain('callerIsSubagentFromContext')
    expect(src).not.toMatch(/describeOwnSession\(\s*getCurrentSessionTitle/)
    expect(src).toContain(
      'describeOwnSession(\n      callerIsSubagentFromContext({',
    )
  })

  test('empty list without self is No reachable agents.', () => {
    expect(__test.formatPeersListing([])).toBe('No reachable agents.')
  })

  test('empty list still keeps the own-session header', () => {
    const listing = __test.formatPeersListing([], {
      selfHeader: 'This session is alpha [abcdef] — listed.',
    })
    expect(listing).toContain('This session is alpha [abcdef]')
    expect(listing).toContain('No reachable agents')
    expect(listing).toContain(
      'no other Claude session is running on this machine right now',
    )
  })
})
