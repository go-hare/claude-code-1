/**
 * Conversation clearing utility.
 * This module has heavier dependencies and should be lazy-loaded when possible.
 */
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import { getReplBridgeHandle } from '../../bridge/replBridgeHandle.js'
import {
  getIsRemoteMode,
  getLastMainRequestId,
  getOriginalCwd,
  getSessionId,
  regenerateSessionId,
  resetCostState,
  setLastAPIRequest,
  setLastAPIRequestMessages,
  setLastClassifierRequests,
} from '../../bootstrap/state.js'
import type { SDKStatusMessage } from '../../entrypoints/sdk/coreTypes.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { endMainThreadConversation } from '../../services/codeMode/executor.js'
import type { AppState } from '../../state/AppState.js'
import { isTerminalTaskStatus } from '../../Task.js'
import { isInProcessTeammateTask } from '../../tasks/InProcessTeammateTask/types.js'
import {
  clearAgentPermissionWaits,
  forfeitAllChatPins,
  isLocalAgentTask,
  type LocalAgentTaskState,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { isLocalShellTask } from '../../tasks/LocalShellTask/guards.js'
import { isLocalWorkflowTask } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { type AgentId, asAgentId } from '../../types/ids.js'
import { IDLE_WINDOW_KEEPALIVE_REASON } from '../../utils/task/framework.js'
import type { Message } from '../../types/message.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import {
  executeSessionEndHooks,
  getSessionEndHookTimeoutMs,
  getSessionEndHooksBoundMs,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { clearAllPlanSlugs } from '../../utils/plans.js'
import { setCwd } from '../../utils/Shell.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import {
  clearBridgeSession,
  clearSessionMetadata,
  flushSessionStorage,
  getAgentTranscriptPath,
  getCurrentSessionTitle,
  hasInternalEventWriter,
  isTranscriptPersistenceDisabled,
  resetSessionFilePointer,
  saveWorktreeState,
} from '../../utils/sessionStorage.js'
import {
  evictTaskOutput,
  initTaskOutputAsSymlink,
} from '../../utils/task/diskOutput.js'
import { resetImageRereadState } from '../../utils/subagentCacheEvict.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import {
  getOwnTaskListId,
  noteSessionTaskListAfterClear,
  sanitizePathComponent,
  setOwnTaskListId,
} from '../../utils/tasks.js'
import { getCurrentWorktreeSession } from '../../utils/worktree.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionHost.js'
import { clearSessionCaches } from './caches.js'

const clearSessionStartSlot = new RootSessionSlot<{
  controller: AbortController | null
}>(() => ({
  controller: null,
}))

/**
 * Official 2.1.328 (#393): move the session-scoped task list directory when
 * `/clear` rotates the session ID so tasks created after `/clear` belong to
 * the new session ID and cleared tasks are never resurrected on resume, even
 * in cloud/runner sessions with no feature flags loaded.
 */
export async function moveOwnTaskListOnClear(
  _oldSessionId: string,
  newSessionId: string,
  opts?: {
    tasksRootDir?: string
    ownTaskListId?: string | null
    setOwnTaskListId?: (id: string | undefined) => void
  },
): Promise<{ moved: boolean; reason?: string }> {
  const sourceId =
    opts && 'ownTaskListId' in opts
      ? (opts.ownTaskListId ?? newSessionId)
      : getOwnTaskListId(newSessionId)
  if (!sourceId || sourceId === newSessionId) {
    return { moved: false, reason: 'same_id' }
  }
  const safeSourceId = sanitizePathComponent(sourceId)
  const safeNewSessionId = sanitizePathComponent(newSessionId)
  if (!safeSourceId || safeSourceId === safeNewSessionId) {
    return { moved: false, reason: 'same_id' }
  }
  const clearOwnTaskListId = opts?.setOwnTaskListId ?? setOwnTaskListId
  const { rename } = await import('fs/promises')
  const { join } = await import('path')
  const { getClaudeConfigHomeDir } = await import('../../utils/envUtils.js')
  const tasksRoot =
    opts?.tasksRootDir ?? join(getClaudeConfigHomeDir(), 'tasks')
  const oldDir = join(tasksRoot, safeSourceId)
  const newDir = join(tasksRoot, safeNewSessionId)
  try {
    await rename(oldDir, newDir)
    return { moved: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code
    if (code !== 'ENOENT') {
      clearOwnTaskListId(undefined)
    }
    return {
      moved: false,
      reason: code === 'ENOENT' ? 'enoent' : (code ?? 'rename_failed'),
    }
  }
}

/**
 * Official 2.1.319 (#1760): compute which tasks survive /clear vs get killed.
 * Preserves background agents, teammates, workflows, AND any subtasks (running
 * shells or foreground subagents) owned by a surviving background agent,
 * teammate, or workflow (transitively).
 */
export function computeSurvivingTaskIdsOnClear(
  tasks: AppState['tasks'],
): Set<string> {
  const survivingTaskIds = new Set<string>()
  const survivingOwnerIds = new Set<string>()
  const entries = Object.entries(tasks)

  // Seed pass: surviving roots are background agents, teammates, workflows,
  // and backgrounded shells/tasks (anything that is NOT an explicit foreground
  // agent or non-background local shell).
  for (const [taskId, task] of entries) {
    const isExplicitForeground =
      'isBackgrounded' in task && task.isBackgrounded === false
    const isNonBackgroundShell =
      isLocalShellTask(task) &&
      !('isBackgrounded' in task && task.isBackgrounded === true)
    if (!isExplicitForeground && !isNonBackgroundShell) {
      survivingTaskIds.add(taskId)
      if (isLocalAgentTask(task)) {
        if (task.agentId) survivingOwnerIds.add(task.agentId)
        survivingOwnerIds.add(task.id)
      } else if (isInProcessTeammateTask(task)) {
        if (task.identity?.agentId) {
          survivingOwnerIds.add(task.identity.agentId)
        }
        survivingOwnerIds.add(task.id)
      } else if (isLocalWorkflowTask(task)) {
        survivingOwnerIds.add(task.id)
        if (task.agentId) survivingOwnerIds.add(task.agentId)
      }
    }
  }

  // Fixed-point pass: keep any subtask (shell or foreground subagent) whose
  // owner/parent is a surviving background agent, teammate, or workflow.
  let changed = true
  while (changed) {
    changed = false
    for (const [taskId, task] of entries) {
      if (survivingTaskIds.has(taskId)) continue
      const ownerCandidate =
        ('parentAgentId' in task && typeof task.parentAgentId === 'string'
          ? task.parentAgentId
          : undefined) ??
        ('ownerAgentId' in task && typeof task.ownerAgentId === 'string'
          ? task.ownerAgentId
          : undefined) ??
        (isLocalShellTask(task) && typeof task.agentId === 'string'
          ? task.agentId
          : undefined)
      if (ownerCandidate && survivingOwnerIds.has(ownerCandidate)) {
        survivingTaskIds.add(taskId)
        if (isLocalAgentTask(task)) {
          survivingOwnerIds.add(task.agentId)
          survivingOwnerIds.add(task.id)
        }
        changed = true
      }
    }
  }

  return survivingTaskIds
}

function findSurvivingTaskForAgentId(
  tasks: AppState['tasks'],
  agentId: string,
): AppState['tasks'][string] | undefined {
  if (Object.hasOwn(tasks, agentId)) {
    return tasks[agentId]
  }
  return Object.values(tasks).find(
    task =>
      isInProcessTeammateTask(task) &&
      (task.identity as { resumableAgentId?: string } | undefined)
        ?.resumableAgentId === agentId,
  )
}

/**
 * Official 2.1.328 (`H1r`, `chunk@312460395.js`, called from `chunk@312462718.js @5883`):
 * prune `agentNameRegistry` on `/clear` to keep only entries whose target task
 * survived and is either non-terminal or a local agent held alive by a
 * non-idle-window keepalive reason.
 */
export function pruneAgentNameRegistry(
  registry: Map<string, AgentId>,
  survivingTasks: AppState['tasks'],
): Map<string, AgentId> {
  return new Map(
    [...registry].filter(([, agentId]) => {
      const task = findSurvivingTaskForAgentId(survivingTasks, agentId)
      if (task === undefined) return false
      if (!isTerminalTaskStatus(task.status)) return true
      return (
        isLocalAgentTask(task) &&
        task.keepaliveReasons !== undefined &&
        [...task.keepaliveReasons].some(
          reason => reason !== IDLE_WINDOW_KEEPALIVE_REASON,
        )
      )
    }),
  )
}

function buildBackgroundTasksChangedPayload(tasks: AppState['tasks']) {
  return Object.values(tasks)
    .filter(task => task.status === 'running')
    .map(task => ({
      task_id: task.id,
      task_type: task.type,
      description: task.description,
      ...('selectedAgent' in task &&
      task.selectedAgent &&
      typeof task.selectedAgent === 'object' &&
      'agentType' in task.selectedAgent
        ? {
            subagent_type: (task.selectedAgent as { agentType?: string })
              .agentType,
          }
        : {}),
    }))
}

function notifyRemoteConversationCleared(
  survivingTasks?: AppState['tasks'],
): void {
  // densable 2.1.224 #21 — /clear → conversation_reset to attached RC clients
  // (WS({type:"conversation_reset",new_conversation_id}) when bridge/CCR live).
  // Official 2.1.319 (#1773): re-emit full `background_tasks_changed` immediately
  // after `conversation_reset` so tasks surviving /clear stay visible on web/RC.
  const handle = getReplBridgeHandle()
  if (!handle) return
  handle.markTranscriptReset?.()

  const newConversationId = getSessionId()
  const resetMessage = {
    type: 'conversation_reset' as const,
    new_conversation_id: newConversationId,
    uuid: randomUUID(),
    session_id: newConversationId,
  }
  const tasksChangedMessage = {
    type: 'system' as const,
    subtype: 'background_tasks_changed' as const,
    tasks: survivingTasks
      ? buildBackgroundTasksChangedPayload(survivingTasks)
      : [],
    uuid: randomUUID(),
    session_id: newConversationId,
  }
  handle.writeSdkMessages([
    resetMessage as unknown as SDKStatusMessage,
    tasksChangedMessage as unknown as SDKStatusMessage,
  ])
}

export async function clearConversation({
  setMessages,
  readFileState,
  discoveredSkillNames,
  loadedNestedMemoryPaths,
  pendingNestedMemoryTriggers,
  getAppState,
  setAppState,
  setConversationId,
  taskRegistry,
}: {
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  readFileState: FileStateCache
  discoveredSkillNames?: Set<string>
  loadedNestedMemoryPaths?: Set<string>
  pendingNestedMemoryTriggers?: Set<string>
  getAppState?: () => AppState
  setAppState?: (f: (prev: AppState) => AppState) => void
  setConversationId?: (id: UUID) => void
  taskRegistry?: import('../../utils/taskRegistry.js').TaskRegistry
}): Promise<void> {
  // Execute SessionEnd + function-hook `session.end` (`reason: 'clear'`) before
  // session ID rotation (`regenerateSessionId`). Per-hook `_go` vs bound `Kfe`.
  const sessionEndTimeoutMs = getSessionEndHookTimeoutMs()
  const sessionEndBoundMs = getSessionEndHooksBoundMs()
  await executeSessionEndHooks('clear', {
    getAppState,
    setAppState,
    signal: AbortSignal.timeout(sessionEndBoundMs),
    timeoutMs: sessionEndTimeoutMs,
  })

  // #1501: Flush pending transcript/plan writes before rotating session ID.
  await flushSessionStorage()

  // Signal to inference that this conversation's cache can be evicted.
  const lastRequestId = getLastMainRequestId()
  if (lastRequestId) {
    logEvent('tengu_cache_eviction_hint', {
      scope:
        'conversation_clear' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_request_id:
        lastRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Compute preserved tasks up front so their per-agent state survives the
  // cache wipe below. A task is preserved unless it explicitly has
  // isBackgrounded === false. Main-session tasks (Ctrl+B) are preserved —
  // they write to an isolated per-task transcript and run under an agent
  // context, so they're safe across session ID regeneration. See
  // LocalMainSessionTask.ts startBackgroundSession.
  const preservedAgentIds = new Set<string>()
  const preservedLocalAgents: LocalAgentTaskState[] = []
  const initialSurvivingIds = getAppState
    ? computeSurvivingTaskIdsOnClear(getAppState().tasks)
    : new Set<string>()
  const shouldKillTask = (
    taskId: string,
    task: AppState['tasks'][string],
    survivingIds: Set<string>,
  ): boolean =>
    !survivingIds.has(taskId) &&
    'isBackgrounded' in task &&
    task.isBackgrounded === false
  if (getAppState) {
    for (const [taskId, task] of Object.entries(getAppState().tasks)) {
      if (shouldKillTask(taskId, task, initialSurvivingIds)) continue
      if (isLocalAgentTask(task)) {
        preservedAgentIds.add(task.agentId)
        preservedLocalAgents.push(task)
      } else if (isInProcessTeammateTask(task)) {
        preservedAgentIds.add(task.identity.agentId)
      }
    }
  }

  setMessages(() => [])
  // densable emits conversation_reset with the *new* conversation id —
  // defer until after regenerateSessionId() below.

  // Clear context-blocked flag so proactive ticks resume after /clear
  if (feature('PROACTIVE') || feature('KAIROS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { setContextBlocked } = require('../../proactive/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    setContextBlocked(false)
  }

  // Force logo re-render by updating conversationId
  if (setConversationId) {
    setConversationId(randomUUID())
  }

  // Clear all session-related caches. Per-agent state for preserved background
  // tasks (invoked skills, pending permission callbacks, dump state, cache-break
  // tracking) is retained so those agents keep functioning.
  clearSessionCaches(preservedAgentIds)
  // Official 2.1.328 (`chunk@313694282.js @8309`): end ONLY main-thread Code
  // Mode conversation state on /clear so surviving background subagents keep
  // their VM sessions and evals intact.
  endMainThreadConversation('the conversation was cleared')
  // Clear tracked permission waits for the outgoing session and forfeit chat
  // pins on any surviving agents so stale pins/notices don't leak past /clear.
  clearAgentPermissionWaits(getSessionId())
  if (setAppState) {
    forfeitAllChatPins(setAppState)
  }
  // Official 2.1.325 #1929: reset unchanged-image re-read tracking on /clear.
  resetImageRereadState()

  const { getBashTaskDeliveryBag } = await import(
    '../../utils/bashTaskDeliveryOutcomes.js'
  )
  getBashTaskDeliveryBag().reset()

  // densable 2.1.212: /clear resets WebSearch + subagent session budgets
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resetSessionSpawnCaps } =
      require('../../utils/sessionSpawnCaps.js') as typeof import('../../utils/sessionSpawnCaps.js')
    resetSessionSpawnCaps()
  } catch {
    // optional
  }

  // Clear large STATE-held data that outlives the message array.
  // lastAPIRequestMessages can hold the full post-compaction conversation
  // (hundreds of KB–MB) for /share; resetCostState clears modelUsage.
  setLastAPIRequest(null)
  setLastAPIRequestMessages(null)
  setLastClassifierRequests(null)
  resetCostState()

  setCwd(getOriginalCwd())
  readFileState.clear()
  discoveredSkillNames?.clear()
  loadedNestedMemoryPaths?.clear()
  pendingNestedMemoryTriggers?.clear()

  // densable F7e + Ktn — new conversation: epoch++ and empty hosted Vtn.
  const { noteArtifactConversationReset, clearedArtifactConversationAppState } =
    await import('../../services/artifactAutoReact/conversationBoundary.js')
  noteArtifactConversationReset()

  // Clean out necessary items from App State
  // densable 2.1.289 $Er `ie`: daemon/non-agent tasks don't hold subagent slots
  // or WebSearch session budget across /clear.
  const NON_AGENT_SURVIVING_TASK_TYPES = new Set([
    'local_bash',
    'monitor_mcp',
    'monitor_ws',
    'mcp_task',
  ])
  let survivingAgentTaskCount = 0
  let survivingTasksSnapshot: AppState['tasks'] | undefined
  let clearedGoal: AppState['activeGoal'] | undefined
  if (setAppState) {
    setAppState(prev => {
      // Partition tasks using the same transitive survival predicate (#1760):
      // kill+remove unowned foreground tasks, preserve background tasks and their subtasks.
      const survivingIds = computeSurvivingTaskIdsOnClear(prev.tasks)
      const nextTasks: AppState['tasks'] = {}
      const killedTaskIds: string[] = []
      for (const [taskId, task] of Object.entries(prev.tasks)) {
        if (!shouldKillTask(taskId, task, survivingIds)) {
          nextTasks[taskId] = task
          continue
        }
        killedTaskIds.push(taskId)
        // Foreground task: kill it and drop from state
        try {
          if (task.status === 'running') {
            if (isLocalShellTask(task)) {
              task.shellCommand?.kill()
              task.shellCommand?.cleanup()
              if (task.cleanupTimeoutId) {
                clearTimeout(task.cleanupTimeoutId)
              }
            }
            if ('abortController' in task) {
              task.abortController?.abort()
            }
            if ('unregisterCleanup' in task) {
              task.unregisterCleanup?.()
            }
          }
        } catch (error) {
          logError(error)
        }
        void evictTaskOutput(taskId)
      }

      survivingTasksSnapshot = nextTasks
      survivingAgentTaskCount = Object.values(nextTasks).filter(
        t => !NON_AGENT_SURVIVING_TASK_TYPES.has(t.type),
      ).length
      clearedGoal = prev.activeGoal

      // Official 2.1.328 (`chunk@312462718.js @5480-5920`):
      // Clear toolPermissionContext.planDoc when present, clear viewingAgentTaskId
      // when the currently viewed task was killed, prune agentNameRegistry (`H1r`),
      // and clear activeGoal + frameUrls.
      const prevPermCtx = prev.toolPermissionContext as
        | (AppState['toolPermissionContext'] & { planDoc?: unknown })
        | undefined
      const clearedPlanDocPatch =
        prevPermCtx !== undefined && prevPermCtx.planDoc !== undefined
          ? {
              toolPermissionContext: {
                ...prevPermCtx,
                planDoc: undefined,
              },
            }
          : {}
      const clearedViewingAgentPatch =
        prev.viewingAgentTaskId !== undefined &&
        killedTaskIds.includes(prev.viewingAgentTaskId)
          ? {
              viewingAgentTaskId: undefined,
              viewSelectionMode: 'none' as const,
            }
          : {}
      // Official 2.1.331 (@335669436): prune AppState.transcripts entries for killed tasks.
      let nextTranscripts = prev.transcripts
      if (nextTranscripts && killedTaskIds.length > 0) {
        for (const id of killedTaskIds) {
          if (id in nextTranscripts) {
            if (nextTranscripts === prev.transcripts) {
              nextTranscripts = { ...prev.transcripts }
            }
            delete nextTranscripts[id]
          }
        }
      }

      return {
        ...prev,
        ...clearedArtifactConversationAppState(),
        ...clearedPlanDocPatch,
        activeGoal: undefined,
        tasks: nextTasks,
        ...(nextTranscripts !== prev.transcripts
          ? { transcripts: nextTranscripts }
          : {}),
        ...clearedViewingAgentPatch,
        runningSubagents:
          survivingAgentTaskCount === 0 ? 0 : prev.runningSubagents,
        // densable session_start: clear clickable image path map
        storedImagePaths: new Map(),
        // densable 2.1.212 #17: /clear must re-prompt ultrareview overage
        // (AppState.ultrareviewOverageConfirmed — not a module flag)
        ultrareviewOverageConfirmed: false,
        // densable 2.1.214: /clear resets EndConversation session lock
        endedByModel: false,
        // densable session reset: clear MessageDisplay salvage map
        displayedMessageContent: {},
        sendMessagePins: {},
        agentNameRegistry: pruneAgentNameRegistry(
          prev.agentNameRegistry,
          nextTasks,
        ),
        frameUrls: {},
        pendingPlanVerification: undefined,
        // densable 2.1.243 #31: keep /rename name on the prompt bar when the
        // session title is still set (F=!clearedSessionTitle && ct()!==void 0).
        standaloneAgentContext: (() => {
          const keepRename =
            getCurrentSessionTitle(getSessionId()) !== undefined
          const name = keepRename
            ? prev.standaloneAgentContext?.name
            : undefined
          const prideGradient = prev.standaloneAgentContext?.prideGradient
          if (name || prideGradient) {
            return {
              ...(name ? { name } : {}),
              ...(prideGradient ? { prideGradient } : {}),
            }
          }
          return undefined
        })(),
        fileHistory: {
          snapshots: [],
          trackedFiles: new Set(),
          snapshotSequence: 0,
        },
        // Reset MCP state to default to trigger re-initialization.
        // Preserve pluginReconnectKey so /clear doesn't cause a no-op
        // (it's only bumped by /reload-plugins). densable clientsInitialized
        // resets to false so gDs waits for the next pending-init stamp.
        mcp: {
          clientsInitialized: false,
          clients: [],
          tools: [],
          commands: [],
          resources: {},
          resourceTemplates: {},
          suppressedPluginMcpServers: [],
          pluginReconnectKey: prev.mcp.pluginReconnectKey,
        },
      }
    })
    // Official 2.1.328 (`yEe`, `chunk@288443515.js @996`, `chunk@312462718.js @5883`):
    // emit goal-cleared telemetry when `/clear` wipes an active goal.
    if (clearedGoal !== undefined) {
      logEvent('tengu_goal_cleared', {
        reason:
          'session_clear' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        iterations: clearedGoal.iterations,
        durationMs: Date.now() - clearedGoal.setAt,
        origin:
          clearedGoal.origin as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } else if (getAppState) {
    const prevTasks = getAppState().tasks
    const survivingIds = computeSurvivingTaskIdsOnClear(prevTasks)
    survivingTasksSnapshot = Object.fromEntries(
      Object.entries(prevTasks).filter(
        ([taskId, t]) => !shouldKillTask(taskId, t, survivingIds),
      ),
    )
    survivingAgentTaskCount = Object.values(survivingTasksSnapshot).filter(
      t => !NON_AGENT_SURVIVING_TASK_TYPES.has(t.type),
    ).length
  }

  if (taskRegistry && survivingAgentTaskCount === 0) {
    taskRegistry.resetWebSearchCalls()
  }

  // Clear plan slug cache so a new plan file is used after /clear
  clearAllPlanSlugs()

  // densable 2.1.243 #31: keep /rename title for the new session; still wipe
  // tag / agent / mode so they don't leak. Mode/worktree are re-saved below.
  clearSessionMetadata({ keepTitle: true })
  // #663 SEA 325 Mle: write bridgeSessionId:"" tombstone on the pre-clear
  // session before rotating the session ID so resuming before /clear does not
  // reattach to the post-clear Remote Control session.
  clearBridgeSession()

  // Generate new session ID to provide fresh state
  // Set the old session as parent for analytics lineage tracking
  const prevSessionId = getSessionId()
  // Official 2.1.328 (#586) `Se() && MC() && AJn() && !J() -> $8s()`:
  // Only withdraw an existing resume/rewind `last-prompt` checkpoint in remote
  // CCR v2 sessions with a registered `internalEventWriter`. Local `/clear`
  // MUST NOT write a clear-checkpoint tombstone to the pre-clear local `.jsonl`
  // file, otherwise `claude --resume <prevSessionId>` permanently fails.
  if (
    getIsRemoteMode() &&
    hasInternalEventWriter() &&
    !isTranscriptPersistenceDisabled()
  ) {
    try {
      const { saveExplicitClearCheckpoint } = await import(
        '../../utils/sessionStorage.js'
      )
      await saveExplicitClearCheckpoint(prevSessionId)
    } catch {
      // best-effort when diskless or storage unavailable
    }
  }

  regenerateSessionId({ setCurrentAsParent: true })
  const newSessionId = getSessionId()

  if (isAgentSwarmsEnabled()) {
    await noteSessionTaskListAfterClear(newSessionId)
  }

  // Official 2.1.328 (#393): only rename HI(sourceId) -> HI(newSessionId)
  // when an explicit ownTaskListId differs from newSessionId (so local `/clear`
  // never renames `<prevSessionId>` tasks into `<newSessionId>`).
  const ownTaskSourceId = getOwnTaskListId(newSessionId)
  if (ownTaskSourceId !== newSessionId) {
    await moveOwnTaskListOnClear(ownTaskSourceId, newSessionId, {
      ownTaskListId: ownTaskSourceId,
      setOwnTaskListId,
    })
  }
  // densable #21 & #1773 — after new id is live, notify RC clients of
  // conversation_reset and re-emit full background_tasks_changed
  notifyRemoteConversationCleared(
    survivingTasksSnapshot ?? getAppState?.().tasks,
  )
  // Update the environment variable so subprocesses use the new session ID
  if (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_CODE_SESSION_ID) {
    process.env.CLAUDE_CODE_SESSION_ID = getSessionId()
  }
  await resetSessionFilePointer()

  // Preserved local_agent tasks had their TaskOutput symlink baked against the
  // old session ID at spawn time, but post-clear transcript writes land under
  // the new session directory (appendEntry re-reads getSessionId()). Re-point
  // the symlinks so TaskOutput reads the live file instead of a frozen pre-clear
  // snapshot. Only re-point running tasks — finished tasks will never write
  // again, so re-pointing would replace a valid symlink with a dangling one.
  // Main-session tasks use the same per-agent path (they write via
  // recordSidechainTranscript to getAgentTranscriptPath), so no special case.
  for (const task of preservedLocalAgents) {
    if (task.status !== 'running') continue
    void initTaskOutputAsSymlink(
      task.id,
      getAgentTranscriptPath(asAgentId(task.agentId)),
    )
  }

  // Re-persist mode and worktree state after the clear so future --resume
  // knows what the new post-clear session was in. clearSessionMetadata
  // wiped both from the cache, but the process is still in the same mode
  // and (if applicable) the same worktree directory.
  if (feature('COORDINATOR_MODE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { saveMode } = require('../../utils/sessionStorage.js')
    const {
      isCoordinatorMode,
    } = require('../../coordinator/coordinatorMode.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    saveMode(isCoordinatorMode() ? 'coordinator' : 'normal')
  }
  const worktreeSession = getCurrentWorktreeSession()
  if (worktreeSession) {
    saveWorktreeState(worktreeSession)
  }

  // Execute classic SessionStart settings hooks after clearing (function-hook
  // `session.start` does not fire on `'clear'`, per gold `claude-code.d.ts`).
  const clearSlot = clearSessionStartSlot.of(getBootstrapSession())
  const activeClearSessionStartController = clearSlot.controller
  activeClearSessionStartController?.abort()
  const orphanedController = new AbortController()
  clearSlot.controller = orphanedController
  let hookMessages: Awaited<ReturnType<typeof processSessionStartHooks>>
  try {
    hookMessages = await processSessionStartHooks('clear', {
      orphaned: orphanedController.signal,
    })
  } finally {
    if (clearSlot.controller === orphanedController) {
      clearSlot.controller = null
    }
  }

  // Update messages with hook results
  if (!orphanedController.signal.aborted && hookMessages.length > 0) {
    setMessages(() => hookMessages)
  }
}
