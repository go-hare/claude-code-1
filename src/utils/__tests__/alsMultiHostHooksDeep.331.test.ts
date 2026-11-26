/**
 * Official Claude Code 2.1.331 single-process multi-host `HostSlot` & `AsyncLocalStorage`
 * deep hooks isolation tests:
 *
 * 1. `src/utils/hooks/hooksConfigSnapshot.ts` (`HostSlot` + `WeakRef<Session>` `settingsChangeDetector`)
 * 2. `src/utils/hooks/AsyncHookRegistry.ts` (`HostSlot` + captured ALS `Session` + `WeakRef` registries)
 * 3. `src/utils/hooks/hookHeartbeat.ts` (`HostSlot` + captured host state & `Session` on `HookProgressHeartbeat`)
 * 4. `src/utils/hooks/fileChangedWatcher.ts` (`HostSlot` + `WeakRef<Session>` ALS restoration)
 * 5. `src/utils/sessionEnvironment.ts` (`HostSlot` per-host env script cache without cross-host thrashing)
 * 6. `src/utils/hooks/modelHookConcurrency.ts` & `src/utils/hooks.ts` (`eventSlotsByHost` & `sessionModelHookSlotsByHost`)
 * 7. `src/utils/plugins/loadPluginHooks.ts` (`setupPluginHookHotReload` `WeakRef<Session>` + `runWithSession`)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getRegisteredHooks,
  registerHookCallbacks,
  resetStateForTests,
  setInlinePlugins,
} from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getSessionModelHookSlots } from '../hooks.js'
import {
  checkForAsyncHookResponses,
  clearAllAsyncHooks,
  finalizePendingAsyncHooks,
  getPendingAsyncHooks,
  registerPendingAsyncHook,
  removeDeliveredAsyncHooks,
} from '../hooks/AsyncHookRegistry.js'
import {
  initializeFileChangedWatcher,
  onCwdChangedForHooks,
  resetFileChangedWatcherForTesting,
  setEnvHookNotifier,
} from '../hooks/fileChangedWatcher.js'
import {
  clearHookEventState,
  type HookExecutionEvent,
  registerHookEventHandler,
  setAllHookEventsEnabled,
} from '../hooks/hookEvents.js'
import {
  type HookHeartbeatEvent,
  markHookHeartbeatTurnPastResult,
  registerHookHeartbeatSink,
  setHookHeartbeatTurn,
  startHookHeartbeat,
  stopAllHookHeartbeatsForSession,
} from '../hooks/hookHeartbeat.js'
import {
  captureHooksConfigSnapshot,
  getHooksConfigFromSnapshot,
  resetHooksConfigSnapshot,
  shouldAllowManagedHooksOnly,
  updateHooksConfigSnapshot,
} from '../hooks/hooksConfigSnapshot.js'
import {
  acquireModelHookSlot,
  getActiveModelHookCount,
  MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  resetModelHookConcurrencyForTests,
} from '../hooks/modelHookConcurrency.js'
import {
  clearPluginHookCache,
  loadPluginHooks,
  resetHotReloadState,
  resetPluginHookRegistrationForTests,
  setupPluginHookHotReload,
} from '../plugins/loadPluginHooks.js'
import { clearPluginCache } from '../plugins/pluginLoader.js'
import type { ShellCommand } from '../ShellCommand.js'
import {
  getSessionAlsStore,
  runWithNewHostSession,
} from '../sessionContextAls.js'
import {
  getHookEnvFilePath,
  getSessionEnvironmentScript,
  getSessionEnvironmentVariables,
  invalidateSessionEnvCache,
} from '../sessionEnvironment.js'
import { getBootstrapSession, getBootstrapSessionHost } from '../sessionHost.js'
import { registerSessionContextReader } from '../sessionRoot.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
} from '../settings/settingsCache.js'

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

function writeJsonFile(filePath: string, value: unknown): void {
  const dirIdx = filePath.lastIndexOf('/')
  if (dirIdx > 0) {
    mkdirSync(filePath.slice(0, dirIdx), { recursive: true })
  }
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createRepoWithSettings(
  workspace: string,
  name: string,
  settings: Record<string, unknown>,
): string {
  const repoDir = join(workspace, name)
  mkdirSync(join(repoDir, '.git'), { recursive: true })
  writeJsonFile(join(repoDir, '.claude', 'settings.json'), settings)
  return repoDir
}

function createInlinePluginWithHook(
  workspace: string,
  name: string,
  commandText: string,
): string {
  const pluginDir = join(workspace, `plugin-${name}`)
  writeJsonFile(join(pluginDir, '.claude-plugin', 'plugin.json'), {
    name: `${name}-plugin`,
    version: '1.0.0',
    description: `Plugin ${name}`,
  })
  writeJsonFile(join(pluginDir, 'hooks', 'hooks.json'), {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: commandText }],
        },
      ],
    },
  })
  return pluginDir
}

function makeFakeShellCommand(opts: {
  initialStatus?: 'running' | 'completed' | 'killed'
  stdout?: string
  stderr?: string
  exitCode?: number
}): {
  shell: ShellCommand
  setStatus: (next: 'running' | 'completed' | 'killed') => void
  setStdout: (next: string) => void
  wasKilled: () => boolean
  cleanups: () => number
} {
  let status: 'running' | 'completed' | 'killed' =
    opts.initialStatus ?? 'running'
  let stdout = opts.stdout ?? ''
  const stderr = opts.stderr ?? ''
  const exitCode = opts.exitCode ?? 0
  let killed = false
  let cleanupCount = 0

  const shell = {
    get status() {
      return status
    },
    set status(next: 'running' | 'completed' | 'killed') {
      status = next
    },
    result: Promise.resolve({
      code: exitCode,
      interrupted: false,
    }),
    taskOutput: {
      getStdout: async () => stdout,
      getStderr: () => stderr,
    },
    kill: () => {
      killed = true
      status = 'killed'
    },
    cleanup: () => {
      cleanupCount++
    },
  } as unknown as ShellCommand

  return {
    shell,
    setStatus: next => {
      status = next
    },
    setStdout: next => {
      stdout = next
    },
    wasKilled: () => killed,
    cleanups: () => cleanupCount,
  }
}

describe('2.1.331 multi-host Deep Hooks, AsyncHookRegistry, Watcher, Heartbeat & Concurrency isolation', () => {
  const tempDirs: string[] = []
  let savedConfigDir: string | undefined
  let savedEnvFile: string | undefined
  let savedHeartbeatInterval: string | undefined
  let savedHooksSameThread: string | undefined

  beforeEach(async () => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    savedEnvFile = process.env.CLAUDE_ENV_FILE
    savedHeartbeatInterval = process.env.CLAUDE_CODE_HOOK_HEARTBEAT_INTERVAL_MS
    savedHooksSameThread = process.env.CLAUDE_CODE_HOOKS_SAME_THREAD

    const homeDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-hooks-deep-home-')),
    )
    tempDirs.push(homeDir)
    process.env.CLAUDE_CONFIG_DIR = homeDir
    delete process.env.CLAUDE_ENV_FILE
    delete process.env.CLAUDE_CODE_HOOK_HEARTBEAT_INTERVAL_MS
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'
    getClaudeConfigHomeDir.cache?.clear?.()

    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetSettingsCache()
    resetHooksConfigSnapshot()
    clearAllAsyncHooks()
    resetFileChangedWatcherForTesting()
    resetModelHookConcurrencyForTests()
    invalidateSessionEnvCache()
    await settingsChangeDetector.resetForTesting()
  })

  afterEach(async () => {
    await settingsChangeDetector.resetForTesting()
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
    resetSettingsCache()
    resetHooksConfigSnapshot()
    clearAllAsyncHooks()
    resetFileChangedWatcherForTesting()
    resetModelHookConcurrencyForTests()
    invalidateSessionEnvCache()
    clearHookEventState()

    if (savedConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    }
    if (savedEnvFile === undefined) {
      delete process.env.CLAUDE_ENV_FILE
    } else {
      process.env.CLAUDE_ENV_FILE = savedEnvFile
    }
    if (savedHeartbeatInterval === undefined) {
      delete process.env.CLAUDE_CODE_HOOK_HEARTBEAT_INTERVAL_MS
    } else {
      process.env.CLAUDE_CODE_HOOK_HEARTBEAT_INTERVAL_MS =
        savedHeartbeatInterval
    }
    if (savedHooksSameThread === undefined) {
      delete process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    } else {
      process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = savedHooksSameThread
    }
    getClaudeConfigHomeDir.cache?.clear?.()

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('hooksConfigSnapshot: concurrent hosts in /repo-a and /repo-b snapshot strictly disjoint project PreToolUse hooks and isolate updates/disables', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-hooks-snap-ws-')),
    )
    tempDirs.push(workspace)

    const repoA = createRepoWithSettings(workspace, 'repo-a', {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo guard-repo-a' }],
          },
        ],
      },
    })
    const repoB = createRepoWithSettings(workspace, 'repo-b', {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo guard-repo-b' }],
          },
        ],
      },
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
          isInteractive: false,
        },
        async () => {
          captureHooksConfigSnapshot()
          const initialA = getHooksConfigFromSnapshot()
          await tick(15)
          // Host B disabled all hooks, notified settingsChangeDetector, and reset its snapshot;
          // Host A must still preserve its own /repo-a PreToolUse hook!
          const afterHostBDisable = getHooksConfigFromSnapshot()
          const managedOnlyA = shouldAllowManagedHooksOnly()
          return { initialA, afterHostBDisable, managedOnlyA }
        },
      ),
      runWithNewHostSession(
        {
          id: 'bbbbbbbb-2222-4222-8222-222222222222',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
          isInteractive: false,
        },
        async () => {
          await tick(2)
          captureHooksConfigSnapshot()
          const initialB = getHooksConfigFromSnapshot()

          // Rewrite /repo-b/.claude/settings.json to disable all non-managed hooks
          writeJsonFile(join(repoB, '.claude', 'settings.json'), {
            disableAllHooks: true,
            hooks: {
              PreToolUse: [
                {
                  matcher: 'Bash',
                  hooks: [
                    { type: 'command', command: 'echo should-not-run-b' },
                  ],
                },
              ],
            },
          })
          // Notify via settingsChangeDetector from inside Host B's ALS context:
          // Host A's WeakRef<Session> subscriber must run inside sessionA (reading /repo-a),
          // while Host B's subscriber updates Host B to {}.
          settingsChangeDetector.notifyChange('projectSettings')
          const afterNotifyB = getHooksConfigFromSnapshot()
          const managedOnlyB = shouldAllowManagedHooksOnly()

          updateHooksConfigSnapshot()
          const afterExplicitUpdateB = getHooksConfigFromSnapshot()

          resetHooksConfigSnapshot()
          await tick(2)
          return {
            initialB,
            afterNotifyB,
            managedOnlyB,
            afterExplicitUpdateB,
          }
        },
      ),
    ])

    expect(resA.initialA?.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo guard-repo-a' }],
      },
    ])
    expect(resA.afterHostBDisable?.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo guard-repo-a' }],
      },
    ])
    expect(resA.managedOnlyA).toBe(false)

    expect(resB.initialB?.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo guard-repo-b' }],
      },
    ])
    expect(resB.afterNotifyB).toEqual({})
    expect(resB.afterExplicitUpdateB).toEqual({})
    expect(resB.managedOnlyB).toBe(true)
  })

  test('AsyncHookRegistry: pending async hook in Host A is invisible to Host B checkForAsyncHookResponses and drains only in Host A', async () => {
    const eventsA: HookExecutionEvent[] = []
    const eventsB: HookExecutionEvent[] = []

    const fakeA = makeFakeShellCommand({
      initialStatus: 'running',
      stdout: '{"async":true}\n{"systemMessage":"async-msg-from-host-a"}\n',
      exitCode: 0,
    })
    const fakeB = makeFakeShellCommand({
      initialStatus: 'completed',
      stdout: '{"async":true}\n{"systemMessage":"async-msg-from-host-b"}\n',
      exitCode: 0,
    })
    const lingeringB = makeFakeShellCommand({
      initialStatus: 'running',
      stdout: '',
      exitCode: 0,
    })

    let releaseHostBChecked!: () => void
    const hostBChecked = new Promise<void>(resolve => {
      releaseHostBChecked = resolve
    })
    let releaseHostARegistered!: () => void
    const hostARegistered = new Promise<void>(resolve => {
      releaseHostARegistered = resolve
    })

    const [outA, outB] = await Promise.all([
      runWithNewHostSession(
        { id: 'async-host-a', isInteractive: false },
        async () => {
          setAllHookEventsEnabled(true)
          registerHookEventHandler(ev => eventsA.push(ev))

          // Register completed-ready hook on Host A before Host B checks
          fakeA.setStatus('completed')
          registerPendingAsyncHook({
            processId: 'proc-host-a',
            hookId: 'hook-id-a',
            asyncResponse: { async: true, asyncTimeout: 5000 },
            hookName: 'PostToolUse:Bash',
            hookEvent: 'PostToolUse',
            command: 'echo host-a',
            shellCommand: fakeA.shell,
            toolName: 'Bash',
          })
          expect(getPendingAsyncHooks().map(h => h.processId)).toEqual([
            'proc-host-a',
          ])
          releaseHostARegistered()

          // Wait until Host B runs checkForAsyncHookResponses, finalizePendingAsyncHooks, and clearAllAsyncHooks
          await hostBChecked

          // Host A's completed hook must STILL be pending and untouched!
          const pendingStillInA = getPendingAsyncHooks().map(h => h.processId)
          const drainedA = await checkForAsyncHookResponses()
          removeDeliveredAsyncHooks(drainedA.map(d => d.processId))
          const pendingAfterDrainA = getPendingAsyncHooks().length

          return {
            pendingStillInA,
            drainedA,
            pendingAfterDrainA,
            killedA: fakeA.wasKilled(),
          }
        },
      ),
      runWithNewHostSession(
        { id: 'async-host-b', isInteractive: false },
        async () => {
          setAllHookEventsEnabled(true)
          registerHookEventHandler(ev => eventsB.push(ev))

          await hostARegistered

          // Host B sees 0 pending hooks before registering its own
          const pendingBeforeRegisterB = getPendingAsyncHooks().map(
            h => h.processId,
          )

          registerPendingAsyncHook({
            processId: 'proc-host-b',
            hookId: 'hook-id-b',
            asyncResponse: { async: true, asyncTimeout: 5000 },
            hookName: 'PostToolUse:Bash',
            hookEvent: 'PostToolUse',
            command: 'echo host-b',
            shellCommand: fakeB.shell,
            toolName: 'Bash',
          })
          registerPendingAsyncHook({
            processId: 'proc-host-b-lingering',
            hookId: 'hook-id-b-lingering',
            asyncResponse: { async: true, asyncTimeout: 5000 },
            hookName: 'Stop:check',
            hookEvent: 'Stop',
            command: 'sleep 10',
            shellCommand: lingeringB.shell,
          })

          // Draining in Host B returns ONLY proc-host-b, never proc-host-a
          const drainedB = await checkForAsyncHookResponses()
          // Finalizing & clearing in Host B kills ONLY proc-host-b-lingering, never proc-host-a
          await finalizePendingAsyncHooks()
          clearAllAsyncHooks()

          releaseHostBChecked()
          return {
            pendingBeforeRegisterB,
            drainedB,
            lingeringKilledB: lingeringB.wasKilled(),
          }
        },
      ),
    ])

    expect(outB.pendingBeforeRegisterB).toEqual([])
    expect(outB.drainedB).toHaveLength(1)
    expect(outB.drainedB[0]?.processId).toBe('proc-host-b')
    expect(outB.drainedB[0]?.response.systemMessage).toBe(
      'async-msg-from-host-b',
    )
    expect(outB.lingeringKilledB).toBe(true)

    expect(outA.pendingStillInA).toEqual(['proc-host-a'])
    expect(outA.killedA).toBe(false)
    expect(outA.drainedA).toHaveLength(1)
    expect(outA.drainedA[0]?.processId).toBe('proc-host-a')
    expect(outA.drainedA[0]?.response.systemMessage).toBe(
      'async-msg-from-host-a',
    )
    expect(outA.pendingAfterDrainA).toBe(0)

    expect(eventsA.map(e => e.hookId)).toEqual(['hook-id-a'])
    expect(eventsB.map(e => e.hookId)).toEqual([
      'hook-id-b',
      'hook-id-b-lingering',
    ])
  })

  test('hookHeartbeat: setHookHeartbeatTurn, registerHookHeartbeatSink, and stopAllHookHeartbeatsForSession in Host B never stop or hijack Host A heartbeats', async () => {
    process.env.CLAUDE_CODE_HOOK_HEARTBEAT_INTERVAL_MS = '15'

    const eventsA: HookHeartbeatEvent[] = []
    const eventsB: HookHeartbeatEvent[] = []
    const observedSinkSessionsA: string[] = []

    let markHostAStarted!: () => void
    const hostAStarted = new Promise<void>(resolve => {
      markHostAStarted = resolve
    })
    let markHostBInterfered!: () => void
    const hostBInterfered = new Promise<void>(resolve => {
      markHostBInterfered = resolve
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession(
        { id: 'hb-session-shared-id', isInteractive: false },
        async sessionA => {
          const unsubA = registerHookHeartbeatSink(ev => {
            eventsA.push(ev)
            observedSinkSessionsA.push(
              getBootstrapSession() === sessionA ? 'sessionA' : 'wrong',
            )
          })
          try {
            setHookHeartbeatTurn(1)
            const hbA = startHookHeartbeat({
              hookEvent: 'PreToolUse',
              toolUseID: 'toolu_host_a',
              matchedHookCount: 1,
              maxTimeoutMs: 5000,
              forceNonInteractiveForTest: true,
            })
            expect(hbA).toBeDefined()
            markHostAStarted()

            await hostBInterfered
            // Wait several 15ms intervals AFTER Host B mutated turns, sinks, and called stopAllHookHeartbeatsForSession
            await tick(55)
            const beatsWhileRunning = hbA!.beatCount

            // Advancing Host A's own turn stops hbA on its next tick
            setHookHeartbeatTurn(2)
            await tick(25)
            const beatsAfterOwnTurnAdvance = hbA!.beatCount
            await tick(25)
            const beatsStableAfterStop = hbA!.beatCount
            hbA!.stop()

            return {
              beatsWhileRunning,
              beatsAfterOwnTurnAdvance,
              beatsStableAfterStop,
            }
          } finally {
            unsubA()
          }
        },
      ),
      runWithNewHostSession(
        { id: 'hb-session-shared-id', isInteractive: false },
        async () => {
          await hostAStarted
          await tick(20)

          // Host B registers its own sink, advances turns, marks past result, and stops all heartbeats for its session
          const unsubB = registerHookHeartbeatSink(ev => {
            eventsB.push(ev)
          })
          try {
            setHookHeartbeatTurn(42)
            markHookHeartbeatTurnPastResult(42)
            const suppressedInB = startHookHeartbeat({
              hookEvent: 'PreToolUse',
              toolUseID: 'toolu_host_b_past_result',
              matchedHookCount: 1,
              maxTimeoutMs: 5000,
              forceNonInteractiveForTest: true,
            })
            stopAllHookHeartbeatsForSession('hb-session-shared-id')
            markHostBInterfered()
            await tick(60)
            return { suppressedInB: suppressedInB === undefined }
          } finally {
            unsubB()
          }
        },
      ),
    ])

    expect(resB.suppressedInB).toBe(true)
    expect(eventsB).toHaveLength(0)

    expect(resA.beatsWhileRunning).toBeGreaterThanOrEqual(2)
    expect(resA.beatsStableAfterStop).toBe(resA.beatsAfterOwnTurnAdvance)
    expect(eventsA.length).toBeGreaterThanOrEqual(2)
    expect(eventsA.every(e => e.parent_tool_use_id === 'toolu_host_a')).toBe(
      true,
    )
    expect(observedSinkSessionsA.every(s => s === 'sessionA')).toBe(true)
  })

  test('fileChangedWatcher: isolates notifiers, CwdChanged / FileChanged execution, and restores target Session ALS in fs watcher callbacks', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-watcher-ws-')),
    )
    tempDirs.push(workspace)

    const cmdPrintSystemMsg = (msg: string): string =>
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        `console.log(JSON.stringify({ systemMessage: ${JSON.stringify(msg)} }))`,
      )}`

    const repoA = createRepoWithSettings(workspace, 'repo-a', {
      hooks: {
        FileChanged: [
          {
            matcher: '.envrc',
            hooks: [
              {
                type: 'command',
                command: cmdPrintSystemMsg('file-msg-host-a'),
              },
            ],
          },
        ],
        CwdChanged: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: cmdPrintSystemMsg('cwd-msg-host-a') },
            ],
          },
        ],
      },
    })
    const repoASub = join(repoA, 'sub-a')
    mkdirSync(repoASub, { recursive: true })
    writeFileSync(join(repoA, '.envrc'), 'export A=1\n', 'utf8')

    const repoB = createRepoWithSettings(workspace, 'repo-b', {
      hooks: {
        FileChanged: [
          {
            matcher: '.envrc',
            hooks: [
              {
                type: 'command',
                command: cmdPrintSystemMsg('file-msg-host-b'),
              },
            ],
          },
        ],
        CwdChanged: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: cmdPrintSystemMsg('cwd-msg-host-b') },
            ],
          },
        ],
      },
    })
    const repoBSub = join(repoB, 'sub-b')
    mkdirSync(repoBSub, { recursive: true })
    writeFileSync(join(repoB, '.envrc'), 'export B=1\n', 'utf8')

    const notificationsA: Array<{ text: string; isError: boolean }> = []
    const notificationsB: Array<{ text: string; isError: boolean }> = []
    const callbackHostsA: object[] = []
    const callbackHostsB: object[] = []

    await Promise.all([
      runWithNewHostSession(
        {
          id: 'watcher-host-a',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
          isInteractive: false,
        },
        async sessionA => {
          try {
            captureHooksConfigSnapshot()
            registerHookCallbacks({
              CwdChanged: [
                {
                  hooks: [
                    {
                      type: 'callback',
                      callback: async () => {
                        callbackHostsA.push(getBootstrapSessionHost())
                        return { systemMessage: 'cwd-msg-host-a' }
                      },
                    },
                  ],
                },
              ],
              FileChanged: [
                {
                  matcher: '.envrc',
                  hooks: [
                    {
                      type: 'callback',
                      callback: async () => {
                        callbackHostsA.push(getBootstrapSessionHost())
                        return { systemMessage: 'file-msg-host-a' }
                      },
                    },
                  ],
                },
              ],
            })
            setEnvHookNotifier((text, isError) => {
              expect(getBootstrapSession()).toBe(sessionA)
              notificationsA.push({ text, isError })
            })

            initializeFileChangedWatcher(repoA)
            await onCwdChangedForHooks(repoA, repoASub)

            // Wait for chokidar watcher on repoASub/.envrc to become live, then trigger a file add/change
            await tick(150)
            writeFileSync(join(repoASub, '.envrc'), 'export A=2\n', 'utf8')

            const deadline = Date.now() + 2500
            while (
              !notificationsA.some(n => n.text === 'file-msg-host-a') &&
              Date.now() < deadline
            ) {
              await tick(40)
            }

            expect(callbackHostsA.every(h => h === sessionA.host)).toBe(true)
          } finally {
            resetFileChangedWatcherForTesting()
          }
        },
      ),
      runWithNewHostSession(
        {
          id: 'watcher-host-b',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
          isInteractive: false,
        },
        async sessionB => {
          try {
            captureHooksConfigSnapshot()
            registerHookCallbacks({
              CwdChanged: [
                {
                  hooks: [
                    {
                      type: 'callback',
                      callback: async () => {
                        callbackHostsB.push(getBootstrapSessionHost())
                        return { systemMessage: 'cwd-msg-host-b' }
                      },
                    },
                  ],
                },
              ],
            })
            setEnvHookNotifier((text, isError) => {
              expect(getBootstrapSession()).toBe(sessionB)
              notificationsB.push({ text, isError })
            })

            initializeFileChangedWatcher(repoB)
            await onCwdChangedForHooks(repoB, repoBSub)
            await tick(80)
            // Resetting Host B's watcher mid-flight must never close Host A's watcher or clear Host A's notifier
            resetFileChangedWatcherForTesting()
            expect(callbackHostsB.every(h => h === sessionB.host)).toBe(true)
          } finally {
            resetFileChangedWatcherForTesting()
          }
        },
      ),
    ])

    expect(notificationsA).toEqual([
      { text: 'cwd-msg-host-a', isError: false },
      { text: 'file-msg-host-a', isError: false },
    ])
    expect(notificationsB).toEqual([{ text: 'cwd-msg-host-b', isError: false }])
  })

  test('sessionEnvironment: HostSlot isolates sessionEnvScript / sessionEnvOwner without disk cache thrashing across interleaved sessions', async () => {
    const [resultA, resultB] = await Promise.all([
      runWithNewHostSession(
        { id: 'env-host-session-a', isInteractive: false },
        async () => {
          const envFileA = await getHookEnvFilePath('SessionStart', 0)
          writeFileSync(envFileA, 'export SESSION_ROLE="host-a-v1"\n', 'utf8')
          invalidateSessionEnvCache()

          const firstScriptA = await getSessionEnvironmentScript()
          const firstVarsA = await getSessionEnvironmentVariables()

          // Mutate file on disk WITHOUT invalidating cache on Host A
          writeFileSync(envFileA, 'export SESSION_ROLE="host-a-v2"\n', 'utf8')
          await tick(10)

          // Even after Host B loaded and invalidated its own cache concurrently,
          // Host A still hits its in-memory HostSlot cache ('host-a-v1')!
          const cachedScriptAAfterHostB = await getSessionEnvironmentScript()

          // Explicit invalidation on Host A reloads 'host-a-v2'
          invalidateSessionEnvCache()
          const reloadedScriptA = await getSessionEnvironmentScript()

          return {
            firstScriptA,
            firstRoleA: firstVarsA.get('SESSION_ROLE'),
            cachedScriptAAfterHostB,
            reloadedScriptA,
          }
        },
      ),
      runWithNewHostSession(
        { id: 'env-host-session-b', isInteractive: false },
        async () => {
          const envFileB = await getHookEnvFilePath('SessionStart', 0)
          writeFileSync(envFileB, 'export SESSION_ROLE="host-b-v1"\n', 'utf8')
          invalidateSessionEnvCache()

          await tick(3)
          const firstScriptB = await getSessionEnvironmentScript()
          const firstVarsB = await getSessionEnvironmentVariables()

          writeFileSync(envFileB, 'export SESSION_ROLE="host-b-v2"\n', 'utf8')
          invalidateSessionEnvCache()
          const reloadedScriptB = await getSessionEnvironmentScript()

          return {
            firstScriptB,
            firstRoleB: firstVarsB.get('SESSION_ROLE'),
            reloadedScriptB,
          }
        },
      ),
    ])

    expect(resultA).toEqual({
      firstScriptA: 'export SESSION_ROLE="host-a-v1"',
      firstRoleA: 'host-a-v1',
      cachedScriptAAfterHostB: 'export SESSION_ROLE="host-a-v1"',
      reloadedScriptA: 'export SESSION_ROLE="host-a-v2"',
    })
    expect(resultB).toEqual({
      firstScriptB: 'export SESSION_ROLE="host-b-v1"',
      firstRoleB: 'host-b-v1',
      reloadedScriptB: 'export SESSION_ROLE="host-b-v2"',
    })
  })

  test('modelHookConcurrency & hooks.ts getSessionModelHookSlots: isolates per-event and per-session model hook semaphores across hosts', async () => {
    let markHostASaturated!: () => void
    const hostASaturated = new Promise<void>(resolve => {
      markHostASaturated = resolve
    })
    let markHostBVerified!: () => void
    const hostBVerified = new Promise<void>(resolve => {
      markHostBVerified = resolve
    })

    let slotsRefA!: ReturnType<typeof getSessionModelHookSlots>
    let slotsRefB!: ReturnType<typeof getSessionModelHookSlots>

    const [outA, outB] = await Promise.all([
      runWithNewHostSession({ id: 'concurrency-host-a' }, async () => {
        const acA = new AbortController()
        slotsRefA = getSessionModelHookSlots()
        const eventReleases: Array<() => void> = []

        for (let i = 0; i < MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT; i++) {
          const rel = await acquireModelHookSlot('PreToolUse', acA.signal)
          expect(rel).toBeDefined()
          eventReleases.push(rel!)
        }
        const sessionRel1 = await slotsRefA.slots.acquire(
          'model_hooks',
          1,
          acA.signal,
        )
        expect(sessionRel1).toBeDefined()
        expect(slotsRefA.slots.wouldWait('model_hooks', 1)).toBe(true)

        let waiter13Granted = false
        const waiter13 = acquireModelHookSlot('PreToolUse', acA.signal).then(
          rel => {
            waiter13Granted = true
            return rel
          },
        )
        await Promise.resolve()
        expect(waiter13Granted).toBe(false)

        markHostASaturated()
        await hostBVerified

        // Host B acquired, released, and called resetModelHookConcurrencyForTests,
        // yet Host A still holds all 12 active slots and waiter13 is still queued!
        const activeAfterHostBReset = getActiveModelHookCount('PreToolUse')
        const stillWaitingInA = !waiter13Granted

        eventReleases.shift()!()
        const rel13 = await waiter13
        rel13?.()
        for (const r of eventReleases) r()
        sessionRel1?.()

        return {
          activeAfterHostBReset,
          stillWaitingInA,
          finalActiveA: getActiveModelHookCount('PreToolUse'),
        }
      }),
      runWithNewHostSession({ id: 'concurrency-host-b' }, async () => {
        await hostASaturated
        const acB = new AbortController()
        slotsRefB = getSessionModelHookSlots()

        const initialActiveB = getActiveModelHookCount('PreToolUse')
        const sessionWouldWaitB = slotsRefB.slots.wouldWait('model_hooks', 1)

        // Acquires immediately on Host B despite Host A being completely saturated
        const relB = await acquireModelHookSlot('PreToolUse', acB.signal)
        const activeDuringHoldB = getActiveModelHookCount('PreToolUse')
        relB?.()
        resetModelHookConcurrencyForTests()

        markHostBVerified()
        return {
          initialActiveB,
          sessionWouldWaitB,
          grantedImmediatelyB: relB !== undefined,
          activeDuringHoldB,
        }
      }),
    ])

    expect(slotsRefA).not.toBe(slotsRefB)
    expect(outB).toEqual({
      initialActiveB: 0,
      sessionWouldWaitB: false,
      grantedImmediatelyB: true,
      activeDuringHoldB: 1,
    })
    expect(outA).toEqual({
      activeAfterHostBReset: MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
      stillWaitingInA: true,
      finalActiveA: 0,
    })
  })

  test('loadPluginHooks: setupPluginHookHotReload wraps subscriber in WeakRef<Session> + runWithSession so policy reloads stay host-isolated', async () => {
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'als-plugin-hotreload-ws-')),
    )
    tempDirs.push(workspace)

    const repoA = createRepoWithSettings(workspace, 'repo-plug-a', {})
    const repoB = createRepoWithSettings(workspace, 'repo-plug-b', {})
    const pluginAlpha = createInlinePluginWithHook(
      workspace,
      'alpha',
      'echo alpha-plugin-hook',
    )
    const pluginBeta = createInlinePluginWithHook(
      workspace,
      'beta',
      'echo beta-plugin-hook',
    )

    const [hooksA, hooksB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'plugin-hotreload-a',
          originalCwd: repoA,
          projectRoot: repoA,
          cwd: repoA,
          isInteractive: false,
        },
        async () => {
          try {
            setInlinePlugins([pluginAlpha])
            clearPluginCache('test-init-a')
            clearPluginHookCache()
            await loadPluginHooks()
            setupPluginHookHotReload()

            await tick(25)
            await loadPluginHooks()

            const matchers = getRegisteredHooks()?.PreToolUse ?? []
            return matchers.map(m =>
              'pluginName' in m ? m.pluginName : 'non-plugin',
            )
          } finally {
            resetHotReloadState()
            resetPluginHookRegistrationForTests()
          }
        },
      ),
      runWithNewHostSession(
        {
          id: 'plugin-hotreload-b',
          originalCwd: repoB,
          projectRoot: repoB,
          cwd: repoB,
          isInteractive: false,
        },
        async () => {
          try {
            await tick(5)
            setInlinePlugins([pluginBeta])
            clearPluginCache('test-init-b')
            clearPluginHookCache()
            await loadPluginHooks()
            setupPluginHookHotReload()

            // Trigger policySettings change inside Host B's ALS scope
            setCachedSettingsForSource('policySettings', {
              strictKnownMarketplaces: [],
            })
            settingsChangeDetector.notifyChange('policySettings')
            await tick(15)
            await loadPluginHooks()

            const matchers = getRegisteredHooks()?.PreToolUse ?? []
            return matchers.map(m =>
              'pluginName' in m ? m.pluginName : 'non-plugin',
            )
          } finally {
            resetHotReloadState()
            resetPluginHookRegistrationForTests()
          }
        },
      ),
    ])

    expect(hooksA).toEqual(['alpha-plugin'])
    expect(hooksB).toEqual(['beta-plugin'])
  })
})
