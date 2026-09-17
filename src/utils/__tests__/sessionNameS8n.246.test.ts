/**
 * densable 2.1.246 #49 — Or / s8n (Pi Kr 3-arg).
 * 09-16 promoted to HAVE.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  __resetRegisteredSessionNameForTests,
  setRegisteredName,
} from '../concurrentSessions.js'
import {
  applyLeftoverS8nUserName,
  isSessionNameFullyApplied,
  findSupersedingRegistryName,
  type SessionNameUniquenessDeps,
} from '../sessionNameUniqueness.js'
import { getProject, resetProjectForTesting } from '../sessionStorage.js'

const srcRoot = join(import.meta.dir, '../..')

function rec(
  pid: number,
  name: string,
  startedAt: number,
): { pid: number; name: string; startedAt: number; procStart: string } {
  return { pid, name, startedAt, procStart: `ps-${pid}` }
}

describe('leftover Or / s8n (2.1.246 Pi Kr)', () => {
  test('Or is leftover isTeammate; Pi serializes Kr on tt', () => {
    const init = readFileSync(join(srcRoot, 'bridge/initReplBridge.ts'), 'utf8')
    expect(init).toContain('isTeammate')
    expect(init).toContain('titlePropagateChain')
    expect(init).toContain('applyLeftoverS8nUserName')
    expect(init).toContain('onRenameSession: name propagation failed:')
    expect(init).toContain('!isTeammate() && !foreign')
    const teammate = readFileSync(join(srcRoot, 'utils/teammate.ts'), 'utf8')
    expect(teammate).toContain('if (inProcessCtx) return true')
    expect(teammate).toContain(
      'return !!(dynamicTeamContext?.agentId && dynamicTeamContext?.teamName)',
    )
    const gold = readFileSync(
      join(
        srcRoot,
        '../docs/upstream-extraction/v2.1.246/snippets/gold-bytecode-na-ie-he-bln.txt',
      ),
      'utf8',
    )
    expect(gold).toContain('isTeammate:()=>c')
    expect(gold).toContain('async function s8n(e,t,n,r,o=!1,s,i)')
    expect(gold).toContain(
      'function p8n(e,t){if(t)return!1;return d_()?.name===e&&my(We())===e&&l1e()===e}',
    )
    expect(gold).toContain(
      'function rTe(e,t,n){let r=d_();if(r===void 0||r.source==="derived")return;',
    )
    expect(gold).toContain('async function Li(e,t,n,r,i,s)')
    expect(gold).toContain('async function Ti(e,t,n,r,i)')
    expect(gold).toContain(
      'function P(e){return e.replace(/[\\p{Cc}\\p{Cf}\\u2028\\u2029]+/gu," ")}',
    )
    const uniq = readFileSync(
      join(srcRoot, 'utils/sessionNameUniqueness.ts'),
      'utf8',
    )
    expect(uniq).toContain('isSessionNameFullyApplied')
    expect(uniq).toContain('findSupersedingRegistryName')
    expect(uniq).toContain('patchBgJobDirRespawnFlags')
    expect(uniq).toContain('patchBgJobRegistrySessionName')
    expect(uniq).toContain('applySessionName')
    expect(uniq).toContain('applySessionNameWithOutcome')
    expect(uniq).toContain('getSurfaceRemoteHandle')
    expect(uniq).toContain('replaceSurfaceCapabilities')
    expect(uniq).toContain("m?.kind === 'ccr' && m.sessionId")
    expect(uniq).not.toContain('latchCcrSessionId')
    expect(uniq).toContain('getPinnedStorageV5')
    const sidecar = readFileSync(
      join(srcRoot, 'utils/sessionNameJobSidecar.ts'),
      'utf8',
    )
    expect(sidecar).toContain('export async function patchBgJobDirRespawnFlags')
    expect(sidecar).toContain(
      'export async function patchBgJobRegistrySessionName',
    )
    expect(sidecar).toContain('export function resolveBgJobShortId')
    expect(sidecar).toContain('export function resolveJobDirStorageV5Key')
    expect(sidecar).toContain('export function isValidStoragePathSegment')
    expect(sidecar).toContain('getBgJobTakeover()?.jobDir')
    expect(sidecar).toContain('Official JS has no caller')
    expect(uniq).toContain('syncReplBridgeSelfTitle')
    expect(uniq).toContain('stripBridgeSessionIdPrefix')
    expect(uniq).toContain("id.replace(/^(?:session|cse)_/, '')")
    expect(uniq).toContain('credentials')
    expect(init).toContain('startTranscriptPersistenceBackfill')
    expect(init).toContain('onTransportPersistenceReady')
    const persist = readFileSync(
      join(srcRoot, 'utils/sessionPersistenceSync.ts'),
      'utf8',
    )
    expect(persist).toContain(
      'export async function backfillPersistedTranscripts',
    )
    expect(persist).toContain(
      'export async function readTranscriptEventsReverse',
    )
    expect(persist).toContain('readTranscriptLinesReverse')
    expect(persist).toContain('parseTranscriptKeyFromPath')
    expect(persist).toContain('iterateTranscriptRecordPages')
    expect(persist).toContain('createTranscriptStorageKey')
    expect(persist).toContain('bSa as or')
    expect(persist).toContain("order: 'backward'")
    expect(persist).toContain('RECORD_PAGE_FIRST_MAX_BYTES')
    expect(persist).toContain('export async function listSubagentIdsForSession')
    expect(persist).toContain(
      'export async function readSubagentTranscriptsFromStorage',
    )
    expect(persist).toContain('export async function drainPagedListEntries')
    expect(persist).toContain('storageV5 && key')
    expect(persist).toContain('collectSubagentTranscripts')
    expect(persist).toContain('listSessionTranscriptPaths')
    expect(persist).toContain('isCompactBoundaryEvent')
    expect(persist).toContain('isHistorySuppressionJsonlLine')
    expect(persist).toContain('getMainTranscriptPathForPersist')
    const hook = readFileSync(join(srcRoot, 'hooks/useReplBridge.tsx'), 'utf8')
    expect(hook).toContain('s_e=1e4')
    expect(hook).toContain(
      'suppressHistoryBackfill: leftoverEt || leftoverDt || leftoverMo',
    )
    expect(hook).toContain(
      'leftoverPn ? undefined : lastBridgeSessionIdRef.current',
    )
    expect(hook).toContain(
      '[bridge:repl] Reattach stash owner differs from current credential account — dropping stash, minting fresh (history not uploaded)',
    )
    expect(hook).toContain('chokepoint_veto')
    expect(hook).toContain('markPrecautionarySessionSuppression(historySid)')
    expect(hook).toContain('markResilientPrecautionSid(historySid)')
    expect(hook).toContain('clearScanUncertaintyHoldSid(historySid)')
    expect(hook).toContain('clearBridgeSessionCache()')
    expect(hook).toContain('GUa as HR ← qXs as GUa')
    expect(hook).toContain('JUa as jR ← KXs as JUa')
    expect(hook).toContain('MUa as FK ← ZXs as MUa')
    expect(hook).toContain('ZUa as tC ← r9s as ZUa')
    expect(hook).toContain('fe / Z are hook-local refs (not imports)')
    expect(hook).toContain('const s_e = 1e4')
    expect(hook).toContain('if (leftoverPn)')
    expect(hook).toContain('archiveAbandoned: oe')
    expect(hook).toContain('gt.archive')
    expect(hook).toContain('Deferred archive failed')
    expect(init).toContain('storageV5: getPinnedStorageV5()')
    expect(init).toContain('handle.titleWriter = titleWriter')
    expect(init).toContain('clearScanUncertaintyHoldSid(getSessionId())')
    expect(init).toContain('markResilientPrecautionSid(sid)')
    // 语义化后这行超过 80 列被 biome 折行，故按去空白后比对
    expect(init.replace(/\s+/g, ' ')).toContain(
      'probeActiveSessionHistorySuppression( getPinnedStorageV5(), )',
    )
    expect(init).toContain('releaseScanPrecautionHold(scanSid)')
    expect(init).toContain('applyScanPrecautionHold(scanSid)')
    expect(init).toContain('leftoverXn')
    expect(init).toContain('onHistoryBackfillSuppressed')
    expect(init).toContain('isScanUncertaintyHeld(historySid)')
    expect(init).toContain('uncertaintyOnly: true')
    expect(init).toContain("'scan_torn'")
    expect(init).toContain("'scan_budget_exhausted'")
    expect(init).toContain("'scan_read_error'")
    const storage = readFileSync(
      join(srcRoot, 'utils/sessionStorage.ts'),
      'utf8',
    )
    expect(storage).toContain('parseSessionSidecarKeyFromPath')
    expect(storage).toContain('writeCustomTitleSidecar')
    expect(storage).toContain(
      'sessionId === getSessionId()\n        ? getTranscriptPathForSession(sessionId)',
    )
    expect(storage).toContain('isHoverRestOn()')
    expect(storage).toContain('getCustomTitleSidecarPath')
    expect(storage).toContain('writeSessionTitleSidecar:')
    expect(storage).toContain('probeActiveSessionHistorySuppression')
    expect(storage).toContain('releaseScanPrecautionHold')
    expect(storage).toContain('applyScanPrecautionHold')
    expect(storage).toContain('getActiveSessionTranscriptPath')
    expect(storage).toContain('isScanUncertaintyHeld')
    expect(storage).toContain('Official `e9s`/`TUa` has no JS caller')
    expect(uniq).toContain('getActiveSessionTranscriptPath()')
  })

  test('s8n leftover: empty sanitize returns null', async () => {
    expect(await applyLeftoverS8nUserName('   ')).toBeNull()
  })

  test('s8n leftover: own-name writes registry and skips doe', async () => {
    __resetRegisteredSessionNameForTests()
    setRegisteredName('phone-title', 'user')
    const writes: Array<{ name: string; source: string }> = []
    let recheck = 0
    const u = await applyLeftoverS8nUserName('phone-title', {
      persistAgentName: async () => {},
      writeName: async (name, source) => {
        writes.push({ name, source })
      },
      scheduleRecheck: () => {
        recheck++
      },
    })
    expect(u).toBe('phone-title')
    expect(writes).toEqual([{ name: 'phone-title', source: 'user' }])
    expect(recheck).toBe(0)
    __resetRegisteredSessionNameForTests()
  })

  test('s8n leftover: keep schedules doe; yield writes collision', async () => {
    __resetRegisteredSessionNameForTests()
    const writes: Array<{ name: string; source: string }> = []
    const depsKeep: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => [rec(process.pid, 'solo', 1)],
    }
    const kept = await applyLeftoverS8nUserName('fresh-name', {
      persistAgentName: async () => {},
      writeName: async (name, source) => {
        writes.push({ name, source })
      },
      deps: depsKeep,
      scheduleRecheck: () => {},
    })
    expect(kept).toBe('fresh-name')
    expect(writes).toEqual([{ name: 'fresh-name', source: 'user' }])

    writes.length = 0
    const depsYield: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => [
        rec(1, 'shared', 1),
        rec(process.pid, 'other', 99),
      ],
    }
    const yielded = await applyLeftoverS8nUserName('shared', {
      persistAgentName: async () => {},
      writeName: async (name, source) => {
        writes.push({ name, source })
      },
      deps: depsYield,
      scheduleRecheck: () => {},
    })
    expect(yielded).not.toBe('shared')
    expect(writes[0]?.source).toBe('collision')
    __resetRegisteredSessionNameForTests()
  })

  test('p8n leftover: strict triple skips persist', async () => {
    __resetRegisteredSessionNameForTests()
    resetProjectForTesting()
    setRegisteredName('phone-title', 'user')
    getProject().currentSessionTitle = 'phone-title'
    getProject().currentSessionAgentName = 'phone-title'
    expect(isSessionNameFullyApplied('phone-title')).toBe(true)
    expect(isSessionNameFullyApplied('phone-title', true)).toBe(false)
    const writes: Array<{ name: string; source: string }> = []
    let persist = 0
    const u = await applyLeftoverS8nUserName('phone-title', {
      persistAgentName: async () => {
        persist++
      },
      writeName: async (name, source) => {
        writes.push({ name, source })
      },
      scheduleRecheck: () => {
        throw new Error('doe must not run on p8n')
      },
    })
    expect(u).toBe('phone-title')
    expect(writes).toEqual([])
    expect(persist).toBe(0)
    getProject().currentSessionAgentName = 'other'
    expect(isSessionNameFullyApplied('phone-title')).toBe(false)
    __resetRegisteredSessionNameForTests()
    resetProjectForTesting()
  })

  test('rTe leftover: superseded returns live name and skips persist', async () => {
    __resetRegisteredSessionNameForTests()
    setRegisteredName('old-name', 'user')
    const snapshot = {
      name: 'old-name',
      source: 'user' as const,
      since: 1,
    }
    expect(
      findSupersedingRegistryName(snapshot, 'fresh-name', 'fresh-name'),
    ).toBeUndefined()
    setRegisteredName('hijack', 'user')
    expect(
      findSupersedingRegistryName(snapshot, 'fresh-name', 'fresh-name')?.name,
    ).toBe('hijack')
    __resetRegisteredSessionNameForTests()
    setRegisteredName('old-name', 'user')
    const writes: Array<{ name: string; source: string }> = []
    const deps: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => {
        setRegisteredName('hijack', 'user')
        return [rec(process.pid, 'hijack', 1)]
      },
    }
    const u = await applyLeftoverS8nUserName('fresh-name', {
      writeName: async (name, source) => {
        writes.push({ name, source })
      },
      deps,
      scheduleRecheck: () => {
        throw new Error('doe must not run on rTe superseded')
      },
    })
    expect(u).toBe('hijack')
    expect(writes).toEqual([])
    __resetRegisteredSessionNameForTests()
  })

  test('c8n leftover: collision maps to hook', async () => {
    const { mapApplySourceToAgentSource, settleSessionNameApply } =
      await import('../sessionNameUniqueness.js')
    expect(mapApplySourceToAgentSource('collision')).toBe('hook')
    expect(mapApplySourceToAgentSource('user')).toBe('user')
    __resetRegisteredSessionNameForTests()
    const pre = await settleSessionNameApply('x', 'collision')
    expect(pre.settle).toBe('pre-decided')
    expect(pre.recordSource).toBe('collision')
  })

  test('Li leftover: bg jobDir rewrites --name respawnFlags', async () => {
    const {
      isSafeRespawnFlagValue,
      patchBgJobDirRespawnFlags,
      shouldAllowJobNameUpdate,
      formatJobRespawnFlagArgs,
    } = await import('../sessionNameJobSidecar.js')
    expect(isSafeRespawnFlagValue('phone')).toBe(true)
    expect(isSafeRespawnFlagValue('--x')).toBe(false)
    expect(formatJobRespawnFlagArgs('--name', 'phone')).toEqual([
      '--name',
      'phone',
    ])
    expect(formatJobRespawnFlagArgs('--name', '--x')).toEqual(['--name=--x'])
    expect(
      shouldAllowJobNameUpdate({ name: 'old', nameSource: 'user' }, ['old']),
    ).toBe(true)
    expect(
      shouldAllowJobNameUpdate({ name: 'old', nameSource: 'user' }, ['other']),
    ).toBe(false)
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
      'fs'
    )
    const { tmpdir } = await import('os')
    const { join: pathJoin } = await import('path')
    const dir = mkdtempSync(pathJoin(tmpdir(), 's8n-li-'))
    const prevJob = process.env.CLAUDE_JOB_DIR
    const prevKind = process.env.CLAUDE_CODE_SESSION_KIND
    process.env.CLAUDE_JOB_DIR = dir
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    writeFileSync(
      pathJoin(dir, 'state.json'),
      JSON.stringify({
        respawnFlags: ['--name', 'old', '--foo'],
        name: 'old',
        nameSource: 'user',
      }),
    )
    await patchBgJobDirRespawnFlags(
      '--name',
      ['-n'],
      'phone',
      { name: 'phone', nameSource: 'user' },
      undefined,
      ['old', 'phone'],
    )
    const next = JSON.parse(
      readFileSync(pathJoin(dir, 'state.json'), 'utf8'),
    ) as { respawnFlags: string[]; name?: string }
    expect(next.respawnFlags).toEqual(['--foo', '--name', 'phone'])
    expect(next.name).toBe('phone')
    if (prevJob === undefined) delete process.env.CLAUDE_JOB_DIR
    else process.env.CLAUDE_JOB_DIR = prevJob
    if (prevKind === undefined) delete process.env.CLAUDE_CODE_SESSION_KIND
    else process.env.CLAUDE_CODE_SESSION_KIND = prevKind
    rmSync(dir, { recursive: true, force: true })
  })

  test('Oi leftover: takeover jobDir after CLAUDE_JOB_DIR', async () => {
    const {
      resolveBgJobShortId,
      resetBgJobTakeoverForTests,
      setBgJobTakeover,
    } = await import('../sessionNameJobSidecar.js')
    resetBgJobTakeoverForTests()
    const prevJob = process.env.CLAUDE_JOB_DIR
    delete process.env.CLAUDE_JOB_DIR
    setBgJobTakeover({ jobDir: join('C:', 'jobs', 'deadbeef') })
    expect(resolveBgJobShortId()).toBe('deadbeef')
    resetBgJobTakeoverForTests()
    if (prevJob === undefined) delete process.env.CLAUDE_JOB_DIR
    else process.env.CLAUDE_JOB_DIR = prevJob
  })

  test('re leftover: T.job key only when jobDir is QF()/id', async () => {
    const {
      resolveJobDirStorageV5Key,
      isValidStoragePathSegment,
      createJobStorageV5Key,
    } = await import('../sessionNameJobSidecar.js')
    expect(isValidStoragePathSegment('abcd1234')).toBe(true)
    expect(isValidStoragePathSegment('')).toBe(false)
    expect(isValidStoragePathSegment('a/b')).toBe(false)
    expect(
      resolveJobDirStorageV5Key('/tmp/not-jobs/abcd1234', ['state.json']),
    ).toBeUndefined()
    expect(createJobStorageV5Key('abcd1234', ['state.json'])).toEqual({
      namespace: 'job',
      jobId: 'abcd1234',
      relPath: ['state.json'],
    })
  })

  test('fj leftover: At().remote default null; Kx sets kind=ccr', async () => {
    const {
      getSurfaceCapabilities,
      getSurfaceRemoteHandle,
      replaceSurfaceCapabilities,
      resetSurfaceCapabilitiesForTests,
    } = await import('../sessionNameUniqueness.js')
    resetSurfaceCapabilitiesForTests()
    expect(getSurfaceRemoteHandle()).toBeNull()
    replaceSurfaceCapabilities({
      ...getSurfaceCapabilities(),
      remote: {
        kind: 'ccr',
        isRemoteMode: true,
        sessionId: 'cse_1',
      },
    })
    expect(getSurfaceRemoteHandle()?.kind).toBe('ccr')
    expect(getSurfaceRemoteHandle()?.sessionId).toBe('cse_1')
    resetSurfaceCapabilitiesForTests()
    expect(getSurfaceRemoteHandle()).toBeNull()
  })

  test('S leftover: lQc strips session_ and cse_ only', async () => {
    const { stripBridgeSessionIdPrefix } = await import(
      '../sessionNameUniqueness.js'
    )
    expect(stripBridgeSessionIdPrefix('cse_abc')).toBe('abc')
    expect(stripBridgeSessionIdPrefix('session_abc')).toBe('abc')
    expect(stripBridgeSessionIdPrefix('abc')).toBe('abc')
    expect(stripBridgeSessionIdPrefix('cse_session_x')).toBe('session_x')
  })
})
