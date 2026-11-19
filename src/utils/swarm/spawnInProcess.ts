/**
 * In-process teammate spawning
 *
 * Creates and registers an in-process teammate task. Unlike process-based
 * teammates (tmux/iTerm2), in-process teammates run in the same Node.js
 * process using AsyncLocalStorage for context isolation.
 *
 * The actual agent execution loop is handled by InProcessTeammateTask
 * component (Task #14). This module handles:
 * 1. Creating TeammateContext
 * 2. Creating linked AbortController
 * 3. Registering InProcessTeammateTaskState in AppState
 * 4. Returning spawn result for backend
 */

import sample from 'lodash-es/sample.js'
import { getSessionId } from '../../bootstrap/state.js'
import { getSpinnerVerbs } from '../../constants/spinnerVerbs.js'
import { TURN_COMPLETION_VERBS } from '../../constants/turnCompletionVerbs.js'
import { logEvent } from '../../services/analytics/index.js'
import { redactSecretsForDisplay } from '../../services/teamMemorySync/secretScanner.js'
import type { AppState } from '../../state/AppState.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type {
  InProcessTeammateTaskState,
  TeammateIdentity,
} from '../../tasks/InProcessTeammateTask/types.js'
import { createAbortController } from '../abortController.js'
import { markAutonomyRunFailed } from '../autonomyRuns.js'
import { formatAgentId } from '../agentId.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { emitTaskTerminatedSdk } from '../sdkEventQueue.js'
import { evictTaskOutput } from '../task/diskOutput.js'
import {
  addKeepaliveReason,
  idleWindowKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  STOPPED_DISPLAY_MS,
} from '../task/framework.js'
import { createTaskRegistry, type TaskRegistry } from '../taskRegistry.js'
import { createTeammateContext } from '../teammateContext.js'
import {
  isPerfettoTracingEnabled,
  registerAgent as registerPerfettoAgent,
  unregisterAgent as unregisterPerfettoAgent,
} from '../telemetry/perfettoTracing.js'
import type { PermissionMode } from '../../types/permissions.js'
import { removeMemberByAgentId } from './teamHelpers.js'

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

type KillableTeammateTaskState = InProcessTeammateTaskState & {
  paneTeardown?: () => Promise<boolean>
}

/**
 * Hold/release `flag:idle-window` keepalive around teammate idle transition
 * and wakeup (densable yG / YP / hx).
 */
export function holdTeammateIdleWindowKeepalive(
  ownerAgentId: string | undefined,
  registry: TaskRegistry | undefined,
): void {
  if (!registry) return
  addKeepaliveReason(ownerAgentId, idleWindowKeepaliveReason(), registry)
}

export function releaseTeammateIdleWindowKeepalive(
  ownerAgentId: string | undefined,
  registry: TaskRegistry | undefined,
): void {
  if (!registry) return
  removeKeepaliveReason(ownerAgentId, idleWindowKeepaliveReason(), registry)
}

/**
 * Minimal context required for spawning an in-process teammate.
 * This is a subset of ToolUseContext - only what spawnInProcessTeammate actually uses.
 */
export type SpawnContext = {
  setAppState: SetAppStateFn
  getAppState?: () => AppState
  toolUseId?: string
}

/**
 * Configuration for spawning an in-process teammate.
 */
export type InProcessSpawnConfig = {
  /** Display name for the teammate, e.g., "researcher" */
  name: string
  /** Team this teammate belongs to */
  teamName: string
  /** Initial prompt/task for the teammate */
  prompt: string
  /** Optional UI color for the teammate */
  color?: string
  /** Whether teammate must enter plan mode before implementing */
  planModeRequired: boolean
  /** Optional model override for this teammate */
  model?: string
  /** Official #1592: effort-picked model carried on teammate spawn config. */
  pickedEffortModel?: string
  /** densable spawn stamp; wins over session-derived M(). */
  permissionMode?: PermissionMode
  /** Leader session mode for densable `M(de(o).mode, planModeRequired)`. */
  sessionPermissionMode?: PermissionMode
}

/**
 * densable `M(e, o)` — in-process teammate permission stamp.
 * plan required → plan; session plan/dontAsk → default; else session.
 */
export function resolveInProcessTeammatePermissionMode(
  sessionMode: PermissionMode | undefined,
  planModeRequired: boolean,
): PermissionMode {
  if (planModeRequired) return 'plan'
  if (sessionMode === 'plan' || sessionMode === 'dontAsk') return 'default'
  return sessionMode ?? 'default'
}

/**
 * Result from spawning an in-process teammate.
 */
export type InProcessSpawnOutput = {
  /** Whether spawn was successful */
  success: boolean
  /** Full agent ID (format: "name@team") */
  agentId: string
  /** Task ID for tracking in AppState */
  taskId?: string
  /** AbortController for this teammate (linked to parent) */
  abortController?: AbortController
  /** Teammate context for AsyncLocalStorage */
  teammateContext?: ReturnType<typeof createTeammateContext>
  /** Error message if spawn failed */
  error?: string
}

/**
 * Spawns an in-process teammate.
 *
 * Creates the teammate's context, registers the task in AppState, and returns
 * the spawn result. The actual agent execution is driven by the
 * InProcessTeammateTask component which uses runWithTeammateContext() to
 * execute the agent loop with proper identity isolation.
 *
 * @param config - Spawn configuration
 * @param context - Context with setAppState for registering task
 * @returns Spawn result with teammate info
 */
export function resolveSwarmPickedEffortModel(config: {
  pickedEffortModel?: string
  model?: string
}): string | undefined {
  return config.pickedEffortModel ?? config.model
}

export async function spawnInProcessTeammate(
  config: InProcessSpawnConfig,
  context: SpawnContext,
): Promise<InProcessSpawnOutput> {
  const { name, teamName, prompt, color, planModeRequired, model } = config
  const { setAppState } = context

  // Generate deterministic agent ID
  const agentId = formatAgentId(name, teamName)
  const taskId = generateTaskId('in_process_teammate')

  logForDebugging(
    `[spawnInProcessTeammate] Spawning ${agentId} (taskId: ${taskId})`,
  )

  try {
    // Create independent AbortController for this teammate
    // Teammates should not be aborted when the leader's query is interrupted
    const abortController = createAbortController()

    // Get parent session ID for transcript correlation
    const parentSessionId = getSessionId()

    // Create teammate identity (stored as plain data in AppState)
    const identity: TeammateIdentity = {
      agentId,
      agentName: name,
      teamName,
      color,
      planModeRequired,
      parentSessionId,
    }

    // Create teammate context for AsyncLocalStorage
    // This will be used by runWithTeammateContext() during agent execution
    const teammateContext = createTeammateContext({
      agentId,
      agentName: name,
      teamName,
      color,
      planModeRequired,
      parentSessionId,
      abortController,
    })

    // Register agent in Perfetto trace for hierarchy visualization
    if (isPerfettoTracingEnabled()) {
      registerPerfettoAgent(agentId, name, parentSessionId)
    }

    // Create task state (#589: redact credentials before truncating description)
    const redactedPrompt = redactSecretsForDisplay(prompt)
    const description = `${name}: ${redactedPrompt.substring(0, 50)}${redactedPrompt.length > 50 ? '...' : ''}`

    const taskState: InProcessTeammateTaskState = {
      ...createTaskStateBase(
        taskId,
        'in_process_teammate',
        description,
        context.toolUseId,
      ),
      type: 'in_process_teammate',
      status: 'running',
      identity,
      prompt,
      model,
      abortController,
      awaitingPlanApproval: false,
      spinnerVerb: sample(getSpinnerVerbs()),
      pastTenseVerb: sample(TURN_COMPLETION_VERBS),
      permissionMode:
        config.permissionMode ??
        resolveInProcessTeammatePermissionMode(
          config.sessionPermissionMode,
          planModeRequired,
        ),
      isIdle: false,
      shutdownRequested: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
      pendingUserMessages: [],
      messages: [], // Initialize to empty array so getDisplayedMessages works immediately
    }

    // Register cleanup handler for graceful shutdown
    const unregisterCleanup = registerCleanup(async () => {
      logForDebugging(`[spawnInProcessTeammate] Cleanup called for ${agentId}`)
      abortController.abort()
      // Task state will be updated by the execution loop when it detects abort
    })
    taskState.unregisterCleanup = unregisterCleanup

    // All force-kill entry points abort this controller, including Task.kill
    // which only receives a registry. Capture the real spawning store setter
    // here so that path also removes the live teammate from the UI.
    abortController.signal.addEventListener(
      'abort',
      () => setAppState(prev => dropTeammateFromTeamContext(prev, agentId)),
      { once: true },
    )

    // Register task in AppState
    registerTask(taskState, setAppState)
    const getState: () => AppState =
      context.getAppState ??
      (() => {
        let snapshot = { tasks: {} } as unknown as AppState
        setAppState(prev => {
          snapshot = prev
          return prev
        })
        return snapshot
      })
    releaseTeammateIdleWindowKeepalive(
      agentId,
      createTaskRegistry(getState, setAppState),
    )

    logForDebugging(
      `[spawnInProcessTeammate] Registered ${agentId} in AppState`,
    )
    logEvent('swarm_in_process_spawn', {})

    return {
      success: true,
      agentId,
      taskId,
      abortController,
      teammateContext,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error during spawn'
    logForDebugging(
      `[spawnInProcessTeammate] Failed to spawn ${agentId}: ${errorMessage}`,
    )
    return {
      success: false,
      agentId,
      error: errorMessage,
    }
  }
}

/**
 * Drop a live teammate from AppState.teamContext.teammates.
 * Matches spawnMultiAgent.updateTeamContext / removeSpawnedTeammateFromAppState:
 * keyed by agentId (`name@team`), rest of teamContext preserved.
 */
function dropTeammateFromTeamContext(
  prev: AppState,
  agentId: string,
): AppState {
  if (!prev.teamContext?.teammates?.[agentId]) {
    return prev
  }
  const { [agentId]: _removed, ...teammates } = prev.teamContext.teammates
  return {
    ...prev,
    teamContext: {
      ...prev.teamContext,
      teammates,
    },
  }
}

/**
 * Kills an in-process teammate by aborting its controller.
 *
 * Note: This is the implementation called by InProcessBackend.kill().
 *
 * @param taskId - Task ID of the teammate to kill
 * @param registry - densable Xm
 * @param setAppState - same setter the registry closes over; drops UI teammates
 * @returns true if killed successfully
 */
export function killInProcessTeammate(
  taskId: string,
  registry: TaskRegistry,
  setAppState?: SetAppStateFn,
): boolean {
  const task = registry.get(taskId)
  if (
    !task ||
    task.type !== 'in_process_teammate' ||
    task.status !== 'running'
  ) {
    return false
  }

  const teammateTask = task as KillableTeammateTaskState
  const teamName = teammateTask.identity.teamName
  const agentId = teammateTask.identity.agentId
  const toolUseId = teammateTask.toolUseId
  const description = teammateTask.description
  const pendingAutonomyRuns = teammateTask.pendingUserMessages.flatMap(
    message =>
      message.autonomyRunId
        ? [
            {
              runId: message.autonomyRunId,
              ...(message.autonomyRootDir
                ? { rootDir: message.autonomyRootDir }
                : {}),
            },
          ]
        : [],
  )

  teammateTask.abortController?.abort()
  teammateTask.unregisterCleanup?.()
  teammateTask.onIdleCallbacks?.forEach(cb => cb())

  registry.update<KillableTeammateTaskState>(taskId, () => ({
    ...teammateTask,
    status: 'killed' as const,
    notified: true,
    endTime: Date.now(),
    onIdleCallbacks: [],
    messages: teammateTask.messages?.length
      ? [teammateTask.messages[teammateTask.messages.length - 1]!]
      : undefined,
    pendingUserMessages: [],
    inProgressToolUseIDs: undefined,
    abortController: undefined,
    unregisterCleanup: undefined,
    currentWorkAbortController: undefined,
    paneTeardown: undefined,
    evictAfter: undefined,
  }))

  // Banner/footer/inbox read teamContext.teammates, not the team file.
  // Xm.update only patches tasks — drop the live member in the same setter.
  if (agentId && setAppState) {
    setAppState(prev => dropTeammateFromTeamContext(prev, agentId))
  }

  if (teamName && agentId) {
    removeMemberByAgentId(teamName, agentId)
  }

  releaseTeammateIdleWindowKeepalive(agentId ?? taskId, registry)
  for (const run of pendingAutonomyRuns) {
    void markAutonomyRunFailed(
      run.runId,
      `Teammate ${agentId ?? taskId} was stopped before it could consume the queued autonomy prompt.`,
      run.rootDir,
    )
  }
  void evictTaskOutput(taskId)
  emitTaskTerminatedSdk(taskId, 'stopped', {
    toolUseId,
    summary: description,
  })
  setTimeout(() => {
    registry.evictTerminal(taskId)
  }, STOPPED_DISPLAY_MS)
  logEvent('swarm_in_process_kill', {})
  if (agentId) {
    unregisterPerfettoAgent(agentId)
  }
  return true
}

/**
 * Kills an in-process teammate by logical agent ID.
 * Used by team-level UI/actions where the stable identifier is
 * "name@team", not the AppState task id.
 */
export function killInProcessTeammateByAgentId(
  agentIdToKill: string,
  registry: TaskRegistry,
  setAppState?: SetAppStateFn,
): boolean {
  let taskIdToKill: string | undefined
  for (const [taskId, task] of Object.entries(registry.all())) {
    if (
      task.type === 'in_process_teammate' &&
      'identity' in task &&
      (task as KillableTeammateTaskState).identity.agentId === agentIdToKill &&
      task.status === 'running'
    ) {
      taskIdToKill = taskId
      break
    }
  }
  if (!taskIdToKill) {
    return false
  }
  return killInProcessTeammate(taskIdToKill, registry, setAppState)
}
