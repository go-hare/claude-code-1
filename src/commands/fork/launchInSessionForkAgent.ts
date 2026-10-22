/**
 * densable 2.1.289 `aIt` for gwd/subtask slash paths.
 *
 * Gold `aIt` never calls AgentTool — allocateName + B1 FORK_AGENT + N5 stream.
 * Local host: registerAsyncAgent + runAsyncAgentLifecycle(runAgent) with
 * FORK_AGENT, useExactTools, parent system prompt, Bln directive message.
 */
import {
  getIsNonInteractiveSession,
  getMainThreadAgentId,
} from '../../bootstrap/state.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getAgentContext,
  isDelegatedObservation,
  runWithAgentContext,
  type SubagentContext,
} from '../../utils/agentContext.js'
import { getCwd } from '../../utils/cwd.js'
import { getAgentModel } from '../../utils/model/agent.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { createUserMessage } from '../../utils/messages.js'
import { getQuerySourceForAgent } from '../../utils/promptCategory.js'
import {
  assertAndTakeConcurrencySlot,
  assertCanSpawnSubagent,
} from '../../utils/sessionSpawnCaps.js'
import {
  recordSubagentSpawn,
  webFetchSavedFilesForAgent,
} from '../../utils/subagentSpawnLedger.js'
import { isReservedSpawnAgentName } from '../../utils/swarm/constants.js'
import {
  addKeepaliveReason,
  agentKeepaliveReason,
} from '../../utils/task/framework.js'
import { getParentSessionId } from '../../utils/teammate.js'
import { asAgentId, type AgentId } from '../../types/ids.js'
import { createAgentId } from '../../utils/uuid.js'
import { agentContextSpawnDepth } from '../../utils/webFetchAdmission.js'
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import {
  FORK_AGENT,
  buildChildMessage,
} from '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js'
import { isBuiltInAgent } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { runAgent } from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import { runAsyncAgentLifecycle } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import { toolMatchesName } from '../../Tool.js'
import {
  registerAsyncAgent,
  resolvePanelOwnerAgentId,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { SetAppState } from '../../Task.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import type { Message } from '../../types/message.js'

export type InSessionForkLaunchResult = {
  agentId: string
  name: string
}

/**
 * densable `pwd` / `h(t)` — first 3 tokens, lowercased, ≤24, fallback `"fork"`.
 */
export function deriveInSessionForkName(prompt: string): string {
  return (
    prompt
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'fork'
  )
}

/** densable description = collapsed prompt, 50 chars with ellipsis. */
export function deriveInSessionForkDescription(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim()
  return oneLine.length > 50 ? `${oneLine.slice(0, 49)}…` : oneLine
}

function allocateDisplayName(
  baseName: string,
  registry: Map<string, AgentId>,
): string {
  const seed = baseName === 'main' || baseName.length === 0 ? 'fork' : baseName
  if (!registry.has(seed)) return seed
  let i = 2
  while (registry.has(`${seed}-${i}`)) i++
  return `${seed}-${i}`
}

/**
 * densable `aIt(directive, context, canUseTool)` → `{agentId, name} | null`.
 *
 * Gold: endedByModel / coordinator / missing prompt → null (callers toast).
 * Spawn is registerAsyncAgent + N5/runAgent, never AgentTool.
 */
export async function launchInSessionForkAgent(
  directive: string,
  context: LocalJSXCommandContext,
  _lastAssistantMessage: Message,
): Promise<InSessionForkLaunchResult | null> {
  const canUseTool = context.canUseTool
  if (!canUseTool) {
    logForDebugging('In-session fork: canUseTool missing', { level: 'error' })
    return null
  }

  const appState = context.getAppState()
  if (appState.endedByModel) {
    logForDebugging('In-session fork: endedByModel', { level: 'error' })
    return null
  }
  if (isCoordinatorMode()) {
    return null
  }

  let systemPrompt = context.renderedSystemPrompt
  if (!systemPrompt) {
    const mainThreadAgentDefinition = appState.agent
      ? appState.agentDefinitions.activeAgents.find(
          a => a.agentType === appState.agent,
        )
      : undefined
    const additionalWorkingDirectories = Array.from(
      appState.toolPermissionContext.additionalWorkingDirectories.keys(),
    )
    const defaultSystemPrompt = await getSystemPrompt(
      context.options.tools,
      context.options.mainLoopModel,
      additionalWorkingDirectories,
      context.options.mcpClients,
    )
    systemPrompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition,
      toolUseContext: context,
      customSystemPrompt: context.options.customSystemPrompt,
      defaultSystemPrompt,
      appendSystemPrompt: context.options.appendSystemPrompt,
    })
  }
  if (!systemPrompt) {
    logForDebugging('In-session fork: system prompt missing', {
      level: 'error',
    })
    return null
  }

  const name = allocateDisplayName(
    deriveInSessionForkName(directive),
    appState.agentNameRegistry ?? new Map(),
  )
  const description = deriveInSessionForkDescription(directive)
  const agentId = createAgentId(name)
  const startTime = Date.now()
  const childSpawnDepth = agentContextSpawnDepth(getAgentContext()) + 1
  const permissionMode = appState.toolPermissionContext.mode
  const resolvedAgentModel = getAgentModel(
    FORK_AGENT.model,
    context.options.mainLoopModel ?? getMainLoopModel(),
    'inherit',
    permissionMode,
  )
  // Gold aIt promptMessages: Re({content:[{type:"text",text:Bln(t)}]})
  const promptMessages = [
    createUserMessage({
      content: [{ type: 'text' as const, text: buildChildMessage(directive) }],
    }),
  ]
  const setAppState: SetAppState =
    context.setAppStateForTasks ?? context.setAppState
  const rootSetAppState = setAppState

  try {
    assertCanSpawnSubagent({
      abortSignal: context.abortController.signal,
      allowInterrupt: true,
      maxBudgetUsd: context.options.maxBudgetUsd,
    })
  } catch (error) {
    logForDebugging(`In-session fork: spawn refused (${error})`, {
      level: 'error',
    })
    return null
  }

  let releaseConcurrencySlot: (() => void) | undefined
  try {
    releaseConcurrencySlot = assertAndTakeConcurrencySlot({
      mainLoopModel: context.options.mainLoopModel,
      effortValue: appState.effortValue,
      ultracode: appState.ultracode,
    })
  } catch (error) {
    logForDebugging(`In-session fork: concurrency (${error})`, {
      level: 'error',
    })
    return null
  }

  const parentAgentId = context.agentId
  const ownerId =
    resolvePanelOwnerAgentId(parentAgentId, context.getAppState) ??
    getMainThreadAgentId()
  const canReadOutputFile = context.options.tools.some(
    t =>
      toolMatchesName(t, FILE_READ_TOOL_NAME) ||
      toolMatchesName(t, BASH_TOOL_NAME),
  )
  const spawnedSubagent = recordSubagentSpawn({
    agentType: FORK_AGENT.agentType,
    runInBackground: true,
    runsInBackground: true,
    depth: childSpawnDepth,
  })

  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description,
    prompt: directive,
    selectedAgent: FORK_AGENT,
    setAppState: rootSetAppState,
    toolUseId: context.toolUseId,
    ownerAgentId: ownerId,
    notificationTargetAgentId: asAgentId(ownerId),
    parentAgentId,
    spawnDepth: childSpawnDepth,
    cwd: getCwd(),
    spawnedSubagent,
    webFetchSavedFiles: webFetchSavedFilesForAgent(FORK_AGENT),
    outputFileReadable: canReadOutputFile,
    model: resolvedAgentModel,
    attachOwnerKeepalive: false,
  })

  if (name && !isReservedSpawnAgentName(name)) {
    rootSetAppState(prev => {
      const next = new Map(prev.agentNameRegistry)
      next.set(name, asAgentId(agentId))
      return { ...prev, agentNameRegistry: next }
    })
  }

  if (!getIsNonInteractiveSession()) {
    addKeepaliveReason(ownerId, agentKeepaliveReason(agentId), rootSetAppState)
  }

  const asyncAgentContext: SubagentContext = {
    agentId,
    parentSessionId: getParentSessionId(),
    agentType: 'subagent',
    subagentName: FORK_AGENT.agentType,
    isBuiltIn: isBuiltInAgent(FORK_AGENT),
    invocationKind: 'spawn',
    invocationEmitted: false,
    isBackgroundAgent: true,
    depth: childSpawnDepth,
    ...(isDelegatedObservation(getAgentContext())
      ? { delegatedObservation: true }
      : {}),
  }

  const metadata = {
    prompt: directive,
    resolvedAgentModel,
    isBuiltInAgent: isBuiltInAgent(FORK_AGENT),
    startTime,
    agentType: FORK_AGENT.agentType,
    isAsync: true as const,
  }

  void runWithAgentContext(asyncAgentContext, () =>
    runAsyncAgentLifecycle({
      taskId: agentBackgroundTask.agentId,
      abortController: agentBackgroundTask.abortController!,
      makeStream: onCacheSafeParams =>
        runAgent({
          agentDefinition: FORK_AGENT,
          promptMessages,
          toolUseContext: context,
          canUseTool,
          isAsync: true,
          querySource: getQuerySourceForAgent(
            FORK_AGENT.agentType,
            isBuiltInAgent(FORK_AGENT),
          ),
          model: undefined,
          override: {
            systemPrompt,
            agentId: asAgentId(agentBackgroundTask.agentId),
            abortController: agentBackgroundTask.abortController!,
          },
          availableTools: context.options.tools,
          forkContextMessages: context.messages,
          useExactTools: true,
          onCacheSafeParams,
          description,
          name,
          toolUseId: context.toolUseId,
          parentAgentId: context.agentId,
          spawnDepth: childSpawnDepth,
          handbackOptIn: false,
        }),
      metadata,
      description,
      toolUseContext: context,
      rootSetAppState,
      agentIdForCleanup: agentId,
      enableSummarization: true,
      getWorktreeResult: async () => ({}),
      onRunSettled: releaseConcurrencySlot,
    }),
  )

  return { agentId, name }
}

/**
 * AgentTool async path still returns `{ data: { status: 'async_launched', agentId } }`.
 * Kept for tests / mid-refactor streams.
 */
export function extractAgentIdFromToolResult(
  result: unknown,
): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const rec = result as Record<string, unknown>

  const direct = pickAgentId(rec)
  if (direct) return direct

  const data = rec.data
  if (data && typeof data === 'object') {
    const fromData = pickAgentId(data as Record<string, unknown>)
    if (fromData) return fromData
  }

  return undefined
}

function pickAgentId(rec: Record<string, unknown>): string | undefined {
  for (const key of ['agentId', 'agent_id'] as const) {
    const v = rec[key]
    if (typeof v === 'string' && v.length >= 4) return v
  }
  return undefined
}
