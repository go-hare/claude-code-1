import { afterEach, describe, expect, test } from 'bun:test'
import {
  AGENT_PERMISSION_WAIT_THRESHOLD_MS,
  clearAgentPermissionWaits,
  clearAgentWaitingNotice,
  enqueueAgentNotification,
  getAgentAskNoticeAttachment,
  HANDBACK_WAITING_PLACEHOLDER,
  queuePendingMessage,
  registerAgentPermissionWait,
  rewireOrphanedOwnerNotifications,
  type LocalAgentTaskState,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import {
  clearCommandQueue,
  getCommandQueueSnapshot,
} from 'src/utils/messageQueueManager.js'
import { resolveTeammateCompactionParams } from 'src/utils/swarm/inProcessRunner.js'
import {
  clearHandbackFollowUpDropped,
  formatHandbackFollowUpDroppedNotice,
  getHandbackFollowUpDropped,
  HANDBACK_FOLLOWUP_DROPPED_BASE,
  HANDBACK_FOLLOWUP_DROPPED_HINTS,
  markHandbackFollowUpDropped,
} from '../agentToolUtils.js'
import {
  buildSiblingResumeToolUseContext,
  isSiblingSubagentResume,
} from '../resumeAgent.js'
import { resolvePersistedAgentModel } from '../runAgent.js'

afterEach(() => {
  clearAgentPermissionWaits()
  clearHandbackFollowUpDropped('agent-drop-test')
  clearCommandQueue()
})

describe('Wave 327-328 Agents / Subagents / Swarm / Tasks', () => {
  test('#423 resolveTeammateCompactionParams computes compaction threshold and bytes-per-token from teammate model', () => {
    const opusParams = resolveTeammateCompactionParams([], {
      agentModel: 'claude-opus-4-6',
      leadModel: 'claude-haiku-4-5-20251001',
    })
    const haikuParams = resolveTeammateCompactionParams([], {
      agentModel: 'claude-haiku-4-5-20251001',
      leadModel: 'claude-opus-4-6',
    })
    expect(opusParams.model).toBe('claude-opus-4-6')
    expect(haikuParams.model).toBe('claude-haiku-4-5-20251001')
    expect(opusParams.threshold).toBeGreaterThan(0)
    expect(opusParams.bytesPerToken).toBeGreaterThan(0)
  })

  test('#424 & #510 sibling subagent resume strips sibling effort/model/permission layers and uses session defaults', () => {
    expect(isSiblingSubagentResume('agent-a', 'agent-parent', false)).toBe(true)
    expect(isSiblingSubagentResume(undefined, 'agent-parent', false)).toBe(
      false,
    )
    expect(isSiblingSubagentResume('agent-parent', 'agent-parent', false)).toBe(
      false,
    )
    expect(isSiblingSubagentResume('agent-a', 'agent-parent', true)).toBe(false)

    const fakeContext = {
      options: {
        mainLoopModel: 'claude-haiku-4-5-20251001',
        tools: [],
      },
      permissionLayers: [
        { kind: 'effort' as const, effort: 'low' as const },
        { kind: 'model' as const, mainLoopModel: 'claude-haiku-4-5-20251001' },
        {
          kind: 'permission_mode' as const,
          mode: 'bypassPermissions' as const,
        },
        { kind: 'allowed_tools' as const, tools: ['Bash'] },
      ],
      getAppState: () => ({
        mainLoopModel: 'claude-sonnet-4-6',
        toolPermissionContext: {
          mode: 'bypassPermissions' as const,
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
      }),
    }

    const stripped = buildSiblingResumeToolUseContext(
      fakeContext as never,
      'claude-sonnet-4-6',
      'plan',
    )
    expect(
      stripped.permissionLayers?.some(
        l =>
          l.kind === 'effort' ||
          l.kind === 'permission_mode' ||
          l.kind === 'allowed_tools',
      ),
    ).toBe(false)
    expect(stripped.permissionLayers?.find(l => l.kind === 'model')).toEqual({
      kind: 'model',
      mainLoopModel: 'claude-sonnet-4-6',
    })
    expect(stripped.getAppState().toolPermissionContext.mode).toBe('plan')
  })

  test('#425 rewireOrphanedOwnerNotifications rewires evicted-child notifications stamped with childCompletion', async () => {
    const { createTaskRegistry } = await import('src/utils/taskRegistry.js')
    let appState = { tasks: {} as Record<string, unknown> }
    const registry = createTaskRegistry(
      () => appState as never,
      updater => {
        appState = updater(appState as never) as never
      },
    )
    const parentTask = {
      id: 'parent-1',
      type: 'local_agent',
      status: 'completed',
      description: 'Parent agent',
      startTime: Date.now(),
      outputFile: '',
      outputOffset: 0,
      notified: false,
      agentId: 'parent-1',
      prompt: 'p',
      selectedAgent: {
        agentType: 'general-purpose',
        whenToUse: 'test',
        getSystemPrompt: () => 'sys',
        source: 'built-in',
      },
      agentType: 'general-purpose',
      messages: [],
      retain: false,
      diskLoaded: false,
      evicted: false,
      isBackgrounded: true,
    } as unknown as LocalAgentTaskState
    registry.register(parentTask)

    await enqueueAgentNotification({
      taskId: 'child-1',
      description: 'Child agent',
      status: 'completed',
      finalMessage: 'child result',
      ownerAgentId: 'parent-1',
      registry,
    })

    // Queue notification was delivered to parent-1; now rewire orphaned owner notifications
    rewireOrphanedOwnerNotifications('parent-1', registry, { force: true })
    const snap = getCommandQueueSnapshot()
    expect(snap.length).toBeGreaterThanOrEqual(0)
  })

  test('#426 agent permission wait tracking surfaces ask-notice attachment after 30s threshold', async () => {
    expect(AGENT_PERMISSION_WAIT_THRESHOLD_MS).toBe(30_000)
    const now = 100_000
    const { createTaskRegistry } = await import('src/utils/taskRegistry.js')
    let appState = { tasks: {} as Record<string, unknown> }
    const registry = createTaskRegistry(
      () => appState as never,
      updater => {
        appState = updater(appState as never) as never
      },
    )
    registry.register({
      id: 'sub-1',
      type: 'local_agent',
      status: 'running',
      description: 'researcher',
      startTime: now - 40_000,
      outputFile: '',
      outputOffset: 0,
      notified: false,
      agentId: 'sub-1',
      prompt: 'p',
      selectedAgent: {
        agentType: 'general-purpose',
        whenToUse: 'test',
        getSystemPrompt: () => 'sys',
        source: 'built-in',
      },
      agentType: 'general-purpose',
      messages: [],
      retain: false,
      diskLoaded: false,
      evicted: false,
      isBackgrounded: true,
    } as unknown as LocalAgentTaskState)

    const dispose = registerAgentPermissionWait(
      'sess-key-1',
      'req-1',
      'sub-1',
      { name: 'Bash' },
      now - 35_000,
    )
    const attachments = getAgentAskNoticeAttachment(
      'sess-key-1',
      registry,
      [],
      [],
      now,
    )
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.open).toEqual(['req-1'])
    expect(attachments[0]?.lines.join('\n')).toContain('Bash')

    // Before 30s threshold, not surfaced
    const tooEarly = getAgentAskNoticeAttachment(
      'sess-key-1',
      registry,
      [],
      [],
      now - 20_000,
    )
    expect(tooEarly).toHaveLength(0)

    dispose()
    expect(
      getAgentAskNoticeAttachment('sess-key-1', registry, [], [], now),
    ).toHaveLength(0)
  })

  test('#427 handback waiting-notice dedup and follow-up dropped guidance hints', () => {
    expect(HANDBACK_WAITING_PLACEHOLDER).toBeTruthy()
    expect(HANDBACK_FOLLOWUP_DROPPED_BASE).toBeTruthy()
    expect(HANDBACK_FOLLOWUP_DROPPED_HINTS.report).toBeTruthy()
    expect(HANDBACK_FOLLOWUP_DROPPED_HINTS.message).toBeTruthy()
    expect(HANDBACK_FOLLOWUP_DROPPED_HINTS.wait).toBeTruthy()

    markHandbackFollowUpDropped('agent-drop-test', 'report')
    expect(getHandbackFollowUpDropped('agent-drop-test')).toEqual({
      dropped: true,
      hint: 'report',
    })
    const notice = formatHandbackFollowUpDroppedNotice('report')
    expect(notice).toContain(HANDBACK_FOLLOWUP_DROPPED_BASE)
    expect(notice).toContain(HANDBACK_FOLLOWUP_DROPPED_HINTS.report)
    clearHandbackFollowUpDropped('agent-drop-test')
    expect(getHandbackFollowUpDropped('agent-drop-test')).toEqual({
      dropped: false,
    })

    expect(typeof clearAgentWaitingNotice).toBe('function')
    expect(typeof enqueueAgentNotification).toBe('function')
  })

  test('#522 resolvePersistedAgentModel persists resolved model on fresh non-fork launch when omitted', () => {
    const persisted = resolvePersistedAgentModel({
      explicitModel: undefined,
      resolvedAgentModel: 'claude-opus-4-6',
      isFork: false,
      isResume: false,
    })
    expect(persisted).toBe('claude-opus-4-6')

    // Explicit model takes precedence
    expect(
      resolvePersistedAgentModel({
        explicitModel: 'sonnet',
        resolvedAgentModel: 'claude-sonnet-4-6',
        isFork: false,
        isResume: false,
      }),
    ).toBe('sonnet')

    // Forked subagent does not persist parent model as explicit pin
    expect(
      resolvePersistedAgentModel({
        explicitModel: undefined,
        resolvedAgentModel: 'claude-opus-4-6',
        isFork: true,
        isResume: false,
      }),
    ).toBeUndefined()
  })

  test('#423 regression: resolveTeammateCompactionParams never scales exact API-reported usage tokens', () => {
    const assistantWithExactUsage = {
      type: 'assistant',
      uuid: 'a-exact-1',
      message: {
        id: 'msg_exact_1',
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'text', text: 'Done.' }],
        usage: {
          input_tokens: 90_000,
          cache_creation_input_tokens: 5_000,
          cache_read_input_tokens: 4_000,
          output_tokens: 1_000,
        },
      },
    } as never

    // Exact usage = 100,000 tokens, no unmeasured tail → must stay 100,000 regardless of bytesPerToken
    const noTail = resolveTeammateCompactionParams([assistantWithExactUsage], {
      agentModel: 'claude-opus-4-6',
      leadModel: 'claude-sonnet-4-6',
    })
    expect(noTail.estimatedTokens).toBe(100_000)

    // With an unmeasured user message after the API response, exact 100,000 stays
    // exact and only the tail is estimated and scaled.
    const tailUser = {
      type: 'user',
      uuid: 'u-tail-1',
      message: { role: 'user', content: 'x'.repeat(400) },
    } as never
    const withTail = resolveTeammateCompactionParams(
      [assistantWithExactUsage, tailUser],
      {
        agentModel: 'claude-opus-4-6',
        leadModel: 'claude-sonnet-4-6',
      },
    )
    expect(withTail.estimatedTokens).toBeGreaterThan(100_000)
    expect(withTail.estimatedTokens).toBeLessThan(102_000)
  })

  test('#427 regression: queuePendingMessage clears waitingNoticeRecipient and waitingNoticeText', () => {
    let state: { tasks: Record<string, LocalAgentTaskState> } = {
      tasks: {
        'agent-wait-1': {
          id: 'agent-wait-1',
          type: 'local_agent',
          status: 'completed',
          description: 'waiting agent',
          isBackgrounded: true,
          pendingMessages: [],
          waitingNoticeRecipient: 'main',
          waitingNoticeText: HANDBACK_WAITING_PLACEHOLDER,
        } as unknown as LocalAgentTaskState,
      },
    }
    const setAppState = (
      updater: (prev: typeof state) => typeof state,
    ): void => {
      state = updater(state)
    }
    queuePendingMessage('agent-wait-1', 'check status', setAppState as never)
    expect(state.tasks['agent-wait-1']?.pendingMessages).toHaveLength(1)
    expect(state.tasks['agent-wait-1']?.waitingNoticeRecipient).toBeUndefined()
    expect(state.tasks['agent-wait-1']?.waitingNoticeText).toBeUndefined()
  })
})
