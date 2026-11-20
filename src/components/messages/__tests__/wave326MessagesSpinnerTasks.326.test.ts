import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { TaskState } from '../../../tasks/types.js'
import {
  commandAsHint,
  MAX_HINT_LINES,
} from '../../../utils/collapseReadSearch.js'
import { EMPTY_LOOKUPS } from '../../../utils/messages.js'
import { IDLE_WINDOW_KEEPALIVE_REASON } from '../../../utils/task/framework.js'
import {
  describeAgentWaitingOn,
  getAgentStatusParts,
  isAgentWaitingOnBackgroundWork,
} from '../../CoordinatorAgentStatus.js'
import { shouldSuppressTurnDurationForFailedOrRefusedTurn } from '../../Messages.js'
import {
  classifyFailedTurnAction,
  getFailedRequestPlaceholder,
} from '../../PromptInput/usePromptInputPlaceholder.js'
import {
  formatOwnerSubagentLabel,
  getBackgroundTaskItemPresentation,
} from '../../tasks/BackgroundTask.js'
import {
  resolveCollapsedGroupActiveState,
  selectActiveDisplayCall,
} from '../CollapsedReadSearchContent.js'
import { isRateLimitStillActive } from '../RateLimitMessage.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('Wave 326 Group 4B — Messages / Spinner / Tasks / REPL', () => {
  test('#110 describeAgentWaitingOn & formatOwnerSubagentLabel', () => {
    const parentAgent = {
      id: 'agent-1',
      type: 'local_agent',
      agentType: 'Explore',
      description: 'Search files',
      status: 'completed',
      startTime: 1000,
      endTime: 2000,
      pendingMessages: [],
      messages: [],
      keepaliveReasons: new Set(['shell:sh-1']),
    } as unknown as TaskState
    const childShell = {
      id: 'sh-1',
      type: 'local_bash',
      command: 'npm test',
      description: 'npm test',
      status: 'running',
      isBackgrounded: true,
      agentId: 'agent-1',
      startTime: 1500,
    } as unknown as TaskState
    const tasks = { 'agent-1': parentAgent, 'sh-1': childShell }

    expect(isAgentWaitingOnBackgroundWork(parentAgent)).toBe(true)
    const waiting = describeAgentWaitingOn(parentAgent as never, tasks)
    expect(waiting?.label).toBe('waiting on 1 command')
    expect(waiting?.since).toBe(1500)

    const status = getAgentStatusParts(parentAgent as never, 3000, false, tasks)
    expect(status.held?.label).toBe('waiting on 1 command')

    // Idle-window-only keepalive is NOT waiting on background work
    const idleOnly = {
      ...parentAgent,
      keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
    } as unknown as TaskState
    expect(isAgentWaitingOnBackgroundWork(idleOnly)).toBe(false)

    // /tasks owner label uses @registeredName when present, else `<agentType> subagent`
    const named = formatOwnerSubagentLabel(
      { agentId: 'agent-1' },
      tasks,
      new Map([['researcher', 'agent-1']]),
    )
    expect(named).toBe('@researcher')
    const unnamed = formatOwnerSubagentLabel(
      { agentId: 'agent-1' },
      tasks,
      new Map(),
    )
    expect(unnamed).toBe('Explore subagent')

    const pres = getBackgroundTaskItemPresentation(
      childShell as never,
      '@researcher',
    )
    expect(pres?.facts).toContain('@researcher')
  })

  test('#111 failed and stopped agents carry explicit terminalLabel', () => {
    const failedAgent = {
      id: 'a-fail',
      type: 'local_agent',
      agentType: 'Explore',
      description: 'fail',
      status: 'failed',
      startTime: 1000,
      endTime: 2500,
      pendingMessages: [],
      messages: [],
    } as unknown as TaskState
    const stoppedAgent = {
      ...failedAgent,
      id: 'a-stop',
      status: 'killed',
    } as unknown as TaskState

    expect(getAgentStatusParts(failedAgent as never, 3000).terminalLabel).toBe(
      'failed',
    )
    expect(getAgentStatusParts(stoppedAgent as never, 3000).terminalLabel).toBe(
      'stopped',
    )
  })

  test('#157 & #111 resolveCollapsedGroupActiveState', () => {
    // Active when asking permission (unanswered & loading)
    expect(
      resolveCollapsedGroupActiveState({
        toolUseIds: ['t1'],
        inProgressToolUseIDs: new Set(),
        lookups: EMPTY_LOOKUPS,
        isActiveGroupProp: true,
        isViewedAgentTerminal: false,
      }),
    ).toBe(true)

    // Inactive once resolved/errored (panel open won't flip back to "Running…")
    const resolvedLookups = {
      ...EMPTY_LOOKUPS,
      resolvedToolUseIDs: new Set(['t1']),
      erroredToolUseIDs: new Set(['t1']),
    }
    expect(
      resolveCollapsedGroupActiveState({
        toolUseIds: ['t1'],
        inProgressToolUseIDs: new Set(),
        lookups: resolvedLookups,
        isActiveGroupProp: true,
        isViewedAgentTerminal: false,
      }),
    ).toBe(false)

    // Inactive when viewing a stopped/failed background agent
    expect(
      resolveCollapsedGroupActiveState({
        toolUseIds: ['t1'],
        inProgressToolUseIDs: new Set(['t1']),
        lookups: EMPTY_LOOKUPS,
        isActiveGroupProp: true,
        isViewedAgentTerminal: true,
      }),
    ).toBe(false)
  })

  test('#159 shouldSuppressTurnDurationForFailedOrRefusedTurn', () => {
    const failedTurn = [
      {
        type: 'assistant',
        isApiErrorMessage: true,
        message: { content: [{ type: 'text', text: 'API error' }] },
      },
      { type: 'system', subtype: 'turn_duration', durationMs: 500 },
    ] as never[]
    expect(
      shouldSuppressTurnDurationForFailedOrRefusedTurn(failedTurn, 1),
    ).toBe(true)

    const okTurn = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'All done!' }] },
      },
      { type: 'system', subtype: 'turn_duration', durationMs: 500 },
    ] as never[]
    expect(shouldSuppressTurnDurationForFailedOrRefusedTurn(okTurn, 1)).toBe(
      false,
    )
  })

  test('#180 isRateLimitStillActive hides hint after resetsAt passes', () => {
    const now = 1_700_000_000_000
    expect(
      isRateLimitStillActive(
        { status: 'rejected', resetsAt: Math.floor((now + 60_000) / 1000) },
        now,
      ),
    ).toBe(true)
    expect(
      isRateLimitStillActive(
        { status: 'rejected', resetsAt: Math.floor((now - 1_000) / 1000) },
        now,
      ),
    ).toBe(false)
    expect(isRateLimitStillActive({ status: 'allowed' }, now)).toBe(false)
  })

  test('#192 selectActiveDisplayCall prefers running call over finished/queued calls', () => {
    const calls = [
      { id: 'c1', name: 'Bash', input: { command: 'echo done' } },
      { id: 'c2', name: 'Bash', input: { command: 'sleep 5' } },
      { id: 'c3', name: 'Bash', input: { command: 'echo queued' } },
    ]
    const chosen = selectActiveDisplayCall(
      calls,
      new Set(['c2']),
      new Set(['c1']),
    )
    expect(chosen?.id).toBe('c2')
  })

  test('#194 commandAsHint caps multi-line shell commands to MAX_HINT_LINES', () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => `echo ${i}`).join(
      '\n',
    )
    const hint = commandAsHint(manyLines)
    expect(hint.split('\n').length).toBeLessThanOrEqual(MAX_HINT_LINES)
    expect(hint.endsWith('…')).toBe(true)
  })

  test('#7 classifyFailedTurnAction + getFailedRequestPlaceholder', () => {
    const apiErrMsg = [
      {
        type: 'assistant',
        isApiErrorMessage: true,
        apiErrorStatus: 401,
        message: { content: [{ type: 'text', text: 'Unauthorized' }] },
      },
    ]
    const action = classifyFailedTurnAction(apiErrMsg)
    expect(action).toBe('fix_setup')
    expect(getFailedRequestPlaceholder(action)).toBe(
      'Once fixed, resend your message',
    )

    const transientErr = [
      {
        type: 'assistant',
        isApiErrorMessage: true,
        apiErrorStatus: 500,
        message: { content: [{ type: 'text', text: 'Internal error' }] },
      },
    ]
    expect(classifyFailedTurnAction(transientErr)).toBe('try_again')
  })

  test('#20/#40/#53/#112/#117/#131/#205/#214/#250/#257/#297/#336/#350 REPL & UI wiring', () => {
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain('subscribeSettingsFileErrorNotices')
    expect(replSrc).toContain('AUTO_CONTINUE_LOGIN_CHANGED_NOTICE')
    expect(replSrc).toContain('resolveAutoDefaultOnPolicySettingsLoad')
    expect(replSrc).toContain('buildAgentMessageContentWithImages')
    expect(replSrc).toContain('encodeOsc7501Status')
    expect(replSrc).toContain('collectProgramStatusAwaited')
    expect(replSrc).toContain('collectProgramStatusChildren')
    expect(replSrc).toContain('activeRetryStatus !== null')
    expect(replSrc).toContain(
      'retryStatus={viewingAgentTaskId ? null : retryStatus}',
    )
    expect(replSrc).toContain('afterReplyText={afterReplyText}')
    expect(replSrc).toContain('else if (draftController.value.length > 0)')
    expect(replSrc).toContain('dialog waiting')

    const attSrc = readFileSync(
      join(ROOT, 'src/components/messages/AttachmentMessage.tsx'),
      'utf8',
    )
    expect(attSrc).toContain('formatHookErrorOutput(')
    expect(attSrc).toContain('HookStatusLine')

    const spinnerSrc = readFileSync(
      join(ROOT, 'src/components/Spinner.tsx'),
      'utf8',
    )
    expect(spinnerSrc).not.toContain('showClearTip')
    expect(spinnerSrc).toContain('afterReplyText')
    // #205 Rules of Hooks: useState(suppressTipAfterReply) MUST appear before
    // the early return for `if (foregroundedTeammate?.isIdle)` so idle↔active
    // teammate transitions never change hook call count.
    const hookIdx = spinnerSrc.indexOf('useState(suppressTipAfterReply)')
    const idleEarlyReturnIdx = spinnerSrc.indexOf(
      'if (foregroundedTeammate?.isIdle)',
    )
    expect(hookIdx).toBeGreaterThan(-1)
    expect(idleEarlyReturnIdx).toBeGreaterThan(-1)
    expect(hookIdx).toBeLessThan(idleEarlyReturnIdx)

    // #188 / #257 OSC 7501 uses TerminalWriteContext, tD(), and Jk().programStatus
    expect(replSrc).toContain('React.useContext(TerminalWriteContext)')
    expect(replSrc).not.toContain('TerminalWriteProvider as unknown')
    expect(replSrc).toContain("tD().now('programStatus')")
    expect(replSrc).toContain("tD().onSettle('programStatus'")
    expect(replSrc).toContain('Jk().programStatus')
    expect(replSrc).toContain('PROGRAM_STATUS_KEEP_ALL')

    // #38 onSummarize accepts signal?: AbortSignal and guards setMessages
    expect(replSrc).toContain('signal?: AbortSignal')
    expect(replSrc).toContain('if (signal?.aborted)')

    // #26 REPL consumes pending AutoDefaultNudge stray draft into draftController
    expect(replSrc).toContain('consumePendingAutoDefaultNudgeDraft')

    // #340 REPL emits empty-quit for empty bg conversations
    expect(replSrc).toContain("detail: 'empty-quit'")
    expect(replSrc).toContain("isEmptyBgQuit ? 'empty-quit'")

    const bgHintSrc = readFileSync(
      join(ROOT, 'src/components/SessionBackgroundHint.tsx'),
      'utf8',
    )
    expect(bgHintSrc).toContain('suppressInFullscreenTranscript')

    const agentProgressSrc = readFileSync(
      join(ROOT, 'src/components/AgentProgressLine.tsx'),
      'utf8',
    )
    expect(agentProgressSrc).toContain("return 'Stopped'")
    expect(agentProgressSrc).toContain("return 'Failed'")
  })
})
