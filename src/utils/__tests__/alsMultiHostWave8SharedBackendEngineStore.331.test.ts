import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import {
  resolveTurnHandoffAdmission,
  shouldUseTurnHandoffRelayMarker,
} from '../../cli/printControlExtras.js'
import {
  getLocalISODate,
  getSessionTimezone,
  isSessionTimezoneAssumed,
  setSessionTimezone,
} from '../../constants/common.js'
import { AcpAgent } from '../../services/acp/agent.js'
import {
  isAsyncReplEnabled,
  markPollEventWiringForTerminalRun,
  resetCodeModeOptInStateForTests,
  sandboxHostListsBlockCodeMode,
  setEngineCheckResultForTests,
  setSandboxCommandNetworkListsOffered,
  settleCodeModeOptIn,
} from '../../services/codeMode/optIn.js'
import { isReplSpliceWaitEnabled } from '../../services/codeMode/replSessions.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { clearMemoryFileCaches, getMemoryFiles } from '../claudemd.js'
import { getSdkEventQueue, holdSdkEventQueueLevels } from '../sdkEventQueue.js'
import {
  getBootstrapSession,
  isSharedBackend,
  runWithNewHostSession,
  runWithSession,
  setSharedBackendMode,
} from '../sessionHost.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

function makeAcpConn(): AgentSideConnection {
  return {
    sessionUpdate: async () => {},
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    readTextFile: async () => ({ content: '' }),
    writeTextFile: async () => ({}),
  } as unknown as AgentSideConnection
}

afterEach(() => {
  setSharedBackendMode(false)
  setSessionTimezone(undefined, false)
  resetCodeModeOptInStateForTests()
  getSdkEventQueue().reset()
  getBootstrapSession().engineStore.reset()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

describe('2.1.331 Wave 8: isSharedBackend (o7) guards & Session.engineStore.adopt parity', () => {
  test('sdkEventQueue.holdSdkEventQueueLevels (SWl): no-op outside ALS under sharedBackend, active inside ALS host', () => {
    setSharedBackendMode(false)
    const hSingle = holdSdkEventQueueLevels()
    expect(getSdkEventQueue().isHoldingLevels()).toBe(true)
    hSingle.release()
    expect(getSdkEventQueue().isHoldingLevels()).toBe(false)

    setSharedBackendMode(true)
    // Outside ALS under sharedBackend -> no-op
    const hSharedOutside = holdSdkEventQueueLevels()
    expect(getSdkEventQueue().isHoldingLevels()).toBe(false)
    hSharedOutside.release()

    // Inside ALS under sharedBackend -> holds only that host's queue
    runWithNewHostSession({ id: 'sdk-hold-host-a' }, () => {
      const hInside = holdSdkEventQueueLevels()
      expect(getSdkEventQueue().isHoldingLevels()).toBe(true)
      hInside.release()
      expect(getSdkEventQueue().isHoldingLevels()).toBe(false)
    })
  })

  test('constants/common.ts (Hxr / C5i): session timezone isolates per root session, shares across forks, honors sharedBackend & diskless UTC', () => {
    setSessionTimezone('America/New_York', true)
    expect(getSessionTimezone()).toBe('America/New_York')
    expect(isSessionTimezoneAssumed()).toBe(true)

    // Under sharedBackend outside ALS, default host timezone is suppressed
    setSharedBackendMode(true)
    expect(getSessionTimezone()).toBeUndefined()

    // Diskless host falls back to 'UTC'
    runWithNewHostSession({ id: 'tz-diskless', diskless: true }, () => {
      expect(getSessionTimezone()).toBe('UTC')
      expect(getLocalISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    // Per-root-session isolation + fork sharing + dateline formatting
    runWithNewHostSession({ id: 'tz-host-a' }, sessionA => {
      setSessionTimezone('Pacific/Kiritimati', false)
      const dateA = getLocalISODate()
      expect(dateA).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      const forkA = sessionA.withProject({ cwd: '/tmp/tz-fork-a' })
      runWithSession(forkA, () => {
        expect(getSessionTimezone()).toBe('Pacific/Kiritimati')
        expect(getLocalISODate()).toBe(dateA)
      })

      runWithNewHostSession({ id: 'tz-host-b' }, () => {
        expect(getSessionTimezone()).toBeUndefined()
        setSessionTimezone('Pacific/Niue', false)
        expect(getSessionTimezone()).toBe('Pacific/Niue')
        expect(getLocalISODate()).not.toBe(dateA)
      })

      expect(getSessionTimezone()).toBe('Pacific/Kiritimati')
    })
  })

  test('codeMode/optIn & replSessions (ACr / WRo / Ize): sharedBackend disables async REPL/splice-wait and guards outside-ALS holdoff', () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    markPollEventWiringForTerminalRun()
    expect(isAsyncReplEnabled()).toBe(true)
    expect(isReplSpliceWaitEnabled()).toBe(true)

    setSandboxCommandNetworkListsOffered(true)
    expect(sandboxHostListsBlockCodeMode()).toBe(true)

    // Shared backend turns off outside-ALS holdoff & disables async REPL / splice-wait
    setSharedBackendMode(true)
    expect(sandboxHostListsBlockCodeMode()).toBe(false)
    expect(isAsyncReplEnabled()).toBe(false)
    expect(isReplSpliceWaitEnabled()).toBe(false)

    // Inside ALS host, per-host sandbox holdoff still reports true while async REPL stays off
    runWithNewHostSession({ id: 'cm-shared-host' }, () => {
      setEngineCheckResultForTests('passed')
      settleCodeModeOptIn({ state: 'on', source: 'shell' })
      markPollEventWiringForTerminalRun()
      setSandboxCommandNetworkListsOffered(true)
      expect(sandboxHostListsBlockCodeMode()).toBe(true)
      expect(isAsyncReplEnabled()).toBe(false)
      expect(isReplSpliceWaitEnabled()).toBe(false)
    })
  })

  test('printControlExtras (g5r / turn_handoff): sharedBackend disables turn_handoff admission and relay marker', () => {
    const baseInput = {
      sdkUrl: 'https://claude.ai/sdk',
      remoteSessionId: 'sess_123',
      environmentKind: undefined,
      disabled: false,
    }
    const admitted = resolveTurnHandoffAdmission(baseInput)
    expect(admitted.admitted).toBe(true)

    const denied = resolveTurnHandoffAdmission({
      ...baseInput,
      sharedBackend: true,
    })
    expect(denied).toEqual({ admitted: false, reason: 'shared_backend' })

    expect(
      shouldUseTurnHandoffRelayMarker({
        admission: admitted,
        relayConfigured: true,
        persistsTranscript: true,
      }),
    ).toBe(true)

    setSharedBackendMode(true)
    expect(
      shouldUseTurnHandoffRelayMarker({
        admission: admitted,
        relayConfigured: true,
        persistsTranscript: true,
      }),
    ).toBe(false)
  })

  test('AcpAgent: sole session adopts engineStore with sharedBackend=false; 2nd concurrent session flips sharedBackend=true and restores on teardown', async () => {
    const repoA = makeTempDir('w8-acp-a-')
    const repoB = makeTempDir('w8-acp-b-')
    const agent = new AcpAgent(makeAcpConn())
    await agent.initialize({ protocolVersion: 1 } as never)

    expect(isSharedBackend()).toBe(false)

    const resA = await agent.newSession({ cwd: repoA, mcpServers: [] })
    expect(isSharedBackend()).toBe(false)

    const sessionA = agent.sessions.get(resA.sessionId)
    expect(sessionA).toBeDefined()
    const storeA = sessionA!.hostSession.engineStore.current as
      | { getState: () => { toolPermissionContext: { mode: string } } }
      | undefined
    expect(storeA).toBeDefined()
    expect(typeof storeA?.getState().toolPermissionContext.mode).toBe('string')
    // Fork shares adopted engineStore
    expect(
      sessionA!.hostSession.withProject({ cwd: repoA }).engineStore.current,
    ).toBe(storeA)

    const resB = await agent.newSession({ cwd: repoB, mcpServers: [] })
    expect(isSharedBackend()).toBe(true)

    const sessionB = agent.sessions.get(resB.sessionId)
    expect(sessionB).toBeDefined()
    const storeB = sessionB!.hostSession.engineStore.current
    expect(storeB).toBeDefined()
    expect(storeB).not.toBe(storeA)

    await agent.teardownSession(resB.sessionId)
    expect(sessionB!.hostSession.engineStore.current).toBeUndefined()
    expect(isSharedBackend()).toBe(false)

    await agent.teardownSession(resA.sessionId)
    expect(sessionA!.hostSession.engineStore.current).toBeUndefined()
    expect(isSharedBackend()).toBe(false)
  })

  test('claudemd.ts (uZr): Session.engineStore.adopt(store) feeds live Read deny rules per root session without registerClaudeMdPermissionContextSource', async () => {
    const repoA = makeTempDir('w8-cmd-a-')
    const repoB = makeTempDir('w8-cmd-b-')
    writeFileSync(join(repoA, 'CLAUDE.md'), '# SECRET_ALPHA_MEMORY\n')
    writeFileSync(join(repoB, 'CLAUDE.md'), '# PUBLIC_BETA_MEMORY\n')

    const [filesA, filesB] = await Promise.all([
      runWithNewHostSession(
        { id: 'uZr-host-a', cwd: repoA, originalCwd: repoA },
        async sessionA => {
          const denyCtx = {
            ...getEmptyToolPermissionContext(),
            alwaysDenyRules: { userSettings: ['Read(CLAUDE.md)'] },
          }
          sessionA.engineStore.adopt({
            getState: () => ({ toolPermissionContext: denyCtx }),
          })
          clearMemoryFileCaches()
          return getMemoryFiles()
        },
      ),
      runWithNewHostSession(
        { id: 'uZr-host-b', cwd: repoB, originalCwd: repoB },
        async sessionB => {
          const allowCtx = getEmptyToolPermissionContext()
          sessionB.engineStore.adopt({
            getState: () => ({ toolPermissionContext: allowCtx }),
          })
          clearMemoryFileCaches()
          return getMemoryFiles()
        },
      ),
    ])

    const contentsA = filesA.map(f => f.content).join('\n')
    const contentsB = filesB.map(f => f.content).join('\n')
    expect(contentsA).not.toContain('SECRET_ALPHA_MEMORY')
    expect(contentsB).toContain('PUBLIC_BETA_MEMORY')
  })
})
