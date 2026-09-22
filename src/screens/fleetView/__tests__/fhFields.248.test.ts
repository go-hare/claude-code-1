/**
 * densable 2.1.248 leftover-missing Fh fields — AgentView / fleetView hosts.
 * Gold: Fh @192130704 · ic @192124455 · Ih @192123625 · $ye @182998628
 *       noteDeleteRefusal @192134203 · cp @192191480 · #O / #P / Ss
 * Do not invent function Fh / class gc / function rp / function Xw.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getProjectDir } from '../../../utils/sessionStoragePortable.js'
import {
  FLEET_ADOPTED_PEER_MAX_AGE_MS,
  FLEET_LOOP_KICK_TIMES,
  FLEET_NOT_DELETED_LABEL,
  FLEET_PEER_PROTOCOL_MIN,
  buildAdoptedPeers,
  buildFleetStatuses,
  createLoopScanCache,
  fleetCfActivity,
  fleetJobStatusKey,
  fleetLiveStatus,
  fleetLoBand,
  fleetPeerStateFromLive,
  fleetRowLogTailDetail,
  fleetRpMerge,
  fleetStatusOf,
  mintFleetPending,
  appendFleetPending,
  patchFleetPending,
  removeFleetPending,
  sessionFromPending,
  fleetTranscriptPath,
  isFleetLogTailEligible,
  isFleetLoopKickState,
  isFleetPeersWanted,
  isFleetSelfDrivingState,
  nextFleetStatuses,
  nextLogTails,
  noteDeleteRefusal,
  parseFleetLogTailLine,
  pruneDeleteRefusals,
  pruneLoopKicks,
  readFleetLogTail,
  refreshLoopKicks,
  resetFhOverlay,
  scanLoopTranscript,
  settleLandedPendings,
  shouldResetFhOverlay,
  shouldShowDeleteRefusal,
} from '../fhFields.js'

const AGENT_VIEW = readFileSync(
  join(import.meta.dir, '../../AgentView.tsx'),
  'utf8',
)
const FH = readFileSync(join(import.meta.dir, '../fhFields.ts'), 'utf8')
const PR = readFileSync(join(import.meta.dir, '../prStatuses.ts'), 'utf8')

const prevConfig = process.env.CLAUDE_CONFIG_DIR
const prevHarbor = process.env.CLAUDE_CODE_HARBOR_KITE
let tmpDir: string | undefined

afterEach(() => {
  if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfig
  if (prevHarbor === undefined) delete process.env.CLAUDE_CODE_HARBOR_KITE
  else process.env.CLAUDE_CODE_HARBOR_KITE = prevHarbor
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

function withConfigDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'fh-fields-248-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  return tmpDir
}

describe('densable 2.1.248 Fh leftover host mapping', () => {
  test('lands on AgentView / fleetView hosts — no second Fh/gc/rp/Xw', () => {
    expect(AGENT_VIEW).toContain('const [logTails, setLogTails]')
    expect(AGENT_VIEW).toContain('const [deleteRefusals, setDeleteRefusals]')
    expect(AGENT_VIEW).toContain('const [loopKicks, setLoopKicks]')
    expect(AGENT_VIEW).toContain(
      'const [overlaidLoadLanded, setOverlaidLoadLanded]',
    )
    expect(AGENT_VIEW).toContain('const [adoptedPeers, setAdoptedPeers]')
    expect(AGENT_VIEW).toContain('const [remoteJobs, setRemoteJobs]')
    expect(AGENT_VIEW).toContain(
      'const [remoteListLoaded, setRemoteListLoaded]',
    )
    expect(AGENT_VIEW).toContain('const [pendings, setPendings]')
    expect(AGENT_VIEW).toContain('const [statuses, setStatuses]')
    expect(AGENT_VIEW).toContain('setOverlaidLoadLanded(true)')
    expect(AGENT_VIEW).toContain('noteDeleteRefusal')
    expect(AGENT_VIEW).toContain('readFleetLogTail')
    expect(AGENT_VIEW).toContain('refreshLoopKicks')
    expect(AGENT_VIEW).toContain('buildAdoptedPeers')
    expect(AGENT_VIEW).toContain('buildFleetStatuses')
    expect(AGENT_VIEW).toContain('settleLandedPendings')
    expect(AGENT_VIEW).toContain('fleetRpMerge')
    expect(AGENT_VIEW).toContain('setRemoteWanted')
    expect(AGENT_VIEW).toContain('loadRemote')
    expect(AGENT_VIEW).toContain('const stopRemote')
    expect(AGENT_VIEW).toContain('const archiveRemote')
    expect(AGENT_VIEW).toContain('fleetSimpleWantsRemote')
    expect(AGENT_VIEW).toContain('mintFleetPending')
    expect(AGENT_VIEW).toContain('appendFleetPending')
    expect(AGENT_VIEW).toContain('fleetLiveStatus')
    expect(AGENT_VIEW).toContain('shouldResetFhOverlay')
    expect(AGENT_VIEW).toContain('resetFhOverlay')
    expect(AGENT_VIEW).toContain('FLEET_NOT_DELETED_LABEL')
    expect(AGENT_VIEW).toContain('FLEET_LOOP_KICK_TIMES')
    expect(AGENT_VIEW).toContain('worktree ${phrase}')
    expect(AGENT_VIEW).toContain('worker may still be running')
    expect(AGENT_VIEW).toContain(
      'sessions.length === 0 && overlaidLoadLanded && !error && !simpleView',
    )
    const inventedDecl =
      /(?:^|\n)\s*(?:export\s+)?(?:function Fh\s*\(|class gc\b|function rp\s*\(|function Xw\s*\()/
    expect(AGENT_VIEW).not.toMatch(inventedDecl)
    expect(FH).not.toMatch(inventedDecl)
    expect(FH).not.toContain("bg === 'claude'")
    expect(FH).not.toContain('bg===claude')
    expect(PR).toContain('fleetPrStatuses')
    expect(PR).toContain('`Xw` stay on leftover')
  })

  test('official Xw stays on leftover fleetPrStatuses — not a new selector', () => {
    expect(AGENT_VIEW).toContain('fleetPrStatuses.prStatuses')
    expect(AGENT_VIEW).not.toMatch(/\bfunction Xw\s*\(/)
  })
})

describe('densable 2.1.248 $ye / lo / Cf', () => {
  test('$ye is intent or initialPrompt starting with /loop', () => {
    expect(isFleetLoopKickState({ intent: '/loop every 5m' })).toBe(true)
    expect(isFleetLoopKickState({ initialPrompt: '  /LOOP x' })).toBe(true)
    expect(isFleetLoopKickState({ intent: 'loop later' })).toBe(false)
    expect(isFleetLoopKickState({})).toBe(false)
  })

  test('lo completed skips log tails; active is eligible', () => {
    expect(fleetLoBand({ state: 'done', tempo: 'idle' })).toBe('completed')
    expect(isFleetLogTailEligible({ state: 'done', tempo: 'idle' })).toBe(false)
    expect(fleetLoBand({ state: 'working', tempo: 'active' })).toBe('active')
    expect(isFleetLogTailEligible({ state: 'working', tempo: 'active' })).toBe(
      true,
    )
    expect(fleetLoBand({ tempo: 'blocked' })).toBe('blocked')
    expect(fleetLoBand({ state: 'working' }, 'busy')).toBe('active')
    expect(fleetLoBand({ tempo: 'idle' }, 'waiting')).toBe('blocked')
  })

  test('Cf + self-driving keep success+loop in active band', () => {
    expect(fleetCfActivity('done')).toBe('success')
    expect(fleetCfActivity('failed')).toBe('failure')
    expect(fleetCfActivity('stopped')).toBe('stopped')
    expect(fleetCfActivity('working')).toBe(null)
    expect(isFleetSelfDrivingState({ intent: '/loop' })).toBe(true)
    expect(fleetLoBand({ state: 'done', tempo: 'idle', intent: '/loop' })).toBe(
      'active',
    )
  })
})

describe('densable 2.1.248 ic / Ih logTails', () => {
  test('Ih parses assistant / user / tool_result error', () => {
    expect(
      parseFleetLogTailLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hello tail' }] },
        }),
      ),
    ).toBe('hello tail')
    expect(
      parseFleetLogTailLine(
        JSON.stringify({
          type: 'user',
          message: { content: 'please continue' },
        }),
      ),
    ).toBe('> please continue')
    expect(
      parseFleetLogTailLine(
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                is_error: true,
                content: 'boom',
              },
            ],
          },
        }),
      ),
    ).toBe('\u2717 boom')
    expect(parseFleetLogTailLine('not-json')).toBe(null)
  })

  test('ic reads last unique Ih line from the transcript tail', async () => {
    withConfigDir()
    const cwd = join(tmpDir!, 'repo')
    const sessionId = 'sess-logtail'
    const path = fleetTranscriptPath({ cwd, sessionId })
    expect(path).toBe(join(getProjectDir(cwd), `${sessionId}.jsonl`))
    mkdirSync(getProjectDir(cwd), { recursive: true })
    writeFileSync(
      path!,
      [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'first' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'first' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'latest' }] },
        }),
        '',
      ].join('\n'),
    )
    await expect(readFleetLogTail({ state: { cwd, sessionId } })).resolves.toBe(
      'latest',
    )
  })

  test('nextLogTails keeps identity when values match', () => {
    const prev = { a: 'x' }
    expect(nextLogTails(prev, [['a', 'x']])).toBe(prev)
    expect(nextLogTails(prev, [['a', 'y']])).toEqual({ a: 'y' })
  })

  test('Ss logTail slot prefers detail; else active non-success tail', () => {
    expect(
      fleetRowLogTailDetail(
        { state: 'working', tempo: 'active' },
        'from job',
        'from tail',
      ),
    ).toBe('from job')
    expect(
      fleetRowLogTailDetail(
        { state: 'working', tempo: 'active' },
        undefined,
        'from tail',
      ),
    ).toBe('from tail')
    expect(
      fleetRowLogTailDetail(
        { state: 'done', tempo: 'idle' },
        undefined,
        'from tail',
      ),
    ).toBe('')
  })
})

describe('densable 2.1.248 deleteRefusals / cp', () => {
  test('noteDeleteRefusal null-clears; prune is Li', () => {
    const empty = new Map<string, string>()
    const written = noteDeleteRefusal(
      empty,
      'job1',
      'worker may still be running',
    )
    expect(written.get('job1')).toBe('worker may still be running')
    expect(
      noteDeleteRefusal(written, 'job1', 'worker may still be running'),
    ).toBe(written)
    expect(noteDeleteRefusal(written, 'job1', null).has('job1')).toBe(false)
    const kept = pruneDeleteRefusals(written, new Set(['job1']))
    expect(kept).toBe(written)
    expect(pruneDeleteRefusals(written, new Set()).has('job1')).toBe(false)
  })

  test('Ss shows not deleted only when Cf && tempo !== active', () => {
    expect(FLEET_NOT_DELETED_LABEL).toBe('not deleted')
    expect(
      shouldShowDeleteRefusal(
        { state: 'done', tempo: 'idle' },
        'worktree dirty',
      ),
    ).toBe('worktree dirty')
    expect(
      shouldShowDeleteRefusal(
        { state: 'done', tempo: 'active' },
        'worktree dirty',
      ),
    ).toBeUndefined()
    expect(
      shouldShowDeleteRefusal(
        { state: 'working', tempo: 'idle' },
        'worktree dirty',
      ),
    ).toBeUndefined()
  })
})

describe('densable 2.1.248 loopKicks / ec', () => {
  test('ec counts scheduled_task_fire and estimates nextAt', async () => {
    withConfigDir()
    const path = join(tmpDir!, 'loop.jsonl')
    const t0 = Date.parse('2026-09-20T00:00:00.000Z')
    const t1 = t0 + 60_000
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: 'system',
          subtype: 'scheduled_task_fire',
          timestamp: new Date(t0).toISOString(),
        }),
        JSON.stringify({
          type: 'system',
          subtype: 'scheduled_task_fire',
          timestamp: new Date(t1).toISOString(),
        }),
        '',
      ].join('\n'),
    )
    const cache = createLoopScanCache()
    const scan = await scanLoopTranscript(path, cache)
    expect(scan?.count).toBe(2)
    expect(scan?.nextAt).toBe(null)
    const later = await refreshLoopKicks(
      [
        {
          state: {
            intent: '/loop every 1m',
            cwd: join(tmpDir!, 'repo'),
            sessionId: 'loop-sess',
          },
        },
      ],
      new Map(),
      cache,
    )
    expect(later.size).toBe(0)
  })

  test('refreshLoopKicks writes count when $ye transcript is present', async () => {
    withConfigDir()
    const cwd = join(tmpDir!, 'repo')
    const sessionId = 'loop-sess'
    const path = fleetTranscriptPath({ cwd, sessionId })
    mkdirSync(getProjectDir(cwd), { recursive: true })
    const t0 = Date.now() - 120_000
    writeFileSync(
      path!,
      [
        `{"type":"system","subtype":"scheduled_task_fire","timestamp":"${new Date(t0).toISOString()}"}`,
        `{"type":"system","subtype":"scheduled_task_fire","timestamp":"${new Date(t0 + 60_000).toISOString()}"}`,
        '',
      ].join('\n'),
    )
    const next = await refreshLoopKicks(
      [{ state: { intent: '/loop', cwd, sessionId } }],
      new Map(),
      createLoopScanCache(),
    )
    expect(next.get(sessionId)?.count).toBe(2)
    expect(FLEET_LOOP_KICK_TIMES).toBe('\u00d7')
  })

  test('pruneLoopKicks drops sessionIds that left the job list', () => {
    const map = new Map([
      ['keep', { mtimeMs: 1, count: 2, nextAt: null }],
      ['gone', { mtimeMs: 1, count: 1, nextAt: null }],
    ])
    const pruned = pruneLoopKicks(map, new Set(['keep']))
    expect([...pruned.keys()]).toEqual(['keep'])
  })
})

describe('densable 2.1.248 statuses / liveStatus / #O', () => {
  test('Ir / ac / #O fill from live status + jobId', () => {
    expect(fleetJobStatusKey('abc')).toBe('job:abc')
    const statuses = buildFleetStatuses([
      {
        pid: 2,
        sessionId: 'sess-a',
        jobId: 'job-a',
        status: 'busy',
      },
      { pid: 3, sessionId: 'sess-b' },
    ])
    expect(statuses.get('sess-a')).toBe('busy')
    expect(statuses.get('job:job-a')).toBe('busy')
    expect(statuses.has('sess-b')).toBe(false)
    expect(
      fleetStatusOf(statuses, {
        id: 'job-a',
        state: { sessionId: 'sess-a' },
      }),
    ).toBe('busy')
    expect(nextFleetStatuses(statuses, statuses)).toBe(statuses)
    const same = new Map(statuses)
    expect(nextFleetStatuses(same, new Map(same))).toBe(same)
  })

  test('liveStatus: exec/remote/pending/held without inventing #b/#h', () => {
    const holders = new Map([['sess-held', 9]])
    expect(
      fleetLiveStatus(
        {
          id: 'ex',
          state: { template: 'exec', respawnFlags: [], tempo: 'active' },
        },
        { statuses: new Map(), holders, pendings: [] },
      ),
    ).toBe('busy')
    expect(
      fleetLiveStatus(
        {
          id: 'ex',
          state: { template: 'exec', respawnFlags: [], tempo: 'idle' },
        },
        { statuses: new Map(), holders, pendings: [] },
      ),
    ).toBeUndefined()
    expect(
      fleetLiveStatus(
        { id: 'r', state: { backend: 'remote', tempo: 'active' } },
        { statuses: new Map(), holders, pendings: [] },
      ),
    ).toBe('busy')
    expect(
      fleetLiveStatus(
        { id: 'p', state: { sessionId: 'pending-1' } },
        {
          statuses: new Map(),
          holders,
          pendings: [{ id: 'p', state: { sessionId: 'pending-1' } }],
        },
      ),
    ).toBe('busy')
    expect(
      fleetLiveStatus(
        {
          id: 'held',
          state: { sessionId: 'sess-held', backend: 'daemon' },
        },
        {
          statuses: new Map([['job:held', 'waiting']]),
          holders,
          pendings: [],
        },
      ),
    ).toBe('waiting')
  })
})

describe('densable 2.1.248 adoptedPeers / remote / pendings / #P', () => {
  test('#O adoptedPeers requires peerProtocol >= _2t and Po+GB', () => {
    expect(FLEET_PEER_PROTOCOL_MIN).toBe(1)
    expect(FLEET_ADOPTED_PEER_MAX_AGE_MS).toBe(86_400_000)
    expect(isFleetPeersWanted()).toBe(false)
    const now = Date.now()
    const live = [
      {
        kind: 'interactive' as const,
        pid: 99,
        sessionId: 'peer-sess',
        startedAt: now,
        updatedAt: now,
      },
    ]
    expect(buildAdoptedPeers(live, new Set(), 1, now)).toEqual([])
    expect(
      buildAdoptedPeers([{ ...live[0]!, peerProtocol: 1 }], new Set(), 1, now),
    ).toEqual([
      {
        id: 'peer-99',
        state: fleetPeerStateFromLive({ ...live[0]!, peerProtocol: 1 }),
      },
    ])
    expect(
      buildAdoptedPeers(
        [{ ...live[0]!, peerProtocol: 1 }],
        new Set(['peer-sess']),
        1,
        now,
      ),
    ).toEqual([])
  })

  test('settleLandedPendings + #P overlay reset; rp merges Ct/Mt/Lt', () => {
    const pendings = [
      { id: 'landed', state: { sessionId: 's1' } },
      { id: 'still', state: { sessionId: 's2' } },
    ]
    expect(settleLandedPendings(pendings, new Set(['landed']))).toEqual([
      { id: 'still', state: { sessionId: 's2' } },
    ])
    const overlay = {
      pendings,
      remoteJobs: [{ id: 'remote-pending-1' }, { id: 'remote-ok' }],
      remoteListLoaded: true,
      overlaidLoadLanded: true,
    }
    expect(shouldResetFhOverlay(overlay)).toBe(true)
    expect(resetFhOverlay(overlay)).toEqual({
      pendings: [],
      remoteJobs: [{ id: 'remote-ok' }],
      remoteListLoaded: false,
      overlaidLoadLanded: false,
    })
    const minted = mintFleetPending({
      id: 'pend-1',
      intent: 'do it',
      cwd: '/repo',
    })
    expect(minted.activity).toBe('flowing')
    expect(appendFleetPending([], minted)).toEqual([minted])
    expect(removeFleetPending([minted], 'pend-1')).toEqual([])
    expect(
      patchFleetPending([minted], 'pend-1', {
        ...minted,
        id: 'abcd1234',
        state: { ...minted.state, sessionId: 'sess-1' },
      })[0]?.id,
    ).toBe('abcd1234')
    expect(sessionFromPending(minted).status).toBe('busy')

    const local = {
      pid: 1,
      sessionId: 'local-sess',
      cwd: '/repo',
      startedAt: 1,
      kind: 'bg',
      short: 'local1',
    }
    const merged = fleetRpMerge({
      sessions: [local],
      adoptedPeers: [],
      remoteJobs: [
        { id: 'r', state: { sessionId: 'remote-1', backend: 'remote' } },
      ],
      pendings: [minted],
      peersEnabled: false,
      showRemoteTabs: false,
      simpleWantsRemote: true,
    })
    expect(merged.map(s => s.short)).toEqual(['pend-1', 'local1', 'r'])
    expect(
      fleetRpMerge({
        sessions: [local],
        adoptedPeers: [],
        remoteJobs: [{ id: 'r', state: { sessionId: 'remote-1' } }],
        pendings: [],
        peersEnabled: false,
        showRemoteTabs: false,
        simpleWantsRemote: false,
      }).map(s => s.short),
    ).toEqual(['local1'])
    const peer = {
      id: 'peer-99',
      state: fleetPeerStateFromLive({
        kind: 'interactive',
        pid: 99,
        sessionId: 'peer-sess',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        peerProtocol: 1,
        status: 'busy',
      }),
    }
    expect(
      fleetRpMerge({
        sessions: [local],
        adoptedPeers: [peer],
        remoteJobs: [],
        pendings: [],
        peersEnabled: true,
        showRemoteTabs: false,
        simpleWantsRemote: false,
      }).map(s => s.short),
    ).toEqual(['local1', 'peer-99'])
  })
})
