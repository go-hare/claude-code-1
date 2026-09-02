/**
 * densable 2.1.239 leftover — MHm / J1w ListAgents Subagents section.
 */
import { describe, expect, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import { __test } from '../ListPeersTool.js'
import {
  buildListingCandidateMap,
  formatSubagentsSection,
  listSubagentsForListing,
  teammateCandidatesFromRows,
} from '../teammatesListing.js'

const NOW = 1_700_000_000_000

function listingState(partial: {
  teamContext?: AppState['teamContext']
  tasks?: AppState['tasks']
  agentNameRegistry?: Map<string, string>
}): AppState {
  return {
    teamContext: partial.teamContext,
    tasks: partial.tasks ?? {},
    agentNameRegistry: partial.agentNameRegistry ?? new Map(),
  } as unknown as AppState
}

describe('densable MHm / J1w Subagents', () => {
  test('MHm skips main-session and name-colliding teammates', () => {
    const rows = listSubagentsForListing(
      listingState({
        teamContext: {
          teamName: 'demo',
          teammates: {
            tm: {
              name: 'explore',
              agentType: 'researcher',
              tmuxPaneId: 'in-process',
            },
          },
        } as unknown as AppState['teamContext'],
        agentNameRegistry: new Map([
          ['explore', 'agent-collide'],
          ['worker', 'agent-ok'],
        ]),
        tasks: {
          main: {
            type: 'local_agent',
            agentType: 'main-session',
            status: 'running',
            startTime: NOW - 1000,
            id: 'main',
          },
          'agent-collide': {
            type: 'local_agent',
            agentType: 'Explore',
            status: 'running',
            startTime: NOW - 1000,
            id: 'agent-collide',
          },
          'agent-ok': {
            type: 'local_agent',
            agentType: 'general-purpose',
            status: 'completed',
            startTime: NOW - 60_000,
            id: 'agent-ok',
          },
        } as unknown as AppState['tasks'],
      }),
    )
    expect(rows.map(r => r.agentId)).toEqual(['agent-collide', 'agent-ok'])
    expect(rows[0]?.name).toBeUndefined()
    expect(rows[1]?.name).toBe('worker')
  })

  test('J1w uses Eao + Subagents (n) and V1w composes it first', () => {
    const rows = [
      {
        agentId: 'agent-ok',
        name: 'worker',
        agentType: 'general-purpose',
        status: 'running',
        startTime: NOW - 60_000,
      },
    ]
    const candidates = buildListingCandidateMap([
      { kind: 'subagent', id: 'agent-ok', name: 'worker' },
    ])
    const section = formatSubagentsSection(rows, candidates, NOW)
    expect(section.startsWith('Subagents (1):')).toBe(true)
    expect(section).toContain('worker [')
    expect(section).toContain('general-purpose')
    expect(section).toContain('running')
    expect(section).toContain('started')
    expect(section).toContain('\u00B7')

    const listing = __test.formatPeersListing([], {
      subagentsSection: section,
      selfHeader: 'This session is alpha [abcdef] — listed.',
    })
    expect(listing).toContain('Subagents (1):')
    expect(listing).not.toContain('No reachable agents.')
    expect(teammateCandidatesFromRows([]).size).toBe(0)
  })
})
