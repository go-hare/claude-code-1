import {
  isInProcessTeammateTask,
  type InProcessTeammateTaskState,
} from '../../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../../tasks/types.js'
import type { Message } from '../../types/message.js'

/** densable LPt — shared empty messages when the transcript bag misses. */
const EMPTY_MESSAGES: Message[] = []
/** densable FPt — shared empty in-progress IDs when the transcript bag misses. */
const EMPTY_IN_PROGRESS_TOOL_USE_IDS: Set<string> = new Set()

/** densable kr — localAgent predicate. Body matches isLocalAgentTask. */
function isLocalAgentTask(task: unknown): task is LocalAgentTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_agent'
  )
}

/**
 * densable dKe — teammate if Ld (in_process_teammate), else localAgent if
 * kr (local_agent). Iln uses d ?? y for the viewed task.
 */
export function viewedTeammateOrLocalAgent(
  viewingAgentTaskId: string | undefined,
  tasks: Record<string, TaskState>,
): {
  teammate: InProcessTeammateTaskState | undefined
  localAgent: LocalAgentTaskState | undefined
} {
  const task = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined
  const teammate = isInProcessTeammateTask(task) ? task : undefined
  const localAgent = !teammate && isLocalAgentTask(task) ? task : undefined
  return { teammate, localAgent }
}

/**
 * densable wCe — viewingAgentTaskId → teammate (`viewed`) or localAgent
 * (`named_agent`), else leader.
 */
export type ViewedAgentForInput =
  | { type: 'leader' }
  | { type: 'viewed'; task: InProcessTeammateTaskState }
  | { type: 'named_agent'; task: LocalAgentTaskState }

export function viewedAgentForInput(s: {
  viewingAgentTaskId: string | undefined
  tasks: Record<string, TaskState>
}): ViewedAgentForInput {
  const { teammate, localAgent } = viewedTeammateOrLocalAgent(
    s.viewingAgentTaskId,
    s.tasks,
  )
  if (teammate) return { type: 'viewed', task: teammate }
  if (localAgent) return { type: 'named_agent', task: localAgent }
  return { type: 'leader' }
}

/**
 * densable _Mn — teammate identity.agentName, else registry name for the
 * viewed local_agent, else that task's agentType (so Bpe can still emit
 * `Message @name…` with no registry entry).
 */
export function viewedAgentNameForPlaceholder(
  viewingAgentTaskId: string | undefined,
  tasks: Record<string, TaskState>,
  agentNameRegistry: Map<string, string>,
): string | undefined {
  const n = viewedAgentForInput({ viewingAgentTaskId, tasks })
  switch (n.type) {
    case 'leader':
      return
    case 'viewed':
      return n.task.identity.agentName
    case 'named_agent': {
      for (const [name, id] of agentNameRegistry) {
        if (id === n.task.id) return name
      }
      return n.task.agentType
    }
  }
}

/** Caller-passed transcript bag. Do not invent a second store. */
export type ViewedTranscript = {
  messages?: Message[]
  inProgressToolUseIDs?: Set<string>
}

type ViewedTaskFields = {
  messages: Message[]
  inProgressToolUseIDs: Set<string>
  conversationKey: string | undefined
  isLoading: boolean
}

export type ViewedTask =
  | (ViewedTaskFields & {
      task: undefined
      isMain: true
      isTeammate: false
    })
  | (ViewedTaskFields & {
      task: InProcessTeammateTaskState
      isMain: false
      isTeammate: true
    })
  | (ViewedTaskFields & {
      task: LocalAgentTaskState
      isMain: false
      isTeammate: false
    })

/**
 * densable Iln — viewed-task envelope (task / isMain / isTeammate /
 * messages / conversationKey). `k = d ?? y` from dKe. Main messages are
 * `r[tt()]` in SEA; tt() transcript table is ABSENT, so the caller keys
 * the existing bag at `mainConversationId`.
 */
export function resolveViewedTask({
  viewingAgentTaskId,
  tasks,
  transcripts,
  mainIsBusy,
  mainConversationId,
}: {
  viewingAgentTaskId: string | undefined
  tasks: Record<string, TaskState>
  transcripts: Record<string, ViewedTranscript | undefined>
  mainIsBusy: boolean
  mainConversationId: string | undefined
}): ViewedTask {
  const { teammate, localAgent } = viewedTeammateOrLocalAgent(
    viewingAgentTaskId,
    tasks,
  )
  const task = teammate ?? localAgent
  if (!task || !viewingAgentTaskId) {
    const main =
      mainConversationId !== undefined
        ? transcripts[mainConversationId]
        : undefined
    return {
      task: undefined,
      isMain: true,
      isTeammate: false,
      messages: main?.messages ?? EMPTY_MESSAGES,
      inProgressToolUseIDs:
        main?.inProgressToolUseIDs ?? EMPTY_IN_PROGRESS_TOOL_USE_IDS,
      conversationKey: mainConversationId,
      isLoading: mainIsBusy,
    }
  }
  const viewed = transcripts[viewingAgentTaskId]
  return {
    task,
    isMain: false,
    isTeammate: !!teammate,
    messages: viewed?.messages ?? EMPTY_MESSAGES,
    inProgressToolUseIDs:
      viewed?.inProgressToolUseIDs ?? EMPTY_IN_PROGRESS_TOOL_USE_IDS,
    conversationKey: viewingAgentTaskId,
    isLoading: task.status === 'running' && !task.isIdle,
  } as ViewedTask
}
