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
import { resolveMainLoopModel } from 'src/utils/contextLayers.js'
import { getAgentModel } from 'src/utils/model/agent.js'
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js'
import {
  getAgentTranscript,
  readAgentMetadata,
  recordSidechainTranscript,
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
  /**
   * Official Aye awaitCompletion path — final text from the completed turn
   * after joining the lifecycle promise (`Tu(pe.result?.content??[], "\n")`).
   */
  finalText?: string
}

/**
 * Official densable B6 — ResumeAgentStateError base for Aye resume failures
 * that are not a hard user-stop. Observer host restarts on this name.
 */
export class ResumeAgentStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeAgentStateError'
  }
}

/**
 * Official densable orr extends B6 — AgentStoppedByUserError. Thrown by Aye
 * when stoppedByUser refuses silent resume. Observer delivery classifies this
 * name as pairing-terminal (no restart).
 */
export class AgentStoppedByUserError extends ResumeAgentStateError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentStoppedByUserError'
  }
}

export async function resumeAgentBackground({
  agentId,
  prompt,
  toolUseContext,
  canUseTool,
  invokingRequestId,
  continueInterruptedTurn,
  userInitiated,
  promptOriginKind,
  suppressOwnerNotification,
  awaitCompletion,
  workerPermissionMode: _workerPermissionMode,
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
   * Also densable: if(continueInterruptedTurn) skip Xeo append and skip
   * re-appending the resume prompt to promptMessages.
   */
  continueInterruptedTurn?: boolean
  /**
   * Official Aye `userInitiated` — when true, clears stoppedByUser marker and
   * allows resume after an explicit user re-launch. Silent/auto resumes refuse
   * when metadata.stoppedByUser is set.
   */
  userInitiated?: boolean
  /**
   * Official promptOrigin.kind — `observer-activity` bypasses the stoppedByUser
   * refuse (observer re-arm must resume observed agents the user stopped).
   */
  promptOriginKind?: string
  /**
   * Official Aye `suppressOwnerNotification` — densable Cxt.deliver passes
   * `!0` so observer mid-task resume does not surface owner BRt noise. Local:
   * Kle after Sot + shouldNotifyOwner:!1 when also awaiting.
   */
  suppressOwnerNotification?: boolean
  /**
   * Official Aye `awaitCompletion` — densable observer deliver uses `!0`.
   * When true: parentAbortController linked, join lifecycle, return finalText,
   * finally notify+evictAfter grace (Yqe join path).
   */
  awaitCompletion?: boolean
  /**
   * Official Aye `workerPermissionMode` — densable observer deliver passes
   * arming permission mode. Accepted for call-site parity (runAgent residual).
   */
  workerPermissionMode?: string
  /**
   * Official Aye `promptIsMeta` (n) — when true, densable skips Xeo
   * (`if(!n&&!o)Xeo`) because the prompt is already on the sidechain.
   */
  promptIsMeta?: boolean
}): Promise<ResumeAgentResult> {
  void _workerPermissionMode
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

  // Official Aye: if (b?.stoppedByUser && r?.kind !== "observer-activity") {
  //   if (!c) throw orr(...); else clear marker via T1e
  // }
  // Second gate BEFORE Sot: if (!c && Wl(ne) && ne.stoppedByUser) throw orr
  const refuseStoppedMsg = `Agent ${agentId} was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.`
  if (
    meta?.stoppedByUser === true &&
    promptOriginKind !== 'observer-activity'
  ) {
    if (!userInitiated) {
      throw new AgentStoppedByUserError(refuseStoppedMsg)
    }
    // Explicit user re-launch: clear stop marker on sidecar so subsequent
    // silent resumes are not blocked after this intentional restart.
    try {
      const { stoppedByUser: _cleared, ...rest } = meta
      await writeAgentMetadata(asAgentId(agentId), {
        ...rest,
        agentType: rest.agentType ?? 'general-purpose',
      })
    } catch (err) {
      logForDebugging(
        `failed to clear stop marker for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  // Official Aye densable: if (r?.kind==="observer-activity" && b?.isObserver!==!0)
  // throw B6(`Observer sidecar for ${e} missing or did not confirm isObserver...`)
  if (promptOriginKind === 'observer-activity' && meta?.isObserver !== true) {
    throw new ResumeAgentStateError(
      `Observer sidecar for ${agentId} missing or did not confirm isObserver; refusing delivery`,
    )
  }

  // Live registry second gate (densable ne.stoppedByUser BEFORE Sot/register)
  // checked just above registerAsyncAgent when userInitiated is false.
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
      // Official Aye alreadyCompleted: g.update(e, {resuming:!1, notified:!0,
      // evictAfter: Date.now()+_re}) then return without re-running.
      try {
        const { PANEL_GRACE_MS } = await import('src/utils/task/framework.js')
        rootSetAppState(prev => {
          const tasks = prev.tasks
          const task = tasks?.[agentId]
          if (!task || !tasks) return prev
          const retain =
            'retain' in task ? Boolean((task as { retain?: boolean }).retain) : false
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

  // densable X$ — last model permissionLayer wins over options.mainLoopModel.
  const parentMainLoopModel = resolveMainLoopModel(toolUseContext)

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
        parentMainLoopModel,
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
    resolveAgentDefinitionModel(selectedAgent, parentMainLoopModel),
    parentMainLoopModel,
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

  // Official densable:
  //   ie = r ? Nr({content:cIt(t,r),origin:r,isMeta:!0})
  //        : Nr({content:t,...n&&{isMeta:!0}})
  //   promptMessages: o ? O : [...O, ie]
  // Local: observer-activity leaves body as-is (cIt case); stamps origin+isMeta.
  const resumeUserMessage = promptOriginKind
    ? createUserMessage({
        content: prompt,
        origin: promptOriginKind as never,
        isMeta: true,
      })
    : createUserMessage({
        content: prompt,
        ...(promptIsMeta ? { isMeta: true as const } : {}),
      })
  const runAgentParams: Parameters<typeof runAgent>[0] = {
    agentDefinition: selectedAgent,
    promptMessages: continueInterruptedTurn
      ? [...resumedMessages]
      : [...resumedMessages, resumeUserMessage],
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

  // Official Aye second stoppedByUser gate BEFORE Sot(register):
  //   ne = g.get(e); if (!c && Wl(ne) && ne.stoppedByUser) throw orr(...)
  // Must run pre-register: densable ekg does not carry stoppedByUser across
  // replace, so a post-Sot read would always miss hAe's live stamp. Meta was
  // cleared above when userInitiated; live flag still blocks silent resume
  // if only the in-memory task was stamped (sidecar missing).
  if (!userInitiated) {
    let liveStopped = false
    rootSetAppState(prev => {
      const t = prev.tasks?.[agentId] as
        | { type?: string; stoppedByUser?: boolean }
        | undefined
      if (t?.type === 'local_agent' && t.stoppedByUser === true) {
        liveStopped = true
      }
      return prev
    })
    if (liveStopped) {
      throw new AgentStoppedByUserError(refuseStoppedMsg)
    }
  }

  // Skip name-registry write — original entry persists from the initial spawn
  // Official densable: if(!n&&!o)Xeo(e, Ace(r)?ie:Nr(...), g)
  // Append resume prompt to in-memory task transcript + sidechain before Sot
  // so retain/panel and disk share the new user turn. Skip when promptIsMeta
  // (n) or continueInterruptedTurn (o) — densable already has that message.
  if (!promptIsMeta && !continueInterruptedTurn) {
    try {
      rootSetAppState(prev => {
        const t = prev.tasks?.[agentId]
        if (!t || t.type !== 'local_agent') return prev
        const base =
          'messages' in t && Array.isArray((t as { messages?: unknown[] }).messages)
            ? ((t as { messages?: unknown[] }).messages as unknown[])
            : []
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [agentId]: {
              ...t,
              messages: [...base, resumeUserMessage] as never,
            },
          },
        }
      })
      void recordSidechainTranscript(
        [resumeUserMessage as never],
        agentId,
      ).catch(err =>
        logForDebugging(
          `Xeo sidechain append failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    } catch {
      /* best-effort — registry may lack the task on cold resume */
    }
  }

  // Official Sot: ...r?.kind==="observer-activity"&&{isObserver:!0}
  // Also re-stamp when sidecar already marks isObserver (observer cold resume).
  // densable: parentAbortController:i?s.abortController:void 0
  const stampIsObserver =
    promptOriginKind === 'observer-activity' || meta?.isObserver === true
  // densable Sot: ownerAgentId: mi() on cold resume (main-owned). Local only
  // stamps nested panel parents so BRt/Gge do not attach to session id.
  let nestedOwnerId: string | undefined
  try {
    const { resolvePanelOwnerAgentId } = await import(
      'src/tasks/LocalAgentTask/LocalAgentTask.js'
    )
    nestedOwnerId = resolvePanelOwnerAgentId(
      toolUseContext.agentId,
      toolUseContext.getAppState,
    )
  } catch {
    nestedOwnerId = undefined
  }
  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description: uiDescription,
    prompt,
    selectedAgent,
    setAppState: rootSetAppState,
    toolUseId: toolUseContext.toolUseId,
    ...(awaitCompletion
      ? { parentAbortController: toolUseContext.abortController }
      : {}),
    ...(stampIsObserver ? { isObserver: true } : {}),
    ...(nestedOwnerId
      ? {
          ownerAgentId: nestedOwnerId,
          notificationTargetAgentId: asAgentId(nestedOwnerId),
          parentAgentId: nestedOwnerId,
        }
      : {}),
  })

  // Official Aye: if(u) Kle(re.agentId, g) — suppressOwnerNotification parks
  // the resumed agent as quietly notified so complete/BRt does not re-notify
  // the owner for observer-activity digests.
  if (suppressOwnerNotification) {
    try {
      const { markAgentsNotified } = await import(
        'src/tasks/LocalAgentTask/LocalAgentTask.js'
      )
      markAgentsNotified(agentId, rootSetAppState)
    } catch {
      /* optional in pure unit contexts */
    }
  }

  // Official Aye densable: after Sot(register) + await exu(re-arm) → Jeo(e, g).
  // Local re-arm runs just above; Jeo sweeps stale agent:/workflow: KA on the
  // resumed agent so orphan holds from a prior terminal child do not pin the
  // panel after resume re-attaches live observer/workflow children.
  try {
    const { sweepStaleKeepaliveReasons } = await import(
      'src/utils/task/framework.js'
    )
    sweepStaleKeepaliveReasons(agentId, rootSetAppState)
  } catch {
    /* best-effort — registry may be empty in pure unit contexts */
  }

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

  // densable: shouldNotifyOwner:i?()=>!1:void 0
  const lifecyclePromise = runWithAgentContext(asyncAgentContext, () =>
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
        ...(awaitCompletion ? { shouldNotifyOwner: () => false } : {}),
      }),
    ),
  )

  if (awaitCompletion) {
    // Official: if(i) try{await Ae; finalText=Tu(...)} finally{notified+evictAfter}
    try {
      await lifecyclePromise
      let finalText = ''
      rootSetAppState(prev => {
        const t = prev.tasks?.[agentId] as
          | {
              type?: string
              result?: { content?: Array<{ type?: string; text?: string }> }
            }
          | undefined
        if (t?.type === 'local_agent' && t.result?.content) {
          finalText = t.result.content
            .map(c => (c && typeof c.text === 'string' ? c.text : ''))
            .filter(Boolean)
            .join('\n')
        }
        return prev
      })
      return {
        agentId,
        description: uiDescription,
        outputFile: getTaskOutputPath(agentId),
        finalText,
      }
    } finally {
      try {
        const { PANEL_GRACE_MS } = await import('src/utils/task/framework.js')
        rootSetAppState(prev => {
          const t = prev.tasks?.[agentId]
          if (!t) return prev
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [agentId]: {
                ...t,
                notified: true,
                evictAfter: Date.now() + PANEL_GRACE_MS,
              } as typeof t,
            },
          }
        })
      } catch {
        /* best-effort */
      }
    }
  }

  void lifecyclePromise

  return {
    agentId,
    description: uiDescription,
    outputFile: getTaskOutputPath(agentId),
  }
}
