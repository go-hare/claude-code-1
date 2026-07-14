/**
 * Shared real ObserverRuntimeHost handlers (G0t spawn/deliver/abort).
 *
 * AgentTool, query VOu (main-session ensure), and resumeAgent zOu all install
 * the same pairing-scoped host so first-run is a real async observer fork —
 * not the default log-only refuse stub.
 */

import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { ToolUseContext } from 'src/Tool.js'
import { assembleToolPool } from 'src/tools.js'
import {
  killAsyncAgent,
  queuePendingMessage,
  registerAsyncAgent,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { asAgentId } from 'src/types/ids.js'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { createUserMessage } from 'src/utils/messages.js'
import { getAgentModel } from 'src/utils/model/agent.js'
import type {
  EnsureObserverRuntimeHostOptions,
  ObserverRuntimeHost,
} from 'src/utils/observerAgents.js'
import { getParentSessionId } from 'src/utils/teammate.js'
import { runAsyncAgentLifecycle } from './agentToolUtils.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import { isBuiltInAgent } from './loadAgentsDir.js'
import { runAgent } from './runAgent.js'

export type AgentObserverRuntimeHostDeps = {
  /**
   * Fallback toolUseContext when a pairing has no armingToolUseContext
   * (e.g. main-session ensure from query).
   */
  toolUseContext?: ToolUseContext
  canUseTool?: CanUseToolFn
  /**
   * Fallback setAppState (prefer setAppStateForTasks when available).
   * Pairing.setAppState wins when present.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAppState?: (...args: any[]) => void
  log?: (msg: string) => void
}

type SetAppState = (...args: unknown[]) => void

function resolveSetAppState(
  pairingSet: unknown,
  fallback: SetAppState | undefined,
  toolUseContext: ToolUseContext | undefined,
): SetAppState {
  if (typeof pairingSet === 'function') {
    return pairingSet as SetAppState
  }
  if (typeof fallback === 'function') {
    return fallback
  }
  if (toolUseContext?.setAppStateForTasks) {
    return toolUseContext.setAppStateForTasks as SetAppState
  }
  if (toolUseContext?.setAppState) {
    return toolUseContext.setAppState as SetAppState
  }
  return () => {}
}

/**
 * Build real spawnFirstRun / deliver / abortObserver / writeTombstone handlers.
 * Handlers prefer pairing.armingToolUseContext / setAppState so one process host
 * can serve concurrent pairings without force-clobber.
 */
export function createAgentObserverRuntimeHostHandlers(
  deps: AgentObserverRuntimeHostDeps = {},
): Pick<
  ObserverRuntimeHost,
  'spawnFirstRun' | 'deliver' | 'abortObserver' | 'writeTombstone'
> {
  const log =
    deps.log ?? ((msg: string) => logForDebugging(msg, { level: 'debug' }))

  return {
    spawnFirstRun: async ({
      pairing,
      digest,
      framingPrompt,
      observerDefinition,
    }) => {
      const { planObserverSpawnFirstRun } = await import(
        'src/utils/observerAgents.js'
      )
      const plan = planObserverSpawnFirstRun({
        pairing,
        digest,
        framingPrompt,
        observerDefinition,
      })

      const armCtx =
        (pairing.armingToolUseContext as ToolUseContext | undefined) ??
        deps.toolUseContext
      if (!armCtx) {
        throw new Error(
          'ObserverRuntimeHost.spawnFirstRun requires armingToolUseContext or install-time toolUseContext',
        )
      }
      const armCanUseTool =
        (pairing.canUseTool as CanUseToolFn | undefined) ?? deps.canUseTool
      if (!armCanUseTool) {
        throw new Error(
          'ObserverRuntimeHost.spawnFirstRun requires canUseTool on pairing or install deps',
        )
      }
      const armSetAppState = resolveSetAppState(
        pairing.setAppState,
        deps.setAppState as SetAppState | undefined,
        armCtx,
      )

      const activeAgents = armCtx.options?.agentDefinitions?.activeAgents ?? []
      const observerAgentDef: AgentDefinition =
        activeAgents.find(a => a.agentType === plan.observerAgentType) ??
        ({
          agentType: plan.observerAgentType,
          whenToUse: `Observer for ${pairing.observedEnvelopeName}`,
          tools: ['*'],
          source: 'built-in',
          baseDir: 'built-in',
          model: 'inherit',
          permissionMode: 'acceptEdits',
          getSystemPrompt: () =>
            `You are the ${plan.observerAgentType} observer agent.`,
        } satisfies AgentDefinition)

      const observerAppState = armCtx.getAppState()
      const observerPermissionContext = {
        ...observerAppState.toolPermissionContext,
        mode: observerAgentDef.permissionMode ?? 'acceptEdits',
      }
      const observerTools = assembleToolPool(
        observerPermissionContext,
        observerAppState.mcp.tools,
      )

      const observerTask = registerAsyncAgent({
        agentId: plan.observerTaskId,
        description: plan.description,
        prompt: plan.prompt,
        selectedAgent: observerAgentDef,
        setAppState: armSetAppState as Parameters<
          typeof registerAsyncAgent
        >[0]['setAppState'],
        toolUseId: armCtx.toolUseId,
      })

      const observerPromptMessages = [
        createUserMessage({ content: plan.prompt }),
      ]

      void runWithAgentContext(
        {
          agentId: asAgentId(plan.observerTaskId),
          parentSessionId: getParentSessionId(),
          agentType: 'subagent' as const,
          subagentName: plan.observerAgentType,
          isBuiltIn: isBuiltInAgent(observerAgentDef),
          invocationKind: 'spawn' as const,
          invocationEmitted: false,
          isBackgroundAgent: true,
        },
        async () => {
          try {
            await runAsyncAgentLifecycle({
              taskId: observerTask.agentId,
              abortController: observerTask.abortController!,
              makeStream: onCacheSafeParams =>
                runAgent({
                  agentDefinition: observerAgentDef,
                  promptMessages: observerPromptMessages,
                  toolUseContext: armCtx,
                  canUseTool: armCanUseTool,
                  isAsync: true,
                  querySource: plan.querySource as Parameters<
                    typeof runAgent
                  >[0]['querySource'],
                  availableTools: observerTools,
                  description: plan.description,
                  override: {
                    agentId: asAgentId(observerTask.agentId),
                    abortController: observerTask.abortController!,
                  },
                  onCacheSafeParams,
                }),
              metadata: {
                prompt: plan.prompt,
                resolvedAgentModel: getAgentModel(
                  observerAgentDef.model,
                  armCtx.options.mainLoopModel,
                  undefined,
                  observerPermissionContext.mode,
                ),
                isBuiltInAgent: isBuiltInAgent(observerAgentDef),
                startTime: Date.now(),
                agentType: plan.observerAgentType,
                isAsync: true,
              },
              description: plan.description,
              toolUseContext: armCtx,
              rootSetAppState: armSetAppState as Parameters<
                typeof runAsyncAgentLifecycle
              >[0]['rootSetAppState'],
              agentIdForCleanup: plan.observerTaskId,
              enableSummarization: false,
              getWorktreeResult: async () => ({}),
            })
          } catch (err) {
            log(
              `[agentObserver] spawnFirstRun failed for ${plan.observerTaskId}: ${errorMessage(err)}`,
            )
          }
        },
      )
    },

    deliver: async ({ pairing, digest }) => {
      const armCtx =
        (pairing.armingToolUseContext as ToolUseContext | undefined) ??
        deps.toolUseContext
      const armSetAppState = resolveSetAppState(
        pairing.setAppState,
        deps.setAppState as SetAppState | undefined,
        armCtx,
      )
      queuePendingMessage(
        pairing.observerTaskId,
        digest,
        armSetAppState as Parameters<typeof queuePendingMessage>[2],
      )
    },

    writeTombstone: async ({ observerTaskId, observerAgentType }) => {
      try {
        const { writeObserverStoppedTombstone } = await import(
          'src/utils/observerAgents.js'
        )
        await writeObserverStoppedTombstone({
          observerTaskId,
          observerAgentType,
          log,
        })
      } catch (err) {
        log(
          `[agentObserver] writeTombstone failed for ${observerTaskId}: ${errorMessage(err)}`,
        )
      }
    },

    abortObserver: ({ observerTaskId, setAppState }) => {
      const armSetAppState = resolveSetAppState(
        setAppState,
        deps.setAppState as SetAppState | undefined,
        deps.toolUseContext,
      )
      try {
        killAsyncAgent(
          observerTaskId,
          armSetAppState as Parameters<typeof killAsyncAgent>[1],
        )
      } catch {
        // best-effort
      }
    },
  }
}

/**
 * Install (or merge) the real AgentTool-backed observer host into the process
 * singleton. Safe to call repeatedly — ensureObserverRuntimeHost merges without
 * force so concurrent pairings keep pairing-scoped context.
 */
export async function installAgentObserverRuntimeHost(
  deps: AgentObserverRuntimeHostDeps = {},
): Promise<ObserverRuntimeHost> {
  const { ensureObserverRuntimeHost } = await import(
    'src/utils/observerAgents.js'
  )
  const handlers = createAgentObserverRuntimeHostHandlers(deps)
  const opts: EnsureObserverRuntimeHostOptions = {
    ...handlers,
    log: deps.log,
  }
  return ensureObserverRuntimeHost(opts)
}
