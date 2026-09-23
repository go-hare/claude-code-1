import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../../tasks/types.js'
import type { Message } from '../../types/message.js'

/** densable LPt — shared empty messages when the transcript bag misses. */
const EMPTY_MESSAGES: Message[] = []
/** densable FPt — shared empty in-progress IDs when the transcript bag misses. */
const EMPTY_IN_PROGRESS_TOOL_USE_IDS: Set<string> = new Set()

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
  const teammate =
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'in_process_teammate'
      ? task
      : undefined
  const localAgent =
    !teammate &&
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_agent'
      ? task
      : undefined
  return { teammate, localAgent }
}

/** Placeholder name: teammate identity, else local_agent registry name. */
export function viewedAgentNameForPlaceholder(
  viewingAgentTaskId: string | undefined,
  tasks: Record<string, TaskState>,
  agentNameRegistry: Map<string, string>,
): string | undefined {
  const { teammate, localAgent } = viewedTeammateOrLocalAgent(
    viewingAgentTaskId,
    tasks,
  )
  if (teammate) return teammate.identity.agentName
  if (!localAgent) return undefined
  for (const [name, id] of agentNameRegistry) {
    if (id === localAgent.id) return name
  }
  return undefined
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
 * `r[tt()]` in SEA; there is no local transcript store, so the caller
 * keys the existing bag at `mainConversationId`.
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
  if (task && viewingAgentTaskId) {
    const viewed = transcripts[viewingAgentTaskId]
    const messages = viewed?.messages ?? EMPTY_MESSAGES
    const inProgressToolUseIDs =
      viewed?.inProgressToolUseIDs ?? EMPTY_IN_PROGRESS_TOOL_USE_IDS
    const isLoading = task.status === 'running' && !task.isIdle
    if (teammate) {
      return {
        task: teammate,
        isMain: false,
        isTeammate: true,
        messages,
        inProgressToolUseIDs,
        conversationKey: viewingAgentTaskId,
        isLoading,
      }
    }
    if (localAgent) {
      return {
        task: localAgent,
        isMain: false,
        isTeammate: false,
        messages,
        inProgressToolUseIDs,
        conversationKey: viewingAgentTaskId,
        isLoading,
      }
    }
  }
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
