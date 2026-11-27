import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getIsInteractive,
  getMainThreadAgentId,
  setIsInteractive,
} from '../bootstrap/state.js'
import { getToolPermissionContextFromLayers } from '../engine/permissionLayerReaders.js'
import {
  buildAgentsArgsFromOptsWithGlobals,
  restorePersistedSep2663TasksOnResume,
} from '../main.js'
import { getDefaultAppState } from '../state/AppState.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { isPathTrusted } from '../utils/config.js'
import {
  avoidsPromptsByNature,
  getAskRuleForTool,
  getDenyRuleForTool,
  toolAlwaysAllowedRule,
  toolMatchesRule,
} from '../utils/permissions/permissions.js'
import { classifyYoloAction } from '../utils/permissions/yoloClassifier.js'
import {
  clearHandbackLaterReportRefused,
  wasHandbackLaterReportRefused,
} from '../../packages/builtin-tools/src/tools/AgentTool/agentToolUtils.js'
import { getSimplePrompt } from '../../packages/builtin-tools/src/tools/BashTool/prompt.js'
import { SubagentHandbackTool } from '../../packages/builtin-tools/src/tools/SubagentHandbackTool/SubagentHandbackTool.js'
import {
  clearHandbackDeliveriesForTests,
  setHandbackSessionContract,
} from '../utils/subagentHandback.js'

const REPO_ROOT = join(import.meta.dir, '../..')

describe('Wave 319-322 cross-group wire Batch A', () => {
  const prevIgnoreTrust = process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST
  const prevDisableTelemetry = process.env.DISABLE_TELEMETRY
  const prevAutoModeServer = process.env.CLAUDE_CODE_AUTO_MODE_SERVER
  const prevInteractive = getIsInteractive()
  const tempDirs: string[] = []

  afterEach(() => {
    if (prevIgnoreTrust === undefined) {
      delete process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST
    } else {
      process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST = prevIgnoreTrust
    }
    if (prevDisableTelemetry === undefined) {
      delete process.env.DISABLE_TELEMETRY
    } else {
      process.env.DISABLE_TELEMETRY = prevDisableTelemetry
    }
    if (prevAutoModeServer === undefined) {
      delete process.env.CLAUDE_CODE_AUTO_MODE_SERVER
    } else {
      process.env.CLAUDE_CODE_AUTO_MODE_SERVER = prevAutoModeServer
    }
    setIsInteractive(prevInteractive)
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1781: isPathTrusted returns false when CLAUDE_CODE_IGNORE_PERSISTED_TRUST=1', () => {
    process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST = '1'
    expect(isPathTrusted(REPO_ROOT)).toBe(false)
    expect(isPathTrusted(REPO_ROOT, { advisoryNoFsProbe: true })).toBe(false)
  })

  test('#1883: buildAgentsArgsFromOptsWithGlobals forwards global flags + unknown trailing args', () => {
    const args = buildAgentsArgsFromOptsWithGlobals(
      {
        model: 'claude-opus-4-6',
        dangerouslySkipPermissions: true,
        addDir: ['/repo-a', '/repo-b'],
        cwd: '/work',
        json: true,
        all: true,
      },
      [
        'bun',
        'claude',
        '--model',
        'claude-opus-4-6',
        '--dangerously-skip-permissions',
        'agents',
        '--cwd',
        '/work',
        '--json',
        '--all',
        '--custom-flag',
        'val',
      ],
    )
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-6')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--cwd')
    expect(args[args.indexOf('--cwd') + 1]).toBe('/work')
    expect(args).toContain('--json')
    expect(args).toContain('--all')
    expect(args).toContain('--add-dir')
    expect(args).toContain('/repo-a')
    expect(args).toContain('/repo-b')
    expect(args).toContain('--custom-flag')
    expect(args).toContain('val')
  })

  test('#1717: restorePersistedSep2663TasksOnResume reads sidecar metas and restores tasks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sep2663-resume-'))
    tempDirs.push(dir)
    writeFileSync(
      join(dir, 'mcp-task-task_1.meta.json'),
      JSON.stringify({
        taskId: 'task_1',
        serverName: 'claude.ai Slack',
        toolName: 'search_messages',
        mcpTaskId: 'srv_task_99',
        protocol: 'sep2663',
        pollIntervalMs: 5,
      }),
    )

    let state = getDefaultAppState()
    const calls: string[] = []
    const fakeClient = {
      type: 'connected' as const,
      name: 'claude.ai Slack',
      capabilities: {},
      config: { type: 'http' as const, url: 'https://example.test/mcp' },
      client: {
        request: async (req: { method: string }) => {
          calls.push(req.method)
          if (req.method === 'tasks/get') {
            return { status: 'completed', statusMessage: 'Done' }
          }
          return { content: [{ type: 'text', text: 'matched message' }] }
        },
      },
      cleanup: async () => {},
    }

    const res = await restorePersistedSep2663TasksOnResume({
      sessionId: 'sess-test-1717',
      getInitialState: () => state,
      setInitialState: next => {
        state = next
      },
      getMcpClients: () => [fakeClient as never],
      sidecarDirOverride: dir,
    })

    expect(res.restoredTaskIds).toEqual(['task_1'])
    expect(res.skippedTaskIds).toEqual([])
    expect(state.tasks['task_1']?.type).toBe('mcp_task')

    // Allow microtasks/polling to finish
    await new Promise(r => setTimeout(r, 30))
    expect(calls).toContain('tasks/get')
    expect(calls).toContain('tasks/result')
    expect(state.tasks['task_1']?.status).toBe('completed')
  })

  test('#1703: avoid_prompts layer sets avoidsPromptsByNature even when denyInsteadOfPrompting is true', () => {
    const base = {
      ...getEmptyToolPermissionContext(),
      shouldAvoidPermissionPrompts: true,
      denyInsteadOfPrompting: true,
    }
    // Before avoid_prompts layer, interactive denyInsteadOfPrompting is NOT by nature
    expect(avoidsPromptsByNature(base)).toBe(false)

    const effective = getToolPermissionContextFromLayers({
      getAppState: () => ({ toolPermissionContext: base }) as never,
      permissionLayers: [{ kind: 'avoid_prompts' }],
    })
    expect(effective.shouldAvoidPermissionPrompts).toBe(true)
    expect(effective.avoidsPromptsByNature).toBe(true)
    expect(avoidsPromptsByNature(effective)).toBe(true)
  })

  test('#1779: connector aliases match deny/ask/disallowedTools but NEVER allow', () => {
    const desktopPostTool = { name: 'mcp__Slack__post_message' }
    const desktopReadTool = { name: 'mcp__Slack__read_message' }
    const terminalPostTool = { name: 'mcp__claude_ai_Slack__post_message' }

    // Server-level terminal deny rule blocks Desktop connector tool
    const serverDenyCtx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { cliArg: ['mcp__claude_ai_Slack'] },
    }
    expect(getDenyRuleForTool(serverDenyCtx, desktopPostTool)).not.toBeNull()
    expect(getDenyRuleForTool(serverDenyCtx, desktopReadTool)).not.toBeNull()

    // Tool-level terminal deny rule blocks ONLY that tool, not sibling tools
    const toolDenyCtx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { userSettings: ['mcp__claude_ai_Slack__post_message'] },
    }
    expect(getDenyRuleForTool(toolDenyCtx, desktopPostTool)).not.toBeNull()
    expect(getDenyRuleForTool(toolDenyCtx, desktopReadTool)).toBeNull()

    // Wildcard terminal ask rule matches Desktop connector tool
    const askCtx = {
      ...getEmptyToolPermissionContext(),
      alwaysAskRules: { userSettings: ['mcp__claude_ai_Slack__*'] },
    }
    expect(getAskRuleForTool(askCtx, desktopPostTool)).not.toBeNull()

    // Reverse direction: short server rule matches terminal connector tool on deny/ask
    const shortDenyCtx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { cliArg: ['mcp__Slack'] },
    }
    expect(getDenyRuleForTool(shortDenyCtx, terminalPostTool)).not.toBeNull()

    // STRICT: allow rules MUST NEVER expand connector aliases in either direction
    const terminalAllowCtx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        userSettings: [
          'mcp__claude_ai_Slack',
          'mcp__claude_ai_Slack__post_message',
        ],
      },
    }
    expect(toolAlwaysAllowedRule(terminalAllowCtx, desktopPostTool)).toBeNull()
    expect(
      toolMatchesRule(terminalPostTool, {
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'mcp__Slack__post_message' },
      }),
    ).toBe(false)
  })

  test('#1791 & #1732: SubagentHandbackTool marks repeat refusal and sets handbackReportText on origin', async () => {
    const senderId = 'agent-batch-a-test-1791'
    const parentId = 'parent-batch-a-test-1791'
    clearHandbackDeliveriesForTests()
    clearHandbackLaterReportRefused(senderId)
    setHandbackSessionContract(senderId, true)

    let pendingOrigin: Record<string, unknown> | undefined
    const tasks: Record<string, unknown> = {
      [senderId]: {
        id: senderId,
        type: 'local_agent',
        status: 'running',
        agentType: 'worker',
        handbackContract: true,
        handbackRecipient: parentId,
      },
      [parentId]: {
        id: parentId,
        type: 'local_agent',
        status: 'running',
        agentType: 'lead',
        pendingMessages: [],
      },
    }

    const ctx = {
      agentId: senderId,
      toolUseId: 'tu_batch_a_1',
      getAppState: () => ({ tasks }),
      setAppState: (
        updater: (prev: { tasks: Record<string, unknown> }) => {
          tasks: Record<string, unknown>
        },
      ) => {
        const next = updater({ tasks })
        const updatedParent = next.tasks[parentId] as {
          pendingMessages?: Array<{ origin?: Record<string, unknown> }>
        }
        if (updatedParent?.pendingMessages?.length) {
          pendingOrigin = updatedParent.pendingMessages[0]?.origin
        }
        Object.assign(tasks, next.tasks)
      },
    } as unknown as ToolUseContext

    // Ensure recipient != mainId
    expect(parentId).not.toBe(getMainThreadAgentId())

    const first = await SubagentHandbackTool.call!(
      { message: 'All done.\nLine two.' },
      ctx,
    )
    expect(first.data.success).toBe(true)
    expect(pendingOrigin?.handback).toBe(true)
    expect(pendingOrigin?.handbackReportText).toBe('All done.\nLine two.')
    expect(wasHandbackLaterReportRefused(senderId)).toBe(false)

    const second = await SubagentHandbackTool.call!(
      { message: 'Second report' },
      ctx,
    )
    expect(second.data.success).toBe(false)
    expect(wasHandbackLaterReportRefused(senderId)).toBe(true)

    clearHandbackLaterReportRefused(senderId)
    clearHandbackDeliveriesForTests()
  })

  test('#1699: classifyYoloAction refuses local classifier fallback when switched off', async () => {
    process.env.DISABLE_TELEMETRY = '1'
    delete process.env.CLAUDE_CODE_AUTO_MODE_SERVER
    const result = await classifyYoloAction(
      [],
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'rm -rf /tmp/example' },
          },
        ],
      },
      [
        {
          name: 'Bash',
          toAutoClassifierInput: (i: { command: string }) => i.command,
        } as never,
      ],
      { ...getEmptyToolPermissionContext(), mode: 'auto' },
      new AbortController().signal,
    )
    expect(result.shouldBlock).toBe(true)
    expect(result.unavailable).toBe(true)
    expect(result.errorKind).toBe('classifier_switched_off')
    expect(result.reason).toBe('Claude Code no longer checks actions itself')
  })

  test('#1864: BashTool prompt includes non-interactive background timeout guidance in -p mode', async () => {
    setIsInteractive(true)
    const interactivePrompt = await getSimplePrompt(undefined, false)
    expect(interactivePrompt).not.toContain('default 600000ms / 10 minutes')

    setIsInteractive(false)
    const nonInteractivePrompt = await getSimplePrompt(undefined, false)
    expect(nonInteractivePrompt).toContain(
      'default 600000ms / 10 minutes, max 1800000ms / 30 minutes',
    )

    const leanNonInteractivePrompt = await getSimplePrompt(undefined, true)
    expect(leanNonInteractivePrompt).toContain(
      'default 600000ms / 10 minutes, max 1800000ms / 30 minutes',
    )
  })

  test('#1960, #1927, #1699, #1894: production wire integrity checks', () => {
    const mainSrc = readFileSync(join(REPO_ROOT, 'src/main.tsx'), 'utf-8')
    expect(mainSrc).toContain(".command('restore-set-aside <plugin>')")
    expect(mainSrc).toContain('pluginRestoreSetAsideHandler(plugin, options)')
    expect(mainSrc).toContain('writeExitCause(`worktree_chdir:${errnoCode}`)')
    expect(mainSrc).toContain(
      'writeExitDetail(`worktree_chdir:${errnoCode}`, detail)',
    )
    expect(mainSrc).toContain('cmd.optsWithGlobals()')
    expect(mainSrc).toContain('restorePersistedSep2663TasksOnResume')

    const yoloSrc = readFileSync(
      join(REPO_ROOT, 'src/utils/permissions/yoloClassifier.ts'),
      'utf-8',
    )
    expect(yoloSrc).toContain('isLocalAutoModeClassifierSwitchedOff')
    expect(yoloSrc).toContain("errorKind: 'classifier_switched_off'")

    const execDir = join(REPO_ROOT, 'src/services/tools/execution')
    const execSrc = [
      readFileSync(
        join(REPO_ROOT, 'src/services/tools/toolExecution.ts'),
        'utf-8',
      ),
      ...readdirSync(execDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(execDir, f), 'utf-8')),
    ].join('\n')
    expect(execSrc).toContain('const toolContextLayers = result.contextLayers')
    expect(execSrc).toContain('layers: toolContextLayers')

    const bashSrc = readFileSync(
      join(REPO_ROOT, 'packages/builtin-tools/src/tools/BashTool/BashTool.tsx'),
      'utf-8',
    )
    expect(bashSrc).toContain('formatNonInteractiveBgTimeoutToolDescription')
    expect(bashSrc).toContain('resolveNonInteractiveBgTimeoutMs')
  })
})
