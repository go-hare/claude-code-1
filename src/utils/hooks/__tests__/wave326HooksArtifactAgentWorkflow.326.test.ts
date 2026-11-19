import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyGoalStateUpdateIfUnchanged,
  bumpGoalMutationEpoch,
  getGoalMutationEpoch,
  isSameActiveGoal,
} from '../../../commands/goal.js'
import { isPathInBackgroundSessionTmp } from '../../../services/artifactAutoReact/readPerm/uploadReadGate.js'
import {
  formatSubagentTakeoverNotice,
  resetSubagentTokenThrottleState,
  shouldThrottleSubagentTokenUpdate,
} from '../../../tasks/LocalAgentTask/LocalAgentTask.js'
import {
  buildRecoveryHint,
  formatWorkflowResumeCacheSummary,
} from '../../../workflow/notifications.js'
import {
  isIgnoredHttpHookHeader,
  isManagedHttpHookSource,
} from '../execHttpHook.js'
import {
  formatHookErrorOutput,
  HOOK_ERROR_EXPANDED_MAX_CHARS,
  HOOK_EXIT_127_PRETOOL_MESSAGE,
} from '../hookErrorDisplay.js'
import {
  countToolUses,
  isCloudArtifactMcpTool,
} from '../../../../packages/builtin-tools/src/tools/AgentTool/agentToolUtils.js'
import { formatArtifactPublishVisibilityNote } from '../../../../packages/builtin-tools/src/tools/ArtifactTool/mapToolResultSentences.js'
import { findActiveWorktreeTasks } from '../../../../packages/builtin-tools/src/tools/ExitWorktreeTool/ExitWorktreeTool.js'

describe('Wave 326 Group 3 — Hooks, /goal, Artifact, Agent, ExitWorktree & Workflow', () => {
  test('#53 & #249: Node/Python stack trace prefers real error line, Ctrl+O expands to 10,000 chars, exit 127 notes check may not have run', () => {
    const pyTrace = [
      'Traceback (most recent call last):',
      '  File "/tmp/hook.py", line 12, in <module>',
      '    main()',
      'ValueError: invalid hook input',
    ].join('\n')
    expect(formatHookErrorOutput(pyTrace, '', false)).toBe(
      'ValueError: invalid hook input',
    )

    const nodeTrace = [
      '/tmp/hook.js:42',
      '  throw new TypeError("bad arg");',
      'TypeError: bad arg',
      '    at Object.<anonymous> (/tmp/hook.js:42:9)',
    ].join('\n')
    expect(formatHookErrorOutput(nodeTrace, '', false)).toBe(
      'TypeError: bad arg',
    )

    const huge = 'x'.repeat(12_000)
    const expanded = formatHookErrorOutput(huge, '', true)
    expect(expanded.length).toBe(HOOK_ERROR_EXPANDED_MAX_CHARS + 1)
    expect(HOOK_EXIT_127_PRETOOL_MESSAGE).toContain('may not have run')
  })

  test('#54: goal mutation epoch prevents stale Stop hook from overwriting /goal clear or new /goal', () => {
    const snap = {
      condition: 'old goal',
      setAt: 1000,
      iterations: 0,
      tokensAtStart: 0,
      origin: 'user' as const,
    }
    const epochBefore = getGoalMutationEpoch()
    bumpGoalMutationEpoch()
    let state: { activeGoal?: typeof snap } = {
      activeGoal: { ...snap, condition: 'new goal', setAt: 2000 },
    }
    expect(isSameActiveGoal(state.activeGoal, snap)).toBe(false)
    const applied = applyGoalStateUpdateIfUnchanged(
      updater => {
        state = updater(state as never) as typeof state
      },
      snap,
      { ...snap, iterations: 1 },
      epochBefore,
    )
    expect(applied).toBe(false)
    expect(state.activeGoal?.condition).toBe('new goal')
  })

  test('#327 & #328: HTTP hook managed policy isolation and ignored Content-Length/Transfer-Encoding headers', () => {
    expect(isManagedHttpHookSource('policySettings')).toBe(true)
    expect(isManagedHttpHookSource('projectSettings')).toBe(false)
    expect(isIgnoredHttpHookHeader('Content-Length')).toBe(true)
    expect(isIgnoredHttpHookHeader('transfer-encoding')).toBe(true)
    expect(isIgnoredHttpHookHeader('Authorization')).toBe(false)
  })

  test('#103: background session temporary folder is permitted for artifact publishing', () => {
    const jobDir = mkdtempSync(join(tmpdir(), 'wave326-job-'))
    const bgTmp = join(jobDir, 'tmp')
    const file = join(bgTmp, 'chart.html')
    expect(isPathInBackgroundSessionTmp(file, { CLAUDE_JOB_DIR: jobDir })).toBe(
      true,
    )
    expect(
      isPathInBackgroundSessionTmp('/etc/passwd', { CLAUDE_JOB_DIR: jobDir }),
    ).toBe(false)
    writeFileSync(join(jobDir, 'marker'), 'ok')
  })

  test('#104: disallowedTools Artifact matches cloud MCP artifact tools', () => {
    expect(
      isCloudArtifactMcpTool({
        name: 'mcp__artifacts__publish_version',
        isMcp: true,
        mcpInfo: { serverName: 'artifacts', toolName: 'publish_version' },
      } as never),
    ).toBe(true)
    expect(
      isCloudArtifactMcpTool({
        name: 'mcp__github__list_issues',
        isMcp: true,
        mcpInfo: { serverName: 'github', toolName: 'list_issues' },
      } as never),
    ).toBe(false)
  })

  test('#105: folder-inherited artifact is not described as private', () => {
    const sharedFolderNote = formatArtifactPublishVisibilityNote(
      'owner',
      'others',
    )
    expect(sharedFolderNote).toContain('people with access to the folder')
    expect(sharedFolderNote).not.toContain('This artifact is private')

    const privateNote = formatArtifactPublishVisibilityNote('owner', 'owner')
    expect(privateNote).toContain('This artifact is private')
  })

  test('#107: takeover notice tells main which agent the background subagent reports to', () => {
    const notice = formatSubagentTakeoverNotice(
      'Research worker',
      'Coordinator agent',
    )
    expect(notice).toContain('Research worker')
    expect(notice).toContain('Coordinator agent')
    expect(notice).toContain('now reports to that agent')
  })

  test('#115: countToolUses excludes SubagentHandback final report call', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: '1', name: 'Read', input: {} },
            { type: 'tool_use', id: '2', name: 'SubagentHandback', input: {} },
          ],
        },
      },
    ] as never
    expect(countToolUses(messages)).toBe(1)
  })

  test('#121: workflow resume summary reports reused cached count and where reuse stopped', () => {
    const summary = formatWorkflowResumeCacheSummary({
      status: 'failed',
      agents: [],
      resumeReusedCount: 3,
      resumeStoppedAt: { label: 'build-step', reason: 'exit 1' },
    })
    expect(summary).toContain('reused 3 cached agent results')
    expect(summary).toContain('reuse stopped at "build-step" (exit 1)')
    const hint = buildRecoveryHint({
      runId: 'run-1',
      workflowName: 'deploy',
      status: 'failed',
      phases: [],
      declaredPhases: [],
      currentPhase: null,
      agents: [],
      agentCount: 4,
      startedAt: 0,
      updatedAt: 1000,
      scriptPath: '/tmp/w.py',
      resumeReusedCount: 2,
      resumeStoppedAt: { label: 'test-step', reason: 'timeout' },
    })
    expect(hint).toContain('reused 2 cached agent results')
    expect(hint).toContain('up to the first one that failed')
  })

  test('#243: >20 running subagents throttle background token updates to 5s unless transcript is open', () => {
    resetSubagentTokenThrottleState()
    expect(
      shouldThrottleSubagentTokenUpdate({
        taskId: 'a1',
        runningSubagentCount: 21,
        viewingAgentTaskId: undefined,
        tokenOnlyChange: true,
        nowMs: 10_000,
      }),
    ).toBe(false)
    expect(
      shouldThrottleSubagentTokenUpdate({
        taskId: 'a1',
        runningSubagentCount: 21,
        viewingAgentTaskId: undefined,
        tokenOnlyChange: true,
        nowMs: 12_000,
      }),
    ).toBe(true)
    // Open transcript is NOT throttled
    expect(
      shouldThrottleSubagentTokenUpdate({
        taskId: 'a1',
        runningSubagentCount: 21,
        viewingAgentTaskId: 'a1',
        tokenOnlyChange: true,
        nowMs: 12_000,
      }),
    ).toBe(false)
    // After 5s, flushes again
    expect(
      shouldThrottleSubagentTokenUpdate({
        taskId: 'a1',
        runningSubagentCount: 21,
        viewingAgentTaskId: undefined,
        tokenOnlyChange: true,
        nowMs: 15_000,
      }),
    ).toBe(false)
  })

  test('#314: findActiveWorktreeTasks detects running background subagents/shells in worktree', () => {
    const tasks = {
      t1: {
        id: 't1',
        type: 'local_agent',
        status: 'running',
        description: 'bg agent',
        worktreePath: '/repo/.wt/feature',
      },
      t2: {
        id: 't2',
        type: 'local_bash',
        status: 'completed',
        description: 'done shell',
        cwd: '/repo/.wt/feature',
      },
      t3: {
        id: 't3',
        type: 'local_bash',
        status: 'running',
        description: 'other dir shell',
        cwd: '/elsewhere',
      },
    } as never
    const active = findActiveWorktreeTasks(tasks, '/repo/.wt/feature')
    expect(active.map(t => t.id)).toEqual(['t1'])
  })
})
