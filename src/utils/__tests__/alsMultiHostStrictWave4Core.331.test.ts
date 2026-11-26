import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { randomUUID, type UUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import { runAgent } from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  getOriginalCwd,
  getParentSessionId,
  getPlanSlugCache,
  getSdkBetas,
  getSessionId,
  onSessionSwitch,
  resetStateForTests,
  setSdkBetas,
  switchSession,
  type SessionSwitchReason,
} from '../../bootstrap/state.js'
import { QueryEngine } from '../../QueryEngine.js'
import { AcpAgent } from '../../services/acp/agent.js'
import {
  confirmModelMaxTokensCeiling,
  getCachedModelMaxTokensCeiling,
  getDefaultMaxRetries,
} from '../../services/api/withRetry.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import {
  enqueueShellNotification,
  spawnShellTask,
} from '../../tasks/LocalShellTask/LocalShellTask.js'
import type { SessionId } from '../../types/ids.js'
import type { UserMessage } from '../../types/message.js'
import {
  cleanupDrainStarted,
  registerCleanup,
  registerPreExitFlush,
  runCleanupFunctions,
  runPreExitFlush,
} from '../cleanupRegistry.js'
import {
  getCwd,
  getCwdVersion,
  pinScopedCallCwd,
  runWithCwd,
  setCwd,
  unpinScopedCallCwd,
  withScopedCallCwd,
} from '../cwd.js'
import '../effortThinkingGuard.js'
import { createFileStateCacheWithSizeLimit } from '../fileStateCache.js'
import {
  getPendingAsyncHooks,
  registerPendingAsyncHook,
} from '../hooks/AsyncHookRegistry.js'
import {
  captureHooksConfigSnapshot,
  getHooksConfigFromSnapshot,
} from '../hooks/hooksConfigSnapshot.js'
import {
  clearCommandQueue,
  createQueueRecordWriter,
  getCommandQueueSnapshot,
  setQueueRecordHookRunner,
} from '../messageQueueManager.js'
import { createUserMessage } from '../messages.js'
import { getPlanSlug, setPlanSlug } from '../plans.js'
import { createSessionHost } from '../sessionHost.js'
import {
  createRootSession,
  getActiveSubconversationFromAls,
  getBootstrapSession,
  getSessionAlsStore,
  getSessionOnceLatches,
  hasActiveSessionAls,
  registerSessionContextReader,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
} from '../sessionRoot.js'
import {
  cacheSessionTitle,
  flushAllLiveHostStorageStatesAtExit,
  flushSessionStorageAtExit,
  getProject,
  getTranscriptPath,
  recordTranscript,
  registerSessionExitDrain,
  resetProjectForTesting,
  syncExitReStamp,
} from '../sessionStorage.js'
import type { ShellCommand } from '../ShellCommand.js'
import { createTaskRegistry } from '../taskRegistry.js'
import {
  getTranscriptWriterDegraded,
  recordTranscriptWriteFailure,
  recordTranscriptWriteSuccess,
  resetTranscriptWriterHealthForTest,
  subscribeTranscriptWriterHealth,
} from '../transcriptWriterHealth.js'

// Ensure MACRO.VERSION is defined in standalone test runs.
;(globalThis as unknown as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '0.0.0-test',
}

// Top-level synchronous registrations:
// 1. Default scope ('session') binds ONLY to default session (zero cross-host leak).
// 2. Explicit { scope: 'global' } fires for EVERY switching ALS session.
let captureTopLevel = false
const topLevelDefaultEvents: Array<{
  id: string
  reason?: SessionSwitchReason
}> = []
const topLevelGlobalEvents: Array<{
  id: string
  reason?: SessionSwitchReason
  alsActive: boolean
  activeSessionId: string
}> = []

onSessionSwitch((id, reason) => {
  if (!captureTopLevel) return
  topLevelDefaultEvents.push({ id: String(id), reason })
})

onSessionSwitch(
  (id, reason) => {
    if (!captureTopLevel) return
    topLevelGlobalEvents.push({
      id: String(id),
      reason,
      alsActive: hasActiveSessionAls(),
      activeSessionId: String(getSessionId()),
    })
  },
  { scope: 'global' },
)

const makeConn = (): AgentSideConnection =>
  ({
    sessionUpdate: mock(async () => {}),
    requestPermission: mock(async () => ({
      outcome: { outcome: 'cancelled' as const },
    })),
  }) as unknown as AgentSideConnection

function makeUserMessage(text: string): UserMessage {
  return createUserMessage({
    content: text,
    uuid: randomUUID(),
  })
}

function makeDeferredShellCommand(taskId: string) {
  let resolveExit!: (result: {
    code: number
    interrupted: boolean
    stdout?: string
    stderr?: string
  }) => void
  const result = new Promise<{
    code: number
    interrupted: boolean
    stdout?: string
    stderr?: string
  }>(resolve => {
    resolveExit = resolve
  })
  let status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running'
  const shellCommand = {
    get status() {
      return status
    },
    taskOutput: {
      taskId,
      flush: async () => {},
    },
    result,
    outputEnded: Promise.resolve(),
    background: () => {
      if (status === 'completed' || status === 'killed') return false
      status = 'backgrounded'
      return true
    },
    kill: () => {
      status = 'killed'
    },
    cleanup: () => {},
  } as unknown as ShellCommand
  return { shellCommand, resolveExit }
}

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = prev
  }
}

describe('Wave 4 Strict Core ALS Multi-Host Fixes', () => {
  const tempDirs: string[] = []
  const activeSpies: Array<{ mockRestore(): void }> = []
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  const savedPersistence = process.env.TEST_ENABLE_SESSION_PERSISTENCE
  const savedCustomHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS
  const savedMaxRetries = process.env.CLAUDE_CODE_MAX_RETRIES
  const savedRetryWatchdog = process.env.CLAUDE_CODE_RETRY_WATCHDOG

  function makeTempDir(prefix: string): string {
    const raw = mkdtempSync(join(tmpdir(), prefix))
    const canonical = realpathSync(raw).normalize('NFC')
    tempDirs.push(canonical)
    return canonical
  }

  beforeEach(() => {
    captureTopLevel = false
    topLevelDefaultEvents.length = 0
    topLevelGlobalEvents.length = 0
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetProjectForTesting()
    resetTranscriptWriterHealthForTest()
    clearCommandQueue()
  })

  afterEach(() => {
    captureTopLevel = false
    topLevelDefaultEvents.length = 0
    topLevelGlobalEvents.length = 0
    for (let i = activeSpies.length - 1; i >= 0; i--) {
      activeSpies[i]?.mockRestore()
    }
    activeSpies.length = 0
    restoreEnv('CLAUDE_CONFIG_DIR', savedConfigDir)
    restoreEnv('TEST_ENABLE_SESSION_PERSISTENCE', savedPersistence)
    restoreEnv('ANTHROPIC_CUSTOM_HEADERS', savedCustomHeaders)
    restoreEnv('CLAUDE_CODE_MAX_RETRIES', savedMaxRetries)
    restoreEnv('CLAUDE_CODE_RETRY_WATCHDOG', savedRetryWatchdog)
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetProjectForTesting()
    resetTranscriptWriterHealthForTest()
    clearCommandQueue()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  describe('1. onSessionSwitch explicit scope, state.ts subconversation & switchSession semantics, and withRetry HostSlot', () => {
    test('default scope binds strictly per-session even at module top-level, while { scope: "global" } fires in every switching ALS host', () => {
      captureTopLevel = true

      // Mark latches and model ceilings on default host to confirm isolated host switches never touch default host.
      getSessionOnceLatches().markFired('stream_no_events_fallback_warning')
      confirmModelMaxTokensCeiling('claude-sonnet-4-6', 8192)

      const defaultRuntimeEvents: string[] = []
      const unsubDefault = onSessionSwitch(id => {
        defaultRuntimeEvents.push(String(id))
      })

      try {
        runWithNewHostSession({ id: 'iso-host-1', cwd: '/tmp/iso1' }, () => {
          const isoLatches = getSessionOnceLatches()
          isoLatches.markFired('stream_no_events_fallback_warning')
          confirmModelMaxTokensCeiling('claude-sonnet-4-6', 4096)

          const isoSessionEvents: Array<{
            id: string
            reason?: SessionSwitchReason
          }> = []
          const unsubIso = onSessionSwitch((id, reason) => {
            isoSessionEvents.push({ id: String(id), reason })
          })

          try {
            const nextId = 'iso-host-1-next' as SessionId
            switchSession(nextId, null, 'resume')

            // Global subscriber + effortThinkingGuard + withRetry fired inside isolated ALS!
            expect(
              isoLatches.hasFired('stream_no_events_fallback_warning'),
            ).toBe(false)
            expect(
              getCachedModelMaxTokensCeiling('claude-sonnet-4-6'),
            ).toBeUndefined()
            expect(isoSessionEvents).toEqual([
              { id: 'iso-host-1-next', reason: 'resume' },
            ])
            expect(topLevelGlobalEvents).toEqual([
              {
                id: 'iso-host-1-next',
                reason: 'resume',
                alsActive: true,
                activeSessionId: 'iso-host-1-next',
              },
            ])
            // Top-level default-scope subscriber and runtime default subscriber NEVER leaked!
            expect(topLevelDefaultEvents).toEqual([])
            expect(defaultRuntimeEvents).toEqual([])
          } finally {
            unsubIso()
          }
        })

        // Default host latch & ceiling remained completely untouched!
        expect(
          getSessionOnceLatches().hasFired('stream_no_events_fallback_warning'),
        ).toBe(true)
        expect(getCachedModelMaxTokensCeiling('claude-sonnet-4-6')).toBe(8192)
      } finally {
        unsubDefault()
      }
    })

    test('getParentSessionId preserves root parentId under partial subconversation and setSdkBetas updates subconversation overlay', () => {
      runWithNewHostSession(
        { id: 'root-s', parentId: 'root-parent-s', cwd: '/tmp/root' },
        () => {
          setSdkBetas(['root-beta'])

          // Partial subconversation without parentSessionId / sdkBetas inherits root values
          runWithSubconversationContext({ originalCwd: '/tmp/partial' }, () => {
            expect(getParentSessionId()).toBe('root-parent-s' as SessionId)
            expect(getSdkBetas()).toEqual(['root-beta'])
          })

          // Explicit subconversation with sdkBetas updates overlay without mutating root
          runWithSubconversationContext(
            {
              sessionId: 'sub-s',
              parentSessionId: 'sub-parent',
              sdkBetas: ['sub-initial'],
            },
            () => {
              expect(getParentSessionId()).toBe('sub-parent' as SessionId)
              expect(getSdkBetas()).toEqual(['sub-initial'])
              setSdkBetas(['sub-updated-1', 'sub-updated-2'])
              expect(getSdkBetas()).toEqual(['sub-updated-1', 'sub-updated-2'])
              setSdkBetas(undefined)
              expect(getSdkBetas()).toBeUndefined()
            },
          )

          // Root session betas stayed intact
          expect(getParentSessionId()).toBe('root-parent-s' as SessionId)
          expect(getSdkBetas()).toEqual(['root-beta'])
        },
      )
    })

    test('switchSession(sameId) skips signal when reason is undefined, emits on explicit reason, and only forgets plan slug on clear or ID change', () => {
      runWithNewHostSession({ id: 'plan-sess', cwd: '/tmp/plan' }, () => {
        const sid = getSessionId()
        setPlanSlug(sid, 'vivid-slug')

        const events: Array<{ id: string; reason?: SessionSwitchReason }> = []
        const unsub = onSessionSwitch((id, reason) => {
          events.push({ id: String(id), reason })
        })

        try {
          // Same ID + undefined reason: no-op for slug and signal
          switchSession(sid, '/tmp/dir-1')
          expect(getPlanSlug()).toBe('vivid-slug')
          expect(events).toEqual([])

          // Same ID + explicit 'cd' reason: emits signal while keeping plan slug
          switchSession(sid, '/tmp/dir-2', 'cd')
          expect(getPlanSlug()).toBe('vivid-slug')
          expect(events).toEqual([{ id: String(sid), reason: 'cd' }])

          // Same ID + explicit 'hydrate' reason: emits signal while keeping plan slug
          switchSession(sid, '/tmp/dir-3', 'hydrate')
          expect(getPlanSlug()).toBe('vivid-slug')
          expect(events).toEqual([
            { id: String(sid), reason: 'cd' },
            { id: String(sid), reason: 'hydrate' },
          ])

          // Same ID + explicit 'clear' reason: forgets plan slug AND emits signal
          switchSession(sid, null, 'clear')
          expect(getPlanSlugCache().has(sid)).toBe(false)
          expect(events).toEqual([
            { id: String(sid), reason: 'cd' },
            { id: String(sid), reason: 'hydrate' },
            { id: String(sid), reason: 'clear' },
          ])
        } finally {
          unsub()
        }
      })
    })

    test('withRetry maxRetriesClampWarned is isolated per SessionHost', () => {
      process.env.CLAUDE_CODE_MAX_RETRIES = '50'
      delete process.env.CLAUDE_CODE_RETRY_WATCHDOG

      // Host A clamps and marks its own host slot warned
      const maxA = runWithNewHostSession({ cwd: '/tmp/retry-a' }, () => {
        expect(getDefaultMaxRetries()).toBe(15)
        return getDefaultMaxRetries()
      })
      // Host B independently clamps using its own HostSlot
      const maxB = runWithNewHostSession({ cwd: '/tmp/retry-b' }, () =>
        getDefaultMaxRetries(),
      )
      expect(maxA).toBe(15)
      expect(maxB).toBe(15)
    })
  })

  describe('2. cleanupRegistry per-host ALS drain vs out-of-ALS all-live-hosts drain', () => {
    test('drains only active host inside ALS and drains all remaining live hosts in their own Session ALS outside ALS', async () => {
      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'cleanup-host-a',
        project: {
          originalCwd: '/tmp/cleanup-a',
          projectRoot: '/tmp/cleanup-a',
          cwd: '/tmp/cleanup-a',
        },
      })
      const hostB = createSessionHost()
      const sessionB = createRootSession({
        host: hostB,
        id: 'cleanup-host-b',
        project: {
          originalCwd: '/tmp/cleanup-b',
          projectRoot: '/tmp/cleanup-b',
          cwd: '/tmp/cleanup-b',
        },
      })

      const drainedLog: Array<{
        label: string
        sessionId: string
        origCwd: string
        alsActive: boolean
      }> = []

      runWithSession(sessionA, () => {
        registerCleanup(() => {
          drainedLog.push({
            label: 'hostA',
            sessionId: String(getSessionId()),
            origCwd: getOriginalCwd(),
            alsActive: hasActiveSessionAls(),
          })
        })
      })

      runWithSession(sessionB, () => {
        // Also test via a withProject fork — sessionRef must store sessionB.root!
        const forkB = sessionB.withProject({ cwd: '/tmp/cleanup-b/sub' })
        runWithSession(forkB, () => {
          registerCleanup(() => {
            drainedLog.push({
              label: 'hostB',
              sessionId: String(getSessionId()),
              origCwd: getOriginalCwd(),
              alsActive: hasActiveSessionAls(),
            })
          })
        })
        registerPreExitFlush(() => {
          drainedLog.push({
            label: 'preExitB',
            sessionId: String(getSessionId()),
            origCwd: getOriginalCwd(),
            alsActive: hasActiveSessionAls(),
          })
        })
      })

      // 1) Inside Host A's ALS: drains ONLY Host A; Host B remains untouched!
      await runWithSession(sessionA, async () => {
        await runCleanupFunctions()
        expect(cleanupDrainStarted()).toBe(true)
      })
      expect(drainedLog).toEqual([
        {
          label: 'hostA',
          sessionId: 'cleanup-host-a',
          origCwd: '/tmp/cleanup-a',
          alsActive: true,
        },
      ])
      runWithSession(sessionB, () => {
        expect(cleanupDrainStarted()).toBe(false)
      })

      // 2) Outside ALS (process shutdown): drains Host B inside sessionB.root ALS!
      expect(hasActiveSessionAls()).toBe(false)
      await runCleanupFunctions()
      await runPreExitFlush()

      expect(drainedLog).toEqual([
        {
          label: 'hostA',
          sessionId: 'cleanup-host-a',
          origCwd: '/tmp/cleanup-a',
          alsActive: true,
        },
        {
          label: 'hostB',
          sessionId: 'cleanup-host-b',
          origCwd: '/tmp/cleanup-b',
          alsActive: true,
        },
        {
          label: 'preExitB',
          sessionId: 'cleanup-host-b',
          origCwd: '/tmp/cleanup-b',
          alsActive: true,
        },
      ])
    })

    test('prunes WeakRef entries without retaining dropped isolated SessionHosts', () => {
      const refs: Array<WeakRef<object>> = []
      for (let i = 0; i < 70; i++) {
        const host = createSessionHost()
        refs.push(new WeakRef(host))
        const session = createRootSession({
          host,
          id: `ephemeral-cleanup-${i}`,
          project: {
            originalCwd: '/tmp/eph',
            projectRoot: '/tmp/eph',
            cwd: '/tmp/eph',
          },
        })
        runWithSession(session, () => {
          const unreg = registerCleanup(() => {})
          unreg()
        })
      }
      Bun.gc(true)
      const collected = refs.filter(r => r.deref() === undefined).length
      expect(collected).toBeGreaterThan(0)
    })
  })

  describe('3. sessionStorage exit flush inside ALS, withProject fork GC safety, transcriptWriterHealth & messageQueueManager', () => {
    test('syncExitReStamp and flushAllLiveHostStorageStatesAtExit drain ALL live hosts even when triggered inside another host ALS', async () => {
      const configDir = makeTempDir('w4-storage-cfg-')
      const dirA = makeTempDir('w4-storage-a-')
      const dirB = makeTempDir('w4-storage-b-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: randomUUID(),
        project: { originalCwd: dirA, projectRoot: dirA, cwd: dirA },
      })
      const hostB = createSessionHost()
      const sessionB = createRootSession({
        host: hostB,
        id: randomUUID(),
        project: { originalCwd: dirB, projectRoot: dirB, cwd: dirB },
      })

      let pathA = ''
      let pathB = ''
      let drainA = 0
      let drainB = 0

      await runWithSession(sessionA, async () => {
        registerSessionExitDrain(() => {
          drainA++
        })
        await recordTranscript([makeUserMessage('turn on A')])
        cacheSessionTitle('Title-Host-A')
        await getProject().appendEntry({
          type: 'tag',
          tag: 'pending-tag-A',
          sessionId: getSessionId() as UUID,
        })
        pathA = getTranscriptPath()
      })

      await runWithSession(sessionB, async () => {
        registerSessionExitDrain(() => {
          drainB++
        })
        await recordTranscript([makeUserMessage('turn on B')])
        cacheSessionTitle('Title-Host-B')
        await getProject().appendEntry({
          type: 'tag',
          tag: 'pending-tag-B',
          sessionId: getSessionId() as UUID,
        })
        pathB = getTranscriptPath()
      })

      // Trigger flushAllLiveHostStorageStatesAtExit WHILE INSIDE sessionA's ALS!
      await runWithSession(sessionA, async () => {
        expect(hasActiveSessionAls()).toBe(true)
        await flushAllLiveHostStorageStatesAtExit()
      })

      expect(drainA).toBe(1)
      expect(drainB).toBe(1)
      expect(existsSync(pathA)).toBe(true)
      expect(existsSync(pathB)).toBe(true)
      expect(readFileSync(pathA, 'utf8')).toContain('pending-tag-A')
      expect(readFileSync(pathA, 'utf8')).toContain('Title-Host-A')
      expect(readFileSync(pathB, 'utf8')).toContain('pending-tag-B')
      expect(readFileSync(pathB, 'utf8')).toContain('Title-Host-B')

      // Now test syncExitReStamp inside sessionA's ALS flushing new queued writes on BOTH hosts!
      await runWithSession(sessionA, async () => {
        resetProjectForTesting()
        await recordTranscript([makeUserMessage('sync turn A')])
        await getProject().appendEntry({
          type: 'tag',
          tag: 'sync-tag-A',
          sessionId: getSessionId() as UUID,
        })
      })
      await runWithSession(sessionB, async () => {
        resetProjectForTesting()
        await recordTranscript([makeUserMessage('sync turn B')])
        await getProject().appendEntry({
          type: 'tag',
          tag: 'sync-tag-B',
          sessionId: getSessionId() as UUID,
        })
      })

      runWithSession(sessionA, () => {
        syncExitReStamp()
      })
      expect(readFileSync(pathA, 'utf8')).toContain('sync-tag-A')
      expect(readFileSync(pathB, 'utf8')).toContain('sync-tag-B')
    })

    test('withProject fork GC never clobbers HostSessionStorageState.sessionRef (stores session.root)', async () => {
      const configDir = makeTempDir('w4-forkref-cfg-')
      const dirRoot = makeTempDir('w4-forkref-root-')
      const dirFork = makeTempDir('w4-forkref-sub-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

      const rootId = randomUUID()
      const host = createSessionHost()
      const rootSession = createRootSession({
        host,
        id: rootId,
        project: {
          originalCwd: dirRoot,
          projectRoot: dirRoot,
          cwd: dirRoot,
        },
      })

      let transcriptPath = ''
      let observedDrainSessionId = ''

      await (async () => {
        const ephemeralFork = rootSession.withProject({
          originalCwd: dirFork,
          cwd: dirFork,
        })
        await runWithSession(ephemeralFork, async () => {
          registerSessionExitDrain(() => {
            observedDrainSessionId = String(getSessionId())
          })
          await recordTranscript([makeUserMessage('written via fork')])
          cacheSessionTitle('Root-Title-After-Fork-GC')
          transcriptPath = getTranscriptPath()
        })
      })()

      // Force GC to collect ephemeralFork while rootSession stays alive
      Bun.gc(true)

      expect(hasActiveSessionAls()).toBe(false)
      await flushSessionStorageAtExit()

      expect(observedDrainSessionId).toBe(rootId)
      const content = readFileSync(transcriptPath, 'utf8')
      expect(content).toContain('Root-Title-After-Fork-GC')
      expect(content).toContain(rootId)
      expect(content).not.toContain(String(getBootstrapSession().id))
    })

    test('GC of owning root Session never stamps defaultBootstrapSession.id into isolated host JSONL during exit flush', async () => {
      const configDir = makeTempDir('w4-rootgc-cfg-')
      const dirIso = makeTempDir('w4-rootgc-iso-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

      const defaultId = String(getBootstrapSession().id)
      // Keep host strongly alive so HostSessionStorageState stays in liveHostStorageStates
      // while the owning root Session is dropped and GC'd.
      const survivingHost = createSessionHost()
      let transcriptPath = ''
      let drainFired = false

      await (async () => {
        const tempRoot = createRootSession({
          host: survivingHost,
          id: randomUUID(),
          project: {
            originalCwd: dirIso,
            projectRoot: dirIso,
            cwd: dirIso,
          },
        })
        await runWithSession(tempRoot, async () => {
          registerSessionExitDrain(() => {
            drainFired = true
          })
          await recordTranscript([makeUserMessage('written before root GC')])
          cacheSessionTitle('Title-Before-Root-GC')
          await getProject().appendEntry({
            type: 'tag',
            tag: 'queued-before-root-gc',
            sessionId: tempRoot.id as UUID,
          })
          transcriptPath = getTranscriptPath()
        })
      })()

      Bun.gc(true)
      expect(hasActiveSessionAls()).toBe(false)
      await flushAllLiveHostStorageStatesAtExit()

      expect(drainFired).toBe(true)
      expect(existsSync(transcriptPath)).toBe(true)
      const content = readFileSync(transcriptPath, 'utf8')
      expect(content).toContain('queued-before-root-gc')
      expect(content).not.toContain(defaultId)
      // Keep survivingHost referenced until assertions finish
      expect(survivingHost).toBeDefined()
    })

    test('transcriptWriterHealth isolates degraded state, failure stamps, and listeners per SessionHost', () => {
      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'health-a',
        project: {
          originalCwd: '/tmp/ha',
          projectRoot: '/tmp/ha',
          cwd: '/tmp/ha',
        },
      })
      const hostB = createSessionHost()
      const sessionB = createRootSession({
        host: hostB,
        id: 'health-b',
        project: {
          originalCwd: '/tmp/hb',
          projectRoot: '/tmp/hb',
          cwd: '/tmp/hb',
        },
      })

      let notifA = 0
      let notifB = 0
      const unsubA = runWithSession(sessionA, () =>
        subscribeTranscriptWriterHealth(() => {
          notifA++
        }),
      )
      const unsubB = runWithSession(sessionB, () =>
        subscribeTranscriptWriterHealth(() => {
          notifB++
        }),
      )

      try {
        runWithSession(sessionA, () => {
          recordTranscriptWriteFailure(
            'drain',
            Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
            '/tmp/ha/s.jsonl',
          )
          expect(getTranscriptWriterDegraded()).toEqual({
            code: 'ENOSPC',
            source: 'drain',
            filePath: '/tmp/ha/s.jsonl',
          })
        })

        // Host B and default host are completely unaffected!
        expect(getTranscriptWriterDegraded()).toBeNull()
        runWithSession(sessionB, () => {
          expect(getTranscriptWriterDegraded()).toBeNull()
        })
        expect(notifA).toBe(1)
        expect(notifB).toBe(0)

        runWithSession(sessionA, () => {
          recordTranscriptWriteSuccess('/tmp/ha/s.jsonl')
          expect(getTranscriptWriterDegraded()).toBeNull()
        })
        expect(notifA).toBe(2)
        expect(notifB).toBe(0)
      } finally {
        unsubA()
        unsubB()
      }
    })

    test('messageQueueManager queue record writer cleanup runs inside its own root Session ALS on out-of-ALS shutdown', async () => {
      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'queue-cleanup-host-a',
        project: {
          originalCwd: '/tmp/qa',
          projectRoot: '/tmp/qa',
          cwd: '/tmp/qa',
        },
      })

      const writtenInSessions: string[] = []
      let writer!: ReturnType<typeof createQueueRecordWriter>

      runWithSession(sessionA, () => {
        // Install a slow hook so the record stays inFlight until cleanup closes the writer
        setQueueRecordHookRunner(() => new Promise<string>(() => {}))
        writer = createQueueRecordWriter(
          () => {
            writtenInSessions.push(String(getSessionId()))
          },
          { timeoutMs: 60_000 },
        )
        writer({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: getSessionId(),
          content: 'pending-at-exit',
        })
      })

      expect(writtenInSessions).toEqual([])
      expect(hasActiveSessionAls()).toBe(false)

      // Out-of-ALS process shutdown drains Host A's writer inside sessionA's ALS!
      await runCleanupFunctions()
      expect(writtenInSessions).toEqual(['queue-cleanup-host-a'])
      // Keep writer referenced until assertion completes
      expect(typeof writer).toBe('function')
    })
  })

  describe('4. cwd.ts version stability across concurrent scopes & pinScopedCallCwd finished-frame safety', () => {
    test('getCwdVersion does not ping-pong across concurrent root session, withProject fork, and runWithCwd scopes on same host', async () => {
      await runWithNewHostSession(
        { id: 'cwd-ver-root', originalCwd: '/repo/root', cwd: '/repo/root' },
        async rootSession => {
          const fork = rootSession.withProject({ cwd: '/repo/fork' })

          const rootV0 = getCwdVersion()
          const forkV0 = runWithSession(fork, () => getCwdVersion())
          const scopedAV0 = runWithCwd('/repo/scoped-a', () => getCwdVersion())
          const scopedBV0 = runWithCwd('/repo/scoped-b', () => getCwdVersion())

          // Interleave reads across all 4 scopes repeatedly — zero spurious increments!
          for (let i = 0; i < 5; i++) {
            expect(getCwdVersion()).toBe(rootV0)
            expect(runWithSession(fork, () => getCwdVersion())).toBe(forkV0)
            expect(
              runWithCwd('/repo/scoped-a', () => {
                const v1 = getCwdVersion()
                const v2 = getCwdVersion()
                expect(v2).toBe(v1)
                setCwd('/repo/scoped-a/nested')
                expect(getCwdVersion()).toBe(v1 + 1)
                return v1
              }),
            ).toBe(0)
            expect(scopedAV0).toBe(0)
            expect(scopedBV0).toBe(0)
          }

          // Mutating fork increments ONLY fork's version, not root's!
          runWithSession(fork, () => {
            setCwd('/repo/fork/moved')
            expect(getCwdVersion()).toBe(forkV0 + 1)
          })
          expect(getCwdVersion()).toBe(rootV0)
        },
      )
    })

    test('pinScopedCallCwd and unpinScopedCallCwd unwrap finished isOver frames via getActiveCwdStore', async () => {
      await runWithCwd('/virtual/outer', async () => {
        let detachedPin!: () => void
        let detachedUnpin!: () => void

        await withScopedCallCwd(async () => {
          await withScopedCallCwd(async () => {
            detachedPin = () => pinScopedCallCwd()
            detachedUnpin = () => unpinScopedCallCwd()
          })
          // Inner frame is now isOver=true! Calling detachedPin must pin the ACTIVE outer frame.
          detachedPin()
          setCwd('/virtual/outer-moved')
          // Because outer frame is pinned, outer frame's own getCwd stays '/virtual/outer'
          expect(getCwd()).toBe('/virtual/outer')

          // Calling detachedUnpin unpins the ACTIVE outer frame!
          detachedUnpin()
          setCwd('/virtual/outer-unpinned')
          expect(getCwd()).toBe('/virtual/outer-unpinned')
        })

        // Outside all active call frames, calling detachedPin/detachedUnpin is a safe no-op
        detachedPin()
        detachedUnpin()
        expect(getCwd()).toBe('/virtual/outer-unpinned')
      })
    })
  })

  describe('5. QueryEngine, runAgent, and LocalShellTask strip foreign SubconversationAlsContext overlays', () => {
    test('QueryEngine bound to (sessionA, undefined) strips foreign subconversation overlay on submitMessage / runInBoundSession', async () => {
      const dirA = makeTempDir('w4-qe-a-')
      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'qe-root-a',
        project: { originalCwd: dirA, projectRoot: dirA, cwd: dirA },
      })

      let engine!: QueryEngine
      runWithSession(sessionA, () => {
        const appState = getDefaultAppState()
        engine = new QueryEngine({
          cwd: dirA,
          tools: [],
          commands: [],
          mcpClients: [],
          agents: [],
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'test',
            decisionReason: { type: 'mode', mode: 'default' },
          }),
          getAppState: () => appState,
          setAppState: () => {},
          readFileCache: createFileStateCacheWithSizeLimit(10),
        })
      })

      let observedSessionId = ''
      let observedSub: unknown = 'unset'
      const innerSpy = spyOn(
        engine as unknown as {
          submitMessageInner: () => AsyncGenerator<unknown, void, unknown>
        },
        'submitMessageInner',
      ).mockImplementation(async function* () {
        observedSessionId = String(getSessionId())
        observedSub = getActiveSubconversationFromAls()
        yield { type: 'system', subtype: 'init' }
      })
      activeSpies.push(innerSpy)

      // Iterate engine.submitMessage WHILE a foreign SubconversationAlsContext is active on sessionA!
      await runWithSession(sessionA, async () => {
        await runWithSubconversationContext(
          { sessionId: 'foreign-sub-qe', originalCwd: '/foreign/dir' },
          async () => {
            expect(getSessionId()).toBe('foreign-sub-qe' as SessionId)
            const gen = engine.submitMessage('hello')
            await gen.next()
            await gen.return(undefined)
          },
        )
      })

      expect(observedSessionId).toBe('qe-root-a')
      expect(observedSub).toBeUndefined()
    })

    test('runAgent strips foreign SubconversationAlsContext overlay when resumed inside foreign subconversation', async () => {
      const dirA = makeTempDir('w4-agent-a-')
      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'agent-root-a',
        project: { originalCwd: dirA, projectRoot: dirA, cwd: dirA },
      })

      const observedAppStateContexts: Array<{
        sessionId: string
        hasSub: boolean
      }> = []

      const appState = getDefaultAppState()
      const agentDef: AgentDefinition = {
        agentType: 'test-sub',
        whenToUse: 'test',
        getSystemPrompt: () => 'test prompt',
        source: 'built-in',
        baseDir: 'built-in',
      }

      const abortController = new AbortController()
      abortController.abort()

      let gen!: ReturnType<typeof runAgent>
      runWithSession(sessionA, () => {
        gen = runAgent({
          agentDefinition: agentDef,
          promptMessages: [makeUserMessage('hi')],
          toolUseContext: {
            options: {
              commands: [],
              debug: false,
              mainLoopModel: 'claude-sonnet-4-6',
              tools: [],
              verbose: false,
              maxThinkingTokens: 0,
              mcpClients: [],
              mcpResources: {},
              isNonInteractiveSession: true,
              agentDefinitions: { activeAgents: [], allAgents: [] },
              fileReadingLimits: { maxTokens: 10000 },
              refreshTools: () => [],
            },
            abortController,
            readFileState: createFileStateCacheWithSizeLimit(10),
            getAppState: () => {
              observedAppStateContexts.push({
                sessionId: String(getSessionId()),
                hasSub: getActiveSubconversationFromAls() !== undefined,
              })
              return appState
            },
            setAppState: () => {},
            setResponseLength: () => {},
            updateFileHistoryState: () => {},
            setInProgressToolUseIDs: () => {},
            agentId: undefined,
            messages: [],
          } as unknown as Parameters<typeof runAgent>[0]['toolUseContext'],
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'test',
            decisionReason: { type: 'mode', mode: 'default' },
          }),
          isAsync: false,
          querySource: 'agent:custom',
          availableTools: [],
          override: {
            systemPrompt: ['test'] as unknown as Parameters<
              typeof runAgent
            >[0]['override'] extends { systemPrompt?: infer S }
              ? S
              : never,
            userContext: {},
            systemContext: {},
          },
        })
      })

      // Resume generator inside a foreign subconversation overlay on the SAME sessionA!
      await runWithSession(sessionA, async () => {
        await runWithSubconversationContext(
          { sessionId: 'foreign-sub-agent', originalCwd: '/foreign/agent' },
          async () => {
            try {
              await gen.next()
            } catch {
              // Aborted generator may complete or reject — we inspect captured context before abort
            } finally {
              await gen.return(undefined)
            }
          },
        )
      })

      expect(observedAppStateContexts.length).toBeGreaterThan(0)
      for (const obs of observedAppStateContexts) {
        expect(obs).toEqual({ sessionId: 'agent-root-a', hasSub: false })
      }
    })

    test('LocalShellTask strips foreign subconversation overlays AND exits foreign ALS for default-context tasks', async () => {
      const hostA = createSessionHost()
      const sessionA = createRootSession({
        host: hostA,
        id: 'shell-host-a',
        project: {
          originalCwd: '/tmp/sh-a',
          projectRoot: '/tmp/sh-a',
          cwd: '/tmp/sh-a',
        },
      })
      const hostB = createSessionHost()
      const sessionB = createRootSession({
        host: hostB,
        id: 'shell-host-b',
        project: {
          originalCwd: '/tmp/sh-b',
          projectRoot: '/tmp/sh-b',
          cwd: '/tmp/sh-b',
        },
      })

      // 1) Task spawned inside (sessionA, undefined); resolve inside foreign subconversation on sessionA
      const appStateA = getDefaultAppState()
      const deferredA = makeDeferredShellCommand('w4-task-substrip')
      const handleA = await runWithSession(sessionA, () =>
        spawnShellTask(
          {
            command: 'echo a',
            description: 'substrip check',
            shellCommand: deferredA.shellCommand,
          },
          {
            abortController: new AbortController(),
            getAppState: () => appStateA,
            setAppState: updater => {
              Object.assign(appStateA, updater(appStateA))
            },
          },
        ),
      )

      let observedOnNotif: { sessionId: string; hasSub: boolean } | undefined
      const registrySpy = createTaskRegistry(
        () => appStateA,
        updater => {
          observedOnNotif = {
            sessionId: String(getSessionId()),
            hasSub: getActiveSubconversationFromAls() !== undefined,
          }
          Object.assign(appStateA, updater(appStateA))
        },
      )

      await runWithSession(sessionA, async () => {
        await runWithSubconversationContext(
          { sessionId: 'foreign-shell-sub' },
          async () => {
            await enqueueShellNotification(
              'w4-task-substrip',
              'substrip check',
              'completed',
              0,
              registrySpy,
              undefined,
              'bash',
              undefined,
              undefined,
              undefined,
              { session: sessionA, subconversation: undefined },
            )
          },
        )
      })
      expect(observedOnNotif).toEqual({
        sessionId: 'shell-host-a',
        hasSub: false,
      })
      deferredA.resolveExit({ code: 0, interrupted: false })
      await handleA.settled

      // 2) Task spawned OUTSIDE ALS (default host); resolveExit fires INSIDE unrelated sessionB ALS!
      const defaultAppState = getDefaultAppState()
      const deferredDefault = makeDeferredShellCommand('w4-task-default')
      expect(hasActiveSessionAls()).toBe(false)
      const handleDefault = await spawnShellTask(
        {
          command: 'echo default',
          description: 'default host task',
          shellCommand: deferredDefault.shellCommand,
        },
        {
          abortController: new AbortController(),
          getAppState: () => defaultAppState,
          setAppState: updater => {
            Object.assign(defaultAppState, updater(defaultAppState))
          },
        },
      )

      // Settle while sessionB is active on ALS — notification must land in DEFAULT host queue, NOT sessionB!
      runWithSession(sessionB, () => {
        deferredDefault.resolveExit({ code: 0, interrupted: false })
      })
      await handleDefault.settled

      const defaultQueueSnap = getCommandQueueSnapshot()
      const sessionBQueueSnap = runWithSession(sessionB, () =>
        getCommandQueueSnapshot(),
      )
      expect(
        defaultQueueSnap.some(item =>
          String(item.value).includes('w4-task-default'),
        ),
      ).toBe(true)
      expect(
        sessionBQueueSnap.some(item =>
          String(item.value).includes('w4-task-default'),
        ),
      ).toBe(false)
    })
  })

  describe('6. AcpAgent teardownSession race & cleanup drain, zero process.env leak, and live CWD sync', () => {
    test('teardownSession deletes session before awaiting flush, drains only that host cleanups/hooks, and never leaks process.env from repo settings', async () => {
      const configDir = makeTempDir('w4-acp-cfg-')
      const repoA = makeTempDir('w4-acp-repo-a-')
      const repoB = makeTempDir('w4-acp-repo-b-')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
      delete process.env.ANTHROPIC_CUSTOM_HEADERS

      // Repo A defines a safe env var in .claude/settings.local.json — even as the
      // VERY FIRST session on AcpAgent, it must NOT mutate process.env for Repo B!
      mkdirSync(join(repoA, '.claude'), { recursive: true })
      writeFileSync(
        join(repoA, '.claude', 'settings.local.json'),
        JSON.stringify({
          env: { ANTHROPIC_CUSTOM_HEADERS: 'x-repo-a-secret: leaked' },
          permissions: { defaultMode: 'acceptEdits' },
        }),
      )

      const agent = new AcpAgent(makeConn())
      await agent.initialize({ protocolVersion: 1 } as never)

      const resA = await agent.newSession({ cwd: repoA, mcpServers: [] })
      expect(resA.modes?.currentModeId).toBe('acceptEdits')
      expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()

      const resB = await agent.newSession({ cwd: repoB, mcpServers: [] })
      expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()

      const sessionA = agent.sessions.get(resA.sessionId)!
      const sessionB = agent.sessions.get(resB.sessionId)!

      let hostACleanupRan = 0
      let hostBCleanupRan = 0

      const hookShellA = makeDeferredShellCommand('hook-proc-a').shellCommand
      const hookShellB = makeDeferredShellCommand('hook-proc-b').shellCommand
      runWithSession(sessionA.hostSession, () => {
        registerCleanup(() => {
          hostACleanupRan++
        })
        captureHooksConfigSnapshot()
        registerPendingAsyncHook({
          processId: 'proc-a',
          hookId: 'hook-a',
          asyncResponse: { async: true, asyncTimeout: 5000 },
          hookName: 'test-hook-a',
          hookEvent: 'PostToolUse',
          command: 'echo a',
          shellCommand: hookShellA,
        })
      })
      runWithSession(sessionB.hostSession, () => {
        registerCleanup(() => {
          hostBCleanupRan++
        })
        captureHooksConfigSnapshot()
        registerPendingAsyncHook({
          processId: 'proc-b',
          hookId: 'hook-b',
          asyncResponse: { async: true, asyncTimeout: 5000 },
          hookName: 'test-hook-b',
          hookEvent: 'PostToolUse',
          command: 'echo b',
          shellCommand: hookShellB,
        })
      })

      // Block flush inside sessionA's teardown and verify sessionA is ALREADY deleted
      // from agent.sessions BEFORE teardownSession finishes awaiting!
      let releaseFlush!: () => void
      const flushGate = new Promise<void>(resolve => {
        releaseFlush = resolve
      })
      const projA = runWithSession(sessionA.hostSession, () => getProject())
      const flushSpy = spyOn(projA, 'flush').mockImplementation(async () => {
        await flushGate
      })
      activeSpies.push(flushSpy)

      const teardownPromise = agent.teardownSession(resA.sessionId)
      // Synchronously deleted BEFORE await!
      expect(agent.sessions.has(resA.sessionId)).toBe(false)
      // Concurrent prompt() immediately sees "not found" instead of grabbing dying sessionA!
      await expect(
        agent.prompt({
          sessionId: resA.sessionId,
          prompt: [{ type: 'text', text: 'late prompt' }],
        }),
      ).rejects.toThrow(`Session ${resA.sessionId} not found`)

      releaseFlush()
      await teardownPromise

      // Host A cleanups + async hooks + hooks snapshot were drained; Host B is 100% untouched!
      expect(hostACleanupRan).toBe(1)
      expect(hostBCleanupRan).toBe(0)
      runWithSession(sessionA.hostSession, () => {
        expect(getPendingAsyncHooks()).toHaveLength(0)
      })
      runWithSession(sessionB.hostSession, () => {
        expect(getPendingAsyncHooks()).toHaveLength(1)
        expect(getHooksConfigFromSnapshot()).not.toBeNull()
      })
      expect(agent.sessions.has(resB.sessionId)).toBe(true)

      await agent.teardownSession(resB.sessionId)
      expect(hostBCleanupRan).toBe(1)
      expect(agent.sessions.has(resB.sessionId)).toBe(false)
    })

    test('getOrCreateSession reconnect updates existingSession.cwd when params.cwd changes', async () => {
      const configDir = makeTempDir('w4-acp-reconnect-cfg-')
      const dir1 = makeTempDir('w4-acp-reconnect-1-')
      const dir2 = makeTempDir('w4-acp-reconnect-2-')
      process.env.CLAUDE_CONFIG_DIR = configDir

      const agent = new AcpAgent(makeConn())
      await agent.initialize({ protocolVersion: 1 } as never)
      const { sessionId } = await agent.newSession({
        cwd: dir1,
        mcpServers: [],
      })
      const existing = agent.sessions.get(sessionId)!
      expect(existing.cwd).toBe(dir1)

      // Match fingerprint to exercise the reconnect path with a changed cwd
      const { computeSessionFingerprint } = await import(
        '../../services/acp/utils.js'
      )
      existing.sessionFingerprint = computeSessionFingerprint({
        cwd: dir2,
        mcpServers: [],
      })

      await agent.getOrCreateSession({
        sessionId,
        cwd: dir2,
        mcpServers: [],
        replay: false,
      })

      expect(existing.cwd).toBe(dir2)
      expect(existing.hostSession.project.cwd).toBe(dir2)
      expect(existing.hostSession.project.originalCwd).toBe(dir2)

      // Verify canUseTool resolves the updated live CWD (not stale initial dir1)
      const engineConfig = (
        existing.queryEngine as unknown as {
          config: {
            canUseTool: (
              tool: { name: string },
              input: Record<string, unknown>,
              context: unknown,
              assistantMessage: unknown,
              toolUseID: string,
            ) => Promise<{ behavior: string }>
          }
        }
      ).config
      const res = await engineConfig.canUseTool(
        { name: 'ExitPlanMode' },
        { plan: 'live cwd check' },
        {},
        {},
        'tu-live-cwd',
      )
      expect(res.behavior).toBe('deny')

      await agent.teardownSession(sessionId)
    })
  })
})
