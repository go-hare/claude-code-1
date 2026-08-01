import {
  createFileJournalStore,
  type ProgressEvent,
  type WorkflowPorts,
} from '@claude-code/workflow-engine'
import { logForDebugging } from '../utils/debug.js'
import { getProjectRoot } from '../bootstrap/state.js'
import { getRunsDir } from './persistence.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { AgentId } from '../types/ids.js'
import {
  completeWorkflowTask,
  consumePendingAgentAction,
  failWorkflowTask,
  killWorkflowTask,
  registerLocalWorkflowTask,
  retryWorkflowAgent,
  skipWorkflowAgent,
} from '../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  buildHostBundle,
  makeHostHandle,
  readHostBundle,
  type WorkflowHostBundle,
} from './hostHandle.js'
import { buildRegistry } from './registry.js'
import type { ProgressBus } from './progress/bus.js'
import type { ProgressStore } from './progress/store.js'
import {
  installWorkflowTaskProgressBridge,
  type WorkflowTaskProgressBinding,
} from './taskProgressBridge.js'
import type { SetAppState } from '../Task.js'
import type { AssistantMessage } from '../types/message.js'

type RunBinding = {
  runId: string
  taskId: string
  setAppState: SetAppState
  abortController: AbortController
  workflowName: string
  /** densable jrH / task_progress bookkeeping (startTime + toolUseId + description). */
  progress: WorkflowTaskProgressBinding
  /** agentId → AbortController. Registered when backend starts an agent; killAgent uses it for precise abort. */
  agentAbortControllers: Map<number, AbortController>
}

/** Constructs a WorkflowHostContext from toolUseContext on each tool invocation. */
function makeHostFactory(): WorkflowPorts['hostFactory'] {
  return ({ context, canUseTool, parentMessage }) => {
    const ctx = context as WorkflowHostBundle['toolUseContext'] & {
      agentId?: string
    }
    return {
      handle: makeHostHandle(
        buildHostBundle(
          ctx,
          canUseTool as WorkflowHostBundle['canUseTool'],
          parentMessage as AssistantMessage | undefined,
        ),
      ),
      // Use projectRoot rather than getCwd(): shares the same root as journalStore's runsDir,
      // otherwise named workflow resolution and journal persistence diverge when the user
      // enters a worktree/sub-directory. The engine's internal ctx.cwd is only used for
      // resolution (scriptPath/name) and does not affect the agent's execution cwd
      // (the agent gets its own cwd via the toolUseContext inside the host bundle).
      cwd: getProjectRoot(),
      budgetTotal: null, // turn-level budget injection point (read from settings in the future)
      ...(ctx.toolUseId ? { toolUseId: ctx.toolUseId } : {}),
    }
  }
}

/**
 * Assembles the complete WorkflowPorts. bus/store are passed in by the caller (shared via the service singleton).
 * taskRegistrar maintains runId → RunBinding for kill routing.
 */
export function createWorkflowPorts(opts: {
  bus: ProgressBus
  store: ProgressStore
}): WorkflowPorts {
  const bindings = new Map<string, RunBinding>()
  const runsDir = getRunsDir()
  const registry = buildRegistry()

  // densable: mid-run system/task_progress (+ workflow_progress deltas) so Desktop
  // Tasks can enable Running local_workflow rows. Must install before register so
  // early bus events still find the binding after task_started.
  const taskProgressBridge = installWorkflowTaskProgressBridge({
    bus: opts.bus,
    store: opts.store,
    getBinding: runId => bindings.get(runId)?.progress,
  })

  // Telemetry subscription (independent of store). LogEventMetadata only accepts boolean/number/undefined,
  // and runId is a string — use the brand cast provided by the analytics module (verified non-code/path) to pass it through.
  opts.bus.subscribe((e: ProgressEvent) => {
    if (e.type === 'run_done') {
      logEvent('tengu_workflow_done', {
        status: e.status === 'completed' ? 0 : e.status === 'failed' ? 1 : 2,
        runId:
          e.runId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  })

  const taskRegistrar: WorkflowPorts['taskRegistrar'] = {
    register(regOpts, host) {
      const bundle = readHostBundle(host)
      const setAppState =
        bundle.toolUseContext.setAppStateForTasks ??
        bundle.toolUseContext.setAppState
      const abortController = new AbortController()
      const description = regOpts.summary ?? regOpts.workflowName
      // Register first; patch workflowRunId after we know taskId when engine omitted runId.
      const taskId = registerLocalWorkflowTask(setAppState, {
        description,
        workflowName: regOpts.workflowName,
        workflowFile: regOpts.workflowFile ?? '',
        summary: regOpts.summary,
        ...(regOpts.toolUseId ? { toolUseId: regOpts.toolUseId } : {}),
        abortController,
        ...(regOpts.runId ? { workflowRunId: regOpts.runId } : {}),
      })
      const resolvedRunId = regOpts.runId ?? taskId
      // Stamp workflowRunId when engine didn't pass one (task id is the run id).
      if (!regOpts.runId) {
        setAppState(prev => {
          const t = prev.tasks?.[taskId]
          if (!t || t.type !== 'local_workflow') return prev
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [taskId]: { ...t, workflowRunId: resolvedRunId },
            },
          }
        })
      }
      // Prefer AppState startTime if the task is already registered (registerTask
      // sets it); fall back to now so emit duration_ms stays non-zero.
      const getAppState = bundle.toolUseContext.getAppState
      const startTime =
        (typeof getAppState === 'function'
          ? (
              getAppState()?.tasks?.[taskId] as
                | { startTime?: number }
                | undefined
            )?.startTime
          : undefined) ?? Date.now()
      bindings.set(resolvedRunId, {
        runId: resolvedRunId,
        taskId,
        setAppState,
        abortController,
        workflowName: regOpts.workflowName,
        progress: {
          taskId,
          description,
          summary: regOpts.summary ?? description,
          startTime,
          setAppState,
          ...(regOpts.toolUseId ? { toolUseId: regOpts.toolUseId } : {}),
        },
        agentAbortControllers: new Map(),
      })
      logForDebugging(
        `workflow task registered: ${resolvedRunId} (${regOpts.workflowName})`,
      )
      return { runId: resolvedRunId, signal: abortController.signal }
    },
    complete(runId, summary) {
      const b = bindings.get(runId)
      if (!b) return
      // densable flushes pending progress before terminal task_notification.
      taskProgressBridge.forceFlush(runId)
      completeWorkflowTask(b.taskId, b.setAppState)
      logForDebugging(`workflow ${runId} completed: ${summary ?? ''}`)
      bindings.delete(runId)
    },
    fail(runId, error) {
      const b = bindings.get(runId)
      if (!b) return
      taskProgressBridge.forceFlush(runId)
      failWorkflowTask(b.taskId, b.setAppState, error)
      logForDebugging(`workflow ${runId} failed: ${error}`)
      bindings.delete(runId)
    },
    kill(runId) {
      const b = bindings.get(runId)
      if (!b) return
      taskProgressBridge.forceFlush(runId)
      killWorkflowTask(b.taskId, b.setAppState) // internal abort controller
      // Killing the run also aborts all in-flight agents (guards against the edge timing where the backend misses the task abort)
      for (const ac of b.agentAbortControllers.values()) {
        try {
          ac.abort()
        } catch {
          // no-op: abort won't throw internally, but fail-closed
        }
      }
      b.agentAbortControllers.clear()
      bindings.delete(runId)
    },
    registerAgentAbort(runId, agentId, ac) {
      const b = bindings.get(runId)
      if (!b) return
      b.agentAbortControllers.set(agentId, ac)
    },
    unregisterAgentAbort(runId, agentId) {
      const b = bindings.get(runId)
      if (!b) return
      b.agentAbortControllers.delete(agentId)
    },
    killAgent(runId, agentId, reason) {
      const b = bindings.get(runId)
      if (!b) return false
      const ac = b.agentAbortControllers.get(agentId)
      if (!ac) return false
      try {
        // densable yqK aborts with reason "user-skip" / "user-retry".
        if (reason !== undefined) ac.abort(reason)
        else ac.abort()
      } catch {
        // no-op
      }
      b.agentAbortControllers.delete(agentId)
      return true
    },
    // densable RG_/LG_ (yqK): abort in-flight agentControllers with reason.
    // When no controller is registered (between agents), queue pendingAgentAction so
    // the next agent() poll can skip/retry. If a controller is still registered but
    // already aborted (window before backend finally unregister), treat as handled —
    // do NOT queue pending (would double-skip the next agent).
    skipAgent(runId, agentId) {
      const b = bindings.get(runId)
      if (!b) return false
      const ac = b.agentAbortControllers.get(agentId)
      if (ac) {
        if (!ac.signal.aborted) {
          try {
            ac.abort('user-skip')
          } catch {
            // no-op
          }
        }
        return true
      }
      skipWorkflowAgent(b.taskId, String(agentId) as AgentId, b.setAppState)
      return true
    },
    retryAgent(runId, agentId) {
      const b = bindings.get(runId)
      if (!b) return false
      const ac = b.agentAbortControllers.get(agentId)
      if (ac) {
        if (!ac.signal.aborted) {
          try {
            ac.abort('user-retry')
          } catch {
            // no-op
          }
        }
        return true
      }
      retryWorkflowAgent(b.taskId, String(agentId) as AgentId, b.setAppState)
      return true
    },
    pendingAction(runId) {
      // densable: engine polls before each agent(); consume task.pendingAgentAction.
      // skip → agent returns null without running; retry clears the flag so the next
      // agent() starts clean (in-flight abort is skipAgent/retryAgent/killAgent).
      const b = bindings.get(runId)
      if (!b) return null
      const consumed = consumePendingAgentAction(b.taskId, b.setAppState)
      if (!consumed) return null
      if (consumed.kind === 'skip') return { kind: 'skip' as const }
      // retry: clear the flag; if a numeric agent index is still live, abort it
      // so the next agent() call restarts that step. Engine only auto-skips on
      // kind==='skip'; retry is for mid-flight abort+requeue UX.
      const n = Number(consumed.agentId)
      if (Number.isFinite(n)) {
        const ac = b.agentAbortControllers.get(n)
        if (ac && !ac.signal.aborted) {
          try {
            ac.abort('user-retry')
          } catch {
            // no-op
          }
        }
      }
      return { kind: 'retry' as const }
    },
  }

  return {
    hostFactory: makeHostFactory(),
    agentAdapterRegistry: registry,
    agentRunner: {
      // Dead-code fallback: hooks always go through agentAdapterRegistry (required on ports). Reaching here means the registry was not registered — fail-fast.
      async runAgentToResult() {
        throw new Error(
          'workflow agentRunner fallback reached — agentAdapterRegistry must be set on ports',
        )
      },
    },
    progressEmitter: {
      emit(event) {
        opts.bus.emit(event) // → store reducer + telemetry
      },
    },
    taskRegistrar,
    journalStore: createFileJournalStore(runsDir),
    permissionGate: { isAborted: () => false }, // engine uses ctx.signal to check abort
    logger: {
      debug: msg => logForDebugging(msg),
      warn: msg => logForDebugging(`[workflow warn] ${msg}`),
      event: name => logForDebugging(`workflow event: ${name}`),
    },
  }
}
