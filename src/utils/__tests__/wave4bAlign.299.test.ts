import { describe, expect, test } from 'bun:test'
import { openAgentsViaLeftArrow } from '../../cli/bg/leftArrowAgents.js'
import {
  buildUnrecognizedModelNotice,
  MODEL_CONFIG_DOCS_URL,
  MODEL_CONFIG_WINDOW_DOCS_URL,
} from '../../components/LogoV2/WelcomeV2.js'
import { BEHAVIOR_CARDS } from '../../components/Settings/Usage.js'
import {
  enqueueAgentNotification,
  isAgentWaitingOnOwnBackgroundWork,
  type LocalAgentTaskState,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { dequeueAllMatching, getCommandQueue } from '../messageQueueManager.js'

type AgentTaskRegistry = Parameters<
  typeof enqueueAgentNotification
>[0]['registry']
import {
  formatLeftArrowStrandedQueuedMessage,
  isLeftArrowStrandedQueuedMessage,
  shouldShowLeftArrowFailureMessage,
} from '../leftArrowConfirm.js'

describe('Wave 4B 2.1.299 alignment', () => {
  test('#581 BEHAVIOR_CARDS includes max_effort, workflow, always_on_context, large_tool_results', () => {
    for (const key of [
      'max_effort',
      'workflow',
      'always_on_context',
      'large_tool_results',
    ] as const) {
      const card = BEHAVIOR_CARDS[key]
      expect(card).toBeDefined()
      expect(card.headline(42)).toContain('42%')
      expect(card.body.length).toBeGreaterThan(20)
    }
  })

  test('#650 stranded queued message notice shows even while Remote Control is on', async () => {
    const msg1 = formatLeftArrowStrandedQueuedMessage(1)
    expect(msg1).toBe(
      "Cannot open agents — 1 queued message can't move to the background. Press ← again once Claude has read it.",
    )
    expect(isLeftArrowStrandedQueuedMessage(msg1)).toBe(true)

    const msg3 = formatLeftArrowStrandedQueuedMessage(3)
    expect(msg3).toBe(
      "Cannot open agents — 3 queued messages can't move to the background. Press ← again once Claude has read them.",
    )
    expect(isLeftArrowStrandedQueuedMessage(msg3)).toBe(true)
    expect(isLeftArrowStrandedQueuedMessage('Cannot open agents — draft')).toBe(
      false,
    )

    // Remote Control on: generic failure withheld, stranded-queued notice shown
    expect(
      shouldShowLeftArrowFailureMessage('Cannot open agents — generic', true),
    ).toBeUndefined()
    expect(shouldShowLeftArrowFailureMessage(msg1, true)).toBe(msg1)
    // Remote Control off: both shown
    expect(
      shouldShowLeftArrowFailureMessage('Cannot open agents — generic', false),
    ).toBe('Cannot open agents — generic')

    const result = await openAgentsViaLeftArrow([], { strandedQueuedCount: 2 })
    expect(result).toEqual({
      ok: false,
      error: formatLeftArrowStrandedQueuedMessage(2),
    })
  })

  test('#706 buildUnrecognizedModelNotice builds short warning with docs URL', () => {
    expect(MODEL_CONFIG_DOCS_URL).toBe(
      'https://code.claude.com/docs/en/model-config',
    )
    expect(MODEL_CONFIG_WINDOW_DOCS_URL).toBe(
      'https://code.claude.com/docs/en/model-config#correct-the-window-for-a-gateway-or-custom-model-id',
    )

    expect(buildUnrecognizedModelNotice('sonnet')).toBeNull()
    const unknown = buildUnrecognizedModelNotice('custom-gateway-model-xyz')
    expect(unknown).not.toBeNull()
    expect(unknown?.model).toBe('custom-gateway-model-xyz')
    expect(unknown?.window).toBeGreaterThan(0)
  })

  test('#713 isAgentWaitingOnOwnBackgroundWork and enqueueAgentNotification status notes', async () => {
    const baseTask = {
      id: 'agent-1',
      type: 'local_agent',
      status: 'completed',
      description: 'worker',
      prompt: 'do work',
      selectedAgent: undefined as never,
      agentId: 'agent-1',
      messages: [],
      pendingMessages: [{ text: 'follow up', isMeta: false }],
      retain: true,
      isBackgrounded: true,
      startTime: Date.now(),
      outputFile: '/tmp/out.txt',
      outputOffset: 0,
      notified: false,
      keepaliveReasons: new Set(['bash:cmd-1']),
    } as unknown as LocalAgentTaskState

    expect(isAgentWaitingOnOwnBackgroundWork(baseTask)).toBe(true)
    expect(
      isAgentWaitingOnOwnBackgroundWork({
        ...baseTask,
        keepaliveReasons: new Set(),
      }),
    ).toBe(false)

    const makeRegistry = (task: LocalAgentTaskState): AgentTaskRegistry => {
      const store = new Map<string, LocalAgentTaskState>([[task.id, task]])
      return {
        get: (id: string) => store.get(id),
        all: () => Object.fromEntries(store.entries()),
        update: (
          id: string,
          updater: (task: LocalAgentTaskState) => LocalAgentTaskState,
        ) => {
          const cur = store.get(id)
          if (cur) store.set(id, updater(cur))
        },
        mutateAppState: () => {},
      } as unknown as AgentTaskRegistry
    }

    dequeueAllMatching(() => true)
    await enqueueAgentNotification({
      taskId: 'agent-1',
      description: 'worker',
      status: 'completed',
      usageLimit: { rateLimitType: 'five_hour' },
      registry: makeRegistry(baseTask),
    })

    const queued1 = getCommandQueue()
    expect(queued1).toHaveLength(1)
    expect(queued1[0]?.value).toContain(
      'Agent "worker" is waiting on its own background work',
    )
    expect(queued1[0]?.value).toContain(
      "arrived after this run's last step, too late for the result below",
    )
    expect(queued1[0]?.value).toContain("This agent's work so far is saved.")

    dequeueAllMatching(() => true)
    await enqueueAgentNotification({
      taskId: 'agent-2',
      description: 'worker-2',
      status: 'killed',
      error: 'usage limit reached',
      registry: makeRegistry({
        ...baseTask,
        id: 'agent-2',
        agentId: 'agent-2',
        status: 'killed',
      }),
    })
    const queued2 = getCommandQueue()
    expect(queued2).toHaveLength(1)
    expect(queued2[0]?.value).toContain(
      'Agent "worker-2" was stopped: usage limit reached',
    )
    dequeueAllMatching(() => true)
  })
})
