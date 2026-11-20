import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shouldKeepWorktreeOnBridgeShutdown } from '../../bridge/bridgeMain.js'
import {
  BRIDGE_MALFORMED_RESPONSE_HINT,
  BRIDGE_SESSION_NOT_BRIDGE_HINT,
  BRIDGE_SIGNATURE_WANTED_HINT,
  formatBridgeDisconnectMessage,
  isNonRetryableBridgeDetail,
} from '../../bridge/bridgeStatusUtil.js'
import { extractInboundMessageFields } from '../../bridge/inboundMessages.js'
import { resolveInitialRemoteWorkerState } from '../../bridge/remoteBridgeCore.js'
import {
  buildInitialWorkerMetadataPatch,
  shouldClearPendingActionAfterLateRead,
} from '../../bridge/replBridgeTransport.js'
import { moveOwnTaskListOnClear } from '../../commands/clear/conversation.js'
import {
  clearSharedGitStatusSummaryForTests,
  getSharedGitStatusSummary,
  parseGitStatusShortSummary,
  recordSharedGitStatusSummary,
} from '../../context.js'
import { shouldRetainProgressInMutableMessages } from '../../QueryEngine.js'
import {
  buildRequestHeadTimeoutResponse,
  buildTooManyConnectionsResponse,
  DEFAULT_MAX_CLIENT_CONNECTIONS,
  DEFAULT_REQUEST_HEAD_TIMEOUT_MS,
  getUpstreamProxyRelayStats,
  resetUpstreamProxyRelayStatsForTests,
} from '../../upstreamproxy/relay.js'
import {
  closeTtyFdsForRelaunch,
  isStartupRelaunchStarted,
  markStartupRelaunchStarted,
  occupyClosedFdWithDevNull,
  resetStartupRelaunchStartedForTests,
} from '../../utils/cliRelaunch.js'
import { shouldSubagentWaitForOwnSubagents } from '../../utils/forkSubagentGate.js'
import { getBranchForDir, getDefaultBranchForDir } from '../../utils/git.js'
import {
  notifySweptBackgroundAgents,
  shouldSuppressTaskStartedPrompt,
} from '../../utils/task/framework.js'
import {
  isGitForWindowsLauncherPath,
  resolveGitForWindowsDirectExe,
} from '../../utils/windowsPaths.js'
import { isJobWorktreeFullyUpstream } from '../../utils/worktree.js'
import {
  shouldResendWorkflowProgress,
  WORKFLOW_PROGRESS_LEGACY_CUTOFF_MS,
} from '../../workflow/taskProgressBridge.js'
import {
  handleOrphanedPermissionResponse,
  shouldDropOrphanedPermissionAfterStop,
  shouldInterruptParkedQuestionOnStreamClose,
} from '../headless/HeadlessControlPlane.js'
import {
  isDeferredToolResumeDisabled,
  PrintPeerHoldNoticeWriter,
} from '../print.js'
import {
  advanceSharedPrintBgWaitFirstIdle,
  formatPrintBgWaitCeilingMessage,
  shouldStopAgentsOnPrintBgCeiling,
} from '../printBgWait.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  resetStartupRelaunchStartedForTests()
  resetUpstreamProxyRelayStatsForTests()
  clearSharedGitStatusSummaryForTests()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 327-328 CLI / Bridge / Daemon / Proxy / Worktree', () => {
  test('#376: RC worktree shutdown keeps clean non-hook worktrees when session may resume', () => {
    expect(
      shouldKeepWorktreeOnBridgeShutdown({
        clean: true,
        sessionMayReturn: true,
        hookBased: false,
      }),
    ).toEqual({ keep: true, reason: 'session can resume' })

    expect(
      shouldKeepWorktreeOnBridgeShutdown({
        clean: true,
        sessionMayReturn: true,
        hookBased: true,
      }),
    ).toEqual({ keep: false })

    expect(
      shouldKeepWorktreeOnBridgeShutdown({
        clean: false,
        sessionMayReturn: false,
        hookBased: true,
      }).keep,
    ).toBe(true)
  })

  test('#380: orphaned permission responses are dropped after Stop or behind newer input', async () => {
    expect(
      shouldDropOrphanedPermissionAfterStop({
        sessionStoppedAfterRestart: true,
      }),
    ).toBe(true)
    expect(
      shouldDropOrphanedPermissionAfterStop({
        behindNewInput: true,
      }),
    ).toBe(true)
    expect(
      shouldDropOrphanedPermissionAfterStop({
        sessionStoppedAfterRestart: false,
        behindNewInput: false,
        alreadySettled: false,
      }),
    ).toBe(false)

    let enqueued = false
    const handled = await handleOrphanedPermissionResponse({
      message: {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-1',
          response: { behavior: 'allow', toolUseID: 'toolu_1' },
        },
      },
      setAppState: () => {},
      handledToolUseIds: new Set(),
      sessionStoppedAfterRestart: true,
      findUnresolvedToolUseFn: async () => {
        throw new Error('should not even look up transcript after stop')
      },
      enqueueFn: () => {
        enqueued = true
      },
    })
    expect(handled).toBe(false)
    expect(enqueued).toBe(false)
  })

  test('#393: moveOwnTaskListOnClear moves session task directory only when ownTaskListId differs and never sets newSessionId', async () => {
    const root = makeTempDir('wave328-tasks-')
    const oldId = '11111111-1111-1111-1111-111111111111'
    const newId = '22222222-2222-2222-2222-222222222222'
    mkdirSync(join(root, oldId), { recursive: true })
    writeFileSync(join(root, oldId, '1.json'), '{"id":"1"}', 'utf8')

    // Local /clear with ownTaskListId unset must NOT rename prevSessionId -> newSessionId
    const localNoop = await moveOwnTaskListOnClear(oldId, newId, {
      tasksRootDir: root,
      ownTaskListId: null,
    })
    expect(localNoop).toEqual({ moved: false, reason: 'same_id' })

    const setCalls: Array<string | undefined> = []
    const res = await moveOwnTaskListOnClear(oldId, newId, {
      tasksRootDir: root,
      ownTaskListId: oldId,
      setOwnTaskListId: id => {
        setCalls.push(id)
      },
    })
    expect(res).toEqual({ moved: true })
    expect(setCalls).toEqual([])
  })

  test('#401: startup relaunch latch and /dev/null fd occupation on Linux/Unix', () => {
    expect(isStartupRelaunchStarted()).toBe(false)
    markStartupRelaunchStarted()
    expect(isStartupRelaunchStarted()).toBe(true)

    // Simulate opening fds 3, 4, then hitting target fd 5
    const openedSeq = [3, 4, 5]
    let idx = 0
    const closedExtras: number[] = []
    occupyClosedFdWithDevNull(5, {
      openDevNull: () => openedSeq[idx++]!,
      closeFd: fd => closedExtras.push(fd),
    })
    expect(closedExtras).toEqual([3, 4])

    // closeTtyFdsForRelaunch skips fd 1 and fd 2
    const closedTtys: number[] = []
    const res = closeTtyFdsForRelaunch({
      maxFd: 4,
      platform: 'linux',
      isTtyFd: fd => fd === 0 || fd === 1 || fd === 2 || fd === 3,
      closeFd: fd => closedTtys.push(fd),
      openDevNull: () => 99,
    })
    expect(res).toEqual([0, 3])
    expect(closedTtys).not.toContain(1)
    expect(closedTtys).not.toContain(2)
  })

  test('#405: upstreamproxy relay exposes connection caps, 503/408 responses, and stats', () => {
    expect(DEFAULT_MAX_CLIENT_CONNECTIONS).toBe(8192)
    expect(DEFAULT_REQUEST_HEAD_TIMEOUT_MS).toBe(30_000)

    const r503 = buildTooManyConnectionsResponse(8192)
    expect(r503).toContain('HTTP/1.1 503 Service Unavailable')
    expect(r503).toContain('8192 connections open')

    const r408 = buildRequestHeadTimeoutResponse(30_000)
    expect(r408).toContain('HTTP/1.1 408 Request Timeout')
    expect(r408).toContain('within 30 s')

    const stats = getUpstreamProxyRelayStats()
    expect(stats.maxClientConnections).toBe(8192)
    expect(stats.requestHeadTimeoutMs).toBe(30_000)
    expect(stats.clientConnectionsRefused).toBe(0)
    expect(stats.requestHeadTimeouts).toBe(0)
  })

  test('#428: task_started omits prompt when local_agent was woken by a task-notification', () => {
    expect(
      shouldSuppressTaskStartedPrompt({
        type: 'local_agent',
        promptIsNotice: true,
      }),
    ).toBe(true)
    expect(
      shouldSuppressTaskStartedPrompt({
        type: 'local_agent',
        promptIsNotice: false,
      }),
    ).toBe(false)
    expect(
      shouldSuppressTaskStartedPrompt({
        type: 'local_bash',
        promptIsNotice: true,
      }),
    ).toBe(false)
  })

  test('#429: extractInboundMessageFields preserves priority="later" and origin on bridge messages', () => {
    const extracted = extractInboundMessageFields({
      type: 'user',
      uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      priority: 'later',
      origin: { kind: 'peer', from: 'other-session' },
      message: { role: 'user', content: 'hello from peer' },
    } as never)
    expect(extracted?.priority).toBe('later')
    expect(extracted?.origin).toEqual({ kind: 'peer', from: 'other-session' })
  })

  test('#439: isJobWorktreeFullyUpstream succeeds even with top-level file named HEAD', async () => {
    const repoDir = makeTempDir('wave328-wt-head-')
    const bareDir = makeTempDir('wave328-bare-')
    execFileSync('git', ['init', '--bare', bareDir], { stdio: 'pipe' })
    execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      stdio: 'pipe',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: repoDir,
      stdio: 'pipe',
    })
    writeFileSync(join(repoDir, 'HEAD'), 'not a git ref\n', 'utf8')
    execFileSync('git', ['add', 'HEAD'], { cwd: repoDir, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'add HEAD file'], {
      cwd: repoDir,
      stdio: 'pipe',
    })
    execFileSync('git', ['remote', 'add', 'origin', bareDir], {
      cwd: repoDir,
      stdio: 'pipe',
    })
    execFileSync('git', ['push', '-u', 'origin', 'main'], {
      cwd: repoDir,
      stdio: 'pipe',
    })

    const upstream = await isJobWorktreeFullyUpstream(repoDir, 'origin/main', {
      primaryCheckoutVouches: false,
    })
    expect(upstream).toBe(true)
  })

  test('#486: isGitForWindowsLauncherPath matches bin\\git.exe unless grandparent is an arch/usr dir', () => {
    expect(
      isGitForWindowsLauncherPath('C:\\Program Files\\Git\\cmd\\git.exe'),
    ).toBe(true)
    expect(
      isGitForWindowsLauncherPath('C:\\Program Files\\Git\\bin\\git.exe'),
    ).toBe(true)
    expect(
      isGitForWindowsLauncherPath(
        'C:\\Program Files\\Git\\mingw64\\bin\\git.exe',
      ),
    ).toBe(false)
    expect(
      isGitForWindowsLauncherPath('C:\\Program Files\\Git\\usr\\bin\\git.exe'),
    ).toBe(false)

    const prevMsystem = process.env.MSYSTEM
    delete process.env.MSYSTEM
    try {
      const resolved = resolveGitForWindowsDirectExe(
        'C:\\Program Files\\Git\\bin\\git.exe',
        {
          checkExists: p =>
            p.toLowerCase() === 'c:\\program files\\git\\mingw64\\bin\\git.exe',
          execCommand: cmd => {
            if (cmd.includes('--exec-path')) {
              return 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core\n'
            }
            return 'git version 2.45.0.windows.1\n'
          },
          cwdFn: () => 'C:\\Users\\dev\\project',
        },
      )
      expect(resolved.toLowerCase()).toBe(
        'c:\\program files\\git\\mingw64\\bin\\git.exe',
      )
    } finally {
      if (prevMsystem !== undefined) process.env.MSYSTEM = prevMsystem
    }
  })

  test('#527: context.ts parses & shares git status short summary per cwd', () => {
    const summary = parseGitStatusShortSummary(
      '## main\n M src/a.ts\nA  src/b.ts\n?? untracked.txt\n',
    )
    expect(summary).toEqual({
      isCleanTree: false,
      changedFileCount: 2,
      untrackedFileCount: 1,
    })
    recordSharedGitStatusSummary('/tmp/repo-a', summary)
    expect(getSharedGitStatusSummary('/tmp/repo-a')).toEqual(summary)
  })

  test('#545: CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME disables deferred tool resume', () => {
    expect(
      isDeferredToolResumeDisabled({
        CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: '1',
      }),
    ).toBe(true)
    expect(
      isDeferredToolResumeDisabled({
        CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: '0',
      }),
    ).toBe(false)
    expect(isDeferredToolResumeDisabled({})).toBe(false)
  })

  test('#584: non-retryable RC failure hints suppress reconnect prompt', () => {
    expect(isNonRetryableBridgeDetail(BRIDGE_SESSION_NOT_BRIDGE_HINT)).toBe(
      true,
    )
    expect(isNonRetryableBridgeDetail(BRIDGE_SIGNATURE_WANTED_HINT)).toBe(true)
    expect(isNonRetryableBridgeDetail(BRIDGE_MALFORMED_RESPONSE_HINT)).toBe(
      true,
    )

    const msg = formatBridgeDisconnectMessage(BRIDGE_SESSION_NOT_BRIDGE_HINT)
    expect(msg).toContain(BRIDGE_SESSION_NOT_BRIDGE_HINT)
    expect(msg).not.toContain('run /remote-control to reconnect')

    const retryable = formatBridgeDisconnectMessage('temporary socket drop')
    expect(retryable).toContain('run /remote-control to reconnect')
  })

  test('#585: initial PUT /worker omits pending_action:null when initial state read is pending', () => {
    expect(shouldClearPendingActionAfterLateRead()).toBe(true)
    const preserved = buildInitialWorkerMetadataPatch({
      initialStateReadPending: true,
      clearsCardAfterLateRead: true,
      baseMetadata: { pending_action: null, pending_actions: null, foo: 'bar' },
    })
    expect(preserved).toEqual({ foo: 'bar' })
    expect('pending_action' in preserved).toBe(false)

    const cleared = buildInitialWorkerMetadataPatch({
      initialStateReadPending: false,
      clearsCardAfterLateRead: true,
      baseMetadata: { foo: 'bar' },
    })
    expect(cleared).toEqual({
      pending_action: null,
      pending_actions: null,
      foo: 'bar',
    })
  })

  test('#590: getBranchForDir and getDefaultBranchForDir resolve target repo independent of originalCwd', async () => {
    const repoB = makeTempDir('wave328-repo-b-')
    execFileSync('git', ['init', '-b', 'main', repoB], { stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoB,
      stdio: 'pipe',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: repoB,
      stdio: 'pipe',
    })
    writeFileSync(join(repoB, 'a.txt'), 'init\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: repoB, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'init'], {
      cwd: repoB,
      stdio: 'pipe',
    })
    execFileSync('git', ['checkout', '-b', 'feat/second-repo'], {
      cwd: repoB,
      stdio: 'pipe',
    })

    expect(await getBranchForDir(repoB)).toBe('feat/second-repo')
    expect(await getDefaultBranchForDir(repoB)).toBe('main')
  })

  test('#591: workflow progress resend stays active past 1h on IDE/SDK/modern Desktop', () => {
    const overOneHour = WORKFLOW_PROGRESS_LEGACY_CUTOFF_MS + 60_000
    expect(
      shouldResendWorkflowProgress({
        isNonInteractive: true,
        elapsedSinceLastProgressMs: overOneHour,
        entrypoint: 'claude-vscode',
      }),
    ).toBe(true)
    expect(
      shouldResendWorkflowProgress({
        isNonInteractive: true,
        elapsedSinceLastProgressMs: overOneHour,
        entrypoint: 'sdk-ts',
      }),
    ).toBe(true)
    expect(
      shouldResendWorkflowProgress({
        isNonInteractive: true,
        elapsedSinceLastProgressMs: overOneHour,
        entrypoint: 'claude-desktop',
        desktopVersion: '6.7665.0',
      }),
    ).toBe(true)
    expect(
      shouldResendWorkflowProgress({
        isNonInteractive: true,
        elapsedSinceLastProgressMs: overOneHour,
        entrypoint: 'claude-desktop',
        desktopVersion: '6.7664.0',
      }),
    ).toBe(false)
  })

  test('#592: idle Desktop/VS Code session turning RC on reports idle instead of running', () => {
    expect(
      resolveInitialRemoteWorkerState({
        isTurnUnderWay: false,
        holdsRunning: false,
        queuedTurnCount: 0,
        explicitInitialState: 'running',
      }),
    ).toBe('idle')
    expect(
      resolveInitialRemoteWorkerState({
        isTurnUnderWay: true,
        holdsRunning: false,
        queuedTurnCount: 0,
      }),
    ).toBe('running')
    expect(
      resolveInitialRemoteWorkerState({
        isTurnUnderWay: false,
        holdsRunning: true,
        queuedTurnCount: 0,
      }),
    ).toBe('running')
  })

  test('#593: notifySweptBackgroundAgents enqueues killed task-notification for stopped background agents', () => {
    const enqueued: Array<{
      value: string
      mode: string
      shouldQuery: boolean
      isMeta: boolean
      skipAttachments: boolean
      priority: string
      taskId: string
      userStopNotice: boolean
    }> = []
    let state: Record<string, unknown> = {
      tasks: {
        'agent-1': {
          id: 'agent-1',
          type: 'local_agent',
          status: 'running',
          description: 'Explore <codebase> & "docs"',
          toolUseId: 'toolu_<1>&x',
          isBackgrounded: true,
          ownerAgentId: 'main',
          notified: false,
        },
        'subagent-child': {
          id: 'subagent-child',
          type: 'local_agent',
          status: 'running',
          description: 'Owned by another subagent',
          isBackgrounded: true,
          ownerAgentId: 'other-subagent-123',
          notified: false,
        },
        'fg-1': {
          id: 'fg-1',
          type: 'local_agent',
          status: 'running',
          description: 'Foreground',
          isBackgrounded: false,
          notified: false,
        },
      },
    }
    const ids = notifySweptBackgroundAgents(
      state.tasks as never,
      updater => {
        state = updater(state as never) as unknown as Record<string, unknown>
      },
      {
        reason: 'stopped <by> & user',
        enqueue: n => enqueued.push(n),
      },
    )
    expect(ids).toEqual(['agent-1'])
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({
      mode: 'task-notification',
      shouldQuery: false,
      isMeta: true,
      skipAttachments: true,
      priority: 'next',
      taskId: 'agent-1',
      userStopNotice: true,
    })
    expect(enqueued[0]!.value).toContain('<status>killed</status>')
    expect(enqueued[0]!.value).toContain(
      '<tool-use-id>toolu_&lt;1&gt;&amp;x</tool-use-id>',
    )
    expect(enqueued[0]!.value).toContain(
      'Agent "Explore &lt;codebase&gt; &amp; "docs"" stopped &lt;by&gt; &amp; user',
    )
  })

  test('#647: QueryEngine skips retaining ephemeral progress messages in mutableMessages', () => {
    expect(
      shouldRetainProgressInMutableMessages({
        type: 'progress',
        data: { type: 'bash_progress' },
      }),
    ).toBe(false)
    expect(
      shouldRetainProgressInMutableMessages({
        type: 'progress',
        data: { type: 'tool_progress' },
      }),
    ).toBe(false)
    expect(
      shouldRetainProgressInMutableMessages({
        type: 'assistant',
      }),
    ).toBe(true)
  })

  test('#659: PrintPeerHoldNoticeWriter writes stderr notice in text mode only', () => {
    const stderrLines: string[] = []
    const textWriter = new PrintPeerHoldNoticeWriter('text', {
      writeStderr: s => stderrLines.push(s),
      isEnabled: () => true,
    })
    const emitted = textWriter.observe({
      type: 'system',
      subtype: 'peer_message_hold',
      from: 'worker-a',
      state: 'held',
    })
    expect(emitted).toContain('worker-a')
    expect(emitted).toContain('held for approval')
    expect(emitted).toContain('crossSessionInbound')
    expect(stderrLines).toHaveLength(1)

    const jsonWriter = new PrintPeerHoldNoticeWriter('json', {
      writeStderr: s => stderrLines.push(s),
      isEnabled: () => true,
    })
    expect(
      jsonWriter.observe({
        type: 'system',
        subtype: 'peer_message_hold',
        from: 'worker-a',
        state: 'dropped',
      }),
    ).toBeUndefined()
    expect(stderrLines).toHaveLength(1)
  })

  test('#669: shouldSubagentWaitForOwnSubagents defaults true for -p/SDK/Desktop/VS Code with FORK_SUBAGENT=0', () => {
    expect(
      shouldSubagentWaitForOwnSubagents({
        env: { CLAUDE_CODE_FORK_SUBAGENT: '0' },
        isNonInteractive: true,
        gbValue: true,
      }),
    ).toBe(true)
    expect(
      shouldSubagentWaitForOwnSubagents({
        env: { CLAUDE_CODE_FORK_SUBAGENT: '0' },
        entrypoint: 'claude-vscode',
        gbValue: true,
      }),
    ).toBe(true)
    expect(
      shouldSubagentWaitForOwnSubagents({
        env: { CLAUDE_CODE_FORK_SUBAGENT: '1' },
        isNonInteractive: true,
        gbValue: true,
      }),
    ).toBe(false)
  })

  test('#670: shared printBgWaitFirstIdle does not reset across chained subagents', () => {
    const t0 = 1_000_000
    const first = advanceSharedPrintBgWaitFirstIdle({
      firstIdleAt: null,
      hasRunningBgTasks: true,
      now: t0,
    })
    expect(first).toBe(t0)
    const second = advanceSharedPrintBgWaitFirstIdle({
      firstIdleAt: first,
      hasRunningBgTasks: true,
      now: t0 + 300_000,
    })
    expect(second).toBe(t0)
    expect(
      advanceSharedPrintBgWaitFirstIdle({
        firstIdleAt: second,
        hasRunningBgTasks: false,
        now: t0 + 301_000,
      }),
    ).toBeNull()
    expect(shouldStopAgentsOnPrintBgCeiling(true)).toBe(true)
    expect(formatPrintBgWaitCeilingMessage(600_000, 'subagent-A')).toContain(
      '10m after the last turn (subagent-A); stopping them',
    )
  })

  test('#673: shouldInterruptParkedQuestionOnStreamClose defaults to interrupt on 3P or GrowthBook off', () => {
    expect(
      shouldInterruptParkedQuestionOnStreamClose({
        isFirstParty: false,
        isGrowthBookEnabled: true,
      }),
    ).toBe(true)
    expect(
      shouldInterruptParkedQuestionOnStreamClose({
        isFirstParty: true,
        isGrowthBookEnabled: false,
      }),
    ).toBe(true)
    expect(
      shouldInterruptParkedQuestionOnStreamClose({
        flagValue: 'interrupt',
      }),
    ).toBe(true)
    expect(
      shouldInterruptParkedQuestionOnStreamClose({
        flagValue: 'off',
      }),
    ).toBe(false)
  })

  test('#593/#387/#405/#585 regressions: swept agent status/id filter, bgManager disk account & spare race guard, relay error handler order, ccrClient stale pending_action clear', () => {
    // #593: already-completed or failed background agents must NEVER be falsely reported as killed
    const notifications: Array<{ value: string; mode: string }> = []
    let state: { tasks: Record<string, unknown> } = {
      tasks: {
        'agent-running': {
          id: 'agent-running',
          type: 'local_agent',
          status: 'running',
          description: 'Running worker',
          isBackgrounded: true,
          notified: false,
        },
        'agent-completed': {
          id: 'agent-completed',
          type: 'local_agent',
          status: 'completed',
          description: 'Completed worker',
          isBackgrounded: true,
          notified: false,
        },
        'agent-failed': {
          id: 'agent-failed',
          type: 'local_agent',
          status: 'failed',
          description: 'Failed worker',
          isBackgrounded: true,
          notified: false,
        },
      },
    }
    const notified = notifySweptBackgroundAgents(
      state.tasks as never,
      ((updater: (prev: typeof state) => typeof state) => {
        state = updater(state)
      }) as never,
      {
        sweptIds: ['agent-running', 'agent-completed', 'agent-failed'],
        enqueue: n => notifications.push(n),
      },
    )
    expect(notified).toEqual(['agent-running'])
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.value).toContain('agent-running')
    expect(notifications[0]!.value).not.toContain('agent-completed')
    expect(notifications[0]!.value).not.toContain('agent-failed')

    // #387: bgManager uses disk account info and guards heldSpare === spare
    const bgSrc = readFileSync(
      join(import.meta.dir, '../../daemon/bgManager.ts'),
      'utf8',
    )
    expect(bgSrc).toContain('getOauthAccountInfoFromDisk()')
    expect(bgSrc).toContain('if (heldSpare === spare)')

    // #405: relay attaches error/close before trackAcceptedConn
    const relaySrc = readFileSync(
      join(import.meta.dir, '../../upstreamproxy/relay.ts'),
      'utf8',
    )
    const errIdx = relaySrc.indexOf("sock.on('error'")
    const trackIdx = relaySrc.indexOf('trackAcceptedConn(adapter')
    expect(errIdx).toBeGreaterThan(-1)
    expect(trackIdx).toBeGreaterThan(errIdx)

    // #585: ccrClient clears stale pending_action after restoredPromise resolves
    const ccrSrc = readFileSync(
      join(import.meta.dir, '../transports/ccrClient.ts'),
      'utf8',
    )
    expect(ccrSrc).toContain('hadStalePendingAction')
    expect(ccrSrc).toContain('pending_action: null')
    expect(ccrSrc).toContain('pending_actions: null')
  })
})
