import { setMainLoopModelOverride } from '../bootstrap/state.js'
import {
  clearApiKeyHelperCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { toError } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'
import {
  permissionModeFromString,
  toExternalPermissionMode,
} from '../utils/permissions/PermissionMode.js'
import {
  isWorkerPermissionModeRecordEnabled,
  notifyInternalMetadataChanged,
  notifyPermissionModeChanged,
  notifySessionMetadataChanged,
  type SessionExternalMetadata,
} from '../utils/sessionState.js'
import { isObserverAgentTask } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../tasks/types.js'
import type { AppState } from './AppStateStore.js'

/**
 * densable 2.1.211 Kw / 2.1.289 yg — live background membership for stream
 * level signal. running|pending, and if isBackgrounded is present it must not
 * be false (foreground-registered agents are excluded until mid-bg flip).
 */
function isLiveBackgroundTask(task: TaskState): boolean {
  if (task.status !== 'running' && task.status !== 'pending') {
    return false
  }
  if ('isBackgrounded' in task && task.isBackgrounded === false) {
    return false
  }
  return true
}

/**
 * densable 2.1.289 Ku — observer local_agent tasks are excluded from CCR/SDK
 * live lists; owner-agent Ku also stamps observer_owned on child shells/monitors.
 */
function isObserverExcludedTask(task: TaskState): boolean {
  return isObserverAgentTask(task)
}

/** densable 2.1.211 Zlr / 2.1.289 y — wire list for background_tasks_changed. */
function listLiveBackgroundTasks(tasks: AppState['tasks'] | undefined): Array<{
  task_id: string
  task_type: string
  description: string
  ambient?: boolean
}> {
  if (!tasks) return []
  return Object.values(tasks)
    .filter(t => isLiveBackgroundTask(t) && !isObserverExcludedTask(t))
    .map(t => ({
      task_id: t.id,
      task_type: t.type,
      description: t.description,
      ...('ambient' in t &&
      typeof (t as { ambient?: unknown }).ambient === 'boolean'
        ? { ambient: (t as { ambient: boolean }).ambient }
        : {}),
    }))
}

/** densable 2.1.289 CCR internal allowlist (gold E type filter). */
const RUNNING_BACKGROUND_TASK_TYPES = new Set([
  'local_bash',
  'monitor_mcp',
  'monitor_ws',
  'local_agent',
  'local_workflow',
])

export type RunningBackgroundTaskInternal = {
  task_id: string
  task_type: string
  description: string
  owner_agent_id?: string
  shell_kind?: string
  ambient?: boolean
  observer_owned?: boolean
}

/**
 * densable 2.1.289 L — shell/monitor owned by an observer agent.
 */
function isObserverOwnedBackgroundTask(
  task: TaskState,
  tasks: AppState['tasks'],
): boolean {
  if (
    task.type !== 'local_bash' &&
    task.type !== 'monitor_mcp' &&
    task.type !== 'monitor_ws'
  ) {
    return false
  }
  const agentId = 'agentId' in task ? task.agentId : undefined
  if (agentId === undefined) return false
  const owner = tasks[agentId]
  return owner !== undefined && isObserverExcludedTask(owner)
}

/**
 * densable 2.1.289 E — CCR internal_metadata.running_background_tasks writer
 * list (type-filtered live set + optional owner/shell/ambient/observer_owned).
 */
export function listRunningBackgroundTasksForInternalMetadata(
  tasks: AppState['tasks'] | undefined,
): RunningBackgroundTaskInternal[] {
  if (!tasks) return []
  return Object.values(tasks)
    .filter(
      t =>
        isLiveBackgroundTask(t) &&
        !isObserverExcludedTask(t) &&
        RUNNING_BACKGROUND_TASK_TYPES.has(t.type),
    )
    .map(t => {
      const entry: RunningBackgroundTaskInternal = {
        task_id: t.id,
        task_type: t.type,
        description: t.description,
      }
      if (
        (t.type === 'local_bash' ||
          t.type === 'monitor_mcp' ||
          t.type === 'monitor_ws') &&
        'agentId' in t &&
        t.agentId !== undefined
      ) {
        entry.owner_agent_id = t.agentId
      }
      if (
        t.type === 'local_bash' &&
        'kind' in t &&
        (t as { kind?: unknown }).kind !== undefined
      ) {
        entry.shell_kind = String((t as { kind: string | number }).kind)
      }
      if (
        t.type === 'monitor_ws' &&
        'ambient' in t &&
        (t as { ambient?: unknown }).ambient
      ) {
        entry.ambient = true
      }
      if (isObserverOwnedBackgroundTask(t, tasks)) {
        entry.observer_owned = true
      }
      return entry
    })
}

function backgroundTasksMembershipChanged(
  prev: Array<{ task_id: string }>,
  next: Array<{ task_id: string }>,
): boolean {
  if (prev.length !== next.length) return true
  return next.some((t, i) => t.task_id !== prev[i]?.task_id)
}

// Inverse of the push below — restore on worker restart.
export function externalMetadataToAppState(
  metadata: SessionExternalMetadata,
): (prev: AppState) => AppState {
  return prev => ({
    ...prev,
    ...(typeof metadata.permission_mode === 'string'
      ? {
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: permissionModeFromString(metadata.permission_mode),
          },
        }
      : {}),
  })
}

export function onChangeAppState({
  newState,
  oldState,
}: {
  newState: AppState
  oldState: AppState
}) {
  // toolPermissionContext.mode — single choke point for CCR/SDK mode sync.
  //
  // Prior to this block, mode changes were relayed to CCR by only 2 of 8+
  // mutation paths: a bespoke setAppState wrapper in print.ts (headless/SDK
  // mode only) and a manual notify in the set_permission_mode handler.
  // Every other path — Shift+Tab cycling, ExitPlanModePermissionRequest
  // dialog options, the /plan slash command, rewind, the REPL bridge's
  // onSetPermissionMode — mutated AppState without telling
  // CCR, leaving external_metadata.permission_mode stale and the web UI out
  // of sync with the CLI's actual mode.
  //
  // Hooking the diff here means ANY setAppState call that changes the mode
  // notifies CCR (via notifySessionMetadataChanged → ccrClient.reportMetadata)
  // and the SDK status stream (via notifyPermissionModeChanged → registered
  // in print.ts). The scattered callsites above need zero changes.
  const prevMode = oldState.toolPermissionContext.mode
  const newMode = newState.toolPermissionContext.mode
  if (prevMode !== newMode) {
    // CCR external_metadata must not receive internal-only mode names
    // (bubble). Externalize first — and skip the CCR notify if the
    // EXTERNAL mode didn't change (e.g., default→bubble→default is noise
    // from CCR's POV since both externalize to 'default'). Official 2.1.207:
    // auto is first-class external and is reported as 'auto'. The SDK channel
    // (notifyPermissionModeChanged) passes raw mode; print.ts filters itself.
    const prevExternal = toExternalPermissionMode(prevMode)
    const newExternal = toExternalPermissionMode(newMode)
    if (prevExternal !== newExternal) {
      notifySessionMetadataChanged({
        permission_mode: newExternal,
      })
      // Official k8e: only after enableWorkerPermissionModeRecord (XWy).
      if (isWorkerPermissionModeRecordEnabled()) {
        notifyInternalMetadataChanged({
          worker_permission_mode: newExternal,
        })
      }
    }
    notifyPermissionModeChanged(newMode)
  }

  // densable 2.1.211 JNe / 2.1.289: e.tasks!==t.tasks →
  //   E membership → notifyInternalMetadataChanged({running_background_tasks})
  //   y membership → system/background_tasks_changed (REPLACE full live set).
  // notifyInternalMetadataChanged noops when no CCR listener is registered.
  if (newState.tasks !== oldState.tasks) {
    const prevInternal = listRunningBackgroundTasksForInternalMetadata(
      oldState.tasks,
    )
    const nextInternal = listRunningBackgroundTasksForInternalMetadata(
      newState.tasks,
    )
    if (backgroundTasksMembershipChanged(prevInternal, nextInternal)) {
      notifyInternalMetadataChanged({
        running_background_tasks: nextInternal,
      })
    }

    const prevLive = listLiveBackgroundTasks(oldState.tasks)
    const nextLive = listLiveBackgroundTasks(newState.tasks)
    if (backgroundTasksMembershipChanged(prevLive, nextLive)) {
      try {
        const { emitBackgroundTasksChangedSdk } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/sdkEventQueue.js') as typeof import('../utils/sdkEventQueue.js')
        emitBackgroundTasksChangedSdk(nextLive)
      } catch {
        // optional
      }
    }
  }

  // mainLoopModel: session-scoped only (do NOT persist to userSettings).
  // Writing to settings.json would leak model changes into other running
  // sessions (anthropics/claude-code#37596). Each process keeps its own
  // model override in memory via setMainLoopModelOverride.
  if (newState.mainLoopModel !== oldState.mainLoopModel) {
    setMainLoopModelOverride(newState.mainLoopModel)
  }

  // expandedView → persist as showExpandedTodos + showSpinnerTree for backwards compat
  if (newState.expandedView !== oldState.expandedView) {
    const showExpandedTodos = newState.expandedView === 'tasks'
    const showSpinnerTree = newState.expandedView === 'teammates'
    if (
      getGlobalConfig().showExpandedTodos !== showExpandedTodos ||
      getGlobalConfig().showSpinnerTree !== showSpinnerTree
    ) {
      saveGlobalConfig(current => ({
        ...current,
        showExpandedTodos,
        showSpinnerTree,
      }))
    }
  }

  // verbose
  if (
    newState.verbose !== oldState.verbose &&
    getGlobalConfig().verbose !== newState.verbose
  ) {
    const verbose = newState.verbose
    saveGlobalConfig(current => ({
      ...current,
      verbose,
    }))
  }

  // tungstenPanelVisible (ant-only tmux panel sticky toggle)
  if (process.env.USER_TYPE === 'ant') {
    if (
      newState.tungstenPanelVisible !== oldState.tungstenPanelVisible &&
      newState.tungstenPanelVisible !== undefined &&
      getGlobalConfig().tungstenPanelVisible !== newState.tungstenPanelVisible
    ) {
      const tungstenPanelVisible = newState.tungstenPanelVisible
      saveGlobalConfig(current => ({ ...current, tungstenPanelVisible }))
    }
  }

  // settings: clear auth-related caches when settings change
  // This ensures apiKeyHelper and AWS/GCP credential changes take effect immediately
  if (newState.settings !== oldState.settings) {
    try {
      clearApiKeyHelperCache()
      clearAwsCredentialsCache()
      clearGcpCredentialsCache()

      // Re-apply environment variables when settings.env changes
      // This is additive-only: new vars are added, existing may be overwritten, nothing is deleted
      if (newState.settings.env !== oldState.settings.env) {
        applyConfigEnvironmentVariables()
      }
    } catch (error) {
      logError(toError(error))
    }
  }
}
