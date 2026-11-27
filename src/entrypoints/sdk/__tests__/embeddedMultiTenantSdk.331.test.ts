import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@claude-code/builtin-tools/tools/GlobTool/GlobTool.js'
import { GrepTool } from '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
import { getSkillDirCommands } from '../../../skills/loadSkillsDir.js'
import { registerCleanup } from '../../../utils/cleanupRegistry.js'
import { getCwd } from '../../../utils/cwd.js'
import { assertTempDirAllowedInDiskless } from '../../../utils/disklessGuards.js'
import {
  acquireSharedBackendMode,
  isSharedBackend,
  setSharedBackendMode,
} from '../../../utils/sessionContextAls.js'
import {
  getDesktopAppHostsTenant,
  getHostOtelState,
  getHostPolicyVerdict,
  getHostRendersChromeSetupOffer,
  getMcpClientsFromAccessorOrTenant,
  getSdkPerTaskStopAffordance,
  getToolsConfirmedOnHost,
  getToolsMayBeOnHost,
  isCcsTenant,
  isDisklessProcess,
  isGatewayHostHeldStrict,
  isGatewayRequiredByHostPolicy,
} from '../../../utils/sessionHost.js'
import { getTaskOutputPath } from '../../../utils/task/diskOutput.js'
import {
  attachRemoteNativeToolBridge,
  buildTurnHandoffCapability,
  createEmbeddedHost,
  createExplicitToolDeps,
  createHttpRemoteNativeToolBridge,
  createMemoryStorageV5Backend,
  createSdkMcpServer,
  createToolCallContext,
  type EmbeddedHost,
  EXIT_REASONS,
  evaluateTurnHandoffAdmission,
  getPinnedStorageV5,
  getRemoteNativeToolRunner,
  getTurnHandoffManager,
  HOOK_EVENTS,
  LOCAL_ONLY_NATIVE_TOOL_NAMES,
  type McpHttpServerHandle,
  type MemoryStorageV5,
  NativeToolElsewhereError,
  NeverRunsInThisProcessError,
  pinInjectedStorageV5,
  REMOTE_CHECK_DOES_NOT_DECIDE,
  registerRemoteNativeToolRunner,
  spawnRemoteNativeToolWorker,
  startMCPServerHttp,
  TurnHandoffManager,
  unregisterRemoteNativeToolRunner,
} from '../index.js'

function isMemoryStorageV5(storage: unknown): storage is MemoryStorageV5 {
  return (
    typeof storage === 'object' &&
    storage !== null &&
    'snapshot' in storage &&
    typeof (storage as { snapshot?: unknown }).snapshot === 'function'
  )
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('Public Multi-Tenant Embedded SDK & Live Cross-Process E2E (2.1.331)', () => {
  const tempDirs: string[] = []
  const hostsToDispose: EmbeddedHost[] = []
  const serversToClose: McpHttpServerHandle[] = []

  afterEach(async () => {
    while (hostsToDispose.length > 0) {
      const host = hostsToDispose.pop()
      if (host) {
        await host.dispose()
      }
    }
    while (serversToClose.length > 0) {
      const server = serversToClose.pop()
      if (server) {
        await server.close()
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    setSharedBackendMode(false)
  })

  test('SDK barrel exports all documented runtime APIs, constants, and constructors', () => {
    expect(typeof createEmbeddedHost).toBe('function')
    expect(typeof createSdkMcpServer).toBe('function')
    expect(Array.isArray(HOOK_EVENTS)).toBe(true)
    expect(Array.isArray(EXIT_REASONS)).toBe(true)
    expect(LOCAL_ONLY_NATIVE_TOOL_NAMES.has('Read')).toBe(true)
    expect(LOCAL_ONLY_NATIVE_TOOL_NAMES.has('Bash')).toBe(true)
    expect(typeof createExplicitToolDeps).toBe('function')
    expect(typeof createToolCallContext).toBe('function')
    expect(typeof registerRemoteNativeToolRunner).toBe('function')
    expect(typeof unregisterRemoteNativeToolRunner).toBe('function')
    expect(typeof getRemoteNativeToolRunner).toBe('function')
    expect(typeof NativeToolElsewhereError).toBe('function')
    expect(typeof NeverRunsInThisProcessError).toBe('function')
    expect(typeof REMOTE_CHECK_DOES_NOT_DECIDE).toBe('symbol')
    expect(typeof createHttpRemoteNativeToolBridge).toBe('function')
    expect(typeof attachRemoteNativeToolBridge).toBe('function')
    expect(typeof spawnRemoteNativeToolWorker).toBe('function')
    expect(typeof createMemoryStorageV5Backend).toBe('function')
    expect(typeof pinInjectedStorageV5).toBe('function')
    expect(typeof getPinnedStorageV5).toBe('function')
    expect(typeof startMCPServerHttp).toBe('function')
    expect(typeof evaluateTurnHandoffAdmission).toBe('function')
    expect(typeof buildTurnHandoffCapability).toBe('function')
    expect(typeof getTurnHandoffManager).toBe('function')
    expect(typeof TurnHandoffManager).toBe('function')
  })

  test('3-tenant concurrent isolation: live HTTP worker for diskless Tenant A, local FS for Tenant B, fail-closed diskless Tenant C', async () => {
    const workerWorkspace = makeTempDir('sdk-e2e-worker-a-')
    const tenantBCwd = makeTempDir('sdk-e2e-tenant-b-')
    tempDirs.push(workerWorkspace, tenantBCwd)

    // Spin up a REAL live Streamable HTTP MCP tool worker serving native tools
    const workerServer = await startMCPServerHttp(workerWorkspace, {
      port: 0,
      resultFormat: 'raw',
      announceOnStdout: false,
      authAnnounceMode: 'silent',
      getToolsOverride: () => [
        FileWriteTool,
        FileReadTool,
        FileEditTool,
        GlobTool,
        GrepTool,
        BashTool,
      ],
      loadAgentDefinitions: async () => ({
        activeAgents: [],
        allAgents: [],
      }),
    })
    serversToClose.push(workerServer)

    const workerBridge = createHttpRemoteNativeToolBridge({
      url: workerServer.url,
      authToken: workerServer.authToken,
    })

    // Tenant A: diskless CCS tenant with auto in-memory StorageV5 and live HTTP worker
    const tenantAOtel = { tracer: 'tenant-a-otel' }
    const tenantAMcpClients = [{ name: 'mcp-a' }]
    const tenantA = createEmbeddedHost({
      tenantId: 'tenant-a',
      diskless: true,
      desktopAppHostsTenant: true,
      toolsMayBeOnHost: true,
      toolsConfirmedOnHost: true,
      hostPolicyVerdict: true,
      hostOtelState: tenantAOtel,
      sdkPerTaskStopAffordance: true,
      hostRendersChromeSetupOffer: true,
      strictGatewayHosts: ['gw-a.internal.'],
      gatewayRequiredByHostPolicy: host => host.endsWith('.tenant-a.corp'),
      tenantMcpClientsAccessor: () => tenantAMcpClients,
    })
    hostsToDispose.push(tenantA)

    // Tenant B: non-diskless local host with separate temp CWD & custom MemoryStorageV5
    const tenantBStorage = createMemoryStorageV5Backend({
      configHome: '/mem-tenant-b',
    })
    const tenantB = createEmbeddedHost({
      tenantId: 'tenant-b',
      diskless: false,
      storageV5: tenantBStorage,
      hostPolicyVerdict: false,
    })
    hostsToDispose.push(tenantB)

    // Tenant C: diskless CCS tenant with NO remote worker attached (fail-closed)
    const tenantC = createEmbeddedHost({
      tenantId: 'tenant-c',
      diskless: true,
    })
    hostsToDispose.push(tenantC)

    expect(isSharedBackend()).toBe(true)
    expect(tenantA.diskless).toBe(true)
    expect(tenantA.storageV5).toBeDefined()
    expect(tenantB.diskless).toBe(false)
    expect(tenantB.storageV5).toBe(tenantBStorage)
    expect(tenantC.diskless).toBe(true)
    expect(tenantC.storageV5).toBeDefined()

    const sessionA = tenantA.createSession({
      sessionId: 'sess-a-1',
      remoteNativeToolBridge: workerBridge,
    })
    const sessionB = tenantB.createSession({
      sessionId: 'sess-b-1',
      cwd: tenantBCwd,
    })
    const sessionC = tenantC.createSession({
      sessionId: 'sess-c-1',
    })

    const workerTargetFile = join(workerWorkspace, 'hello.txt')
    const tenantBTargetFile = join(tenantBCwd, 'local-b.txt')
    const storageKey = { namespace: 'session', file: 'tenant-marker.json' }

    // Execute all three tenants concurrently in the same process
    await Promise.all([
      // ---- Tenant A flow (diskless host -> HTTP worker -> real worker FS) ----
      (async () => {
        await sessionA.run(async () => {
          expect(isCcsTenant()).toBe(true)
          expect(isDisklessProcess()).toBe(false)
          expect(getDesktopAppHostsTenant()).toBe(true)
          expect(getToolsMayBeOnHost()).toBe(true)
          expect(getToolsConfirmedOnHost()).toBe(true)
          expect(getHostPolicyVerdict()).toBe(true)
          expect(getHostOtelState()).toBe(tenantAOtel)
          expect(getSdkPerTaskStopAffordance()).toBe(true)
          expect(getHostRendersChromeSetupOffer()).toBe(true)
          expect(isGatewayHostHeldStrict('gw-a.internal')).toBe(true)
          expect(isGatewayHostHeldStrict('gw-b.internal')).toBe(false)
          expect(isGatewayRequiredByHostPolicy('api.tenant-a.corp')).toBe(true)
          expect(isGatewayRequiredByHostPolicy('api.tenant-b.corp')).toBe(false)
          expect(getMcpClientsFromAccessorOrTenant()).toEqual(tenantAMcpClients)

          // Pin StorageV5 writes strictly to Tenant A's in-memory backend
          const pinnedA = getPinnedStorageV5()
          expect(pinnedA).toBe(tenantA.storageV5)
          const writeRes = await pinnedA!.write(
            storageKey,
            JSON.stringify({ tenant: 'A' }),
          )
          expect(writeRes.ok).toBe(true)
          expect(existsSync('/mem-claude/sessions/tenant-marker.json')).toBe(
            false,
          )
        })

        // 1. Write file via HTTP worker
        const writeResult = await sessionA.executeTool(FileWriteTool, {
          file_path: workerTargetFile,
          content: 'line1: alpha-marker\nline2: beta-value\n',
        })
        expect(writeResult.data.filePath).toBe(workerTargetFile)

        // 2. Read file back via HTTP worker
        const readResult = await sessionA.executeTool(FileReadTool, {
          file_path: workerTargetFile,
        })
        expect(readResult.data.type).toBe('text')
        if (readResult.data.type === 'text') {
          expect(readResult.data.file.content).toContain('alpha-marker')
        }

        // 3. Edit file via HTTP worker and verify claudecode/editResult propagation
        const editResult = await sessionA.executeTool(FileEditTool, {
          file_path: workerTargetFile,
          old_string: 'beta-value',
          new_string: 'gamma-edited-331',
        })
        expect(editResult.data.newString).toBe('gamma-edited-331')
        expect(editResult.subagentFrameResult).toBeDefined()
        expect(readFileSync(workerTargetFile, 'utf8')).toContain(
          'gamma-edited-331',
        )

        // 4. Glob via HTTP worker
        const globResult = await sessionA.executeTool(GlobTool, {
          pattern: '*.txt',
          path: workerWorkspace,
        })
        expect(globResult.data.numFiles).toBeGreaterThanOrEqual(1)
        expect(
          globResult.data.filenames.some(f => f.endsWith('hello.txt')),
        ).toBe(true)

        // 5. Grep via HTTP worker
        const grepResult = await sessionA.executeTool(GrepTool, {
          pattern: 'gamma-edited-331',
          path: workerWorkspace,
          output_mode: 'content',
        })
        expect(grepResult.data.mode).toBe('content')
        if (grepResult.data.mode === 'content') {
          expect(grepResult.data.content).toContain('gamma-edited-331')
        }

        // 6. Bash via HTTP worker
        const bashResult = await sessionA.executeTool(BashTool, {
          command: 'printf "worker-bash-ok-331"',
        })
        expect(bashResult.data.stdout).toContain('worker-bash-ok-331')

        // Confirm Tenant A's StorageV5 still contains only Tenant A's marker
        await sessionA.run(async () => {
          const readBack = await getPinnedStorageV5()!.readText([
            { key: storageKey },
          ])
          expect(readBack.ok).toBe(true)
          if (readBack.ok) {
            expect(readBack.value.items[0]?.value).toBe(
              JSON.stringify({ tenant: 'A' }),
            )
          }
        })
      })(),

      // ---- Tenant B flow (non-diskless local FS in Tenant B's own CWD) ----
      (async () => {
        await sessionB.run(async () => {
          expect(isCcsTenant()).toBe(false)
          expect(isDisklessProcess()).toBe(false)
          expect(getDesktopAppHostsTenant()).toBe(false)
          expect(getHostPolicyVerdict()).toBe(false)
          expect(isGatewayHostHeldStrict('gw-a.internal')).toBe(false)
          expect(getCwd()).toBe(tenantBCwd)

          // Temp dir and task output paths succeed in non-diskless Tenant B
          expect(() => assertTempDirAllowedInDiskless()).not.toThrow()
          expect(getTaskOutputPath('task-b-ok')).toContain('task-b-ok')

          // Write Tenant B's own marker to its isolated custom StorageV5
          const pinnedB = getPinnedStorageV5()
          expect(pinnedB).toBe(tenantBStorage)
          const writeRes = await pinnedB!.write(
            storageKey,
            JSON.stringify({ tenant: 'B' }),
          )
          expect(writeRes.ok).toBe(true)
        })

        // Local FileWriteTool & FileReadTool inside Tenant B's CWD
        const writeB = await sessionB.executeTool(FileWriteTool, {
          file_path: tenantBTargetFile,
          content: 'tenant-b-local-content\n',
        })
        expect(writeB.data.filePath).toBe(tenantBTargetFile)
        expect(readFileSync(tenantBTargetFile, 'utf8')).toBe(
          'tenant-b-local-content\n',
        )

        const readB = await sessionB.executeTool(FileReadTool, {
          file_path: tenantBTargetFile,
        })
        expect(readB.data.type).toBe('text')
        if (readB.data.type === 'text') {
          expect(readB.data.file.content).toContain('tenant-b-local-content')
        }

        // Verify Tenant B did NOT touch Tenant A's worker workspace or StorageV5
        expect(existsSync(join(workerWorkspace, 'local-b.txt'))).toBe(false)
        expect(existsSync(join(tenantBCwd, 'hello.txt'))).toBe(false)

        await sessionB.run(async () => {
          const readBack = await getPinnedStorageV5()!.readText([
            { key: storageKey },
          ])
          expect(readBack.ok).toBe(true)
          if (readBack.ok) {
            expect(readBack.value.items[0]?.value).toBe(
              JSON.stringify({ tenant: 'B' }),
            )
          }
        })
      })(),

      // ---- Tenant C flow (diskless without worker -> fail-closed guards) ----
      (async () => {
        await sessionC.run(async () => {
          expect(isCcsTenant()).toBe(true)
          expect(isDisklessProcess()).toBe(false)
          expect(() => assertTempDirAllowedInDiskless()).toThrow(
            /diskless session/i,
          )
          expect(() => getTaskOutputPath('task-c-refused')).toThrow(
            /diskless session/i,
          )
        })

        await expect(
          sessionC.executeTool(FileReadTool, {
            file_path: workerTargetFile,
          }),
        ).rejects.toThrow(NeverRunsInThisProcessError)

        await expect(
          sessionC.executeTool(BashTool, {
            command: 'echo should-never-run',
          }),
        ).rejects.toThrow(NeverRunsInThisProcessError)
      })(),
    ])

    // Verify Tenant A's auto-created StorageV5 kept its data purely in memory
    if (isMemoryStorageV5(tenantA.storageV5)) {
      const snapA = tenantA.storageV5.snapshot()
      expect(snapA['/mem-claude/sessions/tenant-marker.json']).toBe(
        JSON.stringify({ tenant: 'A' }),
      )
    }
    const snapB = tenantBStorage.snapshot()
    expect(snapB['/mem-tenant-b/sessions/tenant-marker.json']).toBe(
      JSON.stringify({ tenant: 'B' }),
    )
    expect(snapB['/mem-claude/sessions/tenant-marker.json']).toBeUndefined()

    await workerBridge.dispose()
  })

  test('forkProject() shares RootSessionSlot (remote bridge + TurnHandoffManager) while isolating project cwd', async () => {
    const workerWorkspace = makeTempDir('sdk-e2e-fork-worker-')
    const forkProjectDir = '/virtual/forked-project'
    tempDirs.push(workerWorkspace)

    const workerServer = await startMCPServerHttp(workerWorkspace, {
      port: 0,
      resultFormat: 'raw',
      announceOnStdout: false,
      authAnnounceMode: 'silent',
      getToolsOverride: () => [FileWriteTool, FileReadTool],
      loadAgentDefinitions: async () => ({
        activeAgents: [],
        allAgents: [],
      }),
    })
    serversToClose.push(workerServer)

    const bridge = createHttpRemoteNativeToolBridge({
      url: workerServer.url,
      authToken: workerServer.authToken,
    })

    const host = createEmbeddedHost({
      tenantId: 'tenant-fork',
      diskless: true,
    })
    hostsToDispose.push(host)

    const parent = host.createSession({
      sessionId: 'sess-parent',
      cwd: '/virtual/root-project',
      remoteNativeToolBridge: bridge,
    })

    const testFile = join(workerWorkspace, 'fork-shared.txt')
    await parent.executeTool(FileWriteTool, {
      file_path: testFile,
      content: 'written-by-parent',
    })

    parent
      .getTurnHandoffManager()
      .stageFile('shared/from-parent.ts', 'export const x = 1')

    const fork = parent.forkProject(forkProjectDir)
    expect(fork.session.root).toBe(parent.session.root)
    expect(fork.sessionId).toBe(parent.sessionId)
    expect(fork.cwd).toBe(forkProjectDir)
    expect(parent.cwd).toBe('/virtual/root-project')
    expect(host.listSessions()).toHaveLength(2)

    // Fork sees its own project CWD inside ALS while parent retains its own
    const [parentCwd, forkCwd] = await Promise.all([
      parent.run(() => getCwd()),
      fork.run(() => getCwd()),
    ])
    expect(parentCwd).toBe('/virtual/root-project')
    expect(forkCwd).toBe(forkProjectDir)

    // Fork inherits parent's remote bridge via RootSessionSlot
    expect(getRemoteNativeToolRunner(fork.session, 'Read')).toBeDefined()
    const forkRead = await fork.executeTool(FileReadTool, {
      file_path: testFile,
    })
    expect(forkRead.data.type).toBe('text')
    if (forkRead.data.type === 'text') {
      expect(forkRead.data.file.content).toContain('written-by-parent')
    }

    // Fork shares TurnHandoffManager via RootSessionSlot
    expect(fork.getTurnHandoffManager()).toBe(parent.getTurnHandoffManager())
    expect(
      fork.getTurnHandoffManager().stagedFiles.get('shared/from-parent.ts')
        ?.content,
    ).toBe('export const x = 1')

    // Disposing the fork leaves parent's bridge intact
    await fork.dispose()
    expect(fork.disposed).toBe(true)
    expect(parent.disposed).toBe(false)
    expect(getRemoteNativeToolRunner(parent.session, 'Read')).toBeDefined()

    const parentReadAfterForkDispose = await parent.executeTool(FileReadTool, {
      file_path: testFile,
    })
    // Same worker readFileStateCache deduplicates the unchanged second read
    expect(['text', 'file_unchanged']).toContain(
      parentReadAfterForkDispose.data.type,
    )

    await bridge.dispose()
  })

  test('Worker 1 -> Worker 2 turn_handoff snapshot export & hydration inside EmbeddedSession', () => {
    const admission = evaluateTurnHandoffAdmission({
      remoteSessionId: 'remote-sess-331',
      hydratesCarriedLines: true,
    })
    expect(admission.admitted).toBe(true)
    const cap = buildTurnHandoffCapability(admission, {
      workerEpoch: 1,
      homeFiles: true,
      carriedWrites: true,
    })
    expect(cap?.turn_handoff?.worker_epoch).toBe(1)
    expect(cap?.turn_handoff?.carried_writes).toBe(true)

    const host = createEmbeddedHost({
      tenantId: 'tenant-handoff',
      diskless: true,
    })
    hostsToDispose.push(host)

    const worker1Session = host.createSession({ sessionId: 'handoff-sess-1' })
    const worker2Session = host.createSession({ sessionId: 'handoff-sess-2' })

    const mgr1 = worker1Session.getTurnHandoffManager()
    const mgr2 = worker2Session.getTurnHandoffManager()
    expect(mgr1).not.toBe(mgr2)

    mgr1.markMultiTenantWorkerShutdown()
    mgr1.stageFile('src/index.ts', 'export const hello = "world"\n')
    mgr1.recordCarriedWrite('notes/handoff.md', '# Carried\n', 'create')

    const snapshot = mgr1.exportHandoffSnapshot({
      sessionId: worker1Session.sessionId,
      sharedMessageId: 'msg-shared-42',
      rewindRequestId: 'rewind-req-7',
    })
    expect(snapshot.worker_epoch).toBe(1)
    expect(snapshot.multi_tenant_worker_shutdown).toBe(true)
    expect(snapshot.staged_files).toHaveLength(1)
    expect(snapshot.carried_writes).toHaveLength(1)

    const hydrated = mgr2.hydrateFromHandoffSnapshot(snapshot)
    expect(hydrated).toEqual({
      ok: true,
      appliedEpoch: 1,
      stagedCount: 1,
      carriedWriteCount: 1,
      homeFileCount: 0,
      droppedMessages: 0,
    })
    expect(mgr2.workerEpoch).toBe(1)
    expect(mgr2.multiTenantShutdownAborted).toBe(true)
    expect(mgr2.lastSessionId).toBe('handoff-sess-1')
    expect(mgr2.lastSharedMessageId).toBe('msg-shared-42')
    expect(mgr2.lastRewindRequestId).toBe('rewind-req-7')
    expect(mgr2.stagedFiles.get('src/index.ts')?.content).toBe(
      'export const hello = "world"\n',
    )
    expect(mgr2.carriedWrites.get('notes/handoff.md')).toEqual({
      path: 'notes/handoff.md',
      content: '# Carried\n',
      mode: 'create',
    })

    // Replaying same/stale epoch is rejected
    const replay = mgr2.hydrateFromHandoffSnapshot(snapshot)
    expect(replay.ok).toBe(false)
  })

  test('full dispose() lifecycle: detaches bridges, drains only host cleanup, rejects subsequent runs, and restores isSharedBackend()', async () => {
    expect(isSharedBackend()).toBe(false)

    const workerWorkspace = makeTempDir('sdk-e2e-dispose-')
    tempDirs.push(workerWorkspace)

    const workerServer = await startMCPServerHttp(workerWorkspace, {
      port: 0,
      resultFormat: 'raw',
      announceOnStdout: false,
      authAnnounceMode: 'silent',
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({
        activeAgents: [],
        allAgents: [],
      }),
    })
    serversToClose.push(workerServer)

    const bridge = createHttpRemoteNativeToolBridge({
      url: workerServer.url,
      authToken: workerServer.authToken,
    })

    const hostA = createEmbeddedHost({
      tenantId: 'dispose-tenant-a',
      diskless: true,
    })
    const hostB = createEmbeddedHost({
      tenantId: 'dispose-tenant-b',
      diskless: false,
    })
    hostsToDispose.push(hostA, hostB)

    expect(isSharedBackend()).toBe(true)

    const sessionA = hostA.createSession({
      sessionId: 'dispose-sess-a',
      remoteNativeToolBridge: bridge,
    })
    const sessionB = hostB.createSession({
      sessionId: 'dispose-sess-b',
      cwd: workerWorkspace,
    })

    let cleanupACalled = 0
    let cleanupBCalled = 0
    await hostA.run(() => {
      registerCleanup(() => {
        cleanupACalled++
      })
    })
    await hostB.run(() => {
      registerCleanup(() => {
        cleanupBCalled++
      })
    })

    expect(getRemoteNativeToolRunner(sessionA.session, 'Read')).toBeDefined()

    // Dispose Host A (idempotent double-dispose)
    await hostA.dispose()
    await hostA.dispose()

    expect(hostA.disposed).toBe(true)
    expect(sessionA.disposed).toBe(true)
    expect(hostA.listSessions()).toHaveLength(0)
    expect(getRemoteNativeToolRunner(sessionA.session, 'Read')).toBeUndefined()
    expect(cleanupACalled).toBe(1)
    expect(cleanupBCalled).toBe(0)

    // Subsequent calls on disposed session & host reject/throw cleanly
    await expect(sessionA.run(() => 'nope')).rejects.toThrow(/disposed/i)
    await expect(
      sessionA.executeTool(FileReadTool, { file_path: '/tmp/nope.txt' }),
    ).rejects.toThrow(/disposed/i)
    await expect(hostA.run(() => 'nope')).rejects.toThrow(/disposed/i)
    expect(() => hostA.createSession()).toThrow(/disposed/i)

    // Host B is still active, so shared-backend mode remains enabled
    expect(isSharedBackend()).toBe(true)
    expect(await sessionB.run(() => getCwd())).toBe(workerWorkspace)

    // Disposing the last active host restores isSharedBackend() to false
    await hostB.dispose()
    expect(cleanupBCalled).toBe(1)
    expect(isSharedBackend()).toBe(false)

    // Close bridge and live HTTP MCP worker cleanly
    await bridge.dispose()
    await workerServer.close()
    serversToClose.pop()
  })

  test('P0-3: diskless EmbeddedHost with auto memory StorageV5 never reads skills from OS disk', async () => {
    const hostDiskDir = makeTempDir('sdk-p03-skills-')
    tempDirs.push(hostDiskDir)
    const skillDir = join(hostDiskDir, '.claude', 'skills', 'leaked-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: leaked-skill\ndescription: Must not load in diskless\n---\nSecret\n',
      'utf8',
    )

    const host = createEmbeddedHost({
      tenantId: 'p03-diskless-host',
      diskless: true,
    })
    hostsToDispose.push(host)
    expect(host.storageV5).toBeDefined()

    const session = host.createSession({ cwd: hostDiskDir })
    const skills = await session.run(() => getSkillDirCommands(hostDiskDir))
    expect(skills).toEqual([])
  })

  test('P1-2: concurrent EmbeddedHost + acquireSharedBackendMode (ACP) leases never clobber isSharedBackend()', async () => {
    expect(isSharedBackend()).toBe(false)

    // Order 1: EmbeddedHost created first, ACP acquires second, EmbeddedHost disposes first
    const host1 = createEmbeddedHost({ tenantId: 'p12-host-1' })
    hostsToDispose.push(host1)
    expect(isSharedBackend()).toBe(true)

    const releaseAcp1 = acquireSharedBackendMode()
    expect(isSharedBackend()).toBe(true)

    await host1.dispose()
    // ACP lease still active -> MUST remain true
    expect(isSharedBackend()).toBe(true)

    // Double-release is idempotent and clears once the last lease exits
    releaseAcp1()
    releaseAcp1()
    expect(isSharedBackend()).toBe(false)

    // Order 2: ACP acquires first, EmbeddedHost created second, ACP releases first
    const releaseAcp2 = acquireSharedBackendMode()
    const host2 = createEmbeddedHost({ tenantId: 'p12-host-2' })
    hostsToDispose.push(host2)
    expect(isSharedBackend()).toBe(true)

    releaseAcp2()
    // EmbeddedHost still active -> MUST remain true
    expect(isSharedBackend()).toBe(true)

    await host2.dispose()
    expect(isSharedBackend()).toBe(false)
  })

  test('P1-1: create-only executeTool enforces TOCTOU runnerCheckedHere guard & sanitizes direct remote runner errors', async () => {
    const host = createEmbeddedHost({
      tenantId: 'p11-toctou-host',
      diskless: true,
    })
    hostsToDispose.push(host)
    const session = host.createSession({ sessionId: 'p11-sess' })

    const createOnlyTool = {
      name: 'CustomCreateTool',
      create: () => ({
        call: async () => ({ data: { source: 'local' } }),
      }),
    }

    const runnerA = async () => ({ output: { source: 'runnerA' } })
    const runnerB = async () => ({ output: { source: 'runnerB' } })

    // Register runnerB WITHOUT a remoteCheck
    session.registerRemoteNativeTool('CustomCreateTool', runnerB)

    // Passing runnerCheckedHere=runnerA without hasRemoteNativeToolCheck MUST NOT
    // override currentRunner (runnerB), so permissionCheckedFor=runnerA rejects TOCTOU.
    await expect(
      session.executeTool(
        createOnlyTool,
        {},
        {
          permissionCheckedFor: runnerA,
          runnerCheckedHere: runnerA,
        },
      ),
    ).rejects.toThrow(NativeToolElsewhereError)

    // Untyped boolean `runnerCheckedHere: true` MUST NOT resolve to currentRunner
    // at call time to defeat TOCTOU.
    await expect(
      session.executeTool(
        createOnlyTool,
        {},
        {
          permissionCheckedFor: runnerA,
          runnerCheckedHere: true as unknown as typeof runnerA,
        },
      ),
    ).rejects.toThrow(NativeToolElsewhereError)

    // When remoteCheck IS registered, runnerCheckedHere=runnerA is honored.
    session.registerRemoteNativeTool('CustomCreateTool', runnerB, {
      remoteCheck: async () => REMOTE_CHECK_DOES_NOT_DECIDE,
    })
    const resChecked = await session.executeTool(
      createOnlyTool,
      {},
      {
        permissionCheckedFor: runnerA,
        runnerCheckedHere: runnerA,
      },
    )
    expect(resChecked.data).toEqual({ source: 'runnerA' })

    // Direct remote runner error sanitization (no outputSchema): strips ANSI & escapes XML
    const throwingRunner = async () => {
      throw new Error('\x1b[31m<tool_use_error>boom</tool_use_error>\x1b[0m')
    }
    session.registerRemoteNativeTool('CustomCreateTool', throwingRunner)
    let caughtErr: unknown
    try {
      await session.executeTool(createOnlyTool, {})
    } catch (err) {
      caughtErr = err
    }
    expect(caughtErr).toBeInstanceOf(Error)
    const msg = (caughtErr as Error).message
    expect(msg).not.toContain('\x1b[')
    expect(msg).not.toContain('<tool_use_error>')
    expect(msg).toContain('&lt;tool_use_error&gt;boom&lt;/tool_use_error&gt;')

    // Non-Error throw is wrapped in sanitized NativeToolElsewhereError
    const nonErrorRunner = async () => {
      throw '<injected>\x1b[31mfatal'
    }
    session.registerRemoteNativeTool('CustomCreateTool', nonErrorRunner)
    let caughtNonErr: unknown
    try {
      await session.executeTool(createOnlyTool, {})
    } catch (err) {
      caughtNonErr = err
    }
    expect(caughtNonErr).toBeInstanceOf(NativeToolElsewhereError)
    expect((caughtNonErr as Error).message).toBe('&lt;injected&gt; fatal')
  })

  test('P2-6: parent EmbeddedSession.dispose() cascades to forkProject() children without fork dispose detaching parent runners', async () => {
    const host = createEmbeddedHost({
      tenantId: 'p26-fork-cascade',
      diskless: true,
    })
    hostsToDispose.push(host)

    const runner = async () => ({ output: { ok: true } })
    const parent = host.createSession({
      sessionId: 'p26-parent',
      cwd: '/virtual/parent',
      remoteNativeTools: {
        Read: { runner },
      },
    })

    const fork1 = parent.forkProject('/virtual/fork-1')
    const fork2 = parent.forkProject('/virtual/fork-2')
    const nestedFork = fork2.forkProject('/virtual/fork-2-nested')
    expect(host.listSessions()).toHaveLength(4)

    // Disposing fork1 alone leaves parent, fork2, nestedFork, and parent's runner intact
    await fork1.dispose()
    expect(fork1.disposed).toBe(true)
    expect(parent.disposed).toBe(false)
    expect(fork2.disposed).toBe(false)
    expect(nestedFork.disposed).toBe(false)
    expect(getRemoteNativeToolRunner(parent.session, 'Read')).toBe(runner)
    expect(host.listSessions()).toHaveLength(3)

    // Disposing parent cascades to fork2 & nestedFork and detaches parent's runner
    await parent.dispose()
    expect(parent.disposed).toBe(true)
    expect(fork2.disposed).toBe(true)
    expect(nestedFork.disposed).toBe(true)
    expect(getRemoteNativeToolRunner(parent.session, 'Read')).toBeUndefined()
    expect(host.listSessions()).toHaveLength(0)

    await expect(fork2.run(() => 'nope')).rejects.toThrow(/disposed/i)
    await expect(nestedFork.run(() => 'nope')).rejects.toThrow(/disposed/i)
  })
})
