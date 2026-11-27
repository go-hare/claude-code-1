import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  declareSdkDialogKinds,
  deriveSingleShotPrintSession,
  getDesktopAppHostsTenant,
  getHostOtelState,
  getHostPolicyVerdict,
  getHostRendersChromeSetupOffer,
  getMcpClientsFromAccessorOrTenant,
  getSdkDialogCapabilitySource,
  getSdkPerTaskStopAffordance,
  getToolsConfirmedOnHost,
  getToolsMachine,
  getToolsMayBeOnHost,
  hasSdkHostLeftCallUnanswered,
  holdGatewayHostStrict,
  isCcsTenant,
  isDisklessLaunch,
  isDisklessProcess,
  isGatewayHostHeldStrict,
  isGatewayRequiredByHostPolicy,
  markSdkHostLeftCallUnanswered,
  releaseGatewayHost,
  setDesktopAppHostsTenant,
  setDisklessLaunch,
  setGatewayRequiredByHostPolicyReader,
  setHostOtelState,
  setHostPolicyVerdict,
  setHostRendersChromeSetupOffer,
  setParentManagedSettings,
  setSdkPerTaskStopAffordance,
  setTenantMcpClientsAccessor,
  setToolsConfirmedOnHost,
  setToolsMachine,
  setToolsMayBeOnHost,
} from '../../bootstrap/state.js'
import { getSkillDirCommands } from '../../skills/loadSkillsDir.js'
import type { ToolUseContext } from '../../Tool.js'
import { resumeAgentBackground } from '../../../packages/builtin-tools/src/tools/AgentTool/resumeAgent.js'
import { spawnTeammate } from '../../../packages/builtin-tools/src/tools/shared/spawnMultiAgent.js'
import {
  cleanupOldMessageFilesInBackground,
  getRetentionCleanupSkipReason,
} from '../cleanup.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import {
  assertProgramStartAllowedInDiskless,
  assertTempDirAllowedInDiskless,
  DISK_PROGRAMS_UNAVAILABLE_MESSAGE,
  DisklessRefusalError,
  DROPPED_ON_A_DISKLESS_HOST,
  dropForADisklessHost,
  filterOutForDisklessHost,
  isDisklessActive,
  isDisklessProcessActive,
  isNoConfigHomeError,
  logDisklessWriteSkipped,
  subscribeDisklessWriteSkipped,
} from '../disklessGuards.js'
import { getClaudeTempDir } from '../permissions/filesystem.js'
import {
  createSessionHost,
  getBootstrapSession,
  getBootstrapSessionHost,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import { createRootSession } from '../sessionRoot.js'
import {
  createMemoryStorageV5Backend,
  getPinnedStorageV5,
  pinInjectedStorageV5,
  recordHoverRestDecision,
  registerExternalStorageV5Factory,
  resetHoverRestPinForTests,
  resetPinnedStorageV5ForTests,
  tryCreateV5Backend,
} from '../storageV5/index.js'
import { getTaskOutputPath } from '../task/diskOutput.js'
import { ensureClaudeTempDir } from '../tempDir.js'
import {
  ensureToolResultsDir,
  persistToolResult,
} from '../toolResultStorage.js'

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const tempDirs: string[] = []

afterEach(() => {
  resetHoverRestPinForTests()
  resetPinnedStorageV5ForTests()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('2.1.331 CCS / Multi-Tenant Host Hooks (15 official hooks)', () => {
  test('isolates all 15 CCS/multi-tenant hooks across two concurrent SessionHosts via runWithSession', async () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const sessionA = createRootSession({
      host: hostA,
      id: 'tenant-a-session',
      project: {
        originalCwd: '/tenant-a',
        projectRoot: '/tenant-a',
        cwd: '/tenant-a',
      },
    })
    const sessionB = createRootSession({
      host: hostB,
      id: 'tenant-b-session',
      project: {
        originalCwd: '/tenant-b',
        projectRoot: '/tenant-b',
        cwd: '/tenant-b',
      },
    })

    // Default process host stays non-diskless throughout
    expect(isDisklessProcess()).toBe(false)
    expect(isDisklessProcessActive()).toBe(false)

    const [resA, resB] = await Promise.all([
      runWithSession(sessionA, async () => {
        // 1 & 2: isCcsTenant / isDisklessLaunch vs isDisklessProcess
        setDisklessLaunch(true)
        // 3: desktopAppHostsTenant
        setDesktopAppHostsTenant(true)
        // 4: toolsMayBeOnHost / toolsConfirmedOnHost / toolsMachine
        setToolsMayBeOnHost(true)
        setToolsConfirmedOnHost(true)
        setToolsMachine({ directory: { path: '/host-a/work' }, os: 'linux' })
        // 5: tenant MCP clients accessor
        setTenantMcpClientsAccessor(() => [{ name: 'tenant-a-mcp' }])
        // 6: hostPolicyVerdict (both setter and replaceParentManagedSettings)
        setParentManagedSettings({ allowManagedHooksOnly: true }, 'cloud', true)
        // 7: hostOtelState
        setHostOtelState({ tenant: 'A', endpoint: 'https://otel-a.example' })
        // 8: sdkDialogCapabilitySource
        declareSdkDialogKinds(['confirm', 'select'], 'initialize')
        // 9: sdkPerTaskStopAffordance
        setSdkPerTaskStopAffordance(true)
        // 10: hostRendersChromeSetupOffer
        setHostRendersChromeSetupOffer(true)
        // 11: sdkHostLeftCallUnanswered
        markSdkHostLeftCallUnanswered(true)
        // 12: gatewayHostHeldStrict (trailing dot stripped)
        holdGatewayHostStrict('gw-a.internal.')
        // 13: gatewayRequiredByHostPolicy
        setGatewayRequiredByHostPolicyReader(host => host.endsWith('.corp-a'))

        await tick(10)

        return {
          host: getBootstrapSessionHost(),
          isCcs: isCcsTenant(),
          isDiskless: isDisklessLaunch(),
          isDisklessActive: isDisklessActive(),
          isDisklessProc: isDisklessProcess(),
          isDisklessProcActive: isDisklessProcessActive(),
          desktopApp: getDesktopAppHostsTenant(),
          toolsMayBe: getToolsMayBeOnHost(),
          toolsConfirmed: getToolsConfirmedOnHost(),
          toolsMachine: getToolsMachine(),
          mcpClients: getMcpClientsFromAccessorOrTenant(),
          policyVerdict: getHostPolicyVerdict(),
          otel: getHostOtelState(),
          dialogSource: getSdkDialogCapabilitySource(),
          perTaskStop: getSdkPerTaskStopAffordance(),
          chromeSetupOffer: getHostRendersChromeSetupOffer(),
          leftUnanswered: hasSdkHostLeftCallUnanswered(),
          heldA: isGatewayHostHeldStrict('gw-a.internal'),
          heldADot: isGatewayHostHeldStrict('GW-A.INTERNAL.'),
          heldB: isGatewayHostHeldStrict('gw-b.internal'),
          gwReqA: isGatewayRequiredByHostPolicy('api.corp-a'),
          gwReqB: isGatewayRequiredByHostPolicy('api.corp-b'),
        }
      }),
      runWithSession(sessionB, async () => {
        setDisklessLaunch(false)
        setDesktopAppHostsTenant(false)
        setToolsMayBeOnHost(false)
        setToolsConfirmedOnHost(false)
        setToolsMachine({ directory: { path: '/host-b/work' }, os: 'darwin' })
        setTenantMcpClientsAccessor(() => [{ name: 'tenant-b-mcp' }])
        setHostPolicyVerdict(false)
        setHostOtelState({ tenant: 'B' })
        declareSdkDialogKinds(['confirm'], undefined)
        setSdkPerTaskStopAffordance(false)
        setHostRendersChromeSetupOffer(false)
        holdGatewayHostStrict('gw-b.internal.')
        setGatewayRequiredByHostPolicyReader(host => host.endsWith('.corp-b'))

        await tick(5)

        return {
          host: getBootstrapSessionHost(),
          isCcs: isCcsTenant(),
          isDiskless: isDisklessLaunch(),
          isDisklessActive: isDisklessActive(),
          isDisklessProc: isDisklessProcess(),
          isDisklessProcActive: isDisklessProcessActive(),
          desktopApp: getDesktopAppHostsTenant(),
          toolsMayBe: getToolsMayBeOnHost(),
          toolsConfirmed: getToolsConfirmedOnHost(),
          toolsMachine: getToolsMachine(),
          mcpClients: getMcpClientsFromAccessorOrTenant(),
          policyVerdict: getHostPolicyVerdict(),
          otel: getHostOtelState(),
          dialogSource: getSdkDialogCapabilitySource(),
          perTaskStop: getSdkPerTaskStopAffordance(),
          chromeSetupOffer: getHostRendersChromeSetupOffer(),
          leftUnanswered: hasSdkHostLeftCallUnanswered(),
          heldA: isGatewayHostHeldStrict('gw-a.internal'),
          heldB: isGatewayHostHeldStrict('gw-b.internal'),
          gwReqA: isGatewayRequiredByHostPolicy('api.corp-a'),
          gwReqB: isGatewayRequiredByHostPolicy('api.corp-b'),
        }
      }),
    ])

    // Tenant A assertions
    expect(resA.host).toBe(hostA)
    expect(resA.isCcs).toBe(true)
    expect(resA.isDiskless).toBe(true)
    expect(resA.isDisklessActive).toBe(true)
    expect(resA.isDisklessProc).toBe(false)
    expect(resA.isDisklessProcActive).toBe(false)
    expect(resA.desktopApp).toBe(true)
    expect(resA.toolsMayBe).toBe(true)
    expect(resA.toolsConfirmed).toBe(true)
    expect(resA.toolsMachine).toEqual({
      directory: { path: '/host-a/work' },
      os: 'linux',
    })
    expect(resA.mcpClients).toEqual([{ name: 'tenant-a-mcp' }])
    expect(resA.policyVerdict).toBe(true)
    expect(resA.otel).toEqual({
      tenant: 'A',
      endpoint: 'https://otel-a.example',
    })
    expect(resA.dialogSource).toBe('initialize')
    expect(resA.perTaskStop).toBe(true)
    expect(resA.chromeSetupOffer).toBe(true)
    expect(resA.leftUnanswered).toBe(true)
    expect(resA.heldA).toBe(true)
    expect(resA.heldADot).toBe(true)
    expect(resA.heldB).toBe(false)
    expect(resA.gwReqA).toBe(true)
    expect(resA.gwReqB).toBe(false)

    // Tenant B assertions (zero cross-tenant bleed)
    expect(resB.host).toBe(hostB)
    expect(resB.isCcs).toBe(false)
    expect(resB.isDiskless).toBe(false)
    expect(resB.isDisklessActive).toBe(false)
    expect(resB.isDisklessProc).toBe(false)
    expect(resB.isDisklessProcActive).toBe(false)
    expect(resB.desktopApp).toBe(false)
    expect(resB.toolsMayBe).toBe(false)
    expect(resB.toolsConfirmed).toBe(false)
    expect(resB.toolsMachine).toEqual({
      directory: { path: '/host-b/work' },
      os: 'darwin',
    })
    expect(resB.mcpClients).toEqual([{ name: 'tenant-b-mcp' }])
    expect(resB.policyVerdict).toBe(false)
    expect(resB.otel).toEqual({ tenant: 'B' })
    expect(resB.dialogSource).toBe('none')
    expect(resB.perTaskStop).toBe(false)
    expect(resB.chromeSetupOffer).toBe(false)
    expect(resB.leftUnanswered).toBe(false)
    expect(resB.heldA).toBe(false)
    expect(resB.heldB).toBe(true)
    expect(resB.gwReqA).toBe(false)
    expect(resB.gwReqB).toBe(true)

    // Release gateway host with trailing dot & verify session MCP accessor precedence
    runWithSession(sessionA, () => {
      releaseGatewayHost('gw-a.internal.')
      expect(isGatewayHostHeldStrict('gw-a.internal')).toBe(false)

      getBootstrapSession().mcpSessionWiring.registerClientsAccessor(() => [
        { name: 'session-direct-mcp' },
      ])
      expect(getMcpClientsFromAccessorOrTenant()).toEqual([
        { name: 'session-direct-mcp' },
      ])

      declareSdkDialogKinds(undefined, 'initialize')
      expect(getSdkDialogCapabilitySource()).toBe('none')
    })
  })

  test('deriveSingleShotPrintSession computes !hasStreamingInput && !sdkUrl', () => {
    expect(deriveSingleShotPrintSession({})).toBe(true)
    expect(
      deriveSingleShotPrintSession({ hasStreamingInput: false, sdkUrl: null }),
    ).toBe(true)
    expect(
      deriveSingleShotPrintSession({ hasStreamingInput: true, sdkUrl: null }),
    ).toBe(false)
    expect(
      deriveSingleShotPrintSession({
        hasStreamingInput: false,
        sdkUrl: 'wss://sdk.example',
      }),
    ).toBe(false)
    expect(
      deriveSingleShotPrintSession({
        hasStreamingInput: true,
        sdkUrl: 'wss://sdk.example',
      }),
    ).toBe(false)
  })
})

describe('2.1.331 Diskless Guard Infrastructure & Integration Sites', () => {
  test('guards program start, temp dir, task output, tool results, drop helpers, and NoConfigHomeError', async () => {
    // Non-diskless default allows everything
    expect(() => assertProgramStartAllowedInDiskless('bash')).not.toThrow()
    expect(() => assertTempDirAllowedInDiskless()).not.toThrow()
    expect(dropForADisklessHost('keep-me')).toBe('keep-me')
    expect(filterOutForDisklessHost(['a', 'b'])).toEqual(['a', 'b'])
    expect(DROPPED_ON_A_DISKLESS_HOST).toBe('dropped_on_a_diskless_host')

    const noCfgErr = Object.assign(new Error('missing home'), {
      name: 'NoConfigHomeError',
    })
    expect(isNoConfigHomeError(noCfgErr)).toBe(true)
    expect(isNoConfigHomeError(new Error('other'))).toBe(false)

    await runWithNewHostSession({ id: 'diskless-guards-test' }, async () => {
      setDisklessLaunch(true)

      // Program start refusal
      let caughtProgram: unknown
      try {
        assertProgramStartAllowedInDiskless('BashTool')
      } catch (err) {
        caughtProgram = err
      }
      expect(caughtProgram).toBeInstanceOf(DisklessRefusalError)
      expect((caughtProgram as DisklessRefusalError).code).toBe(
        'DISKLESS_REFUSED',
      )
      expect((caughtProgram as DisklessRefusalError).message).toBe(
        DISK_PROGRAMS_UNAVAILABLE_MESSAGE,
      )

      // Temp dir refusals (direct guard, ensureClaudeTempDir, getClaudeTempDir)
      const expectedTempMsg =
        'The temp directory is unavailable in a diskless session: nothing is created, verified or written under the shared per-uid temp root'
      expect(() => assertTempDirAllowedInDiskless()).toThrow(expectedTempMsg)
      expect(() => ensureClaudeTempDir()).toThrow(expectedTempMsg)
      expect(() => getClaudeTempDir()).toThrow(expectedTempMsg)

      // Task output path refusal
      expect(() => getTaskOutputPath('task-123')).toThrow(
        'Task output is not written to disk in a diskless session',
      )

      // Tool result storage skips mkdir & disk write
      await expect(ensureToolResultsDir()).resolves.toBeUndefined()
      const persistRes = await persistToolResult('large output', 'tool-use-1')
      expect('error' in persistRes).toBe(true)

      // dropForADisklessHost & filterOutForDisklessHost
      expect(dropForADisklessHost({ hook: 'local' })).toBeUndefined()
      expect(filterOutForDisklessHost(['disk-a', 'disk-b'])).toEqual([])
      expect(
        filterOutForDisklessHost(
          [
            { name: 'disk', needsDisk: true },
            { name: 'mem', needsDisk: false },
          ],
          item => item.needsDisk,
        ),
      ).toEqual([{ name: 'mem', needsDisk: false }])

      // logDisklessWriteSkipped emits to observers safely without throwing
      const skipped: Array<{ writer: string; targetPath: string }> = []
      const unsub = subscribeDisklessWriteSkipped(ev => skipped.push(ev))
      try {
        expect(() =>
          logDisklessWriteSkipped('testWriter', '/virtual/path'),
        ).not.toThrow()
        expect(skipped).toEqual([
          { writer: 'testWriter', targetPath: '/virtual/path' },
        ])
      } finally {
        unsub()
      }
    })
  })

  test('config.ts keeps mutations in memory without disk writes when diskless without storage backend', () => {
    const skipped: Array<{ writer: string; targetPath: string }> = []
    const unsub = subscribeDisklessWriteSkipped(ev => skipped.push(ev))
    try {
      runWithNewHostSession({ id: 'diskless-config-test' }, () => {
        setDisklessLaunch(true)
        const didPersist = saveGlobalConfig(cur => ({
          ...cur,
          numStartups: 42,
        }))
        expect(didPersist).toBe(false)
        expect(getGlobalConfig().numStartups).toBe(42)
        expect(skipped.some(e => e.writer === 'saveGlobalConfig')).toBe(true)
      })
    } finally {
      unsub()
    }
  })

  test('loadSkillsDir skips filesystem scan and returns [] when diskless without or with pinned StorageV5 (P0-3)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'diskless-skills-'))
    tempDirs.push(root)
    const skillDir = join(root, '.claude', 'skills', 'demo-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: Demo\n---\nHello skill\n',
      'utf8',
    )
    const commandsDir = join(root, '.claude', 'commands')
    mkdirSync(commandsDir, { recursive: true })
    writeFileSync(
      join(commandsDir, 'demo-cmd.md'),
      '---\ndescription: Demo command\n---\nRun demo\n',
      'utf8',
    )

    const loadedWithoutStorage = await runWithNewHostSession(
      {
        id: 'diskless-skills-session-no-v5',
        originalCwd: root,
        projectRoot: root,
        cwd: root,
      },
      async () => {
        setDisklessLaunch(true)
        return getSkillDirCommands(root)
      },
    )
    expect(loadedWithoutStorage).toEqual([])

    // Even when a memory StorageV5 backend is pinned, diskless MUST NOT fall
    // through to OS disk scanning.
    const mem = createMemoryStorageV5Backend({ configHome: '/mem-skills-p03' })
    const loadedWithStorage = await runWithNewHostSession(
      {
        id: 'diskless-skills-session-with-v5',
        originalCwd: root,
        projectRoot: root,
        cwd: root,
      },
      async () => {
        setDisklessLaunch(true)
        pinInjectedStorageV5(mem)
        return getSkillDirCommands(root)
      },
    )
    expect(loadedWithStorage).toEqual([])
  })

  test('saveGlobalConfig persists via registered pinned StorageV5 with { precondition: { type: "none" } } (P1-8)', async () => {
    const writeCalls: Array<{ key: unknown; opts: unknown }> = []
    const mem = createMemoryStorageV5Backend({ configHome: '/mem-cfg-p18' })
    const origWrite = mem.write.bind(mem)
    mem.write = async (key, value, opts) => {
      writeCalls.push({ key, opts })
      return origWrite(key, value, opts)
    }

    await runWithNewHostSession({ id: 'diskless-config-p18' }, async () => {
      setDisklessLaunch(true)
      pinInjectedStorageV5(mem)
      const didPersist = saveGlobalConfig(cur => ({
        ...cur,
        numStartups: 77,
      }))
      expect(didPersist).toBe(true)
      expect(getGlobalConfig().numStartups).toBe(77)
      await tick(10)
    })

    expect(writeCalls.length).toBe(1)
    expect(writeCalls[0]?.key).toEqual({ namespace: 'globalConfig' })
    expect(writeCalls[0]?.opts).toEqual({ precondition: { type: 'none' } })
    const snap = mem.snapshot()
    expect(snap['/mem-cfg-p18/.claude.json']).toContain('"numStartups": 77')
  })

  test('retention cleanup skips immediately with reason "diskless"', async () => {
    await runWithNewHostSession(
      { id: 'diskless-cleanup-session' },
      async () => {
        setDisklessLaunch(true)
        expect(getRetentionCleanupSkipReason()).toBe('diskless')
        await expect(
          cleanupOldMessageFilesInBackground(),
        ).resolves.toBeUndefined()
      },
    )
  })

  test('teammate spawn and agent resume refuse with DisklessRefusalError in diskless session', async () => {
    await runWithNewHostSession(
      { id: 'diskless-teammate-session' },
      async () => {
        setDisklessLaunch(true)

        const dummyContext = {
          getAppState: () => ({}),
          setAppState: () => {},
        } as unknown as ToolUseContext

        await expect(
          spawnTeammate({ name: 'worker-1', prompt: 'hello' }, dummyContext),
        ).rejects.toThrow('teammate spawn refused in a session with no disk')

        await expect(
          resumeAgentBackground({
            agentId: 'agent-1',
            prompt: 'continue',
            toolUseContext: dummyContext,
            canUseTool: async () => ({
              behavior: 'deny',
              message: 'denied',
              decisionReason: { type: 'other', reason: 'test' },
            }),
          }),
        ).rejects.toThrow('teammate resume refused in a session with no disk')
      },
    )
  })
})

describe('2.1.331 Pluggable In-Memory StorageV5 Backend & Multi-Tenant Isolation', () => {
  test('createMemoryStorageV5Backend supports full CRUD, preconditions, scopes, streams, leases, subscriptions & snapshot', async () => {
    let now = 1_700_000_000_000
    const mem = createMemoryStorageV5Backend({
      configHome: '/mem-home',
      globalConfigFile: '/mem-home/.claude.json',
      clock: () => now,
      initialFiles: {
        'plans/seed.md': 'seeded plan',
      },
    })

    // Initial file readable + zero disk creation
    expect(existsSync('/mem-home')).toBe(false)
    const seedRead = await mem.readText([{ namespace: 'plan', name: 'seed' }])
    expect(seedRead.ok).toBe(true)
    if (seedRead.ok) {
      expect(seedRead.value.items[0]?.found).toBe(true)
      expect(seedRead.value.items[0]?.value).toBe('seeded plan')
    }

    // Subscribe to key and scope
    const keyEvents: unknown[] = []
    const scopeEvents: unknown[] = []
    const planKey = { namespace: 'plan', name: 'alpha' }
    const planScope = { namespace: 'plan' }
    const keySub = await mem.subscribe({ target: 'key', key: planKey }, ev =>
      keyEvents.push(ev),
    )
    const scopeSub = await mem.subscribe(
      { target: 'scope', scope: planScope },
      ev => scopeEvents.push(ev),
    )
    expect(keySub.ok).toBe(true)
    expect(scopeSub.ok).toBe(true)

    // Write + precondition checks
    const w1 = await mem.write(planKey, 'hello v1', {
      precondition: { type: 'ifNotExists' },
    })
    expect(w1.ok).toBe(true)
    if (!w1.ok) throw new Error('expected write ok')

    const wDup = await mem.write(planKey, 'conflict', {
      precondition: { type: 'ifNotExists' },
    })
    expect(wDup.ok).toBe(false)
    if (!wDup.ok) expect(wDup.error.code).toBe('PreconditionFailed')

    const wBadVer = await mem.write(planKey, 'bad-ver', {
      precondition: { type: 'ifMatch', version: 'wrong' },
    })
    expect(wBadVer.ok).toBe(false)

    const w2 = await mem.write(planKey, 'hello v2', {
      precondition: { type: 'ifMatch', version: w1.value.version },
    })
    expect(w2.ok).toBe(true)
    expect(keyEvents.length).toBe(2)
    expect(scopeEvents.length).toBe(2)

    // stat, statMeta, digest, updateText, copy, move, delete
    const st = await mem.stat(planKey)
    expect(st.ok).toBe(true)
    if (st.ok) expect(st.value.size).toBe(8)

    const dig = await mem.digest(planKey)
    expect(dig.ok).toBe(true)
    if (dig.ok) expect(dig.value.digest).toHaveLength(64)

    const upd = await mem.updateText(planKey, cur => ({
      write: `${cur?.value ?? ''}!`,
    }))
    expect(upd.ok).toBe(true)
    if (upd.ok) {
      expect(upd.value.written).toBe(true)
      expect(upd.value.found).toBe(true)
    }

    const betaKey = { namespace: 'plan', name: 'beta' }
    const cp = await mem.copy(planKey, betaKey)
    expect(cp.ok).toBe(true)
    const mvTarget = { namespace: 'plan', name: 'gamma' }
    const mv = await mem.move(betaKey, mvTarget)
    expect(mv.ok).toBe(true)
    const delRes = await mem.delete(mvTarget)
    expect(delRes.ok).toBe(true)
    if (delRes.ok) expect(delRes.value.existed).toBe(true)

    // Scopes: ensureScope, scopeKind, listEntries, listRecursive, scopeKeys, deleteScope
    const memScope = { namespace: 'memory', projectKey: 'proj-1' }
    const ens = await mem.ensureScope(memScope)
    expect(ens.ok).toBe(true)
    if (ens.ok) expect(ens.value.created).toBe(true)

    const sk = await mem.scopeKind(memScope)
    expect(sk.ok).toBe(true)
    if (sk.ok) expect(sk.value.kind).toBe('directory')

    await mem.write(
      { namespace: 'memory', projectKey: 'proj-1', relPath: ['notes.md'] },
      'note body',
    )
    const list = await mem.listEntries(memScope)
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.value.items.length).toBe(1)

    const recList = await mem.listRecursive(memScope)
    expect(recList.ok).toBe(true)
    if (recList.ok) expect(recList.value.items.length).toBe(1)

    const delScope = await mem.deleteScope(memScope)
    expect(delScope.ok).toBe(true)
    if (delScope.ok) expect(delScope.value.deleted).toBe(1)

    // Record stream: append, readRecords, statStream, tombstone, applyTombstones
    const transcriptKey = {
      namespace: 'transcript',
      projectKey: 'proj-1',
      sessionId: 'sess-1',
    }
    const app = await mem.append(transcriptKey, [
      { data: '{"n":1}', recordId: 'r1' },
      { data: '{"n":2}', recordId: 'r2' },
    ])
    expect(app.ok).toBe(true)
    if (app.ok) expect(app.value.acks.map(a => a.seq)).toEqual([1, 2])

    const fwd = await mem.readRecords(transcriptKey, { order: 'forward' })
    expect(fwd.ok).toBe(true)
    if (fwd.ok) expect(fwd.value.items.length).toBe(2)

    const bwd = await mem.readRecords(transcriptKey, {
      order: 'backward',
      limit: 1,
    })
    expect(bwd.ok).toBe(true)
    if (bwd.ok) expect(bwd.value.items[0]?.recordId).toBe('r2')

    const tomb = await mem.tombstone(transcriptKey, ['r1', 'missing'])
    expect(tomb.ok).toBe(true)
    if (tomb.ok) {
      expect(tomb.value.matched).toEqual([true, false])
      expect(tomb.value.newly).toEqual(['r1'])
    }
    const purged = await mem.applyTombstones(transcriptKey)
    expect(purged.ok).toBe(true)
    if (purged.ok) expect(purged.value.purged).toBe(1)

    const stStream = await mem.statStream(transcriptKey)
    expect(stStream.ok).toBe(true)
    if (stStream.ok) expect(stStream.value.recordCount).toBe(1)

    // Leases
    const lease1 = await mem.acquireLease({ lock: 'cfg' }, 5_000, {
      holder: 'holder-a',
    })
    expect(lease1.ok).toBe(true)
    const leaseConflict = await mem.acquireLease({ lock: 'cfg' }, 5_000, {
      holder: 'holder-b',
    })
    expect(leaseConflict.ok).toBe(false)
    now += 6_000
    const leaseAfterExpiry = await mem.acquireLease({ lock: 'cfg' }, 5_000, {
      holder: 'holder-b',
    })
    expect(leaseAfterExpiry.ok).toBe(true)
    if (leaseAfterExpiry.ok) {
      await leaseAfterExpiry.value.release()
    }

    // writeFromStream
    async function* chunks() {
      yield 'chunk-1-'
      yield 'chunk-2'
    }
    const streamRes = await mem.writeFromStream(
      { namespace: 'paste', id: 'p1' },
      chunks(),
      { maxBytes: 1024 },
    )
    expect(streamRes.ok).toBe(true)

    // Unsubscribe & snapshot & clear
    if (keySub.ok) keySub.value.unsubscribe()
    if (scopeSub.ok) scopeSub.value.unsubscribe()
    const snap = mem.snapshot()
    expect(snap['/mem-home/plans/alpha.md']).toBe('hello v2!')
    expect(snap['/mem-home/paste-cache/p1.txt']).toBe('chunk-1-chunk-2')

    mem.clear()
    expect(Object.keys(mem.snapshot())).toEqual([])

    const closeRes = await mem.close()
    expect(closeRes.ok).toBe(true)
    const afterClose = await mem.write(planKey, 'nope')
    expect(afterClose.ok).toBe(false)
  })

  test('isolates concurrent multi-tenant StorageV5 via pinInjectedStorageV5 with zero disk writes', async () => {
    const memA = createMemoryStorageV5Backend({ configHome: '/virtual-a' })
    const memB = createMemoryStorageV5Backend({ configHome: '/virtual-b' })

    await Promise.all([
      runWithNewHostSession({ id: 'storage-tenant-a' }, async () => {
        setDisklessLaunch(true)
        pinInjectedStorageV5(memA)
        expect(getPinnedStorageV5()).toBe(memA)

        const backend = getPinnedStorageV5()!
        await backend.write({ namespace: 'state', id: 'tenant' }, 'VALUE_A')
        await tick(10)

        const read = await getPinnedStorageV5()!.readText([
          { namespace: 'state', id: 'tenant' },
        ])
        expect(read.ok).toBe(true)
        if (read.ok) expect(read.value.items[0]?.value).toBe('VALUE_A')
      }),
      runWithNewHostSession({ id: 'storage-tenant-b' }, async () => {
        setDisklessLaunch(true)
        pinInjectedStorageV5(memB)
        expect(getPinnedStorageV5()).toBe(memB)

        const backend = getPinnedStorageV5()!
        await backend.write({ namespace: 'state', id: 'tenant' }, 'VALUE_B')
        await tick(5)

        const read = await getPinnedStorageV5()!.readText([
          { namespace: 'state', id: 'tenant' },
        ])
        expect(read.ok).toBe(true)
        if (read.ok) expect(read.value.items[0]?.value).toBe('VALUE_B')
      }),
    ])

    expect(memA.snapshot()['/virtual-a/state/tenant.json']).toBe('VALUE_A')
    expect(memB.snapshot()['/virtual-b/state/tenant.json']).toBe('VALUE_B')
    expect(existsSync('/virtual-a')).toBe(false)
    expect(existsSync('/virtual-b')).toBe(false)
    // Default host remains unpinned
    expect(getPinnedStorageV5()).toBeUndefined()
  })

  test('registerExternalStorageV5Factory plugs into tryCreateV5Backend per SessionHost', () => {
    recordHoverRestDecision(true)
    // Without a registered factory, tryCreateV5Backend stays undefined
    expect(tryCreateV5Backend()).toBeUndefined()

    const custom = createMemoryStorageV5Backend({ configHome: '/ext-mem' })
    runWithNewHostSession({ id: 'ext-factory-host' }, () => {
      registerExternalStorageV5Factory(() => custom)
      expect(tryCreateV5Backend()).toBe(custom)
    })

    // Default host did not inherit tenant host's factory override
    expect(tryCreateV5Backend()).toBeUndefined()
  })

  test('createMemoryStorageV5Backend enforces P0-5 preconditions and P1-11 move/clone/lease hardening', async () => {
    let now = 1_700_000_000_000
    const mem = createMemoryStorageV5Backend({
      configHome: '/mem-harden',
      clock: () => now,
    })

    // P0-5: ifAbsent, none, and unknown precondition validation
    const planKey = { namespace: 'plan', name: 'precond' }
    const created = await mem.write(planKey, 'v1', {
      precondition: { type: 'ifAbsent' },
    })
    expect(created.ok).toBe(true)

    const dupIfAbsent = await mem.write(planKey, 'v2', {
      precondition: { type: 'ifAbsent' },
    })
    expect(dupIfAbsent.ok).toBe(false)
    if (!dupIfAbsent.ok) {
      expect(dupIfAbsent.error.code).toBe('PreconditionFailed')
    }

    const blindWrite = await mem.write(planKey, 'v2', {
      precondition: { type: 'none' },
    })
    expect(blindWrite.ok).toBe(true)

    const unknownPrecond = await mem.write(planKey, 'v3', {
      precondition: { type: 'madeUpCondition' },
    })
    expect(unknownPrecond.ok).toBe(false)
    if (!unknownPrecond.ok) {
      expect(unknownPrecond.error.code).toBe('InvalidArgument')
      expect(unknownPrecond.error.argument).toBe('opts.precondition')
    }

    // P0-5: append preconditions (ifExists, ifAbsent, unknown)
    const streamKey = {
      namespace: 'transcript',
      projectKey: 'proj-p05',
      sessionId: 'sess-p05',
    }
    const appendMissing = await mem.append(
      streamKey,
      [{ data: '{"a":1}', recordId: 'r1' }],
      { precondition: { type: 'ifExists' } },
    )
    expect(appendMissing.ok).toBe(false)
    if (!appendMissing.ok) {
      expect(appendMissing.error.code).toBe('PreconditionFailed')
    }

    const appendUnknown = await mem.append(
      streamKey,
      [{ data: '{"a":1}', recordId: 'r1' }],
      { precondition: { type: 'bogus' } },
    )
    expect(appendUnknown.ok).toBe(false)
    if (!appendUnknown.ok) {
      expect(appendUnknown.error.code).toBe('InvalidArgument')
    }

    const appendCreate = await mem.append(
      streamKey,
      [{ data: '{"a":1}', recordId: 'r1' }],
      { precondition: { type: 'ifAbsent' } },
    )
    expect(appendCreate.ok).toBe(true)

    const appendDupAbsent = await mem.append(
      streamKey,
      [{ data: '{"a":2}', recordId: 'r2' }],
      { precondition: { type: 'ifAbsent' } },
    )
    expect(appendDupAbsent.ok).toBe(false)
    if (!appendDupAbsent.ok) {
      expect(appendDupAbsent.error.code).toBe('PreconditionFailed')
    }

    const appendExists = await mem.append(
      streamKey,
      [{ data: '{"a":2}', recordId: 'r2' }],
      { precondition: { type: 'ifExists' } },
    )
    expect(appendExists.ok).toBe(true)

    // P1-11: self-move preserves data & stream state without deleting
    const selfMove = await mem.move(streamKey, streamKey)
    expect(selfMove.ok).toBe(true)
    const afterSelfMove = await mem.readRecords(streamKey)
    expect(afterSelfMove.ok).toBe(true)
    if (afterSelfMove.ok) {
      expect(afterSelfMove.value.items.map(i => i.recordId)).toEqual([
        'r1',
        'r2',
      ])
    }

    // P1-11: move migrates stream records to destination key
    const movedStreamKey = {
      namespace: 'transcript',
      projectKey: 'proj-p05',
      sessionId: 'sess-p05-moved',
    }
    const moveRes = await mem.move(streamKey, movedStreamKey)
    expect(moveRes.ok).toBe(true)
    const destRecords = await mem.readRecords(movedStreamKey)
    expect(destRecords.ok).toBe(true)
    if (destRecords.ok) {
      expect(destRecords.value.items.map(i => i.recordId)).toEqual(['r1', 'r2'])
    }
    const srcRecords = await mem.readRecords(streamKey)
    expect(srcRecords.ok).toBe(true)
    if (srcRecords.ok) {
      expect(srcRecords.value.items).toEqual([])
    }

    // P1-11: moveScope self-move preserves data & cross-scope move rewrites entry.key + streams
    const scopeFrom = { namespace: 'memory', projectKey: 'proj-src' }
    const scopeTo = { namespace: 'memory', projectKey: 'proj-dst' }
    const mutableKey = {
      namespace: 'memory',
      projectKey: 'proj-src',
      relPath: ['nested', 'note.md'],
    }
    await mem.append(mutableKey, [{ data: 'line-1', recordId: 'm1' }])
    // Mutating caller key must not corrupt stored entry.key
    mutableKey.projectKey = 'mutated-by-caller'
    mutableKey.relPath.push('corrupted')

    const selfScopeMove = await mem.moveScope(scopeFrom, scopeFrom, {
      replace: true,
    })
    expect(selfScopeMove.ok).toBe(true)
    const beforeMoveKeys = await mem.scopeKeys(scopeFrom)
    expect(beforeMoveKeys.ok).toBe(true)
    if (beforeMoveKeys.ok) {
      expect(beforeMoveKeys.value).toEqual([
        {
          namespace: 'memory',
          projectKey: 'proj-src',
          relPath: ['nested', 'note.md'],
        },
      ])
      // Mutating returned key must not corrupt internal store
      ;(beforeMoveKeys.value[0] as { projectKey: string }).projectKey = 'tamper'
    }

    const scopeMoved = await mem.moveScope(scopeFrom, scopeTo, {
      replace: true,
    })
    expect(scopeMoved.ok).toBe(true)
    if (scopeMoved.ok) expect(scopeMoved.value.moved).toBe(true)

    const dstKeys = await mem.scopeKeys(scopeTo)
    expect(dstKeys.ok).toBe(true)
    if (dstKeys.ok) {
      expect(dstKeys.value).toEqual([
        {
          namespace: 'memory',
          projectKey: 'proj-dst',
          relPath: ['nested', 'note.md'],
        },
      ])
    }
    const migratedStream = await mem.readRecords({
      namespace: 'memory',
      projectKey: 'proj-dst',
      relPath: ['nested', 'note.md'],
    })
    expect(migratedStream.ok).toBe(true)
    if (migratedStream.ok) {
      expect(migratedStream.value.items.map(i => i.recordId)).toEqual(['m1'])
    }

    // P1-11: lease target canonicalization, circular rejection, deep-clone, & expired renew rejection
    const leaseTargetA = { b: 2, a: { y: 1, x: 0 } }
    const leaseA = await mem.acquireLease(leaseTargetA, 1_000, {
      holder: 'holder-1',
    })
    expect(leaseA.ok).toBe(true)
    // Mutating caller target must not mutate stored lease
    leaseTargetA.b = 999
    leaseTargetA.a.x = 999

    // Semantically identical target with different key ordering conflicts
    const leaseB = await mem.acquireLease({ a: { x: 0, y: 1 }, b: 2 }, 1_000, {
      holder: 'holder-2',
    })
    expect(leaseB.ok).toBe(false)
    if (!leaseB.ok) expect(leaseB.error.code).toBe('AlreadyHeld')

    // listLeases returns deep clone unaffected by caller mutations
    const listed1 = await mem.listLeases({})
    expect(listed1.ok).toBe(true)
    if (listed1.ok) {
      expect(listed1.value.items[0]?.target).toEqual({
        b: 2,
        a: { y: 1, x: 0 },
      })
      ;(listed1.value.items[0]?.target as { b: number }).b = -1
    }
    const listed2 = await mem.listLeases({})
    expect(listed2.ok).toBe(true)
    if (listed2.ok) {
      expect(listed2.value.items[0]?.target).toEqual({
        b: 2,
        a: { y: 1, x: 0 },
      })
    }

    // Circular target returns InvalidArgument instead of throwing TypeError
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const circRes = await mem.acquireLease(circular, 1_000, {
      holder: 'holder-c',
    })
    expect(circRes.ok).toBe(false)
    if (!circRes.ok) {
      expect(circRes.error.code).toBe('InvalidArgument')
      expect(circRes.error.argument).toBe('target')
    }

    // lease.renew validates ttlMs, rejects expired lease, and rejects after close
    if (leaseA.ok) {
      const badRenew = await leaseA.value.renew(0)
      expect(badRenew.ok).toBe(false)
      if (!badRenew.ok) expect(badRenew.error.code).toBe('InvalidArgument')

      const nanRenew = await leaseA.value.renew(Number.NaN)
      expect(nanRenew.ok).toBe(false)
      if (!nanRenew.ok) expect(nanRenew.error.code).toBe('InvalidArgument')

      // Advance past expiry -> renew MUST fail
      now += 1_500
      const expiredRenew = await leaseA.value.renew(5_000)
      expect(expiredRenew.ok).toBe(false)
      if (!expiredRenew.ok) {
        expect(['PreconditionFailed', 'NotFound']).toContain(
          expiredRenew.error.code,
        )
      }
    }

    // Renew after close fails with Closed
    const leaseLive = await mem.acquireLease({ lock: 'live' }, 5_000, {
      holder: 'holder-live',
    })
    expect(leaseLive.ok).toBe(true)
    await mem.close()
    if (leaseLive.ok) {
      const closedRenew = await leaseLive.value.renew(5_000)
      expect(closedRenew.ok).toBe(false)
      if (!closedRenew.ok) expect(closedRenew.error.code).toBe('Closed')
    }
  })
})
