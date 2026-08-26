/**
 * densable 2.1.239 #51 — OHm / Z1w / SRl / K1w ListAgents live teammates.
 */
import { describe, expect, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import type { TeamFile } from 'src/utils/swarm/teamHelpers.js'
import { SESSION_LIST_TRUNCATED_LISTING_NOTE } from 'src/utils/sessionListIncompleteCopy.js'
import { pinDigest } from '../../SendMessageTool/nameResolve.js'
import { __test } from '../ListPeersTool.js'
import {
  callerTeammateIdFromContext,
  formatTeammatesSection,
  listTeammatesForListing,
  sanitizeListingName,
  teammateCandidatesFromRows,
} from '../teammatesListing.js'

const NOW = 1_700_000_000_000
const FIVE_MIN = 5 * 60 * 1000

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

function teamContext(
  teammates: NonNullable<AppState['teamContext']>['teammates'],
  extra?: Partial<NonNullable<AppState['teamContext']>>,
): NonNullable<AppState['teamContext']> {
  return {
    teamName: 'demo',
    teamFilePath: '',
    leadAgentId: 'lead-1',
    teammates,
    ...extra,
  }
}

function roster(members: TeamFile['members']): TeamFile {
  return {
    name: 'demo',
    createdAt: 1,
    leadAgentId: 'lead-1',
    members,
  }
}

function teammateRef(id: string): string {
  return pinDigest('teammate', id).slice(0, 6)
}

describe('callerTeammateIdFromContext', () => {
  test('SRl: missing teammateContext → undefined', () => {
    expect(callerTeammateIdFromContext(undefined, 'agent-1')).toBeUndefined()
  })

  test('SRl: matching agentId → that id', () => {
    expect(
      callerTeammateIdFromContext({ agentId: 'worker-1' }, 'worker-1'),
    ).toBe('worker-1')
  })

  test('SRl: mismatch → null', () => {
    expect(
      callerTeammateIdFromContext({ agentId: 'worker-1' }, 'other'),
    ).toBeNull()
    expect(
      callerTeammateIdFromContext({ agentId: 'worker-1' }, undefined),
    ).toBeNull()
  })
})

describe('sanitizeListingName', () => {
  test('ALe empty / non-string → untitled session / null', () => {
    expect(sanitizeListingName('')).toBe('untitled session')
    expect(sanitizeListingName('   ')).toBe('untitled session')
    expect(sanitizeListingName(1)).toBeNull()
  })

  test('ALe strips Cc and caps at 200', () => {
    expect(sanitizeListingName('hello\u0001world')).toBe('helloworld')
    expect(sanitizeListingName('a'.repeat(250))?.length).toBe(200)
  })
})

describe('listTeammatesForListing', () => {
  test('OHm in-process idle + pane; excludes selfAgentId', () => {
    const rows = listTeammatesForListing(
      listingState({
        teamContext: teamContext(
          {
            'lead-1': {
              name: 'lead',
              agentType: 'team-lead',
              tmuxSessionName: 'current',
              tmuxPaneId: 'leader',
              cwd: '/tmp',
              spawnedAt: NOW - FIVE_MIN,
            },
            'worker-1': {
              name: 'researcher',
              agentType: 'researcher',
              tmuxSessionName: 'swarm',
              tmuxPaneId: 'in-process',
              cwd: '/tmp',
              spawnedAt: NOW - FIVE_MIN,
            },
            'pane-1': {
              name: 'reviewer',
              agentType: 'reviewer',
              tmuxSessionName: 'swarm',
              tmuxPaneId: '%3',
              cwd: '/tmp',
              spawnedAt: NOW - FIVE_MIN,
            },
          },
          { selfAgentId: 'lead-1', isLeader: true },
        ),
        tasks: {
          t1: {
            type: 'in_process_teammate',
            status: 'running',
            identity: { agentId: 'worker-1' },
            isIdle: true,
          },
        } as unknown as AppState['tasks'],
      }),
      null,
      undefined,
    )
    expect(rows.map(r => r.teammateId)).toEqual(['worker-1', 'pane-1'])
    expect(rows[0]).toMatchObject({
      backend: 'in-process',
      status: 'idle',
      nameShadowed: false,
    })
    expect(rows[1]).toMatchObject({
      backend: 'pane',
      status: undefined,
      nameShadowed: false,
    })
  })

  test('OHm callerTeammateId null does not exclude self', () => {
    const rows = listTeammatesForListing(
      listingState({
        teamContext: teamContext(
          {
            'lead-1': {
              name: 'lead',
              tmuxSessionName: 'current',
              tmuxPaneId: 'leader',
              cwd: '/tmp',
              spawnedAt: NOW,
            },
          },
          { selfAgentId: 'lead-1', isLeader: true },
        ),
      }),
      null,
      null,
    )
    expect(rows.map(r => r.teammateId)).toEqual(['lead-1'])
  })

  test('OHm isLeader===false without selfAgentId does not use leadAgentId', () => {
    const rows = listTeammatesForListing(
      listingState({
        teamContext: teamContext(
          {
            'lead-1': {
              name: 'lead',
              tmuxSessionName: 'current',
              tmuxPaneId: 'leader',
              cwd: '/tmp',
              spawnedAt: NOW,
            },
          },
          { isLeader: false },
        ),
      }),
      null,
      undefined,
    )
    expect(rows.map(r => r.teammateId)).toEqual(['lead-1'])
  })

  test('K1w unreachable vs bare-only on roster', () => {
    const rows = listTeammatesForListing(
      listingState({
        agentNameRegistry: new Map([
          ['helper', 'sub-1'],
          ['Reviewer', 'sub-2'],
        ]),
      }),
      roster([
        {
          agentId: 'r-1',
          name: 'helper',
          joinedAt: NOW - FIVE_MIN,
          tmuxPaneId: '%1',
          cwd: '/tmp',
          subscriptions: [],
        },
        {
          agentId: 'r-2',
          name: 'reviewer',
          joinedAt: NOW - FIVE_MIN,
          tmuxPaneId: '%2',
          cwd: '/tmp',
          subscriptions: [],
        },
      ]),
      undefined,
    )
    expect(rows.find(r => r.teammateId === 'r-1')?.nameShadowed).toBe(
      'unreachable',
    )
    expect(rows.find(r => r.teammateId === 'r-2')?.nameShadowed).toBe(
      'bare-only',
    )
  })
})

describe('formatTeammatesSection', () => {
  test('Z1w in-process row uses name [ref] · type · idle · started', () => {
    const rows = listTeammatesForListing(
      listingState({
        teamContext: teamContext({
          'worker-1': {
            name: 'researcher',
            agentType: 'researcher',
            tmuxSessionName: 'swarm',
            tmuxPaneId: 'in-process',
            cwd: '/tmp',
            spawnedAt: NOW - FIVE_MIN,
          },
        }),
        tasks: {
          t1: {
            type: 'in_process_teammate',
            status: 'running',
            identity: { agentId: 'worker-1' },
            isIdle: true,
          },
        } as unknown as AppState['tasks'],
      }),
      null,
      undefined,
    )
    const listing = formatTeammatesSection(
      rows,
      teammateCandidatesFromRows(rows),
      NOW,
    )
    const ref = teammateRef('worker-1')
    expect(listing).toBe(
      `Teammates (1):\n  researcher [${ref}]  \u00B7  researcher  \u00B7  idle  \u00B7  started 5m ago`,
    )
  })

  test('Z1w pane shows backend; roster uses joined', () => {
    const rows = listTeammatesForListing(
      listingState({
        teamContext: teamContext({
          'pane-1': {
            name: 'reviewer',
            agentType: 'reviewer',
            tmuxSessionName: 'swarm',
            tmuxPaneId: '%3',
            cwd: '/tmp',
            spawnedAt: NOW - FIVE_MIN,
          },
        }),
      }),
      roster([
        {
          agentId: 'r-1',
          name: 'helper',
          agentType: 'helper',
          joinedAt: NOW - FIVE_MIN,
          tmuxPaneId: '%9',
          cwd: '/tmp',
          subscriptions: [],
        },
      ]),
      undefined,
    )
    const listing = formatTeammatesSection(
      rows,
      teammateCandidatesFromRows(rows),
      NOW,
    )
    expect(listing).toContain('Teammates (2):')
    expect(listing).toContain(
      `reviewer [${teammateRef('pane-1')}]  \u00B7  reviewer  \u00B7  pane  \u00B7  started 5m ago`,
    )
    expect(listing).toContain(
      `helper [${teammateRef('r-1')}]  \u00B7  helper  \u00B7  roster  \u00B7  joined 5m ago`,
    )
  })

  test('Z1w shadow copy is official unreachable / bare-only', () => {
    const rows = listTeammatesForListing(
      listingState({
        agentNameRegistry: new Map([
          ['helper', 'sub-1'],
          ['Reviewer', 'sub-2'],
        ]),
      }),
      roster([
        {
          agentId: 'r-1',
          name: 'helper',
          joinedAt: NOW - FIVE_MIN,
          tmuxPaneId: '%1',
          cwd: '/tmp',
          subscriptions: [],
        },
        {
          agentId: 'r-2',
          name: 'reviewer',
          joinedAt: NOW - FIVE_MIN,
          tmuxPaneId: '%2',
          cwd: '/tmp',
          subscriptions: [],
        },
      ]),
      undefined,
    )
    const listing = formatTeammatesSection(
      rows,
      teammateCandidatesFromRows(rows),
      NOW,
    )
    expect(listing).toContain(
      'not messageable by name while a subagent in this session is registered under that name (the name reaches the subagent)',
    )
    expect(listing).toContain(
      'message it by this exact name as printed \u2014 no [ref]: a subagent here is registered under a variant spelling of it',
    )
    expect(listing).not.toContain('helper [')
    expect(listing).not.toContain('reviewer [')
  })

  test('NHm caps at 100 and counts the full set', () => {
    const rows = listTeammatesForListing(
      listingState({}),
      roster(
        Array.from({ length: 101 }, (_, i) => ({
          agentId: `r-${i}`,
          name: `mate-${i}`,
          joinedAt: NOW - FIVE_MIN,
          tmuxPaneId: `%${i}`,
          cwd: '/tmp',
          subscriptions: [],
        })),
      ),
      undefined,
    )
    const listing = formatTeammatesSection(
      rows,
      teammateCandidatesFromRows(rows),
      NOW,
    )
    expect(listing.startsWith('Teammates (101):')).toBe(true)
    expect(listing).toContain('  (\u2026 1 more not shown)')
    expect(listing.match(/^ {2}/gm)?.length).toBe(101)
  })
})

describe('formatPeersListing teammates compose', () => {
  test('teammates-only omits No agents found.', () => {
    const listing = __test.formatPeersListing([], {
      teammatesSection: 'Teammates (1):\n  researcher [abcdef]',
    })
    expect(listing).toBe('Teammates (1):\n  researcher [abcdef]')
    expect(listing).not.toContain('No agents found.')
  })

  test('teammates + peers join with a blank line', () => {
    const listing = __test.formatPeersListing(
      [{ address: 'uds:/tmp/a.sock', name: 'peer', transport: 'uds' }],
      { teammatesSection: 'Teammates (1):\n  researcher [abcdef]' },
    )
    expect(listing).toContain('Teammates (1):')
    expect(listing).toContain('Found 1 agent(s):')
    expect(listing).toContain('\n\nFound 1 agent(s):')
  })

  test('teammates + truncated notes keep official note, not No agents found.', () => {
    const listing = __test.formatPeersListing([], {
      teammatesSection: 'Teammates (1):\n  researcher [abcdef]',
      listTruncated: true,
    })
    expect(listing).toContain('Teammates (1):')
    expect(listing).toContain(SESSION_LIST_TRUNCATED_LISTING_NOTE)
    expect(listing).not.toContain('No agents found.')
  })
})
