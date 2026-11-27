import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ClientDataDocument,
  coverLoadedClientDataDocument,
  describeLoadedClientDataStatus,
  getLoadedClientDataDocument,
  getPublishedCatalogFloorPath,
  mergeLoadedClientDataInto,
  persistPublishedCatalogFloor,
  resetClientDataUrlStateForTests,
  setLoadedClientDataDocumentForTests,
} from '../../cli/clientDataUrl.js'
import {
  clearActiveMonitor,
  getActiveMonitor,
  trySetActiveMonitor,
} from '../../commands/autofix-pr/monitorState.js'
import {
  clearBuiltinPlugins,
  getBuiltinPluginDefinition,
  getBuiltinPlugins,
  getBuiltinPluginSkillCommands,
  isBuiltinPluginsInitialized,
  registerBuiltinPlugin,
} from '../../plugins/builtinPlugins.js'
import { initBuiltinPlugins } from '../../plugins/bundled/index.js'
import {
  readRoster,
  type RosterEntry,
  updateRoster,
} from '../../daemon/bgWorker.js'
import {
  _resetEgressProxyAuthForTesting,
  commandEnvWithOriginalProxy,
  enableEgressProxyAuth,
  PROXY_AUTH_COMMAND_ENV,
  PROXY_AUTH_FILE_ENV,
  sessionChildProxyEnvOverlay,
} from '../../self-hosted-runner/egressProxyAuth.js'
import { createInstinct } from '../../services/skillLearning/instinctParser.js'
import {
  loadInstincts,
  upsertInstinct,
} from '../../services/skillLearning/instinctStore.js'
import { llmObserverBackend } from '../../services/skillLearning/llmObserverBackend.js'
import {
  listObserverBackends,
  registerDefaultObserverBackend,
  resetObserverBackendsForTest,
} from '../../services/skillLearning/observerBackend.js'
import { heuristicObserverBackend } from '../../services/skillLearning/sessionObserver.js'
import {
  getRegisteredRemoteTaskHandlersForTests,
  registerContentExtractor,
} from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import {
  getAgentProxyNote,
  resetAgentProxyNoteForTests,
  setAgentProxyNote,
} from '../../upstreamproxy/agentProxyPrompt.js'
import {
  getUpstreamProxyEnv,
  initUpstreamProxy,
  resetUpstreamProxyForTests,
} from '../../upstreamproxy/upstreamproxy.js'
import {
  __resetBundledWorkflowsInitForTests,
  initBundledWorkflows,
} from '../../workflow/bundled/init.js'
import {
  __resetWorkflowServiceForTests,
  getWorkflowService,
  peekWorkflowService,
  shutdownAllWorkflowServices,
} from '../../workflow/service.js'
import { createWorkflowToolCore } from '../../workflow/wiring.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import { releasePump, retainPump } from '../computerUse/drainRunLoop.js'
import {
  notifyExpectedEscape,
  unregisterEscHotkey,
} from '../computerUse/escHotkey.js'
import {
  ensureBridge,
  stopAllBridges,
  stopBridge,
} from '../computerUse/win32/bridgeClient.js'
import {
  hideAllIndicators,
  showIndicator,
} from '../computerUse/win32/inputIndicator.js'
import {
  hideAllVirtualCursors,
  isVirtualCursorActive,
  showVirtualCursor,
} from '../computerUse/win32/virtualCursor.js'
import {
  getSessionRefsStore,
  resetSessionRefsStoreForTests,
} from '../plugins/sessionRefsManifest.js'
import { syncCloudSyncedPlugins } from '../plugins/syncedPluginCloudSync.js'
import { pruneSyncedTrash } from '../plugins/syncedPluginSyncFs.js'
import {
  getActiveSessionFromAls,
  resetSessionHostForTests,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import {
  checkMidSessionSettingsFileErrors,
  getActiveSettingsFileErrorNotices,
  resetForTesting as resetChangeDetectorForTesting,
  type SettingsFileErrorNotice,
  subscribeSettingsFileErrorNotices,
} from '../settings/changeDetector.js'
import {
  getMdmRawReadPromise,
  startMdmRawRead,
} from '../settings/mdm/rawRead.js'
import {
  getRegisteredUpstreamProxyEnv,
  registerUpstreamProxyEnvFn,
  resetUpstreamProxyEnvFnForTests,
  subprocessEnv,
} from '../subprocessEnv.js'

const createdTempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  createdTempDirs.push(dir)
  return dir
}

describe('2.1.331 Wave 7 — BuiltinPlugins, ChangeDetector, Workflow, UpstreamProxy, Disk Locks, ComputerUse & RemoteAgentTask fixes', () => {
  afterEach(async () => {
    await resetChangeDetectorForTesting().catch(() => {})
    while (createdTempDirs.length > 0) {
      const dir = createdTempDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
    resetSessionHostForTests()
  })

  test('P0-3 builtinPlugins: boot initBuiltinPlugins() on default host is inherited by isolated hosts while keeping per-host overrides/clears isolated', () => {
    const g = globalThis as Record<string, unknown>
    const hadMacro = 'MACRO' in g
    const prevMacro = g.MACRO
    if (!hadMacro) {
      g.MACRO = { VERSION: '2.1.331-test' }
    }
    clearBuiltinPlugins()
    try {
      // Pre-touch Host Early BEFORE boot initBuiltinPlugins() runs to prove
      // fallback works even for already-materialized HostSlots that were not cleared.
      let earlySessionHostSeenBeforeBoot = false
      const earlySession = runWithNewHostSession(
        { id: 'w7-builtin-early' },
        sessionEarly => {
          earlySessionHostSeenBeforeBoot = isBuiltinPluginsInitialized()
          return sessionEarly
        },
      )
      expect(earlySessionHostSeenBeforeBoot).toBe(false)

      // Boot initBuiltinPlugins() outside ALS (default host)
      initBuiltinPlugins()
      expect(isBuiltinPluginsInitialized()).toBe(true)

      // Fresh isolated host (--acp style) inherits ALL boot-registered builtin plugins & skill commands
      const isolatedSnapshot = runWithNewHostSession(
        { id: 'w7-builtin-iso' },
        () => {
          const { enabled, disabled } = getBuiltinPlugins()
          const allNames = [...enabled, ...disabled].map(p => p.name)
          const skillNames = getBuiltinPluginSkillCommands().map(c => c.name)
          return {
            initialized: isBuiltinPluginsInitialized(),
            hasSecDefault:
              getBuiltinPluginDefinition('cc-plugin-sec-default') !== undefined,
            hasAgentsMd:
              getBuiltinPluginDefinition('cc-plugin-agents-md') !== undefined,
            hasDiff: getBuiltinPluginDefinition('cc-plugin-diff') !== undefined,
            hasMermaid:
              getBuiltinPluginDefinition('cc-plugin-mermaid') !== undefined,
            allNames,
            skillCount: skillNames.length,
          }
        },
      )
      expect(isolatedSnapshot.initialized).toBe(true)
      expect(isolatedSnapshot.hasSecDefault).toBe(true)
      expect(isolatedSnapshot.hasAgentsMd).toBe(true)
      expect(isolatedSnapshot.hasDiff).toBe(true)
      expect(isolatedSnapshot.hasMermaid).toBe(true)
      expect(isolatedSnapshot.allNames.length).toBeGreaterThanOrEqual(4)
      expect(isolatedSnapshot.skillCount).toBeGreaterThan(0)

      // Pre-touched host (whose HostSlot existed before boot) ALSO sees boot defaults
      const preTouchedAfterBoot = runWithSession(earlySession, () => ({
        initialized: isBuiltinPluginsInitialized(),
        hasSecDefault:
          getBuiltinPluginDefinition('cc-plugin-sec-default') !== undefined,
        hasDiff: getBuiltinPluginDefinition('cc-plugin-diff') !== undefined,
      }))
      expect(preTouchedAfterBoot).toEqual({
        initialized: true,
        hasSecDefault: true,
        hasDiff: true,
      })

      // Per-host clear + override stays isolated to that host
      const localOverrideRes = runWithNewHostSession(
        { id: 'w7-builtin-override' },
        () => {
          clearBuiltinPlugins()
          expect(isBuiltinPluginsInitialized()).toBe(false)
          expect(
            getBuiltinPluginDefinition('cc-plugin-sec-default'),
          ).toBeUndefined()
          registerBuiltinPlugin({
            name: 'host-local-only',
            description: 'Local override',
          })
          return {
            hasLocal:
              getBuiltinPluginDefinition('host-local-only') !== undefined,
            hasSecDefault:
              getBuiltinPluginDefinition('cc-plugin-sec-default') !== undefined,
          }
        },
      )
      expect(localOverrideRes).toEqual({
        hasLocal: true,
        hasSecDefault: false,
      })

      // Subsequent fresh host STILL inherits boot defaults untouched by the cleared host
      const freshAfterOverride = runWithNewHostSession(
        { id: 'w7-builtin-after' },
        () => ({
          initialized: isBuiltinPluginsInitialized(),
          hasSecDefault:
            getBuiltinPluginDefinition('cc-plugin-sec-default') !== undefined,
          hasLocalOnly:
            getBuiltinPluginDefinition('host-local-only') !== undefined,
        }),
      )
      expect(freshAfterOverride).toEqual({
        initialized: true,
        hasSecDefault: true,
        hasLocalOnly: false,
      })
    } finally {
      clearBuiltinPlugins()
      if (!hadMacro) {
        delete g.MACRO
      } else {
        g.MACRO = prevMacro
      }
    }
  })

  test('P0-4 changeDetector: isolated hosts subscribed via subscribeSettingsFileErrorNotices() receive notices when checkMidSessionSettingsFileErrors() fires outside ALS', () => {
    const receivedA: Array<{
      notice: SettingsFileErrorNotice
      alsSessionId: string | undefined
    }> = []
    const receivedB: Array<{
      notice: SettingsFileErrorNotice
      alsSessionId: string | undefined
    }> = []

    let unsubA: (() => void) | undefined
    let unsubB: (() => void) | undefined
    const sessionA = runWithNewHostSession({ id: 'w7-cd-host-a' }, session => {
      unsubA = subscribeSettingsFileErrorNotices(notice => {
        receivedA.push({ notice, alsSessionId: getActiveSessionFromAls()?.id })
      })
      return session
    })
    const sessionB = runWithNewHostSession({ id: 'w7-cd-host-b' }, session => {
      unsubB = subscribeSettingsFileErrorNotices(notice => {
        receivedB.push({ notice, alsSessionId: getActiveSessionFromAls()?.id })
      })
      return session
    })

    try {
      // Simulate process-wide chokidar callback firing OUTSIDE ALS
      expect(getActiveSessionFromAls()).toBeUndefined()
      checkMidSessionSettingsFileErrors('userSettings', [
        {
          file: '/tmp/shared-user/.claude/settings.json',
          path: '',
          message: 'Invalid JSON syntax',
          severity: 'fatal',
        },
      ])

      expect(receivedA).toHaveLength(1)
      expect(receivedA[0]?.notice.file).toBe(
        '/tmp/shared-user/.claude/settings.json',
      )
      expect(receivedA[0]?.alsSessionId).toBe(sessionA.id)
      expect(receivedB).toHaveLength(1)
      expect(receivedB[0]?.notice.file).toBe(
        '/tmp/shared-user/.claude/settings.json',
      )
      expect(receivedB[0]?.alsSessionId).toBe(sessionB.id)

      // Both isolated hosts also see the active notice via getActiveSettingsFileErrorNotices()
      expect(
        runWithNewHostSession({ id: 'w7-cd-check-unrelated' }, () =>
          getActiveSettingsFileErrorNotices(),
        ),
      ).toHaveLength(0)

      // Clearing outside ALS delivers cleared notice to both subscribed isolated hosts
      checkMidSessionSettingsFileErrors('userSettings', [])
      expect(receivedA).toHaveLength(2)
      expect(receivedA[1]?.notice.cleared).toBe(true)
      expect(receivedB).toHaveLength(2)
      expect(receivedB[1]?.notice.cleared).toBe(true)
    } finally {
      unsubA?.()
      unsubB?.()
    }
  })

  test('P0-5 workflow/wiring: createWorkflowToolCore() returns a single process-wide Tool reference while descriptorHostSlot routes Host A vs Host B to their own WorkflowService', async () => {
    const defaultTool = createWorkflowToolCore()
    const projA = makeTempDir('w7-wf-a-')
    const projB = makeTempDir('w7-wf-b-')

    let hostAFactoryCalls = 0
    let hostBFactoryCalls = 0

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        { id: 'w7-wf-host-a', cwd: projA, originalCwd: projA },
        async () => {
          __resetWorkflowServiceForTests()
          const toolA = createWorkflowToolCore()
          const svcA = getWorkflowService()
          svcA.ports.hostFactory = () => {
            hostAFactoryCalls++
            throw new Error('routed-to-host-a')
          }
          await new Promise(resolve => setTimeout(resolve, 10))
          let errMsg = ''
          try {
            await toolA.call(
              { script: 'return 1' },
              {} as never,
              (() => {}) as never,
              {} as never,
            )
          } catch (err) {
            errMsg = err instanceof Error ? err.message : String(err)
          }
          __resetWorkflowServiceForTests()
          return { toolA, svcA, errMsg }
        },
      ),
      runWithNewHostSession(
        { id: 'w7-wf-host-b', cwd: projB, originalCwd: projB },
        async () => {
          __resetWorkflowServiceForTests()
          const toolB = createWorkflowToolCore()
          const svcB = getWorkflowService()
          svcB.ports.hostFactory = () => {
            hostBFactoryCalls++
            throw new Error('routed-to-host-b')
          }
          await new Promise(resolve => setTimeout(resolve, 10))
          let errMsg = ''
          try {
            await toolB.call(
              { script: 'return 2' },
              {} as never,
              (() => {}) as never,
              {} as never,
            )
          } catch (err) {
            errMsg = err instanceof Error ? err.message : String(err)
          }
          __resetWorkflowServiceForTests()
          return { toolB, svcB, errMsg }
        },
      ),
    ])

    expect(resA.toolA).toBe(defaultTool)
    expect(resB.toolB).toBe(defaultTool)
    expect(resA.svcA).not.toBe(resB.svcB)
    expect(resA.errMsg).toBe('routed-to-host-a')
    expect(resB.errMsg).toBe('routed-to-host-b')
    expect(hostAFactoryCalls).toBe(1)
    expect(hostBFactoryCalls).toBe(1)
  })

  test('P0-6 upstreamproxy / agentProxyPrompt / subprocessEnv: boot setup on default host is visible inside isolated hosts while preserving per-host overrides', async () => {
    const dir = makeTempDir('w7-upproxy-')
    const tokenPath = join(dir, 'session_token')
    const systemCaPath = join(dir, 'sys-ca.crt')
    const caBundlePath = join(dir, 'ca-bundle.crt')
    writeFileSync(tokenPath, 'secret-session-token')
    writeFileSync(systemCaPath, '---SYS-CA---')

    const server = createServer((req, res) => {
      if (req.url === '/v1/code/upstreamproxy/ca-cert') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('---CCR-CA---')
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevEnabled = process.env.CCR_UPSTREAM_PROXY_ENABLED
    const prevSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    const prevHttpsProxy = process.env.HTTPS_PROXY
    const prevSslCertFile = process.env.SSL_CERT_FILE

    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CCR_UPSTREAM_PROXY_ENABLED = '1'
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess-w7-boot'
    delete process.env.HTTPS_PROXY
    delete process.env.SSL_CERT_FILE

    try {
      // Boot-time setup on default host (outside ALS), mirroring init.ts:621-622
      registerUpstreamProxyEnvFn(getUpstreamProxyEnv)
      const state = await initUpstreamProxy({
        tokenPath,
        systemCaPath,
        caBundlePath,
        ccrBaseUrl: `http://127.0.0.1:${port}`,
      })
      expect(state.enabled).toBe(true)
      expect(state.port).toBeGreaterThan(0)

      // Fresh isolated Host A inherits boot upstreamproxy state, subprocessEnv, and agentProxyNote
      const hostA = runWithNewHostSession({ id: 'w7-upproxy-a' }, () => ({
        directEnv: getUpstreamProxyEnv(),
        registeredEnv: getRegisteredUpstreamProxyEnv(),
        subEnvProxy: subprocessEnv().HTTPS_PROXY,
        note: getAgentProxyNote(),
      }))
      const expectedProxyUrl = `http://127.0.0.1:${state.port}`
      expect(hostA.directEnv.HTTPS_PROXY).toBe(expectedProxyUrl)
      expect(hostA.directEnv.SSL_CERT_FILE).toBe(caBundlePath)
      expect(hostA.registeredEnv.HTTPS_PROXY).toBe(expectedProxyUrl)
      expect(hostA.subEnvProxy).toBe(expectedProxyUrl)
      expect(hostA.note).toContain(caBundlePath)

      // Host B can override locally without mutating default host or Host A
      const hostB = runWithNewHostSession({ id: 'w7-upproxy-b' }, () => {
        setAgentProxyNote('custom-host-b-note')
        registerUpstreamProxyEnvFn(() => ({
          HTTPS_PROXY: 'http://override-b:8888',
        }))
        return {
          registeredProxy: getRegisteredUpstreamProxyEnv().HTTPS_PROXY,
          note: getAgentProxyNote(),
        }
      })
      expect(hostB).toEqual({
        registeredProxy: 'http://override-b:8888',
        note: 'custom-host-b-note',
      })

      // Host C still sees boot setup
      const hostC = runWithNewHostSession({ id: 'w7-upproxy-c' }, () => ({
        registeredProxy: getRegisteredUpstreamProxyEnv().HTTPS_PROXY,
        note: getAgentProxyNote(),
      }))
      expect(hostC.registeredProxy).toBe(expectedProxyUrl)
      expect(hostC.note).toContain(caBundlePath)
    } finally {
      await runCleanupFunctions().catch(() => {})
      resetUpstreamProxyForTests()
      resetAgentProxyNoteForTests()
      resetUpstreamProxyEnvFnForTests()
      await new Promise<void>(resolve => server.close(() => resolve()))
      if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
      else process.env.CLAUDE_CODE_REMOTE = prevRemote
      if (prevEnabled === undefined)
        delete process.env.CCR_UPSTREAM_PROXY_ENABLED
      else process.env.CCR_UPSTREAM_PROXY_ENABLED = prevEnabled
      if (prevSessionId === undefined)
        delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
      else process.env.CLAUDE_CODE_REMOTE_SESSION_ID = prevSessionId
      if (prevHttpsProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = prevHttpsProxy
      if (prevSslCertFile === undefined) delete process.env.SSL_CERT_FILE
      else process.env.SSL_CERT_FILE = prevSslCertFile
    }
  })

  test('P1-8 egressProxyAuth: boot enableEgressProxyAuth() strips secrets in isolated hosts and restores original proxy without loopback loop', async () => {
    const dir = makeTempDir('w7-egress-')
    const authFile = join(dir, 'proxy-auth.txt')
    writeFileSync(authFile, 'Bearer minted-token-1234567890')

    const prevHttps = process.env.HTTPS_PROXY
    const prevHttp = process.env.HTTP_PROXY
    const prevLowerHttps = process.env.https_proxy
    const prevLowerHttp = process.env.http_proxy
    const prevCmd = process.env[PROXY_AUTH_COMMAND_ENV]
    const prevFile = process.env[PROXY_AUTH_FILE_ENV]

    process.env.HTTPS_PROXY = 'http://corp-egress.internal:3128'
    delete process.env.HTTP_PROXY
    delete process.env.https_proxy
    delete process.env.http_proxy
    process.env[PROXY_AUTH_FILE_ENV] = authFile

    let handle: Awaited<ReturnType<typeof enableEgressProxyAuth>> | undefined
    try {
      handle = await enableEgressProxyAuth(
        {
          source: { kind: 'file', path: authFile },
          upstreamProxyUrl: 'http://corp-egress.internal:3128',
        },
        { onStatus: () => {} },
      )

      // Inside isolated Host A, sessionChildProxyEnvOverlay strips secrets and points at loopback listener,
      // while commandEnvWithOriginalProxy restores original corp proxy (no infinite loopback loop).
      const hostA = runWithNewHostSession({ id: 'w7-egress-a' }, () => ({
        overlay: sessionChildProxyEnvOverlay(process.env),
        origCmdEnv: commandEnvWithOriginalProxy(process.env),
      }))
      expect(hostA.overlay.HTTPS_PROXY).toBe(handle.url)
      expect(hostA.overlay[PROXY_AUTH_COMMAND_ENV]).toBeUndefined()
      expect(hostA.overlay[PROXY_AUTH_FILE_ENV]).toBeUndefined()
      expect(hostA.overlay.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER).toBeUndefined()
      expect(hostA.origCmdEnv.HTTPS_PROXY).toBe(
        'http://corp-egress.internal:3128',
      )

      // Resetting inside Host A only clears Host A, not Host B
      runWithNewHostSession({ id: 'w7-egress-reset' }, () => {
        _resetEgressProxyAuthForTesting()
        expect(sessionChildProxyEnvOverlay(process.env)).toEqual({})
      })
      const hostB = runWithNewHostSession({ id: 'w7-egress-b' }, () => ({
        overlayProxy: sessionChildProxyEnvOverlay(process.env).HTTPS_PROXY,
        origProxy: commandEnvWithOriginalProxy(process.env).HTTPS_PROXY,
      }))
      expect(hostB.overlayProxy).toBe(handle.url)
      expect(hostB.origProxy).toBe('http://corp-egress.internal:3128')
    } finally {
      await handle?.close()
      _resetEgressProxyAuthForTesting()
      if (prevHttps === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = prevHttps
      if (prevHttp === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = prevHttp
      if (prevLowerHttps === undefined) delete process.env.https_proxy
      else process.env.https_proxy = prevLowerHttps
      if (prevLowerHttp === undefined) delete process.env.http_proxy
      else process.env.http_proxy = prevLowerHttp
      if (prevCmd === undefined) delete process.env[PROXY_AUTH_COMMAND_ENV]
      else process.env[PROXY_AUTH_COMMAND_ENV] = prevCmd
      if (prevFile === undefined) delete process.env[PROXY_AUTH_FILE_ENV]
      else process.env[PROXY_AUTH_FILE_ENV] = prevFile
    }
  })

  test('P1-9 instinctStore: 6 concurrent isolated hosts upserting same instinct lose 0 / 6 updates', async () => {
    const rootDir = makeTempDir('w7-instincts-')
    const base = createInstinct({
      trigger: 'when running concurrent multi-host tests',
      action: 'serialize per-directory instinct upserts',
      confidence: 0.5,
      domain: 'testing',
      source: 'session-observation',
      scope: 'global',
      evidence: ['seed'],
      observationIds: ['obs-seed'],
    })

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        runWithNewHostSession({ id: `w7-instinct-host-${i}` }, async () => {
          await upsertInstinct(
            {
              ...base,
              evidence: [`ev-${i}`],
              observationIds: [`obs-${i}`],
            },
            { rootDir, scope: 'global' },
          )
        }),
      ),
    )

    const stored = await loadInstincts({ rootDir, scope: 'global' })
    expect(stored).toHaveLength(1)
    const merged = stored[0]!
    for (let i = 0; i < 6; i++) {
      expect(merged.evidence).toContain(`ev-${i}`)
      expect(merged.observationIds).toContain(`obs-${i}`)
    }
  })

  test('P1-9 bgWorker: 6 concurrent isolated hosts calling updateRoster lose 0 / 6 workers and preserve caller ALS', async () => {
    const configDir = makeTempDir('w7-roster-')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    try {
      const seenAlsIds: string[] = []
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          runWithNewHostSession({ id: `w7-roster-host-${i}` }, async () => {
            await updateRoster(roster => {
              const alsId = getActiveSessionFromAls()?.id
              if (alsId) seenAlsIds.push(alsId)
              const entry: RosterEntry = {
                pid: 10_000 + i,
                sessionId: `sid-${i}`,
                rendezvousSock: `/tmp/rv-${i}.sock`,
                startedAt: 1000 + i,
                attempt: 1,
                cwd: `/tmp/cwd-${i}`,
                dispatch: {
                  short: `w${i}`,
                  sessionId: `sid-${i}`,
                  intent: 'test',
                  cwd: `/tmp/cwd-${i}`,
                  respawnFlags: [],
                  source: 'cli',
                  createdAt: 1000 + i,
                  launch: { mode: 'prompt', args: [] },
                },
              }
              roster.workers[`worker-${i}`] = entry
              return roster
            })
          }),
        ),
      )

      const roster = await readRoster()
      expect(Object.keys(roster.workers).sort()).toEqual([
        'worker-0',
        'worker-1',
        'worker-2',
        'worker-3',
        'worker-4',
        'worker-5',
      ])
      expect(seenAlsIds.sort()).toEqual([
        'w7-roster-host-0',
        'w7-roster-host-1',
        'w7-roster-host-2',
        'w7-roster-host-3',
        'w7-roster-host-4',
        'w7-roster-host-5',
      ])
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('P1-9 clientDataUrl: 6 concurrent isolated hosts lose 0 / 6 published floor writes AND loadedDocument falls back to default host', async () => {
    const configDir = makeTempDir('w7-clientdata-')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetClientDataUrlStateForTests()
    try {
      // 1. 6 concurrent isolated hosts persisting distinct floor keys
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          runWithNewHostSession({ id: `w7-floor-host-${i}` }, async () => {
            await persistPublishedCatalogFloor(
              `floor-key-${i}`,
              { version: 10 + i, issued_at: `2026-01-0${i + 1}` },
              1_700_000_000_000 + i,
            )
          }),
        ),
      )

      const floorJson = JSON.parse(
        readFileSync(getPublishedCatalogFloorPath(), 'utf8'),
      ) as { sources: Record<string, { version: number }> }
      expect(Object.keys(floorJson.sources).sort()).toEqual([
        'floor-key-0',
        'floor-key-1',
        'floor-key-2',
        'floor-key-3',
        'floor-key-4',
        'floor-key-5',
      ])
      for (let i = 0; i < 6; i++) {
        expect(floorJson.sources[`floor-key-${i}`]?.version).toBe(10 + i)
      }

      // 2. Boot loadedDocument on default host is visible inside isolated hosts
      const bootDoc: ClientDataDocument = {
        version: 42,
        entries: [
          { pattern: /^claude-sonnet/, clientData: { rollout: 'boot-v42' } },
        ],
      }
      setLoadedClientDataDocumentForTests(bootDoc)
      const isoView = runWithNewHostSession({ id: 'w7-cdoc-iso' }, () => ({
        doc: getLoadedClientDataDocument(),
        merged: mergeLoadedClientDataInto(
          { existing: true },
          'claude-sonnet-4-6',
        ),
        status: describeLoadedClientDataStatus('claude-sonnet-4-6'),
        coverOk: coverLoadedClientDataDocument('claude-sonnet-4-6'),
      }))
      expect(isoView.doc).toBe(bootDoc)
      expect(isoView.merged).toEqual({ existing: true, rollout: 'boot-v42' })
      expect(isoView.status).toContain('document v42')
      expect(isoView.coverOk).toBeUndefined()
    } finally {
      resetClientDataUrlStateForTests()
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('P1-9 syncedPluginSyncFs: 6 concurrent isolated hosts pruning same trashRoot coalesce justMoved protections and preserve all 6 protected batches', async () => {
    const trashRoot = makeTempDir('w7-trash-')
    // Use timestamps > 7 days old so survival depends strictly on coalesced justMoved protection
    const oldMs = Date.now() - 14 * 24 * 60 * 60 * 1000
    const oldDate = new Date(oldMs)

    const overflowNames: string[] = []
    for (let i = 0; i < 10; i++) {
      const hash = i.toString(16).padStart(32, 'a')
      const name = `${oldMs - (i + 1) * 1000}-1234-${hash}-old${i}`
      const dir = join(trashRoot, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'marker.txt'), 'old')
      utimesSync(dir, oldDate, oldDate)
      overflowNames.push(name)
    }

    const protectedNames: string[] = []
    for (let i = 0; i < 6; i++) {
      const hash = i.toString(16).padStart(32, 'b')
      const name = `${oldMs + (i + 1) * 1000}-1234-${hash}-keep${i}`
      const dir = join(trashRoot, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'marker.txt'), 'keep')
      utimesSync(dir, oldDate, oldDate)
      protectedNames.push(name)
    }

    const outcomes = await Promise.all(
      protectedNames.map((batchName, i) =>
        runWithNewHostSession({ id: `w7-trash-host-${i}` }, () =>
          pruneSyncedTrash(trashRoot, batchName, 6),
        ),
      ),
    )

    for (const o of outcomes) {
      expect(o.errors).toBe(0)
    }
    for (const keep of protectedNames) {
      expect(existsSync(join(trashRoot, keep))).toBe(true)
    }
    for (const old of overflowNames) {
      expect(existsSync(join(trashRoot, old))).toBe(false)
    }
  })

  test('P1-9 syncedPluginCloudSync: concurrent isolated hosts serialize syncCloudSyncedPlugins() per staging dir without overlapping', async () => {
    const configDir = makeTempDir('w7-sync-staging-')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const prevSyncRefs = process.env.CLAUDE_CODE_SYNC_SESSION_REFS
    const prevSessionId = process.env.CLAUDE_CODE_SESSION_ID
    const prevSyncPlugins = process.env.CLAUDE_CODE_SYNC_PLUGINS
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_SYNC_SESSION_REFS = '1'
    process.env.CLAUDE_CODE_SESSION_ID = 'session_w7_staging_test'
    process.env.CLAUDE_CODE_SYNC_PLUGINS = '0'

    const events: string[] = []
    try {
      await Promise.all([
        runWithNewHostSession({ id: 'w7-sync-a' }, async () => {
          resetSessionRefsStoreForTests()
          const store = getSessionRefsStore()
          store.listEntries = async () => {
            events.push(`A:start:${getActiveSessionFromAls()?.id}`)
            await new Promise(resolve => setTimeout(resolve, 40))
            events.push(`A:end:${getActiveSessionFromAls()?.id}`)
            return { success: true, entries: [] }
          }
          await syncCloudSyncedPlugins()
          resetSessionRefsStoreForTests()
        }),
        runWithNewHostSession({ id: 'w7-sync-b' }, async () => {
          resetSessionRefsStoreForTests()
          const store = getSessionRefsStore()
          store.listEntries = async () => {
            events.push(`B:start:${getActiveSessionFromAls()?.id}`)
            await new Promise(resolve => setTimeout(resolve, 10))
            events.push(`B:end:${getActiveSessionFromAls()?.id}`)
            return { success: true, entries: [] }
          }
          await syncCloudSyncedPlugins()
          resetSessionRefsStoreForTests()
        }),
      ])

      // Strict non-interleaved execution: A finishes before B enters staging lock
      expect(events).toEqual([
        'A:start:w7-sync-a',
        'A:end:w7-sync-a',
        'B:start:w7-sync-b',
        'B:end:w7-sync-b',
      ])
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      if (prevSyncRefs === undefined)
        delete process.env.CLAUDE_CODE_SYNC_SESSION_REFS
      else process.env.CLAUDE_CODE_SYNC_SESSION_REFS = prevSyncRefs
      if (prevSessionId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
      else process.env.CLAUDE_CODE_SESSION_ID = prevSessionId
      if (prevSyncPlugins === undefined)
        delete process.env.CLAUDE_CODE_SYNC_PLUGINS
      else process.env.CLAUDE_CODE_SYNC_PLUGINS = prevSyncPlugins
    }
  })

  test('P1-10 computerUse win32: per-host registerCleanup tears down Host A procs while process-wide stopAll/hideAll cleans up Host B procs & temp scripts', async () => {
    const spawned: Array<{
      cmd: string[]
      killed: boolean
    }> = []

    const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(((
      command: string,
      args?: readonly string[],
    ) => {
      const entry = {
        cmd: [command, ...(args ?? [])],
        killed: false,
      }
      spawned.push(entry)
      const proc = new EventEmitter() as childProcess.ChildProcess
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      stdout.end()
      stderr.end()
      Object.assign(proc, {
        stdin,
        stdout,
        stderr,
        pid: 10000 + spawned.length,
        killed: false,
        kill() {
          entry.killed = true
          ;(proc as { killed: boolean }).killed = true
          proc.emit('exit', 0, null)
          return true
        },
      })
      return proc
    }) as typeof childProcess.spawn)

    try {
      await runWithNewHostSession({ id: 'w7-win32-a' }, async () => {
        expect(ensureBridge()).toBe(true)
        expect(showIndicator('12345')).toBe(true)
        expect(showVirtualCursor('12345')).toBe(true)
        expect(isVirtualCursorActive()).toBe(true)

        await runWithNewHostSession({ id: 'w7-win32-b' }, async () => {
          expect(ensureBridge()).toBe(true)
          expect(showIndicator('67890')).toBe(true)
          expect(showVirtualCursor('67890')).toBe(true)
          expect(isVirtualCursorActive()).toBe(true)
        })

        expect(spawned).toHaveLength(6)
        // Host A teardown kills ONLY Host A's 3 subprocesses
        await runCleanupFunctions()
        expect(isVirtualCursorActive()).toBe(false)
        expect(spawned.slice(0, 3).every(p => p.killed)).toBe(true)
        expect(spawned.slice(3, 6).every(p => !p.killed)).toBe(true)
      })

      // Outside ALS (simulating process exit -> cleanupAll()), stopAll/hideAll kills Host B's 3 subprocesses!
      stopAllBridges()
      hideAllIndicators()
      hideAllVirtualCursors()
      expect(spawned.slice(3, 6).every(p => p.killed)).toBe(true)
    } finally {
      stopBridge()
      stopAllBridges()
      hideAllIndicators()
      hideAllVirtualCursors()
      spawnSpy.mockRestore()
    }
  })

  test('P1-11 RemoteAgentTask + autofix-pr: module-load autofix-pr checker, hook, and extractor are visible in isolated hosts', async () => {
    // Even if imported inside an isolated ALS session, launchAutofixPr wraps its
    // registrations in exitSessionContext() so boot-default registries are populated.
    await runWithNewHostSession({ id: 'w7-autofix-loader' }, async () => {
      await import('../../commands/autofix-pr/launchAutofixPr.js')
    })

    const resA = runWithNewHostSession({ id: 'w7-autofix-iso-a' }, () => {
      const handlers = getRegisteredRemoteTaskHandlersForTests('autofix-pr')
      const extracted = handlers.contentExtractor?.([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: '<autofix-result><pr-number>42</pr-number><ci-status>green</ci-status><summary>Fixed lint</summary></autofix-result>',
              },
            ],
          },
        } as never,
      ])

      const ac = new AbortController()
      trySetActiveMonitor({
        taskId: 'autofix-task-a',
        owner: 'acme',
        repo: 'demo',
        prNumber: 42,
        abortController: ac,
        startedAt: Date.now(),
      })
      const hadMonitorBefore = getActiveMonitor()?.taskId === 'autofix-task-a'
      handlers.completionHook?.('autofix-task-a', {
        owner: 'acme',
        repo: 'demo',
        prNumber: 42,
      })
      const clearedMonitorAfter = getActiveMonitor() === null

      // Per-host override stays local to Host A
      registerContentExtractor('autofix-pr', () => '<custom-host-a/>')
      const customExtracted = getRegisteredRemoteTaskHandlersForTests(
        'autofix-pr',
      ).contentExtractor?.([])

      return {
        hasChecker: typeof handlers.completionChecker === 'function',
        hasHook: typeof handlers.completionHook === 'function',
        hasExtractor: typeof handlers.contentExtractor === 'function',
        extracted,
        hadMonitorBefore,
        clearedMonitorAfter,
        customExtracted,
      }
    })

    const resB = runWithNewHostSession({ id: 'w7-autofix-iso-b' }, () => {
      clearActiveMonitor()
      const handlers = getRegisteredRemoteTaskHandlersForTests('autofix-pr')
      return {
        hasChecker: typeof handlers.completionChecker === 'function',
        extractedEmpty: handlers.contentExtractor?.([]) ?? null,
      }
    })

    expect(resA.hasChecker).toBe(true)
    expect(resA.hasHook).toBe(true)
    expect(resA.hasExtractor).toBe(true)
    expect(resA.extracted).toContain('<autofix-result>')
    expect(resA.extracted).toContain('Fixed lint')
    expect(resA.hadMonitorBefore).toBe(true)
    expect(resA.clearedMonitorAfter).toBe(true)
    expect(resA.customExtracted).toBe('<custom-host-a/>')

    expect(resB.hasChecker).toBe(true)
    expect(resB.extractedEmpty).toBeNull()
  })

  test('P2-12 computerUse drainRunLoop & escHotkey: process-global pump refcount and escape hotkey handle nested hosts cleanly', () => {
    runWithNewHostSession({ id: 'w7-cu-a' }, () => {
      retainPump()
      runWithNewHostSession({ id: 'w7-cu-b' }, () => {
        retainPump()
        notifyExpectedEscape()
        unregisterEscHotkey()
        releasePump()
      })
      releasePump()
      // Extra releasePump when pending is 0 is an underflow-safe no-op
      releasePump()
    })
  })

  test('P2-13 workflow/service & bundled/init: host teardown calls service.shutdown(), shutdownAllWorkflowServices() cleans surviving hosts, and bundled init is process-global', async () => {
    __resetBundledWorkflowsInitForTests()
    let shutdownACount = 0
    let shutdownBCount = 0

    await runWithNewHostSession({ id: 'w7-wf-svc-a' }, async () => {
      initBundledWorkflows()
      const svcA = getWorkflowService()
      const origA = svcA.shutdown.bind(svcA)
      svcA.shutdown = () => {
        shutdownACount++
        origA()
      }

      await runWithNewHostSession({ id: 'w7-wf-svc-b' }, async () => {
        initBundledWorkflows()
        const svcB = getWorkflowService()
        const origB = svcB.shutdown.bind(svcB)
        svcB.shutdown = () => {
          shutdownBCount++
          origB()
        }
        expect(peekWorkflowService()).toBe(svcB)
      })

      // Host A cleanup shuts down ONLY Host A's workflow service
      await runCleanupFunctions()
      expect(shutdownACount).toBe(1)
      expect(shutdownBCount).toBe(0)
      expect(peekWorkflowService()).toBeNull()
    })

    // Process exit hook helper shuts down remaining live Host B workflow service
    shutdownAllWorkflowServices()
    expect(shutdownBCount).toBe(1)
  })

  test('P2-14 observerBackend: lazy registerDefaultObserverBackend() inside ALS still seeds bootDefaultRegistry for all subsequent hosts', () => {
    try {
      // Simulate lazy registration occurring for the first time inside an isolated ALS host
      const hostABackends = runWithNewHostSession(
        { id: 'w7-obs-lazy-a' },
        () => {
          registerDefaultObserverBackend({
            name: 'w7-lazy-default',
            analyze: () => [],
          })
          return listObserverBackends()
        },
      )
      expect(hostABackends).toContain('w7-lazy-default')

      // Subsequent fresh isolated host inherits the lazily-registered default backend
      const hostBBackends = runWithNewHostSession({ id: 'w7-obs-lazy-b' }, () =>
        listObserverBackends(),
      )
      expect(hostBBackends).toContain('w7-lazy-default')
      expect(hostBBackends).toContain('heuristic')
      expect(hostBBackends).toContain('llm')
    } finally {
      // Restore clean default observer backends (heuristic + llm)
      resetObserverBackendsForTest()
      registerDefaultObserverBackend(heuristicObserverBackend)
      registerDefaultObserverBackend(llmObserverBackend)
    }
  })

  test('P2-15 mdm/rawRead: boot startMdmRawRead() on default host is visible inside isolated hosts via getMdmRawReadPromise()', () => {
    startMdmRawRead()
    const bootPromise = getMdmRawReadPromise()
    expect(bootPromise).not.toBeNull()

    const isoPromise = runWithNewHostSession({ id: 'w7-mdm-iso' }, () =>
      getMdmRawReadPromise(),
    )
    expect(isoPromise).toBe(bootPromise)
  })
})
