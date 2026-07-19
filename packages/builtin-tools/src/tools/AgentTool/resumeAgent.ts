import { promises as fsp } from 'fs'
import { getSdkAgentProgressSummariesEnabled } from 'src/bootstrap/state.js'
import { getSystemPrompt } from 'src/constants/prompts.js'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { ToolUseContext } from 'src/Tool.js'
import { registerAsyncAgent } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { assembleToolPool } from 'src/tools.js'
import { filterParentToolsForFork } from 'src/utils/agentToolFilter.js'
import { asAgentId } from 'src/types/ids.js'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import { runWithCwdOverride } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  createUserMessage,
  filterOrphanedThinkingOnlyMessages,
  filterUnresolvedToolUses,
  filterWhitespaceOnlyAssistantMessages,
} from 'src/utils/messages.js'
import { getAgentModel } from 'src/utils/model/agent.js'
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js'
import {
  getAgentTranscript,
  readAgentMetadata,
  writeAgentMetadata,
} from 'src/utils/sessionStorage.js'
import { createAgentId } from 'src/utils/uuid.js'
import { buildEffectiveSystemPrompt } from 'src/utils/systemPrompt.js'
import type { SystemPrompt } from 'src/utils/systemPromptType.js'
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js'
import { getParentSessionId } from 'src/utils/teammate.js'
import { reconstructForSubagentResume } from 'src/utils/toolResultStorage.js'
import { runAsyncAgentLifecycle } from './agentToolUtils.js'
import { resolveAgentDefinitionModel } from './built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { FORK_AGENT, isForkSubagentEnabled } from './forkSubagent.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import { isBuiltInAgent } from './loadAgentsDir.js'
import { runAgent } from './runAgent.js'

export type ResumeAgentResult = {
  agentId: string
  description: string
  outputFile: string
  /**
   * Official Aye alreadyCompleted — when continueInterruptedTurn and the
   * sidechain already ends on an assistant turn ($co false), skip re-run
   * and only report completion (orphan EAf path).
   */
  alreadyCompleted?: boolean
}
export async function resumeAgentBackground({
  agentId,
  prompt,
  toolUseContext,
  canUseTool,
  invokingRequestId,
  continueInterruptedTurn,
  promptIsMeta,
}: {
  agentId: string
  prompt: string
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  invokingRequestId?: string
  /**
   * Official Aye `continueInterruptedTurn` (orphan auto-resume / send-message
   * resume). When true and the filtered transcript is already complete
   * (ends on assistant), return alreadyCompleted without spawning.
   * Also densable: skip re-appending the resume prompt to promptMessages.
   */
  continueInterruptedTurn?: boolean
  /**
   * Official Aye `promptIsMeta` (n) — reserved for call-site parity when the
   * resume prompt is already on the sidechain.
   */
  promptIsMeta?: boolean
}): Promise<ResumeAgentResult> {
  void promptIsMeta
  const startTime = Date.now()
  const appState = toolUseContext.getAppState()
  // In-process teammates get a no-op setAppState; setAppStateForTasks
  // reaches the root store so task registration/progress/kill stay visible.
  const rootSetAppState =
    toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
  const permissionMode = appState.toolPermissionContext.mode

  const [transcript, meta] = await Promise.all([
    getAgentTranscript(asAgentId(agentId)),
    readAgentMetadata(asAgentId(agentId)),
  ])
  if (!transcript) {
    throw new Error(`No transcript found for agent ID: ${agentId}`)
  }

  // Official Aye: P = continueInterruptedTurn ? LVr(messages) : messages
  // then O = filters(P); if (continueInterruptedTurn && O.length>0 && !$co(O)) alreadyCompleted.
  let rawForResume = transcript.messages as Array<{
    type?: string
    message?: { content?: unknown; stop_reason?: string | null }
    [key: string]: unknown
  }>
  if (continueInterruptedTurn) {
    const { stripInterruptedTrailingTurns } = await import(
      'src/utils/orphanAgentResume.js'
    )
    rawForResume = stripInterruptedTrailingTurns(rawForResume)
  }
  const resumedMessages = filterWhitespaceOnlyAssistantMessages(
    filterOrphanedThinkingOnlyMessages(
      filterUnresolvedToolUses(rawForResume as never),
    ),
  )
  if (continueInterruptedTurn && resumedMessages.length > 0) {
    const { isAgentTranscriptIncomplete } = await import(
      'src/utils/orphanAgentResume.js'
    )
    if (!isAgentTranscriptIncomplete(resumedMessages as never)) {
      // Official Aye alreadyCompleted: mark notified + grace, return without re-run.
      try {
        const { PANEL_GRACE_MS } = await import('src/utils/task/framework.js')
        rootSetAppState(prev => {
          const tasks = prev.tasks
          const task = tasks?.[agentId]
          if (!task || !tasks) return prev
          const retain =
            'retain' in task
              ? Boolean((task as { retain?: boolean }).retain)
              : false
          const nextTask = {
            ...task,
            resuming: false,
            notified: true as const,
            evictAfter: retain
              ? (task as { evictAfter?: number }).evictAfter
              : Date.now() + PANEL_GRACE_MS,
          }
          return {
            ...prev,
            tasks: {
              ...tasks,
              [agentId]: nextTask as typeof task,
            },
          }
        })
      } catch {
        /* best-effort — task may not be registered on orphan cold resume */
      }
      return {
        agentId,
        description: meta?.description ?? '(resumed)',
        outputFile: getTaskOutputPath(agentId),
        alreadyCompleted: true,
      }
    }
  }
  const resumedReplacementState = reconstructForSubagentResume(
    toolUseContext.contentReplacementState,
    resumedMessages,
    transcript.contentReplacements,
  )
  // Best-effort: if the original worktree was removed externally, fall back
  // to parent cwd rather than crashing on chdir later.
  const resumedWorktreePath = meta?.worktreePath
    ? await fsp.stat(meta.worktreePath).then(
        s => (s.isDirectory() ? meta.worktreePath : undefined),
        () => {
          logForDebugging(
            `Resumed worktree ${meta.worktreePath} no longer exists; falling back to parent cwd`,
          )
          return undefined
        },
      )
    : undefined
  if (resumedWorktreePath) {
    // Bump mtime so stale-worktree cleanup doesn't delete a just-resumed worktree (#22355)
    const now = new Date()
    await fsp.utimes(resumedWorktreePath, now, now)
  }

  // Skip filterDeniedAgents re-gating — original spawn already passed permission checks
  let selectedAgent: AgentDefinition
  let isResumedFork = false
  if (meta?.agentType === FORK_AGENT.agentType) {
    selectedAgent = FORK_AGENT
    isResumedFork = true
  } else if (meta?.agentType) {
    const found = toolUseContext.options.agentDefinitions.activeAgents.find(
      a => a.agentType === meta.agentType,
    )
    selectedAgent = found ?? GENERAL_PURPOSE_AGENT
  } else {
    selectedAgent = GENERAL_PURPOSE_AGENT
  }

  const uiDescription = meta?.description ?? '(resumed)'

  let forkParentSystemPrompt: SystemPrompt | undefined
  if (isResumedFork) {
    if (toolUseContext.renderedSystemPrompt) {
      forkParentSystemPrompt = toolUseContext.renderedSystemPrompt
    } else {
      const mainThreadAgentDefinition = appState.agent
        ? appState.agentDefinitions.activeAgents.find(
            a => a.agentType === appState.agent,
          )
        : undefined
      const additionalWorkingDirectories = Array.from(
        appState.toolPermissionContext.additionalWorkingDirectories.keys(),
      )
      const defaultSystemPrompt = await getSystemPrompt(
        toolUseContext.options.tools,
        toolUseContext.options.mainLoopModel,
        additionalWorkingDirectories,
        toolUseContext.options.mcpClients,
      )
      forkParentSystemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt: toolUseContext.options.customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt: toolUseContext.options.appendSystemPrompt,
      })
    }
    if (!forkParentSystemPrompt) {
      throw new Error(
        'Cannot resume fork agent: unable to reconstruct parent system prompt',
      )
    }
  }

  // Resolve model for analytics metadata (runAgent resolves its own internally).
  // Official $6e: Explore firstParty cap-to-opus before getAgentModel.
  const resolvedAgentModel = getAgentModel(
    resolveAgentDefinitionModel(
      selectedAgent,
      toolUseContext.options.mainLoopModel,
    ),
    toolUseContext.options.mainLoopModel,
    undefined,
    permissionMode,
  )

  const workerPermissionContext = {
    ...appState.toolPermissionContext,
    mode: selectedAgent.permissionMode ?? 'acceptEdits',
  }
  const workerTools = isResumedFork
    ? filterParentToolsForFork(toolUseContext.options.tools)
    : assembleToolPool(workerPermissionContext, appState.mcp.tools)

  // Official densable: promptMessages: o ? O : [...O, ie]
  // continueInterruptedTurn skips re-appending the resume prompt (already mid-turn).
  const runAgentParams: Parameters<typeof runAgent>[0] = {
    agentDefinition: selectedAgent,
    promptMessages: continueInterruptedTurn
      ? [...resumedMessages]
      : [...resumedMessages, createUserMessage({ content: prompt })],
    toolUseContext,
    canUseTool,
    isAsync: true,
    querySource: getQuerySourceForAgent(
      selectedAgent.agentType,
      isBuiltInAgent(selectedAgent),
    ),
    model: undefined,
    // Fork resume: pass parent's system prompt (cache-identical prefix).
    // Non-fork: undefined → runAgent recomputes under wrapWithCwd so
    // getCwd() sees resumedWorktreePath.
    override: isResumedFork
      ? { systemPrompt: forkParentSystemPrompt }
      : undefined,
    availableTools: workerTools,
    // Transcript already contains the parent context slice from the
    // original fork. Re-supplying it would cause duplicate tool_use IDs.
    forkContextMessages: undefined,
    ...(isResumedFork && { useExactTools: true }),
    // Re-persist so metadata survives runAgent's writeAgentMetadata overwrite
    worktreePath: resumedWorktreePath,
    description: meta?.description,
    contentReplacementState: resumedReplacementState,
  }

  // Official zOu densable — resume re-arm observer pairing from agent metadata
  // pointer (observerTaskId / armingPermissionMode) when observed declares observer.
  try {
    const { ensureObservedAgentObserver } = await import(
      'src/utils/observerAgents.js'
    )
    const { installAgentObserverRuntimeHost } = await import(
      './observerRuntimeHost.js'
    )
    const { readAgentMetadata: readObsMeta } = await import(
      'src/utils/sessionStorage.js'
    )
    // Real G0t host before re-arm so first post-resume delivery can fork.
    await installAgentObserverRuntimeHost({
      toolUseContext,
      canUseTool,
      setAppState: rootSetAppState,
      log: msg => logForDebugging(msg),
    })
    // Prefer meta already loaded above; re-read only if fields missing (older files).
    const observedMeta = {
      ...(meta?.observerTaskId ? { observerTaskId: meta.observerTaskId } : {}),
      ...(meta?.armingPermissionMode
        ? { armingPermissionMode: meta.armingPermissionMode }
        : {}),
    }
    // If metadata lacked observer fields, try a fresh read (same path).
    if (!observedMeta.observerTaskId) {
      const fresh = await readObsMeta(asAgentId(agentId))
      if (fresh?.observerTaskId) {
        observedMeta.observerTaskId = fresh.observerTaskId
      }
      if (fresh?.armingPermissionMode) {
        observedMeta.armingPermissionMode = fresh.armingPermissionMode
      }
    }
    const { toolMatchesName } = await import('src/Tool.js')
    const { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } = await import(
      './constants.js'
    )
    const rearmed = await ensureObservedAgentObserver({
      observedTaskId: agentId,
      observedDefinition: {
        agentType: selectedAgent.agentType,
        ...('observer' in selectedAgent && selectedAgent.observer
          ? { observer: selectedAgent.observer as string }
          : {}),
        ...('observerMessage' in selectedAgent &&
        typeof selectedAgent.observerMessage === 'string'
          ? { observerMessage: selectedAgent.observerMessage }
          : {}),
      },
      observedName: selectedAgent.agentType,
      observedMeta:
        observedMeta.observerTaskId || observedMeta.armingPermissionMode
          ? observedMeta
          : null,
      activeAgents: toolUseContext.options.agentDefinitions.activeAgents,
      armingToolUseContext: toolUseContext,
      canUseTool,
      setAppState: rootSetAppState,
      // Match AgentTool o5r arm gate density (tools + AgentTool.checkPermissions).
      tools: toolUseContext.options.tools?.map(t => ({
        name: t.name,
        ...(t.aliases ? { aliases: t.aliases } : {}),
      })),
      gateCanUseTool: async ({
        subagentType,
        description: gateDesc,
        prompt: gatePrompt,
      }) => {
        const agentTool = toolUseContext.options.tools.find(
          t =>
            toolMatchesName(t, AGENT_TOOL_NAME) ||
            toolMatchesName(t, LEGACY_AGENT_TOOL_NAME),
        )
        if (!agentTool) return 'deny'
        try {
          const result = await agentTool.checkPermissions(
            {
              description: gateDesc,
              prompt: gatePrompt,
              subagent_type: subagentType,
              run_in_background: true,
            },
            toolUseContext,
          )
          if (result.behavior === 'allow') return 'allow'
          if (result.behavior === 'deny') return 'deny'
          if (result.behavior === 'ask') return 'ask'
          return 'allow'
        } catch {
          return 'error'
        }
      },
      // Cold resume: prior observer process is not live → firstRunDone=false
      // + fresh observerTaskId (avoids re-register under residual dead id).
      isObserverProcessRunning: observerTaskId => {
        try {
          const tasks = toolUseContext.getAppState().tasks
          const task = tasks?.[observerTaskId] as
            | { type?: string; status?: string }
            | undefined
          return task?.type === 'local_agent' && task.status === 'running'
        } catch {
          return false
        }
      },
      generateObserverTaskId: () => createAgentId(),
      // Official KOu loadSidecar — feed observerStopped so reattach blocks.
      reattach: {
        priorObserverTaskId: observedMeta.observerTaskId,
        declaredObserverType:
          'observer' in selectedAgent &&
          typeof selectedAgent.observer === 'string'
            ? selectedAgent.observer
            : selectedAgent.agentType,
        loadSidecar: async sidecarId => {
          const side = await readObsMeta(asAgentId(sidecarId))
          if (!side) return null
          return {
            ...(side.observerStopped ? { observerStopped: true } : {}),
            agentType: side.agentType,
          }
        },
        isSidecarReattachable: async sidecarId => {
          try {
            const t = await getAgentTranscript(asAgentId(sidecarId))
            return Boolean(t)
          } catch {
            return false
          }
        },
      },
      log: msg => logForDebugging(msg),
    })
    // HXt: if cold reattach minted a fresh observer id, persist the pointer
    // so a later resume can reattach/hot-path or re-cold-spawn correctly.
    if (rearmed && rearmed.observerTaskId !== observedMeta.observerTaskId) {
      void writeAgentMetadata(asAgentId(agentId), {
        agentType: selectedAgent.agentType,
        description: uiDescription,
        observerTaskId: rearmed.observerTaskId,
        ...(rearmed.armingPermissionMode
          ? { armingPermissionMode: rearmed.armingPermissionMode }
          : {}),
      }).catch(_err =>
        logForDebugging(
          `Failed to write cold-reattach observer pointer metadata: ${_err}`,
        ),
      )
    }
  } catch (err) {
    logForDebugging(
      `[agentObserver] resume re-arm failed for '${selectedAgent.agentType}': ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Skip name-registry write — original entry persists from the initial spawn
  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description: uiDescription,
    prompt,
    selectedAgent,
    setAppState: rootSetAppState,
    toolUseId: toolUseContext.toolUseId,
  })

  const metadata = {
    prompt,
    resolvedAgentModel,
    isBuiltInAgent: isBuiltInAgent(selectedAgent),
    startTime,
    agentType: selectedAgent.agentType,
    isAsync: true,
  }

  const asyncAgentContext = {
    agentId,
    parentSessionId: getParentSessionId(),
    agentType: 'subagent' as const,
    subagentName: selectedAgent.agentType,
    isBuiltIn: isBuiltInAgent(selectedAgent),
    invokingRequestId,
    invocationKind: 'resume' as const,
    invocationEmitted: false,
    isBackgroundAgent: true as const,
  }

  const wrapWithCwd = <T>(fn: () => T): T =>
    resumedWorktreePath ? runWithCwdOverride(resumedWorktreePath, fn) : fn()

  void runWithAgentContext(asyncAgentContext, () =>
    wrapWithCwd(() =>
      runAsyncAgentLifecycle({
        taskId: agentBackgroundTask.agentId,
        abortController: agentBackgroundTask.abortController!,
        makeStream: onCacheSafeParams =>
          runAgent({
            ...runAgentParams,
            override: {
              ...runAgentParams.override,
              agentId: asAgentId(agentBackgroundTask.agentId),
              abortController: agentBackgroundTask.abortController!,
            },
            onCacheSafeParams,
          }),
        metadata,
        description: uiDescription,
        toolUseContext,
        rootSetAppState,
        agentIdForCleanup: agentId,
        enableSummarization:
          isCoordinatorMode() ||
          isForkSubagentEnabled() ||
          getSdkAgentProgressSummariesEnabled(),
        getWorktreeResult: async () =>
          resumedWorktreePath ? { worktreePath: resumedWorktreePath } : {},
      }),
    ),
  )

  return {
    agentId,
    description: uiDescription,
    outputFile: getTaskOutputPath(agentId),
  }
}
