/**
 * Official Claude Code 2.1.331 Wave 5 multi-host / multi-session ALS isolation tests:
 * Verifies concurrent `runWithNewHostSession` isolation across Memory, ShellSnapshot,
 * Tasks, Tool Execution, Builtin Tools, API, and Reminders.
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  FileReadTool,
  registerFileReadListener,
} from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import {
  _resetFetchBudgetForTest,
  LocalMemoryRecallTool,
} from '@claude-code/builtin-tools/tools/LocalMemoryRecallTool/LocalMemoryRecallTool.js'
import {
  clearWebFetchCache,
  getURLMarkdownContent,
  getWebFetchCacheTtlMs,
  resetWebFetchCacheTtlMsForTests,
} from '@claude-code/builtin-tools/tools/WebFetchTool/utils.js'
import {
  _resetForTesting as resetAnalyticsForTesting,
  attachAnalyticsSink,
} from 'src/services/analytics/index.js'
import {
  clearSessionMediaItemCap,
  getSessionMediaItemCap,
  setSessionMediaItemCap,
} from 'src/services/api/claude.js'
import {
  recordApiRedirect,
  resetApiRedirectCountsForTests,
} from 'src/services/api/modelRedirectGuard.js'
import {
  clearCompactWarningSuppression,
  compactWarningStore,
  suppressCompactWarning,
} from 'src/services/compact/compactWarningState.js'
import { setEntry } from 'src/services/SessionMemory/multiStore.js'
import {
  resetLastMemoryMessageUuid,
  shouldExtractMemory,
} from 'src/services/SessionMemory/sessionMemory.js'
import {
  recordExtractionTokenCount,
  resetSessionMemoryState,
  setSessionMemoryConfig,
} from 'src/services/SessionMemory/sessionMemoryUtils.js'
import {
  redactSecrets,
  SECRET_REDACTION_OOM_FALLBACK,
  setSecretScannerErrorReporter,
  setSecretScannerMemoryProbeForTest,
} from 'src/services/teamMemorySync/secretScanner.js'
import {
  currentRemoteToolHost,
  noteRemoteToolHost,
} from 'src/services/tools/remoteToolCall.js'
import { defaultSessionRegistry } from 'src/services/tools/remoteToolHost.js'
import { exclusiveCallQueuedBehind } from 'src/services/tools/StreamingToolExecutor.js'
import {
  clearAgentPermissionWaits,
  getAgentAskNoticeAttachment,
  registerAgentPermissionWait,
  resetSubagentTokenThrottleState,
  shouldThrottleSubagentTokenUpdate,
  strandedAgentResume,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import {
  _resetLiveShellKillStateForTesting,
  killLiveShellCommands,
  registerLiveShellCommand,
} from 'src/tasks/LocalShellTask/killShellTasks.js'
import {
  clearCapturedShellExportsForTesting,
  createAndSaveSnapshot,
  getCapturedShellExports,
} from 'src/utils/bash/ShellSnapshot.js'
import {
  resetBatchingReminderLatch,
  resolveBatchingReminderText,
  TOASTY_THIMBLE_ENV,
} from 'src/utils/batchingReminder.js'
import {
  getMemoryStoreSkillCommands,
  getMemoryStoresHost,
  replaceMemoryStoreSkillCommands,
} from 'src/utils/memoryStoreSkills.js'
import { runWithNewHostSession } from 'src/utils/sessionHost.js'
import {
  getWaitingPowerShellState,
  markPowerShellCommandEnded,
  recordPowerShellCommandLaunch,
  resetWaitingPowerShellForTesting,
} from 'src/utils/shell/powershellProvider.js'
import { TaskOutput } from 'src/utils/task/TaskOutput.js'
import {
  peakTaskUsedSinceAnchor,
  reanchorTotalTokensReminder,
  resetTotalTokensReminderStateForTests,
} from 'src/utils/totalTokensReminder.js'
import type { ToolUseContext } from 'src/Tool.js'
import type { Command } from 'src/types/command.js'
import type { Message } from 'src/types/message.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function tick(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore temp cleanup errors
    }
  }
})

describe('2.1.331 Wave 5 ALS multi-host isolation: Memory, ShellSnapshot, Tasks, Tools, API & Reminders', () => {
  test('sessionMemory: lastMemoryMessageUuid isolates concurrent root sessions', async () => {
    const buildMessages = (assistantText: string): Message[] =>
      [
        {
          type: 'user',
          uuid: 'u-1',
          message: { role: 'user', content: 'start' },
        },
        {
          type: 'assistant',
          uuid: 'a-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: assistantText },
              {
                type: 'tool_use',
                id: 't-1',
                name: 'Read',
                input: { file_path: 'a.ts' },
              },
              {
                type: 'tool_use',
                id: 't-2',
                name: 'Read',
                input: { file_path: 'b.ts' },
              },
            ],
            usage: {
              input_tokens: 20_000,
              output_tokens: 500,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        },
        {
          type: 'user',
          uuid: 'u-2',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't-1', content: 'ok' },
              { type: 'tool_result', tool_use_id: 't-2', content: 'ok' },
            ],
          },
        },
      ] as unknown as Message[]

    const msgs = buildMessages('calling tools')
    let releaseB!: () => void
    const bReady = new Promise<void>(resolve => {
      releaseB = resolve
    })
    let aExtracted!: () => void
    const waitAExtracted = new Promise<void>(resolve => {
      aExtracted = resolve
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'sm-host-a' }, async () => {
        resetSessionMemoryState()
        resetLastMemoryMessageUuid()
        setSessionMemoryConfig({
          minimumMessageTokensToInit: 1,
          minimumTokensBetweenUpdate: 1,
          toolCallsBetweenUpdates: 2,
        })
        const first = shouldExtractMemory(msgs)
        recordExtractionTokenCount(0)
        // Last message uuid is now recorded as 'u-2'; with 0 tool calls after 'u-2'
        // and the last assistant turn still containing tool_use blocks, a second
        // check in Host A must return false.
        const second = shouldExtractMemory(msgs)
        aExtracted()
        await bReady
        const thirdStillBlocked = shouldExtractMemory(msgs)
        return { first, second, thirdStillBlocked }
      }),
      runWithNewHostSession({ id: 'sm-host-b' }, async () => {
        resetSessionMemoryState()
        resetLastMemoryMessageUuid()
        setSessionMemoryConfig({
          minimumMessageTokensToInit: 1,
          minimumTokensBetweenUpdate: 1,
          toolCallsBetweenUpdates: 2,
        })
        await waitAExtracted
        // Host B has never extracted yet — must NOT see Host A's lastMemoryMessageUuid.
        const firstInB = shouldExtractMemory(msgs)
        resetLastMemoryMessageUuid()
        releaseB()
        return { firstInB }
      }),
    ])

    expect(resA.first).toBe(true)
    expect(resA.second).toBe(false)
    expect(resA.thirdStillBlocked).toBe(false)
    expect(resB.firstInB).toBe(true)
  })

  test('memoryStoreSkills: skill bag and MemoryStoresHost isolate per host', async () => {
    const cmdA = { name: 'memories::skill-a', type: 'prompt' } as Command
    const cmdB = { name: 'memories::skill-b', type: 'prompt' } as Command

    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'mss-host-a' }, async () => {
        replaceMemoryStoreSkillCommands([cmdA])
        const host = getMemoryStoresHost()
        host.reset({
          storeSkillConfigs: [{ scope: 'team', mount: 'mount-a' }],
        })
        await tick(20)
        return {
          names: getMemoryStoreSkillCommands().map(c => c.name),
          mounts: getMemoryStoresHost().storeSkillConfigs?.map(c => c.mount),
          hostRef: host,
        }
      }),
      runWithNewHostSession({ id: 'mss-host-b' }, async () => {
        await tick(5)
        replaceMemoryStoreSkillCommands([cmdB])
        const host = getMemoryStoresHost()
        host.reset({
          storeSkillConfigs: [{ scope: 'team', mount: 'mount-b' }],
        })
        await tick(20)
        return {
          names: getMemoryStoreSkillCommands().map(c => c.name),
          mounts: getMemoryStoresHost().storeSkillConfigs?.map(c => c.mount),
          hostRef: host,
        }
      }),
    ])

    expect(a.names).toEqual(['memories::skill-a'])
    expect(b.names).toEqual(['memories::skill-b'])
    expect(a.mounts).toEqual(['mount-a'])
    expect(b.mounts).toEqual(['mount-b'])
    expect(a.hostRef).not.toBe(b.hostRef)
  })

  test('secretScanner: error reporter, memory probe override, and redact cache isolate per host', async () => {
    const errorsA: unknown[] = []
    const errorsB: unknown[] = []

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'sec-host-a' }, async () => {
        setSecretScannerErrorReporter(err => errorsA.push(err))
        setSecretScannerMemoryProbeForTest(() => {
          throw new RangeError('simulated host A OOM')
        })
        await tick(15)
        const out = redactSecrets('plain text host A')
        setSecretScannerMemoryProbeForTest(undefined)
        setSecretScannerErrorReporter(undefined)
        return out
      }),
      runWithNewHostSession({ id: 'sec-host-b' }, async () => {
        setSecretScannerErrorReporter(err => errorsB.push(err))
        setSecretScannerMemoryProbeForTest(undefined)
        await tick(15)
        const out = redactSecrets('plain text host B')
        setSecretScannerErrorReporter(undefined)
        return out
      }),
    ])

    expect(resA).toBe(SECRET_REDACTION_OOM_FALLBACK)
    expect(errorsA.length).toBe(1)
    expect(resB).toBe('plain text host B')
    expect(errorsB.length).toBe(0)
  })

  test('ShellSnapshot: capturedShellExports isolates per host', async () => {
    const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const configDir = makeTempDir('wave5-snapshot-')
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      let hostACaptured!: () => void
      const waitHostACaptured = new Promise<void>(resolve => {
        hostACaptured = resolve
      })
      let hostBChecked!: () => void
      const waitHostBChecked = new Promise<void>(resolve => {
        hostBChecked = resolve
      })

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'snap-host-a' }, async () => {
          clearCapturedShellExportsForTesting()
          const snapPath = await createAndSaveSnapshot('/bin/sh')
          const beforeClear = getCapturedShellExports()
          hostACaptured()
          await waitHostBChecked
          const afterHostBClear = getCapturedShellExports()
          return { snapPath, beforeClear, afterHostBClear }
        }),
        runWithNewHostSession({ id: 'snap-host-b' }, async () => {
          await waitHostACaptured
          const seenInB = getCapturedShellExports()
          clearCapturedShellExportsForTesting()
          hostBChecked()
          return { seenInB }
        }),
      ])

      expect(resA.snapPath).toBeDefined()
      expect(resA.beforeClear).toBeDefined()
      expect(resA.afterHostBClear).toBe(resA.beforeClear)
      expect(resB.seenInB).toBeUndefined()
    } finally {
      if (prevEntrypoint === undefined) {
        delete process.env.CLAUDE_CODE_ENTRYPOINT
      } else {
        process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
      }
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
    }
  })

  test('powershellProvider: headStartState isolates per host', async () => {
    const [a, b] = await Promise.all([
      runWithNewHostSession({ id: 'ps-host-a' }, async () => {
        await resetWaitingPowerShellForTesting()
        recordPowerShellCommandLaunch({
          powershellPath: 'pwsh',
          cwd: '/host-a',
          env: { HOST: 'A' },
        })
        markPowerShellCommandEnded()
        markPowerShellCommandEnded()
        await tick(15)
        return {
          cwd: getWaitingPowerShellState().lastPowerShellLaunch?.cwd,
          commandsEnded: getWaitingPowerShellState().commandsEnded,
        }
      }),
      runWithNewHostSession({ id: 'ps-host-b' }, async () => {
        await resetWaitingPowerShellForTesting()
        recordPowerShellCommandLaunch({
          powershellPath: 'pwsh',
          cwd: '/host-b',
          env: { HOST: 'B' },
        })
        markPowerShellCommandEnded()
        await tick(15)
        return {
          cwd: getWaitingPowerShellState().lastPowerShellLaunch?.cwd,
          commandsEnded: getWaitingPowerShellState().commandsEnded,
        }
      }),
    ])

    expect(a.cwd).toBe('/host-a')
    expect(a.commandsEnded).toBe(2)
    expect(b.cwd).toBe('/host-b')
    expect(b.commandsEnded).toBe(1)
  })

  test('TaskOutput: static registry and poller isolate identical taskIds per host', async () => {
    let callsA = 0
    let callsB = 0
    let resolveHostATick!: () => void
    const hostATicked = new Promise<void>(resolve => {
      resolveHostATick = resolve
    })

    let outA: TaskOutput | undefined
    let outB: TaskOutput | undefined

    try {
      await Promise.all([
        runWithNewHostSession({ id: 'taskout-host-a' }, async () => {
          outA = new TaskOutput(
            'shared-task-id',
            () => {
              callsA++
              resolveHostATick()
            },
            true,
          )
          mkdirSync(dirname(outA.path), { recursive: true })
          writeFileSync(outA.path, 'line from host A\n', 'utf8')
          TaskOutput.startPolling('shared-task-id')
          await Promise.race([hostATicked, tick(2500)])
        }),
        runWithNewHostSession({ id: 'taskout-host-b' }, async () => {
          outB = new TaskOutput(
            'shared-task-id',
            () => {
              callsB++
            },
            true,
          )
          // Stopping polling and clearing in Host B must NOT affect Host A's poller
          await tick(50)
          TaskOutput.stopPolling('shared-task-id')
          outB.clear()
          await Promise.race([hostATicked, tick(2500)])
        }),
      ])

      expect(callsA).toBeGreaterThanOrEqual(1)
      expect(callsB).toBe(0)
    } finally {
      outA?.clear()
      outB?.clear()
      if (outA) await outA.deleteOutputFile()
      if (outB) await outB.deleteOutputFile()
    }
  })

  test('killShellTasks: killing live shell commands on Host A never kills Host B commands', async () => {
    let killedA = 0
    let killedB = 0
    let hostAKilled!: () => void
    const waitHostAKilled = new Promise<void>(resolve => {
      hostAKilled = resolve
    })
    let hostBRegistered!: () => void
    const waitHostBRegistered = new Promise<void>(resolve => {
      hostBRegistered = resolve
    })

    await Promise.all([
      runWithNewHostSession({ id: 'kill-host-a' }, async () => {
        _resetLiveShellKillStateForTesting()
        const unregisterA = registerLiveShellCommand({
          status: 'running',
          kill: () => {
            killedA++
          },
        })
        await waitHostBRegistered
        killLiveShellCommands()
        hostAKilled()
        unregisterA()
      }),
      runWithNewHostSession({ id: 'kill-host-b' }, async () => {
        _resetLiveShellKillStateForTesting()
        const unregisterB = registerLiveShellCommand({
          status: 'running',
          kill: () => {
            killedB++
          },
        })
        hostBRegistered()
        await waitHostAKilled
        expect(killedA).toBe(1)
        expect(killedB).toBe(0)
        killLiveShellCommands()
        expect(killedB).toBe(1)
        unregisterB()
      }),
    ])

    expect(killedA).toBe(1)
    expect(killedB).toBe(1)
  })

  test('LocalAgentTask & StreamingToolExecutor: strandedAgentResume, permission waits, token throttle, and exclusiveCallQueuedBehind isolate per host/session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'lat-host-a' }, async () => {
        const seen: string[] = []
        const unsub = strandedAgentResume.subscribe(id => seen.push(id))
        resetSubagentTokenThrottleState()
        clearAgentPermissionWaits()
        const unregWait = registerAgentPermissionWait(
          'same-session-key',
          'req-1',
          'agent-1',
          'Bash',
          1000,
        )
        exclusiveCallQueuedBehind.set('toolu_shared', {
          isQueued: () => true,
          mayYetBeQueued: () => false,
          holdLogged: false,
        })
        const firstThrottle = shouldThrottleSubagentTokenUpdate({
          taskId: 'sub-1',
          runningSubagentCount: 25,
          tokenOnlyChange: true,
          nowMs: 10_000,
        })
        await tick(15)
        strandedAgentResume.emit('agent-from-a')
        const secondThrottle = shouldThrottleSubagentTokenUpdate({
          taskId: 'sub-1',
          runningSubagentCount: 25,
          tokenOnlyChange: true,
          nowMs: 11_000,
        })
        const askNotice = getAgentAskNoticeAttachment(
          'same-session-key',
          {
            get: () =>
              ({
                id: 'agent-1',
                type: 'local_agent',
                status: 'running',
              }) as never,
          },
          [],
          [],
          40_000,
        )
        const hasExclusive = exclusiveCallQueuedBehind.has('toolu_shared')
        unregWait()
        unsub()
        exclusiveCallQueuedBehind.delete('toolu_shared')
        return {
          seen,
          firstThrottle,
          secondThrottle,
          askNoticeCount: askNotice.length,
          hasExclusive,
        }
      }),
      runWithNewHostSession({ id: 'lat-host-b' }, async () => {
        const seen: string[] = []
        const unsub = strandedAgentResume.subscribe(id => seen.push(id))
        resetSubagentTokenThrottleState()
        clearAgentPermissionWaits()
        await tick(20)
        // Host B must NOT see Host A's strandedAgentResume emit, permission wait,
        // token throttle timestamp, or exclusiveCallQueuedBehind entry.
        const firstThrottleInB = shouldThrottleSubagentTokenUpdate({
          taskId: 'sub-1',
          runningSubagentCount: 25,
          tokenOnlyChange: true,
          nowMs: 11_000,
        })
        const askNoticeInB = getAgentAskNoticeAttachment(
          'same-session-key',
          {
            get: () =>
              ({
                id: 'agent-1',
                type: 'local_agent',
                status: 'running',
              }) as never,
          },
          [],
          [],
          40_000,
        )
        const hasExclusiveInB = exclusiveCallQueuedBehind.has('toolu_shared')
        unsub()
        return {
          seen,
          firstThrottleInB,
          askNoticeCountInB: askNoticeInB.length,
          hasExclusiveInB,
        }
      }),
    ])

    expect(resA.seen).toEqual(['agent-from-a'])
    expect(resA.firstThrottle).toBe(false)
    expect(resA.secondThrottle).toBe(true)
    expect(resA.askNoticeCount).toBe(1)
    expect(resA.hasExclusive).toBe(true)

    expect(resB.seen).toEqual([])
    expect(resB.firstThrottleInB).toBe(false)
    expect(resB.askNoticeCountInB).toBe(0)
    expect(resB.hasExclusiveInB).toBe(false)
  })

  test('remoteToolCall & remoteToolHost: announced host and defaultSessionRegistry isolate per root session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'rt-host-a' }, async () => {
        noteRemoteToolHost({
          instanceId: 'a1',
          hostName: 'machine-a',
          live: { status: 'online', lastHeardAt: Date.now() },
          stale: false,
        })
        defaultSessionRegistry.accept({
          name: 'machine-a',
          instanceId: 'a1',
          tools: [{ name: 'Bash', refusedInputFields: [] }],
        })
        await tick(15)
        return {
          announcedName: currentRemoteToolHost()?.hostName,
          machineNames: defaultSessionRegistry.machines.map(m => m.name),
        }
      }),
      runWithNewHostSession({ id: 'rt-host-b' }, async () => {
        await tick(10)
        const beforeSet = currentRemoteToolHost()
        noteRemoteToolHost({
          instanceId: 'b1',
          hostName: 'machine-b',
          live: { status: 'online', lastHeardAt: Date.now() },
          stale: false,
        })
        return {
          beforeSet,
          announcedName: currentRemoteToolHost()?.hostName,
          machineNames: defaultSessionRegistry.machines.map(m => m.name),
        }
      }),
    ])

    expect(resA.announcedName).toBe('machine-a')
    expect(resA.machineNames).toEqual(['machine-a'])
    expect(resB.beforeSet).toBeNull()
    expect(resB.announcedName).toBe('machine-b')
    expect(resB.machineNames).toEqual([])
  })

  test('FileReadTool: fileReadListeners isolate per root session', async () => {
    const dir = makeTempDir('wave5-fileread-')
    const filePath = join(dir, 'sample.txt')
    writeFileSync(filePath, 'hello wave 5\n', 'utf8')

    const makeMockContext = (): ToolUseContext =>
      ({
        abortController: new AbortController(),
        readFileState: new Map(),
        options: {
          tools: [],
          mainLoopModel: 'claude-sonnet-4-6',
        },
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
        }),
      }) as unknown as ToolUseContext

    const callsA: string[] = []
    const callsB: string[] = []

    let hostAReadDone!: () => void
    const waitHostAReadDone = new Promise<void>(resolve => {
      hostAReadDone = resolve
    })
    let hostBRegistered!: () => void
    const waitHostBRegistered = new Promise<void>(resolve => {
      hostBRegistered = resolve
    })

    await Promise.all([
      runWithNewHostSession({ id: 'fr-host-a', cwd: dir }, async () => {
        const unsubA = registerFileReadListener((p, _c) => callsA.push(p))
        try {
          await waitHostBRegistered
          await FileReadTool.call({ file_path: filePath }, makeMockContext())
          hostAReadDone()
        } finally {
          unsubA()
        }
      }),
      runWithNewHostSession({ id: 'fr-host-b', cwd: dir }, async () => {
        const unsubB = registerFileReadListener((p, _c) => callsB.push(p))
        try {
          hostBRegistered()
          await waitHostAReadDone
          expect(callsA.length).toBe(1)
          expect(callsB.length).toBe(0)
          await FileReadTool.call({ file_path: filePath }, makeMockContext())
        } finally {
          unsubB()
        }
      }),
    ])

    expect(callsA.length).toBe(1)
    expect(callsB.length).toBe(1)
  })

  test('LocalMemoryRecallTool: FETCH_BUDGET_USED isolates per root session for identical turnKey', async () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const configDir = makeTempDir('wave5-memrecall-')
    process.env.CLAUDE_CONFIG_DIR = configDir

    try {
      // 50KB payload with preview_only: false consumes 50KB per fetch.
      // 2 fetches fill the 100KB PER_TURN_FETCH_BUDGET_BYTES; the 3rd fetch
      // in the same session + turnKey must be refused with budget_exceeded.
      const bigPayload = 'A'.repeat(50 * 1024)
      setEntry('notes', 'big', bigPayload)

      const sharedTurnContext = {
        messages: [{ type: 'assistant', uuid: 'shared-turn-uuid' }],
      } as unknown as ToolUseContext

      let hostADone!: () => void
      const waitHostADone = new Promise<void>(resolve => {
        hostADone = resolve
      })

      type RecallOutput = {
        value?: string
        budget_exceeded?: boolean
        error?: string
      }

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'lmr-host-a' }, async () => {
          _resetFetchBudgetForTest()
          const first = await LocalMemoryRecallTool.call(
            {
              action: 'fetch',
              store: 'notes',
              key: 'big',
              preview_only: false,
            },
            sharedTurnContext,
          )
          const second = await LocalMemoryRecallTool.call(
            {
              action: 'fetch',
              store: 'notes',
              key: 'big',
              preview_only: false,
            },
            sharedTurnContext,
          )
          const third = await LocalMemoryRecallTool.call(
            {
              action: 'fetch',
              store: 'notes',
              key: 'big',
              preview_only: false,
            },
            sharedTurnContext,
          )
          hostADone()
          return {
            firstData: first.data as RecallOutput,
            secondData: second.data as RecallOutput,
            thirdData: third.data as RecallOutput,
          }
        }),
        runWithNewHostSession({ id: 'lmr-host-b' }, async () => {
          _resetFetchBudgetForTest()
          await waitHostADone
          // Same turnKey as Host A, but Host B has its own fresh 100KB budget.
          const firstInB = await LocalMemoryRecallTool.call(
            {
              action: 'fetch',
              store: 'notes',
              key: 'big',
              preview_only: false,
            },
            sharedTurnContext,
          )
          return {
            firstDataInB: firstInB.data as RecallOutput,
          }
        }),
      ])

      expect(resA.firstData.value).toContain('AAAA')
      expect(resA.secondData.value).toContain('AAAA')
      expect(resA.thirdData.budget_exceeded).toBe(true)
      expect(resB.firstDataInB.value).toContain('AAAA')
      expect(resB.firstDataInB.budget_exceeded).toBeUndefined()
    } finally {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
    }
  })

  test('WebFetchTool: cachedWebFetchTtlMs and URL_CACHE isolate per host', async () => {
    const prevTtl = process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
    const g = globalThis as Record<string, unknown>
    const prevMacro = g.MACRO
    if (prevMacro === undefined) {
      g.MACRO = { VERSION: '2.1.331' }
    }
    let fetchCount = 0
    const axiosSpy = spyOn(axios, 'get').mockImplementation((async () => {
      fetchCount++
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        data: Buffer.from(`response-${fetchCount}`, 'utf8'),
      }
    }) as unknown as typeof axios.get)

    try {
      const targetUrl = 'https://example.com/wave5-isolation'
      let hostACached!: () => void
      const waitHostACached = new Promise<void>(resolve => {
        hostACached = resolve
      })

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'wf-host-a' }, async () => {
          resetWebFetchCacheTtlMsForTests()
          clearWebFetchCache()
          process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = '12345'
          const ttlA1 = getWebFetchCacheTtlMs()
          const first = await getURLMarkdownContent(
            targetUrl,
            new AbortController(),
          )
          const cached = await getURLMarkdownContent(
            targetUrl,
            new AbortController(),
          )
          hostACached()
          await tick(25)
          const ttlA2 = getWebFetchCacheTtlMs()
          return {
            ttlA1,
            ttlA2,
            firstContent: 'content' in first ? first.content : '',
            cachedContent: 'content' in cached ? cached.content : '',
          }
        }),
        runWithNewHostSession({ id: 'wf-host-b' }, async () => {
          await waitHostACached
          resetWebFetchCacheTtlMsForTests()
          clearWebFetchCache()
          process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = '67890'
          const ttlB = getWebFetchCacheTtlMs()
          // Host B must NOT hit Host A's URL_CACHE entry; it must perform its own fetch.
          const firstInB = await getURLMarkdownContent(
            targetUrl,
            new AbortController(),
          )
          return {
            ttlB,
            firstContentInB: 'content' in firstInB ? firstInB.content : '',
          }
        }),
      ])

      expect(resA.ttlA1).toBe(12345)
      expect(resA.ttlA2).toBe(12345)
      expect(resB.ttlB).toBe(67890)
      expect(resA.firstContent).toBe('response-1')
      expect(resA.cachedContent).toBe('response-1')
      expect(resB.firstContentInB).toBe('response-2')
      expect(fetchCount).toBe(2)
    } finally {
      axiosSpy.mockRestore()
      if (prevMacro === undefined) {
        delete g.MACRO
      } else {
        g.MACRO = prevMacro
      }
      if (prevTtl === undefined) {
        delete process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
      } else {
        process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS = prevTtl
      }
    }
  })

  test('modelRedirectGuard: countedRedirects isolates per host', async () => {
    const loggedA: Array<{ eventName: string; bucket?: unknown }> = []
    const loggedB: Array<{ eventName: string; bucket?: unknown }> = []

    await Promise.all([
      runWithNewHostSession({ id: 'mrg-host-a' }, async () => {
        resetAnalyticsForTesting()
        attachAnalyticsSink({
          logEvent(eventName, metadata) {
            loggedA.push({ eventName, bucket: metadata.bucket })
          },
          async logEventAsync(eventName, metadata) {
            loggedA.push({ eventName, bucket: metadata.bucket })
          },
        })
        try {
          resetApiRedirectCountsForTests()
          recordApiRedirect(
            'model_call_refused',
            'https://api.anthropic.com/v1/messages',
            { href: 'https://evil.example/v1/messages' },
          )
          // Duplicate within Host A must be deduplicated
          recordApiRedirect(
            'model_call_refused',
            'https://api.anthropic.com/v1/messages',
            { href: 'https://evil.example/v1/messages' },
          )
        } finally {
          resetAnalyticsForTesting()
        }
      }),
      runWithNewHostSession({ id: 'mrg-host-b' }, async () => {
        await tick(10)
        resetAnalyticsForTesting()
        attachAnalyticsSink({
          logEvent(eventName, metadata) {
            loggedB.push({ eventName, bucket: metadata.bucket })
          },
          async logEventAsync(eventName, metadata) {
            loggedB.push({ eventName, bucket: metadata.bucket })
          },
        })
        try {
          resetApiRedirectCountsForTests()
          // Same bucket on Host B must STILL be emitted once (not suppressed by Host A)
          recordApiRedirect(
            'model_call_refused',
            'https://api.anthropic.com/v1/messages',
            { href: 'https://evil.example/v1/messages' },
          )
          recordApiRedirect(
            'model_call_refused',
            'https://api.anthropic.com/v1/messages',
            { href: 'https://evil.example/v1/messages' },
          )
        } finally {
          resetAnalyticsForTesting()
        }
      }),
    ])

    const redirectEventsA = loggedA.filter(
      e => e.eventName === 'tengu_api_redirect',
    )
    const redirectEventsB = loggedB.filter(
      e => e.eventName === 'tengu_api_redirect',
    )
    expect(redirectEventsA.length).toBe(1)
    expect(redirectEventsB.length).toBe(1)
    expect(redirectEventsA[0]?.bucket).toBe('model_call_refused_other_origin')
    expect(redirectEventsB[0]?.bucket).toBe('model_call_refused_other_origin')
  })

  test('claude.ts: mediaItemCapBySession isolates per root session', async () => {
    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'media-host-a' }, async () => {
        setSessionMediaItemCap('shared-session-id', {
          model: 'claude-opus-4-6',
          limit: 255,
          gaveUp: false,
        })
        await tick(15)
        const cap = getSessionMediaItemCap(
          'shared-session-id',
          'claude-opus-4-6',
        )
        clearSessionMediaItemCap('shared-session-id')
        return cap
      }),
      runWithNewHostSession({ id: 'media-host-b' }, async () => {
        await tick(5)
        const before = getSessionMediaItemCap(
          'shared-session-id',
          'claude-opus-4-6',
        )
        setSessionMediaItemCap('shared-session-id', {
          model: 'claude-opus-4-6',
          limit: 127,
          gaveUp: true,
        })
        await tick(20)
        const after = getSessionMediaItemCap(
          'shared-session-id',
          'claude-opus-4-6',
        )
        return { before, after }
      }),
    ])

    expect(resA?.limit).toBe(255)
    expect(resA?.gaveUp).toBe(false)
    expect(resB.before).toBeUndefined()
    expect(resB.after?.limit).toBe(127)
    expect(resB.after?.gaveUp).toBe(true)
  })

  test('compactWarningState: compactWarningStore isolates state and subscribers per root session', async () => {
    let notifiedA = 0
    let notifiedB = 0
    let hostASuppressed!: () => void
    const waitHostASuppressed = new Promise<void>(resolve => {
      hostASuppressed = resolve
    })
    let hostBChecked!: () => void
    const waitHostBChecked = new Promise<void>(resolve => {
      hostBChecked = resolve
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'cw-host-a' }, async () => {
        const unsub = compactWarningStore.subscribe(() => {
          notifiedA++
        })
        try {
          suppressCompactWarning()
          const suppressed = compactWarningStore.getState()
          hostASuppressed()
          await waitHostBChecked
          clearCompactWarningSuppression()
          const cleared = compactWarningStore.getState()
          return { suppressed, cleared }
        } finally {
          unsub()
        }
      }),
      runWithNewHostSession({ id: 'cw-host-b' }, async () => {
        const unsub = compactWarningStore.subscribe(() => {
          notifiedB++
        })
        try {
          await waitHostASuppressed
          const seenInB = compactWarningStore.getState()
          hostBChecked()
          return { seenInB }
        } finally {
          unsub()
        }
      }),
    ])

    expect(resA.suppressed).toBe(true)
    expect(resA.cleared).toBe(false)
    expect(resB.seenInB).toBe(false)
    expect(notifiedA).toBe(2)
    expect(notifiedB).toBe(0)
  })

  test('batchingReminder & totalTokensReminder: latches and anchor peaks isolate per root session', async () => {
    const prevThimble = process.env[TOASTY_THIMBLE_ENV]
    const prevForceMid = process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'

    try {
      let hostALatched!: () => void
      const waitHostALatched = new Promise<void>(resolve => {
        hostALatched = resolve
      })
      let hostBLatched!: () => void
      const waitHostBLatched = new Promise<void>(resolve => {
        hostBLatched = resolve
      })

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: 'rem-host-a' }, async () => {
          resetBatchingReminderLatch()
          resetTotalTokensReminderStateForTests()
          process.env[TOASTY_THIMBLE_ENV] = 'Host A batch tip'
          const batchA1 = resolveBatchingReminderText(
            { id: 'same-conv-id' },
            'claude-mythos-5',
          )
          reanchorTotalTokensReminder('main', 1000)
          const peakA1 = peakTaskUsedSinceAnchor('main', 6000)
          hostALatched()
          await waitHostBLatched
          // Must still return Host A's latched reminder and anchor peak
          const batchA2 = resolveBatchingReminderText(
            { id: 'same-conv-id' },
            'claude-mythos-5',
          )
          const peakA2 = peakTaskUsedSinceAnchor('main', 4000)
          return { batchA1, batchA2, peakA1, peakA2 }
        }),
        runWithNewHostSession({ id: 'rem-host-b' }, async () => {
          resetBatchingReminderLatch()
          resetTotalTokensReminderStateForTests()
          await waitHostALatched
          process.env[TOASTY_THIMBLE_ENV] = 'Host B batch tip'
          const batchB = resolveBatchingReminderText(
            { id: 'same-conv-id' },
            'claude-mythos-5',
          )
          reanchorTotalTokensReminder('main', 5500)
          const peakB = peakTaskUsedSinceAnchor('main', 6000)
          hostBLatched()
          return { batchB, peakB }
        }),
      ])

      expect(resA.batchA1).toBe('Host A batch tip')
      expect(resA.batchA2).toBe('Host A batch tip')
      expect(resB.batchB).toBe('Host B batch tip')
      expect(resA.peakA1).toBe(5000)
      expect(resA.peakA2).toBe(5000)
      expect(resB.peakB).toBe(500)
    } finally {
      if (prevThimble === undefined) {
        delete process.env[TOASTY_THIMBLE_ENV]
      } else {
        process.env[TOASTY_THIMBLE_ENV] = prevThimble
      }
      if (prevForceMid === undefined) {
        delete process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM
      } else {
        process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = prevForceMid
      }
    }
  })
})
