/**
 * Shared real ObserverRuntimeHost handlers (G0t spawn/deliver/abort).
 *
 * AgentTool, query VOu (main-session ensure), and resumeAgent zOu all install
 * the same pairing-scoped host so first-run is a real async observer fork —
 * not the default log-only refuse stub.
 */

import { getMainThreadAgentId } from 'src/bootstrap/state.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { ToolUseContext } from 'src/Tool.js'
import { assembleToolPool } from 'src/tools.js'
import {
  killAsyncAgent,
  markAgentsNotified,
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
import {
  buildObserverFramingPrompt,
  type ObserverPairing,
} from 'src/utils/observerAgents.js'
import { getParentSessionId } from 'src/utils/teammate.js'
import type { InternalPermissionMode } from 'src/types/permissions.js'
import { OBSERVER_REPORT_TOOL_NAME } from '../ObserverReportTool/constants.js'
import {
  applyObserverExactToolPool,
  resolveAgentTools,
  runAsyncAgentLifecycle,
} from './agentToolUtils.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import { isBuiltInAgent } from './loadAgentsDir.js'
import { resolveWorkerPermissionMode } from './resumeAgent.js'
import { runAgent } from './runAgent.js'

/** Fallback tool allowlist when no observer agent definition is registered. */
const OBSERVER_FALLBACK_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  OBSERVER_REPORT_TOOL_NAME,
] as const

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
          // Never fall back to tools:* + acceptEdits — observer reads the
          // observed transcript and reports via ObserverReport only. Prompt
          // injection in observed output must not unlock Shell/Edit/MCP.
          tools: [...OBSERVER_FALLBACK_TOOLS],
          source: 'built-in',
          baseDir: 'built-in',
          model: 'inherit',
          permissionMode: 'default',
          getSystemPrompt: () =>
            `You are the ${plan.observerAgentType} observer agent. ` +
            'You may only read context and deliver findings with ObserverReport. ' +
            'Do not edit files, run shell commands, or call MCP tools.',
        } satisfies AgentDefinition)

      const observerAppState = armCtx.getAppState()
      // densable spawnFirstRun: c = MJe(armingPermissionMode, session) ?? session
      const sessionMode = observerAppState.toolPermissionContext.mode as
        | InternalPermissionMode
        | undefined
      const spawnMode = (resolveWorkerPermissionMode(
        pairing.armingPermissionMode as string | undefined,
        sessionMode,
      ) ??
        sessionMode ??
        'default') as InternalPermissionMode
      // densable spawnMode:c — stamp onto agent def so runAgent's
      // agentPermissionMode path can apply it (parent bypass/acceptEdits/auto
      // still win in runAgent, matching densable parent-precedence edges).
      const observerAgentDefForRun: AgentDefinition = {
        ...observerAgentDef,
        permissionMode: spawnMode,
      }
      const observerPermissionContext = {
        ...observerAppState.toolPermissionContext,
        mode: spawnMode,
      }
      // densable: m = Lco(WJ(e, pz(u, l1e(d), ...), !0, !1, !1, f).resolvedTools)
      // then E8(..., availableTools:m, useExactTools:!0, spawnMode:c)
      const observerPoolBase = assembleToolPool(
        observerPermissionContext,
        observerAppState.mcp.tools,
      )
      const observerTools = applyObserverExactToolPool(
        resolveAgentTools(
          observerAgentDefForRun,
          observerPoolBase,
          true, // isAsync
          false, // isMainThread
          true, // isObserverAgent
        ).resolvedTools,
      )

      // densable lYy: write sidecar isObserver:!0 before Sot, refuse if read-back fails.
      const { patchAgentMetadata, readAgentMetadata } = await import(
        'src/utils/sessionStorage.js'
      )
      await patchAgentMetadata(asAgentId(plan.observerTaskId), {
        agentType: observerAgentDef.agentType,
        isObserver: true,
      })
      const marker = await readAgentMetadata(asAgentId(plan.observerTaskId))
      if (marker?.isObserver !== true) {
        throw new Error('observer marker read-back failed')
      }

      // densable: framing (r) + digest (n) as two user messages — not a merged
      // single prompt. Digest stamps origin:{kind:"observer-activity"}.
      const framing =
        framingPrompt ??
        buildObserverFramingPrompt(pairing as unknown as ObserverPairing)
      const firstRunPromptForMeta = framing

      // densable observer Sot: ownerAgentId:mi(), isObserver:!0, no Gge
      // (Kle quietly parks notify; attachOwnerKeepalive:false).
      const mainOwnerId = getMainThreadAgentId()
      const observerTask = registerAsyncAgent({
        agentId: plan.observerTaskId,
        description: plan.description,
        prompt: firstRunPromptForMeta,
        selectedAgent: observerAgentDefForRun,
        setAppState: armSetAppState as Parameters<
          typeof registerAsyncAgent
        >[0]['setAppState'],
        toolUseId: armCtx.toolUseId,
        ownerAgentId: mainOwnerId,
        notificationTargetAgentId: asAgentId(mainOwnerId),
        isObserver: true,
        attachOwnerKeepalive: false,
      })
      // densable spawnFirstRun: Kle(s, a) immediately after Sot
      markAgentsNotified(
        plan.observerTaskId,
        armSetAppState as Parameters<typeof markAgentsNotified>[1],
      )

      // densable: promptMessages:[Nr({content:r}), Nr({content:n, origin:{kind:"observer-activity"}})]
      const observerPromptMessages = [
        createUserMessage({ content: framing }),
        createUserMessage({
          content: digest,
          origin: { kind: 'observer-activity' },
        }),
      ]

      // densable spawnFirstRun: await fY(..., Yqe(...)) — full lifecycle so
      // subsequent G0t.deliver Aye can claim (status no longer running).
      try {
        await runWithAgentContext(
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
            await runAsyncAgentLifecycle({
              taskId: observerTask.agentId,
              abortController: observerTask.abortController!,
              makeStream: onCacheSafeParams =>
                runAgent({
                  agentDefinition: observerAgentDefForRun,
                  promptMessages: observerPromptMessages,
                  toolUseContext: armCtx,
                  canUseTool: armCanUseTool,
                  isAsync: true,
                  querySource: plan.querySource as Parameters<
                    typeof runAgent
                  >[0]['querySource'],
                  availableTools: observerTools,
                  // densable spawnFirstRun: useExactTools:!0 so Lco pool is not
                  // re-filtered (and ObserverReport is not stripped).
                  useExactTools: true,
                  description: plan.description,
                  override: {
                    agentId: asAgentId(observerTask.agentId),
                    abortController: observerTask.abortController!,
                  },
                  onCacheSafeParams,
                }),
              metadata: {
                prompt: firstRunPromptForMeta,
                resolvedAgentModel: getAgentModel(
                  observerAgentDefForRun.model,
                  armCtx.options.mainLoopModel,
                  undefined,
                  spawnMode,
                ),
                isBuiltInAgent: isBuiltInAgent(observerAgentDefForRun),
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
          },
        )
      } catch (err) {
        log(
          `[agentObserver] spawnFirstRun failed for ${plan.observerTaskId}: ${errorMessage(err)}`,
        )
        throw err
      }
    },

    deliver: async ({ pairing, digest }) => {
      // densable G0t.deliver → Aye({
      //   agentId, prompt:digest, promptOrigin:{kind:"observer-activity"},
      //   awaitCompletion:!0, suppressOwnerNotification:!0, workerPermissionMode
      // })
      const armCtx =
        (pairing.armingToolUseContext as ToolUseContext | undefined) ??
        deps.toolUseContext
      if (!armCtx) {
        throw new Error(
          'ObserverRuntimeHost.deliver requires armingToolUseContext or install-time toolUseContext',
        )
      }
      const armCanUseTool =
        (pairing.canUseTool as CanUseToolFn | undefined) ?? deps.canUseTool
      if (!armCanUseTool) {
        throw new Error(
          'ObserverRuntimeHost.deliver requires canUseTool on pairing or install deps',
        )
      }
      const { resumeAgentBackground } = await import('./resumeAgent.js')
      await resumeAgentBackground({
        agentId: pairing.observerTaskId,
        prompt: digest,
        toolUseContext: armCtx,
        canUseTool: armCanUseTool,
        promptOriginKind: 'observer-activity',
        suppressOwnerNotification: true,
        awaitCompletion: true,
        // densable G0t.deliver: workerPermissionMode:o (armingPermissionMode)
        ...(pairing.armingPermissionMode !== undefined
          ? { workerPermissionMode: pairing.armingPermissionMode }
          : {}),
      })
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
